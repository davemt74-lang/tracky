import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneState,
  deriveParticipantActivity,
  normalizeZone,
  pointInZone,
  replaceSceneZones,
  sceneStateSnapshot,
  updateSceneState,
  zoneForPosition
} from '../src/scene-core.js';

function baseSnapshot(overrides = {}) {
  return {
    participants: [],
    objects: [],
    interactions: [],
    conversationGroups: [],
    ...overrides
  };
}

test('zones normalize and smallest matching zone wins', () => {
  const zones = [
    normalizeZone({id:'room',name:'Room',x:0,y:0,width:1,height:1}),
    normalizeZone({id:'desk',name:'Desk',x:0.2,y:0.2,width:0.2,height:0.2})
  ];
  assert.equal(pointInZone({x:0.25,y:0.25}, zones[1]), true);
  assert.equal(zoneForPosition({x:0.25,y:0.25}, zones).id, 'desk');
});

test('participant presence becomes a semantic scene change', () => {
  const state = createSceneState('room');
  const changes = updateSceneState(state, baseSnapshot({
    participants:[{
      id:'p1',name:'Dave',trackId:'T001',presence:'active',
      position:{x:0.5,y:0.5},behavior:{motion:'stationary'}
    }]
  }), 1000, {activityCommitMs:0,zoneCommitMs:0});
  assert.equal(changes.some((change)=>change.type==='presence.entered'), true);
  assert.equal(sceneStateSnapshot(state).participants[0].name, 'Dave');
});

test('zone change commits only after dwell threshold', () => {
  const state = createSceneState('room', [
    {id:'desk',name:'Desk',x:0,y:0,width:0.5,height:1},
    {id:'door',name:'Door',x:0.5,y:0,width:0.5,height:1}
  ]);
  const participant={
    id:'p1',name:'Dave',trackId:'T001',presence:'active',
    position:{x:0.2,y:0.5},behavior:{motion:'stationary'}
  };

  updateSceneState(state, baseSnapshot({participants:[participant]}), 1000, {
    zoneCommitMs:1000,activityCommitMs:999999
  });
  let changes=updateSceneState(state, baseSnapshot({participants:[participant]}), 1800, {
    zoneCommitMs:1000,activityCommitMs:999999
  });
  assert.equal(changes.some((change)=>change.type==='location.changed'),false);

  changes=updateSceneState(state, baseSnapshot({participants:[participant]}), 2101, {
    zoneCommitMs:1000,activityCommitMs:999999
  });
  assert.equal(changes.some((change)=>change.type==='location.changed'),true);
  assert.equal(state.participants.p1.zoneId,'desk');
});

test('activity derivation prefers holding over generic movement', () => {
  const participant={
    id:'p1',trackId:'T001',conversationGroup:null,
    behavior:{motion:'moving',posture:'standing'}
  };
  const activity=deriveParticipantActivity(participant, baseSnapshot({
    interactions:[{
      type:'holding',participantId:'p1',trackId:'T001',
      objectId:'O1',objectLabel:'phone',confidence:0.9
    }]
  }));
  assert.equal(activity.type,'holding-object');
  assert.match(activity.label,/phone/);
});

test('activity changes create and close episodes', () => {
  const state=createSceneState('room');
  const participant={
    id:'p1',name:'Dave',trackId:'T001',presence:'active',
    position:{x:0.5,y:0.5},
    behavior:{motion:'stationary',posture:'standing'}
  };

  updateSceneState(state,baseSnapshot({participants:[participant]}),1000,{
    activityCommitMs:0,zoneCommitMs:999999
  });
  updateSceneState(state,baseSnapshot({participants:[participant]}),1001,{
    activityCommitMs:0,zoneCommitMs:999999
  });

  const moving={...participant,behavior:{motion:'moving',posture:'standing'}};
  updateSceneState(state,baseSnapshot({participants:[moving]}),2000,{
    activityCommitMs:0,zoneCommitMs:999999
  });
  const changes=updateSceneState(state,baseSnapshot({participants:[moving]}),2001,{
    activityCommitMs:0,zoneCommitMs:999999
  });

  assert.equal(changes.some((change)=>change.type==='activity.ended'),true);
  assert.equal(changes.some((change)=>change.type==='activity.started'),true);
  assert.ok(state.episodes.length>=1);
});

test('object permanence keeps last known position after object disappears', () => {
  const state=createSceneState('room');
  const object={id:'O1',label:'laptop',score:0.9,position:{x:0.3,y:0.4}};

  updateSceneState(state,baseSnapshot({objects:[object]}),1000);
  const changes=updateSceneState(state,baseSnapshot(),1500);

  assert.equal(state.objects.O1.status,'last-known');
  assert.deepEqual(state.objects.O1.lastKnownPosition,{x:0.3,y:0.4});
  assert.equal(changes.some((change)=>change.type==='object.last_known'),true);
});

test('object movement is emitted only for meaningful displacement', () => {
  const state=createSceneState('room');
  updateSceneState(state,baseSnapshot({
    objects:[{id:'O1',label:'cup',score:0.9,position:{x:0.2,y:0.2}}]
  }),1000);

  let changes=updateSceneState(state,baseSnapshot({
    objects:[{id:'O1',label:'cup',score:0.9,position:{x:0.23,y:0.22}}]
  }),3000);
  assert.equal(changes.some((change)=>change.type==='object.moved'),false);

  changes=updateSceneState(state,baseSnapshot({
    objects:[{id:'O1',label:'cup',score:0.9,position:{x:0.4,y:0.2}}]
  }),5000);
  assert.equal(changes.some((change)=>change.type==='object.moved'),true);
});

test('conversation lifecycle creates semantic episode changes', () => {
  const state=createSceneState('room');
  let changes=updateSceneState(state,baseSnapshot({
    conversationGroups:[{id:'G01',participantIds:['p1','p2'],trackIds:['T1','T2']}]
  }),1000);
  assert.equal(changes.some((change)=>change.type==='conversation.started'),true);

  changes=updateSceneState(state,baseSnapshot(),2000);
  assert.equal(changes.some((change)=>change.type==='conversation.ended'),true);
  assert.ok(state.episodes.some((episode)=>episode.type==='conversation'));
});

test('replaceSceneZones resets pending zone transitions', () => {
  const state=createSceneState('room');
  state.pending.zones.p1={target:'old',since:1};
  const zones=replaceSceneZones(state,[{id:'desk',name:'Desk',x:0,y:0,width:.5,height:.5}]);
  assert.equal(zones.length,1);
  assert.deepEqual(state.pending.zones,{});
});


test('recognizing an unknown track migrates scene identity without false leave-enter', () => {
  const state=createSceneState('room');
  const unknown={
    id:null,name:'T001',trackId:'T001',presence:'active',
    position:{x:0.4,y:0.5},behavior:{motion:'stationary'}
  };

  updateSceneState(state,baseSnapshot({participants:[unknown]}),1000,{
    activityCommitMs:999999,zoneCommitMs:999999
  });
  const before=state.changes.length;

  const recognized={
    ...unknown,
    id:'p1',
    name:'Dave'
  };
  const changes=updateSceneState(state,baseSnapshot({participants:[recognized]}),1500,{
    activityCommitMs:999999,zoneCommitMs:999999
  });

  assert.equal(changes.some((change)=>change.type==='presence.left'),false);
  assert.equal(changes.some((change)=>change.type==='presence.entered'),false);
  assert.equal(state.participants.T001,undefined);
  assert.equal(state.participants.p1.name,'Dave');
  assert.equal(state.changes.length,before);
});

test('holding interaction creates pickup change and removal creates put-down change', () => {
  const state=createSceneState('room');
  const participant={
    id:'p1',name:'Dave',trackId:'T001',presence:'active',
    position:{x:0.4,y:0.5},behavior:{motion:'stationary'}
  };
  const object={id:'O1',label:'phone',score:0.9,position:{x:0.42,y:0.52}};

  updateSceneState(state,baseSnapshot({participants:[participant],objects:[object]}),1000,{
    activityCommitMs:999999,zoneCommitMs:999999
  });

  let changes=updateSceneState(state,baseSnapshot({
    participants:[participant],
    objects:[object],
    interactions:[{
      id:'holding:T001:O1',type:'holding',
      participantId:'p1',participantName:'Dave',trackId:'T001',
      objectId:'O1',objectLabel:'phone',confidence:0.91
    }]
  }),2000,{activityCommitMs:999999,zoneCommitMs:999999});
  assert.equal(changes.some((change)=>change.type==='object.picked_up'),true);

  changes=updateSceneState(state,baseSnapshot({
    participants:[participant],
    objects:[object],
    interactions:[]
  }),3000,{activityCommitMs:999999,zoneCommitMs:999999});
  assert.equal(changes.some((change)=>change.type==='object.put_down'),true);
});
