/**
 * KYRO FINANCE | CONTROLADOR DE FLUXO DE VOZ E CONFIRMAÇÃO DO CHAT (CHAT VOICE CONTROLLER)
 * 
 * Conecta o ciclo de vida do reconhecimento nativo de voz (NativeSpeechRecognizer)
 * com o estado reativo da interface do Chat e o despachante de persistência HTTP (/api/database).
 * 
 * Garante estritamente que:
 * 1. Frames parciais (onPartial), finais (onFinal) e cancelamento (cancelRecording)
 *    apenas atualizam o estado visual e NÃO disparam nenhuma requisição de mutação.
 * 2. A confirmação do usuário (confirmRecording / botão "Lançar") aciona a transcrição
 *    limpa e desduplicada, gerando um requestId estável e persistindo via rota HTTP oficial.
 * 3. O reenvio ou retry da confirmação recupera o recibo sem reaplicar efeito financeiro (idempotência).
 */

import {
  isNativeSpeechAvailable,
  startNativeSpeech,
  stopNativeSpeech,
  cancelNativeSpeech,
  cleanAndDeduplicateTranscript
} from '../nativeBridge';
import { Transaction } from '../types';

export interface ChatVoiceState {
  isRecording: boolean;
  liveTranscript: string;
  inputMessage: string;
  recordedText: string;
  errorMessage: string | null;
  lastAction: 'idle' | 'recording' | 'cancelled' | 'confirmed';
}

export interface ChatMutationRequestLog {
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

export class ChatVoiceController {
  public state: ChatVoiceState = {
    isRecording: false,
    liveTranscript: '',
    inputMessage: '',
    recordedText: '',
    errorMessage: null,
    lastAction: 'idle'
  };

  // Histórico de requisições de mutação enviadas pelo controlador para comprovação de auditoria
  public mutationLog: ChatMutationRequestLog[] = [];

  constructor(
    private fetchImpl: typeof fetch = typeof window !== 'undefined' ? window.fetch.bind(window) : fetch
  ) {}

  /**
   * Inicia o fluxo de gravação de áudio do chat.
   * Conecta os callbacks de fala ao estado reativo.
   */
  public async startRecording(): Promise<boolean> {
    this.state.isRecording = true;
    this.state.liveTranscript = '';
    this.state.recordedText = '';
    this.state.errorMessage = null;
    this.state.lastAction = 'recording';

    const available = await isNativeSpeechAvailable();
    if (!available) {
      // Se não disponível, mantém estado local para simulação controlada
      return true;
    }

    const started = await startNativeSpeech({
      onPartial: (text) => this.handlePartialResult(text),
      onFinal: (text) => this.handleFinalResult(text),
      onError: (err) => {
        this.state.errorMessage = err?.message || String(err);
      }
    });

    return started;
  }

  /**
   * Processa frames parciais da transcrição.
   * Atualiza a interface em tempo real sem disparar nenhuma mutação de saldo ou banco.
   */
  public handlePartialResult(rawText: string): void {
    const cleaned = cleanAndDeduplicateTranscript(rawText);
    this.state.liveTranscript = cleaned;
    this.state.inputMessage = cleaned;
    this.state.recordedText = cleaned;
  }

  /**
   * Processa resultado final do frame de voz.
   * Apenas consolida o buffer visual. Não realiza gravação contábil.
   */
  public handleFinalResult(rawText: string): void {
    const cleaned = cleanAndDeduplicateTranscript(rawText);
    this.state.liveTranscript = cleaned;
    this.state.inputMessage = cleaned;
    this.state.recordedText = cleaned;
  }

  /**
   * Cancela a gravação em andamento (usuário clica na Lixeira / Cancelar).
   * Zera todos os buffers e desativa o recognizer. Nenhuma mutação é enviada.
   */
  public async cancelRecording(): Promise<void> {
    this.state.isRecording = false;
    this.state.liveTranscript = '';
    this.state.inputMessage = '';
    this.state.recordedText = '';
    this.state.lastAction = 'cancelled';
    await cancelNativeSpeech().catch(() => {});
  }

  /**
   * Confirmação deliberada do usuário (botão "Lançar" / Check).
   * Para a escuta nativa, obtém a transcrição limpa, constrói a transação
   * e despacha a requisição de gravação para a rota HTTP /api/database.
   */
  public async confirmRecording(options: {
    baseUrl: string;
    authToken: string;
    accountId?: string;
    requestId?: string;
    customTx?: Partial<Transaction>;
  }): Promise<{ ok: boolean; status: number; data: any; requestId: string; transaction: Transaction }> {
    this.state.isRecording = false;
    this.state.lastAction = 'confirmed';
    await stopNativeSpeech().catch(() => {});

    const finalText = cleanAndDeduplicateTranscript(
      this.state.recordedText || this.state.liveTranscript || this.state.inputMessage
    );

    if (!finalText || finalText.trim().length === 0) {
      throw new Error('[ChatVoiceController] Nenhuma transcrição de fala foi detectada para confirmação.');
    }

    const txId = options.customTx?.id || `tx_voice_${Date.now()}`;
    const requestId = options.requestId || `req_voice_${txId}`;
    const accountId = options.accountId || 'acc_default';

    const transaction: Transaction = {
      id: txId,
      description: finalText,
      product: options.customTx?.product || finalText,
      establishment: options.customTx?.establishment || 'Geral',
      category: options.customTx?.category || 'Transporte',
      city: options.customTx?.city || 'Local',
      amount: options.customTx?.amount !== undefined ? options.customTx.amount : 50.0,
      type: options.customTx?.type || 'Saída',
      method: options.customTx?.method || 'PIX',
      date: options.customTx?.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
      status: options.customTx?.status || 'Concluído'
    };

    const payload = {
      action: 'save_transaction',
      requestId,
      accountId,
      transaction: {
        id: transaction.id,
        description: transaction.description,
        amount: transaction.amount,
        type: transaction.type === 'Entrada' ? 'INCOME' : 'EXPENSE',
        category: transaction.category
      }
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.authToken}`,
      'X-Request-ID': requestId
    };

    const targetUrl = `${options.baseUrl.replace(/\/$/, '')}/api/database`;

    // Registra no histórico de mutações do chat
    this.mutationLog.push({
      timestamp: new Date().toISOString(),
      url: targetUrl,
      method: 'POST',
      headers,
      body: payload
    });

    const response = await this.fetchImpl(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      data,
      requestId,
      transaction
    };
  }

  /**
   * Reenvia a confirmação do chat (Simula perda de resposta da rede ou retry automático).
   * Envia o mesmo requestId e transação para a rota HTTP oficial.
   */
  public async retryConfirmation(options: {
    baseUrl: string;
    authToken: string;
    requestId: string;
    transaction: Transaction;
    accountId?: string;
  }): Promise<{ ok: boolean; status: number; data: any }> {
    const accountId = options.accountId || 'acc_default';

    const payload = {
      action: 'save_transaction',
      requestId: options.requestId,
      accountId,
      transaction: {
        id: options.transaction.id,
        description: options.transaction.description,
        amount: options.transaction.amount,
        type: options.transaction.type === 'Entrada' ? 'INCOME' : 'EXPENSE',
        category: options.transaction.category
      }
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.authToken}`,
      'X-Request-ID': options.requestId
    };

    const targetUrl = `${options.baseUrl.replace(/\/$/, '')}/api/database`;

    this.mutationLog.push({
      timestamp: new Date().toISOString(),
      url: targetUrl,
      method: 'POST',
      headers,
      body: payload
    });

    const response = await this.fetchImpl(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      data
    };
  }
}
