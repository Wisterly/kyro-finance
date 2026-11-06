import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuthToken, enforceTenantBoundary, CrossTenantViolationError, AuthenticationError } from '../src/services/authBoundary';
import { FirestoreLedgerAdapter, IdempotencyConflictError } from '../src/services/firestoreAdapter';
import { TransactionalStoreMock } from '../src/services/storeClient';
import { SafeMoneySerializer } from '../src/services/SafeMoneySerializer';
import { parseToCents } from '../src/engine/money';

// Armazenamento Central Transacional no Servidor (Singleton com semântica de isolamento por Tenant)
const globalStore: any = global;
if (!globalStore.__KYRO_SECURE_STORE__) {
  globalStore.__KYRO_SECURE_STORE__ = new TransactionalStoreMock();
}
export const getSecureStore = (): TransactionalStoreMock => globalStore.__KYRO_SECURE_STORE__;
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

  // 1. Verificação da Fronteira de Autenticação
  const authHeader = req.headers.authorization;
  const authContext = await verifyAuthToken(authHeader);

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

  // ==========================================================
  // GET: RECUPERA RECURSOS DELIMITADOS ESTREITAMENTE POR AUTH UID
  // ==========================================================
  if (req.method === 'GET') {
    try {
      const adapter = getLedgerAdapter();
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

      // Garante conta padrão se ainda não existir
      const adapter = getLedgerAdapter();
      const accountId = payload.accountId || 'acc_default';
      const existingAcc = await adapter.getAccount(authUid, accountId);
      if (!existingAcc) {
        await adapter.seedAccount({
          id: accountId,
          userId: authUid,
          name: 'Conta Principal',
          balanceCents: 0,
          rev: 1,
          fencingToken: 1,
          updatedAt: new Date().toISOString()
        });
      }

      // Ação: Gravar Transação Individual (save_transaction)
      if (action === 'save_transaction') {
        const rawTx = payload.transaction || payload;
        const txId = String(rawTx.id || `tx_${Date.now()}`);
        
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
            isEstimated: !!rawTx.isEstimated,
            fencingToken: payload.fencingToken || 1
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
          throw commitErr;
        }
      }

      return res.status(400).json({
        success: false,
        error: `Ação desconhecida: '${action}'`,
        code: 'UNKNOWN_ACTION'
      });

    } catch (e: any) {
      return res.status(500).json({
        success: false,
        error: 'Erro no processamento transacional',
        details: e?.message
      });
    }
  }

  return res.status(405).json({
    success: false,
    error: 'Método HTTP não permitido'
  });
}
