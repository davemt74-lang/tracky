import { clamp } from './participant-core.js';
import { roomDistance } from './camera-core.js';

export const KNOWN_FUSION_DISTANCE = 0.42;
export const UNKNOWN_OVERLAP_DISTANCE = 0.13;
export const WORLD_OBJECT_DISTANCE = 0.16;
export const WORLD_ENTITY_GRACE_MS = 5500;
export const WORLD_OBJECT_GRACE_MS = 8000;

export function observationQuality(observation = {}) {
  const face = clamp(Number(observation.faceConfidence || 0));
  const body = clamp(Number(observation.bodyConfidence || 0));
  const pose = clamp(Number(observation.poseConfidence || 0));
  const object = clamp(Number(observation.confidence || 0));

  if (observation.kind === 'object') {
    return clamp(object * 0.78 + (observation.stable ? 0.22 : 0));
  }

  return clamp(
    face * 0.48 +
    body * 0.27 +
    pose * 0.10 +
    clamp(Number(observation.continuityConfidence || 0.5)) * 0.15
  );
}

export function fuseKnownParticipantObservations(observations = []) {
  if (!observations.length) return null;

  const ranked = [...observations]
    .map((observation) => ({
      observation,
      quality: observationQuality(observation)
    }))
    .sort((a, b) => b.quality - a.quality);

  const best = ranked[0];
  const positionConsistent = ranked.filter((item) => (
    roomDistance(
      best.observation.roomPosition,
      item.observation.roomPosition
    ) <= KNOWN_FUSION_DISTANCE
  ));
  const positionConflict = positionConsistent.length !== ranked.length;
  const positionSources = positionConsistent.length
    ? positionConsistent
    : [best];

  const totalWeight = positionSources.reduce(
    (sum, item) => sum + Math.max(0.05, item.quality),
    0
  );

  const roomPosition = {
    x: positionSources.reduce(
      (sum, item) => sum + item.observation.roomPosition.x * Math.max(0.05, item.quality),
      0
    ) / totalWeight,
    y: positionSources.reduce(
      (sum, item) => sum + item.observation.roomPosition.y * Math.max(0.05, item.quality),
      0
    ) / totalWeight
  };

  return {
    id: 'P:' + best.observation.participantId,
    participantId: best.observation.participantId,
    participantName: best.observation.participantName || null,
    identityAuthority: 'enrolled-participant',
    roomId: best.observation.roomId,
    roomPosition,
    confidence: best.quality,
    primaryCameraId: best.observation.cameraId,
    cameraIds: ranked.map((item) => item.observation.cameraId),
    observations: ranked.map((item) => ({
      ...item.observation,
      fusionQuality: item.quality
    })),
    overlap: positionSources.length > 1,
    positionConflict,
    positionCameraIds: positionSources.map((item) => item.observation.cameraId),
    conflictingCameraIds: ranked
      .filter((item) => !positionSources.includes(item))
      .map((item) => item.observation.cameraId)
  };
}

export function clusterUnknownObservations(observations = [], maxDistance = UNKNOWN_OVERLAP_DISTANCE) {
  const clusters = [];

  for (const observation of observations) {
    let best = null;
    let bestDistance = Infinity;

    for (const cluster of clusters) {
      if (cluster.some((item) => item.cameraId === observation.cameraId)) continue;
      const centroid = {
        x: cluster.reduce((sum, item) => sum + item.roomPosition.x, 0) / cluster.length,
        y: cluster.reduce((sum, item) => sum + item.roomPosition.y, 0) / cluster.length
      };
      const distance = roomDistance(centroid, observation.roomPosition);
      if (distance < bestDistance && distance <= maxDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }

    if (best) best.push(observation);
    else clusters.push([observation]);
  }

  return clusters;
}

export function fuseUnknownCluster(cluster = []) {
  const ranked = [...cluster]
    .map((observation) => ({
      observation,
      quality: observationQuality(observation)
    }))
    .sort((a, b) => b.quality - a.quality);
  const best = ranked[0];

  if (!best) return null;

  const total = ranked.reduce(
    (sum, item) => sum + Math.max(0.05, item.quality),
    0
  );
  const roomPosition = {
    x: ranked.reduce(
      (sum, item) => sum + item.observation.roomPosition.x * Math.max(0.05, item.quality),
      0
    ) / total,
    y: ranked.reduce(
      (sum, item) => sum + item.observation.roomPosition.y * Math.max(0.05, item.quality),
      0
    ) / total
  };

  const ids = ranked
    .map((item) => item.observation.cameraId + ':' + item.observation.localTrackId)
    .sort();

  return {
    id: 'U:' + ids.join('|'),
    participantId: null,
    participantName: null,
    identityAuthority: 'anonymous-spatial-overlap',
    roomId: best.observation.roomId,
    roomPosition,
    confidence: best.quality * (ranked.length > 1 ? 0.92 : 0.78),
    primaryCameraId: best.observation.cameraId,
    cameraIds: ranked.map((item) => item.observation.cameraId),
    observations: ranked.map((item) => ({
      ...item.observation,
      fusionQuality: item.quality
    })),
    overlap: ranked.length > 1
  };
}

export function fuseParticipantObservations(observations = []) {
  const byParticipant = new Map();
  const unknown = [];

  for (const observation of observations) {
    if (observation.participantId) {
      if (!byParticipant.has(observation.participantId)) {
        byParticipant.set(observation.participantId, []);
      }
      byParticipant.get(observation.participantId).push(observation);
    } else {
      unknown.push(observation);
    }
  }

  return [
    ...[...byParticipant.values()]
      .map(fuseKnownParticipantObservations)
      .filter(Boolean),
    ...clusterUnknownObservations(unknown)
      .map(fuseUnknownCluster)
      .filter(Boolean)
  ];
}

function objectCandidateCost(track, observation) {
  if (track.label !== observation.label) return Infinity;
  const distance = roomDistance(track.roomPosition, observation.roomPosition);
  const cameraPenalty = track.cameraIds?.includes(observation.cameraId) ? 0 : 0.02;
  return distance + cameraPenalty;
}

export function fuseWorldObjects(previousObjects = [], observations = [], now = 0, options = {}) {
  const nextId = options.nextId || (() => 'WO' + Math.random().toString(36).slice(2, 8).toUpperCase());
  const maxDistance = options.maxDistance ?? WORLD_OBJECT_DISTANCE;
  const available = new Set(previousObjects.map((_, index) => index));
  const output = [];

  const groups = new Map();
  for (const observation of observations) {
    if (!groups.has(observation.label)) groups.set(observation.label, []);
    groups.get(observation.label).push(observation);
  }

  for (const [label, items] of groups) {
    const clusters = [];
    for (const observation of items) {
      let target = null;
      for (const cluster of clusters) {
        if (cluster.some((item) => item.cameraId === observation.cameraId)) {
          continue;
        }
        const centroid = {
          x: cluster.reduce((sum, item) => sum + item.roomPosition.x, 0) / cluster.length,
          y: cluster.reduce((sum, item) => sum + item.roomPosition.y, 0) / cluster.length
        };
        if (roomDistance(centroid, observation.roomPosition) <= maxDistance) {
          target = cluster;
          break;
        }
      }
      if (target) target.push(observation);
      else clusters.push([observation]);
    }

    for (const cluster of clusters) {
      const ranked = [...cluster]
        .map((observation) => ({
          observation,
          quality: observationQuality({ ...observation, kind: 'object' })
        }))
        .sort((a, b) => b.quality - a.quality);

      const best = ranked[0];
      const total = ranked.reduce((sum, item) => sum + Math.max(0.05, item.quality), 0);
      const roomPosition = {
        x: ranked.reduce((sum, item) => sum + item.observation.roomPosition.x * Math.max(0.05, item.quality), 0) / total,
        y: ranked.reduce((sum, item) => sum + item.observation.roomPosition.y * Math.max(0.05, item.quality), 0) / total
      };

      let bestPrevious = -1;
      let bestCost = Infinity;
      for (const index of available) {
        const cost = objectCandidateCost(previousObjects[index], {
          label,
          roomPosition,
          cameraId: best.observation.cameraId
        });
        if (cost < bestCost && cost <= maxDistance) {
          bestCost = cost;
          bestPrevious = index;
        }
      }

      const previous = bestPrevious >= 0 ? previousObjects[bestPrevious] : null;
      if (bestPrevious >= 0) available.delete(bestPrevious);

      output.push({
        id: previous?.id || nextId(),
        label,
        roomId: best.observation.roomId,
        roomPosition,
        confidence: best.quality,
        primaryCameraId: best.observation.cameraId,
        cameraIds: [...new Set(ranked.map((item) => item.observation.cameraId))],
        observations: ranked.map((item) => ({
          ...item.observation,
          fusionQuality: item.quality
        })),
        overlap: ranked.length > 1,
        firstSeenAt: previous?.firstSeenAt || now,
        lastSeenAt: now,
        status: 'visible'
      });
    }
  }

  for (const index of available) {
    const previous = previousObjects[index];
    if (now - Number(previous.lastSeenAt || 0) <= WORLD_OBJECT_GRACE_MS) {
      output.push({
        ...previous,
        status: 'last-known'
      });
    }
  }

  return output;
}

export function updateWorldFusion(previous = {}, participantObservations = [], objectObservations = [], now = 0, options = {}) {
  const previousParticipants = previous.participants || [];
  const currentParticipants = fuseParticipantObservations(participantObservations);
  const events = [];

  const previousKnown = new Map(
    previousParticipants
      .filter((entity) => entity.participantId)
      .map((entity) => [entity.participantId, entity])
  );

  for (const entity of currentParticipants) {
    entity.firstSeenAt = previousKnown.get(entity.participantId)?.firstSeenAt || now;
    entity.lastSeenAt = now;
    entity.status = 'visible';

    if (!entity.participantId) continue;
    const old = previousKnown.get(entity.participantId);
    if (!old) continue;

    const oldCameras = new Set(old.cameraIds || []);
    const newCameras = new Set(entity.cameraIds || []);
    const overlapAdded = entity.cameraIds.length > 1 && old.cameraIds?.length <= 1;

    if (overlapAdded) {
      events.push({
        type: 'camera.overlap_fused',
        participantId: entity.participantId,
        participantName: entity.participantName,
        cameraIds: entity.cameraIds,
        confidence: entity.confidence,
        roomPosition: entity.roomPosition
      });
    }

    if (
      old.primaryCameraId &&
      entity.primaryCameraId &&
      old.primaryCameraId !== entity.primaryCameraId &&
      (!newCameras.has(old.primaryCameraId) || !oldCameras.has(entity.primaryCameraId))
    ) {
      events.push({
        type: 'camera.handoff',
        participantId: entity.participantId,
        participantName: entity.participantName,
        fromCameraId: old.primaryCameraId,
        toCameraId: entity.primaryCameraId,
        confidence: entity.confidence,
        roomPosition: entity.roomPosition
      });
    }
  }

  const visibleKnownIds = new Set(
    currentParticipants
      .filter((entity) => entity.participantId)
      .map((entity) => entity.participantId)
  );

  for (const old of previousParticipants) {
    if (
      old.participantId &&
      !visibleKnownIds.has(old.participantId) &&
      now - Number(old.lastSeenAt || 0) <= WORLD_ENTITY_GRACE_MS
    ) {
      currentParticipants.push({
        ...old,
        status: 'last-known'
      });
    }
  }

  const objects = fuseWorldObjects(
    previous.objects || [],
    objectObservations,
    now,
    options
  );

  return {
    state: {
      schemaVersion: 1,
      roomId: options.roomId || previous.roomId || 'ROOM01',
      updatedAt: now,
      participants: currentParticipants,
      objects
    },
    events
  };
}
