import { normalizeCameraConfig } from './camera-core.js';

const DB_NAME = 'tracky-camera-registry-v1';
const DB_VERSION = 1;
const CAMERAS = 'cameras';

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
    tx.onabort = () => reject(tx.error || new Error('Camera registry transaction aborted.'));
  });
}

export function normalizeCameraList(cameras = []) {
  const normalized = cameras.map((camera, index) => normalizeCameraConfig(camera, index));
  const primaryIndex = normalized.findIndex((camera) => camera.primary);

  if (primaryIndex < 0 && normalized.length) {
    normalized[0] = { ...normalized[0], primary: true };
  } else if (primaryIndex >= 0) {
    for (let index = 0; index < normalized.length; index += 1) {
      if (index !== primaryIndex && normalized[index].primary) {
        normalized[index] = { ...normalized[index], primary: false };
      }
    }
  }

  return normalized;
}

async function openDb() {
  if (!('indexedDB' in window)) {
    throw new Error('IndexedDB is not available in this browser.');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CAMERAS)) {
        db.createObjectStore(CAMERAS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Camera registry upgrade is blocked by another tab.'));
  });
}

async function action(mode, handler) {
  const db = await openDb();
  try {
    const tx = db.transaction(CAMERAS, mode);
    const done = transactionToPromise(tx);
    const store = tx.objectStore(CAMERAS);
    const result = await handler(store);
    await done;
    return result;
  } finally {
    db.close();
  }
}

export async function listCameraConfigs() {
  const rows = await action('readonly', (store) => requestToPromise(store.getAll()));
  return normalizeCameraList(rows);
}

export async function saveCameraConfig(camera) {
  const config = normalizeCameraConfig({
    ...camera,
    updatedAt: Date.now()
  });

  if (config.primary) {
    const existing = await listCameraConfigs();
    await action('readwrite', async (store) => {
      for (const item of existing) {
        if (item.id !== config.id && item.primary) {
          store.put({
            ...item,
            homography: undefined,
            primary: false,
            updatedAt: Date.now()
          });
        }
      }
      store.put({ ...config, homography: undefined });
    });
  } else {
    await action('readwrite', async (store) => {
      store.put({ ...config, homography: undefined });
    });
  }

  return config;
}

export async function deleteCameraConfig(id) {
  await action('readwrite', async (store) => {
    store.delete(id);
  });
  return true;
}

export async function replaceCameraConfigs(cameras = []) {
  const normalized = normalizeCameraList(cameras);
  await action('readwrite', async (store) => {
    store.clear();
    for (const camera of normalized) {
      store.put({ ...camera, homography: undefined });
    }
  });
  return normalized;
}
