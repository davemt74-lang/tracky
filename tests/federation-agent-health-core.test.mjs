import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFederationAgentHealth,shouldDeliverFederationHealthEvent,federationAgentHealthCapability} from '../src/federation-agent-health-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const HDEV='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ODEV='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function input(status='partitioned',fresh=false){
  return {
    operations:{local_site_id:HOME,sites:[
      {id:HOME,label:'Home',status:'active',authority:{status:'current',device_id:HDEV,epoch:4},federation:{status:'current'}},
      {id:OFFICE,label:'Office',status:'active',authority:{status:'current',device_id:ODEV,epoch:2},federation:{status}}
    ],devices:[
      {device_id:HDEV,site_id:HOME,runtime_status:'online'},
      {device_id:ODEV,site_id:OFFICE,runtime_status:'online'}
    ]},
    sync_visibility:{local_site_id:HOME,sites:[
      {site_id:HOME,status:'current',fresh:true,reconciliation_required:false},
      {site_id:OFFICE,status,fresh,reconciliation_required:status!=='current',revision_gap:status==='reconciling'?2:0,stale_age_ms:120000}
    ]},
    access:{peers:[{site_id:OFFICE,policy_peer_allowed:true}]},
    relay:{cloud:{state:'connected',connected:true}}
  };
}

test('partition is critical and blocks current physical claims',()=>{
 const report=buildFederationAgentHealth(input(),{},1000);
 const office=report.sites.find(s=>s.site_id===OFFICE);
 assert.equal(office.state,'partitioned');
 assert.equal(office.severity,'critical');
 assert.equal(office.recovery_complete,false);
 assert.equal(office.trust.physical_claims,'do_not_claim_current');
 assert.equal(report.events[0].event_type,'site.partitioned');
});

test('connectivity return while reconciling becomes recovering, not recovered',()=>{
 const prev=buildFederationAgentHealth(input('partitioned',false),{},1000);
 const next=buildFederationAgentHealth(input('reconciling',false),prev,2000);
 const office=next.sites.find(s=>s.site_id===OFFICE);
 assert.equal(office.state,'recovering');
 assert.equal(office.recovery_complete,false);
 assert.equal(next.events.find(e=>e.site_id===OFFICE).event_type,'site.recovering');
 assert.match(office.message,/not complete/i);
});

test('recovery completes only when authoritative reconciliation is current',()=>{
 const first=buildFederationAgentHealth(input('partitioned',false),{},1000);
 const second=buildFederationAgentHealth(input('reconciling',false),first,2000);
 const third=buildFederationAgentHealth(input('current',true),second,3000);
 const office=third.sites.find(s=>s.site_id===OFFICE);
 assert.equal(office.state,'current');
 assert.equal(office.recovery_complete,true);
 const event=third.events.find(e=>e.site_id===OFFICE);
 assert.equal(event.event_type,'site.recovered');
 assert.equal(event.voice_eligible,true);
});

test('authority device offline is distinguished from a federation partition',()=>{
 const data=input('current',true);
 data.operations.devices.find(d=>d.site_id===OFFICE).runtime_status='offline';
 const report=buildFederationAgentHealth(data,{},1000);
 const office=report.sites.find(s=>s.site_id===OFFICE);
 assert.equal(office.state,'failed');
 assert.equal(office.cause,'authority_device_offline');
});

test('agent site health is filtered by federation policy visibility',()=>{
 const data=input('partitioned',false);
 data.access.peers[0].policy_peer_allowed=false;
 const report=buildFederationAgentHealth(data,{},1000);
 assert.equal(report.sites.some(s=>s.site_id===OFFICE),true);
 assert.equal(report.agent_context.sites.some(s=>s.site_id===OFFICE),false);
});

test('duplicate alert cooldown suppresses noise while severity escalation breaks cooldown',()=>{
 const event={dedupe_key:'office|reconciling|x',severity:'warning'};
 const first=shouldDeliverFederationHealthEvent(event,{},1000);
 assert.equal(first.deliver,true);
 const state={'office|reconciling|x':first.next};
 assert.equal(shouldDeliverFederationHealthEvent(event,state,2000).deliver,false);
 const escalated=shouldDeliverFederationHealthEvent({...event,severity:'critical'},state,2000);
 assert.equal(escalated.deliver,true);
 assert.equal(escalated.reason,'severity_escalated');
});

test('relay failure is distinct from site partition and has its own recovery event',()=>{
 const data=input('current',true);
 data.relay.cloud={state:'offline',connected:false,paired:true,last_error:'relay unavailable'};
 const first=buildFederationAgentHealth(data,{},1000);
 assert.equal(first.relay_health.state,'offline');
 assert.equal(first.sites.find(s=>s.site_id===OFFICE).state,'current');
 data.relay.cloud={state:'connected',connected:true,paired:true};
 const second=buildFederationAgentHealth(data,first,2000);
 assert.equal(second.relay_health.state,'current');
 assert.equal(second.events.some(e=>e.event_type==='relay.recovered'),true);
});

test('capability encodes the recovery gate',()=>{
 const cap=federationAgentHealthCapability();
 assert.equal(cap.recovery_requires_authoritative_reconciliation,true);
 assert.equal(cap.connectivity_returned_is_not_recovery,true);
 assert.equal(cap.authority_mutation,false);
});
