import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEDERATION_RECONCILIATION_PROTOCOL,
  FEDERATION_PEER_STATES,
  annotateFederatedQueryFreshness,
  applyFederationReconciliationResult,
  buildFederationReconciliationRequest,
  createFederationReconciliationState,
  evaluateFederationPartitions,
  federationFreshnessForSite,
  federationReconciliationCapability,
  markFederationPartition,
  noteFederationPeerContact,
  noteFederationPeerFailure,
  scheduleFederationReconciliationRetry
} from '../src/federation-reconciliation-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';

test('capability preserves local authority and fail-closed recovery boundaries',()=>{
  const cap=federationReconciliationCapability();
  assert.equal(cap.protocol,FEDERATION_RECONCILIATION_PROTOCOL);
  assert.equal(cap.authority_assignment,'origin_only');
  assert.equal(cap.cloud_role,'relay_and_mirror_only');
  assert.equal(cap.same_revision_conflicts,'fail_closed');
  for(const state of ['current','partitioned','reconciling','stale','failed']) assert.ok(FEDERATION_PEER_STATES.includes(state));
  for(const guard of [
    'origin-site-authority-only',
    'partition-never-promotes-remote-or-cloud-authority',
    'stale-data-must-be-labeled',
    'same-revision-fingerprint-conflict-fails-closed'
  ]) assert.ok(cap.boundaries.includes(guard));
});

test('partition detection marks remote evidence stale without changing authority',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME,suspectAfterMs:1000,partitionAfterMs:2000,staleAfterMs:3000},0);
  state=noteFederationPeerContact(state,{
    site_id:OFFICE,
    local_cursor:{revision:4,fingerprint:'a',authority_epoch:2},
    remote_cursor:{revision:4,fingerprint:'a',authority_epoch:2}
  },100);
  assert.equal(federationFreshnessForSite(state,OFFICE,100).status,'current');
  state=evaluateFederationPartitions(state,2500);
  const freshness=federationFreshnessForSite(state,OFFICE,2500);
  assert.equal(freshness.status,'partitioned');
  assert.equal(freshness.fresh,false);
  assert.equal(freshness.reconciliation_required,true);
});

test('revision gap after reconnect forces authoritative full reconciliation',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME},0);
  state=markFederationPartition(state,OFFICE,'simulated_partition',1000);
  state=noteFederationPeerContact(state,{
    site_id:OFFICE,
    local_cursor:{revision:4,fingerprint:'a',authority_epoch:2},
    remote_cursor:{revision:9,fingerprint:'b',authority_epoch:2}
  },2000);
  assert.equal(federationFreshnessForSite(state,OFFICE,2000).status,'reconciling');
  const built=buildFederationReconciliationRequest(state,{remote_site_id:OFFICE},2100);
  assert.equal(built.request.request_mode,'authoritative_full');
  assert.ok(built.request.reasons.includes('revision_gap'));
  assert.equal(built.request.authority_assignment,'origin_only');
});

test('authority epoch changes require revalidation and cannot silently become current',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME},0);
  state=noteFederationPeerContact(state,{
    site_id:OFFICE,
    local_cursor:{revision:7,fingerprint:'x',authority_epoch:1},
    remote_cursor:{revision:7,fingerprint:'y',authority_epoch:2}
  },1000);
  const built=buildFederationReconciliationRequest(state,{remote_site_id:OFFICE},1100);
  assert.equal(built.request.request_mode,'authoritative_full');
  assert.ok(built.request.reasons.includes('authority_epoch_changed'));
  const failed=applyFederationReconciliationResult(built.state,{
    remote_site_id:OFFICE,
    reconciliation_id:built.request.reconciliation_id,
    authoritative:true,
    semantic_only:true,
    authority_assignment:'origin_only',
    applied_cursor:{revision:7,fingerprint:'y',authority_epoch:1},
    remote_cursor:{revision:7,fingerprint:'y',authority_epoch:2}
  },1200);
  assert.equal(failed.status,'failed');
  assert.equal(failed.freshness.status,'failed');
});

test('same revision different fingerprint fails closed',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME},0);
  state=noteFederationPeerContact(state,{
    site_id:OFFICE,
    local_cursor:{revision:5,fingerprint:'alpha',authority_epoch:1},
    remote_cursor:{revision:5,fingerprint:'beta',authority_epoch:1}
  },100);
  assert.equal(federationFreshnessForSite(state,OFFICE,100).status,'failed');
  const built=buildFederationReconciliationRequest(state,{remote_site_id:OFFICE},200);
  assert.ok(built.request.reasons.includes('same_revision_fingerprint_conflict'));
});

test('successful authoritative catch-up is the only path back to current',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME},0);
  state=markFederationPartition(state,OFFICE,'offline',100);
  state=noteFederationPeerContact(state,{
    site_id:OFFICE,
    local_cursor:{revision:2,fingerprint:'r2',authority_epoch:3},
    remote_cursor:{revision:6,fingerprint:'r6',authority_epoch:3}
  },200);
  const built=buildFederationReconciliationRequest(state,{remote_site_id:OFFICE},300);
  const incomplete=applyFederationReconciliationResult(built.state,{
    remote_site_id:OFFICE,
    reconciliation_id:built.request.reconciliation_id,
    authoritative:true,semantic_only:true,authority_assignment:'origin_only',
    applied_cursor:{revision:5,fingerprint:'r5',authority_epoch:3},
    remote_cursor:{revision:6,fingerprint:'r6',authority_epoch:3}
  },400);
  assert.equal(incomplete.status,'incomplete');
  assert.equal(incomplete.freshness.status,'reconciling');

  const complete=applyFederationReconciliationResult(incomplete.state,{
    remote_site_id:OFFICE,
    reconciliation_id:built.request.reconciliation_id,
    authoritative:true,semantic_only:true,authority_assignment:'origin_only',
    applied_cursor:{revision:6,fingerprint:'r6',authority_epoch:3},
    remote_cursor:{revision:6,fingerprint:'r6',authority_epoch:3}
  },500);
  assert.equal(complete.status,'completed');
  assert.equal(complete.freshness.status,'current');
  assert.equal(complete.freshness.fresh,true);
});

test('retries use bounded exponential backoff and exhaust into failed',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME,maxRetries:2,baseRetryDelayMs:1000,maxRetryDelayMs:5000},0);
  state=noteFederationPeerFailure(state,OFFICE,'offline',100);
  state=scheduleFederationReconciliationRetry(state,OFFICE,'attempt1',200);
  let p=state.peers[OFFICE];
  assert.equal(p.retry_count,1);
  assert.equal(p.next_retry_at,1200);
  state=scheduleFederationReconciliationRetry(state,OFFICE,'attempt2',300);
  p=state.peers[OFFICE];
  assert.equal(p.retry_count,2);
  assert.equal(p.next_retry_at,2300);
  state=scheduleFederationReconciliationRetry(state,OFFICE,'attempt3',400);
  assert.equal(state.peers[OFFICE].status,'failed');
  assert.equal(state.peers[OFFICE].next_retry_at,0);
});

test('query results expose stale federation uncertainty instead of inventing freshness',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME},0);
  state=markFederationPartition(state,OFFICE,'offline',100);
  const result=annotateFederatedQueryFreshness({
    status:'ok',
    results:[
      {site_id:HOME,access:'allowed',data:{fragment:{}}},
      {site_id:OFFICE,access:'allowed',data:{fragment:{}}}
    ],
    uncertainty:[]
  },state,200);
  assert.equal(result.status,'partial');
  assert.ok(result.uncertainty.includes('federation_stale'));
  assert.equal(result.results[1].federation_freshness.fresh,false);
  assert.equal(result.authority_mutation,false);
});
