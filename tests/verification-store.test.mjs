import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerificationState, verificationSnapshot } from '../src/verification-core.js';

test('verification snapshot persists only semantic request history',()=>{
  const state=createVerificationState();
  state.history.push({
    id:'VER1',signature:'x',status:'verified',result:'verified',
    completedAt:1000,evidence:[{id:'E1',source:'camera',outcome:'supporting'}]
  });
  const snapshot=verificationSnapshot(state);
  assert.equal(snapshot.history.length,1);
  assert.equal(snapshot.history[0].result,'verified');
  assert.doesNotThrow(()=>JSON.stringify(snapshot));
});
