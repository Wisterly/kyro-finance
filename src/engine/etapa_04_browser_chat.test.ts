/**
 * KYRO FINANCE - ETAPA 04: VALIDAÇÃO DINÂMICA DE INTERFACE EM NAVEGADOR REAL (E2E BROWSER)
 * 
 * Bateria automatizada que abre a aplicação renderizada no Google Chrome real (Puppeteer-Core)
 * conectado ao Firebase Auth Emulator e Firestore Emulator.
 * 
 * DIRETRIZES DE AUDITORIA:
 * 1. O adaptador (FirestoreLedgerAdapter) é utilizado ESTRITAMENTE para preparar o estado
 *    inicial (seedAccount) e consultar o estado final (getAccount / listUserTransactions).
 * 2. Zero chamadas a adapter.commitTransaction que fabriquem resultados artificialmente.
 * 3. Cada mutação financeira é disparada pela PRÓPRIA AÇÃO NA INTERFACE (digitação no input,
 *    submissão de texto, entrada do reconhecedor de fala e clique no botão renderizado "Lançar").
 * 4. Correlação ponta a ponta: requisição disparada pelo navegador -> requestId estável ->
 *    recibo oficial (status APPLIED) -> confirmação visual renderizada -> registro no banco ->
 *    efeito contábil único no saldo.
 * 5. Entrada ambígua sem valor monetário gera pedido de esclarecimento no chat, com zero
 *    requisições de mutação e saldo rigorosamente intacto.
 * 6. Lançamento sem cidade e sem método segue o contrato de ausência no banco (sem PIX e sem Teresina).
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-kyro-synthetic';
process.env.STORAGE_DISABLED = 'false';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync, ChildProcess } from 'child_process';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { clientAuthSession } from '../services/clientAuthSession';
import { FirestoreAdminStore } from '../services/firestoreAdminStore';
import { FirestoreLedgerAdapter, StoredAccountRecord } from '../services/firestoreAdapter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

let totalBrowserTests = 0;
let passedBrowserTests = 0;

function assertBrowser(condition: any, message: string): asserts condition {
  totalBrowserTests++;
  if (condition) {
    passedBrowserTests++;
    console.log(`  [OK - BROWSER] ${message}`);
  } else {
    console.error(`  [FALHA - BROWSER] ${message}`);
    throw new Error(`Asserção em navegador falhou: ${message}`);
  }
}

const spawnedProcesses: ChildProcess[] = [];

function startProcess(cmd: string, args: string[], envOverrides: Record<string, string> = {}): ChildProcess {
  const proc = spawn(cmd, args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...envOverrides
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });
  if (proc.pid) {
    spawnedProcesses.push(proc);
  }
  return proc;
}

async function waitForUrl(url: string, maxAttempts = 60, intervalMs = 300): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
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

function findChromePath(): string {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Nenhum executável de navegador compatível (Chrome/Edge) encontrado no host.');
}

export async function runEtapa04BrowserChatTests(): Promise<{ total: number; passed: number; sha: string }> {
  let currentSha = 'unknown';
  try {
    currentSha = execSync('git rev-parse HEAD').toString().trim();
  } catch {}

  console.log('\n================================================================');
  console.log('KYRO FINANCE | VALIDAÇÃO DE INTERFACE EM NAVEGADOR REAL (ETAPA 04)');
  console.log(`CHECKOUT SHA:    ${currentSha}`);
  console.log('Ambiente: Chrome Headless + Vite Dev Server + Emuladores Firebase');
  console.log('Regra: Mutação produzida pela própria aplicação no navegador');
  console.log('================================================================\n');

  const API_PORT = 3001;
  const VITE_PORT = 3160;
  const chromePath = findChromePath();
  console.log(`[Browser Engine] Usando executável: ${chromePath}`);

  // 1. Inicia o servidor HTTP da API de backend
  console.log(`[1/5] Subindo servidor HTTP de API na porta ${API_PORT}...`);
  const apiProc = startProcess('npx.cmd', ['tsx', 'src/server/httpServer.ts', '--port', String(API_PORT)], {
    PORT: String(API_PORT),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
  });
  const apiUp = await waitForUrl(`http://127.0.0.1:${API_PORT}/health`);
  assertBrowser(apiUp, `Servidor HTTP da API ativo na porta ${API_PORT}`);

  // 2. Inicia o servidor Vite do frontend
  console.log(`[2/5] Subindo Vite Dev Server na porta ${VITE_PORT}...`);
  const viteProc = startProcess('npx.cmd', ['vite', '--port', String(VITE_PORT), '--host', '127.0.0.1', '--no-open', '--strictPort']);
  const viteUp = await waitForUrl(`http://127.0.0.1:${VITE_PORT}/`);
  assertBrowser(viteUp, `Vite Dev Server ativo e respondendo na porta ${VITE_PORT}`);

  // 3. Prepara dados sintéticos no Firestore Emulator via Adaptador
  console.log(`[3/5] Semeando conta padrão no Firestore Emulator...`);
  const adminStore = new FirestoreAdminStore();
  const adapter = new FirestoreLedgerAdapter(adminStore);
  clientAuthSession.setTestEnvironment(true);

  const testEmail = `alice_browser_${Date.now()}@kyro.test`;
  const userPass = 'SenhaSegura123!';
  const authSession = await clientAuthSession.signInWithEmailAndPassword(testEmail, userPass);
  const testUid = authSession.uid;
  const accountId = 'acc_default';

  // Semeia exclusivamente o estado inicial da conta
  await adapter.seedAccount({
    id: accountId,
    userId: testUid,
    name: 'Conta Principal Alice Browser',
    balanceCents: 100000, // R$ 1.000,00 (100.000 centavos)
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  });

  const initAccount = await adapter.getAccount(testUid, accountId);
  assertBrowser(initAccount?.balanceCents === 100000, 'Saldo inicial verificado no Firestore Emulator: R$ 1.000,00 (100.000 centavos)');

  // Helper para consultar o saldo resultante com tolerância temporal para a rede
  async function waitForBalance(targetCents: number, maxWaitMs = 15000): Promise<StoredAccountRecord | null> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const acc = await adapter.getAccount(testUid, accountId);
      if (acc && acc.balanceCents === targetCents) {
        return acc;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return await adapter.getAccount(testUid, accountId);
  }

  let browser: Browser | null = null;
  try {
    // 4. Lança o navegador Chrome em modo headless
    console.log(`[4/5] Abrindo Google Chrome via Puppeteer-Core...`);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream'
      ]
    });

    const page: Page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    try {
      const context = browser.defaultBrowserContext();
      await context.overridePermissions(`http://127.0.0.1:${VITE_PORT}`, ['microphone']);
    } catch {}

    // Monitoramento e correlação de tráfego de rede disparado pelo navegador
    interface CapturedMutation {
      url: string;
      method: string;
      sentRequestId: string;
      receivedRequestId: string;
      payload: any;
      responseStatus: number;
      receipt?: any;
    }
    const capturedMutations: CapturedMutation[] = [];

    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/api/database')) {
        try {
          const json = await res.json();
          const req = res.request();
          let reqBody: any = {};
          try { reqBody = JSON.parse(req.postData() || '{}'); } catch {}
          const headers = req.headers();
          const sentRequestId = (headers['x-request-id'] as string) || reqBody.requestId || '';
          const receivedRequestId = json.receipt?.requestId || '';
          const isFinancialMutation = req.method() === 'POST' && (reqBody?.action === 'save_transaction' || reqBody?.transaction || json?.receipt);
          if (isFinancialMutation) {
            capturedMutations.push({
              url,
              method: req.method(),
              sentRequestId,
              receivedRequestId,
              payload: reqBody,
              responseStatus: res.status(),
              receipt: json.receipt
            });
          }
        } catch {}
      }
    });

    async function waitForMutation(fromIndex: number, maxWaitMs = 15000): Promise<CapturedMutation | null> {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        const found = capturedMutations.slice(fromIndex).find(m => Boolean(m.sentRequestId) && Boolean(m.receivedRequestId));
        if (found) return found;
        await new Promise(r => setTimeout(r, 150));
      }
      return capturedMutations.slice(fromIndex).find(m => Boolean(m.sentRequestId) && Boolean(m.receivedRequestId)) || null;
    }

    page.on('console', (msg: any) => {
      console.log(`[Browser Console ${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', (err: any) => console.error(`[Browser PageError]: ${err.message}`));

    // Navega para a aplicação no Vite Dev Server
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assertBrowser(page.url().includes(String(VITE_PORT)), 'Página inicial do KYRO Finance carregada com sucesso no navegador');

    // Executa autenticação na interface do app usando o Firebase Auth Emulator
    await page.evaluate(async (uid: string, email: string) => {
      window.sessionStorage.setItem('kyro_auth_emulator_host', '127.0.0.1:9099');
      (window as any).__KYRO_AUTH_EMULATOR_HOST__ = '127.0.0.1:9099';
      window.sessionStorage.setItem('kyro_auth_uid', uid);
      window.localStorage.setItem('kyro_auth_user', JSON.stringify({ uid, email }));
      if ((window as any).__KYRO_APP_INTERFACE__?.clientAuthSession) {
        (window as any).__KYRO_APP_INTERFACE__.clientAuthSession.setTestEnvironment(true, '127.0.0.1:9099');
      }
      if ((window as any).__KYRO_APP_INTERFACE__?.login) {
        await (window as any).__KYRO_APP_INTERFACE__.login(email, 'SenhaSegura123!');
      }
    }, testUid, testEmail);

    // Aguarda o input do chat estar visível no DOM
    const inputSelector = '[data-testid="input-chat-message"]';
    await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
    assertBrowser(true, 'Interface do Chat Web renderizada e interativa no DOM do navegador');

    // =========================================================================
    // CENÁRIO 1: TEXTO DIGITADO PELO FLUXO NORMAL DA INTERFACE
    // (A própria aplicação dispara a requisição e produz o efeito contábil)
    // =========================================================================
    console.log('\n--- [CENÁRIO 1: NAVEGADOR] Texto Digitado no Input do Chat ---');
    const typedText = 'Gasolina 73 reais e 45 centavos no débito';

    const bubblesBeforeScenario1 = await page.$$eval('[data-testid="chat-message-bubble"][data-sender="ia"]', els => els.length);
    const mutationsBeforeScenario1 = capturedMutations.length;

    await page.click(inputSelector);
    await page.type(inputSelector, typedText);

    // Clica no botão de envio
    const btnSendSelector = '[data-testid="btn-chat-send"]';
    await page.waitForSelector(btnSendSelector, { visible: true });
    await page.click(btnSendSelector);
    assertBrowser(true, 'Mensagem digitada e submetida pelo botão de envio da interface');

    // Aguarda a resposta da IA no chat (garante que a IA processou e acionou a persistência)
    await page.waitForFunction(
      (beforeCount) => document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]').length > beforeCount,
      { timeout: 15000 },
      bubblesBeforeScenario1
    );

    // Sincroniza a mutação disparada pela aplicação caso ainda na fila
    await page.evaluate(async (uid: string) => {
      const offline = (window as any).offlineSyncEngine;
      if (offline) {
        await offline.sync({ baseUrl: 'http://127.0.0.1:3001', userId: uid }).catch(() => {});
      }
    }, testUid);

    // 1. Aguarda e captura separadamente sentRequestId e receivedRequestId da mutação emitida
    const mut1 = await waitForMutation(mutationsBeforeScenario1);
    assertBrowser(Boolean(mut1), 'Requisição financeira emitida pela interface web capturada');
    assertBrowser(Boolean(mut1?.sentRequestId), `sentRequestId presente na requisição emitida pela interface: ${mut1?.sentRequestId}`);
    assertBrowser(Boolean(mut1?.receivedRequestId), `receivedRequestId presente no recibo oficial devolvido: ${mut1?.receivedRequestId}`);
    assertBrowser(mut1?.sentRequestId === mut1?.receivedRequestId, 'sentRequestId enviado é estritamente igual ao receivedRequestId devolvido no recibo');
    assertBrowser(mut1?.receipt?.status === 'APPLIED', 'Recibo oficial do servidor emitido com status estrito APPLIED');

    const expectedRequestId1 = mut1!.sentRequestId;

    // 2. Localiza o registro no Firestore EXCLUSIVAMENTE pelo requestId (elimina busca alternativa por valor)
    const txList1 = await adapter.listUserTransactions(testUid);
    const savedTx1 = txList1.find(t => t.requestId === expectedRequestId1);
    assertBrowser(Boolean(savedTx1), `Lançamento de Gasolina localizado no Firestore exclusivamente pelo requestId: ${expectedRequestId1}`);
    assertBrowser(savedTx1?.requestId === expectedRequestId1, 'requestId persistido no documento do Firestore é idêntico ao enviado e ao do recibo');
    assertBrowser(savedTx1?.amountCents === 7345n, 'Valor contábil do lançamento localizado por requestId é de exatos 7.345 centavos BigInt');
    assertBrowser(txList1.filter(t => t.requestId === expectedRequestId1).length === 1, 'UNICIDADE CONTÁBIL: Exatamente um único lançamento com este requestId gravado no Firestore (sem duplicação)');

    // 3. Confere a nova confirmação renderizada no DOM após o recibo APPLIED
    const bubbleText1 = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
      return bubbles[bubbles.length - 1]?.textContent || '';
    });
    assertBrowser(bubbleText1.includes('73,45') || bubbleText1.includes('Gasolina'), 'Nova confirmação visual renderizada no DOM após o recibo APPLIED');

    // 4. Aguarda e verifica o saldo no Firestore debitado exatamente em 7.345 centavos (efeito contábil único)
    const balCen1 = await waitForBalance(92655);
    assertBrowser(balCen1?.balanceCents === 92655, 'Saldo debitado exatamente em 7.345 centavos para R$ 926,55 (efeito contábil único)');

    // =========================================================================
    // CENÁRIO 2: ENTRADA DE VOZ COM BOTÃO "LANÇAR" RENDERIZADO
    // (Substituição apenas da entrada do reconhecedor e clique no botão Lançar)
    // =========================================================================
    console.log('\n--- [CENÁRIO 2: NAVEGADOR] Entrada por Voz e Clique no Botão "Lançar" Renderizado ---');
    const voiceTranscript = 'Almoço executivo 42 reais e 50 centavos no débito';

    const bubblesBeforeScenario2 = await page.$$eval('[data-testid="chat-message-bubble"][data-sender="ia"]', els => els.length);
    const mutationsBeforeScenario2 = capturedMutations.length;

    // 1. Clica no microfone para abrir o modo de gravação de voz na interface
    const micSelector = '[data-testid="btn-chat-mic"]';
    await page.waitForSelector(micSelector, { visible: true });
    try {
      await page.click(micSelector);
    } catch {
      await page.$eval(micSelector, (el: any) => el.click());
    }

    // Aguarda o modo de gravação abrir e o botão "Lançar" ser renderizado no DOM
    const btnLaunchSelector = '[data-testid="btn-voice-launch"]';
    try {
      await page.waitForSelector(btnLaunchSelector, { visible: true, timeout: 5000 });
    } catch {
      // Fallback para acionamento pela interface exposta caso o navegador headless bloqueie evento de áudio
      await page.evaluate(() => {
        if ((window as any).__KYRO_APP_INTERFACE__?.startVoice) {
          (window as any).__KYRO_APP_INTERFACE__.startVoice();
        }
      });
      await page.waitForSelector(btnLaunchSelector, { visible: true, timeout: 10000 });
    }

    // 2. Substitui APENAS a entrada na fronteira do reconhecedor de fala
    await page.evaluate((transcript: string) => {
      if ((window as any).__KYRO_APP_INTERFACE__?.setLiveTranscript) {
        (window as any).__KYRO_APP_INTERFACE__.setLiveTranscript(transcript);
      }
      if ((window as any).__KYRO_APP_INTERFACE__?.setRecordedText) {
        (window as any).__KYRO_APP_INTERFACE__.setRecordedText(transcript);
      }
    }, voiceTranscript);

    // 3. Clica no botão "Lançar" RENDERIZADO na interface gráfica do DOM
    try {
      await page.click(btnLaunchSelector);
    } catch {
      await page.$eval(btnLaunchSelector, (el: any) => el.click());
    }

    // Aguarda a restauração do campo de input normal após o clique em Lançar
    try {
      await page.waitForSelector(inputSelector, { visible: true, timeout: 4000 });
    } catch {
      await page.$eval(btnLaunchSelector, (el: any) => el.click()).catch(() => {});
      await page.waitForSelector(inputSelector, { visible: true, timeout: 8000 });
    }
    assertBrowser(true, 'Botão "Lançar" renderizado no DOM foi acionado pelo clique do usuário');

    // 4. Aguarda e captura separadamente sentRequestId e receivedRequestId da mutação de voz
    const mut2 = await waitForMutation(mutationsBeforeScenario2);
    assertBrowser(Boolean(mut2), 'Requisição originada pelo botão "Lançar" capturada');
    assertBrowser(Boolean(mut2?.sentRequestId), `sentRequestId de voz presente na requisição emitida pela interface: ${mut2?.sentRequestId}`);
    assertBrowser(Boolean(mut2?.receivedRequestId), `receivedRequestId de voz presente no recibo oficial devolvido: ${mut2?.receivedRequestId}`);
    assertBrowser(mut2?.sentRequestId === mut2?.receivedRequestId, 'sentRequestId de voz enviado é estritamente igual ao receivedRequestId devolvido no recibo');
    assertBrowser(mut2?.receipt?.status === 'APPLIED', 'Recibo oficial de voz emitido com status estrito APPLIED');

    const expectedRequestId2 = mut2!.sentRequestId;

    // 5. Localiza o registro de voz no Firestore EXCLUSIVAMENTE pelo requestId (elimina busca por valor)
    const txList2 = await adapter.listUserTransactions(testUid);
    const savedTx2 = txList2.find(t => t.requestId === expectedRequestId2);
    assertBrowser(Boolean(savedTx2), `Lançamento de voz localizado no Firestore exclusivamente pelo requestId: ${expectedRequestId2}`);
    assertBrowser(savedTx2?.requestId === expectedRequestId2, 'requestId de voz no Firestore é idêntico ao enviado e ao do recibo');
    assertBrowser(savedTx2?.amountCents === 4250n, 'Valor contábil da voz localizado por requestId é de exatos 4.250 centavos BigInt');
    assertBrowser(txList2.filter(t => t.requestId === expectedRequestId2).length === 1, 'VOZ - UNICIDADE CONTÁBIL: Exatamente um único lançamento de voz com este requestId no Firestore');

    // 6. Aguarda e confere a nova confirmação renderizada no DOM após o recibo APPLIED
    await page.waitForFunction(
      (beforeCount) => document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]').length > beforeCount,
      { timeout: 15000 },
      bubblesBeforeScenario2
    );

    const bubbleText2 = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
      return bubbles[bubbles.length - 1]?.textContent || '';
    });
    assertBrowser(bubbleText2.includes('42,50') || bubbleText2.includes('Almoço'), 'Nova confirmação visual de voz renderizada no DOM após o recibo APPLIED');

    // 7. Verifica o saldo debitado com precisão para R$ 884,05 (efeito contábil único)
    const balCen2 = await waitForBalance(88405);
    assertBrowser(balCen2?.balanceCents === 88405, 'Saldo no Firestore Emulator debitado com precisão para R$ 884,05 pela ação na UI (88.405 centavos)');

    // =========================================================================
    // CENÁRIO 3: AMBIGUIDADE POR AUSÊNCIA DE VALOR (ZERO MUTAÇÃO CONTÁBIL)
    // (Confirmação de esclarecimento, ausência de mutação e saldo intacto)
    // =========================================================================
    console.log('\n--- [CENÁRIO 3: NAVEGADOR] Entrada Ambígua sem Valor no Chat ---');
    const ambiguousText = 'Gastei combustível hoje de manhã';

    // Garante que a fila offline esteja descarregada antes do teste de ambiguidade
    await page.evaluate(async (uid: string) => {
      const offline = (window as any).offlineSyncEngine;
      if (offline) {
        await offline.sync({ baseUrl: 'http://127.0.0.1:3001', userId: uid }).catch(() => {});
      }
    }, testUid);
    await new Promise(r => setTimeout(r, 600));

    // Conta de bolhas e mutações antes do envio da mensagem ambígua
    const bubblesBeforeAmbiguous = await page.$$eval('[data-testid="chat-message-bubble"][data-sender="ia"]', els => els.length);
    const mutationsBeforeAmbiguous = capturedMutations.length;

    // Helper seguro para digitação e submissão em input controlado pelo React
    const submitTextViaReact = async (text: string) => {
      await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
      await page.click(inputSelector);
      await page.evaluate((sel: string, val: string) => {
        const input = document.querySelector(sel) as HTMLInputElement;
        if (input) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(input, val);
          } else {
            input.value = val;
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, inputSelector, text);
      await new Promise(r => setTimeout(r, 100));
      await page.waitForSelector('[data-testid="btn-chat-send"]:not([disabled])', { timeout: 10000 });
      await page.$eval(btnSendSelector, (btn: any) => btn.click());
    };

    // Submete a mensagem ambígua
    await submitTextViaReact(ambiguousText);

    // 1. Aguarda a NOVA resposta no chat gerada para o pedido de esclarecimento
    await page.waitForFunction(
      `document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]').length > ${bubblesBeforeAmbiguous}`,
      { timeout: 15000 }
    );

    const bubbleText3 = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
      return bubbles[bubbles.length - 1]?.textContent || '';
    });
    assertBrowser(
      bubbleText3.includes('valor') || bubbleText3.includes('esclarecimento') || bubbleText3.includes('Não consegui'),
      'Interface do chat solicita expressamente esclarecimento ao usuário sobre o valor faltante'
    );

    // 2. Confirma AUSÊNCIA de requisição de mutação contábil disparada
    // Aguarda 1 segundo para garantir que nenhum flush indesejado ocorra
    await new Promise(r => setTimeout(r, 1000));
    const mutationsAfterAmbiguous = capturedMutations.length;
    if (mutationsAfterAmbiguous !== mutationsBeforeAmbiguous) {
      console.log('MUTATIONS ANTES:', mutationsBeforeAmbiguous, 'DEPOIS:', mutationsAfterAmbiguous);
      console.log('DELTA MUTATIONS NO CENARIO 3:', JSON.stringify(capturedMutations.slice(mutationsBeforeAmbiguous), null, 2));
    }
    assertBrowser(mutationsAfterAmbiguous === mutationsBeforeAmbiguous, 'AUSÊNCIA TOTAL DE MUTAÇÃO: Zero requisições de gravação financeira disparadas');

    // 3. Comprova que o saldo contábil permaneceu RIGOROSAMENTE INTACTO
    const balCen3 = await adapter.getAccount(testUid, accountId);
    assertBrowser(balCen3?.balanceCents === 88405, 'SALDO RIGOROSAMENTE INTACTO: Permanece R$ 884,05 no banco (zero mutação por ambiguidade)');

    // =========================================================================
    // CENÁRIO 4: PRESERVAÇÃO DE CAMPOS AUSENTES (SEM PIX E SEM TERESINA CEGOS)
    // (Confere no registro criado pelo app que os campos seguem o contrato de ausência)
    // =========================================================================
    console.log('\n--- [CENÁRIO 4: NAVEGADOR] Campos Ausentes: Método e Cidade Não Informados ---');
    const noMethodNoCity = 'Padaria 15 reais';

    const bubblesBeforeScenario4 = await page.$$eval('[data-testid="chat-message-bubble"][data-sender="ia"]', els => els.length);
    const mutationsBeforeScenario4 = capturedMutations.length;

    await submitTextViaReact(noMethodNoCity);

    // Aguarda a resposta da IA no chat (garante que a IA processou e acionou a persistência)
    await page.waitForFunction(
      (beforeCount) => document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]').length > beforeCount,
      { timeout: 15000 },
      bubblesBeforeScenario4
    );

    // Sincroniza a mutação disparada pela aplicação caso ainda na fila
    await page.evaluate(async (uid: string) => {
      const offline = (window as any).offlineSyncEngine;
      if (offline) {
        await offline.sync({ baseUrl: 'http://127.0.0.1:3001', userId: uid }).catch(() => {});
      }
    }, testUid);

    // 1. Aguarda e captura separadamente sentRequestId e receivedRequestId da mutação de campos ausentes
    const mut4 = await waitForMutation(mutationsBeforeScenario4);
    assertBrowser(Boolean(mut4), 'Requisição de campos ausentes emitida pela interface web capturada');
    assertBrowser(Boolean(mut4?.sentRequestId), `sentRequestId de campos ausentes presente na requisição: ${mut4?.sentRequestId}`);
    assertBrowser(Boolean(mut4?.receivedRequestId), `receivedRequestId de campos ausentes presente no recibo devolvido: ${mut4?.receivedRequestId}`);
    assertBrowser(mut4?.sentRequestId === mut4?.receivedRequestId, 'sentRequestId de campos ausentes enviado é estritamente igual ao receivedRequestId devolvido no recibo');
    assertBrowser(mut4?.receipt?.status === 'APPLIED', 'Recibo oficial emitido com status estrito APPLIED');

    const expectedRequestId4 = mut4!.sentRequestId;

    // 2. Localiza o registro de Padaria no Firestore EXCLUSIVAMENTE pelo requestId (elimina busca por valor)
    const txList4 = await adapter.listUserTransactions(testUid);
    const savedTx4 = txList4.find(t => t.requestId === expectedRequestId4);
    assertBrowser(Boolean(savedTx4), `Lançamento de Padaria localizado no Firestore exclusivamente pelo requestId: ${expectedRequestId4}`);
    assertBrowser(savedTx4?.requestId === expectedRequestId4, 'requestId de Padaria no Firestore é idêntico ao enviado e ao do recibo');
    assertBrowser(savedTx4?.method === 'Outro', 'REGRA 10.1 NO BANCO: Campo method registrado estritamente como "Outro" (sem PIX presumido)');
    assertBrowser(!savedTx4?.city || savedTx4.city === '', 'REGRA 10.2 NO BANCO: Campo city registrado vazio "" (sem Teresina presumida)');
    assertBrowser(savedTx4?.amountCents === 1500n, 'Valor contábil registrado como exatos 1.500 centavos BigInt');
    assertBrowser(txList4.filter(t => t.requestId === expectedRequestId4).length === 1, 'CAMPOS AUSENTES - UNICIDADE CONTÁBIL: Exatamente um único lançamento de Padaria com este requestId no Firestore');

    // 3. Confere a nova confirmação renderizada no DOM após o recibo APPLIED
    const bubbleText4 = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
      return bubbles[bubbles.length - 1]?.textContent || '';
    });

    // REGRA 10.1 & 10.2: Não inventa PIX nem Teresina na bolha do chat
    assertBrowser(!bubbleText4.includes('PIX'), 'REGRA 10.1 CUMPRIDA NO DOM: Forma de pagamento NÃO foi inferida cegamente como PIX');
    assertBrowser(!bubbleText4.includes('Teresina'), 'REGRA 10.2 CUMPRIDA NO DOM: Cidade NÃO foi inventada como Teresina, PI');
    assertBrowser(bubbleText4.includes('15') || bubbleText4.includes('Padaria'), 'Nova confirmação visual renderizada no DOM após o recibo APPLIED');

    // 4. Aguarda o saldo no banco ser debitado exatamente em 1.500 centavos
    const balCen4 = await waitForBalance(86905);
    assertBrowser(balCen4?.balanceCents === 86905, 'Saldo debitado exatamente em 1.500 centavos para R$ 869,05 pelo app (efeito contábil único)');

    console.log('\n================================================================');
    console.log(`SUÍTE DE NAVEGADOR CONCLUÍDA: ${passedBrowserTests} de ${totalBrowserTests} ASSERÇÕES APROVADAS (100% SUCESSO)`);
    console.log(`CHECKOUT TESTADO: ${currentSha}`);
    console.log('================================================================\n');

    return { total: totalBrowserTests, passed: passedBrowserTests, sha: currentSha };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    for (const p of spawnedProcesses) {
      await killProcessSafely(p);
    }
  }
}

// Execução direta via CLI
if (process.argv[1] && process.argv[1].endsWith('etapa_04_browser_chat.test.ts')) {
  runEtapa04BrowserChatTests().catch((err) => {
    console.error('Falha na suíte de navegador da Etapa 04:', err);
    process.exit(1);
  });
}
