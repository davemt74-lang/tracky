import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePhysicalExpectation,evaluatePhysicalGoal,evaluatePhysicalGoals,normalizePhysicalGoal} from '../src/physical-goal-core.js';

const context=()=>({
  people:[
    {participantId:'p1',label:'Dave',roomId:'ROOM01',presence:'confirmed',confidence:.95},
    {participantId:'p2',label:'Sarah',roomId:'ROOM02',presence:'confirmed',confidence:.9}
  ],
  objects:[
    {objectId:'O1',label:'keys',roomId:'ROOM01',presence:'confirmed',confidence:.88}
  ],
  roomObservability:{ROOM01:true,ROOM02:true,PRIVATE:false},
  currentAnchors:{O1:{anchorId:'A1',roomId:'ROOM01',confidence:.85}}
});

test('normalizes standing expectation with compact governed fields',()=>{
 const g=normalizePhysicalGoal({type:'standing-expectation',label:'Keys stay office',expectation:{kind:'entity-in-room',subjectId:'O1',roomId:'ROOM01'},rawPayload:{secret:true}},1000);
 assert.equal(g.type,'standing-expectation');assert.equal(g.expectations.length,1);assert.equal('rawPayload' in g,false);
});
test('entity-in-room expectation distinguishes met and violated',()=>{
 const c=context();
 assert.equal(evaluatePhysicalExpectation({kind:'entity-in-room',subjectId:'O1',roomId:'ROOM01'},c).state,'met');
 assert.equal(evaluatePhysicalExpectation({kind:'entity-in-room',subjectId:'O1',roomId:'ROOM02'},c).state,'violated');
});
test('missing or stale entity produces unknown rather than false violation',()=>{
 const c=context();c.objects[0].presence='last-known';
 assert.equal(evaluatePhysicalExpectation({kind:'entity-in-room',subjectId:'O1',roomId:'ROOM01'},c).state,'unknown');
 assert.equal(evaluatePhysicalExpectation({kind:'entity-in-room',subjectId:'missing',roomId:'ROOM01'},c).state,'unknown');
});
test('room-empty respects observation policy',()=>{
 const c=context();
 assert.equal(evaluatePhysicalExpectation({kind:'room-empty',roomId:'ROOM01'},c).state,'violated');
 c.people=c.people.filter(x=>x.roomId!=='ROOM01');
 assert.equal(evaluatePhysicalExpectation({kind:'room-empty',roomId:'ROOM01'},c).state,'met');
 assert.equal(evaluatePhysicalExpectation({kind:'room-empty',roomId:'PRIVATE'},c).state,'unknown');
});
test('entity-at-anchor uses current governed semantic anchor evidence',()=>{
 const c=context();
 assert.equal(evaluatePhysicalExpectation({kind:'entity-at-anchor',subjectId:'O1',anchorId:'A1'},c).state,'met');
 assert.equal(evaluatePhysicalExpectation({kind:'entity-at-anchor',subjectId:'O1',anchorId:'A2'},c).state,'violated');
 delete c.currentAnchors.O1;
 assert.equal(evaluatePhysicalExpectation({kind:'entity-at-anchor',subjectId:'O1',anchorId:'A1'},c).state,'unknown');
});
test('standing expectation emits only on violation transition and restoration',()=>{
 const c=context();
 const base={id:'G1',type:'standing-expectation',label:'Keys stay kitchen',cooldownMs:0,expectation:{kind:'entity-in-room',subjectId:'O1',roomId:'ROOM02'}};
 let r=evaluatePhysicalGoal(base,{},c,1000);assert.equal(r.events[0].type,'expectation-violated');assert.equal(r.goal.lastState,'violated');
 r=evaluatePhysicalGoal(r.goal,c,c,2000);assert.equal(r.events.length,0);
 c.objects[0].roomId='ROOM02';
 r=evaluatePhysicalGoal(r.goal,{},c,3000);assert.equal(r.events[0].type,'expectation-restored');assert.equal(r.goal.lastState,'met');
});
test('routine evaluates checks when participant leaves watched room',()=>{
 const before=context(),after=context();after.people[0]={...after.people[0],roomId:'ROOM02'};
 const goal={id:'G1',type:'routine',label:'Office exit check',cooldownMs:0,trigger:{kind:'entity-leaves-room',subjectId:'p1',subjectKind:'person',roomId:'ROOM01'},checks:[{kind:'room-empty',roomId:'ROOM01'}]};
 const r=evaluatePhysicalGoal(goal,before,after,2000);
 assert.equal(r.events.length,1);assert.equal(r.events[0].type,'routine-complete');assert.equal(r.events[0].state,'met');
});
test('routine reports needs-attention when a check is violated',()=>{
 const before=context(),after=context();after.people[0]={...after.people[0],roomId:'ROOM02'};after.people.push({participantId:'p3',label:'Alex',roomId:'ROOM01',presence:'confirmed',confidence:.9});
 const goal={id:'G1',type:'routine',label:'Office exit check',cooldownMs:0,trigger:{kind:'entity-leaves-room',subjectId:'p1',roomId:'ROOM01'},checks:[{kind:'room-empty',roomId:'ROOM01'}]};
 const r=evaluatePhysicalGoal(goal,before,after,2000);
 assert.equal(r.events[0].type,'routine-needs-attention');assert.equal(r.events[0].briefingEligible,true);
});
test('baseline reconstruction can suppress recurring routine triggers',()=>{
 const before={people:[],objects:[],roomObservability:{ROOM01:true},currentAnchors:{}};
 const after=context();
 const goal={id:'G-enter',type:'routine',label:'Entry check',cooldownMs:0,trigger:{kind:'entity-enters-room',subjectId:'p1',roomId:'ROOM01'},checks:[{kind:'room-empty',roomId:'ROOM02'}]};
 const r=evaluatePhysicalGoal(goal,before,after,1000,{suppressRoutineTriggers:true});
 assert.equal(r.events.length,0);
});
test('routine supports multiple ordered semantic checks',()=>{
 const before=context(),after=context();
 after.people[0]={...after.people[0],roomId:'ROOM02'};
 const goal={id:'G-multi',type:'routine',label:'Exit checklist',cooldownMs:0,trigger:{kind:'entity-leaves-room',subjectId:'p1',roomId:'ROOM01'},checks:[
  {kind:'room-empty',roomId:'ROOM01'},
  {kind:'entity-in-room',subjectId:'O1',roomId:'ROOM01'}
 ]};
 const r=evaluatePhysicalGoal(goal,before,after,2000);
 assert.equal(r.events[0].checks.length,2);
 assert.equal(r.events[0].state,'met');
});

test('routine supports manual execution',()=>{
 const c=context();c.people=c.people.filter(x=>x.roomId!=='ROOM01');
 const goal={id:'G1',type:'routine',label:'Office check',cooldownMs:0,trigger:{kind:'manual'},checks:[{kind:'room-empty',roomId:'ROOM01'}]};
 const r=evaluatePhysicalGoal(goal,c,c,2000,{manual:true});
 assert.equal(r.events[0].type,'routine-complete');
});
test('routine unknown result does not claim a violation',()=>{
 const before=context(),after=context();after.people[0]={...after.people[0],roomId:'ROOM02'};
 const goal={id:'G1',type:'routine',label:'Private exit check',cooldownMs:0,trigger:{kind:'entity-leaves-room',subjectId:'p1',roomId:'ROOM01'},checks:[{kind:'room-empty',roomId:'PRIVATE'}]};
 const r=evaluatePhysicalGoal(goal,before,after,2000);
 assert.equal(r.events[0].type,'routine-unknown');assert.equal(r.events[0].briefingEligible,false);
});
test('disabled goals and cooldown suppress events',()=>{
 const before=context(),after=context();after.people[0]={...after.people[0],roomId:'ROOM02'};
 assert.equal(evaluatePhysicalGoal({id:'G1',enabled:false,type:'routine',trigger:{kind:'entity-leaves-room',subjectId:'p1',roomId:'ROOM01'},checks:[{kind:'room-empty',roomId:'ROOM01'}]},before,after,2000).events.length,0);
 assert.equal(evaluatePhysicalGoal({id:'G2',type:'routine',lastTriggeredAt:1900,cooldownMs:5000,trigger:{kind:'entity-leaves-room',subjectId:'p1',roomId:'ROOM01'},checks:[{kind:'room-empty',roomId:'ROOM01'}]},before,after,2000).events.length,0);
});
test('batch evaluator returns updated goals and semantic events',()=>{
 const c=context();
 const r=evaluatePhysicalGoals([{id:'G1',type:'standing-expectation',label:'Keys kitchen',cooldownMs:0,expectation:{kind:'entity-in-room',subjectId:'O1',roomId:'ROOM02'}}],{},c,1000);
 assert.equal(r.goals.length,1);assert.equal(r.events.length,1);
 assert.ok(r.events[0].boundaries.includes('privacy-governed-context'));
 assert.doesNotMatch(JSON.stringify(r.events[0]),/imageDataUrl|embedding|descriptor|rawPayload|transcript/);
});
