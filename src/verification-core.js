const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export const VERIFICATION_STATES = Object.freeze([
  'queued',
  'gathering',
  'verified',
  'cleared',
  'uncertain',
  'blocked',
  'cancelled'
]);

const STRATEGIES = Object.freeze({
  'world-contradiction': {
    category:'system',
    channels:['world-state','room-fusion','identity'],
    minimumEvidence:2,
    minimumSources:2,
    confidenceThreshold:0.72,
    deadlineMs:8000,
    refreshEnvironment:false
  },
  'environment-unrecognized': {
    category:'environment',
    channels:['environment-frame','baseline-match','landmarks'],
    minimumEvidence:2,
    minimumSources:2,
    confidenceThreshold:0.68,
    deadlineMs:12000,
    refreshEnvironment:true
  },
  'environment-structural-drift': {
    category:'environment',
    channels:['environment-frame','baseline-match','landmarks'],
    minimumEvidence:3,
    minimumSources:2,
    confidenceThreshold:0.72,
    deadlineMs:16000,
    refreshEnvironment:true
  },
  'camera-pose-shift': {
    category:'environment',
    channels:['environment-frame','landmarks','camera-health'],
    minimumEvidence:2,
    minimumSources:2,
    confidenceThreshold:0.68,
    deadlineMs:12000,
    refreshEnvironment:true
  },
  'camera-quality-degraded': {
    category:'environment',
    channels:['environment-frame','camera-health'],
    minimumEvidence:2,
    minimumSources:2,
    confidenceThreshold:0.65,
    deadlineMs:10000,
    refreshEnvironment:true
  },
  'expected-location-deviation': {
    category:'object',
    channels:['object-observation','room-visibility','same-room-cameras'],
    minimumEvidence:3,
    minimumSources:2,
    confidenceThreshold:0.70,
    deadlineMs:12000,
    refreshEnvironment:false
  },
  'expected-object-missing': {
    category:'object',
    channels:['object-observation','room-visibility','same-room-cameras'],
    minimumEvidence:3,
    minimumSources:2,
    confidenceThreshold:0.72,
    deadlineMs:16000,
    refreshEnvironment:false
  },
  'new-object-presence': {
    category:'object',
    channels:['object-observation','scene-change','same-room-cameras'],
    minimumEvidence:3,
    minimumSources:2,
    confidenceThreshold:0.65,
    deadlineMs:20000,
    refreshEnvironment:false
  }
});

export function verificationStrategy(anomalyType) {
  return {
    category:'system',
    channels:['world-state'],
    minimumEvidence:2,
    minimumSources:1,
    confidenceThreshold:0.65,
    deadlineMs:12000,
    refreshEnvironment:false,
    ...(STRATEGIES[anomalyType] || {})
  };
}

export function createVerificationState() {
  return {
    schemaVersion:1,
    updatedAt:Date.now(),
    requests:{},
    history:[],
    stats:{
      started:0,
      verified:0,
      cleared:0,
      uncertain:0,
      blocked:0,
      cancelled:0
    }
  };
}

function verificationId(signature, now) {
  let hash=0;
  for(const char of String(signature||'')){
    hash=((hash<<5)-hash+char.charCodeAt(0))|0;
  }
  return 'VER-'+Math.abs(hash).toString(36)+'-'+Number(now).toString(36);
}

export function privacyAllowsVerificationChannel(channel, policy = {}) {
  if (channel === 'world-state') return true;
  if (channel === 'room-fusion') return policy.allowVisualObservation !== false;
  if (channel === 'identity') {
    return (
      policy.allowVisualObservation !== false &&
      policy.allowParticipantIdentity !== false
    );
  }
  if (['environment-frame','baseline-match','landmarks','camera-health'].includes(channel)) {
    return (
      policy.allowVisualObservation !== false &&
      policy.allowEnvironmentComparison !== false
    );
  }
  if (['object-observation','room-visibility','same-room-cameras','scene-change'].includes(channel)) {
    return (
      policy.allowVisualObservation !== false &&
      policy.allowObjectObservation !== false
    );
  }
  return false;
}

export function createVerificationPlan(anomaly = {}, policy = {}, now = Date.now()) {
  const strategy=verificationStrategy(anomaly.type);
  const channels=strategy.channels.map((channel)=>({
    channel,
    allowed:privacyAllowsVerificationChannel(channel,policy)
  }));
  const allowed=channels.filter((item)=>item.allowed).map((item)=>item.channel);

  return {
    anomalyType:anomaly.type,
    category:strategy.category,
    channels,
    allowedChannels:allowed,
    blockedChannels:channels.filter((item)=>!item.allowed).map((item)=>item.channel),
    minimumEvidence:strategy.minimumEvidence,
    minimumSources:Math.min(strategy.minimumSources,Math.max(1,allowed.length)),
    confidenceThreshold:strategy.confidenceThreshold,
    deadlineMs:strategy.deadlineMs,
    deadlineAt:now+strategy.deadlineMs,
    refreshEnvironment:strategy.refreshEnvironment && allowed.includes('environment-frame'),
    blocked:allowed.length===0
  };
}

export function startVerification(state, anomaly = {}, policy = {}, now = Date.now()) {
  if (!anomaly.signature) throw new Error('Verification requires an anomaly signature.');
  const existing=state.requests[anomaly.signature];
  if (existing && ['queued','gathering'].includes(existing.status)) return existing;

  const plan=createVerificationPlan(anomaly,policy,now);
  const request={
    id:verificationId(anomaly.signature,now),
    signature:anomaly.signature,
    anomalyId:anomaly.id || null,
    anomalyType:anomaly.type,
    category:anomaly.category || plan.category,
    roomId:anomaly.roomId || null,
    subjectId:anomaly.subjectId || null,
    objectId:anomaly.objectId || null,
    participantId:anomaly.participantId || null,
    summary:anomaly.summary || anomaly.type,
    priority:clamp01(anomaly.priority ?? 0.7),
    status:plan.blocked?'blocked':'gathering',
    plan,
    evidence:[],
    sourceKeys:[],
    startedAt:now,
    updatedAt:now,
    completedAt:plan.blocked?now:null,
    result:plan.blocked?'blocked':null
  };

  state.requests[anomaly.signature]=request;
  state.stats.started+=1;
  if(plan.blocked){
    state.stats.blocked+=1;
    boundedHistory(state,request);
    delete state.requests[anomaly.signature];
  }
  state.updatedAt=now;
  return request;
}

function boundedHistory(state, record, limit=200){
  state.history.push(JSON.parse(JSON.stringify(record)));
  if(state.history.length>limit){
    state.history.splice(0,state.history.length-limit);
  }
}

function normalizedEvidence(item = {}, now = Date.now()) {
  return {
    id:String(item.id || [item.source,item.observedAt || now,item.outcome].join(':')),
    source:String(item.source || 'unknown'),
    channel:String(item.channel || item.source || 'unknown'),
    outcome:['supporting','clearing','neutral'].includes(item.outcome)
      ? item.outcome
      : 'neutral',
    confidence:clamp01(item.confidence ?? 0.5),
    observedAt:Number(item.observedAt || now),
    cameraId:item.cameraId || null,
    roomId:item.roomId || null,
    data:item.data || null
  };
}

export function addVerificationEvidence(state, signature, evidence, now = Date.now()) {
  const request=state.requests[signature];
  if (!request || !['queued','gathering'].includes(request.status)) return null;

  const item=normalizedEvidence(evidence,now);
  if (!request.plan.allowedChannels.includes(item.channel)) return request;
  if (request.evidence.some((existing)=>existing.id===item.id)) return request;

  request.evidence.push(item);
  if(request.evidence.length>50) request.evidence.shift();
  request.sourceKeys=[...new Set(request.evidence.map((entry)=>entry.source))];
  request.updatedAt=now;
  request.status='gathering';
  state.updatedAt=now;
  return request;
}

function quorumFor(request,outcome){
  const evidence=request.evidence.filter((item)=>item.outcome===outcome);
  const sources=new Set(evidence.map((item)=>item.source));
  const confidence=evidence.length
    ? evidence.reduce((sum,item)=>sum+item.confidence,0)/evidence.length
    : 0;
  return {
    evidenceCount:evidence.length,
    sourceCount:sources.size,
    confidence,
    met:(
      evidence.length>=request.plan.minimumEvidence &&
      sources.size>=request.plan.minimumSources &&
      confidence>=request.plan.confidenceThreshold
    )
  };
}

export function verificationQuorum(request) {
  return {
    supporting:quorumFor(request,'supporting'),
    clearing:quorumFor(request,'clearing')
  };
}

export function evaluateVerification(state, signature, now = Date.now()) {
  const request=state.requests[signature];
  if (!request) return null;

  if (request.status==='blocked') return request;
  const quorum=verificationQuorum(request);

  let result=null;
  if(quorum.supporting.met && !quorum.clearing.met) result='verified';
  else if(quorum.clearing.met && !quorum.supporting.met) result='cleared';
  else if(quorum.supporting.met && quorum.clearing.met) result='uncertain';
  else if(now>=request.plan.deadlineAt) result='uncertain';

  if(!result){
    request.updatedAt=now;
    return request;
  }

  request.status=result;
  request.result=result;
  request.quorum=quorum;
  request.completedAt=now;
  request.updatedAt=now;
  state.stats[result]+=1;
  boundedHistory(state,request);
  delete state.requests[signature];
  state.updatedAt=now;
  return request;
}

export function cancelVerification(state, signature, now = Date.now()) {
  const request=state.requests[signature];
  if (!request) return null;
  request.status='cancelled';
  request.result='cancelled';
  request.completedAt=now;
  request.updatedAt=now;
  state.stats.cancelled+=1;
  boundedHistory(state,request);
  delete state.requests[signature];
  state.updatedAt=now;
  return request;
}

export function evidenceFromContext(request, context = {}, now = Date.now()) {
  const evidence=[];
  const anomaly=context.anomaly || {};
  const type=request.anomalyType;

  if(request.plan.allowedChannels.includes('world-state')){
    const contradiction=(context.physicalWorld?.contradictions || [])
      .find((item)=>item.subjectId===request.subjectId);
    evidence.push({
      id:'world:'+request.signature+':'+String(context.physicalWorld?.updatedAt || now),
      source:'physical-world',
      channel:'world-state',
      outcome:contradiction?'supporting':'clearing',
      confidence:contradiction?1:0.78,
      observedAt:context.physicalWorld?.updatedAt || now,
      data:contradiction || null
    });
  }

  if(request.plan.allowedChannels.includes('room-fusion')){
    const participant=request.participantId
      ? context.multiRoom?.participants?.['PERSON:'+request.participantId]
      : null;
    if(participant){
      evidence.push({
        id:'fusion:'+participant.id+':'+participant.lastObservedAt,
        source:'room-fusion',
        channel:'room-fusion',
        outcome:participant.presence==='uncertain'?'supporting':'clearing',
        confidence:participant.confidence,
        observedAt:participant.lastObservedAt,
        roomId:participant.roomId,
        data:{presence:participant.presence,candidateRoomIds:participant.candidateRoomIds}
      });
    }
  }

  if(request.plan.allowedChannels.includes('identity') && request.participantId){
    const participant=context.multiRoom?.participants?.['PERSON:'+request.participantId];
    if(participant){
      evidence.push({
        id:'identity:'+request.participantId+':'+participant.lastObservedAt,
        source:'identity',
        channel:'identity',
        outcome:participant.identityAuthority==='enrolled-participant'?'supporting':'neutral',
        confidence:participant.confidence,
        observedAt:participant.lastObservedAt,
        data:{authority:participant.identityAuthority}
      });
    }
  }

  if(request.plan.allowedChannels.includes('environment-frame') && context.currentEnvironment){
    const captured=Number(context.currentEnvironment.capturedAt || now);
    let supporting=false;
    let confidence=0.6;
    if(type==='environment-unrecognized'){
      supporting=context.environment?.classification==='unknown';
      confidence=supporting
        ? Math.max(0.55,1-Number(context.environment?.best?.score || 0))
        : Number(context.environment?.best?.score || 0.75);
    }else if(type==='environment-structural-drift'){
      supporting=Number(context.environment?.drift?.structuralDrift || 0)>=0.35;
      confidence=supporting
        ? clamp01(0.55+Number(context.environment?.drift?.structuralDrift || 0)*0.45)
        : 0.75;
    }else if(type==='camera-pose-shift'){
      supporting=context.environment?.drift?.likelyCameraShift===true;
      confidence=supporting
        ? clamp01(context.environment?.drift?.cameraPoseDrift || 0.6)
        : 0.75;
    }else if(type==='camera-quality-degraded'){
      supporting=Number(context.currentEnvironment?.quality?.score || 1)<0.22;
      confidence=supporting
        ? clamp01(1-Number(context.currentEnvironment?.quality?.score || 0))
        : clamp01(context.currentEnvironment?.quality?.score || 0.75);
    }

    evidence.push({
      id:'environment-frame:'+captured,
      source:'environment-frame',
      channel:'environment-frame',
      outcome:supporting?'supporting':'clearing',
      confidence,
      observedAt:captured,
      roomId:request.roomId,
      data:{
        classification:context.environment?.classification || null,
        drift:context.environment?.drift || null,
        quality:context.currentEnvironment?.quality || null
      }
    });
  }

  if(request.plan.allowedChannels.includes('baseline-match') && context.environment){
    const stamp=Number(context.currentEnvironment?.capturedAt || context.environment?.best?.capturedAt || now);
    const score=Number(context.environment?.best?.score || 0);
    let supporting=false;
    if(type==='environment-unrecognized') supporting=context.environment.classification==='unknown';
    if(type==='environment-structural-drift') supporting=Number(context.environment?.drift?.structuralDrift || 0)>=0.35;
    evidence.push({
      id:'baseline:'+stamp,
      source:'baseline-match',
      channel:'baseline-match',
      outcome:supporting?'supporting':'clearing',
      confidence:supporting?Math.max(0.6,1-score):Math.max(0.65,score),
      observedAt:stamp,
      roomId:request.roomId,
      data:{classification:context.environment.classification,score}
    });
  }

  if(request.plan.allowedChannels.includes('landmarks') && context.environment?.drift){
    const stamp=Number(context.currentEnvironment?.capturedAt || now);
    const drift=context.environment.drift;
    const supporting=(
      type==='camera-pose-shift'
        ? drift.likelyCameraShift===true
        : Number(drift.structuralDrift || 0)>=0.35
    );
    evidence.push({
      id:'landmarks:'+stamp,
      source:'landmarks',
      channel:'landmarks',
      outcome:supporting?'supporting':'clearing',
      confidence:supporting
        ? clamp01(Math.max(drift.cameraPoseDrift || 0,drift.structuralDrift || 0))
        : 0.72,
      observedAt:stamp,
      roomId:request.roomId,
      data:drift
    });
  }

  if(request.plan.allowedChannels.includes('camera-health') && context.currentEnvironment?.quality){
    const stamp=Number(context.currentEnvironment.capturedAt || now);
    const score=Number(context.currentEnvironment.quality.score || 0);
    evidence.push({
      id:'camera-health:'+stamp,
      source:'camera-health',
      channel:'camera-health',
      outcome:score<0.22?'supporting':'clearing',
      confidence:score<0.22?clamp01(1-score):clamp01(score),
      observedAt:stamp,
      roomId:request.roomId,
      data:context.currentEnvironment.quality
    });
  }

  const object=request.objectId
    ? context.multiRoom?.objects?.[request.objectId]
    : request.subjectId
      ? context.multiRoom?.objects?.[request.subjectId]
      : null;

  if(request.plan.allowedChannels.includes('object-observation') && object){
    const expected=context.expectedLocations?.[object.id] || null;
    const currentTarget=context.currentTargets?.[object.id] || null;
    let supporting=false;
    if(type==='expected-location-deviation'){
      supporting=Boolean(
        expected && (
          (expected.roomId && object.roomId!==expected.roomId) ||
          (expected.anchorId && currentTarget && currentTarget!==expected.anchorId)
        )
      );
    }else if(type==='expected-object-missing'){
      supporting=['last-known','absent'].includes(object.presence);
    }else if(type==='new-object-presence'){
      supporting=object.presence==='confirmed';
    }
    evidence.push({
      id:'object:'+object.id+':'+String(object.lastObservedAt || now),
      source:'object-observation',
      channel:'object-observation',
      outcome:supporting?'supporting':'clearing',
      confidence:Number(object.confidence || 0.6),
      observedAt:object.lastObservedAt || now,
      roomId:object.roomId,
      data:{presence:object.presence,currentTarget,expected}
    });
  }

  if(request.plan.allowedChannels.includes('room-visibility')){
    const localId=object?.localRoomObjectId || request.objectId || request.subjectId;
    const visibility=context.roomVisibility?.[request.roomId]?.objects?.[localId];
    if(visibility){
      const supporting=visibility.state==='missing-unexpected';
      evidence.push({
        id:'visibility:'+String(localId)+':'+String(context.visibilityUpdatedAt || now),
        source:'room-visibility',
        channel:'room-visibility',
        outcome:supporting?'supporting':'clearing',
        confidence:Number(visibility.confidence || 0.7),
        observedAt:context.visibilityUpdatedAt || now,
        roomId:request.roomId,
        data:visibility
      });
    }
  }

  if(request.plan.allowedChannels.includes('same-room-cameras') && object){
    for(const cameraId of object.cameraIds || []){
      evidence.push({
        id:'camera-object:'+cameraId+':'+object.id+':'+String(object.lastObservedAt || now),
        source:'camera:'+cameraId,
        channel:'same-room-cameras',
        outcome:object.presence==='confirmed'?'supporting':'neutral',
        confidence:Number(object.confidence || 0.6),
        observedAt:object.lastObservedAt || now,
        cameraId,
        roomId:object.roomId,
        data:{objectId:object.id}
      });
    }
  }

  if(request.plan.allowedChannels.includes('scene-change')){
    for(const change of context.sceneChanges || []){
      if(
        change.objectId &&
        (change.objectId===request.objectId || change.objectId===request.subjectId)
      ){
        evidence.push({
          id:'scene-change:'+String(change.id || change.timestamp),
          source:'scene-change',
          channel:'scene-change',
          outcome:change.type==='object.appeared'?'supporting':'neutral',
          confidence:Number(change.confidence || 0.6),
          observedAt:change.timestamp || now,
          roomId:request.roomId,
          data:change
        });
      }
    }
  }

  return evidence;
}

export function verificationSnapshot(state) {
  return JSON.parse(JSON.stringify({
    schemaVersion:state.schemaVersion,
    updatedAt:state.updatedAt,
    requests:Object.values(state.requests),
    history:state.history.slice(-100),
    stats:state.stats
  }));
}
