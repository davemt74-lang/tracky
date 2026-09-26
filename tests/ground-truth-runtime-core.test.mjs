import test from 'node:test';
import assert from 'node:assert/strict';
import {
  correctionSemanticSignature,
  groundTruthPersistenceSignature,
  groundTruthPersistenceSnapshot,
  groundTruthSemanticSignature,
  reportedMovedCameraIds
} from '../src/ground-truth-runtime-core.js';

const state={
  recoveryMode:false,activeRoomId:'OFFICE',
  entities:[
    {subjectId:'O1',entityType:'object',label:'keys',state:'confirmed',roomId:'OFFICE',lastKnownRoomId:'OFFICE',authority:'direct-observation',freshness:'current',confidence:.91},
    {subjectId:'O2',entityType:'object',label:'wallet',state:'last-known',roomId:null,lastKnownRoomId:'PRIVATE',authority:'recovered-history',freshness:'unknown',confidence:.3}
  ],
  facts:[{subjectId:'O1'},{subjectId:'O2'}],
  conflicts:[{id:'C1',subjectId:'O2'}],
  continuityIssues:[{id:'I1',subjectIds:['O2']}]
};
const policies={
  OFFICE:{roomId:'OFFICE',allowSpatialMemory:true,sensitiveRegions:[]},
  PRIVATE:{roomId:'PRIVATE',allowSpatialMemory:false,sensitiveRegions:[]}
};

test('semantic signature ignores volatile generated timestamps but captures authority/freshness',()=>{
  const a=groundTruthSemanticSignature({...state,generatedAt:1000},{status:'healthy'});
  const b=groundTruthSemanticSignature({...state,generatedAt:2000},{status:'healthy'});
  assert.equal(a,b);
  const c=groundTruthSemanticSignature({...state,entities:[{...state.entities[0],freshness:'stale'}]},{status:'limited'});
  assert.notEqual(a,c);
});
test('persistence snapshot removes entities whose room disallows spatial retention',()=>{
  const snapshot=groundTruthPersistenceSnapshot(state,policies);
  assert.equal(snapshot.entities.some(x=>x.subjectId==='O1'),true);
  assert.equal(snapshot.entities.some(x=>x.subjectId==='O2'),false);
  assert.equal(snapshot.facts.some(x=>x.subjectId==='O2'),false);
  assert.equal(snapshot.conflicts.length,0);
  assert.equal(snapshot.continuityIssues.length,0);
});
test('correction signature captures lifecycle status but not timestamps',()=>{
  const a=correctionSemanticSignature([{id:'X',type:'entity-label',status:'active',subjectId:'O1',updatedAt:1000}]);
  const b=correctionSemanticSignature([{id:'X',type:'entity-label',status:'active',subjectId:'O1',updatedAt:2000}]);
  assert.equal(a,b);
  const c=correctionSemanticSignature([{id:'X',type:'entity-label',status:'revoked',subjectId:'O1',updatedAt:3000}]);
  assert.notEqual(a,c);
});
test('persistence signature changes only when retention-safe semantics or correction lifecycle changes',()=>{
  const a=groundTruthPersistenceSignature(state,{status:'healthy'},[],policies);
  const b=groundTruthPersistenceSignature({...state,generatedAt:9999},{status:'healthy'},[],policies);
  assert.equal(a,b);
  const c=groundTruthPersistenceSignature(state,{status:'limited'},[],policies);
  assert.notEqual(a,c);
});
test('only active camera-moved corrections affect diagnostics',()=>{
  assert.deepEqual(reportedMovedCameraIds([
    {type:'camera-moved',cameraId:'C1',status:'active'},
    {type:'camera-moved',cameraId:'C2',status:'revoked'},
    {type:'entity-label',cameraId:'C3',status:'active'}
  ]),['C1']);
});
