const txt=(v,max=200)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const arr=(v)=>Array.isArray(v)?v:[];
const copy=(v)=>JSON.parse(JSON.stringify(v));
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN=/^[a-z][a-z0-9_.:-]{1,79}$/;
const LOCAL=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const FORBIDDEN=/(?:^|_)(?:raw|frame|frames|image|images|video|videos|audio|recording|recordings|embedding|embeddings|blob|bytes|pixels|file_path|filesystem_path|camera_uri)(?:$|_)/i;
const TEMPORAL=new Set(['current','last_seen','historical','inferred','predicted','unknown']);
const STATES=new Set(['observed','inferred','last-known','user-confirmed','contradicted','expired','unknown']);

export const FEDERATED_WORLD_PROTOCOL='physical_federated_world.v1';
export const FEDERATED_WORLD_SCHEMA_VERSION=1;

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out))throw new Error(label+' must be a UUID.');
  return out;
}
function token(v,label,fallback=''){
  const out=txt(v||fallback,80).toLowerCase();
  if(!TOKEN.test(out))throw new Error(label+' is invalid.');
  return out;
}
function localId(v,label){
  const out=txt(v,160);
  if(!LOCAL.test(out))throw new Error(label+' is invalid.');
  return out;
}
function semantic(value,path='payload',depth=0){
  if(depth>8)throw new Error('Federated world semantic value is too deeply nested.');
  if(value==null||['string','number','boolean'].includes(typeof value)){
    return typeof value==='string'?txt(value,500):value;
  }
  if(Array.isArray(value)){
    if(value.length>128)throw new Error('Federated world semantic list is too large.');
    return value.map((item,index)=>semantic(item,path+'['+index+']',depth+1));
  }
  if(typeof value!=='object')return null;
  const out={};
  for(const [key,item] of Object.entries(value).slice(0,128)){
    if(FORBIDDEN.test(key))throw new Error('Federated world cannot retain raw perception payloads at '+path+'.'+key+'.');
    out[txt(key,80)]=semantic(item,path+'.'+key,depth+1);
  }
  return out;
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,canonical(value[key])]));
  }
  return value;
}
function stableHash(value){
  const input=JSON.stringify(canonical(value));
  let h=2166136261;
  for(const ch of input){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16).padStart(8,'0');
}
function topologySites(topology){
  return arr(topology?.sites);
}
function topologyAuthority(topology,siteId){
  const site=topologySites(topology).find((item)=>(item.id||item.site_id)===siteId);
  if(!site)return null;
  const authorityDeviceId=site.authorityDeviceId||site.authority_device_id||'';
  const authorityEpoch=Number(site.authorityEpoch??site.authority_epoch??0);
  if(!authorityDeviceId||authorityEpoch<1)return null;
  return {site,deviceId:uuid(authorityDeviceId,'authority device id'),epoch:authorityEpoch};
}
function topologyRevision(topology){
  return Math.max(0,Number(topology?.revision??0)||0);
}
function qualify(siteId,id){
  return 'site:'+siteId+'::'+encodeURIComponent(id);
}
function entityInputId(item){
  return item?.localId??item?.local_id??item?.id??item?.entity_id??item?.subjectId??item?.subject_id;
}
function normalizeEntity(siteId,item={},now=Date.now()){
  semantic(item,'entity');
  const id=localId(entityInputId(item),'entity local id');
  const type=token(item.type||item.entityType||item.entity_type||'entity','entity type','entity');
  const state=txt(item.state||'unknown',30).toLowerCase();
  const observed=Number(item.lastObservedAt??item.last_observed_at??item.observedAt??item.observed_at??now);
  return {
    local_id:id,
    ref:qualify(siteId,id),
    type,
    label:txt(item.label||item.name||'',160),
    state:STATES.has(state)?state:'unknown',
    confidence:clamp01(item.confidence),
    observed_at:Number.isFinite(observed)?observed:Number(now)
  };
}
function normalizeRelation(siteId,item={},now=Date.now()){
  semantic(item,'relation');
  const subject=localId(item.subjectId??item.subject_id,'relation subject');
  const rawObject=item.objectId??item.object_id??'';
  const objectId=rawObject===''?'':localId(rawObject,'relation object');
  const temporal=txt(item.temporalState??item.temporal_state??'current',30).toLowerCase();
  const sequence=Math.max(0,Number(item.sequence??item.sequence_no??0)||0);
  const at=Number(item.asOf??item.as_of??item.observedAt??item.observed_at??now);
  return {
    subject_local_id:subject,
    subject_ref:qualify(siteId,subject),
    predicate:token(item.predicate||'related_to','relation predicate','related_to'),
    object_local_id:objectId,
    object_ref:objectId?qualify(siteId,objectId):'',
    value:semantic(item.value||{},'relation.value'),
    confidence:clamp01(item.confidence),
    temporal_state:TEMPORAL.has(temporal)?temporal:'unknown',
    source_event_id:txt(item.sourceEventId??item.source_event_id??'',160),
    sequence,
    as_of:Number.isFinite(at)?at:Number(now)
  };
}
function deriveEntities(siteId,entities,relations,now){
  const out=new Map();
  for(const raw of arr(entities)){
    const entity=normalizeEntity(siteId,raw,now);
    out.set(entity.local_id,entity);
  }
  for(const relation of relations){
    for(const id of [relation.subject_local_id,relation.object_local_id]){
      if(id&&!out.has(id))out.set(id,{
        local_id:id,ref:qualify(siteId,id),type:'entity',label:'',state:'unknown',confidence:0,observed_at:relation.as_of
      });
    }
  }
  return [...out.values()].sort((a,b)=>a.local_id.localeCompare(b.local_id));
}
function fragmentMaterial(fragment){
  return {
    protocol:fragment.protocol,schema_version:fragment.schema_version,site_id:fragment.site_id,
    authority_device_id:fragment.authority_device_id,authority_epoch:fragment.authority_epoch,
    topology_revision:fragment.topology_revision,revision:fragment.revision,observed_at:fragment.observed_at,
    entities:fragment.entities,relations:fragment.relations,context:fragment.context
  };
}
function normalizeFragment(input={}){
  if(input.protocol!==FEDERATED_WORLD_PROTOCOL)throw new Error('Unsupported federated world protocol.');
  const siteId=uuid(input.site_id??input.siteId,'site id');
  const authorityDeviceId=uuid(input.authority_device_id??input.authorityDeviceId,'authority device id');
  const authorityEpoch=Math.max(0,Number(input.authority_epoch??input.authorityEpoch??0)||0);
  const revision=Math.max(0,Number(input.revision||0)||0);
  if(authorityEpoch<1)throw new Error('authority epoch is required.');
  if(revision<1)throw new Error('world revision is required.');
  const observedAt=Number(input.observed_at??input.observedAt??Date.now());
  const relations=arr(input.relations).map((item)=>normalizeRelation(siteId,item,observedAt));
  const entities=deriveEntities(siteId,input.entities,relations,observedAt);
  const fragment={
    protocol:FEDERATED_WORLD_PROTOCOL,schema_version:FEDERATED_WORLD_SCHEMA_VERSION,
    site_id:siteId,authority_device_id:authorityDeviceId,authority_epoch:authorityEpoch,
    topology_revision:Math.max(0,Number(input.topology_revision??input.topologyRevision??0)||0),
    revision,observed_at:Number.isFinite(observedAt)?observedAt:Date.now(),
    entities,relations,context:semantic(input.context||{},'context'),
    semantic_only:true,identity_scope:'site_local'
  };
  fragment.fingerprint=stableHash(fragmentMaterial(fragment));
  return fragment;
}

export function qualifyFederatedEntityRef(siteId,localEntityId){
  return qualify(uuid(siteId,'site id'),localId(localEntityId,'entity local id'));
}

export function buildSiteWorldFragment(input={},now=Date.now()){
  const topology=input.topology||{};
  const siteId=uuid(input.siteId??input.site_id,'site id');
  const authority=topologyAuthority(topology,siteId);
  if(!authority)throw new Error('Site must have an active authority device before its world can federate.');
  const status=txt(authority.site.status||'active',20).toLowerCase();
  if(status!=='active')throw new Error('Inactive site cannot publish an authoritative world fragment.');
  return normalizeFragment({
    protocol:FEDERATED_WORLD_PROTOCOL,
    site_id:siteId,
    authority_device_id:authority.deviceId,
    authority_epoch:authority.epoch,
    topology_revision:topologyRevision(topology),
    revision:Math.max(1,Number(input.revision||1)||1),
    observed_at:Number(input.observedAt??input.observed_at??now),
    entities:input.entities||input.sceneGraph?.nodes||[],
    relations:input.relations||input.world_state||input.sceneGraph?.edges||[],
    context:input.context||{}
  });
}

export function createFederatedWorldState(now=Date.now()){
  return {
    protocol:FEDERATED_WORLD_PROTOCOL,schemaVersion:FEDERATED_WORLD_SCHEMA_VERSION,
    createdAt:Number(now),updatedAt:Number(now),sites:{},
    boundaries:[
      'site-authority-preserved',
      'entity-identity-site-scoped',
      'cross-site-identity-linking-deferred',
      'monotonic-site-world-revisions',
      'raw-perception-never-retained',
      'cloud-read-only'
    ]
  };
}

export function applySiteWorldFragment(stateInput,fragmentInput,topology={},now=Date.now()){
  const state=stateInput&&stateInput.protocol===FEDERATED_WORLD_PROTOCOL?copy(stateInput):createFederatedWorldState(now);
  const fragment=normalizeFragment(fragmentInput);
  const authority=topologyAuthority(topology,fragment.site_id);
  if(!authority)throw new Error('Federated fragment site has no active topology authority.');
  if(authority.deviceId!==fragment.authority_device_id||authority.epoch!==fragment.authority_epoch){
    throw new Error('Federated fragment authority does not match the current site authority epoch.');
  }
  const prior=state.sites[fragment.site_id]||null;
  if(prior&&fragment.revision<prior.revision)return {state,fragment:copy(prior),stale:true,idempotent:false,changed:false};
  if(prior&&fragment.revision===prior.revision){
    if(prior.fingerprint!==fragment.fingerprint)throw new Error('Federated fragment revision conflicts with existing site world.');
    return {state,fragment:copy(prior),stale:false,idempotent:true,changed:false};
  }
  state.sites[fragment.site_id]=fragment;
  state.updatedAt=Number(now);
  return {state,fragment:copy(fragment),stale:false,idempotent:false,changed:true};
}

export function federatedWorldSnapshot(stateInput){
  const state=stateInput&&stateInput.protocol===FEDERATED_WORLD_PROTOCOL?stateInput:createFederatedWorldState();
  const sites=Object.values(state.sites||{}).sort((a,b)=>a.site_id.localeCompare(b.site_id));
  const entities=[],relations=[];
  for(const fragment of sites){
    for(const entity of fragment.entities)entities.push({...copy(entity),site_id:fragment.site_id,authority_device_id:fragment.authority_device_id,authority_epoch:fragment.authority_epoch,site_revision:fragment.revision});
    for(const relation of fragment.relations)relations.push({...copy(relation),site_id:fragment.site_id,authority_device_id:fragment.authority_device_id,authority_epoch:fragment.authority_epoch,site_revision:fragment.revision});
  }
  return {
    protocol:FEDERATED_WORLD_PROTOCOL,schema_version:FEDERATED_WORLD_SCHEMA_VERSION,
    generated_at:state.updatedAt,site_count:sites.length,sites:copy(sites),
    entities,relations,identity_scope:'site_local',cross_site_identity_links:[],
    semantic_only:true,cloud_read_only:true
  };
}

export function cloudFederatedWorldSummary(stateInput){
  const snapshot=federatedWorldSnapshot(stateInput);
  return {
    ...snapshot,
    sites:snapshot.sites.map((fragment)=>({
      protocol:fragment.protocol,schema_version:fragment.schema_version,site_id:fragment.site_id,
      authority_device_id:fragment.authority_device_id,authority_epoch:fragment.authority_epoch,
      topology_revision:fragment.topology_revision,revision:fragment.revision,observed_at:fragment.observed_at,
      entities:fragment.entities,relations:fragment.relations,context:fragment.context,
      fingerprint:fragment.fingerprint,semantic_only:true,identity_scope:'site_local'
    })),
    summary_only:true,authority_assignment:'local_only'
  };
}
