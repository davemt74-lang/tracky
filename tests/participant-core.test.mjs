import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceScan,
  assignTracks,
  bestParticipantMatch,
  cosineSimilarity,
  faceQuality,
  normalizeBox,
  robustProfileSimilarity
} from '../src/participant-core.js';

test('normalizeBox converts pixel boxes into normalized coordinates', () => {
  const box = normalizeBox([100, 50, 200, 100], 1000, 500);
  assert.equal(box.x, 0.1);
  assert.equal(box.y, 0.1);
  assert.equal(box.width, 0.2);
  assert.equal(box.height, 0.2);
});

test('faceQuality rewards a large centered frontal face', () => {
  const good = faceQuality({ box: [350, 150, 300, 300], score: 0.98, rotation: { yaw: 0, pitch: 0, roll: 0 } }, 1000, 600);
  const poor = faceQuality({ box: [0, 0, 80, 80], score: 0.50, rotation: { yaw: 40, pitch: 20, roll: 15 } }, 1000, 600);
  assert.ok(good > poor);
  assert.ok(good > 0.65);
});

test('cosineSimilarity identifies identical embeddings', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  assert.ok(cosineSimilarity([1, 0], [0, 1]) < 0.01);
});

test('bestParticipantMatch chooses enrolled participant above threshold', () => {
  const participants = [
    { id: 'a', name: 'A', embeddings: [[1, 0, 0], [0.99, 0.02, 0], [0.98, 0.04, 0]], recognitionEnabled: true },
    { id: 'b', name: 'B', embeddings: [[0, 1, 0], [0.02, 0.99, 0], [0.04, 0.98, 0]], recognitionEnabled: true }
  ];
  const match = bestParticipantMatch([0.99, 0.05, 0], participants, 0.8);
  assert.equal(match.matched, true);
  assert.equal(match.participant.id, 'a');
});

test('bestParticipantMatch refuses weak match', () => {
  const participants = [{ id: 'a', embeddings: [[1, 0], [0.99, 0.01], [0.98, 0.02]], recognitionEnabled: true }];
  const match = bestParticipantMatch([0, 1], participants, 0.8);
  assert.equal(match.matched, false);
});

test('assignTracks preserves a nearby room track ID', () => {
  const previous = [{
    id: 'T0001',
    cx: 0.25,
    cy: 0.25,
    box: { cx: 0.25, cy: 0.25 },
    scanProgress: 40,
    samples: 2,
    firstSeenAt: 0
  }];
  const detections = [{
    box: { cx: 0.27, cy: 0.28 },
    quality: 0.8,
    embedding: [1, 2]
  }];
  const tracks = assignTracks(previous, detections, 100, { nextId: () => 'T9999' });
  assert.equal(tracks[0].id, 'T0001');
  assert.equal(tracks[0].scanProgress, 40);
});

test('assignTracks creates distinct IDs for multiple people', () => {
  let id = 0;
  const tracks = assignTracks([], [
    { box: { cx: 0.2, cy: 0.5 }, quality: 0.8 },
    { box: { cx: 0.8, cy: 0.5 }, quality: 0.8 }
  ], 0, { nextId: () => 'T' + (++id) });
  assert.deepEqual(tracks.map((t) => t.id), ['T1', 'T2']);
});

test('advanceScan reaches ready state with repeated high-quality samples', () => {
  let track = { scanProgress: 0, samples: 0, quality: 1, status: 'detected' };
  for (let i = 0; i < 6; i += 1) track = advanceScan(track, { increment: 20 });
  assert.equal(track.scanProgress, 100);
  assert.equal(track.status, 'ready');
});


test('robustProfileSimilarity does not trust one outlier reference', () => {
  const score = robustProfileSimilarity(
    [1, 0],
    [[1, 0], [0, 1], [0, 1]],
    2
  );
  assert.ok(score < 0.6);
});

test('bestParticipantMatch ignores incomplete face profiles', () => {
  const match = bestParticipantMatch([1, 0], [
    { id:'a', recognitionEnabled:true, embeddings:[[1,0],[1,0]] }
  ], 0.5);
  assert.equal(match.matched, false);
});

test('bestParticipantMatch rejects ambiguous face profiles', () => {
  const participants = [
    { id:'a', recognitionEnabled:true, embeddings:[[1,0],[1,0],[1,0]] },
    { id:'b', recognitionEnabled:true, embeddings:[[0.999,0.04],[0.999,0.04],[0.999,0.04]] }
  ];
  const match = bestParticipantMatch([1,0.02], participants, 0.8, 0.05);
  assert.equal(match.matched, false);
  assert.equal(match.ambiguous, true);
});
