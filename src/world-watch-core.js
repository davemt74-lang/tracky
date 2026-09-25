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
function allEntities(context={}){
  return [...arr(context.people),...arr(context.objects)];
}
function entityMatch(item,watch){
  if(!item) return false;
  if(watch.subjectId&&subjectKey(item)===watch.subjectId) return true;
  if(watch.subjectLabel&&txt(item.label,80).toLowerCase()===watch.subjectLabel.toLowerCase()) return true;
  return false;
}
function findEntity(context,watch){
  return allEntities(context).find((item)=>entityMatch(item,watch))||null;
}
function findAnomaly(context,watch){
  return arr(context?.anomalies).find((item)=>{
    if(watch.anomalySignature&&item.signature===watch.anomalySignature) return true;
    if(watch.anomalyType&&item.type===watch.anomalyType) return true;
    return !watch.anomalySignature&&!watch.anomalyType;
  })||null;
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
    const before=findEntity(previous,watch);
    const after=findEntity(current,watch);
    if(watch.type==='entity-enters-room'){
      if(after&&after.roomId===watch.roomId&&(!before||before.roomId!==watch.roomId)){
        return trigger(watch,watch.type,(after.label||watch.subjectLabel||'Entity')+' entered '+(after.room||watch.roomId)+'.',now,
          {subjectId:subjectKey(after),roomId:after.roomId,confidence:after.confidence});
      }
    }else if(watch.type==='entity-leaves-room'){
      if(before&&before.roomId===watch.roomId&&(!after||after.roomId!==watch.roomId)){
        return trigger(watch,watch.type,(before.label||watch.subjectLabel||'Entity')+' left '+(before.room||watch.roomId)+'.',now,
          {subjectId:subjectKey(before),roomId:watch.roomId,confidence:before.confidence});
      }
    }else if(before&&after&&(before.roomId!==after.roomId||before.presence!==after.presence)){
      return trigger(watch,watch.type,(after.label||watch.subjectLabel||'Entity')+' changed location state.',now,
        {subjectId:subjectKey(after),roomId:after.roomId,confidence:after.confidence});
    }
  }

  if(watch.type==='anomaly-active'){
    const before=findAnomaly(previous,watch);
    const after=findAnomaly(current,watch);
    if(after&&!before){
      return trigger(watch,watch.type,after.summary||'A watched anomaly became active.',now,
        {anomalySignature:after.signature,anomalyType:after.type,roomId:after.roomId,confidence:after.confidence});
    }
  }

  if(watch.type==='anomaly-cleared'){
    const before=findAnomaly(previous,watch);
    const after=findAnomaly(current,watch);
    if(before&&!after){
      return trigger(watch,watch.type,(before.summary||before.type||'Watched anomaly')+' cleared.',now,
        {anomalySignature:before.signature,anomalyType:before.type,roomId:before.roomId,confidence:before.confidence});
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
