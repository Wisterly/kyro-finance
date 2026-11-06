/**
 * KYRO FINANCE | MOTOR DE CONCORRÊNCIA E LEASES (COMPONENTE 04)
 * 
 * Implementa aquisição, renovação e liberação atômica de leases distribuídos com escopo
 * explícito por usuário e recurso (users/{uid}/leases/{resourceId}).
 * 
 * Regras Estritas:
 * 1. Fencing Tokens estritamente monotônicos e crescentes a cada nova concessão/expiração.
 * 2. Validação atômica de fencingToken dentro da mesma transação do Firestore.
 * 3. Processos com lease vencido ou substituído falham categoricamente sem mutar saldos ou recibos.
 * 4. TTL configurável com default canônico de 30s.
 */

import { ITransactionalStore, IStoreTransaction } from '../services/firestoreAdapter';

export interface LeaseRecord {
  resourceId: string;
  userId: string;
  holderId: string;
  fencingToken: number;
  ttlMs: number;
  acquiredAt: number;
  expiresAt: number;
  updatedAt: number;
}

export class LeaseExpiredError extends Error {
  public readonly code = 'LEASE_EXPIRED';
  public readonly statusCode = 412; // Precondition Failed
  constructor(message: string) {
    super(`[LeaseExpired] ${message}`);
    this.name = 'LeaseExpiredError';
  }
}

export class FencingTokenMismatchError extends Error {
  public readonly code = 'FENCING_TOKEN_OBSOLETE';
  public readonly statusCode = 412; // Precondition Failed
  constructor(message: string) {
    super(`[FencingTokenMismatch] ${message}`);
    this.name = 'FencingTokenMismatchError';
  }
}

export class LeaseHolderMismatchError extends Error {
  public readonly code = 'LEASE_HOLDER_MISMATCH';
  public readonly statusCode = 412;
  constructor(message: string) {
    super(`[LeaseHolderMismatch] ${message}`);
    this.name = 'LeaseHolderMismatchError';
  }
}

export class LeaseAlreadyHeldError extends Error {
  public readonly code = 'LEASE_ALREADY_HELD';
  public readonly statusCode = 409; // Conflict
  constructor(message: string, public readonly currentLease?: LeaseRecord) {
    super(`[LeaseAlreadyHeld] ${message}`);
    this.name = 'LeaseAlreadyHeldError';
  }
}

export class LeaseNotFoundError extends Error {
  public readonly code = 'LEASE_NOT_FOUND';
  public readonly statusCode = 404;
  constructor(message: string) {
    super(`[LeaseNotFound] ${message}`);
    this.name = 'LeaseNotFoundError';
  }
}

export interface AcquireLeaseResult {
  success: boolean;
  lease: LeaseRecord;
  isReacquired: boolean;
}

export class LeaseManager {
  constructor(private store: ITransactionalStore) {}

  /**
   * Adquire lease de recurso para um usuário específico.
   * Se o lease estiver vago ou expirado, incrementa monotonicamente o fencingToken.
   * Se já pertencer ao mesmo holderId, renova preservando o fencingToken.
   * Se pertencer a outro holderId e ainda for válido, falha com LeaseAlreadyHeldError.
   */
  public async acquireLease(
    userId: string,
    resourceId: string,
    holderId: string,
    ttlMs: number = 30000
  ): Promise<AcquireLeaseResult> {
    if (!userId) throw new Error('[LeaseManager] userId é obrigatório');
    if (!resourceId) throw new Error('[LeaseManager] resourceId é obrigatório');
    if (!holderId) throw new Error('[LeaseManager] holderId é obrigatório');

    const leasePath = `users/${userId}/leases/${resourceId}`;

    return await this.store.runTransaction(async (t) => {
      const existing = await t.get(leasePath) as LeaseRecord | null;
      const now = Date.now();

      // Caso 1: Lease existe e ainda está ativamente detido
      if (existing && existing.holderId && now < existing.expiresAt) {
        if (existing.holderId === holderId) {
          // Mesmo holder ativo: renovação durante aquisição
          const renewedLease: LeaseRecord = {
            ...existing,
            ttlMs,
            expiresAt: now + ttlMs,
            updatedAt: now
          };
          t.set(leasePath, renewedLease);
          return { success: true, lease: renewedLease, isReacquired: false };
        } else {
          // Outro holder ativo: conflito
          throw new LeaseAlreadyHeldError(
            `Recurso '${resourceId}' já possui lease ativo pertencente a '${existing.holderId}' até ${new Date(existing.expiresAt).toISOString()}.`,
            existing
          );
        }
      }

      // Caso 2: Não existe, já expirou ou foi liberado voluntariamente
      // (nova concessão/reaquisição com token monotônico estritamente crescente)
      const nextToken = (existing?.fencingToken || 0) + 1;
      const newLease: LeaseRecord = {
        resourceId,
        userId,
        holderId,
        fencingToken: nextToken,
        ttlMs,
        acquiredAt: now,
        expiresAt: now + ttlMs,
        updatedAt: now
      };

      t.set(leasePath, newLease);
      return {
        success: true,
        lease: newLease,
        isReacquired: !!existing && !!existing.holderId
      };
    });
  }

  /**
   * Renova um lease existente pertencente ao mesmo holderId e mesmo fencingToken.
   * Rejeita se o token for obsoleto, titular incorreto ou se o lease já tiver expirado.
   */
  public async renewLease(
    userId: string,
    resourceId: string,
    holderId: string,
    fencingToken: number,
    ttlMs: number = 30000
  ): Promise<LeaseRecord> {
    const leasePath = `users/${userId}/leases/${resourceId}`;

    return await this.store.runTransaction(async (t) => {
      const existing = await t.get(leasePath) as LeaseRecord | null;
      const now = Date.now();

      if (!existing) {
        throw new LeaseNotFoundError(`Lease para o recurso '${resourceId}' não foi encontrado.`);
      }

      if (existing.fencingToken !== fencingToken) {
        throw new FencingTokenMismatchError(
          `Fencing token informado (${fencingToken}) difere do token ativo no storage (${existing.fencingToken}). Renovação rejeitada.`
        );
      }

      if (existing.holderId !== holderId) {
        throw new LeaseHolderMismatchError(
          `Titular informado '${holderId}' difere do titular ativo '${existing.holderId}'. Renovação rejeitada.`
        );
      }

      if (now > existing.expiresAt) {
        throw new LeaseExpiredError(
          `Lease para '${resourceId}' expirou em ${new Date(existing.expiresAt).toISOString()}. Reaquisição obrigatória.`
        );
      }

      const renewed: LeaseRecord = {
        ...existing,
        ttlMs,
        expiresAt: now + ttlMs,
        updatedAt: now
      };

      t.set(leasePath, renewed);
      return renewed;
    });
  }

  /**
   * Libera voluntariamente um lease ativo.
   */
  public async releaseLease(
    userId: string,
    resourceId: string,
    holderId: string,
    fencingToken: number
  ): Promise<void> {
    const leasePath = `users/${userId}/leases/${resourceId}`;

    await this.store.runTransaction(async (t) => {
      const existing = await t.get(leasePath) as LeaseRecord | null;
      if (!existing || !existing.holderId || existing.expiresAt === 0) return;

      if (existing.fencingToken !== fencingToken) {
        throw new FencingTokenMismatchError(
          `Tentativa de liberação com fencing token obsoleto (${fencingToken} vs ${existing.fencingToken}).`
        );
      }

      if (existing.holderId !== holderId) {
        throw new LeaseHolderMismatchError(
          `Apenas o titular atual '${existing.holderId}' pode liberar este lease (informado: '${holderId}').`
        );
      }

      // Ao invés de apagar o documento e perder a sequência numérica, marca como liberado
      // zerando titular e expiração, preservando a monotonicidade estrita do fencingToken para futuras reaquisições
      const releasedRecord: LeaseRecord = {
        ...existing,
        holderId: '',
        expiresAt: 0,
        updatedAt: Date.now()
      };
      t.set(leasePath, releasedRecord);
    });
  }

  /**
   * Recupera o estado atual do lease diretamente do armazenamento.
   * Retorna null se não houver lease ativo (não existente, expirado ou liberado).
   */
  public async getLease(userId: string, resourceId: string): Promise<LeaseRecord | null> {
    const doc = await this.store.getDocument(`users/${userId}/leases/${resourceId}`) as LeaseRecord | null;
    if (!doc || !doc.holderId || doc.expiresAt === 0 || Date.now() > doc.expiresAt) {
      return null;
    }
    return doc;
  }
}

/**
 * Validação atômica de Fencing Token no contexto de uma transação contábil.
 * Executada no MESMO commit transacional que grava saldo e recibo.
 */
export async function validateFencingUnderTransaction(
  t: IStoreTransaction,
  userId: string,
  resourceId: string,
  requiredFencingToken?: number,
  holderId?: string
): Promise<LeaseRecord | null> {
  const leasePath = `users/${userId}/leases/${resourceId}`;
  const lease = await t.get(leasePath) as LeaseRecord | null;

  if (!lease || !lease.holderId || lease.expiresAt === 0) {
    // Se não há lease explícito ativo cadastrado para o recurso, não há restrição de fencing
    return null;
  }

  const now = Date.now();

  // 1. Verificação de expiração temporal do lease
  if (now > lease.expiresAt) {
    throw new LeaseExpiredError(
      `O lease do recurso '${resourceId}' expirou em ${new Date(lease.expiresAt).toISOString()} (agora: ${new Date(now).toISOString()}). Mutação bloqueada.`
    );
  }

  // 2. Se o recurso possui lease ativo, prova de posse é estritamente OBRIGATÓRIA
  // A. Conferência de Fencing Token
  if (requiredFencingToken === undefined || requiredFencingToken === null) {
    throw new FencingTokenMismatchError(
      `Recurso '${resourceId}' possui lease ativo concedido a '${lease.holderId}'. Prova de posse obrigatória: fencingToken não fornecido.`
    );
  }

  if (requiredFencingToken < lease.fencingToken) {
    throw new FencingTokenMismatchError(
      `Fencing token informado (${requiredFencingToken}) é inferior ao token vigente no storage (${lease.fencingToken}). Processo obsoleto/fenced.`
    );
  }
  if (requiredFencingToken !== lease.fencingToken) {
    throw new FencingTokenMismatchError(
      `Fencing token informado (${requiredFencingToken}) difere do token vigente (${lease.fencingToken}).`
    );
  }

  // B. Conferência de Titular do Lease (HolderId)
  if (!holderId || typeof holderId !== 'string' || holderId.trim() === '') {
    throw new LeaseHolderMismatchError(
      `Recurso '${resourceId}' possui lease ativo concedido a '${lease.holderId}'. Prova de posse obrigatória: holderId não fornecido.`
    );
  }

  if (lease.holderId !== holderId) {
    throw new LeaseHolderMismatchError(
      `Titular do processo ('${holderId}') difere do proprietário do lease ('${lease.holderId}').`
    );
  }

  return lease;
}
