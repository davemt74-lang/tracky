import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCameraList } from '../src/camera-store.js';

test('camera registry elects first camera primary when none specified', () => {
  const cameras=normalizeCameraList([
    {id:'CAM01',primary:false},
    {id:'CAM02',primary:false}
  ]);
  assert.equal(cameras[0].primary,true);
  assert.equal(cameras[1].primary,false);
});

test('camera registry permits only one primary camera', () => {
  const cameras=normalizeCameraList([
    {id:'CAM01',primary:true},
    {id:'CAM02',primary:true}
  ]);
  assert.equal(cameras.filter((camera)=>camera.primary).length,1);
  assert.equal(cameras[0].primary,true);
});
