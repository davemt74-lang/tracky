import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeAnomaly,
  anomalySnapshot,
  createAnomalyState,
  deriveAnomalySignals,
  dismissAnomaly,
  observeAnomalySignals,
  proactiveAwarenessSummary
} from '../src/anomaly-core.js';

test('critical contradiction confirms immediately',()=>{
  const state=createAnomalyState();
  const events=observeAnomalySignals(state,[{
    type:'world-contradiction',
    subjectId:'PERSON:p1',
    confidence:1,
    summary:'conflict'
  }],1000);
  assert.equal(events[0].type,'confirmed');
  assert.equal(proactiveAwarenessSummary(state).critical,1);
});

test('expected location deviation requires persistence before confirmation',()=>{
  const state=createAnomalyState();
  const signal={
    type:'expected-location-deviation',
    objectId:'WO1',
    roomId:'ROOM02',
    expectedTargetId:'L1',
    confidence:.9,
    summary:'away'
  };
  assert.equal(observeAnomalySignals(state,[signal],1000).length,0);
  assert.equal(observeAnomalySignals(state,[signal],3000).length,0);
  const events=observeAnomalySignals(state,[signal],7000);
  assert.equal(events[0].type,'confirmed');
});

test('active anomaly clears when evidence disappears beyond grace',()=>{
  const state=createAnomalyState();
  observeAnomalySignals(state,[{type:'world-contradiction',subjectId:'X',confidence:1}],1000);
  const events=observeAnomalySignals(state,[],7000);
  assert.equal(events[0].type,'cleared');
  assert.equal(Object.keys(state.active).length,0);
});

test('dismissal suppresses immediate reappearance',()=>{
  const state=createAnomalyState();
  observeAnomalySignals(state,[{type:'world-contradiction',subjectId:'X',confidence:1}],1000);
  const signature=Object.keys(state.active)[0];
  dismissAnomaly(state,signature,2000,10000);
  observeAnomalySignals(state,[{type:'world-contradiction',subjectId:'X',confidence:1}],3000);
  assert.equal(Object.keys(state.active).length,0);
});

test('acknowledgement keeps anomaly active',()=>{
  const state=createAnomalyState();
  observeAnomalySignals(state,[{type:'world-contradiction',subjectId:'X',confidence:1}],1000);
  const signature=Object.keys(state.active)[0];
  acknowledgeAnomaly(state,signature,2000);
  assert.equal(state.active[signature].status,'acknowledged');
});

test('derive signals uses only confirmed expected location inputs',()=>{
  const signals=deriveAnomalySignals({
    activeRoomId:'ROOM01',
    environment:{classification:'known-view',drift:null},
    currentEnvironment:{quality:{score:.9}},
    policies:{ROOM01:{allowVisualObservation:true,allowObjectObservation:true}},
    confirmedExpectedLocations:[{
      entityId:'WO1',roomId:'ROOM01',anchorId:'L1',confidence:.9
    }],
    multiRoom:{objects:{
      WO1:{id:'WO1',label:'phone',roomId:'ROOM02',presence:'confirmed',confidence:.9,roomPosition:{x:.5,y:.5}}
    }},
    landmarksByRoom:{},
    roomVisibility:{},
    physicalWorld:{contradictions:[]},
    sceneChanges:[]
  },1000);
  assert.equal(signals.some((item)=>item.type==='expected-location-deviation'),true);
});

test('object anomaly is suppressed when room object observation is disabled',()=>{
  const signals=deriveAnomalySignals({
    activeRoomId:'ROOM01',
    environment:{classification:'known-view',drift:null},
    currentEnvironment:{quality:{score:.9}},
    policies:{ROOM01:{allowVisualObservation:true,allowObjectObservation:false}},
    confirmedExpectedLocations:[{
      entityId:'WO1',roomId:'ROOM01',anchorId:'L1',confidence:.9
    }],
    multiRoom:{objects:{
      WO1:{id:'WO1',label:'phone',roomId:'ROOM02',presence:'confirmed',confidence:.9}
    }},
    landmarksByRoom:{},
    roomVisibility:{},
    physicalWorld:{contradictions:[]},
    sceneChanges:[{type:'object.appeared',objectId:'WO2',objectLabel:'box',timestamp:900,confidence:.8}]
  },1000);
  assert.equal(signals.some((item)=>item.category==='object'),false);
});

test('camera pose shift is separated from structural drift anomaly',()=>{
  const signals=deriveAnomalySignals({
    activeRoomId:'ROOM01',
    environment:{
      classification:'known-view',
      drift:{likelyCameraShift:true,cameraPoseDrift:.8,structuralDrift:.7}
    },
    currentEnvironment:{quality:{score:.9}},
    policies:{},
    confirmedExpectedLocations:[],
    multiRoom:{objects:{}},
    landmarksByRoom:{},
    roomVisibility:{},
    physicalWorld:{contradictions:[]},
    sceneChanges:[]
  },1000);
  assert.equal(signals.some((item)=>item.type==='camera-pose-shift'),true);
  assert.equal(signals.some((item)=>item.type==='environment-structural-drift'),false);
});

test('snapshot is bounded to semantic anomaly state',()=>{
  const state=createAnomalyState();
  observeAnomalySignals(state,[{type:'world-contradiction',subjectId:'X',confidence:1}],1000);
  const snapshot=anomalySnapshot(state);
  assert.equal(snapshot.active.length,1);
  assert.doesNotThrow(()=>JSON.stringify(snapshot));
});
