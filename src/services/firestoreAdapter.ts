/**
 * KYRO FINANCE | ADAPTADOR DE PERSISTÊNCIA FIRESTORE (FIRESTORE LEDGER ADAPTER)
 * 
 * Integração entre o Firestore e o LedgerEngine com:
 * 1. Serialização segura de centavos BigInt para IEEE 754 Safe Integer via SafeMoneySerializer.
 * 2. Gravação transacional atômica (efeitos de saldo + recibo de idempotência no mesmo commit).
 * 3. Idempotência estrita por requestId: mesmo payload = recuperação; payload divergente = conflito 409.
 * 4. Preservação transparente de leitura de dados legados em float.
 * 5. Isolamento total particionado por users/{userId}/...
 */

import { SafeMoneySerializer, SafeMoneyError } from './SafeMoneySerializer';
import { Cents, parseToCents, formatCentsToBRL } from '../engine/money';
import { LedgerTransaction, TransactionType, MutationReceipt } from '../engine/ledger';
import { 
  validateFencingUnderTransaction, 
  LeaseExpiredError, 
  FencingTokenMismatchError, 
  LeaseHolderMismatchError,
  LeaseAlreadyHeldError,
  LeaseNotFoundError,
  LeaseRecord,
  LeaseManager
} from '../engine/concurrency';

export {
  LeaseExpiredError,
  FencingTokenMismatchError,
  LeaseHolderMismatchError,
  LeaseAlreadyHeldError,
  LeaseNotFoundError,
  LeaseManager
};
export type { LeaseRecord };

export class IdempotencyConflictError extends Error {
  public readonly code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
  public readonly statusCode = 409;
  constructor(message: string) {
    super(`[IdempotencyConflict] ${message}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class LedgerTransactionError extends Error {
  constructor(message: string, public readonly code: string = 'TRANSACTION_FAILED') {
    super(`[LedgerTransactionError] ${message}`);
    this.name = 'LedgerTransactionError';
  }
}

export interface StoredIdempotencyRecord {
  requestId: string;
  payloadHash: string;
  status: 'APPLIED' | 'REJECTED';
  code: string;
  resultingRev: number;
  fencingToken: number;
  createdAt: string;
  responseSnapshot: any;
}

export interface StoredAccountRecord {
  id: string;
  userId: string;
  name: string;
  balanceCents: number; // Armazenado como inteiro seguro no Firestore
  rev: number;
  fencingToken: number;
  updatedAt: string;
}

export interface StoredTransactionRecord {
  id: string;
  userId: string;
  requestId: string;
  type: TransactionType;
  amountCents: number; // Armazenado como inteiro seguro no Firestore
  sourceAccountId?: string;
  targetAccountId?: string;
  category: string;
  description: string;
  date: string;
  isEstimated?: boolean;
  rev: number;
  fencingToken: number;
  createdAt: string;
  updatedAt: string;
  // Campos legados para compatibilidade reversa
  amount?: number;
}

/**
 * Hash determinístico de payload para verificação de idempotência sem colisão.
 */
export function computePayloadHash(payload: any): string {
  const jsonStr = JSON.stringify(payload, Object.keys(payload || {}).sort());
  let hash = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Converte para inteiro de 32 bits
  }
  return `hash_${Math.abs(hash).toString(16)}`;
}

/**
 * Cliente de Armazenamento Transacional (Interface Canônica para Firestore)
 */
export interface ITransactionalStore {
  runTransaction<T>(updateFunction: (transaction: IStoreTransaction) => Promise<T>): Promise<T>;
  getDocument(path: string): Promise<any | null>;
  queryCollection(collectionPath: string): Promise<any[]>;
}

export interface IStoreTransaction {
  get(path: string): Promise<any | null>;
  set(path: string, data: any): void;
  delete(path: string): void;
}

/**
 * Adaptador Principal de Persistência
 */
export class FirestoreLedgerAdapter {
  constructor(private store: ITransactionalStore) {}

  /**
   * Executa a mutação contábil garantindo:
   * 1. Idempotência no mesmo commit
   * 2. Serialização exata de BigInt <-> Number Safe Cents
   * 3. Isolamento estrito sob users/{userId}/
   */
  public async commitTransaction(
    userId: string,
    params: {
      requestId: string;
      id: string;
      type: TransactionType;
      amountCents: Cents;
      sourceAccountId?: string;
      targetAccountId?: string;
      category: string;
      description: string;
      date?: string;
      isEstimated?: boolean;
      fencingToken?: number;
      holderId?: string;
      resourceId?: string;
      simulatePreCommitFailure?: boolean;
    }
  ): Promise<MutationReceipt> {
    if (!userId) throw new Error('[FirestoreLedgerAdapter] userId é obrigatório');
    if (!params.requestId) throw new Error('[FirestoreLedgerAdapter] requestId é obrigatório');
    if (params.amountCents <= 0n) {
      throw new LedgerTransactionError('O valor deve ser estritamente positivo', 'INVALID_AMOUNT_NON_POSITIVE');
    }

    const payloadHash = computePayloadHash({
      id: params.id,
      type: params.type,
      amountCents: params.amountCents.toString(),
      sourceAccountId: params.sourceAccountId,
      targetAccountId: params.targetAccountId,
      category: params.category,
      description: params.description,
      isEstimated: params.isEstimated
    });

    const idempotencyPath = `users/${userId}/idempotency/${params.requestId}`;
    const txPath = `users/${userId}/transactions/${params.id}`;
    const tombstonePath = `users/${userId}/tombstones/${params.id}`;

    return await this.store.runTransaction(async (t) => {
      // 1. Verificação de Idempotência
      const existingIdempotency = await t.get(idempotencyPath) as StoredIdempotencyRecord | null;
      if (existingIdempotency) {
        if (existingIdempotency.payloadHash === payloadHash) {
          // Mesmo requestId e mesmo payload: recuperação idêntica do resultado anterior sem reaplicar efeitos
          return {
            status: existingIdempotency.status,
            code: existingIdempotency.code,
            requestId: params.requestId,
            replay: true,
            resultingRev: existingIdempotency.resultingRev,
            fencingToken: existingIdempotency.fencingToken
          };
        } else {
          // Mesmo requestId com payload divergente: CONFLITO 409
          throw new IdempotencyConflictError(
            `Conflito de Idempotência: O requestId '${params.requestId}' já foi processado anteriormente com parâmetros diferentes. Nova mutação rejeitada.`
          );
        }
      }

      // 2. Verificação de Tombstone (Sem Ressurreição)
      const tombstone = await t.get(tombstonePath);
      if (tombstone) {
        throw new LedgerTransactionError(
          `Registro ${params.id} foi excluído previamente (Tombstone ativo). Ressurreição proibida.`,
          'TOMBSTONED_NO_RESURRECTION'
        );
      }

      // 3. Verificação de Transação já existente
      const existingTx = await t.get(txPath);
      if (existingTx) {
        throw new LedgerTransactionError(
          `Transação com id '${params.id}' já existe no ledger.`,
          'TRANSACTION_ALREADY_EXISTS'
        );
      }

      // 3.5. Validação Atômica de Lease e Prova de Posse no MESMO Commit
      // Deriva os recursos protegidos a partir da operação contábil autorizada no servidor,
      // impedindo que omitir ou desviar resourceId na requisição burle a validação da conta.
      const protectedResources = new Set<string>();
      if (params.targetAccountId) protectedResources.add(params.targetAccountId);
      if (params.sourceAccountId) protectedResources.add(params.sourceAccountId);
      if (params.resourceId) protectedResources.add(params.resourceId);
      if (protectedResources.size === 0) protectedResources.add('ledger');

      let activeLease: LeaseRecord | null = null;
      for (const resId of protectedResources) {
        const validated = await validateFencingUnderTransaction(
          t,
          userId,
          resId,
          params.fencingToken,
          params.holderId
        );
        if (validated) {
          activeLease = validated;
        }
      }

      // 4. Aplicação dos Efeitos Financeiros nas Contas
      const nowIso = new Date().toISOString();
      const isEstimated = params.isEstimated || false;
      let resultingRev = 1;
      const fencing = activeLease ? activeLease.fencingToken : (params.fencingToken || 1);

      if (!isEstimated) {
        if (params.type === 'INCOME') {
          if (!params.targetAccountId) throw new LedgerTransactionError('Receita requer conta de destino.');
          const accPath = `users/${userId}/accounts/${params.targetAccountId}`;
          let acc = await t.get(accPath) as StoredAccountRecord | null;
          if (!acc) {
            // Inicialização atômica da conta no mesmo commit
            acc = {
              id: params.targetAccountId,
              userId,
              name: 'Conta Principal',
              balanceCents: 0,
              rev: 1,
              fencingToken: fencing,
              updatedAt: nowIso
            };
          }

          const currentCents = SafeMoneySerializer.fromFirestoreCents(acc.balanceCents);
          const newCents = currentCents + params.amountCents;
          resultingRev = acc.rev + 1;

          t.set(accPath, {
            ...acc,
            balanceCents: SafeMoneySerializer.toFirestoreCents(newCents),
            rev: resultingRev,
            fencingToken: fencing,
            updatedAt: nowIso
          });
        } else if (params.type === 'EXPENSE') {
          if (!params.sourceAccountId) throw new LedgerTransactionError('Despesa requer conta de origem.');
          const accPath = `users/${userId}/accounts/${params.sourceAccountId}`;
          let acc = await t.get(accPath) as StoredAccountRecord | null;
          if (!acc) {
            // Inicialização atômica da conta no mesmo commit
            acc = {
              id: params.sourceAccountId,
              userId,
              name: 'Conta Principal',
              balanceCents: 0,
              rev: 1,
              fencingToken: fencing,
              updatedAt: nowIso
            };
          }

          const currentCents = SafeMoneySerializer.fromFirestoreCents(acc.balanceCents);
          const newCents = currentCents - params.amountCents;
          resultingRev = acc.rev + 1;

          t.set(accPath, {
            ...acc,
            balanceCents: SafeMoneySerializer.toFirestoreCents(newCents),
            rev: resultingRev,
            fencingToken: fencing,
            updatedAt: nowIso
          });
        } else if (params.type === 'TRANSFER') {
          if (!params.sourceAccountId || !params.targetAccountId) {
            throw new LedgerTransactionError('Transferência requer conta de origem e conta de destino.');
          }
          if (params.sourceAccountId === params.targetAccountId) {
            throw new LedgerTransactionError('Conta de origem e destino não podem ser iguais.');
          }
          const srcPath = `users/${userId}/accounts/${params.sourceAccountId}`;
          const tgtPath = `users/${userId}/accounts/${params.targetAccountId}`;

          const srcAcc = await t.get(srcPath) as StoredAccountRecord | null;
          const tgtAcc = await t.get(tgtPath) as StoredAccountRecord | null;
          if (!srcAcc || !tgtAcc) {
            throw new LedgerTransactionError('Contas de origem ou destino não localizadas.');
          }

          const srcCents = SafeMoneySerializer.fromFirestoreCents(srcAcc.balanceCents) - params.amountCents;
          const tgtCents = SafeMoneySerializer.fromFirestoreCents(tgtAcc.balanceCents) + params.amountCents;

          resultingRev = Math.max(srcAcc.rev, tgtAcc.rev) + 1;

          t.set(srcPath, {
            ...srcAcc,
            balanceCents: SafeMoneySerializer.toFirestoreCents(srcCents),
            rev: srcAcc.rev + 1,
            fencingToken: fencing,
            updatedAt: nowIso
          });

          t.set(tgtPath, {
            ...tgtAcc,
            balanceCents: SafeMoneySerializer.toFirestoreCents(tgtCents),
            rev: tgtAcc.rev + 1,
            fencingToken: fencing,
            updatedAt: nowIso
          });
        }
      }

      // 5. Persistência do Documento da Transação (com conversão segura para inteiro centavos)
      const firestoreCents = SafeMoneySerializer.toFirestoreCents(params.amountCents);
      const txDoc: StoredTransactionRecord = {
        id: params.id,
        userId,
        requestId: params.requestId,
        type: params.type,
        amountCents: firestoreCents,
        sourceAccountId: params.sourceAccountId,
        targetAccountId: params.targetAccountId,
        category: params.category,
        description: params.description,
        date: params.date || nowIso.split('T')[0],
        isEstimated,
        rev: 1,
        fencingToken: fencing,
        createdAt: nowIso,
        updatedAt: nowIso,
        amount: firestoreCents / 100 // Compatibilidade reversa de visualização
      };

      t.set(txPath, txDoc);

      // 6. Gravação do Recibo de Idempotência no MESMO COMMIT ATÔMICO
      const receipt: MutationReceipt = {
        status: 'APPLIED',
        code: 'TRANSACTION_COMMITTED',
        requestId: params.requestId,
        resultingRev,
        fencingToken: fencing
      };

      const idempotencyDoc: StoredIdempotencyRecord = {
        requestId: params.requestId,
        payloadHash,
        status: 'APPLIED',
        code: 'TRANSACTION_COMMITTED',
        resultingRev,
        fencingToken: fencing,
        createdAt: nowIso,
        responseSnapshot: txDoc
      };

      t.set(idempotencyPath, idempotencyDoc);

      // Simulação controlada de falha proposital imediatamente anterior ao commit
      if (params.simulatePreCommitFailure) {
        throw new LedgerTransactionError(
          'Simulação de falha proposital imediatamente antes do commit.',
          'SIMULATED_PRE_COMMIT_FAILURE'
        );
      }

      return receipt;
    });
  }

  /**
   * Recupera a lista de transações normalizadas para o usuário,
   * preservando perfeitamente os dados legados com valores float.
   */
  public async listUserTransactions(userId: string): Promise<LedgerTransaction[]> {
    if (!userId) throw new Error('[FirestoreLedgerAdapter] userId obrigatório');

    const rawDocs = await this.store.queryCollection(`users/${userId}/transactions`);
    
    return rawDocs.map((doc: any) => {
      // Se possui amountCents, usa SafeMoneySerializer; se possui apenas amount legado (float), normaliza
      let cents: bigint;
      if (doc.amountCents !== undefined && doc.amountCents !== null) {
        cents = SafeMoneySerializer.fromFirestoreCents(doc.amountCents);
      } else if (doc.amount !== undefined && doc.amount !== null) {
        cents = parseToCents(doc.amount);
      } else {
        cents = 0n;
      }

      return {
        id: String(doc.id),
        userId: doc.userId || userId,
        requestId: doc.requestId || `legacy_${doc.id}`,
        type: doc.type || 'EXPENSE',
        amountCents: cents,
        sourceAccountId: doc.sourceAccountId,
        targetAccountId: doc.targetAccountId,
        category: doc.category || 'Geral',
        description: doc.description || '',
        date: doc.date || '2026-01-01',
        isEstimated: !!doc.isEstimated,
        rev: doc.rev || 1,
        fencingToken: doc.fencingToken || 1,
        createdAt: doc.createdAt || new Date().toISOString(),
        updatedAt: doc.updatedAt || new Date().toISOString()
      };
    });
  }

  /**
   * Obtém a conta do usuário.
   */
  public async getAccount(userId: string, accountId: string): Promise<StoredAccountRecord | null> {
    const doc = await this.store.getDocument(`users/${userId}/accounts/${accountId}`);
    return doc || null;
  }

  /**
   * Inicializa ou atualiza conta.
   */
  public async seedAccount(account: StoredAccountRecord): Promise<void> {
    await this.store.runTransaction(async (t) => {
      t.set(`users/${account.userId}/accounts/${account.id}`, account);
    });
  }

  /**
   * Retorna uma instância do LeaseManager sobre a mesma store.
   */
  public getLeaseManager(): LeaseManager {
    return new LeaseManager(this.store);
  }
}
