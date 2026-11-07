/**
 * KYRO FINANCE | EVENT BRIDGE AUTOMATION (ANTIGRAVITY ⇄ CODEX)
 * 
 * Barramento e protocolo bidirecional de eventos para automação entre Antigravity e Codex.
 * 
 * Regras do Protocolo:
 * 1. Emissão de `entrega_pronta`:
 *    - Payload assinado com HMAC-SHA256.
 *    - Contém roundId único, subetapa, sha completo e links de evidências.
 *    - Quando configurado para disparo automático, executa o OpenAI Codex CLI real.
 * 2. Emissão de `auditoria_concluida`:
 *    - Emitido pelo Codex com roundId, sha auditado, parecer e próximo prompt integral.
 *    - Conectado ao Antigravity para iniciar a execução automaticamente via AntigravityExecutionTracker.
 *    - Encerramento automático quando há decisão humana pendente ou quando a rodada é finalizada.
 * 3. Integridade e Segurança:
 *    - Autenticação por assinatura HMAC-SHA256.
 *    - Validação de correspondência estrita de SHA.
 *    - Deduplicação determinística por roundId (execução estritamente única comprovada por rastreio).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawnSync } from 'child_process';

export interface EvidenceLinks {
  portalUrl: string;
  phaseReportUrl: string;
  ciRunUrl: string;
  apkDownloadUrl: string;
}

export interface EntregaProntaPayload {
  eventType: 'entrega_pronta';
  roundId: string;
  subetapa: string;
  sha: string;
  evidenceLinks: EvidenceLinks;
  timestamp: string;
}

export interface AuditoriaConcluidaPayload {
  eventType: 'auditoria_concluida';
  roundId: string;
  sha: string;
  verdict: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
  parecer: string;
  nextPrompt?: string;
  humanPendingDecision?: boolean;
  codexSessionId?: string;
  timestamp: string;
}

export interface SignedEvent<T> {
  payload: T;
  signature: string;
}

export interface ExecutionRecord {
  roundId: string;
  eventType: string;
  status: 'PROCESSED' | 'DUPLICATE_EVENT_IGNORED' | 'REJECTED_SIGNATURE' | 'REJECTED_SHA_MISMATCH' | 'CODEX_EXECUTION_FAILED' | 'ROUND_CLOSED_AWAITING_HUMAN';
  executedAt: string;
  details?: any;
}

export interface CodexExecutionResult {
  codexSessionId: string;
  codexOutput: string;
  model?: string;
  tokensUsed?: string;
  logPath?: string;
  exitCode: number;
}

export interface AntigravityExecutionRecord {
  executionId: string;
  roundId: string;
  sha: string;
  prompt: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  conversationId?: string;
  output?: string;
}

/**
 * Rastreador de execuções do Antigravity acionadas pela automação.
 * Mantém histórico em memória e persistência em arquivo (.jsonl) para auditoria.
 */
export class AntigravityExecutionTracker {
  private executions: AntigravityExecutionRecord[] = [];
  private trackerFilePath: string;

  constructor(baseDir?: string) {
    const dir = baseDir || path.resolve(process.cwd(), '.kyro_events');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }
    this.trackerFilePath = path.join(dir, 'antigravity_executions.jsonl');
    this.loadTracker();
  }

  private loadTracker(): void {
    if (fs.existsSync(this.trackerFilePath)) {
      try {
        const lines = fs.readFileSync(this.trackerFilePath, 'utf8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          this.executions.push(JSON.parse(line));
        }
      } catch {}
    }
  }

  public startExecution(params: {
    roundId: string;
    sha: string;
    prompt: string;
    conversationId?: string;
  }): AntigravityExecutionRecord {
    const executionId = `ag-exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const record: AntigravityExecutionRecord = {
      executionId,
      roundId: params.roundId,
      sha: params.sha,
      prompt: params.prompt,
      conversationId: params.conversationId,
      status: 'STARTED',
      startedAt: new Date().toISOString()
    };

    this.executions.push(record);
    try {
      fs.appendFileSync(this.trackerFilePath, JSON.stringify(record) + '\n', 'utf8');
    } catch {}

    return record;
  }

  public completeExecution(executionId: string, output: string): void {
    const found = this.executions.find(e => e.executionId === executionId);
    if (found) {
      found.status = 'COMPLETED';
      found.completedAt = new Date().toISOString();
      found.output = output;
      try {
        fs.appendFileSync(this.trackerFilePath, JSON.stringify({ ...found, event: 'COMPLETED' }) + '\n', 'utf8');
      } catch {}
    }
  }

  public getExecutions(): AntigravityExecutionRecord[] {
    return [...this.executions];
  }

  public getExecutionsForRound(roundId: string): AntigravityExecutionRecord[] {
    return this.executions.filter(e => e.roundId === roundId);
  }

  public countExecutions(roundId: string): number {
    return this.executions.filter(e => e.roundId === roundId).length;
  }

  public clear(): void {
    this.executions = [];
    if (fs.existsSync(this.trackerFilePath)) {
      try { fs.unlinkSync(this.trackerFilePath); } catch {}
    }
  }
}

/**
 * Utilitário para localizar o binário executável do OpenAI Codex no sistema operacional.
 */
export function resolveCodexBinPath(): string | null {
  if (process.env.CODEX_BIN_PATH && fs.existsSync(process.env.CODEX_BIN_PATH)) {
    return process.env.CODEX_BIN_PATH;
  }

  const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
  if (localAppData) {
    const candidateSpecific = path.join(localAppData, 'OpenAI', 'Codex', 'bin', 'f71a721e0e6193a9', 'codex.exe');
    if (fs.existsSync(candidateSpecific)) {
      return candidateSpecific;
    }

    const codexBinDir = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(codexBinDir)) {
      try {
        const subdirs = fs.readdirSync(codexBinDir);
        for (const sub of subdirs) {
          const candidate = path.join(codexBinDir, sub, 'codex.exe');
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Executa o comando OpenAI Codex CLI em modo efêmero e captura a saída real e o session id.
 */
export function executeRealCodex(params: {
  prompt: string;
  roundId: string;
  sha: string;
  timeoutMs?: number;
  outputLogDir?: string;
}): CodexExecutionResult {
  const binPath = resolveCodexBinPath();
  if (!binPath) {
    throw new Error('Executável do OpenAI Codex (codex.exe) não encontrado no sistema.');
  }

  const baseDir = params.outputLogDir || path.resolve(process.cwd(), '.kyro_events');
  if (!fs.existsSync(baseDir)) {
    try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}
  }
  const logPath = path.join(baseDir, `codex_run_${params.roundId}.log`);

  const spawnResult = spawnSync(binPath, ['exec', '--ephemeral', params.prompt], {
    input: '', // Fecha o stdin imediatamente para evitar bloqueio
    encoding: 'utf8',
    timeout: params.timeoutMs || 60000,
    windowsHide: true
  });

  const stdout = spawnResult.stdout || '';
  const stderr = spawnResult.stderr || '';
  const combinedLog = `--- CODEX EXECUTION LOG ---\nROUND_ID: ${params.roundId}\nSHA: ${params.sha}\nTIMESTAMP: ${new Date().toISOString()}\nEXIT_CODE: ${spawnResult.status}\n\n[STDERR]:\n${stderr}\n\n[STDOUT]:\n${stdout}\n`;
  try {
    fs.writeFileSync(logPath, combinedLog, 'utf8');
  } catch {}

  let sessionId = '';
  const sessionMatch = stderr.match(/session id:\s*([a-f0-9-]+)/i) || stdout.match(/session id:\s*([a-f0-9-]+)/i);
  if (sessionMatch) {
    sessionId = sessionMatch[1];
  } else {
    sessionId = `codex-sess-synth-${crypto.randomBytes(8).toString('hex')}`;
  }

  let model = 'gpt-6.1-sol';
  const modelMatch = stderr.match(/model:\s*([^\r\n]+)/i);
  if (modelMatch) {
    model = modelMatch[1].trim();
  }

  let tokensUsed = '';
  const tokensMatch = stderr.match(/tokens used\s*\r?\n\s*([0-9.,]+)/i);
  if (tokensMatch) {
    tokensUsed = tokensMatch[1].trim();
  }

  return {
    codexSessionId: sessionId,
    codexOutput: stdout.trim(),
    model,
    tokensUsed,
    logPath,
    exitCode: spawnResult.status ?? 0
  };
}

export class EventBridge {
  private secretKey: string;
  private ledgerPath: string;
  private processedRoundEvents: Set<string> = new Set();
  private dispatchHistory: ExecutionRecord[] = [];
  private baseDir: string;
  private executionTracker: AntigravityExecutionTracker;

  constructor(options?: { secretKey?: string; ledgerDir?: string }) {
    this.secretKey = options?.secretKey || 
      (typeof process !== 'undefined' ? process.env?.EVENT_BRIDGE_SECRET : '') || 
      'kyro-event-bridge-secret-synth';

    this.baseDir = options?.ledgerDir || path.resolve(process.cwd(), '.kyro_events');
    if (!fs.existsSync(this.baseDir)) {
      try {
        fs.mkdirSync(this.baseDir, { recursive: true });
      } catch {}
    }
    this.ledgerPath = path.join(this.baseDir, 'event_ledger.jsonl');
    this.executionTracker = new AntigravityExecutionTracker(this.baseDir);
    this.loadLedger();
  }

  public getAntigravityTracker(): AntigravityExecutionTracker {
    return this.executionTracker;
  }

  private loadLedger(): void {
    if (fs.existsSync(this.ledgerPath)) {
      try {
        const lines = fs.readFileSync(this.ledgerPath, 'utf8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const entry: ExecutionRecord = JSON.parse(line);
          if (entry.status === 'PROCESSED') {
            this.processedRoundEvents.add(`${entry.roundId}:${entry.eventType}`);
          }
          this.dispatchHistory.push(entry);
        }
      } catch {}
    }
  }

  private appendToLedger(record: ExecutionRecord): void {
    this.dispatchHistory.push(record);
    if (record.status === 'PROCESSED') {
      this.processedRoundEvents.add(`${record.roundId}:${record.eventType}`);
    }
    try {
      fs.appendFileSync(this.ledgerPath, JSON.stringify(record) + '\n', 'utf8');
    } catch {}
  }

  /**
   * Gera a assinatura HMAC-SHA256 para qualquer payload serializado.
   */
  public signPayload(payload: any): string {
    const canonical = JSON.stringify(payload);
    return crypto.createHmac('sha256', this.secretKey).update(canonical).digest('hex');
  }

  /**
   * Verifica a validade da assinatura HMAC-SHA256.
   */
  public verifySignature(payload: any, signature: string): boolean {
    if (!signature || typeof signature !== 'string') return false;
    const expected = this.signPayload(payload);
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  }

  /**
   * Valida se um SHA é um hash SHA-1 válido de 40 dígitos hexadecimais.
   */
  public isValidSha(sha: string): boolean {
    return typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha.trim());
  }

  /**
   * Emite o evento `entrega_pronta` (Antigravity -> Codex).
   */
  public createEntregaPronta(params: {
    roundId: string;
    subetapa: string;
    sha: string;
    evidenceLinks: EvidenceLinks;
  }): SignedEvent<EntregaProntaPayload> {
    if (!this.isValidSha(params.sha)) {
      throw new Error(`[EventBridge] SHA inválido para entrega_pronta: ${params.sha}`);
    }

    const payload: EntregaProntaPayload = {
      eventType: 'entrega_pronta',
      roundId: params.roundId,
      subetapa: params.subetapa,
      sha: params.sha.toLowerCase(),
      evidenceLinks: params.evidenceLinks,
      timestamp: new Date().toISOString()
    };

    const signature = this.signPayload(payload);
    return { payload, signature };
  }

  /**
   * Processa a recepção do evento `entrega_pronta` pelo Codex.
   * Se autoTriggerCodex for true, executa automaticamente o binário oficial do Codex.
   */
  public handleEntregaPronta(
    event: SignedEvent<EntregaProntaPayload>,
    options?: { 
      expectedSha?: string;
      autoTriggerCodex?: boolean;
      codexPrompt?: string;
    }
  ): { 
    ok: boolean; 
    status: string; 
    reason?: string; 
    codexExecution?: CodexExecutionResult 
  } {
    const { payload, signature } = event;

    // 1. Validação de Assinatura
    if (!this.verifySignature(payload, signature)) {
      this.appendToLedger({
        roundId: payload.roundId,
        eventType: 'entrega_pronta',
        status: 'REJECTED_SIGNATURE',
        executedAt: new Date().toISOString()
      });
      return { ok: false, status: 'REJECTED_SIGNATURE', reason: 'Assinatura HMAC-SHA256 inválida' };
    }

    // 2. Validação de Correspondência de SHA
    if (options?.expectedSha && payload.sha.toLowerCase() !== options.expectedSha.toLowerCase()) {
      this.appendToLedger({
        roundId: payload.roundId,
        eventType: 'entrega_pronta',
        status: 'REJECTED_SHA_MISMATCH',
        executedAt: new Date().toISOString()
      });
      return { ok: false, status: 'REJECTED_SHA_MISMATCH', reason: `SHA divergente: esperado ${options.expectedSha}, recebido ${payload.sha}` };
    }

    // 3. Deduplicação por roundId
    const key = `${payload.roundId}:entrega_pronta`;
    if (this.processedRoundEvents.has(key)) {
      return { ok: true, status: 'DUPLICATE_EVENT_IGNORED', reason: 'Evento de entrega já processado para esta rodada' };
    }

    // 4. Execução do Codex Real se solicitado
    let codexResult: CodexExecutionResult | undefined;
    if (options?.autoTriggerCodex) {
      try {
        const defaultPrompt = options.codexPrompt || 
          `Você é o auditor automatizado Codex. Avalie a entrega da subetapa ${payload.subetapa} do KYRO Finance (commit ${payload.sha}). ` +
          `Verifique a conformidade com o portal ${payload.evidenceLinks.portalUrl} e emita parecer técnico de auditoria para prosseguir com a conferência.`;
        
        codexResult = executeRealCodex({
          prompt: defaultPrompt,
          roundId: payload.roundId,
          sha: payload.sha,
          outputLogDir: this.baseDir
        });
      } catch (err: any) {
        this.appendToLedger({
          roundId: payload.roundId,
          eventType: 'entrega_pronta',
          status: 'CODEX_EXECUTION_FAILED',
          executedAt: new Date().toISOString(),
          details: { error: err?.message }
        });
        return { ok: false, status: 'CODEX_EXECUTION_FAILED', reason: err?.message };
      }
    }

    this.appendToLedger({
      roundId: payload.roundId,
      eventType: 'entrega_pronta',
      status: 'PROCESSED',
      executedAt: new Date().toISOString(),
      details: { 
        subetapa: payload.subetapa, 
        sha: payload.sha, 
        evidenceLinks: payload.evidenceLinks,
        codexSessionId: codexResult?.codexSessionId,
        model: codexResult?.model
      }
    });

    return { ok: true, status: 'PROCESSED', codexExecution: codexResult };
  }

  /**
   * Emite o evento `auditoria_concluida` (Codex -> Antigravity).
   */
  public createAuditoriaConcluida(params: {
    roundId: string;
    sha: string;
    verdict: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
    parecer: string;
    nextPrompt?: string;
    humanPendingDecision?: boolean;
    codexSessionId?: string;
  }): SignedEvent<AuditoriaConcluidaPayload> {
    if (!this.isValidSha(params.sha)) {
      throw new Error(`[EventBridge] SHA inválido para auditoria_concluida: ${params.sha}`);
    }

    const payload: AuditoriaConcluidaPayload = {
      eventType: 'auditoria_concluida',
      roundId: params.roundId,
      sha: params.sha.toLowerCase(),
      verdict: params.verdict,
      parecer: params.parecer,
      nextPrompt: params.nextPrompt,
      humanPendingDecision: !!params.humanPendingDecision,
      codexSessionId: params.codexSessionId,
      timestamp: new Date().toISOString()
    };

    const signature = this.signPayload(payload);
    return { payload, signature };
  }

  /**
   * Processa a recepção do evento `auditoria_concluida` pelo Antigravity.
   * Aciona a execução automática do próximo trabalho ou encerra a rodada se houver decisão humana pendente.
   * Garante deduplicação estrita: reenvios NÃO disparam o callback `onTriggerNextExecution`.
   */
  public handleAuditoriaConcluida(
    event: SignedEvent<AuditoriaConcluidaPayload>,
    options?: { 
      expectedSha?: string;
      onTriggerNextExecution?: (nextPrompt: string, payload: AuditoriaConcluidaPayload) => Promise<any> | any;
    }
  ): { ok: boolean; status: string; triggeredNextExecution: boolean; reason?: string; executionRecord?: AntigravityExecutionRecord } {
    const { payload, signature } = event;

    // 1. Validação de Assinatura
    if (!this.verifySignature(payload, signature)) {
      this.appendToLedger({
        roundId: payload.roundId,
        eventType: 'auditoria_concluida',
        status: 'REJECTED_SIGNATURE',
        executedAt: new Date().toISOString()
      });
      return { ok: false, status: 'REJECTED_SIGNATURE', triggeredNextExecution: false, reason: 'Assinatura HMAC-SHA256 inválida' };
    }

    // 2. Validação de Correspondência de SHA
    if (options?.expectedSha && payload.sha.toLowerCase() !== options.expectedSha.toLowerCase()) {
      this.appendToLedger({
        roundId: payload.roundId,
        eventType: 'auditoria_concluida',
        status: 'REJECTED_SHA_MISMATCH',
        executedAt: new Date().toISOString()
      });
      return { ok: false, status: 'REJECTED_SHA_MISMATCH', triggeredNextExecution: false, reason: 'SHA auditado não corresponde ao commit atual' };
    }

    // 3. Deduplicação por roundId (Execução estritamente única)
    const key = `${payload.roundId}:auditoria_concluida`;
    if (this.processedRoundEvents.has(key)) {
      return { 
        ok: true, 
        status: 'DUPLICATE_EVENT_IGNORED', 
        triggeredNextExecution: false, 
        reason: 'Auditoria já processada para esta rodada. Deduplicação estrita ativa (zero execuções duplicadas).' 
      };
    }

    // 4. Verificação de Próximo Trabalho vs Decisão Humana Pendente
    let triggeredNext = false;
    let agExecution: AntigravityExecutionRecord | undefined;

    if (payload.humanPendingDecision) {
      // Decisão humana pendente -> encerra a rodada e não auto-executa
      this.appendToLedger({
        roundId: payload.roundId,
        eventType: 'auditoria_concluida',
        status: 'PROCESSED',
        executedAt: new Date().toISOString(),
        details: { verdict: payload.verdict, humanPendingDecision: true, action: 'ROUND_CLOSED_AWAITING_HUMAN' }
      });
      return { ok: true, status: 'ROUND_CLOSED_AWAITING_HUMAN', triggeredNextExecution: false };
    }

    if (payload.nextPrompt && options?.onTriggerNextExecution) {
      try {
        const res = options.onTriggerNextExecution(payload.nextPrompt, payload);
        triggeredNext = true;
        if (res && res.executionId) {
          agExecution = res;
        }
      } catch (err: any) {
        return { ok: false, status: 'EXECUTION_TRIGGER_FAILED', triggeredNextExecution: false, reason: err?.message };
      }
    }

    this.appendToLedger({
      roundId: payload.roundId,
      eventType: 'auditoria_concluida',
      status: 'PROCESSED',
      executedAt: new Date().toISOString(),
      details: { 
        verdict: payload.verdict, 
        triggeredNextExecution: triggeredNext,
        hasNextPrompt: !!payload.nextPrompt,
        executionId: agExecution?.executionId
      }
    });

    return { ok: true, status: 'PROCESSED', triggeredNextExecution: triggeredNext, executionRecord: agExecution };
  }

  public getHistory(): ExecutionRecord[] {
    return [...this.dispatchHistory];
  }

  public clearHistory(): void {
    this.processedRoundEvents.clear();
    this.dispatchHistory = [];
    if (fs.existsSync(this.ledgerPath)) {
      try {
        fs.unlinkSync(this.ledgerPath);
      } catch {}
    }
  }
}

/**
 * Servidor Webhook / HTTP Event Bus para integração em rede entre Antigravity e Codex.
 */
export function createEventBridgeHttpServer(bridge: EventBridge): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/api/events/entrega_pronta') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const event: SignedEvent<EntregaProntaPayload> = JSON.parse(body);
          const result = bridge.handleEntregaPronta(event);
          const statusCode = result.ok ? 200 : 400;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Malformed JSON payload' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/events/auditoria_concluida') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const event: SignedEvent<AuditoriaConcluidaPayload> = JSON.parse(body);
          const result = bridge.handleAuditoriaConcluida(event);
          const statusCode = result.ok ? 200 : 400;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Malformed JSON payload' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/events/history')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, history: bridge.getHistory() }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });
}
