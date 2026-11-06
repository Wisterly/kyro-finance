/**
 * KYRO FINANCE | BATERIA DE HOMOLOGAÇÃO E PROVA DE COMPORTAMENTO: SUBETAPA 03.3
 * 
 * Demonstração dos 6 Cenários Oficiais nos Emuladores/Ambiente Isolado:
 * 1. Gravação autorizada (sucesso, persistência, débito de saldo, recibo no mesmo commit).
 * 2. Credencial inválida (rejeição com 401).
 * 3. Tentativa de escrita em outro UID (Cross-tenant bloqueado com 403).
 * 4. Repetição concorrente (idempotência atômica sob concorrência).
 * 5. Perda de confirmação seguida de retry (mesmo payload = replay; payload divergente = conflito 409).
 * 6. Falha antes do commit (rollback atômico garantido).
 * + Comprovação da ida e volta de centavos BigInt no Firestore.
 * + Fronteira de autorização do Webhook (distinção entre provedor e usuário, rejeição de ausente/ambíguo).
 * + Preservação da leitura de dados legados em float.
 */

import { SafeMoneySerializer, SafeMoneyError } from '../services/SafeMoneySerializer';
import { 
  verifyAuthToken, 
  enforceTenantBoundary, 
  validateWebhookOrigin, 
  resolveProviderBinding,
  ProviderBinding,
  CrossTenantViolationError 
} from '../services/authBoundary';
import { FirestoreLedgerAdapter, IdempotencyConflictError } from '../services/firestoreAdapter';
import { TransactionalStoreMock } from '../services/storeClient';
import handler, { getSecureStore, getLedgerAdapter } from '../../api/database';

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

// Mock simples para simular VercelRequest e VercelResponse
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

async function runSubetapa033Suite() {
  console.log('\n=== INICIANDO BATERIA DE HOMOLOGAÇÃO DA SUBETAPA 03.3 ===\n');

  // =========================================================================
  // BLOCO 1: SERIALIZADOR MONETÁRIO SEGURO E IDA E VOLTA DE BIGINT NO FIRESTORE
  // =========================================================================
  console.log('[1/4] Comprovação de Serialização BigInt <-> Firestore Safe Integer...');

  const originalCents = 15450n; // R$ 154,50
  const firestoreNum = SafeMoneySerializer.toFirestoreCents(originalCents);
  assert(typeof firestoreNum === 'number', 'Centavos BigInt convertidos para Number aceito pelo Firestore');
  assert(firestoreNum === 15450, 'Valor numérico exato preservado: 15450');

  const roundTripCents = SafeMoneySerializer.fromFirestoreCents(firestoreNum);
  assert(typeof roundTripCents === 'bigint', 'Leitura do Firestore retorna tipo BigInt estrito');
  assert(roundTripCents === originalCents, 'Ida e volta exata comprovada: 15450n -> 15450 -> 15450n');

  // Teste de Limites Máximos Seguros (Number.MAX_SAFE_INTEGER = 9.007.199.254.740.991)
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const maxNum = SafeMoneySerializer.toFirestoreCents(maxSafe);
  const roundTripMax = SafeMoneySerializer.fromFirestoreCents(maxNum);
  assert(roundTripMax === maxSafe, 'Limite máximo IEEE 754 (R$ 90 Trilhões) preservado com exatidão');

  // Rejeição de Overflow
  let threwOverflow = false;
  try {
    SafeMoneySerializer.toFirestoreCents(maxSafe + 1n);
  } catch (e) {
    if (e instanceof SafeMoneyError) threwOverflow = true;
  }
  assert(threwOverflow, 'Valores acima do limite seguro de 53 bits são terminantemente rejeitados');

  // Normalização de Float Legado (ex: 150.50 salvo no banco antigo)
  const legacyFloat = 150.50;
  const legacyCents = SafeMoneySerializer.fromFirestoreCents(legacyFloat);
  assert(legacyCents === 15050n, 'Float legado 150.50 normalizado com exatidão para 15050n sem erro de arredondamento');

  // =========================================================================
  // BLOCO 2: TESTES DE FRONTEIRA DE AUTORIZAÇÃO E ENCAPSULAMENTO DE API/DATABASE
  // =========================================================================
  console.log('\n[2/4] Teste da Rota nos Emuladores / Ambiente Isolado (6 Cenários Obrigatórios)...');

  const store = getSecureStore();
  store.clear();
  const adapter = getLedgerAdapter();

  // Inicializa conta de demonstração
  await adapter.seedAccount({
    id: 'acc_demo',
    userId: 'usr_alice',
    name: 'Conta Corrente Alice',
    balanceCents: 50000, // R$ 500,00
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  });

  // CENÁRIO 1: GRAVAÇÃO AUTORIZADA
  console.log('\n--- Cenário 1: Gravação Autorizada ---');
  const http1 = createMockHttp({
    method: 'POST',
    headers: {
      authorization: 'Bearer demo-token:usr_alice',
      'x-request-id': 'req_auth_01'
    },
    body: {
      action: 'save_transaction',
      accountId: 'acc_demo',
      transaction: {
        id: 'tx_auth_01',
        type: 'EXPENSE',
        amountCents: 15000, // R$ 150,00
        category: 'Alimentação',
        description: 'Almoço Executivo'
      }
    }
  });

  await handler(http1.req, http1.res);
  assert(http1.getStatusCode() === 200, 'Gravação autorizada retorna HTTP 200');
  const res1 = http1.getResponseData();
  assert(res1.success === true, 'Payload indica sucesso');
  assert(res1.receipt?.status === 'APPLIED', 'Recibo de mutação emitido com status APPLIED');
  assert(res1.userId === 'usr_alice', 'Recurso gravado sob o UID derivado do token');

  // Comprovação do estado persistido
  const savedTx = await store.getDocument('users/usr_alice/transactions/tx_auth_01');
  assert(savedTx !== null && savedTx.amountCents === 15000, 'Transação persistida no Firestore com amountCents = 15000');
  
  const savedAccount = await store.getDocument('users/usr_alice/accounts/acc_demo');
  assert(savedAccount.balanceCents === 35000, 'Saldo da conta debitado exatamente de 50000 para 35000 (R$ 350,00)');

  const savedReceipt = await store.getDocument('users/usr_alice/idempotency/req_auth_01');
  assert(savedReceipt !== null && savedReceipt.status === 'APPLIED', 'Recibo de idempotência gravado no mesmo commit atômico');

  // CENÁRIO 2: CREDENCIAL INVÁLIDA
  console.log('\n--- Cenário 2: Credencial Inválida ---');
  const http2 = createMockHttp({
    method: 'POST',
    headers: {
      authorization: 'Bearer token_invalido_expirado',
      'x-request-id': 'req_auth_02'
    },
    body: {
      action: 'save_transaction',
      accountId: 'acc_demo',
      transaction: { id: 'tx_invalid', amountCents: 10000 }
    }
  });

  await handler(http2.req, http2.res);
  assert(http2.getStatusCode() === 401, 'Credencial inválida rejeitada com HTTP 401');
  assert(http2.getResponseData().code === 'UNAUTHORIZED_INVALID_CREDENTIAL', 'Código UNAUTHORIZED_INVALID_CREDENTIAL retornado');

  const unauthDoc = await store.getDocument('users/usr_alice/transactions/tx_invalid');
  assert(unauthDoc === null, 'Nenhuma transação foi gravada sob credencial inválida');

  // CENÁRIO 3: TENTATIVA DE ESCRITA EM OUTRO UID (CROSS-TENANT)
  console.log('\n--- Cenário 3: Tentativa de Escrita em Outro UID (Cross-Tenant) ---');
  // Inicializa conta de Bob
  await adapter.seedAccount({
    id: 'acc_demo_bob',
    userId: 'usr_bob',
    name: 'Conta Corrente Bob',
    balanceCents: 100000, // R$ 1.000,00
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  });

  const http3 = createMockHttp({
    method: 'POST',
    headers: {
      // Token é de Alice
      authorization: 'Bearer demo-token:usr_alice',
      'x-request-id': 'req_cross_tenant_01'
    },
    body: {
      // Corpo tenta alterar conta de Bob
      userId: 'usr_bob',
      action: 'save_transaction',
      accountId: 'acc_demo_bob',
      transaction: {
        id: 'tx_hacker_bob',
        type: 'EXPENSE',
        amountCents: 90000,
        description: 'Transferência ilegítima'
      }
    }
  });

  await handler(http3.req, http3.res);
  assert(http3.getStatusCode() === 403, 'Tentativa de escrita cross-tenant bloqueada com HTTP 403');
  assert(http3.getResponseData().code === 'PERMISSION_DENIED_CROSS_TENANT', 'Código PERMISSION_DENIED_CROSS_TENANT retornado');

  // Comprova que Bob não foi afetado
  const bobTx = await store.getDocument('users/usr_bob/transactions/tx_hacker_bob');
  assert(bobTx === null, 'Transação não autorizada NÃO existe na conta de Bob');
  const bobAccount = await store.getDocument('users/usr_bob/accounts/acc_demo_bob');
  assert(bobAccount.balanceCents === 100000, 'Saldo da conta de Bob permaneceu 100% inalterado em 100000 centavos');

  // CENÁRIO 4: REPETIÇÃO CONCORRENTE
  console.log('\n--- Cenário 4: Repetição Concorrente ---');
  const concurrentReqId = 'req_concurrent_99';
  const makeConcurrentCall = () => adapter.commitTransaction('usr_alice', {
    requestId: concurrentReqId,
    id: 'tx_concurrent_01',
    type: 'EXPENSE',
    amountCents: 5000n, // R$ 50,00
    sourceAccountId: 'acc_demo',
    category: 'Transporte',
    description: 'Uber Concorrente'
  });

  // Disparo simultâneo
  const [resA, resB] = await Promise.all([makeConcurrentCall(), makeConcurrentCall()]);
  assert(resA.status === 'APPLIED' || resB.status === 'APPLIED', 'Ao menos uma requisição executou a mutação contábil');
  assert(resA.replay === true || resB.replay === true, 'A requisição duplicada concorrente recebeu replay: true');

  const accAfterConcurrent = await adapter.getAccount('usr_alice', 'acc_demo');
  assert(accAfterConcurrent?.balanceCents === 30000, 'Saldo debitado exatamente uma única vez (35000 -> 30000), sem duplo débito');

  // CENÁRIO 5: PERDA DE CONFIRMAÇÃO SEGUIDA DE RETRY (MESMO PAYLOAD VS DIVERGENTE)
  console.log('\n--- Cenário 5: Perda de Confirmação e Retry (Mesmo Conteúdo vs Conflito) ---');
  // 5a: Retry com o mesmo conteúdo
  const retrySameResult = await adapter.commitTransaction('usr_alice', {
    requestId: 'req_concurrent_99',
    id: 'tx_concurrent_01',
    type: 'EXPENSE',
    amountCents: 5000n,
    sourceAccountId: 'acc_demo',
    category: 'Transporte',
    description: 'Uber Concorrente'
  });
  assert(retrySameResult.replay === true, 'Retry com mesmo requestId e mesmo conteúdo retorna recibo anterior com replay: true');
  const accAfterSame = await adapter.getAccount('usr_alice', 'acc_demo');
  assert(accAfterSame?.balanceCents === 30000, 'Saldo permanece rigorosamente inalterado');

  // 5b: Retry com payload divergente (tentativa de alteração com mesmo requestId)
  let threwConflict = false;
  try {
    await adapter.commitTransaction('usr_alice', {
      requestId: 'req_concurrent_99',
      id: 'tx_concurrent_01',
      type: 'EXPENSE',
      amountCents: 10000n, // VALOR DIVERGENTE: 10000 em vez de 5000
      sourceAccountId: 'acc_demo',
      category: 'Transporte',
      description: 'Uber Concorrente Modificado'
    });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) threwConflict = true;
  }
  assert(threwConflict, 'Retry com payload divergente retorna CONFLITO (IdempotencyConflictError) sem reaplicar efeitos');

  // CENÁRIO 6: FALHA ANTES DO COMMIT (ROLLBACK ATÔMICO)
  console.log('\n--- Cenário 6: Falha Antes do Commit (Rollback Atômico) ---');
  const initialDocsCount = store.documents.size;
  let threwPreCommit = false;
  try {
    await adapter.commitTransaction('usr_alice', {
      requestId: 'req_fail_before_commit',
      id: 'tx_should_abort',
      type: 'EXPENSE',
      amountCents: 1000n,
      sourceAccountId: 'acc_inexistente_que_vai_falhar', // Provoca erro durante a transação
      category: 'Falha',
      description: 'Esta transação deve abortar'
    });
  } catch (err) {
    threwPreCommit = true;
  }
  assert(threwPreCommit, 'Exceção disparada antes do commit da transação');
  assert(store.documents.size === initialDocsCount, 'Nenhum documento residual gravado: Rollback 100% garantido');
  assert(!store.documents.has('users/usr_alice/transactions/tx_should_abort'), 'Documento da transação não existe no store');
  assert(!store.documents.has('users/usr_alice/idempotency/req_fail_before_commit'), 'Recibo de idempotência não foi comitado');

  // =========================================================================
  // BLOCO 3: FRONTEIRA DE AUTORIZAÇÃO DO WEBHOOK (PROVEDOR VS USUÁRIO)
  // =========================================================================
  console.log('\n[3/4] Fronteira de Autorização do Webhook (Baileys / Evolution)...');

  // 3.1 Validação de Origem do Webhook
  const validSecretHeader = { 'x-webhook-secret': 'kyro_webhook_secret_dev' };
  const invalidSecretHeader = { 'x-webhook-secret': 'chave_falsa_hacker' };
  assert(validateWebhookOrigin(validSecretHeader), 'Origem com segredo correto é validada com sucesso');
  assert(!validateWebhookOrigin(invalidSecretHeader), 'Origem com segredo falso é sumariamente rejeitada');

  // Tabela de Vínculos de Provedores
  const bindings: ProviderBinding[] = [
    {
      providerPhone: '558695368780',
      userId: 'usr_alice',
      status: 'ACTIVE',
      boundAt: '2026-11-06T00:00:00Z'
    },
    {
      providerPhone: '5586988887777',
      userId: 'usr_carlos_1',
      status: 'ACTIVE',
      boundAt: '2026-11-06T00:00:00Z'
    },
    {
      providerPhone: '5586988887777', // Telefone repetido para outro UID (Ambiguidade)
      userId: 'usr_carlos_2',
      status: 'ACTIVE',
      boundAt: '2026-11-06T00:00:00Z'
    }
  ];

  // 3.2 Vínculo Unívoco Resolvido
  const resResolved = resolveProviderBinding(bindings, '558695368780');
  assert(resResolved.status === 'RESOLVED', 'Vínculo unívoco ativo resolvido com sucesso');
  assert(resResolved.userId === 'usr_alice', 'Identidade do usuário resolvida no servidor como usr_alice');

  // 3.3 Vínculo Ausente
  const resUnbound = resolveProviderBinding(bindings, '5586999990000');
  assert(resUnbound.status === 'UNBOUND', 'Telefone desconhecido rejeitado com status UNBOUND');

  // 3.4 Vínculo Ambíguo
  const resAmbiguous = resolveProviderBinding(bindings, '5586988887777');
  assert(resAmbiguous.status === 'AMBIGUOUS', 'Telefone mapeado para múltiplos UIDs bloqueado com status AMBIGUOUS');

  // =========================================================================
  // BLOCO 4: PRESERVAÇÃO DE DADOS LEGADOS EM FLOAT
  // =========================================================================
  console.log('\n[4/4] Preservação de Leitura de Dados Legados em Float...');

  // Simula documentos legados salvos no modelo antigo
  store.documents.set('users/usr_legacy/transactions/tx_old_float_01', {
    id: 'tx_old_float_01',
    userId: 'usr_legacy',
    amount: 320.50, // Float legado em Reais
    category: 'Mercado',
    description: 'Compras Antigas'
  });

  store.documents.set('users/usr_legacy/transactions/tx_modern_01', {
    id: 'tx_modern_01',
    userId: 'usr_legacy',
    amountCents: 45000, // Inteiro centavos novo
    category: 'Salário',
    description: 'Adiantamento'
  });

  const legacyList = await adapter.listUserTransactions('usr_legacy');
  assert(legacyList.length === 2, 'Recuperadas as 2 transações do usuário');

  const oldItem = legacyList.find(t => t.id === 'tx_old_float_01');
  assert(oldItem !== undefined && oldItem.amountCents === 32050n, 'Transação legada float 320.50 normalizada para 32050n com exatidão');

  const modernItem = legacyList.find(t => t.id === 'tx_modern_01');
  assert(modernItem !== undefined && modernItem.amountCents === 45000n, 'Transação moderna em centavos 45000n recuperada perfeitamente');

  // =========================================================================
  // TOTALIZAÇÃO
  // =========================================================================
  console.log('\n================================================================');
  console.log(`TOTAL DE TESTES DA SUBETAPA 03.3: ${passCount} APROVADOS, ${failCount} FALHAS`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runSubetapa033Suite().catch((err) => {
  console.error('Erro fatal na execução da suite 03.3:', err);
  process.exit(1);
});
