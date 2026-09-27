const txt=(v,max=240)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const arr=(v)=>Array.isArray(v)?v:[];
const copy=(v)=>JSON.parse(JSON.stringify(v));
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SITE_REF=/^site:([0-9a-f-]{36})::(.+)$/;

export const FEDERATED_AGENT_CONTEXT_PROTOCOL='physical_federated_agent_context.v1';
export const FEDERATED_AGENT_CONTEXT_SCHEMA_VERSION=1;

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out))throw new Error(label+' must be a UUID.');
  return out;
}
function timeMs(v){
  if(v==null||v==='')return 0;
  if(Number.isFinite(Number(v)))return Number(v);
  const parsed=Date.parse(String(v));
  return Number.isFinite(parsed)?parsed:0;
}
function topologySites(topology){return arr(topology?.sites);}
function siteId(site){return site?.id||site?.site_id||'';}
function authority(site){
  const device=site?.authorityDeviceId||site?.authority_device_id||'';
  const epoch=Number(site?.authorityEpoch??site?.authority_epoch??0)||0;
  return {device_id:device,epoch};
}
function worldSites(world){
  if(Array.isArray(world?.sites))return world.sites;
  if(world?.sites&&typeof world.sites==='object')return Object.values(world.sites);
  return [];
}
function worldSiteId(fragment){return fragment?.site_id||fragment?.siteId||'';}
function syncPeers(sync){
  if(Array.isArray(sync?.peers))return sync.peers;
  if(sync?.peers&&typeof sync.peers==='object')return Object.values(sync.peers);
  return [];
}
function identities(identity){
  return arr(identity?.identities);
}
function mobileTransitions(mobile){
  return arr(mobile?.transitions);
}
function memberSite(ref){
  const m=SITE_REF.exec(String(ref||''));
  return m?m[1]:'';
}
function memberLocal(ref){
  const m=SITE_REF.exec(String(ref||''));
  if(!m)return '';
  try{return decodeURIComponent(m[2]);}catch{return '';}
}
function entityRef(site,entity){
  return entity?.ref||('site:'+site+'::'+encodeURIComponent(entity?.local_id||entity?.localId||entity?.id||''));
}
function relationSubjectRef(site,relation){
  return relation?.subject_ref||relation?.subjectRef||('site:'+site+'::'+encodeURIComponent(relation?.subject_local_id||relation?.subjectId||relation?.subject_id||''));
}
function relationObjectRef(site,relation){
  const local=relation?.object_local_id||relation?.objectId||relation?.object_id||'';
  return relation?.object_ref||relation?.objectRef||(local?'site:'+site+'::'+encodeURIComponent(local):'');
}
function freshness(observedAt,now,staleMs){
  const at=timeMs(observedAt);
  if(!at)return {state:'unknown',age_ms:null};
  const age=Math.max(0,Number(now)-at);
  return {state:age>staleMs?'stale':'current',age_ms:age};
}
function peerFor(sync,site){
  return syncPeers(sync).find(p=>(p.site_id||p.siteId)===site)||null;
}
function compactRecentChanges(fragment){
  const raw=arr(fragment?.context?.recent_changes??fragment?.context?.recentChanges);
  return raw.slice(-5).map(v=>txt(v,240)).filter(Boolean);
}
function siteSummary(topologySite,fragment,sync,localSite,now,staleMs){
  const id=siteId(topologySite)||worldSiteId(fragment);
  const auth=authority(topologySite||{});
  const fresh=freshness(fragment?.observed_at??fragment?.observedAt,now,staleMs);
  const peer=peerFor(sync,id);
  const syncStatus=txt(peer?.status||(id===localSite?'local':'unknown'),40).toLowerCase();
  return {
    site_id:id,
    label:txt(topologySite?.label||topologySite?.name||fragment?.context?.site||'',120),
    local:id===localSite,
    status:txt(topologySite?.status||'active',30).toLowerCase(),
    authority_device_id:auth.device_id,
    authority_epoch:auth.epoch,
    world_revision:Number(fragment?.revision||0)||0,
    world_observed_at:fragment?.observed_at??fragment?.observedAt??null,
    freshness:fresh.state,
    age_ms:fresh.age_ms,
    sync_status:syncStatus,
    recent_changes:compactRecentChanges(fragment)
  };
}
function focusIdentity(identitySnapshot,focusId){
  if(!focusId)return null;
  const id=uuid(focusId,'focus canonical identity id');
  const found=identities(identitySnapshot).find(i=>i.canonical_identity_id===id&&i.status==='active');
  if(!found)return null;
  return {
    canonical_identity_id:id,
    entity_type:txt(found.entity_type,40),
    aliases:arr(found.aliases).slice(0,8).map(v=>txt(v,120)).filter(Boolean),
    members:arr(found.members).slice(0,64).map(v=>String(v))
  };
}
function locationCandidates(focus,world,now,currentAgeMs){
  if(!focus)return [];
  const members=new Set(focus.members);
  const out=[];
  for(const fragment of worldSites(world)){
    const sid=worldSiteId(fragment);
    if(!sid)continue;
    const memberRefs=[...members].filter(ref=>memberSite(ref)===sid);
    if(!memberRefs.length)continue;
    let best=null;
    for(const ref of memberRefs){
      const entity=arr(fragment.entities).find(e=>entityRef(sid,e)===ref)||null;
      const entityObserved=timeMs(entity?.observed_at??entity?.observedAt??fragment?.observed_at);
      const entityAge=entityObserved?Math.max(0,Number(now)-entityObserved):Infinity;
      const entityState=txt(entity?.state||'unknown',40).toLowerCase();
      const entityConfidence=clamp01(entity?.confidence);
      const entityCurrent=entityAge<=currentAgeMs&&['observed','user-confirmed'].includes(entityState);

      const relations=arr(fragment.relations).filter(r=>
        relationSubjectRef(sid,r)===ref &&
        ['located_in','present_in','located_on'].includes(txt(r.predicate,60).toLowerCase()) &&
        ['current','inferred'].includes(txt(r.temporal_state??r.temporalState??'current',30).toLowerCase())
      );
      for(const rel of relations){
        const at=timeMs(rel.as_of??rel.asOf??entityObserved);
        const age=at?Math.max(0,Number(now)-at):Infinity;
        const conf=clamp01(rel.confidence);
        const score=(conf*0.65)+(entityConfidence*0.35)-(age>currentAgeMs?0.35:0);
        const candidate={
          site_id:sid,member_ref:ref,local_entity_id:memberLocal(ref),
          object_ref:relationObjectRef(sid,rel),
          predicate:txt(rel.predicate,60),
          confidence:clamp01(score),
          observed_at:at||entityObserved||0,
          age_ms:Number.isFinite(age)?age:null,
          evidence:'current_relation'
        };
        if(!best||candidate.confidence>best.confidence||candidate.observed_at>best.observed_at)best=candidate;
      }
      if(!relations.length&&entityCurrent){
        const candidate={
          site_id:sid,member_ref:ref,local_entity_id:memberLocal(ref),
          object_ref:'',predicate:'observed_at_site',
          confidence:entityConfidence,
          observed_at:entityObserved,age_ms:entityAge,
          evidence:'current_entity_observation'
        };
        if(!best||candidate.confidence>best.confidence||candidate.observed_at>best.observed_at)best=candidate;
      }
    }
    if(best)out.push(best);
  }
  return out.sort((a,b)=>b.confidence-a.confidence||b.observed_at-a.observed_at);
}
function selectLocation(candidates,threshold=0.65,conflictDelta=0.12){
  const viable=candidates.filter(c=>c.confidence>=threshold);
  if(!viable.length)return {state:'unknown',current:null,conflicts:[]};
  if(viable.length===1)return {state:'present',current:viable[0],conflicts:[]};
  const top=viable[0],second=viable[1];
  if(second.site_id!==top.site_id&&Math.abs(top.confidence-second.confidence)<=conflictDelta){
    return {state:'uncertain',current:null,conflicts:viable.slice(0,4)};
  }
  return {state:'present',current:top,conflicts:viable.filter(c=>c.site_id!==top.site_id&&c.confidence>=top.confidence-conflictDelta)};
}
function activeFocusTransition(mobile,focusMobileIds){
  const ids=new Set(arr(focusMobileIds).map(String));
  if(!ids.size)return null;
  const active=mobileTransitions(mobile)
    .filter(t=>ids.has(String(t.subject_id||t.subjectId||''))&&!['arrived','canceled'].includes(t.state))
    .sort((a,b)=>Number(b.updated_at||b.state_changed_at||0)-Number(a.updated_at||a.state_changed_at||0));
  return active[0]||null;
}
function changesElsewhere(sites,currentSite,previous){
  const prev=previous?.site_revisions&&typeof previous.site_revisions==='object'?previous.site_revisions:{};
  if(!Object.keys(prev).length)return [];
  return sites.filter(s=>s.site_id!==currentSite&&Number(s.world_revision)!==Number(prev[s.site_id]??s.world_revision))
    .map(s=>({
      site_id:s.site_id,
      label:s.label,
      from_revision:Number(prev[s.site_id]||0),
      to_revision:Number(s.world_revision||0),
      freshness:s.freshness,
      sync_status:s.sync_status,
      recent_changes:s.recent_changes
    }))
    .slice(0,12);
}
function deriveAgentState(input,location,sites,authoritySite){
  const reconciliation=txt(input.reconciliationState??input.reconciliation_state??'',40).toLowerCase();
  if(reconciliation==='reconciling')return 'reconciling';
  if(reconciliation==='failed')return 'failed';
  const authoritySummary=sites.find(s=>s.site_id===authoritySite);
  if(authoritySite&&(!authoritySummary||!authoritySummary.authority_device_id||authoritySummary.authority_epoch<1))return 'failed';
  if(location.state==='uncertain')return 'stale';
  if(authoritySummary?.freshness==='stale')return 'stale';
  if(authoritySummary&&['quarantined','failed'].includes(authoritySummary.sync_status))return 'stale';
  return 'current';
}

export function buildFederatedAgentContext(input={},now=Date.now()){
  const topology=input.topology||{};
  const world=input.federatedWorld??input.federated_world??{};
  const sync=input.federationSync??input.federation_sync??{};
  const mobile=input.mobileTransitions??input.mobile_transitions??{};
  const identity=input.identityContinuity??input.identity_continuity??{};
  const localSite=input.localSiteId??input.local_site_id?uuid(input.localSiteId??input.local_site_id,'local site id'):'';
  const currentAgeMs=Math.max(1000,Number(input.currentAgeMs??input.current_age_ms??120000));
  const staleMs=Math.max(1000,Number(input.siteStaleAgeMs??input.site_stale_age_ms??300000));

  const topoById=new Map(topologySites(topology).map(s=>[siteId(s),s]));
  const worldById=new Map(worldSites(world).map(s=>[worldSiteId(s),s]));
  const ids=[...new Set([...topoById.keys(),...worldById.keys()].filter(Boolean))].sort();
  const sites=ids.map(id=>siteSummary(topoById.get(id)||{id},worldById.get(id)||null,sync,localSite,now,staleMs));

  const focus=focusIdentity(identity,input.focusCanonicalIdentityId??input.focus_canonical_identity_id);
  const candidates=locationCandidates(focus,world,now,currentAgeMs);
  let location=selectLocation(candidates,
    Number(input.locationThreshold??input.location_threshold??0.65),
    Number(input.conflictDelta??input.conflict_delta??0.12)
  );

  const transition=activeFocusTransition(mobile,input.focusMobileSubjectIds??input.focus_mobile_subject_ids);
  let authoritySite=location.current?.site_id||localSite||'';
  let physicalState=location.state;
  let transitionSummary=null;
  if(transition){
    const tstate=txt(transition.state,40).toLowerCase();
    authoritySite=transition.source_site_id||authoritySite;
    transitionSummary={
      transition_id:txt(transition.transition_id,160),
      subject_kind:txt(transition.subject_kind,40),
      subject_id:txt(transition.subject_id,160),
      source_site_id:txt(transition.source_site_id,64),
      destination_site_id:txt(transition.destination_site_id,64),
      state:tstate,
      confidence:clamp01(transition.confidence),
      temporary_context:transition.temporary_context?{
        id:txt(transition.temporary_context.id,160),
        label:txt(transition.temporary_context.label,160),
        confidence:clamp01(transition.temporary_context.confidence),
        durable_site:false,site_authority:false
      }:null,
      offline_since:transition.offline_since??null
    };
    if(['departing','in_transit','arriving','offline','temporary_context','uncertain'].includes(tstate)){
      physicalState=tstate;
      if(tstate!=='arriving')location={...location,current:null};
    }
  }

  const authSite=sites.find(s=>s.site_id===authoritySite)||null;
  const currentSite=location.current?.site_id||'';
  const changedElsewhere=changesElsewhere(sites,currentSite,input.previousContext??input.previous_context);
  const siteRevisions=Object.fromEntries(sites.map(s=>[s.site_id,s.world_revision]));
  const agentState=deriveAgentState(input,location,sites,authoritySite);

  return {
    protocol:FEDERATED_AGENT_CONTEXT_PROTOCOL,
    schema_version:FEDERATED_AGENT_CONTEXT_SCHEMA_VERSION,
    generated_at:Number(now),
    agent_state:agentState,
    physical_state:physicalState,
    local_site_id:localSite,
    current_site:location.current?{
      site_id:location.current.site_id,
      label:sites.find(s=>s.site_id===location.current.site_id)?.label||'',
      member_ref:location.current.member_ref,
      location_ref:location.current.object_ref,
      confidence:location.current.confidence,
      observed_at:location.current.observed_at,
      age_ms:location.current.age_ms,
      why:location.current.evidence
    }:null,
    location_conflicts:location.conflicts.map(c=>({
      site_id:c.site_id,member_ref:c.member_ref,location_ref:c.object_ref,
      confidence:c.confidence,observed_at:c.observed_at,why:c.evidence
    })),
    authority:{
      site_id:authoritySite,
      device_id:authSite?.authority_device_id||'',
      epoch:authSite?.authority_epoch||0,
      basis:transition?'active_mobile_transition':location.current?'current_site':'local_site_fallback'
    },
    focus_identity:focus?{
      canonical_identity_id:focus.canonical_identity_id,
      entity_type:focus.entity_type,
      aliases:focus.aliases,
      member_site_ids:[...new Set(focus.members.map(memberSite).filter(Boolean))].sort()
    }:null,
    active_mobile_transition:transitionSummary,
    changed_elsewhere:changedElsewhere,
    sites:sites.slice(0,32),
    site_revisions:siteRevisions,
    explainability:{
      location_candidate_count:candidates.length,
      current_location_selected:!!location.current,
      conflict_count:location.conflicts.length,
      reconciliation_state:txt(input.reconciliationState??input.reconciliation_state??'current',40),
      no_location_invention:!location.current&&['unknown','uncertain','in_transit','offline','temporary_context'].includes(physicalState)
    },
    semantic_only:true,
    authority_assignment:'local_only',
    cloud_read_only:true
  };
}

export function cloudFederatedAgentContext(input={},now=Date.now()){
  const context=input?.protocol===FEDERATED_AGENT_CONTEXT_PROTOCOL?copy(input):buildFederatedAgentContext(input,now);
  return {
    ...context,
    sites:arr(context.sites).map(s=>({
      site_id:s.site_id,label:s.label,status:s.status,authority_device_id:s.authority_device_id,
      authority_epoch:s.authority_epoch,world_revision:s.world_revision,freshness:s.freshness,
      sync_status:s.sync_status,recent_changes:s.recent_changes
    })),
    summary_only:true,
    cloud_read_only:true,
    context_mutation_authority:false,
    site_authority_mutation:false
  };
}
