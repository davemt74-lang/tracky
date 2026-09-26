import { retentionAllowedForProjectedEntity } from './governed-world-projection-core.js';

function arr(value){ return Array.isArray(value)?value:[]; }
function stableEntity(item={}){
  return [
    item.subjectId||null,item.entityType||null,item.label||null,
    item.state||null,item.roomId||null,item.lastKnownRoomId||null,
    item.authority||null,item.freshness||null
  ];
}
function stableConflict(item={}){
  return [item.id||null,item.type||null,item.subjectId||null,
    arr(item.roomIds).map(String),item.unresolved!==false];
}
function stableCorrection(item={}){
  return [
    item.id||null,item.type||null,item.status||null,item.subjectId||null,
    item.label||null,item.roomId||null,item.cameraId||null,
    item.canonicalEntityId||null,item.aliasEntityId||null,
    item.supersededBy||null,arr(item.supersededIds).map(String)
  ];
}

function objectValues(value){
  return value&&typeof value==='object'
    ? Object.entries(value).sort(([a],[b])=>String(a).localeCompare(String(b)))
    : [];
}
function confidenceBucket(value){
  return Math.round(Number(value||0)*20)/20;
}
function entityEvidenceSignature(item={},key=''){
  return [
    key,item.id||null,item.participantId||null,item.objectId||null,
    item.participantName||item.label||null,item.roomId||null,item.lastKnownRoomId||null,
    item.presence||item.status||null,arr(item.candidateRoomIds).map(String).sort(),
    item.holderParticipantId||null,confidenceBucket(item.confidence)
  ];
}
function policyEvidenceSignature(policy={},roomId=''){
  return [
    roomId,
    policy.allowVisualObservation!==false,
    policy.allowParticipantIdentity!==false,
    policy.allowAnonymousTracking!==false,
    policy.allowObjectObservation!==false,
    policy.allowSpatialMemory!==false,
    arr(policy.sensitiveRegions).map((region)=>[
      region.id||null,region.enabled!==false,region.mode||null,
      Number(region.x||0),Number(region.y||0),Number(region.width||0),Number(region.height||0),
      arr(region.appliesTo).map(String).sort()
    ])
  ];
}
export function groundTruthInputSignature(input={}){
  const world=input.multiRoom||{};
  const graph=input.sceneGraph||{};
  return JSON.stringify({
    running:input.runtimeActive===true,
    activeRoomId:input.activeRoomId||null,
    participants:objectValues(world.participants).map(([key,item])=>entityEvidenceSignature(item,key)),
    objects:objectValues(world.objects).map(([key,item])=>entityEvidenceSignature(item,key)),
    graphNodes:arr(graph.nodes).map((node)=>[
      node.id||null,node.type||null,node.label||null,node.state||null,
      confidenceBucket(node.confidence)
    ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
    graphEdges:arr(graph.edges).map((edge)=>[
      edge.id||null,edge.subjectId||null,edge.predicate||null,edge.objectId||null,
      edge.state||null,confidenceBucket(edge.confidence)
    ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
    policies:objectValues(input.roomPolicies).map(([roomId,policy])=>policyEvidenceSignature(policy,roomId)),
    cameras:arr(input.cameras).map((camera)=>[
      camera.id||null,camera.roomId||null,camera.enabled!==false,camera.primary===true,
      arr(camera.roomPoints).flatMap((point)=>[Number(point.x||0),Number(point.y||0)])
    ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
    cameraStatuses:objectValues(input.cameraStatuses).map(([id,status])=>[id,status]),
    environment:[
      input.environment?.classification||null,
      input.environment?.best?.roomId||null,
      input.environment?.drift?.likelyCameraShift===true
    ],
    corrections:correctionSemanticSignature(input.corrections||[])
  });
}

export function groundTruthSemanticSignature(state={},health={}){
  return JSON.stringify({
    recoveryMode:state.recoveryMode===true,
    activeRoomId:state.activeRoomId||null,
    entities:arr(state.entities).map(stableEntity),
    conflicts:arr(state.conflicts).map(stableConflict),
    continuityIssues:arr(state.continuityIssues).map(item=>[
      item.id||null,item.type||null,arr(item.subjectIds).map(String),
      arr(item.roomIds).map(String),item.requiresConfirmation===true
    ]),
    health:{
      status:health?.status||null,
      staleEntityCount:Number(health?.staleEntityCount||0),
      conflictedEntityCount:Number(health?.conflictedEntityCount||0),
      continuityIssueCount:Number(health?.continuityIssueCount||0),
      issues:arr(health?.issues).map(item=>[item.type,item.id,item.issue])
    }
  });
}

export function correctionSemanticSignature(corrections=[]){
  return JSON.stringify(arr(corrections).map(stableCorrection));
}

export function groundTruthPersistenceSnapshot(state={},roomPolicies={}){
  const snapshot=JSON.parse(JSON.stringify(state||{}));
  snapshot.entities=arr(snapshot.entities).filter(entity=>(
    retentionAllowedForProjectedEntity(entity,roomPolicies)
  ));
  const allowed=new Set(snapshot.entities.map(entity=>entity.subjectId));
  snapshot.facts=arr(snapshot.facts).filter(fact=>allowed.has(fact.subjectId));
  snapshot.conflicts=arr(snapshot.conflicts).filter(conflict=>allowed.has(conflict.subjectId));
  snapshot.continuityIssues=arr(snapshot.continuityIssues).filter(issue=>(
    arr(issue.subjectIds).some(id=>allowed.has(id)) ||
    (issue.subjectId&&allowed.has(issue.subjectId))
  ));
  return snapshot;
}

export function groundTruthPersistenceSignature(state={},health={},corrections=[],roomPolicies={}){
  return JSON.stringify({
    truth:groundTruthSemanticSignature(
      groundTruthPersistenceSnapshot(state,roomPolicies),
      health
    ),
    corrections:correctionSemanticSignature(corrections)
  });
}

export function reportedMovedCameraIds(corrections=[]){
  return arr(corrections)
    .filter(item=>item.type==='camera-moved'&&item.status==='active'&&item.cameraId)
    .map(item=>String(item.cameraId));
}
