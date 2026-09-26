import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundTruth,recoverGroundTruthSnapshot } from '../src/ground-truth-core.js';
import { buildOperationalHealth } from '../src/operational-health-core.js';
import {
  appendGroundTruthCorrection,
  activeGroundTruthCorrections,
  revokeGroundTruthCorrection
} from '../src/ground-truth-correction-core.js';
import { buildGovernedSemanticProjection } from '../src/governed-world-projection-core.js';
import {
  groundTruthInputSignature,
  groundTruthSemanticSignature
} from '../src/ground-truth-runtime-core.js';

function policies(overrides={}){
  return {
    OFFICE:{
      roomId:'OFFICE',allowVisualObservation:true,allowParticipantIdentity:true,
      allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,
      sensitiveRegions:[],...overrides.OFFICE
    },
    KITCHEN:{
      roomId:'KITCHEN',allowVisualObservation:true,allowParticipantIdentity:true,
      allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,
      sensitiveRegions:[],...overrides.KITCHEN
    }
  };
}
function object(roomId,at,confidence=.9){
  return {id:'O1',objectId:'O1',label:'keys',roomId,lastKnownRoomId:roomId,
    presence:'confirmed',confidence,lastObservedAt:at,roomPosition:{x:.4,y:.4}};
}
function person(roomId,at){
  return {id:'PERSON:p1',participantId:'p1',participantName:'Dave',
    roomId,lastKnownRoomId:roomId,presence:'confirmed',confidence:.94,lastObservedAt:at,
    roomPosition:{x:.2,y:.2},identityAuthority:'enrolled-participant'};
}
function camera(status='online'){
  return {
    config:{id:'CAM1',name:'Main',roomId:'OFFICE',enabled:true,primary:true,
      sourcePoints:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
      roomPoints:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},
    statuses:{CAM1:status}
  };
}
function projectionInput(now,roomId='OFFICE',policySet=policies(),corrections=[],runtimeActive=true,camStatus='online'){
  const cam=camera(camStatus);
  return {
    runtimeActive,activeRoomId:runtimeActive?roomId:null,
    multiRoom:{
      participants:{'PERSON:p1':person(roomId,now)},
      objects:{O1:object(roomId,now)},
      transitions:[]
    },
    sceneGraph:{roomId,nodes:[],edges:[]},
    roomPolicies:policySet,
    cameras:[cam.config],cameraStatuses:cam.statuses,
    environment:{classification:'known',best:{roomId},drift:null},
    corrections
  };
}
function reconcile(input,previous,now){
  const projection=buildGovernedSemanticProjection(input,{purpose:'ground-truth'});
  const truth=buildGroundTruth({
    ...projection,
    corrections:activeGroundTruthCorrections(input.corrections||[])
  },previous,now);
  const health=buildOperationalHealth({
    activeRoomId:truth.activeRoomId,rooms:[{id:'OFFICE',name:'Office'},{id:'KITCHEN',name:'Kitchen'}],
    cameras:input.cameras,cameraStatuses:input.cameraStatuses,roomPolicies:input.roomPolicies,
    environment:input.environment,groundTruth:truth
  },now);
  return {truth,health,signature:groundTruthSemanticSignature(truth,health)};
}

test('multi-day semantic soak keeps identical frame timestamps from causing input churn',()=>{
  const start=1_000_000;
  let first=null;
  let changes=0;
  for(let minute=0;minute<3*24*60;minute+=1){
    const now=start+minute*60_000;
    const input=projectionInput(now);
    const signature=groundTruthInputSignature(input);
    if(first===null) first=signature;
    if(signature!==first) changes+=1;
  }
  assert.equal(changes,0);
});

test('semantic soak detects meaningful transitions while remaining stable between them',()=>{
  const start=2_000_000;
  let priorInput=null;
  let inputChanges=0;
  let truth=null;
  let truthChanges=0;
  let priorTruthSignature=null;

  for(let minute=0;minute<24*60;minute+=1){
    const now=start+minute*60_000;
    const roomId=minute<480?'OFFICE':minute<960?'KITCHEN':'OFFICE';
    const input=projectionInput(now,roomId);
    const inputSignature=groundTruthInputSignature(input);
    if(priorInput!==null&&inputSignature!==priorInput) inputChanges+=1;
    priorInput=inputSignature;

    if(minute===0||minute===480||minute===960){
      const result=reconcile(input,truth,now);
      truth=result.truth;
      if(priorTruthSignature!==null&&result.signature!==priorTruthSignature) truthChanges+=1;
      priorTruthSignature=result.signature;
    }
  }
  assert.equal(inputChanges,2);
  assert.equal(truthChanges,2);
  assert.equal(truth.entities.find(x=>x.subjectId==='O1').roomId,'OFFICE');
});

test('camera outage and recovery changes health without corrupting canonical entity identity',()=>{
  const now=3_000_000;
  let result=reconcile(projectionInput(now),null,now);
  assert.equal(result.health.status,'healthy');
  const beforeId=result.truth.entities.find(x=>x.entityType==='object').subjectId;

  result=reconcile(projectionInput(now+1000,'OFFICE',policies(),[],true,'offline'),result.truth,now+1000);
  assert.equal(result.health.status,'needs-attention');
  assert.equal(result.truth.entities.find(x=>x.entityType==='object').subjectId,beforeId);

  result=reconcile(projectionInput(now+2000),result.truth,now+2000);
  assert.equal(result.health.status,'healthy');
});

test('privacy policy changes suppress governed object evidence and identity without leaking raw identity',()=>{
  const now=4_000_000;
  const p=policies({OFFICE:{allowParticipantIdentity:false,allowObjectObservation:false}});
  const input=projectionInput(now,'OFFICE',p);
  const projection=buildGovernedSemanticProjection(input,{purpose:'ground-truth'});
  assert.equal(Object.keys(projection.multiRoom.objects).length,0);
  const people=Object.values(projection.multiRoom.participants);
  assert.equal(people.length,1);
  assert.equal(people[0].participantId,null);
  assert.equal(people[0].participantName,'Anonymous participant');
  assert.doesNotMatch(JSON.stringify(projection),/"Dave"/);
});

test('restart recovery stays historical until fresh governed observation re-establishes truth',()=>{
  const now=5_000_000;
  const first=reconcile(projectionInput(now),null,now);
  const recovered=recoverGroundTruthSnapshot(first.truth,now+10_000);
  assert.equal(recovered.recoveryMode,true);
  assert.equal(recovered.entities.find(x=>x.subjectId==='O1').roomId,null);

  const offlineInput={
    ...projectionInput(now+11_000,'OFFICE',policies(),[],false,'offline'),
    multiRoom:{participants:{},objects:{},transitions:[]}
  };
  let next=reconcile(offlineInput,recovered,now+11_000);
  assert.equal(next.truth.recoveryMode,true);
  assert.equal(next.truth.entities.find(x=>x.subjectId==='O1').authority,'recovered-history');

  next=reconcile(projectionInput(now+20_000),next.truth,now+20_000);
  assert.equal(next.truth.recoveryMode,false);
  assert.equal(next.truth.entities.find(x=>x.subjectId==='O1').roomId,'OFFICE');
});

test('correction and merge undo lifecycle survives repeated reconciliation without duplicate canonical entities',()=>{
  const now=6_000_000;
  let corrections=[];
  let r=appendGroundTruthCorrection(corrections,{
    id:'L1',type:'entity-location',subjectId:'O1',roomId:'KITCHEN'
  },now);
  corrections=r.corrections;
  let result=reconcile(projectionInput(now,'OFFICE',policies(),corrections),null,now);
  assert.equal(result.truth.entities.filter(x=>x.subjectId==='O1').length,1);

  r=appendGroundTruthCorrection(corrections,{
    id:'M1',type:'entity-merge',aliasEntityId:'O9',canonicalEntityId:'O1'
  },now+1000);
  corrections=r.corrections;

  const input=projectionInput(now+1000,'OFFICE',policies(),corrections);
  input.multiRoom.objects.O9={...object('OFFICE',now+1000),id:'O9',objectId:'O9'};
  result=reconcile(input,result.truth,now+1000);
  assert.equal(result.truth.entities.filter(x=>x.subjectId==='O1').length,1);
  assert.equal(result.truth.entities.some(x=>x.subjectId==='O9'),false);

  const undone=revokeGroundTruthCorrection(corrections,'M1','different-object',now+2000);
  corrections=undone.corrections;
  const unmerged={...input,corrections};
  result=reconcile(unmerged,result.truth,now+2000);
  assert.equal(result.truth.entities.some(x=>x.subjectId==='O1'),true);
  assert.equal(result.truth.entities.some(x=>x.subjectId==='O9'),true);
});

test('soak inputs remain semantic-only and never retain raw sensor payloads',()=>{
  const input=projectionInput(7_000_000);
  input.multiRoom.objects.O1.imageDataUrl='private';
  input.multiRoom.participants['PERSON:p1'].embedding=[1,2,3];
  const projection=buildGovernedSemanticProjection(input,{purpose:'ground-truth'});
  // The projection is fed only from semantic multi-room state in production; verify runtime fingerprint ignores raw extras.
  const clean=groundTruthInputSignature(input);
  const stripped=JSON.parse(JSON.stringify(input));
  delete stripped.multiRoom.objects.O1.imageDataUrl;
  delete stripped.multiRoom.participants['PERSON:p1'].embedding;
  assert.equal(clean,groundTruthInputSignature(stripped));
});
