const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FEDERATION_RECONCILIATION_PROTOCOL='physical_federation_reconciliation.v1';
export const FEDERATION_RECONCILIATION_SCHEMA_VERSION=1;
export const FEDERATION_PEER_STATES=Object.freeze([
  'unknown','current','suspect','partitioned','reconciling','stale','failed'
]);

const txt=(v,max=180)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const copy=(v)=>JSON.parse(JSON.stringify(v));
const clampInt=(v,min,max)=>Math.max(min,Math.min(max,Math.trunc(Number(v)||0)));

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out)) throw new Error(label+' must be a UUID.');
  return out;
}
function canonical(v){
  if(Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function shortHash(input){
  let h=2166136261;
  for(const ch of input){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16).padStart(8,'0');
}
function cursor(input={}){
  return {
    revision:Math.max(0,Number(input.revision??input.world_revision??0)||0),
    fingerprint:txt(input.fingerprint,128),
    authority_epoch:Math.max(0,Number(input.authority_epoch??0)||0)
  };
}
function peer(state,siteId){
  const id=uuid(siteId,'peer site id');
  if(!state.peers[id]){
    state.peers[id]={
      site_id:id,
      status:'unknown',
      last_contact_at:0,
      partitioned_at:0,
      stale_since:0,
      reconciling_since:0,
      last_error:'',
      consecutive_failures:0,
      retry_count:0,
      next_retry_at:0,
      local_cursor:cursor(),
      remote_cursor:cursor(),
      last_reconciliation_id:'',
      last_reconciled_at:0
    };
  }
  return state.peers[id];
}
function audit(state,type,details,now){
  state.audit=[...state.audit,{type,details:copy(details||{}),at:Number(now)}].slice(-500);
  state.updated_at=Number(now);
}
function retryDelay(policy,retryCount){
  const n=Math.max(1,retryCount);
  return Math.min(policy.max_retry_delay_ms,policy.base_retry_delay_ms*(2**Math.min(10,n-1)));
}
function statePolicy(options={}){
  return {
    suspect_after_ms:clampInt(options.suspectAfterMs??options.suspect_after_ms??15000,1000,86400000),
    partition_after_ms:clampInt(options.partitionAfterMs??options.partition_after_ms??45000,2000,86400000),
    stale_after_ms:clampInt(options.staleAfterMs??options.stale_after_ms??120000,5000,604800000),
    max_retries:clampInt(options.maxRetries??options.max_retries??5,1,20),
    base_retry_delay_ms:clampInt(options.baseRetryDelayMs??options.base_retry_delay_ms??1000,100,3600000),
    max_retry_delay_ms:clampInt(options.maxRetryDelayMs??options.max_retry_delay_ms??60000,1000,86400000)
  };
}

export function createFederationReconciliationState(options={},now=Date.now()){
  const localSiteId=options.localSiteId?uuid(options.localSiteId,'local site id'):'';
  const policy=statePolicy(options);
  if(policy.partition_after_ms<=policy.suspect_after_ms) policy.partition_after_ms=policy.suspect_after_ms+1000;
  if(policy.stale_after_ms<policy.partition_after_ms) policy.stale_after_ms=policy.partition_after_ms;
  return {
    protocol:FEDERATION_RECONCILIATION_PROTOCOL,
    schema_version:FEDERATION_RECONCILIATION_SCHEMA_VERSION,
    local_site_id:localSiteId,
    created_at:Number(now),
    updated_at:Number(now),
    policy,
    peers:{},
    audit:[],
    boundaries:[
      'origin-site-authority-only',
      'partition-never-promotes-remote-or-cloud-authority',
      'stale-data-must-be-labeled',
      'revision-gap-requires-authoritative-reconciliation',
      'authority-epoch-change-requires-revalidation',
      'same-revision-fingerprint-conflict-fails-closed',
      'retries-are-bounded-and-backoff-controlled',
      'reconciliation-is-semantic-only',
      'cloud-remains-relay-and-mirror-only'
    ]
  };
}

export function noteFederationPeerContact(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?copy(stateInput):createFederationReconciliationState({},now);
  const p=peer(state,input.site_id??input.siteId);
  const incoming=cursor(input.remote_cursor??input.remoteCursor??input);
  const local=cursor(input.local_cursor??input.localCursor??p.local_cursor);
  p.last_contact_at=Number(now);
  p.local_cursor=local;
  p.remote_cursor=incoming;
  p.last_error='';
  p.consecutive_failures=0;
  p.retry_count=0;
  p.next_retry_at=0;

  const authorityAdvanced=incoming.authority_epoch>0&&local.authority_epoch>0&&incoming.authority_epoch!==local.authority_epoch;
  const revisionGap=incoming.revision>local.revision;
  const fingerprintConflict=incoming.revision>0&&incoming.revision===local.revision
    && incoming.fingerprint&&local.fingerprint&&incoming.fingerprint!==local.fingerprint;

  if(fingerprintConflict){
    p.status='failed';
    p.stale_since=p.stale_since||Number(now);
    p.last_error='same_revision_fingerprint_conflict';
  }else if(authorityAdvanced||revisionGap||p.status==='partitioned'||p.status==='stale'||p.status==='failed'){
    p.status='reconciling';
    p.reconciling_since=p.reconciling_since||Number(now);
    p.stale_since=p.stale_since||Number(now);
  }else{
    p.status='current';
    p.partitioned_at=0;
    p.stale_since=0;
    p.reconciling_since=0;
    p.last_reconciled_at=Number(now);
  }
  audit(state,'peer_contact',{site_id:p.site_id,status:p.status,local_cursor:p.local_cursor,remote_cursor:p.remote_cursor},now);
  return state;
}

export function noteFederationPeerFailure(stateInput,siteId,error='transport_failure',now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?copy(stateInput):createFederationReconciliationState({},now);
  const p=peer(state,siteId);
  p.consecutive_failures=(p.consecutive_failures||0)+1;
  p.last_error=txt(error,240)||'transport_failure';
  if(p.status==='unknown'||p.status==='current') p.status='suspect';
  if(!p.stale_since) p.stale_since=Number(now);
  audit(state,'peer_failure',{site_id:p.site_id,error:p.last_error,consecutive_failures:p.consecutive_failures},now);
  return state;
}

export function markFederationPartition(stateInput,siteId,reason='transport_partition',now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?copy(stateInput):createFederationReconciliationState({},now);
  const p=peer(state,siteId);
  p.status='partitioned';
  p.partitioned_at=p.partitioned_at||Number(now);
  p.stale_since=p.stale_since||Number(now);
  p.last_error=txt(reason,240)||'transport_partition';
  audit(state,'peer_partitioned',{site_id:p.site_id,reason:p.last_error},now);
  return state;
}

export function evaluateFederationPartitions(stateInput,now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?copy(stateInput):createFederationReconciliationState({},now);
  for(const p of Object.values(state.peers)){
    const age=p.last_contact_at?Math.max(0,Number(now)-Number(p.last_contact_at)):Infinity;
    if(p.status==='reconciling'||p.status==='failed') continue;
    if(age>=state.policy.partition_after_ms){
      if(p.status!=='partitioned'){
        p.status='partitioned';
        p.partitioned_at=p.partitioned_at||Number(now);
        p.stale_since=p.stale_since||Number(now);
        p.last_error=p.last_error||'peer_contact_timeout';
        audit(state,'peer_partitioned',{site_id:p.site_id,reason:p.last_error,contact_age_ms:Number.isFinite(age)?age:null},now);
      }
    }else if(age>=state.policy.suspect_after_ms&&p.status==='current'){
      p.status='suspect';
      p.stale_since=p.stale_since||Number(now);
      audit(state,'peer_suspect',{site_id:p.site_id,contact_age_ms:age},now);
    }
    if(p.stale_since&&Number(now)-Number(p.stale_since)>=state.policy.stale_after_ms&&p.status==='suspect'){
      p.status='stale';
      audit(state,'peer_stale',{site_id:p.site_id},now);
    }
  }
  return state;
}

export function federationFreshnessForSite(stateInput,siteId,now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?stateInput:createFederationReconciliationState({},now);
  const id=uuid(siteId,'peer site id');
  const p=state.peers[id];
  if(!p){
    return {site_id:id,status:'unknown',fresh:false,age_ms:null,stale_since:0,reconciliation_required:true};
  }
  const age=p.last_contact_at?Math.max(0,Number(now)-Number(p.last_contact_at)):null;
  return {
    site_id:id,
    status:p.status,
    fresh:p.status==='current',
    age_ms:age,
    stale_since:Number(p.stale_since||0),
    partitioned_at:Number(p.partitioned_at||0),
    local_cursor:copy(p.local_cursor),
    remote_cursor:copy(p.remote_cursor),
    reconciliation_required:['partitioned','reconciling','stale','failed'].includes(p.status)
      || p.remote_cursor.revision>p.local_cursor.revision
      || (p.remote_cursor.authority_epoch>0&&p.local_cursor.authority_epoch>0&&p.remote_cursor.authority_epoch!==p.local_cursor.authority_epoch)
  };
}

export function buildFederationReconciliationRequest(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?copy(stateInput):createFederationReconciliationState({},now);
  const siteId=uuid(input.remote_site_id??input.remoteSiteId??input.site_id,'remote site id');
  const p=peer(state,siteId);
  const local=cursor(input.local_cursor??input.localCursor??p.local_cursor);
  const remote=cursor(input.remote_cursor??input.remoteCursor??p.remote_cursor);
  p.local_cursor=local;
  p.remote_cursor=remote;

  const epochMismatch=remote.authority_epoch>0&&local.authority_epoch>0&&remote.authority_epoch!==local.authority_epoch;
  const revisionGap=remote.revision>local.revision;
  const fingerprintConflict=remote.revision>0&&remote.revision===local.revision
    && remote.fingerprint&&local.fingerprint&&remote.fingerprint!==local.fingerprint;
  const forceFull=Boolean(input.force_full??input.forceFull);
  const fullSnapshot=forceFull||epochMismatch||fingerprintConflict||revisionGap||['partitioned','failed','stale'].includes(p.status);
  const material={
    protocol:FEDERATION_RECONCILIATION_PROTOCOL,
    schema_version:1,
    local_site_id:state.local_site_id,
    remote_site_id:siteId,
    local_cursor:local,
    known_remote_cursor:remote,
    request_mode:fullSnapshot?'authoritative_full':'cursor_verify',
    semantic_only:true,
    read_only:true,
    authority_assignment:'origin_only'
  };
  const reconciliationId='fr:'+siteId+':'+shortHash(canonical(material));
  p.status='reconciling';
  p.reconciling_since=p.reconciling_since||Number(now);
  p.stale_since=p.stale_since||Number(now);
  p.last_reconciliation_id=reconciliationId;
  audit(state,'reconciliation_requested',{site_id:siteId,reconciliation_id:reconciliationId,request_mode:material.request_mode},now);
  return {
    state,
    request:{
      ...material,
      reconciliation_id:reconciliationId,
      requested_at:Number(now),
      reasons:[
        ...(epochMismatch?['authority_epoch_changed']:[]),
        ...(revisionGap?['revision_gap']:[]),
        ...(fingerprintConflict?['same_revision_fingerprint_conflict']:[]),
        ...(['partitioned','failed','stale'].includes(p.status)?['partition_recovery']:[])
      ]
    }
  };
}

export function applyFederationReconciliationResult(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?copy(stateInput):createFederationReconciliationState({},now);
  const siteId=uuid(input.remote_site_id??input.remoteSiteId??input.site_id,'remote site id');
  const p=peer(state,siteId);
  const reconciliationId=txt(input.reconciliation_id??input.reconciliationId,180);
  if(p.last_reconciliation_id&&reconciliationId&&p.last_reconciliation_id!==reconciliationId){
    throw new Error('Federation reconciliation result does not match the active reconciliation.');
  }
  const authoritative=Boolean(input.authoritative);
  const semanticOnly=input.semantic_only!==false;
  const authorityAssignment=txt(input.authority_assignment??'origin_only',40);
  if(!authoritative||!semanticOnly||authorityAssignment!=='origin_only'){
    p.status='failed';
    p.last_error='invalid_reconciliation_authority';
    p.stale_since=p.stale_since||Number(now);
    audit(state,'reconciliation_rejected',{site_id:siteId,reason:p.last_error},now);
    return {state,status:'rejected',freshness:federationFreshnessForSite(state,siteId,now)};
  }

  const applied=cursor(input.applied_cursor??input.appliedCursor);
  const remote=cursor(input.remote_cursor??input.remoteCursor??p.remote_cursor);
  if(remote.authority_epoch>0&&applied.authority_epoch!==remote.authority_epoch){
    p.status='failed';p.last_error='authority_epoch_not_reconciled';
    p.stale_since=p.stale_since||Number(now);
    audit(state,'reconciliation_failed',{site_id:siteId,reason:p.last_error,applied_cursor:applied,remote_cursor:remote},now);
    return {state,status:'failed',freshness:federationFreshnessForSite(state,siteId,now)};
  }
  if(applied.revision<remote.revision){
    p.status='reconciling';
    p.local_cursor=applied;p.remote_cursor=remote;
    p.last_error='reconciliation_incomplete';
    audit(state,'reconciliation_incomplete',{site_id:siteId,applied_cursor:applied,remote_cursor:remote},now);
    return {state,status:'incomplete',freshness:federationFreshnessForSite(state,siteId,now)};
  }
  if(applied.revision===remote.revision&&remote.fingerprint&&applied.fingerprint&&remote.fingerprint!==applied.fingerprint){
    p.status='failed';p.last_error='same_revision_fingerprint_conflict';
    p.stale_since=p.stale_since||Number(now);
    audit(state,'reconciliation_failed',{site_id:siteId,reason:p.last_error},now);
    return {state,status:'failed',freshness:federationFreshnessForSite(state,siteId,now)};
  }

  p.local_cursor=applied;
  p.remote_cursor=remote.revision>=applied.revision?remote:applied;
  p.status='current';
  p.last_contact_at=Number(now);
  p.partitioned_at=0;
  p.stale_since=0;
  p.reconciling_since=0;
  p.last_error='';
  p.consecutive_failures=0;
  p.retry_count=0;
  p.next_retry_at=0;
  p.last_reconciled_at=Number(now);
  audit(state,'reconciliation_completed',{site_id:siteId,applied_cursor:applied},now);
  return {state,status:'completed',freshness:federationFreshnessForSite(state,siteId,now)};
}

export function scheduleFederationReconciliationRetry(stateInput,siteId,error='reconciliation_failed',now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?copy(stateInput):createFederationReconciliationState({},now);
  const p=peer(state,siteId);
  p.retry_count=(p.retry_count||0)+1;
  p.last_error=txt(error,240)||'reconciliation_failed';
  p.stale_since=p.stale_since||Number(now);
  if(p.retry_count>state.policy.max_retries){
    p.status='failed';
    p.next_retry_at=0;
    audit(state,'reconciliation_retry_exhausted',{site_id:p.site_id,retry_count:p.retry_count,error:p.last_error},now);
    return state;
  }
  p.status='reconciling';
  p.next_retry_at=Number(now)+retryDelay(state.policy,p.retry_count);
  audit(state,'reconciliation_retry_scheduled',{site_id:p.site_id,retry_count:p.retry_count,next_retry_at:p.next_retry_at,error:p.last_error},now);
  return state;
}

export function annotateFederatedQueryFreshness(resultInput,stateInput,now=Date.now()){
  const result=copy(resultInput||{});
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?stateInput:createFederationReconciliationState({},now);
  const freshness=[];
  let staleCount=0;
  for(const row of Array.isArray(result.results)?result.results:[]){
    const siteId=txt(row?.site_id,64).toLowerCase();
    if(!UUID.test(siteId)) continue;
    if(siteId===state.local_site_id){
      row.federation_freshness={site_id:siteId,status:'current',fresh:true,age_ms:0,reconciliation_required:false};
    }else{
      row.federation_freshness=federationFreshnessForSite(state,siteId,now);
      if(['partitioned','reconciling','stale','failed'].includes(row.federation_freshness.status)) staleCount++;
    }
    freshness.push(copy(row.federation_freshness));
  }
  result.federation_freshness=freshness;
  result.uncertainty=Array.isArray(result.uncertainty)?[...result.uncertainty]:[];
  if(staleCount&&!result.uncertainty.includes('federation_stale')) result.uncertainty.push('federation_stale');
  if(staleCount&&result.status==='ok') result.status='partial';
  result.freshness_enforced=true;
  result.authority_mutation=false;
  return result;
}

export function federationReconciliationStatus(stateInput,now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_RECONCILIATION_PROTOCOL?stateInput:createFederationReconciliationState({},now);
  return {
    protocol:FEDERATION_RECONCILIATION_PROTOCOL,
    schema_version:FEDERATION_RECONCILIATION_SCHEMA_VERSION,
    local_site_id:state.local_site_id,
    peers:Object.values(state.peers).sort((a,b)=>a.site_id.localeCompare(b.site_id)).map(p=>({
      ...copy(p),
      freshness:federationFreshnessForSite(state,p.site_id,now)
    })),
    policy:copy(state.policy),
    boundaries:[...state.boundaries],
    cloud_role:'relay_and_mirror_only',
    authority_assignment:'origin_only'
  };
}

export function federationReconciliationCapability(){
  return {
    version:'2.78',
    protocol:FEDERATION_RECONCILIATION_PROTOCOL,
    peer_states:[...FEDERATION_PEER_STATES],
    semantic_only:true,
    stale_data_labeled:true,
    bounded_retries:true,
    full_snapshot_on_gap:true,
    authority_epoch_revalidation:true,
    same_revision_conflicts:'fail_closed',
    cloud_role:'relay_and_mirror_only',
    authority_assignment:'origin_only',
    boundaries:[
      'origin-site-authority-only',
      'partition-never-promotes-remote-or-cloud-authority',
      'stale-data-must-be-labeled',
      'revision-gap-requires-authoritative-reconciliation',
      'authority-epoch-change-requires-revalidation',
      'same-revision-fingerprint-conflict-fails-closed',
      'retries-are-bounded-and-backoff-controlled',
      'reconciliation-is-semantic-only',
      'cloud-remains-relay-and-mirror-only'
    ]
  };
}
