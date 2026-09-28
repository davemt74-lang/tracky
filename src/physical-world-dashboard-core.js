const copy=(v)=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=160)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const clamp=(v)=>Math.max(0,Math.min(1,Number(v)||0));
const SITE_REF=/^site:([0-9a-f-]{36})::(.+)$/i;

export const PHYSICAL_WORLD_DASHBOARD_PROTOCOL='physical_world_dashboard.v1';
export const PHYSICAL_WORLD_DASHBOARD_VERSION='2.80';

const ROOM_TYPES=new Set(['room','area','zone','space','environment']);
const PERSON_TYPES=new Set(['person']);
const DEVICE_TYPES=new Set(['device','sensor','camera','appliance','hardware']);
const LOCATION_PREDICATES=new Set(['located_in','present_in','located_on','inside','in_room']);

function worldSites(world){
  if(Array.isArray(world?.sites))return world.sites;
  if(world?.sites&&typeof world.sites==='object')return Object.values(world.sites);
  return [];
}
function opSites(operations){return Array.isArray(operations?.sites)?operations.sites:[];}
function opDevices(operations){return Array.isArray(operations?.devices)?operations.devices:[];}
function siteId(row){return txt(row?.site_id??row?.id,64).toLowerCase();}
function entityRef(site,entity){
  return txt(entity?.ref||('site:'+site+'::'+encodeURIComponent(entity?.local_id??entity?.id??'')),360);
}
function relationRef(site,value){
  const ref=txt(value,360);
  if(ref)return ref;
  return site?'site:'+site+'::':'';
}
function entityType(entity){return txt(entity?.type||'entity',40).toLowerCase()||'entity';}
function categoryFor(type){
  if(ROOM_TYPES.has(type))return 'rooms';
  if(PERSON_TYPES.has(type))return 'people';
  if(DEVICE_TYPES.has(type))return 'devices';
  return 'objects';
}
function refLocalId(ref){
  const match=SITE_REF.exec(String(ref||''));
  if(!match)return '';
  try{return decodeURIComponent(match[2]);}catch{return match[2];}
}
function locationFor(site,entity,relations,entityByLocal){
  const ref=entityRef(site,entity);
  const local=txt(entity?.local_id??entity?.id,160);
  const candidates=relations.filter((rel)=>{
    const predicate=txt(rel?.predicate,60).toLowerCase();
    if(!LOCATION_PREDICATES.has(predicate))return false;
    const subject=txt(rel?.subject_ref,360)||('site:'+site+'::'+encodeURIComponent(rel?.subject_local_id||''));
    return subject===ref||txt(rel?.subject_local_id,160)===local;
  }).map((rel)=>{
    const objectRef=txt(rel?.object_ref,360)||(
      rel?.object_local_id?'site:'+site+'::'+encodeURIComponent(rel.object_local_id):''
    );
    const objectLocal=txt(rel?.object_local_id,160)||refLocalId(objectRef);
    const target=entityByLocal.get(objectLocal)||null;
    return {
      location_ref:objectRef,
      location_local_id:objectLocal,
      location_label:txt(target?.label||target?.name||objectLocal,160),
      predicate:txt(rel?.predicate,60).toLowerCase(),
      confidence:clamp(rel?.confidence),
      temporal_state:txt(rel?.temporal_state||'unknown',30).toLowerCase(),
      as_of:Number(rel?.as_of)||0
    };
  }).filter(x=>x.location_ref);
  candidates.sort((a,b)=>{
    const ac=['current','inferred'].includes(a.temporal_state)?1:0;
    const bc=['current','inferred'].includes(b.temporal_state)?1:0;
    return bc-ac||b.confidence-a.confidence||b.as_of-a.as_of;
  });
  return candidates[0]||null;
}
function normalizeEntity(site,entity,relations,entityByLocal){
  const type=entityType(entity);
  const location=locationFor(site,entity,relations,entityByLocal);
  const observedAt=Number(entity?.observed_at)||0;
  const state=txt(entity?.state||'unknown',30).toLowerCase();
  const entityConfidence=clamp(entity?.confidence);
  const confidence=location?clamp((entityConfidence*0.4)+(location.confidence*0.6)):entityConfidence;
  return {
    ref:entityRef(site,entity),
    local_id:txt(entity?.local_id??entity?.id,160),
    site_id:site,
    type,
    category:categoryFor(type),
    label:txt(entity?.label||entity?.name||entity?.local_id||entity?.id||type,160),
    state,
    confidence,
    observed_at:observedAt,
    current:['observed','user-confirmed'].includes(state)&&(!location||['current','inferred'].includes(location.temporal_state)),
    last_known:state==='last-known'||!!observedAt,
    location,
    identity_scope:'site_local'
  };
}
function selectedSiteId(input,siteIds){
  const explicit=txt(input.selectedSiteId??input.selected_site_id,64).toLowerCase();
  const current=txt(input.agentContext?.current_site?.site_id??input.agent_context?.current_site?.site_id,64).toLowerCase();
  const local=txt(input.operations?.local_site_id,64).toLowerCase();
  if(explicit&&siteIds.has(explicit))return {site_id:explicit,basis:'explicit_user_selection'};
  if(current&&siteIds.has(current))return {site_id:current,basis:'current_agent_site'};
  if(local&&siteIds.has(local))return {site_id:local,basis:'local_site_fallback'};
  return {site_id:[...siteIds][0]||'',basis:[...siteIds].length?'first_authorized_site':'none'};
}
function siteWorldSummary(fragment){
  const site=siteId(fragment);
  const entities=Array.isArray(fragment?.entities)?fragment.entities:[];
  const counts={rooms:0,people:0,objects:0,devices:0};
  for(const entity of entities)counts[categoryFor(entityType(entity))]+=1;
  return {site_id:site,world_revision:Number(fragment?.revision)||0,observed_at:fragment?.observed_at??0,counts};
}

export function buildPhysicalWorldDashboard(input={},now=Date.now()){
  const operations=copy(input.operations||{});
  const world=copy(input.federatedWorld??input.federated_world??{});
  const agentContext=copy(input.agentContext??input.agent_context??{});
  const opSiteRows=opSites(operations);
  const worldRows=worldSites(world);
  const opById=new Map(opSiteRows.map(row=>[siteId(row),row]).filter(([id])=>id));
  const worldById=new Map(worldRows.map(row=>[siteId(row),row]).filter(([id])=>id));
  const siteIds=new Set([...opById.keys(),...worldById.keys()]);
  const selection=selectedSiteId({...input,operations,agentContext},siteIds);
  const selectedFragment=worldById.get(selection.site_id)||null;
  const relations=Array.isArray(selectedFragment?.relations)?selectedFragment.relations:[];
  const entitiesRaw=Array.isArray(selectedFragment?.entities)?selectedFragment.entities:[];
  const entityByLocal=new Map(entitiesRaw.map(e=>[txt(e?.local_id??e?.id,160),e]).filter(([id])=>id));
  const normalized=entitiesRaw.map(entity=>normalizeEntity(selection.site_id,entity,relations,entityByLocal));
  const groups={rooms:[],people:[],objects:[],devices:[]};
  for(const item of normalized)groups[item.category].push(item);
  const inventoryDevices=opDevices(operations).filter(d=>siteId(d)===selection.site_id).map(d=>({
    id:txt(d?.id??d?.device_id,64).toLowerCase(),
    label:txt(d?.label||d?.hardware_profile_label||d?.hardware_profile||'Device',160),
    hardware_profile:txt(d?.hardware_profile||'custom',40).toLowerCase(),
    hardware_profile_label:txt(d?.hardware_profile_label||d?.hardware_profile||'Custom',80),
    trust_state:txt(d?.trust_state||'unknown',24).toLowerCase(),
    runtime_status:txt(d?.runtime_status||'unknown',32).toLowerCase(),
    version:txt(d?.version,64),
    authority_device_id:txt(opById.get(selection.site_id)?.authority?.device_id??opById.get(selection.site_id)?.authority_device_id,64).toLowerCase()
  })).sort((a,b)=>a.label.localeCompare(b.label));
  for(const key of Object.keys(groups))groups[key].sort((a,b)=>Number(b.current)-Number(a.current)||b.confidence-a.confidence||a.label.localeCompare(b.label));

  const siteOptions=[...siteIds].sort().map(id=>{
    const op=opById.get(id)||{};
    const ws=siteWorldSummary(worldById.get(id)||{site_id:id});
    return {
      site_id:id,
      label:txt(op?.label||worldById.get(id)?.context?.site||id,160),
      selected:id===selection.site_id,
      health:txt(op?.health||'unknown',24).toLowerCase(),
      federation_status:txt(op?.federation?.status||'unknown',24).toLowerCase(),
      authority_device_id:txt(op?.authority?.device_id??op?.authority_device_id,64).toLowerCase(),
      authority_epoch:Number(op?.authority?.epoch??op?.authority_epoch)||0,
      world_revision:ws.world_revision,
      counts:ws.counts
    };
  });
  const physicalCurrentSite=txt(agentContext?.current_site?.site_id,64).toLowerCase();
  const selectedOp=opById.get(selection.site_id)||{};
  const selectionIssue=(txt(input.selectedSiteId??input.selected_site_id,64)&&selection.basis!=='explicit_user_selection')
    ?'requested_site_not_available':null;

  return {
    protocol:PHYSICAL_WORLD_DASHBOARD_PROTOCOL,
    version:PHYSICAL_WORLD_DASHBOARD_VERSION,
    schema_version:1,
    generated_at:Number(now),
    selected_site:{
      site_id:selection.site_id,
      label:txt(selectedOp?.label||worldById.get(selection.site_id)?.context?.site||'',160),
      basis:selection.basis,
      health:txt(selectedOp?.health||'unknown',24).toLowerCase(),
      federation_status:txt(selectedOp?.federation?.status||'unknown',24).toLowerCase(),
      world_revision:Number(selectedFragment?.revision)||0,
      observed_at:selectedFragment?.observed_at??0
    },
    site_options:siteOptions,
    counts:{
      rooms:groups.rooms.length,
      people:groups.people.length,
      objects:groups.objects.length,
      world_devices:groups.devices.length,
      hardware_units:inventoryDevices.length
    },
    rooms:groups.rooms,
    people:groups.people,
    objects:groups.objects,
    world_devices:groups.devices,
    hardware_units:inventoryDevices,
    agent_context:{
      view_site_id:selection.site_id,
      view_basis:selection.basis,
      physical_current_site_id:physicalCurrentSite,
      physical_state:txt(agentContext?.physical_state||'unknown',40).toLowerCase(),
      agent_state:txt(agentContext?.agent_state||'unknown',40).toLowerCase(),
      follows_selected_site:true,
      view_only:true,
      changes_physical_authority:false,
      changes_physical_location:false
    },
    issues:selectionIssue?[{severity:'degraded',code:selectionIssue}]:[],
    semantic_only:true,
    permission_filtered_input:true,
    identity_scope:'site_local',
    cross_site_identity_merge:false,
    authority_assignment:'origin_only',
    cloud_role:'relay_and_mirror_only'
  };
}

export function physicalWorldDashboardCapability(){
  return {
    version:PHYSICAL_WORLD_DASHBOARD_VERSION,
    protocol:PHYSICAL_WORLD_DASHBOARD_PROTOCOL,
    categories:['rooms','people','objects','world_devices','hardware_units'],
    site_switching:true,
    agent_context_follows_selected_site:true,
    view_only:true,
    authority_mutation:false,
    physical_location_mutation:false,
    cross_site_identity_merge:false,
    semantic_only:true
  };
}
