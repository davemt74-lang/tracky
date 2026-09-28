const copy=(v)=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const n=(v)=>Math.max(0,Number(v)||0);
const statusRank={current:0,unknown:1,suspect:2,reconciling:3,stale:4,partitioned:5,failed:6};

export const FEDERATION_SYNC_VISIBILITY_PROTOCOL='physical_federation_sync_visibility.v1';
export const FEDERATION_SYNC_VISIBILITY_VERSION='2.80';

function toMs(value){
  if(value===null||value===undefined||value==='')return 0;
  const numeric=Number(value);
  if(Number.isFinite(numeric)&&numeric>0)return numeric>100000000000?numeric:numeric*1000;
  const parsed=Date.parse(String(value));
  return Number.isFinite(parsed)?parsed:0;
}
function siteId(row){return txt(row?.id??row?.site_id,64).toLowerCase();}
function reconciliationMap(input={}){
  return new Map((Array.isArray(input.peers)?input.peers:[]).map(row=>[
    txt(row?.remote_site_id??row?.site_id,64).toLowerCase(),row
  ]).filter(([id])=>id));
}
function operationsSites(input={}){
  return Array.isArray(input.sites)?input.sites:[];
}
function runRows(input={}){
  return Array.isArray(input.runs)?input.runs:[];
}
function progress(localRevision,remoteRevision){
  if(remoteRevision<=0)return localRevision>0?1:0;
  return Math.max(0,Math.min(1,localRevision/remoteRevision));
}
function issueCode(peer){
  const status=txt(peer?.status||'unknown',24).toLowerCase();
  const localRevision=n(peer?.local_revision);
  const remoteRevision=n(peer?.remote_revision);
  const localEpoch=n(peer?.local_authority_epoch);
  const remoteEpoch=n(peer?.remote_authority_epoch);
  const sameRevConflict=localRevision>0&&localRevision===remoteRevision
    &&txt(peer?.local_fingerprint,128)&&txt(peer?.remote_fingerprint,128)
    &&txt(peer?.local_fingerprint,128)!==txt(peer?.remote_fingerprint,128);
  if(sameRevConflict)return 'same_revision_fingerprint_conflict';
  if(localEpoch>0&&remoteEpoch>0&&localEpoch!==remoteEpoch)return 'authority_epoch_mismatch';
  if(remoteRevision>localRevision)return 'revision_gap';
  if(status==='partitioned')return 'transport_partition';
  if(status==='failed')return txt(peer?.last_error,120)||'reconciliation_failed';
  if(status==='stale')return 'stale_peer';
  if(status==='reconciling')return txt(peer?.last_error,120)||'reconciling';
  if(status==='suspect')return 'peer_suspect';
  if(status==='unknown')return 'peer_unknown';
  return '';
}
function message(row){
  if(row.is_local)return 'Local authoritative site is current by local ownership.';
  if(row.status==='current')return row.last_reconciled_at?'Current; last reconciliation completed successfully.':'Current; no reconciliation is required.';
  if(row.status==='partitioned')return 'Partitioned; remote data remains labeled stale until authoritative reconciliation completes.';
  if(row.status==='reconciling')return row.revision_gap>0
    ?'Reconciling '+row.revision_gap+' revision'+(row.revision_gap===1?'':'s')+' from the origin site.'
    :'Reconciling authoritative site state.';
  if(row.status==='stale')return 'Stale; remote semantic data must not be treated as current.';
  if(row.status==='failed')return 'Reconciliation failed closed: '+(row.last_error||'unknown reconciliation error')+'.';
  if(row.status==='suspect')return 'Peer contact is suspect; freshness is degraded.';
  return 'Peer freshness is unknown until the origin site reports authoritative state.';
}
function normalizeSite(site,peer,localSite,now){
  const id=siteId(site)||txt(peer?.remote_site_id??peer?.site_id,64).toLowerCase();
  const isLocal=id&&id===localSite;
  const federation=site?.federation&&typeof site.federation==='object'?site.federation:{};
  const status=isLocal?'current':txt(peer?.status??federation.status??'unknown',24).toLowerCase();
  const localRevision=isLocal?n(site?.world_revision):n(peer?.local_revision);
  const remoteRevision=isLocal?localRevision:n(peer?.remote_revision);
  const localEpoch=isLocal?n(site?.authority?.epoch??site?.authority_epoch):n(peer?.local_authority_epoch);
  const remoteEpoch=isLocal?localEpoch:n(peer?.remote_authority_epoch);
  const staleSince=isLocal?0:toMs(peer?.stale_since??federation.stale_since);
  const partitionedAt=isLocal?0:toMs(peer?.partitioned_at??federation.partitioned_at);
  const reconcilingSince=isLocal?0:toMs(peer?.reconciling_since);
  const lastContactAt=isLocal?Number(now):toMs(peer?.last_contact_at??federation.last_contact_at);
  const lastReconciledAt=isLocal:Number(now):toMs(peer?.last_reconciled_at);
  const nextRetryAt=isLocal?0:toMs(peer?.next_retry_at??federation.next_retry_at);
  const revisionGap=Math.max(0,remoteRevision-localRevision);
  const sameRevConflict=!isLocal&&localRevision>0&&localRevision===remoteRevision
    &&txt(peer?.local_fingerprint,128)&&txt(peer?.remote_fingerprint,128)
    &&txt(peer?.local_fingerprint,128)!==txt(peer?.remote_fingerprint,128);
  const epochMismatch=!isLocal&&localEpoch>0&&remoteEpoch>0&&localEpoch!==remoteEpoch;
  const row={
    site_id:id,
    label:txt(site?.label||id,160),
    is_local:isLocal,
    status:statusRank[status]===undefined?'unknown':status,
    fresh:isLocal||status==='current',
    reconciliation_required:!isLocal&&(Boolean(peer?.reconciliation_required)||['partitioned','reconciling','stale','failed','unknown'].includes(status)||revisionGap>0||epochMismatch||sameRevConflict),
    stale_since:staleSince,
    stale_age_ms:staleSince?Math.max(0,Number(now)-staleSince):0,
    partitioned_at:partitionedAt,
    partition_age_ms:partitionedAt?Math.max(0,Number(now)-partitionedAt):0,
    reconciling_since:reconcilingSince,
    reconciling_age_ms:reconcilingSince?Math.max(0,Number(now)-reconcilingSince):0,
    last_contact_at:lastContactAt,
    contact_age_ms:lastContactAt?Math.max(0,Number(now)-lastContactAt):null,
    last_reconciled_at:lastReconciledAt,
    retry_count:isLocal?0:n(peer?.retry_count??federation.retry_count),
    next_retry_at:nextRetryAt,
    retry_due_in_ms:nextRetryAt?Math.max(0,nextRetryAt-Number(now)):0,
    last_error:isLocal?'':txt(peer?.last_error??federation.last_error,240),
    local_cursor:{revision:localRevision,fingerprint:txt(peer?.local_fingerprint,128),authority_epoch:localEpoch},
    remote_cursor:{revision:remoteRevision,fingerprint:txt(peer?.remote_fingerprint,128),authority_epoch:remoteEpoch},
    revision_gap:revisionGap,
    authority_epoch_mismatch:epochMismatch,
    fingerprint_conflict:sameRevConflict,
    catch_up:{
      applied_revision:localRevision,
      target_revision:Math.max(localRevision,remoteRevision),
      remaining_revisions:revisionGap,
      progress:progress(localRevision,Math.max(localRevision,remoteRevision))
    },
    conflict_code:'',
    authority_assignment:'origin_only',
    remote_authority_promotion:false
  };
  row.conflict_code=issueCode({...peer,...row.local_cursor,...{
    status:row.status,
    local_revision:localRevision,remote_revision:remoteRevision,
    local_authority_epoch:localEpoch,remote_authority_epoch:remoteEpoch,
    local_fingerprint:row.local_cursor.fingerprint,remote_fingerprint:row.remote_cursor.fingerprint,
    last_error:row.last_error
  }});
  row.message=message(row);
  return row;
}
function normalizeRun(row,labels){
  const site=txt(row?.remote_site_id??row?.site_id,64).toLowerCase();
  const details=row?.details&&typeof row.details==='object'?row.details:{};
  return {
    reconciliation_id:txt(row?.reconciliation_id,180),
    site_id:site,
    site_label:labels.get(site)||site,
    status:txt(row?.status||'unknown',30).toLowerCase(),
    request_mode:txt(row?.request_mode||'unknown',30).toLowerCase(),
    reason:txt(row?.reason,160),
    local_revision:n(row?.local_revision),
    remote_revision:n(row?.remote_revision),
    applied_revision:n(row?.applied_revision),
    authority_epoch:n(row?.authority_epoch),
    started_at:toMs(row?.started_at??row?.created_at),
    completed_at:toMs(row?.completed_at),
    fingerprint_conflict:Boolean(details.same_revision_fingerprint_conflict),
    authority_epoch_changed:Boolean(details.authority_epoch_changed),
    immutable:true
  };
}
function overallState(sites){
  let worst='current';
  for(const row of sites){
    if((statusRank[row.status]??1)>(statusRank[worst]??0))worst=row.status;
  }
  return worst;
}

export function buildFederationSyncVisibility(input={},now=Date.now()){
  const operations=copy(input.operations||{});
  const reconciliation=copy(input.reconciliation||{});
  const sync=copy(input.sync??input.federationSync??input.federation_sync??{});
  const localSite=txt(reconciliation.local_site_id??sync.local_site_id??operations.local_site_id,64).toLowerCase();
  const peers=reconciliationMap(reconciliation);
  const ops=operationsSites(operations);
  const ids=new Set(ops.map(siteId).filter(Boolean));
  for(const id of peers.keys())ids.add(id);
  if(localSite)ids.add(localSite);
  const opMap=new Map(ops.map(s=>[siteId(s),s]));
  const sites=[...ids].sort().map(id=>normalizeSite(opMap.get(id)||{id},peers.get(id)||{},localSite,now));
  const labels=new Map(sites.map(s=>[s.site_id,s.label]));
  const runs=runRows(reconciliation).map(r=>normalizeRun(r,labels))
    .sort((a,b)=>(b.started_at||b.completed_at)-(a.started_at||a.completed_at))
    .slice(0,100);
  const alerts=sites.filter(s=>!s.is_local&&s.status!=='current').map(s=>({
    site_id:s.site_id,label:s.label,status:s.status,severity:['partitioned','failed'].includes(s.status)?'critical':'degraded',
    message:s.message,stale_age_ms:s.stale_age_ms,revision_gap:s.revision_gap,retry_count:s.retry_count,last_error:s.last_error
  }));
  const transitionHints=(Array.isArray(input.crossSiteTransitions??input.cross_site_transitions)?input.crossSiteTransitions??input.cross_site_transitions:[])
    .filter(t=>t&&typeof t==='object'&&t.active).map(t=>{
      const destination=txt(t?.destination_site?.site_id??t?.destination_site_id,64).toLowerCase();
      const source=txt(t?.source_site?.site_id??t?.source_site_id,64).toLowerCase();
      const destinationSync=sites.find(s=>s.site_id===destination);
      const sourceSync=sites.find(s=>s.site_id===source);
      return {
        transition_id:txt(t.transition_id,160),
        subject_label:txt(t.subject_label||t.subject_id,160),
        state:txt(t.state,40).toLowerCase(),
        source_site_id:source,destination_site_id:destination,
        source_sync_status:sourceSync?.status||'unknown',
        destination_sync_status:destinationSync?.status||'unknown',
        destination_presence_claim_blocked:Boolean(destinationSync&&!destinationSync.fresh&&t.state!=='arrived'),
        note:destinationSync&&!destinationSync.fresh?'Destination federation data is '+destinationSync.status+'; do not infer arrival from stale remote state.':''
      };
    });
  return {
    protocol:FEDERATION_SYNC_VISIBILITY_PROTOCOL,
    version:FEDERATION_SYNC_VISIBILITY_VERSION,
    schema_version:1,
    generated_at:Number(now),
    local_site_id:localSite,
    overall_state:overallState(sites),
    counts:{
      sites:sites.length,current:sites.filter(s=>s.status==='current').length,
      stale:sites.filter(s=>['stale','suspect','unknown'].includes(s.status)).length,
      partitioned:sites.filter(s=>s.status==='partitioned').length,
      reconciling:sites.filter(s=>s.status==='reconciling').length,
      failed:sites.filter(s=>s.status==='failed').length
    },
    sites,
    reconciliation_runs:runs,
    transition_sync_hints:transitionHints,
    agent_context:{
      state:overallState(sites),
      alerts:alerts.slice(0,16),
      summary:alerts.length?alerts.map(a=>a.label+' is '+a.status).slice(0,6).join('; '):'All known federation sites are current.',
      no_remote_authority_promotion:true,
      remote_freshness_requires_origin_confirmation:true
    },
    read_only:true,
    semantic_only:true,
    authority_assignment:'origin_only',
    cloud_role:'relay_and_mirror_only',
    cloud_can_mark_destination_current:false,
    boundaries:[
      'origin-site-authority-only',
      'remote-staleness-is-explicit',
      'revision-gap-requires-authoritative-reconciliation',
      'authority-epoch-change-requires-revalidation',
      'same-revision-fingerprint-conflict-fails-closed',
      'retry-state-is-visible-but-not-cloud-controlled',
      'cloud-cannot-declare-a-destination-current'
    ]
  };
}

export function annotatePhysicalWorldFreshness(dashboardInput,visibilityInput){
  const dashboard=copy(dashboardInput||{});
  const visibility=visibilityInput?.protocol===FEDERATION_SYNC_VISIBILITY_PROTOCOL?visibilityInput:buildFederationSyncVisibility(visibilityInput||{});
  const selected=txt(dashboard?.selected_site?.site_id,64).toLowerCase();
  const row=visibility.sites.find(s=>s.site_id===selected)||null;
  const freshness=row?{
    site_id:row.site_id,status:row.status,fresh:row.fresh,stale_age_ms:row.stale_age_ms,
    reconciliation_required:row.reconciliation_required,revision_gap:row.revision_gap,
    authority_epoch_mismatch:row.authority_epoch_mismatch,fingerprint_conflict:row.fingerprint_conflict,
    message:row.message
  }:{site_id:selected,status:'unknown',fresh:false,stale_age_ms:0,reconciliation_required:true,revision_gap:0,authority_epoch_mismatch:false,fingerprint_conflict:false,message:'Federation freshness is unknown.'};
  dashboard.federation_freshness=freshness;
  if(dashboard.selected_site&&typeof dashboard.selected_site==='object')dashboard.selected_site.federation_freshness=freshness;
  for(const key of ['rooms','people','objects','world_devices']){
    if(Array.isArray(dashboard[key]))dashboard[key]=dashboard[key].map(item=>({...item,federation_freshness:freshness}));
  }
  dashboard.agent_context=dashboard.agent_context&&typeof dashboard.agent_context==='object'?dashboard.agent_context:{};
  dashboard.agent_context.sync_state=freshness.status;
  dashboard.agent_context.sync_message=freshness.message;
  dashboard.agent_context.remote_freshness_verified=freshness.fresh;
  dashboard.agent_context.no_remote_authority_promotion=true;
  return dashboard;
}

export function federationSyncVisibilityCapability(){
  return {
    version:FEDERATION_SYNC_VISIBILITY_VERSION,
    protocol:FEDERATION_SYNC_VISIBILITY_PROTOCOL,
    peer_states:['unknown','current','suspect','partitioned','reconciling','stale','failed'],
    revision_gap_visibility:true,
    authority_epoch_visibility:true,
    fingerprint_conflict_visibility:true,
    retry_visibility:true,
    immutable_reconciliation_history:true,
    physical_world_freshness_annotations:true,
    transition_sync_annotations:true,
    agent_context:true,
    read_only:true,
    authority_mutation:false,
    cloud_can_mark_destination_current:false
  };
}
