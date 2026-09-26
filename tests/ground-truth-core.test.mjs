import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroundTruth,
  explainGroundTruth,
  recoverGroundTruthSnapshot,
  reconcileGroundTruthEntities,
  truthFreshness
} from '../src/ground-truth-core.js';

const person=(roomId,at=1000)=>({
  id:'PERSON:p1',participantId:'p1',participantName:'Dave',
  roomId,lastKnownRoomId:roomId,presence:'confirmed',confidence:.92,lastObservedAt:at,cameraIds:['CAM1']
});
const object=(id,label,roomId,at=1000)=>({
  id,objectId:id,label,roomId,lastKnownRoomId:roomId,presence:'confirmed',confidence:.88,lastObservedAt:at,cameraIds:['CAM1']
});

test('freshness distinguishes current recent stale and unknown without pretending stale is current',()=>{
  assert.equal(truthFreshness({...object('O1','keys','OFFICE',1000),observedAt:1000},2000).state,'current');
  assert.equal(truthFreshness({...object('O1','keys','OFFICE',1000),observedAt:1000},360000).state!=='current',true);
  assert.equal(truthFreshness({label:'keys'},2000).state,'unknown');
});

test('reconciliation preserves comparable simultaneous room conflict instead of silently choosing',()=>{
 const r=reconcileGroundTruthEntities({
   multiRoom:{participants:{
     a:person('OFFICE',1000),
     b:{...person('KITCHEN',1000),id:'PERSON:p1'}
   }}
 },1000);
 assert.equal(r.conflicts.length,1);
 assert.equal(r.entities[0].state,'conflicted');
 assert.equal(r.entities[0].roomId,null);
 assert.deepEqual(new Set(r.entities[0].candidateRoomIds),new Set(['OFFICE','KITCHEN']));
});

test('fresh higher-authority observation wins over stale lower-authority memory-like scene evidence',()=>{
 const state=buildGroundTruth({
   activeRoomId:'OFFICE',
   multiRoom:{objects:{O1:object('O1','keys','OFFICE',10000)}},
   sceneGraph:{
    roomId:'KITCHEN',
    nodes:[{id:'O1',type:'object',label:'keys',state:'last-known',confidence:.5,lastObservedAt:1000,properties:{}}],
    edges:[{id:'e1',subjectId:'O1',predicate:'located-in',objectId:'KITCHEN',state:'last-known',confidence:.5,lastObservedAt:1000}]
   }
 },null,10000);
 const e=state.entities.find(x=>x.subjectId==='O1');
 assert.equal(e.roomId,'OFFICE');
 assert.equal(e.state,'confirmed');
});

test('user location correction is authoritative until a newer direct observation conflicts',()=>{
 const correction={id:'C1',type:'entity-location',subjectId:'O1',roomId:'DESKROOM',source:'user',createdAt:5000,status:'active'};
 let state=buildGroundTruth({
   multiRoom:{objects:{O1:object('O1','keys','OFFICE',4000)}},
   sceneGraph:{nodes:[],edges:[]},
   corrections:[correction]
 },null,6000);
 let e=state.entities.find(x=>x.subjectId==='O1');
 assert.equal(e.roomId,'DESKROOM');
 assert.equal(e.authority,'user-confirmed');

 state=buildGroundTruth({
   multiRoom:{objects:{O1:object('O1','keys','OFFICE',7000)}},
   sceneGraph:{nodes:[],edges:[]},
   corrections:[correction]
 },null,7000);
 e=state.entities.find(x=>x.subjectId==='O1');
 assert.equal(e.state,'conflicted');
 assert.equal(state.conflicts.some(x=>x.type==='user-correction-conflict'),true);
});

test('forget correction removes entity from current ground truth',()=>{
 const state=buildGroundTruth({
   multiRoom:{objects:{O1:object('O1','keys','OFFICE',1000)}},
   sceneGraph:{nodes:[],edges:[]},
   corrections:[{id:'C1',type:'forget-entity',subjectId:'O1',source:'user',createdAt:1000,status:'active'}]
 },null,1000);
 assert.equal(state.entities.some(x=>x.subjectId==='O1'),false);
});

test('recovered persisted snapshot is historical and never current truth',()=>{
 const saved=buildGroundTruth({
   activeRoomId:'OFFICE',
   multiRoom:{participants:{p:person('OFFICE',1000)}},
   sceneGraph:{nodes:[],edges:[]}
 },null,1000);
 const recovered=recoverGroundTruthSnapshot(saved,5000);
 const e=recovered.entities[0];
 assert.equal(recovered.recoveryMode,true);
 assert.equal(e.freshness,'unknown');
 assert.equal(e.state,'last-known');
 assert.equal(e.roomId,null);
 assert.equal(e.lastKnownRoomId,'OFFICE');
});

test('explanation separates current observation from historical evidence',()=>{
 let state=buildGroundTruth({
   multiRoom:{objects:{O1:object('O1','keys','OFFICE',1000)}},
   sceneGraph:{nodes:[],edges:[]}
 },null,1000);
 let x=explainGroundTruth(state,'O1');
 assert.equal(x.observed,true);
 assert.match(x.summary,/current governed evidence/);

 state=recoverGroundTruthSnapshot(state,5000);
 x=explainGroundTruth(state,'O1');
 assert.equal(x.observed,false);
 assert.match(x.summary,/historical|insufficiently fresh/);
});
