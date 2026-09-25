import { clamp, normalizeBox } from './participant-core.js';

export const BODY_TRACK_MAX_DISTANCE = 0.34;
export const BODY_OCCLUSION_GRACE_MS = 6000;

function normalizedBodyPoint(point, frameWidth, frameHeight) {
  const raw = point?.positionRaw;
  const position = point?.position;

  const rawX = Array.isArray(raw) ? raw[0] : raw?.x;
  const rawY = Array.isArray(raw) ? raw[1] : raw?.y;
  const rawZ = Array.isArray(raw) ? raw[2] : raw?.z;

  const px = Array.isArray(position) ? position[0] : position?.x ?? point?.x;
  const py = Array.isArray(position) ? position[1] : position?.y ?? point?.y;
  const pz = Array.isArray(position) ? position[2] : position?.z ?? point?.z;

  return {
    part: point?.part || point?.name || null,
    x: clamp(Number.isFinite(Number(rawX))
      ? Number(rawX)
      : Number(px || 0) / Math.max(1, frameWidth)),
    y: clamp(Number.isFinite(Number(rawY))
      ? Number(rawY)
      : Number(py || 0) / Math.max(1, frameHeight)),
    z: Number.isFinite(Number(rawZ))
      ? Number(rawZ)
      : Number.isFinite(Number(pz))
        ? Number(pz)
        : null,
    score: Number(point?.score ?? point?.confidence ?? 0),
    distance: point?.distance || null
  };
}

export function bodyDetection(body, frameWidth = 1, frameHeight = 1) {
  const box = normalizeBox(body?.box, frameWidth, frameHeight);
  const keypoints = Array.isArray(body?.keypoints)
    ? body.keypoints.map((point) => normalizedBodyPoint(point, frameWidth, frameHeight))
    : [];

  return {
    raw: body,
    id: body?.id ?? null,
    box,
    score: Number(body?.score ?? body?.confidence ?? 0),
    keypoints,
    annotations: body?.annotations || null
  };
}

export function boxContainsPoint(box, x, y, margin = 0) {
  return (
    x >= box.x - margin &&
    x <= box.x + box.width + margin &&
    y >= box.y - margin &&
    y <= box.y + box.height + margin
  );
}

export function associateFacesToBodies(faces, bodies) {
  const assignments = new Map();

  for (let faceIndex = 0; faceIndex < (faces || []).length; faceIndex += 1) {
    const face = faces[faceIndex];
    let bestBody = -1;
    let bestScore = Infinity;

    for (let bodyIndex = 0; bodyIndex < (bodies || []).length; bodyIndex += 1) {
      const body = bodies[bodyIndex];
      if (!boxContainsPoint(body.box, face.box.cx, face.box.cy, 0.03)) continue;

      const expectedHeadY = body.box.y + body.box.height * 0.14;
      const dx = Math.abs(face.box.cx - body.box.cx);
      const dy = Math.abs(face.box.cy - expectedHeadY);
      const cost = dx + dy * 0.75;

      if (cost < bestScore) {
        bestScore = cost;
        bestBody = bodyIndex;
      }
    }

    if (bestBody === -1 && bodies?.length) {
      for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
        const body = bodies[bodyIndex];
        const distance = Math.hypot(
          face.box.cx - body.box.cx,
          face.box.cy - (body.box.y + body.box.height * 0.18)
        );
        if (distance < bestScore && distance < 0.22) {
          bestScore = distance;
          bestBody = bodyIndex;
        }
      }
    }

    if (bestBody >= 0) assignments.set(faceIndex, bestBody);
  }

  return assignments;
}

export function bodyOverlap(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (!intersection) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function predictTrackPosition(track, now) {
  const elapsed = Math.max(0, Math.min(1.5, (now - (track.lastSeenAt || now)) / 1000));
  return {
    cx: clamp((track.cx || 0) + (track.vx || 0) * elapsed),
    cy: clamp((track.cy || 0) + (track.vy || 0) * elapsed)
  };
}

export function bodyTrackCost(track, detection, now) {
  const predicted = predictTrackPosition(track, now);
  const distance = Math.hypot(predicted.cx - detection.box.cx, predicted.cy - detection.box.cy);
  const overlapPenalty = 1 - bodyOverlap(track.box, detection.box);

  const oldArea = Math.max(0.001, (track.box?.width || 0) * (track.box?.height || 0));
  const newArea = Math.max(0.001, detection.box.width * detection.box.height);
  const sizePenalty = Math.min(1, Math.abs(Math.log(newArea / oldArea)));

  return distance * 0.68 + overlapPenalty * 0.22 + sizePenalty * 0.10;
}

export function createBodyTrack(id, detection, now = 0) {
  return {
    id,
    box: detection.box,
    cx: detection.box.cx,
    cy: detection.box.cy,
    vx: 0,
    vy: 0,
    bodyScore: detection.score || 0,
    keypoints: detection.keypoints || [],
    annotations: detection.annotations || null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastBodySeenAt: now,
    lastFaceSeenAt: null,
    participantId: null,
    participantName: null,
    similarity: 0,
    scanProgress: 0,
    quality: 0,
    samples: 0,
    embedding: null,
    latestPhoto: null,
    status: 'body-detected',
    identitySource: 'body'
  };
}

export function updateBodyTrack(track, detection, now) {
  const dt = Math.max(0.05, Math.min(1.5, (now - (track.lastSeenAt || now)) / 1000));
  const measuredVx = (detection.box.cx - track.cx) / dt;
  const measuredVy = (detection.box.cy - track.cy) / dt;

  return {
    ...track,
    box: detection.box,
    cx: detection.box.cx,
    cy: detection.box.cy,
    vx: (track.vx || 0) * 0.55 + measuredVx * 0.45,
    vy: (track.vy || 0) * 0.55 + measuredVy * 0.45,
    bodyScore: detection.score || 0,
    keypoints: detection.keypoints || [],
    annotations: detection.annotations || null,
    lastSeenAt: now,
    lastBodySeenAt: now,
    status: track.participantId ? 'body-lock' : 'body-detected',
    identitySource: track.participantId ? 'body' : track.identitySource || 'body'
  };
}

export function assignBodyTracks(previousTracks, bodyDetections, now = 0, options = {}) {
  const maxCost = options.maxCost ?? BODY_TRACK_MAX_DISTANCE;
  const nextId = options.nextId || (() => 'T' + Math.random().toString(36).slice(2, 6).toUpperCase());

  const unassigned = new Set((previousTracks || []).map((_, index) => index));
  const assigned = [];

  const detections = [...(bodyDetections || [])]
    .sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height));

  for (const detection of detections) {
    let bestIndex = -1;
    let bestCost = Infinity;

    for (const index of unassigned) {
      const track = previousTracks[index];
      const cost = bodyTrackCost(track, detection, now);
      if (cost < bestCost && cost <= maxCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      unassigned.delete(bestIndex);
      assigned.push(updateBodyTrack(previousTracks[bestIndex], detection, now));
    } else {
      assigned.push(createBodyTrack(nextId(), detection, now));
    }
  }

  return assigned;
}

export function carryOccludedTracks(previousTracks, liveTracks, now = 0, graceMs = BODY_OCCLUSION_GRACE_MS) {
  const liveIds = new Set((liveTracks || []).map((track) => track.id));

  return (previousTracks || [])
    .filter((track) => !liveIds.has(track.id))
    .filter((track) => now - (track.lastBodySeenAt || track.lastSeenAt || 0) <= graceMs)
    .map((track) => ({
      ...track,
      status: track.participantId ? 'occluded' : 'reacquiring',
      identitySource: track.participantId ? 'body-memory' : track.identitySource
    }));
}

export function attachFacesToTracks(tracks, faces, bodies, assignments, now = 0) {
  const output = tracks.map((track) => ({ ...track, face: null }));
  const usedTracks = new Set();

  for (const [faceIndex, bodyIndex] of assignments.entries()) {
    const face = faces[faceIndex];
    const body = bodies[bodyIndex];
    if (!face || !body) continue;

    let bestTrackIndex = -1;
    let bestDistance = Infinity;

    output.forEach((track, trackIndex) => {
      if (usedTracks.has(trackIndex)) return;
      const distance = Math.hypot(track.cx - body.box.cx, track.cy - body.box.cy);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTrackIndex = trackIndex;
      }
    });

    if (bestTrackIndex >= 0 && bestDistance < 0.18) {
      usedTracks.add(bestTrackIndex);
      output[bestTrackIndex] = {
        ...output[bestTrackIndex],
        face,
        quality: face.quality || 0,
        embedding: face.embedding || output[bestTrackIndex].embedding,
        lastFaceSeenAt: now,
        identitySource: 'face'
      };
    }
  }

  return output;
}

export function roomPresenceState(track, now = 0) {
  const faceAge = track.lastFaceSeenAt == null ? Infinity : now - track.lastFaceSeenAt;
  const bodyAge = track.lastBodySeenAt == null ? Infinity : now - track.lastBodySeenAt;

  if (track.participantId && bodyAge <= 1200 && faceAge > 1200) return 'body-lock';
  if (track.participantId && bodyAge <= 1200 && faceAge <= 1200) return 'matched';
  if (track.participantId && bodyAge <= BODY_OCCLUSION_GRACE_MS) return 'occluded';
  if (bodyAge <= 1200) return 'body-detected';
  return 'reacquiring';
}


export function syntheticBodyFromFace(face) {
  const faceBox = face?.box || { x: 0, y: 0, width: 0, height: 0, cx: 0.5, cy: 0.5 };
  const width = clamp(Math.max(faceBox.width * 3.2, 0.18), 0.12, 0.55);
  const height = clamp(Math.max(faceBox.height * 6.5, 0.48), 0.35, 0.95);
  const x = clamp(faceBox.cx - width / 2, 0, 1 - width);
  const y = clamp(faceBox.y - faceBox.height * 0.35, 0, 1 - height);
  return {
    raw: null,
    box: {
      x,
      y,
      width,
      height,
      cx: clamp(x + width / 2),
      cy: clamp(y + height / 2)
    },
    score: Math.max(0.35, Number(face?.score || 0) * 0.75),
    keypoints: [],
    synthetic: true
  };
}

export function augmentBodiesWithFaceFallbacks(faces, bodies) {
  const output = [...(bodies || [])];
  const assignments = associateFacesToBodies(faces, output);

  for (let faceIndex = 0; faceIndex < (faces || []).length; faceIndex += 1) {
    if (assignments.has(faceIndex)) continue;
    output.push(syntheticBodyFromFace(faces[faceIndex]));
  }

  return output;
}


function participantTrackEvidence(track) {
  const faceEvidence = track.face ? 3 : 0;
  const liveBodyEvidence = track.status !== 'occluded' && track.status !== 'reacquiring' ? 2 : 0;
  const similarity = Number(track.similarity || 0);
  const freshness = Math.min(1, Number(track.lastBodySeenAt || track.lastSeenAt || 0) / 1e9);
  return faceEvidence + liveBodyEvidence + similarity + freshness;
}

export function dedupeParticipantAssignments(tracks) {
  const winners = new Map();

  for (let index = 0; index < (tracks || []).length; index += 1) {
    const track = tracks[index];
    if (!track.participantId) continue;

    const current = winners.get(track.participantId);
    if (
      !current ||
      participantTrackEvidence(track) > participantTrackEvidence(current.track)
    ) {
      winners.set(track.participantId, { index, track });
    }
  }

  return (tracks || []).map((track, index) => {
    if (!track.participantId) return track;
    const winner = winners.get(track.participantId);
    if (!winner || winner.index === index) return track;

    return {
      ...track,
      participantId: null,
      participantName: null,
      similarity: 0,
      voiceParticipantId: null,
      voiceParticipantName: null,
      voiceMatchConfidence: 0,
      status: track.face ? 'ready' : 'body-detected',
      identitySource: track.face ? 'face' : 'body'
    };
  });
}
