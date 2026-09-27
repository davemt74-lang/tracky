import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_TOPOLOGY_PROTOCOL,BUILTIN_HARDWARE_PROFILES,createSiteTopologyState,registerSite,
  registerDevice,claimSiteAuthority,releaseSiteAuthority,assignDeviceToSite,setDeviceTrust,
  setDeviceRoles,upsertTopologyRelationship,topologySnapshot,cloudTopologySummary
} from '../src/site-topology-core.js';

const SITE_HOME='11111111-1111-4111-8111-111111111111';
const SITE_OFFICE='22222222-2222-4222-8222-222222222222';
const NODE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const POCKET='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DESK='dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function withSites(){
  let state=createSiteTopologyState(1000);
  state=registerSite(state,{id:SITE_HOME,label:'Home',aliases:['home-main']},1010).state;
  state=registerSite(state,{id:SITE_OFFICE,label:'Office',kind:'shared_site'},1020).state;
  return state;
}
function authorityNode(state,id=NODE_A,siteId=SITE_HOME,label='Node'){
  return registerDevice(state,{
    id,label,siteId,hardwareProfile:'Node',trustState:'trusted',
    roles:['site_authority','perception','automation','persistence'],
    capabilities:{site_authority_eligible:true,reconciliation:true,physical_context:true,persistent_storage:true}
  },1100).state;
}

test('V2.78 exposes built-in OTRO hardware families without hard-coded authority',()=>{
  assert.equal(BUILTIN_HARDWARE_PROFILES.node.label,'Node');
  assert.equal(BUILTIN_HARDWARE_PROFILES.desk.label,'Desk');
  assert.equal(BUILTIN_HARDWARE_PROFILES.studio.label,'Studio');
  assert.equal(BUILTIN_HARDWARE_PROFILES.team_node.label,'Team Node');
  assert.equal(BUILTIN_HARDWARE_PROFILES.pocket.label,'Pocket');
  assert.equal(BUILTIN_HARDWARE_PROFILES.custom.label,'Custom');
  assert.equal(BUILTIN_HARDWARE_PROFILES.node.siteAuthority,undefined);
});

test('registers stable site/device UUIDs, aliases, roles and capabilities',()=>{
  let state=withSites();
  state=registerDevice(state,{
    id:DESK,label:'Dave Desk',siteId:SITE_HOME,hardwareProfile:'Desk',aliases:['desk-primary'],
    trustState:'trusted',roles:['personal_agent','interaction','perception'],
    capabilities:{camera:true,microphone:true,display:true}
  },1200).state;
  const snap=topologySnapshot(state);
  assert.equal(snap.protocol,SITE_TOPOLOGY_PROTOCOL);
  assert.equal(snap.sites.length,2);
  assert.equal(snap.devices[0].hardwareProfile,'desk');
  assert.deepEqual(snap.devices[0].roles,['interaction','perception','personal_agent']);
  assert.equal(snap.sites.find((x)=>x.id===SITE_HOME).deviceCount,1);
});

test('site authority is capability-driven, trusted and single-owner',()=>{
  let state=authorityNode(withSites());
  let result=claimSiteAuthority(state,{siteId:SITE_HOME,deviceId:NODE_A},1300);
  state=result.state;
  assert.equal(result.authority.epoch,1);
  state=registerDevice(state,{
    id:NODE_B,label:'Backup Node',siteId:SITE_HOME,hardwareProfile:'Node',trustState:'trusted',
    roles:['site_authority','persistence'],capabilities:{site_authority_eligible:true,reconciliation:true}
  },1310).state;
  assert.throws(()=>claimSiteAuthority(state,{siteId:SITE_HOME,deviceId:NODE_B},1320),/already has an active authority/);
  result=claimSiteAuthority(state,{siteId:SITE_HOME,deviceId:NODE_B,replace:true,reason:'planned_handoff'},1330);
  assert.equal(result.authority.epoch,2);
  assert.equal(result.replaced.deviceId,NODE_A);
});

test('profile name alone never grants authority',()=>{
  let state=withSites();
  state=registerDevice(state,{
    id:NODE_A,siteId:SITE_HOME,hardwareProfile:'Node',trustState:'trusted',
    roles:['site_authority'],capabilities:{}
  },1400).state;
  assert.throws(()=>claimSiteAuthority(state,{siteId:SITE_HOME,deviceId:NODE_A},1410),/capability-eligible/);
});

test('Pocket/mobile devices cannot become durable site authority',()=>{
  let state=withSites();
  assert.throws(()=>registerDevice(state,{
    id:POCKET,siteId:SITE_HOME,hardwareProfile:'Pocket',trustState:'trusted',
    roles:['site_authority'],capabilities:{site_authority_eligible:true}
  },1500),/Mobile devices cannot/);
  state=registerDevice(state,{
    id:POCKET,siteId:SITE_HOME,hardwareProfile:'Pocket',trustState:'trusted',
    roles:['mobile_presence','identity_continuity','transition_sensor'],
    capabilities:{camera:true,location_transition:true}
  },1510).state;
  assert.equal(topologySnapshot(state).devices[0].mobility,'mobile');
});

test('authority must be released before move, trust loss, or role loss',()=>{
  let state=authorityNode(withSites());
  state=claimSiteAuthority(state,{siteId:SITE_HOME,deviceId:NODE_A},1600).state;
  assert.throws(()=>assignDeviceToSite(state,{deviceId:NODE_A,siteId:SITE_OFFICE},1610),/Release site authority/);
  assert.throws(()=>setDeviceTrust(state,{deviceId:NODE_A,trustState:'revoked'},1610),/Release site authority/);
  assert.throws(()=>setDeviceRoles(state,{deviceId:NODE_A,roles:['perception']},1610),/Release site authority/);
  state=releaseSiteAuthority(state,{siteId:SITE_HOME,deviceId:NODE_A,reason:'maintenance'},1620).state;
  state=assignDeviceToSite(state,{deviceId:NODE_A,siteId:SITE_OFFICE},1630).state;
  assert.equal(topologySnapshot(state).devices[0].siteId,SITE_OFFICE);
});

test('topology relationships are typed and reference registered entities',()=>{
  let state=authorityNode(withSites());
  state=registerDevice(state,{
    id:DESK,siteId:SITE_HOME,hardwareProfile:'Desk',trustState:'trusted',
    roles:['perception'],capabilities:{camera:true}
  },1700).state;
  state=upsertTopologyRelationship(state,{subjectId:DESK,type:'observes',objectId:SITE_HOME,metadata:{coverage:'office'}},1710).state;
  state=upsertTopologyRelationship(state,{subjectId:NODE_A,type:'controls',objectId:DESK},1720).state;
  assert.equal(topologySnapshot(state).relationships.length,2);
  assert.throws(()=>upsertTopologyRelationship(state,{subjectId:DESK,type:'unknown_relation',objectId:SITE_HOME},1730),/unsupported/);
});

test('topology rejects raw perception payload retention',()=>{
  const state=withSites();
  assert.throws(()=>registerDevice(state,{
    id:DESK,siteId:SITE_HOME,hardwareProfile:'Desk',metadata:{frameData:'secret'}
  },1800),/raw perception/);
});

test('cloud summary is compact and explicitly read-only',()=>{
  let state=authorityNode(withSites());
  state=claimSiteAuthority(state,{siteId:SITE_HOME,deviceId:NODE_A},1900).state;
  state=registerDevice(state,{
    id:POCKET,siteId:SITE_HOME,hardwareProfile:'Pocket',trustState:'trusted',
    roles:['mobile_presence','identity_continuity'],capabilities:{location_transition:true,camera:true}
  },1910).state;
  const summary=cloudTopologySummary(state);
  assert.equal(summary.protocol,'physical_site_topology.v1');
  assert.equal(summary.summary_only,true);
  assert.equal(summary.cloud_read_only,true);
  assert.equal(summary.authority_assignment,'local_only');
  assert.equal(summary.sites.find((x)=>x.id===SITE_HOME).authority_device_id,NODE_A);
  assert.equal(summary.sites.find((x)=>x.id===SITE_HOME).mobile_device_count,1);
  assert.equal(JSON.stringify(summary).includes('metadata'),false);
});

test('custom profiles remain first-class for future OTRO hardware',()=>{
  let state=withSites();
  state=registerDevice(state,{
    id:DESK,siteId:SITE_HOME,hardwareProfile:'Wall Hub',hardwareProfileLabel:'Wall Hub',
    trustState:'trusted',roles:['interaction'],capabilities:{display:true}
  },2000).state;
  const device=topologySnapshot(state).devices[0];
  assert.equal(device.hardwareProfile,'custom');
  assert.equal(device.hardwareProfileLabel,'Wall Hub');
});
