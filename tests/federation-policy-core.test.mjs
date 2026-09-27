import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEDERATION_POLICY_PROTOCOL,
  createFederationPolicyState,
  setFederatedSitePolicy,
  grantFederationPermission,
  revokeFederationPermission,
  setRecognitionConsent,
  federationPermissionDecision,
  recognitionDecision,
  filterFederatedPayloadForDestination,
  cloudFederationPolicyProjection
} from '../src/federation-policy-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const CABIN='33333333-3333-4333-8333-333333333333';
const PERSON='44444444-4444-4444-8444-444444444444';

function base(){
  let state=createFederationPolicyState(1000);
  state=setFederatedSitePolicy(state,{
    siteId:HOME,mode:'household',allowFederation:true,allowRemoteObservation:false,
    allowedPeerSites:[OFFICE]
  },1100).state;
  return state;
}

test('federation is deny-by-default',()=>{
  const state=createFederationPolicyState();
  const d=federationPermissionDecision(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read'});
  assert.equal(d.allowed,false);
  assert.equal(d.reason,'source_site_policy_missing');
});

test('allowed peer still needs explicit scope grant',()=>{
  const state=base();
  const d=federationPermissionDecision(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read'});
  assert.equal(d.allowed,false);
  assert.equal(d.reason,'permission_not_granted');
});

test('explicit site grant enables only the named scope and destination',()=>{
  let state=base();
  state=grantFederationPermission(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read'
  },1200).state;
  assert.equal(federationPermissionDecision(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read'}).allowed,true);
  assert.equal(federationPermissionDecision(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'agent_context_read'}).allowed,false);
  assert.equal(federationPermissionDecision(state,{sourceSiteId:HOME,destinationSiteId:CABIN,scope:'semantic_world_read'}).allowed,false);
});

test('remote observation requires both site enablement and explicit grant',()=>{
  let state=base();
  assert.throws(()=>grantFederationPermission(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'remote_observation'
  }),/does not permit remote observation/);

  state=setFederatedSitePolicy(state,{
    siteId:HOME,mode:'household',allowFederation:true,allowRemoteObservation:true,
    allowedPeerSites:[OFFICE]
  },1250).state;
  state=grantFederationPermission(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'remote_observation'
  },1300).state;
  assert.equal(federationPermissionDecision(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'remote_observation'}).allowed,true);
});

test('person recognition and identity linking require site-scoped consent',()=>{
  let state=base();
  state=grantFederationPermission(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'identity_linking'
  },1200).state;
  let d=federationPermissionDecision(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'identity_linking',
    canonicalIdentityId:PERSON
  });
  assert.equal(d.allowed,false);
  assert.equal(d.reason,'consent_required');

  state=setRecognitionConsent(state,{
    siteId:HOME,canonicalIdentityId:PERSON,scope:'identity_linking',status:'granted'
  },1300).state;
  d=federationPermissionDecision(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'identity_linking',
    canonicalIdentityId:PERSON
  });
  assert.equal(d.allowed,true);
  assert.equal(recognitionDecision(state,{siteId:HOME,canonicalIdentityId:PERSON,scope:'identity_linking'}).allowed,true);
});

test('consent revocation is monotonic and blocks stale re-grant',()=>{
  let state=base();
  state=setRecognitionConsent(state,{
    siteId:HOME,canonicalIdentityId:PERSON,scope:'person_recognition',status:'granted',revision:1
  },1200).state;
  state=setRecognitionConsent(state,{
    siteId:HOME,canonicalIdentityId:PERSON,scope:'person_recognition',status:'revoked',revision:2
  },1300).state;
  const revoked=recognitionDecision(state,{siteId:HOME,canonicalIdentityId:PERSON,scope:'person_recognition'});
  assert.equal(revoked.allowed,false);
  assert.equal(revoked.reason,'consent_revoked');
  assert.throws(()=>setRecognitionConsent(state,{
    siteId:HOME,canonicalIdentityId:PERSON,scope:'person_recognition',status:'granted',revision:2
  },1400),/blocked by a newer revocation/);
});

test('permission revocation immediately removes sharing and advances revocation epoch',()=>{
  let state=base();
  state=grantFederationPermission(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read',revision:1
  },1200).state;
  const before=state.revocationEpoch;
  state=revokeFederationPermission(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read',revision:2
  },1300).state;
  assert.ok(state.revocationEpoch>before);
  const d=federationPermissionDecision(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read'});
  assert.equal(d.allowed,false);
  assert.equal(d.reason,'permission_revoked');
});

test('federated payload is filtered independently per scope',()=>{
  let state=base();
  state=grantFederationPermission(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read'},1200).state;
  state=grantFederationPermission(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'agent_context_read'},1210).state;
  const out=filterFederatedPayloadForDestination(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,
    payload:{
      federated_world:{protocol:'physical_federated_world.v1',sites:[{
        site_id:HOME,
        entities:[
          {local_id:'object:keys',type:'object'},
          {local_id:'person:dave',type:'person'}
        ],
        relations:[
          {subject_local_id:'object:keys',object_local_id:'room:kitchen'},
          {subject_local_id:'person:dave',object_local_id:'room:kitchen'}
        ],
        context:{recent_changes:['Dave entered kitchen']}
      }]},
      federated_agent_context:{protocol:'physical_federated_agent_context.v1',agent_state:'current'},
      mobile_transitions:{protocol:'physical_mobile_transition.v1',transitions:[{transition_id:'t1'}]},
      identity_continuity:{protocol:'physical_identity_continuity.v1',identities:[],links:[]}
    }
  });
  assert.ok(out.federated_world);
  assert.equal(out.federated_world.sites[0].entities.length,1);
  assert.equal(out.federated_world.sites[0].entities[0].local_id,'object:keys');
  assert.equal(out.federated_world.sites[0].relations.length,1);
  assert.deepEqual(out.federated_world.sites[0].context,{});
  assert.ok(out.federated_agent_context);
  assert.ok(out.mobile_transitions);
  assert.equal(out.identity_continuity,null);
  assert.equal(out.remote_observation_allowed,false);
  assert.ok(out.denied_scopes.includes('identity_continuity_read'));
});

test('identity continuity sharing requires read grant and person identity-link consent',()=>{
  let state=base();
  state=grantFederationPermission(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'identity_continuity_read'},1200).state;
  const identity={
    protocol:'physical_identity_continuity.v1',
    identities:[{
      canonical_identity_id:PERSON,entity_type:'person',status:'active',
      members:['site:'+HOME+'::person%3Adave','site:'+OFFICE+'::person%3Adave']
    }],
    links:[{canonical_identity_id:PERSON,status:'confirmed'}]
  };
  let out=filterFederatedPayloadForDestination(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,payload:{identity_continuity:identity}
  });
  assert.equal(out.identity_continuity.identities.length,0);

  state=setRecognitionConsent(state,{
    siteId:HOME,canonicalIdentityId:PERSON,scope:'identity_linking',status:'granted'
  },1300).state;
  out=filterFederatedPayloadForDestination(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,payload:{identity_continuity:identity}
  });
  assert.equal(out.identity_continuity.identities.length,1);
});

test('raw perception keys are never accepted into federation policy filtering',()=>{
  let state=base();
  state=grantFederationPermission(state,{sourceSiteId:HOME,destinationSiteId:OFFICE,scope:'semantic_world_read'},1200).state;
  assert.throws(()=>filterFederatedPayloadForDestination(state,{
    sourceSiteId:HOME,destinationSiteId:OFFICE,payload:{federated_world:{raw_frame:'secret'}}
  }),/cannot contain raw perception data/);
});

test('Cloud policy projection is mirror/enforcer only',()=>{
  const projection=cloudFederationPolicyProjection(base());
  assert.equal(projection.protocol,FEDERATION_POLICY_PROTOCOL);
  assert.equal(projection.cloud_role,'mirror_relay_enforcer');
  assert.equal(projection.cloud_can_grant,false);
  assert.equal(projection.cloud_can_revoke,false);
  assert.equal(projection.cloud_can_change_consent,false);
  assert.equal(projection.raw_perception,false);
});
