import {
  normalizeRoutineSequence,
  semanticTransition,
  routineSequenceStepKey
} from './routine-sequence-core.js';

const arr=(v)=>Array.isArray(v)?v:[];
const txt=(v,max=180)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const MIN_SEQUENCE_OCCURRENCES=4;
const MIN_SEQUENCE_SESSIONS=3;
const MIN_LOCATION_OBSERVATIONS=8;
const MIN_LOCATION_SESSIONS=3;
const LOCATION_EVIDENCE_INTERVAL_MS=15*60*1000;
const RECENT_SEQUENCE_WINDOW_MS=20*60*1000;

export const ROUTINE_LEARNING_SCHEMA_VERSION=1;
export const ROUTINE_LEARNING_PROPOSAL_TYPES=Object.freeze(['sequence-routine','temporal-location']);

export function createRoutineLearningState(){
  return {
    schemaVersion:ROUTINE_LEARNING_SCHEMA_VERSION,
    updatedAt:Date.now(),
    sequences:{},
    temporalLocations:{},
    proposals:[],
    ignoredProposalKeys:{},
    recentBySubject:{},
    lastLocationEvidenceAt:{}
  };
}

export function hydrateRoutineLearningState(input={}){
  const base=createRoutineLearningState();
  return {
    ...base,
    ...(input&&typeof input==='object'?input:{}),
    sequences:{...(input?.sequences||{})},
    temporalLocations:{...(input?.temporalLocations||{})},
    proposals:arr(input?.proposals).map((item)=>({...item})),
    ignoredProposalKeys:{...(input?.ignoredProposalKeys||{})},
    recentBySubject:{...(input?.recentBySubject||{})},
    lastLocationEvidenceAt:{...(input?.lastLocationEvidenceAt||{})}
  };
}

function proposalByKey(state,key){
  return arr(state.proposals).find((item)=>item.key===key)||null;
}
function upsertProposal(state,input,now){
  const key=String(input.key);
  if(state.ignoredProposalKeys?.[key]) return {proposal:null,isNew:false};
  const existing=proposalByKey(state,key);
  if(existing){
    Object.assign(existing,input,{
      id:existing.id,
      key,
      status:existing.status||'proposed',
      createdAt:existing.createdAt||now,
      updatedAt:now
    });
    return {proposal:existing,isNew:false};
  }
  const proposal={
    id:'ROUTINE-PROP-'+now+'-'+Math.random().toString(36).slice(2,7),
    key,
    status:'proposed',
    createdAt:now,
    updatedAt:now,
    ...input
  };
  state.proposals.push(proposal);
  if(state.proposals.length>100) state.proposals.splice(0,state.proposals.length-100);
  return {proposal,isNew:true};
}
function sessionCount(sessions){return Object.keys(sessions||{}).length;}
function average(sum,count){return count?Number(sum||0)/count:0;}
function subjectKey(t){return [t.kind,t.subjectId].join(':');}
function sequencePatternKey(steps){
  return steps.map(routineSequenceStepKey).join('>');
}
function sequenceLabel(steps){
  if(!steps.length) return 'Learned physical routine';
  const subject=steps[0].subjectLabel||steps[0].subjectId||'Entity';
  const rooms=[steps[0].fromRoomId,...steps.map((step)=>step.toRoomId)].filter(Boolean);
  return subject+' routine: '+rooms.join(' → ');
}
function recordSequencePattern(state,steps,sessionId,confidence,now,newProposals){
  if(steps.length<2) return;
  const patternKey=sequencePatternKey(steps);
  if(!state.sequences[patternKey]){
    state.sequences[patternKey]={
      key:patternKey,
      steps:steps.map((step)=>({...step})),
      occurrences:0,
      sessions:{},
      confidenceSum:0,
      firstObservedAt:now,
      lastObservedAt:now
    };
  }
  const pattern=state.sequences[patternKey];
  pattern.occurrences+=1;
  pattern.sessions[sessionId||'session']=true;
  pattern.confidenceSum+=clamp01(confidence);
  pattern.lastObservedAt=now;

  const sessions=sessionCount(pattern.sessions);
  const avg=average(pattern.confidenceSum,pattern.occurrences);
  if(pattern.occurrences<MIN_SEQUENCE_OCCURRENCES||sessions<MIN_SEQUENCE_SESSIONS||avg<0.75) return;

  const key='sequence-routine::'+patternKey;
  const {proposal,isNew}=upsertProposal(state,{
    key,
    type:'sequence-routine',
    label:sequenceLabel(pattern.steps),
    confidence:clamp01(avg*0.8+Math.min(1,pattern.occurrences/8)*0.12+Math.min(1,sessions/5)*0.08),
    sequence:normalizeRoutineSequence({steps:pattern.steps,maxGapMs:15*60*1000}),
    evidence:{
      occurrences:pattern.occurrences,
      sessions,
      averageConfidence:avg,
      firstObservedAt:pattern.firstObservedAt,
      lastObservedAt:pattern.lastObservedAt
    },
    boundaries:['proposal-only','requires-user-confirmation','semantic-transition-evidence','no-autonomous-physical-control']
  },now);
  if(isNew&&proposal) newProposals.push(proposal);
}

export function observeRoutineTransitions(stateInput,events=[],sessionId='session',now=Date.now()){
  const state=hydrateRoutineLearningState(stateInput||{});
  const newProposals=[];
  for(const raw of arr(events)){
    const transition=semanticTransition(raw);
    if(!transition||transition.confidence<0.7) continue;
    const key=subjectKey(transition);
    const recentRecord=state.recentBySubject[key]||{sessionId:null,events:[]};
    const sameSession=recentRecord.sessionId===sessionId;
    const recent=sameSession
      ? arr(recentRecord.events).filter((item)=>now-Number(item.timestamp||0)<=RECENT_SEQUENCE_WINDOW_MS)
      : [];
    if(
      transition.sourceEventId &&
      recent.some((item)=>item.sourceEventId===transition.sourceEventId)
    ) continue;
    recent.push(transition);
    if(recent.length>6) recent.splice(0,recent.length-6);
    state.recentBySubject[key]={sessionId,events:recent};

    for(const length of [2,3]){
      if(recent.length<length) continue;
      const steps=recent.slice(-length);
      const confidence=Math.min(...steps.map((step)=>step.confidence));
      recordSequencePattern(state,steps,sessionId,confidence,now,newProposals);
    }
  }
  const keys=Object.keys(state.sequences);
  if(keys.length>240){
    keys.sort((a,b)=>Number(state.sequences[a].lastObservedAt||0)-Number(state.sequences[b].lastObservedAt||0))
      .slice(0,keys.length-240)
      .forEach((key)=>delete state.sequences[key]);
  }
  state.updatedAt=now;
  return {state,newProposals};
}

function dayClass(date){return [0,6].includes(date.getDay())?'weekend':'weekday';}
function timeBucket(date){
  const hour=date.getHours();
  if(hour>=6&&hour<12) return 'morning';
  if(hour>=12&&hour<17) return 'afternoon';
  if(hour>=17&&hour<22) return 'evening';
  return 'overnight';
}
function entityId(entity){return String(entity?.participantId||entity?.objectId||entity?.id||'');}
function entityLabel(entity){return txt(entity?.label||entity?.name||entity?.participantName||entity?.objectLabel||entityId(entity),100);}
function entityKind(entity){return entity?.participantId?'person':entity?.objectId?'object':null;}
function temporalGroupKey(entity,day,bucket){
  return [entityKind(entity),entityId(entity),day,bucket].join('::');
}
function targetFor(entity,context){
  const id=entityId(entity);
  const anchor=context.currentAnchors?.[id]||null;
  if(anchor?.anchorId){
    return {
      targetId:'ANCHOR:'+anchor.anchorId,
      roomId:anchor.roomId||entity.roomId||null,
      anchorId:anchor.anchorId,
      anchorLabel:anchor.anchorLabel||anchor.anchorId
    };
  }
  if(entity.roomId){
    return {targetId:'ROOM:'+entity.roomId,roomId:entity.roomId,anchorId:null,anchorLabel:null};
  }
  return null;
}
function bucketWindow(bucket){
  if(bucket==='morning') return {startMinute:360,endMinute:719};
  if(bucket==='afternoon') return {startMinute:720,endMinute:1019};
  if(bucket==='evening') return {startMinute:1020,endMinute:1319};
  return {startMinute:1320,endMinute:359};
}
function daysForClass(value){return value==='weekend'?[0,6]:[1,2,3,4,5];}

function maybeTemporalLocationProposal(state,group,now,newProposals){
  const candidates=Object.values(group.candidates||{}).sort((a,b)=>b.observations-a.observations);
  const best=candidates[0];
  if(!best||group.totalObservations<MIN_LOCATION_OBSERVATIONS) return;
  const sessions=sessionCount(group.sessions);
  const share=best.observations/group.totalObservations;
  const avg=average(best.confidenceSum,best.observations);
  if(sessions<MIN_LOCATION_SESSIONS||share<0.75||avg<0.75) return;

  const key='temporal-location::'+group.key+'::'+best.targetId;
  const window=bucketWindow(group.timeBucket);
  const {proposal,isNew}=upsertProposal(state,{
    key,
    type:'temporal-location',
    label:group.subjectLabel+' is usually '+(best.anchorLabel?'by '+best.anchorLabel:'in '+best.roomId)+' on '+group.dayClass+' '+group.timeBucket+'s',
    confidence:clamp01(avg*0.7+share*0.2+Math.min(1,sessions/5)*0.1),
    subjectId:group.subjectId,
    subjectLabel:group.subjectLabel,
    subjectKind:group.subjectKind,
    roomId:best.roomId,
    anchorId:best.anchorId,
    anchorLabel:best.anchorLabel,
    temporalPolicy:{
      schemaVersion:1,mode:'window',days:daysForClass(group.dayClass),
      startMinute:window.startMinute,endMinute:window.endMinute,
      deadlineMinute:null,graceMs:0,clock:'local',source:'learned-confirmed'
    },
    evidence:{
      observations:best.observations,
      totalObservations:group.totalObservations,
      sessions,
      dominance:share,
      averageConfidence:avg,
      firstObservedAt:group.firstObservedAt,
      lastObservedAt:group.lastObservedAt
    },
    boundaries:['proposal-only','requires-user-confirmation','privacy-governed-context','no-autonomous-physical-control']
  },now);
  if(isNew&&proposal) newProposals.push(proposal);
}

export function observeTemporalLocations(stateInput,context={},sessionId='session',now=Date.now()){
  const state=hydrateRoutineLearningState(stateInput||{});
  const newProposals=[];
  const date=new Date(now);
  const dc=dayClass(date);
  const bucket=timeBucket(date);
  for(const entity of [...arr(context.people),...arr(context.objects)]){
    if(!['confirmed','transitioning'].includes(String(entity.presence||'confirmed'))) continue;
    const id=entityId(entity);
    if(!id||clamp01(entity.confidence??1)<0.7) continue;
    const target=targetFor(entity,context);
    if(!target) continue;

    const groupKey=temporalGroupKey(entity,dc,bucket);
    const evidenceKey=groupKey+'::'+target.targetId;
    if(
      state.lastLocationEvidenceAt[evidenceKey] &&
      now-Number(state.lastLocationEvidenceAt[evidenceKey])<LOCATION_EVIDENCE_INTERVAL_MS
    ) continue;
    state.lastLocationEvidenceAt[evidenceKey]=now;

    if(!state.temporalLocations[groupKey]){
      state.temporalLocations[groupKey]={
        key:groupKey,
        subjectId:id,
        subjectLabel:entityLabel(entity),
        subjectKind:entityKind(entity),
        dayClass:dc,
        timeBucket:bucket,
        totalObservations:0,
        sessions:{},
        candidates:{},
        firstObservedAt:now,
        lastObservedAt:now
      };
    }
    const group=state.temporalLocations[groupKey];
    group.totalObservations+=1;
    group.sessions[sessionId||'session']=true;
    group.lastObservedAt=now;
    if(!group.candidates[target.targetId]){
      group.candidates[target.targetId]={
        ...target,
        observations:0,
        confidenceSum:0,
        sessions:{},
        firstObservedAt:now,
        lastObservedAt:now
      };
    }
    const candidate=group.candidates[target.targetId];
    candidate.observations+=1;
    candidate.confidenceSum+=clamp01(entity.confidence??1);
    candidate.sessions[sessionId||'session']=true;
    candidate.lastObservedAt=now;
    maybeTemporalLocationProposal(state,group,now,newProposals);
  }
  const groups=Object.keys(state.temporalLocations);
  if(groups.length>240){
    groups.sort((a,b)=>Number(state.temporalLocations[a].lastObservedAt||0)-Number(state.temporalLocations[b].lastObservedAt||0))
      .slice(0,groups.length-240)
      .forEach((key)=>delete state.temporalLocations[key]);
  }
  state.updatedAt=now;
  return {state,newProposals};
}

export function confirmRoutineLearningProposal(state,id,now=Date.now()){
  const proposal=arr(state?.proposals).find((item)=>item.id===id||item.key===id);
  if(!proposal||proposal.status!=='proposed') return null;
  proposal.status='confirmed';
  proposal.resolvedAt=now;
  proposal.updatedAt=now;
  state.updatedAt=now;
  return proposal;
}
export function ignoreRoutineLearningProposal(state,id,now=Date.now()){
  const proposal=arr(state?.proposals).find((item)=>item.id===id||item.key===id);
  if(!proposal) return null;
  proposal.status='ignored';
  proposal.resolvedAt=now;
  proposal.updatedAt=now;
  state.ignoredProposalKeys[proposal.key]=now;
  state.updatedAt=now;
  return proposal;
}
export function routineLearningProposals(state,status='proposed'){
  return arr(state?.proposals)
    .filter((item)=>!status||item.status===status)
    .sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
}

export function proposalToPhysicalGoal(proposal={},now=Date.now()){
  if(proposal.type==='sequence-routine'){
    return {
      type:'routine',
      label:txt(proposal.label||'Learned physical routine',160),
      severity:'medium',
      enabled:true,
      trigger:{kind:'manual'},
      checks:[],
      cooldownMs:30000,
      notifyOnSuccess:false,
      sequence:{...proposal.sequence,sourceProposalId:proposal.id},
      origin:'learned-confirmed',
      createdAt:now
    };
  }
  if(proposal.type==='temporal-location'){
    const expectation=proposal.anchorId
      ? {
          kind:'entity-at-anchor',subjectId:proposal.subjectId,subjectLabel:proposal.subjectLabel,
          subjectKind:proposal.subjectKind,roomId:proposal.roomId,anchorId:proposal.anchorId,anchorLabel:proposal.anchorLabel
        }
      : {
          kind:'entity-in-room',subjectId:proposal.subjectId,subjectLabel:proposal.subjectLabel,
          subjectKind:proposal.subjectKind,roomId:proposal.roomId
        };
    return {
      type:'standing-expectation',
      label:txt(proposal.label||'Learned temporal location',160),
      severity:'medium',
      enabled:true,
      expectation,
      temporalPolicy:{...(proposal.temporalPolicy||{}),source:'learned-confirmed'},
      cooldownMs:30000,
      origin:'learned-confirmed',
      createdAt:now
    };
  }
  return null;
}

export function routineLearningSnapshot(state){
  const value=state||createRoutineLearningState();
  return JSON.parse(JSON.stringify({
    schemaVersion:value.schemaVersion,
    updatedAt:value.updatedAt,
    sequences:value.sequences,
    temporalLocations:value.temporalLocations,
    proposals:value.proposals,
    ignoredProposalKeys:value.ignoredProposalKeys
  }));
}
