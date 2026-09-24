import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeNewTrack,
  bestVoiceMatch,
  buildConversationGroups,
  cloneReadiness,
  dbFromRms,
  normalizeAudio,
  rmsLevel,
  speakingState
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

test('bestVoiceMatch selects enrolled speaker embedding', () => {
  const participants = [
    { id:'a', voiceRecognitionEnabled:true, voiceEmbeddings:[[1,0,0]] },
    { id:'b', voiceRecognitionEnabled:true, voiceEmbeddings:[[0,1,0]] }
  ];
  const match = bestVoiceMatch([0.98,0.04,0], participants, 0.8);
  assert.equal(match.matched, true);
  assert.equal(match.participant.id, 'a');
});

test('conversation groups follow participant proximity', () => {
  const tracks = [
    { id:'T1', participantId:'a', cx:0.1, cy:0.5 },
    { id:'T2', participantId:'b', cx:0.2, cy:0.5 },
    { id:'T3', participantId:'c', cx:0.85, cy:0.5 }
  ];
  const groups = buildConversationGroups(tracks, 0.2);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g)=>g.length===2).length, 2);
});

test('new unknown tracks are explicitly acknowledged', () => {
  const event = acknowledgeNewTrack({id:'T009'});
  assert.equal(event.type, 'new-participant-detected');
  assert.match(event.message, /T009/);
});

test('voice clone readiness requires consent and enough audio', () => {
  const ready = cloneReadiness({
    voiceCloneConsent:true,
    voiceSamples:[{durationSeconds:12}]
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.cloned, false);
});

test('speakingState applies threshold', () => {
  assert.equal(speakingState(-30, -42), 'speaking');
  assert.equal(speakingState(-60, -42), 'quiet');
});
