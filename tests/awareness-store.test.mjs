import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awarenessSnapshot,
  createAwarenessState,
  defaultAwarenessPolicy
} from '../src/awareness-core.js';

test('awareness state and policy are serializable',()=>{
  const state=createAwarenessState();
  const policy=defaultAwarenessPolicy();
  assert.doesNotThrow(()=>JSON.stringify(awarenessSnapshot(state)));
  assert.doesNotThrow(()=>JSON.stringify(policy));
  assert.equal(policy.speakHighSeverity,false);
});
