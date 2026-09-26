import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceRoutineSequence,semanticTransition,tickRoutineSequence} from '../src/routine-sequence-core.js';

const goal=()=>({
 id:'G1',type:'routine',label:'Leave routine',severity:'medium',notifyOnSuccess:false,
 sequence:{maxGapMs:60000,steps:[
  {kind:'person-room-transition',subjectId:'p1',fromRoomId:'OFFICE',toRoomId:'HALL'},
  {kind:'person-room-transition',subjectId:'p1',fromRoomId:'HALL',toRoomId:'ENTRY'},
  {kind:'person-room-transition',subjectId:'p1',fromRoomId:'ENTRY',toRoomId:'OUT'}
 ]},
 sequenceState:{}
});
const ev=(from,to,t=1000)=>({type:'participant.room_transition',participantId:'p1',fromRoomId:from,toRoomId:to,confidence:.9,timestamp:t});

test('semantic transition strips runtime event to governed sequence fields',()=>{
 const t=semanticTransition({...ev('OFFICE','HALL'),rawPayload:{x:1}});
 assert.deepEqual(t.kind,'person-room-transition');assert.equal(t.subjectId,'p1');
 assert.equal('rawPayload' in t,false);
});
test('sequence advances and completes in order',()=>{
 let g=goal();
 let r=advanceRoutineSequence(g,ev('OFFICE','HALL'),1000);g=r.goal;assert.equal(g.sequenceState.progress,1);assert.equal(r.events.length,0);
 r=advanceRoutineSequence(g,ev('HALL','ENTRY'),2000);g=r.goal;assert.equal(g.sequenceState.progress,2);
 r=advanceRoutineSequence(g,ev('ENTRY','OUT'),3000);assert.equal(r.goal.sequenceState.progress,0);assert.equal(r.events[0].type,'routine-complete');
});
test('later expected step produces skipped-step deviation',()=>{
 let r=advanceRoutineSequence(goal(),ev('OFFICE','HALL'),1000);
 r=advanceRoutineSequence(r.goal,ev('ENTRY','OUT'),2000);
 assert.equal(r.events[0].type,'routine-step-skipped');assert.equal(r.goal.sequenceState.progress,0);
});
test('unexpected transition by same subject produces path deviation',()=>{
 let r=advanceRoutineSequence(goal(),ev('OFFICE','HALL'),1000);
 r=advanceRoutineSequence(r.goal,ev('HALL','KITCHEN'),2000);
 assert.equal(r.events[0].type,'routine-sequence-deviated');
});
test('unrelated subject transition does not disrupt sequence',()=>{
 let r=advanceRoutineSequence(goal(),ev('OFFICE','HALL'),1000);
 const other={type:'participant.room_transition',participantId:'p2',fromRoomId:'X',toRoomId:'Y',confidence:.9};
 r=advanceRoutineSequence(r.goal,other,2000);
 assert.equal(r.events.length,0);assert.equal(r.goal.sequenceState.progress,1);
});
test('sequence timeout produces predictive deviation',()=>{
 let r=advanceRoutineSequence(goal(),ev('OFFICE','HALL'),1000);
 r=tickRoutineSequence(r.goal,62001);
 assert.equal(r.events[0].type,'sequence-window-missed');assert.equal(r.goal.sequenceState.progress,0);
});
test('late incoming transition emits timeout then may restart',()=>{
 let r=advanceRoutineSequence(goal(),ev('OFFICE','HALL'),1000);
 r=advanceRoutineSequence(r.goal,ev('OFFICE','HALL'),70000);
 assert.equal(r.events[0].type,'sequence-window-missed');assert.equal(r.goal.sequenceState.progress,1);
});
