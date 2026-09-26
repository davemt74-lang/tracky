import test from 'node:test';
import assert from 'node:assert/strict';
import {
 combinedCoverage,cameraOperationalHealth,roomOperationalHealth,buildOperationalHealth
} from '../src/operational-health-core.js';

const cam=(id,roomId='OFFICE',points=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}])=>({
 id,name:id,roomId,enabled:true,primary:id==='CAM1',
 sourcePoints:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],roomPoints:points,updatedAt:1000
});

test('combined calibrated coverage reaches full room for unit camera',()=>{
 assert.ok(combinedCoverage([cam('CAM1')])>.98);
});
test('camera pose shift requires review rather than being trusted',()=>{
 const h=cameraOperationalHealth(cam('CAM1'),'online',{drift:{likelyCameraShift:true}},2000);
 assert.equal(h.status,'needs-review');assert.equal(h.poseShiftDetected,true);assert.ok(h.trust<.5);
});
test('offline camera is explicit operational issue',()=>{
 const h=cameraOperationalHealth(cam('CAM1'),'offline',null,2000);
 assert.equal(h.status,'offline');assert.ok(h.issues.includes('offline'));
});
test('room occupancy verification requires privacy and broad live coverage',()=>{
 let h=roomOperationalHealth({id:'OFFICE'},[cam('CAM1')],{CAM1:'online'},{allowVisualObservation:true,allowAnonymousTracking:true,sensitiveRegions:[]},null,2000);
 assert.equal(h.occupancyVerifiable,true);
 h=roomOperationalHealth({id:'OFFICE'},[cam('CAM1')],{CAM1:'online'},{allowVisualObservation:true,allowAnonymousTracking:false,sensitiveRegions:[]},null,2000);
 assert.equal(h.occupancyVerifiable,false);
});
test('participant ignore region makes room occupancy unverifiable',()=>{
 const h=roomOperationalHealth({id:'OFFICE'},[cam('CAM1')],{CAM1:'online'},{
   allowVisualObservation:true,allowAnonymousTracking:true,
   sensitiveRegions:[{enabled:true,mode:'ignore',appliesTo:['participant']}]
 },null,2000);
 assert.equal(h.occupancyVerifiable,false);
 assert.ok(h.issues.includes('participant-privacy-blind-spot'));
});
test('operational health includes stale and conflicted truth diagnostics',()=>{
 const h=buildOperationalHealth({
  activeRoomId:'OFFICE',rooms:[{id:'OFFICE'}],cameras:[cam('CAM1')],
  cameraStatuses:{CAM1:'online'},roomPolicies:{OFFICE:{allowVisualObservation:true,allowAnonymousTracking:true,sensitiveRegions:[]}},
  groundTruth:{entities:[
   {subjectId:'O1',freshness:'stale',state:'last-known'},
   {subjectId:'P1',freshness:'current',state:'conflicted'}
  ]}
 },2000);
 assert.equal(h.staleEntityCount,1);assert.equal(h.conflictedEntityCount,1);
 assert.equal(h.status,'needs-attention');
});
