import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultEnvironmentPolicy,
  normalizeEnvironmentView,
  normalizeRoom
} from '../src/environment-store.js';

test('environment view normalizes mapping evidence',()=>{
  const view=normalizeEnvironmentView({
    id:'VIEW01',roomId:'ROOM01',name:'Desk',
    landmarks:[{id:'L1',label:'desk',position:{x:.2,y:.3},confidence:.9}]
  });
  assert.equal(view.roomId,'ROOM01');
  assert.equal(view.landmarks[0].id,'L1');
  assert.equal(view.version,1);
});

test('room normalization preserves topology container',()=>{
  const room=normalizeRoom({id:'ROOM01',name:'Office'});
  assert.deepEqual(room.topology,{portals:[]});
});

test('privacy policy defaults comparison images to ephemeral',()=>{
  const policy=defaultEnvironmentPolicy('ROOM01');
  assert.equal(policy.retainPrimaryImages,true);
  assert.equal(policy.retainComparisonImages,false);
  assert.equal(policy.analyzeScreenContent,false);
});
