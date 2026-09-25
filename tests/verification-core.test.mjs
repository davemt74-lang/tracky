import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addVerificationEvidence,
  cancelVerification,
  createVerificationPlan,
  createVerificationState,
  evaluateVerification,
  evidenceFromContext,
  privacyAllowsVerificationChannel,
  startVerification,
  verificationQuorum,
  verificationSnapshot
} from '../src/verification-core.js';

const anomaly={
  id:'A1',
  signature:'expected-object-missing::WO1::ROOM01::L1',
  type:'expected-object-missing',
  category:'object',
  roomId:'ROOM01',
  objectId:'WO1',
  subjectId:'WO1',
  confidence:.85,
  priority:.82,
  summary:'Phone missing'
};

test('privacy policy blocks object verification channels without enabling sensors',()=>{
  const plan=createVerificationPlan(anomaly,{
    allowVisualObservation:false,
    allowObjectObservation:false
  },1000);
  assert.equal(plan.blocked,true);
  assert.equal(plan.allowedChannels.length,0);
  assert.equal(privacyAllowsVerificationChannel('object-observation',{
    allowVisualObservation:false
  }),false);
});

test('verification starts blocked when all required channels are prohibited',()=>{
  const state=createVerificationState();
  const request=startVerification(state,anomaly,{
    allowVisualObservation:false,
    allowObjectObservation:false
  },1000);
  assert.equal(request.status,'blocked');
  assert.equal(state.stats.blocked,1);
  assert.equal(state.requests[anomaly.signature],undefined);
});

test('duplicate evidence id is counted only once',()=>{
  const state=createVerificationState();
  startVerification(state,anomaly,{},1000);
  const item={id:'E1',source:'camera:CAM01',channel:'same-room-cameras',outcome:'supporting',confidence:.9};
  addVerificationEvidence(state,anomaly.signature,item,1100);
  addVerificationEvidence(state,anomaly.signature,item,1200);
  assert.equal(state.requests[anomaly.signature].evidence.length,1);
});

test('independent supporting evidence reaches verified quorum',()=>{
  const state=createVerificationState();
  startVerification(state,anomaly,{},1000);
  addVerificationEvidence(state,anomaly.signature,{id:'E1',source:'object',channel:'object-observation',outcome:'supporting',confidence:.9},2000);
  addVerificationEvidence(state,anomaly.signature,{id:'E2',source:'visibility',channel:'room-visibility',outcome:'supporting',confidence:.85},3000);
  addVerificationEvidence(state,anomaly.signature,{id:'E3',source:'camera:CAM01',channel:'same-room-cameras',outcome:'supporting',confidence:.8},4000);
  const request=evaluateVerification(state,anomaly.signature,5000);
  assert.equal(request.result,'verified');
  assert.equal(state.stats.verified,1);
});

test('independent clearing evidence resolves as cleared',()=>{
  const state=createVerificationState();
  startVerification(state,anomaly,{},1000);
  addVerificationEvidence(state,anomaly.signature,{id:'E1',source:'object',channel:'object-observation',outcome:'clearing',confidence:.9},2000);
  addVerificationEvidence(state,anomaly.signature,{id:'E2',source:'visibility',channel:'room-visibility',outcome:'clearing',confidence:.85},3000);
  addVerificationEvidence(state,anomaly.signature,{id:'E3',source:'camera:CAM01',channel:'same-room-cameras',outcome:'clearing',confidence:.8},4000);
  const request=evaluateVerification(state,anomaly.signature,5000);
  assert.equal(request.result,'cleared');
});

test('conflicting quorums resolve uncertain rather than picking a side',()=>{
  const state=createVerificationState();
  startVerification(state,anomaly,{},1000);
  for(let i=0;i<3;i++){
    addVerificationEvidence(state,anomaly.signature,{id:'S'+i,source:'support'+i,channel:i===0?'object-observation':i===1?'room-visibility':'same-room-cameras',outcome:'supporting',confidence:.9},2000+i);
    addVerificationEvidence(state,anomaly.signature,{id:'C'+i,source:'clear'+i,channel:i===0?'object-observation':i===1?'room-visibility':'same-room-cameras',outcome:'clearing',confidence:.9},3000+i);
  }
  assert.equal(evaluateVerification(state,anomaly.signature,5000).result,'uncertain');
});

test('deadline without quorum resolves uncertain',()=>{
  const state=createVerificationState();
  const request=startVerification(state,anomaly,{},1000);
  const result=evaluateVerification(state,anomaly.signature,request.plan.deadlineAt+1);
  assert.equal(result.result,'uncertain');
});

test('environment verification plan can request a fresh look only when comparison is allowed',()=>{
  const env={...anomaly,signature:'env1',type:'environment-unrecognized',category:'environment'};
  const allowed=createVerificationPlan(env,{allowVisualObservation:true,allowEnvironmentComparison:true},1000);
  const blocked=createVerificationPlan(env,{allowVisualObservation:true,allowEnvironmentComparison:false},1000);
  assert.equal(allowed.refreshEnvironment,true);
  assert.equal(blocked.refreshEnvironment,false);
});

test('context evidence uses independent environment frame and baseline sources',()=>{
  const env={...anomaly,signature:'env1',type:'environment-unrecognized',category:'environment'};
  const state=createVerificationState();
  const request=startVerification(state,env,{allowVisualObservation:true,allowEnvironmentComparison:true},1000);
  const evidence=evidenceFromContext(request,{
    anomaly:env,
    environment:{classification:'unknown',best:{score:.2}},
    currentEnvironment:{capturedAt:5000,quality:{score:.9}}
  },5000);
  assert.equal(evidence.some((item)=>item.source==='environment-frame'),true);
  assert.equal(evidence.some((item)=>item.source==='baseline-match'),true);
  assert.equal(new Set(evidence.map((item)=>item.id)).size,evidence.length);
});

test('verification can be explicitly cancelled',()=>{
  const state=createVerificationState();
  startVerification(state,anomaly,{},1000);
  const cancelled=cancelVerification(state,anomaly.signature,2000);
  assert.equal(cancelled.status,'cancelled');
  assert.equal(state.stats.cancelled,1);
});

test('snapshot is serializable and bounded to semantic verification state',()=>{
  const state=createVerificationState();
  startVerification(state,anomaly,{},1000);
  const snapshot=verificationSnapshot(state);
  assert.equal(snapshot.requests.length,1);
  assert.doesNotThrow(()=>JSON.stringify(snapshot));
  assert.equal(snapshot.schemaVersion,1);
});
