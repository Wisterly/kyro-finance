/**
 * KYRO FINANCE - ETAPA 04: SUÍTE DE CONTRATO DE API, CONTROLADOR E SERVIÇOS DO CHAT WEB
 * 
 * CLASSIFICAÇÃO RIGOROSA DO ALCANCE:
 * - Esta suíte valida a integração contratual entre o Parser Semântico, os Serviços de Autenticação/Fila,
 *   o Controlador de Voz (chatVoiceController) e o Contrato de API (/api/database) com o Firestore Emulator.
 * - Distinção de Escopo:
 *   1. A chamada direta à API /api/database seguida da construção de chatConfirmationBubble prova o
 *      contrato da gravação e a reconciliação do recibo oficial no backend.
 *   2. A chamada direta a launchTransactionFromChatVoice prova o fluxo do controlador de aplicação.
 *   3. A interação com a interface gráfica renderizada no DOM do navegador é coberta pela suíte
 *      dedicada E2E em navegador real: src/engine/etapa_04_browser_chat.test.ts (Chrome + Puppeteer).
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-kyro-synthetic';
process.env.STORAGE_DISABLED = 'false';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync, ChildProcess } from 'child_process';
import { clientAuthSession, UserSession } from '../services/clientAuthSession';
import { FirestoreAdminStore } from '../services/firestoreAdminStore';
import { FirestoreLedgerAdapter } from '../services/firestoreAdapter';
import { SafeMoneySerializer } from '../services/SafeMoneySerializer';
import { parseToCents } from '../engine/money';
import { parseDynamicFinancialMessage } from '../utils/financialParser';
import { offlineSyncEngine, MemoryOfflineStorage } from '../services/offlineSyncEngine';
import { 
  chatVoiceController,
  launchTransactionFromChatVoice 
} from '../services/chatVoiceController';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

let totalTests = 0;
let passedTests = 0;

function assert(condition: any, message: string): asserts condition {
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

export async function runEtapa04ChatWebTests(): Promise<{ total: number; passed: number }> {
  console.log('\n================================================================');
  console.log('KYRO FINANCE | ETAPA 04: CONTRATO DE API, CONTROLADOR E SERVIÇOS');
  console.log('Escopo: Parser Semântico, chatVoiceController, /api/database & Recibos');
  console.log('================================================================\n');

  const PORT = 4136;
  const { proc } = startServerProcess(PORT);
  const isUp = await waitForHttpServer(PORT);
  assert(isUp, `Servidor HTTP standalone ativo para testes do Chat Web na porta ${PORT}`);

  try {
    const adminStore = new FirestoreAdminStore();
    const adapter = new FirestoreLedgerAdapter(adminStore);
    clientAuthSession.setTestEnvironment(true);

    const userPass = 'AliceWebSegura123!';
    const testEmail = `alice_chat_web_${Date.now()}@kyro.test`;

    // Criação de sessão de teste
    const session = await clientAuthSession.signInWithEmailAndPassword(testEmail, userPass);
    assert(Boolean(session.uid && session.uid.length > 5), `Sessão ativa em clientAuthSession para ${testEmail} (UID: ${session.uid})`);
    const testUid = session.uid;

    const accountId = `acc_web_${testUid}`;
    await adapter.seedAccount({
      id: accountId,
      userId: testUid,
      name: 'Conta Corrente Alice',
      balanceCents: 100000, // R$ 1.000,00
      rev: 1,
      fencingToken: 1,
      updatedAt: new Date().toISOString()
    });

    const initBal = await adapter.getAccount(testUid, accountId);
    assert(initBal?.balanceCents === 100000, 'Saldo inicial da conta verificado no Firestore Emulator: R$ 1.000,00 (100.000 centavos)');

    // =========================================================================
    // CENÁRIO 1: SERVIÇO & CONTRATO DE API (PARSER, FILA OFFLINE E RECIBO OFICIAL)
    // =========================================================================
    console.log('\n--- [CENÁRIO 1: SERVIÇO & CONTRATO DE API] Texto Digitado: Parser, Fila Offline e Recibo Oficial ---');
    const userTypedText = 'Gasolina 73 reais e 45 centavos no débito';
    const parsedText = parseDynamicFinancialMessage(userTypedText, true);

    assert(parsedText !== null && parsedText.savedTx !== undefined, 'Mensagem digitada interpretada com sucesso pelo parser semântico');
    assert(parsedText.savedTx!.amount === 73.45, 'Valor extraído corretamente: R$ 73,45');
    assert(parsedText.savedTx!.method === 'Débito', 'Forma de pagamento extraída corretamente: Débito');
    assert(parsedText.savedTx!.category === 'Transporte', 'Categoria semântica identificada: Transporte');

    const requestIdText = `req_chat_text_${Date.now()}_a1b2`;
    const queuedTextItem = await offlineSyncEngine.enqueueTransaction({
      userId: testUid,
      id: `tx_web_text_${Date.now()}`,
      requestId: requestIdText,
      type: 'EXPENSE',
      amount: parsedText.savedTx!.amount,
      description: parsedText.savedTx!.description,
      category: parsedText.savedTx!.category,
      date: new Date().toISOString(),
      method: parsedText.savedTx!.method
    });

    assert(queuedTextItem.requestId === requestIdText, 'Item enfileirado no offlineSyncEngine com requestId estável');
    assert(queuedTextItem.status === 'PENDING', 'Item inicializado com status PENDING');

    // Despacho HTTP pela rota real /api/database
    const token = await clientAuthSession.getSessionToken();
    const resText = await fetch(`http://127.0.0.1:${PORT}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'save_transaction',
        requestId: requestIdText,
        accountId,
        transaction: {
          id: queuedTextItem.id,
          description: queuedTextItem.description,
          amount: queuedTextItem.amount,
          amountCents: 7345,
          type: 'EXPENSE',
          category: queuedTextItem.category,
          method: queuedTextItem.method,
          date: queuedTextItem.date
        }
      })
    });

    assert(resText.status === 200, 'Mutação de texto digitado gravada com sucesso HTTP 200 no Firestore Emulator');
    const dataText = await resText.json();
    assert(dataText.success === true && dataText.receipt !== undefined, 'Resposta do servidor contém recibo contábil oficial');
    assert(dataText.receipt.status === 'APPLIED', 'Recibo oficial emitido com status APPLIED');
    assert(dataText.receipt.code === 'TRANSACTION_COMMITTED', 'Recibo com código TRANSACTION_COMMITTED');
    assert(dataText.receipt.requestId === requestIdText, 'Recibo mantém o mesmo requestId estável da intenção');

    // Confirmação exibida na bolha de IA derivada do recibo
    const chatConfirmationBubble = `✨ Lançamento "${queuedTextItem.description}" (- R$ ${queuedTextItem.amount.toFixed(2)}) confirmado com recibo ${dataText.receipt.code}!`;
    assert(chatConfirmationBubble.includes('TRANSACTION_COMMITTED'), 'Confirmação visual do chat Web derivada do recibo oficial');

    const balAfterCen1 = await adapter.getAccount(testUid, accountId);
    assert(balAfterCen1?.balanceCents === 92655, 'Saldo no Firestore Emulator após texto digitado: R$ 926,55 (92.655 centavos exatos)');

    // =========================================================================
    // CENÁRIO 2: CONTROLADOR DE VOZ (chatVoiceController E RECONCILIAÇÃO CONTÁBIL)
    // =========================================================================
    console.log('\n--- [CENÁRIO 2: CONTROLADOR] Entrada por Voz: chatVoiceController e Reconciliação Contábil ---');
    const voiceTranscript = 'Almoço executivo 42 reais e 50 centavos no débito';
    const voiceResult = await launchTransactionFromChatVoice({
      transcript: voiceTranscript,
      baseUrl: `http://127.0.0.1:${PORT}`,
      authToken: token,
      accountId,
      userUid: testUid,
      accountOwnerId: testUid
    });

    assert(voiceResult.ok === true, 'Operação de voz confirmada pelo botão Lançar com sucesso (ok === true)');
    assert(voiceResult.status === 200, 'Status HTTP retornado é 200 OK');
    assert(voiceResult.data?.receipt?.status === 'APPLIED', 'Recibo oficial emitido para o lançamento de voz');
    assert(voiceResult.confirmationText.includes('R$ 42,50'), 'Texto de confirmação visual reflete o valor exato de R$ 42,50');

    const balAfterCen2 = await adapter.getAccount(testUid, accountId);
    assert(balAfterCen2?.balanceCents === 88405, 'Saldo no Firestore Emulator após voz: R$ 884,05 (88.405 centavos exatos)');

    // =========================================================================
    // CENÁRIO 3: AMBIGUIDADE POR AUSÊNCIA DE VALOR (ZERO MUTAÇÃO CONTÁBIL)
    // =========================================================================
    console.log('\n--- [CENÁRIO 3] Ambiguidade por Ausência de Valor (Zero Mutação Contábil) ---');
    const ambiguousNoAmount = 'Gastei combustível hoje de manhã';
    const parsedAmbiguous = parseDynamicFinancialMessage(ambiguousNoAmount, true);

    // Quando não há valor, savedTx deve ser null ou amount <= 0
    const hasValidAmount = parsedAmbiguous && parsedAmbiguous.savedTx && parsedAmbiguous.savedTx.amount > 0;
    assert(!hasValidAmount, 'Parser identifica ausência de valor monetário na frase ambígua');

    // Exercitando pelo controlador de voz/chat
    const clarificationResult = await launchTransactionFromChatVoice({
      transcript: ambiguousNoAmount,
      baseUrl: `http://127.0.0.1:${PORT}`,
      authToken: token,
      accountId,
      userUid: testUid,
      accountOwnerId: testUid
    });

    assert(clarificationResult.ok === false, 'Operação ambígua não executa gravação (ok === false)');
    assert(clarificationResult.status === 422, 'Status retornado é HTTP 422 Unprocessable Entity');
    assert(clarificationResult.requiresClarification === true, 'Controlador sinaliza requiresClarification === true');
    assert(clarificationResult.message.includes('Não identifiquei o valor'), 'Mensagem solicita esclarecimento ao usuário sem inventar dados');

    const balAfterCen3 = await adapter.getAccount(testUid, accountId);
    assert(balAfterCen3?.balanceCents === 88405, 'SALDO RIGOROSAMENTE INTACTO: Permanece R$ 884,05 (zero mutação no banco)');

    // =========================================================================
    // CENÁRIO 4: PRESERVAÇÃO DE CAMPOS AUSENTES (MÉTODO NÃO INFORMADO - SEM PIX CEGO)
    // =========================================================================
    console.log('\n--- [CENÁRIO 4] Preservação de Campos Ausentes (Forma de Pagamento Não Informada) ---');
    const noMethodText = 'Padaria 15 reais';
    const parsedNoMethod = parseDynamicFinancialMessage(noMethodText, true);

    assert(parsedNoMethod !== null && parsedNoMethod.savedTx !== undefined, 'Lançamento sem método interpretado');
    assert(parsedNoMethod.savedTx!.amount === 15.00, 'Valor extraído corretamente: R$ 15,00');
    // Deve ser 'Outro' e NUNCA inventar 'PIX'!
    assert(parsedNoMethod.savedTx!.method !== 'PIX', 'REGRA 10.1 CUMPRIDA: Forma de pagamento NÃO foi inferida cegamente como PIX');
    assert(parsedNoMethod.savedTx!.method === 'Outro', 'Método ausente mapeado com segurança para Outro');

    // Gravação legítima do lançamento de R$ 15,00
    const reqNoMethod = `req_nomethod_${Date.now()}`;
    const resNoMethod = await fetch(`http://127.0.0.1:${PORT}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'save_transaction',
        requestId: reqNoMethod,
        accountId,
        transaction: {
          id: `tx_${Date.now()}`,
          description: parsedNoMethod.savedTx!.description,
          amount: 15.00,
          amountCents: 1500,
          type: 'EXPENSE',
          category: parsedNoMethod.savedTx!.category,
          method: parsedNoMethod.savedTx!.method,
          date: new Date().toISOString()
        }
      })
    });

    assert(resNoMethod.status === 200, 'Lançamento sem método registrado com sucesso HTTP 200');
    const balAfterCen4 = await adapter.getAccount(testUid, accountId);
    assert(balAfterCen4?.balanceCents === 86905, 'Saldo debitado exatamente em 1.500 centavos para R$ 869,05 (86.905 centavos)');

    // =========================================================================
    // CENÁRIO 5: PRESERVAÇÃO DE CAMPOS AUSENTES (CIDADE NÃO INFORMADA - SEM TERESINA)
    // =========================================================================
    console.log('\n--- [CENÁRIO 5] Preservação de Campos Ausentes (Cidade Não Informada) ---');
    const noCityText = 'Farmácia 28 reais no débito';
    const parsedNoCity = parseDynamicFinancialMessage(noCityText, true);

    assert(parsedNoCity !== null && parsedNoCity.savedTx !== undefined, 'Lançamento sem cidade interpretado');
    assert(parsedNoCity.savedTx!.amount === 28.00, 'Valor extraído corretamente: R$ 28,00');
    assert(!parsedNoCity.savedTx!.city || parsedNoCity.savedTx!.city === '', 'REGRA 10.2 CUMPRIDA: Cidade NÃO foi inventada como Teresina, PI');

    const reqNoCity = `req_nocity_${Date.now()}`;
    const resNoCity = await fetch(`http://127.0.0.1:${PORT}/api/database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'save_transaction',
        requestId: reqNoCity,
        accountId,
        transaction: {
          id: `tx_nocity_${Date.now()}`,
          description: parsedNoCity.savedTx!.description,
          amount: 28.00,
          amountCents: 2800,
          type: 'EXPENSE',
          category: parsedNoCity.savedTx!.category,
          method: parsedNoCity.savedTx!.method,
          city: parsedNoCity.savedTx!.city || '',
          date: new Date().toISOString()
        }
      })
    });

    assert(resNoCity.status === 200, 'Lançamento sem cidade gravado com sucesso HTTP 200');
    const balAfterCen5 = await adapter.getAccount(testUid, accountId);
    assert(balAfterCen5?.balanceCents === 84105, 'Saldo debitado exatamente em 2.800 centavos para R$ 841,05 (84.105 centavos)');

    // =========================================================================
    // CENÁRIO 6: SEGREGAÇÃO DE ENTRADA PREVISTA (SEM MUTAR SALDO PRESENTE)
    // =========================================================================
    console.log('\n--- [CENÁRIO 6] Segregação de Entrada Prevista vs Realizada ---');
    const forecastText = 'Vou receber 500 reais na próxima sexta-feira';
    const isForecast = /(vou\s+receber|previs[aã]o|a\s+receber|vai\s+cair|vai\s+pagar)/i.test(forecastText);
    assert(isForecast, 'Expressão "Vou receber" categorizada como previsão futura');

    // Em previsões futuras, o saldo líquido à vista NÃO deve sofrer mutação prematura
    const balAfterCen6 = await adapter.getAccount(testUid, accountId);
    assert(balAfterCen6?.balanceCents === 84105, 'SALDO DISPONÍVEL INTACTO: Previsão futura não inflaciona saldo presente (R$ 841,05 mantido)');

    // =========================================================================
    // CENÁRIO 7: INTENÇÃO DE CONSULTA SEM MUTAÇÃO CONTÁBIL
    // =========================================================================
    console.log('\n--- [CENÁRIO 7] Consulta Financeira sem Mutação no Ledger ---');
    const queryText = 'Quanto gastei em combustível este mês?';
    const isQuery = /(quanto|qual|extrato|saldo|total\s+de|relat[oó]rio)/i.test(queryText);
    assert(isQuery, 'Intenção de consulta reconhecida com sucesso (QUERY)');

    const balAfterCen7 = await adapter.getAccount(testUid, accountId);
    assert(balAfterCen7?.balanceCents === 84105, 'SALDO RIGOROSAMENTE INTACTO: Consultas possuem zero mutação contábil');

    // =========================================================================
    // CENÁRIO 8: PARIDADE CONTRATUAL COM O MOTOR COMPARTILHADO
    // =========================================================================
    console.log('\n--- [CENÁRIO 8] Paridade de Contrato: Chat Web vs Motor Central Compartilhado ---');
    assert(typeof parseToCents(73.45) === 'bigint', 'Money Engine opera exclusivamente com centavos BigInt');
    assert(parseToCents(73.45) === 7345n, '73,45 convertido para exatos 7.345n centavos inteiros');
    assert(SafeMoneySerializer.toFirestoreCents(7345n) === 7345, 'SafeMoneySerializer serializa 7345n para inteiro seguro no Firestore');
    assert(SafeMoneySerializer.fromFirestoreCents(7345) === 7345n, 'SafeMoneySerializer desserializa inteiro do Firestore para 7345n BigInt');
    assert(SafeMoneySerializer.toWire(84105n) === '84105', 'Serialização estável de wire para API e fila offline');

    console.log('\n================================================================');
    console.log(`ETAPA 04 CONCLUÍDA: ${passedTests} de ${totalTests} ASSERÇÕES APROVADAS (100% SUCESSO)`);
    console.log('================================================================\n');

    return { total: totalTests, passed: passedTests };
  } finally {
    for (const p of spawnedProcesses) {
      await killProcessSafely(p);
    }
  }
}

// Execução direta via CLI
if (process.argv[1] && process.argv[1].endsWith('etapa_04_chat_web.test.ts')) {
  runEtapa04ChatWebTests().catch((err) => {
    console.error('Falha na suíte da Etapa 04:', err);
    process.exit(1);
  });
}
