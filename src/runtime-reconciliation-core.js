import { RELIABILITY_POLICY } from './reliability-policy.js';

export const RECONCILIATION_REASON=Object.freeze({
  WORLD:'world',
  PRIVACY:'privacy',
  CAMERA:'camera',
  ENVIRONMENT:'environment',
  CORRECTION:'correction',
  TIMER:'freshness-timer',
  STARTUP:'startup'
});

export function createReconciliationState(now=Date.now()){
  return {
    schemaVersion:1,
    dirty:true,
    reasons:['startup'],
    lastReconciledAt:0,
    nextFreshnessAt:now,
    lastPersistedSignature:null,
    persistencePending:false
  };
}
export function markReconciliationDirty(state,reason='world'){
  state.dirty=true;
  if(!state.reasons.includes(reason)) state.reasons.push(reason);
  return state;
}
export function nextFreshnessBoundary(entities=[],now=Date.now()){
  let next=Infinity;
  for(const entity of entities||[]){
    const observedAt=Number(entity.observedAt||0);
    const halfLife=Number(entity.halfLifeMs||0);
    if(!observedAt||!halfLife) continue;
    for(const age of [Math.min(15000,halfLife*.15),halfLife,halfLife*4]){
      const at=observedAt+age+1;
      if(at>now&&at<next) next=at;
    }
  }
  return Number.isFinite(next)?next:now+RELIABILITY_POLICY.groundTruth.fallbackTickMs;
}
export function reconciliationDue(state,now=Date.now()){
  return state.dirty===true||now>=Number(state.nextFreshnessAt||0);
}
export function consumeReconciliation(state,entities=[],now=Date.now()){
  const reasons=[...state.reasons];
  state.dirty=false;
  state.reasons=[];
  state.lastReconciledAt=now;
  state.nextFreshnessAt=nextFreshnessBoundary(entities,now);
  return {reasons,nextFreshnessAt:state.nextFreshnessAt};
}
export function persistenceNeeded(state,signature,force=false){
  if(force) return true;
  return signature!==state.lastPersistedSignature;
}
export function notePersisted(state,signature){
  state.lastPersistedSignature=signature;
  state.persistencePending=false;
  return state;
}
