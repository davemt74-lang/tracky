const arr=(v)=>Array.isArray(v)?v:[];
const txt=(v,max=140)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));

export const ROUTINE_SEQUENCE_SCHEMA_VERSION=1;

export function normalizeRoutineSequence(input={}){
  return {
    schemaVersion:ROUTINE_SEQUENCE_SCHEMA_VERSION,
    steps:arr(input.steps).slice(0,8).map((step)=>({
      kind:['person-room-transition','object-room-transition'].includes(String(step?.kind))
        ? String(step.kind)
        : 'person-room-transition',
      subjectId:txt(step?.subjectId||'',120)||null,
      subjectLabel:txt(step?.subjectLabel||'',100)||null,
      fromRoomId:txt(step?.fromRoomId||'',120)||null,
      toRoomId:txt(step?.toRoomId||'',120)||null
    })),
    maxGapMs:Math.max(1000,Math.min(86400000,Number(input.maxGapMs||15*60*1000))),
    sourceProposalId:txt(input.sourceProposalId||'',120)||null
  };
}

export function normalizeRoutineSequenceState(input={}){
  return {
    progress:Math.max(0,Number(input.progress||0)),
    startedAt:Number(input.startedAt||0)||null,
    lastStepAt:Number(input.lastStepAt||0)||null,
    completedAt:Number(input.completedAt||0)||null,
    lastDeviationAt:Number(input.lastDeviationAt||0)||null
  };
}

export function semanticTransition(input={}){
  if(input.type==='participant.room_transition'&&input.participantId){
    return {
      kind:'person-room-transition',
      subjectId:String(input.participantId),
      subjectLabel:txt(input.participantName||input.label||input.participantId,100),
      fromRoomId:input.fromRoomId||null,
      toRoomId:input.toRoomId||null,
      confidence:clamp01(input.confidence??1),
      timestamp:Number(input.timestamp||Date.now()),
      sourceEventId:input.id||null
    };
  }
  if(input.type==='object.room_transition'&&input.objectId){
    return {
      kind:'object-room-transition',
      subjectId:String(input.objectId),
      subjectLabel:txt(input.objectLabel||input.label||input.objectId,100),
      fromRoomId:input.fromRoomId||null,
      toRoomId:input.toRoomId||null,
      confidence:clamp01(input.confidence??1),
      timestamp:Number(input.timestamp||Date.now()),
      sourceEventId:input.id||null
    };
  }
  return null;
}

export function routineSequenceStepKey(step={}){
  return [
    step.kind||'',
    step.subjectId||'',
    step.fromRoomId||'',
    step.toRoomId||''
  ].join('|');
}
export function transitionKey(event={}){
  const transition=event.kind?event:semanticTransition(event);
  return transition?routineSequenceStepKey(transition):null;
}
function matches(step,event){
  if(!step||!event) return false;
  return routineSequenceStepKey(step)===transitionKey(event);
}
function event(goal,type,summary,now,evidence={}){
  return {
    id:'GOAL-EVENT-'+now+'-'+Math.random().toString(36).slice(2,7),
    goalId:goal.id,
    goalType:goal.type,
    type,
    state:type==='routine-complete'?'met':'needs-attention',
    severity:goal.severity||'medium',
    summary:txt(summary,320),
    generatedAt:now,
    confidence:clamp01(evidence.confidence??1),
    evidence,
    checks:[],
    briefingEligible:type!=='routine-complete'||goal.notifyOnSuccess===true,
    provenance:['physical-world-goal','routine-sequence','governed-semantic-transition'],
    boundaries:['semantic-goal-only','privacy-governed-context','no-autonomous-physical-control']
  };
}
function resetState(state){
  state.progress=0;
  state.startedAt=null;
  state.lastStepAt=null;
  return state;
}
function maybeStart(sequence,state,transition,now){
  if(matches(sequence.steps[0],transition)){
    state.progress=1;
    state.startedAt=now;
    state.lastStepAt=now;
    return true;
  }
  return false;
}

export function advanceRoutineSequence(goalInput={},transitionInput={},now=Date.now()){
  const sequence=normalizeRoutineSequence(goalInput.sequence||{});
  const transition=transitionInput.kind?transitionInput:semanticTransition(transitionInput);
  const state=normalizeRoutineSequenceState(goalInput.sequenceState||{});
  const goal={...goalInput,sequence,sequenceState:state};
  if(!transition||!sequence.steps.length) return {goal,events:[],matched:false};

  if(state.progress>0&&state.lastStepAt&&now-state.lastStepAt>sequence.maxGapMs){
    const expected=sequence.steps[Math.min(state.progress,sequence.steps.length-1)]||null;
    const timeoutEvent=event(goal,'sequence-window-missed',goal.label+': the expected routine sequence timed out.',now,{
      expectedStep:expected,
      observedTransition:transition,
      progress:state.progress,
      maxGapMs:sequence.maxGapMs,
      confidence:transition.confidence
    });
    state.lastDeviationAt=now;
    resetState(state);
    const restarted=maybeStart(sequence,state,transition,now);
    return {goal,events:[timeoutEvent],matched:restarted};
  }

  if(state.progress===0){
    const started=maybeStart(sequence,state,transition,now);
    if(!started) return {goal,events:[],matched:false};
    if(sequence.steps.length===1){
      state.completedAt=now;
      resetState(state);
      return {goal,events:[event(goal,'routine-complete',goal.label+': learned routine sequence completed.',now,{
        observedTransition:transition,confidence:transition.confidence
      })],matched:true};
    }
    return {goal,events:[],matched:true};
  }

  const expected=sequence.steps[state.progress];
  if(matches(expected,transition)){
    state.progress+=1;
    state.lastStepAt=now;
    if(state.progress>=sequence.steps.length){
      state.completedAt=now;
      resetState(state);
      return {goal,events:[event(goal,'routine-complete',goal.label+': learned routine sequence completed.',now,{
        observedTransition:transition,
        stepCount:sequence.steps.length,
        confidence:transition.confidence
      })],matched:true};
    }
    return {goal,events:[],matched:true};
  }

  const laterIndex=sequence.steps.findIndex((step,index)=>index>state.progress&&matches(step,transition));
  if(laterIndex>state.progress){
    const skipped=sequence.steps.slice(state.progress,laterIndex);
    const deviation=event(goal,'routine-step-skipped',goal.label+': an expected routine step was skipped.',now,{
      expectedStep:expected,
      skippedSteps:skipped,
      observedTransition:transition,
      progress:state.progress,
      confidence:transition.confidence
    });
    state.lastDeviationAt=now;
    resetState(state);
    maybeStart(sequence,state,transition,now);
    return {goal,events:[deviation],matched:false};
  }

  if(
    expected?.subjectId &&
    transition.subjectId===expected.subjectId &&
    transition.kind===expected.kind
  ){
    const deviation=event(goal,'routine-sequence-deviated',goal.label+': the routine took a different physical path than expected.',now,{
      expectedStep:expected,
      observedTransition:transition,
      progress:state.progress,
      confidence:transition.confidence
    });
    state.lastDeviationAt=now;
    resetState(state);
    maybeStart(sequence,state,transition,now);
    return {goal,events:[deviation],matched:false};
  }

  return {goal,events:[],matched:false};
}

export function tickRoutineSequence(goalInput={},now=Date.now()){
  const sequence=normalizeRoutineSequence(goalInput.sequence||{});
  const state=normalizeRoutineSequenceState(goalInput.sequenceState||{});
  const goal={...goalInput,sequence,sequenceState:state};
  if(!sequence.steps.length||state.progress===0||!state.lastStepAt) return {goal,events:[]};
  if(now-state.lastStepAt<=sequence.maxGapMs) return {goal,events:[]};
  const expected=sequence.steps[Math.min(state.progress,sequence.steps.length-1)]||null;
  const deviation=event(goal,'sequence-window-missed',goal.label+': the next expected routine step did not happen in time.',now,{
    expectedStep:expected,
    progress:state.progress,
    maxGapMs:sequence.maxGapMs,
    confidence:1
  });
  state.lastDeviationAt=now;
  resetState(state);
  return {goal,events:[deviation]};
}
