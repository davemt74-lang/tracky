import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFederationFleetHealth,federationFleetHealthCapability} from '../src/federation-fleet-health-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';

function base(now=1_000_000){
  return {
    now,
    input:{
      operations:{local_site_id:HOME,sites:[{id:HOME,label:'Home'},{id:OFFICE,label:'Office'}]},
      federation_health:{sites:[
        {site_id:HOME,state:'current',fresh:true,recovery_complete:true},
        {site_id:OFFICE,state:'current',fresh:true,recovery_complete:true}
      ]},
      access:{peers:[{site_id:OFFICE,policy_peer_allowed:true}]},
      fleet_sites:[
        {site_id:HOME,generated_at_ms:now-1000,diagnostics_allowed:true,devices:[
          {device_id:'hs-home',label:'HomeServer',health:'healthy',last_seen_at:now-1000,storage_state:'ok',backup_state:'ready'}
        ]},
        {site_id:OFFICE,generated_at_ms:now-1000,diagnostics_allowed:true,devices:[
          {device_id:'hs-office',label:'Office HomeServer',health:'healthy',last_seen_at:now-1000,storage_state:'ok',backup_state:'ready'}
        ]}
      ]
    }
  };
}

test('healthy current diagnostics remain healthy',()=>{
  const {input,now}=base();
  const report=buildFederationFleetHealth(input,{},now);
  assert.equal(report.protocol,'physical_federation_fleet_health.v1');
  assert.equal(report.overall_state,'healthy');
  assert.equal(report.counts.devices,2);
  assert.equal(report.sites[0].current_claims_allowed,true);
});

test('critical device diagnostics fail the site',()=>{
  const {input,now}=base();
  input.fleet_sites[1].devices[0].health='critical';
  input.fleet_sites[1].devices[0].issues=['storage_critical'];
  const report=buildFederationFleetHealth(input,{},now);
  const office=report.sites.find(s=>s.site_id===OFFICE);
  assert.equal(office.state,'failed');
  assert.equal(office.severity,'critical');
  assert.equal(office.cause,'storage_critical');
});

test('telemetry ages into stale then offline',()=>{
  const {input,now}=base();
  input.stale_after_ms=60_000;
  input.offline_after_ms=180_000;
  input.fleet_sites[1].devices[0].last_seen_at=now-120_000;
  let report=buildFederationFleetHealth(input,{},now);
  assert.equal(report.sites.find(s=>s.site_id===OFFICE).state,'stale');
  input.fleet_sites[1].devices[0].last_seen_at=now-240_000;
  report=buildFederationFleetHealth(input,{},now);
  assert.equal(report.sites.find(s=>s.site_id===OFFICE).state,'offline');
});

test('section 7 recovering gate prevents healthy diagnostics from claiming current',()=>{
  const {input,now}=base();
  input.federation_health.sites[1]={site_id:OFFICE,state:'recovering',fresh:false,recovery_complete:false};
  const report=buildFederationFleetHealth(input,{},now);
  const office=report.sites.find(s=>s.site_id===OFFICE);
  assert.equal(office.state,'recovering');
  assert.equal(office.diagnostics_current,false);
  assert.equal(office.current_claims_allowed,false);
  assert.equal(office.trust.physical_claims,'do_not_claim_current');
});

test('agent context filters unauthorized remote sites',()=>{
  const {input,now}=base();
  input.access.peers[0].policy_peer_allowed=false;
  input.fleet_sites[1].devices[0].health='critical';
  input.fleet_sites[1].devices[0].issues=['privacy_fault'];
  const report=buildFederationFleetHealth(input,{},now);
  assert.ok(report.sites.some(s=>s.site_id===OFFICE));
  assert.ok(report.agent_context.sites.every(s=>s.site_id!==OFFICE));
  assert.ok(report.agent_context.active_issues.every(s=>s.site_id!==OFFICE));
});

test('privacy projection excludes sensitive diagnostic payload fields',()=>{
  const {input,now}=base();
  input.fleet_sites[0].devices[0].raw_logs='SECRET';
  input.fleet_sites[0].devices[0].filesystem_path='C:/secret';
  input.fleet_sites[0].devices[0].credentials='token';
  const report=buildFederationFleetHealth(input,{},now);
  const serialized=JSON.stringify(report);
  assert.equal(serialized.includes('SECRET'),false);
  assert.equal(serialized.includes('C:/secret'),false);
  assert.equal(serialized.includes('token'),false);
  assert.equal(report.privacy.diagnostic_content_included,false);
});

test('capability is read-only and cannot mutate authority or run remote commands',()=>{
  const cap=federationFleetHealthCapability();
  assert.equal(cap.section7_health_is_authoritative,true);
  assert.equal(cap.cloud_read_only,true);
  assert.equal(cap.remote_command_execution,false);
  assert.equal(cap.authority_mutation,false);
});
