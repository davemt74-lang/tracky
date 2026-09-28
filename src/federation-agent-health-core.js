const copy=v=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const n=v=>Math.max(0,Number(v)||0);
const arr=v=>Array.isArray(v)?v:[];
const rank={current:0,unknown:1,degraded:2,stale:3,reconciling:4,recovering:5,partitioned:6,offline:7,failed:8};
const severityRank={info:0,warning:1,critical:2};

export const FEDERATION_AGENT_HEALTH_PROTOCOL='physical_federation_agent_health.v1';
export const FEDERATION_AGENT_HEALTH_VERSION='2.80';
export const FEDERATION_AGENT_HEALTH_STATES=Object.freeze(['current','degraded','stale','partitioned','reconciling','recovering','offline','failed','unknown']);

function siteId(v){return txt(v,64).toLowerCase();}
function mapBySite(rows){return new Map(arr(rows).filter(x=>x&&typeof x==='object').map(x=>[siteId(x.site_id??x.id),x]).filter(([id])=>id));}
function authorityDevice(operations,site){
  const auth=site?.authority&&typeof site.authority==='object'?site.authority:{};
  const deviceId=siteId(auth.device_id);
  return arr(operations?.devices).find(d=>siteId(d?.device_id??d?.id)===deviceId)||null;
}
function runtimeOffline(device){
  const status=txt(device?.runtime_status??device?.status,40).toLowerCase();
  return ['offline','disconnected','unavailable','failed','stopped','missing'].includes(status);
}
function siteCause(site,sync,device,relay){
  const auth=site?.authority&&typeof site.authority==='object'?site.authority:{};
  const syncStatus=txt(sync?.status||site?.federation?.status||'unknown',30).toLowerCase();
  if(site?.status&&txt(site.status,24).toLowerCase()!=='active')return 'site_inactive';
  if(auth.status==='missing')return 'authority_device_missing';
  if(auth.status==='invalid')return txt(auth.reason||'authority_device_invalid',100);
  if(runtimeOffline(device))return 'authority_device_offline';
  if(syncStatus==='failed')return txt(sync?.conflict_code||sync?.last_error||'reconciliation_failed',120);
  if(syncStatus==='partitioned')return 'federation_partition';
  if(syncStatus==='stale')return 'federation_stale';
  if(syncStatus==='reconciling')return 'federation_reconciling';
  if(syncStatus==='suspect')return 'federation_suspect';
  if(syncStatus==='unknown')return 'federation_unknown';
  if(relay&&relay.state==='offline')return 'cloud_relay_offline';
  return '';
}
function baseState(site,sync,device){
  const auth=site?.authority&&typeof site.authority==='object'?site.authority:{};
  const syncStatus=txt(sync?.status||site?.federation?.status||'unknown',30).toLowerCase();
  if(site?.status&&txt(site.status,24).toLowerCase()!=='active')return 'offline';
  if(auth.status==='missing'||auth.status==='invalid'||runtimeOffline(device))return 'failed';
  if(syncStatus==='failed')return 'failed';
  if(syncStatus==='partitioned')return 'partitioned';
  if(syncStatus==='stale')return 'stale';
  if(syncStatus==='reconciling')return 'reconciling';
  if(['suspect','unknown'].includes(syncStatus))return 'degraded';
  if(syncStatus==='current')return 'current';
  return 'unknown';
}
function severity(state,durationMs,flapCount){
  if(['failed','offline','partitioned'].includes(state))return 'critical';
  if(['recovering','reconciling','stale','degraded'].includes(state))return durationMs>=300000||flapCount>=3?'critical':'warning';
  return 'info';
}
function trustFor(state,sync){
  if(state==='current'&&sync?.fresh)return {semantic_state:'current',agent_use:'current',physical_claims:'current',reason:'authoritative_reconciliation_current'};
  if(['recovering','reconciling','stale','degraded','partitioned','offline'].includes(state))return {
    semantic_state:'stale',agent_use:'qualified_stale',physical_claims:'do_not_claim_current',
    reason:'authoritative_reconciliation_not_current'
  };
  return {semantic_state:'blocked',agent_use:'health_only',physical_claims:'do_not_claim_current',reason:'health_or_authority_failure'};
}
function eventType(state,previous){
  if(state==='current'&&previous&&previous!=='current')return 'site.recovered';
  if(state==='recovering')return 'site.recovering';
  return 'site.'+state;
}
function titleFor(row){
  const label=row.label||row.site_id;
  if(row.state==='current'&&row.previous_state&&row.previous_state!=='current')return label+' recovered';
  if(row.state==='offline')return label+' is offline';
  if(row.state==='partitioned')return label+' is partitioned';
  if(row.state==='failed')return label+' health failure';
  if(row.state==='recovering')return label+' is recovering';
  if(row.state==='reconciling')return label+' is reconciling';
  if(row.state==='stale')return label+' data is stale';
  if(row.state==='degraded')return label+' is degraded';
  return label+' federation health changed';
}
function messageFor(row){
  if(row.state==='current'&&row.previous_state&&row.previous_state!=='current')return 'Connectivity and authoritative reconciliation are current. Recovery is complete.';
  if(row.state==='recovering')return 'Connectivity has returned, but recovery is not complete until authoritative reconciliation is current.';
  if(row.state==='reconciling')return 'The site is connected but authoritative reconciliation is still running. Treat remote physical state as stale.';
  if(row.state==='partitioned')return 'The site is partitioned. Last known semantic state remains stale and cannot be promoted to current.';
  if(row.state==='offline')return 'The site is offline. Agent may use only qualified last-known state where policy permits.';
  if(row.state==='failed')return 'The site has a health or authority failure. Physical current-state claims are blocked.';
  if(row.state==='stale')return 'Federated semantic state is stale. Agent must qualify it as last known.';
  if(row.state==='degraded')return 'Federation health is degraded. Freshness is not verified current.';
  return 'Federation state is current and authoritative.';
}
function priorFor(previous,id){
  if(previous?.sites&&Array.isArray(previous.sites))return previous.sites.find(x=>siteId(x.site_id)===id)||null;
  return null;
}
function previousEventTimes(previous,id){return arr(previous?.event_state?.[id]?.transition_times).map(n).filter(Boolean);}
function relayProjection(relay={}){
  const cloud=relay?.cloud&&typeof relay.cloud==='object'?relay.cloud:relay;
  const state=txt(cloud?.state||'unknown',30).toLowerCase();
  return {
    state:['connected','reconnecting','offline','not_connected'].includes(state)?state:'unknown',
    connected:!!cloud?.connected,paired:!!cloud?.paired,last_seen_at:cloud?.last_seen_at??null,last_error:txt(cloud?.last_error,240),
    transport:txt(cloud?.transport,40)
  };
}

export function buildFederationAgentHealth(input={},previous={},now=Date.now()){
  const operations=copy(input.operations||{});
  const visibility=copy(input.syncVisibility??input.sync_visibility??{});
  const access=copy(input.access??input.accessOperations??input.access_operations??{});
  const relay=relayProjection(copy(input.relay||{}));
  const syncMap=mapBySite(visibility.sites);
  const accessPeers=new Map(arr(access.peers).map(x=>[siteId(x.site_id),x]));
  const sites=[];
  const events=[];
  const eventState={};
  const previousRelay=previous?.relay_health&&typeof previous.relay_health==='object'?previous.relay_health:{};
  let relayHealth='current';
  if(relay.paired&&relay.state==='offline')relayHealth='offline';
  else if(relay.paired&&relay.state==='reconnecting')relayHealth='recovering';
  else if(relay.paired&&!relay.connected&&relay.state!=='not_connected')relayHealth='degraded';
  const relayRow={
    component:'vp3_cloud_relay',state:relayHealth,previous_state:txt(previousRelay.state||'',30)||null,
    severity:severity(relayHealth,0,0),cause:relay.last_error?'cloud_relay_error':'cloud_relay_'+relay.state,
    recovery_complete:relayHealth==='current',message:relayHealth==='current'?'VP3 Cloud relay is connected or not required.':relayHealth==='recovering'?'VP3 Cloud relay is reconnecting; federation recovery is not yet complete.':'VP3 Cloud relay is unavailable.'
  };
  if((relayRow.previous_state&&relayRow.previous_state!==relayHealth)||(!relayRow.previous_state&&relayHealth!=='current')){
    events.push({
      event_id:'federation-health:vp3-cloud-relay:'+relayHealth+':'+String(Number(now)),
      event_type:relayHealth==='current'?'relay.recovered':'relay.'+relayHealth,component:'vp3_cloud_relay',
      severity:relayRow.severity,importance:relayRow.severity==='critical'?0.95:0.75,priority:relayRow.severity==='critical'?'priority':'normal',
      title:relayHealth==='current'?'VP3 Cloud relay recovered':'VP3 Cloud relay '+relayHealth,
      summary:relayRow.message,cause:relayRow.cause,recovery_complete:relayRow.recovery_complete,
      voice_eligible:true,dedupe_key:'vp3_cloud_relay|'+relayHealth+'|'+relayRow.cause,flap_count_10m:0,occurred_at_ms:Number(now)
    });
  }
  for(const site of arr(operations.sites)){
    if(!site||typeof site!=='object')continue;
    const id=siteId(site.id??site.site_id);if(!id)continue;
    const sync=syncMap.get(id)||{};
    const device=authorityDevice(operations,site);
    const prior=priorFor(previous,id);
    const previousState=txt(prior?.state||'',30).toLowerCase();
    let state=baseState(site,sync,device);
    const transportReturned=previousState&&['offline','partitioned','failed'].includes(previousState)
      && !['offline','partitioned','failed'].includes(state);
    if(transportReturned&&state!=='current')state='recovering';
    const stateSince=state===previousState?n(prior?.state_since||now):Number(now);
    let times=previousEventTimes(previous,id).filter(t=>Number(now)-t<=600000);
    if(previousState&&previousState!==state)times.push(Number(now));
    const flapCount=Math.max(0,times.length-1);
    const duration=Math.max(0,Number(now)-stateSince);
    const sev=severity(state,duration,flapCount);
    const accessPeer=accessPeers.get(id)||null;
    const agentVisible=id===siteId(operations.local_site_id)||!!accessPeer?.policy_peer_allowed;
    const row={
      site_id:id,label:txt(site.label||id,160),state,previous_state:previousState||null,state_since:stateSince,
      duration_ms:duration,severity:sev,cause:siteCause(site,sync,device,relay),
      federation_status:txt(sync.status||site?.federation?.status||'unknown',30).toLowerCase(),
      fresh:!!sync.fresh,reconciliation_required:!!sync.reconciliation_required,
      revision_gap:n(sync.revision_gap),stale_age_ms:n(sync.stale_age_ms),
      authority:{status:txt(site?.authority?.status||'unknown',30),device_id:siteId(site?.authority?.device_id),epoch:n(site?.authority?.epoch)},
      authority_device_runtime:txt(device?.runtime_status??device?.status||'unknown',40).toLowerCase(),
      trust:trustFor(state,sync),agent_visible:agentVisible,
      recovery_complete:state==='current'&&!!sync.fresh&&!sync.reconciliation_required,
      recovery_gate:'authoritative_reconciliation_current',
      flap_count_10m:flapCount
    };
    row.title=titleFor(row);
    row.message=messageFor(row);
    sites.push(row);
    eventState[id]={state,state_since:stateSince,transition_times:times.slice(-20)};
    const changed=!previousState||previousState!==state;
    const priorSeverity=txt(prior?.severity||'info',20);
    const escalated=!changed&&(severityRank[sev]??0)>(severityRank[priorSeverity]??0);
    if((changed||escalated)&&!(state==='current'&&!previousState)){
      const type=escalated?'site.escalated':eventType(state,previousState);
      events.push({
        event_id:'federation-health:'+id+':'+state+':'+String(Number(now)),
        event_type:type,site_id:id,label:row.label,state,previous_state:previousState||null,
        severity:sev,importance:sev==='critical'?0.95:sev==='warning'?0.75:0.55,
        priority:sev==='critical'?'priority':'normal',
        title:escalated?(row.label+' health escalated'):row.title,summary:row.message,cause:row.cause,trust:copy(row.trust),
        recovery_complete:row.recovery_complete,voice_eligible:sev!=='info'||type==='site.recovered',
        dedupe_key:id+'|'+state+'|'+row.cause,
        flap_count_10m:flapCount,occurred_at_ms:Number(now)
      });
    }
  }
  const nonCurrent=sites.filter(s=>s.state!=='current');
  let overall='current';
  for(const row of sites)if((rank[row.state]??1)>(rank[overall]??0))overall=row.state;
  if((rank[relayHealth]??0)>(rank[overall]??0))overall=relayHealth;
  const visible=sites.filter(s=>s.agent_visible);
  const relayIssue=relayHealth!=='current'?{component:'vp3_cloud_relay',state:relayHealth,severity:relayRow.severity,cause:relayRow.cause,message:relayRow.message}:null;
  const priorityEvents=events.filter(e=>e.severity==='critical'||e.event_type==='site.recovered'||e.event_type==='relay.recovered');
  return {
    protocol:FEDERATION_AGENT_HEALTH_PROTOCOL,version:FEDERATION_AGENT_HEALTH_VERSION,schema_version:1,
    generated_at:Number(now),local_site_id:siteId(operations.local_site_id),overall_state:overall,relay,relay_health:relayRow,sites,events,event_state:eventState,
    counts:{
      sites:sites.length,current:sites.filter(s=>s.state==='current').length,
      degraded:sites.filter(s=>['degraded','stale','reconciling','recovering'].includes(s.state)).length,
      critical:sites.filter(s=>['partitioned','offline','failed'].includes(s.state)).length,
      recovering:sites.filter(s=>s.state==='recovering'||s.state==='reconciling').length
    },
    agent_context:{
      overall_state:overall,
      sites:visible.map(s=>({site_id:s.site_id,label:s.label,state:s.state,severity:s.severity,cause:s.cause,fresh:s.fresh,recovery_complete:s.recovery_complete,trust:s.trust})),
      active_issues:[
        ...visible.filter(s=>s.state!=='current').map(s=>({site_id:s.site_id,label:s.label,state:s.state,severity:s.severity,cause:s.cause,message:s.message,trust:s.trust})),
        ...(relayIssue?[relayIssue]:[])
      ].slice(0,24),
      summary:(nonCurrent.length||relayIssue)?[
        ...nonCurrent.map(s=>s.label+' is '+s.state).slice(0,6),
        ...(relayIssue?['VP3 Cloud relay is '+relayHealth]:[])
      ].join('; '):'All authorized federation sites and the Cloud relay are current.',
      recovery_requires_authoritative_reconciliation:true,
      connectivity_returned_is_not_recovery:true
    },
    notifications:priorityEvents,
    boundaries:[
      'connectivity-returned-is-not-recovery',
      'recovery-requires-authoritative-reconciliation-current',
      'stale-state-never-promoted-to-current',
      'health-never-changes-authority',
      'agent-health-context-respects-site-policy',
      'duplicate-and-flap-alerts-are-bounded'
    ]
  };
}

export function shouldDeliverFederationHealthEvent(event,deliveryState={},now=Date.now()){
  if(!event||typeof event!=='object')return {deliver:false,reason:'invalid_event'};
  const key=txt(event.dedupe_key,320);if(!key)return {deliver:false,reason:'missing_dedupe_key'};
  const prior=deliveryState[key]||{};
  const last=n(prior.last_delivered_at),priorSeverity=txt(prior.severity||'info',20);
  const cooldown=event.severity==='critical'?60000:120000;
  const severityIncreased=(severityRank[event.severity]??0)>(severityRank[priorSeverity]??0);
  if(last&&Number(now)-last<cooldown&&!severityIncreased)return {deliver:false,reason:'dedupe_cooldown'};
  return {deliver:true,reason:severityIncreased?'severity_escalated':'state_change',next:{last_delivered_at:Number(now),severity:event.severity}};
}

export function federationAgentHealthCapability(){
  return {
    version:FEDERATION_AGENT_HEALTH_VERSION,protocol:FEDERATION_AGENT_HEALTH_PROTOCOL,
    states:[...FEDERATION_AGENT_HEALTH_STATES],recovery_requires_authoritative_reconciliation:true,
    connectivity_returned_is_not_recovery:true,priority_agent_events:true,voice_eligible_events:true,
    flap_suppression:true,stale_data_qualification:true,permission_filtered_agent_context:true,
    authority_mutation:false
  };
}
