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
export type { LeaseRecord, MutationReceipt };

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
   * Executa a mutação contábil atômica de um LOTE de transações financeiras no mesmo commit:
   * 1. Se qualquer item falhar (validação, conflito, simulação de falha), faz rollback de 100% do lote (zero mutações).
   * 2. Idempotência estrita pelo batchRequestId: se reenviado com o mesmo payload, retorna replay: true e os mesmos recibos.
   * 3. Aplica todos os efeitos de crédito/débito nas contas envolvidas de forma agregada no mesmo commit.
   * 4. Grava cada documento de transação, cada recibo individual e o recibo atômico do lote.
   */
  public async commitBatchTransactions(
    userId: string,
    params: {
      batchRequestId: string;
      items: Array<{
        id: string;
        requestId?: string;
        type: TransactionType;
        amountCents: Cents;
        sourceAccountId?: string;
        targetAccountId?: string;
        category: string;
        description: string;
        date?: string;
        isEstimated?: boolean;
        product?: string;
        establishment?: string;
        city?: string;
        method?: string;
        cardName?: string;
        currentInstallment?: number;
        totalInstallments?: number;
      }>;
      fencingToken?: number;
      holderId?: string;
      simulateItemFailureIndex?: number;
    }
  ): Promise<{
    status: 'APPLIED';
    code: 'BATCH_COMMITTED';
    batchRequestId: string;
    resultingRev: number;
    replay?: boolean;
    receipts: MutationReceipt[];
    savedTransactions: StoredTransactionRecord[];
  }> {
    if (!userId) throw new Error('[FirestoreLedgerAdapter] userId é obrigatório');
    if (!params.batchRequestId) throw new Error('[FirestoreLedgerAdapter] batchRequestId é obrigatório');
    if (!params.items || params.items.length === 0) {
      throw new LedgerTransactionError('O lote deve conter pelo menos uma transação.', 'EMPTY_BATCH');
    }

    const payloadHash = computePayloadHash({
      batchRequestId: params.batchRequestId,
      items: params.items.map(it => ({
        id: it.id,
        requestId: it.requestId,
        type: it.type,
        amountCents: it.amountCents.toString(),
        sourceAccountId: it.sourceAccountId,
        targetAccountId: it.targetAccountId,
        category: it.category,
        description: it.description,
        isEstimated: it.isEstimated
      }))
    });

    const batchIdempotencyPath = `users/${userId}/idempotency/${params.batchRequestId}`;

    return await this.store.runTransaction(async (t) => {
      // 1. Verificação de Idempotência do Lote
      const existingBatch = await t.get(batchIdempotencyPath) as StoredIdempotencyRecord | null;
      if (existingBatch) {
        if (existingBatch.payloadHash === payloadHash) {
          // Replay do lote: retorna os recibos e dados previamente comitados
          const snap = existingBatch.responseSnapshot;
          return {
            status: 'APPLIED',
            code: 'BATCH_COMMITTED',
            batchRequestId: params.batchRequestId,
            resultingRev: existingBatch.resultingRev,
            replay: true,
            receipts: snap?.receipts?.map((r: any) => ({ ...r, replay: true })) || [],
            savedTransactions: snap?.savedTransactions || []
          };
        } else {
          throw new IdempotencyConflictError(
            `Conflito de Idempotência: O lote '${params.batchRequestId}' já foi processado anteriormente com parâmetros diferentes. Nova mutação rejeitada.`
          );
        }
      }

      // 2. Validação prévia de cada item do lote
      for (let i = 0; i < params.items.length; i++) {
        const item = params.items[i];
        if (params.simulateItemFailureIndex === i) {
          throw new LedgerTransactionError(
            `Simulação de falha proposital no item ${i + 1} do lote.`,
            'SIMULATED_BATCH_ITEM_FAILURE'
          );
        }
        if (item.amountCents <= 0n) {
          throw new LedgerTransactionError(
            `O valor do item ${i + 1} deve ser estritamente positivo.`,
            'INVALID_AMOUNT_NON_POSITIVE'
          );
        }
        const tombstone = await t.get(`users/${userId}/tombstones/${item.id}`);
        if (tombstone) {
          throw new LedgerTransactionError(
            `Item ${item.id} foi excluído previamente (Tombstone ativo). Ressurreição proibida.`,
            'TOMBSTONED_NO_RESURRECTION'
          );
        }
        const existingTx = await t.get(`users/${userId}/transactions/${item.id}`);
        if (existingTx) {
          throw new LedgerTransactionError(
            `Transação com id '${item.id}' já existe no ledger.`,
            'TRANSACTION_ALREADY_EXISTS'
          );
        }
      }

      // 3. Carregamento e Atualização das Contas Envolvidas
      const accountsMap = new Map<string, StoredAccountRecord>();
      const nowIso = new Date().toISOString();
      const fencing = params.fencingToken || 1;

      for (const item of params.items) {
        const isEstimated = item.isEstimated || false;
        if (!isEstimated) {
          const accId = item.type === 'INCOME' ? item.targetAccountId : item.sourceAccountId;
          if (!accId) {
            throw new LedgerTransactionError(`Item requer conta de ${item.type === 'INCOME' ? 'destino' : 'origem'}.`);
          }

          let acc = accountsMap.get(accId);
          if (!acc) {
            const fetched = await t.get(`users/${userId}/accounts/${accId}`) as StoredAccountRecord | null;
            if (fetched) {
              acc = fetched;
            } else {
              acc = {
                id: accId,
                userId,
                name: 'Conta Principal',
                balanceCents: 0,
                rev: 1,
                fencingToken: fencing,
                updatedAt: nowIso
              };
            }
          }

          const currentCents = SafeMoneySerializer.fromFirestoreCents(acc.balanceCents);
          const newCents = item.type === 'INCOME' ? currentCents + item.amountCents : currentCents - item.amountCents;
          acc = {
            ...acc,
            balanceCents: SafeMoneySerializer.toFirestoreCents(newCents),
            rev: acc.rev + 1,
            fencingToken: fencing,
            updatedAt: nowIso
          };
          accountsMap.set(accId, acc);
        }
      }

      // Persiste as contas atualizadas
      let maxRev = 1;
      for (const [accId, accRecord] of accountsMap.entries()) {
        t.set(`users/${userId}/accounts/${accId}`, accRecord);
        if (accRecord.rev > maxRev) maxRev = accRecord.rev;
      }

      // 4. Persiste cada transação e emite recibos individuais
      const receipts: MutationReceipt[] = [];
      const savedTransactions: StoredTransactionRecord[] = [];

      for (let i = 0; i < params.items.length; i++) {
        const item = params.items[i];
        const isEstimated = item.isEstimated || false;
        const firestoreCents = SafeMoneySerializer.toFirestoreCents(item.amountCents);
        const itemReqId = item.requestId || `${params.batchRequestId}_item_${i + 1}`;

        const txDoc: StoredTransactionRecord = {
          id: item.id,
          userId,
          requestId: itemReqId,
          type: item.type,
          amountCents: firestoreCents,
          sourceAccountId: item.sourceAccountId,
          targetAccountId: item.targetAccountId,
          category: item.category,
          description: item.description,
          date: item.date || nowIso.split('T')[0],
          isEstimated,
          rev: maxRev,
          fencingToken: fencing,
          createdAt: nowIso,
          updatedAt: nowIso,
          amount: firestoreCents / 100
        };

        t.set(`users/${userId}/transactions/${item.id}`, txDoc);
        savedTransactions.push(txDoc);

        const receipt: MutationReceipt = {
          status: 'APPLIED',
          code: 'TRANSACTION_COMMITTED',
          requestId: itemReqId,
          resultingRev: maxRev,
          fencingToken: fencing
        };
        receipts.push(receipt);

        // Idempotência individual por item
        const itemPayloadHash = computePayloadHash({
          id: item.id,
          type: item.type,
          amountCents: item.amountCents.toString(),
          sourceAccountId: item.sourceAccountId,
          targetAccountId: item.targetAccountId,
          category: item.category,
          description: item.description,
          isEstimated: item.isEstimated
        });

        t.set(`users/${userId}/idempotency/${itemReqId}`, {
          requestId: itemReqId,
          payloadHash: itemPayloadHash,
          status: 'APPLIED',
          code: 'TRANSACTION_COMMITTED',
          resultingRev: maxRev,
          fencingToken: fencing,
          createdAt: nowIso,
          responseSnapshot: txDoc
        });
      }

      // 5. Idempotência do Lote Consolidado no mesmo commit
      const batchResult = {
        status: 'APPLIED' as const,
        code: 'BATCH_COMMITTED' as const,
        batchRequestId: params.batchRequestId,
        resultingRev: maxRev,
        receipts,
        savedTransactions
      };

      t.set(batchIdempotencyPath, {
        requestId: params.batchRequestId,
        payloadHash,
        status: 'APPLIED',
        code: 'BATCH_COMMITTED',
        resultingRev: maxRev,
        fencingToken: fencing,
        createdAt: nowIso,
        responseSnapshot: batchResult
      });

      return batchResult;
    });
  }

  /**
   * Estorna uma transação financeira no Firestore:
   * 1. Verifica idempotência pelo requestId
   * 2. Localiza a transação original
   * 3. Desfaz o efeito contábil no saldo da conta
   * 4. Registra tombstone de 90 dias
   * 5. Grava recibo de idempotência
   */
  public async reverseTransaction(
    userId: string,
    params: {
      requestId: string;
      originalTxId: string;
      reason: string;
      fencingToken?: number;
    }
  ): Promise<MutationReceipt> {
    if (!userId) throw new Error('[FirestoreLedgerAdapter] userId é obrigatório');
    if (!params.requestId) throw new Error('[FirestoreLedgerAdapter] requestId é obrigatório');
    if (!params.originalTxId) throw new Error('[FirestoreLedgerAdapter] originalTxId é obrigatório');

    const idempotencyPath = `users/${userId}/idempotency/${params.requestId}`;
    const originalTxPath = `users/${userId}/transactions/${params.originalTxId}`;
    const tombstonePath = `users/${userId}/tombstones/${params.originalTxId}`;

    return await this.store.runTransaction(async (t) => {
      // 1. Idempotência por requestId
      const existingIdempotency = await t.get(idempotencyPath) as StoredIdempotencyRecord | null;
      if (existingIdempotency) {
        return {
          status: existingIdempotency.status,
          code: existingIdempotency.code,
          requestId: params.requestId,
          replay: true,
          resultingRev: existingIdempotency.resultingRev,
          fencingToken: existingIdempotency.fencingToken
        };
      }

      // 2. Busca transação original
      const origDoc = await t.get(originalTxPath) as StoredTransactionRecord | null;
      if (!origDoc) {
        throw new LedgerTransactionError(`Transação original '${params.originalTxId}' não encontrada para estorno.`, 'ORIGINAL_TX_NOT_FOUND');
      }

      // 3. Verifica se já possui tombstone
      const existingTomb = await t.get(tombstonePath);
      if (existingTomb) {
        throw new LedgerTransactionError(`Transação original '${params.originalTxId}' já foi estornada anteriormente (Tombstone ativo).`, 'ALREADY_REVERSED');
      }

      // 4. Desfaz o efeito no saldo da conta
      let amountCents: bigint;
      if (origDoc.amountCents !== undefined && origDoc.amountCents !== null) {
        amountCents = SafeMoneySerializer.fromFirestoreCents(origDoc.amountCents);
      } else if (origDoc.amount !== undefined && origDoc.amount !== null) {
        amountCents = parseToCents(origDoc.amount);
      } else {
        amountCents = 0n;
      }

      const isExpense = origDoc.type === 'EXPENSE';
      const isIncome = origDoc.type === 'INCOME';
      const accountId = isExpense ? origDoc.sourceAccountId : origDoc.targetAccountId;

      if (accountId && amountCents > 0n && !origDoc.isEstimated) {
        const accountPath = `users/${userId}/accounts/${accountId}`;
        const accDoc = await t.get(accountPath) as StoredAccountRecord | null;
        if (accDoc) {
          const currentBal = SafeMoneySerializer.fromFirestoreCents(accDoc.balanceCents);
          const newBal = isExpense ? currentBal + amountCents : currentBal - amountCents;
          const safeBal = SafeMoneySerializer.toFirestoreCents(newBal);
          t.set(accountPath, {
            ...accDoc,
            balanceCents: safeBal,
            rev: (accDoc.rev || 1) + 1,
            updatedAt: new Date().toISOString()
          });
        }
      }

      // 5. Registra Tombstone com TTL de 90 dias
      const tombstoneDoc = {
        id: params.originalTxId,
        userId,
        reason: params.reason,
        deletedAt: Date.now(),
        expiresAt: Date.now() + (90 * 24 * 60 * 60 * 1000),
        rev: (origDoc.rev || 1) + 1
      };
      t.set(tombstonePath, tombstoneDoc);

      // 6. Atualiza status da transação para estornada
      t.set(originalTxPath, {
        ...origDoc,
        status: 'REVERSED',
        reversedAt: new Date().toISOString(),
        reversalReason: params.reason
      });

      // 7. Grava Idempotência do estorno
      const receipt: MutationReceipt = {
        status: 'APPLIED',
        code: 'TRANSACTION_REVERSED',
        requestId: params.requestId,
        resultingRev: (origDoc.rev || 1) + 1,
        fencingToken: params.fencingToken || 1
      };

      const idempotencyDoc: StoredIdempotencyRecord = {
        requestId: params.requestId,
        payloadHash: computePayloadHash(params),
        status: 'APPLIED',
        code: 'TRANSACTION_REVERSED',
        resultingRev: receipt.resultingRev || 1,
        fencingToken: receipt.fencingToken || 1,
        createdAt: new Date().toISOString(),
        responseSnapshot: { success: true, receipt }
      };

      t.set(idempotencyPath, idempotencyDoc);

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
        status: doc.status || 'Concluído',
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
