import test from 'node:test';
import assert from 'node:assert/strict';
import {
  associateFacesToBodies,
  assignBodyTracks,
  attachFacesToTracks,
  bodyDetection,
  carryOccludedTracks,
  roomPresenceState
} from '../src/room-tracking-core.js';

test('bodyDetection normalizes a full-body bounding box', () => {
  const detection = bodyDetection({ box: [100, 50, 200, 400], score: 0.9 }, 1000, 500);
  assert.equal(detection.box.x, 0.1);
  assert.equal(detection.box.y, 0.1);
  assert.equal(detection.box.width, 0.2);
  assert.equal(detection.box.height, 0.8);
});

test('face is associated with the body containing its head', () => {
  const faces = [{ box: { x: 0.18, y: 0.1, width: 0.08, height: 0.1, cx: 0.22, cy: 0.15 } }];
  const bodies = [
    { box: { x: 0.1, y: 0.05, width: 0.3, height: 0.8, cx: 0.25, cy: 0.45 } },
    { box: { x: 0.6, y: 0.05, width: 0.3, height: 0.8, cx: 0.75, cy: 0.45 } }
  ];
  const assignments = associateFacesToBodies(faces, bodies);
  assert.equal(assignments.get(0), 0);
});

test('body track preserves identity when face disappears', () => {
  const previous = [{
    id: 'T001',
    box: { x: 0.2, y: 0.1, width: 0.3, height: 0.8, cx: 0.35, cy: 0.5 },
    cx: 0.35,
    cy: 0.5,
    vx: 0,
    vy: 0,
    lastSeenAt: 0,
    lastBodySeenAt: 0,
    participantId: 'p1',
    participantName: 'Dave',
    status: 'matched'
  }];
  const bodies = [{
    box: { x: 0.22, y: 0.1, width: 0.3, height: 0.8, cx: 0.37, cy: 0.5 },
    score: 0.9
  }];
  const next = assignBodyTracks(previous, bodies, 100);
  assert.equal(next[0].id, 'T001');
  assert.equal(next[0].participantId, 'p1');
  assert.equal(next[0].status, 'body-lock');
});

test('short occlusion carries identified participant track', () => {
  const previous = [{
    id: 'T001',
    lastSeenAt: 1000,
    lastBodySeenAt: 1000,
    participantId: 'p1',
    participantName: 'Dave'
  }];
  const carried = carryOccludedTracks(previous, [], 4000, 6000);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].status, 'occluded');
  assert.equal(carried[0].participantId, 'p1');
});

test('expired occlusion does not preserve stale track', () => {
  const previous = [{ id: 'T001', lastSeenAt: 0, lastBodySeenAt: 0, participantId: 'p1' }];
  const carried = carryOccludedTracks(previous, [], 7000, 6000);
  assert.equal(carried.length, 0);
});

test('face descriptor attaches to matching body track', () => {
  const tracks = [{ id: 'T001', cx: 0.25, cy: 0.5, participantId: null }];
  const faces = [{ box: { cx: 0.24, cy: 0.15 }, quality: 0.9, embedding: [1, 2, 3] }];
  const bodies = [{ box: { cx: 0.25, cy: 0.5 } }];
  const assignments = new Map([[0, 0]]);
  const attached = attachFacesToTracks(tracks, faces, bodies, assignments, 500);
  assert.deepEqual(attached[0].embedding, [1, 2, 3]);
  assert.equal(attached[0].lastFaceSeenAt, 500);
});

test('presence state reports body lock after face turns away', () => {
  const state = roomPresenceState({
    participantId: 'p1',
    lastFaceSeenAt: 1000,
    lastBodySeenAt: 3000
  }, 3100);
  assert.equal(state, 'body-lock');
});
