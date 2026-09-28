import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFederationSyncVisibility,annotatePhysicalWorldFreshness,federationSyncVisibilityCapability,FEDERATION_SYNC_VISIBILITY_PROTOCOL} from '../src/federation-sync-visibility-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const CABIN='33333333-3333-4333-8333-333333333333';

function input(status='reconciling'){
  return {
    operations:{local_site_id:HOME,sites:[
      {id:HOME,label:'Home',world_revision:12,authority:{epoch:4},federation:{status:'current'}},
      {id:OFFICE,label:'Office',world_revision:18,authority:{epoch:3},federation:{status}},
      {id:CABIN,label:'Cabin',world_revision:7,authority:{epoch:1},federation:{status:'partitioned'}}
    ]},
    reconciliation:{local_site_id:HOME,peers:[
      {remote_site_id:OFFICE,status,stale_since:'2026-09-28T12:00:00Z',reconciling_since:'2026-09-28T12:02:00Z',last_contact_at:'2026-09-28T12:04:00Z',
       retry_count:2,next_retry_at:'2026-09-28T12:06:00Z',local_revision:15,local_fingerprint:'abc',local_authority_epoch:2,
       remote_revision:18,remote_fingerprint:'def',remote_authority_epoch:3,last_error:'reconciliation_incomplete'},
      {remote_site_id:CABIN,status:'partitioned',stale_since:'2026-09-28T11:30:00Z',partitioned_at:'2026-09-28T11:31:00Z',
       local_revision:7,local_fingerprint:'cab',local_authority_epoch:1,remote_revision:7,remote_fingerprint:'cab',remote_authority_epoch:1,last_error:'transport_partition'}
    ],runs:[
      {reconciliation_id:'r1',remote_site_id:OFFICE,status:'running',request_mode:'full_snapshot',reason:'revision_gap',
       local_revision:15,remote_revision:18,authority_epoch:3,created_at:'2026-09-28T12:02:00Z',details:{authority_epoch_changed:true}}
    ]},
    sync:{local_site_id:HOME},
    crossSiteTransitions:[{transition_id:'trip-1',subject_label:'Pocket',state:'arriving',active:true,
      source_site:{site_id:HOME},destination_site:{site_id:OFFICE}}]
  };
}
const NOW=Date.parse('2026-09-28T12:05:00Z');

test('visibility exposes revision gap, epoch mismatch, retries and stale age',()=>{
  const report=buildFederationSyncVisibility(input(),NOW);
  assert.equal(report.protocol,FEDERATION_SYNC_VISIBILITY_PROTOCOL);
  const office=report.sites.find(s=>s.site_id===OFFICE);
  assert.equal(office.status,'reconciling');
  assert.equal(office.revision_gap,3);
  assert.equal(office.authority_epoch_mismatch,true);
  assert.equal(office.retry_count,2);
  assert.equal(office.stale_age_ms,5*60*1000);
  assert.equal(office.catch_up.applied_revision,15);
  assert.equal(office.catch_up.target_revision,18);
  assert(office.catch_up.progress>0.8&&office.catch_up.progress<1);
  assert.equal(office.remote_authority_promotion,false);
});

test('partition and reconciliation history stay visible',()=>{
  const report=buildFederationSyncVisibility(input(),NOW);
  const cabin=report.sites.find(s=>s.site_id===CABIN);
  assert.equal(cabin.status,'partitioned');
  assert.equal(cabin.fresh,false);
  assert.equal(cabin.reconciliation_required,true);
  assert.equal(report.reconciliation_runs[0].status,'running');
  assert.equal(report.reconciliation_runs[0].immutable,true);
  assert.equal(report.counts.partitioned,1);
});

test('transition sync hints block destination inference while remote site is not fresh',()=>{
  const report=buildFederationSyncVisibility(input(),NOW);
  assert.equal(report.transition_sync_hints[0].destination_sync_status,'reconciling');
  assert.equal(report.transition_sync_hints[0].destination_presence_claim_blocked,true);
  assert.match(report.transition_sync_hints[0].note,/do not infer arrival/i);
});

test('physical world receives selected-site freshness on entities and Agent context',()=>{
  const visibility=buildFederationSyncVisibility(input(),NOW);
  const dashboard=annotatePhysicalWorldFreshness({
    selected_site:{site_id:OFFICE},people:[{label:'Dave'}],rooms:[],objects:[],world_devices:[],agent_context:{}
  },visibility);
  assert.equal(dashboard.federation_freshness.status,'reconciling');
  assert.equal(dashboard.people[0].federation_freshness.fresh,false);
  assert.equal(dashboard.agent_context.sync_state,'reconciling');
  assert.equal(dashboard.agent_context.no_remote_authority_promotion,true);
});

test('same revision fingerprint conflict fails closed visibly',()=>{
  const data=input('failed');
  const peer=data.reconciliation.peers[0];
  peer.local_revision=18;peer.remote_revision=18;peer.local_fingerprint='left';peer.remote_fingerprint='right';
  peer.local_authority_epoch=3;peer.remote_authority_epoch=3;peer.last_error='same_revision_fingerprint_conflict';
  const office=buildFederationSyncVisibility(data,NOW).sites.find(s=>s.site_id===OFFICE);
  assert.equal(office.fingerprint_conflict,true);
  assert.equal(office.conflict_code,'same_revision_fingerprint_conflict');
  assert.equal(office.fresh,false);
});

test('capability is observability-only and Cloud cannot decide current',()=>{
  const cap=federationSyncVisibilityCapability();
  assert.equal(cap.retry_visibility,true);
  assert.equal(cap.physical_world_freshness_annotations,true);
  assert.equal(cap.read_only,true);
  assert.equal(cap.authority_mutation,false);
  assert.equal(cap.cloud_can_mark_destination_current,false);
});
