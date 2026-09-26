import { retentionAllowedForProjectedEntity } from './governed-world-projection-core.js';

function arr(value){ return Array.isArray(value)?value:[]; }
function stableEntity(item={}){
  return [
    item.subjectId||null,item.entityType||null,item.label||null,
    item.state||null,item.roomId||null,item.lastKnownRoomId||null,
    item.authority||null,item.freshness||null,
    Math.round(Number(item.confidence||0)*20)/20
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
