import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_CONTEXT_SCHEMA_VERSION,buildAgentContext,diffAgentContext,sanitizeAgentContext} from '../src/agent-context-core.js';

function context(){
  return {
    activeRoomId:'ROOM01',
    rooms:[{id:'ROOM01',name:'Office'},{id:'ROOM02',name:'Kitchen'}],
    roomPolicies:{
      ROOM01:{allowVisualObservation:true,allowParticipantIdentity:true,allowObjectObservation:true,allowBehaviorAnalysis:true,
        allowEnvironmentComparison:true,allowRoomAudio:true,allowVoiceMatching:true,allowLiveTranscription:true,
        allowTranscriptStorage:false,allowSpatialMemory:true,regions:[{id:'R1'}]},
      ROOM02:{allowVisualObservation:true,allowParticipantIdentity:false,allowObjectObservation:true,allowSpatialMemory:false}
    },
    multiRoom:{
      participants:{
        P1:{id:'PERSON:p1',participantId:'p1',participantName:'Dave',roomId:'ROOM01',presence:'confirmed',confidence:.94,lastObservedAt:9000},
        P2:{id:'PERSON:p2',participantId:'p2',participantName:'Sarah',roomId:'ROOM02',presence:'confirmed',confidence:.91,lastObservedAt:8800}
      },
      objects:{
        O1:{id:'O1',label:'phone',roomId:'ROOM01',presence:'confirmed',confidence:.88,lastObservedAt:8900},
        O2:{id:'O2',label:'keys',roomId:null,lastKnownRoomId:'ROOM02',presence:'last-known',confidence:.62,lastObservedAt:7000}
      }
    },
    attention:{
      activeTask:{id:'T1',mode:'find-object',label:'Find phone',targetId:'O1',status:'active',startedAt:8000},
      items:[{key:'K1',type:'task.find-object',category:'object',state:'pending',roomId:'ROOM01',objectId:'O1',
        summary:'Keep looking for phone',taskPriority:.83,confidence:.8,lastSeenAt:9200}]
    },
    anomalies:{active:{A1:{signature:'A1',type:'expected-object-missing',severity:'high',status:'active',roomId:'ROOM01',
      objectId:'O1',summary:'Phone missing from expected location',confidence:.9,firstSeenAt:8500,lastSeenAt:9300}}},
    sceneChanges:[{id:'C1',type:'object.moved',roomId:'ROOM01',objectId:'O1',summary:'Phone moved',confidence:.8,timestamp:9100}],
    perceptionBudget:{intensity:'focused',mainCameraMs:350,secondaryCameraMs:600,environmentCheckMs:30000},
    groundTruth:{
      generatedAt:10000,recoveryMode:false,
      entities:[{subjectId:'O1',entityType:'object',label:'phone',roomId:'ROOM01',state:'confirmed',authority:'direct-observation',freshness:'current',confidence:.88,observedAt:8900}],
      conflicts:[]
    },
    operationalHealth:{status:'healthy',staleEntityCount:0,conflictedEntityCount:0,continuityIssueCount:0,issues:[]}
  };
}

test('builds a compact governed agent context',()=>{
  const result=buildAgentContext(context(),{},10000);
  assert.equal(result.schemaVersion,AGENT_CONTEXT_SCHEMA_VERSION);
  assert.equal(result.activeRoom.name,'Office');
  assert.match(result.summary,/Office/);
  assert.equal(result.task.mode,'find-object');
  assert.equal(result.people.length,2);
  assert.equal(result.objects.length,1);
  assert.equal(result.anomalies.length,1);
  assert.ok(result.priorities.length>=1);
});
test('anonymizes participant identity when room policy disables identity',()=>{
  const result=buildAgentContext(context(),{},10000);
  const kitchen=result.people.find((item)=>item.roomId==='ROOM02');
  assert.equal(kitchen.label,'Anonymous participant');
  assert.equal(kitchen.participantId,null);
});
test('does not expose last-known object memory where spatial memory is disabled',()=>{
  const result=buildAgentContext(context(),{},10000);
  assert.equal(result.objects.some((item)=>item.objectId==='O2'),false);
});
test('reports active-room privacy capability constraints',()=>{
  const result=buildAgentContext(context(),{},10000);
  assert.ok(result.privacy.constraints.includes('transcript-storage-disabled'));
  assert.equal(result.privacy.regionCount,1);
});
test('sanitizer strips raw images embeddings descriptors audio transcripts and provider payloads',()=>{
  const result=sanitizeAgentContext({safe:'yes',nested:{embedding:[1,2,3],imageDataUrl:'private',faceDescriptor:[1],
    audio:[1],transcript:'private words',providerPayload:{secret:true},keep:'ok'}});
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/embedding|imageDataUrl|Descriptor|audio|transcript|providerPayload/);
  assert.equal(result.nested.keep,'ok');
});
test('prioritizes confirmed anomalies and attention items without raw evidence',()=>{
  const ctx=context();
  ctx.anomalies.active.A1.evidence={imageDataUrl:'private',embedding:[1,2]};
  ctx.attention.items[0].data={rawPayload:{x:1}};
  const result=buildAgentContext(ctx,{},10000);
  assert.equal(result.priorities[0].source,'anomaly');
  assert.doesNotMatch(JSON.stringify(result),/imageDataUrl|embedding|rawPayload/);
});
test('initial delta returns the complete stable projection',()=>{
  const current=buildAgentContext(context(),{},10000);
  const delta=diffAgentContext(null,current);
  assert.equal(delta.changed,true);
  assert.equal(delta.reason,'initial-context');
  assert.equal(delta.current.activeRoom.id,'ROOM01');
});
test('unchanged contexts do not emit a changed delta when only freshness advances',()=>{
  const before=buildAgentContext(context(),{},10000);
  const after=buildAgentContext(context(),{},11000);
  assert.equal(diffAgentContext(before,after).changed,false);
});
test('semantic delta ignores observation timestamp and small confidence jitter',()=>{
  const beforeContext=context();
  const afterContext=context();
  afterContext.multiRoom.participants.P1.lastObservedAt=10950;
  afterContext.multiRoom.participants.P1.confidence=.93;
  afterContext.multiRoom.objects.O1.lastObservedAt=10980;
  afterContext.multiRoom.objects.O1.confidence=.89;
  afterContext.anomalies.active.A1.lastSeenAt=10990;
  afterContext.anomalies.active.A1.confidence=.91;
  const before=buildAgentContext(beforeContext,{},10000);
  const after=buildAgentContext(afterContext,{},11000);
  assert.equal(diffAgentContext(before,after).changed,false);
});

test('delta captures object anomaly task and privacy changes',()=>{
  const before=buildAgentContext(context(),{},10000);
  const next=context();
  next.multiRoom.objects.O3={id:'O3',label:'wallet',roomId:'ROOM01',presence:'confirmed',confidence:.81,lastObservedAt:10100};
  next.groundTruth.entities.push({subjectId:'O3',entityType:'object',label:'wallet',roomId:'ROOM01',state:'confirmed',authority:'direct-observation',freshness:'current',confidence:.81,observedAt:10100});
  next.anomalies.active={};
  next.attention.activeTask={id:'T2',mode:'general',label:'General awareness',status:'active',startedAt:10100};
  next.roomPolicies.ROOM01.allowRoomAudio=false;
  const delta=diffAgentContext(before,buildAgentContext(next,{},10200));
  assert.equal(delta.changed,true);
  assert.equal(delta.taskChanged,true);
  assert.equal(delta.privacyChanged,true);
  assert.equal(delta.objects.added.some((item)=>item.objectId==='O3'),true);
  assert.equal(delta.anomalies.removed.some((item)=>item.signature==='A1'),true);
});
test('context declares safety and authority boundaries',()=>{
  const result=buildAgentContext(context(),{},10000);
  assert.ok(result.boundaries.includes('no-autonomous-physical-control'));
  assert.ok(result.boundaries.includes('privacy-policy-remains-authoritative'));
  assert.ok(result.boundaries.includes('semantic-context-only'));
});

test('Agent context exposes observed authority and operational health separately from legacy object list',()=>{
  const result=buildAgentContext(context(),{},10000);
  assert.equal(result.groundTruth.entities[0].subjectId,'O1');
  assert.equal(result.groundTruth.entities[0].authority,'direct-observation');
  assert.equal(result.groundTruth.entities[0].freshness,'current');
  assert.equal(result.groundTruth.health.status,'healthy');
});
test('Agent context makes recovery-mode historical truth explicit',()=>{
  const ctx=context();
  ctx.groundTruth.recoveryMode=true;
  ctx.groundTruth.entities[0]={...ctx.groundTruth.entities[0],roomId:null,lastKnownRoomId:'ROOM01',state:'last-known',authority:'recovered-history',freshness:'unknown',confidence:.3};
  const result=buildAgentContext(ctx,{},10000);
  assert.equal(result.groundTruth.recoveryMode,true);
  assert.match(result.summary,/recovery mode/i);
});
test('ground truth conflicts participate in semantic context delta',()=>{
  const before=buildAgentContext(context(),{},10000);
  const ctx=context();
  ctx.groundTruth.conflicts=[{id:'X1',type:'simultaneous-location',subjectId:'O1',roomIds:['ROOM01','ROOM02'],summary:'Conflict',confidence:.8,unresolved:true}];
  const after=buildAgentContext(ctx,{},10000);
  const delta=diffAgentContext(before,after);
  assert.equal(delta.changed,true);
  assert.equal(delta.groundTruthChanged,true);
});

test('canonical ground truth overrides conflicting legacy multi-room object location',()=>{
  const ctx=context();
  ctx.multiRoom.objects.O1.roomId='ROOM02';
  ctx.multiRoom.objects.O1.lastKnownRoomId='ROOM02';
  ctx.groundTruth.entities[0]={...ctx.groundTruth.entities[0],roomId:'ROOM01',lastKnownRoomId:'ROOM01'};
  const result=buildAgentContext(ctx,{},10000);
  const phone=result.objects.find(item=>item.objectId==='O1');
  assert.equal(phone.roomId,'ROOM01');
  assert.equal(phone.authority,'direct-observation');
});
test('canonical ground truth suppresses noncanonical extra object evidence when truth exists',()=>{
  const ctx=context();
  ctx.multiRoom.objects.O9={id:'O9',label:'ghost-object',roomId:'ROOM01',presence:'confirmed',confidence:1,lastObservedAt:9999};
  const result=buildAgentContext(ctx,{},10000);
  assert.equal(result.objects.some(item=>item.objectId==='O9'),false);
});
