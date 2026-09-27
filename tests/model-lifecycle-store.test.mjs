import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/model-lifecycle-store.js',import.meta.url),'utf8');

test('model lifecycle persistence is local IndexedDB storage',()=>{
  assert.match(source,/indexedDB/);
  assert.match(source,/tracky-model-lifecycle-v1/);
});

test('model lifecycle store exposes load save and clear',()=>{
  for(const name of ['loadModelLifecycleState','saveModelLifecycleState','clearModelLifecycleState']){
    assert.ok(source.includes('export async function '+name),'missing '+name);
  }
});

test('model lifecycle persistence is bounded by reliability policy',()=>{
  for(const key of ['maxModels','maxEnvironmentProfiles','maxAccuracySnapshots','maxScenarioEvaluations','maxDecisions']){
    assert.ok(source.includes('RELIABILITY_POLICY.modelLifecycle.'+key),'missing bound '+key);
  }
});
