/**
 * KYRO FINANCE - SUBETAPA 03.6 (PR.047)
 * BATERIA DE HOMOLOGAÇÃO: CONVERGÊNCIA DO WHATSAPP COM O MOTOR FINANCEIRO COMPARTILHADO
 * (PARIDADE NATURAL DOS DOIS CHATS, LOTE ATÔMICO COM ROLLBACK, IMUNIDADE DO PAYLOAD COMUM E MÍDIA DO PROVEDOR)
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
import { launchTransactionFromChatVoice } from '../services/chatVoiceController';
import { clientAuthSession } from '../services/clientAuthSession';

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
  const BOB_UID = `usr_bob_web_036_${runSuffix}`;
  const ALICE_PHONE = `558699411${String(runSuffix).slice(-4)}`;
  const BOB_PHONE = `558699412${String(runSuffix).slice(-4)}`;
  const UNBOUND_PHONE = `558699999${String(runSuffix).slice(-4)}`;

  // Ambas as contas iniciam com saldo sintético equivalente de R$ 1.000,00 (100.000 centavos)
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
    name: 'Conta Corrente Bob (Chat Web)',
    balanceCents: 100000, // R$ 1.000,00
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

  // Limpa mensagens capturadas, traces de áudio e injeção de falhas
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear_captured_replies' })
  });

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear_audio_pipeline_trace' })
  });

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear_test_batch_failure_index' })
  });

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
    assert(accBobAfterCross?.balanceCents === 100000, 'Saldo de Bob permanece estritamente R$ 1.000,00 (Zero mutação indevida)');

    // ------------------------------------------------------------------------
    // GRUPO 2: AMBIGUIDADE RELEVANTE SEM GRAVAÇÃO (ZERO MUTAÇÕES) E CAPTURA DE ENVIO
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 2: AMBIGUIDADE RELEVANTE SEM GRAVAÇÃO (ZERO MUTAÇÕES) E CAPTURA ---');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_captured_replies' })
    });

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
    assert(respVague1.status === 200, 'Mensagem com ambiguidade relevante responde com status 200');
    assert(jsonVague1.status === 'clarification_requested', 'Status operacional indica clarification_requested');
    assert(jsonVague1.isAmbiguous === true, 'Flag isAmbiguous retorna true');
    assert(jsonVague1.mutations === 0, 'Mutations retorna estritamente 0');
    assert(typeof jsonVague1.replySent === 'string' && jsonVague1.replySent.includes('valor exato'), 'Mensagem solicita esclarecimento sobre o valor exato');

    // 2.2 Captura do envio da mensagem de esclarecimento ao WhatsApp
    const respCapturedAmb = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_captured_replies' })
    });
    const jsonCapturedAmb = await respCapturedAmb.json();
    assert(Array.isArray(jsonCapturedAmb.replies) && jsonCapturedAmb.replies.length >= 1, 'Mensagem de esclarecimento foi efetivamente enviada e capturada');
    assert(jsonCapturedAmb.replies[0].message.includes('valor exato'), 'Mensagem capturada enviada ao WhatsApp solicita o valor sem gravar no banco');

    // 2.3 Mensagem com valores conflitantes
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

    // 2.4 Saldo de Alice permanece R$ 1.000,00 intacto no Firestore Emulator
    const accAliceAfterAmb = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterAmb?.balanceCents === 100000, 'Saldo de Alice permanece R$ 1.000,00 intacto após mensagens ambíguas');

    // ------------------------------------------------------------------------
    // GRUPO 3: CONTRATO ATÔMICO DO LOTE E IMUNIDADE A simulateItemFailureIndex NO PAYLOAD COMUM
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: CONTRATO ATÔMICO DO LOTE E IMUNIDADE A simulateItemFailureIndex ---');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_captured_replies' })
    });

    // 3.1 Prova de que simulateItemFailureIndex no payload comum do webhook é TOTALMENTE IGNORADO
    const msgIdCommon = `msg_wa_common_ignore_${Date.now()}`;
    const respCommon = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        messageId: msgIdCommon,
        message: 'Padaria 15 reais e farmacia 25 reais',
        simulateItemFailureIndex: 1, // Enviado no payload comum: DEVE ser ignorado pelo webhook normal!
        isGroup: true
      })
    });
    const jsonCommon = await respCommon.json();

    assert(respCommon.status === 200, 'Payload comum com simulateItemFailureIndex é aceito com HTTP 200 OK (imunidade confirmada)');
    assert(jsonCommon.status === 'success', 'Status da operação é success: o parâmetro do payload comum foi ignorado');
    assert(jsonCommon.receipts?.length === 2, 'Ambos os itens foram comitados normalmente');
    assert(jsonCommon.receipts[0]?.status === 'APPLIED' && jsonCommon.receipts[1]?.status === 'APPLIED', 'Recibos emitidos com status APPLIED');

    // Saldo atualizado: 100.000 - 1.500 - 2.500 = 96.000 centavos (R$ 960,00)
    const accAliceAfterCommon = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterCommon?.balanceCents === 96000, 'Saldo de Alice atualizado para R$ 960,00 (96.000 cents): payload comum não abortou o lote');

    // 3.2 Prova de Rollback por Injeção de Falha Controlada na Infraestrutura de Teste
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_test_batch_failure_index', failureIndex: 1 })
    });

    const msgIdFalhaLote = `msg_wa_lote_fail_${Date.now()}`;
    const respLoteFalha = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        messageId: msgIdFalhaLote,
        message: 'Jantar 60 reais e uber 20 reais',
        isGroup: true
      })
    });
    const jsonLoteFalha = await respLoteFalha.json();

    assert(respLoteFalha.status === 400, 'Falha injetada na infraestrutura de teste retorna HTTP 400');
    assert(jsonLoteFalha.status === 'batch_failure', 'Status reportado é batch_failure');
    assert(jsonLoteFalha.rolledBack === true, 'Flag rolledBack confirma reversão de todos os efeitos');
    assert(jsonLoteFalha.mutations === 0, 'Mutations no lote com falha é estritamente 0');

    // 3.3 Captura do envio da mensagem de erro e rollback para o WhatsApp
    const respCapturedFail = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_captured_replies' })
    });
    const jsonCapturedFail = await respCapturedFail.json();
    assert(jsonCapturedFail.replies.length >= 1, 'Mensagem de falha do lote foi enviada ao WhatsApp');
    const lastReplyFail = jsonCapturedFail.replies[jsonCapturedFail.replies.length - 1].message;
    assert(lastReplyFail.includes('Rollback total'), 'Mensagem capturada comunica Rollback total e integridade do saldo');

    // 3.4 Prova contábil no Firestore: Saldo permanece estritamente R$ 960,00 (ZERO dedução) e ZERO registros órfãos
    const accAliceAfterFail = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterFail?.balanceCents === 96000, 'Saldo de Alice no Firestore permanece estritamente R$ 960,00 (zero efeito da falha)');

    const txsAliceAfterFail = await adapter.listUserTransactions(ALICE_UID);
    const hasJantarOrUber = txsAliceAfterFail.some((t: any) => 
      (t.description && (t.description.toLowerCase().includes('jantar') || t.description.toLowerCase().includes('uber')))
    );
    assert(!hasJantarOrUber, 'Zero transações de Jantar ou Uber gravadas no Firestore Emulator após falha no lote (Rollback Total)');

    // ------------------------------------------------------------------------
    // GRUPO 4: LOTE COMPOSTO BEM-SUCEDIDO, CONCORRÊNCIA E REPLAY
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 4: LOTE COMPOSTO BEM-SUCEDIDO, CONCORRÊNCIA E REPLAY ---');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_captured_replies' })
    });

    const messageIdLote = `msg_wa_lote_success_${Date.now()}`;
    const lotePayload = {
      sender: `${ALICE_PHONE}@s.whatsapp.net`,
      messageId: messageIdLote,
      message: 'Almoço 35 reais e abasteci 120 reais no posto',
      isGroup: true
    };

    // 4.1 Reentrega concorrente com Promise.all (duas chamadas simultâneas com mesmo messageId)
    const [respL1, respL2] = await Promise.all([
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
        body: JSON.stringify(lotePayload)
      }),
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
        body: JSON.stringify(lotePayload)
      })
    ]);

    const jsonL1 = await respL1.json();
    const jsonL2 = await respL2.json();

    assert(respL1.status === 200 && respL2.status === 200, 'Ambas requisições simultâneas do lote retornam HTTP 200 OK');
    assert(jsonL1.status === 'success' && jsonL2.status === 'success', 'Ambas reportam status success');

    const hasReplayBatch = jsonL1.receipts.some((r: any) => r.replay) || jsonL2.receipts.some((r: any) => r.replay);
    assert(hasReplayBatch, 'Idempotência atômica interceptou a requisição concorrente marcando replay = true');

    // 4.2 Saldo no Firestore Emulator atualizado exatamente uma vez:
    // 96.000 - 3.500 - 12.000 = 80.500 centavos (R$ 805,00)
    const accAliceAfterLote = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterLote?.balanceCents === 80500, 'Saldo no Firestore debitado exatamente uma vez para R$ 805,00 (80.500 cents)');

    // 4.3 Descarte de resposta pós-commit e retry pelo cliente
    const respLoteRetry = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify(lotePayload)
    });
    const jsonLoteRetry = await respLoteRetry.json();

    assert(respLoteRetry.status === 200, 'Reenvio pós perda de resposta retorna HTTP 200 OK');
    assert(jsonLoteRetry.receipts.every((r: any) => r.replay === true), 'Todos os recibos recuperados com replay = true');
    assert(jsonLoteRetry.receipts.every((r: any) => r.status === 'APPLIED'), 'Status de todos os recibos recuperados é APPLIED');

    const accAliceAfterRetry = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterRetry?.balanceCents === 80500, 'Saldo no Firestore mantido estritamente em R$ 805,00 após retry');

    // 4.4 Captura e inspeção da mensagem efetivamente enviada ao WhatsApp a partir dos recibos
    const respCapturedLote = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_captured_replies' })
    });
    const jsonCapturedLote = await respCapturedLote.json();
    assert(jsonCapturedLote.replies.length >= 1, 'Mensagens do lote composto foram enviadas e capturadas');
    const capturedMsg = jsonCapturedLote.replies[0].message;

    // Comparação de valores, estado previsto vs realizado e ausência de campos com o banco
    assert(capturedMsg.includes('155,00'), 'Mensagem enviada deriva o valor total do lote (R$ 155,00)');
    assert(capturedMsg.includes('35,00') && capturedMsg.includes('120,00'), 'Mensagem reflete valores exatos dos itens em centavos');
    assert(capturedMsg.includes('Realizado / Debitado em conta'), 'Mensagem reflete estado Realizado / Debitado em conta');
    assert(capturedMsg.includes('Posto de Combustível'), 'Item 2 contém estabelecimento Posto de Combustível');
    assert(!capturedMsg.includes('Local / Cidade: undefined') && !capturedMsg.includes('Local / Cidade: null'), 'Preservação de campos ausentes sem cidades fantasmas');

    // ------------------------------------------------------------------------
    // GRUPO 5: EVENTO SINTÉTICO DE MÍDIA NO FORMATO DO PROVEDOR (BAILEYS/EVOLUTION)
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 5: EVENTO SINTÉTICO DE MÍDIA NO FORMATO DO PROVEDOR ---');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_test_audio_mocks',
        transcription: 'Cinema 40 reais no débito',
        mimetype: 'audio/ogg'
      })
    });

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_audio_pipeline_trace' })
    });

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_captured_replies' })
    });

    // Envio do payload nativo do provedor Baileys/Evolution (data.message.audioMessage)
    const audioMessageId = `baileys_audio_${Date.now()}`;
    const respAudioNative = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        isGroup: true,
        data: {
          key: {
            remoteJid: `${ALICE_PHONE}@s.whatsapp.net`,
            fromMe: false,
            id: audioMessageId,
            participant: `${ALICE_PHONE}@s.whatsapp.net`
          },
          message: {
            audioMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7114-24/synthetic_cinema_voice.ogg',
              mimetype: 'audio/ogg; codecs=opus',
              fileLength: '24560',
              seconds: 4,
              ptt: true
            }
          }
        }
      })
    });
    const jsonAudioNative = await respAudioNative.json();

    assert(respAudioNative.status === 200, 'Áudio no formato nativo do provedor processado com HTTP 200 OK');
    assert(jsonAudioNative.status === 'success', 'Status da operação de áudio nativo é success');
    assert(jsonAudioNative.receipt?.status === 'APPLIED', 'Recibo de áudio emitido com status APPLIED');
    assert(jsonAudioNative.savedTx?.amountCents === 4000, 'Valor monetário extraído do áudio: exatamente 4.000 centavos');

    // 5.2 Validação do trace das fronteiras simuladas controladas (substituição de serviços externos)
    const respAudioTrace = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_audio_pipeline_trace' })
    });
    const jsonAudioTrace = await respAudioTrace.json();
    assert(Array.isArray(jsonAudioTrace.trace) && jsonAudioTrace.trace.length >= 2, 'Trace do pipeline de áudio contém registros das fronteiras controladas');
    assert(jsonAudioTrace.trace.some((t: any) => t.step === 'FETCH_AUDIO_MEDIA'), 'Fronteira externa FETCH_AUDIO_MEDIA executada sob serviço de teste controlado');
    assert(jsonAudioTrace.trace.some((t: any) => t.step === 'TRANSCRIBE_AUDIO_BUFFER'), 'Fronteira externa TRANSCRIBE_AUDIO_BUFFER executada sob serviço de teste controlado');

    // 5.3 Saldo no Firestore atualizado: 80.500 - 4.000 = 76.500 centavos (R$ 765,00)
    const accAliceAfterAudio = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterAudio?.balanceCents === 76500, 'Saldo de Alice no Firestore atualizado exatamente para R$ 765,00 (76.500 cents)');

    // 5.4 Mensagem enviada ao WhatsApp capturada e verificada
    const respCapturedAudio = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_captured_replies' })
    });
    const jsonCapturedAudio = await respCapturedAudio.json();
    const lastAudioMsg = jsonCapturedAudio.replies[jsonCapturedAudio.replies.length - 1].message;
    assert(lastAudioMsg.includes('🎙️ [Áudio de Voz]'), 'Mensagem enviada ao WhatsApp inclui prefixo de áudio');
    assert(lastAudioMsg.includes('40,00'), 'Mensagem reflete o valor de R$ 40,00 debitado');
    assert(lastAudioMsg.includes('APPLIED'), 'Mensagem inclui confirmação derivada do recibo APPLIED');

    // ------------------------------------------------------------------------
    // GRUPO 6: PROVA RIGOROSA DE PARIDADE PELA ENTRADA NATURAL DOS DOIS CHATS
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 6: PROVA RIGOROSA DE PARIDADE PELA ENTRADA NATURAL DOS DOIS CHATS ---');

    // Mesma frase natural enviada em ambos os canais: "Gasolina 73 reais e 45 centavos no débito"
    // Contas sintéticas equivalentes: Bob (Web) e Alice (WhatsApp)
    // 6.1 Canal Chat Web: Invocação do mesmo ponto de entrada de mensagem natural chamado pelo handler real em App.tsx
    const bobAuthToken = await getAuthTokenForUser(BOB_UID);
    clientAuthSession.setCurrentSession({
      uid: BOB_UID,
      email: `${BOB_UID}@kyro.test`,
      getIdToken: async () => bobAuthToken
    });

    const naturalPhrase = 'Gasolina 73 reais e 45 centavos no débito';
    const webLaunchRes = await launchTransactionFromChatVoice({
      transcript: naturalPhrase,
      baseUrl,
      accountId: `acc_${BOB_UID}`,
      accountOwnerId: BOB_UID,
      userUid: BOB_UID,
      authToken: bobAuthToken
    });

    assert(webLaunchRes.ok === true, 'Chat Web processou a entrada natural com sucesso (ok: true)');
    assert(webLaunchRes.transaction !== null, 'Transação financeira construída e persistida pelo Chat Web');
    assert(webLaunchRes.transaction?.amount === 73.45, 'Chat Web interpretou exatamente R$ 73,45 a partir da frase natural');
    assert(webLaunchRes.data?.receipt?.status === 'APPLIED', 'Recibo formal emitido para o Chat Web com status APPLIED');

    // 6.2 Canal WhatsApp Webhook: Envio da mesma frase natural pura via HTTP
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_captured_replies' })
    });

    const waNaturalMsgId = `msg_wa_natural_parity_${Date.now()}`;
    const respWaNatural = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        messageId: waNaturalMsgId,
        message: naturalPhrase, // Mesma frase natural pura!
        isGroup: true
      })
    });
    const jsonWaNatural = await respWaNatural.json();

    assert(respWaNatural.status === 200, 'WhatsApp Webhook processou a entrada natural com HTTP 200 OK');
    assert(jsonWaNatural.status === 'success', 'WhatsApp Webhook reporta status success');
    assert(jsonWaNatural.savedTx?.amountCents === 7345, 'WhatsApp interpretou exatamente 7.345 centavos da frase natural');
    assert(jsonWaNatural.receipt?.status === 'APPLIED', 'Recibo formal emitido para o WhatsApp com status APPLIED');

    // 6.3 Comparação 1: Exatidão matemática de 7.345 centavos inteiros nos documentos persistidos no Firestore
    const txWebDoc = await store.getDocument(`users/${BOB_UID}/transactions/${webLaunchRes.transaction!.id}`);
    const txWaDoc = await store.getDocument(`users/${ALICE_UID}/transactions/${jsonWaNatural.savedTx.id}`);

    assert(txWebDoc !== null && txWaDoc !== null, 'Ambos os documentos de transação foram persistidos no Firestore');
    assert(txWebDoc.amountCents === 7345, 'Documento persistido pelo Chat Web possui exatamente 7.345 centavos inteiros');
    assert(txWaDoc.amountCents === 7345, 'Documento persistido pelo WhatsApp possui exatamente 7.345 centavos inteiros');

    // 6.4 Comparação 2: Efeito no saldo contábil no Firestore Emulator
    // Bob (Web): 100.000 - 7.345 = 92.655 centavos (R$ 926,55)
    // Alice (WhatsApp): 76.500 - 7.345 = 69.155 centavos (R$ 691,55) -> Ambas sofreram a redução de exatos 7.345 centavos!
    const accBobAfterNatural = await adapter.getAccount(BOB_UID, `acc_${BOB_UID}`);
    const accAliceAfterNatural = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);

    assert(accBobAfterNatural?.balanceCents === 92655, 'Saldo de Bob (Web) debitado em exatamente 7.345 centavos (R$ 926,55)');
    assert(accAliceAfterNatural?.balanceCents === 69155, 'Saldo de Alice (WhatsApp) debitado em exatamente 7.345 centavos (R$ 691,55)');

    // 6.5 Comparação 3: Campos persistidos no Firestore (Tipo, Categoria, Descrição, Método)
    assert(txWebDoc.type === 'EXPENSE' && txWaDoc.type === 'EXPENSE', 'Ambos canais persistiram tipo EXPENSE (Saída)');
    assert(
      txWebDoc.category === 'Transporte' && txWaDoc.category === 'Transporte',
      'Ambos canais classificaram a categoria principal como Transporte'
    );
    assert(
      (txWebDoc.subcategory === 'Combustível' || String(txWebDoc.description).toLowerCase().includes('combust')) &&
      (txWaDoc.subcategory === 'Combustível' || String(txWaDoc.description).toLowerCase().includes('combust')),
      'Ambos canais classificaram a subcategoria/descrição como Combustível'
    );
    assert(txWebDoc.method === 'Débito' && txWaDoc.method === 'Débito', 'Ambos canais persistiram a forma de pagamento como Débito');

    // 6.6 Comparação 4: Confirmação apresentada em cada canal derivada do recibo contábil
    assert(
      webLaunchRes.confirmationText.includes('73,45') && webLaunchRes.confirmationText.includes('APPLIED'),
      'Confirmação do Chat Web apresentada ao usuário deriva o valor de R$ 73,45 e o recibo APPLIED'
    );

    const respCapturedWaNatural = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_captured_replies' })
    });
    const jsonCapturedWaNatural = await respCapturedWaNatural.json();
    const lastWaNaturalReply = jsonCapturedWaNatural.replies[jsonCapturedWaNatural.replies.length - 1].message;

    assert(
      lastWaNaturalReply.includes('73,45') && lastWaNaturalReply.includes('APPLIED') && lastWaNaturalReply.includes('Realizado / Debitado em conta'),
      'Confirmação enviada ao WhatsApp apresentada deriva o valor de R$ 73,45, estado Realizado e recibo APPLIED'
    );

    // ------------------------------------------------------------------------
    // GRUPO 7: MODELO B DE CARTÕES, CONSULTA E ESTORNO COM TOMBSTONE
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 7: MODELO B DE CARTÕES, CONSULTA E ESTORNO COM TOMBSTONE ---');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_captured_replies' })
    });

    // 7.1 Modelo B de Cartões e Faturas ("Tênis 300 reais em 3x no Nubank")
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

    assert(respCard.status === 200, 'Compra parcelada no cartão aceita com HTTP 200 OK');
    assert(jsonCard.status === 'success', 'Status da compra parcelada é success');
    assert(jsonCard.savedTx?.cardName === 'Nubank', 'Cartão detectado com precisão: Nubank');
    assert(jsonCard.savedTx?.method === 'Crédito', 'Método classificado como Crédito');

    // Saldo de conta corrente permanece inalterado (Modelo B: fatura a vencer não debita conta corrente)
    const accAliceAfterCard = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterCard?.balanceCents === 69155, 'Modelo B preservado: Saldo de conta corrente permanece R$ 691,55 intacto');

    // 7.2 Consulta de Histórico / Diagnóstico
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
    assert(jsonQuery.status === 'query_answered', 'Status da consulta é query_answered');
    assert(jsonQuery.mutations === 0, 'Zero mutações contábeis durante consulta');

    // 7.3 Cancelamento / Estorno de Transação Específica ("Cancela o abastecimento de 120 reais")
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
    assert(jsonCancel.action === 'reversal', 'Ação registrada é reversal');
    assert(jsonCancel.receipt?.code === 'TRANSACTION_REVERSED', 'Recibo de estorno possui código TRANSACTION_REVERSED');

    // Saldo de Alice restaurado: 69.155 + 12.000 = 81.155 centavos (R$ 811,55)
    const accAliceAfterCancel = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterCancel?.balanceCents === 81155, 'Saldo no Firestore restaurado para R$ 811,55 (81.155 cents)');

    // 7.4 Tentativa de estorno duplicado bloqueada pelo Tombstone ativo de 90 dias
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
      'Tombstone ativo bloqueia segundo cancelamento da mesma transação'
    );

    const accAliceAfterDupl = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterDupl?.balanceCents === 81155, 'Saldo permanece inalterado em R$ 811,55 após tentativa de duplo estorno');

    console.log('\n================================================================');
    console.log(`RESULTADO DA SUBETAPA 03.6: ${passedTests} / ${totalTests} APROVADOS (100%)`);
    console.log('STATUS: CONVERGÊNCIA COMPROVADA DO WHATSAPP COM MOTOR COMPARTILHADO');
    console.log('PARIDADE NATURAL DOS DOIS CHATS, LOTE ATÔMICO COM ROLLBACK E MÍDIA DO PROVEDOR');
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
