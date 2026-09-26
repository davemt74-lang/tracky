import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createRoutineLearningState,observeRoutineTransitions,observeTemporalLocations,
 confirmRoutineLearningProposal,ignoreRoutineLearningProposal,proposalToPhysicalGoal,routineLearningProposals
} from '../src/routine-learning-core.js';

const transition=(from,to,t=1000)=>({id:'E'+t,type:'participant.room_transition',participantId:'p1',participantName:'Dave',fromRoomId:from,toRoomId:to,confidence:.9,timestamp:t});

test('repeated semantic sequences across multiple sessions create proposal only',()=>{
 let state=createRoutineLearningState(),now=1000;
 const sessions=['s1','s2','s3','s3'];
 for(let i=0;i<4;i++){
   const base=now+i*100000;
   let r=observeRoutineTransitions(state,[transition('OFFICE','HALL',base),transition('HALL','ENTRY',base+1000)],sessions[i],base+1000);
   state=r.state;
 }
 const proposals=routineLearningProposals(state);
 assert.ok(proposals.some(p=>p.type==='sequence-routine'));
 assert.ok(proposals.every(p=>p.status==='proposed'));
});
test('sequence evidence never stitches transitions across separate sessions',()=>{
 let state=createRoutineLearningState();
 state=observeRoutineTransitions(state,[transition('OFFICE','HALL',1000)],'s1',1000).state;
 state=observeRoutineTransitions(state,[transition('HALL','ENTRY',2000)],'s2',2000).state;
 assert.equal(Object.keys(state.sequences).length,0);
});

test('sequence proposal threshold is not met from one session alone',()=>{
 let state=createRoutineLearningState();
 for(let i=0;i<6;i++){
   const base=1000+i*100000;
   state=observeRoutineTransitions(state,[transition('OFFICE','HALL',base),transition('HALL','ENTRY',base+1000)],'same-session',base+1000).state;
 }
 assert.equal(routineLearningProposals(state).length,0);
});
test('confirmed sequence proposal converts to inactive-authority physical routine definition',()=>{
 let state=createRoutineLearningState();
 for(const [i,s] of ['s1','s2','s3','s3'].entries()){
   const base=1000+i*100000;
   state=observeRoutineTransitions(state,[transition('OFFICE','HALL',base),transition('HALL','ENTRY',base+1000)],s,base+1000).state;
 }
 const p=routineLearningProposals(state)[0];
 const confirmed=confirmRoutineLearningProposal(state,p.id,999999);
 const goal=proposalToPhysicalGoal(confirmed,1000000);
 assert.equal(goal.type,'routine');assert.equal(goal.origin,'learned-confirmed');assert.ok(goal.sequence.steps.length>=2);
 assert.equal('execute' in goal,false);
});
test('ignored proposal cannot be silently re-proposed',()=>{
 let state=createRoutineLearningState();
 for(const [i,s] of ['s1','s2','s3','s3'].entries()){
   const base=1000+i*100000;
   state=observeRoutineTransitions(state,[transition('OFFICE','HALL',base),transition('HALL','ENTRY',base+1000)],s,base+1000).state;
 }
 const p=routineLearningProposals(state)[0];ignoreRoutineLearningProposal(state,p.id,900000);
 for(let i=0;i<3;i++){
   const base=1000000+i*100000;
   state=observeRoutineTransitions(state,[transition('OFFICE','HALL',base),transition('HALL','ENTRY',base+1000)],'s'+(4+i),base+1000).state;
 }
 assert.equal(routineLearningProposals(state).filter(x=>x.key===p.key).length,0);
});
test('dominant temporal location across sessions becomes proposal',()=>{
 let state=createRoutineLearningState();
 const base=new Date(2026,8,21,18,0,0).getTime();
 for(let i=0;i<8;i++){
   const dayOffset=[0,1,2,3,4,7,8,9][i];
   const now=base+dayOffset*86400000;
   const context={people:[],objects:[{objectId:'O1',label:'keys',roomId:'OFFICE',presence:'confirmed',confidence:.9}],currentAnchors:{O1:{anchorId:'DOOR',anchorLabel:'door',roomId:'OFFICE',confidence:.9}}};
   state=observeTemporalLocations(state,context,'session-'+Math.min(i,4),now).state;
 }
 const p=routineLearningProposals(state).find(x=>x.type==='temporal-location');
 assert.ok(p);assert.equal(p.anchorId,'DOOR');assert.equal(p.temporalPolicy.mode,'window');
 const goal=proposalToPhysicalGoal(confirmRoutineLearningProposal(state,p.id,base+999999),base+1000000);
 assert.equal(goal.type,'standing-expectation');assert.equal(goal.expectation.kind,'entity-at-anchor');assert.equal(goal.origin,'learned-confirmed');
});
