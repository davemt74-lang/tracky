import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttentionState,attentionSnapshot} from '../src/attention-core.js';

test('attention state snapshot is serializable',()=>{
  const state=createAttentionState();
  state.items.push({key:'a',type:'system',priority:.5,state:'pending'});
  const snapshot=attentionSnapshot(state);
  assert.equal(snapshot.items.length,1);
  assert.doesNotThrow(()=>JSON.stringify(snapshot));
});
