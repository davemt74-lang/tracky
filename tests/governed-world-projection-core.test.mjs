import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGovernedSemanticProjection,retentionAllowedForProjectedEntity } from '../src/governed-world-projection-core.js';

const baseWorld={
 participants:{
  'PERSON:p1':{id:'PERSON:p1',participantId:'p1',participantName:'Dave',roomId:'OFFICE',presence:'confirmed',confidence:.9,roomPosition:{x:.2,y:.2}}
 },
 objects:{
  O1:{id:'O1',objectId:'O1',label:'keys',roomId:'OFFICE',presence:'confirmed',confidence:.9,roomPosition:{x:.4,y:.4}}
 }
};
const graph={roomId:'OFFICE',nodes:[
 {id:'PERSON:p1',type:'person',label:'Dave',position:{x:.2,y:.2}},
 {id:'O1',type:'object',label:'keys',position:{x:.4,y:.4}},
 {id:'OFFICE',type:'room',label:'Office'}
],edges:[
 {id:'e1',subjectId:'PERSON:p1',predicate:'located-in',objectId:'OFFICE'},
 {id:'e2',subjectId:'O1',predicate:'located-in',objectId:'OFFICE'}
]};
test('ground truth projection applies identity privacy in one canonical layer',()=>{
 const p=buildGovernedSemanticProjection({
  runtimeActive:true,activeRoomId:'OFFICE',multiRoom:baseWorld,sceneGraph:graph,
  roomPolicies:{OFFICE:{roomId:'OFFICE',allowVisualObservation:true,allowParticipantIdentity:false,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,sensitiveRegions:[]}}
 });
 assert.equal(Object.keys(p.multiRoom.participants).length,1);
 const person=Object.values(p.multiRoom.participants)[0];
 assert.equal(person.participantId,null);
 assert.equal(person.participantName,'Anonymous participant');
 assert.equal(p.sceneGraph.nodes.some(x=>x.type==='person'),false);
 assert.equal(p.activeRoomId,'OFFICE');
});
test('projection removes visually disallowed entities and room is not asserted when runtime stopped',()=>{
 const p=buildGovernedSemanticProjection({
  runtimeActive:false,activeRoomId:'OFFICE',multiRoom:baseWorld,sceneGraph:graph,
  roomPolicies:{OFFICE:{roomId:'OFFICE',allowVisualObservation:false,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,sensitiveRegions:[]}}
 });
 assert.equal(Object.keys(p.multiRoom.participants).length,0);
 assert.equal(Object.keys(p.multiRoom.objects).length,0);
 assert.equal(p.activeRoomId,null);
});
test('memory projection enforces retention while live ground truth can remain visible',()=>{
 const policies={OFFICE:{roomId:'OFFICE',allowVisualObservation:true,allowParticipantIdentity:true,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:false,sensitiveRegions:[]}};
 const live=buildGovernedSemanticProjection({runtimeActive:true,activeRoomId:'OFFICE',multiRoom:baseWorld,sceneGraph:graph,roomPolicies:policies},{purpose:'ground-truth'});
 const memory=buildGovernedSemanticProjection({runtimeActive:true,activeRoomId:'OFFICE',multiRoom:baseWorld,sceneGraph:graph,roomPolicies:policies},{purpose:'memory'});
 assert.equal(Object.keys(live.multiRoom.objects).length,1);
 assert.equal(Object.keys(memory.multiRoom.objects).length,0);
 assert.equal(retentionAllowedForProjectedEntity(baseWorld.objects.O1,policies),false);
});
test('ignore privacy region suppresses only entities within the region',()=>{
 const policies={OFFICE:{roomId:'OFFICE',allowVisualObservation:true,allowParticipantIdentity:true,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,
  sensitiveRegions:[{id:'P1',enabled:true,mode:'ignore',x:.3,y:.3,width:.3,height:.3,appliesTo:['object'],maskImage:true}]}};
 const p=buildGovernedSemanticProjection({runtimeActive:true,activeRoomId:'OFFICE',multiRoom:baseWorld,sceneGraph:graph,roomPolicies:policies});
 assert.equal(Object.keys(p.multiRoom.participants).length,1);
 assert.equal(Object.keys(p.multiRoom.objects).length,0);
});

test('memory projection filters transitions whose destination room disallows retention',()=>{
 const world={...baseWorld,transitions:[
  {id:'T1',fromRoomId:'OFFICE',toRoomId:'PRIVATE'},
  {id:'T2',fromRoomId:'OFFICE',toRoomId:'OFFICE'}
 ]};
 const policies={
  OFFICE:{roomId:'OFFICE',allowVisualObservation:true,allowParticipantIdentity:true,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,sensitiveRegions:[]},
  PRIVATE:{roomId:'PRIVATE',allowVisualObservation:true,allowParticipantIdentity:true,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:false,sensitiveRegions:[]}
 };
 const p=buildGovernedSemanticProjection({runtimeActive:true,activeRoomId:'OFFICE',multiRoom:world,sceneGraph:graph,roomPolicies:policies},{purpose:'memory'});
 assert.deepEqual(p.multiRoom.transitions.map(x=>x.id),['T2']);
});

test('memory transition is suppressed when either origin or destination disallows retention',()=>{
 const world={...baseWorld,transitions:[
  {id:'T1',fromRoomId:'PRIVATE',toRoomId:'OFFICE'},
  {id:'T2',fromRoomId:'OFFICE',toRoomId:'PRIVATE'},
  {id:'T3',fromRoomId:'OFFICE',toRoomId:'OFFICE'}
 ]};
 const policies={
  OFFICE:{roomId:'OFFICE',allowVisualObservation:true,allowParticipantIdentity:true,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:true,sensitiveRegions:[]},
  PRIVATE:{roomId:'PRIVATE',allowVisualObservation:true,allowParticipantIdentity:true,allowAnonymousTracking:true,allowObjectObservation:true,allowSpatialMemory:false,sensitiveRegions:[]}
 };
 const p=buildGovernedSemanticProjection({runtimeActive:true,activeRoomId:'OFFICE',multiRoom:world,sceneGraph:graph,roomPolicies:policies},{purpose:'memory'});
 assert.deepEqual(p.multiRoom.transitions.map(x=>x.id),['T3']);
});
