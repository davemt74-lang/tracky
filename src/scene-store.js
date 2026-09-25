const DB_NAME = 'tracky-scene-v1';
const DB_VERSION = 1;
const CHANGES = 'scene-changes';
const EPISODES = 'scene-episodes';
const CONFIG = 'scene-config';

export const MAX_SCENE_CHANGES = 500;
export const MAX_SCENE_EPISODES = 250;

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
    tx.onabort = () => reject(tx.error || new Error('Scene storage transaction aborted.'));
  });
}

export function idsToPrune(rows, maxRows) {
  if (!Array.isArray(rows) || rows.length <= maxRows) return [];
  return [...rows]
    .sort((a, b) => Number(a.timestamp || a.startedAt || 0) - Number(b.timestamp || b.startedAt || 0))
    .slice(0, rows.length - maxRows)
    .map((row) => row.id)
    .filter(Boolean);
}

async function openSceneDb() {
  if (!('indexedDB' in window)) {
    throw new Error('IndexedDB is not available in this browser.');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(CHANGES)) {
        const changes = db.createObjectStore(CHANGES, { keyPath: 'id' });
        changes.createIndex('timestamp', 'timestamp', { unique: false });
        changes.createIndex('type', 'type', { unique: false });
      }

      if (!db.objectStoreNames.contains(EPISODES)) {
        const episodes = db.createObjectStore(EPISODES, { keyPath: 'id' });
        episodes.createIndex('startedAt', 'startedAt', { unique: false });
        episodes.createIndex('type', 'type', { unique: false });
      }

      if (!db.objectStoreNames.contains(CONFIG)) {
        db.createObjectStore(CONFIG, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Scene database upgrade is blocked by another tab.'));
  });
}

async function storeAction(storeName, mode, action) {
  const db = await openSceneDb();
  try {
    const tx = db.transaction(storeName, mode);
    const done = transactionToPromise(tx);
    const store = tx.objectStore(storeName);
    const result = await action(store);
    await done;
    return result;
  } finally {
    db.close();
  }
}

async function pruneStore(storeName, maxRows, timeField) {
  return storeAction(storeName, 'readwrite', async (store) => {
    const rows = await requestToPromise(store.getAll());
    const ids = idsToPrune(
      rows.map((row) => ({ ...row, timestamp: row[timeField] })),
      maxRows
    );
    for (const id of ids) store.delete(id);
    return ids.length;
  });
}

export async function saveSceneChanges(changes = []) {
  if (!changes.length) return [];

  await storeAction(CHANGES, 'readwrite', async (store) => {
    for (const change of changes) store.put(change);
  });

  await pruneStore(CHANGES, MAX_SCENE_CHANGES, 'timestamp').catch(() => {});
  return changes;
}

export async function saveSceneEpisodes(episodes = []) {
  if (!episodes.length) return [];

  await storeAction(EPISODES, 'readwrite', async (store) => {
    for (const episode of episodes) store.put(episode);
  });

  await pruneStore(EPISODES, MAX_SCENE_EPISODES, 'startedAt').catch(() => {});
  return episodes;
}

export function listSceneChanges(limit = 100) {
  return storeAction(CHANGES, 'readonly', async (store) => {
    const rows = await requestToPromise(store.getAll());
    return rows
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
      .slice(-Math.max(1, limit));
  });
}

export function listSceneEpisodes(limit = 100) {
  return storeAction(EPISODES, 'readonly', async (store) => {
    const rows = await requestToPromise(store.getAll());
    return rows
      .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0))
      .slice(-Math.max(1, limit));
  });
}

export async function saveSceneZones(zones = []) {
  const record = {
    key: 'zones',
    zones,
    updatedAt: Date.now()
  };

  await storeAction(CONFIG, 'readwrite', async (store) => {
    store.put(record);
  });

  return zones;
}

export async function loadSceneZones() {
  const record = await storeAction(
    CONFIG,
    'readonly',
    (store) => requestToPromise(store.get('zones'))
  );
  return Array.isArray(record?.zones) ? record.zones : [];
}

export async function clearSceneMemory(options = {}) {
  const preserveZones = options.preserveZones !== false;
  const db = await openSceneDb();

  try {
    const stores = preserveZones
      ? [CHANGES, EPISODES]
      : [CHANGES, EPISODES, CONFIG];
    const tx = db.transaction(stores, 'readwrite');
    const done = transactionToPromise(tx);
    tx.objectStore(CHANGES).clear();
    tx.objectStore(EPISODES).clear();
    if (!preserveZones) tx.objectStore(CONFIG).clear();
    await done;
    return true;
  } finally {
    db.close();
  }
}
