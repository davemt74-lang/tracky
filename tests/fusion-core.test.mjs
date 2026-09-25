import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterUnknownObservations,
  fuseParticipantObservations,
  fuseWorldObjects,
  observationQuality,
  updateWorldFusion
} from '../src/fusion-core.js';

function person(cameraId,trackId,x,participantId=null,face=.8,body=.8){
  return {
    kind:'participant',cameraId,localTrackId:trackId,roomId:'ROOM01',
    participantId,participantName:participantId?'Dave':null,
    roomPosition:{x,y:.5},faceConfidence:face,bodyConfidence:body,
    poseConfidence:.7,continuityConfidence:.8
  };
}

test('known participant seen by two cameras becomes one fused entity', () => {
  const entities=fuseParticipantObservations([
    person('CAM01','T1',.45,'p1',.92,.8),
    person('CAM02','T9',.47,'p1',.70,.9)
  ]);
  assert.equal(entities.length,1);
  assert.equal(entities[0].participantId,'p1');
  assert.equal(entities[0].cameraIds.length,2);
  assert.equal(entities[0].primaryCameraId,'CAM01');
});

test('unknown bodies may dedupe only as anonymous spatial overlap', () => {
  const entities=fuseParticipantObservations([
    person('CAM01','T1',.45),
    person('CAM02','T9',.48)
  ]);
  assert.equal(entities.length,1);
  assert.equal(entities[0].participantId,null);
  assert.equal(entities[0].identityAuthority,'anonymous-spatial-overlap');
});

test('unknown bodies far apart remain separate', () => {
  const clusters=clusterUnknownObservations([
    person('CAM01','T1',.2),
    person('CAM02','T9',.8)
  ]);
  assert.equal(clusters.length,2);
});

test('camera arbitration prefers stronger face evidence', () => {
  const q1=observationQuality(person('CAM01','T1',.4,'p1',.95,.5));
  const q2=observationQuality(person('CAM02','T2',.4,'p1',.4,.95));
  assert.ok(q1>q2);
});

test('world fusion reports known participant camera handoff', () => {
  const previous={
    roomId:'ROOM01',
    participants:[{
      id:'P:p1',participantId:'p1',participantName:'Dave',
      primaryCameraId:'CAM01',cameraIds:['CAM01'],roomPosition:{x:.3,y:.5},
      lastSeenAt:1000,firstSeenAt:500
    }],
    objects:[]
  };
  const result=updateWorldFusion(previous,[
    person('CAM02','T5',.35,'p1',.9,.8)
  ],[],2000,{roomId:'ROOM01'});
  assert.equal(result.events.some((event)=>event.type==='camera.handoff'),true);
  assert.equal(result.state.participants[0].primaryCameraId,'CAM02');
});

test('same object class in overlap fuses into one world object', () => {
  const objects=fuseWorldObjects([],[
    {cameraId:'CAM01',roomId:'ROOM01',localObjectId:'O1',label:'cup',roomPosition:{x:.4,y:.4},confidence:.9,stable:true},
    {cameraId:'CAM02',roomId:'ROOM01',localObjectId:'O8',label:'cup',roomPosition:{x:.45,y:.42},confidence:.8,stable:true}
  ],1000,{nextId:()=> 'WO001'});
  assert.equal(objects.length,1);
  assert.equal(objects[0].id,'WO001');
  assert.equal(objects[0].cameraIds.length,2);
});

test('object world id persists across camera handoff', () => {
  const previous=[{
    id:'WO001',label:'phone',roomPosition:{x:.3,y:.4},
    cameraIds:['CAM01'],primaryCameraId:'CAM01',firstSeenAt:100,lastSeenAt:1000
  }];
  const objects=fuseWorldObjects(previous,[
    {cameraId:'CAM02',roomId:'ROOM01',localObjectId:'O4',label:'phone',roomPosition:{x:.34,y:.42},confidence:.88,stable:true}
  ],2000);
  assert.equal(objects[0].id,'WO001');
  assert.equal(objects[0].primaryCameraId,'CAM02');
});


test('known participant position conflict trusts best calibrated view instead of averaging', () => {
  const entities=fuseParticipantObservations([
    person('CAM01','T1',.15,'p1',.96,.9),
    person('CAM02','T2',.90,'p1',.50,.7)
  ]);
  assert.equal(entities.length,1);
  assert.equal(entities[0].positionConflict,true);
  assert.ok(entities[0].roomPosition.x<.3);
  assert.deepEqual(entities[0].conflictingCameraIds,['CAM02']);
});

test('two same-label objects from one camera remain separate world objects', () => {
  const objects=fuseWorldObjects([],[
    {cameraId:'CAM01',roomId:'ROOM01',localObjectId:'O1',label:'cup',roomPosition:{x:.40,y:.40},confidence:.9,stable:true},
    {cameraId:'CAM01',roomId:'ROOM01',localObjectId:'O2',label:'cup',roomPosition:{x:.44,y:.42},confidence:.85,stable:true}
  ],1000,{nextId:(()=>{let n=0;return()=> 'WO00'+(++n);})()});
  assert.equal(objects.length,2);
});
