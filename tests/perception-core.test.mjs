import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PerceptionEventBus,
  applyPerceptionEvent,
  createPerceptionEvent,
  createRoomState,
  roomStateSnapshot
} from '../src/perception-core.js';

test('event bus delivers typed events and wildcard events', () => {
  const bus = new PerceptionEventBus();
  const seen = [];
  bus.subscribe('participant.detected', (event) => seen.push(event.type));
  bus.subscribe('*', (event) => seen.push('*:' + event.type));
  bus.emit('participant.detected', { trackId:'T001' }, { timestamp:1 });
  assert.deepEqual(seen, ['participant.detected', '*:participant.detected']);
});

test('unknown track becomes participant after recognition', () => {
  const state = createRoomState('room-a');
  applyPerceptionEvent(state, createPerceptionEvent(
    'participant.detected',
    { trackId:'T001', roomPosition:{x:0.2,y:0.5} },
    { timestamp:1, roomId:'room-a' }
  ));
  assert.ok(state.unknownTracks.T001);

  applyPerceptionEvent(state, createPerceptionEvent(
    'participant.recognized',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      confidence:0.96
    },
    { timestamp:2, roomId:'room-a' }
  ));

  assert.equal(state.unknownTracks.T001, undefined);
  assert.equal(state.participants.p1.name, 'Dave');
  assert.equal(state.participants.p1.trackId, 'T001');
});

test('active speaker and transcript are reflected in room state', () => {
  const state = createRoomState();
  applyPerceptionEvent(state, createPerceptionEvent(
    'voice.activity_started',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      confidence:0.91,
      conversationGroup:'G01'
    },
    { timestamp:10 }
  ));
  assert.equal(state.activeSpeaker.participantName, 'Dave');

  applyPerceptionEvent(state, createPerceptionEvent(
    'transcript.turn',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      confidence:0.88,
      conversationGroup:'G01',
      nearbyParticipants:['Sarah'],
      data:{text:'hello room'}
    },
    { timestamp:11 }
  ));
  assert.equal(state.transcript[0].text, 'hello room');

  applyPerceptionEvent(state, createPerceptionEvent(
    'voice.activity_stopped',
    { participantId:'p1', trackId:'T001' },
    { timestamp:12 }
  ));
  assert.equal(state.activeSpeaker, null);
});

test('conversation membership is normalized into room groups', () => {
  const state = createRoomState();
  applyPerceptionEvent(state, createPerceptionEvent(
    'conversation.started',
    {
      conversationGroup:'G01',
      data:{participantIds:['p1'],trackIds:['T001']}
    },
    { timestamp:1 }
  ));
  applyPerceptionEvent(state, createPerceptionEvent(
    'conversation.participant_joined',
    {
      participantId:'p2',
      trackId:'T002',
      conversationGroup:'G01'
    },
    { timestamp:2 }
  ));
  assert.deepEqual(state.conversationGroups.G01.participantIds, ['p1','p2']);
});

test('room snapshot exposes serializable arrays for agent consumption', () => {
  const state = createRoomState('agent-room');
  applyPerceptionEvent(state, createPerceptionEvent(
    'participant.recognized',
    { participantId:'p1', participantName:'Dave', trackId:'T001' },
    { timestamp:1, roomId:'agent-room' }
  ));
  const snapshot = roomStateSnapshot(state);
  assert.equal(snapshot.roomId, 'agent-room');
  assert.equal(snapshot.participants.length, 1);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test('unknown event types are rejected', () => {
  assert.throws(
    () => createPerceptionEvent('made.up', {}),
    /Unknown perception event type/
  );
});


test('face.hidden clears stale face visibility', () => {
  const state = createRoomState();
  applyPerceptionEvent(state, createPerceptionEvent(
    'face.visible',
    { participantId:'p1', participantName:'Dave', trackId:'T001' },
    { timestamp:1 }
  ));
  assert.equal(state.participants.p1.faceVisible, true);

  applyPerceptionEvent(state, createPerceptionEvent(
    'face.hidden',
    { participantId:'p1', participantName:'Dave', trackId:'T001' },
    { timestamp:2 }
  ));
  assert.equal(state.participants.p1.faceVisible, false);
});

test('conversation.ended removes stale room groups', () => {
  const state = createRoomState();
  applyPerceptionEvent(state, createPerceptionEvent(
    'conversation.started',
    { conversationGroup:'G01', data:{participantIds:['p1'],trackIds:['T001','T002']} },
    { timestamp:1 }
  ));
  assert.ok(state.conversationGroups.G01);

  applyPerceptionEvent(state, createPerceptionEvent(
    'conversation.ended',
    { conversationGroup:'G01' },
    { timestamp:2 }
  ));
  assert.equal(state.conversationGroups.G01, undefined);
});


test('conversation start and leave update participant group membership', () => {
  const state = createRoomState();
  applyPerceptionEvent(state, createPerceptionEvent(
    'participant.recognized',
    { participantId:'p1', participantName:'Dave', trackId:'T001' },
    { timestamp:1 }
  ));
  applyPerceptionEvent(state, createPerceptionEvent(
    'conversation.started',
    {
      conversationGroup:'G01',
      data:{participantIds:['p1'],trackIds:['T001','T002']}
    },
    { timestamp:2 }
  ));
  assert.equal(state.participants.p1.conversationGroup, 'G01');

  applyPerceptionEvent(state, createPerceptionEvent(
    'conversation.participant_left',
    { participantId:'p1', trackId:'T001', conversationGroup:'G01' },
    { timestamp:3 }
  ));
  assert.equal(state.participants.p1.conversationGroup, null);
});


test('behavior attention and gesture events update participant state', () => {
  const state = createRoomState();

  applyPerceptionEvent(state, createPerceptionEvent(
    'participant.recognized',
    { participantId:'p1', participantName:'Dave', trackId:'T001' },
    { timestamp:1 }
  ));

  applyPerceptionEvent(state, createPerceptionEvent(
    'behavior.changed',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      data:{
        behavior:{posture:'standing',motion:'stationary',orientation:'center'},
        addressing:{targetName:'Sarah',confidence:0.72}
      }
    },
    { timestamp:2 }
  ));

  applyPerceptionEvent(state, createPerceptionEvent(
    'attention.changed',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      data:{attention:{targetName:'Sarah',targetType:'participant',confidence:0.81}}
    },
    { timestamp:3 }
  ));

  applyPerceptionEvent(state, createPerceptionEvent(
    'gesture.detected',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      confidence:0.84,
      data:{gesture:'left-hand-raised'}
    },
    { timestamp:4 }
  ));

  assert.equal(state.participants.p1.behavior.posture,'standing');
  assert.equal(state.participants.p1.attention.targetName,'Sarah');
  assert.equal(state.participants.p1.lastGesture.type,'left-hand-raised');
});


test('object events populate room objects without flooding recent semantic events', () => {
  const state = createRoomState();

  applyPerceptionEvent(state, createPerceptionEvent(
    'object.detected',
    {
      confidence:0.91,
      roomPosition:{x:0.4,y:0.5},
      data:{objectId:'O001',label:'cup',status:'tracked'}
    },
    { timestamp:1 }
  ));

  const before = state.recentEvents.length;
  applyPerceptionEvent(state, createPerceptionEvent(
    'object.updated',
    {
      confidence:0.92,
      roomPosition:{x:0.42,y:0.5},
      data:{objectId:'O001',label:'cup',status:'tracked'}
    },
    { timestamp:2 }
  ));

  assert.equal(state.objects.O001.label,'cup');
  assert.equal(state.objects.O001.position.x,0.42);
  assert.equal(state.recentEvents.length,before);
});

test('picked up and put down update object holder state', () => {
  const state = createRoomState();
  applyPerceptionEvent(state, createPerceptionEvent(
    'object.detected',
    { data:{objectId:'O001',label:'cell phone'} },
    { timestamp:1 }
  ));
  applyPerceptionEvent(state, createPerceptionEvent(
    'object.picked_up',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      data:{objectId:'O001',label:'cell phone'}
    },
    { timestamp:2 }
  ));
  assert.equal(state.objects.O001.holderParticipantId,'p1');

  applyPerceptionEvent(state, createPerceptionEvent(
    'object.put_down',
    {
      participantId:'p1',
      trackId:'T001',
      data:{objectId:'O001',label:'cell phone'}
    },
    { timestamp:3 }
  ));
  assert.equal(state.objects.O001.holderParticipantId,null);
});

test('interaction lifecycle is represented in room snapshot', () => {
  const state = createRoomState();
  applyPerceptionEvent(state, createPerceptionEvent(
    'interaction.started',
    {
      participantId:'p1',
      participantName:'Dave',
      trackId:'T001',
      confidence:0.8,
      data:{
        interactionId:'pointing-at:T001:O001',
        type:'pointing-at',
        objectId:'O001',
        objectLabel:'laptop'
      }
    },
    { timestamp:1 }
  ));
  assert.equal(roomStateSnapshot(state).interactions.length,1);

  applyPerceptionEvent(state, createPerceptionEvent(
    'interaction.ended',
    {
      participantId:'p1',
      trackId:'T001',
      data:{interactionId:'pointing-at:T001:O001'}
    },
    { timestamp:2 }
  ));
  assert.equal(roomStateSnapshot(state).interactions.length,0);
});


test('lost objects are pruned from long-running room state after retention', () => {
  const state = createRoomState();

  applyPerceptionEvent(state, createPerceptionEvent(
    'object.detected',
    {
      confidence:0.9,
      data:{objectId:'O001',label:'cup',status:'tracked'}
    },
    { timestamp:1 }
  ));

  applyPerceptionEvent(state, createPerceptionEvent(
    'object.lost',
    {
      confidence:0.9,
      data:{objectId:'O001',label:'cup',status:'lost'}
    },
    { timestamp:1000 }
  ));

  assert.ok(state.objects.O001);

  applyPerceptionEvent(state, createPerceptionEvent(
    'sensor.status',
    { data:{sensor:'camera',status:'online'} },
    { timestamp:62001 }
  ));

  assert.equal(state.objects.O001, undefined);
});


test('camera fusion events are accepted by the perception event bus', () => {
  const bus = new PerceptionEventBus();
  const seen = [];
  bus.subscribe('camera.handoff', (event) => seen.push(event));
  bus.emit('camera.handoff', {
    participantId:'p1',
    participantName:'Dave',
    confidence:0.91,
    data:{fromCameraId:'CAM01',toCameraId:'CAM02'}
  }, {timestamp:1});
  assert.equal(seen.length,1);
  assert.equal(seen[0].data.toCameraId,'CAM02');
});
