import { RELIABILITY_POLICY } from './reliability-policy.js';

const txt=(v,max=160)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const arr=(v)=>Array.isArray(v)?v:[];
const FORBIDDEN_RAW_KEYS=/^(?:image|imageDataUrl|frame|frameData|rawFrame|video|audio|embedding|embeddings|blob|bytes|pixels|cameraUri|filePath)$/i;
const CHANNELS=new Set(['shadow','canary','active','retired','rolled_back']);

export const MODEL_LIFECYCLE_SCHEMA_VERSION=1;
export const MODEL_LIFECYCLE_PROTOCOL='physical_model_lifecycle.v1';

function copyValue(value){return JSON.parse(JSON.stringify(value));}
function safeId(value,label,max=128){
  const out=txt(value,max);
  if(!out||!/^[A-Za-z0-9._:-]{2,128}$/.test(out))throw new Error(label+' is invalid.');
  return out;
}
function safeVersion(value,label='modelVersion',max=80){
  const out=txt(value,max);
  if(!out||!/^[A-Za-z0-9._:-]{1,80}$/.test(out))throw new Error(label+' is invalid.');
  return out;
}
function semanticCopy(value,depth=0){
  if(depth>8)throw new Error('Model lifecycle semantic value is too deeply nested.');
  if(value==null||['string','number','boolean'].includes(typeof value))return value;
  if(Array.isArray(value))return value.slice(0,64).map((item)=>semanticCopy(item,depth+1));
  if(typeof value!=='object')return null;
  const out={};
  for(const [key,item] of Object.entries(value).slice(0,64)){
    if(FORBIDDEN_RAW_KEYS.test(key))throw new Error('Model lifecycle cannot retain raw perception payloads.');
    out[txt(key,80)]=semanticCopy(item,depth+1);
  }
  return out;
}
function modelId(modelKey,modelVersion){
  return safeId(modelKey,'modelKey')+'@'+safeVersion(modelVersion);
}
function stableHash(value){
  let h=2166136261;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}
function profileMetrics(report,modelKey,modelVersion,channel){
  const profiles=arr(report?.profiles).filter((p)=>
    p&&p.modelKey===modelKey&&p.modelVersion===modelVersion&&p.channel===channel
  );
  const settled=profiles.reduce((n,p)=>n+Math.max(0,Number(p.settledCount)||0),0);
  const weighted=(key)=>{
    let n=0,d=0;
    for(const p of profiles){
      const count=Math.max(0,Number(p.settledCount)||0);
      if(count&&p[key]!=null){n+=Number(p[key])*count;d+=count;}
    }
    return d?n/d:null;
  };
  return {
    settledCount:settled,
    empiricalAccuracy:weighted('empiricalAccuracy'),
    brierScore:weighted('brierScore'),
    expectedCalibrationError:weighted('expectedCalibrationError'),
    profileCount:profiles.length
  };
}
function latestScenarioSummary(state,id){
  const rows=arr(state.scenarioEvaluations).filter((x)=>x.modelId===id);
  if(!rows.length)return {runs:0,passRate:null,criticalFailures:0,passed:false};
  const latestByScenario=new Map();
  for(const row of rows)latestByScenario.set(row.scenarioKey,row);
  const latest=[...latestByScenario.values()];
  const passes=latest.filter((x)=>x.passed).length;
  const criticalFailures=latest.filter((x)=>!x.passed&&x.critical).length;
  return {
    runs:latest.length,
    passRate:latest.length?passes/latest.length:null,
    criticalFailures,
    passed:latest.length>=RELIABILITY_POLICY.modelLifecycle.minimumGoldenScenarios
      && criticalFailures===0
      && passes/latest.length>=RELIABILITY_POLICY.modelLifecycle.minimumGoldenScenarioPassRate
  };
}
function findModel(state,id){
  return arr(state.models).find((x)=>x.id===id)||null;
}
function activeForKey(state,modelKey){
  return arr(state.models).find((x)=>x.modelKey===modelKey&&x.channel==='active')||null;
}
function previousKnownGood(state,modelKey,excludeId=''){
  return [...arr(state.models)]
    .filter((x)=>x.modelKey===modelKey&&x.id!==excludeId&&x.knownGood&&['retired','rolled_back'].includes(x.channel))
    .sort((a,b)=>Number(b.activatedAt||0)-Number(a.activatedAt||0))[0]||null;
}
function decision(state,input,now){
  const item={
    id:safeId(input.id||('decision-'+now+'-'+state.decisions.length),'decision id'),
    type:txt(input.type,60),
    modelId:txt(input.modelId,180),
    fromChannel:txt(input.fromChannel||'',30),
    toChannel:txt(input.toChannel||'',30),
    reason:txt(input.reason||'',500),
    automatic:!!input.automatic,
    metrics:semanticCopy(input.metrics||{}),
    at:Number(now)
  };
  state.decisions=[...state.decisions,item].slice(-RELIABILITY_POLICY.modelLifecycle.maxDecisions);
  return item;
}

export function createModelLifecycleState(now=Date.now()){
  return {
    schemaVersion:MODEL_LIFECYCLE_SCHEMA_VERSION,
    protocol:MODEL_LIFECYCLE_PROTOCOL,
    createdAt:Number(now),
    updatedAt:Number(now),
    models:[],
    environmentProfiles:[],
    accuracySnapshots:[],
    scenarioEvaluations:[],
    decisions:[],
    boundaries:[
      'calibration-authority-external',
      'ground-truth-never-overridden',
      'shadow-before-canary',
      'canary-before-active',
      'verified-evidence-required',
      'rollback-to-known-good',
      'raw-perception-never-retained'
    ]
  };
}
export function hydrateModelLifecycleState(input={},now=Date.now()){
  const base=createModelLifecycleState(now);
  if(!input||typeof input!=='object')return base;
  return {
    ...base,
    createdAt:Number(input.createdAt||now),
    updatedAt:Number(input.updatedAt||now),
    models:arr(input.models).slice(-RELIABILITY_POLICY.modelLifecycle.maxModels),
    environmentProfiles:arr(input.environmentProfiles).slice(-RELIABILITY_POLICY.modelLifecycle.maxEnvironmentProfiles),
    accuracySnapshots:arr(input.accuracySnapshots).slice(-RELIABILITY_POLICY.modelLifecycle.maxAccuracySnapshots),
    scenarioEvaluations:arr(input.scenarioEvaluations).slice(-RELIABILITY_POLICY.modelLifecycle.maxScenarioEvaluations),
    decisions:arr(input.decisions).slice(-RELIABILITY_POLICY.modelLifecycle.maxDecisions)
  };
}
export function registerModelCandidate(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const id=modelId(input.modelKey,input.modelVersion);
  const existing=findModel(state,id);
  if(existing)return {state,model:copyValue(existing),created:false,idempotent:true};
  const channel=input.channel||'shadow';
  if(channel!=='shadow')throw new Error('New model candidates must begin in shadow mode.');
  const model={
    id,
    modelKey:safeId(input.modelKey,'modelKey'),
    modelVersion:safeVersion(input.modelVersion),
    channel:'shadow',
    status:'evaluating',
    registeredAt:Number(now),
    activatedAt:null,
    retiredAt:null,
    knownGood:false,
    canaryPercent:0,
    previousActiveId:null,
    packageChecksum:txt(input.packageChecksum||'',128)||null,
    runtime:txt(input.runtime||'tracky',80)||'tracky',
    metadata:semanticCopy(input.metadata||{})
  };
  state.models=[...state.models,model].slice(-RELIABILITY_POLICY.modelLifecycle.maxModels);
  state.updatedAt=Number(now);
  decision(state,{type:'register',modelId:id,toChannel:'shadow',reason:'candidate_registered'},now);
  return {state,model:copyValue(model),created:true,idempotent:false};
}
export function recordAccuracySnapshot(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const modelKey=safeId(input.modelKey,'modelKey');
  const modelVersion=safeVersion(input.modelVersion);
  const id=modelId(modelKey,modelVersion);
  if(!findModel(state,id))throw new Error('Model must be registered before accuracy can be recorded.');
  const channel=txt(input.channel||'shadow',20);
  if(!['shadow','canary','active'].includes(channel))throw new Error('Accuracy snapshot channel is invalid.');
  const snapshotId=safeId(input.id||('accuracy-'+id.replace('@','-')+'-'+now),'accuracy snapshot id');
  const existing=arr(state.accuracySnapshots).find((item)=>item.id===snapshotId);
  if(existing)return {state,snapshot:copyValue(existing),created:false,idempotent:true};
  const metrics={
    settledCount:Math.max(0,Number(input.settledCount)||0),
    empiricalAccuracy:input.empiricalAccuracy==null?null:clamp01(input.empiricalAccuracy),
    brierScore:input.brierScore==null?null:clamp01(input.brierScore),
    expectedCalibrationError:input.expectedCalibrationError==null?null:clamp01(input.expectedCalibrationError),
    failureRate:input.failureRate==null?0:clamp01(input.failureRate),
    p95LatencyMs:Math.max(0,Number(input.p95LatencyMs)||0)
  };
  const row={
    id:snapshotId,
    modelId:id,modelKey,modelVersion,channel,
    contextKey:txt(input.contextKey||'global',120)||'global',
    metrics,observedAt:Number(input.observedAt||now)
  };
  state.accuracySnapshots=[...state.accuracySnapshots,row].slice(-RELIABILITY_POLICY.modelLifecycle.maxAccuracySnapshots);
  state.updatedAt=Number(now);
  return {state,snapshot:copyValue(row),created:true,idempotent:false};
}
export function importCalibrationReport(stateInput,report={},now=Date.now()){
  let state=hydrateModelLifecycleState(stateInput,now);
  const imported=[];
  for(const p of arr(report.profiles)){
    if(!p||!p.modelKey||!p.modelVersion||!['shadow','canary','active'].includes(p.channel))continue;
    const id=modelId(p.modelKey,p.modelVersion);
    if(!findModel(state,id))continue;
    const result=recordAccuracySnapshot(state,{
      id:'cal-'+String(report.generatedAt||now)+'-'+stableHash(id+'|'+p.kind+'|'+p.channel),
      modelKey:p.modelKey,modelVersion:p.modelVersion,channel:p.channel,
      contextKey:p.kind||'global',settledCount:p.settledCount,
      empiricalAccuracy:p.empiricalAccuracy,brierScore:p.brierScore,
      expectedCalibrationError:p.expectedCalibrationError,
      observedAt:report.generatedAt||now
    },now);
    state=result.state;imported.push(result.snapshot);
  }
  return {state,imported};
}
export function registerEnvironmentProfile(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const profileKey=safeId(input.profileKey,'profileKey');
  const normalized={
    profileKey,
    roomId:txt(input.roomId||'',128)||null,
    cameraId:txt(input.cameraId||'',128)||null,
    angleKey:txt(input.angleKey||'default',80)||'default',
    lightingBucket:txt(input.lightingBucket||'unknown',60)||'unknown',
    layoutFingerprint:txt(input.layoutFingerprint||'',128)||null,
    timeBucket:txt(input.timeBucket||'any',40)||'any',
    seasonBucket:txt(input.seasonBucket||'any',40)||'any',
    modelKey:safeId(input.modelKey,'modelKey'),
    modelVersion:safeVersion(input.modelVersion),
    calibrationKey:txt(input.calibrationKey||profileKey,128),
    metadata:semanticCopy(input.metadata||{}),
    updatedAt:Number(now)
  };
  const idx=state.environmentProfiles.findIndex((x)=>x.profileKey===profileKey);
  if(idx>=0)state.environmentProfiles[idx]=normalized;
  else state.environmentProfiles=[...state.environmentProfiles,normalized].slice(-RELIABILITY_POLICY.modelLifecycle.maxEnvironmentProfiles);
  state.updatedAt=Number(now);
  return {state,profile:copyValue(normalized)};
}
export function selectEnvironmentProfile(stateInput,input={}){
  const state=hydrateModelLifecycleState(stateInput);
  const candidates=arr(state.environmentProfiles).filter((p)=>{
    if(input.roomId&&p.roomId&&p.roomId!==input.roomId)return false;
    if(input.cameraId&&p.cameraId&&p.cameraId!==input.cameraId)return false;
    if(input.angleKey&&p.angleKey!==input.angleKey)return false;
    if(input.lightingBucket&&p.lightingBucket!==input.lightingBucket)return false;
    if(input.timeBucket&&p.timeBucket!=='any'&&p.timeBucket!==input.timeBucket)return false;
    if(input.seasonBucket&&p.seasonBucket!=='any'&&p.seasonBucket!==input.seasonBucket)return false;
    return true;
  });
  const scored=candidates.map((p)=>({
    profile:p,
    score:
      (input.roomId&&p.roomId===input.roomId?4:0)+
      (input.cameraId&&p.cameraId===input.cameraId?4:0)+
      (input.angleKey&&p.angleKey===input.angleKey?3:0)+
      (input.lightingBucket&&p.lightingBucket===input.lightingBucket?3:0)+
      (input.timeBucket&&p.timeBucket===input.timeBucket?2:0)+
      (input.seasonBucket&&p.seasonBucket===input.seasonBucket?1:0)
  })).sort((a,b)=>b.score-a.score||Number(b.profile.updatedAt||0)-Number(a.profile.updatedAt||0));
  return scored[0]?copyValue(scored[0]):null;
}
export function recordGoldenScenarioEvaluation(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const id=modelId(input.modelKey,input.modelVersion);
  if(!findModel(state,id))throw new Error('Model must be registered before scenario evaluation.');
  const row={
    id:safeId(input.id||('scenario-'+now+'-'+state.scenarioEvaluations.length),'scenario evaluation id'),
    modelId:id,
    scenarioKey:safeId(input.scenarioKey,'scenarioKey'),
    passed:!!input.passed,
    critical:!!input.critical,
    metrics:semanticCopy(input.metrics||{}),
    evaluatedAt:Number(now)
  };
  state.scenarioEvaluations=[...state.scenarioEvaluations,row].slice(-RELIABILITY_POLICY.modelLifecycle.maxScenarioEvaluations);
  state.updatedAt=Number(now);
  return {state,evaluation:copyValue(row)};
}
function latestMetrics(state,id,channel){
  return [...arr(state.accuracySnapshots)]
    .filter((x)=>x.modelId===id&&x.channel===channel)
    .sort((a,b)=>Number(b.observedAt||0)-Number(a.observedAt||0))[0]||null;
}
export function evaluateDrift(stateInput,input={}){
  const state=hydrateModelLifecycleState(stateInput);
  const id=modelId(input.modelKey,input.modelVersion);
  const active=findModel(state,id);
  if(!active)throw new Error('Model is not registered.');
  const baseline=input.baseline||{};
  const current=input.current||latestMetrics(state,id,'active')?.metrics||{};
  const reasons=[];
  const accDrop=(baseline.empiricalAccuracy!=null&&current.empiricalAccuracy!=null)
    ?Number(baseline.empiricalAccuracy)-Number(current.empiricalAccuracy):0;
  const brierRise=(baseline.brierScore!=null&&current.brierScore!=null)
    ?Number(current.brierScore)-Number(baseline.brierScore):0;
  const eceRise=(baseline.expectedCalibrationError!=null&&current.expectedCalibrationError!=null)
    ?Number(current.expectedCalibrationError)-Number(baseline.expectedCalibrationError):0;
  if(accDrop>RELIABILITY_POLICY.modelLifecycle.maximumAccuracyRegression)reasons.push('accuracy_regression');
  if(brierRise>RELIABILITY_POLICY.modelLifecycle.maximumBrierRegression)reasons.push('brier_regression');
  if(eceRise>RELIABILITY_POLICY.modelLifecycle.maximumCalibrationErrorRegression)reasons.push('calibration_error_regression');
  if(Number(current.failureRate||0)>RELIABILITY_POLICY.modelLifecycle.maximumFailureRate)reasons.push('failure_rate');
  if(Number(current.p95LatencyMs||0)>RELIABILITY_POLICY.modelLifecycle.maximumP95LatencyMs)reasons.push('latency');
  return {
    drifting:reasons.length>0,reasons,modelId:id,
    deltas:{accuracy:-accDrop,brier:brierRise,calibrationError:eceRise},
    current:semanticCopy(current),baseline:semanticCopy(baseline)
  };
}
export function evaluatePromotion(stateInput,input={}){
  const state=hydrateModelLifecycleState(stateInput);
  const id=modelId(input.modelKey,input.modelVersion);
  const model=findModel(state,id);
  if(!model)throw new Error('Model is not registered.');
  const channel=model.channel;
  if(!['shadow','canary'].includes(channel))return {eligible:false,reasons:['invalid_channel'],model:copyValue(model)};
  const metrics=latestMetrics(state,id,channel)?.metrics||profileMetrics(input.calibrationReport||{},model.modelKey,model.modelVersion,channel);
  const reasons=[];
  const minimum=channel==='shadow'
    ?RELIABILITY_POLICY.modelLifecycle.minimumShadowSettlements
    :RELIABILITY_POLICY.modelLifecycle.minimumCanarySettlements;
  if(Number(metrics.settledCount||0)<minimum)reasons.push('insufficient_verified_evidence');
  if(metrics.empiricalAccuracy==null||Number(metrics.empiricalAccuracy)<RELIABILITY_POLICY.modelLifecycle.minimumEmpiricalAccuracy)reasons.push('accuracy_below_gate');
  if(metrics.brierScore==null||Number(metrics.brierScore)>RELIABILITY_POLICY.modelLifecycle.maximumBrierScore)reasons.push('brier_above_gate');
  if(metrics.expectedCalibrationError==null||Number(metrics.expectedCalibrationError)>RELIABILITY_POLICY.modelLifecycle.maximumCalibrationError)reasons.push('calibration_error_above_gate');
  if(Number(metrics.failureRate||0)>RELIABILITY_POLICY.modelLifecycle.maximumFailureRate)reasons.push('failure_rate_above_gate');
  if(Number(metrics.p95LatencyMs||0)>RELIABILITY_POLICY.modelLifecycle.maximumP95LatencyMs)reasons.push('latency_above_gate');
  const scenarios=latestScenarioSummary(state,id);
  if(!scenarios.passed)reasons.push('golden_scenarios_not_green');
  return {eligible:reasons.length===0,reasons,channel,metrics:copyValue(metrics),scenarios,model:copyValue(model)};
}
export function promoteModel(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const id=modelId(input.modelKey,input.modelVersion);
  const model=findModel(state,id);
  if(!model)throw new Error('Model is not registered.');
  const gate=evaluatePromotion(state,input);
  if(!gate.eligible)throw new Error('Model promotion gate failed: '+gate.reasons.join(','));
  const from=model.channel;
  if(from==='shadow'){
    model.channel='canary';model.canaryPercent=Math.max(1,Math.min(
      Number(input.canaryPercent)||RELIABILITY_POLICY.modelLifecycle.defaultCanaryPercent,
      RELIABILITY_POLICY.modelLifecycle.maximumCanaryPercent
    ));model.status='canary';
    decision(state,{type:'promote',modelId:id,fromChannel:'shadow',toChannel:'canary',reason:'promotion_gate_green',metrics:gate.metrics},now);
  }else if(from==='canary'){
    const current=activeForKey(state,model.modelKey);
    if(current&&current.id!==model.id){
      current.channel='retired';current.status='known_good';current.knownGood=true;current.retiredAt=Number(now);
      model.previousActiveId=current.id;
    }
    model.channel='active';model.status='active';model.knownGood=true;model.canaryPercent=100;model.activatedAt=Number(now);
    decision(state,{type:'activate',modelId:id,fromChannel:'canary',toChannel:'active',reason:'canary_gate_green',metrics:gate.metrics},now);
  }
  state.updatedAt=Number(now);
  return {state,model:copyValue(model),decision:copyValue(state.decisions.at(-1))};
}
export function canaryAssignment(stateInput,input={}){
  const state=hydrateModelLifecycleState(stateInput);
  const id=modelId(input.modelKey,input.modelVersion);
  const model=findModel(state,id);
  if(!model||model.channel!=='canary')return {selected:false,reason:'not_canary',modelId:id};
  const key=txt(input.assignmentKey||input.cameraId||input.environmentId||'',160);
  if(!key)return {selected:false,reason:'missing_assignment_key',modelId:id};
  const bucket=stableHash(id+'|'+key)%100;
  return {selected:bucket<model.canaryPercent,bucket,canaryPercent:model.canaryPercent,modelId:id};
}
export function rollbackModel(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const id=modelId(input.modelKey,input.modelVersion);
  const active=findModel(state,id);
  if(!active||active.channel!=='active')throw new Error('Only the active model can be rolled back.');
  const fallback=active.previousActiveId?findModel(state,active.previousActiveId):previousKnownGood(state,active.modelKey,active.id);
  if(!fallback)throw new Error('No known-good rollback model is available.');
  active.channel='rolled_back';active.status='rolled_back';active.knownGood=false;active.retiredAt=Number(now);
  fallback.channel='active';fallback.status='active';fallback.knownGood=true;fallback.canaryPercent=100;fallback.activatedAt=Number(now);
  const d=decision(state,{
    type:'rollback',modelId:active.id,fromChannel:'active',toChannel:'rolled_back',
    reason:input.reason||'regression_gate',automatic:!!input.automatic,
    metrics:input.metrics||{}
  },now);
  state.updatedAt=Number(now);
  return {state,rolledBack:copyValue(active),active:copyValue(fallback),decision:copyValue(d)};
}
export function enforceActiveHealth(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const id=modelId(input.modelKey,input.modelVersion);
  const active=findModel(state,id);
  if(!active||active.channel!=='active')return {state,action:'none',reason:'not_active'};
  const drift=evaluateDrift(state,{...input,modelKey:active.modelKey,modelVersion:active.modelVersion});
  if(!drift.drifting)return {state,action:'none',drift};
  if(!RELIABILITY_POLICY.modelLifecycle.automaticRollback)return {state,action:'degraded',drift};
  try{
    const rollback=rollbackModel(state,{
      modelKey:active.modelKey,modelVersion:active.modelVersion,
      reason:drift.reasons.join(','),automatic:true,metrics:drift
    },now);
    return {...rollback,action:'rolled_back',drift};
  }catch{
    active.status='degraded';
    const d=decision(state,{
      type:'degrade',modelId:active.id,fromChannel:'active',toChannel:'active',
      reason:'drift_without_known_good',automatic:true,metrics:drift
    },now);
    return {state,action:'degraded',drift,decision:d};
  }
}
export function enforceLatestActiveHealth(stateInput,input={},now=Date.now()){
  const state=hydrateModelLifecycleState(stateInput,now);
  const id=modelId(input.modelKey,input.modelVersion);
  const active=findModel(state,id);
  if(!active||active.channel!=='active')return {state,action:'none',reason:'not_active'};
  const snapshots=arr(state.accuracySnapshots)
    .filter((x)=>x.modelId===id&&x.channel==='active')
    .sort((a,b)=>Number(a.observedAt||0)-Number(b.observedAt||0));
  if(snapshots.length<2)return {state,action:'none',reason:'insufficient_active_history'};
  const baseline=snapshots[0].metrics;
  const current=snapshots[snapshots.length-1].metrics;
  return enforceActiveHealth(state,{
    modelKey:active.modelKey,modelVersion:active.modelVersion,baseline,current
  },now);
}

export function modelLifecycleReport(stateInput){
  const state=hydrateModelLifecycleState(stateInput);
  const active=state.models.filter((x)=>x.channel==='active');
  const shadow=state.models.filter((x)=>x.channel==='shadow');
  const canary=state.models.filter((x)=>x.channel==='canary');
  const degraded=active.filter((x)=>x.status==='degraded');
  return {
    schemaVersion:MODEL_LIFECYCLE_SCHEMA_VERSION,
    protocol:MODEL_LIFECYCLE_PROTOCOL,
    active:copyValue(active),
    shadow:copyValue(shadow),
    canary:copyValue(canary),
    degraded:copyValue(degraded),
    environmentProfiles:copyValue(state.environmentProfiles),
    recentDecisions:copyValue(state.decisions.slice(-50)),
    scenarioStatus:Object.fromEntries(state.models.map((x)=>[x.id,latestScenarioSummary(state,x.id)])),
    boundaries:[
      'local-model-activation-authority',
      'calibration-consumed-not-duplicated',
      'ground-truth-never-overridden',
      'rollback-known-good-only',
      'semantic-only-state'
    ]
  };
}
