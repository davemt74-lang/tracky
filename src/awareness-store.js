const DB_NAME = 'tracky-awareness-v1';
const DB_VERSION = 1;
const RECORDS = 'records';

function requestToPromise(request) {
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

function txPromise(tx) {
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error('Awareness transaction aborted.'));
  });
}

async function openDb() {
  if (!('indexedDB' in window)) throw new Error('IndexedDB unavailable.');
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(RECORDS)){
        db.createObjectStore(RECORDS,{keyPath:'id'});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function action(mode, handler) {
  const db=await openDb();
  try{
    const tx=db.transaction(RECORDS,mode);
    const done=txPromise(tx);
    const result=await handler(tx.objectStore(RECORDS));
    await done;
    return result;
  } finally {
    db.close();
  }
}

export async function loadAwarenessState() {
  const record=await action('readonly',(store)=>requestToPromise(store.get('state')));
  return record?.value || null;
}

export async function saveAwarenessState(state) {
  await action('readwrite',async(store)=>{
    store.put({id:'state',value:state,updatedAt:Date.now()});
  });
  return state;
}

export async function loadAwarenessPolicy() {
  const record=await action('readonly',(store)=>requestToPromise(store.get('policy')));
  return record?.value || null;
}

export async function saveAwarenessPolicy(policy) {
  await action('readwrite',async(store)=>{
    store.put({id:'policy',value:policy,updatedAt:Date.now()});
  });
  return policy;
}

export async function clearAwarenessHistory() {
  await action('readwrite',async(store)=>{
    store.delete('state');
  });
  return true;
}
