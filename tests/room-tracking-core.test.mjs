import test from 'node:test';
import assert from 'node:assert/strict';
import {
  associateFacesToBodies,
  assignBodyTracks,
  augmentBodiesWithFaceFallbacks,
  attachFacesToTracks,
  bodyDetection,
  carryOccludedTracks,
  dedupeParticipantAssignments,
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


test('face-only fallback creates a synthetic body so face recognition still works', () => {
  const faces = [{ box: { x: 0.4, y: 0.1, width: 0.12, height: 0.14, cx: 0.46, cy: 0.17 }, score: 0.9 }];
  const bodies = augmentBodiesWithFaceFallbacks(faces, []);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].synthetic, true);
  const assignments = associateFacesToBodies(faces, bodies);
  assert.equal(assignments.get(0), 0);
});

test('motion prediction helps preserve IDs when two people cross paths', () => {
  const previous = [
    {
      id: 'T001',
      box: { x: 0.2, y: 0.1, width: 0.2, height: 0.8, cx: 0.3, cy: 0.5 },
      cx: 0.3, cy: 0.5, vx: 0.25, vy: 0,
      lastSeenAt: 1000, lastBodySeenAt: 1000,
      participantId: 'p1'
    },
    {
      id: 'T002',
      box: { x: 0.6, y: 0.1, width: 0.2, height: 0.8, cx: 0.7, cy: 0.5 },
      cx: 0.7, cy: 0.5, vx: -0.25, vy: 0,
      lastSeenAt: 1000, lastBodySeenAt: 1000,
      participantId: 'p2'
    }
  ];
  // Test after the exact overlap moment, once the two bodies begin separating.
  // At a perfectly symmetric overlap, geometry alone cannot determine identity.
  const detections = [
    { box: { x: 0.48, y: 0.1, width: 0.2, height: 0.8, cx: 0.58, cy: 0.5 }, score: 0.9 },
    { box: { x: 0.32, y: 0.1, width: 0.2, height: 0.8, cx: 0.42, cy: 0.5 }, score: 0.9 }
  ];
  const next = assignBodyTracks(previous, detections, 2000);
  const p1 = next.find((track) => track.participantId === 'p1');
  const p2 = next.find((track) => track.participantId === 'p2');
  assert.ok(p1.cx > p2.cx);
});


test('dedupeParticipantAssignments keeps the freshest live identity track', () => {
  const tracks = [
    {
      id:'T001',
      participantId:'p1',
      participantName:'Dave',
      status:'occluded',
      lastBodySeenAt:1000,
      similarity:0.91,
      face:null
    },
    {
      id:'T002',
      participantId:'p1',
      participantName:'Dave',
      status:'matched',
      lastBodySeenAt:2000,
      similarity:0.88,
      face:{}
    }
  ];
  const result = dedupeParticipantAssignments(tracks);
  assert.equal(result[1].participantId, 'p1');
  assert.equal(result[0].participantId, null);
});
