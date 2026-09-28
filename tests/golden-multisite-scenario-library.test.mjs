import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFederationReconciliationResult,
  buildFederationReconciliationRequest,
  createFederationReconciliationState,
  markFederationPartition,
  noteFederationPeerContact
} from '../src/federation-reconciliation-core.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/tracky_v278_golden_multisite_scenarios.json', import.meta.url),'utf8'));
const byId=new Map(fixture.scenarios.map(x=>[x.id,x]));
const HOME=fixture.sites.home.site_id;
const OFFICE=fixture.sites.office.site_id;

test('golden multi-site library permanently covers V2.78 release invariants',()=>{
  assert.equal(fixture.format,'tracky_v278_golden_multisite_scenarios.v1');
  assert.equal(fixture.version,'2.78');
  assert.equal(fixture.scenarios.length,10);
  for(const id of [
    'healthy-two-site-current',
    'transport-partition-stale-query',
    'reconnect-revision-gap-full-snapshot',
    'authority-epoch-change-revalidation',
    'same-revision-fingerprint-conflict',
    'permission-revoked-during-partition',
    'mobile-transition-site-boundary',
    'history-immutable-through-reconciliation',
    'restart-during-reconciliation',
    'three-site-cloud-relay-no-authority'
  ]) assert.ok(byId.has(id),'missing golden scenario '+id);
  for(const invariant of [
    'origin-site-authority-only',
    'cloud-remains-relay-and-mirror-only',
    'semantic-only-federation',
    'stale-data-must-be-labeled',
    'partition-never-promotes-remote-or-cloud-authority',
    'authority-epoch-change-requires-revalidation',
    'same-revision-fingerprint-conflict-fails-closed',
    'reconciliation-state-survives-restart',
    'history-remains-immutable'
  ]) assert.ok(fixture.invariants.includes(invariant),'missing release invariant '+invariant);
});

test('golden healthy and partition scenarios agree with the reconciliation runtime',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME},0);
  state=noteFederationPeerContact(state,{
    site_id:OFFICE,
    local_cursor:{revision:4,fingerprint:'same',authority_epoch:1},
    remote_cursor:{revision:4,fingerprint:'same',authority_epoch:1}
  },100);
  assert.equal(state.peers[OFFICE].status,byId.get('healthy-two-site-current').expect.peer_status);

  state=markFederationPartition(state,OFFICE,'golden_partition',200);
  assert.equal(state.peers[OFFICE].status,byId.get('transport-partition-stale-query').expect.peer_status);
});

test('golden revision-gap recovery requires full authoritative catch-up',()=>{
  let state=createFederationReconciliationState({localSiteId:HOME},0);
  state=markFederationPartition(state,OFFICE,'golden_partition',100);
  state=noteFederationPeerContact(state,{
    site_id:OFFICE,
    local_cursor:{revision:4,fingerprint:'r4',authority_epoch:1},
    remote_cursor:{revision:9,fingerprint:'r9',authority_epoch:1}
  },200);
  const built=buildFederationReconciliationRequest(state,{remote_site_id:OFFICE},300);
  assert.equal(built.request.request_mode,byId.get('reconnect-revision-gap-full-snapshot').expect.request_mode);

  const result=applyFederationReconciliationResult(built.state,{
    remote_site_id:OFFICE,
    reconciliation_id:built.request.reconciliation_id,
    authoritative:true,
    semantic_only:true,
    authority_assignment:'origin_only',
    applied_cursor:{revision:9,fingerprint:'r9',authority_epoch:1},
    remote_cursor:{revision:9,fingerprint:'r9',authority_epoch:1}
  },400);
  assert.equal(result.status,'completed');
  assert.equal(result.freshness.status,byId.get('reconnect-revision-gap-full-snapshot').expect.final_status);
});

test('golden authority epoch and same-revision conflict cases fail closed',()=>{
  let epoch=createFederationReconciliationState({localSiteId:HOME},0);
  epoch=noteFederationPeerContact(epoch,{
    site_id:OFFICE,
    local_cursor:{revision:7,fingerprint:'r7',authority_epoch:1},
    remote_cursor:{revision:7,fingerprint:'r7-new',authority_epoch:2}
  },100);
  const request=buildFederationReconciliationRequest(epoch,{remote_site_id:OFFICE},200);
  assert.equal(request.request.request_mode,byId.get('authority-epoch-change-revalidation').expect.request_mode);

  let conflict=createFederationReconciliationState({localSiteId:HOME},0);
  conflict=noteFederationPeerContact(conflict,{
    site_id:OFFICE,
    local_cursor:{revision:9,fingerprint:'alpha',authority_epoch:1},
    remote_cursor:{revision:9,fingerprint:'beta',authority_epoch:1}
  },100);
  assert.equal(conflict.peers[OFFICE].status,byId.get('same-revision-fingerprint-conflict').expect.peer_status);
  assert.equal(conflict.peers[OFFICE].last_error,byId.get('same-revision-fingerprint-conflict').expect.reason);
});
