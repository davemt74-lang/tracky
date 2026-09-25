import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeEnvironmentObservation,
  assistedMappingFromObservation,
  environmentProviderContract,
  landmarksFromWorldObjects,
  videoFrameDimensions
} from '../src/environment-runtime.js';

test('video frame dimensions preserve aspect ratio while bounding width',()=>{
  assert.deepEqual(videoFrameDimensions({videoWidth:1920,videoHeight:1080},720),{width:720,height:405});
});

test('world objects become environment landmark candidates',()=>{
  const landmarks=landmarksFromWorldObjects([
    {id:'WO1',label:'desk',status:'visible',roomPosition:{x:.3,y:.5},confidence:.9},
    {id:'WO2',label:'cup',status:'last-known',roomPosition:{x:.4,y:.5},confidence:.8}
  ]);
  assert.equal(landmarks.length,1);
  assert.equal(landmarks[0].id,'L-WO1');
});

test('assisted mapping is explicitly confidence-scored and confirmable',()=>{
  const mapping=assistedMappingFromObservation({capturedAt:1},[
    {id:'WO1',label:'desk',status:'visible',roomPosition:{x:.3,y:.5},confidence:.9}
  ]);
  assert.equal(mapping.requiresConfirmation,true);
  assert.equal(mapping.provider,'human-object-plus-floor-heuristic');
  assert.ok(mapping.floor.confidence>0);
});

test('provider contract keeps structural provider replaceable',()=>{
  const contract=environmentProviderContract();
  assert.equal(contract.schemaVersion,1);
  assert.ok(contract.mayReturn.includes('structural-boundaries'));
});

test('environment analysis returns unknown cleanly with no baselines',()=>{
  const result=analyzeEnvironmentObservation({fingerprint:{values:[]},landmarks:[]},[]);
  assert.equal(result.classification,'unknown');
  assert.equal(result.room,null);
});
