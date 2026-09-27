import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes loads and persists V2.76 forecast calibration state',()=>{
  assert.match(source,/createForecastCalibrationState/);
  assert.match(source,/loadForecastCalibrationState/);
  assert.match(source,/saveForecastCalibrationState/);
  assert.match(source,/initializeForecastCalibration/);
  assert.match(source,/forecastCalibrationLastSavedAt/);
});

test('Agent Eyes exposes record settle calibrate report and clear APIs',()=>{
  for(const name of [
    'getForecastCalibrationReport',
    'calibrateForecastConfidence',
    'recordForecastPrediction',
    'settleForecastPrediction',
    'clearForecastCalibration'
  ]){
    assert.ok(source.includes(name),'missing Agent Eyes API: '+name);
  }
});

test('world snapshot includes calibration report but not a parallel truth authority',()=>{
  assert.match(source,/forecastCalibration:\s*forecastCalibrationReport\(runtime\.forecastCalibration\)/);
  assert.doesNotMatch(source,/forecastCalibration.*authorityRank/);
});

test('calibration startup occurs before physical goal evaluation',()=>{
  const init=source.indexOf('await initializeForecastCalibration();');
  const goals=source.indexOf('await initializePhysicalGoals();');
  assert.ok(init>0&&goals>init);
});
