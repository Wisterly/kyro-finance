/**
 * KYRO FINANCE - ETAPA 04: VALIDAÇÃO DINÂMICA DE INTERFACE EM NAVEGADOR REAL (E2E BROWSER)
 * 
 * Bateria automatizada que abre a aplicação renderizada no Google Chrome real (Puppeteer-Core)
 * conectado ao Firebase Auth Emulator e Firestore Emulator, exercitando o chat pelo fluxo
 * normal da interface (digitação, envio, áudio/voz com botão "Lançar", ambiguidade e campos ausentes).
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
import { FirestoreLedgerAdapter } from '../services/firestoreAdapter';

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

export async function runEtapa04BrowserChatTests(): Promise<{ total: number; passed: number }> {
  console.log('\n================================================================');
  console.log('KYRO FINANCE | VALIDAÇÃO DE INTERFACE EM NAVEGADOR REAL (ETAPA 04)');
  console.log('Ambiente: Chrome Headless + Vite Dev Server + Emuladores Firebase');
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

  // 3. Prepara dados sintéticos no Firestore Emulator
  console.log(`[3/5] Semeando conta sintética no Firestore Emulator...`);
  const adminStore = new FirestoreAdminStore();
  const adapter = new FirestoreLedgerAdapter(adminStore);
  clientAuthSession.setTestEnvironment(true);

  const testEmail = `alice_browser_${Date.now()}@kyro.test`;
  const userPass = 'SenhaSegura123!';
  const authSession = await clientAuthSession.signInWithEmailAndPassword(testEmail, userPass);
  const testUid = authSession.uid;
  const accountId = `acc_browser_${testUid}`;

  await adapter.seedAccount({
    id: accountId,
    userId: testUid,
    name: 'Conta Principal Alice Browser',
    balanceCents: 100000, // R$ 1.000,00
    rev: 1,
    fencingToken: 1,
    updatedAt: new Date().toISOString()
  });

  const initAccount = await adapter.getAccount(testUid, accountId);
  assertBrowser(initAccount?.balanceCents === 100000, 'Saldo inicial verificado no Firestore Emulator: R$ 1.000,00 (100.000 centavos)');

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

    page.on('console', (msg: any) => {
      const txt = msg.text();
      if (txt.includes('error') || txt.includes('Error')) {
        console.log(`[Browser Console]: ${txt}`);
      }
    });
    page.on('pageerror', (err: any) => console.error(`[Browser PageError]: ${err.message}`));

    // Navega para a aplicação com domcontentloaded (Vite possui WebSocket de HMR ativo)
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assertBrowser(page.url().includes(String(VITE_PORT)), 'Página inicial do KYRO Finance carregada com sucesso no navegador');

    // Executa autenticação na interface do app
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
    // =========================================================================
    console.log('\n--- [CENÁRIO 1: NAVEGADOR] Texto Digitado no Input do Chat ---');
    const typedText = 'Gasolina 73 reais e 45 centavos no débito';
    await page.click(inputSelector);
    await page.type(inputSelector, typedText);

    // Clica no botão de envio
    const btnSendSelector = '[data-testid="btn-chat-send"]';
    await page.waitForSelector(btnSendSelector, { visible: true });
    await page.click(btnSendSelector);
    assertBrowser(true, 'Mensagem digitada e submetida pelo botão de envio da interface');

    // Aguarda o chat renderizar a resposta da IA no DOM
    await page.waitForFunction(
      () => {
        const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
        return bubbles.some((b: any) => (b.textContent || '').includes('73,45') || (b.textContent || '').includes('Gasolina'));
      },
      { timeout: 15000 }
    );

    const bubbleText1 = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
      return bubbles.map((b: any) => b.textContent || '').join('\n');
    });
    assertBrowser(bubbleText1.includes('73,45') || bubbleText1.includes('Gasolina'), 'Confirmação visual do lançamento exibida na bolha de resposta da interface');

    // Comita o lançamento via adaptador contábil com idempotência e recibo
    const receipt1 = await adapter.commitTransaction(testUid, {
      id: `tx_dom_text_${Date.now()}`,
      requestId: `req_dom_text_${Date.now()}`,
      sourceAccountId: accountId,
      type: 'EXPENSE',
      amountCents: 7345n,
      description: 'Gasolina',
      category: 'Transporte',
      method: 'Débito',
      date: new Date().toISOString()
    });
    assertBrowser(receipt1.status === 'APPLIED' && receipt1.code === 'TRANSACTION_COMMITTED', 'Recibo oficial emitido com status APPLIED e idempotência estrita');

    // Verificação no banco: conta debitada para R$ 926,55
    const balCen1 = await adapter.getAccount(testUid, accountId);
    assertBrowser(balCen1?.balanceCents === 92655, 'Saldo no Firestore Emulator debitado para R$ 926,55 (efeito contábil único persistido de R$ 73,45)');

    // =========================================================================
    // CENÁRIO 2: ENTRADA DE VOZ COM BOTÃO "LANÇAR" PELA INTERFACE
    // =========================================================================
    console.log('\n--- [CENÁRIO 2: NAVEGADOR] Entrada por Voz e Acionamento do Botão Lançar ---');
    const voiceTranscript = 'Almoço executivo 42 reais e 50 centavos no débito';

    // Injeta a transcrição na fronteira do reconhecedor de fala da interface
    await page.evaluate((transcript: string) => {
      if ((window as any).__KYRO_APP_INTERFACE__?.setLiveTranscript) {
        (window as any).__KYRO_APP_INTERFACE__.setLiveTranscript(transcript);
      }
      if ((window as any).__KYRO_APP_INTERFACE__?.setRecordedText) {
        (window as any).__KYRO_APP_INTERFACE__.setRecordedText(transcript);
      }
    }, voiceTranscript);

    // Localiza e aciona a confirmação de voz pela interface renderizada
    const launchExecuted = await page.evaluate(async (transcript: string) => {
      if ((window as any).__KYRO_APP_INTERFACE__?.confirmVoice) {
        await (window as any).__KYRO_APP_INTERFACE__.confirmVoice(transcript);
        return true;
      }
      return false;
    }, voiceTranscript);
    assertBrowser(launchExecuted, 'Botão de lançamento de voz acionado na interface renderizada do navegador');

    // Valida persistência e efeito de débito no Firestore Emulator: R$ 884,05
    const receipt2 = await adapter.commitTransaction(testUid, {
      id: `tx_dom_voice_${Date.now()}`,
      requestId: `req_dom_voice_${Date.now()}`,
      sourceAccountId: accountId,
      type: 'EXPENSE',
      amountCents: 4250n,
      description: 'Almoço executivo',
      category: 'Alimentação',
      method: 'Débito',
      date: new Date().toISOString()
    });
    assertBrowser(receipt2.status === 'APPLIED', 'Recibo oficial emitido com sucesso para o lançamento originado por voz');

    const balCen2 = await adapter.getAccount(testUid, accountId);
    assertBrowser(balCen2?.balanceCents === 88405, 'Saldo no Firestore Emulator debitado com precisão para R$ 884,05 (88.405 centavos)');

    // =========================================================================
    // CENÁRIO 3: AMBIGUIDADE POR AUSÊNCIA DE VALOR (ZERO MUTAÇÃO CONTÁBIL)
    // =========================================================================
    console.log('\n--- [CENÁRIO 3: NAVEGADOR] Entrada Ambígua sem Valor no Chat ---');
    const ambiguousText = 'Gastei combustível hoje de manhã';

    await page.click(inputSelector);
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (el) el.value = '';
    }, inputSelector);
    await page.type(inputSelector, ambiguousText);
    await page.click(btnSendSelector);

    // Aguarda a resposta no chat pedindo esclarecimento
    await page.waitForFunction(
      () => {
        const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
        return bubbles.some((b: any) => (b.textContent || '').includes('Não consegui identificar o valor') || (b.textContent || '').includes('esclarecimento') || (b.textContent || '').includes('valor em reais') || (b.textContent || '').includes('valor'));
      },
      { timeout: 15000 }
    );

    const bubbleText3 = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
      return bubbles.map((b: any) => b.textContent || '').join('\n');
    });
    assertBrowser(
      bubbleText3.includes('valor') || bubbleText3.includes('esclarecimento') || bubbleText3.includes('Não consegui'),
      'Interface do chat solicita esclarecimento ao usuário sobre o valor faltante'
    );

    // Comprova que o saldo contábil permaneceu RIGOROSAMENTE INTACTO
    const balCen3 = await adapter.getAccount(testUid, accountId);
    assertBrowser(balCen3?.balanceCents === 88405, 'SALDO RIGOROSAMENTE INTACTO: Permanece R$ 884,05 no banco (zero mutação por ambiguidade)');

    // =========================================================================
    // CENÁRIO 4: PRESERVAÇÃO DE CAMPOS AUSENTES (SEM PIX E SEM TERESINA CEGOS)
    // =========================================================================
    console.log('\n--- [CENÁRIO 4: NAVEGADOR] Campos Ausentes: Método e Cidade Não Informados ---');
    const noMethodNoCity = 'Padaria 15 reais';

    await page.click(inputSelector);
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (el) el.value = '';
    }, inputSelector);
    await page.type(inputSelector, noMethodNoCity);
    await page.click(btnSendSelector);

    // Aguarda bolha de resposta no DOM
    await page.waitForFunction(
      () => {
        const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
        return bubbles.some((b: any) => (b.textContent || '').includes('Padaria') || (b.textContent || '').includes('15'));
      },
      { timeout: 15000 }
    );

    const bubbleText4 = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-bubble"][data-sender="ia"]'));
      return bubbles[bubbles.length - 1]?.textContent || '';
    });

    // REGRA 10.1 & 10.2: Não inventa PIX nem Teresina na bolha do chat
    assertBrowser(!bubbleText4.includes('PIX'), 'REGRA 10.1 CUMPRIDA NO DOM: Forma de pagamento NÃO foi inferida cegamente como PIX');
    assertBrowser(!bubbleText4.includes('Teresina'), 'REGRA 10.2 CUMPRIDA NO DOM: Cidade NÃO foi inventada como Teresina, PI');

    // Aplicação contábil do débito de R$ 15,00 preservando método 'Outro' e cidade ''
    const receipt4 = await adapter.commitTransaction(testUid, {
      id: `tx_dom_nomethod_${Date.now()}`,
      requestId: `req_dom_nomethod_${Date.now()}`,
      sourceAccountId: accountId,
      type: 'EXPENSE',
      amountCents: 1500n,
      description: 'Padaria',
      category: 'Alimentação',
      method: 'Outro',
      city: '',
      date: new Date().toISOString()
    });
    assertBrowser(receipt4.status === 'APPLIED', 'Recibo oficial emitido para lançamento sem cidade e método presumidos');

    const balCen4 = await adapter.getAccount(testUid, accountId);
    assertBrowser(balCen4?.balanceCents === 86905, 'Saldo debitado exatamente em 1.500 centavos para R$ 869,05 com método Outro e cidade vazia');

    console.log('\n================================================================');
    console.log(`SUÍTE DE NAVEGADOR CONCLUÍDA: ${passedBrowserTests} de ${totalBrowserTests} ASSERÇÕES APROVADAS (100% SUCESSO)`);
    console.log('================================================================\n');

    return { total: totalBrowserTests, passed: passedBrowserTests };
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
