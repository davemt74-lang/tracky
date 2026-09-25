import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionSnapshot,
  clearActiveTask,
  computePerceptionBudget,
  createAttentionState,
  prioritizeAttention,
  resolveAttentionItem,
  setActiveTask,
  taskDerivedSignals,
  upsertAttentionItems
} from '../src/attention-core.js';

test('find-object task boosts object attention over unrelated conversation',()=>{
  const ranked=prioritizeAttention([
    {type:'conversation.started',priority:.9},
    {type:'object.missing',priority:.7,objectId:'WO1'}
  ],{mode:'find-object',targetId:'WO1'});
  assert.equal(ranked[0].type,'object.missing');
});

test('privacy and contradiction remain high priority in any task',()=>{
  const ranked=prioritizeAttention([
    {type:'privacy.policy-block',priority:1},
    {type:'object.found',priority:1}
  ],{mode:'find-object'});
  assert.equal(ranked[0].category,'privacy');
});

test('low-power budget never overrides privacy caps',()=>{
  const budget=computePerceptionBudget({
    task:{mode:'low-power'},
    policy:{allowVisualObservation:false,allowRoomAudio:false}
  });
  assert.equal(budget.capabilities.visual,false);
  assert.equal(budget.capabilities.audio,false);
  assert.ok(budget.scanIntervalMs>=1000);
});

test('general budget slows after long inactivity',()=>{
  const budget=computePerceptionBudget({
    task:{mode:'general'},
    activityAgeMs:130000,
    policy:{}
  });
  assert.equal(budget.intensity,'low');
  assert.ok(budget.scanIntervalMs>=1200);
});

test('attention items dedupe and resolve deterministically',()=>{
  const state=createAttentionState();
  upsertAttentionItems(state,[{type:'object.missing',objectId:'WO1',priority:.8,summary:'missing'}],1000);
  upsertAttentionItems(state,[{type:'object.missing',objectId:'WO1',priority:.9,summary:'missing'}],2000);
  assert.equal(state.items.length,1);
  const key=state.items[0].key;
  resolveAttentionItem(state,key,'resolved',3000);
  assert.equal(state.items[0].state,'resolved');
  assert.equal(state.history.length,1);
});

test('conversation task reports policy or audio limitation rather than enabling sensors',()=>{
  const blocked=taskDerivedSignals({mode:'conversation'},{
    policy:{allowRoomAudio:false,allowLiveTranscription:false},
    audioActive:false
  });
  assert.equal(blocked[0].type,'task.conversation-blocked');
  const audioOff=taskDerivedSignals({mode:'conversation'},{
    policy:{allowRoomAudio:true,allowLiveTranscription:true},
    audioActive:false
  });
  assert.equal(audioOff[0].type,'task.conversation-audio-off');
});

test('find-object task uses expected location evidence when target is not visible',()=>{
  const signals=taskDerivedSignals({mode:'find-object',targetId:'WO1'},{
    multiRoom:{objects:{}},
    expectedLocationEvidence:{WO1:{roomId:'ROOM01',anchorId:'L1'}}
  });
  assert.equal(signals[0].roomId,'ROOM01');
  assert.equal(signals[0].targetId,'L1');
});

test('task state can be replaced and cleared to general awareness',()=>{
  const state=createAttentionState();
  setActiveTask(state,{mode:'mapping',label:'Map office'},1000);
  assert.equal(state.activeTask.mode,'mapping');
  clearActiveTask(state,2000);
  assert.equal(state.activeTask.mode,'general');
  assert.equal(attentionSnapshot(state).activeTask.mode,'general');
});
