import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCrossSitePresence,crossSitePresenceCapability,CROSS_SITE_PRESENCE_PROTOCOL} from '../src/cross-site-presence-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const POCKET='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NODE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function transition(state='in_transit'){
  return {
    transition_id:'trip-pocket-1',subject_kind:'mobile_device',subject_id:POCKET,subject_scope:'stable_mobile_device',
    source_site_id:HOME,destination_site_id:OFFICE,state,previous_state:'departing',state_reason:'test',
    confidence:.88,destination_confidence:.8,revision:3,started_at:1000,state_changed_at:1200,updated_at:1250,
    arrived_at:state==='arrived'?1300:null,offline_since:state==='offline'?1220:null,
    temporary_context:state==='temporary_context'?{id:'hotel-room',label:'Hotel',confidence:.7,durable_site:false,site_authority:false}:null,
    evidence:[{type:'source_absence_confirmed',site_id:HOME,confidence:.95,observed_at:1100},{type:'destination_candidate',site_id:OFFICE,confidence:.8,observed_at:1200}],
    identity_linking:false
  };
}
function input(state='in_transit'){
  return {
    operations:{
      sites:[
        {id:HOME,label:'Home',health:'healthy',federation:{status:'current'},authority:{device_id:NODE,epoch:2}},
        {id:OFFICE,label:'Office',health:'healthy',federation:{status:'current'},authority:{device_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',epoch:1}}
      ],
      devices:[
        {id:POCKET,site_id:HOME,label:'Dave Pocket',hardware_profile:'pocket'},
        {id:NODE,site_id:HOME,label:'Home Node',hardware_profile:'node'}
      ]
    },
    mobileTransitions:{transitions:[transition(state)]}
  };
}

test('in-transit subject keeps source as last confirmed and does not invent destination presence',()=>{
  const report=buildCrossSitePresence(input('in_transit'),2000);
  assert.equal(report.protocol,CROSS_SITE_PRESENCE_PROTOCOL);
  assert.equal(report.active_count,1);
  const t=report.active_transitions[0];
  assert.equal(t.last_confirmed_site.site_id,HOME);
  assert.equal(t.current_presence.status,'in_transit');
  assert.equal(t.current_presence.confirmed,false);
  assert.equal(t.may_claim_present_at_destination,false);
  assert.equal(report.agent_context.destination_claim_rule,'present_at_destination_only_after_arrived');
});

test('arrival confirms destination and preserves authority/identity boundaries',()=>{
  const report=buildCrossSitePresence(input('arrived'),2000);
  const t=report.transitions[0];
  assert.equal(t.current_presence.site_id,OFFICE);
  assert.equal(t.current_presence.confirmed,true);
  assert.equal(t.last_confirmed_site.site_id,OFFICE);
  assert.equal(t.may_claim_present_at_destination,true);
  assert.equal(t.authority.authority_transfer,false);
  assert.equal(t.identity.cross_site_merge,false);
});

test('temporary and offline contexts are explicit and not durable sites',()=>{
  let t=buildCrossSitePresence(input('temporary_context'),2000).active_transitions[0];
  assert.equal(t.current_presence.kind,'temporary_context');
  assert.equal(t.current_presence.durable_site,false);
  assert.equal(t.current_presence.site_authority,false);
  t=buildCrossSitePresence(input('offline'),2000).active_transitions[0];
  assert.equal(t.current_presence.status,'offline');
  assert.equal(t.current_presence.confirmed,false);
});

test('immutable revision history drives timeline when supplied',()=>{
  const raw=transition('arriving');
  const report=buildCrossSitePresence({...input('arriving'),transitionHistory:[
    {transition_id:'trip-pocket-1',revision:1,fingerprint:'a',snapshot:{...raw,state:'departing',revision:1,state_changed_at:1000}},
    {transition_id:'trip-pocket-1',revision:2,fingerprint:'b',snapshot:{...raw,state:'in_transit',revision:2,state_changed_at:1100}},
    {transition_id:'trip-pocket-1',revision:3,fingerprint:'c',snapshot:{...raw,state:'arriving',revision:3,state_changed_at:1200}}
  ]},2000);
  assert.equal(report.history_source,'immutable_transition_revision_history');
  assert.deepEqual(report.timeline.map(x=>x.state),['arriving','in_transit','departing']);
  assert(report.timeline.every(x=>x.immutable));
});

test('explicit continuity subject can represent a person without enabling identity merge',()=>{
  const person={...transition('arriving'),transition_id:'dave-trip',subject_kind:'explicit_continuity_subject',subject_id:'continuity-dave'};
  const report=buildCrossSitePresence({...input(),mobileTransitions:{transitions:[person]},subjectCatalog:[
    {subject_id:'continuity-dave',label:'Dave',subject_type:'person'}
  ]},2000);
  assert.equal(report.active_transitions[0].subject_label,'Dave');
  assert.equal(report.active_transitions[0].subject_type,'person');
  assert.equal(report.active_transitions[0].identity.cross_site_merge,false);
});

test('capability keeps Section 4 read-only',()=>{
  const cap=crossSitePresenceCapability();
  assert.equal(cap.transition_history,true);
  assert.equal(cap.destination_claim_requires_arrived,true);
  assert.equal(cap.authority_mutation,false);
  assert.equal(cap.physical_location_mutation,false);
  assert.equal(cap.cross_site_identity_merge,false);
});
