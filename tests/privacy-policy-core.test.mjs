import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyObjectObservationPolicy,
  applyParticipantObservationPolicy,
  defaultObservationPolicy,
  imageMaskRegions,
  imageRetentionAllowed,
  normalizeObservationPolicy,
  normalizePrivacyRegion,
  observationDecision,
  pixelMaskRect,
  pointInPrivacyRegion,
  sanitizeEventPayload,
  transcriptRetentionAllowed
} from '../src/privacy-policy-core.js';

test('privacy regions normalize and clamp to the room map',()=>{
  const region=normalizePrivacyRegion({x:.9,y:.8,width:.5,height:.5,mode:'anonymous'});
  assert.equal(region.width,.1);
  assert.equal(region.height,.2);
  assert.equal(region.mode,'anonymous');
});

test('point-in-region uses normalized room coordinates',()=>{
  const region=normalizePrivacyRegion({x:.2,y:.2,width:.3,height:.3});
  assert.equal(pointInPrivacyRegion({x:.3,y:.4},region),true);
  assert.equal(pointInPrivacyRegion({x:.7,y:.4},region),false);
});

test('ignore region removes participant observation before fusion',()=>{
  const policy=normalizeObservationPolicy({
    roomId:'ROOM01',
    sensitiveRegions:[{id:'R1',mode:'ignore',x:.2,y:.2,width:.3,height:.3,appliesTo:['participant']}]
  });
  const result=applyParticipantObservationPolicy({
    roomId:'ROOM01',participantId:'p1',participantName:'Dave',
    roomPosition:{x:.3,y:.3},faceConfidence:.9
  },policy);
  assert.equal(result,null);
});

test('anonymous region preserves track but strips personal identity',()=>{
  const policy=normalizeObservationPolicy({
    roomId:'ROOM01',
    sensitiveRegions:[{id:'R1',mode:'anonymous',x:0,y:0,width:1,height:1,appliesTo:['participant']}]
  });
  const result=applyParticipantObservationPolicy({
    roomId:'ROOM01',localTrackId:'T1',participantId:'p1',participantName:'Dave',
    roomPosition:{x:.3,y:.3},faceConfidence:.9,identitySource:'face'
  },policy);
  assert.equal(result.localTrackId,'T1');
  assert.equal(result.participantId,null);
  assert.equal(result.participantName,null);
  assert.equal(result.faceConfidence,0);
});

test('room policy can disable object observations globally',()=>{
  const policy=normalizeObservationPolicy({roomId:'ROOM01',allowObjectObservation:false});
  assert.equal(applyObjectObservationPolicy({
    roomId:'ROOM01',localObjectId:'O1',roomPosition:{x:.4,y:.4}
  },policy),null);
});

test('live-only region permits event but denies persistence',()=>{
  const policy=normalizeObservationPolicy({
    roomId:'ROOM01',
    sensitiveRegions:[{id:'R1',mode:'live-only',x:0,y:0,width:1,height:1,appliesTo:['transcript']}]
  });
  const decision=observationDecision({policy,kind:'transcript',position:{x:.5,y:.5}});
  assert.equal(decision.allowed,true);
  assert.equal(decision.retentionAllowed,false);
});

test('identity-off room anonymizes participant events',()=>{
  const policy=normalizeObservationPolicy({roomId:'ROOM01',allowParticipantIdentity:false});
  const result=sanitizeEventPayload('participant.recognized',{
    participantId:'p1',participantName:'Dave',trackId:'T1',roomPosition:{x:.5,y:.5}
  },policy);
  assert.equal(result.suppressed,false);
  assert.equal(result.payload.participantId,null);
  assert.equal(result.payload.participantName,null);
});

test('behavior policy suppresses behavior events',()=>{
  const policy=normalizeObservationPolicy({roomId:'ROOM01',allowBehaviorAnalysis:false});
  const result=sanitizeEventPayload('behavior.changed',{
    trackId:'T1',roomPosition:{x:.5,y:.5}
  },policy);
  assert.equal(result.suppressed,true);
});

test('transcript storage can be disabled while live transcription remains on',()=>{
  const policy=normalizeObservationPolicy({
    roomId:'ROOM01',
    allowLiveTranscription:true,
    allowTranscriptStorage:false
  });
  assert.equal(transcriptRetentionAllowed(policy,{x:.2,y:.2}),false);
});

test('image retention is independently governed by image type',()=>{
  const policy=defaultObservationPolicy('ROOM01');
  policy.retainPrimaryImages=true;
  policy.retainAlternateViewImages=false;
  assert.equal(imageRetentionAllowed(policy,'primary'),true);
  assert.equal(imageRetentionAllowed(policy,'alternate'),false);
});

test('all enabled sensitive regions become image masks by default',()=>{
  const policy=normalizeObservationPolicy({
    roomId:'ROOM01',
    sensitiveRegions:[
      {id:'A',x:.1,y:.1,width:.2,height:.2},
      {id:'B',x:.5,y:.5,width:.2,height:.2,maskImage:false}
    ]
  });
  assert.deepEqual(imageMaskRegions(policy).map((item)=>item.id),['A']);
  assert.deepEqual(pixelMaskRect(imageMaskRegions(policy)[0],1000,500),{
    x:100,y:50,width:200,height:100
  });
});
