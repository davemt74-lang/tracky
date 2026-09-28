import { createHash } from 'node:crypto';
import { createFederatedAutomationRun, FEDERATED_AUTOMATION_PROTOCOL } from './federated-automation-core.js';

const txt=(v,n=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const clamp01=v=>Math.max(0,Math.min(1,num(v)));
const copy=v=>JSON.parse(JSON.stringify(v??null));
const uuid=v=>txt(v,64).toLowerCase();
const TERMINAL_DECISIONS=new Set(['accepted','duplicate','debounced','rejected']);
export const PHYSICAL_TRIGGER_PROTOCOL='physical_federated_trigger.v1';
export const PHYSICAL_TRIGGER_SECTION=2;
export const PHYSICAL_TRIGGER_KINDS=Object.freeze(['world_state','presence','device_state','event','schedule','manual']);

function stable(parts){return createHash('sha256').update(parts.join('|')).digest('hex');}
function assertId(v,label){const out=txt(v,160);if(!out||!/^[A-Za-z0-9._:-]+$/.test(out))throw new Error(label+'_invalid');return out;}
function assertSite(v,label){const out=uuid(v);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(out))throw new Error(label+'_invalid');return out;}

export function normalizePhysicalTriggerEvent(input={},options={}){
  const eventId=assertId(input.event_id??input.id,'event_id');
  const kind=txt(input.kind??input.trigger_kind??'event',40).toLowerCase();
  if(!PHYSICAL_TRIGGER_KINDS.includes(kind)||kind==='manual'||kind==='schedule')throw new Error('physical_event_kind_invalid');
  const sourceSite=assertSite(input.source_site_id??options.local_site_id,'source_site_id');
  const eventKey=txt(input.event_key??input.event_type,120).toLowerCase();
  if(!eventKey)throw new Error('event_key_required');
  const occurred=Math.max(0,num(input.occurred_at_ms??input.timestamp_ms??Date.now()));
  const current=Math.max(occurred,num(options.now_ms??occurred));
  const maxAge=Math.max(1000,num(options.max_age_ms)||300000);
  const age=Math.max(0,current-occurred);
  return {
    protocol:PHYSICAL_TRIGGER_PROTOCOL,section:PHYSICAL_TRIGGER_SECTION,
    event_id:eventId,kind,event_key:eventKey,source_site_id:sourceSite,
    occurred_at_ms:occurred,sequence:Math.max(0,Math.trunc(num(input.sequence))),
    confidence:clamp01(input.confidence??1),
    subject_id:txt(input.subject_id,128)||null,object_id:txt(input.object_id,128)||null,
    room_id:txt(input.room_id,128)||null,device_id:txt(input.device_id,128)||null,
    value:copy(input.value??null),attributes:copy(input.attributes??{}),
    world_state_fresh:input.world_state_fresh!==false && age<=maxAge,
    reconciliation_current:input.reconciliation_current!==false,
    authority_epoch:Math.max(0,Math.trunc(num(input.authority_epoch))),
    age_ms:age,max_age_ms:maxAge
  };
}

function readField(event,path){
  if(!path)return undefined;
  const parts=String(path).split('.');
  let value=event;
  for(const part of parts){if(value==null||typeof value!=='object')return undefined;value=value[part];}
  return value;
}
function compare(actual,op,expected){
  if(op==='eq')return actual===expected;
  if(op==='neq')return actual!==expected;
  if(op==='in')return Array.isArray(expected)&&expected.includes(actual);
  if(op==='contains')return Array.isArray(actual)?actual.includes(expected):String(actual??'').includes(String(expected??''));
  const a=Number(actual),b=Number(expected);
  if(!Number.isFinite(a)||!Number.isFinite(b))return false;
  if(op==='gt')return a>b;if(op==='gte')return a>=b;if(op==='lt')return a<b;if(op==='lte')return a<=b;
  return false;
}
function conditionsPass(event,conditions=[]){
  if(!Array.isArray(conditions))return true;
  return conditions.slice(0,32).every(c=>c&&compare(readField(event,txt(c.field,120)),txt(c.op??'eq',16).toLowerCase(),c.value));
}
function eventKeyMatches(trigger,event){
  const configured=[trigger.event_key,...(Array.isArray(trigger.config?.event_keys)?trigger.config.event_keys:[])].map(x=>txt(x,120).toLowerCase()).filter(Boolean);
  if(!configured.length)return true;
  return configured.some(key=>key===event.event_key || (key.endsWith('.*')&&event.event_key.startsWith(key.slice(0,-1))));
}

export function evaluatePhysicalTrigger(definition,eventInput,state={},options={}){
  if(definition?.protocol!==FEDERATED_AUTOMATION_PROTOCOL)throw new Error('automation_protocol_invalid');
  const trigger=definition.trigger??{};
  const kind=txt(trigger.kind,40).toLowerCase();
  if(!['world_state','presence','device_state','event'].includes(kind))return {accepted:false,decision:'rejected',reason:'non_physical_trigger_kind'};
  const event=eventInput?.protocol===PHYSICAL_TRIGGER_PROTOCOL?eventInput:normalizePhysicalTriggerEvent(eventInput,options);
  const receiptId='ptr:'+stable([definition.automation_id,String(definition.revision),event.event_id]).slice(0,40);
  const base={protocol:PHYSICAL_TRIGGER_PROTOCOL,section:PHYSICAL_TRIGGER_SECTION,receipt_id:receiptId,automation_id:definition.automation_id,automation_revision:definition.revision,event_id:event.event_id,event_key:event.event_key,source_site_id:event.source_site_id,occurred_at_ms:event.occurred_at_ms};
  if(definition.state!=='active')return {...base,accepted:false,decision:'rejected',reason:'automation_not_active'};
  if(uuid(trigger.source_site_id)!==event.source_site_id)return {...base,accepted:false,decision:'rejected',reason:'wrong_source_site'};
  if(!eventKeyMatches(trigger,event))return {...base,accepted:false,decision:'rejected',reason:'event_key_mismatch'};
  const minConfidence=clamp01(trigger.config?.min_confidence??0);
  if(event.confidence<minConfidence)return {...base,accepted:false,decision:'rejected',reason:'confidence_below_threshold',min_confidence:minConfidence};
  if(trigger.requires_fresh_world_state&&(!event.world_state_fresh||!event.reconciliation_current))return {...base,accepted:false,decision:'rejected',reason:event.reconciliation_current?'stale_world_state':'reconciliation_not_current'};
  if(!conditionsPass(event,trigger.config?.conditions))return {...base,accepted:false,decision:'rejected',reason:'conditions_not_met'};
  const receipts=Array.isArray(state.receipts)?state.receipts:[];
  const prior=receipts.find(x=>x.receipt_id===receiptId || (x.automation_id===definition.automation_id&&x.event_id===event.event_id));
  if(prior)return {...base,accepted:false,decision:'duplicate',reason:'event_already_processed',run_id:prior.run_id??null};
  const debounce=Math.max(0,num(trigger.debounce_ms));
  const last=Math.max(0,num(state.last_triggered_at_ms?.[definition.automation_id]));
  if(debounce&&event.occurred_at_ms-last<debounce)return {...base,accepted:false,decision:'debounced',reason:'debounce_window',retry_after_ms:debounce-(event.occurred_at_ms-last)};
  const idem='ptr-run:'+stable([definition.automation_id,String(definition.revision),event.event_id]).slice(0,48);
  return {...base,accepted:true,decision:'accepted',reason:'matched',idempotency_key:idem,run_id:'far-'+stable([idem]).slice(0,32),confidence:event.confidence};
}

export function processPhysicalTriggerEvent(definitions=[],eventInput,state={},options={}){
  const event=eventInput?.protocol===PHYSICAL_TRIGGER_PROTOCOL?eventInput:normalizePhysicalTriggerEvent(eventInput,options);
  const decisions=[],runs=[];
  for(const definition of definitions){
    const decision=evaluatePhysicalTrigger(definition,event,state,options);
    decisions.push(decision);
    if(!decision.accepted)continue;
    const run=createFederatedAutomationRun(definition,{run_id:decision.run_id,idempotency_key:decision.idempotency_key,trigger_event_id:event.event_id},event.occurred_at_ms);
    if(run.state==='running')throw new Error('section2_execution_boundary_breached');
    runs.push(run);
  }
  return {
    protocol:PHYSICAL_TRIGGER_PROTOCOL,section:PHYSICAL_TRIGGER_SECTION,event,
    decisions,runs,
    accepted:decisions.filter(x=>x.accepted).length,
    rejected:decisions.filter(x=>x.decision==='rejected').length,
    duplicates:decisions.filter(x=>x.decision==='duplicate').length,
    debounced:decisions.filter(x=>x.decision==='debounced').length,
    execution_enabled:false,authoritative_homeserver_required:true
  };
}

export function physicalTriggerCapability(){
  return {
    protocol:PHYSICAL_TRIGGER_PROTOCOL,version:'2.81',section:PHYSICAL_TRIGGER_SECTION,
    trigger_kinds:['world_state','presence','device_state','event'],
    canonical_event_identity:true,confidence_gates:true,condition_gates:true,
    freshness_gate:true,reconciliation_gate:true,debounce:true,idempotent_receipts:true,
    creates_durable_runs:true,execution_enabled:false,cloud_execution_allowed:false,
    agent_execution_allowed:false,origin_homeserver_authoritative:true
  };
}
