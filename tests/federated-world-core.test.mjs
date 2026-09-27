import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEDERATED_WORLD_PROTOCOL,
  buildSiteWorldFragment,
  createFederatedWorldState,
  applySiteWorldFragment,
  federatedWorldSnapshot,
  cloudFederatedWorldSummary,
  qualifyFederatedEntityRef
} from '../src/federated-world-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const NODE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function topology(){
  return {
    protocol:'physical_site_topology.v1',
    revision:9,
    sites:[
      {id:HOME,label:'Home',status:'active',authorityDeviceId:NODE_A,authorityEpoch:2},
      {id:OFFICE,label:'Office',status:'active',authorityDeviceId:NODE_B,authorityEpoch:4}
    ]
  };
}

test('builds an authority-bound site fragment with qualified entity refs',()=>{
  const fragment=buildSiteWorldFragment({
    topology:topology(),siteId:HOME,revision:12,observedAt:2000,
    entities:[
      {id:'person:dave',type:'person',label:'Dave',state:'observed',confidence:.98,lastObservedAt:1990},
      {id:'room:office',type:'room',label:'Office',state:'user-confirmed',confidence:1,lastObservedAt:1500}
    ],
    relations:[{
      subject_id:'person:dave',predicate:'located_in',object_id:'room:office',
      confidence:.98,temporal_state:'current',source_event_id:'evt-12',sequence:12,as_of:1990
    }],
    context:{current_room:'Office'}
  },2000);
  assert.equal(fragment.protocol,FEDERATED_WORLD_PROTOCOL);
  assert.equal(fragment.site_id,HOME);
  assert.equal(fragment.authority_device_id,NODE_A);
  assert.equal(fragment.authority_epoch,2);
  assert.equal(fragment.topology_revision,9);
  assert.equal(fragment.revision,12);
  assert.equal(fragment.entities[0].ref.startsWith('site:'+HOME+'::'),true);
  assert.equal(fragment.relations[0].subject_ref,qualifyFederatedEntityRef(HOME,'person:dave'));
  assert.equal(fragment.identity_scope,'site_local');
});

test('same local identity at two sites remains distinct until Section 5 linking',()=>{
  let state=createFederatedWorldState(1000);
  const home=buildSiteWorldFragment({
    topology:topology(),siteId:HOME,revision:1,
    entities:[{id:'person:dave',type:'person',confidence:.9}]
  },1100);
  const office=buildSiteWorldFragment({
    topology:topology(),siteId:OFFICE,revision:1,
    entities:[{id:'person:dave',type:'person',confidence:.92}]
  },1200);
  state=applySiteWorldFragment(state,home,topology(),1300).state;
  state=applySiteWorldFragment(state,office,topology(),1400).state;
  const snap=federatedWorldSnapshot(state);
  const refs=snap.entities.filter((x)=>x.local_id==='person:dave').map((x)=>x.ref);
  assert.equal(refs.length,2);
  assert.notEqual(refs[0],refs[1]);
  assert.deepEqual(snap.cross_site_identity_links,[]);
  assert.equal(snap.identity_scope,'site_local');
});

test('rejects fragments whose authority device or epoch is stale',()=>{
  const fragment=buildSiteWorldFragment({topology:topology(),siteId:HOME,revision:5},1500);
  assert.throws(()=>applySiteWorldFragment(
    createFederatedWorldState(),
    {...fragment,authority_epoch:1},
    topology(),
    1600
  ),/authority does not match/);
  assert.throws(()=>applySiteWorldFragment(
    createFederatedWorldState(),
    {...fragment,authority_device_id:NODE_B},
    topology(),
    1600
  ),/authority does not match/);
});

test('site world revisions are monotonic, idempotent and conflict-safe',()=>{
  const topo=topology();
  let state=createFederatedWorldState();
  const one=buildSiteWorldFragment({
    topology:topo,siteId:HOME,revision:10,
    relations:[{subject_id:'object:keys',predicate:'located_in',object_id:'room:office',confidence:.8,sequence:10}]
  },1700);
  let result=applySiteWorldFragment(state,one,topo,1710);
  state=result.state;
  assert.equal(result.changed,true);

  result=applySiteWorldFragment(state,one,topo,1720);
  assert.equal(result.idempotent,true);
  assert.equal(result.changed,false);

  const stale=buildSiteWorldFragment({topology:topo,siteId:HOME,revision:9},1600);
  result=applySiteWorldFragment(state,stale,topo,1730);
  assert.equal(result.stale,true);
  assert.equal(result.fragment.revision,10);

  const conflict=buildSiteWorldFragment({
    topology:topo,siteId:HOME,revision:10,
    relations:[{subject_id:'object:keys',predicate:'located_in',object_id:'room:kitchen',confidence:.9,sequence:10}]
  },1700);
  assert.throws(()=>applySiteWorldFragment(state,conflict,topo,1740),/revision conflicts/);
});

test('relation-only fragments derive local entity placeholders without identity merging',()=>{
  const fragment=buildSiteWorldFragment({
    topology:topology(),siteId:HOME,revision:20,
    relations:[{subject_id:'object:cup',predicate:'located_on',object_id:'surface:desk',confidence:.7,sequence:20}]
  },1800);
  assert.deepEqual(fragment.entities.map((x)=>x.local_id),['object:cup','surface:desk']);
  assert.equal(fragment.entities.every((x)=>x.type==='entity'),true);
});

test('raw perception fields are rejected before federation',()=>{
  assert.throws(()=>buildSiteWorldFragment({
    topology:topology(),siteId:HOME,revision:2,
    entities:[{id:'person:dave',type:'person',frame_data:'private'}]
  },1900),/raw perception/);
  assert.throws(()=>buildSiteWorldFragment({
    topology:topology(),siteId:HOME,revision:2,
    context:{camera_uri:'private'}
  },1900),/raw perception/);
});

test('inactive or authority-less sites cannot publish authoritative world fragments',()=>{
  const noAuthority={protocol:'physical_site_topology.v1',revision:1,sites:[{id:HOME,status:'active',authorityDeviceId:'',authorityEpoch:0}]};
  assert.throws(()=>buildSiteWorldFragment({topology:noAuthority,siteId:HOME,revision:1}),/active authority/);
  const inactive=topology();
  inactive.sites[0].status='inactive';
  assert.throws(()=>buildSiteWorldFragment({topology:inactive,siteId:HOME,revision:1}),/Inactive site/);
});

test('Cloud projection stays semantic-only and read-only',()=>{
  let state=createFederatedWorldState();
  const fragment=buildSiteWorldFragment({
    topology:topology(),siteId:HOME,revision:30,
    entities:[{id:'object:laptop',type:'object',label:'Laptop',confidence:.9}],
    context:{environment_status:'normal'}
  },2000);
  state=applySiteWorldFragment(state,fragment,topology(),2010).state;
  const cloud=cloudFederatedWorldSummary(state);
  assert.equal(cloud.protocol,FEDERATED_WORLD_PROTOCOL);
  assert.equal(cloud.summary_only,true);
  assert.equal(cloud.cloud_read_only,true);
  assert.equal(cloud.authority_assignment,'local_only');
  assert.equal(cloud.identity_scope,'site_local');
  assert.deepEqual(cloud.cross_site_identity_links,[]);
  assert.equal(JSON.stringify(cloud).includes('frame'),false);
});
