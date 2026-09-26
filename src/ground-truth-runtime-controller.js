import {
  buildGroundTruth,
  createGroundTruthState,
  groundTruthSnapshot,
  recoverGroundTruthSnapshot
} from './ground-truth-core.js';
import {
  buildOperationalHealth,
  operationalHealthSnapshot
} from './operational-health-core.js';
import {
  consumeReconciliation,
  createReconciliationState,
  markReconciliationDirty,
  persistenceNeeded,
  reconciliationDue
} from './runtime-reconciliation-core.js';
import {
  groundTruthPersistenceSignature,
  groundTruthSemanticSignature,
  reportedMovedCameraIds
} from './ground-truth-runtime-core.js';

export function initializeGroundTruthRuntimeState(input={},now=Date.now()){
  const groundTruth=input.saved
    ?recoverGroundTruthSnapshot(input.saved,now)
    :createGroundTruthState(now);
  const operationalHealth=buildOperationalHealth({
    ...(input.healthInput||{}),
    activeRoomId:groundTruth.activeRoomId||null,
    groundTruth
  },now);
  const reconciliation=createReconciliationState(now);
  const corrections=Array.isArray(input.corrections)?input.corrections:[];
  const persistenceSignature=groundTruthPersistenceSignature(
    groundTruth,
    operationalHealth,
    corrections,
    input.roomPolicies||{}
  );
  reconciliation.lastPersistedSignature=persistenceSignature;
  return {
    groundTruth,
    operationalHealth,
    corrections,
    reconciliation,
    semanticSignature:null,
    inputSignature:input.inputSignature||null
  };
}

export function reconcileGroundTruthRuntimeState(state={},input={},now=Date.now(),reason='world-update'){
  const reconciliation=state.reconciliation||createReconciliationState(now);
  const inputSignature=input.inputSignature||null;
  if(reason!=='ground-truth-timer'&&inputSignature!==state.inputSignature){
    state.inputSignature=inputSignature;
    markReconciliationDirty(reconciliation,reason);
  }
  if(!reconciliationDue(reconciliation,now)){
    return {
      state:{...state,reconciliation},
      changed:false,
      reconciled:false,
      groundTruth:groundTruthSnapshot(state.groundTruth),
      operationalHealth:operationalHealthSnapshot(state.operationalHealth)
    };
  }

  const groundTruth=buildGroundTruth(
    input.groundTruthInput||{},
    state.groundTruth,
    now
  );
  const operationalHealth=buildOperationalHealth({
    ...(input.healthInput||{}),
    activeRoomId:groundTruth.activeRoomId||null,
    environment:{
      ...(input.healthInput?.environment||{}),
      reportedMovedCameraIds:reportedMovedCameraIds(state.corrections||[])
    },
    groundTruth
  },now);

  groundTruth.health={
    status:operationalHealth.status,
    staleEntityCount:operationalHealth.staleEntityCount,
    conflictedEntityCount:operationalHealth.conflictedEntityCount,
    continuityIssueCount:operationalHealth.continuityIssueCount,
    issueCount:(operationalHealth.issues||[]).length
  };

  const semanticSignature=groundTruthSemanticSignature(groundTruth,operationalHealth);
  const changed=semanticSignature!==state.semanticSignature;
  consumeReconciliation(reconciliation,groundTruth.entities||[],now);

  return {
    state:{
      ...state,
      groundTruth,
      operationalHealth,
      reconciliation,
      semanticSignature
    },
    changed,
    reconciled:true,
    groundTruth:groundTruthSnapshot(groundTruth),
    operationalHealth:operationalHealthSnapshot(operationalHealth)
  };
}

export function replaceRuntimeCorrections(state={},corrections=[]){
  return {...state,corrections:Array.isArray(corrections)?corrections:[]};
}

export function resetGroundTruthRuntimeState(now=Date.now()){
  return {
    groundTruth:createGroundTruthState(now),
    operationalHealth:buildOperationalHealth({},now),
    corrections:[],
    reconciliation:createReconciliationState(now),
    semanticSignature:null,
    inputSignature:null
  };
}

export function groundTruthPersistencePlan(state={},roomPolicies={},force=false){
  const signature=groundTruthPersistenceSignature(
    state.groundTruth,
    state.operationalHealth,
    state.corrections||[],
    roomPolicies
  );
  return {
    needed:persistenceNeeded(state.reconciliation||createReconciliationState(),signature,force),
    signature
  };
}

export function groundTruthRuntimeSnapshot(state={}){
  return {
    groundTruth:groundTruthSnapshot(state.groundTruth),
    operationalHealth:operationalHealthSnapshot(state.operationalHealth),
    corrections:JSON.parse(JSON.stringify(state.corrections||[])),
    reconciliation:JSON.parse(JSON.stringify(state.reconciliation||{})),
    semanticSignature:state.semanticSignature||null,
    inputSignature:state.inputSignature||null
  };
}
