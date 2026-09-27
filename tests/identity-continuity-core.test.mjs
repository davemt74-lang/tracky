import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_CONTINUITY_PROTOCOL,
  createIdentityContinuityState,
  proposeIdentityLink,
  addIdentityEvidence,
  evaluateIdentityLink,
  rejectIdentityLink,
  splitIdentityLink,
  revokeCanonicalIdentity,
  addIdentityAlias,
  resolveCanonicalIdentity,
  identityContinuitySnapshot,
  cloudIdentityContinuityProjection
} from '../src/identity-continuity-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const CABIN='33333333-3333-4333-8333-333333333333';
const DAVE_HOME='site:'+HOME+'::person%3Adave';
const DAVE_OFFICE='site:'+OFFICE+'::person%3Adave';
const DAVE_CABIN='site:'+CABIN+'::person%3Adave';
const PHONE_HOME='site:'+HOME+'::device%3Aphone';
const PHONE_OFFICE='site:'+OFFICE+'::device%3Aphone';

function proposePerson(state=createIdentityContinuityState(),left=DAVE_HOME,right=DAVE_OFFICE,canonicalIdentityId){
  return proposeIdentityLink(state,{leftRef:left,rightRef:right,entityType:'person',canonicalIdentityId},1000);
}

test('person links remain proposed without consent and independent evidence',()=>{
  let {state}=proposePerson();
  state=addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'recognition_match',source:'home-face-v1',sourceClass:'biometric',confidence:.99}
  },1100).state;
  const evaluated=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1200);
  assert.equal(evaluated.eligible,false);
  assert.equal(evaluated.link.status,'proposed');
  assert.equal(evaluated.reason,'identity_linking_consent_required');
});

test('person auto-link requires consent plus two independent high-confidence sources',()=>{
  let {state,link}=proposePerson();
  const canonical=link.canonical_identity_id;
  state=addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{
      type:'recognition_match',source:'face-model',sourceClass:'biometric',confidence:.97,
      consentScope:{identity_linking_allowed:true}
    }
  },1100).state;
  let evaluated=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1150);
  assert.equal(evaluated.eligible,false);
  assert.equal(evaluated.reason,'insufficient_independent_person_evidence');

  state=addIdentityEvidence(evaluated.state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{
      type:'voice_profile_match',source:'voice-profile',sourceClass:'enrollment',confidence:.96,
      consentScope:{identity_linking_allowed:true}
    }
  },1200).state;
  evaluated=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1300);
  assert.equal(evaluated.eligible,true);
  assert.equal(evaluated.link.status,'confirmed');
  assert.equal(evaluated.link.auto_confirmed,true);
  assert.equal(evaluated.identity.canonical_identity_id,canonical);
  assert.deepEqual(evaluated.identity.members.sort(),[DAVE_HOME,DAVE_OFFICE].sort());
  assert.equal(resolveCanonicalIdentity(evaluated.state,DAVE_HOME).canonical_identity_id,canonical);
});

test('user confirmation can confirm a proposed person link directly',()=>{
  let {state}=proposePerson();
  state=addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1100).state;
  const r=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1200);
  assert.equal(r.eligible,true);
  assert.equal(r.reason,'user_confirmed');
  assert.equal(r.link.auto_confirmed,false);
});

test('stable device credentials can link the same mobile device across sites',()=>{
  let {state}=proposeIdentityLink(createIdentityContinuityState(),{
    leftRef:PHONE_HOME,rightRef:PHONE_OFFICE,entityType:'device'
  },1000);
  state=addIdentityEvidence(state,{
    leftRef:PHONE_HOME,rightRef:PHONE_OFFICE,
    evidence:{type:'stable_device_credential',source:'device-cert',sourceClass:'credential',confidence:1}
  },1100).state;
  const r=evaluateIdentityLink(state,{leftRef:PHONE_HOME,rightRef:PHONE_OFFICE},1200);
  assert.equal(r.eligible,true);
  assert.equal(r.reason,'stable_device_credential');
});

test('strong conflicting observation blocks confirmation',()=>{
  let {state}=proposePerson();
  state=addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1100).state;
  state=addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'conflicting_observation',source:'site-conflict',sourceClass:'system',confidence:.95}
  },1150).state;
  const r=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1200);
  assert.equal(r.eligible,false);
  assert.equal(r.reason,'explicit_or_strong_conflict');
});

test('rejected pairs are blocked from silent reproposal',()=>{
  let {state}=proposePerson();
  const rejected=rejectIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,reason:'not_same_person'},1200);
  assert.equal(rejected.link.status,'rejected');
  assert.throws(()=>proposeIdentityLink(rejected.state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,entityType:'person'
  },1300),/blocked/);
});

test('confirmed identities can grow through explicit canonical id without collisions',()=>{
  let first=proposePerson();
  let state=addIdentityEvidence(first.state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1100).state;
  let confirmed=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1200);
  const canonical=confirmed.identity.canonical_identity_id;

  let second=proposeIdentityLink(confirmed.state,{
    leftRef:DAVE_OFFICE,rightRef:DAVE_CABIN,entityType:'person',canonicalIdentityId:canonical
  },1300);
  state=addIdentityEvidence(second.state,{
    leftRef:DAVE_OFFICE,rightRef:DAVE_CABIN,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1400).state;
  confirmed=evaluateIdentityLink(state,{leftRef:DAVE_OFFICE,rightRef:DAVE_CABIN},1500);
  assert.deepEqual(confirmed.identity.members.sort(),[DAVE_HOME,DAVE_OFFICE,DAVE_CABIN].sort());
});

test('an entity cannot be assigned to a different active canonical identity',()=>{
  let first=proposePerson();
  let state=addIdentityEvidence(first.state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1100).state;
  state=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1200).state;

  let second=proposeIdentityLink(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_CABIN,entityType:'person',
    canonicalIdentityId:'44444444-4444-4444-8444-444444444444'
  },1300);
  state=addIdentityEvidence(second.state,{
    leftRef:DAVE_HOME,rightRef:DAVE_CABIN,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1400).state;
  assert.throws(()=>evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_CABIN},1500),/different active canonical identity/);
});

test('split is reversible at the ledger and blocks accidental re-merge',()=>{
  let {state}=proposePerson();
  state=addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1100).state;
  state=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1200).state;
  const split=splitIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,reason:'correction'},1300);
  assert.equal(split.link.status,'split');
  assert.equal(split.identity.status,'split');
  assert.equal(resolveCanonicalIdentity(split.state,DAVE_HOME),null);
  assert.throws(()=>proposeIdentityLink(split.state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,entityType:'person'
  },1400),/blocked/);
});

test('canonical identity aliases and revocation never mutate site-local refs',()=>{
  let {state}=proposePerson();
  state=addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'user_confirmed',source:'user',sourceClass:'user',confidence:1}
  },1100).state;
  let confirmed=evaluateIdentityLink(state,{leftRef:DAVE_HOME,rightRef:DAVE_OFFICE},1200);
  const canonical=confirmed.identity.canonical_identity_id;
  let aliased=addIdentityAlias(confirmed.state,{canonicalIdentityId:canonical,alias:'Dave'},1250);
  assert.deepEqual(aliased.identity.aliases,['Dave']);
  const revoked=revokeCanonicalIdentity(aliased.state,{canonicalIdentityId:canonical,reason:'user_revoked'},1300);
  assert.equal(revoked.identity.status,'revoked');
  assert.equal(resolveCanonicalIdentity(revoked.state,DAVE_HOME),null);
  const snapshot=identityContinuitySnapshot(revoked.state);
  assert.ok(snapshot.links.some(l=>l.left_ref===DAVE_HOME||l.right_ref===DAVE_HOME));
  assert.equal(snapshot.site_local_entities_immutable,true);
});

test('raw biometric/perception payloads are rejected; only semantic evidence survives',()=>{
  let {state}=proposePerson();
  assert.throws(()=>addIdentityEvidence(state,{
    leftRef:DAVE_HOME,rightRef:DAVE_OFFICE,
    evidence:{type:'recognition_match',source:'face-model',sourceClass:'biometric',confidence:.99,metadata:{embedding:[1,2,3]}}
  },1100),/raw perception/);
});

test('Cloud projection is read-only and cannot confirm, merge, or split identities',()=>{
  let {state}=proposePerson();
  const projection=cloudIdentityContinuityProjection(state);
  assert.equal(projection.protocol,IDENTITY_CONTINUITY_PROTOCOL);
  assert.equal(projection.cloud_read_only,true);
  assert.equal(projection.cloud_can_confirm_links,false);
  assert.equal(projection.cloud_can_merge_identities,false);
  assert.equal(projection.cloud_can_split_identities,false);
  assert.equal(projection.site_local_entities_immutable,true);
  assert.equal(projection.reversible,true);
});
