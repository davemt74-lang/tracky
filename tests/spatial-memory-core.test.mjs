import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendEntityHistory,
  createSpatialMemoryState,
  confirmedExpectedLocationFor,
  entityHistory,
  entityJourney,
  expectedLocationFor,
  expectedLocationStatus,
  ignoreMemoryProposal,
  nearestAnchor,
  observeSpatialMemory,
  recordCirculationTransition,
  resolveMemoryProposal
} from '../src/spatial-memory-core.js';

test('nearest anchor binds entity to nearby stable landmark',()=>{
  const anchor=nearestAnchor({x:.32,y:.41},[
    {id:'L1',name:'Desk',position:{x:.3,y:.4}},
    {id:'L2',name:'Shelf',position:{x:.8,y:.8}}
  ]);
  assert.equal(anchor.id,'L1');
});

test('entity history is bounded and queryable',()=>{
  const state=createSpatialMemoryState();
  for(let i=0;i<130;i++) appendEntityHistory(state,'WO1',{timestamp:i,label:'phone',type:'object'});
  assert.equal(entityHistory(state,'WO1',200).length,120);
});

test('repeated object location evidence across sessions proposes expected location',()=>{
  const state=createSpatialMemoryState();
  const base={
    multiRoom:{
      objects:{
        WO1:{id:'WO1',label:'phone',roomId:'ROOM01',presence:'confirmed',confidence:.9,roomPosition:{x:.3,y:.4},holderParticipantId:null}
      },
      participants:{}
    },
    landmarksByRoom:{
      ROOM01:[{id:'L1',name:'Desk',position:{x:.3,y:.4},userConfirmed:true}]
    },
    sceneGraph:{edges:[]},
    transitions:[]
  };
  let now=1000;
  for(const session of ['s1','s2','s3']){
    for(let i=0;i<2;i++){
      observeSpatialMemory(state,{...base,sessionId:session},now);
      now+=16000;
    }
  }
  const proposal=state.proposals.find((item)=>item.type==='expected-location');
  assert.ok(proposal);
  assert.equal(proposal.anchorId,'L1');
  assert.equal(expectedLocationFor(state,'WO1').anchorId,'L1');
});

test('held object does not train expected home location',()=>{
  const state=createSpatialMemoryState();
  observeSpatialMemory(state,{
    sessionId:'s1',
    multiRoom:{objects:{WO1:{id:'WO1',label:'phone',roomId:'ROOM01',presence:'confirmed',confidence:.9,roomPosition:{x:.3,y:.4},holderParticipantId:'p1'}},participants:{}},
    landmarksByRoom:{ROOM01:[{id:'L1',name:'Desk',position:{x:.3,y:.4}}]},
    sceneGraph:{edges:[]},transitions:[]
  },1000);
  assert.equal(expectedLocationFor(state,'WO1'),null);
});

test('circulation learning proposes recurring route without claiming intent',()=>{
  const state=createSpatialMemoryState();
  let now=1000;
  for(const session of ['s1','s2','s3']){
    for(let i=0;i<2;i++){
      recordCirculationTransition(state,{
        type:'participant.room_transition',participantId:'p1',
        fromRoomId:'ROOM01',toRoomId:'ROOM02'
      },session,now++);
    }
  }
  assert.ok(state.proposals.some((item)=>item.type==='circulation-pattern'));
});

test('proposal can be ignored or resolved explicitly',()=>{
  const state=createSpatialMemoryState();
  state.proposals.push({key:'k1',status:'proposed'});
  assert.equal(resolveMemoryProposal(state,'k1','confirmed',1000).status,'confirmed');
  state.proposals.push({key:'k2',status:'proposed'});
  ignoreMemoryProposal(state,'k2',2000);
  assert.equal(state.proposals.some((item)=>item.key==='k2'),false);
  assert.equal(state.ignoredProposalKeys.k2,2000);
});


test('entity journey compresses repeated same-place observations',()=>{
  const state=createSpatialMemoryState();
  appendEntityHistory(state,'WO1',{timestamp:1,label:'phone',type:'object',roomId:'ROOM01',anchorId:'L1',event:'observed',confidence:.8});
  appendEntityHistory(state,'WO1',{timestamp:2,label:'phone',type:'object',roomId:'ROOM01',anchorId:'L1',event:'observed',confidence:.9});
  appendEntityHistory(state,'WO1',{timestamp:3,label:'phone',type:'object',roomId:'ROOM02',anchorId:'L2',event:'observed',confidence:.9});
  const journey=entityJourney(state,'WO1');
  assert.equal(journey.length,2);
  assert.equal(journey[0].observations,2);
});

test('expected location status distinguishes at-home from away',()=>{
  const state=createSpatialMemoryState();
  state.expectedLocations.WO1={entityId:'WO1',candidates:{
    L1:{targetId:'L1',roomId:'ROOM01',anchorId:'L1',anchorLabel:'Desk',observations:8,sessions:{s1:true,s2:true,s3:true},confidenceSum:7}
  }};
  const at=expectedLocationStatus(state,{id:'WO1',roomId:'ROOM01',roomPosition:{x:.3,y:.4}},[
    {id:'L1',name:'Desk',position:{x:.3,y:.4}}
  ]);
  const away=expectedLocationStatus(state,{id:'WO1',roomId:'ROOM02',roomPosition:{x:.5,y:.5}},[]);
  assert.equal(at.state,'at-expected');
  assert.equal(away.state,'away-from-expected');
});

test('ownership relationships are never learned from observation evidence',()=>{
  const state=createSpatialMemoryState();
  for(let i=0;i<10;i++){
    observeSpatialMemory(state,{
      sessionId:'s'+(i%3),
      multiRoom:{objects:{},participants:{}},
      landmarksByRoom:{},
      sceneGraph:{edges:[{
        subjectId:'WO1',predicate:'owned-by',objectId:'PERSON:p1',
        state:'inferred',confidence:.95
      }]},
      transitions:[]
    },1000+i*16000);
  }
  assert.equal(state.proposals.some((item)=>item.predicate==='owned-by'),false);
});


test('relationship evidence is time-gated rather than frame-rate counted',()=>{
  const state=createSpatialMemoryState();
  const input={
    sessionId:'s1',
    multiRoom:{objects:{},participants:{}},
    landmarksByRoom:{},
    sceneGraph:{edges:[{
      subjectId:'WO1',predicate:'on',objectId:'L1',
      state:'inferred',confidence:.9
    }]},
    transitions:[]
  };
  observeSpatialMemory(state,input,1000);
  observeSpatialMemory(state,input,1500);
  const evidence=state.relationshipEvidence['WO1::on::L1'];
  assert.equal(evidence.observations,1);
});


test('authoritative expected location requires explicit proposal confirmation',()=>{
  const state=createSpatialMemoryState();
  state.proposals.push({
    key:'expected-location::WO1::L1',
    type:'expected-location',subjectId:'WO1',targetId:'L1',
    roomId:'ROOM01',anchorId:'L1',anchorLabel:'Desk',
    confidence:.88,status:'proposed'
  });
  assert.equal(confirmedExpectedLocationFor(state,'WO1'),null);
  resolveMemoryProposal(state,'expected-location::WO1::L1','confirmed',5000);
  assert.equal(confirmedExpectedLocationFor(state,'WO1').anchorId,'L1');
});
