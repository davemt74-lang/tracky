const clamp01=(value)=>Math.max(0,Math.min(1,Number.isFinite(Number(value))?Number(value):0));
const TYPES=new Set(['entity-enters-room','entity-leaves-room','entity-moved','anomaly-active','anomaly-cleared','priority-threshold']);

export const WORLD_WATCH_SCHEMA_VERSION=1;
export const WORLD_WATCH_TYPES=Object.freeze(Array.from(TYPES));

function txt(value,max=160){
  return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max);
}
function id(prefix,now=Date.now()){
  return prefix+'-'+Number(now)+'-'+Math.random().toString(36).slice(2,7);
}
function arr(value){ return Array.isArray(value)?value:[]; }
function subjectKey(item){ return String(item?.participantId||item?.objectId||item?.subjectId||item?.id||''); }
function subjectKind(item){
  if(item?.participantId) return 'person';
  if(item?.objectId) return 'object';
  return null;
}
function allEntities(context={}){
  return [...arr(context.people),...arr(context.objects)];
}
function matchingEntities(context,watch){
  const entities=allEntities(context).filter((item)=>!watch.subjectKind||subjectKind(item)===watch.subjectKind);
  if(watch.subjectId) return entities.filter((item)=>subjectKey(item)===watch.subjectId);
  if(watch.subjectLabel){
    const matches=entities.filter((item)=>txt(item.label,80).toLowerCase()===watch.subjectLabel.toLowerCase());
    return matches.length===1?matches:[];
  }
  return entities;
}
function findEntity(context,watch){
  return matchingEntities(context,watch)[0]||null;
}
function matchingAnomalies(context,watch){
  return arr(context?.anomalies).filter((item)=>{
    if(watch.anomalySignature) return item.signature===watch.anomalySignature;
    if(watch.anomalyType) return item.type===watch.anomalyType;
    return true;
  });
}
function findAnomaly(context,watch){
  return matchingAnomalies(context,watch)[0]||null;
}
function anomalyKey(item){
  return String(item?.signature||[item?.type||'anomaly',item?.roomId||'',item?.subjectId||item?.objectId||item?.participantId||''].join('::'));
}
function trigger(watch,type,summary,now,evidence={}){
  return {
    id:id('WATCH-EVENT',now),watchId:watch.id,type,summary:txt(summary,260),
    generatedAt:now,confidence:clamp01(evidence.confidence??1),
    evidence:{
      subjectId:evidence.subjectId||null,roomId:evidence.roomId||null,
      anomalySignature:evidence.anomalySignature||null,anomalyType:evidence.anomalyType||null,
      priority:Number.isFinite(Number(evidence.priority))?Number(evidence.priority):null
    },
    boundaries:['semantic-context-only','privacy-governed-context','no-autonomous-physical-control']
  };
}

export function normalizeWorldWatch(input={},now=Date.now()){
  const type=TYPES.has(String(input.type))?String(input.type):'entity-moved';
  return {
    schemaVersion:WORLD_WATCH_SCHEMA_VERSION,
    id:txt(input.id||id('WATCH',now),120),
    type,
    label:txt(input.label||input.summary||type,140),
    enabled:input.enabled!==false,
    subjectId:txt(input.subjectId||'',120)||null,
    subjectLabel:txt(input.subjectLabel||'',80)||null,
    subjectKind:['person','object'].includes(String(input.subjectKind||''))?String(input.subjectKind):null,
    roomId:txt(input.roomId||'',120)||null,
    anomalySignature:txt(input.anomalySignature||'',140)||null,
    anomalyType:txt(input.anomalyType||'',100)||null,
    priorityThreshold:clamp01(input.priorityThreshold??0.8),
    cooldownMs:Math.max(0,Math.min(86400000,Number(input.cooldownMs??30000)||0)),
    createdAt:Number(input.createdAt||now),
    lastTriggeredAt:Number(input.lastTriggeredAt||0)||null
  };
}

function cooledDown(watch,now){
  return !watch.lastTriggeredAt||now-Number(watch.lastTriggeredAt)>=Number(watch.cooldownMs||0);
}

export function evaluateWorldWatch(input,previous={},current={},delta={},now=Date.now()){
  const watch=normalizeWorldWatch(input,now);
  if(!watch.enabled||!cooledDown(watch,now)) return null;

  if(watch.type==='entity-enters-room'||watch.type==='entity-leaves-room'||watch.type==='entity-moved'){
    const scoped=Boolean(watch.subjectId||watch.subjectLabel);
    const beforeMatches=matchingEntities(previous,watch);
    const afterMatches=matchingEntities(current,watch);
    const before=findEntity(previous,watch);
    const after=findEntity(current,watch);

    if(watch.type==='entity-enters-room'){
      if(scoped){
        if(after&&after.roomId===watch.roomId&&(!before||before.roomId!==watch.roomId)){
          return trigger(watch,watch.type,(after.label||watch.subjectLabel||'Entity')+' entered '+(after.room||watch.roomId)+'.',now,
            {subjectId:subjectKey(after),roomId:after.roomId,confidence:after.confidence});
        }
      }else{
        const beforeInRoom=new Set(beforeMatches.filter((item)=>item.roomId===watch.roomId).map(subjectKey));
        const entrant=afterMatches.find((item)=>item.roomId===watch.roomId&&!beforeInRoom.has(subjectKey(item)));
        if(entrant){
          return trigger(watch,watch.type,(entrant.label||'Entity')+' entered '+(entrant.room||watch.roomId)+'.',now,
            {subjectId:subjectKey(entrant),roomId:entrant.roomId,confidence:entrant.confidence});
        }
      }
    }else if(watch.type==='entity-leaves-room'){
      if(scoped){
        if(before&&before.roomId===watch.roomId&&(!after||after.roomId!==watch.roomId)){
          return trigger(watch,watch.type,(before.label||watch.subjectLabel||'Entity')+' left '+(before.room||watch.roomId)+'.',now,
            {subjectId:subjectKey(before),roomId:watch.roomId,confidence:before.confidence});
        }
      }else{
        const afterInRoom=new Set(afterMatches.filter((item)=>item.roomId===watch.roomId).map(subjectKey));
        const leaver=beforeMatches.find((item)=>item.roomId===watch.roomId&&!afterInRoom.has(subjectKey(item)));
        if(leaver){
          return trigger(watch,watch.type,(leaver.label||'Entity')+' left '+(leaver.room||watch.roomId)+'.',now,
            {subjectId:subjectKey(leaver),roomId:watch.roomId,confidence:leaver.confidence});
        }
      }
    }else{
      if(scoped){
        if(before&&after&&(before.roomId!==after.roomId||before.presence!==after.presence)){
          return trigger(watch,watch.type,(after.label||watch.subjectLabel||'Entity')+' changed location state.',now,
            {subjectId:subjectKey(after),roomId:after.roomId,confidence:after.confidence});
        }
      }else{
        const beforeById=new Map(beforeMatches.map((item)=>[subjectKey(item),item]));
        const moved=afterMatches.find((item)=>{
          const prior=beforeById.get(subjectKey(item));
          return prior&&(prior.roomId!==item.roomId||prior.presence!==item.presence);
        });
        if(moved){
          return trigger(watch,watch.type,(moved.label||'Entity')+' changed location state.',now,
            {subjectId:subjectKey(moved),roomId:moved.roomId,confidence:moved.confidence});
        }
      }
    }
  }

  if(watch.type==='anomaly-active'){
    const scoped=Boolean(watch.anomalySignature||watch.anomalyType);
    const before=findAnomaly(previous,watch);
    const after=findAnomaly(current,watch);
    if(scoped&&after&&!before){
      return trigger(watch,watch.type,after.summary||'A watched anomaly became active.',now,
        {anomalySignature:after.signature,anomalyType:after.type,roomId:after.roomId,confidence:after.confidence});
    }
    if(!scoped){
      const beforeKeys=new Set(matchingAnomalies(previous,watch).map(anomalyKey));
      const added=matchingAnomalies(current,watch).find((item)=>!beforeKeys.has(anomalyKey(item)));
      if(added) return trigger(watch,watch.type,added.summary||'An anomaly became active.',now,
        {anomalySignature:added.signature,anomalyType:added.type,roomId:added.roomId,confidence:added.confidence});
    }
  }

  if(watch.type==='anomaly-cleared'){
    const scoped=Boolean(watch.anomalySignature||watch.anomalyType);
    const before=findAnomaly(previous,watch);
    const after=findAnomaly(current,watch);
    if(scoped&&before&&!after){
      return trigger(watch,watch.type,(before.summary||before.type||'Watched anomaly')+' cleared.',now,
        {anomalySignature:before.signature,anomalyType:before.type,roomId:before.roomId,confidence:before.confidence});
    }
    if(!scoped){
      const afterKeys=new Set(matchingAnomalies(current,watch).map(anomalyKey));
      const cleared=matchingAnomalies(previous,watch).find((item)=>!afterKeys.has(anomalyKey(item)));
      if(cleared) return trigger(watch,watch.type,(cleared.summary||cleared.type||'Anomaly')+' cleared.',now,
        {anomalySignature:cleared.signature,anomalyType:cleared.type,roomId:cleared.roomId,confidence:cleared.confidence});
    }
  }

  if(watch.type==='priority-threshold'){
    const beforeMax=Math.max(0,...arr(previous?.priorities).map((item)=>Number(item.priority||0)));
    const after=arr(current?.priorities).sort((a,b)=>Number(b.priority||0)-Number(a.priority||0))[0]||null;
    if(after&&Number(after.priority||0)>=watch.priorityThreshold&&beforeMax<watch.priorityThreshold){
      return trigger(watch,watch.type,after.summary||'Agent priority crossed the watch threshold.',now,
        {subjectId:after.subjectId,roomId:after.roomId,priority:after.priority,confidence:after.confidence});
    }
  }
  return null;
}

export function evaluateWorldWatches(watches=[],previous={},current={},delta={},now=Date.now()){
  if(delta&&delta.changed===false) return [];
  return arr(watches).map((watch)=>evaluateWorldWatch(watch,previous,current,delta,now)).filter(Boolean);
}
