const txt=(value,max=160)=>String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max);
const arr=(value)=>Array.isArray(value)?value:[];
const copy=(value)=>JSON.parse(JSON.stringify(value));
const ID=/^[A-Za-z0-9._:-]{2,128}$/;
const ROLE=/^[a-z][a-z0-9_.:-]{1,63}$/;
const CAP=/^[a-z][a-z0-9_.:-]{1,63}$/;
const REL=/^[a-z][a-z0-9_.:-]{1,63}$/;
const FORBIDDEN_RAW_KEYS=/^(?:image|imageDataUrl|frame|frameData|rawFrame|video|audio|embedding|embeddings|blob|bytes|pixels|cameraUri|filePath|filesystemPath)$/i;

export const SITE_TOPOLOGY_SCHEMA_VERSION=1;
export const SITE_TOPOLOGY_PROTOCOL='physical_site_topology.v1';
export const BUILTIN_HARDWARE_PROFILES=Object.freeze({
  node:{label:'Node',mobility:'fixed'},
  desk:{label:'Desk',mobility:'fixed'},
  studio:{label:'Studio',mobility:'fixed'},
  team_node:{label:'Team Node',mobility:'fixed'},
  pocket:{label:'Pocket',mobility:'mobile'},
  custom:{label:'Custom',mobility:'unknown'}
});
export const SITE_TRUST_STATES=Object.freeze(['untrusted','pending','trusted','revoked']);
export const SITE_RELATION_TYPES=Object.freeze([
  'member_of','peers_with','observes','controls','backs_up','travels_with','bridges_to'
]);

function safeId(value,label){
  const out=txt(value,128);
  if(!ID.test(out))throw new Error(label+' is invalid.');
  return out;
}
function safeToken(value,label,pattern=ROLE,max=64){
  const out=txt(value,max).toLowerCase();
  if(!pattern.test(out))throw new Error(label+' is invalid.');
  return out;
}
function safeUuid(value,label){
  const out=txt(value,64).toLowerCase();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(out)){
    throw new Error(label+' must be a UUID.');
  }
  return out;
}
function semanticCopy(value,depth=0){
  if(depth>8)throw new Error('Topology semantic value is too deeply nested.');
  if(value==null||['string','number','boolean'].includes(typeof value))return value;
  if(Array.isArray(value))return value.slice(0,64).map((item)=>semanticCopy(item,depth+1));
  if(typeof value!=='object')return null;
  const out={};
  for(const [key,item] of Object.entries(value).slice(0,64)){
    if(FORBIDDEN_RAW_KEYS.test(key))throw new Error('Topology cannot retain raw perception payloads.');
    out[txt(key,80)]=semanticCopy(item,depth+1);
  }
  return out;
}
function stableUnique(values,normalizer){
  const seen=new Set(),out=[];
  for(const value of arr(values)){
    const normalized=normalizer(value);
    if(!seen.has(normalized)){seen.add(normalized);out.push(normalized);}
  }
  return out.sort();
}
function normalizeCapabilities(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('capabilities must be an object.');
  const out={};
  for(const [key,raw] of Object.entries(value).slice(0,128)){
    const name=safeToken(key,'capability',CAP);
    if(!['boolean','string','number'].includes(typeof raw)&&raw!==null)throw new Error('Capability values must be scalar.');
    out[name]=typeof raw==='string'?txt(raw,160):raw;
  }
  return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));
}
function profileKey(value){
  const normalized=txt(value||'custom',80).toLowerCase().replace(/[\s-]+/g,'_');
  return BUILTIN_HARDWARE_PROFILES[normalized]?normalized:'custom';
}
function mobilityFor(profile,input){
  const requested=txt(input||'',20).toLowerCase();
  if(['fixed','mobile','portable','unknown'].includes(requested))return requested;
  return BUILTIN_HARDWARE_PROFILES[profile]?.mobility||'unknown';
}
function findSite(state,siteId){return state.sites.find((site)=>site.id===siteId)||null;}
function findDevice(state,deviceId){return state.devices.find((device)=>device.id===deviceId)||null;}
function nextRevision(state,now){state.revision=Math.max(0,Number(state.revision)||0)+1;state.updatedAt=Number(now);}
function audit(state,type,details,now){
  state.audit=[...state.audit,{revision:state.revision,type:txt(type,60),details:semanticCopy(details||{}),at:Number(now)}].slice(-250);
}
function assertSiteAuthorityEligible(device){
  if(device.trustState!=='trusted')throw new Error('Site authority requires a trusted device.');
  if(!device.roles.includes('site_authority'))throw new Error('Device does not hold the site_authority role.');
  if(device.capabilities.site_authority_eligible!==true)throw new Error('Device is not capability-eligible for site authority.');
  if(device.mobility==='mobile')throw new Error('Mobile devices cannot hold durable site authority.');
}

export function createSiteTopologyState(now=Date.now()){
  return {
    schemaVersion:SITE_TOPOLOGY_SCHEMA_VERSION,
    protocol:SITE_TOPOLOGY_PROTOCOL,
    createdAt:Number(now),updatedAt:Number(now),revision:0,
    sites:[],devices:[],relationships:[],authority:[],audit:[],
    boundaries:[
      'stable-site-and-device-uuids',
      'capability-driven-roles',
      'single-authority-per-site',
      'mobile-devices-do-not-imply-site-authority',
      'cloud-summary-is-read-only',
      'raw-perception-never-retained'
    ]
  };
}
export function hydrateSiteTopologyState(input={},now=Date.now()){
  const base=createSiteTopologyState(now);
  if(!input||typeof input!=='object')return base;
  if(input.protocol&&input.protocol!==SITE_TOPOLOGY_PROTOCOL)throw new Error('Unsupported site topology protocol.');
  return {
    ...base,
    createdAt:Number(input.createdAt||now),updatedAt:Number(input.updatedAt||now),revision:Math.max(0,Number(input.revision)||0),
    sites:arr(input.sites).slice(-128),devices:arr(input.devices).slice(-512),relationships:arr(input.relationships).slice(-1024),
    authority:arr(input.authority).slice(-128),audit:arr(input.audit).slice(-250)
  };
}
export function registerSite(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const id=safeUuid(input.id,'site id');
  const existing=findSite(state,id);
  const aliases=stableUnique(input.aliases||[],(v)=>safeId(v,'site alias'));
  const normalized={
    id,
    label:txt(input.label||'Site',160)||'Site',
    aliases,
    kind:safeToken(input.kind||'physical_site','site kind'),
    status:['active','inactive','retired'].includes(txt(input.status||'active',20).toLowerCase())?txt(input.status||'active',20).toLowerCase():'active',
    metadata:semanticCopy(input.metadata||{}),
    createdAt:existing?.createdAt||Number(now),updatedAt:Number(now)
  };
  if(existing){
    const index=state.sites.findIndex((site)=>site.id===id);state.sites[index]=normalized;
  }else state.sites=[...state.sites,normalized].slice(-128);
  nextRevision(state,now);audit(state,existing?'site_updated':'site_registered',{siteId:id},now);
  return {state,site:copy(normalized),created:!existing};
}
export function registerDevice(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const id=safeUuid(input.id,'device id');
  const existing=findDevice(state,id);
  const profile=profileKey(input.hardwareProfile);
  const siteId=input.siteId?safeUuid(input.siteId,'site id'):null;
  if(siteId&&!findSite(state,siteId))throw new Error('Device site is not registered.');
  const trustState=txt(input.trustState||existing?.trustState||'pending',20).toLowerCase();
  if(!SITE_TRUST_STATES.includes(trustState))throw new Error('Device trust state is invalid.');
  const roles=stableUnique(input.roles||existing?.roles||[],(v)=>safeToken(v,'device role'));
  const capabilities=normalizeCapabilities(input.capabilities||existing?.capabilities||{});
  const normalized={
    id,
    label:txt(input.label||BUILTIN_HARDWARE_PROFILES[profile].label,160)||BUILTIN_HARDWARE_PROFILES[profile].label,
    aliases:stableUnique(input.aliases||existing?.aliases||[],(v)=>safeId(v,'device alias')),
    hardwareProfile:profile,
    hardwareProfileLabel:profile==='custom'?txt(input.hardwareProfileLabel||existing?.hardwareProfileLabel||'Custom',80):BUILTIN_HARDWARE_PROFILES[profile].label,
    siteId,
    mobility:mobilityFor(profile,input.mobility||existing?.mobility),
    trustState,roles,capabilities,
    metadata:semanticCopy(input.metadata||existing?.metadata||{}),
    createdAt:existing?.createdAt||Number(now),updatedAt:Number(now)
  };
  if(normalized.mobility==='mobile'&&normalized.roles.includes('site_authority'))throw new Error('Mobile devices cannot be assigned the site_authority role.');
  if(existing){
    const index=state.devices.findIndex((device)=>device.id===id);state.devices[index]=normalized;
  }else state.devices=[...state.devices,normalized].slice(-512);
  nextRevision(state,now);audit(state,existing?'device_updated':'device_registered',{deviceId:id,siteId,hardwareProfile:profile},now);
  return {state,device:copy(normalized),created:!existing};
}
export function assignDeviceToSite(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const device=findDevice(state,safeUuid(input.deviceId,'device id'));
  if(!device)throw new Error('Device is not registered.');
  const siteId=input.siteId?safeUuid(input.siteId,'site id'):null;
  if(siteId&&!findSite(state,siteId))throw new Error('Device site is not registered.');
  const held=state.authority.find((row)=>row.deviceId===device.id&&row.active);
  if(held&&held.siteId!==siteId)throw new Error('Release site authority before moving the device to another site.');
  const fromSiteId=device.siteId||null;device.siteId=siteId;device.updatedAt=Number(now);
  nextRevision(state,now);audit(state,'device_site_changed',{deviceId:device.id,fromSiteId,toSiteId:siteId},now);
  return {state,device:copy(device)};
}
export function setDeviceTrust(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const device=findDevice(state,safeUuid(input.deviceId,'device id'));
  if(!device)throw new Error('Device is not registered.');
  const trustState=txt(input.trustState,20).toLowerCase();
  if(!SITE_TRUST_STATES.includes(trustState))throw new Error('Device trust state is invalid.');
  if(trustState!=='trusted'&&state.authority.some((row)=>row.deviceId===device.id&&row.active)){
    throw new Error('Release site authority before removing device trust.');
  }
  device.trustState=trustState;device.updatedAt=Number(now);
  nextRevision(state,now);audit(state,'device_trust_changed',{deviceId:device.id,trustState},now);
  return {state,device:copy(device)};
}
export function setDeviceRoles(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const device=findDevice(state,safeUuid(input.deviceId,'device id'));
  if(!device)throw new Error('Device is not registered.');
  const roles=stableUnique(input.roles||[],(v)=>safeToken(v,'device role'));
  if(device.mobility==='mobile'&&roles.includes('site_authority'))throw new Error('Mobile devices cannot be assigned the site_authority role.');
  if(!roles.includes('site_authority')&&state.authority.some((row)=>row.deviceId===device.id&&row.active)){
    throw new Error('Release site authority before removing the site_authority role.');
  }
  device.roles=roles;device.updatedAt=Number(now);
  nextRevision(state,now);audit(state,'device_roles_changed',{deviceId:device.id,roles},now);
  return {state,device:copy(device)};
}
export function upsertTopologyRelationship(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const subjectId=safeUuid(input.subjectId,'relationship subject');
  const objectId=safeUuid(input.objectId,'relationship object');
  if(subjectId===objectId)throw new Error('Topology relationship cannot target itself.');
  if(!findDevice(state,subjectId)&&!findSite(state,subjectId))throw new Error('Relationship subject is not registered.');
  if(!findDevice(state,objectId)&&!findSite(state,objectId))throw new Error('Relationship object is not registered.');
  const type=safeToken(input.type,'relationship type',REL);
  if(!SITE_RELATION_TYPES.includes(type)&&!type.startsWith('custom.'))throw new Error('Topology relationship type is unsupported.');
  const id=subjectId+'|'+type+'|'+objectId;
  const normalized={id,subjectId,type,objectId,metadata:semanticCopy(input.metadata||{}),updatedAt:Number(now)};
  const index=state.relationships.findIndex((row)=>row.id===id);
  if(index>=0)state.relationships[index]=normalized;else state.relationships=[...state.relationships,normalized].slice(-1024);
  nextRevision(state,now);audit(state,index>=0?'relationship_updated':'relationship_added',{subjectId,type,objectId},now);
  return {state,relationship:copy(normalized),created:index<0};
}
export function claimSiteAuthority(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const siteId=safeUuid(input.siteId,'site id');
  const deviceId=safeUuid(input.deviceId,'device id');
  const site=findSite(state,siteId),device=findDevice(state,deviceId);
  if(!site)throw new Error('Site is not registered.');
  if(!device)throw new Error('Device is not registered.');
  if(device.siteId!==siteId)throw new Error('Authority device must belong to the site.');
  assertSiteAuthorityEligible(device);
  const active=state.authority.find((row)=>row.siteId===siteId&&row.active);
  if(active&&active.deviceId!==deviceId&&!input.replace)throw new Error('Site already has an active authority device.');
  const epoch=Math.max(0,...state.authority.filter((row)=>row.siteId===siteId).map((row)=>Number(row.epoch)||0))+1;
  for(const row of state.authority){if(row.siteId===siteId&&row.active){row.active=false;row.releasedAt=Number(now);row.releaseReason=txt(input.reason||'authority_replaced',200);}}
  const authority={siteId,deviceId,epoch,active:true,claimedAt:Number(now),releasedAt:null,releaseReason:null};
  state.authority=[...state.authority,authority].slice(-256);
  nextRevision(state,now);audit(state,'site_authority_claimed',{siteId,deviceId,epoch},now);
  return {state,authority:copy(authority),replaced:active?copy(active):null};
}
export function releaseSiteAuthority(stateInput,input={},now=Date.now()){
  const state=hydrateSiteTopologyState(stateInput,now);
  const siteId=safeUuid(input.siteId,'site id');
  const active=state.authority.find((row)=>row.siteId===siteId&&row.active);
  if(!active)return {state,released:false,authority:null};
  if(input.deviceId&&active.deviceId!==safeUuid(input.deviceId,'device id'))throw new Error('Authority device does not match.');
  active.active=false;active.releasedAt=Number(now);active.releaseReason=txt(input.reason||'released',200);
  nextRevision(state,now);audit(state,'site_authority_released',{siteId,deviceId:active.deviceId,epoch:active.epoch},now);
  return {state,released:true,authority:copy(active)};
}
export function topologySnapshot(stateInput){
  const state=hydrateSiteTopologyState(stateInput);
  const sites=state.sites.map((site)=>({
    ...copy(site),
    authorityDeviceId:state.authority.find((row)=>row.siteId===site.id&&row.active)?.deviceId||null,
    deviceCount:state.devices.filter((device)=>device.siteId===site.id).length
  }));
  const unassignedDevices=state.devices.filter((device)=>!device.siteId).map(copy);
  return {protocol:state.protocol,schemaVersion:state.schemaVersion,revision:state.revision,updatedAt:state.updatedAt,sites,devices:copy(state.devices),unassignedDevices,relationships:copy(state.relationships)};
}
export function cloudTopologySummary(stateInput){
  const state=hydrateSiteTopologyState(stateInput);
  return {
    protocol:SITE_TOPOLOGY_PROTOCOL,
    schema_version:SITE_TOPOLOGY_SCHEMA_VERSION,
    revision:state.revision,
    generated_at:state.updatedAt,
    summary_only:true,
    cloud_read_only:true,
    authority_assignment:'local_only',
    sites:state.sites.map((site)=>{
      const authority=state.authority.find((row)=>row.siteId===site.id&&row.active);
      const devices=state.devices.filter((device)=>device.siteId===site.id);
      return {
        id:site.id,label:site.label,kind:site.kind,status:site.status,
        device_count:devices.length,
        authority_device_id:authority?.deviceId||'',
        authority_epoch:authority?.epoch||0,
        profiles:[...new Set(devices.map((device)=>device.hardwareProfile))].sort(),
        mobile_device_count:devices.filter((device)=>device.mobility==='mobile').length
      };
    }),
    devices:state.devices.map((device)=>({
      id:device.id,label:device.label,site_id:device.siteId||'',hardware_profile:device.hardwareProfile,
      hardware_profile_label:device.hardwareProfileLabel,mobility:device.mobility,trust_state:device.trustState,
      roles:[...device.roles],capabilities:Object.keys(device.capabilities).filter((key)=>device.capabilities[key]===true).sort()
    })),
    relationships:state.relationships.map((row)=>({subject_id:row.subjectId,type:row.type,object_id:row.objectId}))
  };
}
