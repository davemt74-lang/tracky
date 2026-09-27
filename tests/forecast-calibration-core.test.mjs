import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createForecastCalibrationState,
  recordForecastPrediction,
  settleForecastPrediction,
  calibratedForecastConfidence,
  forecastCalibrationProfile,
  forecastCalibrationReport
} from '../src/forecast-calibration-core.js';

function prediction(state,id,confidence=.8,overrides={}){
  return recordForecastPrediction(state,{
    id,
    kind:'entity-location',
    modelKey:'location-model',
    modelVersion:'1',
    contextKey:'office-day',
    channel:'active',
    rawConfidence:confidence,
    predictedAt:1000,
    horizonMs:60000,
    predictedValue:{roomId:'OFFICE'},
    subjectId:'O1',
    ...overrides
  },1000).state;
}
function settle(state,predictionId,id,correctness,authority='user-confirmed',overrides={}){
  return settleForecastPrediction(state,{
    id,
    predictionId,
    authority,
    correctness,
    outcomeValue:{roomId:correctness>=.5?'OFFICE':'KITCHEN'},
    evidenceIds:['truth:O1'],
    reason:'verified outcome',
    ...overrides
  },2000).state;
}
function seeded(count,{correct=1,confidence=.8,contextKey='office-day',channel='active'}={}){
  let state=createForecastCalibrationState(0);
  for(let i=0;i<count;i++){
    const id='p-'+String(i).padStart(3,'0');
    state=prediction(state,id,confidence,{contextKey,channel});
    state=settle(state,id,'s-'+String(i).padStart(3,'0'),typeof correct==='function'?correct(i):correct);
  }
  return state;
}

test('raw prediction is immutable and duplicate ids are idempotent',()=>{
  let state=createForecastCalibrationState(0);
  let result=recordForecastPrediction(state,{
    id:'p-immutable',kind:'presence',modelKey:'presence-model',modelVersion:'1',
    contextKey:'office',rawConfidence:.82,predictedValue:true
  },100);
  state=result.state;
  assert.equal(result.created,true);
  result=recordForecastPrediction(state,{
    id:'p-immutable',kind:'presence',modelKey:'presence-model',modelVersion:'2',
    contextKey:'kitchen',rawConfidence:.1,predictedValue:false
  },200);
  assert.equal(result.idempotent,true);
  assert.equal(result.prediction.modelVersion,'1');
  assert.equal(result.prediction.rawConfidence,.82);
  assert.equal(result.prediction.contextKey,'office');
});

test('settlement requires verified authority and cannot calibrate from semantic inference',()=>{
  let state=createForecastCalibrationState(0);
  state=prediction(state,'p-authority');
  assert.throws(()=>settleForecastPrediction(state,{
    id:'s-authority',predictionId:'p-authority',authority:'semantic-inference',correctness:1
  },2000),/verified outcome authority/);
});

test('insufficient evidence leaves future confidence unchanged',()=>{
  const state=seeded(8,{correct:0,confidence:.9});
  const calibrated=calibratedForecastConfidence(state,{
    modelKey:'location-model',modelVersion:'1',contextKey:'office-day',
    kind:'entity-location',channel:'active',rawConfidence:.9
  });
  assert.equal(calibrated.applied,false);
  assert.equal(calibrated.reason,'insufficient-settlements');
  assert.equal(calibrated.calibratedConfidence,.9);
});

test('authoritative outcomes calibrate future confidence only after minimum evidence',()=>{
  const state=seeded(24,{correct:(i)=>i<12?1:0,confidence:.9});
  const calibrated=calibratedForecastConfidence(state,{
    modelKey:'location-model',modelVersion:'1',contextKey:'office-day',
    kind:'entity-location',channel:'active',rawConfidence:.9
  });
  assert.equal(calibrated.applied,true);
  assert.equal(calibrated.scope,'context');
  assert.equal(calibrated.settledCount,24);
  assert.ok(calibrated.calibratedConfidence<.9);
  assert.ok(calibrated.calibratedConfidence>=.7);
  assert.ok(Math.abs(calibrated.adjustment)<=.2+Number.EPSILON);
});

test('maximum confidence adjustment is bounded even when calibration is poor',()=>{
  const state=seeded(30,{correct:0,confidence:.99});
  const calibrated=calibratedForecastConfidence(state,{
    modelKey:'location-model',modelVersion:'1',contextKey:'office-day',
    kind:'entity-location',channel:'active',rawConfidence:.99
  });
  assert.equal(calibrated.applied,true);
  assert.ok(calibrated.calibratedConfidence>=.79);
  assert.ok(calibrated.calibratedConfidence<=.99);
  assert.ok(Math.abs(calibrated.adjustment)<=.2+Number.EPSILON);
});

test('shadow and canary channels collect accuracy but never change active confidence',()=>{
  const shadow=seeded(30,{correct:0,confidence:.95,channel:'shadow'});
  const shadowResult=calibratedForecastConfidence(shadow,{
    modelKey:'location-model',modelVersion:'1',contextKey:'office-day',
    kind:'entity-location',channel:'shadow',rawConfidence:.95
  });
  assert.equal(shadowResult.applied,false);
  assert.equal(shadowResult.reason,'non-active-channel');

  const activeResult=calibratedForecastConfidence(shadow,{
    modelKey:'location-model',modelVersion:'1',contextKey:'office-day',
    kind:'entity-location',channel:'active',rawConfidence:.95
  });
  assert.equal(activeResult.applied,false);
  assert.equal(activeResult.calibratedConfidence,.95);
});

test('context calibration falls back to model evidence until context evidence is sufficient',()=>{
  let state=createForecastCalibrationState(0);
  for(let i=0;i<24;i++){
    const context=i<6?'office-night':'kitchen-day';
    const id='p-fallback-'+i;
    state=prediction(state,id,.8,{contextKey:context});
    state=settle(state,id,'s-fallback-'+i,i%2===0?1:0);
  }
  const calibrated=calibratedForecastConfidence(state,{
    modelKey:'location-model',modelVersion:'1',contextKey:'office-night',
    kind:'entity-location',channel:'active',rawConfidence:.8
  });
  assert.equal(calibrated.applied,true);
  assert.equal(calibrated.scope,'model');
  assert.equal(calibrated.settledCount,24);
});

test('settlement correction is append-only and supersedes the prior effective outcome',()=>{
  let state=createForecastCalibrationState(0);
  state=prediction(state,'p-revision',.8);
  state=settle(state,'p-revision','s-original',0);
  const revised=settleForecastPrediction(state,{
    id:'s-revised',
    predictionId:'p-revision',
    authority:'user-confirmed',
    correctness:1,
    outcomeValue:{roomId:'OFFICE'},
    supersedesSettlementId:'s-original',
    reason:'user corrected settlement'
  },3000);
  state=revised.state;
  assert.equal(state.settlements.length,2);
  const report=forecastCalibrationReport(state);
  assert.equal(report.settlements,1);
  assert.equal(report.profiles[0].empiricalAccuracy,1);
});

test('profile reports Brier score, calibration error and evidence buckets',()=>{
  const state=seeded(24,{correct:(i)=>i%3?1:0,confidence:.75});
  const profile=forecastCalibrationProfile(state,{
    modelKey:'location-model',modelVersion:'1',contextKey:'office-day',
    kind:'entity-location',channel:'active'
  });
  assert.equal(profile.context.settledCount,24);
  assert.ok(profile.context.brierScore>=0&&profile.context.brierScore<=1);
  assert.ok(profile.context.expectedCalibrationError>=0&&profile.context.expectedCalibrationError<=1);
  assert.ok(profile.context.buckets.length>=1);
  assert.equal(profile.eligibleToInfluenceActive,true);
});

test('raw perception payload keys are rejected at prediction and settlement boundaries',()=>{
  let state=createForecastCalibrationState(0);
  assert.throws(()=>recordForecastPrediction(state,{
    id:'p-raw',kind:'entity-location',modelKey:'location-model',modelVersion:'1',
    contextKey:'office',rawConfidence:.8,predictedValue:{roomId:'OFFICE',imageDataUrl:'private'}
  },1000),/cannot retain raw perception payloads/);
  state=prediction(state,'p-safe',.8);
  assert.throws(()=>settleForecastPrediction(state,{
    id:'s-raw',predictionId:'p-safe',authority:'user-confirmed',correctness:1,
    outcomeValue:{roomId:'OFFICE',embedding:[1,2,3]}
  },2000),/cannot retain raw perception payloads/);
});

test('forecast report never stores raw perception payload contracts',()=>{
  const state=seeded(20,{correct:1,confidence:.8});
  const report=forecastCalibrationReport(state);
  const json=JSON.stringify(report);
  assert.doesNotMatch(json,/imageDataUrl|embedding|video|audio|frameData/);
  assert.match(json,/raw-predictions-immutable/);
  assert.match(json,/verified-outcome-authority-required/);
});
