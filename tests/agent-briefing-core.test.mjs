import test from 'node:test';
import assert from 'node:assert/strict';
import {acknowledgeAgentBriefing,buildAgentBriefing,pendingAgentBriefings} from '../src/agent-briefing-core.js';
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
