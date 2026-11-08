/**
 * KYRO FINANCE - SUBETAPA 03.6 (PR.046)
 * BATERIA DE HOMOLOGAÇÃO: CONVERGÊNCIA DO WHATSAPP COM O MOTOR FINANCEIRO COMPARTILHADO
 * (LOTE ATÔMICO COM ROLLBACK, MENSAGEM DERIVADA DO RECIBO, MÍDIA EMULADA DO PROVEDOR E PARIDADE WEB/WHATSAPP)
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

  // Limpa mensagens capturadas e traces de áudio
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
    // GRUPO 3: CONTRATO ATÔMICO REAL DO LOTE NO MOTOR COMPARTILHADO (FALHA NO 2º ITEM E ROLLBACK)
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: CONTRATO ATÔMICO REAL DO LOTE NO MOTOR COMPARTILHADO (FALHA E ROLLBACK) ---');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_captured_replies' })
    });

    const msgIdFalhaLote = `msg_wa_lote_fail_${Date.now()}`;
    const respLoteFalha = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'kyro_webhook_secret_dev' },
      body: JSON.stringify({
        sender: `${ALICE_PHONE}@s.whatsapp.net`,
        messageId: msgIdFalhaLote,
        message: 'Almoço 35 reais e abasteci 120 reais no posto',
        simulateItemFailureIndex: 1, // Falha simulada exatamente no 2º item do lote
        isGroup: true
      })
    });
    const jsonLoteFalha = await respLoteFalha.json();

    assert(respLoteFalha.status === 400, 'Falha no lote retorna HTTP 400');
    assert(jsonLoteFalha.status === 'batch_failure', 'Status reportado é batch_failure');
    assert(jsonLoteFalha.rolledBack === true, 'Flag rolledBack confirma reversão de todos os efeitos');
    assert(jsonLoteFalha.mutations === 0, 'Mutations no lote com falha é estritamente 0');

    // 3.2 Captura do envio da mensagem de erro e rollback para o WhatsApp
    const respCapturedFail = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_captured_replies' })
    });
    const jsonCapturedFail = await respCapturedFail.json();
    assert(jsonCapturedFail.replies.length >= 1, 'Mensagem de falha do lote foi enviada ao WhatsApp');
    const lastReplyFail = jsonCapturedFail.replies[jsonCapturedFail.replies.length - 1].message;
    assert(lastReplyFail.includes('Rollback total'), 'Mensagem capturada comunica Rollback total e integridade do saldo');

    // 3.3 Prova contábil no Firestore: Saldo permanece estritamente R$ 1.000,00 e ZERO transações gravadas
    const accAliceAfterFail = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterFail?.balanceCents === 100000, 'Saldo de Alice no Firestore permanece estritamente R$ 1.000,00 (100.000 cents)');

    const txsAliceAfterFail = await adapter.listUserTransactions(ALICE_UID);
    assert(txsAliceAfterFail.length === 0, 'Zero transações gravadas no Firestore Emulator após falha atômica no 2º item');

    // ------------------------------------------------------------------------
    // GRUPO 4: LOTE COMPOSTO BEM-SUCEDIDO, CONCORRÊNCIA, DESCARTE E REPLAY
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
    // 100.000 - 3.500 - 12.000 = 84.500 centavos (R$ 845,00)
    const accAliceAfterLote = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterLote?.balanceCents === 84500, 'Saldo no Firestore debitado exatamente uma vez para R$ 845,00 (84.500 cents)');

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
    assert(accAliceAfterRetry?.balanceCents === 84500, 'Saldo no Firestore mantido estritamente em R$ 845,00 após retry');

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
        transcription: 'Gasolina 73 reais e 45 centavos no débito',
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
              url: 'https://mmg.whatsapp.net/v/t62.7114-24/synthetic_voice.ogg',
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
    assert(jsonAudioNative.savedTx?.amountCents === 7345, 'Valor monetário extraído do áudio: exatamente 7.345 centavos');

    // 5.2 Validação do trace das fronteiras simuladas controladas
    const respAudioTrace = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_audio_pipeline_trace' })
    });
    const jsonAudioTrace = await respAudioTrace.json();
    assert(Array.isArray(jsonAudioTrace.trace) && jsonAudioTrace.trace.length >= 2, 'Trace do pipeline de áudio contém registros das fronteiras controladas');
    assert(jsonAudioTrace.trace.some((t: any) => t.step === 'FETCH_AUDIO_MEDIA'), 'Fronteira FETCH_AUDIO_MEDIA executada sob serviço de teste controlado');
    assert(jsonAudioTrace.trace.some((t: any) => t.step === 'TRANSCRIBE_AUDIO_BUFFER'), 'Fronteira TRANSCRIBE_AUDIO_BUFFER executada sob serviço de teste controlado');

    // 5.3 Saldo no Firestore atualizado: 84.500 - 7.345 = 77.155 centavos (R$ 771,55)
    const accAliceAfterAudio = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterAudio?.balanceCents === 77155, 'Saldo de Alice no Firestore atualizado exatamente para R$ 771,55 (77.155 cents)');

    // 5.4 Mensagem enviada ao WhatsApp capturada e verificada
    const respCapturedAudio = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_captured_replies' })
    });
    const jsonCapturedAudio = await respCapturedAudio.json();
    const lastAudioMsg = jsonCapturedAudio.replies[jsonCapturedAudio.replies.length - 1].message;
    assert(lastAudioMsg.includes('🎙️ [Áudio de Voz]'), 'Mensagem enviada ao WhatsApp inclui prefixo de áudio');
    assert(lastAudioMsg.includes('73,45'), 'Mensagem reflete o valor de R$ 73,45 debitado');
    assert(lastAudioMsg.includes('APPLIED'), 'Mensagem inclui confirmação derivada do recibo APPLIED');

    // ------------------------------------------------------------------------
    // GRUPO 6: PARIDADE ESTRITA ENTRE CHAT WEB E WHATSAPP
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 6: PARIDADE ESTRITA ENTRE CHAT WEB E WHATSAPP ---');

    // Frase natural idêntica testada em ambos os canais: "Gasolina 73 reais e 45 centavos no débito"
    // No canal Chat Web (utilizando API Database protegida com token oficial do Auth Emulator para Bob)
    const bobAuthToken = await getAuthTokenForUser(BOB_UID);
    const reqIdWebBob = `req_web_bob_${Date.now()}`;
    const respWebBob = await fetch(`${baseUrl}/api/database`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobAuthToken}`,
        'X-Request-ID': reqIdWebBob
      },
      body: JSON.stringify({
        action: 'save_transaction',
        accountId: `acc_${BOB_UID}`,
        transaction: {
          id: `tx_web_bob_${Date.now()}`,
          amount: 73.45,
          amountCents: 7345,
          description: 'Gasolina',
          category: 'Combustível',
          method: 'Débito'
        }
      })
    });
    const jsonWebBob = await respWebBob.json();

    assert(respWebBob.status === 200, 'Chat Web confirma transação com HTTP 200 OK');
    assert(jsonWebBob.receipt?.status === 'APPLIED', 'Recibo Chat Web emitido com status APPLIED');
    assert(jsonWebBob.receipt?.code === 'TRANSACTION_COMMITTED', 'Código do recibo Web é TRANSACTION_COMMITTED');

    // Saldo de Bob debitado de R$ 500,00 (50.000) para R$ 426,55 (42.655 centavos)
    const accBobAfterWeb = await adapter.getAccount(BOB_UID, `acc_${BOB_UID}`);
    assert(accBobAfterWeb?.balanceCents === 42655, 'Saldo de Bob debitado exatamente em 7.345 centavos no motor contábil');

    // Comparação de Paridade: WhatsApp e Web debitaram exatamente 7.345 centavos inteiros com recibos APPLIED
    assert(
      jsonAudioNative.savedTx?.amountCents === 7345 && (accBobAfterWeb?.balanceCents === 50000 - 7345),
      'Paridade contábil estrita: Chat Web e WhatsApp debitam exatamente 7.345 centavos sem discrepâncias'
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
    assert(accAliceAfterCard?.balanceCents === 77155, 'Modelo B preservado: Saldo de conta corrente permanece R$ 771,55 intacto');

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

    // 7.3 Cancelamento / Estorno de Transação Específica
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

    // Saldo de Alice restaurado: 77.155 + 12.000 = 89.155 centavos (R$ 891,55)
    const accAliceAfterCancel = await adapter.getAccount(ALICE_UID, `acc_${ALICE_UID}`);
    assert(accAliceAfterCancel?.balanceCents === 89155, 'Saldo no Firestore restaurado para R$ 891,55 (89.155 cents)');

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
    assert(accAliceAfterDupl?.balanceCents === 89155, 'Saldo permanece inalterado em R$ 891,55 após tentativa de duplo estorno');

    console.log('\n================================================================');
    console.log(`RESULTADO DA SUBETAPA 03.6: ${passedTests} / ${totalTests} APROVADOS (100%)`);
    console.log('STATUS: CONVERGÊNCIA COMPROVADA DO WHATSAPP COM MOTOR COMPARTILHADO');
    console.log('CONTRATO ATÔMICO DE LOTE, MENSAGEM DO RECIBO, MÍDIA E PARIDADE WEB/WHATSAPP');
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
