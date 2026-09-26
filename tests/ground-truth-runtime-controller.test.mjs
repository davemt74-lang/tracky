import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groundTruthPersistencePlan,
  initializeGroundTruthRuntimeState,
  reconcileGroundTruthRuntimeState,
  replaceRuntimeCorrections,
  resetGroundTruthRuntimeState
} from '../src/ground-truth-runtime-controller.js';
import { notePersisted } from '../src/runtime-reconciliation-core.js';

const policy={OFFICE:{roomId:'OFFICE',allowVisualObservation:true,allowParticipantIdentity:true,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,sensitiveRegions:[]}};
const input=(at=1000,roomId='OFFICE')=>({
  inputSignature:'sig-'+roomId,
  groundTruthInput:{
    activeRoomId:roomId,
    multiRoom:{participants:{},objects:{O1:{id:'O1',objectId:'O1',label:'keys',roomId,lastKnownRoomId:roomId,presence:'confirmed',confidence:.9,lastObservedAt:at}}},
    sceneGraph:{roomId,nodes:[],edges:[]},
    corrections:[]
  },
  healthInput:{rooms:[{id:'OFFICE'},{id:'KITCHEN'}],cameras:[],cameraStatuses:{},roomPolicies:policy,environment:null}
});

test('controller initializes recovered or fresh runtime state with persistence signature',()=>{
  const state=initializeGroundTruthRuntimeState({saved:null,corrections:[],healthInput:input().healthInput,roomPolicies:policy,inputSignature:'initial'},1000);
  assert.equal(state.groundTruth.recoveryMode,false);
  assert.equal(state.inputSignature,'initial');
  assert.ok(state.reconciliation.lastPersistedSignature);
});

test('controller skips unchanged semantic input until freshness boundary',()=>{
  let state=initializeGroundTruthRuntimeState({saved:null,corrections:[],healthInput:input().healthInput,roomPolicies:policy,inputSignature:'sig-OFFICE'},1000);
  // first state remains dirty from startup, so reconcile once
  let result=reconcileGroundTruthRuntimeState(state,input(1000),1000,'startup');
  state=result.state;
  assert.equal(result.reconciled,true);
  result=reconcileGroundTruthRuntimeState(state,input(2000),2000,'physical-world-update');
  assert.equal(result.reconciled,false);
});

test('controller reconciles changed semantic input and updates canonical location',()=>{
  let state=initializeGroundTruthRuntimeState({saved:null,corrections:[],healthInput:input().healthInput,roomPolicies:policy,inputSignature:'sig-OFFICE'},1000);
  state=reconcileGroundTruthRuntimeState(state,input(1000),1000,'startup').state;
  const changed=input(2000,'KITCHEN');
  const result=reconcileGroundTruthRuntimeState(state,changed,2000,'physical-world-update');
  assert.equal(result.reconciled,true);
  assert.equal(result.groundTruth.entities[0].roomId,'KITCHEN');
});

test('controller correction replacement is immutable at top level',()=>{
  const state=resetGroundTruthRuntimeState(1000);
  const next=replaceRuntimeCorrections(state,[{id:'C1',status:'active'}]);
  assert.notEqual(next,state);
  assert.equal(next.corrections.length,1);
});

test('persistence plan skips previously persisted semantic state and supports force',()=>{
  let state=initializeGroundTruthRuntimeState({saved:null,corrections:[],healthInput:input().healthInput,roomPolicies:policy,inputSignature:'x'},1000);
  const first=groundTruthPersistencePlan(state,policy,false);
  assert.equal(first.needed,false);
  notePersisted(state.reconciliation,first.signature);
  assert.equal(groundTruthPersistencePlan(state,policy,false).needed,false);
  assert.equal(groundTruthPersistencePlan(state,policy,true).needed,true);
});
