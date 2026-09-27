import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEDERATION_SYNC_PROTOCOL,
  compareFederationVersion,
  createFederationSyncState,
  applyFederationDelta,
  federationRemoteSnapshot
} from '../src/federation-sync-core.js';
import {
  buildSiteWorldFragment,
  createFederatedWorldState,
  applySiteWorldFragment
} from '../src/federated-world-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const NODE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NODE_C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function topology(epoch=1,officeNode=NODE_B){
  return {
    revision:10,
    sites:[
      {id:HOME,status:'active',authorityDeviceId:NODE_A,authorityEpoch:1},
      {id:OFFICE,status:'active',authorityDeviceId:officeNode,authorityEpoch:epoch}
    ]
  };
}
function fragment(siteId,node,epoch,revision,label='normal'){
  return buildSiteWorldFragment({
    topology:siteId===OFFICE?topology(epoch,node):topology(),
    siteId,revision,
    entities:[{id:'object:keys',type:'object',label,confidence:.9}]
  },1000+revision);
}
function change(id,frag){
  return {
    change_id:id,site_id:frag.site_id,authority_device_id:frag.authority_device_id,
    authority_epoch:frag.authority_epoch,revision:frag.revision,fragment:frag
  };
}

test('authority epoch outranks world revision after a legitimate handoff',()=>{
  let state=createFederatedWorldState();
  const old=fragment(OFFICE,NODE_B,1,100,'old authority');
  state=applySiteWorldFragment(state,old,topology(1,NODE_B),1000).state;
  const replacement=fragment(OFFICE,NODE_C,2,1,'new authority');
  const result=applySiteWorldFragment(state,replacement,topology(2,NODE_C),1100);
  assert.equal(result.changed,true);
  assert.equal(result.fragment.authority_epoch,2);
  assert.equal(result.fragment.revision,1);
});

test('older authority epoch is stale even when its world revision is larger',()=>{
  assert.equal(compareFederationVersion({authority_epoch:1,revision:999},{authority_epoch:2,revision:1}),-1);
  assert.equal(compareFederationVersion({authority_epoch:3,revision:1},{authority_epoch:2,revision:999}),1);
});

test('remote delta advances cursor and preserves remote sites as read-only',()=>{
  let state=createFederationSyncState(0);
  const office=fragment(OFFICE,NODE_B,1,5);
  const result=applyFederationDelta(state,{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:0,
    changes:[change(4,office)],next_cursor:6,has_more:false
  },{localSiteIds:[HOME]});
  state=result.state;
  assert.equal(result.applied,1);
  assert.equal(result.cursor,6);
  const snapshot=federationRemoteSnapshot(state);
  assert.equal(snapshot.sites.length,1);
  assert.equal(snapshot.sites[0].site_id,OFFICE);
  assert.equal(snapshot.remote_only,true);
  assert.equal(snapshot.read_only,true);
});

test('global change ids may contain gaps after Cloud filters local-site changes',()=>{
  const office=fragment(OFFICE,NODE_B,1,7);
  const result=applyFederationDelta(createFederationSyncState(10),{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:10,
    changes:[change(14,office)],next_cursor:15
  },{localSiteIds:[HOME]});
  assert.equal(result.applied,1);
  assert.equal(result.cursor,15);
});

test('remote sync never overwrites a locally authoritative site',()=>{
  const home=fragment(HOME,NODE_A,1,8);
  const result=applyFederationDelta(createFederationSyncState(),{
    protocol:FEDERATION_SYNC_PROTOCOL,changes:[change(1,home)],next_cursor:1
  },{localSiteIds:[HOME]});
  assert.equal(result.applied,0);
  assert.equal(result.localSkipped,1);
  assert.equal(Object.keys(result.state.remoteSites).length,0);
});

test('higher authority epoch replaces remote mirror even with reset revision',()=>{
  let state=createFederationSyncState();
  const old=fragment(OFFICE,NODE_B,1,80,'old');
  state=applyFederationDelta(state,{
    protocol:FEDERATION_SYNC_PROTOCOL,changes:[change(1,old)],next_cursor:1
  }).state;
  const next=fragment(OFFICE,NODE_C,2,1,'new');
  const result=applyFederationDelta(state,{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:1,changes:[change(2,next)],next_cursor:2
  });
  assert.equal(result.applied,1);
  assert.equal(result.state.remoteSites[OFFICE].authority_epoch,2);
  assert.equal(result.state.remoteSites[OFFICE].revision,1);
});

test('older epoch/revision updates are stale, same tuple conflict is rejected',()=>{
  let state=createFederationSyncState();
  const current=fragment(OFFICE,NODE_C,2,10,'current');
  state=applyFederationDelta(state,{protocol:FEDERATION_SYNC_PROTOCOL,changes:[change(1,current)],next_cursor:1}).state;

  const oldEpoch=fragment(OFFICE,NODE_B,1,99,'old');
  let result=applyFederationDelta(state,{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:1,changes:[change(2,oldEpoch)],next_cursor:2
  });
  assert.equal(result.stale,1);
  state=result.state;

  const oldRevision=fragment(OFFICE,NODE_C,2,9,'old revision');
  result=applyFederationDelta(state,{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:2,changes:[change(3,oldRevision)],next_cursor:3
  });
  assert.equal(result.stale,1);

  const conflict=fragment(OFFICE,NODE_C,2,10,'conflict');
  assert.throws(()=>applyFederationDelta(result.state,{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:3,changes:[change(4,conflict)],next_cursor:4
  }),/conflicts/);
});

test('replayed global changes are idempotent and cursor never moves backward',()=>{
  const office=fragment(OFFICE,NODE_B,1,2);
  let state=applyFederationDelta(createFederationSyncState(),{
    protocol:FEDERATION_SYNC_PROTOCOL,changes:[change(5,office)],next_cursor:5
  }).state;
  let result=applyFederationDelta(state,{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:5,changes:[change(5,office)],next_cursor:5
  });
  assert.equal(result.idempotent,1);
  assert.throws(()=>applyFederationDelta(result.state,{
    protocol:FEDERATION_SYNC_PROTOCOL,from_cursor:5,changes:[],next_cursor:4
  }),/backwards/);
});

test('change envelope must match the included authoritative fragment',()=>{
  const office=fragment(OFFICE,NODE_B,1,3);
  assert.throws(()=>applyFederationDelta(createFederationSyncState(),{
    protocol:FEDERATION_SYNC_PROTOCOL,
    changes:[{...change(1,office),authority_epoch:2}],next_cursor:1
  }),/envelope does not match/);
});
