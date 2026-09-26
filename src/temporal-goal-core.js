import {
  buildPhysicalGoalEvent,
  evaluatePhysicalExpectation,
  evaluatePhysicalGoal,
  normalizePhysicalGoal
} from './physical-goal-core.js';

const arr=(v)=>Array.isArray(v)?v:[];
const clamp=(v,min,max,fallback=0)=>{
  const n=Number(v);
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
};
const txt=(v,max=160)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);

export const TEMPORAL_POLICY_SCHEMA_VERSION=1;
export const TEMPORAL_POLICY_MODES=Object.freeze(['always','window','deadline']);

export function normalizeTemporalPolicy(input={}){
  const mode=TEMPORAL_POLICY_MODES.includes(String(input?.mode))?String(input.mode):'always';
  const days=Array.isArray(input?.days)
    ? [...new Set(input.days.map(Number).filter((day)=>Number.isInteger(day)&&day>=0&&day<=6))].sort((a,b)=>a-b)
    : [];
  const minute=(value)=>{
    if(value==null||value==='') return null;
    const n=Number(value);
    return Number.isFinite(n)?Math.round(clamp(n,0,1439,0)):null;
  };
  return {
    schemaVersion:TEMPORAL_POLICY_SCHEMA_VERSION,
    mode,
    days,
    startMinute:minute(input?.startMinute),
    endMinute:minute(input?.endMinute),
    deadlineMinute:minute(input?.deadlineMinute),
    graceMs:Math.round(clamp(input?.graceMs,0,86400000,0)),
    clock:'local',
    source:['user','learned-confirmed'].includes(String(input?.source))?String(input.source):'user'
  };
}

function localDayKey(date){
  return [
    date.getFullYear(),
    String(date.getMonth()+1).padStart(2,'0'),
    String(date.getDate()).padStart(2,'0')
  ].join('-');
}
function previousLocalDay(date){
  const copy=new Date(date.getTime());
  copy.setDate(copy.getDate()-1);
  return copy;
}
function dayAllowed(policy,day){
  return !policy.days.length||policy.days.includes(day);
}

export function temporalPolicyStatus(input={},now=Date.now()){
  const policy=normalizeTemporalPolicy(input);
  const date=new Date(now);
  const minute=date.getHours()*60+date.getMinutes();
  const day=date.getDay();
  const todayKey=localDayKey(date);

  if(policy.mode==='always'){
    return {active:true,phase:'active',windowKey:'always',minute,day,policy};
  }

  if(policy.mode==='deadline'){
    const deadline=policy.deadlineMinute??0;
    const allowed=dayAllowed(policy,day);
    return {
      active:allowed&&minute>=deadline,
      phase:!allowed?'off-day':minute>=deadline?'due':'before-deadline',
      windowKey:allowed?todayKey+':deadline:'+deadline:null,
      minute,day,policy
    };
  }

  const start=policy.startMinute??0;
  const end=policy.endMinute??1439;
  if(start<=end){
    const allowed=dayAllowed(policy,day);
    const active=allowed&&minute>=start&&minute<=end;
    return {
      active,
      phase:!allowed?'off-day':active?'active':'outside-window',
      windowKey:allowed?todayKey+':window:'+start+'-'+end:null,
      minute,day,policy
    };
  }

  const prev=previousLocalDay(date);
  const afterStart=dayAllowed(policy,day)&&minute>=start;
  const beforeEnd=dayAllowed(policy,prev.getDay())&&minute<=end;
  return {
    active:afterStart||beforeEnd,
    phase:(afterStart||beforeEnd)?'active':'outside-window',
    windowKey:afterStart
      ? todayKey+':window:'+start+'-'+end
      : beforeEnd
        ? localDayKey(prev)+':window:'+start+'-'+end
        : null,
    minute,day,policy
  };
}

function freshTemporalState(goal,status){
  const current=goal.temporalState||{};
  if(current.windowKey===status.windowKey) return {...current};
  return {
    windowKey:status.windowKey,
    pendingViolationSince:null,
    violationNotifiedAt:null,
    restoredAt:null,
    pendingRoutineSince:null,
    pendingRoutineEvidence:null,
    lastTemporalState:status.active?'active':'inactive'
  };
}

function temporalEvent(goal,type,state,summary,now,evidence={},checks=[]){
  const event=buildPhysicalGoalEvent(goal,type,state,summary,now,evidence,checks);
  event.briefingEligible=[
    'expected-window-missed',
    'persistent-goal-violation',
    'persistent-routine-deviation',
    'routine-step-skipped',
    'sequence-window-missed'
  ].includes(type)||event.briefingEligible;
  event.temporalReason=type;
  event.provenance=['physical-world-goal','temporal-policy','governed-agent-context'];
  return event;
}

function evaluateStanding(goal,current,status,now){
  const temporalState=freshTemporalState(goal,status);
  goal.temporalState=temporalState;
  goal.lastEvaluatedAt=now;
  if(!status.active){
    temporalState.pendingViolationSince=null;
    temporalState.lastTemporalState='inactive';
    return {goal,events:[]};
  }

  const check=evaluatePhysicalExpectation(goal.expectations[0]||{},current,now);
  const priorState=goal.lastState;
  goal.lastState=check.state;
  temporalState.lastTemporalState=check.state;

  if(check.state==='unknown'){
    temporalState.pendingViolationSince=null;
    temporalState.violationNotifiedAt=null;
    return {goal,events:[]};
  }

  if(check.state==='met'){
    temporalState.pendingViolationSince=null;
    const events=[];
    if(temporalState.violationNotifiedAt){
      temporalState.restoredAt=now;
      events.push(temporalEvent(
        goal,
        'temporal-expectation-restored',
        'met',
        goal.label+': expectation restored.',
        now,
        check.evidence,
        [check]
      ));
      temporalState.violationNotifiedAt=null;
      goal.lastTriggeredAt=now;
    }
    return {goal,events};
  }

  if(!temporalState.pendingViolationSince) temporalState.pendingViolationSince=now;
  const due=now-Number(temporalState.pendingViolationSince)>=status.policy.graceMs;
  if(!due||temporalState.violationNotifiedAt) return {goal,events:[]};

  temporalState.violationNotifiedAt=now;
  goal.lastTriggeredAt=now;
  const type=status.policy.mode==='deadline'?'expected-window-missed':'persistent-goal-violation';
  const prefix=status.policy.mode==='deadline'
    ? goal.label+': expected condition was not met by the deadline. '
    : goal.label+': expected condition remained unmet. ';
  return {
    goal,
    events:[temporalEvent(goal,type,'violated',prefix+check.summary,now,{
      ...check.evidence,
      temporalMode:status.policy.mode,
      graceMs:status.policy.graceMs,
      windowKey:status.windowKey
    },[check])]
  };
}

function evaluateRoutineChecks(goal,current,now,triggerEvidence={}){
  const checks=goal.expectations.map((item)=>evaluatePhysicalExpectation(item,current,now));
  const violated=checks.filter((item)=>item.state==='violated');
  const unknown=checks.filter((item)=>item.state==='unknown');
  const state=violated.length?'needs-attention':unknown.length?'unknown':'met';
  goal.lastState=state;
  let type='routine-complete';
  let summary=goal.label+': all checks are satisfied.';
  if(state==='needs-attention'){
    type='persistent-routine-deviation';
    summary=goal.label+': '+violated.length+' '+(violated.length===1?'check still needs':'checks still need')+' attention after the grace period.';
  }else if(state==='unknown'){
    type='routine-unknown';
    summary=goal.label+': some checks could not be verified after the grace period.';
  }
  return {
    goal,
    event:temporalEvent(goal,type,state,summary,now,triggerEvidence,checks)
  };
}

function evaluateRoutine(goal,previous,current,status,now,options){
  const temporalState=freshTemporalState(goal,status);
  goal.temporalState=temporalState;
  goal.lastEvaluatedAt=now;

  if(!status.active){
    temporalState.pendingRoutineSince=null;
    temporalState.pendingRoutineEvidence=null;
    temporalState.lastTemporalState='inactive';
    return {goal,events:[]};
  }
  temporalState.lastTemporalState='active';

  if(temporalState.pendingRoutineSince){
    if(now-Number(temporalState.pendingRoutineSince)<status.policy.graceMs){
      return {goal,events:[]};
    }
    const evaluated=evaluateRoutineChecks(
      goal,
      current,
      now,
      temporalState.pendingRoutineEvidence||{}
    );
    temporalState.pendingRoutineSince=null;
    temporalState.pendingRoutineEvidence=null;
    if(evaluated.event.type==='routine-complete'&&!goal.notifyOnSuccess) return {goal,events:[]};
    if(evaluated.event.type==='routine-unknown') return {goal,events:[evaluated.event]};
    goal.lastTriggeredAt=now;
    return {goal,events:[evaluated.event]};
  }

  const base=evaluatePhysicalGoal(goal,previous,current,now,options);
  goal=base.goal;
  goal.temporalState=temporalState;
  const first=base.events[0];
  if(!first) return {goal,events:[]};
  if(first.type==='routine-needs-attention'&&status.policy.graceMs>0){
    temporalState.pendingRoutineSince=now;
    temporalState.pendingRoutineEvidence={
      ...(first.evidence||{}),
      temporalMode:status.policy.mode,
      graceMs:status.policy.graceMs,
      windowKey:status.windowKey
    };
    return {goal,events:[]};
  }
  return {goal,events:base.events};
}

export function evaluateTemporalPhysicalGoal(input,previous={},current={},now=Date.now(),options={}){
  let goal=normalizePhysicalGoal(input,now);
  if(!goal.enabled) return {goal,events:[]};

  const status=temporalPolicyStatus(goal.temporalPolicy||{},now);
  goal.temporalPolicy=status.policy;
  goal.temporalState=freshTemporalState(goal,status);

  if(goal.sequence?.steps?.length){
    goal.lastEvaluatedAt=now;
    goal.temporalState.lastTemporalState=status.active?'active':'inactive';
    return {goal,events:[]};
  }

  const isDefaultAlways=status.policy.mode==='always'&&status.policy.graceMs===0;
  if(isDefaultAlways){
    return evaluatePhysicalGoal(goal,previous,current,now,options);
  }

  if(goal.type==='standing-expectation'){
    return evaluateStanding(goal,current,status,now);
  }
  return evaluateRoutine(goal,previous,current,status,now,options);
}

export function evaluateTemporalPhysicalGoals(goals=[],previous={},current={},now=Date.now(),options={}){
  const updated=[];
  const events=[];
  for(const item of arr(goals)){
    const result=evaluateTemporalPhysicalGoal(item,previous,current,now,options);
    updated.push(result.goal);
    events.push(...result.events);
  }
  return {goals:updated,events};
}

export function buildRoutineHealth(goals=[],events=[],now=Date.now(),windowMs=7*86400000){
  const cutoff=now-Math.max(60000,Number(windowMs||7*86400000));
  return arr(goals)
    .filter((goal)=>goal.type==='routine')
    .map((goal)=>{
      const recent=arr(events).filter((event)=>event.goalId===goal.id&&Number(event.generatedAt||0)>=cutoff);
      const completed=recent.filter((event)=>event.type==='routine-complete').length;
      const deviations=recent.filter((event)=>[
        'routine-needs-attention','persistent-routine-deviation','routine-step-skipped',
        'sequence-window-missed','routine-sequence-deviated'
      ].includes(event.type)).length;
      const unknown=recent.filter((event)=>event.type==='routine-unknown').length;
      const resolved=completed+deviations;
      return {
        goalId:goal.id,
        label:txt(goal.label,160),
        enabled:goal.enabled!==false,
        completed,
        deviations,
        unknown,
        observedRuns:recent.length,
        completionRate:resolved?completed/resolved:null,
        lastEvent:recent.sort((a,b)=>Number(b.generatedAt||0)-Number(a.generatedAt||0))[0]||null
      };
    })
    .sort((a,b)=>b.deviations-a.deviations||Number(b.lastEvent?.generatedAt||0)-Number(a.lastEvent?.generatedAt||0));
}
