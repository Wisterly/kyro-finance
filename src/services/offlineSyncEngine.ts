/**
 * KYRO FINANCE - SUBETAPA 03.7 (PR.048)
 * MOTOR DE SINCRONIZAÇÃO OFFLINE E FILA RESILIENTE POR TENANT (OFFLINE SYNC ENGINE)
 * 
 * Regras e Invariantes Arquiteturais:
 * 1. Persistência Isolada por UID: Cada usuário possui partição estritamente isolada no storage.
 * 2. Identidade Estável: O requestId é gerado no momento da intenção offline e jamais se altera.
 * 3. Sobrevivência a Reinicializações: Reidratação idêntica com centavos inteiros BigInt.
 * 4. Sincronização Autenticada: Apenas a sessão ativa do titular pode sincronizar sua própria fila.
 * 5. Reconciliação Derivada do Recibo: Confirmação na interface somente após validação do recibo oficial.
 * 6. Tratamento Tripartite de Exceções:
 *    - Transitórias (rede/503): Retentativa com status FAILED_TRANSIENT.
 *    - Definitivas (validação/403): REJECTED_PERMANENT sem retentativa infinita.
 *    - Conflitos/Tombstone: CONFLICT_RESOLVED impedindo ressurreição de lançamentos estornados.
 * 7. Idempotência em Reenvio Concorrente: Proteção local por mutex e deduplicação no servidor.
 */

import { SafeMoneySerializer } from './SafeMoneySerializer';
import { parseToCents, Cents } from '../engine/money';
import { MutationReceipt } from '../engine/ledger';
import { clientAuthSession, SessionNotFoundError } from './clientAuthSession';

export type OfflineItemStatus =
  | 'PENDING'
  | 'SYNCING'
  | 'COMMITTED'
  | 'FAILED_TRANSIENT'
  | 'REJECTED_PERMANENT'
  | 'CONFLICT_RESOLVED';

export interface OfflineQueueItemSerialized {
  requestId: string;
  id: string;
  userId: string;
  accountId: string;
  accountOwnerId: string;
  type: 'INCOME' | 'EXPENSE';
  amountCentsStr: string;
  amount: number;
  description: string;
  category: string;
  date?: string;
  method?: string;
  product?: string;
  establishment?: string;
  city?: string;
  isEstimated?: boolean;
  status: OfflineItemStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  error?: {
    code: string;
    message: string;
    statusCode?: number;
    permanent: boolean;
  };
  receipt?: MutationReceipt;
}

export interface OfflineQueueItem {
  requestId: string;
  id: string;
  userId: string;
  accountId: string;
  accountOwnerId: string;
  type: 'INCOME' | 'EXPENSE';
  amountCents: bigint;
  amount: number;
  description: string;
  category: string;
  date?: string;
  method?: string;
  product?: string;
  establishment?: string;
  city?: string;
  isEstimated?: boolean;
  status: OfflineItemStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  error?: {
    code: string;
    message: string;
    statusCode?: number;
    permanent: boolean;
  };
  receipt?: MutationReceipt;
}

export interface EnqueueTransactionParams {
  userId: string;
  accountId?: string;
  accountOwnerId?: string;
  id?: string;
  requestId?: string;
  type: 'INCOME' | 'EXPENSE' | 'Entrada' | 'Saída' | 'Receita' | 'Despesa';
  amountCents?: bigint;
  amount?: number;
  description: string;
  category?: string;
  date?: string;
  method?: string;
  product?: string;
  establishment?: string;
  city?: string;
  isEstimated?: boolean;
  maxRetries?: number;
}

export interface SyncOptions {
  baseUrl: string;
  userId: string;
  authToken?: string;
  getAuthToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  onItemConfirmed?: (item: OfflineQueueItem) => void;
  onItemConflict?: (item: OfflineQueueItem) => void;
  onItemRejected?: (item: OfflineQueueItem) => void;
}

export interface SyncSummary {
  userId: string;
  totalProcessed: number;
  committed: number;
  transientFailed: number;
  permanentRejected: number;
  conflictsResolved: number;
  items: OfflineQueueItem[];
}

export interface IOfflineStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

export class BrowserOfflineStorage implements IOfflineStorage {
  getItem(key: string): string | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return null;
  }

  setItem(key: string, value: string): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, value);
      } catch {}
    }
  }

  removeItem(key: string): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(key);
      } catch {}
    }
  }

  clear(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.clear();
      } catch {}
    }
  }
}

export class MemoryOfflineStorage implements IOfflineStorage {
  private map: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.map.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

export class TenantMismatchError extends Error {
  public readonly code = 'PERMISSION_DENIED_TENANT_MISMATCH';
  public readonly statusCode = 403;
  constructor(message: string = 'Acesso negado: a sessão ativa pertence a outro usuário.') {
    super(`[OfflineSyncEngine] ${message}`);
    this.name = 'TenantMismatchError';
  }
}

export class OfflineSyncEngine {
  private storage: IOfflineStorage;
  // Mutex para impedir reenvios concorrentes locais para o mesmo usuário
  private activeSyncs: Set<string> = new Set();

  constructor(storage?: IOfflineStorage) {
    this.storage = storage || new BrowserOfflineStorage();
  }

  /**
   * Chave de isolamento estrito por UID do titular
   */
  public getStorageKey(userId: string): string {
    if (!userId || userId.trim() === '') {
      throw new Error('[OfflineSyncEngine] userId é obrigatório para isolamento da fila offline.');
    }
    return `kyro_offline_queue_${userId.trim()}`;
  }

  /**
   * Enfileira uma nova transação financeira em modo offline.
   * Atribui requestId único e estável desde o primeiro instante.
   */
  public async enqueueTransaction(params: EnqueueTransactionParams): Promise<OfflineQueueItem> {
    if (!params.userId || params.userId.trim() === '') {
      throw new Error('[OfflineSyncEngine] userId é obrigatório para enfileirar operação offline.');
    }

    const userId = params.userId.trim();
    const accountOwnerId = params.accountOwnerId || userId;
    const accountId = params.accountId || `acc_${userId}`;

    // Normalização estrita do valor em centavos inteiros BigInt
    let amountCents: bigint;
    let amount: number;

    if (params.amountCents !== undefined && params.amountCents !== null) {
      amountCents = params.amountCents;
      amount = Number(amountCents) / 100;
    } else if (params.amount !== undefined && params.amount !== null) {
      amountCents = parseToCents(params.amount);
      amount = params.amount;
    } else {
      throw new Error('[OfflineSyncEngine] Valor monetário (amount ou amountCents) é obrigatório.');
    }

    if (amountCents <= 0n) {
      throw new Error('[OfflineSyncEngine] O valor monetário da transação deve ser estritamente positivo (> 0 centavos).');
    }

    // Normalização do tipo contábil
    const normalizedType: 'INCOME' | 'EXPENSE' =
      (params.type === 'INCOME' || params.type === 'Entrada' || params.type === 'Receita')
        ? 'INCOME'
        : 'EXPENSE';

    const nowIso = new Date().toISOString();
    const txId = params.id || `tx_off_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const requestId = params.requestId || `req_off_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const newItem: OfflineQueueItem = {
      requestId,
      id: txId,
      userId,
      accountId,
      accountOwnerId,
      type: normalizedType,
      amountCents,
      amount,
      description: params.description || (normalizedType === 'INCOME' ? 'Receita Offline' : 'Despesa Offline'),
      category: params.category || 'Geral',
      date: params.date || nowIso.split('T')[0],
      method: params.method,
      product: params.product,
      establishment: params.establishment,
      city: params.city,
      isEstimated: !!params.isEstimated,
      status: 'PENDING',
      retryCount: 0,
      maxRetries: params.maxRetries || 5,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    // Lê fila atual do storage do usuário
    const currentQueue = await this.getQueue(userId);

    // Se já existir com mesmo requestId, preserva
    const existingIndex = currentQueue.findIndex(i => i.requestId === requestId);
    if (existingIndex >= 0) {
      return currentQueue[existingIndex];
    }

    currentQueue.push(newItem);
    await this.saveQueue(userId, currentQueue);

    return newItem;
  }

  /**
   * Obtém os itens da fila do usuário informado diretamente do storage persistente.
   */
  public async getQueue(userId: string): Promise<OfflineQueueItem[]> {
    const key = this.getStorageKey(userId);
    const raw = await this.storage.getItem(key);
    if (!raw) return [];

    try {
      const parsed: OfflineQueueItemSerialized[] = JSON.parse(raw);
      return parsed.map(item => {
        const { amountCentsStr, ...rest } = item as any;
        return {
          ...rest,
          amountCents: BigInt(amountCentsStr || '0')
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Salva a fila do usuário no storage persistente, serializando BigInt com segurança.
   */
  private async saveQueue(userId: string, items: OfflineQueueItem[]): Promise<void> {
    const key = this.getStorageKey(userId);
    const serialized: OfflineQueueItemSerialized[] = items.map(item => {
      const { amountCents, ...rest } = item;
      return {
        ...rest,
        amountCentsStr: amountCents.toString()
      };
    });
    await this.storage.setItem(key, JSON.stringify(serialized));
  }

  /**
   * Dispara a sincronização resiliente da fila offline com o servidor oficial.
   * Só permite sincronizar se a sessão do Firebase ativa pertencer ao titular.
   */
  public async sync(options: SyncOptions): Promise<SyncSummary> {
    const { userId, baseUrl } = options;
    const fetchImpl = options.fetchImpl || (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);

    // 1. Verificação Estrita de Titularidade (Isolamento Multi-Tenant)
    const activeSession = clientAuthSession.getCurrentSession();
    if (activeSession && activeSession.uid !== userId) {
      throw new TenantMismatchError(
        `A sessão ativa ('${activeSession.uid}') não tem permissão para acessar ou sincronizar a fila do usuário '${userId}'.`
      );
    }

    // 2. Mutex de Concorrência Local: Serializa disparos simultâneos para o mesmo UID
    if (this.activeSyncs.has(userId)) {
      // Se já está sincronizando em paralelo, aguarda liberação para evitar reenvios desnecessários
      await this.waitForSyncRelease(userId);
      const queueAfter = await this.getQueue(userId);
      return {
        userId,
        totalProcessed: 0,
        committed: queueAfter.filter(i => i.status === 'COMMITTED').length,
        transientFailed: queueAfter.filter(i => i.status === 'FAILED_TRANSIENT').length,
        permanentRejected: queueAfter.filter(i => i.status === 'REJECTED_PERMANENT').length,
        conflictsResolved: queueAfter.filter(i => i.status === 'CONFLICT_RESOLVED').length,
        items: queueAfter
      };
    }

    this.activeSyncs.add(userId);

    try {
      // 3. Obtenção do Token de Autenticação Oficial
      let authToken: string;
      if (options.authToken && options.authToken.trim() !== '') {
        authToken = options.authToken.trim();
      } else if (options.getAuthToken) {
        authToken = await options.getAuthToken();
      } else {
        authToken = await clientAuthSession.getSessionToken();
      }

      // 4. Carrega itens pendentes ou em falha transitória
      const queue = await this.getQueue(userId);
      const eligibleItems = queue.filter(
        item => item.status === 'PENDING' || item.status === 'FAILED_TRANSIENT'
      );

      let committedCount = 0;
      let transientCount = 0;
      let permanentCount = 0;
      let conflictCount = 0;

      const endpoint = `${baseUrl.replace(/\/$/, '')}/api/database`;

      for (const item of eligibleItems) {
        item.status = 'SYNCING';
        item.lastAttemptAt = new Date().toISOString();
        await this.saveQueue(userId, queue);

        const payload = {
          action: 'save_transaction',
          requestId: item.requestId, // Identidade estável desde a criação
          accountId: item.accountId,
          accountOwnerId: item.accountOwnerId,
          transaction: {
            id: item.id,
            description: item.description,
            amount: item.amount,
            amountCents: item.amountCents.toString(),
            type: item.type,
            category: item.category,
            date: item.date,
            method: item.method,
            product: item.product,
            establishment: item.establishment,
            city: item.city,
            isEstimated: item.isEstimated
          }
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-Request-ID': item.requestId
        };

        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });

          const data = await response.json().catch(() => null);

          if (response.ok && data?.receipt) {
            // Sucesso confirmado: reconcilia o recibo oficial
            item.status = 'COMMITTED';
            item.receipt = data.receipt;
            item.updatedAt = new Date().toISOString();
            item.error = undefined;
            committedCount++;
            options.onItemConfirmed?.(item);
          } else if (response.status === 409 && data?.code === 'TOMBSTONED_NO_RESURRECTION') {
            // Conflito com estorno prévio / tombstone no servidor: ressurreição proibida
            item.status = 'CONFLICT_RESOLVED';
            item.error = {
              code: 'TOMBSTONED_NO_RESURRECTION',
              message: data?.error || 'A transação foi estornada previamente no servidor com tombstone ativo. Ressurreição impedida.',
              statusCode: 409,
              permanent: true
            };
            item.updatedAt = new Date().toISOString();
            conflictCount++;
            options.onItemConflict?.(item);
          } else if (response.status === 409 && data?.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
            // Conflito de parâmetros de idempotência
            item.status = 'REJECTED_PERMANENT';
            item.error = {
              code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
              message: data?.error || 'Conflito de parâmetros para o mesmo requestId.',
              statusCode: 409,
              permanent: true
            };
            item.updatedAt = new Date().toISOString();
            permanentCount++;
            options.onItemRejected?.(item);
          } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            // Erros de cliente e validação contábil (400, 403): rejeição permanente
            item.status = 'REJECTED_PERMANENT';
            item.error = {
              code: data?.code || 'VALIDATION_REJECTED',
              message: data?.error || `Rejeição definitiva pelo servidor (HTTP ${response.status}).`,
              statusCode: response.status,
              permanent: true
            };
            item.updatedAt = new Date().toISOString();
            permanentCount++;
            options.onItemRejected?.(item);
          } else {
            // Falha transitória de servidor (500, 502, 503, 504)
            item.retryCount++;
            item.status = 'FAILED_TRANSIENT';
            item.error = {
              code: data?.code || 'SERVER_UNAVAILABLE',
              message: data?.error || `Falha transitória do servidor (HTTP ${response.status}).`,
              statusCode: response.status,
              permanent: false
            };
            item.updatedAt = new Date().toISOString();
            transientCount++;
          }
        } catch (networkErr: any) {
          // Falha transitória de rede (ex: sem conexão, ECONNREFUSED, timeout)
          item.retryCount++;
          item.status = 'FAILED_TRANSIENT';
          item.error = {
            code: 'NETWORK_UNAVAILABLE',
            message: `Queda de conexão durante o envio: ${networkErr?.message || networkErr}`,
            permanent: false
          };
          item.updatedAt = new Date().toISOString();
          transientCount++;
        }

        await this.saveQueue(userId, queue);
      }

      return {
        userId,
        totalProcessed: eligibleItems.length,
        committed: committedCount,
        transientFailed: transientCount,
        permanentRejected: permanentCount,
        conflictsResolved: conflictCount,
        items: queue
      };
    } finally {
      this.activeSyncs.delete(userId);
    }
  }

  private async waitForSyncRelease(userId: string, maxMs = 5000): Promise<void> {
    const start = Date.now();
    while (this.activeSyncs.has(userId) && Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /**
   * Retorna apenas os lançamentos que foram formalmente reconciliados com recibo oficial.
   * Não exibe transações pendentes ou rejeitadas como confirmadas na interface.
   */
  public async getConfirmedTransactions(userId: string): Promise<OfflineQueueItem[]> {
    const queue = await this.getQueue(userId);
    return queue.filter(item => item.status === 'COMMITTED' && !!item.receipt);
  }

  /**
   * Remove itens concluídos ou estornados da fila do usuário.
   */
  public async purgeFinishedItems(userId: string): Promise<void> {
    const queue = await this.getQueue(userId);
    const remaining = queue.filter(
      item => item.status === 'PENDING' || item.status === 'FAILED_TRANSIENT'
    );
    await this.saveQueue(userId, remaining);
  }

  /**
   * Limpa integralmente a fila do usuário informado.
   */
  public async clearUserQueue(userId: string): Promise<void> {
    const key = this.getStorageKey(userId);
    await this.storage.removeItem(key);
  }
}

// Instância padrão global para a aplicação
export const offlineSyncEngine = new OfflineSyncEngine();
