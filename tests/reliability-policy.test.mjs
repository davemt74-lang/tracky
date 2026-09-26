import test from 'node:test';
import assert from 'node:assert/strict';
import { RELIABILITY_POLICY,reliabilityPolicySnapshot } from '../src/reliability-policy.js';

test('reliability thresholds are centralized and preserve V2.6 defaults',()=>{
 assert.equal(RELIABILITY_POLICY.operationalHealth.occupancyCoverage,.85);
 assert.equal(RELIABILITY_POLICY.operationalHealth.lowRoomCoverage,.50);
 assert.equal(RELIABILITY_POLICY.groundTruth.fallbackTickMs,5000);
 assert.equal(RELIABILITY_POLICY.groundTruth.persistenceThrottleMs,10000);
 assert.equal(RELIABILITY_POLICY.corrections.maxRecords,250);
});
test('policy snapshots are detached from immutable runtime policy',()=>{
 const snapshot=reliabilityPolicySnapshot();
 snapshot.operationalHealth.occupancyCoverage=.1;
 assert.equal(RELIABILITY_POLICY.operationalHealth.occupancyCoverage,.85);
});
