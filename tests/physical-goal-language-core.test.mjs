import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretPhysicalGoalCommand,parsePhysicalGoalCommand} from '../src/physical-goal-language-core.js';

const context=()=>({
 selfSubjectId:'p1',
 rooms:[{id:'ROOM01',name:'Office'},{id:'ROOM02',name:'Kitchen'}],
 people:[{participantId:'p1',label:'Dave',roomId:'ROOM01'},{participantId:'p2',label:'Sarah',roomId:'ROOM02'}],
 objects:[{objectId:'O1',label:'keys',roomId:'ROOM01'}],
 anchors:[{id:'A1',label:'door',roomId:'ROOM01'},{id:'A2',label:'desk',roomId:'ROOM01'}]
});

test('parses and resolves entity-in-room expectation',()=>{
 const r=interpretPhysicalGoalCommand('Expect the keys to stay in the office',context(),[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.type,'standing-expectation');
 assert.equal(r.goal.expectations[0].kind,'entity-in-room');assert.equal(r.goal.expectations[0].subjectId,'O1');assert.equal(r.goal.expectations[0].roomId,'ROOM01');
});
test('parses normal-location phrasing',()=>{
 const r=interpretPhysicalGoalCommand('keys normally stay in the office',context(),[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.expectations[0].roomId,'ROOM01');
});
test('parses anchor expectation against known place',()=>{
 const r=interpretPhysicalGoalCommand('keys should be by the door',context(),[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.expectations[0].kind,'entity-at-anchor');assert.equal(r.goal.expectations[0].anchorId,'A1');
});
test('parses standing room-empty expectation',()=>{
 const r=interpretPhysicalGoalCommand('Make sure the office is empty',context(),[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.expectations[0].kind,'room-empty');assert.equal(r.goal.expectations[0].roomId,'ROOM01');
});
test('parses recurring exit routine',()=>{
 const r=interpretPhysicalGoalCommand('Make sure the office is empty when Dave leaves the office',context(),[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.type,'routine');assert.equal(r.goal.trigger.subjectId,'p1');assert.equal(r.goal.trigger.roomId,'ROOM01');
 assert.equal(r.goal.expectations[0].kind,'room-empty');
});
test('self reference uses caller-supplied physical identity instead of guessing',()=>{
 const r=interpretPhysicalGoalCommand('Make sure the office is empty when I leave',context(),[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.trigger.subjectId,'p1');
 const c=context();delete c.selfSubjectId;
 const missing=interpretPhysicalGoalCommand('Make sure the office is empty when I leave',c,[],1000);
 assert.equal(missing.status,'needs-context');assert.equal(missing.field,'selfSubjectId');
});
test('ambiguous anchor is preserved instead of guessed',()=>{
 const c=context();c.anchors.push({id:'A3',label:'door',roomId:'ROOM02'});
 const r=interpretPhysicalGoalCommand('keys should be by the door',c,[],1000);
 assert.equal(r.status,'ambiguous');assert.equal(r.field,'anchor');assert.equal(r.candidates.length,2);
});
test('unknown room returns semantic candidates',()=>{
 const r=interpretPhysicalGoalCommand('Expect the keys to stay in the garage',context(),[],1000);
 assert.equal(r.status,'not-found');assert.equal(r.field,'room');assert.ok(r.candidates.some(x=>x.label==='Office'));
});
test('management language supports list pause resume and remove',()=>{
 const goals=[{id:'G1',label:'Keys stay in Office',type:'standing-expectation',enabled:true}];
 assert.equal(interpretPhysicalGoalCommand('List my goals',context(),goals).intent,'list');
 assert.equal(interpretPhysicalGoalCommand('Pause goal G1',context(),goals).intent,'pause');
 assert.equal(interpretPhysicalGoalCommand('Resume goal G1',context(),goals).intent,'resume');
 assert.equal(interpretPhysicalGoalCommand('Remove goal Keys stay in Office',context(),goals).goal.id,'G1');
});
test('management language supports manual routine run',()=>{
 const goals=[{id:'G2',label:'Office exit check',type:'routine',enabled:true}];
 const r=interpretPhysicalGoalCommand('Run routine Office exit check',context(),goals,1000);
 assert.equal(r.status,'ready');assert.equal(r.intent,'run');assert.equal(r.goal.id,'G2');
});

test('unsupported language is not coerced into a goal',()=>{
 assert.equal(interpretPhysicalGoalCommand('Turn off the lights',context(),[],1000).status,'unsupported');
});
