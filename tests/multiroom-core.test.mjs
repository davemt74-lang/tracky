import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMultiRoomWorld,
  multiRoomSnapshot,
  reconcileObjectLocations,
  reconcileParticipantLocations,
  updateMultiRoomWorld
} from '../src/multiroom-core.js';
import { buildWorldTopology } from '../src/room-topology-core.js';

const rooms=[
  {id:'ROOM01',name:'Office',topology:{portals:[{id:'P1',connectsToRoomId:'ROOM02',connectsToPortalId:'P2',confidence:.95,userConfirmed:true}]}},
  {id:'ROOM02',name:'Hall',topology:{portals:[{id:'P2',connectsToRoomId:'ROOM01',connectsToPortalId:'P1',confidence:.95,userConfirmed:true}]}}
];
const topology=buildWorldTopology(rooms);
const person=(roomId,camera='CAM01')=>({
  id:'P:p1',participantId:'p1',participantName:'Dave',
  confidence:.92,roomPosition:{x:.5,y:.5},cameraIds:[camera],status:'visible',roomId
});

test('known participant transition across adjacent rooms is continuous',()=>{
  const state=createMultiRoomWorld();
  reconcileParticipantLocations(state,{ROOM01:{participants:[person('ROOM01')]}},topology,1000);
  const events=reconcileParticipantLocations(state,{ROOM02:{participants:[person('ROOM02','CAM02')]}},topology,4000);
  assert.equal(state.participants['PERSON:p1'].roomId,'ROOM02');
  assert.equal(events.some((event)=>event.type==='participant.room_transition'),true);
  assert.equal(state.participants['PERSON:p1'].presence,'confirmed');
});

test('same participant observed in different rooms simultaneously becomes uncertain',()=>{
  const state=createMultiRoomWorld();
  const events=reconcileParticipantLocations(state,{
    ROOM01:{participants:[person('ROOM01')]},
    ROOM02:{participants:[person('ROOM02','CAM02')]}
  },topology,1000);
  assert.equal(state.participants['PERSON:p1'].presence,'uncertain');
  assert.equal(events.some((event)=>event.type==='participant.location_uncertain'),true);
});

test('anonymous track does not earn cross-room identity continuity',()=>{
  const state=createMultiRoomWorld();
  const anon={id:'U:CAM01:T1',participantId:null,participantName:null,confidence:.8,roomPosition:{x:.5,y:.5},cameraIds:['CAM01'],status:'visible'};
  reconcileParticipantLocations(state,{ROOM01:{participants:[anon]}},topology,1000);
  const anon2={...anon,id:'U:CAM02:T9',cameraIds:['CAM02']};
  const events=reconcileParticipantLocations(state,{ROOM02:{participants:[anon2]}},topology,3000);
  assert.equal(events.some((event)=>event.type==='participant.room_transition'),false);
});

test('participant becomes last-known then absent when no room sees them',()=>{
  const state=createMultiRoomWorld();
  reconcileParticipantLocations(state,{ROOM01:{participants:[person('ROOM01')]}},topology,1000);
  reconcileParticipantLocations(state,{},topology,5000);
  assert.equal(state.participants['PERSON:p1'].presence,'last-known');
  reconcileParticipantLocations(state,{},topology,70000);
  assert.equal(state.participants['PERSON:p1'].presence,'absent');
});

test('object follows known holder transition when custody evidence agrees',()=>{
  const state=createMultiRoomWorld();
  state.participants['PERSON:p1']={participantId:'p1',roomId:'ROOM02',lastKnownRoomId:'ROOM02',presence:'confirmed',lastObservedAt:4000};
  state.transitions.push({
    id:'PT1',type:'participant.room_transition',participantId:'p1',
    fromRoomId:'ROOM01',toRoomId:'ROOM02',confidence:.9,timestamp:4000
  });
  state.objects.WO1={
    id:'WO1',label:'phone',roomId:'ROOM01',lastKnownRoomId:'ROOM01',
    holderParticipantId:'p1',confidence:.8,lastObservedAt:3000,firstObservedAt:1000
  };
  const events=reconcileObjectLocations(state,{
    ROOM02:{objects:[{id:'O9',label:'phone',confidence:.88,roomPosition:{x:.4,y:.4},cameraIds:['CAM02'],status:'visible'}]}
  },{
    topology,
    custodyByLocalObjectId:{'ROOM02:O9':{participantId:'p1'}}
  },4500);
  assert.equal(state.objects.WO1.roomId,'ROOM02');
  assert.equal(events.some((event)=>event.type==='object.room_transition'),true);
});

test('multi-room snapshot carries room-scoped conversations',()=>{
  const state=createMultiRoomWorld();
  updateMultiRoomWorld(state,{
    rooms,
    cameras:[],
    topology,
    roomFusionStates:{},
    roomSnapshots:{
      ROOM01:{conversationGroups:[{id:'G01',participantIds:['p1','p2'],trackIds:['T1','T2']}]}
    }
  },1000);
  assert.equal(multiRoomSnapshot(state).conversations['ROOM01:G01'].roomId,'ROOM01');
});
