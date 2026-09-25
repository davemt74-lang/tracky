const DB_NAME = 'tracky-spatial-memory-v1';
const DB_VERSION = 1;
const STATE = 'state';

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
    tx.onabort = () => reject(tx.error || new Error('Spatial memory transaction aborted.'));
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
      if (!db.objectStoreNames.contains(STATE)) {
        db.createObjectStore(STATE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSpatialMemory() {
  const db = await openDb();
  try {
    const tx = db.transaction(STATE, 'readonly');
    const done = transactionToPromise(tx);
    const record = await requestToPromise(tx.objectStore(STATE).get('spatial-memory'));
    await done;
    return record?.value || null;
  } finally {
    db.close();
  }
}

export async function saveSpatialMemory(state) {
  const db = await openDb();
  try {
    const tx = db.transaction(STATE, 'readwrite');
    const done = transactionToPromise(tx);
    tx.objectStore(STATE).put({
      id: 'spatial-memory',
      updatedAt: Date.now(),
      value: state
    });
    await done;
    return state;
  } finally {
    db.close();
  }
}

export async function clearSpatialMemory() {
  const db = await openDb();
  try {
    const tx = db.transaction(STATE, 'readwrite');
    const done = transactionToPromise(tx);
    tx.objectStore(STATE).delete('spatial-memory');
    await done;
    return true;
  } finally {
    db.close();
  }
}
