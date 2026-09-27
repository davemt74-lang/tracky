import { RELIABILITY_POLICY } from './reliability-policy.js';

const DB_NAME='tracky-model-lifecycle-v1';
const DB_VERSION=1;
const STATE='state';

function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Model lifecycle transaction aborted.'));});}
async function openDb(){
  if(!('indexedDB' in window))throw new Error('IndexedDB is not available in this browser.');
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STATE))r.result.createObjectStore(STATE,{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
function bounded(value={}){
  const copy={...value};
  copy.models=Array.isArray(copy.models)?copy.models.slice(-RELIABILITY_POLICY.modelLifecycle.maxModels):[];
  copy.environmentProfiles=Array.isArray(copy.environmentProfiles)?copy.environmentProfiles.slice(-RELIABILITY_POLICY.modelLifecycle.maxEnvironmentProfiles):[];
  copy.accuracySnapshots=Array.isArray(copy.accuracySnapshots)?copy.accuracySnapshots.slice(-RELIABILITY_POLICY.modelLifecycle.maxAccuracySnapshots):[];
  copy.scenarioEvaluations=Array.isArray(copy.scenarioEvaluations)?copy.scenarioEvaluations.slice(-RELIABILITY_POLICY.modelLifecycle.maxScenarioEvaluations):[];
  copy.decisions=Array.isArray(copy.decisions)?copy.decisions.slice(-RELIABILITY_POLICY.modelLifecycle.maxDecisions):[];
  return copy;
}
export async function loadModelLifecycleState(){
  const db=await openDb();try{
    const tx=db.transaction(STATE,'readonly'),wait=done(tx);
    const row=await req(tx.objectStore(STATE).get('model-lifecycle'));await wait;
    return row?.value||null;
  }finally{db.close();}
}
export async function saveModelLifecycleState(value){
  const db=await openDb();try{
    const tx=db.transaction(STATE,'readwrite'),wait=done(tx);const safe=bounded(value);
    tx.objectStore(STATE).put({id:'model-lifecycle',updatedAt:Date.now(),value:safe});
    await wait;return safe;
  }finally{db.close();}
}
export async function clearModelLifecycleState(){
  const db=await openDb();try{
    const tx=db.transaction(STATE,'readwrite'),wait=done(tx);
    tx.objectStore(STATE).delete('model-lifecycle');await wait;return true;
  }finally{db.close();}
}
