import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes explicitly imports V1.9 query runtime dependencies',()=>{
  assert.match(source,/from ['"]\.\/src\/world-query-core\.js['"]/);
  assert.match(source,/from ['"]\.\/src\/world-query-store\.js['"]/);
  for(const symbol of ['answerPhysicalWorldQuery','buildEvidenceBundle','buildWorldTimeline','clearWorldQueries','listWorldQueries','saveWorldQuery']){
    assert.match(source,new RegExp('\\b'+symbol+'\\b'));
  }
});

test('Agent Eyes explicitly imports and exposes V2.0 governed Agent context',()=>{
  assert.match(source,/from ['"]\.\/src\/agent-context-core\.js['"]/);
  for(const symbol of ['buildAgentContext','diffAgentContext','getAgentContext','getAgentContextDelta','subscribeAgentContext']){
    assert.match(source,new RegExp('\\b'+symbol+'\\b'));
  }
  assert.match(source,/tracky:agent-context/);
});

test('Agent context refresh is driven by semantic perception events',()=>{
  assert.match(source,/refreshAgentContext\('perception:' \+ event\.type/);
});

test('Agent context integration does not introduce physical execution authority',()=>{
  assert.doesNotMatch(source,/executePhysicalAction|sendDeviceCommand|unlockDoor|openGarage/);
});
