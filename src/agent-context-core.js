const clamp01=(value)=>Math.max(0,Math.min(1,Number.isFinite(Number(value))?Number(value):0));
const SEVERITY={critical:5,high:4,medium:3,low:2,info:1};
const POLICY_FLAGS=[
  ['allowVisualObservation','visual-observation-disabled'],
  ['allowParticipantIdentity','participant-identity-disabled'],
  ['allowObjectObservation','object-observation-disabled'],
  ['allowBehaviorAnalysis','behavior-analysis-disabled'],
  ['allowEnvironmentComparison','environment-comparison-disabled'],
  ['allowRoomAudio','room-audio-disabled'],
  ['allowVoiceMatching','voice-matching-disabled'],
  ['allowLiveTranscription','live-transcription-disabled'],
  ['allowTranscriptStorage','transcript-storage-disabled'],
  ['allowSpatialMemory','spatial-memory-disabled']
];

export const AGENT_CONTEXT_SCHEMA_VERSION=1;
export const AGENT_CONTEXT_SENSITIVE_KEYS=Object.freeze([
  'embedding','embeddings','descriptor','descriptors','faceDescriptor','voiceDescriptor',
  'imageDataUrl','image','pixels','frame','frames','audio','samples','waveform',
  'raw','rawPayload','providerPayload','transcript'
]);
const SENSITIVE=new Set(AGENT_CONTEXT_SENSITIVE_KEYS.map((key)=>key.toLowerCase()));

function arr(value){
  if(Array.isArray(value)) return value;
  if(value&&typeof value==='object') return Object.values(value);
  return [];
}
function txt(value,max=180){
  return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max);
}
function numberOrNull(value){
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}
function roomMap(context){
  return new Map(arr(context.rooms).map((room)=>[String(room.id),room]));
}
function roomName(rooms,roomId){
  if(!roomId) return null;
  const room=rooms.get(String(roomId));
  return txt(room?.name||room?.label||roomId,80)||String(roomId);
}
function policy(context,roomId){
  return context.roomPolicies?.[roomId]||context.observationPolicies?.[roomId]||{};
}
function constraints(roomPolicy={}){
  return POLICY_FLAGS.filter(([flag])=>roomPolicy[flag]===false).map(([,label])=>label);
}
function freshness(timestamp,now){
  const value=numberOrNull(timestamp);
  return value==null?null:Math.max(0,now-value);
}
function sanitizeWalk(value){
  if(Array.isArray(value)) return value.map(sanitizeWalk);
  if(!value||typeof value!=='object') return value;
  const output={};
  for(const [key,item] of Object.entries(value)){
    if(SENSITIVE.has(String(key).toLowerCase())) continue;
    output[key]=sanitizeWalk(item);
  }
  return output;
}
export function sanitizeAgentContext(value){
  return sanitizeWalk(value);
}

function people(context,rooms,now,limit){
  return arr(context.multiRoom?.participants)
    .filter((item)=>['confirmed','transitioning'].includes(String(item.presence||'')))
    .map((item)=>{
      const roomId=item.roomId||item.lastKnownRoomId||null;
      const roomPolicy=policy(context,roomId);
      if(roomPolicy.allowVisualObservation===false) return null;
      const hidden=roomPolicy.allowParticipantIdentity===false;
      return {
        participantId:hidden?null:(item.participantId||item.id||null),
        label:hidden?'Anonymous participant':txt(item.participantName||item.name||item.label||item.participantId||item.id||'Participant',80),
        roomId,room:roomName(rooms,roomId),presence:txt(item.presence||'confirmed',32),
        confidence:clamp01(item.confidence),lastObservedAt:numberOrNull(item.lastObservedAt),
        freshnessMs:freshness(item.lastObservedAt,now)
      };
    })
    .filter(Boolean)
    .sort((a,b)=>Number(b.roomId===context.activeRoomId)-Number(a.roomId===context.activeRoomId)||b.confidence-a.confidence)
    .slice(0,limit);
}
function objects(context,rooms,now,limit){
  return arr(context.multiRoom?.objects)
    .map((item)=>{
      const roomId=item.roomId||item.lastKnownRoomId||null;
      const roomPolicy=policy(context,roomId);
      if(roomPolicy.allowVisualObservation===false||roomPolicy.allowObjectObservation===false) return null;
      const presence=txt(item.presence||(item.roomId?'confirmed':'last-known'),32);
      if(presence==='last-known'&&roomPolicy.allowSpatialMemory===false) return null;
      return {
        objectId:item.objectId||item.id||null,label:txt(item.label||item.className||item.objectClass||item.id||'Object',80),
        roomId,room:roomName(rooms,roomId),presence,confidence:clamp01(item.confidence),
        lastObservedAt:numberOrNull(item.lastObservedAt),freshnessMs:freshness(item.lastObservedAt,now)
      };
    })
    .filter(Boolean)
    .sort((a,b)=>Number(b.presence==='confirmed')-Number(a.presence==='confirmed')||b.confidence-a.confidence)
    .slice(0,limit);
}
function anomalies(context,rooms,limit){
  return arr(context.anomalies?.active)
    .filter((item)=>!item.status||['active','acknowledged'].includes(String(item.status)))
    .map((item)=>({
      signature:txt(item.signature||item.id||'',120)||null,type:txt(item.type||'anomaly',80),
      severity:txt(item.severity||'medium',24),status:txt(item.status||'active',32),
      roomId:item.roomId||null,room:roomName(rooms,item.roomId),
      subjectId:item.subjectId||item.objectId||item.participantId||null,
      summary:txt(item.summary||item.type||'Physical-world anomaly',220),confidence:clamp01(item.confidence),
      firstSeenAt:numberOrNull(item.firstSeenAt),lastSeenAt:numberOrNull(item.lastSeenAt)
    }))
    .sort((a,b)=>(SEVERITY[b.severity]||0)-(SEVERITY[a.severity]||0)||b.confidence-a.confidence)
    .slice(0,limit);
}
function attention(context,rooms,limit){
  return arr(context.attention?.items)
    .filter((item)=>!item.state||['pending','active'].includes(String(item.state)))
    .map((item)=>({
      key:txt(item.key||item.type||'',140)||null,type:txt(item.type||'attention',80),
      category:txt(item.category||'system',40),state:txt(item.state||'pending',24),
      roomId:item.roomId||null,room:roomName(rooms,item.roomId),
      subjectId:item.subjectId||item.objectId||item.participantId||item.targetId||null,
      summary:txt(item.summary||item.type||'Attention item',220),
      priority:clamp01(item.taskPriority??item.priority??item.confidence??0.5),
      confidence:clamp01(item.confidence??item.priority??0.5),
      lastSeenAt:numberOrNull(item.lastSeenAt||item.createdAt)
    }))
    .sort((a,b)=>b.priority-a.priority||b.confidence-a.confidence)
    .slice(0,limit);
}
function changes(context,rooms,limit){
  return arr(context.sceneChanges)
    .map((item)=>({
      id:txt(item.id||'',120)||null,type:txt(item.type||'change',80),
      roomId:item.roomId||null,room:roomName(rooms,item.roomId),
      subjectId:item.objectId||item.participantId||item.subjectId||null,
      summary:txt(item.summary||item.type||'Physical-world change',220),
      confidence:clamp01(item.confidence),timestamp:numberOrNull(item.timestamp||item.updatedAt||item.createdAt)
    }))
    .sort((a,b)=>Number(b.timestamp||0)-Number(a.timestamp||0))
    .slice(0,limit);
}
function task(attentionState={}){
  const item=attentionState.activeTask;
  if(!item) return null;
  return {
    id:txt(item.id||'',100)||null,mode:txt(item.mode||'general',40),
    label:txt(item.label||item.mode||'General awareness',100),
    targetId:item.targetId||null,targetLabel:txt(item.targetLabel||'',100)||null,
    roomId:item.roomId||null,status:txt(item.status||'active',24),
    startedAt:numberOrNull(item.startedAt),expiresAt:numberOrNull(item.expiresAt)
  };
}
function priorities(activeAnomalies,attentionItems,limit){
  const items=[];
  for(const item of activeAnomalies){
    const base={critical:1,high:.9,medium:.72,low:.5,info:.3}[item.severity]||.6;
    items.push({source:'anomaly',key:item.signature||item.type,type:item.type,roomId:item.roomId,room:item.room,
      subjectId:item.subjectId,summary:item.summary,priority:clamp01(base*.75+item.confidence*.25),confidence:item.confidence});
  }
  for(const item of attentionItems){
    items.push({source:'attention',key:item.key,type:item.type,roomId:item.roomId,room:item.room,
      subjectId:item.subjectId,summary:item.summary,priority:item.priority,confidence:item.confidence});
  }
  const seen=new Set();
  return items.sort((a,b)=>b.priority-a.priority||b.confidence-a.confidence).filter((item)=>{
    const key=[item.type,item.roomId||'',item.subjectId||'',item.summary].join('::');
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0,limit);
}

export function buildAgentContext(context={},options={},now=Date.now()){
  const rooms=roomMap(context);
  const activeRoomId=options.roomId||context.activeRoomId||null;
  const activeRoomPolicy=policy(context,activeRoomId);
  const currentPeople=people(context,rooms,now,Number(options.peopleLimit||12));
  const currentObjects=objects(context,rooms,now,Number(options.objectLimit||16));
  const activeAnomalies=anomalies(context,rooms,Number(options.anomalyLimit||8));
  const attentionItems=attention(context,rooms,Number(options.attentionLimit||8));
  const recentChanges=changes(context,rooms,Number(options.changeLimit||10));
  const priorityItems=priorities(activeAnomalies,attentionItems,Number(options.priorityLimit||8));
  const activeTask=task(context.attention||{});
  const activeRoom=activeRoomId?{id:activeRoomId,name:roomName(rooms,activeRoomId),constraints:constraints(activeRoomPolicy)}:null;
  const inRoomPeople=currentPeople.filter((item)=>!activeRoomId||item.roomId===activeRoomId).length;
  const inRoomObjects=currentObjects.filter((item)=>!activeRoomId||item.roomId===activeRoomId).length;
  let summary=(activeRoom?.name||activeRoom?.id||'Current world')+': '+inRoomPeople+' '+(inRoomPeople===1?'person':'people')+
    ' and '+inRoomObjects+' '+(inRoomObjects===1?'tracked object':'tracked objects')+'.';
  if(activeAnomalies.length) summary+=' '+activeAnomalies.length+' active '+(activeAnomalies.length===1?'anomaly.':'anomalies.');
  if(priorityItems.length) summary+=' '+priorityItems.length+' prioritized '+(priorityItems.length===1?'item.':'items.');
  if(activeTask&&activeTask.mode!=='general') summary+=' Task: '+activeTask.label+'.';
  return sanitizeAgentContext({
    schemaVersion:AGENT_CONTEXT_SCHEMA_VERSION,generatedAt:now,activeRoom,summary,task:activeTask,
    priorities:priorityItems,people:currentPeople,objects:currentObjects,anomalies:activeAnomalies,recentChanges,
    privacy:{activeRoomId,constraints:constraints(activeRoomPolicy),regionCount:Number(activeRoomPolicy.regions?.length||activeRoomPolicy.regionCount||0)},
    perceptionBudget:context.perceptionBudget?{
      intensity:txt(context.perceptionBudget.intensity||'',40)||null,
      mainCameraMs:numberOrNull(context.perceptionBudget.mainCameraMs||context.perceptionBudget.mainScanMs),
      secondaryCameraMs:numberOrNull(context.perceptionBudget.secondaryCameraMs||context.perceptionBudget.secondaryScanMs),
      environmentCheckMs:numberOrNull(context.perceptionBudget.environmentCheckMs)
    }:null,
    provenance:['multi-room-world','attention-controller','proactive-awareness','scene-intelligence','observation-policy'],
    boundaries:['semantic-context-only','no-raw-sensor-payloads','no-autonomous-physical-control','privacy-policy-remains-authoritative']
  });
}

const VOLATILE_DELTA_KEYS=new Set([
  'freshnessMs','lastObservedAt','lastSeenAt','updatedAt','generatedAt'
]);
function stableItem(item){
  if(!item||typeof item!=='object') return item;
  const output={};
  for(const [key,value] of Object.entries(item)){
    if(VOLATILE_DELTA_KEYS.has(key)) continue;
    if(['confidence','priority','taskPriority'].includes(key)&&Number.isFinite(Number(value))){
      output[key]=Math.round(Number(value)*20)/20;
      continue;
    }
    output[key]=value;
  }
  return output;
}
function itemKey(item,index){
  return String(item?.key||item?.signature||item?.participantId||item?.objectId||item?.id||item?.type||index);
}
function diffList(previous=[],current=[]){
  const before=new Map(arr(previous).map((item,index)=>[itemKey(item,index),item]));
  const after=new Map(arr(current).map((item,index)=>[itemKey(item,index),item]));
  const added=[],removed=[],changed=[];
  for(const [key,item] of after){
    if(!before.has(key)) added.push(item);
    else if(JSON.stringify(stableItem(before.get(key)))!==JSON.stringify(stableItem(item))) changed.push(item);
  }
  for(const [key,item] of before) if(!after.has(key)) removed.push(item);
  return {added,removed,changed};
}
export function diffAgentContext(previous,current){
  if(!previous){
    return sanitizeAgentContext({schemaVersion:AGENT_CONTEXT_SCHEMA_VERSION,generatedAt:current?.generatedAt||Date.now(),
      changed:true,reason:'initial-context',current:{
        activeRoom:current?.activeRoom||null,task:current?.task||null,priorities:current?.priorities||[],
        people:current?.people||[],objects:current?.objects||[],anomalies:current?.anomalies||[],
        recentChanges:current?.recentChanges||[],privacy:current?.privacy||null,perceptionBudget:current?.perceptionBudget||null
      }});
  }
  const delta={
    schemaVersion:AGENT_CONTEXT_SCHEMA_VERSION,generatedAt:current?.generatedAt||Date.now(),changed:false,
    roomChanged:JSON.stringify(previous.activeRoom||null)!==JSON.stringify(current?.activeRoom||null),
    taskChanged:JSON.stringify(previous.task||null)!==JSON.stringify(current?.task||null),
    privacyChanged:JSON.stringify(previous.privacy||null)!==JSON.stringify(current?.privacy||null),
    budgetChanged:JSON.stringify(previous.perceptionBudget||null)!==JSON.stringify(current?.perceptionBudget||null),
    priorities:diffList(previous.priorities,current?.priorities),people:diffList(previous.people,current?.people),
    objects:diffList(previous.objects,current?.objects),anomalies:diffList(previous.anomalies,current?.anomalies),
    recentChanges:diffList(previous.recentChanges,current?.recentChanges)
  };
  delta.changed=Boolean(delta.roomChanged||delta.taskChanged||delta.privacyChanged||delta.budgetChanged||
    ['priorities','people','objects','anomalies','recentChanges'].some((key)=>
      delta[key].added.length||delta[key].removed.length||delta[key].changed.length));
  return sanitizeAgentContext(delta);
}
