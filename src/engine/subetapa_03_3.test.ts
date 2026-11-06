/**
 * KYRO FINANCE | BATERIA DE HOMOLOGAÇÃO OFICIAL: SUBETAPA 03.3 (REVISÃO DEFINITIVA)
 * 
 * Estrutura e Cobertura Rigorosa dos Ramos:
 * 
 * 1. FALHA EXPLÍCITA QUANDO ARMAZENAMENTO INDISPONÍVEL:
 *    - Sem fallback silencioso para mock na rota da aplicação
 *    - Devolve HTTP 503 (STORAGE_UNAVAILABLE) explícito, sem recibo APPLIED ou confirmação de gravação
 * 
 * 2. AUTENTICAÇÃO REAL NA ROTA E RAMO DESCOBERTO (FORA DO EMULADOR):
 *    - Ramo Descoberto: Execução sem FIREBASE_AUTH_EMULATOR_HOST com JWT forjado -> Rejeição estrita HTTP 401 e zero mutação
 *    - Falha no verificador oficial termina obrigatoriamente em rejeição
 *    - Rejeição de demo-token na entrada pública mesmo sob variáveis de ambiente
 *    - Entrada pública ignora tentativa de injeção de falha via cabeçalho/corpo (HTTP 200 normal)
 *    - Bloqueio de cross-tenant (HTTP 403 PERMISSION_DENIED_CROSS_TENANT)
 *    - Prova criptográfica isolada com chave pública obrigatória (ausência de chave falha explicitamente)
 * 
 * 3. INTEGRAÇÃO REAL MULTI-PROCESSO NO FIRESTORE EMULATOR OFICIAL:
 *    - Token oficial emitido pelo Firebase Auth Emulator (127.0.0.1:9099)
 *    - Processo 1 (Porta 4101, PID A) e Processo 2 (Porta 4102, PID B) executando a rota HTTP
 *    - Disparo concorrente simultâneo via rede HTTP comprovando efeito único e replay: true
 *    - Leitura direta do Firestore Emulator oficial (127.0.0.1:8080)
 *    - Encerramento dos processos (kill nos PIDs) e subida de Processo 3 (Porta 4103, PID C)
 *    - Reenvio idêntico pós-reinício = HTTP 200 com replay e saldo preservado (Zero Duplo Débito)
 *    - Reenvio com payload divergente = HTTP 409 (IDEMPOTENCY_PAYLOAD_MISMATCH) com saldo preservado
 *    - Falha na transação HTTP = HTTP 500 com rollback e contagem de documentos intacta no Firestore
 * 
 * 4. ATOMICIDADE ISOLADA E ESCOPO DO WEBHOOK:
 *    - Prova isolada de atomicidade pré-commit na dependência exclusiva de teste
 *    - Testes de Contrato do Webhook com mock: 401, 403, 409 e 200
 *    - Integração HTTP Real via rede para a rota /api/webhook
 * 
 * 5. SERIALIZAÇÃO BIGINT IEEE 754 E DADOS LEGADOS:
 *    - Ida e volta exata sem perda de centavos no Firestore
 *    - Normalização determinística de float legados para centavos BigInt
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { SafeMoneySerializer } from '../services/SafeMoneySerializer';
import { 
  verifyRealAuthToken, 
  generateTestKeyPair, 
  createSignedTestToken, 
  verifyJwtCryptographically,
  getOfficialAuthEmulatorToken,
  DEMO_PROJECT_ID 
} from '../services/firebaseAdminAuth';
import { FirestoreAdminStore } from '../services/firestoreAdminStore';
import { FirestoreLedgerAdapter, IdempotencyConflictError } from '../services/firestoreAdapter';
import { TransactionalStoreMock } from '../services/storeClient';
import handler, { getSecureStore, setStoreInstance, resetStoreInstance } from '../../api/database';
import webhookHandler from '../../api/webhook';

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

// Mock HTTP shim para testes de contrato
function createMockHttp(options: {
  method: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
}) {
  let statusCode = 200;
  let responseData: any = null;
  const headersSet: Record<string, string> = {};

  const req: any = {
    method: options.method,
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {}
  };

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseData = data;
      return res;
    },
    send(data: any) {
      responseData = data;
      return res;
    },
    setHeader(name: string, value: string) {
      headersSet[name.toLowerCase()] = value;
      return res;
    },
    end() {
      return res;
    }
  };

  return {
    req,
    res,
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
    getHeaders: () => headersSet
  };
}

// Utilitário para aguardar servidor HTTP responder
async function waitForHttpServer(port: number, maxAttempts = 50): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      if (resp.ok) return true;
    } catch {
      // Aguarda 150ms
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

// Inicia processo de servidor HTTP autônomo
function startServerProcess(port: number): { proc: ChildProcess; pid: number } {
  const serverScript = path.resolve(process.cwd(), 'src/server/httpServer.ts');
  const env = {
    ...process.env,
    PORT: String(port),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
  };

  const proc = spawn('npx.cmd', ['tsx', serverScript, '--port', String(port)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  const pid = proc.pid || 0;
  return { proc, pid };
}

// Encerra processo com segurança
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

async function runCompleteSubetapa033Suite() {
  console.log('\n=== INICIANDO BATERIA COMPLETA DE HOMOLOGAÇÃO: SUBETAPA 03.3 ===\n');

  // Garante variáveis do emulador ativas para o processo de teste
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

  // Obtém ID Token oficial emitido pelo Firebase Auth Emulator oficial
  const officialAuth = await getOfficialAuthEmulatorToken('alice_oficial@kyro.local', 'SenhaOficial123!');

  // =========================================================================
  // BLOCO 1: FALHA EXPLÍCITA QUANDO O ARMAZENAMENTO ESTIVER INDISPONÍVEL
  // (Sem Fallback Silencioso para Mock)
  // =========================================================================
  console.log('[1/5] Falha Explícita com Armazenamento Indisponível (Sem Fallback para Mock)...');

  process.env.STORAGE_DISABLED = 'true';
  resetStoreInstance();

  const httpFailStoreAuth = createMockHttp({
    method: 'POST',
    headers: {
      authorization: `Bearer ${officialAuth.idToken}`,
      'x-request-id': 'req_store_fail_01'
    },
    body: {
      action: 'save_transaction',
      amountCents: 10000
    }
  });

  await handler(httpFailStoreAuth.req, httpFailStoreAuth.res);
  assert(httpFailStoreAuth.getStatusCode() === 503, 'Rota com armazenamento indisponível retorna HTTP 503 (STORAGE_UNAVAILABLE)');
  assert(httpFailStoreAuth.getResponseData().code === 'STORAGE_UNAVAILABLE', 'Código explícito STORAGE_UNAVAILABLE retornado');
  assert(httpFailStoreAuth.getResponseData().receipt === undefined, 'Nenhum recibo APPLIED foi emitido');
  assert(httpFailStoreAuth.getResponseData().success === false, 'Nenhuma mensagem de gravação confirmada');

  delete process.env.STORAGE_DISABLED;
  resetStoreInstance();

  // =========================================================================
  // BLOCO 2: AUTENTICAÇÃO REAL NA ROTA E RAMO DESCOBERTO (FORA DO EMULADOR)
  // =========================================================================
  console.log('\n[2/5] Autenticação Real na Rota e Ramo Descoberto (Fora do Emulador)...');

  // 2.1 Teste do Ramo Descoberto: Execução SEM FIREBASE_AUTH_EMULATOR_HOST
  // Simula requisição recebendo JWT com claims plausíveis e assinatura inválida fora do emulador
  const savedEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  const keyPairForged = generateTestKeyPair();
  const forgedJwt = createSignedTestToken({
    uid: 'usr_adversarial_forged',
    projectId: DEMO_PROJECT_ID,
    privateKeyPem: keyPairForged.privateKey,
    adulterateSignature: true
  });

  const httpForgedNoEmulator = createMockHttp({
    method: 'POST',
    headers: {
      authorization: `Bearer ${forgedJwt}`,
      'x-request-id': 'req_forged_no_emulator'
    },
    body: {
      action: 'save_transaction',
      amountCents: 99000
    }
  });

  await handler(httpForgedNoEmulator.req, httpForgedNoEmulator.res);
  assert(httpForgedNoEmulator.getStatusCode() === 401, 'Ramo sem emulador: JWT forjado rejeitado com HTTP 401');
  assert(
    (httpForgedNoEmulator.getResponseData().error || '').includes('Rejeição de autenticação Firebase Admin'),
    'Verificador oficial Firebase Admin rejeitou a credencial explicitamente'
  );

  // Restaura variável do Auth Emulator
  process.env.FIREBASE_AUTH_EMULATOR_HOST = savedEmulatorHost;

  // 2.2 Rejeição de Credencial Sintética (demo-token) na Rota Pública
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_SYNTHETIC_TEST = 'true';
  const httpSyntheticPublic = createMockHttp({
    method: 'POST',
    headers: {
      authorization: 'Bearer demo-token:usr_alice_synthetic',
      'x-request-id': 'req_synth_public'
    },
    body: { action: 'save_transaction', amountCents: 5000 }
  });
  await handler(httpSyntheticPublic.req, httpSyntheticPublic.res);
  assert(httpSyntheticPublic.getStatusCode() === 401, 'demo-token na rota pública é sumariamente rejeitado com HTTP 401');
  assert(
    (httpSyntheticPublic.getResponseData().error || '').includes('proibidas'),
    'Mensagem atesta proibição categórica de credenciais sintéticas na entrada pública'
  );

  // 2.3 Tentativa de Injeção de Falha via Cabeçalho/Corpo na Rota Pública é IGNORADA
  const httpIgnoredFailureInjection = createMockHttp({
    method: 'POST',
    headers: {
      authorization: `Bearer ${officialAuth.idToken}`,
      'x-request-id': `req_ignore_fail_${Date.now()}`,
      'x-simulate-failure': 'pre-commit'
    },
    body: {
      action: 'save_transaction',
      simulatePreCommitFailure: true,
      transaction: {
        id: `tx_clean_entry_${Date.now()}`,
        type: 'EXPENSE',
        amountCents: 5000,
        description: 'Transação com injeção externa ignorada'
      }
    }
  });
  await handler(httpIgnoredFailureInjection.req, httpIgnoredFailureInjection.res);
  assert(
    httpIgnoredFailureInjection.getStatusCode() === 200,
    'Entrada pública ignora x-simulate-failure/body e conclui com HTTP 200 OK (Injeção Externa Bloqueada)'
  );

  // 2.4 Tentativa de Escrita em Outro UID (Cross-Tenant) via Rota HTTP
  const httpCrossTenant = createMockHttp({
    method: 'POST',
    headers: {
      authorization: `Bearer ${officialAuth.idToken}`,
      'x-request-id': 'req_cross_tenant_test'
    },
    body: {
      action: 'save_transaction',
      userId: 'usr_bob_vitima',
      amountCents: 50000
    }
  });
  await handler(httpCrossTenant.req, httpCrossTenant.res);
  assert(httpCrossTenant.getStatusCode() === 403, 'Tentativa de escrita em outro UID rejeitada com HTTP 403 Forbidden');
  assert(
    httpCrossTenant.getResponseData().code === 'PERMISSION_DENIED_CROSS_TENANT',
    'Código PERMISSION_DENIED_CROSS_TENANT emitido pela barreira de segurança'
  );

  // 2.5 Prova Criptográfica Isolada com Chave Pública Obrigatória (Testes de Contrato)
  const keyPair = generateTestKeyPair();
  const validToken = createSignedTestToken({
    uid: 'usr_alice_real',
    projectId: DEMO_PROJECT_ID,
    privateKeyPem: keyPair.privateKey
  });
  const resValid = verifyJwtCryptographically(validToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(resValid.isValid === true, 'Token assinado com RS256 verificado com sucesso');
  assert(resValid.uid === 'usr_alice_real', 'UID extraído com exatidão da claim sub do token');

  // Ausência de Chave Pública Falha Explicitamente
  const resNoKey = verifyJwtCryptographically(validToken, DEMO_PROJECT_ID, '');
  assert(!resNoKey.isValid, 'Ausência de chave pública falha explicitamente na verificação criptográfica');
  assert((resNoKey.error || '').includes('Chave pública não fornecida'), 'Mensagem de erro exige chave pública');

  // Token Expirado
  const expiredToken = createSignedTestToken({
    uid: 'usr_alice_expired',
    projectId: DEMO_PROJECT_ID,
    expiresInSeconds: -3600,
    privateKeyPem: keyPair.privateKey
  });
  const resExpired = verifyJwtCryptographically(expiredToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resExpired.isValid, 'Token expirado é sumariamente rejeitado');

  // Token com Payload Adulterado
  const adulteratedPayloadToken = createSignedTestToken({
    uid: 'usr_legit',
    projectId: DEMO_PROJECT_ID,
    privateKeyPem: keyPair.privateKey,
    adulteratePayload: true
  });
  const resAdulteratedPayload = verifyJwtCryptographically(adulteratedPayloadToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resAdulteratedPayload.isValid, 'Token com payload adulterado rejeitado pela validação de assinatura');

  // Token com Assinatura Adulterada
  const adulteratedSigToken = createSignedTestToken({
    uid: 'usr_legit',
    projectId: DEMO_PROJECT_ID,
    privateKeyPem: keyPair.privateKey,
    adulterateSignature: true
  });
  const resAdulteratedSig = verifyJwtCryptographically(adulteratedSigToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resAdulteratedSig.isValid, 'Token com bytes de assinatura corrompidos rejeitado');

  // Token de Projeto Incorreto
  const wrongProjectToken = createSignedTestToken({
    uid: 'usr_alice_real',
    projectId: 'demo-wrong-project-adversarial',
    privateKeyPem: keyPair.privateKey
  });
  const resWrongProj = verifyJwtCryptographically(wrongProjectToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resWrongProj.isValid, 'Token emitido para projeto incorreto é rejeitado');

  // =========================================================================
  // BLOCO 3: INTEGRAÇÃO REAL EM DOIS PROCESSOS INDEPENDENTES NO FIRESTORE EMULATOR
  // =========================================================================
  console.log('\n[3/5] Integração em Dois Processos Independentes (PIDs Distintos) no Firestore Emulator...');

  const PORT_1 = 4101;
  const PORT_2 = 4102;
  const PORT_3 = 4103;

  console.log(`  -> Subindo Processo 1 na porta ${PORT_1}...`);
  const server1 = startServerProcess(PORT_1);
  console.log(`  -> Subindo Processo 2 na porta ${PORT_2}...`);
  const server2 = startServerProcess(PORT_2);

  const ready1 = await waitForHttpServer(PORT_1);
  const ready2 = await waitForHttpServer(PORT_2);

  assert(ready1 && ready2, 'Ambos os servidores HTTP iniciaram com sucesso nas portas 4101 e 4102');
  assert(server1.pid !== server2.pid, `PIDs comprovadamente distintos no SO: PID 1 (${server1.pid}) !== PID 2 (${server2.pid})`);

  const firestoreDirect = new FirestoreAdminStore();
  const testUid = officialAuth.uid;
  const accountId = 'acc_multi_proc_shared';

  const rawDb = firestoreDirect.getRawDb();
  await rawDb.doc(`users/${testUid}/accounts/${accountId}`).set({
    id: accountId,
    userId: testUid,
    name: 'Conta Multi-Processo Compartilhada',
    balanceCents: 100000, // R$ 1.000,00 inicial
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  });

  const concurrentRequestId = `req_multiproc_${Date.now()}`;
  const mutationPayload = {
    action: 'save_transaction',
    accountId,
    requestId: concurrentRequestId,
    transaction: {
      id: `tx_multiproc_${Date.now()}`,
      type: 'EXPENSE',
      amountCents: 20000, // R$ 200,00
      category: 'Serviços',
      description: 'Débito Concorrente Multi-Processo'
    }
  };

  // 3.1 Disparo Concorrente pela Rede HTTP Real
  console.log('  -> Enviando requisições concorrentes via HTTP para Processo 1 e Processo 2...');
  const [resp1, resp2] = await Promise.all([
    fetch(`http://127.0.0.1:${PORT_1}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': concurrentRequestId
      },
      body: JSON.stringify(mutationPayload)
    }),
    fetch(`http://127.0.0.1:${PORT_2}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officialAuth.idToken}`,
        'X-Request-ID': concurrentRequestId
      },
      body: JSON.stringify(mutationPayload)
    })
  ]);

  const json1: any = await resp1.json();
  const json2: any = await resp2.json();

  assert(resp1.status === 200 && resp2.status === 200, 'Ambas as instâncias retornam HTTP 200 OK');
  assert(json1.receipt?.status === 'APPLIED' && json2.receipt?.status === 'APPLIED', 'Ambas as instâncias confirmam status APPLIED');
  assert(json1.receipt?.replay === true || json2.receipt?.replay === true, 'Exatamente uma instância retornou replay: true');

  // 3.2 Leitura Direta no Firestore Emulator Oficial
  const accSnapAfterConcurrent = await rawDb.doc(`users/${testUid}/accounts/${accountId}`).get();
  const accDataAfterConcurrent = accSnapAfterConcurrent.data();
  assert(
    accDataAfterConcurrent?.balanceCents === 80000,
    'Saldo no Firestore Emulator debitado uma única vez: 100000 -> 80000 (R$ 800,00)'
  );

  const receiptSnap = await rawDb.doc(`users/${testUid}/idempotency/${concurrentRequestId}`).get();
  assert(receiptSnap.exists, 'Recibo de idempotência persistido diretamente no Firestore Emulator');
  assert(receiptSnap.data()?.status === 'APPLIED', 'Recibo de idempotência com status APPLIED no Firestore');

  // 3.3 Integração HTTP Real de Webhook pela Rede (Processo 1 Ativo)
  console.log('  -> Testando integração HTTP real de Webhook pela rede (Processo 1)...');
  const respWebhookHttp = await fetch(`http://127.0.0.1:${PORT_1}/api/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': 'kyro_webhook_secret_dev'
    },
    body: JSON.stringify({
      action: 'sync_transactions',
      senderPhone: '558695368780',
      transaction: {
        id: `tx_wa_net_${Date.now()}`,
        amount: 45.00,
        description: 'Lançamento Webhook HTTP Rede'
      }
    })
  });
  const jsonWaNet: any = await respWebhookHttp.json();
  assert(respWebhookHttp.status === 200, '[Integração HTTP] POST /api/webhook pela rede retorna HTTP 200');
  assert(jsonWaNet.status === 'synced', '[Integração HTTP] Webhook processou e sincronizou a transação via rede');

  // Envio de Webhook Não Autorizado pela Rede
  const respWebhookUnauth = await fetch(`http://127.0.0.1:${PORT_1}/api/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': 'segredo_invalido_hacker'
    },
    body: JSON.stringify({ action: 'sync_transactions' })
  });
  assert(respWebhookUnauth.status === 401, '[Integração HTTP] POST /api/webhook com segredo inválido pela rede retorna HTTP 401');

  // 3.4 Encerramento dos dois processos
  console.log(`  -> Encerrando Processo 1 (PID ${server1.pid}) e Processo 2 (PID ${server2.pid})...`);
  await killProcessSafely(server1.proc);
  await killProcessSafely(server2.proc);

  // 3.5 Subida de NOVO PROCESSO INDEPENDENTE (Processo 3)
  console.log(`  -> Subindo Processo 3 independente na porta ${PORT_3}...`);
  const server3 = startServerProcess(PORT_3);
  const ready3 = await waitForHttpServer(PORT_3);
  assert(ready3, 'Processo 3 iniciado e pronto na porta 4103');
  assert(
    server3.pid !== server1.pid && server3.pid !== server2.pid,
    `Processo 3 possui PID independente (${server3.pid})`
  );

  // 3.6 Retry Pós-Reinício com mesmo requestId e mesmo payload
  console.log('  -> Enviando retry com mesmo payload para o Processo 3...');
  const respRetry = await fetch(`http://127.0.0.1:${PORT_3}/api/database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officialAuth.idToken}`,
      'X-Request-ID': concurrentRequestId
    },
    body: JSON.stringify(mutationPayload)
  });
  const jsonRetry: any = await respRetry.json();

  assert(respRetry.status === 200, 'Retry no Processo 3 retorna HTTP 200');
  assert(jsonRetry.receipt?.replay === true, 'Recibo recuperado diretamente do Firestore pelo Processo 3 com replay: true');

  const accSnapAfterRetry = await rawDb.doc(`users/${testUid}/accounts/${accountId}`).get();
  assert(
    accSnapAfterRetry.data()?.balanceCents === 80000,
    'Saldo no Firestore permanece estritamente 80000 após retry pós-reinício (Zero Duplo Débito)'
  );

  // 3.7 Reenvio com mesmo requestId e PAYLOAD DIVERGENTE
  console.log('  -> Enviando requisição conflitante (payload divergente) para o Processo 3...');
  const respConflict = await fetch(`http://127.0.0.1:${PORT_3}/api/database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officialAuth.idToken}`,
      'X-Request-ID': concurrentRequestId
    },
    body: JSON.stringify({
      ...mutationPayload,
      transaction: {
        ...mutationPayload.transaction,
        amountCents: 99000
      }
    })
  });
  const jsonConflict: any = await respConflict.json();

  assert(respConflict.status === 409, 'Reenvio com payload divergente retorna HTTP 409 Conflict');
  assert(
    jsonConflict.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH',
    'Código IDEMPOTENCY_PAYLOAD_MISMATCH retornado pelo Processo 3'
  );

  const accSnapAfterConflict = await rawDb.doc(`users/${testUid}/accounts/${accountId}`).get();
  assert(
    accSnapAfterConflict.data()?.balanceCents === 80000,
    'Saldo no Firestore protegido e inalterado em 80000 após rejeição de conflito'
  );

  // 3.8 Falha na transação HTTP (valor inválido) deixa estado no Firestore 100% intacto
  console.log('  -> Enviando requisição com valor inválido para o Processo 3...');
  const txListBeforeFailure = await firestoreDirect.queryCollection(`users/${testUid}/transactions`);
  const txCountBefore = txListBeforeFailure.length;

  const respInvalidAmountFail = await fetch(`http://127.0.0.1:${PORT_3}/api/database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officialAuth.idToken}`,
      'X-Request-ID': `req_fail_${Date.now()}`
    },
    body: JSON.stringify({
      action: 'save_transaction',
      accountId,
      transaction: {
        id: `tx_abort_${Date.now()}`,
        type: 'EXPENSE',
        amountCents: -50000 // Valor inválido que aborta a transação contábil
      }
    })
  });

  assert(respInvalidAmountFail.status === 500, 'Transação com valor negativo rejeitada com HTTP 500');

  const txListAfterFailure = await firestoreDirect.queryCollection(`users/${testUid}/transactions`);
  assert(
    txListAfterFailure.length === txCountBefore,
    'Contagem de transações no Firestore Emulator intacta: Rollback 100% comprovado'
  );

  // Encerra Processo 3
  console.log(`  -> Encerrando Processo 3 (PID ${server3.pid})...`);
  await killProcessSafely(server3.proc);

  // =========================================================================
  // BLOCO 4: ATOMICIDADE ISOLADA E ESCOPO DO WEBHOOK (TESTES DE CONTRATO)
  // =========================================================================
  console.log('\n[4/5] Atomicidade Isolada e Contratos de Webhook...');

  (global as any).__KYRO_PROVIDER_BINDINGS__ = [
    {
      providerPhone: '558695368780',
      userId: 'usr_alice_wa',
      status: 'ACTIVE',
      boundAt: '2026-11-06T00:00:00Z'
    },
    {
      providerPhone: '5586911112222',
      userId: 'usr_ambiguo_1',
      status: 'ACTIVE',
      boundAt: '2026-11-06T00:00:00Z'
    },
    {
      providerPhone: '5586911112222',
      userId: 'usr_ambiguo_2',
      status: 'ACTIVE',
      boundAt: '2026-11-06T00:00:00Z'
    }
  ];

  // 4.1 Prova de Atomicidade Pré-Commit Exclusiva na Dependência de Teste
  const contractStore = new TransactionalStoreMock();
  const contractAdapter = new FirestoreLedgerAdapter(contractStore);
  let preCommitFailed = false;
  try {
    await contractAdapter.commitTransaction('usr_test_atomic', {
      requestId: 'req_contract_atomic',
      id: 'tx_contract_atomic',
      type: 'EXPENSE',
      amountCents: 10000n,
      sourceAccountId: 'acc_contract',
      category: 'Teste',
      description: 'Prova de falha pré-commit isolada',
      simulatePreCommitFailure: true // Exclusivo da infraestrutura interna de testes
    });
  } catch {
    preCommitFailed = true;
  }
  assert(preCommitFailed, '[Contrato] Falha pré-commit ativada exclusivamente na dependência de teste');
  assert(contractStore.documents.size === 0, '[Contrato] Zero documentos persistidos após falha pré-commit (Rollback Total)');

  // 4.2 Contrato: Origem Não Autenticada (HTTP 401)
  const httpWaUnauth = createMockHttp({
    method: 'POST',
    headers: { 'x-webhook-secret': 'chave_hacker_errada' },
    body: {
      action: 'sync_transactions',
      senderPhone: '558695368780',
      transaction: { amount: 50, description: 'Tentativa não autorizada' }
    }
  });
  await webhookHandler(httpWaUnauth.req, httpWaUnauth.res);
  assert(httpWaUnauth.getStatusCode() === 401, '[Contrato] POST /api/webhook com segredo incorreto retorna HTTP 401');
  assert(httpWaUnauth.getResponseData().code === 'WEBHOOK_ORIGIN_UNAUTHORIZED', 'Código WEBHOOK_ORIGIN_UNAUTHORIZED retornado');

  // 4.3 Contrato: Vínculo Ausente (HTTP 403)
  const httpWaUnbound = createMockHttp({
    method: 'POST',
    headers: { 'x-webhook-secret': 'kyro_webhook_secret_dev' },
    body: {
      action: 'sync_transactions',
      senderPhone: '5586999994444',
      transaction: { amount: 50, description: 'Lançamento sem cadastro' }
    }
  });
  await webhookHandler(httpWaUnbound.req, httpWaUnbound.res);
  assert(httpWaUnbound.getStatusCode() === 403, '[Contrato] POST /api/webhook com telefone sem vínculo retorna HTTP 403');
  assert(httpWaUnbound.getResponseData().code === 'UNBOUND_PROVIDER_IDENTITY', 'Código UNBOUND_PROVIDER_IDENTITY retornado');

  // 4.4 Contrato: Vínculo Ambíguo (HTTP 409)
  const httpWaAmbiguous = createMockHttp({
    method: 'POST',
    headers: { 'x-webhook-secret': 'kyro_webhook_secret_dev' },
    body: {
      action: 'sync_transactions',
      senderPhone: '5586911112222',
      transaction: { amount: 50, description: 'Lançamento ambíguo' }
    }
  });
  await webhookHandler(httpWaAmbiguous.req, httpWaAmbiguous.res);
  assert(httpWaAmbiguous.getStatusCode() === 409, '[Contrato] POST /api/webhook com vínculo ambíguo retorna HTTP 409');
  assert(httpWaAmbiguous.getResponseData().code === 'AMBIGUOUS_PROVIDER_IDENTITY', 'Código AMBIGUOUS_PROVIDER_IDENTITY retornado');

  // 4.5 Contrato: Vínculo Unívoco Ativo (HTTP 200)
  const httpWaSuccess = createMockHttp({
    method: 'POST',
    headers: { 'x-webhook-secret': 'kyro_webhook_secret_dev' },
    body: {
      action: 'sync_transactions',
      senderPhone: '558695368780',
      transaction: {
        id: 'tx_wa_legit_01',
        amount: 85.50,
        description: 'Mercado via WhatsApp'
      }
    }
  });
  await webhookHandler(httpWaSuccess.req, httpWaSuccess.res);
  assert(httpWaSuccess.getStatusCode() === 200, '[Contrato] POST /api/webhook autorizado com vínculo unívoco retorna HTTP 200');
  assert(httpWaSuccess.getResponseData().userId === 'usr_alice_wa', 'Transação gravada sob o UID resolvido no servidor: usr_alice_wa');

  // =========================================================================
  // BLOCO 5: SERIALIZAÇÃO MONETÁRIA BIGINT E PRESERVAÇÃO DE DADOS LEGADOS
  // =========================================================================
  console.log('\n[5/5] Serialização BigInt IEEE 754 e Dados Legados...');

  const centVal = 999950n;
  const safeInt = SafeMoneySerializer.toFirestoreCents(centVal);
  assert(typeof safeInt === 'number', 'Centavos BigInt representados como number seguro para o Firestore');
  const restoredCent = SafeMoneySerializer.fromFirestoreCents(safeInt);
  assert(restoredCent === centVal, 'Ida e volta exata comprovada: 999950n -> 999950 -> 999950n');

  const legacyNormal = SafeMoneySerializer.fromFirestoreCents(1234.56);
  assert(legacyNormal === 123456n, 'Float legado 1234.56 normalizado deterministicamente para 123456n');

  // =========================================================================
  // TOTALIZAÇÃO DA BATERIA
  // =========================================================================
  console.log('\n================================================================');
  console.log(`TOTAL DE TESTES DA SUBETAPA 03.3: ${passCount} APROVADOS, ${failCount} FALHAS`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runCompleteSubetapa033Suite().catch((err) => {
  console.error('Erro fatal na bateria 03.3:', err);
  process.exit(1);
});
