const copy=(v)=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=160)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);

export const FEDERATION_OPERATIONS_PROTOCOL='physical_federation_operations.v1';
export const FEDERATION_OPERATIONS_VERSION='2.80';
export const FEDERATION_HEALTH_STATES=Object.freeze(['healthy','degraded','critical','unknown']);

const severityRank={healthy:0,unknown:1,degraded:2,critical:3};
const peerRank={current:'healthy',unknown:'degraded',suspect:'degraded',reconciling:'degraded',stale:'degraded',partitioned:'critical',failed:'critical'};

function normalizeTopology(input={}){
  const topology=input&&typeof input==='object'?copy(input):{};
  return {
    protocol:txt(topology.protocol,80),
    revision:Math.max(0,Number(topology.revision)||0),
    sites:Array.isArray(topology.sites)?topology.sites:[],
    devices:Array.isArray(topology.devices)?topology.devices:[],
    relationships:Array.isArray(topology.relationships)?topology.relationships:[]
  };
}
function normalizeReconciliation(input={}){
  const reconciliation=input&&typeof input==='object'?copy(input):{};
  return {
    protocol:txt(reconciliation.protocol,80),
    local_site_id:txt(reconciliation.local_site_id??reconciliation.localSiteId,64).toLowerCase(),
    peers:Array.isArray(reconciliation.peers)?reconciliation.peers:[]
  };
}
function peerFor(reconciliation,siteId){
  if(siteId===reconciliation.local_site_id){
    return {site_id:siteId,status:'current',fresh:true,reconciliation_required:false,last_error:''};
  }
  const peer=reconciliation.peers.find((row)=>txt(row?.site_id??row?.remote_site_id,64).toLowerCase()===siteId);
  if(!peer)return {site_id:siteId,status:'unknown',fresh:false,reconciliation_required:true,last_error:''};
  const status=txt(peer.status||'unknown',24).toLowerCase();
  return {
    site_id:siteId,
    status:peerRank[status]?status:'unknown',
    fresh:status==='current',
    reconciliation_required:Boolean(peer.reconciliation_required)||['partitioned','reconciling','stale','failed','unknown'].includes(status),
    last_error:txt(peer.last_error,240),
    stale_since:peer.stale_since??0,
    partitioned_at:peer.partitioned_at??0,
    last_contact_at:peer.last_contact_at??0,
    retry_count:Math.max(0,Number(peer.retry_count)||0),
    next_retry_at:peer.next_retry_at??0
  };
}
function authorityFor(site,devices){
  const authorityDeviceId=txt(site.authority_device_id??site.authorityDeviceId,64).toLowerCase();
  const authorityEpoch=Math.max(0,Number(site.authority_epoch??site.authorityEpoch)||0);
  if(!authorityDeviceId)return {status:'missing',device_id:'',epoch:authorityEpoch};
  const device=devices.find((row)=>txt(row?.id??row?.device_id,64).toLowerCase()===authorityDeviceId);
  if(!device)return {status:'invalid',device_id:authorityDeviceId,epoch:authorityEpoch,reason:'authority_device_not_in_inventory'};
  const trust=txt(device.trust_state??device.trustState,24).toLowerCase();
  const roles=Array.isArray(device.roles)?device.roles:[];
  const caps=device.capabilities&&typeof device.capabilities==='object'?device.capabilities:{};
  const eligible=caps.site_authority_eligible===true||caps.site_authority_eligible==='true'||roles.includes('site_authority');
  if(trust&&trust!=='trusted')return {status:'invalid',device_id:authorityDeviceId,epoch:authorityEpoch,reason:'authority_device_not_trusted'};
  if(!eligible)return {status:'invalid',device_id:authorityDeviceId,epoch:authorityEpoch,reason:'authority_device_not_eligible'};
  return {status:'current',device_id:authorityDeviceId,epoch:authorityEpoch};
}
function maxHealth(states){
  if(!states.length)return 'unknown';
  return states.reduce((a,b)=>severityRank[b]>severityRank[a]?b:a,'healthy');
}
function issue(siteId,severity,code,message){
  return {site_id:siteId,severity,code,message};
}

export function buildFederationOperationsSnapshot(input={},now=Date.now()){
  const topology=normalizeTopology(input.topology);
  const reconciliation=normalizeReconciliation(input.reconciliation);
  const runtime=Array.isArray(input.runtime_devices)?copy(input.runtime_devices):[];
  const runtimeById=new Map(runtime.map(row=>[txt(row?.device_id??row?.id,64).toLowerCase(),row]));
  const devices=topology.devices.map((raw)=>{
    const id=txt(raw?.id??raw?.device_id,64).toLowerCase();
    const profile=txt(raw?.hardware_profile??raw?.hardwareProfile??'custom',40).toLowerCase()||'custom';
    const extra=runtimeById.get(id)||{};
    return {
      id,
      label:txt(raw?.label||profile,160),
      site_id:txt(raw?.site_id??raw?.siteId,64).toLowerCase(),
      hardware_profile:profile,
      hardware_profile_label:txt(raw?.hardware_profile_label??raw?.hardwareProfileLabel??profile,80),
      mobility:txt(raw?.mobility||'unknown',24).toLowerCase(),
      trust_state:txt(raw?.trust_state??raw?.trustState??'unknown',24).toLowerCase(),
      roles:Array.isArray(raw?.roles)?[...raw.roles].sort():[],
      capabilities:raw?.capabilities&&typeof raw.capabilities==='object'?copy(raw.capabilities):{},
      runtime_status:txt(extra.status??extra.runtime_status??'unknown',32).toLowerCase(),
      version:txt(extra.version,64),
      last_seen_at:extra.last_seen_at??extra.lastSeenAt??0
    };
  });
  const issues=[];
  const sites=topology.sites.map((raw)=>{
    const id=txt(raw?.id??raw?.site_id,64).toLowerCase();
    const members=devices.filter(d=>d.site_id===id);
    const authority=authorityFor(raw,devices);
    const peer=peerFor(reconciliation,id);
    const active=txt(raw?.status||'active',24).toLowerCase()==='active';
    let health='healthy';
    if(!active)health='unknown';
    else if(authority.status!=='current'||['partitioned','failed'].includes(peer.status))health='critical';
    else if(['unknown','suspect','reconciling','stale'].includes(peer.status))health='degraded';
    if(active&&authority.status==='missing')issues.push(issue(id,'critical','authority_missing','Active site has no authority device.'));
    if(active&&authority.status==='invalid')issues.push(issue(id,'critical',authority.reason||'authority_invalid','Site authority is not valid for the current inventory.'));
    if(['partitioned','failed'].includes(peer.status))issues.push(issue(id,'critical','federation_'+peer.status,'Federation peer is '+peer.status+'.'));
    else if(['unknown','suspect','reconciling','stale'].includes(peer.status))issues.push(issue(id,'degraded','federation_'+peer.status,'Federation peer is '+peer.status+'.'));
    return {
      id,
      label:txt(raw?.label||'Site',160),
      kind:txt(raw?.kind||'physical_site',64),
      status:txt(raw?.status||'active',24).toLowerCase(),
      device_count:members.length,
      profiles:[...new Set(members.map(d=>d.hardware_profile))].sort(),
      mobile_device_count:members.filter(d=>d.mobility==='mobile').length,
      authority,
      federation:peer,
      health
    };
  }).sort((a,b)=>a.id.localeCompare(b.id));
  const profile_counts={};
  for(const d of devices)profile_counts[d.hardware_profile]=(profile_counts[d.hardware_profile]||0)+1;
  const health=maxHealth(sites.filter(s=>s.status==='active').map(s=>s.health));
  return {
    protocol:FEDERATION_OPERATIONS_PROTOCOL,
    version:FEDERATION_OPERATIONS_VERSION,
    schema_version:1,
    generated_at:Number(now),
    read_only:true,
    authority_assignment:'origin_only',
    cloud_role:'relay_and_mirror_only',
    topology_revision:topology.revision,
    local_site_id:reconciliation.local_site_id,
    health,
    summary:{
      site_count:sites.length,
      active_site_count:sites.filter(s=>s.status==='active').length,
      device_count:devices.length,
      authority_count:sites.filter(s=>s.authority.status==='current').length,
      current_site_count:sites.filter(s=>s.federation.status==='current').length,
      degraded_site_count:sites.filter(s=>s.health==='degraded').length,
      critical_site_count:sites.filter(s=>s.health==='critical').length,
      profile_counts:Object.fromEntries(Object.entries(profile_counts).sort(([a],[b])=>a.localeCompare(b)))
    },
    sites,
    devices:devices.sort((a,b)=>a.id.localeCompare(b.id)),
    relationships:topology.relationships,
    issues:issues.sort((a,b)=>a.site_id.localeCompare(b.site_id)||a.code.localeCompare(b.code)),
    boundaries:[
      'operations-snapshot-is-read-only',
      'origin-site-authority-only',
      'cloud-remains-relay-and-mirror-only',
      'stale-and-partitioned-sites-are-explicit',
      'inventory-does-not-merge-site-local-identities',
      'health-never-promotes-authority'
    ]
  };
}

export function federationOperationsCapability(){
  return {
    version:FEDERATION_OPERATIONS_VERSION,
    protocol:FEDERATION_OPERATIONS_PROTOCOL,
    health_states:[...FEDERATION_HEALTH_STATES],
    hardware_profiles:['node','desk','studio','team_node','pocket','custom'],
    read_only:true,
    authority_assignment:'origin_only',
    cloud_role:'relay_and_mirror_only',
    authority_mutation:false,
    identity_mutation:false
  };
}
