import {
  defaultObservationPolicy,
  normalizeObservationPolicy,
  observationDecision,
  spatialMemoryRetentionAllowed
} from './privacy-policy-core.js';

function arr(value){
  return Array.isArray(value)?value:(value&&typeof value==='object'?Object.values(value):[]);
}
function policyFor(policies={},roomId){
  return normalizeObservationPolicy(
    policies?.[roomId]||defaultObservationPolicy(roomId||'ROOM01'),
    roomId||'ROOM01'
  );
}
function anonymousId(roomId,item,key){
  const local=item.localRoomEntityId||item.id||key||'participant';
  return 'ANON:'+(roomId||'ROOM')+':'+String(local).replace(/[^a-zA-Z0-9_-]/g,'').slice(-80);
}
function participantProjection(item,key,policies,purpose){
  const roomId=item.roomId||item.lastKnownRoomId||null;
  const policy=policyFor(policies,roomId);
  const decision=observationDecision({
    policy,kind:'participant',position:item.roomPosition,roomId
  });
  if(!decision.allowed) return null;
  if(purpose==='memory'&&!spatialMemoryRetentionAllowed(policy,item.roomPosition)) return null;

  if(decision.anonymize){
    const id=anonymousId(roomId,item,key);
    return [id,{
      ...item,
      id,
      participantId:null,
      participantName:'Anonymous participant',
      identityAuthority:'anonymous',
      privacy:{...(item.privacy||{}),mode:decision.region?.mode||'anonymous',retentionAllowed:decision.retentionAllowed}
    }];
  }
  return [key,item];
}
function objectProjection(item,key,policies,purpose){
  const roomId=item.roomId||item.lastKnownRoomId||null;
  const policy=policyFor(policies,roomId);
  const decision=observationDecision({
    policy,kind:'object',position:item.roomPosition,roomId
  });
  if(!decision.allowed) return null;
  if(purpose==='memory'&&!spatialMemoryRetentionAllowed(policy,item.roomPosition)) return null;
  return [key,{
    ...item,
    privacy:{...(item.privacy||{}),mode:decision.region?.mode||'observe',retentionAllowed:decision.retentionAllowed}
  }];
}
function nodeAllowed(node,policy,purpose){
  if(!['person','object'].includes(node.type)) return true;
  const kind=node.type==='person'?'participant':'object';
  const decision=observationDecision({
    policy,kind,position:node.position,roomId:policy.roomId
  });
  if(!decision.allowed) return false;
  if(purpose==='memory'&&!spatialMemoryRetentionAllowed(policy,node.position)) return false;
  if(node.type==='person'&&decision.anonymize) return false;
  return true;
}

export function buildGovernedSemanticProjection(input={},options={}){
  const purpose=options.purpose==='memory'?'memory':'ground-truth';
  const world=input.multiRoom||{};
  const policies=input.roomPolicies||{};
  const participants={};
  const objects={};

  for(const [key,item] of Object.entries(world.participants||{})){
    const projected=participantProjection(item,key,policies,purpose);
    if(projected) participants[projected[0]]=projected[1];
  }
  for(const [key,item] of Object.entries(world.objects||{})){
    const projected=objectProjection(item,key,policies,purpose);
    if(projected) objects[projected[0]]=projected[1];
  }

  const graph=JSON.parse(JSON.stringify(input.sceneGraph||{nodes:[],edges:[]}));
  const graphPolicy=policyFor(policies,graph.roomId||input.activeRoomId||'ROOM01');
  const nodes=arr(graph.nodes);
  const allowedNodes=new Set(nodes.filter(node=>nodeAllowed(node,graphPolicy,purpose)).map(node=>node.id));
  graph.nodes=nodes.filter(node=>allowedNodes.has(node.id));
  graph.edges=arr(graph.edges).filter(edge=>(
    allowedNodes.has(edge.subjectId)&&allowedNodes.has(edge.objectId)
  ));

  return {
    schemaVersion:1,
    purpose,
    activeRoomId:input.runtimeActive===true?(input.activeRoomId||null):null,
    multiRoom:{...world,participants,objects},
    sceneGraph:graph,
    boundaries:['single-governed-semantic-projection','privacy-policy-authoritative','semantic-only','no-autonomous-physical-control']
  };
}

export function retentionAllowedForProjectedEntity(entity,policies={}){
  const roomId=entity?.roomId||entity?.lastKnownRoomId||null;
  if(!roomId) return false;
  return spatialMemoryRetentionAllowed(policyFor(policies,roomId),entity.roomPosition||null);
}
