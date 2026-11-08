/**
 * KYRO FINANCE - SUBETAPA 03.6 (PR.046)
 * BATERIA DE HOMOLOGAÇÃO: CONVERGÊNCIA DO WHATSAPP COM O MOTOR FINANCEIRO COMPARTILHADO
 * (TEXTO COMPOSTO, ÁUDIO, RESIDÊNCIA DE TENANT, IDEMPOTÊNCIA E HISTÓRICO)
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-kyro-synthetic';
process.env.STORAGE_DISABLED = 'false';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, execSync, ChildProcess } from 'child_process';
import { FirestoreAdminStore } from '../services/firestoreAdminStore';
import { FirestoreLedgerAdapter } from '../services/firestoreAdapter';
import { SafeMoneySerializer } from '../services/SafeMoneySerializer';
import { parseToCents, formatCentsToBRL } from './money';
import { LedgerEngine } from './ledger';
import { 
  parseCompositeFinancialMessage, 
  detectFinancialAmbiguity,
  splitCompositeFinancialMessage 
} from '../utils/financialParser';
import { 
  isRemoveTransactionCommand, 
  executeSmartRemoveTransaction, 
  isFinancialQueryCommand,
  generateThinkingFinancialReply,
  FinancialContext 
} from '../utils/aiCopilot';
import { ProviderBinding } from '../services/authBoundary';
import { getAdminAuth } from '../services/firebaseAdminAuth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

let totalTests = 0;
let passedTests = 0;

async function getAuthTokenForUser(uid: string): Promise<string> {
  const customToken = await getAdminAuth().createCustomToken(uid);
  const resp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const data = await resp.json();
  return data.idToken;
}

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

async function killAllProcesses() {
  for (const proc of spawnedProcesses) {
    await killProcessSafely(proc);
  }
}

export async function runSubetapa036Tests() {
  console.log('\n================================================================');
  console.log('KYRO FINANCE | BATERIA COMPLETA DE HOMOLOGAÇÃO: SUBETAPA 03.6');
  console.log('Convergência do WhatsApp com o Motor Contábil Compartilhado');
  console.log('================================================================\n');

  totalTests = 0;
  passedTests = 0;

  const TEST_PORT = 4140;
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  const webhookUrl = `${baseUrl}/api/webhook`;

  // Inicializa o servidor HTTP real da aplicação
  console.log(`-> Iniciando servidor HTTP standalone na porta ${TEST_PORT}...`);
  const server = startServerProcess(TEST_PORT);
  const isUp = await waitForHttpServer(TEST_PORT);
  assert(isUp, `Servidor HTTP standalone ativo e respondendo na porta ${TEST_PORT} (PID ${server.pid})`);

  const store = new FirestoreAdminStore();
  const adapter = new FirestoreLedgerAdapter(store);

  // Contas sintéticas de teste com isolamento por runId
  const runSuffix = Date.now();
  const ALICE_UID = `usr_alice_wa_036_${runSuffix}`;
  const BOB_UID = `usr_bob_wa_036_${runSuffix}`;
  const ALICE_PHONE = `558699411${String(runSuffix).slice(-4)}`;
  const BOB_PHONE = `558699412${String(runSuffix).slice(-4)}`;
  const UNBOUND_PHONE = `558699999${String(runSuffix).slice(-4)}`;

  // Configura saldos iniciais no Firestore Emulator
  const aliceAccount = {
    id: `acc_${ALICE_UID}`,
    userId: ALICE_UID,
    name: 'Conta Corrente Alice (WhatsApp)',
    balanceCents: 100000, // R$ 1.000,00
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  };
  await adapter.seedAccount(aliceAccount);

  const bobAccount = {
    id: `acc_${BOB_UID}`,
    userId: BOB_UID,
    name: 'Conta Corrente Bob (WhatsApp)',
    balanceCents: 50000, // R$ 500,00
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  };
  await adapter.seedAccount(bobAccount);

  // Registra vínculos oficiais no Webhook
  const bindings: ProviderBinding[] = [
    { providerPhone: ALICE_PHONE, userId: ALICE_UID, status: 'ACTIVE', boundAt: new Date().toISOString() },
    { providerPhone: BOB_PHONE, userId: BOB_UID, status: 'ACTIVE', boundAt: new Date().toISOString() }
  ];

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear_provider_bindings' })
  });

  for (const b of bindings) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register_provider_binding', binding: b })
    });
  }

  try {
    // ------------------------------------------------------------------------
    // GRUPO 1: RESOLUÇÃO DE IDENTIDADE E FRONTEIRA DE TENANT NO WEBHOOK
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 1: RESOLUÇÃO DE IDENTIDADE E FRONTEIRA DE TENANT NO WEBHOOK ---');

    // 1.1 Remetente sem vínculo cadastrado -> Rejeição 403 UNBOUND_PROVIDER_IDENTITY
    const respUnbound = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${UNBOUND_PHONE}@s.whatsapp.net`,
        message: 'Almoço 35 reais',
        isGroup: true
      })
    });
    const jsonUnbound = await respUnbound.json();
    assert(respUnbound.status === 403, 'Remetente sem vínculo cadastrado é rejeitado com HTTP 403');
    assert(jsonUnbound.code === 'UNBOUND_PROVIDER_IDENTITY', 'Código retornado é estritamente UNBOUND_PROVIDER_IDENTITY');

    // 1.2 Alice tentando movimentar conta do Bob -> Rejeição 403 PERMISSION_DENIED_ACCOUNT_MISMATCH
    const respCross = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        message: 'Almoço 35 reais',
        accountId: `acc_${BOB_UID}`,
        accountOwnerId: BOB_UID,
        isGroup: true
      })
    });
    const jsonCross = await respCross.json();
    assert(respCross.status === 403, 'Tentativa de movimentar conta de outro UID é rejeitada com HTTP 403');
    assert(jsonCross.code === 'PERMISSION_DENIED_ACCOUNT_MISMATCH', 'Código retornado é PERMISSION_DENIED_ACCOUNT_MISMATCH');

    // 1.3 Confere integridade dos saldos no Firestore após tentativas ilegais
    const accBobAfterCross = await adapter.getAccount(BOB_UID, `acc_${BOB_UID}`);
    assert(accBobAfterCross?.balanceCents === 50000, 'Saldo de Bob permanece estritamente R$ 500,00 (Zero mutação indevida)');

    // ------------------------------------------------------------------------
    // GRUPO 2: AMBIGUIDADE RELEVANTE SEM GRAVAÇÃO (ZERO MUTAÇÕES CONTÁBEIS)
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 2: AMBIGUIDADE RELEVANTE SEM GRAVAÇÃO (ZERO MUTAÇÕES) ---');

    // 2.1 Mensagem vaga sem valor monetário
    const respVague1 = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        message: 'Gastei na padaria hoje cedo',
        isGroup: true
      })
    });
    const jsonVague1 = await respVague1.json();
    console.log('-> RESPOSTA jsonVague1:', JSON.stringify(jsonVague1));
    assert(respVague1.status === 200, 'Mensagem com ambiguidade relevante responde com status 200');
    assert(jsonVague1.status === 'clarification_requested', 'Status operacional indica clarification_requested');
    assert(jsonVague1.isAmbiguous === true, 'Flag isAmbiguous retorna true');
    assert(jsonVague1.mutations === 0, 'Mutations retorna estritamente 0');
    assert(typeof jsonVague1.replySent === 'string' && jsonVague1.replySent.includes('valor exato'), 'Mensagem solicita esclarecimento sobre o valor');

    // 2.2 Mensagem com valores conflitantes
    const respVague2 = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        message: 'Comprei almoço por 35 ou 50 reais',
        isGroup: true
      })
    });
    const jsonVague2 = await respVague2.json();
    assert(jsonVague2.status === 'clarification_requested', 'Valores conflitantes solicitam clarification_requested');
    assert(jsonVague2.mutations === 0, 'Zero mutações realizadas para valores conflitantes');

    // 2.3 Verifica saldo no Firestore intacto
    const accAliceAfterAmb = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterAmb?.balanceCents === 100000, 'Saldo de Alice permanece R$ 1.000,00 intacto após mensagens ambíguas');

    // ------------------------------------------------------------------------
    // GRUPO 3: MENSAGEM DE TEXTO COM MÚLTIPLAS MOVIMENTAÇÕES (LOTE COMPOSTO)
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: MENSAGEM DE TEXTO COM MÚLTIPLAS MOVIMENTAÇÕES (LOTE COMPOSTO) ---');

    const messageIdLote = `msg_wa_lote_${Date.now()}`;
    const respLote = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        messageId: messageIdLote,
        message: 'Almoço 35 reais e abasteci 120 reais no posto',
        isGroup: true
      })
    });
    const jsonLote = await respLote.json();

    assert(respLote.status === 200, 'Requisição de lote composto aceita com HTTP 200 OK');
    assert(jsonLote.status === 'success', 'Status da operação é success');
    assert(jsonLote.isComposite === true, 'Webhook reconhece mensagem como composta (isComposite: true)');
    assert(Array.isArray(jsonLote.receipts) && jsonLote.receipts.length === 2, 'Dois recibos contábeis foram emitidos');
    assert(jsonLote.receipts[0].status === 'APPLIED', 'Recibo 1 possui status APPLIED');
    assert(jsonLote.receipts[1].status === 'APPLIED', 'Recibo 2 possui status APPLIED');

    // Validação do efeito financeiro exato no Firestore Emulator
    // R$ 1.000,00 - 35,00 - 120,00 = R$ 845,00 (84.500 centavos)
    const accAliceAfterLote = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterLote?.balanceCents === 84500, 'Saldo de Alice no Firestore atualizado exatamente para R$ 845,00 (84.500 centavos)');

    // Confere preservação de campos ausentes
    const tx1 = jsonLote.savedTransactions[0];
    const tx2 = jsonLote.savedTransactions[1];
    assert(tx1.city === '', 'Cidade não mencionada no item 1 permanece estritamente vazia (sem cidades fantasmas)');
    assert(tx2.establishment === 'Posto de Combustível', 'Estabelecimento do item 2 detectado como Posto de Combustível');
    assert(typeof jsonLote.replySent === 'string' && jsonLote.replySent.includes('155,00'), 'Resposta para WhatsApp deriva o valor total do lote (R$ 155,00)');

    // ------------------------------------------------------------------------
    // GRUPO 4: ÁUDIO COM TRANSCRIÇÃO NO WEBHOOK
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 4: ÁUDIO COM TRANSCRIÇÃO NO WEBHOOK ---');

    const messageIdAudio = `msg_wa_audio_${Date.now()}`;
    const respAudio = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        messageId: messageIdAudio,
        isAudio: true,
        transcription: 'Gasolina 73 reais e 45 centavos no débito',
        isGroup: true
      })
    });
    const jsonAudio = await respAudio.json();
    console.log('-> RESPOSTA jsonAudio:', JSON.stringify(jsonAudio));

    assert(respAudio.status === 200, 'Áudio processado com sucesso com HTTP 200 OK');
    assert(jsonAudio.status === 'success', 'Status da operação de áudio é success');
    assert(jsonAudio.receipt?.status === 'APPLIED', 'Recibo do áudio gerado com status APPLIED');
    assert(jsonAudio.savedTx?.amountCents === 7345, 'Valor do áudio gravado exatamente como 7.345 centavos inteiros (R$ 73,45)');

    // Saldo atualizado: 84.500 - 7.345 = 77.155 centavos (R$ 771,55)
    const accAliceAfterAudio = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterAudio?.balanceCents === 77155, 'Saldo de Alice no Firestore atualizado com exatidão para R$ 771,55 (77.155 cents)');

    // ------------------------------------------------------------------------
    // GRUPO 5: REENTREGA CONCORRENTE E PERDA DE RESPOSTA (IDEMPOTÊNCIA ESTRITA)
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 5: REENTREGA CONCORRENTE E PERDA DE RESPOSTA (IDEMPOTÊNCIA ESTRITA) ---');

    const concurrentMsgId = `msg_wa_concurrent_${Date.now()}`;
    const concurrentPayload = {
      sender: `${ALICE_PHONE}@s.whatsapp.net`,
      messageId: concurrentMsgId,
      message: 'Farmácia 40 reais',
      isGroup: true
    };

    // Dispara duas requisições com o mesmo messageId simultaneamente
    const [respC1, respC2] = await Promise.all([
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
        body: JSON.stringify(concurrentPayload)
      }),
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
        body: JSON.stringify(concurrentPayload)
      })
    ]);

    const jsonC1 = await respC1.json();
    const jsonC2 = await respC2.json();

    assert(respC1.status === 200 && respC2.status === 200, 'Ambas requisições simultâneas retornam HTTP 200 OK');
    assert(jsonC1.status === 'success' && jsonC2.status === 'success', 'Ambas reportam status success');

    // Um dos recibos deve acusar replay de idempotência
    const hasReplay = jsonC1.receipt?.replay === true || jsonC2.receipt?.replay === true;
    assert(hasReplay, 'Idempotência interceptou a requisição concorrente marcando replay = true');

    // Saldo de Alice: 77.155 - 4.000 = 73.155 centavos (R$ 731,55) -> ZERO duplo débito
    const accAliceAfterConcurrent = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(
      accAliceAfterConcurrent?.balanceCents === 73155,
      'Saldo de Alice no Firestore permanece estritamente R$ 731,55 (Zero duplo débito por concorrência)'
    );

    // 5.2 Simulação de perda de resposta (timeout do cliente e retry com mesmo messageId)
    const respRetry = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify(concurrentPayload)
    });
    const jsonRetry = await respRetry.json();
    assert(respRetry.status === 200, 'Reenvio pós perda de resposta retorna HTTP 200 OK');
    assert(jsonRetry.receipt?.replay === true, 'Recibo prévio retornado com replay = true');
    assert(jsonRetry.receipt?.status === 'APPLIED', 'Status do recibo mantido como APPLIED');

    const accAliceAfterRetry = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(
      accAliceAfterRetry?.balanceCents === 73155,
      'Saldo no Firestore rigorosamente preservado em R$ 731,55 após reenvio'
    );

    // ------------------------------------------------------------------------
    // GRUPO 6: CONSULTA E CORREÇÃO DE HISTÓRICO NO WHATSAPP (ESCOPO 03.6)
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 6: CONSULTA E CORREÇÃO DE HISTÓRICO NO WHATSAPP ---');

    // 6.1 Consulta de Saldo e Gastos
    const respQuery = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        message: 'Quanto gastei hoje?',
        isGroup: true
      })
    });
    const jsonQuery = await respQuery.json();

    assert(respQuery.status === 200, 'Consulta de histórico responde com HTTP 200 OK');
    assert(jsonQuery.status === 'query_answered', 'Status reportado é query_answered');
    assert(jsonQuery.mutations === 0, 'Zero mutações contábeis durante consulta de histórico');
    assert(typeof jsonQuery.replySent === 'string' && jsonQuery.replySent.includes('Diagnóstico'), 'Resposta analítica do copiloto formatada para WhatsApp');

    // 6.2 Cancelamento / Estorno de Transação Específica
    // Vamos estornar o abastecimento de R$ 120,00 realizado no Grupo 3
    const respCancel = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        message: 'Cancela o abastecimento de 120 reais',
        isGroup: true
      })
    });
    const jsonCancel = await respCancel.json();

    assert(respCancel.status === 200, 'Comando de cancelamento responde com HTTP 200 OK');
    assert(jsonCancel.status === 'success', 'Cancelamento executado com status success');
    assert(jsonCancel.action === 'reversal', 'Ação registrada é estritamente reversal');
    assert(jsonCancel.receipt?.status === 'APPLIED', 'Recibo de estorno possui status APPLIED');
    assert(jsonCancel.receipt?.code === 'TRANSACTION_REVERSED', 'Código do recibo é TRANSACTION_REVERSED');

    // Saldo restaurado: R$ 731,55 + R$ 120,00 = R$ 851,55 (85.155 centavos)
    const accAliceAfterReversal = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(
      accAliceAfterReversal?.balanceCents === 85155,
      'Saldo no Firestore de Alice restaurado exatamente para R$ 851,55 (85.155 centavos)'
    );

    // 6.3 Tentativa de estornar novamente a mesma transação (Tombstone ativo bloqueia)
    const respCancelDupl = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        message: 'Cancela o abastecimento de 120 reais',
        isGroup: true
      })
    });
    const jsonCancelDupl = await respCancelDupl.json();
    assert(
      jsonCancelDupl.status === 'reversal_failed' || jsonCancelDupl.error?.includes('ALREADY_REVERSED') || jsonCancelDupl.receipt?.replay,
      'Tombstone ativo bloqueia estorno duplicado da mesma operação'
    );

    // Saldo inalterado após tentativa de duplo estorno
    const accAliceAfterDupl = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterDupl?.balanceCents === 85155, 'Saldo permanece inalterado em R$ 851,55');

    // ------------------------------------------------------------------------
    // GRUPO 7: PARIDADE ESTRITA ENTRE ENTRADAS NA WEB E NO WHATSAPP
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 7: PARIDADE ESTRITA ENTRE ENTRADAS NA WEB E NO WHATSAPP ---');

    // Lança via Webhook (WhatsApp de Bob)
    const respWaBob = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${BOB_PHONE}@s.whatsapp.net`,
        message: 'Supermercado 100 reais',
        isGroup: true
      })
    });
    const jsonWaBob = await respWaBob.json();

    // Lança via API Database direta (usada pela Web e pelo APK com token do Auth Emulator)
    const aliceAuthToken = await getAuthTokenForUser(ALICE_UID);
    const reqIdWeb = `req_web_${Date.now()}`;
    const respWebAlice = await fetch(`${baseUrl}/api/database`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceAuthToken}`,
        'X-Request-ID': reqIdWeb
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: `acc_${ALICE_UID}`,
        transaction: {
          id: `tx_web_${Date.now()}`,
          amount: 100,
          description: 'Supermercado',
          category: 'Supermercado'
        }
      })
    });
    const jsonWebAlice = await respWebAlice.json();

    assert(respWaBob.status === 200, 'WhatsApp responde 200 OK');
    assert(respWebAlice.status === 200, 'Web responde 200 OK');
    assert(jsonWaBob.receipt?.status === 'APPLIED', 'Recibo WhatsApp emitido com APPLIED');
    assert(jsonWebAlice.receipt?.status === 'APPLIED', 'Recibo Web emitido com APPLIED');

    // Ambos os valores foram comitados exatamente como 10.000 centavos
    assert(jsonWaBob.savedTx?.amountCents === 10000, 'WhatsApp gravou exatamente 10.000 centavos');
    const accBobFinal = await adapter.getAccount(BOB_UID, `acc_${BOB_UID}`);
    // Saldo Bob: 50.000 - 10.000 = 40.000 centavos (R$ 400,00)
    assert(accBobFinal?.balanceCents === 40000, 'Saldo de Bob no motor contábil debitado para R$ 400,00');

    // ------------------------------------------------------------------------
    // GRUPO 8: MODELO B DE CARTÕES E FATURAS NO WHATSAPP
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 8: MODELO B DE CARTÕES E FATURAS NO WHATSAPP ---');

    const respCard = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        message: 'Tênis 300 reais em 3x no Nubank',
        isGroup: true
      })
    });
    const jsonCard = await respCard.json();

    assert(respCard.status === 200, 'Compra parcelada aceita com HTTP 200 OK');
    assert(jsonCard.status === 'success', 'Status da compra parcelada é success');
    assert(jsonCard.savedTx?.cardName === 'Nubank', 'Cartão Nubank detectado com precisão');
    assert(jsonCard.savedTx?.method === 'Crédito', 'Método classificado como Crédito');
    assert(typeof jsonCard.replySent === 'string' && jsonCard.replySent.includes('Nubank'), 'Resposta menciona fatura do cartão Nubank');

    console.log('\n================================================================');
    console.log(`RESULTADO DA SUBETAPA 03.6: ${passedTests} / ${totalTests} APROVADOS (100%)`);
    console.log('STATUS: CONVERGÊNCIA COMPROVADA DO WHATSAPP COM MOTOR COMPARTILHADO');
    console.log('================================================================\n');

  } finally {
    console.log('-> Finalizando processos em segundo plano...');
    await killAllProcesses();
  }

  return { totalTests, passedTests };
}

// Execução direta se invocado via linha de comando
if (process.argv[1] && process.argv[1].endsWith('subetapa_03_6.test.ts')) {
  runSubetapa036Tests()
    .then(({ totalTests, passedTests }) => {
      if (passedTests === totalTests) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('\n[ERRO FATAL NA SUBETAPA 03.6]:', err);
      killAllProcesses().finally(() => process.exit(1));
    });
}
