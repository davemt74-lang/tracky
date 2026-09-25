import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialMemoryState, spatialMemorySnapshot } from '../src/spatial-memory-core.js';

test('spatial memory snapshot is serializable and excludes session internals',()=>{
  const state=createSpatialMemoryState();
  state.entities.WO1={id:'WO1',label:'phone',type:'object',history:[]};
  const snapshot=spatialMemorySnapshot(state);
  assert.equal(snapshot.entities.WO1.label,'phone');
  assert.equal(snapshot.sessionId,undefined);
  assert.doesNotThrow(()=>JSON.stringify(snapshot));
});
