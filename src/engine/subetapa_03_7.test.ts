/**
 * KYRO FINANCE - SUBETAPA 03.7 (PR.048)
 * SUÍTE DE HOMOLOGAÇÃO: SINCRONIZAÇÃO OFFLINE, FILA RESILIENTE POR TENANT,
 * IDENTIDADE ESTÁVEL (REQUEST ID), TOLERÂNCIA A CONFLITOS DE TOMBSTONE E EMULADORES FIREBASE
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-kyro-synthetic';
process.env.STORAGE_DISABLED = 'false';

import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync, ChildProcess } from 'child_process';
import {
  OfflineSyncEngine,
  MemoryOfflineStorage,
  TenantMismatchError,
  OfflineQueueItem
} from '../services/offlineSyncEngine';
import { clientAuthSession } from '../services/clientAuthSession';
import { FirestoreAdminStore } from '../services/firestoreAdminStore';
import { FirestoreLedgerAdapter } from '../services/firestoreAdapter';
import { SafeMoneySerializer } from '../services/SafeMoneySerializer';
import { parseToCents } from './money';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [OK] ${message}`);
  } else {
    console.error(`  [FALHA] ${message}`);
    throw new Error(`Asserção falhou: ${message}`);
  }
}

const spawnedProcesses: ChildProcess[] = [];

function startServerProcess(port: number): { proc: ChildProcess; pid: number } {
  const serverScript = path.resolve(PROJECT_ROOT, 'src/server/httpServer.ts');
  const env = {
    ...process.env,
    PORT: String(port),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    GCLOUD_PROJECT: 'demo-kyro-synthetic',
    STORAGE_DISABLED: 'false'
  };

  const proc = spawn('npx.cmd', ['tsx', serverScript, '--port', String(port)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  if (proc.pid) {
    spawnedProcesses.push(proc);
  }

  return { proc, pid: proc.pid || 0 };
}

async function waitForHttpServer(port: number, maxAttempts = 40): Promise<boolean> {
  const url = `http://127.0.0.1:${port}/health`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function killProcessSafely(proc: ChildProcess) {
  if (proc.pid) {
    try {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch {}
  }
}

async function runSubetapa037Tests() {
  console.log('================================================================');
  console.log('KYRO FINANCE | SUBETAPA 03.7 - SINCRONIZAÇÃO OFFLINE E MOTOR FINANCEIRO');
  console.log('Ambiente: Firestore Emulator (127.0.0.1:8080) & Auth Emulator (127.0.0.1:9099)');
  console.log('================================================================\n');

  const PORT = 3110;
  console.log(`[Setup] Inicializando Servidor HTTP de Teste na porta ${PORT}...`);
  const { proc } = startServerProcess(PORT);
  const serverReady = await waitForHttpServer(PORT);
  assert(serverReady, `Servidor HTTP de teste operacional na porta ${PORT}`);

  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const store = new FirestoreAdminStore();
  const adapter = new FirestoreLedgerAdapter(store);

  // Inicializa gerenciador de sessão com Auth Emulator
  clientAuthSession.setTestEnvironment(true);
  clientAuthSession.configureTestEmulator('127.0.0.1:9099');

  const sharedStorage = new MemoryOfflineStorage();
  let offlineEngine = new OfflineSyncEngine(sharedStorage);

  const ALICE_EMAIL = `alice_offline_${Date.now()}@kyro.synthetic`;
  const ALICE_PWD = 'AliceOfflineSecret#123';
  const BOB_EMAIL = `bob_offline_${Date.now()}@kyro.synthetic`;
  const BOB_PWD = 'BobOfflineSecret#123';

  // 1. Criação dos Usuários Sintéticos no Auth Emulator
  console.log('\n--- [FASE 1] Autenticação Oficial de Usuários no Firebase Auth Emulator ---');
  const aliceSession = await clientAuthSession.signInWithEmailAndPassword(ALICE_EMAIL, ALICE_PWD);
  const aliceUid = aliceSession.uid;
  assert(!!aliceUid && aliceUid.length > 5, `Usuário Alice autenticada com sucesso no Auth Emulator (UID: ${aliceUid})`);

  const aliceToken = await aliceSession.getIdToken();
  assert(!!aliceToken && aliceToken.length > 20, 'Token oficial de Alice emitido pelo Auth Emulator');

  // Inicializa conta contábil de Alice no Firestore Emulator com R$ 1.000,00 (100.000 centavos)
  const aliceAccountId = `acc_${aliceUid}`;
  await adapter.seedAccount({
    id: aliceAccountId,
    userId: aliceUid,
    name: 'Conta Corrente Alice',
    balanceCents: 100000,
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  });

  const initialAliceAcc = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(initialAliceAcc?.balanceCents === 100000, 'Saldo inicial de Alice no Firestore Emulator: R$ 1.000,00 (100.000 centavos)');

  // ===========================================================================
  // CENÁRIO 1: CRIAÇÃO SEM REDE (OFFLINE) E FILA ISOLADA POR UID
  // ===========================================================================
  console.log('\n--- [CENÁRIO 1] Criação Sem Rede (Operações Enfileiradas Offline) ---');
  
  const op1 = await offlineEngine.enqueueTransaction({
    userId: aliceUid,
    accountId: aliceAccountId,
    type: 'EXPENSE',
    amount: 73.45,
    description: 'Gasolina Shell Offline',
    category: 'Transporte',
    method: 'debit'
  });

  const op2 = await offlineEngine.enqueueTransaction({
    userId: aliceUid,
    accountId: aliceAccountId,
    type: 'EXPENSE',
    amount: 50.00,
    description: 'Almoço Restaurante Offline',
    category: 'Alimentação',
    method: 'credit'
  });

  assert(op1.status === 'PENDING', `Operação 1 enfileirada com status PENDING (requestId: ${op1.requestId})`);
  assert(op2.status === 'PENDING', `Operação 2 enfileirada com status PENDING (requestId: ${op2.requestId})`);
  assert(op1.amountCents === 7345n, 'Operação 1 preserva centavos exatos BigInt: 7.345 centavos');
  assert(op2.amountCents === 5000n, 'Operação 2 preserva centavos exatos BigInt: 5.000 centavos');
  assert(op1.requestId !== op2.requestId, 'Cada operação possui requestId único e estável desde a criação');

  // Verifica que o saldo no servidor permanece 100% INTACTO enquanto estiver offline
  const accOfflineCheck = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accOfflineCheck?.balanceCents === 100000, 'Saldo no Firestore Emulator inalterado: R$ 1.000,00 (zero mutações prematuras no servidor)');

  // ===========================================================================
  // CENÁRIO 2: REINICIALIZAÇÃO DO APP ANTES DA RECONEXÃO (SOBREVIVÊNCIA DA FILA)
  // ===========================================================================
  console.log('\n--- [CENÁRIO 2] Reinicialização do App Antes da Reconexão (Resiliência do Storage) ---');

  // Destrói a instância em memória do motor offline
  offlineEngine = null as any;

  // Recria nova instância apontando para o mesmo storage persistido (simula reload/restart)
  const restartedEngine = new OfflineSyncEngine(sharedStorage);
  const rehydratedQueue = await restartedEngine.getQueue(aliceUid);

  assert(rehydratedQueue.length === 2, `Fila re-hidratada com sucesso após reinicialização: exatamente 2 itens persistidos`);
  assert(rehydratedQueue[0].requestId === op1.requestId, `Item 1 mantém requestId estável idêntico: ${op1.requestId}`);
  assert(rehydratedQueue[1].requestId === op2.requestId, `Item 2 mantém requestId estável idêntico: ${op2.requestId}`);
  assert(rehydratedQueue[0].amountCents === 7345n, 'Item 1 re-hidratado com valor exato em centavos inteiros (7345n)');
  assert(rehydratedQueue[1].amountCents === 5000n, 'Item 2 re-hidratado com valor exato em centavos inteiros (5000n)');
  assert(rehydratedQueue[0].status === 'PENDING' && rehydratedQueue[1].status === 'PENDING', 'Status de ambos os itens permanece PENDING após restart');

  // ===========================================================================
  // CENÁRIO 3: RECONEXÃO E SINCRONIZAÇÃO COM RECONCILIAÇÃO DE RECIBOS DO SERVIDOR
  // ===========================================================================
  console.log('\n--- [CENÁRIO 3] Reconexão e Sincronização Autenticada com Recibos Reconciliados ---');

  clientAuthSession.setCurrentSession(aliceSession);

  const confirmedItems: OfflineQueueItem[] = [];
  const syncResult1 = await restartedEngine.sync({
    baseUrl: BASE_URL,
    userId: aliceUid,
    onItemConfirmed: (item) => confirmedItems.push(item)
  });

  assert(syncResult1.totalProcessed === 2, 'Total de itens processados no primeiro flush: 2');
  assert(syncResult1.committed === 2, 'Total de itens comitados com sucesso: 2');
  assert(confirmedItems.length === 2, 'Dois itens reconciliados e confirmados via callback de interface');

  // Verifica os recibos contábeis retornados pelo servidor
  for (const item of confirmedItems) {
    assert(item.status === 'COMMITTED', `Item ${item.requestId} transitou para COMMITTED`);
    assert(!!item.receipt, `Recibo contábil anexado ao item ${item.requestId}`);
    assert(item.receipt?.status === 'APPLIED', `Recibo com status APPLIED no servidor`);
    assert(item.receipt?.code === 'TRANSACTION_COMMITTED', `Recibo com código TRANSACTION_COMMITTED`);
  }

  // Verifica o saldo debitado no Firestore Emulator: 100.000 - 7.345 - 5.000 = 87.655 centavos (R$ 876,55)
  const accPostSync1 = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accPostSync1?.balanceCents === 87655, `Saldo final de Alice no Firestore Emulator: R$ 876,55 (87.655 centavos exatos)`);

  // ===========================================================================
  // CENÁRIO 4: PERDA DA RESPOSTA APÓS GRAVAÇÃO (SIMULAÇÃO DE REDE CAÍDA PÓS-COMMIT)
  // ===========================================================================
  console.log('\n--- [CENÁRIO 4] Perda da Resposta Pós-Commit e Recuperação sem Duplicidade Contábil ---');

  const opDrop = await restartedEngine.enqueueTransaction({
    userId: aliceUid,
    accountId: aliceAccountId,
    type: 'EXPENSE',
    amount: 120.00,
    description: 'Compra Mercado com Queda de Conexão',
    category: 'Mercado',
    method: 'credit'
  });

  assert(opDrop.status === 'PENDING', `Operação com simulação de drop enfileirada (requestId: ${opDrop.requestId})`);

  // Simula primeiro envio: o commit ocorre no servidor via fetch direto, mas o cliente "perde" a resposta
  const dropPayload = {
    action: 'save_transaction',
    requestId: opDrop.requestId,
    accountId: aliceAccountId,
    accountOwnerId: aliceUid,
    transaction: {
      id: opDrop.id,
      description: opDrop.description,
      amount: opDrop.amount,
      amountCents: opDrop.amountCents.toString(),
      type: opDrop.type,
      category: opDrop.category
    }
  };

  // Commit no servidor
  const dropResp = await fetch(`${BASE_URL}/api/database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aliceToken}`,
      'X-Request-ID': opDrop.requestId
    },
    body: JSON.stringify(dropPayload)
  });
  const dropData = await dropResp.json();
  assert(dropResp.ok && dropData.receipt?.status === 'APPLIED', 'Commit efetuado com sucesso no servidor (mas cliente simula perda do pacote HTTP)');

  // Saldo no servidor pós-commit: 87.655 - 12.000 = 75.655 centavos
  const accAfterDropCommit = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accAfterDropCommit?.balanceCents === 75655, 'Saldo debitado no servidor para R$ 756,55 (75.655 centavos)');

  // No cliente, a operação continua PENDING (pois o cliente não recebeu o recibo a tempo)
  const queueBeforeRetry = await restartedEngine.getQueue(aliceUid);
  const pendingDropItem = queueBeforeRetry.find(i => i.requestId === opDrop.requestId);
  assert(pendingDropItem?.status === 'PENDING', 'Item permanece PENDING no storage local aguardando recuperação');

  // Agora o cliente reconecta e dispara o sync() normal com o MESMO requestId estável
  const syncResultDrop = await restartedEngine.sync({
    baseUrl: BASE_URL,
    userId: aliceUid
  });

  assert(syncResultDrop.committed >= 1, 'Reenvio processado com sucesso');
  const queueAfterDropRetry = await restartedEngine.getQueue(aliceUid);
  const recoveredDropItem = queueAfterDropRetry.find(i => i.requestId === opDrop.requestId);

  assert(recoveredDropItem?.status === 'COMMITTED', 'Item recuperado e marcado como COMMITTED');
  assert(recoveredDropItem?.receipt?.replay === true, 'Recibo retornado é REPLAY idêntico do commit anterior');
  assert(recoveredDropItem?.receipt?.requestId === opDrop.requestId, 'Recibo mantém o mesmo requestId estável');

  // PROVA DE OURO: Saldo final no Firestore Emulator PERMANECE 75.655 centavos (SEM DUPLO EFEITO CONTÁBIL)
  const accAfterDropRecover = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accAfterDropRecover?.balanceCents === 75655, 'EFEITO CONTÁBIL ÚNICO: Saldo permanece exatamente R$ 756,55 sem duplicação de débito');

  // ===========================================================================
  // CENÁRIO 5: REENVIO CONCORRENTE SIMULTÂNEO (RACE CONDITION EM PROMISE.ALL)
  // ===========================================================================
  console.log('\n--- [CENÁRIO 5] Reenvio Concorrente Simultâneo (Promise.all) ---');

  const opConcurrent = await restartedEngine.enqueueTransaction({
    userId: aliceUid,
    accountId: aliceAccountId,
    type: 'EXPENSE',
    amount: 45.00,
    description: 'Farmácia com Disparo Duplo Simultâneo',
    category: 'Saúde'
  });

  // Dispara dois sync() simultâneos em paralelo
  const [conc1, conc2] = await Promise.all([
    restartedEngine.sync({ baseUrl: BASE_URL, userId: aliceUid }),
    restartedEngine.sync({ baseUrl: BASE_URL, userId: aliceUid })
  ]);

  const queueConcurrent = await restartedEngine.getQueue(aliceUid);
  const concItem = queueConcurrent.find(i => i.requestId === opConcurrent.requestId);
  assert(concItem?.status === 'COMMITTED', 'Item concorrente consolidado como COMMITTED');

  // Saldo debitado exatamente uma vez: 75.655 - 4.500 = 71.155 centavos (R$ 711,55)
  const accAfterConc = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accAfterConc?.balanceCents === 71155, 'Concorrência resolvida com exato 1 efeito contábil: Saldo R$ 711,55 (71.155 centavos)');

  // ===========================================================================
  // CENÁRIO 6: TROCA DE USUÁRIO COM ITENS PENDENTES (ISOLAMENTO MULTI-TENANT)
  // ===========================================================================
  console.log('\n--- [CENÁRIO 6] Troca de Usuário com Itens Pendentes (Isolamento Multi-Tenant) ---');

  // Alice enfileira uma despesa privada
  const opAlicePrivate = await restartedEngine.enqueueTransaction({
    userId: aliceUid,
    accountId: aliceAccountId,
    type: 'EXPENSE',
    amount: 30.00,
    description: 'Despesa Privada de Alice',
    category: 'Pessoal'
  });

  // Alice efetua logout
  clientAuthSession.signOut();
  assert(clientAuthSession.getCurrentSession() === null, 'Alice efetuou logout');

  // Bob efetua login no Auth Emulator
  const bobSession = await clientAuthSession.signInWithEmailAndPassword(BOB_EMAIL, BOB_PWD);
  const bobUid = bobSession.uid;
  assert(!!bobUid && bobUid !== aliceUid, `Bob autenticado com sucesso (UID: ${bobUid})`);

  // Bob consulta sua fila no storage
  const bobQueue = await restartedEngine.getQueue(bobUid);
  assert(bobQueue.length === 0, 'Fila de Bob está completamente vazia (zero contaminação da fila de Alice)');

  // Bob tenta disparar sync informando o userId de Alice
  let bobCrossTenantBlocked = false;
  try {
    await restartedEngine.sync({
      baseUrl: BASE_URL,
      userId: aliceUid
    });
  } catch (err: any) {
    if (err instanceof TenantMismatchError || err?.code === 'PERMISSION_DENIED_TENANT_MISMATCH') {
      bobCrossTenantBlocked = true;
    }
  }
  assert(bobCrossTenantBlocked, 'Tentativa de Bob sincronizar a fila de Alice sumariamente bloqueada com PERMISSION_DENIED_TENANT_MISMATCH');

  // Bob desloga e Alice reloga
  clientAuthSession.signOut();
  clientAuthSession.setCurrentSession(aliceSession);

  // Alice recupera sua fila com o item privado intacto
  const aliceRecoveredQueue = await restartedEngine.getQueue(aliceUid);
  const alicePrivateItem = aliceRecoveredQueue.find(i => i.requestId === opAlicePrivate.requestId);
  assert(alicePrivateItem?.status === 'PENDING', 'Item privado de Alice continua íntegro e PENDING após retorno de Alice');

  // Alice sincroniza sua fila
  await restartedEngine.sync({ baseUrl: BASE_URL, userId: aliceUid });
  const accAfterAlicePrivate = await adapter.getAccount(aliceUid, aliceAccountId);
  // 71.155 - 3.000 = 68.155 centavos (R$ 681,55)
  assert(accAfterAlicePrivate?.balanceCents === 68155, 'Item de Alice sincronizado com sucesso: Saldo R$ 681,55 (68.155 centavos)');

  // ===========================================================================
  // CENÁRIO 7: CONFLITO COM ESTORNO E TOMBSTONE (PREVENÇÃO DE RESSURREIÇÃO)
  // ===========================================================================
  console.log('\n--- [CENÁRIO 7] Conflito com Estorno e Tombstone Ativo (Prevenção de Ressurreição) ---');

  // 1. Cria e comita uma transação normal no servidor
  const opToReverse = await restartedEngine.enqueueTransaction({
    userId: aliceUid,
    accountId: aliceAccountId,
    type: 'EXPENSE',
    amount: 50.00,
    description: 'Assinatura Mensal Alvo de Estorno',
    category: 'Serviços'
  });

  await restartedEngine.sync({ baseUrl: BASE_URL, userId: aliceUid });
  const accPostCommitRev = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accPostCommitRev?.balanceCents === 63155, 'Transação comitada no servidor: Saldo debitado para R$ 631,55 (63.155 centavos)');

  // 2. Estorna a transação no servidor via rota oficial /api/database
  const revReqId = `req_rev_${Date.now()}`;
  const revResp = await fetch(`${BASE_URL}/api/database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aliceToken}`,
      'X-Request-ID': revReqId
    },
    body: JSON.stringify({
      action: 'reverse_transaction',
      originalTxId: opToReverse.id,
      reason: 'Estorno deliberado pelo titular'
    })
  });

  const revData = await revResp.json();
  assert(revResp.ok && revData.success === true, 'Transação estornada com sucesso no servidor via reverse_transaction');
  assert(revData.receipt?.status === 'APPLIED', 'Recibo de estorno emitido com status APPLIED');

  // Saldo no servidor volta para 68.155 centavos
  const accAfterReversal = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accAfterReversal?.balanceCents === 68155, 'Saldo restaurado no Firestore Emulator após estorno: R$ 681,55 (68.155 centavos)');

  // 3. Simula que a fila offline tenta reenviar uma réplica ou nova mutação com o mesmo ID da transação estornada
  const conflictingItem: OfflineQueueItem = {
    ...opToReverse,
    requestId: `req_conflict_replay_${Date.now()}`,
    status: 'PENDING'
  };

  const currentQ = await restartedEngine.getQueue(aliceUid);
  currentQ.push(conflictingItem);
  await (restartedEngine as any).saveQueue(aliceUid, currentQ);

  // Executa sync
  let conflictEventTriggered = false;
  const syncConflictResult = await restartedEngine.sync({
    baseUrl: BASE_URL,
    userId: aliceUid,
    onItemConflict: (item) => {
      if (item.id === opToReverse.id) conflictEventTriggered = true;
    }
  });

  assert(syncConflictResult.conflictsResolved >= 1, 'Motor detectou e resolveu o conflito de tombstone');
  assert(conflictEventTriggered, 'Callback onItemConflict disparado com a notificação do tombstone');

  const queueAfterConflict = await restartedEngine.getQueue(aliceUid);
  const tombstoneItem = queueAfterConflict.find(i => i.id === opToReverse.id && i.requestId === conflictingItem.requestId);
  assert(tombstoneItem?.status === 'CONFLICT_RESOLVED', 'Item conflitante marcado com status CONFLICT_RESOLVED');
  assert(tombstoneItem?.error?.code === 'TOMBSTONED_NO_RESURRECTION', 'Código do erro identificado: TOMBSTONED_NO_RESURRECTION');

  // Saldo permanece inalterado (zero ressurreição contábil)
  const accAfterTombstoneCheck = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accAfterTombstoneCheck?.balanceCents === 68155, 'RESSURREIÇÃO IMPEDIDA: Saldo permanece intacto em R$ 681,55 (68.155 centavos)');

  // Verifica que getConfirmedTransactions NÃO lista a transação estornada como confirmada
  const confirmedList = await restartedEngine.getConfirmedTransactions(aliceUid);
  const hasResurrected = confirmedList.some(i => i.requestId === conflictingItem.requestId);
  assert(!hasResurrected, 'Lançamento estornado NÃO reaparece na lista de transações confirmadas da interface');

  // ===========================================================================
  // CENÁRIO 8: REJEIÇÃO DEFINITIVA POR ERRO DE VALIDAÇÃO (INVARIANTE CONTÁBIL)
  // ===========================================================================
  console.log('\n--- [CENÁRIO 8] Rejeição Definitiva por Erro de Validação (Invariante Contábil) ---');

  // Enfileira manualmente item com conta que pertence a outro usuário
  const invalidAccountItem: OfflineQueueItem = {
    requestId: `req_invalid_acc_${Date.now()}`,
    id: `tx_invalid_${Date.now()}`,
    userId: aliceUid,
    accountId: `bob_secret_acc:123`,
    accountOwnerId: 'another_user',
    type: 'EXPENSE',
    amountCents: 1500n,
    amount: 15.00,
    description: 'Tentativa em conta alheia',
    category: 'Outros',
    status: 'PENDING',
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const queueWithInvalid = await restartedEngine.getQueue(aliceUid);
  queueWithInvalid.push(invalidAccountItem);
  await (restartedEngine as any).saveQueue(aliceUid, queueWithInvalid);

  let permanentRejectedEvent = false;
  const syncInvalidResult = await restartedEngine.sync({
    baseUrl: BASE_URL,
    userId: aliceUid,
    onItemRejected: (item) => {
      if (item.requestId === invalidAccountItem.requestId) permanentRejectedEvent = true;
    }
  });

  assert(syncInvalidResult.permanentRejected >= 1, 'Item inválido rejeitado definitivamente pelo servidor');
  assert(permanentRejectedEvent, 'Callback onItemRejected disparado');

  const queueAfterInvalid = await restartedEngine.getQueue(aliceUid);
  const rejectedRecord = queueAfterInvalid.find(i => i.requestId === invalidAccountItem.requestId);
  assert(rejectedRecord?.status === 'REJECTED_PERMANENT', 'Status do item atualizado para REJECTED_PERMANENT');
  assert(rejectedRecord?.error?.permanent === true, 'Erro marcado como definitivo (permanent: true)');

  // Executa sync subsequente: verifica que REJECTED_PERMANENT NÃO é reenviado em loop
  const secondSync = await restartedEngine.sync({ baseUrl: BASE_URL, userId: aliceUid });
  assert(secondSync.totalProcessed === 0, 'Itens com status REJECTED_PERMANENT são ignorados em sync subsequente (sem retentativa infinita)');

  // ===========================================================================
  // CENÁRIO 9: FALHA TRANSITÓRIA DE SERVIDOR (HTTP 503 STORAGE UNAVAILABLE)
  // ===========================================================================
  console.log('\n--- [CENÁRIO 9] Falha Transitória de Servidor (503) com Recuperação Posterior ---');

  const opTransient = await restartedEngine.enqueueTransaction({
    userId: aliceUid,
    accountId: aliceAccountId,
    type: 'EXPENSE',
    amount: 25.00,
    description: 'Café da Manhã com Servidor 503',
    category: 'Alimentação'
  });

  // Simula fetch que retorna HTTP 503 na primeira chamada
  let simulate503 = true;
  const simulatedFetch: typeof fetch = async (input, init) => {
    if (simulate503) {
      return new Response(JSON.stringify({
        success: false,
        code: 'STORAGE_UNAVAILABLE',
        error: 'Armazenamento transacional indisponível. Gravação não confirmada.'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return fetch(input, init);
  };

  const syncTransient1 = await restartedEngine.sync({
    baseUrl: BASE_URL,
    userId: aliceUid,
    fetchImpl: simulatedFetch
  });

  assert(syncTransient1.transientFailed >= 1, 'Item marcado como falha transitória (transientFailed >= 1)');
  const queueAfter503 = await restartedEngine.getQueue(aliceUid);
  const transientRecord = queueAfter503.find(i => i.requestId === opTransient.requestId);

  assert(transientRecord?.status === 'FAILED_TRANSIENT', 'Status do item transitou para FAILED_TRANSIENT');
  assert(transientRecord?.retryCount === 1, 'retryCount incrementado para 1');
  assert(transientRecord?.error?.permanent === false, 'Erro catalogado como não permanente (permanent: false)');

  // Servidor se recupera (simulate503 = false)
  simulate503 = false;
  const syncTransient2 = await restartedEngine.sync({
    baseUrl: BASE_URL,
    userId: aliceUid,
    fetchImpl: simulatedFetch
  });

  assert(syncTransient2.committed >= 1, 'Item recuperado e comitado após restabelecimento do servidor');
  const queueAfterRecover = await restartedEngine.getQueue(aliceUid);
  const recoveredRecord = queueAfterRecover.find(i => i.requestId === opTransient.requestId);

  assert(recoveredRecord?.status === 'COMMITTED', 'Status final do item transitou para COMMITTED com recibo oficial');
  assert(!!recoveredRecord?.receipt, 'Recibo oficial anexado com sucesso');

  // Saldo final de Alice: 68.155 - 2.500 = 65.655 centavos (R$ 656,55)
  const accFinalAlice = await adapter.getAccount(aliceUid, aliceAccountId);
  assert(accFinalAlice?.balanceCents === 65655, 'Saldo final de Alice consolidado no Firestore Emulator: R$ 656,55 (65.655 centavos)');

  // Encerramento limpo do processo do servidor
  console.log('\n[Teardown] Encerrando servidor HTTP de teste...');
  await killProcessSafely(proc);

  console.log('\n================================================================');
  console.log(`SUBETAPA 03.7 CONCLUÍDA: ${passedTests} / ${totalTests} ASSERÇÕES APROVADAS (100% SUCESSO)`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runSubetapa037Tests().catch((err) => {
  console.error('Erro na execução da suíte 03.7:', err);
  for (const proc of spawnedProcesses) {
    killProcessSafely(proc);
  }
  process.exit(1);
});
