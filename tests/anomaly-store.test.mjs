import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnomalyState,anomalySnapshot} from '../src/anomaly-core.js';

test('anomaly snapshot persistence contract is serializable',()=>{
  const state=createAnomalyState();
  const snapshot=anomalySnapshot(state);
  assert.equal(snapshot.schemaVersion,1);
  assert.doesNotThrow(()=>JSON.stringify(snapshot));
});
