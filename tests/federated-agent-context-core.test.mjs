import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEDERATED_AGENT_CONTEXT_PROTOCOL,
  buildFederatedAgentContext,
  cloudFederatedAgentContext
} from '../src/federated-agent-context-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const NODE_HOME='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_OFFICE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERSON='44444444-4444-4444-8444-444444444444';
const POCKET='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOME_DAVE='site:'+HOME+'::person%3Adave';
const OFFICE_DAVE='site:'+OFFICE+'::person%3Adave';

function fixture(now=2_000_000){
  return {
    topology:{
      sites:[
        {id:HOME,label:'Home',status:'active',authority_device_id:NODE_HOME,authority_epoch:3},
        {id:OFFICE,label:'Office',status:'active',authority_device_id:NODE_OFFICE,authority_epoch:7}
      ]
    },
    federatedWorld:{
      sites:[
        {
          site_id:HOME,revision:5,observed_at:now-20_000,
          entities:[{ref:HOME_DAVE,local_id:'person:dave',type:'person',state:'observed',confidence:.97,observed_at:now-20_000}],
          relations:[{subject_ref:HOME_DAVE,predicate:'present_in',object_ref:'site:'+HOME+'::room%3Akitchen',confidence:.96,temporal_state:'current',as_of:now-20_000}],
          context:{recent_changes:['Front door opened']}
        },
        {
          site_id:OFFICE,revision:8,observed_at:now-200_000,
          entities:[{ref:OFFICE_DAVE,local_id:'person:dave',type:'person',state:'last-known',confidence:.91,observed_at:now-200_000}],
          relations:[{subject_ref:OFFICE_DAVE,predicate:'present_in',object_ref:'site:'+OFFICE+'::room%3Adesk',confidence:.90,temporal_state:'historical',as_of:now-200_000}],
          context:{recent_changes:['Desk camera recalibrated']}
        }
      ]
    },
    federationSync:{peers:[{site_id:OFFICE,status:'current'}]},
    identityContinuity:{
      identities:[{
        canonical_identity_id:PERSON,entity_type:'person',status:'active',
        aliases:['Dave'],members:[HOME_DAVE,OFFICE_DAVE]
      }]
    },
    mobileTransitions:{transitions:[]},
    localSiteId:HOME,
    focusCanonicalIdentityId:PERSON,
    focusMobileSubjectIds:[POCKET],
    reconciliationState:'current'
  };
}

test('selects one current site and exposes exact authority',()=>{
  const now=2_000_000;
  const c=buildFederatedAgentContext(fixture(now),now);
  assert.equal(c.protocol,FEDERATED_AGENT_CONTEXT_PROTOCOL);
  assert.equal(c.agent_state,'current');
  assert.equal(c.physical_state,'present');
  assert.equal(c.current_site.site_id,HOME);
  assert.equal(c.authority.site_id,HOME);
  assert.equal(c.authority.device_id,NODE_HOME);
  assert.equal(c.authority.epoch,3);
  assert.equal(c.focus_identity.canonical_identity_id,PERSON);
  assert.equal(c.location_conflicts.length,0);
});

test('conflicting current observations produce uncertainty instead of invented location',()=>{
  const now=2_000_000;
  const f=fixture(now);
  f.federatedWorld.sites[1].observed_at=now-15_000;
  f.federatedWorld.sites[1].entities[0].state='observed';
  f.federatedWorld.sites[1].entities[0].confidence=.96;
  f.federatedWorld.sites[1].entities[0].observed_at=now-15_000;
  f.federatedWorld.sites[1].relations[0].temporal_state='current';
  f.federatedWorld.sites[1].relations[0].confidence=.95;
  f.federatedWorld.sites[1].relations[0].as_of=now-15_000;
  const c=buildFederatedAgentContext(f,now);
  assert.equal(c.agent_state,'stale');
  assert.equal(c.physical_state,'uncertain');
  assert.equal(c.current_site,null);
  assert.ok(c.location_conflicts.length>=2);
  assert.equal(c.explainability.no_location_invention,true);
});

test('active mobile transition supersedes static location and preserves source authority',()=>{
  const now=2_000_000;
  const f=fixture(now);
  f.mobileTransitions.transitions=[{
    transition_id:'trip-1',subject_kind:'mobile_device',subject_id:POCKET,
    source_site_id:HOME,destination_site_id:OFFICE,state:'in_transit',
    confidence:.88,updated_at:now-1000
  }];
  const c=buildFederatedAgentContext(f,now);
  assert.equal(c.physical_state,'in_transit');
  assert.equal(c.current_site,null);
  assert.equal(c.authority.site_id,HOME);
  assert.equal(c.authority.device_id,NODE_HOME);
  assert.equal(c.authority.basis,'active_mobile_transition');
  assert.equal(c.active_mobile_transition.destination_site_id,OFFICE);
  assert.equal(c.explainability.no_location_invention,true);
});

test('temporary context stays non-authoritative',()=>{
  const now=2_000_000;
  const f=fixture(now);
  f.mobileTransitions.transitions=[{
    transition_id:'trip-2',subject_kind:'mobile_device',subject_id:POCKET,
    source_site_id:HOME,destination_site_id:'',state:'temporary_context',
    confidence:.75,updated_at:now-1000,
    temporary_context:{id:'hotel-410',label:'Hotel room',confidence:.8,durable_site:true,site_authority:true}
  }];
  const c=buildFederatedAgentContext(f,now);
  assert.equal(c.physical_state,'temporary_context');
  assert.equal(c.current_site,null);
  assert.equal(c.active_mobile_transition.temporary_context.durable_site,false);
  assert.equal(c.active_mobile_transition.temporary_context.site_authority,false);
  assert.equal(c.authority.site_id,HOME);
});

test('reconciling state gates otherwise current context',()=>{
  const now=2_000_000;
  const f=fixture(now);
  f.reconciliationState='reconciling';
  const c=buildFederatedAgentContext(f,now);
  assert.equal(c.agent_state,'reconciling');
  assert.equal(c.current_site.site_id,HOME);
  assert.equal(c.explainability.reconciliation_state,'reconciling');
});

test('stale authority site marks Agent context stale',()=>{
  const now=2_000_000;
  const f=fixture(now);
  f.siteStaleAgeMs=60_000;
  f.federatedWorld.sites[0].observed_at=now-120_000;
  f.federatedWorld.sites[0].entities[0].observed_at=now-120_000;
  f.federatedWorld.sites[0].relations[0].as_of=now-120_000;
  const c=buildFederatedAgentContext(f,now);
  assert.equal(c.agent_state,'stale');
  assert.equal(c.sites.find(s=>s.site_id===HOME).freshness,'stale');
});

test('reports revisions that changed elsewhere since prior snapshot',()=>{
  const now=2_000_000;
  const f=fixture(now);
  f.previousContext={site_revisions:{[HOME]:5,[OFFICE]:7}};
  const c=buildFederatedAgentContext(f,now);
  assert.equal(c.changed_elsewhere.length,1);
  assert.equal(c.changed_elsewhere[0].site_id,OFFICE);
  assert.equal(c.changed_elsewhere[0].from_revision,7);
  assert.equal(c.changed_elsewhere[0].to_revision,8);
  assert.deepEqual(c.changed_elsewhere[0].recent_changes,['Desk camera recalibrated']);
});

test('no focus identity means no inferred person location',()=>{
  const now=2_000_000;
  const f=fixture(now);
  delete f.focusCanonicalIdentityId;
  const c=buildFederatedAgentContext(f,now);
  assert.equal(c.focus_identity,null);
  assert.equal(c.current_site,null);
  assert.equal(c.physical_state,'unknown');
  assert.equal(c.explainability.no_location_invention,true);
});

test('Cloud context is summary-only and read-only',()=>{
  const now=2_000_000;
  const c=cloudFederatedAgentContext(fixture(now),now);
  assert.equal(c.summary_only,true);
  assert.equal(c.cloud_read_only,true);
  assert.equal(c.context_mutation_authority,false);
  assert.equal(c.site_authority_mutation,false);
  assert.equal(c.sites[0].local,undefined);
  assert.equal(c.sites[0].age_ms,undefined);
});
