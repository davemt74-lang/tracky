const copy=v=>JSON.parse(JSON.stringify(v??null));
const arr=v=>Array.isArray(v)?v:[];
const txt=(v,max=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const siteId=v=>txt(v,64).toLowerCase();
const num=v=>Math.max(0,Number(v)||0);
const unique=v=>[...new Set(arr(v).map(x=>txt(x,160)).filter(Boolean))];

export const FEDERATED_AUTOMATION_PROTOCOL='physical_federated_automation.v1';
export const FEDERATED_AUTOMATION_VERSION='2.81';
export const AUTOMATION_STATES=Object.freeze(['draft','active','paused','retired']);
export const RUN_STATES=Object.freeze(['planned','waiting','ready','running','blocked','recovering','completed','failed','cancelled','expired']);
export const STEP_STATES=Object.freeze(['pending','blocked','ready','running','completed','failed','cancelled','expired']);
export const TRIGGER_KINDS=Object.freeze(['manual','schedule','world_state','device_state','presence','event']);
export const ACTION_TYPES=Object.freeze(['physical_action','local_routine','agent_workflow','notification','data_operation']);

const RUN_TERMINAL=new Set(['completed','failed','cancelled','expired']);
const STEP_TERMINAL=new Set(['completed','failed','cancelled','expired']);
const STEP_TRANSITIONS={
 pending:new Set(['blocked','ready','cancelled','expired','failed']),
 blocked:new Set(['ready','cancelled','expired','failed']),
 ready:new Set(['running','blocked','cancelled','expired','failed']),
 running:new Set(['completed','failed','cancelled','expired']),
 completed:new Set(),failed:new Set(),cancelled:new Set(),expired:new Set()
};
const RUN_TRANSITIONS={
 planned:new Set(['waiting','ready','blocked','cancelled','expired','failed']),
 waiting:new Set(['ready','blocked','recovering','cancelled','expired','failed']),
 ready:new Set(['running','blocked','recovering','cancelled','expired','failed']),
 running:new Set(['waiting','blocked','recovering','completed','cancelled','expired','failed']),
 blocked:new Set(['waiting','ready','recovering','cancelled','expired','failed']),
 recovering:new Set(['waiting','ready','blocked','cancelled','expired','failed']),
 completed:new Set(),failed:new Set(),cancelled:new Set(),expired:new Set()
};

function id(v,label,max=128){
  const out=txt(v,max);
  if(!out)throw new Error(label+'_required');
  if(!/^[a-zA-Z0-9._:-]+$/.test(out))throw new Error(label+'_invalid');
  return out;
}
function uuidLike(v,label){
  const out=siteId(v);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(out))throw new Error(label+'_invalid');
  return out;
}
function simpleStableId(value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const ch of String(value||'')){const c=ch.codePointAt(0);h1=Math.imul(h1^c,16777619)>>>0;h2=Math.imul(h2^c,2246822519)>>>0;}
  return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0')+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
function normalizedActor(v={}){
  return {actor_id:txt(v.actor_id??v.id,100),actor_type:txt(v.actor_type??v.type??'user',30).toLowerCase(),display_name:txt(v.display_name??v.label,120)};
}
function normalizeTrigger(v={},originSite){
  const kind=txt(v.kind??'manual',40).toLowerCase();
  if(!TRIGGER_KINDS.includes(kind))throw new Error('trigger_kind_invalid');
  const sourceSite=uuidLike(v.source_site_id??originSite,'trigger_source_site');
  return {
    kind,source_site_id:sourceSite,event_key:txt(v.event_key,120)||null,
    config:copy(v.config??{}),debounce_ms:Math.min(86400000,num(v.debounce_ms)),
    requires_fresh_world_state:['world_state','device_state','presence'].includes(kind)
  };
}
function normalizeStep(step,index,originSite){
  if(!step||typeof step!=='object')throw new Error('step_invalid');
  const stepId=id(step.step_id??('step-'+String(index+1)),'step_id',80);
  const actionType=txt(step.action_type,40).toLowerCase();
  if(!ACTION_TYPES.includes(actionType))throw new Error('action_type_invalid');
  const authoritySite=uuidLike(step.authority_site_id??step.site_id??originSite,'authority_site_id');
  const targetSite=uuidLike(step.target_site_id??authoritySite,'target_site_id');
  const permissions=unique(step.required_permissions);
  if(actionType==='physical_action'&&permissions.length===0)throw new Error('physical_action_permission_required');
  const approvalMode=txt(step.approval_mode??'governed',30).toLowerCase();
  if(!['governed','always','inherit'].includes(approvalMode))throw new Error('approval_mode_invalid');
  return {
    step_id:stepId,label:txt(step.label,120)||stepId,action_type:actionType,
    authority_site_id:authoritySite,target_site_id:targetSite,device_id:txt(step.device_id,100)||null,
    action_key:id(step.action_key??step.command??actionType,'action_key',120),arguments:copy(step.arguments??{}),
    depends_on:unique(step.depends_on),required_permissions:permissions,approval_mode:approvalMode,
    timeout_ms:Math.min(3600000,Math.max(1000,num(step.timeout_ms)||60000)),
    deadline_offset_ms:Math.min(604800000,num(step.deadline_offset_ms)),
    retry_policy:{max_attempts:Math.min(10,Math.max(1,Number(step.retry_policy?.max_attempts)||1)),backoff_ms:Math.min(3600000,num(step.retry_policy?.backoff_ms))},
    reversible:step.reversible===true,compensating_action:step.compensating_action?copy(step.compensating_action):null,
    execution_contract:'authoritative_homeserver_only'
  };
}
function assertDag(steps){
  const ids=new Set(steps.map(x=>x.step_id));
  if(ids.size!==steps.length)throw new Error('duplicate_step_id');
  for(const step of steps){
    for(const dep of step.depends_on){
      if(dep===step.step_id)throw new Error('self_dependency');
      if(!ids.has(dep))throw new Error('dependency_not_found');
    }
  }
  const visiting=new Set(),visited=new Set(),byId=new Map(steps.map(x=>[x.step_id,x]));
  function visit(stepId){
    if(visiting.has(stepId))throw new Error('dependency_cycle');
    if(visited.has(stepId))return;
    visiting.add(stepId);
    for(const dep of byId.get(stepId).depends_on)visit(dep);
    visiting.delete(stepId);visited.add(stepId);
  }
  for(const step of steps)visit(step.step_id);
}

export function normalizeFederatedAutomationDefinition(input={},now=Date.now()){
  const origin=uuidLike(input.origin_site_id,'origin_site_id');
  const actor=normalizedActor(input.actor);
  const actorAllowed=['user','owner','admin','system'].includes(actor.actor_type);
  if(actor.actor_type==='agent')throw new Error('agent_may_propose_only');
  if(!actorAllowed)throw new Error('actor_not_authorized');
  const explicitAutomation=txt(input.automation_id,128),explicitIdempotency=txt(input.idempotency_key,160);
  if(!explicitAutomation&&!explicitIdempotency)throw new Error('automation_identity_required');
  const automationId=id(explicitAutomation||('fa-'+simpleStableId(explicitIdempotency)),'automation_id',128);
  const revision=Math.max(1,Number(input.revision)||1);
  const state=txt(input.state??'draft',30).toLowerCase();
  if(!AUTOMATION_STATES.includes(state))throw new Error('automation_state_invalid');
  const steps=arr(input.steps).map((s,i)=>normalizeStep(s,i,origin));
  if(steps.length<1||steps.length>64)throw new Error('step_count_invalid');
  assertDag(steps);
  const sites=new Set([origin]);
  const devices=new Set();
  for(const step of steps){sites.add(step.authority_site_id);sites.add(step.target_site_id);if(step.device_id)devices.add(step.device_id);}
  for(const s of arr(input.participating_site_ids))sites.add(uuidLike(s,'participating_site_id'));
  for(const d of arr(input.participating_device_ids))if(txt(d,100))devices.add(txt(d,100));
  const deadlineMs=Math.min(2592000000,num(input.default_deadline_ms));
  return {
    protocol:FEDERATED_AUTOMATION_PROTOCOL,version:FEDERATED_AUTOMATION_VERSION,schema_version:1,
    automation_id:automationId,revision,name:txt(input.name,160)||automationId,description:txt(input.description,1000),
    origin_site_id:origin,state,trigger:normalizeTrigger(input.trigger??{},origin),steps,
    participating_site_ids:[...sites].sort(),participating_device_ids:[...devices].sort(),
    approval_policy:txt(input.approval_policy??'governed',30).toLowerCase(),
    default_deadline_ms:deadlineMs,idempotency_key:id(input.idempotency_key??automationId,'idempotency_key',160),
    actor,created_at_ms:num(input.created_at_ms)||num(now),updated_at_ms:num(now),
    safety:{
      execution_enabled:false,cloud_execution_allowed:false,agent_execution_allowed:false,
      origin_homeserver_authoritative:true,step_authority_site_required:true,permissions_required:true,
      federation_v280_invariants_required:true
    }
  };
}

function initialStepState(step){
  return step.depends_on.length?'blocked':'ready';
}
export function createFederatedAutomationRun(definition={},input={},now=Date.now()){
  if(definition.protocol!==FEDERATED_AUTOMATION_PROTOCOL)throw new Error('automation_protocol_invalid');
  if(definition.state!=='active')throw new Error('automation_not_runnable');
  const explicitRun=txt(input.run_id,160),explicitIdem=txt(input.idempotency_key,160);
  if(!explicitRun&&!explicitIdem)throw new Error('run_identity_required');
  const runId=id(explicitRun||('far-'+simpleStableId(explicitIdem)),'run_id',160);
  const idem=id(explicitIdem||runId,'idempotency_key',160);
  const deadlineAt=num(input.deadline_at_ms)||(definition.default_deadline_ms?num(now)+definition.default_deadline_ms:0);
  const steps=definition.steps.map(step=>({
    step_id:step.step_id,state:initialStepState(step),attempt:0,authority_site_id:step.authority_site_id,target_site_id:step.target_site_id,
    device_id:step.device_id,required_permissions:copy(step.required_permissions),depends_on:copy(step.depends_on),deadline_at_ms:step.deadline_offset_ms?num(now)+step.deadline_offset_ms:deadlineAt,
    last_error:null,dispatch_id:null,updated_at_ms:num(now)
  }));
  return {
    protocol:FEDERATED_AUTOMATION_PROTOCOL,version:FEDERATED_AUTOMATION_VERSION,schema_version:1,
    run_id:runId,idempotency_key:idem,automation_id:definition.automation_id,automation_revision:definition.revision,
    origin_site_id:definition.origin_site_id,trigger_event_id:txt(input.trigger_event_id,160)||null,
    state:steps.every(x=>x.state==='ready')?'ready':'waiting',deadline_at_ms:deadlineAt,
    steps,created_at_ms:num(now),updated_at_ms:num(now),last_event:null,
    recovery:{durable:true,resume_required:false,last_checkpoint_ms:num(now)},
    safety:{execution_enabled:false,cloud_execution_allowed:false,agent_execution_allowed:false,authoritative_homeserver_required:true}
  };
}

export function upsertAutomationRun(ledger=[],run={}){
  const rows=copy(ledger)||[];
  const existing=rows.find(x=>txt(x.idempotency_key,160)===txt(run.idempotency_key,160));
  if(existing){
    const same=existing.automation_id===run.automation_id&&existing.automation_revision===run.automation_revision&&existing.origin_site_id===run.origin_site_id&&existing.trigger_event_id===run.trigger_event_id&&Number(existing.deadline_at_ms||0)===Number(run.deadline_at_ms||0);
    if(!same)throw new Error('idempotency_conflict');
    return rows;
  }
  return [...rows,copy(run)];
}

export function appendAutomationRunEvent(ledger=[],event={},now=Date.now()){
  const rows=copy(ledger)||[];
  const runId=id(event.run_id,'run_id',160);
  const idx=rows.findIndex(x=>x.run_id===runId);
  if(idx<0)throw new Error('run_not_found');
  const row=rows[idx];
  const next=txt(event.state,30).toLowerCase();
  if(!RUN_STATES.includes(next))throw new Error('run_state_invalid');
  if(row.state!==next){
    if(RUN_TERMINAL.has(row.state))throw new Error('terminal_run');
    if(!RUN_TRANSITIONS[row.state]?.has(next))throw new Error('invalid_run_transition');
  }
  if(['running','completed'].includes(next)&&row.safety?.execution_enabled!==true)throw new Error('section1_execution_disabled');
  const at=num(event.occurred_at_ms)||num(now);
  rows[idx]={...row,state:next,updated_at_ms:at,last_event:{state:next,reason:txt(event.reason,240),occurred_at_ms:at},
    recovery:{...row.recovery,resume_required:next==='recovering',last_checkpoint_ms:at}};
  return rows;
}

export function appendAutomationStepEvent(run={},event={},now=Date.now()){
  const copyRun=copy(run);
  const stepId=id(event.step_id,'step_id',80);
  const step=copyRun.steps.find(x=>x.step_id===stepId);
  if(!step)throw new Error('step_not_found');
  const next=txt(event.state,30).toLowerCase();
  if(!STEP_STATES.includes(next))throw new Error('step_state_invalid');
  if(STEP_TERMINAL.has(step.state)&&step.state!==next)throw new Error('terminal_step');
  if(step.state!==next&&!STEP_TRANSITIONS[step.state]?.has(next))throw new Error('invalid_step_transition');
  if(['running','completed'].includes(next)&&copyRun.safety?.execution_enabled!==true)throw new Error('section1_execution_disabled');
  if(next==='running'&&event.authoritative_homeserver!==true)throw new Error('authoritative_homeserver_required');
  if(next==='running'&&event.permissions_granted!==true)throw new Error('permissions_required');
  step.state=next;step.updated_at_ms=num(event.occurred_at_ms)||num(now);
  step.last_error=next==='failed'?txt(event.error,500):null;
  step.dispatch_id=txt(event.dispatch_id,160)||step.dispatch_id;
  if(next==='running')step.attempt=Math.max(0,Number(step.attempt)||0)+1;
  for(const candidate of copyRun.steps){
    if(candidate.state==='blocked'&&candidate.depends_on.every(dep=>copyRun.steps.find(x=>x.step_id===dep)?.state==='completed'))candidate.state='ready';
  }
  copyRun.updated_at_ms=step.updated_at_ms;
  return copyRun;
}

export function federatedAutomationAgentContext(definitions=[],runs=[]){
  const activeRuns=arr(runs).filter(x=>!RUN_TERMINAL.has(txt(x.state,30).toLowerCase()));
  return {
    protocol:FEDERATED_AUTOMATION_PROTOCOL,version:FEDERATED_AUTOMATION_VERSION,
    definitions:arr(definitions).filter(x=>x.state!=='retired').slice(0,32).map(x=>({automation_id:x.automation_id,revision:x.revision,name:x.name,state:x.state,origin_site_id:x.origin_site_id,participating_site_ids:x.participating_site_ids})),
    active_runs:activeRuns.slice(0,32).map(x=>({run_id:x.run_id,automation_id:x.automation_id,state:x.state,origin_site_id:x.origin_site_id,deadline_at_ms:x.deadline_at_ms})),
    agent_may_propose:true,agent_may_activate:false,agent_may_execute:false,cloud_may_execute:false,
    execution_phase:'future_v281_distributed_execution'
  };
}

export function federatedAutomationCapability(){
  return {
    protocol:FEDERATED_AUTOMATION_PROTOCOL,version:FEDERATED_AUTOMATION_VERSION,section:1,
    automation_states:[...AUTOMATION_STATES],run_states:[...RUN_STATES],step_states:[...STEP_STATES],
    trigger_kinds:[...TRIGGER_KINDS],action_types:[...ACTION_TYPES],
    durable_action_ledger:true,immutable_audit_events:true,idempotent_runs:true,dag_dependencies:true,
    deadlines:true,cancellation:true,recovery_state:true,per_step_authority:true,per_step_permissions:true,
    execution_enabled:false,cloud_execution_allowed:false,agent_execution_allowed:false,origin_homeserver_authoritative:true,
    federation_v280_invariants_required:true
  };
}
