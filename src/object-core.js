import { clamp, normalizeBox } from './participant-core.js';
import { keypointMap, pointConfidence } from './behavior-core.js';

export const OBJECT_TRACK_GRACE_MS = 2600;
export const OBJECT_MAX_COST = 0.38;
export const HOLD_MAX_DISTANCE = 0.16;
export const POINT_MAX_ANGLE_RAD = Math.PI / 7;

export function objectDetection(object, frameWidth = 1, frameHeight = 1) {
  const rawBox = object?.boxRaw || object?.box;
  const alreadyNormalized = Array.isArray(object?.boxRaw);
  const box = alreadyNormalized
    ? normalizeBox(
        [
          Number(rawBox?.[0] || 0) * frameWidth,
          Number(rawBox?.[1] || 0) * frameHeight,
          Number(rawBox?.[2] || 0) * frameWidth,
          Number(rawBox?.[3] || 0) * frameHeight
        ],
        frameWidth,
        frameHeight
      )
    : normalizeBox(rawBox, frameWidth, frameHeight);

  return {
    detectorId: object?.id ?? null,
    label: String(object?.label || 'object'),
    classId: Number(object?.class ?? -1),
    score: clamp(Number(object?.score || 0)),
    box
  };
}

export function objectOverlap(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (!intersection) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function objectTrackCost(track, detection) {
  if (track.label !== detection.label) return Infinity;

  const distance = Math.hypot(
    Number(track.cx || track.box?.cx || 0.5) - detection.box.cx,
    Number(track.cy || track.box?.cy || 0.5) - detection.box.cy
  );
  const overlapPenalty = 1 - objectOverlap(track.box, detection.box);
  const oldArea = Math.max(0.0005, (track.box?.width || 0) * (track.box?.height || 0));
  const newArea = Math.max(0.0005, detection.box.width * detection.box.height);
  const sizePenalty = Math.min(1, Math.abs(Math.log(newArea / oldArea)));

  return distance * 0.66 + overlapPenalty * 0.24 + sizePenalty * 0.10;
}

export function createObjectTrack(id, detection, now = 0) {
  return {
    id,
    label: detection.label,
    classId: detection.classId,
    detectorId: detection.detectorId,
    score: detection.score,
    box: detection.box,
    cx: detection.box.cx,
    cy: detection.box.cy,
    vx: 0,
    vy: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    observations: 1,
    stable: false,
    status: 'detected',
    holderTrackId: null,
    holderParticipantId: null,
    interaction: null
  };
}

export function updateObjectTrack(track, detection, now = 0) {
  const dt = Math.max(0.05, Math.min(1.5, (now - Number(track.lastSeenAt || now)) / 1000));
  const vx = (detection.box.cx - Number(track.cx || detection.box.cx)) / dt;
  const vy = (detection.box.cy - Number(track.cy || detection.box.cy)) / dt;

  return {
    ...track,
    detectorId: detection.detectorId,
    classId: detection.classId,
    score: detection.score,
    box: detection.box,
    cx: detection.box.cx,
    cy: detection.box.cy,
    vx: Number(track.vx || 0) * 0.55 + vx * 0.45,
    vy: Number(track.vy || 0) * 0.55 + vy * 0.45,
    lastSeenAt: now,
    observations: Number(track.observations || 0) + 1,
    stable: Number(track.observations || 0) + 1 >= 2,
    status: 'tracked'
  };
}

export function assignObjectTracks(previousTracks, detections, now = 0, options = {}) {
  const nextId = options.nextId || (() => 'O' + Math.random().toString(36).slice(2, 7).toUpperCase());
  const maxCost = options.maxCost ?? OBJECT_MAX_COST;
  const unassigned = new Set((previousTracks || []).map((_, index) => index));
  const output = [];

  const ordered = [...(detections || [])]
    .filter((detection) => detection.label !== 'person')
    .sort((a, b) => b.score - a.score);

  for (const detection of ordered) {
    let bestIndex = -1;
    let bestCost = Infinity;

    for (const index of unassigned) {
      const cost = objectTrackCost(previousTracks[index], detection);
      if (cost < bestCost && cost <= maxCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      unassigned.delete(bestIndex);
      output.push(updateObjectTrack(previousTracks[bestIndex], detection, now));
    } else {
      output.push(createObjectTrack(nextId(), detection, now));
    }
  }

  return output;
}

export function carryLostObjectTracks(previousTracks, liveTracks, now = 0, graceMs = OBJECT_TRACK_GRACE_MS) {
  const liveIds = new Set((liveTracks || []).map((track) => track.id));
  return (previousTracks || [])
    .filter((track) => !liveIds.has(track.id))
    .filter((track) => now - Number(track.lastSeenAt || 0) <= graceMs)
    .map((track) => ({
      ...track,
      status: 'reacquiring'
    }));
}

export function pointToBoxDistance(point, box) {
  if (!point || !box) return Infinity;
  const x = clamp(point.x, box.x, box.x + box.width);
  const y = clamp(point.y, box.y, box.y + box.height);
  return Math.hypot(point.x - x, point.y - y);
}

export function nearestHandDistance(personTrack, objectTrack) {
  const points = keypointMap(personTrack?.keypoints || []);
  const wrists = [
    points.get('leftWrist'),
    points.get('rightWrist')
  ].filter(Boolean);

  if (!wrists.length) return { distance: Infinity, side: null, confidence: 0 };

  const ranked = wrists
    .map((wrist) => ({
      distance: pointToBoxDistance(wrist, objectTrack.box),
      side: wrist.part?.startsWith('left') ? 'left' : 'right',
      confidence: Number(wrist.score || 0)
    }))
    .sort((a, b) => a.distance - b.distance);

  return ranked[0];
}

export function inferHolding(personTrack, objectTrack, handDetections = []) {
  if (!personTrack?.box || !objectTrack?.box) {
    return { holding: false, confidence: 0, distance: Infinity, handSide: null };
  }

  const wrist = nearestHandDistance(personTrack, objectTrack);
  const bodyScale = Math.max(0.18, Number(personTrack.box.width || 0.25));
  const threshold = Math.max(0.055, Math.min(HOLD_MAX_DISTANCE, bodyScale * 0.48));
  const wristScore = wrist.distance <= threshold
    ? clamp(1 - wrist.distance / threshold)
    : 0;

  const associatedHand = (handDetections || [])
    .map((hand) => ({
      hand,
      distance: pointToBoxDistance(
        { x: hand.box?.cx ?? 0.5, y: hand.box?.cy ?? 0.5 },
        objectTrack.box
      )
    }))
    .filter((item) => item.distance <= threshold * 1.15)
    .sort((a, b) => a.distance - b.distance)[0];

  const handBoost = associatedHand
    ? clamp(Number(associatedHand.hand.score || 0)) * 0.18
    : 0;

  const confidence = clamp(
    wristScore * 0.72 +
    Number(wrist.confidence || 0) * 0.10 +
    handBoost
  );

  return {
    holding: confidence >= 0.56,
    confidence,
    distance: wrist.distance,
    handSide: wrist.side,
    evidence: {
      wristDistance: wrist.distance,
      threshold,
      wristConfidence: wrist.confidence,
      handDetectorScore: associatedHand?.hand?.score || 0
    }
  };
}

function vector(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function vectorLength(v) {
  return Math.hypot(v.x, v.y);
}

function angleBetween(a, b) {
  const denom = vectorLength(a) * vectorLength(b);
  if (!denom) return Math.PI;
  const cos = clamp((a.x * b.x + a.y * b.y) / denom, -1, 1);
  return Math.acos(cos);
}

export function inferPointingAt(personTrack, objectTrack) {
  const points = keypointMap(personTrack?.keypoints || []);
  const candidates = [];

  for (const side of ['left', 'right']) {
    const elbow = points.get(side + 'Elbow');
    const wrist = points.get(side + 'Wrist');
    if (!elbow || !wrist) continue;

    const arm = vector(elbow, wrist);
    const towardObject = vector(wrist, {
      x: objectTrack.box.cx,
      y: objectTrack.box.cy
    });
    const forwardProjection = arm.x * towardObject.x + arm.y * towardObject.y;
    const angle = angleBetween(arm, towardObject);
    const confidence = clamp(pointConfidence(elbow, wrist));

    candidates.push({
      side,
      angle,
      forwardProjection,
      confidence,
      distance: vectorLength(towardObject)
    });
  }

  const best = candidates
    .filter((candidate) => candidate.forwardProjection > 0)
    .sort((a, b) => a.angle - b.angle)[0];

  if (!best) {
    return { pointing: false, confidence: 0, side: null, angle: null };
  }

  const angularScore = clamp(1 - best.angle / POINT_MAX_ANGLE_RAD);
  const distanceScore = clamp(1 - best.distance / 0.7);
  const confidence = clamp(
    angularScore * 0.58 +
    distanceScore * 0.20 +
    best.confidence * 0.22
  );

  return {
    pointing: best.angle <= POINT_MAX_ANGLE_RAD && confidence >= 0.58,
    confidence,
    side: best.side,
    angle: best.angle,
    evidence: {
      angularScore,
      distanceScore,
      landmarkConfidence: best.confidence
    }
  };
}

export function relationDistance(personTrack, objectTrack) {
  return Math.hypot(
    Number(personTrack?.cx || 0.5) - Number(objectTrack?.cx || 0.5),
    Number(personTrack?.cy || 0.5) - Number(objectTrack?.cy || 0.5)
  );
}

export function relationMotion(previousDistance, currentDistance, threshold = 0.035) {
  if (!Number.isFinite(previousDistance) || !Number.isFinite(currentDistance)) {
    return 'stable';
  }
  const delta = currentDistance - previousDistance;
  if (delta <= -threshold) return 'approaching';
  if (delta >= threshold) return 'moving-away';
  return 'stable';
}

export function bestObjectInteractions(personTracks, objectTracks, handDetections = [], previousDistances = new Map()) {
  const interactions = [];

  for (const objectTrack of objectTracks || []) {
    if (objectTrack.status === 'reacquiring') continue;

    let bestHolder = null;
    let bestPointer = null;

    for (const person of personTracks || []) {
      if (person.status === 'occluded' || person.status === 'reacquiring') continue;

      const holding = inferHolding(person, objectTrack, handDetections);
      if (holding.holding && (!bestHolder || holding.confidence > bestHolder.confidence)) {
        bestHolder = { person, ...holding };
      }

      const pointing = inferPointingAt(person, objectTrack);
      if (pointing.pointing && (!bestPointer || pointing.confidence > bestPointer.confidence)) {
        bestPointer = { person, ...pointing };
      }

      const key = person.id + ':' + objectTrack.id;
      const currentDistance = relationDistance(person, objectTrack);
      const previousDistance = previousDistances.get(key);
      const motion = relationMotion(previousDistance, currentDistance);
      previousDistances.set(key, currentDistance);

      if (motion !== 'stable' && currentDistance <= 0.65) {
        interactions.push({
          type: motion,
          participantTrackId: person.id,
          participantId: person.participantId || null,
          participantName: person.participantName || null,
          objectTrackId: objectTrack.id,
          objectLabel: objectTrack.label,
          confidence: clamp(1 - currentDistance / 0.75),
          evidence: { previousDistance, currentDistance }
        });
      }
    }

    if (bestHolder) {
      interactions.push({
        type: 'holding',
        participantTrackId: bestHolder.person.id,
        participantId: bestHolder.person.participantId || null,
        participantName: bestHolder.person.participantName || null,
        objectTrackId: objectTrack.id,
        objectLabel: objectTrack.label,
        confidence: bestHolder.confidence,
        evidence: bestHolder.evidence
      });
    } else if (bestPointer) {
      interactions.push({
        type: 'pointing-at',
        participantTrackId: bestPointer.person.id,
        participantId: bestPointer.person.participantId || null,
        participantName: bestPointer.person.participantName || null,
        objectTrackId: objectTrack.id,
        objectLabel: objectTrack.label,
        confidence: bestPointer.confidence,
        evidence: bestPointer.evidence
      });
    }
  }

  return interactions;
}

export function interactionKey(interaction) {
  return [
    interaction.type,
    interaction.participantTrackId || '',
    interaction.objectTrackId || ''
  ].join(':');
}
