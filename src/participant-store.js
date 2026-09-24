import { participantRecord, cryptoRandomId } from './participant-core.js';

const DB_NAME = 'tracky-participants-v1';
const DB_VERSION = 2;
const PARTICIPANTS = 'participants';
const PENDING = 'pending-captures';
const DIALOGUE = 'dialogue-turns';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openParticipantDb() {
  if (!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PARTICIPANTS)) {
        const participants = db.createObjectStore(PARTICIPANTS, { keyPath: 'id' });
        participants.createIndex('name', 'name', { unique: false });
        participants.createIndex('lastSeenAt', 'lastSeenAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(PENDING)) {
        db.createObjectStore(PENDING, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(DIALOGUE)) {
        const dialogue = db.createObjectStore(DIALOGUE, { keyPath: 'id' });
        dialogue.createIndex('sessionId', 'sessionId', { unique: false });
        dialogue.createIndex('participantId', 'participantId', { unique: false });
        dialogue.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeAction(storeName, mode, action) {
  const db = await openParticipantDb();
  try {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = await action(store);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

export function listParticipants() {
  return storeAction(PARTICIPANTS, 'readonly', async (store) => {
    const rows = await requestToPromise(store.getAll());
    return rows.sort((a, b) => {
      const aSeen = a.lastSeenAt || a.updatedAt || '';
      const bSeen = b.lastSeenAt || b.updatedAt || '';
      return bSeen.localeCompare(aSeen) || String(a.name).localeCompare(String(b.name));
    });
  });
}

export function getParticipant(id) {
  return storeAction(PARTICIPANTS, 'readonly', (store) => requestToPromise(store.get(id)));
}

export function saveParticipant(input) {
  const record = participantRecord(input);
  return storeAction(PARTICIPANTS, 'readwrite', async (store) => {
    await requestToPromise(store.put(record));
    return record;
  });
}

export async function patchParticipant(id, patch) {
  const current = await getParticipant(id);
  if (!current) throw new Error('Participant not found.');
  return saveParticipant({ ...current, ...patch, id, createdAt: current.createdAt });
}

export function deleteParticipant(id) {
  return storeAction(PARTICIPANTS, 'readwrite', async (store) => {
    await requestToPromise(store.delete(id));
    return true;
  });
}

export function savePendingCapture(input) {
  const record = {
    id: input.id || cryptoRandomId(),
    photo: input.photo || null,
    embedding: input.embedding ? Array.from(input.embedding) : null,
    trackId: input.trackId || null,
    createdAt: new Date().toISOString()
  };
  return storeAction(PENDING, 'readwrite', async (store) => {
    await requestToPromise(store.put(record));
    return record;
  });
}

export function getPendingCapture(id) {
  return storeAction(PENDING, 'readonly', (store) => requestToPromise(store.get(id)));
}

export function deletePendingCapture(id) {
  return storeAction(PENDING, 'readwrite', async (store) => {
    await requestToPromise(store.delete(id));
    return true;
  });
}


export function saveDialogueTurn(input) {
  const record = {
    ...input,
    id: input.id || cryptoRandomId(),
    sessionId: input.sessionId || 'room-session',
    createdAt: input.createdAt || new Date().toISOString()
  };

  return storeAction(DIALOGUE, 'readwrite', async (store) => {
    await requestToPromise(store.put(record));
    return record;
  });
}

export function listDialogueTurns(sessionId = null) {
  return storeAction(DIALOGUE, 'readonly', async (store) => {
    const rows = await requestToPromise(store.getAll());
    return rows
      .filter((row) => !sessionId || row.sessionId === sessionId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  });
}
