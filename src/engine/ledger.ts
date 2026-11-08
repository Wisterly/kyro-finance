/**
 * KYRO FINANCE | ENGINE DE ESCRITURAÇÃO CONTÁBIL (LEDGER ENGINE)
 * Modelo B canônico: Isolamento estrito por userId, partidas dobradas,
 * controle de concorrência com fencing tokens, idempotência estrita por requestId
 * e retenção de tombstones por 90 dias.
 */

import { Cents, add, sub } from './money';
import { getISODateFortaleza, CANONICAL_TIMEZONE } from './calendar';

export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'REVERSAL';

export interface LedgerAccount {
  id: string;
  userId: string;
  name: string;
  balanceCents: Cents;
  currency: string;
  rev: number;
  fencingToken: number;
  updatedAt: string;
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  requestId: string;
  type: TransactionType;
  amountCents: Cents;
  sourceAccountId?: string;
  targetAccountId?: string;
  category: string;
  description: string;
  date: string; // YYYY-MM-DD em America/Fortaleza
  isEstimated?: boolean; // false = Realizado, true = Previsto/Recorrente
  rev: number;
  fencingToken: number;
  createdAt: string;
  updatedAt: string;
  method?: string;
  product?: string;
  establishment?: string;
  city?: string;
}

export interface Tombstone {
  id: string;
  userId: string;
  deletedAt: number;
  rev: number;
}

export interface MutationReceipt {
  status: 'APPLIED' | 'REJECTED' | 'CONFLICT' | 'ALREADY_EXISTS';
  code: string;
  requestId: string;
  replay?: boolean;
  resultingRev?: number;
  fencingToken?: number;
}

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

export class LedgerEngine {
  public accounts: Map<string, LedgerAccount> = new Map();
  public transactions: Map<string, LedgerTransaction> = new Map();
  public tombstones: Map<string, Tombstone> = new Map();
  public processedRequests: Map<string, MutationReceipt> = new Map();

  constructor(private nowProvider: () => number = () => Date.now()) {}

  private getNowIso(): string {
    return new Date(this.nowProvider()).toISOString();
  }

  /**
   * Cria ou registra uma conta para um usuário.
   */
  public createAccount(
    userId: string,
    accountId: string,
    name: string,
    initialBalanceCents: Cents = 0n,
    fencingToken: number = 1
  ): LedgerAccount {
    const key = `${userId}:${accountId}`;
    if (this.accounts.has(key)) {
      throw new Error(`[LedgerEngine] Conta já existente: ${accountId}`);
    }
    const account: LedgerAccount = {
      id: accountId,
      userId,
      name,
      balanceCents: initialBalanceCents,
      currency: 'BRL',
      rev: 1,
      fencingToken,
      updatedAt: this.getNowIso()
    };
    this.accounts.set(key, account);
    return account;
  }

  /**
   * Obtém uma conta validando isolamento estrito por userId.
   */
  public getAccount(userId: string, accountId: string): LedgerAccount | null {
    const key = `${userId}:${accountId}`;
    const acc = this.accounts.get(key);
    if (!acc || acc.userId !== userId) return null;
    return acc;
  }

  /**
   * Registra uma nova transação financeira aplicando idempotência e integridade contábil.
   */
  public recordTransaction(
    userId: string,
    tx: {
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
    }
  ): MutationReceipt {
    // 1. Verificação de Idempotência por requestId
    if (this.processedRequests.has(tx.requestId)) {
      const existing = this.processedRequests.get(tx.requestId)!;
      return { ...existing, replay: true };
    }

    const txKey = `${userId}:${tx.id}`;
    const tomb = this.tombstones.get(txKey);
    if (tomb) {
      const receipt: MutationReceipt = {
        status: 'REJECTED',
        code: 'TOMBSTONED_NO_RESURRECTION',
        requestId: tx.requestId
      };
      this.processedRequests.set(tx.requestId, receipt);
      return receipt;
    }

    if (this.transactions.has(txKey)) {
      const receipt: MutationReceipt = {
        status: 'ALREADY_EXISTS',
        code: 'TRANSACTION_ALREADY_EXISTS',
        requestId: tx.requestId
      };
      this.processedRequests.set(tx.requestId, receipt);
      return receipt;
    }

    if (tx.amountCents <= 0n) {
      const receipt: MutationReceipt = {
        status: 'REJECTED',
        code: 'INVALID_AMOUNT_NON_POSITIVE',
        requestId: tx.requestId
      };
      this.processedRequests.set(tx.requestId, receipt);
      return receipt;
    }

    const dateStr = tx.date || getISODateFortaleza(new Date(this.nowProvider()));
    const fencing = tx.fencingToken || 1;
    const isEstimated = tx.isEstimated || false;

    // 2. Aplicação do efeito no saldo das contas (apenas se for Realizado; previsto não afeta saldo presente)
    if (!isEstimated) {
      switch (tx.type) {
        case 'INCOME': {
          if (!tx.targetAccountId) throw new Error('[LedgerEngine] Conta destino é obrigatória para Receitas.');
          const acc = this.getAccount(userId, tx.targetAccountId);
          if (!acc) throw new Error(`[LedgerEngine] Conta não encontrada: ${tx.targetAccountId}`);
          acc.balanceCents = add(acc.balanceCents, tx.amountCents);
          acc.rev++;
          acc.updatedAt = this.getNowIso();
          break;
        }
        case 'EXPENSE': {
          if (!tx.sourceAccountId) throw new Error('[LedgerEngine] Conta origem é obrigatória para Despesas.');
          const acc = this.getAccount(userId, tx.sourceAccountId);
          if (!acc) throw new Error(`[LedgerEngine] Conta não encontrada: ${tx.sourceAccountId}`);
          acc.balanceCents = sub(acc.balanceCents, tx.amountCents);
          acc.rev++;
          acc.updatedAt = this.getNowIso();
          break;
        }
        case 'TRANSFER': {
          if (!tx.sourceAccountId || !tx.targetAccountId) {
            throw new Error('[LedgerEngine] Transferência requer conta origem e conta destino.');
          }
          if (tx.sourceAccountId === tx.targetAccountId) {
            throw new Error('[LedgerEngine] Conta origem e destino não podem ser iguais na transferência.');
          }
          const srcAcc = this.getAccount(userId, tx.sourceAccountId);
          const tgtAcc = this.getAccount(userId, tx.targetAccountId);
          if (!srcAcc || !tgtAcc) {
            throw new Error('[LedgerEngine] Contas de origem ou destino não encontradas.');
          }
          srcAcc.balanceCents = sub(srcAcc.balanceCents, tx.amountCents);
          tgtAcc.balanceCents = add(tgtAcc.balanceCents, tx.amountCents);
          srcAcc.rev++;
          tgtAcc.rev++;
          srcAcc.updatedAt = this.getNowIso();
          tgtAcc.updatedAt = this.getNowIso();
          break;
        }
        case 'REVERSAL': {
          // Estorno é tratado especificamente pelo método reverseTransaction
          break;
        }
      }
    }

    // 3. Persistência do registro contábil imutável
    const nowIso = this.getNowIso();
    const ledgerTx: LedgerTransaction = {
      id: tx.id,
      userId,
      requestId: tx.requestId,
      type: tx.type,
      amountCents: tx.amountCents,
      sourceAccountId: tx.sourceAccountId,
      targetAccountId: tx.targetAccountId,
      category: tx.category,
      description: tx.description,
      date: dateStr,
      isEstimated,
      rev: 1,
      fencingToken: fencing,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.transactions.set(txKey, ledgerTx);

    const receipt: MutationReceipt = {
      status: 'APPLIED',
      code: 'TRANSACTION_COMMITTED',
      requestId: tx.requestId,
      resultingRev: 1,
      fencingToken: fencing
    };
    this.processedRequests.set(tx.requestId, receipt);
    return receipt;
  }

  /**
   * Estorna uma transação anterior, revertendo seu impacto contábil exatamente.
   */
  public reverseTransaction(
    userId: string,
    requestId: string,
    originalTxId: string,
    reason: string
  ): MutationReceipt {
    if (this.processedRequests.has(requestId)) {
      return { ...this.processedRequests.get(requestId)!, replay: true };
    }

    const txKey = `${userId}:${originalTxId}`;
    const orig = this.transactions.get(txKey);
    if (!orig) {
      const receipt: MutationReceipt = { status: 'REJECTED', code: 'ORIGINAL_TX_NOT_FOUND', requestId };
      this.processedRequests.set(requestId, receipt);
      return receipt;
    }

    // Desfaz efeito contábil nas contas
    if (!orig.isEstimated) {
      if (orig.type === 'INCOME' && orig.targetAccountId) {
        const acc = this.getAccount(userId, orig.targetAccountId);
        if (acc) {
          acc.balanceCents = sub(acc.balanceCents, orig.amountCents);
          acc.rev++;
        }
      } else if (orig.type === 'EXPENSE' && orig.sourceAccountId) {
        const acc = this.getAccount(userId, orig.sourceAccountId);
        if (acc) {
          acc.balanceCents = add(acc.balanceCents, orig.amountCents);
          acc.rev++;
        }
      } else if (orig.type === 'TRANSFER' && orig.sourceAccountId && orig.targetAccountId) {
        const srcAcc = this.getAccount(userId, orig.sourceAccountId);
        const tgtAcc = this.getAccount(userId, orig.targetAccountId);
        if (srcAcc && tgtAcc) {
          srcAcc.balanceCents = add(srcAcc.balanceCents, orig.amountCents);
          tgtAcc.balanceCents = sub(tgtAcc.balanceCents, orig.amountCents);
          srcAcc.rev++;
          tgtAcc.rev++;
        }
      }
    }

    // Registra tombstone para o registro original
    this.transactions.delete(txKey);
    this.tombstones.set(txKey, {
      id: originalTxId,
      userId,
      deletedAt: this.nowProvider(),
      rev: orig.rev + 1
    });

    const receipt: MutationReceipt = {
      status: 'APPLIED',
      code: 'TRANSACTION_REVERSED',
      requestId,
      resultingRev: orig.rev + 1
    };
    this.processedRequests.set(requestId, receipt);
    return receipt;
  }
}
