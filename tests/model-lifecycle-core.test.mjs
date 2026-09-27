import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModelLifecycleState,
  registerModelCandidate,
  recordAccuracySnapshot,
  registerEnvironmentProfile,
  selectEnvironmentProfile,
  recordGoldenScenarioEvaluation,
  evaluatePromotion,
  promoteModel,
  canaryAssignment,
  evaluateDrift,
  enforceActiveHealth,
  importCalibrationReport,
  modelLifecycleReport
} from '../src/model-lifecycle-core.js';

function goodMetrics(channel='shadow',settledCount=24){
  return {
    channel,settledCount,empiricalAccuracy:.88,brierScore:.14,
    expectedCalibrationError:.06,failureRate:.01,p95LatencyMs:320
  };
}
function addScenarios(state,modelKey,modelVersion,{failKey=null,critical=false}={}){
  let next=state;
  for(let i=0;i<6;i++){
    const key='golden-'+i;
    next=recordGoldenScenarioEvaluation(next,{
      id:'scenario-'+modelVersion+'-'+i,
      modelKey,modelVersion,scenarioKey:key,
      passed:key!==failKey,critical:key===failKey&&critical,
      metrics:{precision:.9}
    },100+i).state;
  }
  return next;
}
function promoteToActive(state,modelKey,modelVersion,start=1000){
  state=recordAccuracySnapshot(state,{
    id:'shadow-'+modelVersion,modelKey,modelVersion,...goodMetrics('shadow')
  },start).state;
  state=addScenarios(state,modelKey,modelVersion);
  state=promoteModel(state,{modelKey,modelVersion,canaryPercent:10},start+10).state;
  state=recordAccuracySnapshot(state,{
    id:'canary-'+modelVersion,modelKey,modelVersion,...goodMetrics('canary')
  },start+20).state;
  state=promoteModel(state,{modelKey,modelVersion},start+30).state;
  return state;
}

test('new models always enter shadow mode and cannot skip rollout stages',()=>{
  let state=createModelLifecycleState(0);
  const created=registerModelCandidate(state,{modelKey:'detector',modelVersion:'2'},10);
  state=created.state;
  assert.equal(created.model.channel,'shadow');
  assert.throws(()=>registerModelCandidate(state,{
    modelKey:'detector',modelVersion:'3',channel:'active'
  },20),/must begin in shadow mode/);
  const gate=evaluatePromotion(state,{modelKey:'detector',modelVersion:'2'});
  assert.equal(gate.eligible,false);
  assert.ok(gate.reasons.includes('insufficient_verified_evidence'));
  assert.ok(gate.reasons.includes('golden_scenarios_not_green'));
});

test('promotion requires verified accuracy and a green golden scenario library',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'2'},10).state;
  state=recordAccuracySnapshot(state,{
    id:'shadow-v2',modelKey:'detector',modelVersion:'2',...goodMetrics('shadow')
  },20).state;
  let gate=evaluatePromotion(state,{modelKey:'detector',modelVersion:'2'});
  assert.equal(gate.eligible,false);
  assert.deepEqual(gate.reasons,['golden_scenarios_not_green']);

  state=addScenarios(state,'detector','2');
  gate=evaluatePromotion(state,{modelKey:'detector',modelVersion:'2'});
  assert.equal(gate.eligible,true);

  const promoted=promoteModel(state,{
    modelKey:'detector',modelVersion:'2',canaryPercent:15
  },30);
  assert.equal(promoted.model.channel,'canary');
  assert.equal(promoted.model.canaryPercent,15);
});

test('critical golden scenario regression blocks promotion',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'pose',modelVersion:'7'},10).state;
  state=recordAccuracySnapshot(state,{
    id:'pose-shadow',modelKey:'pose',modelVersion:'7',...goodMetrics('shadow')
  },20).state;
  state=addScenarios(state,'pose','7',{failKey:'golden-3',critical:true});
  const gate=evaluatePromotion(state,{modelKey:'pose',modelVersion:'7'});
  assert.equal(gate.eligible,false);
  assert.ok(gate.reasons.includes('golden_scenarios_not_green'));
  assert.equal(gate.scenarios.criticalFailures,1);
});

test('canary assignment is deterministic and bounded by rollout percentage',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'2'},10).state;
  state=recordAccuracySnapshot(state,{
    id:'shadow-v2',modelKey:'detector',modelVersion:'2',...goodMetrics('shadow')
  },20).state;
  state=addScenarios(state,'detector','2');
  state=promoteModel(state,{modelKey:'detector',modelVersion:'2',canaryPercent:10},30).state;
  const a=canaryAssignment(state,{modelKey:'detector',modelVersion:'2',assignmentKey:'camera-office'});
  const b=canaryAssignment(state,{modelKey:'detector',modelVersion:'2',assignmentKey:'camera-office'});
  assert.deepEqual(a,b);
  assert.equal(a.canaryPercent,10);
  assert.ok(a.bucket>=0&&a.bucket<100);
});

test('canary promotion retires the old active model as known-good lineage',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'1'},10).state;
  state=promoteToActive(state,'detector','1',1000);
  assert.equal(modelLifecycleReport(state).active[0].modelVersion,'1');

  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'2'},2000).state;
  state=promoteToActive(state,'detector','2',2100);

  const report=modelLifecycleReport(state);
  assert.equal(report.active.length,1);
  assert.equal(report.active[0].modelVersion,'2');
  assert.equal(report.active[0].previousActiveId,'detector@1');
  const prior=state.models.find((m)=>m.id==='detector@1');
  assert.equal(prior.channel,'retired');
  assert.equal(prior.knownGood,true);
});

test('active regression automatically rolls back to previous known-good model',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'1'},10).state;
  state=promoteToActive(state,'detector','1',1000);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'2'},2000).state;
  state=promoteToActive(state,'detector','2',2100);

  const result=enforceActiveHealth(state,{
    modelKey:'detector',modelVersion:'2',
    baseline:{empiricalAccuracy:.89,brierScore:.13,expectedCalibrationError:.05},
    current:{empiricalAccuracy:.70,brierScore:.30,expectedCalibrationError:.18,failureRate:.08,p95LatencyMs:1800}
  },3000);
  assert.equal(result.action,'rolled_back');
  assert.equal(result.active.modelVersion,'1');
  assert.equal(result.rolledBack.modelVersion,'2');
  assert.equal(result.decision.automatic,true);
  assert.ok(result.drift.reasons.includes('accuracy_regression'));
  assert.ok(result.drift.reasons.includes('failure_rate'));
});

test('drift detection does not rollback when metrics remain within policy',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'1'},10).state;
  state=promoteToActive(state,'detector','1',1000);
  const drift=evaluateDrift(state,{
    modelKey:'detector',modelVersion:'1',
    baseline:{empiricalAccuracy:.88,brierScore:.14,expectedCalibrationError:.06},
    current:{empiricalAccuracy:.85,brierScore:.16,expectedCalibrationError:.08,failureRate:.01,p95LatencyMs:400}
  });
  assert.equal(drift.drifting,false);
  assert.deepEqual(drift.reasons,[]);
});

test('environment calibration profiles distinguish camera angle lighting and time variants',()=>{
  let state=createModelLifecycleState(0);
  state=registerEnvironmentProfile(state,{
    profileKey:'office-day-front',
    roomId:'office',cameraId:'cam-1',angleKey:'front',
    lightingBucket:'day-bright',timeBucket:'day',seasonBucket:'any',
    modelKey:'detector',modelVersion:'2',calibrationKey:'cal-office-day'
  },100).state;
  state=registerEnvironmentProfile(state,{
    profileKey:'office-night-front',
    roomId:'office',cameraId:'cam-1',angleKey:'front',
    lightingBucket:'night-low',timeBucket:'night',seasonBucket:'any',
    modelKey:'detector',modelVersion:'2',calibrationKey:'cal-office-night'
  },110).state;

  const selected=selectEnvironmentProfile(state,{
    roomId:'office',cameraId:'cam-1',angleKey:'front',
    lightingBucket:'night-low',timeBucket:'night'
  });
  assert.equal(selected.profile.profileKey,'office-night-front');
  assert.ok(selected.score>0);
});

test('raw perception payloads are rejected from model and environment lifecycle state',()=>{
  let state=createModelLifecycleState(0);
  assert.throws(()=>registerModelCandidate(state,{
    modelKey:'detector',modelVersion:'2',metadata:{frameData:'private'}
  },10),/cannot retain raw perception payloads/);
  assert.throws(()=>registerEnvironmentProfile(state,{
    profileKey:'office',modelKey:'detector',modelVersion:'2',
    metadata:{embedding:[1,2,3]}
  },20),/cannot retain raw perception payloads/);
});

test('V2.76 calibration report imports channel-specific accuracy without changing lifecycle authority',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'2'},10).state;
  const imported=importCalibrationReport(state,{
    generatedAt:500,
    profiles:[
      {modelKey:'detector',modelVersion:'2',kind:'entity-location',channel:'shadow',settledCount:22,empiricalAccuracy:.86,brierScore:.16,expectedCalibrationError:.07},
      {modelKey:'detector',modelVersion:'2',kind:'entity-location',channel:'active',settledCount:200,empiricalAccuracy:.99,brierScore:.01,expectedCalibrationError:.01}
    ]
  },500);
  state=imported.state;
  assert.equal(imported.imported.length,2);
  state=addScenarios(state,'detector','2');
  const gate=evaluatePromotion(state,{modelKey:'detector',modelVersion:'2'});
  assert.equal(gate.eligible,true);
  assert.equal(gate.metrics.empiricalAccuracy,.86);
});

test('lifecycle report exposes lineage and decisions but no raw perception',()=>{
  let state=createModelLifecycleState(0);
  state=registerModelCandidate(state,{modelKey:'detector',modelVersion:'2',metadata:{family:'vision'}},10).state;
  const report=modelLifecycleReport(state);
  const json=JSON.stringify(report);
  assert.equal(report.protocol,'physical_model_lifecycle.v1');
  assert.match(json,/local-model-activation-authority/);
  assert.doesNotMatch(json,/imageDataUrl|frameData|embedding|rawFrame/);
});
