import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuthToken, enforceTenantBoundary, CrossTenantViolationError, AuthenticationError } from '../src/services/authBoundary';
import { 
  FirestoreLedgerAdapter, 
  IdempotencyConflictError, 
  ITransactionalStore,
  LeaseExpiredError,
  FencingTokenMismatchError,
  LeaseHolderMismatchError,
  LeaseAlreadyHeldError,
  LeaseNotFoundError
} from '../src/services/firestoreAdapter';
import { TransactionalStoreMock } from '../src/services/storeClient';
import { FirestoreAdminStore } from '../src/services/firestoreAdminStore';
import { SafeMoneySerializer } from '../src/services/SafeMoneySerializer';
import { parseToCents } from '../src/engine/money';

// Armazenamento Central Transacional no Servidor (Singleton com semântica de isolamento por Tenant)
const globalStore: any = global;

export class StorageUnavailableError extends Error {
  public readonly code = 'STORAGE_UNAVAILABLE';
  public readonly statusCode = 503;
  constructor(message: string = 'Armazenamento transacional indisponível. Gravação não confirmada.') {
    super(`[StorageUnavailable] ${message}`);
    this.name = 'StorageUnavailableError';
  }
}

function createDefaultStore(): ITransactionalStore {
  // A rota pública da aplicação usa exclusivamente o Firestore oficial.
  // Nenhum fallback silencioso para mock é permitido no caminho da aplicação.
  if (process.env.STORAGE_DISABLED === 'true') {
    throw new StorageUnavailableError('Armazenamento Firestore explicitamente desabilitado ou indisponível.');
  }

  try {
    return new FirestoreAdminStore();
  } catch (err: any) {
    throw new StorageUnavailableError(`Falha ao conectar com o Firestore oficial: ${err?.message || err}`);
  }
}

if (!globalStore.__KYRO_SECURE_STORE__) {
  try {
    globalStore.__KYRO_SECURE_STORE__ = createDefaultStore();
  } catch {
    // Inicialização sob demanda com tratamento de indisponibilidade
    globalStore.__KYRO_SECURE_STORE__ = null;
  }
}

export const getSecureStore = (): ITransactionalStore => {
  if (!globalStore.__KYRO_SECURE_STORE__) {
    globalStore.__KYRO_SECURE_STORE__ = createDefaultStore();
  }
  return globalStore.__KYRO_SECURE_STORE__;
};

export const setStoreInstance = (store: ITransactionalStore): void => {
  globalStore.__KYRO_SECURE_STORE__ = store;
};

export const resetStoreInstance = (): void => {
  try {
    globalStore.__KYRO_SECURE_STORE__ = createDefaultStore();
  } catch {
    globalStore.__KYRO_SECURE_STORE__ = null;
  }
};

export const getLedgerAdapter = (): FirestoreLedgerAdapter => new FirestoreLedgerAdapter(getSecureStore());

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configuração de cabeçalhos de segurança e CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Verificação da Fronteira de Autenticação Real na Entrada Pública
  // A entrada pública NUNCA permite tokens sintéticos (demo-token), sob nenhuma variável de ambiente.
  const authHeader = req.headers.authorization;
  const authContext = await verifyAuthToken(authHeader, { allowSyntheticInTest: false });

  if (!authContext.isValid || !authContext.uid) {
    return res.status(401).json({
      success: false,
      error: authContext.error || 'Acesso não autorizado: credencial inválida ou ausente.',
      code: 'UNAUTHORIZED_INVALID_CREDENTIAL'
    });
  }

  const authUid = authContext.uid;

  // 2. Verificação de Tentativa de Cross-Tenant (Segurança contra personificação)
  const incomingUid = (req.body?.userId || req.query?.userId) as string | undefined;
  try {
    enforceTenantBoundary(authContext, incomingUid);
  } catch (err: any) {
    if (err instanceof CrossTenantViolationError) {
      return res.status(403).json({
        success: false,
        error: err.message,
        code: err.code
      });
    }
    return res.status(401).json({
      success: false,
      error: err.message,
      code: 'UNAUTHORIZED'
    });
  }

  // 3. Obtenção do Armazenamento Persistente Oficial
  let adapter: FirestoreLedgerAdapter;
  let store: ITransactionalStore;
  try {
    store = getSecureStore();
    adapter = getLedgerAdapter();
  } catch (err: any) {
    return res.status(503).json({
      success: false,
      error: 'Armazenamento transacional indisponível. Gravação não confirmada.',
      code: 'STORAGE_UNAVAILABLE',
      details: err?.message
    });
  }

  // ==========================================================
  // GET: RECUPERA RECURSOS DELIMITADOS ESTREITAMENTE POR AUTH UID
  // Lê de volta saldos, lançamento e recibo pela rota HTTP
  // ==========================================================
  if (req.method === 'GET') {
    try {
      const queryType = req.query?.type as string | undefined;

      // 1. Leitura de Conta e Saldo
      if (queryType === 'account') {
        const accountId = (req.query?.accountId as string) || 'acc_default';
        const accountOwner = req.query?.accountOwnerId as string | undefined;
        if (accountOwner && accountOwner !== authUid) {
          return res.status(403).json({
            success: false,
            error: `Violação de fronteira: A conta pertence ao UID '${accountOwner}'. Acesso bloqueado.`,
            code: 'PERMISSION_DENIED_ACCOUNT_MISMATCH'
          });
        }
        if (accountId.includes(':')) {
          const prefix = accountId.split(':')[0];
          if (prefix !== authUid) {
            return res.status(403).json({
              success: false,
              error: `Violação de fronteira: A conta '${accountId}' pertence a outro usuário. Acesso bloqueado.`,
              code: 'PERMISSION_DENIED_ACCOUNT_MISMATCH'
            });
          }
        }

        const account = await adapter.getAccount(authUid, accountId);
        if (!account) {
          return res.status(404).json({
            success: false,
            error: `Conta '${accountId}' não encontrada.`,
            code: 'ACCOUNT_NOT_FOUND'
          });
        }
        return res.status(200).json({
          success: true,
          userId: authUid,
          account: {
            ...account,
            balanceCentsFormatted: (account.balanceCents / 100).toFixed(2)
          }
        });
      }

      // 2. Leitura de Recibo de Idempotência
      if (queryType === 'idempotency') {
        const reqId = (req.query?.requestId as string) || (req.headers['x-request-id'] as string);
        if (!reqId) {
          return res.status(400).json({
            success: false,
            error: 'requestId é obrigatório para consultar recibo de idempotência.',
            code: 'MISSING_REQUEST_ID'
          });
        }
        const receipt = await store.getDocument(`users/${authUid}/idempotency/${reqId}`);
        if (!receipt) {
          return res.status(404).json({
            success: false,
            error: `Recibo de idempotência '${reqId}' não encontrado.`,
            code: 'RECEIPT_NOT_FOUND'
          });
        }
        return res.status(200).json({
          success: true,
          userId: authUid,
          receipt
        });
      }

      // 3. Leitura de Lançamento Individual Específico
      if (queryType === 'transaction') {
        const txId = req.query?.txId as string;
        if (!txId) {
          return res.status(400).json({
            success: false,
            error: 'txId é obrigatório.',
            code: 'MISSING_TX_ID'
          });
        }
        const txDoc = await store.getDocument(`users/${authUid}/transactions/${txId}`);
        if (!txDoc) {
          return res.status(404).json({
            success: false,
            error: `Transação '${txId}' não encontrada.`,
            code: 'TRANSACTION_NOT_FOUND'
          });
        }
        return res.status(200).json({
          success: true,
          userId: authUid,
          transaction: txDoc
        });
      }

      // 3.5. Leitura de Lease de Concorrência
      if (queryType === 'lease') {
        const resourceId = (req.query?.resourceId as string) || 'default_ledger';
        const lease = await adapter.getLeaseManager().getLease(authUid, resourceId);
        return res.status(200).json({
          success: true,
          userId: authUid,
          resourceId,
          lease
        });
      }

      // 4. Leitura Geral de Transações do Usuário (Preservando dados legados)
      const transactions = await adapter.listUserTransactions(authUid);

      return res.status(200).json({
        success: true,
        userId: authUid,
        count: transactions.length,
        transactions: transactions.map(tx => ({
          ...tx,
          amountCents: tx.amountCents.toString(), // Wire string segura
          amount: Number(tx.amountCents) / 100 // Compatibilidade legada
        })),
        source: 'firestore_tenant_isolated'
      });
    } catch (e: any) {
      return res.status(500).json({
        success: false,
        error: 'Falha ao recuperar dados do tenant',
        details: e?.message
      });
    }
  }

  // ==========================================================
  // POST: OPERAÇÕES CONTÁBEIS AUTORIZADAS E TRANSACIONAIS
  // ==========================================================
  if (req.method === 'POST') {
    try {
      const payload = req.body || {};
      const action = payload.action;
      const requestId = (req.headers['x-request-id'] as string) || payload.requestId;

      if (!requestId) {
        return res.status(400).json({
          success: false,
          error: 'Cabeçalho X-Request-ID ou campo requestId no corpo é obrigatório para garantir idempotência.',
          code: 'MISSING_REQUEST_ID'
        });
      }

      const accountId = payload.accountId || 'acc_default';

      // Ação: Adquirir Lease de Concorrência (acquire_lease)
      if (action === 'acquire_lease') {
        const resourceId = payload.resourceId || 'default_ledger';
        const holderId = payload.holderId || (req.headers['x-process-holder-id'] as string) || `pid_${process.pid}`;
        const ttlMs = payload.ttlMs ? Number(payload.ttlMs) : 30000;
        const result = await adapter.getLeaseManager().acquireLease(authUid, resourceId, holderId, ttlMs);
        return res.status(200).json({
          userId: authUid,
          ...result
        });
      }

      // Ação: Renovar Lease de Concorrência (renew_lease)
      if (action === 'renew_lease') {
        const resourceId = payload.resourceId || 'default_ledger';
        const holderId = payload.holderId || (req.headers['x-process-holder-id'] as string) || `pid_${process.pid}`;
        const fencingToken = Number(payload.fencingToken);
        const ttlMs = payload.ttlMs ? Number(payload.ttlMs) : 30000;
        const lease = await adapter.getLeaseManager().renewLease(authUid, resourceId, holderId, fencingToken, ttlMs);
        return res.status(200).json({
          success: true,
          userId: authUid,
          lease
        });
      }

      // Ação: Liberar Lease de Concorrência (release_lease)
      if (action === 'release_lease') {
        const resourceId = payload.resourceId || 'default_ledger';
        const holderId = payload.holderId || (req.headers['x-process-holder-id'] as string) || `pid_${process.pid}`;
        const fencingToken = Number(payload.fencingToken);
        await adapter.getLeaseManager().releaseLease(authUid, resourceId, holderId, fencingToken);
        return res.status(200).json({
          success: true,
          userId: authUid,
          message: `Lease do recurso '${resourceId}' liberado com sucesso.`
        });
      }

      // Ação: Gravar Transação Individual (save_transaction)
      if (action === 'save_transaction') {
        const rawTx = payload.transaction || payload;
        const txId = String(rawTx.id || `tx_${Date.now()}`);

        // Validação estrita de Titularidade da Conta: a conta informada DEVE pertencer ao UID autenticado
        const incomingAccountOwner = payload.accountOwnerId || payload.accountUserId || rawTx.accountOwnerId;
        if (incomingAccountOwner && incomingAccountOwner.trim() !== '' && incomingAccountOwner !== authUid) {
          return res.status(403).json({
            success: false,
            error: `Violação de fronteira: A conta '${accountId}' pertence ao UID '${incomingAccountOwner}', divergente do usuário autenticado '${authUid}'. Acesso bloqueado.`,
            code: 'PERMISSION_DENIED_ACCOUNT_MISMATCH'
          });
        }

        if (accountId.includes(':')) {
          const accountOwnerPrefix = accountId.split(':')[0];
          if (accountOwnerPrefix !== authUid) {
            return res.status(403).json({
              success: false,
              error: `Violação de fronteira: A conta '${accountId}' pertence a outro usuário (${accountOwnerPrefix}). Acesso bloqueado.`,
              code: 'PERMISSION_DENIED_ACCOUNT_MISMATCH'
            });
          }
        }
        
        let amountCents: bigint;
        if (rawTx.amountCents !== undefined && rawTx.amountCents !== null) {
          amountCents = SafeMoneySerializer.fromWire(rawTx.amountCents);
        } else if (rawTx.amount !== undefined && rawTx.amount !== null) {
          amountCents = parseToCents(rawTx.amount);
        } else {
          return res.status(400).json({
            success: false,
            error: 'Valor monetário (amountCents ou amount) é obrigatório.',
            code: 'INVALID_AMOUNT'
          });
        }

        const type = (rawTx.type === 'Receita' || rawTx.type === 'INCOME') ? 'INCOME' : 'EXPENSE';

        try {
          const receipt = await adapter.commitTransaction(authUid, {
            requestId,
            id: txId,
            type,
            amountCents,
            sourceAccountId: type === 'EXPENSE' ? accountId : undefined,
            targetAccountId: type === 'INCOME' ? accountId : undefined,
            category: rawTx.category || 'Geral',
            description: rawTx.description || 'Lançamento via API Segura',
            date: rawTx.date,
            method: rawTx.method,
            product: rawTx.product,
            establishment: rawTx.establishment,
            city: rawTx.city,
            isEstimated: !!rawTx.isEstimated,
            fencingToken: payload.fencingToken !== undefined ? Number(payload.fencingToken) : undefined,
            holderId: payload.holderId || (req.headers['x-process-holder-id'] as string) || undefined,
            resourceId: payload.resourceId || accountId || undefined
          });

          return res.status(200).json({
            success: true,
            receipt,
            userId: authUid,
            transactionId: txId
          });
        } catch (commitErr: any) {
          if (commitErr instanceof IdempotencyConflictError) {
            return res.status(409).json({
              success: false,
              error: commitErr.message,
              code: commitErr.code
            });
          }
          if (commitErr instanceof LeaseExpiredError || commitErr?.code === 'LEASE_EXPIRED') {
            return res.status(412).json({
              success: false,
              error: commitErr.message,
              code: 'LEASE_EXPIRED'
            });
          }
          if (commitErr instanceof FencingTokenMismatchError || commitErr?.code === 'FENCING_TOKEN_OBSOLETE') {
            return res.status(412).json({
              success: false,
              error: commitErr.message,
              code: 'FENCING_TOKEN_OBSOLETE'
            });
          }
          if (commitErr instanceof LeaseHolderMismatchError || commitErr?.code === 'LEASE_HOLDER_MISMATCH') {
            return res.status(412).json({
              success: false,
              error: commitErr.message,
              code: 'LEASE_HOLDER_MISMATCH'
            });
          }
          if (commitErr instanceof LeaseAlreadyHeldError || commitErr?.code === 'LEASE_ALREADY_HELD') {
            return res.status(409).json({
              success: false,
              error: commitErr.message,
              code: 'LEASE_ALREADY_HELD'
            });
          }
          throw commitErr;
        }
      }

      return res.status(400).json({
        success: false,
        error: `Ação desconhecida: '${action}'`,
        code: 'UNKNOWN_ACTION'
      });

    } catch (e: any) {
      if (e instanceof IdempotencyConflictError) {
        return res.status(409).json({
          success: false,
          error: e.message,
          code: e.code
        });
      }
      if (e instanceof LeaseExpiredError || e?.code === 'LEASE_EXPIRED') {
        return res.status(412).json({
          success: false,
          error: e.message,
          code: 'LEASE_EXPIRED'
        });
      }
      if (e instanceof FencingTokenMismatchError || e?.code === 'FENCING_TOKEN_OBSOLETE') {
        return res.status(412).json({
          success: false,
          error: e.message,
          code: 'FENCING_TOKEN_OBSOLETE'
        });
      }
      if (e instanceof LeaseHolderMismatchError || e?.code === 'LEASE_HOLDER_MISMATCH') {
        return res.status(412).json({
          success: false,
          error: e.message,
          code: 'LEASE_HOLDER_MISMATCH'
        });
      }
      if (e instanceof LeaseAlreadyHeldError || e?.code === 'LEASE_ALREADY_HELD') {
        return res.status(409).json({
          success: false,
          error: e.message,
          code: 'LEASE_ALREADY_HELD'
        });
      }
      if (e instanceof LeaseNotFoundError || e?.code === 'LEASE_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: e.message,
          code: 'LEASE_NOT_FOUND'
        });
      }

      const isStorageFailure = 
        e instanceof StorageUnavailableError ||
        e?.code === 'STORAGE_UNAVAILABLE' ||
        e?.code === 'UNAVAILABLE' ||
        e?.code === 14 ||
        e?.message?.includes('UNAVAILABLE') ||
        e?.message?.includes('ECONNREFUSED') ||
        e?.message?.includes('Armazenamento transacional indisponível') ||
        e?.message?.includes('Could not reach Cloud Firestore');

      return res.status(isStorageFailure ? 503 : 500).json({
        success: false,
        error: isStorageFailure 
          ? 'Armazenamento transacional indisponível. Gravação não confirmada.' 
          : (e?.message || 'Erro no processamento transacional.'),
        code: isStorageFailure ? 'STORAGE_UNAVAILABLE' : (e?.code || 'INTERNAL_ERROR'),
        details: e?.message
      });
    }
  }

  return res.status(405).json({
    success: false,
    error: 'Método HTTP não permitido'
  });
}
