import { RELIABILITY_POLICY } from './reliability-policy.js';

const DB_NAME='tracky-forecast-calibration-v1';
const DB_VERSION=1;
const STATE='state';

function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Forecast calibration transaction aborted.'));});}
async function openDb(){
  if(!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STATE))r.result.createObjectStore(STATE,{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
function bounded(value={}){
  const copy={...value};
  copy.predictions=Array.isArray(copy.predictions)?copy.predictions.slice(-RELIABILITY_POLICY.calibration.maxPredictions):[];
  copy.settlements=Array.isArray(copy.settlements)?copy.settlements.slice(-RELIABILITY_POLICY.calibration.maxSettlements):[];
  return copy;
}
export async function loadForecastCalibrationState(){
  const db=await openDb();try{const tx=db.transaction(STATE,'readonly'),wait=done(tx);const row=await req(tx.objectStore(STATE).get('forecast-calibration'));await wait;return row?.value||null;}finally{db.close();}
}
export async function saveForecastCalibrationState(value){
  const db=await openDb();try{const tx=db.transaction(STATE,'readwrite'),wait=done(tx);const safe=bounded(value);tx.objectStore(STATE).put({id:'forecast-calibration',updatedAt:Date.now(),value:safe});await wait;return safe;}finally{db.close();}
}
export async function clearForecastCalibrationState(){
  const db=await openDb();try{const tx=db.transaction(STATE,'readwrite'),wait=done(tx);tx.objectStore(STATE).delete('forecast-calibration');await wait;return true;}finally{db.close();}
}
