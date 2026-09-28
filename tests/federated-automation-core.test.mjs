import test from 'node:test';
import assert from 'node:assert/strict';
import {
 normalizeFederatedAutomationDefinition,createFederatedAutomationRun,upsertAutomationRun,
 appendAutomationRunEvent,appendAutomationStepEvent,federatedAutomationAgentContext,federatedAutomationCapability
} from '../src/federated-automation-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const owner={actor_id:'u1',actor_type:'owner'};
const def=()=>normalizeFederatedAutomationDefinition({
 automation_id:'fa:morning-open',revision:1,idempotency_key:'fa:morning-open',name:'Morning Open',
 origin_site_id:HOME,state:'active',actor:owner,
 trigger:{kind:'world_state',source_site_id:HOME,event_key:'room.occupied'},
 steps:[
  {step_id:'home-check',action_type:'data_operation',authority_site_id:HOME,target_site_id:HOME,action_key:'world.validate',required_permissions:['semantic_world_read']},
  {step_id:'office-light',action_type:'physical_action',authority_site_id:OFFICE,target_site_id:OFFICE,device_id:'node-office',action_key:'light.on',required_permissions:['device_control'],depends_on:['home-check']}
 ]
},1000);

test('normalizes a governed cross-site automation DAG',()=>{
 const d=def();assert.equal(d.protocol,'physical_federated_automation.v1');assert.equal(d.version,'2.81');
 assert.deepEqual(d.participating_site_ids.sort(),[HOME,OFFICE].sort());assert.equal(d.steps[1].depends_on[0],'home-check');
 assert.equal(d.safety.execution_enabled,false);assert.equal(d.safety.origin_homeserver_authoritative,true);
});
test('rejects dependency cycles and unpermitted physical actions',()=>{
 assert.throws(()=>normalizeFederatedAutomationDefinition({automation_id:'fa:cycle',origin_site_id:HOME,actor:owner,steps:[
  {step_id:'a',action_type:'data_operation',authority_site_id:HOME,action_key:'a',depends_on:['b']},
  {step_id:'b',action_type:'data_operation',authority_site_id:HOME,action_key:'b',depends_on:['a']}
 ]}),/dependency_cycle/);
 assert.throws(()=>normalizeFederatedAutomationDefinition({automation_id:'fa:no-permission',origin_site_id:HOME,actor:owner,steps:[
  {step_id:'a',action_type:'physical_action',authority_site_id:HOME,action_key:'light.on'}
 ]}),/physical_action_permission_required/);
});
test('stable identities are required for replay-safe definitions and runs',()=>{
 assert.throws(()=>normalizeFederatedAutomationDefinition({origin_site_id:HOME,actor:owner,steps:[{step_id:'a',action_type:'data_operation',authority_site_id:HOME,action_key:'x'}]}),/automation_identity_required/);
 const d=normalizeFederatedAutomationDefinition({idempotency_key:'auto-only',origin_site_id:HOME,state:'active',actor:owner,steps:[{step_id:'a',action_type:'data_operation',authority_site_id:HOME,action_key:'x'}]},1000);
 assert.equal(d.automation_id,normalizeFederatedAutomationDefinition({idempotency_key:'auto-only',origin_site_id:HOME,state:'active',actor:owner,steps:[{step_id:'a',action_type:'data_operation',authority_site_id:HOME,action_key:'x'}]},2000).automation_id);
 assert.throws(()=>createFederatedAutomationRun(d,{},2000),/run_identity_required/);
 assert.equal(createFederatedAutomationRun(d,{idempotency_key:'run-only'},2000).run_id,createFederatedAutomationRun(d,{idempotency_key:'run-only'},3000).run_id);
});
test('agent may not create authoritative definitions',()=>{
 assert.throws(()=>normalizeFederatedAutomationDefinition({origin_site_id:HOME,actor:{actor_type:'agent'},steps:[
  {step_id:'a',action_type:'data_operation',authority_site_id:HOME,action_key:'x'}
 ]}),/agent_may_propose_only/);
});
test('run ledger is idempotent and durable',()=>{
 const d=def();const r=createFederatedAutomationRun(d,{run_id:'run-1',idempotency_key:'idem-1'},2000);
 assert.equal(r.state,'waiting');assert.equal(r.steps.find(x=>x.step_id==='home-check').state,'ready');
 assert.equal(r.steps.find(x=>x.step_id==='office-light').state,'blocked');assert.equal(r.recovery.durable,true);
 let ledger=upsertAutomationRun([],r);ledger=upsertAutomationRun(ledger,{...r,run_id:'run-2'});assert.equal(ledger.length,1);
 assert.throws(()=>upsertAutomationRun(ledger,{...r,automation_id:'different'}),/idempotency_conflict/);assert.throws(()=>upsertAutomationRun(ledger,{...r,trigger_event_id:'changed'}),/idempotency_conflict/);
});
test('Section 1 cannot claim run or step execution/completion',()=>{
 const r=createFederatedAutomationRun(def(),{run_id:'run-exec'},2000);
 assert.throws(()=>appendAutomationRunEvent([r],{run_id:'run-exec',state:'running'},2050),/section1_execution_disabled/);
 assert.throws(()=>appendAutomationStepEvent(r,{step_id:'home-check',state:'running',authoritative_homeserver:true,permissions_granted:true},2100),/section1_execution_disabled/);
 assert.throws(()=>appendAutomationStepEvent(r,{step_id:'home-check',state:'completed'},2200),/invalid_step_transition|section1_execution_disabled/);
});
test('run state supports cancellation, recovery and terminal immutability',()=>{
 const r=createFederatedAutomationRun(def(),{run_id:'run-state'},2000);let l=[r];
 l=appendAutomationRunEvent(l,{run_id:'run-state',state:'recovering'},2100);assert.equal(l[0].recovery.resume_required,true);
 l=appendAutomationRunEvent(l,{run_id:'run-state',state:'cancelled'},2200);assert.throws(()=>appendAutomationRunEvent(l,{run_id:'run-state',state:'ready'},2300),/terminal_run/);
});
test('agent context and capability preserve V2.80 authority boundary',()=>{
 const d=def(),r=createFederatedAutomationRun(d,{run_id:'r'},2000);
 const ctx=federatedAutomationAgentContext([d],[r]);assert.equal(ctx.agent_may_execute,false);assert.equal(ctx.cloud_may_execute,false);
 const cap=federatedAutomationCapability();assert.equal(cap.section,1);assert.equal(cap.execution_enabled,false);assert.equal(cap.origin_homeserver_authoritative,true);assert.equal(cap.durable_action_ledger,true);
});

test('only active automation definitions may create runs',()=>{const d={...def(),state:'draft'};assert.throws(()=>createFederatedAutomationRun(d,{run_id:'draft-run'},2000),/automation_not_runnable/);});
