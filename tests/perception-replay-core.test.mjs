import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendReplayFrame,
  replayFrames,
  simulateEnvironmentScenario
} from '../src/perception-replay-core.js';

test('replay frame retention is bounded',()=>{
  let session={schemaVersion:1,frames:[]};
  session=appendReplayFrame(session,{timestamp:1},2);
  session=appendReplayFrame(session,{timestamp:2},2);
  session=appendReplayFrame(session,{timestamp:3},2);
  assert.deepEqual(session.frames.map((frame)=>frame.timestamp),[2,3]);
});

test('replay reducer deterministically processes frames',()=>{
  const session=simulateEnvironmentScenario('object-transfer');
  const result=replayFrames(session,(state,frame)=>({
    count:state.count+(frame.objects?.length||0)
  }),{count:0});
  assert.equal(result.state.count,3);
});

test('simulator exposes camera-shift scenario',()=>{
  const session=simulateEnvironmentScenario('camera-shift');
  assert.equal(session.frames.length,2);
  assert.equal(session.frames[1].environment.classification,'known-room-new-view');
});
