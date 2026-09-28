const copy=(v)=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const clamp=(v)=>Math.max(0,Math.min(1,Number(v)||0));
const TERMINAL=new Set(['arrived','canceled']);
const ACTIVE_STATES=new Set(['departing','in_transit','arriving','uncertain','offline','temporary_context']);

export const CROSS_SITE_PRESENCE_PROTOCOL='physical_cross_site_presence.v1';
export const CROSS_SITE_PRESENCE_VERSION='2.80';

function sitesMap(operations={}){
  return new Map((Array.isArray(operations.sites)?operations.sites:[]).map(row=>[
    txt(row?.id??row?.site_id,64).toLowerCase(),
    {
      id:txt(row?.id??row?.site_id,64).toLowerCase(),
      label:txt(row?.label||row?.id||row?.site_id,160),
      authority_device_id:txt(row?.authority?.device_id??row?.authority_device_id,64).toLowerCase(),
      authority_epoch:Math.max(0,Number(row?.authority?.epoch??row?.authority_epoch)||0),
      health:txt(row?.health||'unknown',24).toLowerCase(),
      federation_status:txt(row?.federation?.status||'unknown',24).toLowerCase()
    }
  ]).filter(([id])=>id));
}
function deviceMap(operations={}){
  return new Map((Array.isArray(operations.devices)?operations.devices:[]).map(row=>[
    txt(row?.id??row?.device_id,160).toLowerCase(),
    {
      label:txt(row?.label||row?.hardware_profile_label||row?.hardware_profile||row?.id||'Device',160),
      subject_type:'mobile_hardware',
      hardware_profile:txt(row?.hardware_profile||'custom',40).toLowerCase(),
      site_id:txt(row?.site_id,64).toLowerCase()
    }
  ]).filter(([id])=>id));
}
function subjectCatalog(input={},devices=new Map()){
  const out=new Map(devices);
  for(const row of (Array.isArray(input.subjectCatalog??input.subject_catalog)?input.subjectCatalog??input.subject_catalog:[])){
    const id=txt(row?.subject_id??row?.id,160);
    if(!id)continue;
    out.set(id.toLowerCase(),{
      label:txt(row?.label||id,160),
      subject_type:txt(row?.subject_type||row?.type||'continuity_subject',40).toLowerCase(),
      hardware_profile:txt(row?.hardware_profile,40).toLowerCase(),
      site_id:txt(row?.site_id,64).toLowerCase()
    });
  }
  return out;
}
function siteLabel(sites,id){return sites.get(id)?.label||id||'';}
function currentPresence(t,sites){
  const source=txt(t.source_site_id,64).toLowerCase();
  const destination=txt(t.destination_site_id,64).toLowerCase();
  const temp=t.temporary_context&&typeof t.temporary_context==='object'?copy(t.temporary_context):null;
  switch(txt(t.state,40).toLowerCase()){
    case 'arrived':
      return destination?{kind:'site',site_id:destination,label:siteLabel(sites,destination),status:'present',confirmed:true}:null;
    case 'departing':
      return source?{kind:'site',site_id:source,label:siteLabel(sites,source),status:'departing',confirmed:true}:null;
    case 'temporary_context':
      return temp?{kind:'temporary_context',context_id:txt(temp.id,160),label:txt(temp.label||'Temporary context',160),status:'temporary_context',confirmed:false,durable_site:false,site_authority:false,confidence:clamp(temp.confidence)}:null;
    case 'in_transit':
    case 'arriving':
    case 'uncertain':
    case 'offline':
      return {kind:'transition',site_id:'',label:'',status:txt(t.state,40).toLowerCase(),confirmed:false};
    default:
      return null;
  }
}
function lastConfirmedSite(t,sites){
  const source=txt(t.source_site_id,64).toLowerCase();
  const destination=txt(t.destination_site_id,64).toLowerCase();
  if(txt(t.state,40).toLowerCase()==='arrived'&&destination){
    return {site_id:destination,label:siteLabel(sites,destination),basis:'destination_arrival_confirmed',confirmed_at:Number(t.arrived_at)||Number(t.updated_at)||0};
  }
  if(source){
    return {site_id:source,label:siteLabel(sites,source),basis:'source_site_before_transition',confirmed_at:Number(t.started_at)||0};
  }
  return null;
}
function transitionSummary(t,sites,catalog){
  const state=txt(t.state,40).toLowerCase();
  const subjectKind=txt(t.subject_kind||'mobile_device',40).toLowerCase();
  const subjectId=txt(t.subject_id,160);
  const subjectMeta=catalog.get(subjectId.toLowerCase())||{};
  const source=txt(t.source_site_id,64).toLowerCase();
  const destination=txt(t.destination_site_id,64).toLowerCase();
  const sourceAuthority=sites.get(source)?.authority_device_id||'';
  const isAuthorityDevice=subjectKind==='mobile_device'&&!!sourceAuthority&&sourceAuthority===subjectId.toLowerCase();
  return {
    transition_id:txt(t.transition_id,160),
    subject_kind:subjectKind,
    subject_id:subjectId,
    subject_type:txt(subjectMeta.subject_type||(subjectKind==='mobile_device'?'mobile_hardware':'continuity_subject'),40).toLowerCase(),
    subject_label:txt(subjectMeta.label||subjectId,160),
    source_site:{site_id:source,label:siteLabel(sites,source)},
    destination_site:destination?{site_id:destination,label:siteLabel(sites,destination)}:null,
    state,
    active:ACTIVE_STATES.has(state),
    confidence:clamp(t.confidence),
    destination_confidence:clamp(t.destination_confidence),
    state_reason:txt(t.state_reason,200),
    started_at:Number(t.started_at)||0,
    state_changed_at:Number(t.state_changed_at)||0,
    updated_at:Number(t.updated_at)||0,
    arrived_at:t.arrived_at==null?null:Number(t.arrived_at)||0,
    offline_since:t.offline_since==null?null:Number(t.offline_since)||0,
    temporary_context:t.temporary_context&&typeof t.temporary_context==='object'?copy(t.temporary_context):null,
    evidence_count:Array.isArray(t.evidence)?t.evidence.length:0,
    evidence:(Array.isArray(t.evidence)?t.evidence:[]).slice(-8).map(e=>({
      type:txt(e?.type,80),site_id:txt(e?.site_id,64).toLowerCase(),confidence:clamp(e?.confidence),observed_at:Number(e?.observed_at)||0,
      context_id:txt(e?.context_id,160),context_label:txt(e?.context_label,160)
    })),
    last_confirmed_site:lastConfirmedSite(t,sites),
    current_presence:currentPresence(t,sites),
    destination_presence_confirmed:state==='arrived'&&!!destination,
    may_claim_present_at_destination:state==='arrived'&&!!destination,
    authority:{
      subject_is_source_authority:isAuthorityDevice,
      source_authority_device_id:sourceAuthority,
      authority_transfer:false,
      authority_unchanged:true
    },
    identity:{
      scope:subjectKind==='mobile_device'?'stable_mobile_device':'explicit_continuity_subject',
      cross_site_merge:false,
      identity_linking:false
    }
  };
}
function historyTimeline(history=[],sites=new Map(),catalog=new Map()){
  const out=[];
  for(const row of history){
    const snapshot=row?.snapshot&&typeof row.snapshot==='object'?row.snapshot:row;
    if(!snapshot||typeof snapshot!=='object')continue;
    const s=transitionSummary(snapshot,sites,catalog);
    out.push({
      event_id:txt(row?.event_id||('transition:'+s.transition_id+':revision:'+Number(row?.revision??snapshot.revision??0)),220),
      transition_id:s.transition_id,
      revision:Math.max(0,Number(row?.revision??snapshot.revision)||0),
      state:s.state,
      subject_id:s.subject_id,
      subject_label:s.subject_label,
      source_site:s.source_site,
      destination_site:s.destination_site,
      confidence:s.confidence,
      state_reason:s.state_reason,
      occurred_at:Number(snapshot.state_changed_at||snapshot.updated_at||snapshot.started_at)||0,
      immutable:true,
      fingerprint:txt(row?.fingerprint??snapshot.fingerprint,128)
    });
  }
  out.sort((a,b)=>b.occurred_at-a.occurred_at||b.revision-a.revision||a.transition_id.localeCompare(b.transition_id));
  return out;
}
function derivedTimeline(transitions=[]){
  const out=[];
  for(const t of transitions){
    out.push({
      event_id:'transition:'+t.transition_id+':current',
      transition_id:t.transition_id,revision:0,state:t.state,subject_id:t.subject_id,subject_label:t.subject_label,
      source_site:t.source_site,destination_site:t.destination_site,confidence:t.confidence,state_reason:t.state_reason,
      occurred_at:t.state_changed_at||t.updated_at||t.started_at||0,immutable:false,fingerprint:''
    });
  }
  return out.sort((a,b)=>b.occurred_at-a.occurred_at);
}
function sitePresence(sites,transitions){
  return [...sites.values()].map(site=>{
    const related=transitions.filter(t=>t.source_site.site_id===site.id||t.destination_site?.site_id===site.id);
    return {
      site_id:site.id,label:site.label,health:site.health,federation_status:site.federation_status,
      departing:related.filter(t=>t.active&&t.source_site.site_id===site.id&&t.state==='departing').length,
      arriving:related.filter(t=>t.active&&t.destination_site?.site_id===site.id&&t.state==='arriving').length,
      in_transit_from:related.filter(t=>t.active&&t.source_site.site_id===site.id&&t.state==='in_transit').length,
      in_transit_to:related.filter(t=>t.active&&t.destination_site?.site_id===site.id&&t.state==='in_transit').length,
      offline:related.filter(t=>t.active&&t.state==='offline'&&(t.source_site.site_id===site.id||t.destination_site?.site_id===site.id)).length,
      recent_arrivals:related.filter(t=>t.state==='arrived'&&t.destination_site?.site_id===site.id).length
    };
  }).sort((a,b)=>a.label.localeCompare(b.label));
}

export function buildCrossSitePresence(input={},now=Date.now()){
  const operations=copy(input.operations||{});
  const mobile=copy(input.mobileTransitions??input.mobile_transitions??{});
  const history=Array.isArray(input.transitionHistory??input.transition_history)?copy(input.transitionHistory??input.transition_history):[];
  const sites=sitesMap(operations);
  const devices=deviceMap(operations);
  const catalog=subjectCatalog(input,devices);
  const transitions=(Array.isArray(mobile.transitions)?mobile.transitions:[]).map(t=>transitionSummary(t,sites,catalog))
    .sort((a,b)=>Number(b.active)-Number(a.active)||(b.state_changed_at||b.updated_at)-(a.state_changed_at||a.updated_at));
  const active=transitions.filter(t=>t.active);
  const timeline=history.length?historyTimeline(history,sites,catalog):derivedTimeline(transitions);
  const stateCounts={departing:0,in_transit:0,arriving:0,uncertain:0,offline:0,temporary_context:0,arrived:0,canceled:0};
  for(const t of transitions)if(Object.hasOwn(stateCounts,t.state))stateCounts[t.state]+=1;
  return {
    protocol:CROSS_SITE_PRESENCE_PROTOCOL,
    version:CROSS_SITE_PRESENCE_VERSION,
    schema_version:1,
    generated_at:Number(now),
    active_count:active.length,
    transition_count:transitions.length,
    state_counts:stateCounts,
    active_transitions:active,
    transitions,
    site_presence:sitePresence(sites,transitions),
    timeline:timeline.slice(0,200),
    history_source:history.length?'immutable_transition_revision_history':'current_transition_snapshots',
    agent_context:{
      active_count:active.length,
      transitions:active.slice(0,12).map(t=>({
        transition_id:t.transition_id,subject_label:t.subject_label,subject_type:t.subject_type,state:t.state,
        source_site:t.source_site,destination_site:t.destination_site,confidence:t.confidence,
        last_confirmed_site:t.last_confirmed_site,current_presence:t.current_presence,
        may_claim_present_at_destination:t.may_claim_present_at_destination,
        authority_transfer:false,cross_site_identity_merge:false
      })),
      destination_claim_rule:'present_at_destination_only_after_arrived',
      physical_location_invention:false
    },
    boundaries:[
      'source-site-transition-authority-remains-authoritative',
      'arrival-is-never-invented',
      'destination-presence-requires-arrived-state',
      'offline-and-temporary-context-are-not-durable-sites',
      'moving-authority-device-does-not-transfer-authority',
      'cross-site-identity-merge-remains-disabled',
      'semantic-only-no-raw-perception'
    ],
    read_only:true,
    authority_mutation:false,
    physical_location_mutation:false,
    cross_site_identity_merge:false,
    cloud_role:'relay_and_mirror_only'
  };
}

export function crossSitePresenceCapability(){
  return {
    version:CROSS_SITE_PRESENCE_VERSION,
    protocol:CROSS_SITE_PRESENCE_PROTOCOL,
    states:['departing','in_transit','arriving','arrived','uncertain','offline','temporary_context','canceled'],
    transition_history:true,
    immutable_history_when_available:true,
    destination_claim_requires_arrived:true,
    agent_context:true,
    authority_mutation:false,
    physical_location_mutation:false,
    cross_site_identity_merge:false,
    temporary_context_site_authority:false,
    read_only:true
  };
}
