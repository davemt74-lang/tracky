import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/forecast-calibration-store.js',import.meta.url),'utf8');

test('forecast calibration persistence is local IndexedDB semantic storage',()=>{
  assert.match(source,/indexedDB/);
  assert.match(source,/tracky-forecast-calibration-v1/);
});

test('forecast calibration store exposes load save and clear',()=>{
  for(const name of ['loadForecastCalibrationState','saveForecastCalibrationState','clearForecastCalibrationState']){
    assert.match(source,new RegExp('export async function '+name));
  }
});

test('forecast calibration persistence is bounded by centralized reliability policy',()=>{
  assert.match(source,/RELIABILITY_POLICY\.calibration\.maxPredictions/);
  assert.match(source,/RELIABILITY_POLICY\.calibration\.maxSettlements/);
});
