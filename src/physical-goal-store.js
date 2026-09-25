const DB_NAME='tracky-physical-goals-v1';
const DB_VERSION=1;
const GOALS='goals';
const EVENTS='events';
const MAX_GOALS=100;
const MAX_EVENTS=250;

function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Physical goal transaction aborted.'));});}
async function openDb(){
  if(!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains(GOALS)){const s=db.createObjectStore(GOALS,{keyPath:'id'});s.createIndex('createdAt','createdAt',{unique:false});}
      if(!db.objectStoreNames.contains(EVENTS)){const s=db.createObjectStore(EVENTS,{keyPath:'id'});s.createIndex('generatedAt','generatedAt',{unique:false});}
    };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
async function trim(store,max,field){
  const rows=await req(store.getAll());
  const drop=rows.sort((a,b)=>Number(a[field]||0)-Number(b[field]||0)).slice(0,Math.max(0,rows.length-max));
  for(const row of drop) store.delete(row.id);
}
export async function savePhysicalGoal(goal){
  const db=await openDb();try{const tx=db.transaction(GOALS,'readwrite'),wait=done(tx),s=tx.objectStore(GOALS);s.put(goal);await trim(s,MAX_GOALS,'createdAt');await wait;return goal;}finally{db.close();}
}
export async function listPhysicalGoals(){
  const db=await openDb();try{const tx=db.transaction(GOALS,'readonly'),wait=done(tx);const rows=await req(tx.objectStore(GOALS).getAll());await wait;return rows.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));}finally{db.close();}
}
export async function deletePhysicalGoal(id){
  const db=await openDb();try{const tx=db.transaction(GOALS,'readwrite'),wait=done(tx);tx.objectStore(GOALS).delete(id);await wait;return true;}finally{db.close();}
}
export async function savePhysicalGoalEvent(event){
  const db=await openDb();try{const tx=db.transaction(EVENTS,'readwrite'),wait=done(tx),s=tx.objectStore(EVENTS);s.put(event);await trim(s,MAX_EVENTS,'generatedAt');await wait;return event;}finally{db.close();}
}
export async function listPhysicalGoalEvents(limit=50){
  const db=await openDb();try{const tx=db.transaction(EVENTS,'readonly'),wait=done(tx);const rows=await req(tx.objectStore(EVENTS).getAll());await wait;return rows.sort((a,b)=>Number(b.generatedAt||0)-Number(a.generatedAt||0)).slice(0,Math.max(1,Math.min(MAX_EVENTS,Number(limit||50))));}finally{db.close();}
}
export async function clearPhysicalGoalEvents(){
  const db=await openDb();try{const tx=db.transaction(EVENTS,'readwrite'),wait=done(tx);tx.objectStore(EVENTS).clear();await wait;return true;}finally{db.close();}
}
