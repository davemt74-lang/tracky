import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFederatedAutomationDefinition,createFederatedAutomationRun} from '../src/federated-automation-core.js';
import {createExecutionDispatch,admitExecutionDispatch,createExecutionReceipt,applyExecutionReceipt,federatedExecutionCapability} from '../src/federated-automation-execution-runtime.js';
const HOME='11111111-1111-4111-8111-111111111111',OFFICE='22222222-2222-4222-8222-222222222222';
const DEV='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const definition=normalizeFederatedAutomationDefinition({automation_id:'fa:dist',idempotency_key:'fa:dist',origin_site_id:HOME,state:'active',actor:{actor_type:'owner'},
 trigger:{kind:'manual',source_site_id:HOME},steps:[
 {step_id:'local',action_type:'data_operation',authority_site_id:HOME,target_site_id:HOME,action_key:'context.check'},
 {step_id:'remote',action_type:'physical_action',authority_site_id:OFFICE,target_site_id:OFFICE,device_id:DEV,action_key:'light.on',required_permissions:['device_control'],approval_mode:'governed',depends_on:['local']}
]},1000);
test('creates authority-epoch-bound replay-safe dispatch',()=>{const run=createFederatedAutomationRun(definition,{idempotency_key:'run:1'},2000);const d=createExecutionDispatch(definition,run,'local',{authority_epoch:4,now_ms:2100});const d2=createExecutionDispatch(definition,run,'local',{authority_epoch:4,now_ms:2200});assert.equal(d.dispatch_id,d2.dispatch_id);assert.equal(d.authority_epoch,4);});
test('remote authority admission fails closed',()=>{const run=createFederatedAutomationRun(definition,{idempotency_key:'run:2'},2000);run.steps[0].state='completed';run.steps[1].state='ready';const d=createExecutionDispatch(definition,run,'remote',{authority_epoch:7,approval_id:'approval-1',now_ms:2200});
 const good={local_site_id:OFFICE,local_device_id:DEV,authority_device_id:DEV,authority_epoch:7,device_trusted:true,reconciliation_current:true,permission_grants:['device_control'],now_ms:2300};
 assert.equal(admitExecutionDispatch(d,good).admitted,true);
 for(const patch of [{local_site_id:HOME},{authority_epoch:8},{reconciliation_current:false},{permission_grants:[]},{revoked:true}])assert.throws(()=>admitExecutionDispatch(d,{...good,...patch}));
});
test('physical execution requires approval evidence',()=>{const run=createFederatedAutomationRun(definition,{idempotency_key:'run:3'},2000);run.steps[0].state='completed';run.steps[1].state='ready';const d=createExecutionDispatch(definition,run,'remote',{authority_epoch:7,now_ms:2200});assert.throws(()=>admitExecutionDispatch(d,{local_site_id:OFFICE,local_device_id:DEV,authority_device_id:DEV,authority_epoch:7,device_trusted:true,reconciliation_current:true,permission_grants:['device_control']}));});
test('receipt advances DAG and completes run',()=>{let run=createFederatedAutomationRun(definition,{idempotency_key:'run:4'},2000);let d=createExecutionDispatch(definition,run,'local',{authority_epoch:1,now_ms:2100});run=applyExecutionReceipt(run,createExecutionReceipt(d,{status:'completed',execution_id:'x1'},{now_ms:2200}));assert.equal(run.steps[1].state,'ready');d=createExecutionDispatch(definition,run,'remote',{authority_epoch:2,approval_id:'a1',now_ms:2300});run=applyExecutionReceipt(run,createExecutionReceipt(d,{status:'completed',execution_id:'x2'},{now_ms:2400}));assert.equal(run.state,'completed');assert.equal(federatedExecutionCapability().section,3);});
