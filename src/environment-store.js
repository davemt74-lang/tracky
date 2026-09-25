import { normalizeLandmark } from './environment-core.js';

const DB_NAME = 'tracky-environment-v1';
const DB_VERSION = 1;
const ROOMS = 'rooms';
const VIEWS = 'views';
const HISTORY = 'environment-history';
const POLICIES = 'environment-policies';

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
    tx.onabort = () => reject(tx.error || new Error('Environment storage transaction aborted.'));
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
      if (!db.objectStoreNames.contains(ROOMS)) {
        db.createObjectStore(ROOMS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VIEWS)) {
        const store = db.createObjectStore(VIEWS, { keyPath: 'id' });
        store.createIndex('roomId', 'roomId', { unique: false });
      }
      if (!db.objectStoreNames.contains(HISTORY)) {
        const store = db.createObjectStore(HISTORY, { keyPath: 'id' });
        store.createIndex('roomId', 'roomId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(POLICIES)) {
        db.createObjectStore(POLICIES, { keyPath: 'roomId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Environment database upgrade is blocked by another tab.'));
  });
}

async function action(stores, mode, handler) {
  const db = await openDb();
  try {
    const names = Array.isArray(stores) ? stores : [stores];
    const tx = db.transaction(names, mode);
    const done = transactionToPromise(tx);
    const result = await handler(tx);
    await done;
    return result;
  } finally {
    db.close();
  }
}

export function normalizeRoom(room = {}) {
  return {
    id: String(room.id || 'ROOM01'),
    name: String(room.name || room.id || 'Room'),
    primaryViewId: room.primaryViewId || null,
    createdAt: Number(room.createdAt || Date.now()),
    updatedAt: Number(room.updatedAt || Date.now()),
    userConfirmed: room.userConfirmed === true,
    topology: room.topology || { portals: [] },
    metadata: room.metadata || {}
  };
}

export function normalizeEnvironmentView(view = {}) {
  return {
    id: String(view.id),
    roomId: String(view.roomId),
    name: String(view.name || view.id || 'Environment View'),
    primary: view.primary === true,
    cameraId: view.cameraId || null,
    capturedAt: Number(view.capturedAt || Date.now()),
    updatedAt: Number(view.updatedAt || Date.now()),
    imageDataUrl: view.imageDataUrl || null,
    fingerprint: view.fingerprint || null,
    quality: view.quality || null,
    floor: view.floor || null,
    landmarks: (view.landmarks || []).map(normalizeLandmark),
    zones: view.zones || [],
    portals: view.portals || [],
    calibration: view.calibration || null,
    privacy: view.privacy || {},
    version: Number(view.version || 1)
  };
}

export async function listEnvironmentRooms() {
  return action([ROOMS, VIEWS], 'readonly', async (tx) => {
    const rooms = await requestToPromise(tx.objectStore(ROOMS).getAll());
    const views = await requestToPromise(tx.objectStore(VIEWS).getAll());
    const byRoom = new Map();
    for (const view of views) {
      if (!byRoom.has(view.roomId)) byRoom.set(view.roomId, []);
      byRoom.get(view.roomId).push(normalizeEnvironmentView(view));
    }
    return rooms.map((room) => ({
      ...normalizeRoom(room),
      views: (byRoom.get(room.id) || []).sort((a,b)=>a.capturedAt-b.capturedAt)
    }));
  });
}

export async function saveEnvironmentRoom(room) {
  const record = normalizeRoom({ ...room, updatedAt: Date.now() });
  await action(ROOMS, 'readwrite', async (tx) => {
    tx.objectStore(ROOMS).put(record);
  });
  return record;
}

export async function saveEnvironmentView(view, options = {}) {
  const record = normalizeEnvironmentView({ ...view, updatedAt: Date.now() });

  await action([ROOMS, VIEWS], 'readwrite', async (tx) => {
    const roomStore = tx.objectStore(ROOMS);
    const viewStore = tx.objectStore(VIEWS);
    const existingRoom = await requestToPromise(roomStore.get(record.roomId));
    const room = normalizeRoom(existingRoom || {
      id: record.roomId,
      name: options.roomName || record.roomId,
      createdAt: Date.now()
    });

    if (record.primary || !room.primaryViewId) {
      room.primaryViewId = record.id;
      room.updatedAt = Date.now();

      const existingViews = await requestToPromise(viewStore.index('roomId').getAll(record.roomId));
      for (const existing of existingViews) {
        if (existing.id !== record.id && existing.primary) {
          viewStore.put({ ...existing, primary: false, updatedAt: Date.now() });
        }
      }
      record.primary = true;
    }

    roomStore.put(room);
    viewStore.put(record);
  });

  return record;
}

export async function deleteEnvironmentView(viewId) {
  await action([ROOMS, VIEWS], 'readwrite', async (tx) => {
    const viewStore = tx.objectStore(VIEWS);
    const roomStore = tx.objectStore(ROOMS);
    const view = await requestToPromise(viewStore.get(viewId));
    if (!view) return;

    viewStore.delete(viewId);
    const room = await requestToPromise(roomStore.get(view.roomId));
    if (room?.primaryViewId === viewId) {
      const remaining = (await requestToPromise(viewStore.index('roomId').getAll(view.roomId)))
        .filter((item) => item.id !== viewId)
        .sort((a,b)=>a.capturedAt-b.capturedAt);
      roomStore.put({
        ...room,
        primaryViewId: remaining[0]?.id || null,
        updatedAt: Date.now()
      });
      if (remaining[0]) {
        viewStore.put({ ...remaining[0], primary: true, updatedAt: Date.now() });
      }
    }
  });
  return true;
}

export async function saveEnvironmentHistory(entry) {
  const record = {
    id: entry.id || 'EH-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
    roomId: entry.roomId || null,
    viewId: entry.viewId || null,
    timestamp: Number(entry.timestamp || Date.now()),
    classification: entry.classification || null,
    score: Number(entry.score || 0),
    drift: entry.drift || null,
    changes: entry.changes || [],
    imageDataUrl: entry.retainImage === true ? (entry.imageDataUrl || null) : null,
    retainImage: entry.retainImage === true
  };

  await action(HISTORY, 'readwrite', async (tx) => {
    const store = tx.objectStore(HISTORY);
    store.put(record);
    const all = await requestToPromise(store.getAll());
    const excess = all
      .sort((a,b)=>a.timestamp-b.timestamp)
      .slice(0, Math.max(0, all.length - 250));
    for (const item of excess) store.delete(item.id);
  });
  return record;
}

export async function listEnvironmentHistory(roomId = null, limit = 50) {
  return action(HISTORY, 'readonly', async (tx) => {
    const store = tx.objectStore(HISTORY);
    const rows = roomId
      ? await requestToPromise(store.index('roomId').getAll(roomId))
      : await requestToPromise(store.getAll());
    return rows.sort((a,b)=>a.timestamp-b.timestamp).slice(-Math.max(1,limit));
  });
}

export function defaultEnvironmentPolicy(roomId) {
  return {
    roomId,
    retainPrimaryImages: true,
    retainAlternateViewImages: true,
    retainComparisonImages: false,
    retainChangeEvidenceImages: false,
    allowParticipantIdentity: true,
    allowTranscriptStorage: true,
    analyzeScreenContent: false,
    sensitiveRegions: [],
    updatedAt: Date.now()
  };
}

export async function loadEnvironmentPolicy(roomId) {
  return action(POLICIES, 'readonly', async (tx) => {
    const record = await requestToPromise(tx.objectStore(POLICIES).get(roomId));
    return record || defaultEnvironmentPolicy(roomId);
  });
}

export async function saveEnvironmentPolicy(policy) {
  const record = {
    ...defaultEnvironmentPolicy(policy.roomId),
    ...policy,
    updatedAt: Date.now()
  };
  await action(POLICIES, 'readwrite', async (tx) => {
    tx.objectStore(POLICIES).put(record);
  });
  return record;
}
