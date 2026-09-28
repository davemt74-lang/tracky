import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runGoldenOperationalRelease,federationV280ReleaseCapability,evaluateGoldenOperationalScenario} from '../src/federation-release-hardening-core.js';

const manifest=JSON.parse(fs.readFileSync(new URL('./fixtures/federation-v280-golden-operational-scenarios.json',import.meta.url),'utf8'));

test('V2.80 golden operational release matrix is complete and deterministic',()=>{
  assert.equal(manifest.format,'physical_federation_v280_golden_operational_release.v1');
  assert.equal(manifest.version,'2.80');
  assert.equal(manifest.scenarios.length,24);
  assert.equal(new Set(manifest.scenarios.map(x=>x.id)).size,24);
  const report=runGoldenOperationalRelease(manifest);
  assert.equal(report.scenario_count,24);
  assert.equal(report.failed,0);
  assert.equal(report.passed,24);
  assert.equal(report.release_ready,true);
});

test('release capability permanently freezes authority and recovery boundaries',()=>{
  const cap=federationV280ReleaseCapability(manifest);
  assert.equal(cap.final_section,10);
  assert.equal(cap.schema_version,53);
  assert.equal(cap.split_brain_allowed,false);
  assert.equal(cap.stale_current_promotion_allowed,false);
  assert.equal(cap.revocation_resurrection_allowed,false);
  assert.equal(cap.cloud_execution_allowed,false);
  assert.equal(cap.agent_execution_allowed,false);
  assert.equal(cap.recovery_authority,'section7_authoritative_reconciliation');
  assert.ok(cap.invariants.includes('authority-transfer-requires-epoch-advance'));
  assert.ok(cap.invariants.includes('migration-053-is-repeat-safe'));
});

test('negative golden vectors fail closed',()=>{
  assert.deepEqual(evaluateGoldenOperationalScenario({kind:'authority_conflict',input:{claim_count:2,same_epoch:true}}),{state:'failed',fail_closed:true});
  assert.deepEqual(evaluateGoldenOperationalScenario({kind:'revocation',input:{site_revoked:true,cached_grant:true}}),{allowed:false,revocation_wins:true});
  assert.deepEqual(evaluateGoldenOperationalScenario({kind:'cloud_boundary',input:{cloud_request:true}}),{execute:false,authority_mutation:false});
});
