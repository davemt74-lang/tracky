const DB_NAME='tracky-world-watch-v1';
const DB_VERSION=1;
const WATCHES='watches';
const HISTORY='history';
const MAX_WATCHES=100;
const MAX_HISTORY=250;

function req(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('World watch transaction aborted.'));});}
async function openDb(){
  if(!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(WATCHES)) db.createObjectStore(WATCHES,{keyPath:'id'});
      if(!db.objectStoreNames.contains(HISTORY)){
        const store=db.createObjectStore(HISTORY,{keyPath:'id'});
        store.createIndex('generatedAt','generatedAt',{unique:false});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function trim(store,max){
  const rows=await req(store.getAll());
  const excess=rows.sort((a,b)=>Number(a.generatedAt||a.createdAt||0)-Number(b.generatedAt||b.createdAt||0)).slice(0,Math.max(0,rows.length-max));
  for(const row of excess) store.delete(row.id);
}
export async function saveWorldWatch(watch){
  const db=await openDb();
  try{
    const tx=db.transaction(WATCHES,'readwrite'),done=txDone(tx),store=tx.objectStore(WATCHES);
    store.put(watch); await trim(store,MAX_WATCHES); await done; return watch;
  }finally{db.close();}
}
export async function listWorldWatches(){
  const db=await openDb();
  try{const tx=db.transaction(WATCHES,'readonly'),done=txDone(tx);const rows=await req(tx.objectStore(WATCHES).getAll());await done;return rows.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));}
  finally{db.close();}
}
export async function deleteWorldWatch(id){
  const db=await openDb();
  try{const tx=db.transaction(WATCHES,'readwrite'),done=txDone(tx);tx.objectStore(WATCHES).delete(id);await done;return true;}
  finally{db.close();}
}
export async function saveWorldWatchTrigger(event){
  const db=await openDb();
  try{const tx=db.transaction(HISTORY,'readwrite'),done=txDone(tx),store=tx.objectStore(HISTORY);store.put(event);await trim(store,MAX_HISTORY);await done;return event;}
  finally{db.close();}
}
export async function listWorldWatchHistory(limit=50){
  const db=await openDb();
  try{const tx=db.transaction(HISTORY,'readonly'),done=txDone(tx);const rows=await req(tx.objectStore(HISTORY).getAll());await done;return rows.sort((a,b)=>Number(b.generatedAt||0)-Number(a.generatedAt||0)).slice(0,Math.max(1,Math.min(MAX_HISTORY,Number(limit||50))));}
  finally{db.close();}
}
export async function clearWorldWatchHistory(){
  const db=await openDb();
  try{const tx=db.transaction(HISTORY,'readwrite'),done=txDone(tx);tx.objectStore(HISTORY).clear();await done;return true;}
  finally{db.close();}
}
