import { clamp } from './participant-core.js';
import { trackDistance } from './voice-core.js';

export const POSE_MIN_SCORE = 0.30;
export const ATTENTION_MAX_DISTANCE = 0.48;

export function keypointMap(keypoints = [], minScore = POSE_MIN_SCORE) {
  const map = new Map();
  for (const point of keypoints || []) {
    if (!point?.part || Number(point.score || 0) < minScore) continue;
    map.set(point.part, point);
  }
  return map;
}

export function pointConfidence(...points) {
  const valid = points.filter(Boolean);
  if (!valid.length) return 0;
  return valid.reduce((sum, point) => sum + Number(point.score || 0), 0) / valid.length;
}

export function faceOrientation(face) {
  const angle = face?.rotation?.angle;
  if (!angle) {
    return {
      horizontal: 'unknown',
      vertical: 'unknown',
      yaw: null,
      pitch: null,
      confidence: 0,
      source: 'none'
    };
  }

  const yaw = Number(angle.yaw || 0);
  const pitch = Number(angle.pitch || 0);
  const horizontal = yaw <= -0.18
    ? 'left'
    : yaw >= 0.18
      ? 'right'
      : 'center';
  const vertical = pitch <= -0.16
    ? 'up'
    : pitch >= 0.18
      ? 'down'
      : 'level';

  return {
    horizontal,
    vertical,
    yaw,
    pitch,
    confidence: clamp(Number(face.quality || face.score || 0.7)),
    source: 'face-rotation'
  };
}

export function bodyOrientation(track) {
  const points = keypointMap(track?.keypoints);
  const leftShoulder = points.get('leftShoulder');
  const rightShoulder = points.get('rightShoulder');

  if (!leftShoulder || !rightShoulder) {
    return {
      horizontal: 'unknown',
      confidence: 0,
      shoulderSpan: null,
      source: 'none'
    };
  }

  const span = Math.abs(rightShoulder.x - leftShoulder.x);
  const bodyWidth = Math.max(0.05, Number(track?.box?.width || 0.25));
  const ratio = span / bodyWidth;
  const confidence = clamp(pointConfidence(leftShoulder, rightShoulder));

  // A large visible shoulder span is useful evidence for a frontal body,
  // but it is not sufficient to infer exact left/right facing direction.
  return {
    horizontal: ratio >= 0.48 ? 'front-ish' : 'profile-ish',
    confidence,
    shoulderSpan: span,
    shoulderRatio: ratio,
    source: 'shoulder-geometry'
  };
}

export function inferPosture(track) {
  const points = keypointMap(track?.keypoints);
  const leftHip = points.get('leftHip');
  const rightHip = points.get('rightHip');
  const leftKnee = points.get('leftKnee');
  const rightKnee = points.get('rightKnee');
  const leftAnkle = points.get('leftAnkle');
  const rightAnkle = points.get('rightAnkle');

  const hip = averagePoint(leftHip, rightHip);
  const knee = averagePoint(leftKnee, rightKnee);
  const ankle = averagePoint(leftAnkle, rightAnkle);

  if (!hip || !knee) {
    return { posture: 'unknown', confidence: 0, evidence: {} };
  }

  const bodyHeight = Math.max(0.1, Number(track?.box?.height || 0.5));
  const hipToKnee = (knee.y - hip.y) / bodyHeight;
  const kneeToAnkle = ankle ? (ankle.y - knee.y) / bodyHeight : null;

  let posture = 'unknown';
  if (
    ankle &&
    hipToKnee >= 0.16 &&
    kneeToAnkle >= 0.15
  ) {
    posture = 'standing';
  } else if (
    hipToKnee >= -0.03 &&
    hipToKnee <= 0.16
  ) {
    posture = 'sitting';
  }

  return {
    posture,
    confidence: clamp(pointConfidence(
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      leftAnkle,
      rightAnkle
    )),
    evidence: {
      hipToKnee,
      kneeToAnkle
    }
  };
}

export function inferMotion(track, thresholds = {}) {
  const speed = Math.hypot(Number(track?.vx || 0), Number(track?.vy || 0));
  const stationaryThreshold = thresholds.stationary ?? 0.035;
  const walkingThreshold = thresholds.walking ?? 0.11;

  return {
    motion: speed >= walkingThreshold
      ? 'moving'
      : speed <= stationaryThreshold
        ? 'stationary'
        : 'shifting',
    speed,
    confidence: clamp(Math.abs(speed - stationaryThreshold) / Math.max(0.12, walkingThreshold))
  };
}

function raisedSide(points, side) {
  const shoulder = points.get(side + 'Shoulder');
  const wrist = points.get(side + 'Wrist');
  const elbow = points.get(side + 'Elbow');

  if (!shoulder || !wrist) return null;
  const margin = 0.035;
  const raised = wrist.y < shoulder.y - margin;
  const confidence = clamp(pointConfidence(shoulder, wrist, elbow));

  return {
    side,
    raised,
    confidence,
    wrist,
    shoulder,
    elbow
  };
}

export function inferRaisedHands(track) {
  const points = keypointMap(track?.keypoints);
  const left = raisedSide(points, 'left');
  const right = raisedSide(points, 'right');
  const raised = [left, right].filter((item) => item?.raised);

  return {
    leftRaised: Boolean(left?.raised),
    rightRaised: Boolean(right?.raised),
    gesture: raised.length === 2
      ? 'both-hands-raised'
      : raised.length === 1
        ? raised[0].side + '-hand-raised'
        : null,
    confidence: raised.length
      ? raised.reduce((sum, item) => sum + item.confidence, 0) / raised.length
      : Math.max(left?.confidence || 0, right?.confidence || 0)
  };
}

export function inferWave(history = [], options = {}) {
  const minSamples = options.minSamples ?? 5;
  const minSpan = options.minSpan ?? 0.055;
  const minReversals = options.minReversals ?? 2;

  if (history.length < minSamples) {
    return { detected: false, confidence: 0, reversals: 0, span: 0 };
  }

  const recent = history.slice(-8);
  const xs = recent.map((sample) => sample.x);
  const span = Math.max(...xs) - Math.min(...xs);

  let reversals = 0;
  let previousDirection = 0;
  for (let index = 1; index < recent.length; index += 1) {
    const delta = recent[index].x - recent[index - 1].x;
    const direction = Math.abs(delta) < 0.008 ? 0 : Math.sign(delta);
    if (direction && previousDirection && direction !== previousDirection) reversals += 1;
    if (direction) previousDirection = direction;
  }

  const detected = span >= minSpan && reversals >= minReversals;
  return {
    detected,
    confidence: detected
      ? clamp((span / (minSpan * 1.8)) * 0.55 + (reversals / 4) * 0.45)
      : 0,
    reversals,
    span
  };
}

export function likelyAttentionTarget(track, tracks = []) {
  const orientation = faceOrientation(track?.face);
  if (orientation.confidence < 0.35) {
    return {
      targetTrackId: null,
      targetParticipantId: null,
      targetName: null,
      targetType: 'unknown',
      confidence: 0,
      evidence: { orientation }
    };
  }

  if (orientation.horizontal === 'center') {
    return {
      targetTrackId: null,
      targetParticipantId: null,
      targetName: 'Agent / camera',
      targetType: 'camera',
      confidence: orientation.confidence * 0.72,
      evidence: { orientation }
    };
  }

  const direction = orientation.horizontal === 'left' ? -1 : 1;
  const candidates = (tracks || [])
    .filter((candidate) => candidate.id !== track.id)
    .filter((candidate) => candidate.status !== 'occluded' && candidate.status !== 'reacquiring')
    .map((candidate) => {
      const horizontal = Number(candidate.cx || 0.5) - Number(track.cx || 0.5);
      const directionCorrect = Math.sign(horizontal) === direction;
      const distance = trackDistance(track, candidate);
      const verticalDifference = Math.abs(
        Number(candidate.cy || 0.5) - Number(track.cy || 0.5)
      );
      const score = directionCorrect
        ? clamp(1 - distance / ATTENTION_MAX_DISTANCE) * clamp(1 - verticalDifference / 0.42)
        : 0;
      return { candidate, distance, score };
    })
    .filter((item) => item.distance <= ATTENTION_MAX_DISTANCE && item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.22) {
    return {
      targetTrackId: null,
      targetParticipantId: null,
      targetName: null,
      targetType: 'room-direction',
      confidence: orientation.confidence * 0.45,
      evidence: { orientation }
    };
  }

  return {
    targetTrackId: best.candidate.id,
    targetParticipantId: best.candidate.participantId || null,
    targetName: best.candidate.participantName || best.candidate.id,
    targetType: best.candidate.participantId ? 'participant' : 'track',
    confidence: clamp(orientation.confidence * 0.6 + best.score * 0.4),
    evidence: {
      orientation,
      distance: best.distance,
      directionalScore: best.score
    }
  };
}

export function inferAddressing(track, tracks, speaking = false) {
  const attention = likelyAttentionTarget(track, tracks);
  const target = attention.targetTrackId
    ? tracks.find((candidate) => candidate.id === attention.targetTrackId)
    : null;
  const sameGroup = Boolean(
    target &&
    track.conversationGroupId &&
    track.conversationGroupId !== 'SOLO' &&
    track.conversationGroupId === target.conversationGroupId
  );

  const confidence = clamp(
    attention.confidence * 0.55 +
    (speaking ? 0.28 : 0) +
    (sameGroup ? 0.17 : 0)
  );

  return {
    addressing: Boolean(
      speaking &&
      target &&
      sameGroup &&
      confidence >= 0.58
    ),
    targetTrackId: target?.id || null,
    targetParticipantId: target?.participantId || null,
    targetName: target?.participantName || target?.id || null,
    confidence,
    evidence: {
      attention,
      speaking,
      sameGroup
    }
  };
}

export function buildBehaviorEvidence(track, tracks = [], options = {}) {
  const face = faceOrientation(track?.face);
  const body = bodyOrientation(track);
  const posture = inferPosture(track);
  const motion = inferMotion(track);
  const raisedHands = inferRaisedHands(track);
  const attention = likelyAttentionTarget(track, tracks);
  const addressing = inferAddressing(track, tracks, options.speaking === true);

  return {
    trackId: track?.id || null,
    orientation: {
      horizontal: face.horizontal !== 'unknown' ? face.horizontal : body.horizontal,
      vertical: face.vertical,
      confidence: Math.max(face.confidence, body.confidence),
      source: face.confidence ? face.source : body.source,
      face,
      body
    },
    posture,
    motion,
    gesture: {
      type: raisedHands.gesture,
      confidence: raisedHands.confidence,
      leftRaised: raisedHands.leftRaised,
      rightRaised: raisedHands.rightRaised
    },
    attention,
    addressing,
    poseConfidence: poseConfidence(track?.keypoints || [])
  };
}

export function poseConfidence(keypoints = []) {
  const scores = (keypoints || [])
    .map((point) => Number(point.score || 0))
    .filter(Number.isFinite);
  if (!scores.length) return 0;
  return clamp(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function averagePoint(a, b) {
  if (a && b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      score: (Number(a.score || 0) + Number(b.score || 0)) / 2
    };
  }
  return a || b || null;
}

export const POSE_CONNECTIONS = Object.freeze([
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['nose', 'leftShoulder'],
  ['nose', 'rightShoulder']
]);
