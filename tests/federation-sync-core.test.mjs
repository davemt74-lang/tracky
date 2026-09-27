import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSiteWorldFragment,
  createFederatedWorldState,
  applySiteWorldFragment
} from '../src/federated-world-core.js';
import {
  FEDERATION_SYNC_PROTOCOL,
  createFederationSyncState,
  buildFederationEnvelope,
  applyFederationEnvelope,
  buildFederationBatch,
  acknowledgeFederationBatch,
  federationSyncStatus
} from '../src/federation-sync-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const CABIN='33333333-3333-4333-8333-333333333333';
const NODE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NODE_C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function topology(revision=12){
  return {
    protocol:'physical_site_topology.v1',
    revision,
    sites:[
      {id:HOME,status:'active',authorityDeviceId:NODE_A,authorityEpoch:2},
      {id:OFFICE,status:'active',authorityDeviceId:NODE_B,authorityEpoch:4},
      {id:CABIN,status:'active',authorityDeviceId:NODE_C,authorityEpoch:1}
    ],
    relationships:[
      {subjectId:HOME,type:'peers_with',objectId:OFFICE},
      {subjectId:HOME,type:'bridges_to',objectId:CABIN}
    ]
  };
}

function fragment(siteId,revision=1,label='keys',topo=topology()){
  const node=siteId===HOME?NODE_A:siteId===OFFICE?NODE_B:NODE_C;
  const epoch=siteId===HOME?2:siteId===OFFICE?4:1;
  const scoped=structuredClone(topo);
  const site=scoped.sites.find(x=>x.id===siteId);
  site.authorityDeviceId=node;site.authorityEpoch=epoch;
  return buildSiteWorldFragment({
    topology:scoped,siteId,revision,observedAt:1000+revision,
    entities:[{id:'object:'+label,type:'object',label,confidence:.9,state:'observed'}],
    context:{summary:'semantic'}
  },1000+revision);
}

test('builds authority-bound federation envelopes only for approved peers',()=>{
  const env=buildFederationEnvelope({
    fragment:fragment(HOME,5),topology:topology(),destinationSiteId:OFFICE
  },2000);
  assert.equal(env.protocol,FEDERATION_SYNC_PROTOCOL);
  assert.equal(env.source_site_id,HOME);
  assert.equal(env.destination_site_id,OFFICE);
  assert.equal(env.source_authority_device_id,NODE_A);
  assert.equal(env.source_authority_epoch,2);
  assert.equal(env.source_world_revision,5);
  assert.match(env.envelope_id,/^fed:/);
  assert.throws(()=>buildFederationEnvelope({
    fragment:fragment(OFFICE,5),topology:topology(),destinationSiteId:CABIN
  }),/not federated peers/);
});

test('applies a remote authoritative fragment and advances its receive cursor',()=>{
  const topo=topology();
  const env=buildFederationEnvelope({fragment:fragment(HOME,7),topology:topo,destinationSiteId:OFFICE},2100);
  const result=applyFederationEnvelope(
    createFederationSyncState({localSiteId:OFFICE}),
    createFederatedWorldState(),
    env,topo,{localSiteId:OFFICE},2200
  );
  assert.equal(result.status,'applied');
  assert.equal(result.changed,true);
  assert.equal(result.worldState.sites[HOME].revision,7);
  const status=federationSyncStatus(result.state);
  assert.equal(status.peers[0].last_received_revision,7);
  assert.equal(status.quarantine_count,0);
});

test('stale replay is ignored and exact replay is idempotent',()=>{
  const topo=topology();
  let sync=createFederationSyncState({localSiteId:OFFICE});
  let world=createFederatedWorldState();
  const current=buildFederationEnvelope({fragment:fragment(HOME,9),topology:topo,destinationSiteId:OFFICE},2300);
  let r=applyFederationEnvelope(sync,world,current,topo,{localSiteId:OFFICE},2310);
  sync=r.state;world=r.worldState;
  r=applyFederationEnvelope(sync,world,current,topo,{localSiteId:OFFICE},2320);
  assert.equal(r.status,'idempotent');
  r=applyFederationEnvelope(r.state,r.worldState,buildFederationEnvelope({
    fragment:fragment(HOME,8),topology:topo,destinationSiteId:OFFICE
  },2330),topo,{localSiteId:OFFICE},2340);
  assert.equal(r.status,'stale');
  assert.equal(r.worldState.sites[HOME].revision,9);
});

test('same site revision with a different semantic fingerprint is quarantined',()=>{
  const topo=topology();
  let sync=createFederationSyncState({localSiteId:OFFICE});
  let world=createFederatedWorldState();
  const first=buildFederationEnvelope({fragment:fragment(HOME,10,'keys'),topology:topo,destinationSiteId:OFFICE},2400);
  let r=applyFederationEnvelope(sync,world,first,topo,{localSiteId:OFFICE},2410);
  const conflict=buildFederationEnvelope({fragment:fragment(HOME,10,'wallet'),topology:topo,destinationSiteId:OFFICE},2420);
  r=applyFederationEnvelope(r.state,r.worldState,conflict,topo,{localSiteId:OFFICE},2430);
  assert.equal(r.status,'quarantined');
  assert.equal(r.quarantine.reason,'revision_conflict');
  assert.equal(r.worldState.sites[HOME].entities[0].local_id,'object:keys');
});

test('authority epoch mismatch is quarantined rather than last-write-wins',()=>{
  const oldTopology=topology(12);
  const old=buildFederationEnvelope({fragment:fragment(HOME,11,'keys',oldTopology),topology:oldTopology,destinationSiteId:OFFICE},2500);
  const newTopology=topology(13);
  newTopology.sites.find(x=>x.id===HOME).authorityDeviceId=NODE_C;
  newTopology.sites.find(x=>x.id===HOME).authorityEpoch=3;
  const result=applyFederationEnvelope(
    createFederationSyncState({localSiteId:OFFICE}),createFederatedWorldState(),
    old,newTopology,{localSiteId:OFFICE},2510
  );
  assert.equal(result.status,'quarantined');
  assert.equal(result.quarantine.reason,'authority_mismatch');
});

test('topology-ahead envelopes hold until authority can be verified',()=>{
  const newer=topology(20);
  const env=buildFederationEnvelope({fragment:fragment(HOME,12,'keys',newer),topology:newer,destinationSiteId:OFFICE},2600);
  const older=topology(19);
  let r=applyFederationEnvelope(
    createFederationSyncState({localSiteId:OFFICE}),createFederatedWorldState(),
    env,older,{localSiteId:OFFICE},2610
  );
  assert.equal(r.status,'held_topology_ahead');
  assert.equal(r.quarantine.reason,'topology_ahead');
  r=applyFederationEnvelope(r.state,r.worldState,env,newer,{localSiteId:OFFICE},2620);
  assert.equal(r.status,'applied');
});

test('unapproved peer and wrong-destination envelopes cannot alter local world',()=>{
  const topo=topology();
  const cabinEnv=buildFederationEnvelope({fragment:fragment(CABIN,3),topology:topo,destinationSiteId:HOME},2700);
  const unapproved=applyFederationEnvelope(
    createFederationSyncState({localSiteId:OFFICE}),createFederatedWorldState(),
    cabinEnv,topo,{localSiteId:OFFICE},2710
  );
  assert.equal(unapproved.status,'ignored_wrong_destination');

  const direct={...cabinEnv,destination_site_id:OFFICE};
  const rejected=applyFederationEnvelope(
    createFederationSyncState({localSiteId:OFFICE}),createFederatedWorldState(),
    direct,topo,{localSiteId:OFFICE},2720
  );
  assert.equal(rejected.status,'quarantined');
  assert.equal(rejected.quarantine.reason,'source_not_federated');
});

test('outbound batch cursors prevent resend after explicit acknowledgement',()=>{
  const topo=topology();
  let world=createFederatedWorldState();
  world=applySiteWorldFragment(world,fragment(HOME,14),topo,2800).state;
  let sync=createFederationSyncState({localSiteId:HOME});
  let built=buildFederationBatch({
    syncState:sync,worldState:world,topology:topo,localSiteId:HOME,destinationSiteId:OFFICE
  },2810);
  sync=built.syncState;
  assert.equal(built.batch.envelopes.length,1);
  assert.equal(built.batch.envelopes[0].source_world_revision,14);
  sync=acknowledgeFederationBatch(sync,{
    destinationSiteId:OFFICE,
    acknowledgements:[{siteId:HOME,revision:14}]
  },2820);
  built=buildFederationBatch({
    syncState:sync,worldState:world,topology:topo,localSiteId:HOME,destinationSiteId:OFFICE
  },2830);
  assert.equal(built.batch.envelopes.length,0);
});

test('invalid federation fragments are quarantined without throwing into sync loop',()=>{
  const result=applyFederationEnvelope(
    createFederationSyncState({localSiteId:OFFICE}),createFederatedWorldState(),
    {protocol:FEDERATION_SYNC_PROTOCOL,source_site_id:HOME},
    topology(),{localSiteId:OFFICE},2900
  );
  assert.equal(result.status,'quarantined');
  assert.equal(result.quarantine.reason,'invalid_fragment');
});
