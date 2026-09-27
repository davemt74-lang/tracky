export const FEDERATED_QUERY_PROTOCOL = 'physical_federated_query.v1';

export const FEDERATED_QUERY_INTENTS = Object.freeze([
  'current_state',
  'where_is',
  'last_seen',
  'history',
  'what_changed',
  'explain'
]);

const HISTORY_INTENTS = new Set(['last_seen','history','what_changed','explain']);
const LOCATION_PREDICATES = new Set(['located_in','located_on','present_in','moving_between']);
const RAW_KEYS = /^(?:raw|frame|frames|image|images|video|videos|audio|recording|recordings|embedding|embeddings|transcript|filesystem_path|file_path|source_uri|camera_uri)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value, max=180) { return String(value ?? '').trim().slice(0,max); }
function clamp(value,min,max){ return Math.max(min,Math.min(max,Number(value)||0)); }
function copy(value){ return JSON.parse(JSON.stringify(value)); }

function assertGoverned(value,path='query',depth=0){
  if(depth>8) throw new Error('Federated query payload nesting is too deep.');
  if(Array.isArray(value)){ for(const item of value) assertGoverned(item,path,depth+1); return; }
  if(!value || typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(RAW_KEYS.test(key)) throw new Error('Federated query payload contains raw perception at '+path+'.'+key+'.');
    assertGoverned(child,path+'.'+key,depth+1);
  }
}

function canonical(value){
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

function shortHash(input){
  let h=2166136261;
  for(const ch of input){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619); }
  return (h>>>0).toString(16).padStart(8,'0');
}

function siteId(value,label='site id'){
  const id=text(value,64).toLowerCase();
  if(!UUID.test(id)) throw new Error('Federated query '+label+' must be a UUID.');
  return id;
}

function parseSiteRef(value){
  const ref=text(value,260);
  const m=ref.match(/^site:([0-9a-f-]{36})::(.+)$/i);
  if(!m || !UUID.test(m[1])) return null;
  let local=m[2];
  try{ local=decodeURIComponent(local); }catch{}
  return {site_id:m[1].toLowerCase(),local_id:local,ref};
}

function nonPersonFragment(input){
  const fragment=copy(input || {});
  const entities=Array.isArray(fragment.entities)?fragment.entities:[];
  const denied=new Set(entities.filter(x=>x&&x.type==='person').map(x=>String(x.local_id||'')));
  fragment.entities=entities.filter(x=>x&&x.type!=='person');
  fragment.relations=(Array.isArray(fragment.relations)?fragment.relations:[]).filter(r=>
    r && !denied.has(String(r.subject_local_id||'')) && !denied.has(String(r.object_local_id||''))
  );
  fragment.context={};
  return fragment;
}

function normalizeFragment(input){
  if(!input || typeof input!=='object') throw new Error('Federated history snapshot fragment is required.');
  assertGoverned(input,'fragment');
  const site=siteId(input.site_id);
  const revision=Math.max(0,Number(input.revision)||0);
  const epoch=Math.max(0,Number(input.authority_epoch)||0);
  if(revision<1 || epoch<1) throw new Error('Federated history snapshot requires revision and authority epoch.');
  return {
    protocol:'physical_federated_world.v1',
    schema_version:1,
    site_id:site,
    authority_device_id:text(input.authority_device_id,64).toLowerCase(),
    authority_epoch:epoch,
    topology_revision:Math.max(0,Number(input.topology_revision)||0),
    revision,
    observed_at:text(input.observed_at,64),
    entities:Array.isArray(input.entities)?copy(input.entities).slice(0,512):[],
    relations:Array.isArray(input.relations)?copy(input.relations).slice(0,1024):[],
    context:input.context && typeof input.context==='object'?copy(input.context):{},
    semantic_only:true,
    identity_scope:'site_local',
    fingerprint:text(input.fingerprint,128)
  };
}

export function normalizeFederatedQuery(input={}, options={}){
  assertGoverned(input,'query');
  const localSiteId=siteId(options.localSiteId || input.local_site_id,'local site id');
  const intent=FEDERATED_QUERY_INTENTS.includes(input.intent)?input.intent:'current_state';
  const sites=[...new Set((Array.isArray(input.site_ids)?input.site_ids:input.site_id?[input.site_id]:[localSiteId]).map(v=>siteId(v)))].slice(0,32);
  const target=text(input.target_ref || input.entity_ref || input.target,260);
  const parsedTarget=target?parseSiteRef(target):null;
  if(target && target.startsWith('site:') && !parsedTarget) throw new Error('Federated query target site reference is invalid.');
  if(parsedTarget && !sites.includes(parsedTarget.site_id)) sites.push(parsedTarget.site_id);
  const sinceMs=Math.max(0,Number(input.since_ms || input.sinceMs)||0);
  const untilMs=Math.max(0,Number(input.until_ms || input.untilMs)||0);
  if(sinceMs && untilMs && sinceMs>untilMs) throw new Error('Federated query time range is invalid.');
  const normalized={
    protocol:FEDERATED_QUERY_PROTOCOL,
    schema_version:1,
    query_id:text(input.query_id,128),
    intent,
    local_site_id:localSiteId,
    site_ids:sites,
    target_ref:target,
    target_site_id:parsedTarget?.site_id || '',
    target_local_id:parsedTarget?.local_id || text(input.local_id,160),
    since_ms:sinceMs,
    until_ms:untilMs,
    limit:clamp(input.limit || 50,1,100),
    explain:input.explain!==false,
    semantic_only:true,
    read_only:true
  };
  if(!normalized.query_id) normalized.query_id='fq:'+shortHash(canonical(normalized));
  return normalized;
}

export function normalizeFederatedHistorySnapshot(input={}){
  assertGoverned(input,'history');
  const fragment=normalizeFragment(input.fragment || input);
  return {
    protocol:FEDERATED_QUERY_PROTOCOL,
    schema_version:1,
    snapshot_id:text(input.snapshot_id,160) || 'snapshot:'+fragment.site_id+':'+fragment.revision+':'+shortHash(canonical(fragment)),
    site_id:fragment.site_id,
    world_revision:fragment.revision,
    authority_device_id:fragment.authority_device_id,
    authority_epoch:fragment.authority_epoch,
    observed_at_ms:Math.max(0,Number(input.observed_at_ms || input.observed_at || fragment.observed_at)||0),
    source:text(input.source || 'federated_world',80),
    fingerprint:text(input.fingerprint || fragment.fingerprint,128),
    fragment
  };
}

function decision(context,source,destination,scope){
  if(source===destination) return {allowed:true,reason:'local_site'};
  const fn=context.permissionDecision;
  if(typeof fn!=='function') return {allowed:false,reason:'policy_unavailable'};
  const out=fn(source,destination,scope);
  return out && typeof out==='object'?out:{allowed:false,reason:'policy_denied'};
}

function siteAccess(query,context,source){
  const world=decision(context,source,query.local_site_id,'semantic_world_read');
  if(!world.allowed) return {allowed:false,reason:world.reason || 'semantic_world_read_denied',world};
  if(HISTORY_INTENTS.has(query.intent)){
    const history=decision(context,source,query.local_site_id,'history_query');
    if(!history.allowed) return {allowed:false,reason:history.reason || 'history_query_denied',world,history};
    return {allowed:true,reason:'explicit_history_grant',world,history};
  }
  return {allowed:true,reason:world.reason || 'semantic_world_read_granted',world};
}

function historiesForSite(context,site){
  return (Array.isArray(context.history)?context.history:[])
    .map(item=>normalizeFederatedHistorySnapshot(item))
    .filter(item=>item.site_id===site)
    .sort((a,b)=>a.world_revision-b.world_revision || a.observed_at_ms-b.observed_at_ms);
}

function currentForSite(context,site){
  const items=Array.isArray(context.currentSites)?context.currentSites:[];
  const found=items.find(item=>String(item?.site_id||'').toLowerCase()===site);
  return found?normalizeFragment(found):null;
}

function rangeSnapshots(items,query){
  return items.filter(item=>{
    if(query.since_ms && item.observed_at_ms<query.since_ms) return false;
    if(query.until_ms && item.observed_at_ms>query.until_ms) return false;
    return true;
  }).slice(-query.limit);
}

function entityIn(fragment,localId){
  return (fragment?.entities||[]).find(x=>String(x?.local_id||'')===localId) || null;
}

function entityRelations(fragment,localId){
  return (fragment?.relations||[]).filter(r=>String(r?.subject_local_id||'')===localId || String(r?.object_local_id||'')===localId);
}

function locationFact(fragment,localId){
  const rel=(fragment?.relations||[]).filter(r=>
    String(r?.subject_local_id||'')===localId && LOCATION_PREDICATES.has(String(r?.predicate||''))
  ).sort((a,b)=>Number(b.as_of||0)-Number(a.as_of||0))[0];
  if(!rel) return null;
  return {
    predicate:rel.predicate,
    object_local_id:rel.object_local_id || '',
    object_ref:rel.object_ref || (rel.object_local_id ? 'site:'+fragment.site_id+'::'+encodeURIComponent(rel.object_local_id) : ''),
    confidence:Number(rel.confidence||0),
    temporal_state:rel.temporal_state || 'unknown',
    source_event_id:rel.source_event_id || '',
    as_of:Number(rel.as_of||0)
  };
}

function snapshotEvidence(snapshot,access){
  return {
    site_id:snapshot.site_id,
    world_revision:snapshot.world_revision,
    authority_device_id:snapshot.authority_device_id,
    authority_epoch:snapshot.authority_epoch,
    observed_at_ms:snapshot.observed_at_ms,
    fingerprint:snapshot.fingerprint,
    policy_basis:access.reason
  };
}

function diffFragments(a,b){
  const aE=new Map((a?.entities||[]).map(x=>[String(x.local_id||''),x]));
  const bE=new Map((b?.entities||[]).map(x=>[String(x.local_id||''),x]));
  const added=[],removed=[],changed=[];
  for(const [id,item] of bE){
    if(!aE.has(id)) added.push({local_id:id,type:item.type||'entity',label:item.label||''});
    else if(canonical(aE.get(id))!==canonical(item)) changed.push({local_id:id,before:aE.get(id),after:item});
  }
  for(const [id,item] of aE) if(!bE.has(id)) removed.push({local_id:id,type:item.type||'entity',label:item.label||''});
  return {added:added.slice(0,50),removed:removed.slice(0,50),changed:changed.slice(0,50)};
}

export function executeFederatedQuery(input={}, context={}){
  const query=normalizeFederatedQuery(input,{localSiteId:context.localSiteId || input.local_site_id});
  const siteResults=[], denied=[];
  for(const site of query.site_ids){
    const access=siteAccess(query,context,site);
    if(!access.allowed){ denied.push({site_id:site,reason:access.reason}); continue; }
    const remote=site!==query.local_site_id;
    const currentRaw=currentForSite(context,site);
    const current=currentRaw ? (remote?nonPersonFragment(currentRaw):currentRaw) : null;
    let history=rangeSnapshots(historiesForSite(context,site),query);
    if(remote) history=history.map(item=>({...item,fragment:nonPersonFragment(item.fragment)}));

    const targetSiteMismatch=query.target_site_id && query.target_site_id!==site;
    const localId=targetSiteMismatch?'':query.target_local_id;
    if(localId && remote && /^person:/i.test(localId)){
      denied.push({site_id:site,reason:'person_query_requires_identity_continuity'});
      continue;
    }
    if(localId && remote){
      const currentEntity=entityIn(current,localId);
      const historyEntity=history.some(s=>entityIn(s.fragment,localId));
      if(currentEntity?.type==='person' || historyEntity){
        const person=[currentEntity,...history.map(s=>entityIn(s.fragment,localId))].find(x=>x?.type==='person');
        if(person){ denied.push({site_id:site,reason:'person_query_requires_identity_continuity'}); continue; }
      }
    }

    let data=null;
    if(query.intent==='current_state'){
      data={fragment:current};
    } else if(query.intent==='where_is'){
      const entity=localId?entityIn(current,localId):null;
      data={entity:entity?copy(entity):null,location:localId?locationFact(current,localId):null};
    } else if(query.intent==='last_seen'){
      const candidates=[...history].reverse();
      if(current) candidates.unshift(normalizeFederatedHistorySnapshot({fragment:current,observed_at_ms:Number(current.observed_at)||0,source:'current'}));
      const found=localId?candidates.find(s=>entityIn(s.fragment,localId)):null;
      data=found?{entity:copy(entityIn(found.fragment,localId)),location:locationFact(found.fragment,localId),snapshot:snapshotEvidence(found,access)}:null;
    } else if(query.intent==='history'){
      data={
        snapshots:history.filter(s=>!localId || entityIn(s.fragment,localId)).slice(-query.limit).map(s=>({
          ...snapshotEvidence(s,access),
          entity:localId?copy(entityIn(s.fragment,localId)):null,
          relations:localId?copy(entityRelations(s.fragment,localId)):[],
          fragment:localId?undefined:copy(s.fragment)
        }))
      };
    } else if(query.intent==='what_changed'){
      const points=history.length?history:(current?[normalizeFederatedHistorySnapshot({fragment:current,observed_at_ms:Number(current.observed_at)||0,source:'current'})]:[]);
      data=points.length>=2?{
        from:snapshotEvidence(points[0],access),
        to:snapshotEvidence(points[points.length-1],access),
        changes:diffFragments(points[0].fragment,points[points.length-1].fragment)
      }:{from:points[0]?snapshotEvidence(points[0],access):null,to:null,changes:{added:[],removed:[],changed:[]}};
    } else if(query.intent==='explain'){
      const latest=history[history.length-1] || (current?normalizeFederatedHistorySnapshot({fragment:current,observed_at_ms:Number(current.observed_at)||0,source:'current'}):null);
      data={
        current_entity:localId?copy(entityIn(current,localId)):null,
        current_relations:localId?copy(entityRelations(current,localId)):[],
        provenance:latest?[snapshotEvidence(latest,access)]:[],
        policy:{reason:access.reason,world:access.world || null,history:access.history || null}
      };
    }

    siteResults.push({site_id:site,access:data===null?'no_evidence':'allowed',data});
  }

  const evidenceCount=siteResults.filter(x=>x.data!==null).length;
  const status=evidenceCount ? (denied.length?'partial':'ok') : (denied.length?'denied':'unknown');
  return {
    protocol:FEDERATED_QUERY_PROTOCOL,
    schema_version:1,
    query_id:query.query_id,
    intent:query.intent,
    status,
    results:siteResults,
    denied,
    confidence:evidenceCount?Math.min(1,evidenceCount/Math.max(1,query.site_ids.length)):0,
    uncertainty:[
      ...(status==='unknown'?['no_matching_evidence']:[]),
      ...(denied.length?['policy_limited']:[])
    ],
    explainability:{
      local_site_id:query.local_site_id,
      requested_sites:query.site_ids,
      history_permission_required:HISTORY_INTENTS.has(query.intent),
      no_location_invention:true,
      person_world_federation:false,
      authority_mutation:false
    },
    semantic_only:true,
    read_only:true,
    cloud_can_answer_from_mirrors_only:true
  };
}

export function federatedQueryCapability(){
  return {
    version:'2.78',
    protocol:FEDERATED_QUERY_PROTOCOL,
    intents:[...FEDERATED_QUERY_INTENTS],
    history_scope:'history_query',
    current_world_scope:'semantic_world_read',
    deny_by_default:true,
    site_qualified_refs:true,
    person_world_federation:false,
    raw_perception:false,
    authority_mutation:false,
    cloud_mirror_only:true,
    boundaries:[
      'query-read-only',
      'history-deny-by-default',
      'site-qualified-references',
      'person-query-via-identity-continuity',
      'no-location-invention',
      'raw-perception-never-queryable',
      'cloud-mirror-only'
    ]
  };
}
