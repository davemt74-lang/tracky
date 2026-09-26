import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes imports V2.5 temporal sequence learning modules',()=>{
 for(const modulePath of [
  './src/temporal-goal-core.js','./src/temporal-goal-language-core.js',
  './src/routine-sequence-core.js','./src/routine-learning-core.js','./src/routine-learning-store.js'
 ]) assert.ok(source.includes("from '"+modulePath+"'"));
});
test('physical goal runtime evaluates through temporal core',()=>{
 assert.match(source,/evaluateTemporalPhysicalGoals/);
 assert.match(source,/evaluateTemporalPhysicalGoal/);
 assert.doesNotMatch(source,/const result = evaluatePhysicalGoals\(/);
});
test('temporal state and sequence progress are persisted durably',()=>{
 const start=source.indexOf('async function evaluatePhysicalGoalsRuntime(');
 const end=source.indexOf('function resetSequenceState(',start);
 const block=source.slice(start,end);
 assert.match(block,/before\.temporalState/);
 assert.match(block,/before\.sequenceState/);
 assert.match(block,/savePhysicalGoal\(goal\)/);
});
test('multi-room transitions feed sequence runtime and proposal learner',()=>{
 assert.match(source,/processSequenceRoutineEvents\(multiRoomEvents, now\)/);
 assert.match(source,/observeRoutineLearningRuntime\(multiRoomEvents, now\)/);
});
test('learning filters transitions through retention and observation policy',()=>{
 const start=source.indexOf('function routineLearningTransitionAllowed(');
 const end=source.indexOf('async function publishRoutineLearningProposal(',start);
 const block=source.slice(start,end);
 assert.match(block,/spatialMemoryRetentionAllowed/);
 assert.match(block,/allowParticipantIdentity === false/);
 assert.match(block,/allowObjectObservation === false/);
});
test('temporal-location learning independently enforces cross-session retention permissions',()=>{
 const start=source.indexOf('function routineLearningLocationContext(');
 const end=source.indexOf('async function observeRoutineLearningRuntime(',start);
 const block=source.slice(start,end);
 assert.match(block,/spatialMemoryRetentionAllowed/);
 assert.match(block,/allowParticipantIdentity !== false/);
 assert.match(block,/allowObjectObservation !== false/);
 assert.match(block,/allowVisualObservation !== false/);
 assert.match(block,/currentAnchors/);
});

test('learned proposals only activate through explicit confirmation handler',()=>{
 const start=source.indexOf('async function confirmRoutineLearningProposalRuntime(');
 const end=source.indexOf('async function ignoreRoutineLearningProposalRuntime(',start);
 const block=source.slice(start,end);
 assert.match(block,/confirmRoutineLearningProposal/);
 assert.match(block,/proposalToPhysicalGoal/);
 assert.match(block,/addAndEvaluatePhysicalGoal/);
});
test('proposal discovery itself does not create a goal',()=>{
 const start=source.indexOf('async function observeRoutineLearningRuntime(');
 const end=source.indexOf('async function confirmRoutineLearningProposalRuntime(',start);
 const block=source.slice(start,end);
 assert.doesNotMatch(block,/addAndEvaluatePhysicalGoal/);
 assert.match(block,/publishRoutineLearningProposal/);
});
test('temporal timer evaluates deadlines grace and sequence timeouts without context changes',()=>{
 assert.match(source,/temporal-timer/);
 assert.match(source,/tickSequenceRoutinesRuntime\(now\)/);
});
test('V2.5 APIs expose health temporal interpretation and learning governance',()=>{
 for(const symbol of [
  'interpretTemporalGoal','getRoutineHealth','getRoutineLearning','getRoutineLearningProposals',
  'confirmRoutineLearningProposal','ignoreRoutineLearningProposal','clearRoutineLearning','subscribeRoutineLearning'
 ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
});
test('V2.5 retains no autonomous physical execution authority',()=>{
 assert.doesNotMatch(source,/sendDeviceCommand|unlockDoor|openGarage|armSecuritySystem/);
});
