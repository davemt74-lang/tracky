const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const arr=(v)=>Array.isArray(v)?v:[];
const txt=(v,max=180)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const GOAL_TYPES=new Set(['standing-expectation','routine']);
const EXPECTATION_KINDS=new Set(['entity-in-room','entity-at-anchor','room-empty']);
const TRIGGER_KINDS=new Set(['manual','entity-enters-room','entity-leaves-room']);

export const PHYSICAL_GOAL_SCHEMA_VERSION=1;
export const PHYSICAL_GOAL_TYPES=Object.freeze([...GOAL_TYPES]);
export const PHYSICAL_EXPECTATION_KINDS=Object.freeze([...EXPECTATION_KINDS]);
export const PHYSICAL_ROUTINE_TRIGGER_KINDS=Object.freeze([...TRIGGER_KINDS]);

function id(prefix,now=Date.now()){
  return prefix+'-'+Number(now)+'-'+Math.random().toString(36).slice(2,7);
}
function entityKey(item){
  return String(item?.participantId||item?.objectId||item?.subjectId||item?.id||'');
}
function entityLabel(item){
  return txt(item?.label||item?.name||item?.participantName||item?.objectLabel||'',80);
}
function semanticEntities(context={}){
  return [...arr(context.people),...arr(context.objects)];
}
function matchingEntities(context,condition){
  const list=semanticEntities(context).filter((item)=>{
    if(!condition.subjectKind) return true;
    if(condition.subjectKind==='person') return Boolean(item.participantId);
    if(condition.subjectKind==='object') return Boolean(item.objectId);
    return true;
  });
  if(condition.subjectId) return list.filter((item)=>entityKey(item)===condition.subjectId);
  if(condition.subjectLabel){
    const q=String(condition.subjectLabel).toLowerCase();
    const matches=list.filter((item)=>entityLabel(item).toLowerCase()===q);
    return matches.length===1?matches:[];
  }
  return [];
}
function confidenceOf(item){return clamp01(item?.confidence??1);}

export function normalizePhysicalExpectation(input={}){
  const kind=EXPECTATION_KINDS.has(String(input.kind))?String(input.kind):'entity-in-room';
  return {
    kind,
    subjectId:txt(input.subjectId||'',120)||null,
    subjectLabel:txt(input.subjectLabel||'',80)||null,
    subjectKind:['person','object'].includes(String(input.subjectKind||''))?String(input.subjectKind):null,
    roomId:txt(input.roomId||'',120)||null,
    anchorId:txt(input.anchorId||'',120)||null,
    anchorLabel:txt(input.anchorLabel||'',100)||null
  };
}

export function normalizeRoutineTrigger(input={}){
  const kind=TRIGGER_KINDS.has(String(input.kind))?String(input.kind):'manual';
  return {
    kind,
    subjectId:txt(input.subjectId||'',120)||null,
    subjectLabel:txt(input.subjectLabel||'',80)||null,
    subjectKind:['person','object'].includes(String(input.subjectKind||''))?String(input.subjectKind):null,
    roomId:txt(input.roomId||'',120)||null
  };
}

export function normalizePhysicalGoal(input={},now=Date.now()){
  const type=GOAL_TYPES.has(String(input.type))?String(input.type):'standing-expectation';
  const expectations=arr(input.expectations||input.checks)
    .slice(0,12)
    .map(normalizePhysicalExpectation);
  if(!expectations.length&&input.expectation) expectations.push(normalizePhysicalExpectation(input.expectation));
  return {
    schemaVersion:PHYSICAL_GOAL_SCHEMA_VERSION,
    id:txt(input.id||id('GOAL',now),120),
    type,
    label:txt(input.label||input.summary||type,160),
    enabled:input.enabled!==false,
    severity:['info','low','medium','high'].includes(String(input.severity))?String(input.severity):'medium',
    expectations,
    trigger:type==='routine'?normalizeRoutineTrigger(input.trigger||{}):null,
    notifyOnSuccess:input.notifyOnSuccess===true,
    cooldownMs:Math.max(0,Math.min(86400000,Number(input.cooldownMs??30000)||0)),
    createdAt:Number(input.createdAt||now),
    lastEvaluatedAt:Number(input.lastEvaluatedAt||0)||null,
    lastTriggeredAt:Number(input.lastTriggeredAt||0)||null,
    lastState:['met','violated','unknown','needs-attention'].includes(String(input.lastState))?String(input.lastState):null
  };
}

export function evaluatePhysicalExpectation(input={},context={},now=Date.now()){
  const condition=normalizePhysicalExpectation(input);
  if(condition.kind==='room-empty'){
    if(!condition.roomId) return {state:'unknown',summary:'Room is not resolved.',confidence:0,evidence:{roomId:null}};
    const occupants=arr(context.people).filter((person)=>(
      person.roomId===condition.roomId &&
      ['confirmed','transitioning'].includes(String(person.presence||'confirmed'))
    ));
    if(occupants.length){
      return {
        state:'violated',
        summary:String(occupants.length)+' '+(occupants.length===1?'person remains':'people remain')+' in the room.',
        confidence:Math.min(...occupants.map(confidenceOf)),
        evidence:{roomId:condition.roomId,occupantIds:occupants.map(entityKey).filter(Boolean)}
      };
    }
    if(context.roomObservability?.[condition.roomId]!==true){
      return {
        state:'unknown',
        summary:'The room cannot be verified empty with current privacy and camera coverage.',
        confidence:clamp01(context.roomCoverageConfidence?.[condition.roomId]||0),
        evidence:{roomId:condition.roomId,occupantIds:[],coverageConfidence:clamp01(context.roomCoverageConfidence?.[condition.roomId]||0)}
      };
    }
    return {
      state:'met',
      summary:'The room is verified empty under current camera coverage.',
      confidence:clamp01(context.roomCoverageConfidence?.[condition.roomId]??1),
      evidence:{roomId:condition.roomId,occupantIds:[],coverageConfidence:clamp01(context.roomCoverageConfidence?.[condition.roomId]??1)}
    };
  }

  const matches=matchingEntities(context,condition);
  if(matches.length!==1){
    return {state:'unknown',summary:'The expected entity is not uniquely confirmed.',confidence:0,evidence:{subjectId:condition.subjectId||null,roomId:condition.roomId||null,anchorId:condition.anchorId||null}};
  }
  const entity=matches[0];
  const presence=String(entity.presence||'confirmed');
  if(!['confirmed','transitioning'].includes(presence)){
    return {state:'unknown',summary:(entityLabel(entity)||'Entity')+' is not currently confirmed.',confidence:confidenceOf(entity),evidence:{subjectId:entityKey(entity),roomId:entity.roomId||null,anchorId:null}};
  }

  if(condition.kind==='entity-in-room'){
    if(!condition.roomId) return {state:'unknown',summary:'Expected room is not resolved.',confidence:0,evidence:{subjectId:entityKey(entity),roomId:null}};
    const met=entity.roomId===condition.roomId;
    return {
      state:met?'met':'violated',
      summary:(entityLabel(entity)||'Entity')+(met?' is in the expected room.':' is outside the expected room.'),
      confidence:confidenceOf(entity),
      evidence:{subjectId:entityKey(entity),roomId:entity.roomId||null,expectedRoomId:condition.roomId}
    };
  }

  if(condition.kind==='entity-at-anchor'){
    if(!condition.anchorId) return {state:'unknown',summary:'Expected anchor is not resolved.',confidence:0,evidence:{subjectId:entityKey(entity),anchorId:null}};
    const currentAnchor=context.currentAnchors?.[entityKey(entity)]||null;
    if(!currentAnchor){
      return {state:'unknown',summary:'The current anchor for '+(entityLabel(entity)||'the entity')+' is not confirmed.',confidence:confidenceOf(entity),evidence:{subjectId:entityKey(entity),anchorId:null,expectedAnchorId:condition.anchorId}};
    }
    const met=currentAnchor.anchorId===condition.anchorId;
    return {
      state:met?'met':'violated',
      summary:(entityLabel(entity)||'Entity')+(met?' is at the expected place.':' is away from the expected place.'),
      confidence:Math.min(confidenceOf(entity),clamp01(currentAnchor.confidence??1)),
      evidence:{subjectId:entityKey(entity),roomId:entity.roomId||currentAnchor.roomId||null,anchorId:currentAnchor.anchorId,expectedAnchorId:condition.anchorId}
    };
  }

  return {state:'unknown',summary:'Expectation could not be evaluated.',confidence:0,evidence:{}};
}

function triggerMatches(trigger,previous={},current={}){
  if(trigger.kind==='manual') return null;
  const before=matchingEntities(previous,trigger)[0]||null;
  const after=matchingEntities(current,trigger)[0]||null;
  if(trigger.kind==='entity-leaves-room'&&before&&before.roomId===trigger.roomId&&(!after||after.roomId!==trigger.roomId)){
    return {subject:before,roomId:trigger.roomId,kind:trigger.kind};
  }
  if(trigger.kind==='entity-enters-room'&&after&&after.roomId===trigger.roomId&&(!before||before.roomId!==trigger.roomId)){
    return {subject:after,roomId:trigger.roomId,kind:trigger.kind};
  }
  return null;
}

function event(goal,type,state,summary,now,evidence={},checks=[]){
  return {
    id:id('GOAL-EVENT',now),
    goalId:goal.id,
    goalType:goal.type,
    type,
    state,
    severity:goal.severity,
    summary:txt(summary,320),
    generatedAt:now,
    confidence:checks.length?Math.min(...checks.map((item)=>clamp01(item.confidence))):clamp01(evidence.confidence??1),
    evidence,
    checks:checks.map((item)=>({state:item.state,summary:txt(item.summary,220),confidence:clamp01(item.confidence),evidence:item.evidence||{}})),
    briefingEligible:type==='expectation-violated'||type==='routine-needs-attention'||(type==='routine-complete'&&goal.notifyOnSuccess),
    boundaries:['semantic-goal-only','privacy-governed-context','no-autonomous-physical-control']
  };
}

function cooldownReady(goal,now){
  return !goal.lastTriggeredAt||now-Number(goal.lastTriggeredAt)>=Number(goal.cooldownMs||0);
}

export function evaluatePhysicalGoal(input,previous={},current={},now=Date.now(),options={}){
  const goal=normalizePhysicalGoal(input,now);
  goal.lastEvaluatedAt=now;
  if(!goal.enabled) return {goal,events:[]};

  if(goal.type==='standing-expectation'){
    const check=evaluatePhysicalExpectation(goal.expectations[0]||{},current,now);
    const prior=goal.lastState;
    goal.lastState=check.state;
    const events=[];
    if(check.state==='violated'&&prior!=='violated'&&cooldownReady(goal,now)){
      goal.lastTriggeredAt=now;
      events.push(event(goal,'expectation-violated','violated',goal.label+': '+check.summary,now,check.evidence,[check]));
    }else if(check.state==='met'&&prior==='violated'){
      goal.lastTriggeredAt=now;
      events.push(event(goal,'expectation-restored','met',goal.label+': expectation restored.',now,check.evidence,[check]));
    }
    return {goal,events};
  }

  if (options.suppressRoutineTriggers === true && options.manual !== true) {
    return {goal,events:[]};
  }
  const trigger=options.manual===true?{kind:'manual',roomId:null,subject:null}:triggerMatches(goal.trigger||{},previous,current);
  if(!trigger||!cooldownReady(goal,now)) return {goal,events:[]};
  goal.lastTriggeredAt=now;
  const checks=goal.expectations.map((item)=>evaluatePhysicalExpectation(item,current,now));
  const violated=checks.filter((item)=>item.state==='violated');
  const unknown=checks.filter((item)=>item.state==='unknown');
  const state=violated.length?'needs-attention':unknown.length?'unknown':'met';
  goal.lastState=state;
  const type=state==='needs-attention'?'routine-needs-attention':state==='met'?'routine-complete':'routine-unknown';
  const summary=state==='needs-attention'
    ? goal.label+': '+String(violated.length)+' '+(violated.length===1?'check needs':'checks need')+' attention.'
    : state==='met'
      ? goal.label+': all checks are satisfied.'
      : goal.label+': some checks could not be verified.';
  return {goal,events:[event(goal,type,state,summary,now,{triggerKind:trigger.kind,triggerRoomId:trigger.roomId||null,triggerSubjectId:trigger.subject?entityKey(trigger.subject):null},checks)]};
}

export function evaluatePhysicalGoals(goals=[],previous={},current={},now=Date.now(),options={}){
  const updated=[];
  const events=[];
  for(const item of arr(goals)){
    const result=evaluatePhysicalGoal(item,previous,current,now,options);
    updated.push(result.goal);
    events.push(...result.events);
  }
  return {goals:updated,events};
}
