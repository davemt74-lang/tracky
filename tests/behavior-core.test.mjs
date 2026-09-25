import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyOrientation,
  buildBehaviorEvidence,
  faceOrientation,
  inferMotion,
  inferPosture,
  inferRaisedHands,
  inferWave,
  keypointMap,
  likelyAttentionTarget
} from '../src/behavior-core.js';

function kp(part, x, y, score = 0.9) {
  return { part, x, y, score };
}

test('keypointMap filters low-confidence landmarks', () => {
  const map = keypointMap([
    kp('leftShoulder', 0.2, 0.3, 0.9),
    kp('rightShoulder', 0.7, 0.3, 0.1)
  ]);
  assert.equal(map.has('leftShoulder'), true);
  assert.equal(map.has('rightShoulder'), false);
});

test('faceOrientation uses conservative yaw and pitch thresholds', () => {
  assert.equal(faceOrientation({rotation:{angle:{yaw:-0.3,pitch:0,roll:0}},quality:0.9}).horizontal, 'left');
  assert.equal(faceOrientation({rotation:{angle:{yaw:0.02,pitch:0.25,roll:0}},quality:0.9}).vertical, 'down');
  assert.equal(faceOrientation(null).horizontal, 'unknown');
});

test('body orientation distinguishes frontal from profile-ish shoulder geometry', () => {
  const front = bodyOrientation({
    box:{width:0.4},
    keypoints:[kp('leftShoulder',0.2,0.3),kp('rightShoulder',0.4,0.3)]
  });
  const profile = bodyOrientation({
    box:{width:0.4},
    keypoints:[kp('leftShoulder',0.29,0.3),kp('rightShoulder',0.34,0.3)]
  });
  assert.equal(front.horizontal, 'front-ish');
  assert.equal(profile.horizontal, 'profile-ish');
});

test('posture infers standing from hip knee ankle vertical structure', () => {
  const result = inferPosture({
    box:{height:0.8},
    keypoints:[
      kp('leftHip',0.4,0.40),kp('rightHip',0.6,0.40),
      kp('leftKnee',0.4,0.58),kp('rightKnee',0.6,0.58),
      kp('leftAnkle',0.4,0.78),kp('rightAnkle',0.6,0.78)
    ]
  });
  assert.equal(result.posture, 'standing');
});

test('raised hand requires wrist above shoulder', () => {
  const result = inferRaisedHands({
    keypoints:[
      kp('leftShoulder',0.3,0.4),
      kp('leftElbow',0.28,0.3),
      kp('leftWrist',0.25,0.2),
      kp('rightShoulder',0.7,0.4),
      kp('rightWrist',0.72,0.6)
    ]
  });
  assert.equal(result.leftRaised, true);
  assert.equal(result.rightRaised, false);
  assert.equal(result.gesture, 'left-hand-raised');
});

test('wave requires lateral wrist oscillation and reversals', () => {
  const result = inferWave([
    {x:0.40},{x:0.48},{x:0.39},{x:0.49},{x:0.40},{x:0.50}
  ]);
  assert.equal(result.detected, true);
  assert.ok(result.reversals >= 2);
});

test('motion labels stationary and moving tracks', () => {
  assert.equal(inferMotion({vx:0.01,vy:0.01}).motion, 'stationary');
  assert.equal(inferMotion({vx:0.2,vy:0.02}).motion, 'moving');
});

test('attention selects a participant in the head-turn direction', () => {
  const source = {
    id:'T1',cx:0.5,cy:0.5,box:{x:0.4,y:0.2,width:0.2,height:0.6,cx:0.5,cy:0.5},
    face:{rotation:{angle:{yaw:0.35,pitch:0,roll:0}},quality:0.9}
  };
  const right = {
    id:'T2',participantId:'p2',participantName:'Sarah',
    cx:0.68,cy:0.5,status:'matched',
    box:{x:0.58,y:0.2,width:0.2,height:0.6,cx:0.68,cy:0.5}
  };
  const target = likelyAttentionTarget(source,[source,right]);
  assert.equal(target.targetTrackId,'T2');
  assert.equal(target.targetName,'Sarah');
});

test('center-facing attention is represented as camera rather than exact gaze', () => {
  const source = {
    id:'T1',
    face:{rotation:{angle:{yaw:0.01,pitch:0,roll:0}},quality:0.9}
  };
  const target = likelyAttentionTarget(source,[source]);
  assert.equal(target.targetType,'camera');
});

test('buildBehaviorEvidence combines pose motion gesture and attention', () => {
  const track = {
    id:'T1',vx:0,vy:0,cx:0.5,cy:0.5,box:{width:0.3,height:0.7},
    face:{rotation:{angle:{yaw:0,pitch:0,roll:0}},quality:0.9},
    keypoints:[
      kp('leftShoulder',0.4,0.3),kp('rightShoulder',0.6,0.3),
      kp('leftWrist',0.38,0.2),kp('rightWrist',0.62,0.5),
      kp('leftHip',0.43,0.5),kp('rightHip',0.57,0.5),
      kp('leftKnee',0.43,0.65),kp('rightKnee',0.57,0.65),
      kp('leftAnkle',0.43,0.82),kp('rightAnkle',0.57,0.82)
    ]
  };
  const result = buildBehaviorEvidence(track,[track]);
  assert.equal(result.motion.motion,'stationary');
  assert.equal(result.gesture.type,'left-hand-raised');
  assert.equal(result.attention.targetType,'camera');
});
