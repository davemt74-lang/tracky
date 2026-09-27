const DB_NAME='tracky-site-topology-v1';
const DB_VERSION=1;
const STATE='state';
const MAX_SITES=128,MAX_DEVICES=512,MAX_RELATIONSHIPS=1024,MAX_AUTHORITY=256,MAX_AUDIT=250;
function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Site topology transaction aborted.'));});}
async function openDb(){
  if(!('indexedDB' in window))throw new Error('IndexedDB is not available in this browser.');
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STATE))r.result.createObjectStore(STATE,{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
function bounded(value={}){
  const out={...value};
  out.sites=Array.isArray(out.sites)?out.sites.slice(-MAX_SITES):[];
  out.devices=Array.isArray(out.devices)?out.devices.slice(-MAX_DEVICES):[];
  out.relationships=Array.isArray(out.relationships)?out.relationships.slice(-MAX_RELATIONSHIPS):[];
  out.authority=Array.isArray(out.authority)?out.authority.slice(-MAX_AUTHORITY):[];
  out.audit=Array.isArray(out.audit)?out.audit.slice(-MAX_AUDIT):[];
  return out;
}
export async function loadSiteTopologyState(){
  const db=await openDb();try{
    const tx=db.transaction(STATE,'readonly'),wait=done(tx);
    const row=await req(tx.objectStore(STATE).get('site-topology'));await wait;
    return row?.value||null;
  }finally{db.close();}
}
export async function saveSiteTopologyState(value){
  const db=await openDb();try{
    const tx=db.transaction(STATE,'readwrite'),wait=done(tx),safe=bounded(value);
    tx.objectStore(STATE).put({id:'site-topology',updatedAt:Date.now(),value:safe});
    await wait;return safe;
  }finally{db.close();}
}
export async function clearSiteTopologyState(){
  const db=await openDb();try{
    const tx=db.transaction(STATE,'readwrite'),wait=done(tx);
    tx.objectStore(STATE).delete('site-topology');await wait;return true;
  }finally{db.close();}
}
