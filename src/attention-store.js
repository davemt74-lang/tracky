const DB_NAME='tracky-attention-v1';
const DB_VERSION=1;
const STORE='state';

function req(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Attention storage aborted.'));});}
async function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function loadAttentionState(){
  const db=await openDb();
  try{const tx=db.transaction(STORE,'readonly');const done=txDone(tx);const row=await req(tx.objectStore(STORE).get('attention'));await done;return row?.value||null;}finally{db.close();}
}
export async function saveAttentionState(state){
  const db=await openDb();
  try{const tx=db.transaction(STORE,'readwrite');const done=txDone(tx);tx.objectStore(STORE).put({id:'attention',updatedAt:Date.now(),value:state});await done;return state;}finally{db.close();}
}
