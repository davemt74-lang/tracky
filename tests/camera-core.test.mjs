import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraCalibrationValid,
  cameraWithCoverage,
  mapCameraBox,
  mapCameraPoint,
  normalizeCameraConfig,
  rectangleRoomPoints
} from '../src/camera-core.js';

test('camera coverage rectangle maps camera center into room center', () => {
  const camera=cameraWithCoverage(
    normalizeCameraConfig({id:'CAM01'}),
    {x:0.2,y:0.1,width:0.4,height:0.6}
  );
  const point=mapCameraPoint(camera,{x:0.5,y:0.5});
  assert.ok(Math.abs(point.x-0.4)<1e-6);
  assert.ok(Math.abs(point.y-0.4)<1e-6);
  assert.equal(cameraCalibrationValid(camera),true);
});

test('arbitrary quadrilateral camera calibration uses homography', () => {
  const camera=normalizeCameraConfig({
    id:'CAM02',
    roomPoints:[
      {x:0.1,y:0.1},{x:0.8,y:0.2},{x:0.7,y:0.9},{x:0.2,y:0.8}
    ]
  });
  const point=mapCameraPoint(camera,{x:0,y:0});
  assert.ok(Math.abs(point.x-0.1)<1e-6);
  assert.ok(Math.abs(point.y-0.1)<1e-6);
});

test('camera box is transformed into room bounding box', () => {
  const camera=cameraWithCoverage(
    normalizeCameraConfig({id:'CAM01'}),
    {x:0.25,y:0.25,width:0.5,height:0.5}
  );
  const box=mapCameraBox(camera,{x:0.2,y:0.2,width:0.2,height:0.2});
  assert.ok(box.cx>0.3 && box.cx<0.5);
  assert.ok(box.cy>0.3 && box.cy<0.5);
});

test('rectangleRoomPoints clamps room coverage', () => {
  const points=rectangleRoomPoints(0.9,0.9,0.4,0.4);
  assert.equal(points[2].x,1);
  assert.equal(points[2].y,1);
});


test('invalid calibration input falls back to finite room coordinates', () => {
  const camera=cameraWithCoverage(
    normalizeCameraConfig({id:'CAM03'}),
    {x:'bad',y:null,width:undefined,height:'bad'}
  );
  for (const point of camera.roomPoints) {
    assert.equal(Number.isFinite(point.x),true);
    assert.equal(Number.isFinite(point.y),true);
  }
  assert.equal(cameraCalibrationValid(camera),true);
});
