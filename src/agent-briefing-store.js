const DB_NAME='tracky-agent-briefing-v1';
const DB_VERSION=1;
const STORE='briefings';
const MAX_RECORDS=200;
function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Agent briefing transaction aborted.'));});}
async function openDb(){
 if(!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:'id'});s.createIndex('generatedAt','generatedAt',{unique:false});}};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
async function trim(store){
 const rows=await req(store.getAll());
 const drop=rows.sort((a,b)=>Number(a.generatedAt||0)-Number(b.generatedAt||0)).slice(0,Math.max(0,rows.length-MAX_RECORDS));
 for(const row of drop) store.delete(row.id);
}
export async function saveAgentBriefing(briefing){
 const db=await openDb();try{const tx=db.transaction(STORE,'readwrite'),wait=done(tx),s=tx.objectStore(STORE);s.put(briefing);await trim(s);await wait;return briefing;}finally{db.close();}
}
export async function listAgentBriefings(limit=50){
 const db=await openDb();try{const tx=db.transaction(STORE,'readonly'),wait=done(tx);const rows=await req(tx.objectStore(STORE).getAll());await wait;return rows.sort((a,b)=>Number(b.generatedAt||0)-Number(a.generatedAt||0)).slice(0,Math.max(1,Math.min(MAX_RECORDS,Number(limit||50))));}finally{db.close();}
}
export async function clearAgentBriefings(){
 const db=await openDb();try{const tx=db.transaction(STORE,'readwrite'),wait=done(tx);tx.objectStore(STORE).clear();await wait;return true;}finally{db.close();}
}
