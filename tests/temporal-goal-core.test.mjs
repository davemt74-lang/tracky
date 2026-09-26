import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoutineHealth,
  evaluateTemporalPhysicalGoal,
  normalizeTemporalPolicy,
  temporalPolicyStatus
} from '../src/temporal-goal-core.js';

const context=()=>({
  people:[],
  objects:[{objectId:'O1',label:'keys',roomId:'OFFICE',presence:'confirmed',confidence:.9}],
  roomObservability:{OFFICE:true,KITCHEN:true},
  roomCoverageConfidence:{OFFICE:.95,KITCHEN:.95},
  currentAnchors:{O1:{anchorId:'DESK',roomId:'OFFICE',confidence:.9}}
});
const local=(y,m,d,h,min=0)=>new Date(y,m-1,d,h,min,0,0).getTime();

test('normalizes local temporal policy and bounded grace',()=>{
 const p=normalizeTemporalPolicy({mode:'window',days:[5,1,1,9],startMinute:100,endMinute:200,graceMs:999999999});
 assert.deepEqual(p.days,[1,5]);assert.equal(p.graceMs,86400000);assert.equal(p.clock,'local');
});
test('weekday window activates only inside local window',()=>{
 const mondayMorning=local(2026,9,21,9,0);
 const mondayLate=local(2026,9,21,19,0);
 const p={mode:'window',days:[1,2,3,4,5],startMinute:480,endMinute:720};
 assert.equal(temporalPolicyStatus(p,mondayMorning).active,true);
 assert.equal(temporalPolicyStatus(p,mondayLate).active,false);
});
test('cross-midnight window remains active after midnight from prior allowed day',()=>{
 const mondayNight=local(2026,9,21,23,0);
 const tuesdayEarly=local(2026,9,22,2,0);
 const p={mode:'window',days:[1],startMinute:1200,endMinute:359};
 assert.equal(temporalPolicyStatus(p,mondayNight).active,true);
 assert.equal(temporalPolicyStatus(p,tuesdayEarly).active,true);
});
test('deadline stays inactive until due',()=>{
 const p={mode:'deadline',deadlineMinute:1080};
 assert.equal(temporalPolicyStatus(p,local(2026,9,21,17,59)).active,false);
 assert.equal(temporalPolicyStatus(p,local(2026,9,21,18,0)).active,true);
});
test('temporal standing expectation honors durable grace before briefing event',()=>{
 const c=context();
 const goal={
  id:'G1',type:'standing-expectation',label:'Keys in kitchen',severity:'medium',
  expectation:{kind:'entity-in-room',subjectId:'O1',roomId:'KITCHEN'},
  temporalPolicy:{mode:'window',startMinute:0,endMinute:1439,graceMs:15*60*1000}
 };
 const start=local(2026,9,21,10,0);
 let r=evaluateTemporalPhysicalGoal(goal,c,c,start);
 assert.equal(r.events.length,0);assert.equal(r.goal.temporalState.pendingViolationSince,start);
 r=evaluateTemporalPhysicalGoal(r.goal,c,c,start+14*60*1000);
 assert.equal(r.events.length,0);
 r=evaluateTemporalPhysicalGoal(r.goal,c,c,start+15*60*1000);
 assert.equal(r.events[0].type,'persistent-goal-violation');
 assert.equal(r.goal.temporalState.violationNotifiedAt,start+15*60*1000);
});
test('deadline violation emits expected-window-missed after grace',()=>{
 const c=context(),due=local(2026,9,21,18,0);
 const goal={id:'G1',type:'standing-expectation',label:'Keys by desk',expectation:{kind:'entity-at-anchor',subjectId:'O1',anchorId:'DOOR'},temporalPolicy:{mode:'deadline',deadlineMinute:1080,graceMs:60000}};
 let r=evaluateTemporalPhysicalGoal(goal,c,c,due);
 assert.equal(r.events.length,0);
 r=evaluateTemporalPhysicalGoal(r.goal,c,c,due+60000);
 assert.equal(r.events[0].type,'expected-window-missed');
});
test('inactive temporal window does not claim violation',()=>{
 const c=context();
 const goal={id:'G1',type:'standing-expectation',label:'Keys kitchen',expectation:{kind:'entity-in-room',subjectId:'O1',roomId:'KITCHEN'},temporalPolicy:{mode:'window',startMinute:1200,endMinute:359}};
 const r=evaluateTemporalPhysicalGoal(goal,c,c,local(2026,9,21,12,0));
 assert.equal(r.events.length,0);assert.equal(r.goal.temporalState.lastTemporalState,'inactive');
});
test('unknown evidence resets continuous violation grace',()=>{
 const c=context(),start=local(2026,9,21,10,0);
 const goal={id:'G1',type:'standing-expectation',label:'Keys kitchen',expectation:{kind:'entity-in-room',subjectId:'O1',roomId:'KITCHEN'},temporalPolicy:{mode:'always',graceMs:60000}};
 let r=evaluateTemporalPhysicalGoal(goal,c,c,start);
 const unknown=context();unknown.objects[0].presence='last-known';
 r=evaluateTemporalPhysicalGoal(r.goal,c,unknown,start+30000);
 assert.equal(r.goal.temporalState.pendingViolationSince,null);
 r=evaluateTemporalPhysicalGoal(r.goal,unknown,c,start+70000);
 assert.equal(r.events.length,0);
});
test('routine grace rechecks current physical state before warning',()=>{
 const before={...context(),people:[{participantId:'p1',label:'Dave',roomId:'OFFICE',presence:'confirmed',confidence:.9}]};
 const after={...context(),people:[{participantId:'p1',label:'Dave',roomId:'HALL',presence:'confirmed',confidence:.9},{participantId:'p2',label:'Alex',roomId:'OFFICE',presence:'confirmed',confidence:.9}]};
 const goal={id:'R1',type:'routine',label:'Office exit',trigger:{kind:'entity-leaves-room',subjectId:'p1',roomId:'OFFICE'},checks:[{kind:'room-empty',roomId:'OFFICE'}],temporalPolicy:{mode:'always',graceMs:60000},cooldownMs:0};
 let r=evaluateTemporalPhysicalGoal(goal,before,after,1000);
 assert.equal(r.events.length,0);assert.equal(r.goal.temporalState.pendingRoutineSince,1000);
 const clear={...after,people:[{participantId:'p1',label:'Dave',roomId:'HALL',presence:'confirmed',confidence:.9}]};
 r=evaluateTemporalPhysicalGoal(r.goal,clear,clear,61001);
 assert.equal(r.events.length,0);assert.equal(r.goal.lastState,'met');
});
test('routine health reports factual completion and deviation counts',()=>{
 const goals=[{id:'R1',type:'routine',label:'Exit routine',enabled:true}];
 const now=1000000;
 const events=[
  {goalId:'R1',type:'routine-complete',generatedAt:now-1000},
  {goalId:'R1',type:'routine-step-skipped',generatedAt:now-2000},
  {goalId:'R1',type:'routine-unknown',generatedAt:now-3000}
 ];
 const h=buildRoutineHealth(goals,events,now,10000)[0];
 assert.equal(h.completed,1);assert.equal(h.deviations,1);assert.equal(h.unknown,1);assert.equal(h.completionRate,.5);
});
