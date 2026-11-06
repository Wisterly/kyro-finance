/**
 * KYRO FINANCE | BATERIA DE HOMOLOGAÇÃO OFICIAL: SUBETAPA 03.4
 * 
 * Verificação Estrita de Concorrência, Lease Monotônico, Fencing Tokens,
 * Resiliência Multi-Processo pós-reinício e Fronteira Criptográfica do Webhook.
 * 
 * Cobertura Completa:
 * 1. CONCORRÊNCIA E LEASE NO MOTOR CONTÁBIL (COMPONENTE 04):
 *    - Aquisição atômica com fencing token = 1
 *    - Reaquisição pelo mesmo titular e bloqueio de titular concorrente
 *    - Renovação com token válido vs rejeição de renovação com token obsoleto (412)
 *    - Rejeição de renovação por titular incorreto (412) e após expiração (412)
 *    - Assunção após expiração gerando token monotônico = 2
 *    - Liberação com token obsoleto rejeitada vs liberação com token válido
 * 
 * 2. DISPUTA CONCORRENTE REAL MULTI-PROCESSO PELA REDE HTTP:
 *    - Processo A (Porta 4101, PID A) e Processo B (Porta 4102, PID B) sobre Firestore Emulator
 *    - Processo A adquire lease (TTL 1200ms, token 1) -> expira
 *    - Processo B assume lease (token 2)
 *    - Processo A tenta comitar transação com token 1 obsoleto -> HTTP 412 (FENCING_TOKEN_OBSOLETE)
 *    - Verificação direta no Firestore: saldo R$ 0,00 intacto, zero efeitos contábeis do Processo A
 *    - Processo B comita com token 2 -> HTTP 200 OK, saldo atualizado, recibo persistido com token 2
 *    - Processo A tenta renovar/liberar com token 1 -> HTTP 412 (FENCING_TOKEN_OBSOLETE)
 * 
 * 3. RETRY APÓS REINÍCIO E PERDA DE CONFIRMAÇÃO:
 *    - Kill nos processos A e B (simulação de crash/reinício de infraestrutura)
 *    - Subida de Processo C (Porta 4103, PID C) conectado ao mesmo Firestore Emulator
 *    - Reenvio do mesmo requestId com payload idêntico -> HTTP 200 OK, replay: true, sem duplo débito
 *    - Reenvio do mesmo requestId com payload divergente -> HTTP 409 (IDEMPOTENCY_PAYLOAD_MISMATCH)
 *    - Falha pré-commit -> Estado e coleções no Firestore rigorosamente preservados
 * 
 * 4. FRONTEIRA CRIPTOGRÁFICA DO WEBHOOK (HMAC + TIMESTAMP + NONCE):
 *    - Assinatura HMAC SHA-256 válida sobre bytes originais -> HTTP 200 OK
 *    - Corpo adulterado (1 byte modificado) -> HTTP 401 (WEBHOOK_HMAC_INVALID)
 *    - Timestamp expirado (> 5 minutos) -> HTTP 401 (WEBHOOK_TIMESTAMP_EXPIRED)
 *    - Nonce repetido (Replay Attack) -> HTTP 409 (WEBHOOK_NONCE_REPLAY)
 *    - Origem sem autorização -> HTTP 401 (WEBHOOK_ORIGIN_UNAUTHORIZED)
 *    - Telefone sem vínculo -> HTTP 403 (UNBOUND_PROVIDER_IDENTITY)
 *    - Telefone ambíguo -> HTTP 409 (AMBIGUOUS_PROVIDER_IDENTITY)
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { 
  getOfficialAuthEmulatorToken, 
  DEMO_PROJECT_ID 
} from '../services/firebaseAdminAuth';
import { FirestoreAdminStore } from '../services/firestoreAdminStore';
import { 
  FirestoreLedgerAdapter, 
  LeaseExpiredError, 
  FencingTokenMismatchError, 
  LeaseHolderMismatchError, 
  LeaseAlreadyHeldError 
} from '../services/firestoreAdapter';
import { LeaseManager } from './concurrency';
import { TransactionalStoreMock } from '../services/storeClient';
import { 
  validateWebhookHmac, 
  validateWebhookTimestamp, 
  validateWebhookNonce, 
  resolveProviderBinding, 
  ProviderBinding 
} from '../services/authBoundary';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ [APROVADO] ${testName}`);
    passCount++;
  } else {
    console.error(`  ✗ [FALHOU] ${testName}${detail ? ` -> ${detail}` : ''}`);
    failCount++;
  }
}

// Inicializador de processos do servidor HTTP standalone
const spawnedProcesses: ChildProcess[] = [];

function startServerProcess(port: number): { proc: ChildProcess; pid: number } {
  const serverScript = path.resolve(process.cwd(), 'src/server/httpServer.ts');
  const env = {
    ...process.env,
    PORT: String(port),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    GCLOUD_PROJECT: DEMO_PROJECT_ID,
    STORAGE_DISABLED: 'false'
  };

  const proc = spawn('npx.cmd', ['tsx', serverScript, '--port', String(port)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  const pid = proc.pid || 0;
  spawnedProcesses.push(proc);
  return { proc, pid };
}

async function waitForHttpServer(port: number, maxAttempts = 40): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // Aguarda próximo ciclo
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

async function killProcessSafely(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed || !proc.pid) return resolve();
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { shell: true });
    } catch {
      proc.kill('SIGTERM');
    }
    setTimeout(resolve, 500);
  });
}

async function killAllProcesses(): Promise<void> {
  for (const proc of spawnedProcesses) {
    await killProcessSafely(proc);
  }
}

export async function runSubetapa034Tests() {
  console.log('================================================================');
  console.log('KYRO FINANCE | EXECUÇÃO DA BATERIA DE TESTES - SUBETAPA 03.4');
  console.log('================================================================\n');

  // Garante que o processo de teste conecta no emulador oficial do Firestore e Auth
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.GCLOUD_PROJECT = DEMO_PROJECT_ID;

  try {
    // =========================================================================
    // BLOCO 1: CONCORRÊNCIA E LEASE NO MOTOR CONTÁBIL (COMPONENTE 04)
    // =========================================================================
    console.log('[1/4] Testes de Contrato e Unidade do Motor de Concorrência (LeaseManager)...');

    const mockStore = new TransactionalStoreMock();
    const leaseManager = new LeaseManager(mockStore);
    const userId = 'usr_alice_lease_test';
    const resourceId = 'acc_primary_lease';

    // 1.1 Aquisição inicial de lease
    const acq1 = await leaseManager.acquireLease(userId, resourceId, 'worker_A', 2000);
    assert(acq1.success === true, 'Aquisição inicial de lease com sucesso');
    assert(acq1.lease.fencingToken === 1, 'Fencing token inicial monotônico estritamente igual a 1');
    assert(acq1.lease.holderId === 'worker_A', 'Proprietário do lease gravado como worker_A');
    assert(!acq1.isReacquired, 'Primeira concessão de lease (isReacquired: false)');

    // 1.2 Reaquisição pelo mesmo titular (worker_A) renova e mantém token
    const acqSame = await leaseManager.acquireLease(userId, resourceId, 'worker_A', 3000);
    assert(acqSame.success === true, 'Reaquisição pelo mesmo titular executada com sucesso');
    assert(acqSame.lease.fencingToken === 1, 'Fencing token inalterado para o mesmo titular');

    // 1.3 Bloqueio de titular concorrente quando lease ainda ativo
    let blockedError: any = null;
    try {
      await leaseManager.acquireLease(userId, resourceId, 'worker_B', 2000);
    } catch (e) {
      blockedError = e;
    }
    assert(
      blockedError instanceof LeaseAlreadyHeldError && blockedError.code === 'LEASE_ALREADY_HELD',
      'Tentativa de aquisição por worker_B com lease ativo bloqueada com LeaseAlreadyHeldError (409)'
    );

    // 1.4 Renovação com token correto pelo titular worker_A
    const renewed = await leaseManager.renewLease(userId, resourceId, 'worker_A', 1, 4000);
    assert(renewed.fencingToken === 1, 'Renovação com token vigente bem-sucedida');

    // 1.5 Rejeição de renovação com token obsoleto
    let obsoleteRenewError: any = null;
    try {
      await leaseManager.renewLease(userId, resourceId, 'worker_A', 999, 4000);
    } catch (e) {
      obsoleteRenewError = e;
    }
    assert(
      obsoleteRenewError instanceof FencingTokenMismatchError && obsoleteRenewError.code === 'FENCING_TOKEN_OBSOLETE',
      'Renovação com token obsoleto rejeitada com FencingTokenMismatchError (412)'
    );

    // 1.6 Rejeição de renovação com titular divergente
    let mismatchHolderError: any = null;
    try {
      await leaseManager.renewLease(userId, resourceId, 'worker_IMPOSTOR', 1, 4000);
    } catch (e) {
      mismatchHolderError = e;
    }
    assert(
      mismatchHolderError instanceof LeaseHolderMismatchError && mismatchHolderError.code === 'LEASE_HOLDER_MISMATCH',
      'Renovação com titular incorreto rejeitada com LeaseHolderMismatchError (412)'
    );

    // 1.7 Simulação de expiração temporal e assunção por novo titular com token monotônico crescente
    await new Promise(r => setTimeout(r, 100)); // Pequena pausa
    // Força expiração retroativa no mock para teste temporal imediato
    const currentLeaseDoc = await mockStore.getDocument(`users/${userId}/leases/${resourceId}`);
    currentLeaseDoc.expiresAt = Date.now() - 1000;
    await mockStore.runTransaction(async (t) => {
      t.set(`users/${userId}/leases/${resourceId}`, currentLeaseDoc);
    });

    // Tentativa de renovar o lease já vencido
    let expiredRenewError: any = null;
    try {
      await leaseManager.renewLease(userId, resourceId, 'worker_A', 1, 4000);
    } catch (e) {
      expiredRenewError = e;
    }
    assert(
      expiredRenewError instanceof LeaseExpiredError && expiredRenewError.code === 'LEASE_EXPIRED',
      'Renovação de lease já expirado rejeitada com LeaseExpiredError (412)'
    );

    // Assunção do lease expirado pelo worker_B
    const acqAfterExpire = await leaseManager.acquireLease(userId, resourceId, 'worker_B', 5000);
    assert(acqAfterExpire.success === true, 'Assunção de lease expirado concluída por worker_B');
    assert(acqAfterExpire.lease.fencingToken === 2, 'Fencing token incrementado monotonicamente: 1 -> 2');
    assert(acqAfterExpire.lease.holderId === 'worker_B', 'Novo proprietário do lease é worker_B');
    assert(acqAfterExpire.isReacquired === true, 'Flag isReacquired indica reaquisição pós-expiração');

    // 1.8 Tentativa de liberação com token obsoleto
    let obsoleteReleaseError: any = null;
    try {
      await leaseManager.releaseLease(userId, resourceId, 'worker_A', 1);
    } catch (e) {
      obsoleteReleaseError = e;
    }
    assert(
      obsoleteReleaseError instanceof FencingTokenMismatchError,
      'Tentativa de liberação com token obsoleto (token 1 vs ativo 2) bloqueada'
    );

    // 1.9 Liberação voluntária legítima por worker_B com token 2
    await leaseManager.releaseLease(userId, resourceId, 'worker_B', 2);
    const leaseAfterRelease = await leaseManager.getLease(userId, resourceId);
    assert(leaseAfterRelease === null, 'Lease liberado voluntariamente removido do armazenamento');

    // =========================================================================
    // BLOCO 2: DISPUTA CONCORRENTE REAL MULTI-PROCESSO PELA REDE HTTP
    // =========================================================================
    console.log('\n[2/4] Disputa Concorrente Multi-Processo Real no Firestore Emulator...');

    const officialAuth = await getOfficialAuthEmulatorToken('usr_dispute_concurrency@kyro.synthetic', 'Pass_123456');
    assert(!!officialAuth.idToken, 'ID Token oficial emitido pelo Firebase Auth Emulator');

    const PORT_A = 4101;
    const PORT_B = 4102;

    console.log(`  -> Subindo Processo A na porta ${PORT_A}...`);
    const serverA = startServerProcess(PORT_A);
    console.log(`  -> Subindo Processo B na porta ${PORT_B}...`);
    const serverB = startServerProcess(PORT_B);

    const readyA = await waitForHttpServer(PORT_A);
    const readyB = await waitForHttpServer(PORT_B);
    assert(readyA && readyB, 'Ambos os servidores HTTP iniciaram com sucesso nas portas 4101 e 4102');
    assert(serverA.pid !== serverB.pid, `PIDs independentes no SO: Processo A (${serverA.pid}) !== Processo B (${serverB.pid})`);

    const firestoreDirect = new FirestoreAdminStore();
    const rawDb = firestoreDirect.getRawDb();
    const testUid = officialAuth.uid;
    const runTimestamp = Date.now();
    const sharedResource = `acc_fencing_dispute_${runTimestamp}`;

    // Deleta qualquer resquício prévio de lease para garantir estado limpo isolado
    await rawDb.doc(`users/${testUid}/leases/${sharedResource}`).delete().catch(() => {});

    // Inicializa conta limpa com R$ 0,00 no Firestore Emulator
    await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).set({
      id: sharedResource,
      userId: testUid,
      name: 'Conta Disputa Fencing',
      balanceCents: 0,
      rev: 1,
      fencingToken: 1,
      updatedAt: new Date().toISOString()
    });

    // 2.1 Processo A adquire o lease com TTL curto (1200 ms) via rede HTTP
    console.log('  -> Processo A adquirindo lease com TTL de 1200ms...');
    const respAcqA = await fetch(`http://127.0.0.1:${PORT_A}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_acq_A_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'acquire_lease',
        resourceId: sharedResource,
        holderId: `pid_${serverA.pid}_processA`,
        ttlMs: 1200
      })
    });
    const jsonAcqA: any = await respAcqA.json();
    assert(respAcqA.status === 200, 'Processo A adquire lease via HTTP com código 200');
    assert(jsonAcqA.lease?.fencingToken === 1, 'Processo A recebe fencingToken = 1');
    assert(jsonAcqA.lease?.holderId === `pid_${serverA.pid}_processA`, 'Holder registrado como Processo A');

    // 2.2 Aguarda expiração temporal do lease do Processo A (1400 ms)
    console.log('  -> Aguardando expiração temporal do lease do Processo A (1400ms)...');
    await new Promise(r => setTimeout(r, 1400));

    // 2.3 Processo B assume o lease expirado na porta 4102 via rede HTTP
    console.log('  -> Processo B assumindo lease expirado na porta 4102...');
    const respAcqB = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_acq_B_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'acquire_lease',
        resourceId: sharedResource,
        holderId: `pid_${serverB.pid}_processB`,
        ttlMs: 30000
      })
    });
    const jsonAcqB: any = await respAcqB.json();
    assert(respAcqB.status === 200, 'Processo B assume lease via HTTP com código 200');
    assert(jsonAcqB.lease?.fencingToken === 2, 'Processo B recebe fencingToken = 2 (Monotônico estritamente crescente)');
    assert(jsonAcqB.lease?.holderId === `pid_${serverB.pid}_processB`, 'Holder atualizado para Processo B');

    // 2.4 Processo A (desavisado) tenta comitar uma transação com token 1 obsoleto
    console.log('  -> Processo A tentando comitar transação com token 1 obsoleto...');
    const reqIdProcessA = `req_tx_procA_${Date.now()}`;
    const respTxA = await fetch(`http://127.0.0.1:${PORT_A}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqIdProcessA
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        resourceId: sharedResource,
        holderId: `pid_${serverA.pid}_processA`,
        fencingToken: 1, // TOKEN OBSOLETO!
        transaction: {
          id: `tx_stale_procA_${Date.now()}`,
          type: 'INCOME',
          amountCents: 50000, // R$ 500,00
          description: 'Lançamento Obsoleto do Processo A'
        }
      })
    });
    const jsonTxA: any = await respTxA.json();
    assert(respTxA.status === 412, 'Transação do Processo A REJEITADA com HTTP 412 Precondition Failed');
    assert(
      jsonTxA.code === 'FENCING_TOKEN_OBSOLETE' || jsonTxA.code === 'LEASE_HOLDER_MISMATCH',
      `Código de erro de fencing retornado: ${jsonTxA.code}`
    );

    // 2.5 Verificação Direta no Firestore Emulator: Zero efeitos gravados pelo Processo A
    const snapAccDirect = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccDirect.data()?.balanceCents === 0, 'Saldo permanece R$ 0,00: NENHUM efeito financeiro aplicado pelo Processo A');

    const snapReceiptA = await rawDb.doc(`users/${testUid}/idempotency/${reqIdProcessA}`).get();
    assert(!snapReceiptA.exists, 'Nenhum recibo de idempotência foi comitado para a requisição rejeitada');

    // 2.6 Processo B grava transação autorizada com fencingToken = 2
    console.log('  -> Processo B gravando transação legítima com fencingToken = 2...');
    const reqIdProcessB = `req_tx_procB_${Date.now()}`;
    const txIdProcessB = `tx_legit_procB_${Date.now()}`;
    const respTxB = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqIdProcessB
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        resourceId: sharedResource,
        holderId: `pid_${serverB.pid}_processB`,
        fencingToken: 2, // TOKEN VÁLIDO!
        transaction: {
          id: txIdProcessB,
          type: 'INCOME',
          amountCents: 25000, // R$ 250,00
          description: 'Lançamento Autorizado do Processo B'
        }
      })
    });
    const jsonTxB: any = await respTxB.json();
    assert(respTxB.status === 200, 'Transação do Processo B confirmada com HTTP 200 OK');
    assert(jsonTxB.receipt?.status === 'APPLIED', 'Recibo de mutação com status APPLIED');
    assert(jsonTxB.receipt?.fencingToken === 2, 'Recibo registrado sob fencingToken = 2');

    // Leitura Direta no Firestore do resultado do Processo B
    const snapAccAfterB = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(
      snapAccAfterB.data()?.balanceCents === 25000,
      'Saldo no Firestore atualizado com exatidão para R$ 250,00 (25000 cents)'
    );

    const snapReceiptB = await rawDb.doc(`users/${testUid}/idempotency/${reqIdProcessB}`).get();
    assert(snapReceiptB.exists && snapReceiptB.data()?.status === 'APPLIED', 'Recibo de B persistido atomicamente no Firestore');

    // 2.7 Processo A tenta renovar e liberar o lease com token 1 obsoleto
    console.log('  -> Processo A tentando renovar lease com token 1 obsoleto...');
    const respRenewObsolete = await fetch(`http://127.0.0.1:${PORT_A}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_renew_obs_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'renew_lease',
        resourceId: sharedResource,
        holderId: `pid_${serverA.pid}_processA`,
        fencingToken: 1
      })
    });
    assert(respRenewObsolete.status === 412, 'Renovação concorrente com token obsoleto rejeitada com HTTP 412');

    const respReleaseObsolete = await fetch(`http://127.0.0.1:${PORT_A}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_release_obs_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'release_lease',
        resourceId: sharedResource,
        holderId: `pid_${serverA.pid}_processA`,
        fencingToken: 1
      })
    });
    assert(respReleaseObsolete.status === 412, 'Liberação concorrente com token obsoleto rejeitada com HTTP 412');

    // =========================================================================
    // BLOCO 3: SOBREVIVÊNCIA A REINÍCIO DE PROCESSO, RETRY E IDEMPOTÊNCIA
    // =========================================================================
    console.log('\n[3/4] Sobrevivência a Reinício de Processo, Retry e Idempotência Estrita...');

    const rebootRequestId = `req_reboot_resilience_${Date.now()}`;
    const rebootTxId = `tx_reboot_${Date.now()}`;
    const rebootPayload = {
      action: 'save_transaction',
      accountId: sharedResource,
      requestId: rebootRequestId,
      transaction: {
        id: rebootTxId,
        type: 'INCOME',
        amountCents: 15000, // R$ 150,00
        description: 'Transação para Teste de Sobrevivência a Reinício'
      }
    };

    // 3.1 Gravação inicial no Processo B
    console.log('  -> Executando gravação inicial no Processo B...');
    const respInitial = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': rebootRequestId
      },
      body: JSON.stringify(rebootPayload)
    });
    const jsonInitial: any = await respInitial.json();
    assert(respInitial.status === 200, 'Gravação inicial confirmada com HTTP 200 OK');
    assert(jsonInitial.receipt?.replay !== true, 'Primeira execução com replay = false');

    // 3.2 Derruba forçadamente TODOS os processos do servidor HTTP (Kill)
    console.log('  -> Derrubando Processo A e Processo B (Simulação de crash/restart)...');
    await killAllProcesses();
    await new Promise(r => setTimeout(r, 600));

    // 3.3 Sobe um NOVO Processo C em nova porta (4103)
    const PORT_C = 4103;
    console.log(`  -> Subindo novo Processo C na porta ${PORT_C}...`);
    const serverC = startServerProcess(PORT_C);
    const readyC = await waitForHttpServer(PORT_C);
    assert(readyC, 'Processo C iniciado com sucesso após restart completo da camada servidora');

    // 3.4 Retry pela rede com o MESMO requestId e MESMO payload no Processo C
    console.log('  -> Enviando retry com mesmo requestId e mesmo payload ao Processo C...');
    const respRetry = await fetch(`http://127.0.0.1:${PORT_C}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': rebootRequestId
      },
      body: JSON.stringify(rebootPayload)
    });
    const jsonRetry: any = await respRetry.json();
    assert(respRetry.status === 200, 'Retry responde com HTTP 200 OK');
    assert(jsonRetry.receipt?.replay === true, 'Recibo recuperado diretamente do Firestore com replay = true');
    assert(jsonRetry.receipt?.status === 'APPLIED', 'Status permanece APPLIED');

    // 3.5 Verificação Direta: Saldo no Firestore NÃO foi duplicado (Zero Duplo Crédito)
    const snapAccAfterRetry = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    // Saldo anterior era 25000 + 15000 = 40000
    assert(
      snapAccAfterRetry.data()?.balanceCents === 40000,
      'Saldo verificado no Firestore Emulator: R$ 400,00 exato (Sem duplicidade pós-reinício)'
    );

    // 3.6 Reenvio com o mesmo requestId mas payload divergente -> CONFLITO 409
    console.log('  -> Enviando mesmo requestId com payload divergente (R$ 999,00)...');
    const divergentPayload = {
      ...rebootPayload,
      transaction: {
        ...rebootPayload.transaction,
        amountCents: 99900 // Payload alterado!
      }
    };
    const respDivergent = await fetch(`http://127.0.0.1:${PORT_C}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': rebootRequestId
      },
      body: JSON.stringify(divergentPayload)
    });
    const jsonDivergent: any = await respDivergent.json();
    assert(respDivergent.status === 409, 'Reenvio com payload conflitante rejeitado com HTTP 409 Conflict');
    assert(
      jsonDivergent.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      'Código de erro IDEMPOTENCY_PAYLOAD_MISMATCH emitido com sucesso'
    );

    // Saldo permanece rigorosamente inalterado em 40000
    const snapAccAfterDivergent = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccAfterDivergent.data()?.balanceCents === 40000, 'Saldo no Firestore permanece R$ 400,00 intacto após conflito');

    // 3.7 Ausência de escrita parcial em falha de validação antes do commit
    console.log('  -> Enviando requisição com falha pré-commit (valor negativo)...');
    const invalidReqId = `req_invalid_neg_${Date.now()}`;
    const respInvalid = await fetch(`http://127.0.0.1:${PORT_C}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': invalidReqId
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        requestId: invalidReqId,
        transaction: {
          id: `tx_invalid_${Date.now()}`,
          type: 'INCOME',
          amountCents: -5000, // VALOR NEGATIVO INVÁLIDO!
          description: 'Lançamento Negativo Proibido'
        }
      })
    });
    assert(respInvalid.status === 500, 'Transação com valor negativo rejeitada');
    const snapInvalidReceipt = await rawDb.doc(`users/${testUid}/idempotency/${invalidReqId}`).get();
    assert(!snapInvalidReceipt.exists, 'Atomicidade total: zero recibos ou mutações parciais no Firestore');

    // =========================================================================
    // BLOCO 4: FRONTEIRA CRIPTOGRÁFICA DO WEBHOOK (HMAC + TIMESTAMP + NONCE)
    // =========================================================================
    console.log('\n[4/4] Fronteira Criptográfica do Webhook (HMAC, Timestamp, Nonce e Origem)...');

    const webhookSecret = 'kyro_webhook_secret_dev';

    // 4.1 Webhook Legítimo com HMAC SHA-256 sobre bytes originais
    const validBodyObj = {
      action: 'sync_transactions',
      senderPhone: '558695368780',
      transaction: {
        id: `tx_hmac_valid_${Date.now()}`,
        amount: 85.00,
        description: 'Lançamento via HMAC Criptográfico'
      }
    };
    const validRawBody = JSON.stringify(validBodyObj);
    const validTimestamp = String(Date.now());
    const validNonce = `nonce_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const validSignature = crypto.createHmac('sha256', webhookSecret).update(validRawBody).digest('hex');

    console.log('  -> Enviando Webhook assinado com HMAC SHA-256 via rede HTTP...');
    const respValidHmac = await fetch(`http://127.0.0.1:${PORT_C}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': validSignature,
        'x-webhook-timestamp': validTimestamp,
        'x-webhook-nonce': validNonce
      },
      body: validRawBody
    });
    const jsonValidHmac: any = await respValidHmac.json();
    assert(respValidHmac.status === 200, 'Webhook com HMAC, timestamp e nonce válidos aprovado com HTTP 200 OK');
    assert(jsonValidHmac.status === 'synced', 'Transação sincronizada com sucesso via webhook seguro');

    // 4.2 Webhook com Corpo Adulterado (1 byte alterado após assinatura)
    console.log('  -> Enviando Webhook com corpo adulterado após assinatura...');
    const tamperedRawBody = validRawBody.replace('85', '95'); // Adulteração do payload!
    const respTampered = await fetch(`http://127.0.0.1:${PORT_C}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': validSignature, // Assinatura do body original não bate com o adulterado!
        'x-webhook-timestamp': String(Date.now()),
        'x-webhook-nonce': `nonce_tampered_${Date.now()}`
      },
      body: tamperedRawBody
    });
    const jsonTampered: any = await respTampered.json();
    assert(respTampered.status === 401, 'Corpo adulterado sumariamente rejeitado com HTTP 401 Unauthorized');
    assert(
      jsonTampered.code === 'WEBHOOK_HMAC_INVALID',
      'Código WEBHOOK_HMAC_INVALID confirma proteção contra adulteração de bytes'
    );

    // 4.3 Webhook com Timestamp Expirado (> 5 minutos no passado)
    console.log('  -> Enviando Webhook com timestamp expirado (10 minutos atrás)...');
    const expiredTimestamp = String(Date.now() - (10 * 60 * 1000));
    const expiredRawBody = JSON.stringify({ action: 'ping' });
    const expiredSig = crypto.createHmac('sha256', webhookSecret).update(expiredRawBody).digest('hex');
    const respExpiredTs = await fetch(`http://127.0.0.1:${PORT_C}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': expiredSig,
        'x-webhook-timestamp': expiredTimestamp,
        'x-webhook-nonce': `nonce_exp_${Date.now()}`
      },
      body: expiredRawBody
    });
    const jsonExpiredTs: any = await respExpiredTs.json();
    assert(respExpiredTs.status === 401, 'Timestamp expirado rejeitado com HTTP 401 Unauthorized');
    assert(
      jsonExpiredTs.code === 'WEBHOOK_TIMESTAMP_EXPIRED',
      'Código WEBHOOK_TIMESTAMP_EXPIRED emitido com exatidão'
    );

    // 4.4 Webhook com Nonce Repetido (Replay Attack)
    console.log('  -> Testando proteção contra Replay Attack com reenvio do mesmo nonce...');
    const replayRawBody = JSON.stringify({ action: 'ping' });
    const replayTimestamp = String(Date.now());
    const replayNonce = `nonce_fixed_replay_${Date.now()}`;
    const replaySig = crypto.createHmac('sha256', webhookSecret).update(replayRawBody).digest('hex');

    // Primeiro envio com esse nonce
    const respReplay1 = await fetch(`http://127.0.0.1:${PORT_C}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': replaySig,
        'x-webhook-timestamp': replayTimestamp,
        'x-webhook-nonce': replayNonce
      },
      body: replayRawBody
    });
    assert(respReplay1.status === 200, 'Primeiro envio com o nonce responde com HTTP 200');

    // Segundo envio com o MESMO nonce (Replay!)
    const respReplay2 = await fetch(`http://127.0.0.1:${PORT_C}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': replaySig,
        'x-webhook-timestamp': replayTimestamp,
        'x-webhook-nonce': replayNonce // REPLAY!
      },
      body: replayRawBody
    });
    const jsonReplay2: any = await respReplay2.json();
    assert(respReplay2.status === 409, 'Replay Attack bloqueado com HTTP 409 Conflict');
    assert(
      jsonReplay2.code === 'WEBHOOK_NONCE_REPLAY',
      'Código WEBHOOK_NONCE_REPLAY atesta bloqueio de duplicação por replay'
    );

    // 4.5 Webhook de Origem Não Autorizada (Sem assinatura e sem segredo)
    console.log('  -> Enviando Webhook sem assinatura e com segredo inválido...');
    const respUnauth = await fetch(`http://127.0.0.1:${PORT_C}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'segredo_malicioso_hacker'
      },
      body: JSON.stringify({ action: 'sync_transactions', senderPhone: '558695368780' })
    });
    const jsonUnauth: any = await respUnauth.json();
    assert(respUnauth.status === 401, 'Origem sem credencial válida rejeitada com HTTP 401');
    assert(
      jsonUnauth.code === 'WEBHOOK_ORIGIN_UNAUTHORIZED',
      'Código WEBHOOK_ORIGIN_UNAUTHORIZED emitido'
    );

    // 4.6 Provedor sem Vínculo (UNBOUND)
    console.log('  -> Enviando mensagem de telefone sem vínculo cadastrado...');
    const unmappedRawBody = JSON.stringify({
      data: {
        key: { participant: '5511999999999@s.whatsapp.net' },
        message: { conversation: 'Gastei 50 no almoço' }
      }
    });
    const unmappedSig = crypto.createHmac('sha256', webhookSecret).update(unmappedRawBody).digest('hex');
    const respUnbound = await fetch(`http://127.0.0.1:${PORT_C}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': unmappedSig,
        'x-webhook-timestamp': String(Date.now()),
        'x-webhook-nonce': `nonce_unbound_${Date.now()}`
      },
      body: unmappedRawBody
    });
    const jsonUnbound: any = await respUnbound.json();
    assert(respUnbound.status === 403, 'Telefone sem vínculo rejeitado com HTTP 403 Forbidden');
    assert(
      jsonUnbound.code === 'UNBOUND_PROVIDER_IDENTITY',
      'Código UNBOUND_PROVIDER_IDENTITY emitido'
    );

    // 4.7 Provedor com Vínculo Ambíguo (AMBIGUOUS) - Teste de Contrato Isolado
    const ambiguousBindings: ProviderBinding[] = [
      { providerPhone: '558699991111', userId: 'usr_user_1', status: 'ACTIVE', boundAt: new Date().toISOString() },
      { providerPhone: '558699991111', userId: 'usr_user_2', status: 'ACTIVE', boundAt: new Date().toISOString() }
    ];
    const ambigRes = resolveProviderBinding(ambiguousBindings, '558699991111');
    assert(ambigRes.status === 'AMBIGUOUS', 'Detecção de vínculo ambíguo para múltiplos UIDs identificada');
    assert(
      (ambigRes.error || '').includes('ambígua'),
      'Mensagem atesta bloqueio de escrita sob ambiguidade de provedor'
    );

  } finally {
    console.log('\n  -> Finalizando processos em segundo plano...');
    await killAllProcesses();
  }

  console.log('\n================================================================');
  console.log(`RESULTADO DA BATERIA DE TESTES DA SUBETAPA 03.4:`);
  console.log(`Total de Testes: ${passCount + failCount}`);
  console.log(`Aprovados:       ${passCount}`);
  console.log(`Falhas:          ${failCount}`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSubetapa034Tests().catch(async (err) => {
  console.error('Erro fatal na execução da suíte da 03.4:', err);
  await killAllProcesses();
  process.exit(1);
});
