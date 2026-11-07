/**
 * KYRO FINANCE | EVENT BRIDGE AUTOMATION (ANTIGRAVITY ⇄ CODEX)
 * 
 * Barramento e protocolo bidirecional de eventos para automação entre Antigravity e Codex.
 * 
 * Regras do Protocolo:
 * 1. Emissão de `entrega_pronta`:
 *    - Payload assinado com HMAC-SHA256.
 *    - Contém roundId único, subetapa, sha completo e links de evidências.
 * 2. Emissão de `auditoria_concluida`:
 *    - Emitido pelo Codex com roundId, sha auditado, parecer e próximo prompt integral.
 *    - Conectado à interface do Antigravity para iniciar execução automaticamente.
 *    - Encerramento automático quando há decisão humana pendente ou quando a rodada é finalizada.
 * 3. Integridade e Segurança:
 *    - Autenticação por assinatura HMAC-SHA256.
 *    - Validação de correspondência estrita de SHA.
 *    - Deduplicação determinística por roundId (execução estritamente única).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

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
  timestamp: string;
}

export interface SignedEvent<T> {
  payload: T;
  signature: string;
}

export interface ExecutionRecord {
  roundId: string;
  eventType: string;
  status: 'PROCESSED' | 'DUPLICATE_EVENT_IGNORED' | 'REJECTED_SIGNATURE' | 'REJECTED_SHA_MISMATCH';
  executedAt: string;
  details?: any;
}

export class EventBridge {
  private secretKey: string;
  private ledgerPath: string;
  private processedRoundEvents: Set<string> = new Set();
  private dispatchHistory: ExecutionRecord[] = [];

  constructor(options?: { secretKey?: string; ledgerDir?: string }) {
    this.secretKey = options?.secretKey || 
      (typeof process !== 'undefined' ? process.env?.EVENT_BRIDGE_SECRET : '') || 
      'kyro-event-bridge-secret-synth';

    const baseDir = options?.ledgerDir || path.resolve(process.cwd(), '.kyro_events');
    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch {}
    }
    this.ledgerPath = path.join(baseDir, 'event_ledger.jsonl');
    this.loadLedger();
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
   */
  public handleEntregaPronta(
    event: SignedEvent<EntregaProntaPayload>,
    options?: { expectedSha?: string }
  ): { ok: boolean; status: string; reason?: string } {
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

    this.appendToLedger({
      roundId: payload.roundId,
      eventType: 'entrega_pronta',
      status: 'PROCESSED',
      executedAt: new Date().toISOString(),
      details: { subetapa: payload.subetapa, sha: payload.sha, evidenceLinks: payload.evidenceLinks }
    });

    return { ok: true, status: 'PROCESSED' };
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
      timestamp: new Date().toISOString()
    };

    const signature = this.signPayload(payload);
    return { payload, signature };
  }

  /**
   * Processa a recepção do evento `auditoria_concluida` pelo Antigravity.
   * Aciona a execução automática do próximo trabalho ou encerra a rodada se houver decisão humana pendente.
   */
  public handleAuditoriaConcluida(
    event: SignedEvent<AuditoriaConcluidaPayload>,
    options?: { 
      expectedSha?: string;
      onTriggerNextExecution?: (nextPrompt: string) => Promise<void> | void;
    }
  ): { ok: boolean; status: string; triggeredNextExecution: boolean; reason?: string } {
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

    // 3. Deduplicação por roundId
    const key = `${payload.roundId}:auditoria_concluida`;
    if (this.processedRoundEvents.has(key)) {
      return { 
        ok: true, 
        status: 'DUPLICATE_EVENT_IGNORED', 
        triggeredNextExecution: false, 
        reason: 'Auditoria já processada para esta rodada. Deduplicação estrita ativa.' 
      };
    }

    // 4. Verificação de Próximo Trabalho vs Decisão Humana Pendente
    let triggeredNext = false;
    if (payload.humanPendingDecision) {
      // Há decisão ou aprovação humana pendente -> encerra a rodada e não auto-executa
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
        options.onTriggerNextExecution(payload.nextPrompt);
        triggeredNext = true;
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
        hasNextPrompt: !!payload.nextPrompt
      }
    });

    return { ok: true, status: 'PROCESSED', triggeredNextExecution: triggeredNext };
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
