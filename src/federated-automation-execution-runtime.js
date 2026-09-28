import {createHash} from 'node:crypto';
import {FEDERATED_AUTOMATION_PROTOCOL} from './federated-automation-core.js';

export const FEDERATED_EXECUTION_PROTOCOL='physical_federated_execution.v1';
export const FEDERATED_EXECUTION_SECTION=3;
const txt=(v,n=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
const num=v=>Math.max(0,Number(v)||0);
const copy=v=>JSON.parse(JSON.stringify(v??null));
const hash=parts=>createHash('sha256').update(parts.join('|')).digest('hex');
const terminal=new Set(['completed','failed','cancelled','expired']);

function stepDefinition(definition,stepId){
  const step=(definition.steps||[]).find(x=>x.step_id===stepId);
  if(!step)throw new Error('step_definition_not_found');
  return step;
}
function stepRun(run,stepId){
  const step=(run.steps||[]).find(x=>x.step_id===stepId);
  if(!step)throw new Error('step_run_not_found');
  return step;
}
export function createExecutionDispatch(definition,run,stepId,context={}){
  if(definition?.protocol!==FEDERATED_AUTOMATION_PROTOCOL||run?.protocol!==FEDERATED_AUTOMATION_PROTOCOL)throw new Error('automation_protocol_invalid');
  if(run.automation_id!==definition.automation_id||Number(run.automation_revision)!==Number(definition.revision))throw new Error('automation_revision_mismatch');
  if(terminal.has(run.state))throw new Error('terminal_run');
  const spec=stepDefinition(definition,stepId),state=stepRun(run,stepId);
  if(state.state!=='ready')throw new Error('step_not_ready');
  const epoch=Math.max(1,Math.trunc(num(context.authority_epoch)));
  const attempt=Math.max(1,Number(state.attempt||0)+1);
  const dispatchId='fad-'+hash([run.run_id,stepId,String(attempt),spec.authority_site_id,String(epoch)]).slice(0,40);
  return {
    protocol:FEDERATED_EXECUTION_PROTOCOL,section:FEDERATED_EXECUTION_SECTION,
    dispatch_id:dispatchId,run_id:run.run_id,automation_id:definition.automation_id,automation_revision:definition.revision,
    step_id:stepId,attempt,origin_site_id:definition.origin_site_id,
    authority_site_id:spec.authority_site_id,target_site_id:spec.target_site_id,authority_epoch:epoch,
    device_id:spec.device_id,action_type:spec.action_type,action_key:spec.action_key,arguments:copy(spec.arguments||{}),
    required_permissions:copy(spec.required_permissions||[]),approval_mode:spec.approval_mode,
    approval_id:txt(context.approval_id,160)||null,issued_at_ms:num(context.now_ms)||Date.now(),
    deadline_at_ms:num(state.deadline_at_ms),idempotency_key:'exec:'+hash([run.run_id,stepId,String(attempt)]).slice(0,48),
    safety:{cloud_execution_allowed:false,agent_execution_allowed:false,authoritative_homeserver_only:true}
  };
}
export function admitExecutionDispatch(dispatch,context={}){
  if(dispatch?.protocol!==FEDERATED_EXECUTION_PROTOCOL)throw new Error('execution_protocol_invalid');
  const now=num(context.now_ms)||Date.now();
  if(txt(context.local_site_id,64).toLowerCase()!==dispatch.authority_site_id)throw new Error('wrong_authority_site');
  if(txt(context.authority_device_id,100)!==txt(context.local_device_id,100))throw new Error('not_current_authority_device');
  if(Number(context.authority_epoch)!==Number(dispatch.authority_epoch))throw new Error('authority_epoch_mismatch');
  if(context.device_trusted!==true)throw new Error('authority_device_not_trusted');
  if(context.reconciliation_current!==true)throw new Error('reconciliation_not_current');
  if(context.revoked===true)throw new Error('revocation_wins');
  if(dispatch.deadline_at_ms&&now>dispatch.deadline_at_ms)throw new Error('dispatch_expired');
  const grants=new Set(Array.isArray(context.permission_grants)?context.permission_grants:[]);
  for(const scope of dispatch.required_permissions||[])if(!grants.has(scope))throw new Error('permission_denied');
  if(dispatch.action_type==='physical_action'&&dispatch.approval_mode!=='inherit'&&!dispatch.approval_id)throw new Error('physical_action_approval_required');
  return {...copy(dispatch),admitted:true,admitted_at_ms:now,executor_site_id:context.local_site_id,executor_device_id:context.local_device_id};
}
export function createExecutionReceipt(dispatch,result={},context={}){
  if(dispatch?.protocol!==FEDERATED_EXECUTION_PROTOCOL)throw new Error('execution_protocol_invalid');
  const status=txt(result.status??(result.ok===false?'failed':'completed'),30).toLowerCase();
  if(!['completed','failed'].includes(status))throw new Error('execution_result_invalid');
  return {
    protocol:FEDERATED_EXECUTION_PROTOCOL,section:FEDERATED_EXECUTION_SECTION,
    receipt_id:'fer-'+hash([dispatch.dispatch_id,status,txt(result.execution_id,160)]).slice(0,40),
    dispatch_id:dispatch.dispatch_id,idempotency_key:dispatch.idempotency_key,run_id:dispatch.run_id,step_id:dispatch.step_id,
    attempt:dispatch.attempt,authority_site_id:dispatch.authority_site_id,authority_epoch:dispatch.authority_epoch,
    status,execution_id:txt(result.execution_id,160)||null,error:status==='failed'?txt(result.error,500):null,
    result:copy(result.result??{}),completed_at_ms:num(context.now_ms)||Date.now()
  };
}
export function applyExecutionReceipt(run,receipt){
  const out=copy(run); const step=stepRun(out,receipt.step_id);
  if(step.dispatch_id&&step.dispatch_id!==receipt.dispatch_id)throw new Error('dispatch_receipt_mismatch');
  if(terminal.has(step.state)&&step.state!==receipt.status)throw new Error('terminal_step');
  step.dispatch_id=receipt.dispatch_id;step.attempt=Math.max(Number(step.attempt||0),Number(receipt.attempt||0));
  step.state=receipt.status;step.last_error=receipt.error;step.updated_at_ms=receipt.completed_at_ms;
  for(const candidate of out.steps){
    if(candidate.state==='blocked'&&candidate.depends_on.every(dep=>out.steps.find(x=>x.step_id===dep)?.state==='completed'))candidate.state='ready';
  }
  if(out.steps.every(x=>x.state==='completed'))out.state='completed';
  else if(out.steps.some(x=>x.state==='failed'))out.state='failed';
  else if(out.steps.some(x=>x.state==='ready'))out.state='running';
  else out.state='waiting';
  out.updated_at_ms=receipt.completed_at_ms;
  out.safety={...out.safety,execution_enabled:true,cloud_execution_allowed:false,agent_execution_allowed:false,authoritative_homeserver_required:true};
  return out;
}
export function federatedExecutionCapability(){
 return {protocol:FEDERATED_EXECUTION_PROTOCOL,version:'2.81',section:3,distributed_dispatch:true,authority_epoch_bound:true,
   permission_gated:true,approval_gated_physical_actions:true,revocation_wins:true,reconciliation_required:true,replay_safe:true,
   durable_receipts:true,cloud_execution_allowed:false,agent_execution_allowed:false,authoritative_homeserver_only:true};
}
