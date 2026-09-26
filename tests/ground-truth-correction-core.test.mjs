import test from 'node:test';
import assert from 'node:assert/strict';
import {
 appendGroundTruthCorrection,interpretGroundTruthCorrection,normalizeGroundTruthCorrection,activeGroundTruthCorrections,revokeGroundTruthCorrection,groundTruthCorrectionHistory
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

test('that is not identity creates user-authoritative identity rejection',()=>{
 const r=interpretGroundTruthCorrection('that is not Sarah',{entities:[],rooms:[]},{subjectId:'PERSON:p1',entityType:'person'},1000);
 assert.equal(r.status,'ready');assert.equal(r.correction.type,'identity-rejection');assert.equal(r.correction.label,'Sarah');
});
test('forget that object works only with explicitly resolved subject context',()=>{
 assert.equal(interpretGroundTruthCorrection('forget that object',{entities:[],rooms:[]},{},1000).status,'not-found');
 const r=interpretGroundTruthCorrection('forget that object',{entities:[],rooms:[]},{subjectId:'O1',entityType:'object',label:'keys'},1000);
 assert.equal(r.status,'ready');assert.equal(r.correction.subjectId,'O1');
});

test('revoking latest correction restores prior correction in the same lifecycle',()=>{
 let r=appendGroundTruthCorrection([],{id:'C1',type:'entity-location',subjectId:'O1',roomId:'OFFICE'},1000);
 r=appendGroundTruthCorrection(r.corrections,{id:'C2',type:'entity-location',subjectId:'O1',roomId:'KITCHEN'},2000);
 assert.equal(activeGroundTruthCorrections(r.corrections)[0].id,'C2');
 const undone=revokeGroundTruthCorrection(r.corrections,'C2','mistake',3000);
 assert.equal(undone.status,'revoked');
 assert.deepEqual(undone.reactivated,['C1']);
 assert.equal(activeGroundTruthCorrections(undone.corrections)[0].id,'C1');
});
test('revoking entity merge provides explicit unmerge without deleting audit history',()=>{
 let r=appendGroundTruthCorrection([],{id:'M1',type:'entity-merge',aliasEntityId:'O9',canonicalEntityId:'O1'},1000);
 assert.equal(activeGroundTruthCorrections(r.corrections).length,1);
 const undone=revokeGroundTruthCorrection(r.corrections,'M1','not-the-same-object',2000);
 assert.equal(activeGroundTruthCorrections(undone.corrections).length,0);
 assert.equal(groundTruthCorrectionHistory(undone.corrections)[0].status,'revoked');
});
test('correction history includes alias and canonical entity merge references',()=>{
 const r=appendGroundTruthCorrection([],{id:'M1',type:'entity-merge',aliasEntityId:'O9',canonicalEntityId:'O1'},1000);
 assert.equal(groundTruthCorrectionHistory(r.corrections,'O9').length,1);
 assert.equal(groundTruthCorrectionHistory(r.corrections,'O1').length,1);
});
