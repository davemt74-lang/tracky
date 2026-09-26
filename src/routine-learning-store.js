const DB_NAME='tracky-routine-learning-v1';
const DB_VERSION=1;
const STATE='state';

function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Routine learning transaction aborted.'));});}
async function openDb(){
  if(!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STATE))r.result.createObjectStore(STATE,{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function loadRoutineLearningState(){
  const db=await openDb();try{const tx=db.transaction(STATE,'readonly'),wait=done(tx);const row=await req(tx.objectStore(STATE).get('routine-learning'));await wait;return row?.value||null;}finally{db.close();}
}
export async function saveRoutineLearningState(value){
  const db=await openDb();try{const tx=db.transaction(STATE,'readwrite'),wait=done(tx);tx.objectStore(STATE).put({id:'routine-learning',updatedAt:Date.now(),value});await wait;return value;}finally{db.close();}
}
export async function clearRoutineLearningState(){
  const db=await openDb();try{const tx=db.transaction(STATE,'readwrite'),wait=done(tx);tx.objectStore(STATE).delete('routine-learning');await wait;return true;}finally{db.close();}
}
