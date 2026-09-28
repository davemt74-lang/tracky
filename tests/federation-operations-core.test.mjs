import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFederationOperationsSnapshot,federationOperationsCapability,FEDERATION_OPERATIONS_PROTOCOL} from '../src/federation-operations-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const NODE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DESK='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture(peerStatus='current'){
  return {
    topology:{
      protocol:'physical_site_topology.v1',revision:17,
      sites:[
        {id:HOME,label:'Home',status:'active',authority_device_id:NODE,authority_epoch:3},
        {id:OFFICE,label:'Office',status:'active',authority_device_id:DESK,authority_epoch:2}
      ],
      devices:[
        {id:NODE,site_id:HOME,label:'Home Node',hardware_profile:'node',mobility:'fixed',trust_state:'trusted',roles:['site_authority'],capabilities:{site_authority_eligible:true}},
        {id:DESK,site_id:OFFICE,label:'Office Desk',hardware_profile:'desk',mobility:'fixed',trust_state:'trusted',roles:['site_authority'],capabilities:{site_authority_eligible:true}}
      ],relationships:[{subject_id:HOME,type:'peers_with',object_id:OFFICE}]
    },
    reconciliation:{
      protocol:'physical_federation_reconciliation.v1',local_site_id:HOME,
      peers:[{site_id:OFFICE,status:peerStatus,reconciliation_required:peerStatus!=='current'}]
    }
  };
}

test('V2.80 operations snapshot inventories sites, devices and authority without mutation',()=>{
  const report=buildFederationOperationsSnapshot(fixture(),1000);
  assert.equal(report.protocol,FEDERATION_OPERATIONS_PROTOCOL);
  assert.equal(report.health,'healthy');
  assert.deepEqual(report.summary.profile_counts,{desk:1,node:1});
  assert.equal(report.summary.authority_count,2);
  assert.equal(report.sites.find(x=>x.id===HOME).federation.status,'current');
  assert.equal(report.read_only,true);
  assert.equal(report.authority_assignment,'origin_only');
});

test('partition is critical, labeled and never changes authority',()=>{
  const input=fixture('partitioned');
  const report=buildFederationOperationsSnapshot(input,2000);
  const office=report.sites.find(x=>x.id===OFFICE);
  assert.equal(report.health,'critical');
  assert.equal(office.health,'critical');
  assert.equal(office.authority.device_id,DESK);
  assert(report.issues.some(x=>x.site_id===OFFICE&&x.code==='federation_partitioned'));
});

test('unknown or reconciling peer is degraded rather than falsely current',()=>{
  for(const state of ['unknown','suspect','reconciling','stale']){
    const report=buildFederationOperationsSnapshot(fixture(state),3000);
    assert.equal(report.sites.find(x=>x.id===OFFICE).health,'degraded');
  }
});

test('missing or invalid authority fails closed',()=>{
  const missing=fixture();
  missing.topology.sites[1].authority_device_id='';
  assert.equal(buildFederationOperationsSnapshot(missing).sites.find(x=>x.id===OFFICE).health,'critical');
  const invalid=fixture();
  invalid.topology.devices[1].trust_state='revoked';
  const report=buildFederationOperationsSnapshot(invalid);
  assert.equal(report.sites.find(x=>x.id===OFFICE).authority.status,'invalid');
  assert(report.issues.some(x=>x.code==='authority_device_not_trusted'));
});

test('public capability preserves V2.78 authority and identity boundaries',()=>{
  const cap=federationOperationsCapability();
  assert.equal(cap.version,'2.80');
  assert.equal(cap.read_only,true);
  assert.equal(cap.authority_mutation,false);
  assert.equal(cap.identity_mutation,false);
  assert.deepEqual(cap.hardware_profiles,['node','desk','studio','team_node','pocket','custom']);
});
