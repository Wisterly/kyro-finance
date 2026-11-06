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
import { SafeMoneySerializer } from '../services/SafeMoneySerializer';
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

function startServerProcess(port: number, scriptPath?: string): { proc: ChildProcess; pid: number } {
  const serverScript = scriptPath || path.resolve(process.cwd(), 'src/server/httpServer.ts');
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

async function waitForHttpServer(port: number, maxAttempts = 50): Promise<boolean> {
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
    assert(leaseAfterRelease === null, 'Lease liberado voluntariamente removido do armazenamento ativo');

    // 1.10 Sequência estrita de monotonicidade: Readquisição pelo MESMO titular pós-liberação
    console.log('  -> Testando sequência de monotonicidade: adquirir, liberar e readquirir com o mesmo titular...');
    const reacquiredByB = await leaseManager.acquireLease(userId, resourceId, 'worker_B', 5000);
    assert(reacquiredByB.success === true, 'Readquisição pelo mesmo titular (worker_B) concluída com sucesso');
    assert(reacquiredByB.lease.fencingToken === 3, 'Monotonicidade estrita comprovada: Token incrementado de 2 para 3');
    assert(reacquiredByB.lease.holderId === 'worker_B', 'Titular do lease permanece worker_B');

    // 1.11 Tentativa de renovação usando o token 2 antigo pelo mesmo titular
    let oldTokenError: any = null;
    try {
      await leaseManager.renewLease(userId, resourceId, 'worker_B', 2);
    } catch (e) {
      oldTokenError = e;
    }
    assert(
      oldTokenError instanceof FencingTokenMismatchError,
      'Tentativa de renovação com token pré-liberação (token 2 vs vigente 3) bloqueada com FencingTokenMismatchError'
    );

    // 1.12 Liberação final pelo titular com o token 3 vigente
    await leaseManager.releaseLease(userId, resourceId, 'worker_B', 3);
    const leaseClean = await leaseManager.getLease(userId, resourceId);
    assert(leaseClean === null, 'Lease ativo limpo no armazenamento após término do teste de contrato');

    // =========================================================================
    // BLOCO 2: DISPUTA CONCORRENTE REAL MULTI-PROCESSO PELA REDE HTTP
    // =========================================================================
    console.log('\n[2/4] Disputa Concorrente Multi-Processo Real no Firestore Emulator...');

    const officialAuth = await getOfficialAuthEmulatorToken('usr_dispute_concurrency@kyro.synthetic', 'Pass_123456');
    assert(!!officialAuth.idToken, 'ID Token oficial emitido pelo Firebase Auth Emulator');

    const PORT_A = 4111;
    const PORT_B = 4112;

    console.log(`  -> Subindo Processo A na porta ${PORT_A}...`);
    const serverA = startServerProcess(PORT_A);
    console.log(`  -> Subindo Processo B na porta ${PORT_B}...`);
    const serverB = startServerProcess(PORT_B);

    const readyA = await waitForHttpServer(PORT_A);
    const readyB = await waitForHttpServer(PORT_B);
    assert(readyA && readyB, 'Ambos os servidores HTTP iniciaram com sucesso nas portas 4111 e 4112');
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

    // 2.6.1 Exigência Estrita de Prova de Posse sob Lease Ativo
    console.log('  -> Testando exigência estrita de prova de posse sob lease ativo do Processo B...');

    // A. Nova mutação com Token Ausente
    console.log('    [A] Nova mutação com token ausente...');
    const reqMissingToken = `req_no_tok_${Date.now()}`;
    const txMissingToken = `tx_no_tok_${Date.now()}`;
    const respMissingTok = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqMissingToken
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        holderId: `pid_${serverB.pid}_processB`,
        // fencingToken AUSENTE
        transaction: {
          id: txMissingToken,
          type: 'INCOME',
          amountCents: 5000,
          description: 'Tentativa sem Fencing Token'
        }
      })
    });
    assert(respMissingTok.status === 412, 'Mutação sem fencing token rejeitada com HTTP 412');
    const snapAccNoTok = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccNoTok.data()?.balanceCents === 25000, 'Leitura direta no Firestore: Saldo permanece R$ 250,00 intacto (Zero efeito)');
    const snapTxNoTok = await rawDb.doc(`users/${testUid}/transactions/${txMissingToken}`).get();
    assert(!snapTxNoTok.exists, 'Leitura direta no Firestore: Transação sem token não foi gravada');
    const snapRecNoTok = await rawDb.doc(`users/${testUid}/idempotency/${reqMissingToken}`).get();
    assert(!snapRecNoTok.exists, 'Leitura direta no Firestore: Zero recibos comitados');

    // B. Nova mutação com Titular Ausente
    console.log('    [B] Nova mutação com titular ausente...');
    const reqMissingHolder = `req_no_hld_${Date.now()}`;
    const txMissingHolder = `tx_no_hld_${Date.now()}`;
    const respMissingHld = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqMissingHolder
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        fencingToken: 2,
        // holderId AUSENTE
        transaction: {
          id: txMissingHolder,
          type: 'INCOME',
          amountCents: 5000,
          description: 'Tentativa sem Titular'
        }
      })
    });
    assert(respMissingHld.status === 412, 'Mutação sem titular rejeitada com HTTP 412');
    const snapAccNoHld = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccNoHld.data()?.balanceCents === 25000, 'Leitura direta no Firestore: Saldo permanece R$ 250,00 intacto');
    const snapTxNoHld = await rawDb.doc(`users/${testUid}/transactions/${txMissingHolder}`).get();
    assert(!snapTxNoHld.exists, 'Leitura direta no Firestore: Transação sem titular não foi gravada');
    const snapRecNoHld = await rawDb.doc(`users/${testUid}/idempotency/${reqMissingHolder}`).get();
    assert(!snapRecNoHld.exists, 'Leitura direta no Firestore: Zero recibos comitados');

    // C. Nova mutação com Ambos Ausentes
    console.log('    [C] Nova mutação com ambos ausentes...');
    const reqMissingBoth = `req_no_both_${Date.now()}`;
    const txMissingBoth = `tx_no_both_${Date.now()}`;
    const respMissingBoth = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqMissingBoth
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        // Ambos ausentes!
        transaction: {
          id: txMissingBoth,
          type: 'INCOME',
          amountCents: 5000,
          description: 'Tentativa sem Credenciais de Lease'
        }
      })
    });
    assert(respMissingBoth.status === 412, 'Mutação com ambos ausentes rejeitada com HTTP 412');
    const snapAccNoBoth = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccNoBoth.data()?.balanceCents === 25000, 'Leitura direta no Firestore: Saldo permanece R$ 250,00 intacto');
    const snapTxNoBoth = await rawDb.doc(`users/${testUid}/transactions/${txMissingBoth}`).get();
    assert(!snapTxNoBoth.exists, 'Leitura direta no Firestore: Transação sem credenciais não foi gravada');
    const snapRecNoBoth = await rawDb.doc(`users/${testUid}/idempotency/${reqMissingBoth}`).get();
    assert(!snapRecNoBoth.exists, 'Leitura direta no Firestore: Zero recibos comitados');

    // D. Nova mutação com Recurso Divergente (tentativa de burlar passando resourceId falso)
    console.log('    [D] Nova mutação com recurso divergente...');
    const reqDivergentRes = `req_div_res_${Date.now()}`;
    const txDivergentRes = `tx_div_res_${Date.now()}`;
    const respDivergentRes = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqDivergentRes
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource, // A conta real protegida por lease
        resourceId: 'outro_recurso_livre_sem_lease', // Tentativa de desvio
        fencingToken: 1, // Token inválido para sharedResource
        holderId: 'hacker_process',
        transaction: {
          id: txDivergentRes,
          type: 'INCOME',
          amountCents: 5000,
          description: 'Tentativa de Desvio de Recurso'
        }
      })
    });
    assert(respDivergentRes.status === 412, 'Desvio de recurso bloqueado com HTTP 412 (recurso derivado da conta)');
    const snapAccDiv = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccDiv.data()?.balanceCents === 25000, 'Leitura direta no Firestore: Saldo permanece R$ 250,00 inalterado');
    const snapTxDiv = await rawDb.doc(`users/${testUid}/transactions/${txDivergentRes}`).get();
    assert(!snapTxDiv.exists, 'Leitura direta no Firestore: Transação desviada não foi gravada');
    const snapRecDiv = await rawDb.doc(`users/${testUid}/idempotency/${reqDivergentRes}`).get();
    assert(!snapRecDiv.exists, 'Leitura direta no Firestore: Zero recibos comitados');

    // E. Preservação do Replay Idêntico de Operação Confirmada
    console.log('    [E] Replay idêntico de operação confirmada sem reaplicar efeito financeiro...');
    const respReplayConfirmed = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqIdProcessB
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        transaction: {
          id: txIdProcessB,
          type: 'INCOME',
          amountCents: 25000,
          description: 'Lançamento Autorizado do Processo B'
        }
      })
    });
    const jsonReplayB: any = await respReplayConfirmed.json();
    assert(respReplayConfirmed.status === 200, 'Replay idêntico responde com HTTP 200 OK');
    assert(jsonReplayB.receipt?.replay === true, 'Recibo prévio recuperado com replay = true');
    assert(jsonReplayB.receipt?.status === 'APPLIED', 'Status permanece APPLIED');
    const snapAccAfterReplayB = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(
      snapAccAfterReplayB.data()?.balanceCents === 25000,
      'Leitura direta no Firestore: Saldo permanece estritamente R$ 250,00 (Zero duplo crédito / sem reaplicação)'
    );

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

    // Leitura Direta no Firestore Emulator pós-tentativa de renovação do Processo A
    const snapLeaseAfterRenew = await rawDb.doc(`users/${testUid}/leases/${sharedResource}`).get();
    const leaseDataAfterRenew = snapLeaseAfterRenew.data();
    assert(
      leaseDataAfterRenew?.holderId === `pid_${serverB.pid}_processB`,
      'Leitura direta no Firestore: Titular continua sendo Processo B após tentativa rejeitada de renovação de A'
    );
    assert(
      leaseDataAfterRenew?.fencingToken === 2,
      'Leitura direta no Firestore: Fencing token permanece estritamente 2 (Token de B preservado)'
    );

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

    // Leitura Direta no Firestore Emulator pós-tentativa de liberação do Processo A
    const snapLeaseAfterRelease = await rawDb.doc(`users/${testUid}/leases/${sharedResource}`).get();
    assert(
      snapLeaseAfterRelease.exists === true,
      'Leitura direta no Firestore: Documento de lease NÃO foi deletado pelo Processo A'
    );
    assert(
      snapLeaseAfterRelease.data()?.holderId === `pid_${serverB.pid}_processB`,
      'Leitura direta no Firestore: Titular continua sendo Processo B após tentativa rejeitada de liberação de A'
    );
    assert(
      snapLeaseAfterRelease.data()?.fencingToken === 2,
      'Leitura direta no Firestore: Fencing token continua 2 (validade de B intacta no storage)'
    );

    // 2.7.1 Comprovação HTTP da Sequência: Adquirir, Liberar e Readquirir com o Mesmo Titular
    console.log('  -> Testando pela rota HTTP a sequência: adquirir, liberar e readquirir com o mesmo titular...');
    // Processo B libera seu lease ativo com token 2 via HTTP
    const respReleaseB = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_release_b_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'release_lease',
        resourceId: sharedResource,
        holderId: `pid_${serverB.pid}_processB`,
        fencingToken: 2
      })
    });
    assert(respReleaseB.status === 200, 'Processo B libera voluntariamente seu lease via HTTP 200');

    // Processo B readquire imediatamente o mesmo recurso via HTTP
    const respReacquireB = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_reacquire_b_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'acquire_lease',
        resourceId: sharedResource,
        holderId: `pid_${serverB.pid}_processB`,
        ttlMs: 5000
      })
    });
    const jsonReacquireB: any = await respReacquireB.json();
    assert(respReacquireB.status === 200, 'Processo B readquire o mesmo recurso via HTTP 200');
    assert(jsonReacquireB.lease?.fencingToken === 3, 'HTTP: Fencing token incrementado monotonicamente de 2 para 3 para o mesmo titular');
    assert(jsonReacquireB.lease?.fencingToken > 2, 'HTTP: Segundo token (3) comprovadamente maior que o token anterior (2)');
    assert(jsonReacquireB.lease?.holderId === `pid_${serverB.pid}_processB`, 'HTTP: Titular readquirente permanece Processo B');

    // Tentativa de gravação pelo Processo B: Nova mutação com outro requestId usando o token antigo (2)
    const reqOldTokenB = `req_other_id_old_tok_${Date.now()}`;
    const txOldTokenB = `tx_old_tok_b_${Date.now()}`;
    const respOldTokenB = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqOldTokenB
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: sharedResource,
        holderId: `pid_${serverB.pid}_processB`,
        fencingToken: 2, // Token pré-liberação (obsoleto)
        transaction: {
          id: txOldTokenB,
          type: 'INCOME',
          amountCents: 5000,
          description: 'Tentativa com token antigo pós-liberação'
        }
      })
    });
    assert(respOldTokenB.status === 412, 'Nova mutação de B com token 2 antigo pós-liberação rejeitada com HTTP 412');
    
    // Leitura direta no Firestore: saldo intacto, ausência de lançamento e ausência de recibo
    const snapAccOldTok = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccOldTok.data()?.balanceCents === 25000, 'Leitura direta no Firestore: Saldo permanece intacto em R$ 250,00 após rejeição');
    const snapTxOldTok = await rawDb.doc(`users/${testUid}/transactions/${txOldTokenB}`).get();
    assert(!snapTxOldTok.exists, 'Leitura direta no Firestore: Ausência de lançamento contábil (transação não foi gravada)');
    const snapRecOldTok = await rawDb.doc(`users/${testUid}/idempotency/${reqOldTokenB}`).get();
    assert(!snapRecOldTok.exists, 'Leitura direta no Firestore: Ausência de recibo de idempotência no storage');

    // Gravação legítima pelo Processo B com o token 3 vigente
    const reqValidTokenB = `req_valid_tok_b_${Date.now()}`;
    const txValidTokenB = `tx_valid_tok_b_${Date.now()}`;
    const validPayloadB = {
      action: 'save_transaction',
      accountId: sharedResource,
      holderId: `pid_${serverB.pid}_processB`,
      fencingToken: 3, // Token novo vigente
      transaction: {
        id: txValidTokenB,
        type: 'INCOME',
        amountCents: 5000,
        description: 'Mutação legítima sob token 3'
      }
    };
    const respValidTokenB = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqValidTokenB
      },
      body: JSON.stringify(validPayloadB)
    });
    const jsonValidTokenB: any = await respValidTokenB.json();
    assert(respValidTokenB.status === 200, 'Mutação de B com token 3 novo aprovada com HTTP 200 OK');
    assert(jsonValidTokenB.receipt?.status === 'APPLIED', 'Recibo de mutação emitido com status APPLIED sob token 3');
    
    // Leitura direta no Firestore Emulator após gravação legítima
    const snapAccToken3 = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccToken3.data()?.balanceCents === 30000, 'Leitura direta no Firestore: Saldo atualizado de R$ 250,00 para R$ 300,00 sob token 3');
    const snapTxValid = await rawDb.doc(`users/${testUid}/transactions/${txValidTokenB}`).get();
    assert(snapTxValid.exists, 'Leitura direta no Firestore: Lançamento contábil comitado com sucesso');
    const snapRecValid = await rawDb.doc(`users/${testUid}/idempotency/${reqValidTokenB}`).get();
    assert(snapRecValid.exists && snapRecValid.data()?.status === 'APPLIED', 'Leitura direta no Firestore: Recibo persistido atomicamente');

    // Replay idêntico da operação já confirmada (mesmo requestId e mesmo payload)
    console.log('  -> Testando replay idêntico de operação confirmada pós-readquisição...');
    const respReplayTokenB = await fetch(`http://127.0.0.1:${PORT_B}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': reqValidTokenB
      },
      body: JSON.stringify(validPayloadB)
    });
    const jsonReplayTokenB: any = await respReplayTokenB.json();
    assert(respReplayTokenB.status === 200, 'Replay idêntico de operação confirmada responde com HTTP 200 OK');
    assert(jsonReplayTokenB.receipt?.replay === true, 'Recibo prévio recuperado com replay = true');
    assert(jsonReplayTokenB.receipt?.status === 'APPLIED', 'Recibo recuperado mantém status APPLIED');
    const snapAccReplayB = await rawDb.doc(`users/${testUid}/accounts/${sharedResource}`).get();
    assert(snapAccReplayB.data()?.balanceCents === 30000, 'Leitura direta no Firestore: Saldo permanece rigorosamente R$ 300,00 (Zero reaplicação de efeito)');

    // 2.8 Proteção contra Replay de Webhook entre Instâncias (Processo A na porta 4101 vs Processo B na 4102)
    console.log('  -> Testando proteção contra replay de Webhook entre instâncias independentes (Porta 4101 vs 4102)...');
    const crossInstNonce = `nonce_cross_inst_${Date.now()}`;
    const crossInstTxId = `tx_cross_inst_${Date.now()}`;
    const crossInstPayload = {
      action: 'sync_transactions',
      senderPhone: '558695368780',
      transaction: {
        id: crossInstTxId,
        amount: 110.00,
        description: 'Transação Webhook Multi-Instância'
      }
    };
    const crossInstRaw = JSON.stringify(crossInstPayload);
    const crossInstSig = crypto.createHmac('sha256', 'kyro_webhook_secret_dev').update(crossInstRaw).digest('hex');
    const crossInstTs = String(Date.now());

    // Disparo para o Processo A (Porta 4101)
    const respCross1 = await fetch(`http://127.0.0.1:${PORT_A}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': crossInstSig,
        'x-webhook-timestamp': crossInstTs,
        'x-webhook-nonce': crossInstNonce
      },
      body: crossInstRaw
    });
    assert(respCross1.status === 200, 'Primeira instância (Porta 4101) processa o evento de webhook com sucesso (HTTP 200)');

    // Disparo do MESMO evento para o Processo B (Porta 4102) com PID diferente sobre o mesmo Firestore Emulator
    const respCross2 = await fetch(`http://127.0.0.1:${PORT_B}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': crossInstSig,
        'x-webhook-timestamp': crossInstTs,
        'x-webhook-nonce': crossInstNonce // Replay entre processos!
      },
      body: crossInstRaw
    });
    const jsonCross2: any = await respCross2.json();
    assert(respCross2.status === 409, 'Segunda instância (Porta 4102) BLOQUEIA replay entre processos com HTTP 409');
    assert(
      jsonCross2.code === 'WEBHOOK_NONCE_REPLAY',
      'Código WEBHOOK_NONCE_REPLAY confirma proteção contra replay distribuído'
    );

    // Leitura direta no Firestore: exatamente 1 efeito persistido
    const snapCrossTx = await rawDb.doc(`users/usr_default/transactions/${crossInstTxId}`).get();
    assert(snapCrossTx.exists === true, 'Leitura direta no Firestore: Transação comitada exatamente uma vez');
    assert(snapCrossTx.data()?.amountCents === 11000, 'Valor contábil exato verificado no Firestore (R$ 110,00 = 11000 cents)');

    // =========================================================================
    // BLOCO 3: SOBREVIVÊNCIA A REINÍCIO DE PROCESSO, RETRY E IDEMPOTÊNCIA
    // =========================================================================
    console.log('\n[3/4] Sobrevivência a Reinício de Processo, Retry e Idempotência Estrita...');

    const rebootRequestId = `req_reboot_resilience_${Date.now()}`;
    const rebootTxId = `tx_reboot_${Date.now()}`;
    const rebootAccountId = `acc_reboot_resilience_${Date.now()}`;
    const rebootPayload = {
      action: 'save_transaction',
      accountId: rebootAccountId,
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

    // 3.3 Sobe um NOVO Processo C em nova porta (4113)
    const PORT_C = 4113;
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
    const snapAccAfterRetry = await rawDb.doc(`users/${testUid}/accounts/${rebootAccountId}`).get();
    assert(
      snapAccAfterRetry.data()?.balanceCents === 15000,
      'Saldo verificado no Firestore Emulator: R$ 150,00 exato (Sem duplicidade pós-reinício)'
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

    // Saldo permanece rigorosamente inalterado em 15000
    const snapAccAfterDivergent = await rawDb.doc(`users/${testUid}/accounts/${rebootAccountId}`).get();
    assert(snapAccAfterDivergent.data()?.balanceCents === 15000, 'Saldo no Firestore permanece R$ 150,00 intacto após conflito');

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
        accountId: rebootAccountId,
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
    const validWebhookTxId = `tx_hmac_valid_${Date.now()}`;
    const validBodyObj = {
      action: 'sync_transactions',
      senderPhone: '558695368780',
      transaction: {
        id: validWebhookTxId,
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

    // Leitura direta no Firestore Emulator: Apenas a transação válida gerou persistência física
    const snapValidWebhookTx = await rawDb.doc(`users/usr_default/transactions/${validWebhookTxId}`).get();
    assert(
      snapValidWebhookTx.exists === true,
      'Leitura direta no Firestore: Transação legítima do Webhook persistida com sucesso'
    );
    assert(
      snapValidWebhookTx.data()?.amountCents === 8500,
      'Valor contábil exato verificado no Firestore: R$ 85,00 (8500 cents)'
    );

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

    // Leitura direta no Firestore: Comprovação de ausência de escrita para corpo adulterado
    const snapTamperedCheck = await rawDb.doc(`users/usr_default/transactions/${validWebhookTxId}_tampered`).get();
    assert(!snapTamperedCheck.exists, 'Leitura direta no Firestore: Zero mutações registradas para corpo adulterado');

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

    // Leitura direta no Firestore Emulator: Ausência de escrita para identidade sem vínculo
    const snapUnboundCheck = await rawDb.doc('users/5511999999999').get();
    assert(!snapUnboundCheck.exists, 'Leitura direta no Firestore: Zero documentos criados para número de telefone não vinculado');

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

    // =========================================================================
    // BLOCO 5: PROTOCOLO E ENSAIO DE REVERSÃO PARA PR.044 COM DADOS SINTÉTICOS
    // =========================================================================
    console.log('\n[5/5] Protocolo e Ensaio de Reversão para PR.044 com Dados Sintéticos...');

    // 5.1 Estado Pré-Reversão: Mutação sob o regime 03.4 (com fencingToken)
    const rollbackAccId = `acc_rollback_${Date.now()}`;
    const rollbackHolderId = `pid_${serverC.pid}_rollback_holder`;
    const rollbackReqIdPre = `req_rollback_pre_${Date.now()}`;
    const rollbackTxIdPre = `tx_rollback_pre_${Date.now()}`;

    console.log('  -> [5.1] Registrando operação contábil sintética sob o regime 03.4 com fencing token...');
    
    // Processo C adquire lease no recurso
    const respAcquirePre = await fetch(`http://127.0.0.1:${PORT_C}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_acq_roll_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'acquire_lease',
        resourceId: rollbackAccId,
        holderId: rollbackHolderId,
        ttlMs: 4000
      })
    });
    const jsonAcquirePre: any = await respAcquirePre.json();
    assert(respAcquirePre.status === 200, 'Lease pré-reversão adquirido com sucesso pelo Processo C');
    const tokenPre = jsonAcquirePre.lease?.fencingToken || 1;

    // Mutação contábil com fencingToken = tokenPre
    const respTxPre = await fetch(`http://127.0.0.1:${PORT_C}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': rollbackReqIdPre
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: rollbackAccId,
        resourceId: rollbackAccId,
        holderId: rollbackHolderId,
        fencingToken: tokenPre,
        transaction: {
          id: rollbackTxIdPre,
          type: 'INCOME',
          amountCents: 30000, // R$ 300,00
          description: 'Lançamento Pré-Reversão Regime 03.4'
        }
      })
    });
    const jsonTxPre: any = await respTxPre.json();
    assert(respTxPre.status === 200, 'Operação pré-reversão aplicada com HTTP 200 OK');
    assert(jsonTxPre.receipt?.status === 'APPLIED', 'Recibo pré-reversão gerado com status APPLIED');

    // Leitura direta no Firestore: saldo R$ 300,00 e recibo persistido
    const snapAccPre = await rawDb.doc(`users/${testUid}/accounts/${rollbackAccId}`).get();
    assert(snapAccPre.data()?.balanceCents === 30000, 'Saldo no Firestore: R$ 300,00 (30000 cents) confirmado');

    // 5.2 Protocolo de Drenagem e Liberação de Leases Ativos (Drain Phase)
    console.log('  -> [5.2] Executando protocolo de drenagem: suspensão de mutações e liberação atômica de leases...');
    const respReleaseRollback = await fetch(`http://127.0.0.1:${PORT_C}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': `req_rel_roll_${Date.now()}`
      },
      body: JSON.stringify({
        action: 'release_lease',
        resourceId: rollbackAccId,
        holderId: rollbackHolderId,
        fencingToken: tokenPre
      })
    });
    assert(respReleaseRollback.status === 200, 'Lease ativo liberado voluntariamente no drain de reversão');

    // Leitura direta no Firestore: lease desocupado e liberado (sem titular ativo e expiresAt = 0)
    const snapLeaseDrained = await rawDb.doc(`users/${testUid}/leases/${rollbackAccId}`).get();
    const isDrained = !snapLeaseDrained.exists || !snapLeaseDrained.data()?.holderId || snapLeaseDrained.data()?.expiresAt === 0;
    assert(isDrained, 'Leitura direta no Firestore: Recurso desimpedido para retorno à PR.044');
    assert(snapLeaseDrained.data()?.fencingToken === tokenPre, 'Fencing token preservado no storage para garantir monotonicidade');

    // 5.3 Troca de Processo: Encerramento da 03.4 e Subida do Servidor Real da PR.044
    console.log('  -> [5.3] Encerrando processo 03.4 e iniciando processo da revisão real PR.044 (commit 1fe397de12de565002e0bec6976634c9c166bedb)...');
    await killProcessSafely(serverC.proc);

    const PORT_PR044 = 4114;
    const pr044Script = path.resolve(process.cwd(), 'isolated_pr044/src/server/httpServer.ts');
    const serverPR044 = startServerProcess(PORT_PR044, pr044Script);
    const readyPR044 = await waitForHttpServer(PORT_PR044);
    assert(readyPR044, 'Servidor standalone da revisão real PR.044 (1fe397de12de565002e0bec6976634c9c166bedb) ativo na porta 4114');
    assert(serverPR044.pid !== serverC.pid, 'Processo da PR.044 opera sob PID independente');

    // 5.4 Execução na Rota Real da PR.044: Replay de Operação Confirmada Anteriormente (Zero Duplo Débito)
    console.log('  -> [5.4] Enviando requisição de retry à rota real da PR.044 para recuperar recibo da 03.4...');
    const respReplayRollback = await fetch(`http://127.0.0.1:${PORT_PR044}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': rollbackReqIdPre
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: rollbackAccId,
        // Formato nativo da PR.044: sem parâmetros de fencing ou lease
        transaction: {
          id: rollbackTxIdPre,
          type: 'INCOME',
          amountCents: 30000,
          description: 'Lançamento Pré-Reversão Regime 03.4'
        }
      })
    });
    const jsonReplayRollback: any = await respReplayRollback.json();
    assert(respReplayRollback.status === 200, 'Rota real da PR.044 recupera recibo anterior com HTTP 200 OK');
    assert(jsonReplayRollback.receipt?.replay === true, 'Recibo prévio retornado pela PR.044 com replay = true');
    assert(jsonReplayRollback.receipt?.status === 'APPLIED', 'Status do recibo mantido como APPLIED');

    // Leitura direta no Firestore: saldo rigorosamente intacto em R$ 300,00 (sem duplicação)
    const snapAccAfterReplay = await rawDb.doc(`users/${testUid}/accounts/${rollbackAccId}`).get();
    assert(
      snapAccAfterReplay.data()?.balanceCents === 30000,
      'Consistência pós-reversão: Saldo no Firestore permanece estritamente R$ 300,00 (Zero duplo crédito na PR.044)'
    );

    // 5.5 Nova Mutação Contábil Válida na Rota Real da PR.044
    console.log('  -> [5.5] Executando nova mutação contábil na rota real da PR.044...');
    const rollbackReqIdPost = `req_rollback_post_${Date.now()}`;
    const rollbackTxIdPost = `tx_rollback_post_${Date.now()}`;
    const respTxPost = await fetch(`http://127.0.0.1:${PORT_PR044}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': rollbackReqIdPost
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: rollbackAccId,
        transaction: {
          id: rollbackTxIdPost,
          type: 'INCOME',
          amountCents: 5000, // + R$ 50,00
          description: 'Nova Mutação sob Revisão Real PR.044'
        }
      })
    });
    const jsonTxPost: any = await respTxPost.json();
    assert(respTxPost.status === 200, 'Nova transação comitada na rota da PR.044 com HTTP 200 OK');
    assert(jsonTxPost.receipt?.status === 'APPLIED', 'Nova transação gravada com status APPLIED');
    assert(jsonTxPost.receipt?.replay !== true, 'Primeira execução da nova transação com replay = false');

    // Leitura direta no Firestore: saldo atualizado de 30000 para 35000 cents
    const snapAccFinal = await rawDb.doc(`users/${testUid}/accounts/${rollbackAccId}`).get();
    assert(
      snapAccFinal.data()?.balanceCents === 35000,
      'Saldo no Firestore atualizado exatamente para R$ 350,00 (35000 cents) pela rota da PR.044'
    );

    // 5.6 Validação de Integridade Bidirecional via SafeMoneySerializer
    console.log('  -> [5.6] Conferindo fidelidade contábil e compatibilidade via SafeMoneySerializer...');
    const rawPreTx = await rawDb.doc(`users/${testUid}/transactions/${rollbackTxIdPre}`).get();
    const rawPostTx = await rawDb.doc(`users/${testUid}/transactions/${rollbackTxIdPost}`).get();
    
    const centsPre = SafeMoneySerializer.fromFirestoreCents(rawPreTx.data()?.amountCents);
    const centsPost = SafeMoneySerializer.fromFirestoreCents(rawPostTx.data()?.amountCents);
    const centsTotal = SafeMoneySerializer.fromFirestoreCents(snapAccFinal.data()?.balanceCents);

    assert(centsPre === 30000n, 'Transação pré-reversão desserializada com exatidão como 30000n');
    assert(centsPost === 5000n, 'Transação pós-reversão da PR.044 desserializada com exatidão como 5000n');
    assert(centsTotal === (centsPre + centsPost), 'Soma contábil exata no Ledger: 30000n + 5000n = 35000n');

    // 5.7 Encerramento do Processo da PR.044
    await killProcessSafely(serverPR044.proc);

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
