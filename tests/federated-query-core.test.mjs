import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEDERATED_QUERY_PROTOCOL,
  executeFederatedQuery,
  federatedQueryCapability,
  normalizeFederatedHistorySnapshot,
  normalizeFederatedQuery
} from '../src/federated-query-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const NODE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fragment(site,node,revision,entities,relations=[],context={}){
  return {
    protocol:'physical_federated_world.v1',schema_version:1,site_id:site,
    authority_device_id:node,authority_epoch:1,topology_revision:8,revision,
    observed_at:String(1000+revision),entities,relations,context,
    semantic_only:true,identity_scope:'site_local'
  };
}

const home1=fragment(HOME,NODE_A,1,[
  {local_id:'object:keys',type:'object',label:'Keys',state:'observed',confidence:.9,observed_at:1001},
  {local_id:'room:kitchen',type:'room',label:'Kitchen',state:'user-confirmed',confidence:1,observed_at:1001}
],[
  {subject_local_id:'object:keys',predicate:'located_in',object_local_id:'room:kitchen',confidence:.9,temporal_state:'current',source_event_id:'h1',sequence:1,as_of:1001}
],{recent_changes:['Keys moved']});

const office1=fragment(OFFICE,NODE_B,1,[
  {local_id:'object:laptop',type:'object',label:'Laptop',state:'observed',confidence:.8,observed_at:1001},
  {local_id:'person:dave',type:'person',label:'Dave',state:'observed',confidence:.99,observed_at:1001},
  {local_id:'room:desk',type:'room',label:'Desk',state:'user-confirmed',confidence:1,observed_at:1001}
],[
  {subject_local_id:'object:laptop',predicate:'located_in',object_local_id:'room:desk',confidence:.8,temporal_state:'current',source_event_id:'o1',sequence:1,as_of:1001},
  {subject_local_id:'person:dave',predicate:'present_in',object_local_id:'room:desk',confidence:.99,temporal_state:'current',source_event_id:'o2',sequence:2,as_of:1001}
],{recent_changes:['Dave entered Office']});

const office2=fragment(OFFICE,NODE_B,2,[
  {local_id:'object:laptop',type:'object',label:'Laptop',state:'last-known',confidence:.7,observed_at:2002},
  {local_id:'person:dave',type:'person',label:'Dave',state:'observed',confidence:.98,observed_at:2002},
  {local_id:'room:shelf',type:'room',label:'Shelf',state:'user-confirmed',confidence:1,observed_at:2002}
],[
  {subject_local_id:'object:laptop',predicate:'located_on',object_local_id:'room:shelf',confidence:.7,temporal_state:'current',source_event_id:'o3',sequence:3,as_of:2002},
  {subject_local_id:'person:dave',predicate:'present_in',object_local_id:'room:shelf',confidence:.98,temporal_state:'current',source_event_id:'o4',sequence:4,as_of:2002}
],{recent_changes:['Dave moved']});

function context(scopes=[]){
  return {
    localSiteId:HOME,
    currentSites:[home1,office2],
    history:[
      {fragment:home1,observed_at_ms:1001,source:'local'},
      {fragment:office1,observed_at_ms:1001,source:'relay'},
      {fragment:office2,observed_at_ms:2002,source:'relay'}
    ],
    permissionDecision(source,destination,scope){
      return {
        allowed:source===HOME || (source===OFFICE && destination===HOME && scopes.includes(scope)),
        reason:scopes.includes(scope)?'explicit_site_grant':'permission_not_granted',
        grant_revision:1,policy_revision:1,revocation_epoch:0
      };
    }
  };
}

test('normalizes deterministic site-qualified query contract',()=>{
  const target='site:'+HOME+'::object%3Akeys';
  const a=normalizeFederatedQuery({intent:'where_is',site_id:HOME,target_ref:target},{localSiteId:HOME});
  const b=normalizeFederatedQuery({intent:'where_is',site_id:HOME,target_ref:target},{localSiteId:HOME});
  assert.equal(a.protocol,FEDERATED_QUERY_PROTOCOL);
  assert.equal(a.query_id,b.query_id);
  assert.equal(a.target_local_id,'object:keys');
  assert.equal(a.read_only,true);
});

test('local current and where-is queries remain available',()=>{
  const result=executeFederatedQuery({
    intent:'where_is',site_id:HOME,target_ref:'site:'+HOME+'::object%3Akeys'
  },context());
  assert.equal(result.status,'ok');
  assert.equal(result.results[0].data.entity.label,'Keys');
  assert.equal(result.results[0].data.location.object_local_id,'room:kitchen');
  assert.equal(result.explainability.no_location_invention,true);
});

test('remote current world is deny-by-default',()=>{
  const denied=executeFederatedQuery({intent:'current_state',site_id:OFFICE},context());
  assert.equal(denied.status,'denied');
  assert.equal(denied.denied[0].reason,'permission_not_granted');

  const allowed=executeFederatedQuery({intent:'current_state',site_id:OFFICE},context(['semantic_world_read']));
  assert.equal(allowed.status,'ok');
  const f=allowed.results[0].data.fragment;
  assert.equal(Object.keys(f.context).length,0);
  assert.deepEqual(f.entities.map(x=>x.local_id).sort(),['object:laptop','room:shelf']);
  assert.ok(!f.entities.some(x=>x.type==='person'));
});

test('remote history requires both current-world and history grants',()=>{
  const target='site:'+OFFICE+'::object%3Alaptop';
  const denied=executeFederatedQuery({intent:'history',site_id:OFFICE,target_ref:target},context(['semantic_world_read']));
  assert.equal(denied.status,'denied');
  assert.equal(denied.denied[0].reason,'permission_not_granted');

  const allowed=executeFederatedQuery({intent:'history',site_id:OFFICE,target_ref:target,limit:10},context(['semantic_world_read','history_query']));
  assert.equal(allowed.status,'ok');
  assert.equal(allowed.results[0].data.snapshots.length,2);
  assert.deepEqual(allowed.results[0].data.snapshots.map(x=>x.world_revision),[1,2]);
});

test('cross-site person query stays on identity-continuity channel',()=>{
  const result=executeFederatedQuery({
    intent:'last_seen',site_id:OFFICE,target_ref:'site:'+OFFICE+'::person%3Adave'
  },context(['semantic_world_read','history_query']));
  assert.equal(result.status,'denied');
  assert.equal(result.denied[0].reason,'person_query_requires_identity_continuity');
});

test('what-changed is evidence-backed and redacted',()=>{
  const result=executeFederatedQuery({intent:'what_changed',site_id:OFFICE},context(['semantic_world_read','history_query']));
  assert.equal(result.status,'ok');
  const changes=result.results[0].data.changes;
  assert.ok(changes.changed.some(x=>x.local_id==='object:laptop'));
  assert.ok(!JSON.stringify(changes).includes('person:dave'));
  assert.equal(result.results[0].data.from.world_revision,1);
  assert.equal(result.results[0].data.to.world_revision,2);
});

test('history snapshot rejects raw perception fields',()=>{
  assert.throws(()=>normalizeFederatedHistorySnapshot({
    fragment:{...home1,frame:'secret'}
  }),/raw perception/i);
});

test('capability documents Section 8 boundaries',()=>{
  const cap=federatedQueryCapability();
  assert.equal(cap.protocol,FEDERATED_QUERY_PROTOCOL);
  assert.equal(cap.deny_by_default,true);
  assert.equal(cap.person_world_federation,false);
  assert.equal(cap.authority_mutation,false);
  assert.ok(cap.boundaries.includes('history-deny-by-default'));
  assert.ok(cap.boundaries.includes('cloud-mirror-only'));
});
