import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes imports V2.4 goal core store and language modules',()=>{
  for(const modulePath of [
    './src/physical-goal-core.js',
    './src/physical-goal-store.js',
    './src/physical-goal-language-core.js'
  ]) assert.ok(source.includes("from '"+modulePath+"'"));
  for(const symbol of [
    'evaluatePhysicalGoal','evaluatePhysicalGoals','normalizePhysicalGoal',
    'listPhysicalGoals','savePhysicalGoal','savePhysicalGoalEvent',
    'interpretPhysicalGoalCommand'
  ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
});

test('Agent Eyes exposes V2.4 goal and routine APIs',()=>{
  for(const symbol of [
    'addPhysicalGoal','removePhysicalGoal','getPhysicalGoals','getPhysicalGoalHistory',
    'clearPhysicalGoalHistory','interpretPhysicalGoal','processPhysicalGoalCommand',
    'runPhysicalRoutine','subscribePhysicalGoals'
  ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
});

test('physical goals evaluate on governed semantic Agent context changes',()=>{
  const refresh=source.indexOf("function refreshAgentContext(");
  const goals=source.indexOf("void evaluatePhysicalGoalsRuntime(previous, next, reason, now);",refresh);
  assert.ok(refresh>=0);assert.ok(goals>refresh);
});

test('goal context requires online room camera coverage for empty assertions',()=>{
  const start=source.indexOf('function physicalGoalContextFromAgent(');
  const end=source.indexOf('function physicalGoalCommandContext(',start);
  const block=source.slice(start,end);
  assert.match(block,/allowVisualObservation !== false && hasOnlineCamera/);
  assert.match(block,/\['online','starting'\]/);
});

test('goal anchor evidence comes only from recent semantic spatial memory',()=>{
  const start=source.indexOf('function physicalGoalContextFromAgent(');
  const end=source.indexOf('function physicalGoalCommandContext(',start);
  const block=source.slice(start,end);
  assert.match(block,/runtime\.spatialMemory\.entities/);
  assert.match(block,/now - Number\(latest\.timestamp\) <= 60000/);
});

test('goal events persist and emit browser-level semantic event',()=>{
  assert.match(source,/savePhysicalGoalEvent\(event\)/);
  assert.match(source,/tracky:physical-goal/);
  assert.match(source,/physicalGoalListeners/);
});

test('briefing-eligible goal events enter existing governed Agent briefing queue',()=>{
  const start=source.indexOf('async function publishPhysicalGoalEvent(');
  const end=source.indexOf('async function evaluatePhysicalGoalsRuntime(',start);
  const block=source.slice(start,end);
  assert.match(block,/event\.briefingEligible/);
  assert.match(block,/buildPhysicalGoalBriefing/);
  assert.match(block,/queueAgentBriefing/);
});

test('V2.4 startup loads goals and evaluates standing expectations after Agent context baseline',()=>{
  const load=source.indexOf('await initializePhysicalGoals();');
  const baseline=source.indexOf('runtime.agentContext = currentAgentContext({}, Date.now());');
  const evaluate=source.indexOf("await evaluatePhysicalGoalsRuntime({}, runtime.agentContext, 'startup', Date.now());");
  assert.ok(load>=0);assert.ok(baseline>load);assert.ok(evaluate>baseline);
});

test('V2.4 integration retains no autonomous physical execution authority',()=>{
  assert.doesNotMatch(source,/sendDeviceCommand|unlockDoor|openGarage|armSecuritySystem/);
});
