import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFederationControlCenterModel,FEDERATION_CONTROL_CENTER_PROTOCOL} from '../src/federation-control-center-core.js';

const HOME='11111111-1111-4111-8111-111111111111';
const OFFICE='22222222-2222-4222-8222-222222222222';
const NODE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DESK='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const operations={
  protocol:'physical_federation_operations.v1',health:'critical',local_site_id:HOME,
  summary:{site_count:2,device_count:2,critical_site_count:1},
  sites:[
    {id:HOME,label:'Home',status:'active',health:'healthy',authority:{device_id:NODE,epoch:3},federation:{status:'current'},device_count:1,profiles:['node']},
    {id:OFFICE,label:'Office',status:'active',health:'critical',authority:{device_id:DESK,epoch:2},federation:{status:'partitioned'},device_count:1,profiles:['desk']}
  ],
  devices:[
    {id:NODE,label:'Home Node',site_id:HOME,hardware_profile:'node',hardware_profile_label:'Node',trust_state:'trusted',roles:['site_authority']},
    {id:DESK,label:'Office Desk',site_id:OFFICE,hardware_profile:'desk',hardware_profile_label:'Desk',trust_state:'trusted',roles:['site_authority']}
  ],
  relationships:[{subject_id:HOME,type:'peers_with',object_id:OFFICE}],
  issues:[{site_id:OFFICE,severity:'critical',code:'federation_partitioned',message:'Federation peer is partitioned.'}]
};

test('control center creates deterministic site/device topology',()=>{
  const model=buildFederationControlCenterModel(operations);
  assert.equal(model.protocol,FEDERATION_CONTROL_CENTER_PROTOCOL);
  assert.equal(model.site_cards[0].label,'Office');
  assert.equal(model.topology.nodes.length,4);
  assert.equal(model.topology.edges.filter(x=>x.type==='member_of').length,2);
  assert.equal(model.topology.edges.some(x=>x.type==='peers_with'),true);
  assert.equal(model.issues[0].code,'federation_partitioned');
});

test('Section 2 remains observational',()=>{
  const model=buildFederationControlCenterModel(operations);
  assert.equal(model.controls.mode,'observe_only');
  assert.equal(model.controls.authority_mutation,false);
  assert.equal(model.controls.identity_mutation,false);
  assert.equal(model.controls.cloud_authority,false);
  assert(model.boundaries.includes('local-freshness-is-not-inferred-by-cloud'));
});
