import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeNewTrack,
  bestVoiceMatch,
  buildConversationGroups,
  conversationGroupForTrack,
  dbFromRms,
  normalizeAudio,
  rmsLevel,
  speakingThreshold,
  transcriptSignalGate,
  updateNoiseFloor,
  voiceProfileReadiness
} from '../src/voice-core.js';

test('rms and db measure signal energy', () => {
  const samples = new Float32Array([0.5, -0.5, 0.5, -0.5]);
  assert.ok(Math.abs(rmsLevel(samples) - 0.5) < 1e-8);
  assert.ok(dbFromRms(0.5) < 0);
});

test('normalizeAudio scales peak to target', () => {
  const normalized = normalizeAudio(new Float32Array([0.2, -0.4]));
  assert.ok(Math.abs(normalized[1] + 0.95) < 1e-6);
});

test('bestVoiceMatch selects enrolled voice profile', () => {
  const participants = [
    { id:'a', voiceRecognitionEnabled:true, voiceEmbeddings:[[1,0,0]] },
    { id:'b', voiceRecognitionEnabled:true, voiceEmbeddings:[[0,1,0]] }
  ];
  const match = bestVoiceMatch([0.98,0.04,0], participants, 0.8);
  assert.equal(match.matched, true);
  assert.equal(match.participant.id, 'a');
});

test('conversation groups follow body proximity', () => {
  const tracks = [
    { id:'T1', participantId:'a', cx:0.1, cy:0.5 },
    { id:'T2', participantId:'b', cx:0.2, cy:0.5 },
    { id:'T3', participantId:'c', cx:0.85, cy:0.5 }
  ];
  const groups = buildConversationGroups(tracks, 0.2);
  assert.equal(groups.length, 2);
  const group = conversationGroupForTrack(groups, 'T1');
  assert.equal(group.tracks.length, 2);
});

test('new unknown tracks are explicitly acknowledged', () => {
  const event = acknowledgeNewTrack({id:'T009'});
  assert.equal(event.type, 'new-participant-detected');
  assert.match(event.message, /T009/);
});

test('voice profile readiness requires redundant samples', () => {
  const ready = voiceProfileReadiness({
    voiceEmbeddings:[[1],[2],[3]],
    voiceProfileSamples:[
      {durationSeconds:5},
      {durationSeconds:5},
      {durationSeconds:6}
    ]
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.sampleCount, 3);
});

test('adaptive speaking threshold follows noise floor', () => {
  assert.equal(speakingThreshold(-60, 12), -48);
  assert.equal(speakingThreshold(-40, 12), -28);
  const floor = updateNoiseFloor(-60, -50, false, 0.1);
  assert.ok(floor > -60 && floor < -50);
});

test('transcript gate rejects noisy weak attribution', () => {
  const weak = transcriptSignalGate({
    levelDb:-38,
    noiseFloorDb:-42,
    voiceConfidence:0.4,
    bodyConfirmed:false,
    vadConfirmed:true
  });
  assert.equal(weak.accept, false);

  const strong = transcriptSignalGate({
    levelDb:-22,
    noiseFloorDb:-50,
    voiceConfidence:0.91,
    bodyConfirmed:true,
    vadConfirmed:true
  });
  assert.equal(strong.accept, true);
  assert.ok(strong.confidence > 0.7);
});
