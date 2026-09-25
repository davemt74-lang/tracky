import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraCanSeePosition,
  classifyVisibility
} from '../src/visibility-core.js';

const camera={
  id:'CAM01',enabled:true,
  roomPoints:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]
};

test('camera coverage contains calibrated room point',()=>{
  assert.equal(cameraCanSeePosition(camera,{x:.5,y:.5}),true);
});

test('entity observed by expected camera is visible',()=>{
  const result=classifyVisibility({
    position:{x:.5,y:.5},cameras:[camera],observedCameraIds:['CAM01']
  });
  assert.equal(result.state,'visible');
});

test('missing entity inside coverage is unexpected without occlusion',()=>{
  const result=classifyVisibility({
    position:{x:.5,y:.5},cameras:[camera],observedCameraIds:[]
  });
  assert.equal(result.state,'missing-unexpected');
});

test('known occluder converts missing evidence into expected occlusion',()=>{
  const result=classifyVisibility({
    position:{x:.5,y:.5},cameras:[camera],observedCameraIds:[],
    occluders:[{x:.4,y:.4,width:.2,height:.2}]
  });
  assert.equal(result.state,'expected-occlusion');
});
