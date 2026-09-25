import test from 'node:test';
import assert from 'node:assert/strict';
import {
  idsToPrune,
  MAX_SCENE_CHANGES,
  MAX_SCENE_EPISODES
} from '../src/scene-store.js';

test('scene store pruning removes oldest changes first', () => {
  const rows=Array.from({length:MAX_SCENE_CHANGES+2},(_,index)=>({
    id:'c'+index,timestamp:index
  }));
  assert.deepEqual(idsToPrune(rows,MAX_SCENE_CHANGES),['c0','c1']);
});

test('scene episode retention is independently bounded', () => {
  const rows=Array.from({length:MAX_SCENE_EPISODES+1},(_,index)=>({
    id:'e'+index,startedAt:index
  }));
  assert.deepEqual(idsToPrune(rows,MAX_SCENE_EPISODES),['e0']);
});
