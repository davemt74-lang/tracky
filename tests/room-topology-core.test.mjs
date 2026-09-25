import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areRoomsAdjacent,
  buildWorldTopology,
  portalForTransition,
  proposeTopologyConnection,
  shortestRoomPath
} from '../src/room-topology-core.js';

function rooms(){
  return [
    {id:'ROOM01',name:'Office',topology:{portals:[{id:'P1',name:'Office door',type:'doorway',connectsToRoomId:'ROOM02',connectsToPortalId:'P2',confidence:.95,userConfirmed:true}]}},
    {id:'ROOM02',name:'Hall',topology:{portals:[
      {id:'P2',name:'Hall office',type:'doorway',connectsToRoomId:'ROOM01',connectsToPortalId:'P1',confidence:.95,userConfirmed:true},
      {id:'P3',name:'Hall kitchen',type:'doorway',connectsToRoomId:'ROOM03',connectsToPortalId:'P4',confidence:.9,userConfirmed:true}
    ]}},
    {id:'ROOM03',name:'Kitchen',topology:{portals:[{id:'P4',name:'Kitchen hall',type:'doorway',connectsToRoomId:'ROOM02',connectsToPortalId:'P3',confidence:.9,userConfirmed:true}]}}
  ];
}

test('topology builds confirmed room connections',()=>{
  const topology=buildWorldTopology(rooms());
  assert.equal(topology.connections.length,2);
  assert.equal(areRoomsAdjacent(topology,'ROOM01','ROOM02'),true);
});

test('shortest path walks connected rooms',()=>{
  assert.deepEqual(shortestRoomPath(buildWorldTopology(rooms()),'ROOM01','ROOM03'),['ROOM01','ROOM02','ROOM03']);
});

test('portal lookup resolves transition evidence',()=>{
  const result=portalForTransition(buildWorldTopology(rooms()),'ROOM01','ROOM02');
  assert.equal(result.fromPortal.id,'P1');
  assert.equal(result.toPortal.id,'P2');
});

test('repeated transitions can propose topology but not self-confirm it',()=>{
  const proposal=proposeTopologyConnection({
    fromRoomId:'ROOM01',toRoomId:'ROOM04',
    verifiedTransitionCount:4,confidence:.85
  });
  assert.equal(proposal.readyForConfirmation,true);
  assert.equal(proposal.userConfirmed,false);
});
