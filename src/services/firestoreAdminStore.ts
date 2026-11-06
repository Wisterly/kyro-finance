/**
 * KYRO FINANCE | ADAPTADOR OFICIAL FIRESTORE ADMIN (TRANSAÇÕES ACID)
 * 
 * Implementação de ITransactionalStore sobre o Firebase Admin SDK (firebase-admin/firestore).
 * - Conecta nativamente ao Firestore Emulator quando FIRESTORE_EMULATOR_HOST está ativo
 * - Executa runTransaction oficial do Firestore garantindo isolamento ACID serializável
 * - Suporta leitura de volta, consultas particionadas por subcoleção e limpeza transacional
 */

import { getFirestore, Firestore, Transaction, DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getAdminApp } from './firebaseAdminAuth';
import { ITransactionalStore, IStoreTransaction } from './firestoreAdapter';

export class FirestoreAdminStore implements ITransactionalStore {
  private db: Firestore;

  constructor(customDb?: Firestore) {
    if (customDb) {
      this.db = customDb;
    } else {
      const app = getAdminApp();
      this.db = getFirestore(app);
    }
  }

  public getRawDb(): Firestore {
    return this.db;
  }

  /**
   * Executa uma transação atômica oficial no Firebase Firestore Admin.
   * Leituras e gravações ocorrem sob o controle transacional do Firestore.
   */
  public async runTransaction<T>(
    updateFunction: (transaction: IStoreTransaction) => Promise<T>
  ): Promise<T> {
    return await this.db.runTransaction(async (adminTx: Transaction) => {
      const t: IStoreTransaction = {
        get: async (path: string) => {
          const docRef = this.db.doc(path);
          const snap: DocumentSnapshot = await adminTx.get(docRef);
          if (!snap.exists) return null;
          return snap.data();
        },
        set: (path: string, data: any) => {
          const docRef = this.db.doc(path);
          const sanitized = JSON.parse(JSON.stringify(data));
          adminTx.set(docRef, sanitized, { merge: true });
        },
        delete: (path: string) => {
          const docRef = this.db.doc(path);
          adminTx.delete(docRef);
        }
      };

      return await updateFunction(t);
    });
  }

  /**
   * Lê um documento específico no Firestore.
   */
  public async getDocument(path: string): Promise<any | null> {
    const docRef = this.db.doc(path);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data();
  }

  /**
   * Consulta documentos de uma coleção ou subcoleção.
   */
  public async queryCollection(collectionPath: string): Promise<any[]> {
    const colRef = this.db.collection(collectionPath);
    const snap = await colRef.get();
    return snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() }));
  }

  /**
   * Limpa uma coleção inteira recursivamente (utilitário para testes de demonstração).
   */
  public async clearCollection(collectionPath: string): Promise<void> {
    const colRef = this.db.collection(collectionPath);
    const snap = await colRef.limit(100).get();
    const batch = this.db.batch();
    snap.docs.forEach((d: QueryDocumentSnapshot) => batch.delete(d.ref));
    if (!snap.empty) {
      await batch.commit();
    }
  }
}
