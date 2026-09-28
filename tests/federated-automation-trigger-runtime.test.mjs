import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFederatedAutomationDefinition } from '../src/federated-automation-core.js';
import { normalizePhysicalTriggerEvent,evaluatePhysicalTrigger,processPhysicalTriggerEvent,physicalTriggerCapability } from '../src/federated-automation-trigger-runtime.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const def=()=>normalizeFederatedAutomationDefinition({
  automation_id:'fa:arrival',idempotency_key:'fa:arrival',origin_site_id:HOME,state:'active',actor:{actor_type:'owner'},
  trigger:{kind:'presence',source_site_id:HOME,event_key:'person.arrived',debounce_ms:10000,config:{min_confidence:.8,conditions:[{field:'room_id',op:'eq',value:'kitchen'}]}},
  steps:[
    {step_id:'context',action_type:'data_operation',authority_site_id:HOME,target_site_id:HOME,action_key:'world.validate'},
    {step_id:'notify-office',action_type:'notification',authority_site_id:OFFICE,target_site_id:OFFICE,action_key:'notify',depends_on:['context']}
  ]
},1000);

const event=(overrides={})=>normalizePhysicalTriggerEvent({
  event_id:'evt-100',kind:'presence',event_key:'person.arrived',source_site_id:HOME,occurred_at_ms:20000,confidence:.92,room_id:'kitchen',
  world_state_fresh:true,reconciliation_current:true,...overrides
},{now_ms:20000});

test('accepts a fresh authoritative physical event and creates only a ledger run',()=>{
  const result=processPhysicalTriggerEvent([def()],event(),{receipts:[],last_triggered_at_ms:{}},{now_ms:20000});
  assert.equal(result.accepted,1);assert.equal(result.runs.length,1);
  assert.ok(['ready','waiting'].includes(result.runs[0].state));assert.equal(result.runs[0].safety.execution_enabled,false);
  assert.equal(result.runs[0].trigger_event_id,'evt-100');
});
test('stable event identity produces deterministic replay-safe run identity',()=>{
  const d=def();const a=evaluatePhysicalTrigger(d,event(),{receipts:[],last_triggered_at_ms:{}});
  const b=evaluatePhysicalTrigger(d,event(),{receipts:[],last_triggered_at_ms:{}});
  assert.equal(a.receipt_id,b.receipt_id);assert.equal(a.run_id,b.run_id);assert.equal(a.idempotency_key,b.idempotency_key);
});
test('fails closed on stale or reconciling world state',()=>{
  const d=def();
  assert.equal(evaluatePhysicalTrigger(d,event({world_state_fresh:false}),{}).reason,'stale_world_state');
  assert.equal(evaluatePhysicalTrigger(d,event({reconciliation_current:false}),{}).reason,'reconciliation_not_current');
});
test('enforces source site, confidence, conditions, debounce and dedupe',()=>{
  const d=def();
  assert.equal(evaluatePhysicalTrigger(d,event({source_site_id:OFFICE}),{}).reason,'wrong_source_site');
  assert.equal(evaluatePhysicalTrigger(d,event({confidence:.4}),{}).reason,'confidence_below_threshold');
  assert.equal(evaluatePhysicalTrigger(d,event({room_id:'garage'}),{}).reason,'conditions_not_met');
  const accepted=evaluatePhysicalTrigger(d,event(),{receipts:[],last_triggered_at_ms:{}});
  assert.equal(evaluatePhysicalTrigger(d,event(),{receipts:[accepted],last_triggered_at_ms:{}}).decision,'duplicate');
  assert.equal(evaluatePhysicalTrigger(d,event({event_id:'evt-101',occurred_at_ms:25000}),{receipts:[],last_triggered_at_ms:{'fa:arrival':20000}}).decision,'debounced');
});
test('supports wildcard event keys without weakening execution boundary',()=>{
  const d=normalizeFederatedAutomationDefinition({
    automation_id:'fa:object',idempotency_key:'fa:object',origin_site_id:HOME,state:'active',actor:{actor_type:'owner'},
    trigger:{kind:'world_state',source_site_id:HOME,event_key:'object.*',config:{min_confidence:.7}},
    steps:[{step_id:'record',action_type:'data_operation',authority_site_id:HOME,target_site_id:HOME,action_key:'world.record'}]
  },1000);
  const result=processPhysicalTriggerEvent([d],event({event_id:'evt-object',kind:'world_state',event_key:'object.moved',confidence:.88}),{});
  assert.equal(result.accepted,1);assert.equal(result.execution_enabled,false);
  assert.equal(physicalTriggerCapability().section,2);assert.equal(physicalTriggerCapability().execution_enabled,false);
});
