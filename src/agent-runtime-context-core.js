import { normalizeDeliveryContext } from './briefing-delivery-policy.js';

function copy(value){ return JSON.parse(JSON.stringify(value)); }

export function runtimeActiveRoomId(input={}){
  if(input.groundTruth?.activeRoomId) return input.groundTruth.activeRoomId;
  if(input.running!==true) return null;
  return input.primaryRoomId||input.fusionRoomId||input.roomStateRoomId||null;
}

export function buildAgentRuntimeContextSource(input={}){
  return {
    activeRoomId:runtimeActiveRoomId(input),
    rooms:input.rooms||[],
    roomPolicies:input.roomPolicies||{},
    multiRoom:input.multiRoom||{},
    attention:input.attention||{},
    anomalies:input.anomalies||{},
    sceneChanges:Array.isArray(input.sceneChanges)?input.sceneChanges.slice(-40):[],
    perceptionBudget:input.perceptionBudget||null,
    groundTruth:input.groundTruth||null,
    operationalHealth:input.operationalHealth||null
  };
}

export function buildWorldQueryRuntimeContext(input={}){
  return {
    activeRoomId:input.groundTruth?.activeRoomId||null,
    rooms:input.rooms||[],
    roomPolicies:input.roomPolicies||{},
    multiRoom:input.multiRoom||{},
    spatialMemory:input.spatialMemory||{},
    sceneGraph:input.sceneGraph||{},
    physicalWorld:input.physicalWorld||{},
    groundTruth:input.groundTruth||null,
    operationalHealth:input.operationalHealth||null,
    sceneChanges:Array.isArray(input.sceneChanges)?input.sceneChanges.slice():[],
    episodes:Array.isArray(input.episodes)?input.episodes.slice():[],
    anomalies:input.anomalies||{}
  };
}

export function buildWorldWatchRuntimeContext(agentContext={},rooms=[]){
  return {
    ...agentContext,
    rooms:(rooms||[]).map((room)=>({
      id:room.id,
      name:room.name||room.label||room.id,
      label:room.label||room.name||room.id
    }))
  };
}

export function buildAgentDeliveryRuntimeContext(input={},now=Date.now()){
  const current=input.deliveryContext||{};
  const activeRoomId=current.activeRoomId||runtimeActiveRoomId(input);
  const taskMode=current.taskMode!=='general'
    ?current.taskMode
    :(input.activeTask?.mode||'general');
  return normalizeDeliveryContext({
    ...current,
    activeRoomId,
    taskMode
  },now);
}

export function canonicalParticipantLocation(input={},participantId){
  const subjectId=String(participantId||'').startsWith('PERSON:')
    ?String(participantId)
    :'PERSON:'+String(participantId||'');
  const truth=(input.groundTruth?.entities||[]).find((item)=>(
    item.entityType==='person'&&item.subjectId===subjectId
  ));
  return copy(truth||input.multiRoom?.participants?.[subjectId]||null);
}

export function canonicalObjectLocation(input={},objectId){
  const truth=(input.groundTruth?.entities||[]).find((item)=>(
    item.entityType==='object'&&item.subjectId===objectId
  ));
  return copy(truth||input.multiRoom?.objects?.[objectId]||null);
}
