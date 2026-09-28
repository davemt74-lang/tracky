import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFederationAgentHealth,federationAgentHealthCapability,FEDERATION_AGENT_HEALTH_PROTOCOL} from '../src/federation-agent-health-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const NODE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function base(syncStatus='current',previous=null){
 return {
  operations:{local_site_id:HOME,sites:[
   {id:HOME,label:'Home',status:'active',health:'healthy',authority:{status:'current',device_id:NODE,epoch:4},federation:{status:'current'}},
   {id:OFFICE,label:'Office',status:'active',health:syncStatus==='current'?'healthy':'critical',authority:{status:'current',device_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',epoch:2},federation:{status:syncStatus}}
  ],devices:[
   {id:NODE,label:'Home Node',site_id:HOME,hardware_profile:'node',runtime_status:'online'},
   {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',label:'Office Node',site_id:OFFICE,hardware_profile:'node',runtime_status:'online'}
  ]},
  sync_visibility:{local_site_id:HOME,sites:[
   {site_id:HOME,status:'current',fresh:true,reconciliation_required:false},
   {site_id:OFFICE,status:syncStatus,fresh:syncStatus==='current',reconciliation_required:syncStatus!=='current',last_error:syncStatus==='failed'?'boom':''}
  ]},
  access_operations:{peers:[{site_id:OFFICE,policy_peer_allowed:true,federation_enabled:true}]},
  bridge:{state:'connected',connected:true,transport:'vp3_https'},
  previous
 };
}
const T=2000000;

test('partition emits a high priority Agent event and stale trust boundary',()=>{
 const report=buildFederationAgentHealth(base('partitioned'),T);
 assert.equal(report.protocol,FEDERATION_AGENT_HEALTH_PROTOCOL);
 const office=report.sites.find(x=>x.site_id===OFFICE);
 assert.equal(office.state,'partitioned');
 assert.equal(office.fresh,false);
 assert.equal(office.trust.agent_may_treat_remote_state_as_current,false);
 const event=report.events.find(x=>x.site_id===OFFICE);
 assert.equal(event.event_type,'site_partitioned');
 assert.equal(event.notification,true);
 assert.equal(event.chat,true);
});

test('reconnect becomes recovering, not recovered, until reconciliation is current',()=>{
 const failed=buildFederationAgentHealth(base('partitioned'),T);
 const reconnect=base('reconciling',failed);
 const recovering=buildFederationAgentHealth(reconnect,T+1000);
 const office=recovering.sites.find(x=>x.site_id===OFFICE);
 assert.equal(office.state,'recovering');
 assert.equal(office.recovery_pending,true);
 assert(recovering.events.some(x=>x.event_type==='site_recovering'));
 assert(!recovering.events.some(x=>x.event_type==='site_recovered'));

 const healthy=buildFederationAgentHealth(base('current',recovering),T+2000);
 assert.equal(healthy.sites.find(x=>x.site_id===OFFICE).state,'connected');
 const recovered=healthy.events.find(x=>x.event_type==='site_recovered');
 assert(recovered);
 assert.equal(recovered.recovery_complete,true);
});

test('same unhealthy state does not create duplicate event until duration escalation',()=>{
 const first=buildFederationAgentHealth(base('partitioned'),T);
 const same=buildFederationAgentHealth(base('partitioned',first),T+30_000);
 assert.equal(same.events.filter(x=>x.site_id===OFFICE).length,0);
 const escalated=buildFederationAgentHealth(base('partitioned',same),T+16*60_000);
 assert(escalated.events.some(x=>x.event_type==='site_health_escalated'));
});

test('Cloud relay outage is separated from local physical truth',()=>{
 const input=base('current');
 input.bridge={state:'offline',connected:false,last_error:'relay unavailable',transport:'vp3_https'};
 const report=buildFederationAgentHealth(input,T);
 const home=report.sites.find(x=>x.site_id===HOME);
 assert.equal(home.trust.local_physical_truth_current,true);
 assert.equal(home.trust.cloud_transport_connected,false);
 const relay=report.events.find(x=>x.event_type==='relay_disconnected');
 assert(relay);
 assert.match(relay.body,/Local physical truth may remain available/);
});

test('authority device offline becomes site offline',()=>{
 const input=base('current');
 input.operations.devices[1].runtime_status='offline';
 const report=buildFederationAgentHealth(input,T);
 assert.equal(report.sites.find(x=>x.site_id===OFFICE).state,'offline');
 assert.equal(report.sites.find(x=>x.site_id===OFFICE).issue_code,'authority_device_offline');
});

test('capability encodes recovery and delivery invariants',()=>{
 const cap=federationAgentHealthCapability();
 assert.equal(cap.recovery_requires_current_reconciliation,true);
 assert.equal(cap.duplicate_state_suppression,true);
 assert.equal(cap.duration_escalation,true);
 assert.equal(cap.voice_respects_existing_settings,true);
 assert.equal(cap.authority_mutation,false);
});
