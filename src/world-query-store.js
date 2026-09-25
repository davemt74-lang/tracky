const DB_NAME = 'tracky-world-query-v1';
const DB_VERSION = 1;
const HISTORY = 'query-history';
const MAX_HISTORY = 100;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('World query transaction aborted.'));
  });
}

async function openDb() {
  if (!('indexedDB' in window)) {
    throw new Error('IndexedDB is not available in this browser.');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY)) {
        const store = db.createObjectStore(HISTORY, { keyPath: 'id' });
        store.createIndex('generatedAt', 'generatedAt', { unique:false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function compactRecord(query, answer) {
  return {
    id:'QUERY-' + Number(answer?.generatedAt || Date.now()) + '-' +
      Math.random().toString(36).slice(2,7),
    query:String(query?.text || query || '').slice(0,240),
    intent:String(answer?.intent || 'search'),
    status:String(answer?.status || 'unknown'),
    summary:String(answer?.summary || '').slice(0,500),
    confidence:Number(answer?.confidence || 0),
    generatedAt:Number(answer?.generatedAt || Date.now())
  };
}

export async function saveWorldQuery(query, answer) {
  const db=await openDb();
  try{
    const tx=db.transaction(HISTORY,'readwrite');
    const done=transactionToPromise(tx);
    const store=tx.objectStore(HISTORY);
    const record=compactRecord(query,answer);
    store.put(record);
    const all=await requestToPromise(store.getAll());
    const excess=all
      .sort((a,b)=>a.generatedAt-b.generatedAt)
      .slice(0,Math.max(0,all.length-MAX_HISTORY));
    for(const item of excess) store.delete(item.id);
    await done;
    return record;
  }finally{
    db.close();
  }
}

export async function listWorldQueries(limit=25) {
  const db=await openDb();
  try{
    const tx=db.transaction(HISTORY,'readonly');
    const done=transactionToPromise(tx);
    const rows=await requestToPromise(tx.objectStore(HISTORY).getAll());
    await done;
    return rows
      .sort((a,b)=>b.generatedAt-a.generatedAt)
      .slice(0,Math.max(1,Math.min(MAX_HISTORY,Number(limit||25))));
  }finally{
    db.close();
  }
}

export async function clearWorldQueries() {
  const db=await openDb();
  try{
    const tx=db.transaction(HISTORY,'readwrite');
    const done=transactionToPromise(tx);
    tx.objectStore(HISTORY).clear();
    await done;
    return true;
  }finally{
    db.close();
  }
}
