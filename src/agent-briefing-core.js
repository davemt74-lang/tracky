function txt(value,max=240){return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max);}
function clamp01(value){const n=Number(value);return Math.max(0,Math.min(1,Number.isFinite(n)?n:0));}
function urgency(event={}){
  if(event.type==='priority-threshold'){
    const p=Number(event.evidence?.priority||0);
    return p>=.9?'high':p>=.75?'medium':'low';
  }
  if(event.type==='anomaly-active') return 'high';
  if(event.type==='anomaly-cleared') return 'info';
  return 'medium';
}
export function buildAgentBriefing(event={},watch={},now=Date.now()){
  const summary=txt(event.summary||watch.label||event.type||'Physical-world watch triggered',260);
  return {
    schemaVersion:1,
    id:'BRIEF-'+String(event.id||event.watchId||now),
    status:'pending',
    type:'physical-world-watch',
    urgency:urgency(event),
    generatedAt:Number(event.generatedAt||now),
    watchId:event.watchId||watch.id||null,
    watchLabel:txt(watch.label||'',140)||null,
    title:txt(watch.label||'Physical-world update',140),
    summary,
    confidence:clamp01(event.confidence??1),
    evidence:{
      subjectId:event.evidence?.subjectId||null,
      roomId:event.evidence?.roomId||null,
      anomalySignature:event.evidence?.anomalySignature||null,
      anomalyType:event.evidence?.anomalyType||null,
      priority:Number.isFinite(Number(event.evidence?.priority))?Number(event.evidence.priority):null
    },
    provenance:['physical-world-watch','governed-agent-context'],
    boundaries:['semantic-briefing-only','privacy-governed-context','no-autonomous-physical-control']
  };
}
export function buildPhysicalGoalBriefing(event={},goal={},now=Date.now()){
  const severity=String(event.severity||goal.severity||'medium');
  const urgency=severity==='high'?'high':severity==='low'?'low':severity==='info'?'info':'medium';
  return {
    schemaVersion:1,
    id:'BRIEF-'+String(event.id||event.goalId||now),
    status:'pending',
    type:'physical-world-goal',
    urgency,
    generatedAt:Number(event.generatedAt||now),
    goalId:event.goalId||goal.id||null,
    goalLabel:txt(goal.label||'',160)||null,
    title:txt(goal.label||'Physical-world goal update',160),
    summary:txt(event.summary||goal.label||event.type||'Physical-world goal update',320),
    confidence:clamp01(event.confidence??1),
    evidence:{
      subjectId:event.evidence?.subjectId||event.evidence?.triggerSubjectId||null,
      roomId:event.evidence?.roomId||event.evidence?.triggerRoomId||null,
      anchorId:event.evidence?.anchorId||null,
      expectedRoomId:event.evidence?.expectedRoomId||null,
      expectedAnchorId:event.evidence?.expectedAnchorId||null,
      goalState:event.state||null,
      checkCount:Array.isArray(event.checks)?event.checks.length:0
    },
    provenance:['physical-world-goal','governed-agent-context'],
    boundaries:['semantic-briefing-only','privacy-governed-context','no-autonomous-physical-control']
  };
}

export function acknowledgeAgentBriefing(briefing,now=Date.now()){
  if(!briefing) return null;
  return {...briefing,status:'acknowledged',acknowledgedAt:Number(now)};
}
export function pendingAgentBriefings(items=[]){
  return items.filter((item)=>(
    item?.status==='pending' &&
    !['acknowledged','expired'].includes(item?.deliveryState)
  )).sort((a,b)=>Number(b.generatedAt||0)-Number(a.generatedAt||0));
}
