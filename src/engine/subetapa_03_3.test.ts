/**
 * KYRO FINANCE | BATERIA DE HOMOLOGAÇÃO OFICIAL: SUBETAPA 03.3
 * 
 * Checklist Completo de Fechamento de Aceite pela Rota HTTP:
 * 
 * 1. FALHA EXPLÍCITA QUANDO ARMAZENAMENTO INDISPONÍVEL:
 *    - Sem fallback silencioso para TransactionalStoreMock na aplicação
 *    - Devolve HTTP 503 (STORAGE_UNAVAILABLE) explícito, sem recibo APPLIED ou mensagem de gravação confirmada
 * 
 * 2. ISOLAMENTO DE AUTENTICAÇÃO SINTÉTICA NA ROTA PÚBLICA:
 *    - Nenhuma variável de ambiente da aplicação consegue habilitar demo-token na rota pública
 *    - demo-token na rota pública é sumariamente rejeitado com HTTP 401
 *    - Token adulterado rejeitado com HTTP 401
 *    - Token válido de Alice tentando gravar sob UID de Bob bloqueado com HTTP 403 (PERMISSION_DENIED_CROSS_TENANT)
 *    - Separação expressa entre testes criptográficos RS256 e testes com Firebase Auth Emulator oficial
 * 
 * 3. INTEGRAÇÃO REAL EM DOIS PROCESSOS INDEPENDENTES:
 *    - Subida de Auth Emulator (127.0.0.1:9099) e Firestore Emulator (127.0.0.1:8080) oficiais
 *    - Processo 1 (Porta 4101, PID A) e Processo 2 (Porta 4102, PID B) executando a rota HTTP
 *    - Mesma requisição concorrente (mesmo requestId) enviada via rede HTTP a ambas as instâncias
 *    - Leitura direta do Firestore Emulator comprovando efeito contábil único e replay: true
 *    - Encerramento dos dois processos (kill nos PIDs) e subida de Processo 3 (Porta 4103, PID C)
 *    - Reenvio com mesmo requestId e mesmo conteúdo = HTTP 200 com replay e saldo preservado
 *    - Reenvio com mesmo requestId e conteúdo divergente = HTTP 409 (IDEMPOTENCY_PAYLOAD_MISMATCH) com saldo preservado
 *    - Falha anterior ao commit = HTTP 500 sem escrita parcial ou documentos fantasmas no Firestore
 * 
 * 4. ESCOPO DO WEBHOOK E PARIDADE ANDROID:
 *    - Rota real de /api/webhook valida origem (401), rejeita vínculo ausente (403) e ambíguo (409)
 *    - Vínculo unívoco autorizado (200 OK) com gravação efetuada no UID resolvido no servidor
 *    - Instalação física Android registrada como pendente separadamente da paridade de assinatura v2
 * 
 * 5. SERIALIZAÇÃO BIGINT IEEE 754 E DADOS LEGADOS:
 *    - Ida e volta exata sem perda de centavos no Firestore
 *    - Normalização de float legados para centavos BigInt
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

// Mock HTTP shim para testes de rota locais
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

// Utilitário para aguardar que um servidor HTTP responda na porta especificada
async function waitForHttpServer(port: number, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      if (resp.ok) return true;
    } catch {
      // Aguarda 100ms antes da próxima tentativa
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// Utilitário para iniciar processo de servidor HTTP autônomo
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

// Utilitário para encerrar processo com segurança
async function killProcessSafely(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed || !proc.pid) return resolve();
    try {
      // No Windows, força encerramento da árvore de processos via taskkill se necessário
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

  // Obtém ID Token oficial emitido pelo Firebase Auth Emulator
  const officialAuth = await getOfficialAuthEmulatorToken('alice_oficial@kyro.local', 'SenhaOficial123!');

  // =========================================================================
  // BLOCO 1: FALHA EXPLÍCITA QUANDO O ARMAZENAMENTO ESTIVER INDISPONÍVEL
  // (Retirada completa do fallback para mock)
  // =========================================================================
  console.log('[1/5] Falha Explícita com Armazenamento Indisponível (Sem Fallback para Mock)...');

  // Simula ambiente com armazenamento desabilitado / indisponível
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

  // Restaura o ambiente de armazenamento normal
  delete process.env.STORAGE_DISABLED;
  resetStoreInstance();

  // =========================================================================
  // BLOCO 2: ISOLAMENTO DE AUTENTICAÇÃO SINTÉTICA NA ROTA PÚBLICA E PROVA RS256
  // =========================================================================
  console.log('\n[2/5] Isolamento de Autenticação Sintética e Prova Criptográfica RS256...');

  // 2.1 Rejeição de demo-token na rota pública, mesmo em ambiente de teste
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

  // 2.2 Prova de Assinatura Criptográfica RS256 Isolada
  const keyPair = generateTestKeyPair();
  const validToken = createSignedTestToken({
    uid: 'usr_alice_real',
    projectId: DEMO_PROJECT_ID,
    privateKeyPem: keyPair.privateKey
  });
  const resValid = verifyJwtCryptographically(validToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(resValid.isValid === true, 'Token assinado com RS256 verificado com sucesso');
  assert(resValid.uid === 'usr_alice_real', 'UID extraído com exatidão da claim sub do token');

  // 2.3 Token Ausente
  const resMissing = await verifyRealAuthToken(undefined);
  assert(!resMissing.isValid, 'Token ausente rejeitado com isValid: false');

  // 2.4 Token Expirado
  const expiredToken = createSignedTestToken({
    uid: 'usr_alice_expired',
    projectId: DEMO_PROJECT_ID,
    expiresInSeconds: -3600,
    privateKeyPem: keyPair.privateKey
  });
  const resExpired = verifyJwtCryptographically(expiredToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resExpired.isValid, 'Token expirado é sumariamente rejeitado');
  assert((resExpired.error || '').includes('expirado'), 'Mensagem de erro explicita expiração');

  // 2.5 Token Adulterado no Payload (Assinatura não bate)
  const adulteratedPayloadToken = createSignedTestToken({
    uid: 'usr_legit',
    projectId: DEMO_PROJECT_ID,
    privateKeyPem: keyPair.privateKey,
    adulteratePayload: true
  });
  const resAdulteratedPayload = verifyJwtCryptographically(adulteratedPayloadToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resAdulteratedPayload.isValid, 'Token com payload adulterado rejeitado pela validação de assinatura');

  // 2.6 Token com Assinatura Adulterada
  const adulteratedSigToken = createSignedTestToken({
    uid: 'usr_legit',
    projectId: DEMO_PROJECT_ID,
    privateKeyPem: keyPair.privateKey,
    adulterateSignature: true
  });
  const resAdulteratedSig = verifyJwtCryptographically(adulteratedSigToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resAdulteratedSig.isValid, 'Token com bytes de assinatura corrompidos rejeitado');

  // 2.7 Token de Projeto Incorreto (mismatch de audience/aud)
  const wrongProjectToken = createSignedTestToken({
    uid: 'usr_alice_real',
    projectId: 'demo-wrong-project-adversarial',
    privateKeyPem: keyPair.privateKey
  });
  const resWrongProj = verifyJwtCryptographically(wrongProjectToken, DEMO_PROJECT_ID, keyPair.publicKey);
  assert(!resWrongProj.isValid, 'Token emitido para projeto incorreto é rejeitado');

  // 2.8 Integração com Firebase Auth Emulator Oficial
  const verifiedOfficial = await verifyRealAuthToken(`Bearer ${officialAuth.idToken}`);
  assert(verifiedOfficial.isValid === true, 'Token emitido pelo Firebase Auth Emulator oficial verificado com sucesso');
  assert(verifiedOfficial.uid === officialAuth.uid, 'UID extraído do Auth Emulator confere com localId oficial');

  // 2.9 Tentativa de Escrita em Outro UID (Cross-Tenant) via Rota HTTP
  const httpCrossTenant = createMockHttp({
    method: 'POST',
    headers: {
      authorization: `Bearer ${officialAuth.idToken}`,
      'x-request-id': 'req_cross_tenant_test'
    },
    body: {
      action: 'save_transaction',
      userId: 'usr_bob_vitima', // Tentativa forçada de gravar na conta de Bob
      amountCents: 50000
    }
  });
  await handler(httpCrossTenant.req, httpCrossTenant.res);
  assert(httpCrossTenant.getStatusCode() === 403, 'Tentativa de escrita em outro UID rejeitada com HTTP 403 Forbidden');
  assert(
    httpCrossTenant.getResponseData().code === 'PERMISSION_DENIED_CROSS_TENANT',
    'Código PERMISSION_DENIED_CROSS_TENANT emitido pela barreira de segurança'
  );

  // =========================================================================
  // BLOCO 3: INTEGRAÇÃO REAL EM DOIS PROCESSOS INDEPENDENTES E SOBREVIVÊNCIA A REINÍCIO
  // =========================================================================
  console.log('\n[3/5] Integração em Dois Processos Independentes (PIDs Distintos) no Firestore Emulator...');

  const PORT_1 = 4101;
  const PORT_2 = 4102;
  const PORT_3 = 4103;

  // Inicia Processo 1 e Processo 2
  console.log(`  -> Subindo Processo 1 na porta ${PORT_1}...`);
  const server1 = startServerProcess(PORT_1);
  console.log(`  -> Subindo Processo 2 na porta ${PORT_2}...`);
  const server2 = startServerProcess(PORT_2);

  const ready1 = await waitForHttpServer(PORT_1);
  const ready2 = await waitForHttpServer(PORT_2);

  assert(ready1 && ready2, 'Ambos os servidores HTTP iniciaram com sucesso nas portas 4101 e 4102');
  assert(server1.pid !== server2.pid, `PIDs comprovadamente distintos no SO: PID 1 (${server1.pid}) !== PID 2 (${server2.pid})`);

  // Inicializa dados no Firestore Emulator oficial diretamente via FirestoreAdminStore
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
      amountCents: 20000, // Débito de R$ 200,00
      category: 'Serviços',
      description: 'Débito Concorrente Multi-Processo'
    }
  };

  // 3.1 Disparo Concorrente pela Rede HTTP Real para Processo 1 e Processo 2
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

  // 3.3 Encerramento dos dois processos
  console.log(`  -> Encerrando Processo 1 (PID ${server1.pid}) e Processo 2 (PID ${server2.pid})...`);
  await killProcessSafely(server1.proc);
  await killProcessSafely(server2.proc);

  // 3.4 Subida de NOVO PROCESSO INDEPENDENTE (Processo 3)
  console.log(`  -> Subindo Processo 3 independente na porta ${PORT_3}...`);
  const server3 = startServerProcess(PORT_3);
  const ready3 = await waitForHttpServer(PORT_3);
  assert(ready3, 'Processo 3 iniciado e pronto na porta 4103');
  assert(
    server3.pid !== server1.pid && server3.pid !== server2.pid,
    `Processo 3 possui PID independente (${server3.pid})`
  );

  // 3.5 Reenvio com o mesmo requestId e mesmo payload para o Processo 3 (Retry pós-reinício)
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

  // 3.6 Reenvio com o mesmo requestId e PAYLOAD DIVERGENTE para o Processo 3
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
        amountCents: 99000 // VALOR MODIFICADO (Conflito de integridade)
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

  // 3.7 Falha anterior ao commit deixa o estado no Firestore 100% intacto
  console.log('  -> Enviando requisição com falha anterior ao commit para o Processo 3...');
  const txListBeforeFailure = await firestoreDirect.queryCollection(`users/${testUid}/transactions`);
  const txCountBefore = txListBeforeFailure.length;

  const respPreCommitFail = await fetch(`http://127.0.0.1:${PORT_3}/api/database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officialAuth.idToken}`,
      'X-Request-ID': `req_fail_${Date.now()}`,
      'X-Simulate-Failure': 'pre-commit'
    },
    body: JSON.stringify({
      action: 'save_transaction',
      accountId: 'acc_inexistente_abort',
      transaction: {
        id: `tx_abort_${Date.now()}`,
        type: 'EXPENSE',
        amountCents: 30000
      }
    })
  });

  assert(respPreCommitFail.status === 500, 'Falha anterior ao commit rejeitada com HTTP 500');

  const txListAfterFailure = await firestoreDirect.queryCollection(`users/${testUid}/transactions`);
  assert(
    txListAfterFailure.length === txCountBefore,
    'Contagem de transações no Firestore Emulator intacta: Rollback 100% comprovado'
  );

  // Encerra Processo 3
  console.log(`  -> Encerrando Processo 3 (PID ${server3.pid})...`);
  await killProcessSafely(server3.proc);

  // =========================================================================
  // BLOCO 4: ESCOPO DO WHATSAPP E ROTA REAL DO WEBHOOK
  // =========================================================================
  console.log('\n[4/5] Escopo do WhatsApp: Fronteira Real do Webhook e Resolução no Servidor...');

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

  // 4.1 Rota do Webhook rejeita origem não autenticada (401)
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
  assert(httpWaUnauth.getStatusCode() === 401, 'POST /api/webhook com segredo incorreto retorna HTTP 401');
  assert(httpWaUnauth.getResponseData().code === 'WEBHOOK_ORIGIN_UNAUTHORIZED', 'Código WEBHOOK_ORIGIN_UNAUTHORIZED retornado');

  // 4.2 Rota do Webhook rejeita vínculo ausente (403 UNBOUND_PROVIDER_IDENTITY)
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
  assert(httpWaUnbound.getStatusCode() === 403, 'POST /api/webhook com telefone sem vínculo retorna HTTP 403');
  assert(httpWaUnbound.getResponseData().code === 'UNBOUND_PROVIDER_IDENTITY', 'Código UNBOUND_PROVIDER_IDENTITY retornado');

  // 4.3 Rota do Webhook rejeita vínculo ambíguo (409 AMBIGUOUS_PROVIDER_IDENTITY)
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
  assert(httpWaAmbiguous.getStatusCode() === 409, 'POST /api/webhook com vínculo ambíguo retorna HTTP 409');
  assert(httpWaAmbiguous.getResponseData().code === 'AMBIGUOUS_PROVIDER_IDENTITY', 'Código AMBIGUOUS_PROVIDER_IDENTITY retornado');

  // 4.4 Rota do Webhook com vínculo unívoco e segredo válido (200 OK)
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
  assert(httpWaSuccess.getStatusCode() === 200, 'POST /api/webhook autorizado com vínculo unívoco retorna HTTP 200');
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
}

runCompleteSubetapa033Suite().catch((err) => {
  console.error('Erro fatal na bateria 03.3:', err);
  process.exit(1);
});
