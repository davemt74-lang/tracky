const copy=v=>JSON.parse(JSON.stringify(v??null));
const arr=v=>Array.isArray(v)?v:[];
const txt=(v,max=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const num=v=>Math.max(0,Number(v)||0);
const siteId=v=>txt(v,64).toLowerCase();
const stateRank={healthy:0,unknown:1,degraded:2,stale:3,recovering:4,offline:5,failed:6};
const severityRank={info:0,warning:1,critical:2};

export const FEDERATION_FLEET_HEALTH_PROTOCOL='physical_federation_fleet_health.v1';
export const FEDERATION_FLEET_HEALTH_VERSION='2.80';
export const FEDERATION_FLEET_HEALTH_STATES=Object.freeze(['healthy','degraded','stale','recovering','offline','failed','unknown']);

function epochMs(v){
  if(v===null||v===undefined||v==='')return 0;
  if(Number.isFinite(Number(v))&&Number(v)>=0)return Number(v);
  const t=Date.parse(String(v));
  return Number.isFinite(t)?t:0;
}
function federationBySite(report){
  return new Map(arr(report?.sites).filter(x=>x&&typeof x==='object').map(x=>[siteId(x.site_id??x.id),x]).filter(([id])=>id));
}
function fleetBySite(rows){
  return new Map(arr(rows).filter(x=>x&&typeof x==='object').map(x=>[siteId(x.site_id??x.id),x]).filter(([id])=>id));
}
function accessBySite(access){
  return new Map(arr(access?.peers).filter(x=>x&&typeof x==='object').map(x=>[siteId(x.site_id),x]).filter(([id])=>id));
}
function severityFor(state){
  if(['failed','offline'].includes(state))return 'critical';
  if(['degraded','stale','recovering'].includes(state))return 'warning';
  return 'info';
}
function normalizeIssueCodes(raw){
  const out=[];
  for(const v of arr(raw).slice(0,32)){
    const code=txt(typeof v==='string'?v:v?.code,80).toLowerCase().replace(/[^a-z0-9_.:-]+/g,'_');
    if(code&&!out.includes(code))out.push(code);
  }
  return out;
}
function deviceState(device,now,staleAfterMs,offlineAfterMs){
  const issues=normalizeIssueCodes(device.issues);
  const seen=epochMs(device.last_seen_at??device.reported_at??device.reported_at_ms);
  const age=seen?Math.max(0,Number(now)-seen):Number.MAX_SAFE_INTEGER;
  if(age>offlineAfterMs)return {state:'offline',age,issues:[...new Set([...issues,'telemetry_offline'])]};
  if(age>staleAfterMs)return {state:'stale',age,issues:[...new Set([...issues,'telemetry_stale'])]};
  const explicit=txt(device.health??device.state,32).toLowerCase();
  const fatal=new Set(['privacy_fault','commissioning_blocked','certification_failed','storage_critical','update_failed']);
  if(issues.some(code=>fatal.has(code))||['critical','failed','error'].includes(explicit))return {state:'failed',age,issues};
  if(issues.length||['warning','degraded'].includes(explicit))return {state:'degraded',age,issues};
  if(['offline','disconnected'].includes(txt(device.runtime_status,32).toLowerCase()))return {state:'offline',age,issues:[...new Set([...issues,'runtime_offline'])]};
  if(['healthy','ready','online','current',''].includes(explicit))return {state:'healthy',age,issues};
  return {state:'unknown',age,issues};
}
function sanitizeDevice(raw,site,now,staleAfterMs,offlineAfterMs){
  const state=deviceState(raw,now,staleAfterMs,offlineAfterMs);
  return {
    device_id:txt(raw.device_id??raw.id,80),
    label:txt(raw.label,120),
    site_id:site,
    hardware_profile:txt(raw.hardware_profile??raw.profile_key??raw.experience_profile??'custom',60).toLowerCase()||'custom',
    os_version:txt(raw.os_version??raw.version,80),
    hardware_experience_version:txt(raw.hardware_experience_version,80),
    release_channel:txt(raw.release_channel,24).toLowerCase(),
    rollout_ring:txt(raw.rollout_ring,24).toLowerCase(),
    commissioning_state:txt(raw.commissioning_state,24).toLowerCase(),
    certification_result:txt(raw.certification_result,24).toLowerCase(),
    update_status:txt(raw.update_status,32).toLowerCase(),
    backup_state:txt(raw.backup_state,24).toLowerCase(),
    storage_state:txt(raw.storage_state,24).toLowerCase(),
    watchdog_failures:Math.min(1000,num(raw.watchdog_failures)),
    privacy_fault:!!raw.privacy_fault,
    runtime_status:txt(raw.runtime_status,32).toLowerCase(),
    runtime_version:txt(raw.runtime_version??raw.version,80),
    camera_count:Math.min(128,num(raw.camera_count)),
    sensor_count:Math.min(512,num(raw.sensor_count)),
    model_health:txt(raw.model_health??'unknown',32).toLowerCase(),
    active_models:Math.min(256,num(raw.active_models)),
    calibration_profiles:Math.min(256,num(raw.calibration_profiles)),
    calibration_state:txt(raw.calibration_state??'unknown',32).toLowerCase(),
    last_sync_at:raw.last_sync_at??null,
    error_count:Math.min(1000,num(raw.error_count??state.issues.length)),
    upgrade_state:txt(raw.upgrade_state??raw.update_status,32).toLowerCase(),
    last_seen_at:raw.last_seen_at??raw.reported_at??null,
    stale_age_ms:Number.isFinite(state.age)?state.age:0,
    state:state.state,
    severity:severityFor(state.state),
    issues:state.issues.slice(0,32)
  };
}
function worstState(states){
  let out='healthy';
  for(const s of states)if((stateRank[s]??1)>(stateRank[out]??0))out=s;
  return states.length?out:'unknown';
}
function applyFederationGate(localState,fed){
  const s=txt(fed?.state,32).toLowerCase();
  const current=s==='current'&&!!fed?.fresh&&!!fed?.recovery_complete;
  if(current)return {state:localState,current:true,reason:'authoritative_reconciliation_current'};
  if(['recovering','reconciling'].includes(s))return {state:'recovering',current:false,reason:'federation_'+s};
  if(['partitioned','offline','failed'].includes(s))return {state:'stale',current:false,reason:'federation_'+s};
  if(['stale','degraded'].includes(s))return {state:'stale',current:false,reason:'federation_'+s};
  if(!s||s==='unknown')return {state:localState==='healthy'?'unknown':localState,current:false,reason:'federation_unknown'};
  return {state:localState,current:false,reason:'federation_not_current'};
}
function siteMessage(row){
  if(row.state==='healthy')return row.label+' fleet diagnostics are healthy and current.';
  if(row.state==='recovering')return row.label+' diagnostics are available, but federation recovery is not complete.';
  if(row.state==='stale')return row.label+' diagnostics are last-known and must not be treated as current.';
  if(row.state==='offline')return row.label+' fleet diagnostics are offline.';
  if(row.state==='failed')return row.label+' has a critical fleet diagnostic failure.';
  if(row.state==='degraded')return row.label+' has degraded fleet diagnostics.';
  return row.label+' fleet health is unknown.';
}
function eventKey(row){return row.site_id+'|'+row.state+'|'+row.cause;}

export function buildFederationFleetHealth(input={},previous={},now=Date.now()){
  const operations=copy(input.operations||{});
  const federationHealth=copy(input.federationHealth??input.federation_health??{});
  const access=copy(input.access??input.accessOperations??input.access_operations??{});
  const fleetRows=copy(input.fleetSites??input.fleet_sites??[]);
  const staleAfterMs=Math.max(60000,num(input.stale_after_ms)||300000);
  const offlineAfterMs=Math.max(staleAfterMs*2,num(input.offline_after_ms)||900000);
  const fedMap=federationBySite(federationHealth);
  const fleetMap=fleetBySite(fleetRows);
  const accessMap=accessBySite(access);
  const local=siteId(operations.local_site_id||federationHealth.local_site_id);
  const previousSites=new Map(arr(previous?.sites).map(x=>[siteId(x.site_id),x]));
  const sites=[];
  const events=[];

  for(const rawSite of arr(operations.sites)){
    if(!rawSite||typeof rawSite!=='object')continue;
    const id=siteId(rawSite.id??rawSite.site_id); if(!id)continue;
    const fleet=fleetMap.get(id)||{};
    const fed=fedMap.get(id)||{};
    const visible=id===local||!!accessMap.get(id)?.policy_peer_allowed;
    const generatedAt=epochMs(fleet.generated_at??fleet.generated_at_ms);
    const snapshotAge=generatedAt?Math.max(0,Number(now)-generatedAt):0;
    const diagnosticsAllowed=fleet.diagnostics_allowed!==false;
    const devices=diagnosticsAllowed?arr(fleet.devices).slice(0,256).map(d=>sanitizeDevice(d,id,now,staleAfterMs,offlineAfterMs)):[];
    let localState=worstState(devices.map(d=>d.state));
    if(!diagnosticsAllowed)localState='unknown';
    if(generatedAt&&snapshotAge>offlineAfterMs)localState='offline';
    else if(generatedAt&&snapshotAge>staleAfterMs&&localState!=='offline'&&localState!=='failed')localState='stale';
    const gate=applyFederationGate(localState,fed);
    let state=gate.state;
    if(id===local&&!fed?.state&&localState!=='unknown')state=localState;
    const failedDevices=devices.filter(d=>['failed','offline'].includes(d.state));
    const degradedDevices=devices.filter(d=>['degraded','stale'].includes(d.state));
    const cause=
      !diagnosticsAllowed?'diagnostics_not_allowed':
      failedDevices[0]?.issues?.[0]||degradedDevices[0]?.issues?.[0]||
      (gate.current?'':gate.reason)||
      (state==='healthy'?'':'diagnostics_'+state);
    const prior=previousSites.get(id)||{};
    const previousState=txt(prior.state,32).toLowerCase()||null;
    const row={
      site_id:id,
      label:txt(rawSite.label||id,160),
      state,
      previous_state:previousState,
      severity:severityFor(state),
      cause,
      diagnostics_allowed:diagnosticsAllowed,
      diagnostics_current:gate.current||id===local&&(!fed?.state||fed?.state==='current'),
      generated_at:generatedAt||null,
      snapshot_age_ms:snapshotAge,
      federation_state:txt(fed?.state||'unknown',32).toLowerCase(),
      federation_recovery_complete:!!fed?.recovery_complete,
      device_count:devices.length,
      healthy_device_count:devices.filter(d=>d.state==='healthy').length,
      degraded_device_count:devices.filter(d=>['degraded','stale'].includes(d.state)).length,
      critical_device_count:failedDevices.length,
      devices,
      agent_visible:visible,
      current_claims_allowed:(gate.current||id===local&&(!fed?.state||fed?.state==='current'))&&state==='healthy',
      trust:{
        diagnostics:gate.current||id===local&&(!fed?.state||fed?.state==='current')?'current':'qualified_last_known',
        physical_claims:(gate.current||id===local&&(!fed?.state||fed?.state==='current'))?'section7_governed':'do_not_claim_current',
        reason:gate.current?'authoritative_reconciliation_current':gate.reason
      }
    };
    row.message=siteMessage(row);
    sites.push(row);
    if(previousState&&previousState!==state){
      events.push({
        event_id:'fleet-health:'+id+':'+state+':'+String(Number(now)),
        event_type:state==='healthy'?'fleet.site_recovered':'fleet.site_'+state,
        site_id:id,label:row.label,state,previous_state:previousState,severity:row.severity,cause:row.cause,
        summary:row.message,dedupe_key:eventKey(row),occurred_at_ms:Number(now)
      });
    } else if(!previousState&&['failed','offline'].includes(state)){
      events.push({
        event_id:'fleet-health:'+id+':'+state+':'+String(Number(now)),
        event_type:'fleet.site_'+state,site_id:id,label:row.label,state,previous_state:null,severity:'critical',cause:row.cause,
        summary:row.message,dedupe_key:eventKey(row),occurred_at_ms:Number(now)
      });
    }
  }
  const visibleSites=sites.filter(s=>s.agent_visible);
  const overall=worstState(sites.map(s=>s.state));
  const agentOverall=worstState(visibleSites.map(s=>s.state));
  const activeIssues=visibleSites.filter(s=>s.state!=='healthy').map(s=>({
    site_id:s.site_id,label:s.label,state:s.state,severity:s.severity,cause:s.cause,message:s.message,
    diagnostics_current:s.diagnostics_current,current_claims_allowed:s.current_claims_allowed
  })).slice(0,32);
  return {
    protocol:FEDERATION_FLEET_HEALTH_PROTOCOL,version:FEDERATION_FLEET_HEALTH_VERSION,schema_version:1,
    generated_at:Number(now),local_site_id:local,overall_state:overall,
    thresholds:{stale_after_ms:staleAfterMs,offline_after_ms:offlineAfterMs},
    counts:{
      sites:sites.length,devices:sites.reduce((n,s)=>n+s.device_count,0),
      healthy:sites.filter(s=>s.state==='healthy').length,
      degraded:sites.filter(s=>['degraded','stale','recovering'].includes(s.state)).length,
      critical:sites.filter(s=>['failed','offline'].includes(s.state)).length
    },
    sites,events,
    agent_context:{
      overall_state:agentOverall,
      sites:visibleSites.map(s=>({site_id:s.site_id,label:s.label,state:s.state,severity:s.severity,cause:s.cause,diagnostics_current:s.diagnostics_current,current_claims_allowed:s.current_claims_allowed})),
      active_issues:activeIssues,
      summary:activeIssues.length?activeIssues.slice(0,6).map(x=>x.label+' is '+x.state).join('; '):'All authorized fleet diagnostics are healthy and current.',
      section7_health_is_authoritative:true,
      diagnostics_never_promote_federation_freshness:true
    },
    privacy:{
      diagnostic_content_included:false,local_path_details_included:false,network_endpoint_details_included:false,
      secret_material_included:false,conversations_included:false,captured_media_content_included:false,knowledge_content_included:false
    },
    cloud_projection:{summary_only:true,read_only:true,authority_mutation:false,remote_command_execution:false},
    boundaries:[
      'section7-federation-health-remains-authoritative',
      'diagnostics-never-promote-stale-state-to-current',
      'diagnostics-are-observational-not-control-authority',
      'cloud-mirror-is-read-only',
      'privacy-safe-summary-only',
      'agent-context-respects-federation-permissions'
    ]
  };
}

export function federationFleetHealthCapability(){
  return {
    version:FEDERATION_FLEET_HEALTH_VERSION,protocol:FEDERATION_FLEET_HEALTH_PROTOCOL,
    states:[...FEDERATION_FLEET_HEALTH_STATES],section7_health_is_authoritative:true,
    diagnostics_never_promote_federation_freshness:true,permission_filtered_agent_context:true,
    privacy_safe_summary_only:true,cloud_read_only:true,remote_command_execution:false,authority_mutation:false,
    hardware_profiles:['homeserver','node','desk','studio','team_node','pocket','custom','future']
  };
}
