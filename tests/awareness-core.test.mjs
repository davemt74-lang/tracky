import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeIncident,
  activeAwareness,
  collectAwarenessCandidates,
  confirmedAlerts,
  createAwarenessState,
  defaultAwarenessPolicy,
  dismissIncident,
  processAwareness,
  verificationRequests
} from '../src/awareness-core.js';

test('unknown environment becomes verification candidate',()=>{
  const candidates=collectAwarenessCandidates({
    environment:{classification:'unknown',best:{score:.2}}
  });
  assert.equal(candidates[0].type,'unknown-environment');
  assert.equal(candidates[0].requestedEvidence,'environment-refresh');
});

test('camera movement is separated from structural drift',()=>{
  const candidates=collectAwarenessCandidates({
    environment:{
      classification:'known-view',
      drift:{likelyCameraShift:true,cameraPoseDrift:.8,structuralDrift:.7}
    }
  });
  assert.equal(candidates.some((item)=>item.type==='camera-pose-shift'),true);
  assert.equal(candidates.some((item)=>item.type==='structural-drift'),false);
});

test('confirmed expected location deviation produces anomaly',()=>{
  const candidates=collectAwarenessCandidates({
    spatialMemory:{
      proposals:[{
        type:'expected-location',status:'confirmed',
        subjectId:'WO1',targetId:'L1',roomId:'ROOM01',
        anchorId:'L1',anchorLabel:'Desk',confidence:.9
      }],
      entities:{WO1:{label:'phone'}}
    },
    multiRoom:{
      objects:{
        WO1:{id:'WO1',label:'phone',roomId:'ROOM02',presence:'confirmed',confidence:.9,roomPosition:{x:.5,y:.5}}
      }
    },
    landmarksByRoom:{ROOM02:[]}
  });
  assert.equal(candidates.some((item)=>item.type==='expected-location-deviation'),true);
});

test('unconfirmed expected-location evidence never creates anomaly',()=>{
  const candidates=collectAwarenessCandidates({
    spatialMemory:{
      proposals:[{
        type:'expected-location',status:'proposed',
        subjectId:'WO1',targetId:'L1',roomId:'ROOM01',confidence:.9
      }]
    },
    multiRoom:{
      objects:{WO1:{id:'WO1',roomId:'ROOM02',presence:'confirmed',confidence:.9,roomPosition:{x:.5,y:.5}}}
    }
  });
  assert.equal(candidates.some((item)=>item.type.includes('expected')),false);
});

test('expected object missing requires unexpected visibility evidence',()=>{
  const base={
    spatialMemory:{
      proposals:[{
        type:'expected-location',status:'confirmed',
        subjectId:'WO1',targetId:'L1',roomId:'ROOM01',
        anchorId:'L1',confidence:.9
      }],
      entities:{WO1:{label:'phone'}}
    },
    multiRoom:{
      objects:{
        WO1:{id:'WO1',label:'phone',lastKnownRoomId:'ROOM01',presence:'last-known',confidence:.7,localRoomObjectId:'O1'}
      }
    }
  };
  assert.equal(collectAwarenessCandidates({
    ...base,
    roomVisibility:{ROOM01:{objects:{O1:{state:'expected-occlusion',confidence:.8}}}}
  }).some((item)=>item.type==='expected-object-missing'),false);

  assert.equal(collectAwarenessCandidates({
    ...base,
    roomVisibility:{ROOM01:{objects:{O1:{state:'missing-unexpected',confidence:.8}}}}
  }).some((item)=>item.type==='expected-object-missing'),true);
});

test('anomaly must survive verification window before confirmation',()=>{
  const state=createAwarenessState();
  const policy={...defaultAwarenessPolicy(),minConfirmations:3,minVerifyMs:1000};
  const item={type:'camera-pose-shift',key:'k',severity:'warning',confidence:.8,summary:'shift',evidence:{x:1}};
  processAwareness(state,[item],policy,0);
  processAwareness(state,[item],policy,500);
  assert.equal(state.incidents.k.state,'verifying');
  const events=processAwareness(state,[item],policy,1200);
  assert.equal(state.incidents.k.state,'confirmed');
  assert.equal(events.some((event)=>event.type==='awareness.confirmed'),true);
});

test('single-frame anomaly clears without ever confirming',()=>{
  const state=createAwarenessState();
  const policy={...defaultAwarenessPolicy(),clearGraceMs:1000};
  const item={type:'structural-drift',key:'k',severity:'warning',confidence:.8,summary:'drift',evidence:{}};
  processAwareness(state,[item],policy,1000);
  processAwareness(state,[],policy,2500);
  assert.equal(state.incidents.k.state,'cleared');
  assert.equal(confirmedAlerts(state).length,0);
});

test('acknowledge suppresses active alert without clearing evidence',()=>{
  const state=createAwarenessState();
  const policy={...defaultAwarenessPolicy(),minConfirmations:1,minVerifyMs:0};
  const item={type:'world-contradiction',key:'k',severity:'high',confidence:.95,summary:'conflict',evidence:{}};
  processAwareness(state,[item],policy,1000);
  assert.equal(confirmedAlerts(state).length,1);
  acknowledgeIncident(state,'k',1200);
  assert.equal(confirmedAlerts(state).length,0);
  assert.equal(state.incidents.k.state,'confirmed');
});

test('dismissal suppresses repeated incident for bounded period',()=>{
  const state=createAwarenessState();
  const policy={...defaultAwarenessPolicy(),minConfirmations:1,minVerifyMs:0};
  const item={type:'camera-degraded',key:'k',severity:'warning',confidence:.8,summary:'camera',evidence:{}};
  processAwareness(state,[item],policy,1000);
  dismissIncident(state,'k',{suppressMs:5000},1200);
  processAwareness(state,[item],policy,3000);
  assert.equal(activeAwareness(state).length,0);
  processAwareness(state,[item],policy,7000);
  assert.equal(activeAwareness(state).length,1);
});

test('verification requests are rate limited',()=>{
  const state=createAwarenessState();
  const policy=defaultAwarenessPolicy();
  processAwareness(state,[{
    type:'unknown-environment',key:'k',severity:'high',confidence:.8,
    summary:'unknown',evidence:{},requestedEvidence:'environment-refresh'
  }],policy,1000);
  assert.equal(verificationRequests(state,policy,1000).length,1);
  assert.equal(verificationRequests(state,policy,1500).length,0);
  assert.equal(verificationRequests(state,policy,4000).length,1);
});
