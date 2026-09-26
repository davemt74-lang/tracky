import test from 'node:test';
import assert from 'node:assert/strict';
import {acknowledgeAgentBriefing,buildAgentBriefing,buildPhysicalGoalBriefing,buildRoutineLearningBriefing,pendingAgentBriefings} from '../src/agent-briefing-core.js';
test('builds compact semantic briefing from world-watch trigger',()=>{
 const b=buildAgentBriefing({id:'E1',watchId:'W1',type:'entity-moved',summary:'Keys changed location state.',confidence:.9,evidence:{subjectId:'O1',roomId:'ROOM02'}},{id:'W1',label:'Keys move'},1000);
 assert.equal(b.status,'pending');assert.equal(b.watchId,'W1');assert.equal(b.evidence.subjectId,'O1');
 assert.ok(b.boundaries.includes('no-autonomous-physical-control'));
});
test('anomaly-active briefing is high urgency',()=>{
 const b=buildAgentBriefing({id:'E1',watchId:'W1',type:'anomaly-active',summary:'Unexpected change',confidence:.8,evidence:{}},{label:'Anomaly active'},1000);
 assert.equal(b.urgency,'high');
});
test('briefing acknowledgement is explicit',()=>{
 const b=acknowledgeAgentBriefing(buildAgentBriefing({id:'E1'},{},1000),2000);
 assert.equal(b.status,'acknowledged');assert.equal(b.acknowledgedAt,2000);
});
test('pending briefing selector excludes acknowledged records',()=>{
 const a=buildAgentBriefing({id:'E1',generatedAt:1000},{},1000);
 const b=acknowledgeAgentBriefing(buildAgentBriefing({id:'E2',generatedAt:2000},{},2000),3000);
 assert.deepEqual(pendingAgentBriefings([a,b]).map(x=>x.id),[a.id]);
});
test('briefings never contain raw sensor payload fields',()=>{
 const b=buildAgentBriefing({id:'E1',summary:'ok',evidence:{subjectId:'O1',imageDataUrl:'private',embedding:[1]}},{},1000);
 assert.doesNotMatch(JSON.stringify(b),/imageDataUrl|embedding|descriptor|rawPayload|transcript/);
});

test('builds compact semantic briefing from physical goal violation',()=>{
 const b=buildPhysicalGoalBriefing(
  {id:'GE1',goalId:'G1',type:'expectation-violated',state:'violated',severity:'high',summary:'Keys are outside the expected room.',confidence:.86,evidence:{subjectId:'O1',roomId:'ROOM02',expectedRoomId:'ROOM01'},checks:[{state:'violated'}]},
  {id:'G1',label:'Keys stay in Office',severity:'high'},
  1000
 );
 assert.equal(b.type,'physical-world-goal');assert.equal(b.goalId,'G1');assert.equal(b.urgency,'high');
 assert.equal(b.evidence.subjectId,'O1');assert.equal(b.evidence.expectedRoomId,'ROOM01');
 assert.ok(b.boundaries.includes('privacy-governed-context'));
});
test('physical goal briefing strips unrelated raw goal-event evidence',()=>{
 const b=buildPhysicalGoalBriefing(
  {id:'GE2',goalId:'G2',summary:'Goal update',evidence:{imageDataUrl:'private',embedding:[1],subjectId:'O1'}},
  {id:'G2',label:'Goal'},
  1000
 );
 assert.doesNotMatch(JSON.stringify(b),/imageDataUrl|embedding|descriptor|rawPayload|transcript/);
});

test('builds low-priority proposal-only briefing for learned routine',()=>{
 const b=buildRoutineLearningBriefing({
  id:'P1',type:'sequence-routine',label:'Dave routine: Office → Hall → Entry',
  confidence:.87,evidence:{occurrences:5,sessions:3},createdAt:1000
 },1000);
 assert.equal(b.type,'routine-learning-proposal');assert.equal(b.urgency,'info');assert.equal(b.proposalId,'P1');
 assert.ok(b.boundaries.includes('requires-user-confirmation'));
 assert.ok(b.boundaries.includes('no-autonomous-physical-control'));
});
test('learned routine briefing contains no raw evidence payload',()=>{
 const b=buildRoutineLearningBriefing({
  id:'P2',label:'Pattern',confidence:.8,evidence:{occurrences:4,sessions:3,imageDataUrl:'private',embedding:[1]}
 },1000);
 assert.doesNotMatch(JSON.stringify(b),/imageDataUrl|embedding|descriptor|rawPayload|transcript/);
});
