import { RELIABILITY_POLICY } from './reliability-policy.js';
const DB_NAME='tracky-ground-truth-v1';
const DB_VERSION=1;
const STATE='state';
const CORRECTIONS='corrections';

function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Ground truth transaction aborted.'));});}
async function openDb(){
  if(!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      if(!r.result.objectStoreNames.contains(STATE))r.result.createObjectStore(STATE,{keyPath:'id'});
      if(!r.result.objectStoreNames.contains(CORRECTIONS))r.result.createObjectStore(CORRECTIONS,{keyPath:'id'});
    };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function loadGroundTruthState(){
  const db=await openDb();try{const tx=db.transaction(STATE,'readonly'),wait=done(tx);const row=await req(tx.objectStore(STATE).get('ground-truth'));await wait;return row?.value||null;}finally{db.close();}
}
export async function saveGroundTruthState(value){
  const db=await openDb();try{const tx=db.transaction(STATE,'readwrite'),wait=done(tx);tx.objectStore(STATE).put({id:'ground-truth',updatedAt:Date.now(),value});await wait;return value;}finally{db.close();}
}
export async function listGroundTruthCorrections(){
  const db=await openDb();try{const tx=db.transaction(CORRECTIONS,'readonly'),wait=done(tx);const rows=await req(tx.objectStore(CORRECTIONS).getAll());await wait;return rows.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0)).slice(-RELIABILITY_POLICY.corrections.maxRecords);}finally{db.close();}
}
export async function replaceGroundTruthCorrections(items=[]){
  const db=await openDb();try{const tx=db.transaction(CORRECTIONS,'readwrite'),wait=done(tx),store=tx.objectStore(CORRECTIONS);store.clear();for(const item of items.slice(-RELIABILITY_POLICY.corrections.maxRecords))store.put(item);await wait;return items.slice(-RELIABILITY_POLICY.corrections.maxRecords);}finally{db.close();}
}
export async function clearGroundTruthStore(){
  const db=await openDb();try{const tx=db.transaction([STATE,CORRECTIONS],'readwrite'),wait=done(tx);tx.objectStore(STATE).clear();tx.objectStore(CORRECTIONS).clear();await wait;return true;}finally{db.close();}
}
