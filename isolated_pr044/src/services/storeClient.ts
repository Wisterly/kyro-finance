/**
 * KYRO FINANCE | IMPLEMENTAÇÃO DO CLIENTE TRANSACIONAL PARA EMULADOR E MEMÓRIA ISOLADA
 * Oferece semântica ACID estrita: Leituras consistentes, buffer de mutações
 * e commit atômico inseparável com trava serializável para concorrência.
 */

import { ITransactionalStore, IStoreTransaction } from './firestoreAdapter';

export class TransactionalStoreMock implements ITransactionalStore {
  // Mapa de coleções e documentos persistidos: path -> document
  public documents: Map<string, any> = new Map();

  // Fila de execução para garantir isolamento serializável (idêntico ao Firestore runTransaction)
  private transactionQueue: Promise<any> = Promise.resolve();

  /**
   * Executa uma transação atômica serializável.
   * As mutações (set / delete) são mantidas em um buffer local e só são
   * aplicadas no mapa principal se a função assíncrona for concluída com sucesso.
   * Se ocorrer erro antes do final, o buffer é descartado (ROLLBACK ATÔMICO GARANTIDO).
   */
  public async runTransaction<T>(
    updateFunction: (transaction: IStoreTransaction) => Promise<T>
  ): Promise<T> {
    // Encapsula no mutex da fila de transações para serializar transações concorrentes
    return new Promise<T>((resolve, reject) => {
      this.transactionQueue = this.transactionQueue.then(async () => {
        const writeBuffer: Map<string, any> = new Map();
        const deleteBuffer: Set<string> = new Set();

        const t: IStoreTransaction = {
          get: async (path: string) => {
            if (deleteBuffer.has(path)) return null;
            if (writeBuffer.has(path)) return JSON.parse(JSON.stringify(writeBuffer.get(path)));
            const doc = this.documents.get(path);
            return doc ? JSON.parse(JSON.stringify(doc)) : null;
          },
          set: (path: string, data: any) => {
            deleteBuffer.delete(path);
            writeBuffer.set(path, JSON.parse(JSON.stringify(data)));
          },
          delete: (path: string) => {
            writeBuffer.delete(path);
            deleteBuffer.add(path);
          }
        };

        try {
          // Executa a lógica transacional
          const result = await updateFunction(t);

          // Commit Atômico: aplica todo o buffer de uma só vez
          for (const path of deleteBuffer) {
            this.documents.delete(path);
          }
          for (const [path, data] of writeBuffer.entries()) {
            this.documents.set(path, data);
          }

          resolve(result);
        } catch (err) {
          // Em caso de falha: todo o buffer é descartado (ROLLBACK)
          reject(err);
        }
      }).catch(reject);
    });
  }

  public async getDocument(path: string): Promise<any | null> {
    const doc = this.documents.get(path);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  public async queryCollection(collectionPath: string): Promise<any[]> {
    const prefix = collectionPath.endsWith('/') ? collectionPath : `${collectionPath}/`;
    const results: any[] = [];

    for (const [key, value] of this.documents.entries()) {
      if (key.startsWith(prefix)) {
        // Garante que é filho direto
        const subPath = key.substring(prefix.length);
        if (!subPath.includes('/')) {
          results.push(JSON.parse(JSON.stringify(value)));
        }
      }
    }
    return results;
  }

  public clear(): void {
    this.documents.clear();
  }
}
