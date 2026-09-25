const DB_NAME='tracky-anomaly-v1';
const DB_VERSION=1;
const STORE='state';

function req(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Anomaly storage aborted.'));});}

async function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

export async function loadAnomalyState(){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,'readonly');
    const complete=done(tx);
    const row=await req(tx.objectStore(STORE).get('anomaly-state'));
    await complete;
    return row?.value||null;
  }finally{db.close();}
}

export async function saveAnomalyState(state){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,'readwrite');
    const complete=done(tx);
    tx.objectStore(STORE).put({id:'anomaly-state',updatedAt:Date.now(),value:state});
    await complete;
    return state;
  }finally{db.close();}
}
