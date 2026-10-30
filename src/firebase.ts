import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  Firestore 
} from 'firebase/firestore';
import { Transaction, RecurringExpense } from './types';

class KyroCloudSync {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  public isConnected: boolean = false;

  constructor() {
    this.init();
  }

  public init(): boolean {
    let savedConfig = this.getSavedConfig();
    if (!savedConfig || !savedConfig.apiKey) {
      const metaEnv = (import.meta as any)?.env;
      if (metaEnv && metaEnv.VITE_FIREBASE_API_KEY) {
        savedConfig = {
          apiKey: metaEnv.VITE_FIREBASE_API_KEY,
          authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: metaEnv.VITE_FIREBASE_PROJECT_ID,
          storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: metaEnv.VITE_FIREBASE_APP_ID,
        };
      }
    }

    if (savedConfig && savedConfig.apiKey && savedConfig.projectId) {
      try {
        if (!getApps().length) {
          this.app = initializeApp(savedConfig);
        } else {
          this.app = getApp();
        }
        this.db = getFirestore(this.app);
        this.isConnected = true;
        return true;
      } catch (err) {
        console.warn("Erro ao conectar Firebase:", err);
        this.isConnected = false;
        return false;
      }
    }
    this.isConnected = false;
    return false;
  }

  public getSavedConfig(): any | null {
    try {
      const data = localStorage.getItem('kyro_firebase_config');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  public saveConfig(config: any): boolean {
    try {
      localStorage.setItem('kyro_firebase_config', JSON.stringify(config));
      return this.init();
    } catch {
      return false;
    }
  }

  // --- SINCRONIZAÇÃO EM TEMPO REAL: TRANSAÇÕES ---
  public subscribeTransactions(onUpdate: (txs: Transaction[]) => void): () => void {
    if (this.isConnected && this.db) {
      const col = collection(this.db, 'kyro_transactions');
      return onSnapshot(col, (snapshot) => {
        const incomingList: Transaction[] = [];
        snapshot.forEach((d) => {
          incomingList.push({ id: d.id, ...d.data() } as Transaction);
        });

        // Carrega transações locais persistidas e lista de exclusões explícitas
        const deletedRaw = localStorage.getItem('kyro_deleted_tx_ids');
        const deletedSet: Set<string> = deletedRaw ? new Set(JSON.parse(deletedRaw)) : new Set();

        let localTxs: Transaction[] = [];
        try {
          const saved = localStorage.getItem('kyro_transactions');
          if (saved) localTxs = JSON.parse(saved);
        } catch {}

        const validLocal = (localTxs || []).filter(t => t && t.id && !deletedSet.has(String(t.id)));
        const validIncoming = incomingList.filter(t => t && t.id && !deletedSet.has(String(t.id)));

        // Se o snapshot do Firestore vier vazio mas houver transações locais:
        // NUNCA APAGA! Re-hidrata a nuvem enviando os dados locais intactos.
        if (validIncoming.length === 0 && validLocal.length > 0) {
          console.log('[KyroCloudSync] Re-hidratando Firestore com dados locais persistidos...');
          validLocal.forEach(t => this.syncSaveTransaction(t));
          onUpdate(validLocal);
          return;
        }

        // Merge seguro sem perda: preserva dados locais que ainda estão propagando para a nuvem
        const incomingIds = new Set(validIncoming.map(t => String(t.id)));
        const missingInCloud = validLocal.filter(l => !incomingIds.has(String(l.id)));

        if (missingInCloud.length > 0) {
          missingInCloud.forEach(t => this.syncSaveTransaction(t));
        }

        const merged = [...missingInCloud, ...validIncoming];
        merged.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        localStorage.setItem('kyro_transactions', JSON.stringify(merged));
        onUpdate(merged);
      }, (err) => {
        console.warn("Firestore listener:", err);
      });
    }
    return () => {};
  }

  public async syncSaveTransaction(tx: Transaction): Promise<void> {
    if (this.isConnected && this.db) {
      try {
        await setDoc(doc(this.db, 'kyro_transactions', tx.id), tx, { merge: true });
      } catch (e) {
        console.error("Erro ao salvar transação no Firestore:", e);
      }
    }
  }

  public async syncDeleteTransaction(txId: string): Promise<void> {
    if (this.isConnected && this.db) {
      try {
        await deleteDoc(doc(this.db, 'kyro_transactions', txId));
      } catch (e) {
        console.error("Erro ao excluir transação no Firestore:", e);
      }
    }
  }

  // --- SINCRONIZAÇÃO EM TEMPO REAL: RECORRENTES ---
  public async syncSaveRecurring(rec: RecurringExpense): Promise<void> {
    if (this.isConnected && this.db) {
      try {
        await setDoc(doc(this.db, 'kyro_recurring', rec.id), rec, { merge: true });
      } catch (e) {
        console.error("Erro ao salvar recorrente no Firestore:", e);
      }
    }
  }

  public async syncDeleteRecurring(recId: string): Promise<void> {
    if (this.isConnected && this.db) {
      try {
        await deleteDoc(doc(this.db, 'kyro_recurring', recId));
      } catch (e) {
        console.error("Erro ao excluir recorrente no Firestore:", e);
      }
    }
  }
}

export const kyroCloud = new KyroCloudSync();
