import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTemporalClause,interpretTemporalGoalCommand} from '../src/temporal-goal-language-core.js';

const context=()=>({
 selfSubjectId:'p1',
 rooms:[{id:'OFFICE',name:'Office'},{id:'KITCHEN',name:'Kitchen'}],
 people:[{participantId:'p1',label:'Dave',roomId:'OFFICE'}],
 objects:[{objectId:'O1',label:'keys',roomId:'OFFICE'}],
 anchors:[{id:'DOOR',label:'door',roomId:'OFFICE'}]
});

test('extracts after-time window from a V2.4 expectation command',()=>{
 const r=interpretTemporalGoalCommand('Make sure the office is empty after 6 PM',context(),[],[],1000);
 assert.equal(r.status,'ready');assert.equal(r.intent,'create');
 assert.equal(r.goal.temporalPolicy.mode,'window');assert.equal(r.goal.temporalPolicy.startMinute,1080);
});
test('extracts deadline policy from by-time language',()=>{
 const r=interpretTemporalGoalCommand('keys should be by the door by 6 PM',context(),[],[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.temporalPolicy.mode,'deadline');assert.equal(r.goal.temporalPolicy.deadlineMinute,1080);
});
test('supports overnight expectation',()=>{
 const r=interpretTemporalGoalCommand('keys should be by the door overnight',context(),[],[],1000);
 assert.equal(r.status,'ready');assert.equal(r.goal.temporalPolicy.startMinute,1200);assert.equal(r.goal.temporalPolicy.endMinute,359);
});
test('supports weekday morning schedule',()=>{
 const x=extractTemporalClause('Make sure the office is empty weekday mornings');
 assert.deepEqual(x.temporalPolicy.days,[1,2,3,4,5]);assert.equal(x.temporalPolicy.startMinute,360);
});
test('updates grace period conversationally',()=>{
 const goals=[{id:'G1',label:'Office empty',type:'standing-expectation'}];
 const r=interpretTemporalGoalCommand('Give goal G1 15 minutes before warning me',context(),goals,[],1000);
 assert.equal(r.status,'ready');assert.equal(r.intent,'set-grace');assert.equal(r.graceMs,900000);
});
test('updates goal daypart and weekdays conversationally',()=>{
 const goals=[{id:'G1',label:'Office empty',type:'standing-expectation'}];
 let r=interpretTemporalGoalCommand('Only check goal G1 at night',context(),goals,[],1000);
 assert.equal(r.intent,'set-temporal-policy');assert.equal(r.temporalPolicy.startMinute,1200);
 r=interpretTemporalGoalCommand('Check goal G1 every weekday',context(),goals,[],1000);
 assert.equal(r.intent,'set-temporal-days');assert.deepEqual(r.days,[1,2,3,4,5]);
});
test('reports routine health and proposal management intents',()=>{
 assert.equal(interpretTemporalGoalCommand('What routines have been failing lately?',context(),[],[],1000).intent,'routine-health');
 const proposals=[{id:'P1',key:'k1',label:'Dave routine',status:'proposed'}];
 assert.equal(interpretTemporalGoalCommand('Show learned routine proposals',context(),[],proposals,1000).intent,'list-learning-proposals');
 assert.equal(interpretTemporalGoalCommand('Confirm proposal P1',context(),[],proposals,1000).proposal.id,'P1');
 assert.equal(interpretTemporalGoalCommand('Ignore proposal P1',context(),[],proposals,1000).intent,'ignore-learning-proposal');
});
test('non-temporal V2.4 commands still pass through unchanged',()=>{
 const r=interpretTemporalGoalCommand('Make sure the office is empty',context(),[],[],1000);
 assert.equal(r.status,'ready');assert.equal(r.intent,'create');assert.equal(r.goal.temporalPolicy,null);
});
