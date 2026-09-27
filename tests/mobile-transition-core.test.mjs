import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOBILE_TRANSITION_PROTOCOL,
  createMobileTransitionState,
  beginMobileTransition,
  applyMobileTransitionEvidence,
  advanceMobileTransitionTimers,
  mobileTransitionSnapshot,
  mobileTransitionAgentContext,
  cloudMobileTransitionProjection
} from '../src/mobile-transition-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const POCKET='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function start(now=1000){
  return beginMobileTransition(createMobileTransitionState(now),{
    transitionId:'trip-1',
    subjectKind:'mobile_device',
    subjectId:POCKET,
    sourceSiteId:HOME,
    confidence:.8
  },now);
}

test('mobile-device transition flows departing -> transit -> arriving -> arrived',()=>{
  let {state,transition}=start();
  assert.equal(transition.state,'departing');
  let r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'source_absence_confirmed',siteId:HOME,confidence:.95}
  },1100);
  state=r.state;
  assert.equal(r.transition.state,'in_transit');

  r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'destination_candidate',siteId:OFFICE,confidence:.8}
  },1200);
  state=r.state;
  assert.equal(r.transition.state,'arriving');
  assert.equal(r.transition.destination_site_id,OFFICE);

  r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'destination_arrival_observed',siteId:OFFICE,confidence:.91}
  },1300);
  assert.equal(r.transition.state,'arrived');
  assert.equal(r.transition.arrived_at,1300);
  assert.equal(mobileTransitionAgentContext(r.state,1400).active_count,0);
});

test('same start retry is idempotent but a different active transition is rejected',()=>{
  let {state}=start();
  const retry=beginMobileTransition(state,{
    transitionId:'trip-1',subjectKind:'mobile_device',subjectId:POCKET,sourceSiteId:HOME
  },1010);
  assert.equal(retry.idempotent,true);
  assert.throws(()=>beginMobileTransition(state,{
    transitionId:'trip-2',subjectKind:'mobile_device',subjectId:POCKET,sourceSiteId:HOME
  },1020),/already has an active/);
});

test('offline mobile context resumes the previous transition state when device returns',()=>{
  let {state}=start();
  state=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,evidence:{type:'mobile_motion',confidence:.9}
  },1100).state;
  let r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,evidence:{type:'mobile_offline',confidence:1}
  },1200);
  state=r.state;
  assert.equal(r.transition.state,'offline');
  assert.equal(r.transition.resume_state,'in_transit');
  assert.equal(r.transition.offline_since,1200);

  r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,evidence:{type:'mobile_online',confidence:1}
  },1300);
  assert.equal(r.transition.state,'in_transit');
  assert.equal(r.transition.offline_since,null);
});

test('temporary contexts never become durable sites or site authorities',()=>{
  let {state}=start();
  const r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{
      type:'temporary_context_observed',
      contextId:'hotel-room-410',
      contextLabel:'Hotel room',
      confidence:.82
    }
  },1400);
  assert.equal(r.transition.state,'temporary_context');
  assert.equal(r.transition.temporary_context.id,'hotel-room-410');
  assert.equal(r.transition.temporary_context.durable_site,false);
  assert.equal(r.transition.temporary_context.site_authority,false);
  const cloud=cloudMobileTransitionProjection(r.state);
  assert.equal(cloud.temporary_context_site_authority,false);
});

test('conflicting site observations move the transition to uncertain',()=>{
  let {state}=start();
  state=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'mobile_motion',confidence:.8}
  },1500).state;
  const r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'conflicting_site_observation',siteId:OFFICE,confidence:.9}
  },1600);
  assert.equal(r.transition.state,'uncertain');
  assert.equal(r.transition.state_reason,'conflicting_site_observation');
});

test('state timeouts degrade to uncertain rather than inventing arrival',()=>{
  let {state}=start(2000);
  let timed=advanceMobileTransitionTimers(state,{departingTimeoutMs:1000},3101);
  state=timed.state;
  assert.equal(timed.changed,1);
  const snap=mobileTransitionSnapshot(state);
  assert.equal(snap.transitions[0].state,'uncertain');
  assert.equal(snap.transitions[0].destination_site_id,'');
});

test('low-confidence arrival stays arriving until stronger or confirmed evidence',()=>{
  let {state}=start();
  state=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'destination_candidate',siteId:OFFICE,confidence:.6}
  },1700).state;
  let r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'destination_arrival_observed',siteId:OFFICE,confidence:.55}
  },1800);
  state=r.state;
  assert.equal(r.transition.state,'arriving');

  r=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'user_confirmed_destination',siteId:OFFICE,confidence:1}
  },1900);
  assert.equal(r.transition.state,'arrived');
  assert.equal(r.transition.destination_confidence,1);
});

test('person/object identity linking is not accepted by the transition runtime',()=>{
  assert.throws(()=>beginMobileTransition(createMobileTransitionState(),{
    transitionId:'person-trip',subjectKind:'person',subjectId:'person:dave',sourceSiteId:HOME
  }),/subject kind is unsupported/);
  const explicit=beginMobileTransition(createMobileTransitionState(),{
    transitionId:'explicit-trip',subjectKind:'explicit_continuity_subject',
    subjectId:'user-confirmed:dave',sourceSiteId:HOME
  },2000);
  assert.equal(explicit.transition.subject_scope,'explicit_continuity_subject');
  assert.equal(explicit.transition.identity_linking,false);
});

test('raw perception payloads are rejected',()=>{
  let {state}=start();
  assert.throws(()=>applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'mobile_motion',metadata:{frame_data:'private'}}
  },2100),/raw perception/);
});

test('destination cannot equal source',()=>{
  assert.throws(()=>beginMobileTransition(createMobileTransitionState(),{
    transitionId:'bad-trip',subjectKind:'mobile_device',subjectId:POCKET,
    sourceSiteId:HOME,destinationSiteId:HOME
  },2200),/must differ/);
});

test('Cloud projection is semantic, read-only, and identity-link safe',()=>{
  let {state}=start();
  state=applyMobileTransitionEvidence(state,{
    subjectKind:'mobile_device',subjectId:POCKET,
    evidence:{type:'mobile_motion',confidence:.9}
  },2300).state;
  const projection=cloudMobileTransitionProjection(state);
  assert.equal(projection.protocol,MOBILE_TRANSITION_PROTOCOL);
  assert.equal(projection.summary_only,true);
  assert.equal(projection.cloud_read_only,true);
  assert.equal(projection.authority_assignment,'local_only');
  assert.equal(projection.person_object_identity_linking,false);
  assert.equal(projection.identity_linking,false);
  assert.equal(JSON.stringify(projection).includes('frame_data'),false);
});
