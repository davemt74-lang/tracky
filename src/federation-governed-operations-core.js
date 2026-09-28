const copy=v=>JSON.parse(JSON.stringify(v??null));
const arr=v=>Array.isArray(v)?v:[];
const txt=(v,max=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const siteId=v=>txt(v,64).toLowerCase();
const nowNum=v=>Math.max(0,Number(v)||0);

export const FEDERATION_GOVERNED_OPERATIONS_PROTOCOL='physical_federation_governed_operations.v1';
export const FEDERATION_GOVERNED_OPERATIONS_VERSION='2.80';
export const FEDERATION_OPERATION_TYPES=Object.freeze(['reconnect','reconcile','restart_runtime','request_update','revoke_site','revoke_device','transfer_authority']);
export const FEDERATION_OPERATION_STATES=Object.freeze(['proposed','awaiting_approval','approved','queued','running','reconciling','completed','failed','rejected','cancelled','expired']);

const HIGH_RISK=new Set(['restart_runtime','request_update','revoke_site','revoke_device','transfer_authority']);
const TERMINAL=new Set(['completed','failed','rejected','cancelled','expired']);
const TRANSITIONS={
  proposed:new Set(['awaiting_approval','approved','rejected','cancelled','expired']),
  awaiting_approval:new Set(['approved','rejected','cancelled','expired']),
  approved:new Set(['queued','rejected','cancelled','expired']),
  queued:new Set(['running','failed','cancelled','expired']),
  running:new Set(['reconciling','completed','failed','cancelled','expired']),
  reconciling:new Set(['completed','failed','cancelled','expired']),
  completed:new Set(),failed:new Set(),rejected:new Set(),cancelled:new Set(),expired:new Set()
};

function operationType(v){
  const op=txt(v,40).toLowerCase();
  if(!FEDERATION_OPERATION_TYPES.includes(op))throw new Error('unsupported_operation');
  return op;
}
function normalizedActor(v={}){
  return {actor_id:txt(v.actor_id??v.id,100),actor_type:txt(v.actor_type??v.type??'user',30).toLowerCase(),display_name:txt(v.display_name??v.label,120)};
}
function federationSite(health,site){return arr(health?.sites).find(x=>siteId(x?.site_id)===site)||{};}
function accessSite(access,site){return arr(access?.peers).find(x=>siteId(x?.site_id)===site)||{};}
function fleetSite(fleet,site){return arr(fleet?.sites).find(x=>siteId(x?.site_id)===site)||{};}
function deviceAt(fleetRow,deviceId){return arr(fleetRow?.devices).find(x=>txt(x?.device_id,80)===deviceId)||{};}

export function evaluateFederationOperation(input={},now=Date.now()){
  const op=operationType(input.operation_type??input.type);
  const targetSite=siteId(input.target_site_id??input.site_id);
  if(!targetSite)throw new Error('target_site_required');
  const requestId=txt(input.request_id,128)||`fop:${targetSite}:${op}:${nowNum(now)}`;
  const idempotencyKey=txt(input.idempotency_key,160)||requestId;
  const actor=normalizedActor(input.actor);
  const health=copy(input.federation_health??{});
  const access=copy(input.access??{});
  const fleet=copy(input.fleet_health??{});
  const local=siteId(input.local_site_id??health.local_site_id??fleet.local_site_id);
  const site=federationSite(health,targetSite);
  const peer=accessSite(access,targetSite);
  const fleetRow=fleetSite(fleet,targetSite);
  const deviceId=txt(input.device_id,80);
  const device=deviceId?deviceAt(fleetRow,deviceId):{};
  const isLocal=targetSite===local;
  const permitted=isLocal||!!peer.policy_peer_allowed;
  const revoked=!!peer.revoked||peer.consent_state==='revoked'||peer.policy_peer_allowed===false;
  const federationState=txt(site.state??'unknown',32).toLowerCase();
  const recoveryComplete=!!site.recovery_complete;
  const fresh=!!site.fresh;
  const current=federationState==='current'&&recoveryComplete&&fresh;
  const actorCanOperate=['user','owner','admin','system'].includes(actor.actor_type);
  const agentOnly=actor.actor_type==='agent';
  const reasons=[];
  if(!permitted)reasons.push('site_not_permitted');
  if(revoked)reasons.push('federation_access_revoked');
  if(!actorCanOperate&&!agentOnly)reasons.push('actor_not_authorized');
  if(agentOnly)reasons.push('agent_may_propose_only');
  if(['restart_runtime','request_update','revoke_device'].includes(op)&&!deviceId)reasons.push('device_required');
  if(deviceId&&!device?.device_id&&op!=='revoke_device')reasons.push('device_not_known');
  if(op==='revoke_site'&&targetSite===local)reasons.push('revoke_site_must_target_peer');
  if(op==='request_update'&&!['healthy','degraded','stale','recovering','unknown'].includes(txt(fleetRow.state,32).toLowerCase()))reasons.push('fleet_state_blocks_update');
  if(op==='transfer_authority'){
    if(!input.new_authority_device_id)reasons.push('new_authority_device_required');
    if(!input.confirmation_token)reasons.push('explicit_confirmation_required');
    if(!current)reasons.push('authority_transfer_requires_current_source');
    if(targetSite!==local)reasons.push('authority_transfer_must_be_origin_local');
  }
  const hardBlocks=reasons.filter(x=>x!=='agent_may_propose_only');
  const requiresApproval=HIGH_RISK.has(op)||agentOnly||input.require_approval===true;
  const executable=hardBlocks.length===0&&actorCanOperate;
  const state=hardBlocks.length?'rejected':requiresApproval?'awaiting_approval':'approved';
  const requiresReconciliation=['reconnect','reconcile','restart_runtime','transfer_authority'].includes(op);
  return {
    protocol:FEDERATION_GOVERNED_OPERATIONS_PROTOCOL,version:FEDERATION_GOVERNED_OPERATIONS_VERSION,schema_version:1,
    request_id:requestId,idempotency_key:idempotencyKey,operation_type:op,target_site_id:targetSite,device_id:deviceId||null,
    new_authority_device_id:txt(input.new_authority_device_id,80)||null,actor,state,executable,requires_approval:requiresApproval,
    requires_confirmation:op==='transfer_authority',requires_reconciliation:requiresReconciliation,
    reason_codes:reasons,requested_at_ms:nowNum(now),expires_at_ms:Math.max(nowNum(now)+60000,nowNum(input.expires_at_ms)||nowNum(now)+900000),
    federation_gate:{state:federationState,current,recovery_complete:recoveryComplete,fresh,section7_authoritative:true},
    safety:{cloud_execution_allowed:false,agent_execution_allowed:false,authority_transfer_automatic:false,reconnect_marks_recovered:false,completion_requires_authoritative_reconciliation:requiresReconciliation},
    audit:{immutable_request:true,actor_recorded:true,idempotency_enforced:true}
  };
}

export function appendFederationOperationEvent(ledger=[],event={},now=Date.now()){
  const rows=copy(ledger)||[];
  const requestId=txt(event.request_id,128); if(!requestId)throw new Error('request_id_required');
  const next=txt(event.state,40).toLowerCase(); if(!FEDERATION_OPERATION_STATES.includes(next))throw new Error('invalid_state');
  const idx=rows.findIndex(x=>txt(x.request_id,128)===requestId);
  if(idx<0)throw new Error('operation_not_found');
  const row=rows[idx]; const current=txt(row.state,40).toLowerCase();
  if(current===next)return rows;
  if(TERMINAL.has(current))throw new Error('terminal_operation');
  if(!TRANSITIONS[current]?.has(next))throw new Error('invalid_transition');
  if(next==='completed'&&row.requires_reconciliation){
    const rec=event.reconciliation??{};
    if(!(rec.state==='current'&&rec.recovery_complete===true&&rec.fresh===true))throw new Error('authoritative_reconciliation_required');
  }
  if(row.operation_type==='transfer_authority'&&next==='completed'){
    const before=Number(row.authority_epoch_before??event.authority_epoch_before??0);
    const after=Number(event.authority_epoch_after??0);
    if(!(after>before))throw new Error('authority_epoch_must_advance');
  }
  const at=nowNum(event.occurred_at_ms)||nowNum(now);
  rows[idx]={...row,state:next,updated_at_ms:at,last_event:{state:next,reason:txt(event.reason,240),occurred_at_ms:at},
    reconciliation:next==='completed'&&row.requires_reconciliation?copy(event.reconciliation):row.reconciliation??null,
    authority_epoch_after:event.authority_epoch_after??row.authority_epoch_after??null};
  return rows;
}

export function upsertFederationOperationRequest(ledger=[],request={}){
  const rows=copy(ledger)||[];
  const existing=rows.find(x=>txt(x.idempotency_key,160)===txt(request.idempotency_key,160));
  if(existing){
    const same=existing.operation_type===request.operation_type&&existing.target_site_id===request.target_site_id&&existing.device_id===request.device_id;
    if(!same)throw new Error('idempotency_conflict');
    return rows;
  }
  return [...rows,{...copy(request),authority_epoch_before:Number(request.authority_epoch_before??0),events:[{state:request.state,occurred_at_ms:request.requested_at_ms}]}];
}

export function federationOperationAgentContext(ledger=[]){
  const rows=arr(ledger);
  const active=rows.filter(x=>!TERMINAL.has(txt(x.state,40).toLowerCase()));
  return {
    protocol:FEDERATION_GOVERNED_OPERATIONS_PROTOCOL,
    active:active.map(x=>({request_id:x.request_id,operation_type:x.operation_type,target_site_id:x.target_site_id,state:x.state,requires_approval:!!x.requires_approval,requires_reconciliation:!!x.requires_reconciliation,reason_codes:arr(x.reason_codes)})).slice(0,32),
    pending_approvals:active.filter(x=>x.state==='awaiting_approval').length,
    agent_may_propose:true,agent_may_execute:false,cloud_may_execute:false,
    recovery_rule:'connectivity_or_command_success_never_implies_recovered_without_authoritative_reconciliation'
  };
}

export function federationGovernedOperationsCapability(){
  return {version:FEDERATION_GOVERNED_OPERATIONS_VERSION,protocol:FEDERATION_GOVERNED_OPERATIONS_PROTOCOL,
    operations:[...FEDERATION_OPERATION_TYPES],states:[...FEDERATION_OPERATION_STATES],
    idempotent_requests:true,monotonic_state_machine:true,durable_audit_required:true,approval_required_for_high_risk:true,operation_expiration:true,revocation_wins:true,
    agent_proposal_only:true,cloud_execution_allowed:false,authority_transfer_automatic:false,
    authority_transfer_requires_epoch_advance:true,completion_requires_authoritative_reconciliation:true,update_request_not_install:true,rollback_delegated_to_rollout_runtime:true,
    section7_health_is_authoritative:true};
}
