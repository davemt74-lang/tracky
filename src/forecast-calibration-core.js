import { RELIABILITY_POLICY } from './reliability-policy.js';

const txt=(v,max=160)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const arr=(v)=>Array.isArray(v)?v:[];

export const FORECAST_CALIBRATION_SCHEMA_VERSION=1;
export const FORECAST_CHANNELS=Object.freeze(['active','shadow','canary']);
export const FORECAST_OUTCOME_AUTHORITY=Object.freeze({
  'user-confirmed':1,
  'direct-observation':.95,
  'reconciled-observation':.90
});

function copyValue(value){return JSON.parse(JSON.stringify(value));}
const FORBIDDEN_RAW_KEYS=/^(?:imageDataUrl|image|frame|frameData|rawFrame|video|audio|embedding|embeddings|blob|bytes|pixels)$/i;
function semanticClone(value,depth=0){
  if(depth>8)throw new Error('Forecast semantic value is too deeply nested.');
  if(value==null||['string','number','boolean'].includes(typeof value))return value;
  if(Array.isArray(value))return value.slice(0,64).map((item)=>semanticClone(item,depth+1));
  if(typeof value!=='object')return null;
  const out={};
  for(const [key,item] of Object.entries(value).slice(0,64)){
    if(FORBIDDEN_RAW_KEYS.test(key))throw new Error('Forecast calibration cannot retain raw perception payloads.');
    out[txt(key,80)]=semanticClone(item,depth+1);
  }
  return out;
}
function idText(value,label){
  const out=txt(value,128);
  if(!out||!/^[A-Za-z0-9._:-]{3,128}$/.test(out))throw new Error(label+' is invalid.');
  return out;
}
function predictionKey(input={}){
  return [
    idText(input.modelKey||'tracky','modelKey'),
    txt(input.modelVersion||'unversioned',80)||'unversioned',
    txt(input.contextKey||'global',120)||'global',
    txt(input.kind||'generic',80)||'generic',
    FORECAST_CHANNELS.includes(input.channel)?input.channel:'active'
  ].join('::');
}
function effectiveSettlements(state){
  const superseded=new Set(
    arr(state.settlements)
      .map((item)=>String(item.supersedesSettlementId||''))
      .filter(Boolean)
  );
  return arr(state.settlements).filter((item)=>!superseded.has(String(item.id||'')));
}
function settledPairs(state,filter={}){
  const predictions=new Map(arr(state.predictions).map((item)=>[String(item.id),item]));
  const rows=[];
  for(const settlement of effectiveSettlements(state)){
    const prediction=predictions.get(String(settlement.predictionId||''));
    if(!prediction)continue;
    if(filter.modelKey&&prediction.modelKey!==filter.modelKey)continue;
    if(filter.modelVersion&&prediction.modelVersion!==filter.modelVersion)continue;
    if(filter.contextKey&&prediction.contextKey!==filter.contextKey)continue;
    if(filter.kind&&prediction.kind!==filter.kind)continue;
    if(filter.channel&&prediction.channel!==filter.channel)continue;
    const authorityWeight=FORECAST_OUTCOME_AUTHORITY[settlement.authority]||0;
    if(authorityWeight<=0)continue;
    rows.push({prediction,settlement,authorityWeight});
  }
  return rows;
}
function bucketFor(confidence,step){
  const safe=Math.max(.01,Math.min(.5,Number(step)||.1));
  const index=Math.min(Math.floor((1-1e-9)/safe),Math.floor(clamp01(confidence)/safe));
  const lower=Number((index*safe).toFixed(6));
  const upper=Number(Math.min(1,lower+safe).toFixed(6));
  return {key:lower.toFixed(2)+'-'+upper.toFixed(2),lower,upper,mid:(lower+upper)/2};
}
function weightedMean(rows,valueFn,weightFn){
  let n=0,d=0;
  for(const row of rows){
    const weight=Math.max(0,Number(weightFn(row))||0);
    if(!weight)continue;
    n+=Number(valueFn(row)||0)*weight;
    d+=weight;
  }
  return d>0?n/d:null;
}
function confidenceMetrics(rows,policy){
  const step=policy.confidenceBucketStep;
  const buckets=new Map();
  let weightedCount=0;
  let squaredError=0;
  let absCalibrationError=0;
  let rawTotal=0;
  let correctTotal=0;
  for(const row of rows){
    const raw=clamp01(row.prediction.rawConfidence);
    const correct=clamp01(row.settlement.correctness);
    const weight=row.authorityWeight;
    weightedCount+=weight;
    squaredError+=((raw-correct)**2)*weight;
    rawTotal+=raw*weight;
    correctTotal+=correct*weight;
    const bucket=bucketFor(raw,step);
    if(!buckets.has(bucket.key))buckets.set(bucket.key,{...bucket,weight:0,count:0,rawTotal:0,correctTotal:0});
    const item=buckets.get(bucket.key);
    item.weight+=weight;item.count+=1;item.rawTotal+=raw*weight;item.correctTotal+=correct*weight;
  }
  const out=[];
  for(const bucket of buckets.values()){
    const meanRaw=bucket.weight?bucket.rawTotal/bucket.weight:0;
    const empiricalAccuracy=bucket.weight?bucket.correctTotal/bucket.weight:0;
    absCalibrationError+=Math.abs(meanRaw-empiricalAccuracy)*bucket.weight;
    out.push({
      key:bucket.key,lower:bucket.lower,upper:bucket.upper,
      count:bucket.count,weightedCount:bucket.weight,
      meanRawConfidence:clamp01(meanRaw),
      empiricalAccuracy:clamp01(empiricalAccuracy),
      absoluteCalibrationError:Math.abs(meanRaw-empiricalAccuracy)
    });
  }
  out.sort((a,b)=>a.lower-b.lower);
  return {
    settledCount:rows.length,
    weightedCount,
    meanRawConfidence:weightedCount?rawTotal/weightedCount:null,
    empiricalAccuracy:weightedCount?correctTotal/weightedCount:null,
    brierScore:weightedCount?squaredError/weightedCount:null,
    expectedCalibrationError:weightedCount?absCalibrationError/weightedCount:null,
    buckets:out
  };
}
function effectiveProfileRows(state,input={}){
  const exact=settledPairs(state,{
    modelKey:input.modelKey,
    modelVersion:input.modelVersion,
    contextKey:input.contextKey,
    kind:input.kind,
    channel:input.channel||'active'
  });
  if(exact.length>=RELIABILITY_POLICY.calibration.minimumContextSettlements){
    return {scope:'context',rows:exact};
  }
  const model=settledPairs(state,{
    modelKey:input.modelKey,
    modelVersion:input.modelVersion,
    kind:input.kind,
    channel:input.channel||'active'
  });
  return {scope:'model',rows:model};
}

export function createForecastCalibrationState(now=Date.now()){
  return {
    schemaVersion:FORECAST_CALIBRATION_SCHEMA_VERSION,
    createdAt:Number(now),
    updatedAt:Number(now),
    predictions:[],
    settlements:[],
    boundaries:[
      'append-only-predictions',
      'append-only-settlements',
      'verified-outcomes-only',
      'raw-confidence-immutable',
      'calibration-never-overrides-user-confirmed-truth',
      'shadow-results-never-affect-active-calibration'
    ]
  };
}

export function hydrateForecastCalibrationState(input={},now=Date.now()){
  const base=createForecastCalibrationState(now);
  if(!input||typeof input!=='object')return base;
  return {
    ...base,
    schemaVersion:FORECAST_CALIBRATION_SCHEMA_VERSION,
    createdAt:Number(input.createdAt||now),
    updatedAt:Number(input.updatedAt||now),
    predictions:arr(input.predictions).slice(-RELIABILITY_POLICY.calibration.maxPredictions),
    settlements:arr(input.settlements).slice(-RELIABILITY_POLICY.calibration.maxSettlements),
    boundaries:[...base.boundaries]
  };
}

export function recordForecastPrediction(stateInput,input={},now=Date.now()){
  const state=hydrateForecastCalibrationState(stateInput,now);
  const id=idText(input.id,'prediction id');
  const existing=state.predictions.find((item)=>item.id===id);
  if(existing){
    return {state,prediction:copyValue(existing),created:false,idempotent:true};
  }
  const rawConfidence=clamp01(input.rawConfidence);
  const channel=FORECAST_CHANNELS.includes(input.channel)?input.channel:'active';
  const prediction={
    id,
    kind:txt(input.kind||'generic',80)||'generic',
    modelKey:idText(input.modelKey||'tracky','modelKey'),
    modelVersion:txt(input.modelVersion||'unversioned',80)||'unversioned',
    contextKey:txt(input.contextKey||'global',120)||'global',
    channel,
    predictedAt:Number(input.predictedAt||now),
    horizonMs:Math.max(0,Math.min(Number(input.horizonMs)||0,RELIABILITY_POLICY.calibration.maximumHorizonMs)),
    rawConfidence,
    predictedValue:semanticClone(input.predictedValue??null),
    subjectId:txt(input.subjectId||'',128)||null,
    roomId:txt(input.roomId||'',128)||null,
    sourceEvidenceIds:arr(input.sourceEvidenceIds).map((v)=>txt(v,128)).filter(Boolean).slice(0,24),
    profileKey:predictionKey({...input,channel}),
    metadata:semanticClone(input.metadata&&typeof input.metadata==='object'?input.metadata:{})
  };
  state.predictions=[...state.predictions,prediction].slice(-RELIABILITY_POLICY.calibration.maxPredictions);
  state.updatedAt=Number(now);
  return {state,prediction:copyValue(prediction),created:true,idempotent:false};
}

export function settleForecastPrediction(stateInput,input={},now=Date.now()){
  const state=hydrateForecastCalibrationState(stateInput,now);
  const predictionId=idText(input.predictionId,'predictionId');
  const prediction=state.predictions.find((item)=>item.id===predictionId);
  if(!prediction)throw new Error('Forecast prediction was not found.');
  const authority=txt(input.authority,80);
  if(!FORECAST_OUTCOME_AUTHORITY[authority])throw new Error('Forecast settlement requires verified outcome authority.');
  const id=idText(input.id,'settlement id');
  const existing=state.settlements.find((item)=>item.id===id);
  if(existing)return {state,settlement:copyValue(existing),created:false,idempotent:true};

  const prior=effectiveSettlements(state)
    .filter((item)=>item.predictionId===predictionId)
    .sort((a,b)=>Number(b.settledAt||0)-Number(a.settledAt||0))[0]||null;
  if(prior&&!input.supersedesSettlementId)throw new Error('Forecast prediction already has an effective settlement.');
  if(input.supersedesSettlementId&&(!prior||prior.id!==input.supersedesSettlementId)){
    throw new Error('Settlement supersedesSettlementId does not match the current effective settlement.');
  }
  const correctness=clamp01(input.correctness);
  const settlement={
    id,
    predictionId,
    settledAt:Number(input.settledAt||now),
    authority,
    authorityWeight:FORECAST_OUTCOME_AUTHORITY[authority],
    correctness,
    outcomeValue:semanticClone(input.outcomeValue??null),
    evidenceIds:arr(input.evidenceIds).map((v)=>txt(v,128)).filter(Boolean).slice(0,24),
    reason:txt(input.reason||'',500),
    supersedesSettlementId:input.supersedesSettlementId?String(input.supersedesSettlementId):null
  };
  state.settlements=[...state.settlements,settlement].slice(-RELIABILITY_POLICY.calibration.maxSettlements);
  state.updatedAt=Number(now);
  return {state,settlement:copyValue(settlement),created:true,idempotent:false};
}

export function forecastCalibrationProfile(stateInput,input={}){
  const state=hydrateForecastCalibrationState(stateInput);
  const modelKey=idText(input.modelKey||'tracky','modelKey');
  const modelVersion=txt(input.modelVersion||'unversioned',80)||'unversioned';
  const contextKey=txt(input.contextKey||'global',120)||'global';
  const kind=txt(input.kind||'generic',80)||'generic';
  const channel=FORECAST_CHANNELS.includes(input.channel)?input.channel:'active';
  const exactRows=settledPairs(state,{modelKey,modelVersion,contextKey,kind,channel});
  const modelRows=settledPairs(state,{modelKey,modelVersion,kind,channel});
  const activeRows=channel==='active'?modelRows:[];
  return {
    schemaVersion:FORECAST_CALIBRATION_SCHEMA_VERSION,
    modelKey,modelVersion,contextKey,kind,channel,
    context:confidenceMetrics(exactRows,RELIABILITY_POLICY.calibration),
    model:confidenceMetrics(modelRows,RELIABILITY_POLICY.calibration),
    eligibleToInfluenceActive:channel==='active'&&activeRows.length>=RELIABILITY_POLICY.calibration.minimumModelSettlements
  };
}

export function calibratedForecastConfidence(stateInput,input={}){
  const rawConfidence=clamp01(input.rawConfidence);
  const channel=FORECAST_CHANNELS.includes(input.channel)?input.channel:'active';
  if(channel!=='active'){
    return {
      rawConfidence,calibratedConfidence:rawConfidence,applied:false,
      reason:'non-active-channel',scope:'none',settledCount:0
    };
  }
  const state=hydrateForecastCalibrationState(stateInput);
  const profile=effectiveProfileRows(state,{...input,channel});
  const minimum=profile.scope==='context'
    ?RELIABILITY_POLICY.calibration.minimumContextSettlements
    :RELIABILITY_POLICY.calibration.minimumModelSettlements;
  if(profile.rows.length<minimum){
    return {
      rawConfidence,calibratedConfidence:rawConfidence,applied:false,
      reason:'insufficient-settlements',scope:profile.scope,settledCount:profile.rows.length
    };
  }

  const targetBucket=bucketFor(rawConfidence,RELIABILITY_POLICY.calibration.confidenceBucketStep);
  const bucketRows=profile.rows.filter((row)=>bucketFor(
    row.prediction.rawConfidence,
    RELIABILITY_POLICY.calibration.confidenceBucketStep
  ).key===targetBucket.key);
  const evidence=bucketRows.length>=RELIABILITY_POLICY.calibration.minimumBucketSettlements
    ?bucketRows
    :profile.rows;
  const empirical=weightedMean(
    evidence,
    (row)=>row.settlement.correctness,
    (row)=>row.authorityWeight
  );
  if(empirical==null){
    return {
      rawConfidence,calibratedConfidence:rawConfidence,applied:false,
      reason:'no-authoritative-outcomes',scope:profile.scope,settledCount:profile.rows.length
    };
  }

  const priorStrength=RELIABILITY_POLICY.calibration.priorStrength;
  const evidenceWeight=evidence.reduce((sum,row)=>sum+row.authorityWeight,0);
  const shrunk=((rawConfidence*priorStrength)+(empirical*evidenceWeight))/(priorStrength+evidenceWeight);
  const delta=Math.max(
    -RELIABILITY_POLICY.calibration.maximumConfidenceAdjustment,
    Math.min(RELIABILITY_POLICY.calibration.maximumConfidenceAdjustment,shrunk-rawConfidence)
  );
  const calibratedConfidence=clamp01(rawConfidence+delta);
  return {
    rawConfidence,
    calibratedConfidence,
    applied:true,
    reason:'authoritative-settlements',
    scope:profile.scope,
    settledCount:profile.rows.length,
    evidenceCount:evidence.length,
    empiricalAccuracy:clamp01(empirical),
    adjustment:calibratedConfidence-rawConfidence
  };
}

export function forecastCalibrationReport(stateInput,input={}){
  const state=hydrateForecastCalibrationState(stateInput);
  const predictions=arr(state.predictions);
  const settlements=effectiveSettlements(state);
  const modelKeys=[...new Set(predictions.map((item)=>item.modelKey))].sort();
  const profiles=[];
  for(const modelKey of modelKeys){
    const versions=[...new Set(predictions.filter((item)=>item.modelKey===modelKey).map((item)=>item.modelVersion))];
    for(const modelVersion of versions){
      const kinds=[...new Set(predictions.filter((item)=>item.modelKey===modelKey&&item.modelVersion===modelVersion).map((item)=>item.kind))];
      for(const kind of kinds){
        for(const channel of FORECAST_CHANNELS){
          const rows=settledPairs(state,{modelKey,modelVersion,kind,channel});
          if(!rows.length)continue;
          profiles.push({
            modelKey,modelVersion,kind,channel,
            ...confidenceMetrics(rows,RELIABILITY_POLICY.calibration)
          });
        }
      }
    }
  }
  return {
    schemaVersion:FORECAST_CALIBRATION_SCHEMA_VERSION,
    generatedAt:Date.now(),
    predictions:predictions.length,
    settlements:settlements.length,
    profiles,
    boundaries:[
      'raw-predictions-immutable',
      'verified-outcome-authority-required',
      'minimum-evidence-before-calibration',
      'bounded-confidence-adjustment',
      'shadow-and-canary-do-not-calibrate-active-channel'
    ]
  };
}
