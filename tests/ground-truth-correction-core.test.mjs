import test from 'node:test';
import assert from 'node:assert/strict';
import {
 appendGroundTruthCorrection,interpretGroundTruthCorrection,normalizeGroundTruthCorrection,activeGroundTruthCorrections
} from '../src/ground-truth-correction-core.js';

test('correction is explicit user-confirmed semantic authority',()=>{
 const c=normalizeGroundTruthCorrection({type:'entity-location',subjectId:'O1',roomId:'OFFICE'},1000);
 assert.equal(c.authority,'user-confirmed');assert.ok(c.boundaries.includes('explicit-user-correction'));
});
test('new correction supersedes older correction of same type for same entity',()=>{
 let r=appendGroundTruthCorrection([],{id:'C1',type:'entity-location',subjectId:'O1',roomId:'OFFICE'},1000);
 r=appendGroundTruthCorrection(r.corrections,{id:'C2',type:'entity-location',subjectId:'O1',roomId:'KITCHEN'},2000);
 assert.equal(r.corrections.find(x=>x.id==='C1').status,'superseded');
 assert.equal(activeGroundTruthCorrections(r.corrections).length,1);
});
test('natural language forget resolves only unambiguous entity',()=>{
 const context={entities:[{subjectId:'O1',entityType:'object',label:'keys'}],rooms:[]};
 const r=interpretGroundTruthCorrection('forget the keys',context,{},1000);
 assert.equal(r.status,'ready');assert.equal(r.correction.type,'forget-entity');
});
test('natural language location correction resolves known room and entity',()=>{
 const context={entities:[{subjectId:'O1',entityType:'object',label:'keys'}],rooms:[{id:'OFFICE',name:'Office'}]};
 const r=interpretGroundTruthCorrection('keys are in office',context,{},1000);
 assert.equal(r.status,'ready');assert.equal(r.correction.roomId,'OFFICE');
});
test('deictic label correction requires explicit subject context',()=>{
 const context={entities:[],rooms:[]};
 assert.equal(interpretGroundTruthCorrection('those are my keys',context,{},1000).status,'unsupported');
 const r=interpretGroundTruthCorrection('those are my keys',context,{subjectId:'O1',entityType:'object'},1000);
 assert.equal(r.status,'ready');assert.equal(r.correction.label,'keys');
});
test('this camera moved requires resolved camera context',()=>{
 assert.equal(interpretGroundTruthCorrection('this camera moved',{},{},1000).status,'needs-context');
 const r=interpretGroundTruthCorrection('this camera moved',{primaryCameraId:'CAM1'},{},1000);
 assert.equal(r.status,'ready');assert.equal(r.correction.type,'camera-moved');assert.equal(r.correction.cameraId,'CAM1');
});
