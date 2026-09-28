import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFederationAccessOperations,explainFederationAccess,federationAccessOperationsCapability,FEDERATION_ACCESS_OPERATIONS_PROTOCOL} from '../src/federation-access-operations-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const PERSON='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture(){
  return {
    local_site_id:HOME,
    topology:{sites:[
      {id:HOME,label:'Home',authority_device_id:DEVICE,authority_epoch:4},
      {id:OFFICE,label:'Office',authority_device_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',authority_epoch:2}
    ]},
    sync_visibility:{local_site_id:HOME,sites:[
      {site_id:HOME,status:'current',fresh:true},
      {site_id:OFFICE,status:'partitioned',fresh:false,stale_age_ms:300000,reconciliation_required:true}
    ]},
    policy:{
      protocol:'physical_federation_policy.v1',revision:11,revocation_epoch:9,
      sites:[{site_id:HOME,revision:3,mode:'household',allow_federation:true,allow_remote_observation:true,allowed_peer_sites:[OFFICE]}],
      grants:[
        {source_site_id:HOME,destination_site_id:OFFICE,scope:'semantic_world_read',status:'granted',revision:4,reason:'share world'},
        {source_site_id:HOME,destination_site_id:OFFICE,scope:'identity_continuity_read',status:'granted',revision:3,reason:'share identity'},
        {source_site_id:HOME,destination_site_id:OFFICE,scope:'agent_context_read',status:'granted',revision:2},
        {source_site_id:HOME,destination_site_id:OFFICE,scope:'remote_observation',status:'granted',revision:2},
        {source_site_id:HOME,destination_site_id:OFFICE,scope:'history_query',status:'revoked',revision:5}
      ],
      consents:[
        {site_id:HOME,canonical_identity_id:PERSON,scope:'person_recognition',status:'granted',revision:4},
        {site_id:HOME,canonical_identity_id:PERSON,scope:'voice_matching',status:'granted',revision:2},
        {site_id:HOME,canonical_identity_id:PERSON,scope:'identity_linking',status:'denied',revision:3}
      ],
      revocations:[
        {revocation_key:'grant:'+HOME+'|'+OFFICE+'|semantic_world_read',revision:5,revocation_epoch:8,reason:'revoked during partition'},
        {revocation_key:'consent:'+HOME+'|'+PERSON+'|person_recognition',revision:5,revocation_epoch:9,reason:'recognition revoked'}
      ]
    },
    history:[
      {event_id:'h1',event_type:'permission_revoked',governing_site_id:HOME,revision:10,revocation_epoch:8,occurred_at:1000,detail:{scope:'semantic_world_read'}},
      {event_id:'h2',event_type:'recognition_consent_revoked',governing_site_id:HOME,revision:11,revocation_epoch:9,occurred_at:1100,detail:{scope:'person_recognition'}}
    ]
  };
}

test('revocation tombstone suppresses stale remote grant even while peer is partitioned',()=>{
  const report=buildFederationAccessOperations(fixture(),2000);
  assert.equal(report.protocol,FEDERATION_ACCESS_OPERATIONS_PROTOCOL);
  const grant=report.grants.find(x=>x.scope==='semantic_world_read');
  assert.equal(grant.status,'revoked');
  assert.equal(grant.effective_allowed,false);
  assert.equal(grant.stale_grant_suppressed,true);
  assert.equal(report.peers[0].sync.status,'partitioned');
  assert.equal(report.peers[0].revocation_protection.revocation_wins,true);
});

test('consent tombstone suppresses recognition while other scopes can remain granted',()=>{
  const report=buildFederationAccessOperations(fixture(),2000);
  const person=report.identities.find(x=>x.canonical_identity_id===PERSON);
  const recognition=person.consents.find(x=>x.scope==='person_recognition');
  assert.equal(recognition.status,'revoked');
  assert.equal(recognition.effective_allowed,false);
  assert.equal(person.state,'revoked');
});

test('category explanation distinguishes limited access',()=>{
  const data=fixture();data.policy.revocations=[];
  const report=buildFederationAccessOperations(data,2000);
  const decision=explainFederationAccess(report,{destination_site_id:OFFICE,category:'federation_sharing'});
  assert.equal(decision.state,'allowed');
  data.policy.grants=data.policy.grants.filter(x=>x.scope!=='identity_continuity_read');
  const limited=explainFederationAccess(buildFederationAccessOperations(data,2000),{destination_site_id:OFFICE,category:'federation_sharing'});
  assert.equal(limited.state,'limited');
  assert.equal(limited.allowed,false);
});

test('expired consent is represented when lifecycle timestamp is present',()=>{
  const data=fixture();data.policy.revocations=[];
  data.policy.consents=[{site_id:HOME,canonical_identity_id:PERSON,scope:'person_recognition',status:'granted',revision:2,expires_at_ms:1500}];
  const report=buildFederationAccessOperations(data,2000);
  assert.equal(report.consents[0].status,'expired');
  assert.equal(report.consents[0].effective_allowed,false);
});

test('history remains immutable and sorted newest first',()=>{
  const report=buildFederationAccessOperations(fixture(),2000);
  assert.deepEqual(report.history.map(x=>x.event_id),['h2','h1']);
  assert(report.history.every(x=>x.immutable));
});

test('capability keeps Cloud and paired apps read-only',()=>{
  const cap=federationAccessOperationsCapability();
  assert.equal(cap.revocation_wins,true);
  assert.equal(cap.stale_remote_grant_can_restore_access,false);
  assert.equal(cap.cloud_read_only,true);
  assert.equal(cap.paired_apps_read_only,true);
  assert.equal(cap.authority_mutation,false);
});
