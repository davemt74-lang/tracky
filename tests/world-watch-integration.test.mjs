import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes imports the governed watch engine and store',()=>{
  assert.match(source,/from ['"]\.\/src\/world-watch-core\.js['"]/);
  assert.match(source,/from ['"]\.\/src\/world-watch-store\.js['"]/);
  for(const symbol of ['evaluateWorldWatches','normalizeWorldWatch','listWorldWatches','saveWorldWatch','saveWorldWatchTrigger']){
    assert.match(source,new RegExp('\\b'+symbol+'\\b'));
  }
});

test('Agent Eyes exposes durable watch APIs and subscription',()=>{
  for(const symbol of [
    'addWorldWatch','removeWorldWatch','getWorldWatches',
    'getWorldWatchHistory','clearWorldWatchHistory','subscribeWorldWatches'
  ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
});

test('world watches are evaluated only from governed Agent-context changes',()=>{
  assert.match(source,/diffAgentContext\(previous, next\)/);
  assert.match(source,/evaluatePhysicalWorldWatches\(previous, next, delta, reason, now\)/);
  assert.match(source,/if \(!delta\.changed\)/);
});

test('watch triggers are browser-visible and do not add physical execution authority',()=>{
  assert.match(source,/tracky:world-watch/);
  assert.doesNotMatch(source,/executePhysicalAction|sendDeviceCommand|unlockDoor|openGarage/);
});

test('durable watches load before the initial Agent-context baseline is captured',()=>{
  const watchInit=source.indexOf('await initializeWorldWatches();');
  const baseline=source.indexOf('runtime.agentContext = currentAgentContext({}, Date.now());');
  assert.ok(watchInit>=0);
  assert.ok(baseline>watchInit);
});
