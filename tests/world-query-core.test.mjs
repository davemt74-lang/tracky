import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerPhysicalWorldQuery,
  buildEvidenceBundle,
  buildWorldTimeline,
  parseWorldQuery,
  resolveEntityReference,
  resolveRoomReference
} from '../src/world-query-core.js';

function context(){
  return {
    activeRoomId:'ROOM01',
    rooms:[
      {id:'ROOM01',name:'Office'},
      {id:'ROOM02',name:'Kitchen'}
    ],
    roomPolicies:{
      ROOM01:{allowSpatialMemory:true},
      ROOM02:{allowSpatialMemory:true}
    },
    multiRoom:{
      updatedAt:9000,
      participants:{
        'PERSON:p1':{
          id:'PERSON:p1',participantId:'p1',participantName:'Dave',
          roomId:'ROOM01',lastKnownRoomId:'ROOM01',
          presence:'confirmed',confidence:.94,lastObservedAt:9000
        },
        'PERSON:p2':{
          id:'PERSON:p2',participantId:'p2',participantName:'Sarah',
          roomId:'ROOM02',lastKnownRoomId:'ROOM02',
          presence:'confirmed',confidence:.91,lastObservedAt:8800
        }
      },
      objects:{
        WO1:{
          id:'WO1',label:'phone',roomId:'ROOM01',lastKnownRoomId:'ROOM01',
          presence:'confirmed',confidence:.88,lastObservedAt:8900
        },
        WO2:{
          id:'WO2',label:'keys',roomId:null,lastKnownRoomId:'ROOM02',
          presence:'last-known',confidence:.62,lastObservedAt:7000
        }
      },
      transitions:[
        {
          id:'T1',type:'participant.room_transition',participantId:'p1',
          participantName:'Dave',fromRoomId:'ROOM02',toRoomId:'ROOM01',
          confidence:.9,timestamp:8000
        }
      ]
    },
    spatialMemory:{
      entities:{
        WO1:{
          id:'WO1',label:'phone',type:'object',history:[
            {timestamp:5000,event:'held',roomId:'ROOM02',holderParticipantId:'p2',confidence:.8,source:'multi-room-world'},
            {timestamp:8900,event:'observed',roomId:'ROOM01',anchorId:'L1',anchorLabel:'Desk',confidence:.88,source:'multi-room-world'}
          ]
        },
        WO2:{
          id:'WO2',label:'keys',type:'object',history:[
            {timestamp:7000,event:'observed',roomId:'ROOM02',anchorId:'L2',anchorLabel:'Counter',confidence:.62,source:'multi-room-world'}
          ]
        }
      },
      proposals:[
        {
          type:'expected-location',subjectId:'WO2',targetId:'L2',
          roomId:'ROOM02',anchorId:'L2',anchorLabel:'Counter',
          confidence:.89,status:'confirmed',resolvedAt:6000
        },
        {
          type:'expected-location',subjectId:'WO1',targetId:'L1',
          roomId:'ROOM01',anchorId:'L1',anchorLabel:'Desk',
          confidence:.81,status:'proposed',updatedAt:8500
        }
      ],
      expectedLocations:{
        WO1:{entityId:'WO1',candidates:{
          L1:{targetId:'L1',roomId:'ROOM01',anchorId:'L1',anchorLabel:'Desk',observations:6,sessions:{a:true,b:true,c:true},confidenceSum:4.8}
        }}
      }
    },
    sceneGraph:{
      nodes:[
        {id:'WO1',type:'object',label:'phone',state:'observed',confidence:.88,properties:{}},
        {id:'L1',type:'landmark',label:'Desk',state:'user-confirmed',confidence:1,properties:{}}
      ],
      edges:[
        {id:'E1',subjectId:'WO1',predicate:'near',objectId:'L1',state:'inferred',confidence:.8}
      ]
    },
    sceneChanges:[
      {id:'C1',type:'object.moved',objectId:'WO1',roomId:'ROOM01',summary:'Phone moved on desk',confidence:.8,timestamp:8500}
    ],
    anomalies:{
      active:{
        A1:{
          signature:'A1',type:'expected-object-missing',severity:'high',
          status:'active',roomId:'ROOM02',objectId:'WO2',
          summary:'Keys expected on counter are missing',confidence:.9,
          firstSeenAt:7500,lastSeenAt:9000
        }
      },
      history:[]
    }
  };
}

test('parser recognizes common physical-world questions',()=>{
  assert.equal(parseWorldQuery('Where is the phone?').intent,'where-is');
  assert.equal(parseWorldQuery('Who had the phone?').intent,'who-had');
  assert.equal(parseWorldQuery('Who is in Office?').intent,'room-occupants');
  assert.equal(parseWorldQuery('What changed?').intent,'what-changed');
  assert.equal(parseWorldQuery('Any anomalies?').intent,'active-anomalies');
});

test('entity and room references resolve by human label',()=>{
  assert.equal(resolveEntityReference('phone',context()).entity.id,'WO1');
  assert.equal(resolveRoomReference('office',context()).room.id,'ROOM01');
});

test('ambiguous same-label entities are not guessed',()=>{
  const ctx=context();
  ctx.multiRoom.objects.WO3={...ctx.multiRoom.objects.WO1,id:'WO3',label:'phone'};
  const result=resolveEntityReference('phone',ctx);
  assert.equal(result.status,'ambiguous');
  assert.equal(result.entity,null);
});

test('where-is uses current confirmed room and anchor evidence',()=>{
  const result=answerPhysicalWorldQuery('Where is phone?',context(),10000);
  assert.equal(result.status,'answered');
  assert.match(result.summary,/Office/);
  assert.match(result.summary,/Desk/);
  assert.equal(result.facts[0].type,'current-location');
});

test('last-known object is described as last seen instead of current',()=>{
  const result=answerPhysicalWorldQuery('Where is keys?',context(),10000);
  assert.equal(result.status,'answered');
  assert.match(result.summary,/last saw/i);
  assert.ok(result.uncertainty.includes('location-is-last-known-not-current'));
});

test('who-had reports possession but explicitly does not imply ownership',()=>{
  const result=answerPhysicalWorldQuery('Who had phone?',context(),10000);
  assert.equal(result.status,'answered');
  assert.match(result.summary,/Sarah/);
  assert.ok(result.uncertainty.includes('possession-does-not-imply-ownership'));
});

test('room occupants query returns only current confirmed or transitioning people',()=>{
  const result=answerPhysicalWorldQuery('Who is in office?',context(),10000);
  assert.equal(result.status,'answered');
  assert.equal(result.facts.length,1);
  assert.equal(result.facts[0].name,'Dave');
});

test('what-changed merges semantic sources into a timeline',()=>{
  const result=answerPhysicalWorldQuery({intent:'what-changed',sinceMs:5000},context(),10000);
  assert.equal(result.status,'answered');
  assert.ok(result.facts.some((item)=>item.source==='scene-intelligence'));
  assert.ok(result.facts.some((item)=>item.source==='multi-room-world'));
  assert.ok(result.facts.some((item)=>item.source==='proactive-awareness'));
});

test('active anomalies remain queryable with severity and confidence',()=>{
  const result=answerPhysicalWorldQuery('Any anomalies?',context(),10000);
  assert.equal(result.status,'answered');
  assert.equal(result.facts[0].severity,'high');
});

test('expected location only becomes authoritative after confirmation',()=>{
  const confirmed=answerPhysicalWorldQuery({
    intent:'expected-location',entity:'keys'
  },context(),10000);
  assert.equal(confirmed.status,'answered');
  assert.match(confirmed.summary,/confirmed expected location/i);

  const candidate=answerPhysicalWorldQuery({
    intent:'expected-location',entity:'phone'
  },context(),10000);
  assert.equal(candidate.status,'unconfirmed');
  assert.ok(candidate.uncertainty.includes('expected-location-not-confirmed'));
});

test('history queries respect room policy that disables spatial memory',()=>{
  const ctx=context();
  ctx.roomPolicies.ROOM02.allowSpatialMemory=false;
  const result=answerPhysicalWorldQuery({intent:'history',entity:'keys'},ctx,10000);
  assert.equal(result.status,'unknown');
  assert.ok(result.uncertainty.includes('no-semantic-history'));
});

test('evidence bundle strips sensitive raw/image/embedding fields',()=>{
  const ctx=context();
  ctx.sceneGraph.nodes[0].properties={
    embedding:[1,2,3],
    imageDataUrl:'data:image/jpeg;base64,abc',
    safe:'yes'
  };
  const bundle=buildEvidenceBundle('WO1',ctx,10000);
  const serialized=JSON.stringify(bundle);
  assert.doesNotMatch(serialized,/embedding/);
  assert.doesNotMatch(serialized,/imageDataUrl/);
  assert.doesNotMatch(serialized,/descriptor/);
});

test('timeline filters historical events when room spatial memory is disabled',()=>{
  const ctx=context();
  ctx.roomPolicies.ROOM02.allowSpatialMemory=false;
  const timeline=buildWorldTimeline(ctx,{now:10000,sinceMs:5000});
  assert.equal(timeline.some((item)=>item.roomIds?.includes('ROOM02')),false);
});

test('world query current-location lookup prefers canonical ground truth over conflicting multi-room evidence',()=>{
  const ctx=context();
  ctx.groundTruth={
    generatedAt:9900,
    entities:[{subjectId:'WO1',entityType:'object',label:'phone',roomId:'ROOM02',lastKnownRoomId:'ROOM02',state:'confirmed',authority:'direct-observation',freshness:'current',confidence:.95,observedAt:9900}],
    conflicts:[]
  };
  const result=answerPhysicalWorldQuery('Where is phone?',ctx,10000);
  assert.equal(result.status,'answered');
  assert.match(result.summary,/Kitchen/);
  assert.equal(result.facts[0].roomId,'ROOM02');
  assert.equal(result.provenance[0].source,'ground-truth-canonical');
});
test('room occupants query prefers canonical ground truth people over legacy multi-room evidence',()=>{
  const ctx=context();
  ctx.groundTruth={
    generatedAt:9900,
    entities:[
      {subjectId:'PERSON:p1',entityType:'person',label:'Dave',roomId:'ROOM02',lastKnownRoomId:'ROOM02',state:'confirmed',authority:'reconciled-observation',freshness:'current',confidence:.95,observedAt:9900}
    ],
    conflicts:[]
  };
  const office=answerPhysicalWorldQuery('Who is in office?',ctx,10000);
  assert.equal(office.facts.length,0);
  const kitchen=answerPhysicalWorldQuery('Who is in kitchen?',ctx,10000);
  assert.equal(kitchen.facts.length,1);
  assert.equal(kitchen.facts[0].name,'Dave');
  assert.equal(kitchen.provenance[0].source,'ground-truth-canonical');
});
