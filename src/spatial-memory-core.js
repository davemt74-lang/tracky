const MAX_HISTORY_PER_ENTITY = 120;
const MAX_TRANSITION_HISTORY = 200;
const MIN_EVIDENCE_INTERVAL_MS = 15000;
const MIN_EXPECTED_LOCATION_OBSERVATIONS = 5;
const MIN_EXPECTED_LOCATION_SESSIONS = 3;

export const MEMORY_PROPOSAL_TYPES = Object.freeze([
  'expected-location',
  'stable-relationship',
  'circulation-pattern'
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function bucketHour(timestamp) {
  return new Date(timestamp).getHours();
}

function entityId(entity) {
  return entity?.participantId
    ? 'PERSON:' + entity.participantId
    : String(entity?.id || '');
}

function observationKey(input) {
  return [
    input.entityId,
    input.roomId || '',
    input.anchorId || '',
    input.relation || '',
    input.holderParticipantId || ''
  ].join('|');
}

export function createSpatialMemoryState() {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    sessionId: null,
    entities: {},
    expectedLocations: {},
    relationshipEvidence: {},
    circulation: {},
    proposals: [],
    ignoredProposalKeys: {},
    lastEvidenceAt: {}
  };
}

export function nearestAnchor(position, landmarks = [], maxDistance = 0.22) {
  if (!position) return null;
  let best = null;
  let bestDistance = Infinity;

  for (const landmark of landmarks || []) {
    const point = landmark.position || landmark.roomPosition;
    if (!point) continue;
    const distance = Math.hypot(
      Number(position.x || 0) - Number(point.x || 0),
      Number(position.y || 0) - Number(point.y || 0)
    );
    if (distance < bestDistance && distance <= maxDistance) {
      best = landmark;
      bestDistance = distance;
    }
  }

  return best ? {
    id: best.id,
    label: best.name || best.label || best.id,
    distance: bestDistance,
    userConfirmed: best.userConfirmed === true
  } : null;
}

export function appendEntityHistory(state, id, entry) {
  if (!id) return null;
  if (!state.entities[id]) {
    state.entities[id] = {
      id,
      label: entry.label || id,
      type: entry.type || 'entity',
      firstObservedAt: entry.timestamp,
      lastObservedAt: entry.timestamp,
      history: []
    };
  }

  const entity = state.entities[id];
  entity.label = entry.label || entity.label;
  entity.type = entry.type || entity.type;
  entity.lastObservedAt = entry.timestamp;
  entity.history.push({ ...entry });
  if (entity.history.length > MAX_HISTORY_PER_ENTITY) {
    entity.history.splice(0, entity.history.length - MAX_HISTORY_PER_ENTITY);
  }
  return entity;
}

function proposalKey(type, subjectId, targetId) {
  return [type, subjectId, targetId].join('::');
}

function upsertProposal(state, proposal) {
  const key = proposal.key || proposalKey(
    proposal.type,
    proposal.subjectId,
    proposal.targetId || proposal.roomId
  );
  if (state.ignoredProposalKeys[key]) return null;

  const existing = state.proposals.find((item) => item.key === key);
  if (existing) {
    Object.assign(existing, proposal, {
      key,
      updatedAt: proposal.updatedAt || Date.now()
    });
    return existing;
  }

  const record = {
    id: 'MEM-' + Math.random().toString(36).slice(2, 10),
    key,
    status: 'proposed',
    createdAt: proposal.createdAt || Date.now(),
    updatedAt: proposal.updatedAt || Date.now(),
    ...proposal
  };
  state.proposals.push(record);
  if (state.proposals.length > 120) state.proposals.shift();
  return record;
}

export function ignoreMemoryProposal(state, key, now = Date.now()) {
  state.ignoredProposalKeys[key] = now;
  state.proposals = state.proposals.filter((proposal) => proposal.key !== key);
  state.updatedAt = now;
}

export function resolveMemoryProposal(state, key, resolution = 'confirmed', now = Date.now()) {
  const proposal = state.proposals.find((item) => item.key === key);
  if (!proposal) return null;
  proposal.status = resolution;
  proposal.resolvedAt = now;
  proposal.updatedAt = now;
  return proposal;
}

function recordExpectedLocationEvidence(state, input, now) {
  const key = input.entityId;
  if (!state.expectedLocations[key]) {
    state.expectedLocations[key] = {
      entityId: key,
      candidates: {}
    };
  }

  const targetId = input.anchorId || ('ROOM:' + input.roomId);
  if (!state.expectedLocations[key].candidates[targetId]) {
    state.expectedLocations[key].candidates[targetId] = {
      targetId,
      roomId: input.roomId,
      anchorId: input.anchorId || null,
      anchorLabel: input.anchorLabel || null,
      observations: 0,
      sessions: {},
      firstObservedAt: now,
      lastObservedAt: now,
      confidenceSum: 0
    };
  }

  const candidate = state.expectedLocations[key].candidates[targetId];
  candidate.observations += 1;
  candidate.sessions[input.sessionId || 'session'] = true;
  candidate.lastObservedAt = now;
  candidate.confidenceSum += Number(input.confidence || 0);

  const sessionCount = Object.keys(candidate.sessions).length;
  const averageConfidence = candidate.observations
    ? candidate.confidenceSum / candidate.observations
    : 0;

  if (
    candidate.observations >= MIN_EXPECTED_LOCATION_OBSERVATIONS &&
    sessionCount >= MIN_EXPECTED_LOCATION_SESSIONS &&
    averageConfidence >= 0.68
  ) {
    upsertProposal(state, {
      type: 'expected-location',
      subjectId: key,
      targetId,
      roomId: candidate.roomId,
      anchorId: candidate.anchorId,
      anchorLabel: candidate.anchorLabel,
      confidence: clamp01(
        averageConfidence * 0.75 +
        Math.min(1, candidate.observations / 10) * 0.15 +
        Math.min(1, sessionCount / 5) * 0.10
      ),
      evidence: {
        observations: candidate.observations,
        sessions: sessionCount,
        firstObservedAt: candidate.firstObservedAt,
        lastObservedAt: candidate.lastObservedAt
      },
      updatedAt: now
    });
  }
}

function recordRelationshipEvidence(state, input, now) {
  const key = [input.subjectId, input.predicate, input.objectId].join('::');
  if (!state.relationshipEvidence[key]) {
    state.relationshipEvidence[key] = {
      key,
      subjectId: input.subjectId,
      predicate: input.predicate,
      objectId: input.objectId,
      observations: 0,
      sessions: {},
      confidenceSum: 0,
      firstObservedAt: now,
      lastObservedAt: now
    };
  }

  const evidence = state.relationshipEvidence[key];
  evidence.observations += 1;
  evidence.sessions[input.sessionId || 'session'] = true;
  evidence.confidenceSum += Number(input.confidence || 0);
  evidence.lastObservedAt = now;

  const sessions = Object.keys(evidence.sessions).length;
  const avg = evidence.confidenceSum / evidence.observations;

  if (
    evidence.observations >= 6 &&
    sessions >= 3 &&
    avg >= 0.72 &&
    ![
      'near','left-of','right-of','above','below',
      'owned-by','belongs-to','located-in','contains','has-portal'
    ].includes(input.predicate)
  ) {
    upsertProposal(state, {
      type: 'stable-relationship',
      subjectId: input.subjectId,
      targetId: input.objectId,
      predicate: input.predicate,
      confidence: clamp01(avg),
      evidence: {
        observations: evidence.observations,
        sessions,
        firstObservedAt: evidence.firstObservedAt,
        lastObservedAt: evidence.lastObservedAt
      },
      updatedAt: now
    });
  }
}

export function recordCirculationTransition(state, transition, sessionId, now = Date.now()) {
  if (
    transition?.type !== 'participant.room_transition' ||
    !transition.fromRoomId ||
    !transition.toRoomId
  ) return null;

  const key = [transition.fromRoomId, transition.toRoomId].join('→');
  if (!state.circulation[key]) {
    state.circulation[key] = {
      key,
      fromRoomId: transition.fromRoomId,
      toRoomId: transition.toRoomId,
      count: 0,
      sessions: {},
      hours: {},
      lastObservedAt: now
    };
  }

  const pattern = state.circulation[key];
  pattern.count += 1;
  pattern.sessions[sessionId || 'session'] = true;
  const hour = bucketHour(now);
  pattern.hours[hour] = Number(pattern.hours[hour] || 0) + 1;
  pattern.lastObservedAt = now;

  const sessions = Object.keys(pattern.sessions).length;
  if (pattern.count >= 6 && sessions >= 3) {
    upsertProposal(state, {
      type: 'circulation-pattern',
      subjectId: transition.participantId
        ? 'PERSON:' + transition.participantId
        : 'WORLD',
      targetId: key,
      fromRoomId: transition.fromRoomId,
      toRoomId: transition.toRoomId,
      confidence: clamp01(0.55 + Math.min(0.35, pattern.count * 0.025) + Math.min(0.1, sessions * 0.02)),
      evidence: {
        count: pattern.count,
        sessions,
        hours: { ...pattern.hours },
        lastObservedAt: pattern.lastObservedAt
      },
      updatedAt: now
    });
  }

  return pattern;
}

export function observeSpatialMemory(state, input = {}, now = Date.now()) {
  state.updatedAt = now;
  state.sessionId = input.sessionId || state.sessionId || 'session';

  const landmarksByRoom = input.landmarksByRoom || {};
  const world = input.multiRoom || {};

  for (const object of Object.values(world.objects || {})) {
    if (object.presence !== 'confirmed') continue;
    const id = String(object.id);
    const anchor = nearestAnchor(
      object.roomPosition,
      landmarksByRoom[object.roomId] || []
    );
    const dedupe = observationKey({
      entityId: id,
      roomId: object.roomId,
      anchorId: anchor?.id,
      holderParticipantId: object.holderParticipantId
    });
    if (
      state.lastEvidenceAt[dedupe] != null &&
      now - Number(state.lastEvidenceAt[dedupe]) < MIN_EVIDENCE_INTERVAL_MS
    ) continue;
    state.lastEvidenceAt[dedupe] = now;

    appendEntityHistory(state, id, {
      timestamp: now,
      type: 'object',
      label: object.label,
      event: object.holderParticipantId ? 'held' : 'observed',
      roomId: object.roomId,
      anchorId: anchor?.id || null,
      anchorLabel: anchor?.label || null,
      holderParticipantId: object.holderParticipantId || null,
      confidence: object.confidence,
      position: object.roomPosition || null,
      source: 'multi-room-world'
    });

    if (!object.holderParticipantId) {
      recordExpectedLocationEvidence(state, {
        entityId: id,
        roomId: object.roomId,
        anchorId: anchor?.id || null,
        anchorLabel: anchor?.label || null,
        confidence: object.confidence,
        sessionId: state.sessionId
      }, now);
    }
  }

  for (const participant of Object.values(world.participants || {})) {
    if (participant.presence !== 'confirmed' || !participant.participantId) continue;
    const id = entityId(participant);
    const anchor = nearestAnchor(
      participant.roomPosition,
      landmarksByRoom[participant.roomId] || []
    );
    const dedupe = observationKey({
      entityId: id,
      roomId: participant.roomId,
      anchorId: anchor?.id
    });
    if (
      state.lastEvidenceAt[dedupe] != null &&
      now - Number(state.lastEvidenceAt[dedupe]) < MIN_EVIDENCE_INTERVAL_MS
    ) continue;
    state.lastEvidenceAt[dedupe] = now;

    appendEntityHistory(state, id, {
      timestamp: now,
      type: 'person',
      label: participant.participantName || id,
      event: 'present',
      roomId: participant.roomId,
      anchorId: anchor?.id || null,
      anchorLabel: anchor?.label || null,
      confidence: participant.confidence,
      position: participant.roomPosition || null,
      source: 'multi-room-world'
    });
  }

  for (const edge of input.sceneGraph?.edges || []) {
    if (
      edge.state === 'expired' ||
      edge.state === 'contradicted' ||
      edge.state === 'user-confirmed'
    ) continue;

    const relationEvidenceKey = observationKey({
      entityId: edge.subjectId,
      anchorId: edge.objectId,
      relation: edge.predicate
    });
    if (
      state.lastEvidenceAt[relationEvidenceKey] != null &&
      now - Number(state.lastEvidenceAt[relationEvidenceKey]) <
      MIN_EVIDENCE_INTERVAL_MS
    ) continue;
    state.lastEvidenceAt[relationEvidenceKey] = now;

    recordRelationshipEvidence(state, {
      subjectId: edge.subjectId,
      predicate: edge.predicate,
      objectId: edge.objectId,
      confidence: edge.confidence,
      sessionId: state.sessionId
    }, now);
  }

  for (const transition of input.transitions || []) {
    recordCirculationTransition(state, transition, state.sessionId, transition.timestamp || now);
  }

  return state;
}

export function expectedLocationFor(state, entityIdValue) {
  const entry = state.expectedLocations[entityIdValue];
  if (!entry) return null;

  const candidates = Object.values(entry.candidates || {})
    .map((candidate) => ({
      ...candidate,
      sessions: Object.keys(candidate.sessions || {}).length,
      averageConfidence: candidate.observations
        ? candidate.confidenceSum / candidate.observations
        : 0
    }))
    .sort((a,b) => (
      b.observations - a.observations ||
      b.averageConfidence - a.averageConfidence
    ));

  return candidates[0] || null;
}

export function confirmedExpectedLocationFor(state, entityIdValue) {
  const proposal = (state.proposals || [])
    .filter((item) => (
      item.type === 'expected-location' &&
      item.subjectId === entityIdValue &&
      item.status === 'confirmed'
    ))
    .sort((a,b) => Number(b.resolvedAt || b.updatedAt || 0) - Number(a.resolvedAt || a.updatedAt || 0))[0];

  if (!proposal) return null;
  return {
    targetId: proposal.targetId,
    roomId: proposal.roomId || null,
    anchorId: proposal.anchorId || null,
    anchorLabel: proposal.anchorLabel || null,
    confidence: proposal.confidence,
    evidence: proposal.evidence || null,
    confirmedAt: proposal.resolvedAt || proposal.updatedAt || null
  };
}

export function entityHistory(state, entityIdValue, limit = 50) {
  return (state.entities[entityIdValue]?.history || []).slice(-Math.max(1, limit));
}


export function entityJourney(state, entityIdValue, limit = 30) {
  const history = entityHistory(state, entityIdValue, 200);
  const journey = [];

  for (const entry of history) {
    const key = [
      entry.roomId || '',
      entry.anchorId || '',
      entry.holderParticipantId || '',
      entry.event || ''
    ].join('|');
    const previous = journey[journey.length - 1];
    if (previous?.key === key) {
      previous.lastObservedAt = entry.timestamp;
      previous.observations += 1;
      previous.confidence = Math.max(previous.confidence, Number(entry.confidence || 0));
      continue;
    }

    journey.push({
      key,
      roomId: entry.roomId || null,
      anchorId: entry.anchorId || null,
      anchorLabel: entry.anchorLabel || null,
      holderParticipantId: entry.holderParticipantId || null,
      event: entry.event || 'observed',
      firstObservedAt: entry.timestamp,
      lastObservedAt: entry.timestamp,
      observations: 1,
      confidence: Number(entry.confidence || 0)
    });
  }

  return journey.slice(-Math.max(1, limit));
}

export function expectedLocationStatus(state, entity, landmarks = []) {
  if (!entity?.id) return { state:'unknown', expected:null, currentAnchor:null };
  const expected = expectedLocationFor(state, entity.id);
  if (!expected) return { state:'unlearned', expected:null, currentAnchor:null };

  const currentAnchor = nearestAnchor(entity.roomPosition, landmarks);
  const targetId = currentAnchor?.id || ('ROOM:' + entity.roomId);
  return {
    state: targetId === expected.targetId ? 'at-expected' : 'away-from-expected',
    expected,
    currentAnchor
  };
}

export function spatialMemorySnapshot(state) {
  return JSON.parse(JSON.stringify({
    schemaVersion: state.schemaVersion,
    updatedAt: state.updatedAt,
    entities: state.entities,
    expectedLocations: state.expectedLocations,
    relationshipEvidence: state.relationshipEvidence,
    circulation: state.circulation,
    proposals: state.proposals,
    ignoredProposalKeys: state.ignoredProposalKeys
  }));
}
