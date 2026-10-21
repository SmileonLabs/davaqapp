// One IndexedDB transaction stores bodies and their receive revision together.
let opened: Promise<IDBDatabase> | null = null;
function database() {
  return opened ??= new Promise<IDBDatabase>((resolve,reject) => {
    const req = indexedDB.open('davaq-chat-history-v1',1);
    req.onupgradeneeded = () => req.result.createObjectStore('snapshots');
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); opened=null; }; resolve(req.result); };
    req.onerror = () => { opened=null; reject(req.error); };
    req.onblocked = () => { opened=null; reject(new Error('History storage blocked')); };
  });
}
async function operation<T>(mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx=db.transaction('snapshots',mode),request=action(tx.objectStore('snapshots'));
    tx.oncomplete=()=>resolve(request.result);
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error ?? new Error('History transaction aborted'));
  });
}
export default {
  async getItem(key: string): Promise<string|null> { return (await operation('readonly',s=>s.get(key))) ?? null; },
  async setItem(key: string,value: string): Promise<void> { await operation('readwrite',s=>s.put(value,key)); },
  async removeItem(key: string): Promise<void> { await operation('readwrite',s=>s.delete(key)); },
  async getAllKeys(): Promise<string[]> { return (await operation('readonly',s=>s.getAllKeys())).filter((k): k is string=>typeof k==='string'); },
};
