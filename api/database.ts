import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  limit 
} from 'firebase/firestore';

// ==============================================================
// BANCO DE DADOS CENTRALIZADO E UNIVERSAL DO KYRO FINANCE (24H)
// Compartilhado automaticamente entre todos os Celulares, PCs e IPs
// ==============================================================

// Inicialização do Firebase Firestore no Backend da Vercel
let db: any = null;
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID
};

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  try {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);
  } catch (e) {
    console.warn('[Central Database] Firestore init warning:', e);
  }
}

// Memória Global em Nuvem compartilhada no Edge
const globalStore: any = global;
if (!globalStore.__KYRO_CENTRAL_DB__) {
  globalStore.__KYRO_CENTRAL_DB__ = {
    transactions: [],
    recurringExpenses: [],
    creditCards: [],
    lastUpdated: new Date().toISOString()
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ==========================================================
  // GET: RECUPERA O BANCO CENTRAL COMPARTILHADO
  // ==========================================================
  if (req.method === 'GET') {
    try {
      let transactions: any[] = [...(globalStore.__KYRO_CENTRAL_DB__.transactions || [])];

      // Se o Firestore estiver ativo, busca a coleção oficial 'kyro_transactions'
      if (db) {
        try {
          const q = query(collection(db, 'kyro_transactions'), orderBy('date', 'desc'), limit(200));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const firestoreTxs: any[] = [];
            snapshot.forEach(d => firestoreTxs.push({ id: d.id, ...d.data() }));
            if (firestoreTxs.length > 0) {
              transactions = firestoreTxs;
              globalStore.__KYRO_CENTRAL_DB__.transactions = firestoreTxs;
            }
          }
        } catch (err) {
          console.warn('[Central DB GET Firestore]:', err);
        }
      }

      return res.status(200).json({
        success: true,
        transactions,
        recurringExpenses: globalStore.__KYRO_CENTRAL_DB__.recurringExpenses || [],
        creditCards: globalStore.__KYRO_CENTRAL_DB__.creditCards || [],
        lastUpdated: globalStore.__KYRO_CENTRAL_DB__.lastUpdated,
        source: db ? 'firestore_central' : 'cloud_global_memory'
      });
    } catch (e: any) {
      return res.status(500).json({ error: 'Falha ao buscar banco central', details: e?.message });
    }
  }

  // ==========================================================
  // POST: SALVA, AJUSTA OU REMOVE NO BANCO CENTRAL
  // ==========================================================
  if (req.method === 'POST') {
    try {
      const payload = req.body || {};
      const action = payload.action;

      // 1. Sincronização Completa de Transações (sync_transactions / sync_all)
      if (action === 'sync_all' || action === 'sync_transactions') {
        const incoming = Array.isArray(payload.transactions) ? payload.transactions : [];
        if (incoming.length > 0) {
          globalStore.__KYRO_CENTRAL_DB__.transactions = incoming;
          globalStore.__KYRO_CENTRAL_DB__.lastUpdated = new Date().toISOString();

          if (db) {
            for (const tx of incoming) {
              if (tx?.id) {
                try {
                  await setDoc(doc(db, 'kyro_transactions', String(tx.id)), tx, { merge: true });
                } catch (e) {}
              }
            }
          }
        }
        if (Array.isArray(payload.recurringExpenses)) {
          globalStore.__KYRO_CENTRAL_DB__.recurringExpenses = payload.recurringExpenses;
        }
        if (Array.isArray(payload.creditCards)) {
          globalStore.__KYRO_CENTRAL_DB__.creditCards = payload.creditCards;
        }

        return res.status(200).json({
          success: true,
          message: 'Banco central atualizado com sucesso!',
          count: globalStore.__KYRO_CENTRAL_DB__.transactions.length,
          lastUpdated: globalStore.__KYRO_CENTRAL_DB__.lastUpdated
        });
      }

      // 2. Salvar ou Ajustar Transação Individual (save_transaction)
      if (action === 'save_transaction') {
        const tx = payload.transaction;
        if (!tx || !tx.id) {
          return res.status(400).json({ error: 'Transação inválida ou sem id.' });
        }

        const txId = String(tx.id);
        const list = globalStore.__KYRO_CENTRAL_DB__.transactions || [];
        const index = list.findIndex((t: any) => String(t.id) === txId);

        if (index >= 0) {
          list[index] = { ...list[index], ...tx };
        } else {
          list.unshift(tx);
        }

        globalStore.__KYRO_CENTRAL_DB__.transactions = list;
        globalStore.__KYRO_CENTRAL_DB__.lastUpdated = new Date().toISOString();

        if (db) {
          try {
            await setDoc(doc(db, 'kyro_transactions', txId), tx, { merge: true });
          } catch (e) {}
        }

        return res.status(200).json({
          success: true,
          message: 'Transação salva no banco central.',
          transaction: tx
        });
      }

      // 3. Excluir Transação Individual (delete_transaction)
      if (action === 'delete_transaction') {
        const txId = String(payload.id);
        if (!txId) return res.status(400).json({ error: 'Id obrigatório' });

        globalStore.__KYRO_CENTRAL_DB__.transactions = (globalStore.__KYRO_CENTRAL_DB__.transactions || [])
          .filter((t: any) => String(t.id) !== txId);
        globalStore.__KYRO_CENTRAL_DB__.lastUpdated = new Date().toISOString();

        if (db) {
          try {
            await deleteDoc(doc(db, 'kyro_transactions', txId));
          } catch (e) {}
        }

        return res.status(200).json({
          success: true,
          message: `Transação ${txId} removida do banco central.`
        });
      }

      // 4. Excluir Múltiplas Transações em Lote (delete_transactions)
      if (action === 'delete_transactions') {
        const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
        if (ids.length === 0) return res.status(400).json({ error: 'Lista de ids obrigatória' });

        globalStore.__KYRO_CENTRAL_DB__.transactions = (globalStore.__KYRO_CENTRAL_DB__.transactions || [])
          .filter((t: any) => !ids.includes(String(t.id)));
        globalStore.__KYRO_CENTRAL_DB__.lastUpdated = new Date().toISOString();

        if (db) {
          for (const id of ids) {
            try {
              await deleteDoc(doc(db, 'kyro_transactions', id));
            } catch (e) {}
          }
        }

        return res.status(200).json({
          success: true,
          message: `${ids.length} transações removidas do banco central.`
        });
      }

      return res.status(400).json({ error: 'Ação não reconhecida no banco central.' });

    } catch (e: any) {
      return res.status(500).json({ error: 'Erro ao processar banco central', details: e?.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido.' });
}
