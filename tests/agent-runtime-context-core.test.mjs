import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runtimeActiveRoomId,
  buildAgentRuntimeContextSource,
  buildWorldQueryRuntimeContext,
  buildWorldWatchRuntimeContext,
  buildAgentDeliveryRuntimeContext,
  canonicalParticipantLocation,
  canonicalObjectLocation
} from '../src/agent-runtime-context-core.js';

const truth={
  activeRoomId:'OFFICE',
  entities:[
    {subjectId:'PERSON:p1',entityType:'person',label:'Dave',roomId:'OFFICE',state:'confirmed'},
    {subjectId:'O1',entityType:'object',label:'keys',roomId:'OFFICE',state:'confirmed'}
  ]
};
const multiRoom={
  participants:{'PERSON:p1':{id:'PERSON:p1',participantId:'p1',roomId:'KITCHEN'}},
  objects:{O1:{id:'O1',roomId:'KITCHEN'}}
};

test('runtime active room prefers canonical truth and never invents room while stopped',()=>{
  assert.equal(runtimeActiveRoomId({groundTruth:truth,running:true,primaryRoomId:'KITCHEN'}),'OFFICE');
  assert.equal(runtimeActiveRoomId({groundTruth:{},running:false,primaryRoomId:'KITCHEN'}),null);
  assert.equal(runtimeActiveRoomId({groundTruth:{},running:true,primaryRoomId:'KITCHEN'}),'KITCHEN');
});

test('Agent context source carries canonical truth and bounded recent changes',()=>{
  const changes=Array.from({length:60},(_,i)=>({id:'C'+i}));
  const result=buildAgentRuntimeContextSource({
    groundTruth:truth,running:true,primaryRoomId:'KITCHEN',
    rooms:[{id:'OFFICE'}],roomPolicies:{OFFICE:{}},multiRoom,
    attention:{activeTask:null},anomalies:{active:{}},sceneChanges:changes,
    perceptionBudget:{intensity:'balanced'},operationalHealth:{status:'healthy'}
  });
  assert.equal(result.activeRoomId,'OFFICE');
  assert.equal(result.sceneChanges.length,40);
  assert.equal(result.groundTruth.activeRoomId,'OFFICE');
});

test('world-query runtime context uses canonical room and preserves history layers as evidence',()=>{
  const result=buildWorldQueryRuntimeContext({
    groundTruth:truth,rooms:[{id:'OFFICE'}],roomPolicies:{},multiRoom,
    spatialMemory:{entities:{}},sceneGraph:{nodes:[]},physicalWorld:{},
    operationalHealth:{status:'healthy'},sceneChanges:[{id:'C1'}],
    episodes:[{id:'E1'}],anomalies:{active:{}}
  });
  assert.equal(result.activeRoomId,'OFFICE');
  assert.equal(result.sceneChanges.length,1);
  assert.equal(result.episodes.length,1);
});

test('watch command context normalizes room labels without changing Agent context',()=>{
  const base={summary:'ok',rooms:[{id:'OLD'}]};
  const result=buildWorldWatchRuntimeContext(base,[{id:'OFFICE',name:'Office'}]);
  assert.equal(result.rooms[0].label,'Office');
  assert.equal(base.rooms[0].id,'OLD');
});

test('delivery runtime context prefers explicit delivery room then canonical truth',()=>{
  const explicit=buildAgentDeliveryRuntimeContext({
    deliveryContext:{activeRoomId:'KITCHEN',taskMode:'general'},
    groundTruth:truth,running:true,activeTask:{mode:'find-object'}
  },1000);
  assert.equal(explicit.activeRoomId,'KITCHEN');
  assert.equal(explicit.taskMode,'find-object');

  const canonical=buildAgentDeliveryRuntimeContext({
    deliveryContext:{taskMode:'general'},groundTruth:truth,running:true,
    primaryRoomId:'KITCHEN',activeTask:{mode:'general'}
  },1000);
  assert.equal(canonical.activeRoomId,'OFFICE');
});

test('canonical location lookups prefer ground truth over lower-level multi-room evidence',()=>{
  assert.equal(canonicalParticipantLocation({groundTruth:truth,multiRoom},'p1').roomId,'OFFICE');
  assert.equal(canonicalObjectLocation({groundTruth:truth,multiRoom},'O1').roomId,'OFFICE');
});

test('canonical location lookups retain backwards-compatible multi-room fallback',()=>{
  const noTruth={groundTruth:{entities:[]},multiRoom};
  assert.equal(canonicalParticipantLocation(noTruth,'p1').roomId,'KITCHEN');
  assert.equal(canonicalObjectLocation(noTruth,'O1').roomId,'KITCHEN');
});

test('delivery context inherits active task when stored delivery task mode is absent',()=>{
  const result=buildAgentDeliveryRuntimeContext({
    deliveryContext:{},
    groundTruth:truth,
    running:true,
    activeTask:{mode:'low-power'}
  },1000);
  assert.equal(result.taskMode,'low-power');
});
