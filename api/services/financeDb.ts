import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
};

let db: any = null;

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
}

export interface NewTransactionInput {
  description: string;
  category: string;
  subcategory?: string;
  city: string;
  amount: number;
  type: 'Entrada' | 'Saída';
  method: 'PIX' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Transferência';
  date?: string;
  status?: 'Concluído' | 'Pendente';
  currentInstallment?: number;
  totalInstallments?: number;
}

export const saveTransactionToDb = async (tx: NewTransactionInput) => {
  if (!db) {
    console.warn('[Firestore] Firebase não configurado no backend. Simulação ou variáveis ausentes.');
    return { id: Date.now().toString(), ...tx };
  }

  const payload = {
    ...tx,
    date: tx.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: tx.status || 'Concluído',
    createdAt: new Date().toISOString()
  };

  const docRef = await addDoc(collection(db, 'kyro_transactions'), payload);
  return { id: docRef.id, ...payload };
};

export const getRecentTransactionsFromDb = async (max: number = 20) => {
  if (!db) return [];
  try {
    const q = query(collection(db, 'kyro_transactions'), orderBy('createdAt', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[Firestore] Erro ao buscar transações:', e);
    return [];
  }
};
