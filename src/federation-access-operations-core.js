const copy=v=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const n=v=>Math.max(0,Number(v)||0);
const arr=v=>Array.isArray(v)?v:[];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const FEDERATION_ACCESS_OPERATIONS_PROTOCOL='physical_federation_access_operations.v1';
export const FEDERATION_ACCESS_OPERATIONS_VERSION='2.80';

export const ACCESS_CATEGORIES=Object.freeze({
  observation:['remote_observation'],
  retention:['history_query'],
  identification:['person_recognition','voice_matching','identity_linking'],
  cloud_sync:['semantic_world_read'],
  agent_use:['agent_context_read'],
  federation_sharing:['semantic_world_read','identity_continuity_read']
});

function uuid(v){const s=txt(v,64).toLowerCase();return UUID.test(s)?s:'';}
function revocationKeyGrant(s,d,scope){return 'grant:'+s+'|'+d+'|'+scope;}
function revocationKeyConsent(site,id,scope){return 'consent:'+site+'|'+id+'|'+scope;}

function normalizeRevocations(policy={}){
  const map=new Map();
  for(const row of arr(policy.revocations)){
    if(!row||typeof row!=='object')continue;
    const key=txt(row.revocation_key??row.key,320);
    if(!key)continue;
    const prior=map.get(key);
    const candidate={key,revision:n(row.revision),revocation_epoch:n(row.revocation_epoch),reason:txt(row.reason,200),at:n(row.revoked_at_ms??row.at)};
    if(!prior||candidate.revocation_epoch>prior.revocation_epoch||(candidate.revocation_epoch===prior.revocation_epoch&&candidate.revision>prior.revision))map.set(key,candidate);
  }
  return map;
}
function effectiveGrant(row,revocations){
  const source=uuid(row?.source_site_id),dest=uuid(row?.destination_site_id),scope=txt(row?.scope,80).toLowerCase();
  const tomb=revocations.get(revocationKeyGrant(source,dest,scope));
  const revision=n(row?.revision);
  const raw=txt(row?.status||'revoked',30).toLowerCase();
  const revokedByTomb=!!tomb&&tomb.revision>=revision;
  const status=revokedByTomb?'revoked':raw==='granted'?'granted':'revoked';
  return {
    source_site_id:source,destination_site_id:dest,scope,status,revision,
    reason:txt(row?.reason,200),origin_role:txt(row?.origin_role||'unknown',40),
    governing_authority_device_id:uuid(row?.governing_authority_device_id),
    governing_authority_epoch:n(row?.governing_authority_epoch),
    granted_at_ms:n(row?.granted_at_ms),revoked_at_ms:n(row?.revoked_at_ms),
    revocation_epoch:tomb?.revocation_epoch||0,revocation_reason:tomb?.reason||'',
    effective_allowed:status==='granted',stale_grant_suppressed:revokedByTomb&&raw==='granted'
  };
}
function effectiveConsent(row,revocations,now){
  const site=uuid(row?.site_id),id=uuid(row?.canonical_identity_id),scope=txt(row?.scope,80).toLowerCase();
  const tomb=revocations.get(revocationKeyConsent(site,id,scope));
  const revision=n(row?.revision);
  const raw=txt(row?.status||'pending',30).toLowerCase();
  const expires=n(row?.expires_at_ms);
  const expired=expires>0&&Number(now)>=expires;
  const revokedByTomb=!!tomb&&tomb.revision>=revision;
  let status=raw;
  if(revokedByTomb)status='revoked';
  else if(expired&&raw==='granted')status='expired';
  else if(!['pending','granted','denied','revoked'].includes(raw))status='pending';
  return {
    site_id:site,canonical_identity_id:id,scope,status,revision,
    source:txt(row?.source||'user',80),reason:txt(row?.reason,200),
    decided_at_ms:n(row?.decided_at_ms),expires_at_ms:expires,
    governing_authority_device_id:uuid(row?.governing_authority_device_id),
    governing_authority_epoch:n(row?.governing_authority_epoch),
    revocation_epoch:tomb?.revocation_epoch||0,revocation_reason:tomb?.reason||'',
    effective_allowed:status==='granted',stale_grant_suppressed:revokedByTomb&&raw==='granted'
  };
}
function categoryState(scopeRows){
  const allowed=scopeRows.filter(x=>x.effective_allowed).length,total=scopeRows.length;
  if(total===0)return 'denied';
  if(allowed===total)return 'allowed';
  if(allowed===0)return scopeRows.some(x=>x.status==='revoked')?'revoked':'denied';
  return 'limited';
}
function normalizeHistory(history=[]){
  return arr(history).filter(x=>x&&typeof x==='object').slice(-500).map((row,index)=>({
    event_id:txt(row.event_id||('policy-event-'+index),180),event_type:txt(row.event_type||row.type,100),
    governing_site_id:uuid(row.governing_site_id??row.site_id),revision:n(row.revision),
    revocation_epoch:n(row.revocation_epoch),detail:copy(row.detail??row.details??{}),
    occurred_at:n(row.occurred_at??row.created_at_ms??row.at),immutable:true
  })).sort((a,b)=>(b.occurred_at-a.occurred_at)||(b.revision-a.revision));
}
function syncState(syncVisibility,id){
  const row=arr(syncVisibility?.sites).find(x=>uuid(x?.site_id)===id);
  return row?{status:txt(row.status||'unknown',24),fresh:!!row.fresh,stale_age_ms:n(row.stale_age_ms),reconciliation_required:!!row.reconciliation_required}:{status:'unknown',fresh:false,stale_age_ms:0,reconciliation_required:true};
}

export function buildFederationAccessOperations(input={},now=Date.now()){
  const policy=copy(input.policy||{}),topology=copy(input.topology||{}),syncVisibility=copy(input.syncVisibility??input.sync_visibility??{});
  const localSite=uuid(input.localSiteId??input.local_site_id??syncVisibility.local_site_id);
  const sites=new Map(arr(topology.sites).map(s=>[uuid(s?.id??s?.site_id),{
    id:uuid(s?.id??s?.site_id),label:txt(s?.label||s?.id||s?.site_id,160),
    authority_device_id:uuid(s?.authority_device_id??s?.authority?.device_id),
    authority_epoch:n(s?.authority_epoch??s?.authority?.epoch)
  }]).filter(([id])=>id));
  for(const row of arr(policy.sites)){
    const id=uuid(row?.site_id);
    if(id&&!sites.has(id))sites.set(id,{id,label:id,authority_device_id:uuid(row?.governing_authority_device_id),authority_epoch:n(row?.governing_authority_epoch)});
  }
  const revocations=normalizeRevocations(policy);
  const grants=arr(policy.grants).map(row=>effectiveGrant(row,revocations)).filter(x=>x.source_site_id&&x.destination_site_id&&x.scope);
  const consents=arr(policy.consents).map(row=>effectiveConsent(row,revocations,now)).filter(x=>x.site_id&&x.canonical_identity_id&&x.scope);
  const localPolicy=arr(policy.sites).find(x=>uuid(x?.site_id)===localSite)||null;
  const peers=[...sites.values()].filter(s=>s.id&&s.id!==localSite).map(site=>{
    const scopeRows=grants.filter(g=>g.source_site_id===localSite&&g.destination_site_id===site.id);
    const categories={};
    for(const [category,scopes] of Object.entries(ACCESS_CATEGORIES)){
      const rows=scopes.map(scope=>scopeRows.find(g=>g.scope===scope)||{
        source_site_id:localSite,destination_site_id:site.id,scope,status:'not_granted',revision:0,
        effective_allowed:false,stale_grant_suppressed:false,revocation_epoch:0
      });
      categories[category]={state:categoryState(rows),scopes:rows};
    }
    const sync=syncState(syncVisibility,site.id);
    return {
      site_id:site.id,label:site.label,
      policy_peer_allowed:!!localPolicy?.allowed_peer_sites?.includes(site.id),
      site_policy_mode:txt(localPolicy?.mode||'private',30),
      federation_enabled:!!localPolicy?.allow_federation,
      remote_observation_enabled:!!localPolicy?.allow_remote_observation,
      categories,sync,
      revocation_protection:{stale_remote_grant_can_restore_access:false,revocation_wins:true,remote_policy_freshness_required:!sync.fresh}
    };
  }).sort((a,b)=>a.label.localeCompare(b.label));

  const identityMap=new Map();
  for(const row of consents){
    if(row.site_id!==localSite)continue;
    const key=row.canonical_identity_id;
    if(!identityMap.has(key))identityMap.set(key,{canonical_identity_id:key,consents:[]});
    identityMap.get(key).consents.push(row);
  }
  const identities=[...identityMap.values()].map(item=>{
    const states=item.consents.map(c=>c.status);
    let state='pending';
    if(states.includes('revoked'))state='revoked';
    else if(states.includes('expired'))state='expired';
    else if(states.length&&states.every(x=>x==='granted'))state='allowed';
    else if(states.some(x=>x==='granted'))state='limited';
    else if(states.includes('denied'))state='denied';
    return {...item,state};
  }).sort((a,b)=>a.canonical_identity_id.localeCompare(b.canonical_identity_id));

  const suppressed=[...grants,...consents].filter(x=>x.stale_grant_suppressed);
  const counts={
    peers:peers.length,grants_allowed:grants.filter(x=>x.effective_allowed).length,
    grants_revoked:grants.filter(x=>x.status==='revoked').length,
    consents_allowed:consents.filter(x=>x.status==='granted').length,
    consents_denied:consents.filter(x=>x.status==='denied').length,
    consents_revoked:consents.filter(x=>x.status==='revoked').length,
    consents_expired:consents.filter(x=>x.status==='expired').length,
    stale_grants_suppressed:suppressed.length
  };
  return {
    protocol:FEDERATION_ACCESS_OPERATIONS_PROTOCOL,version:FEDERATION_ACCESS_OPERATIONS_VERSION,schema_version:1,
    generated_at:Number(now),local_site_id:localSite,policy_revision:n(policy.revision),
    revocation_epoch:n(policy.revocation_epoch??policy.revocationEpoch),local_policy:localPolicy?copy(localPolicy):null,
    peers,grants,consents,identities,revocations:[...revocations.values()].sort((a,b)=>b.revocation_epoch-a.revocation_epoch),
    history:normalizeHistory(input.history||policy.audit||[]),counts,
    agent_context:{
      local_site_id:localSite,policy_revision:n(policy.revision),revocation_epoch:n(policy.revocation_epoch??policy.revocationEpoch),
      active_revocations:grants.filter(x=>x.status==='revoked').length+consents.filter(x=>['revoked','denied','expired'].includes(x.status)).length,
      stale_grants_suppressed:suppressed.length,
      summary:suppressed.length?(String(suppressed.length)+' stale grant'+(suppressed.length===1?'':'s')+' suppressed by newer revocation.'):'No stale grants are overriding current revocations.',
      revocation_wins:true
    },
    operations:{site_policy_local_only:true,grants_local_source_only:true,consent_local_site_only:true,cloud_read_only:true,paired_apps_read_only:true},
    boundaries:['deny-by-default','revocation-always-wins','stale-grant-never-resurrects-access','site-local-policy-authority','consent-required-for-recognition','cloud-mirror-only','cross-site-identity-merge-disabled','raw-perception-never-federated']
  };
}

export function explainFederationAccess(reportInput={},input={}){
  const report=reportInput?.protocol===FEDERATION_ACCESS_OPERATIONS_PROTOCOL?reportInput:buildFederationAccessOperations(reportInput);
  const destination=uuid(input.destinationSiteId??input.destination_site_id),category=txt(input.category,80).toLowerCase();
  const peer=report.peers.find(x=>x.site_id===destination);
  if(!peer)return {allowed:false,state:'denied',reason:'destination_not_known'};
  const row=peer.categories?.[category];
  if(!row)return {allowed:false,state:'denied',reason:'category_not_supported'};
  return {
    allowed:row.state==='allowed',state:row.state,
    reason:row.state==='allowed'?'all_required_scopes_granted':row.state==='limited'?'some_required_scopes_granted':'required_scope_not_granted',
    scopes:copy(row.scopes),revocation_epoch:report.revocation_epoch,
    stale_remote_grant_can_restore_access:false,destination_sync:copy(peer.sync)
  };
}

export function federationAccessOperationsCapability(){
  return {
    version:FEDERATION_ACCESS_OPERATIONS_VERSION,protocol:FEDERATION_ACCESS_OPERATIONS_PROTOCOL,
    categories:Object.keys(ACCESS_CATEGORIES),permission_states:['allowed','denied','limited','revoked'],
    consent_states:['allowed','denied','limited','expired','revoked','pending'],
    local_site_policy_operations:true,local_grant_revoke_operations:true,local_consent_operations:true,
    revocation_wins:true,stale_remote_grant_can_restore_access:false,
    cloud_read_only:true,paired_apps_read_only:true,authority_mutation:false,cross_site_identity_merge:false
  };
}
