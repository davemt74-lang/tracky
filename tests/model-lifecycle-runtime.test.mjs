import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes loads and persists V2.77 model lifecycle state',()=>{
  for(const symbol of [
    'createModelLifecycleState','loadModelLifecycleState','saveModelLifecycleState',
    'initializeModelLifecycle','persistModelLifecycle','modelLifecycleLastSavedAt'
  ]) assert.ok(source.includes(symbol),'missing '+symbol);
});

test('V2.76 settlement feeds V2.77 lifecycle accuracy and health evaluation',()=>{
  assert.match(source,/importCalibrationReport\(runtime\.modelLifecycle, report, now\)/);
  assert.match(source,/enforceLatestActiveHealth/);
  assert.match(source,/model\.lifecycle_changed/);
});

test('Agent Eyes exposes V2.77 lifecycle APIs',()=>{
  for(const symbol of [
    'getModelLifecycleReport','registerModelCandidate','recordModelAccuracy',
    'recordGoldenScenarioEvaluation','promoteModel','canaryAssignment',
    'registerEnvironmentCalibrationProfile','selectEnvironmentCalibrationProfile',
    'evaluateActiveModelHealth','clearModelLifecycle'
  ]) assert.ok(source.includes(symbol),'missing '+symbol);
});

test('world snapshot exposes lifecycle separately from calibration and ground truth',()=>{
  assert.match(source,/forecastCalibration:\s*forecastCalibrationReport\(runtime\.forecastCalibration\)/);
  assert.match(source,/modelLifecycle:\s*modelLifecycleReport\(runtime\.modelLifecycle\)/);
  assert.match(source,/groundTruth:\s*groundTruthSnapshot\(runtime\.groundTruth\)/);
});

test('model lifecycle initializes after calibration and before physical goals',()=>{
  const calibration=source.indexOf('await initializeForecastCalibration();');
  const lifecycle=source.indexOf('await initializeModelLifecycle();');
  const goals=source.indexOf('await initializePhysicalGoals();');
  assert.ok(calibration>0&&lifecycle>calibration&&goals>lifecycle);
});
