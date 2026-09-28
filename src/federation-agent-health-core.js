const copy=v=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const n=v=>Math.max(0,Number(v)||0);
const arr=v=>Array.isArray(v)?v:[];
const rank={connected:0,degraded:1,stale:2,reconciling:3,recovering:4,partitioned:5,offline:6,failed:7};
const failureStates=new Set(['degraded','stale','reconciling','recovering','partitioned','offline','failed']);
const hardFailureStates=new Set(['partitioned','offline','failed']);

export const FEDERATION_AGENT_HEALTH_PROTOCOL='physical_federation_agent_health.v1';
export const FEDERATION_AGENT_HEALTH_VERSION='2.80';

function siteId(row){return txt(row?.id??row?.site_id,64).toLowerCase();}
function deviceMap(operations){return new Map(arr(operations?.devices).map(row=>[txt(row?.id??row?.device_id,64).toLowerCase(),row]));}
function syncMap(visibility){return new Map(arr(visibility?.sites).map(row=>[txt(row?.site_id,64).toLowerCase(),row]));}
function previousMap(previous){return new Map(arr(previous?.sites).map(row=>[txt(row?.site_id,64).toLowerCase(),row]));}
function accessPeerMap(access){return new Map(arr(access?.peers).map(row=>[txt(row?.site_id,64).toLowerCase(),row]));}
function runtimeOffline(v){return ['offline','disconnected','unreachable','failed','stopped'].includes(txt(v,40).toLowerCase());}

function stateFor(site,sync,authorityDevice,previous){
  const siteStatus=txt(site?.status||'active',24).toLowerCase();
  const opsHealth=txt(site?.health||'unknown',24).toLowerCase();
  const syncStatus=txt(sync?.status??site?.federation?.status??'unknown',24).toLowerCase();
  const authority=site?.authority&&typeof site.authority==='object'?site.authority:{};
  if(siteStatus!=='active')return 'offline';
  if(authority.status&&authority.status!=='current')return 'failed';
  if(authorityDevice&&runtimeOffline(authorityDevice.runtime_status))return 'offline';
  if(syncStatus==='failed')return 'failed';
  if(syncStatus==='partitioned')return 'partitioned';
  if(syncStatus==='reconciling'){
    const prior=txt(previous?.state,24).toLowerCase();
    return hardFailureStates.has(prior)||prior==='stale'||previous?.recovery_pending?'recovering':'reconciling';
  }
  if(['stale','suspect','unknown'].includes(syncStatus))return 'stale';
  if(opsHealth==='critical'||opsHealth==='degraded')return 'degraded';
  return 'connected';
}
function issueCode(state,site,sync,authorityDevice){
  const authority=site?.authority&&typeof site.authority==='object'?site.authority:{};
  if(state==='failed'&&authority.status&&authority.status!=='current')return authority.reason||'authority_invalid';
  if(state==='offline'&&authorityDevice&&runtimeOffline(authorityDevice.runtime_status))return 'authority_device_offline';
  if(state==='offline')return 'site_offline';
  if(state==='partitioned')return 'federation_partitioned';
  if(state==='recovering')return 'reconciliation_recovery_pending';
  if(state==='reconciling')return 'federation_reconciling';
  if(state==='stale')return 'federation_stale';
  if(state==='failed')return txt(sync?.last_error,120)||'federation_failed';
  if(state==='degraded')return 'site_degraded';
  return '';
}
function confidenceScope(state,isLocal,bridge){
  const localPhysicalCurrent=isLocal&&!['failed','offline'].includes(state);
  const federationCurrent=state==='connected';
  const cloudTransportConnected=Boolean(bridge?.connected);
  return {
    local_physical_truth_current:localPhysicalCurrent,
    remote_federation_truth_current:federationCurrent,
    cloud_transport_connected:cloudTransportConnected,
    agent_may_treat_remote_state_as_current:federationCurrent,
    agent_may_treat_local_state_as_current:localPhysicalCurrent,
    note:federationCurrent
      ?'Authoritative federation state is current.'
      :localPhysicalCurrent
        ?'Local physical truth may remain current, but remote federation truth is not current.'
        :'Physical truth is not verified current.'
  };
}
function stateMessage(site,state,sync){
  const label=txt(site?.label||siteId(site),160)||'Site';
  if(state==='connected')return label+' is connected and authoritative federation state is current.';
  if(state==='recovering')return label+' has connectivity again but is still reconciling. Recovery is not complete.';
  if(state==='reconciling')return label+' is reconciling authoritative federation state.';
  if(state==='partitioned')return label+' is partitioned. Remote physical data must be treated as stale.';
  if(state==='offline')return label+' is offline.';
  if(state==='failed')return label+' federation health failed closed'+(sync?.last_error?': '+txt(sync.last_error,180):'.');
  if(state==='stale')return label+' federation state is stale and must not be treated as current.';
  return label+' is degraded.';
}
function severity(state,ageMs){
  if(['offline','failed','partitioned'].includes(state))return ageMs>=15*60*1000?'critical':'high';
  if(['recovering','reconciling','stale'].includes(state))return ageMs>=30*60*1000?'high':'warning';
  if(state==='degraded')return ageMs>=30*60*1000?'warning':'notice';
  return 'info';
}
function escalationLevel(state,ageMs){
  if(state==='connected')return 0;
  if(ageMs>=60*60*1000)return 3;
  if(ageMs>=15*60*1000)return 2;
  if(ageMs>=2*60*1000)return 1;
  return 0;
}
function eventFor(site,current,previous,now){
  const changed=!previous||previous.state!==current.state;
  const escalated=previous&&previous.state===current.state&&n(previous.escalation_level)<current.escalation_level;
  if(!changed&&!escalated)return null;
  let type='site_'+current.state;
  let title=txt(site.label||site.id,160)+' '+current.state;
  let body=current.message;
  if(previous&&failureStates.has(previous.state)&&current.state==='connected'){
    type='site_recovered';title=txt(site.label||site.id,160)+' recovered';
    body=txt(site.label||site.id,160)+' is recovered. Authoritative reconciliation is complete and federation state is current.';
  }else if(current.state==='recovering'){
    type='site_recovering';title=txt(site.label||site.id,160)+' reconnecting';
    body=txt(site.label||site.id,160)+' reconnected, but recovery remains pending until authoritative reconciliation is current.';
  }else if(escalated){
    type='site_health_escalated';title=txt(site.label||site.id,160)+' health escalation';
    body=current.message+' The condition has persisted and was escalated.';
  }
  const priority=type==='site_recovered'?'info':severity(current.state,current.state_age_ms);
  return {
    event_type:type,site_id:current.site_id,site_label:current.label,
    previous_state:previous?.state||'unknown',state:current.state,priority,
    title,body,issue_code:current.issue_code,occurred_at:Number(now),
    chat:true,notification:['high','critical'].includes(priority)||type==='site_recovered'||type==='site_recovering',
    voice_eligible:['high','critical'].includes(priority)||type==='site_recovered',
    recovery_complete:type==='site_recovered',
    reconciliation_required:current.reconciliation_required,
    dedupe_key:'site:'+current.site_id+':'+type+':'+current.escalation_level
  };
}
function bridgeState(bridge={},previousBridge={},now){
  const raw=txt(bridge.state??bridge.stage??(bridge.connected?'connected':'offline'),40).toLowerCase();
  const connected=Boolean(bridge.connected)||raw==='connected';
  let state=connected?'connected':raw==='reconnecting'?'reconnecting':raw==='not_connected'?'not_connected':'offline';
  const since=n(previousBridge?.state===state?previousBridge.state_since:now)||Number(now);
  const age=Math.max(0,Number(now)-since);
  return {
    state,connected,state_since:since,state_age_ms:age,
    last_error:txt(bridge.last_error,240),
    last_connected_at:bridge.last_connected_at??null,
    reconnect_count:n(bridge.reconnect_count),
    transport:txt(bridge.transport??bridge.transport_label,80),
    impacts_local_physical_truth:false,
    impacts_cloud_federation_delivery:!connected
  };
}
function bridgeEvent(current,previous,now){
  const changed=!previous||previous.state!==current.state;
  const escalation=previous&&previous.state===current.state&&escalationLevel(current.state,current.state_age_ms)>n(previous.escalation_level);
  if(!changed&&!escalation)return null;
  let type=current.connected?'relay_recovered':current.state==='reconnecting'?'relay_reconnecting':'relay_disconnected';
  const priority=current.connected?'info':current.state_age_ms>=15*60*1000?'high':'warning';
  return {
    event_type:type,site_id:'',site_label:'VP3 Cloud Relay',
    previous_state:previous?.state||'unknown',state:current.state,priority,
    title:current.connected?'VP3 Cloud connection restored':'VP3 Cloud connection '+(current.state==='reconnecting'?'reconnecting':'offline'),
    body:current.connected
      ?'The HomeServer Cloud transport is connected. Site recovery still depends on federation reconciliation state.'
      :'The VP3 Cloud transport is '+current.state+'. Local physical truth may remain available on HomeServer.',
    issue_code:current.connected?'':'cloud_relay_'+current.state,occurred_at:Number(now),
    chat:true,notification:true,voice_eligible:true,recovery_complete:current.connected,
    reconciliation_required:false,dedupe_key:'relay:'+type+':'+escalationLevel(current.state,current.state_age_ms)
  };
}

export function buildFederationAgentHealth(input={},now=Date.now()){
  const operations=copy(input.operations||{}),syncVisibility=copy(input.syncVisibility??input.sync_visibility??{});
  const access=copy(input.accessOperations??input.access_operations??{}),previous=copy(input.previous||{});
  const devices=deviceMap(operations),sync=syncMap(syncVisibility),prior=previousMap(previous),accessPeers=accessPeerMap(access);
  const localSite=txt(syncVisibility.local_site_id??operations.local_site_id,64).toLowerCase();
  const sites=arr(operations.sites).map(site=>{
    const id=siteId(site),syncRow=sync.get(id)||site.federation||{},priorRow=prior.get(id)||{};
    const authorityId=txt(site?.authority?.device_id,64).toLowerCase();
    const authorityDevice=devices.get(authorityId)||null;
    const state=stateFor(site,syncRow,authorityDevice,priorRow);
    const stateSince=priorRow.state===state?n(priorRow.state_since)||Number(now):Number(now);
    const age=Math.max(0,Number(now)-stateSince);
    const escalation=escalationLevel(state,age);
    const accessPeer=accessPeers.get(id)||null;
    const row={
      site_id:id,label:txt(site.label||id,160),is_local:id===localSite,state,
      state_since:stateSince,state_age_ms:age,escalation_level:escalation,
      priority:severity(state,age),health:txt(site.health||'unknown',24),
      sync_status:txt(syncRow.status??site?.federation?.status??'unknown',24),
      reconciliation_required:Boolean(syncRow.reconciliation_required)||['recovering','reconciling','partitioned','stale','failed'].includes(state),
      fresh:state==='connected',issue_code:issueCode(state,site,syncRow,authorityDevice),
      message:'',authority:copy(site.authority||{}),
      authority_device:authorityDevice?{
        id:txt(authorityDevice.id,64),label:txt(authorityDevice.label,160),
        hardware_profile:txt(authorityDevice.hardware_profile,40),
        runtime_status:txt(authorityDevice.runtime_status||'unknown',40),
        last_seen_at:authorityDevice.last_seen_at??0
      }:null,
      trust:confidenceScope(state,id===localSite,input.bridge||{}),
      access:{
        policy_peer_allowed:accessPeer?Boolean(accessPeer.policy_peer_allowed):null,
        federation_enabled:accessPeer?Boolean(accessPeer.federation_enabled):null,
        revocation_wins:true
      },
      recovery_pending:state==='recovering'||state==='reconciling'
    };
    row.message=stateMessage(site,state,syncRow);
    return row;
  }).sort((a,b)=>a.site_id.localeCompare(b.site_id));
  const bridge=bridgeState(input.bridge||{},previous.bridge||{},now);
  bridge.escalation_level=escalationLevel(bridge.state,bridge.state_age_ms);
  const events=[];
  for(const site of sites){
    const event=eventFor({id:site.site_id,label:site.label},site,prior.get(site.site_id)||null,now);
    if(event)events.push(event);
  }
  const be=bridgeEvent(bridge,previous.bridge||null,now);if(be)events.push(be);
  const overall=sites.reduce((worst,row)=>(rank[row.state]??1)>(rank[worst]??0)?row.state:worst,'connected');
  return {
    protocol:FEDERATION_AGENT_HEALTH_PROTOCOL,version:FEDERATION_AGENT_HEALTH_VERSION,schema_version:1,
    generated_at:Number(now),local_site_id:localSite,overall_state:overall,sites,bridge,events,
    counts:{
      sites:sites.length,connected:sites.filter(x=>x.state==='connected').length,
      degraded:sites.filter(x=>x.state==='degraded').length,stale:sites.filter(x=>x.state==='stale').length,
      reconciling:sites.filter(x=>x.state==='reconciling').length,recovering:sites.filter(x=>x.state==='recovering').length,
      partitioned:sites.filter(x=>x.state==='partitioned').length,offline:sites.filter(x=>x.state==='offline').length,
      failed:sites.filter(x=>x.state==='failed').length
    },
    agent_context:{
      state:overall,
      site_health:sites.map(x=>({
        site_id:x.site_id,label:x.label,state:x.state,priority:x.priority,message:x.message,
        fresh:x.fresh,reconciliation_required:x.reconciliation_required,issue_code:x.issue_code,trust:x.trust
      })),
      bridge:copy(bridge),
      recovery_rule:'Connectivity returning does not equal recovery. Recovery completes only after authoritative reconciliation is current.',
      local_truth_survives_cloud_relay_failure:true,
      no_remote_authority_promotion:true
    },
    delivery:{
      chat_events:true,priority_notifications:true,voice_respects_existing_settings:true,
      duplicate_state_events_suppressed:true,escalation_requires_persistent_duration:true
    },
    boundaries:[
      'reconnect-is-not-recovery',
      'authoritative-reconciliation-required-for-recovery',
      'local-physical-truth-separated-from-cloud-transport',
      'stale-remote-data-never-current',
      'agent-health-does-not-promote-authority',
      'permissions-and-consent-remain-enforced',
      'duplicate-transient-alerts-suppressed'
    ]
  };
}

export function federationAgentHealthCapability(){
  return {
    version:FEDERATION_AGENT_HEALTH_VERSION,protocol:FEDERATION_AGENT_HEALTH_PROTOCOL,
    states:Object.keys(rank),relay_states:['connected','reconnecting','offline','not_connected'],
    recovery_requires_current_reconciliation:true,chat_events:true,priority_notifications:true,
    voice_eligible_events:true,voice_respects_existing_settings:true,persistent_history:true,
    duplicate_state_suppression:true,duration_escalation:true,cloud_mirror_only:true,
    authority_mutation:false
  };
}
