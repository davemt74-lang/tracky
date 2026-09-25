export const WORLD_QUERY_INTENTS = Object.freeze([
  'where-is',
  'last-seen',
  'history',
  'who-had',
  'room-occupants',
  'what-changed',
  'active-anomalies',
  'expected-location',
  'explain',
  'search'
]);

const SENSITIVE_KEYS = new Set([
  'embedding',
  'embeddings',
  'descriptor',
  'descriptors',
  'imageDataUrl',
  'raw',
  'samples',
  'audio',
  'frame',
  'frames'
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9:_\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanReference(value = '') {
  return String(value)
    .replace(/[?!.]+$/g, '')
    .trim();
}

function safeCopy(value, depth = 0) {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => safeCopy(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    result[key] = safeCopy(item, depth + 1);
  }
  return result;
}

function roomPolicy(context, roomId) {
  return context?.roomPolicies?.[roomId] || null;
}

function historicalRoomAllowed(context, roomId) {
  if (!roomId) return true;
  return roomPolicy(context, roomId)?.allowSpatialMemory !== false;
}

function roomLabel(context, roomId) {
  if (!roomId) return 'unknown room';
  const room = (context.rooms || []).find((item) => item.id === roomId);
  return room?.name || roomId;
}

function currentEntities(context = {}) {
  const byId = new Map();
  const world = context.multiRoom || {};

  for (const [id, participant] of Object.entries(world.participants || {})) {
    byId.set(id, {
      id,
      type: 'person',
      label: participant.participantName || participant.id || id,
      aliases: [
        participant.participantName,
        participant.participantId,
        participant.id,
        id
      ].filter(Boolean),
      current: participant
    });
  }

  for (const [id, object] of Object.entries(world.objects || {})) {
    byId.set(id, {
      id,
      type: 'object',
      label: object.label || id,
      aliases: [object.label, object.id, id].filter(Boolean),
      current: object
    });
  }

  for (const [id, memory] of Object.entries(context.spatialMemory?.entities || {})) {
    const existing = byId.get(id);
    if (existing) {
      existing.memory = memory;
      if (memory.label) existing.aliases.push(memory.label);
      continue;
    }
    byId.set(id, {
      id,
      type: memory.type || 'entity',
      label: memory.label || id,
      aliases: [memory.label, id].filter(Boolean),
      memory
    });
  }

  const graphNodes = Array.isArray(context.sceneGraph?.nodes)
    ? context.sceneGraph.nodes
    : Object.values(context.sceneGraph?.nodes || {});

  for (const node of graphNodes) {
    if (!node?.id || byId.has(node.id)) continue;
    byId.set(node.id, {
      id: node.id,
      type: node.type || 'entity',
      label: node.label || node.id,
      aliases: [node.label, node.id].filter(Boolean),
      graph: node
    });
  }

  return [...byId.values()];
}

function scoreReference(reference, candidate) {
  const query = normalizeText(reference);
  if (!query) return 0;

  let best = 0;
  const aliases = [...new Set([
    candidate.id,
    candidate.label,
    ...(candidate.aliases || [])
  ].filter(Boolean))];

  for (const alias of aliases) {
    const normalized = normalizeText(alias);
    if (!normalized) continue;
    if (normalized === query) best = Math.max(best, 1);
    else if (normalized.startsWith(query) || query.startsWith(normalized)) {
      best = Math.max(best, 0.86);
    } else if (normalized.includes(query) || query.includes(normalized)) {
      best = Math.max(best, 0.76);
    } else {
      const qTokens = new Set(query.split(' '));
      const aTokens = new Set(normalized.split(' '));
      const overlap = [...qTokens].filter((token) => aTokens.has(token)).length;
      const denominator = Math.max(qTokens.size, aTokens.size, 1);
      best = Math.max(best, overlap / denominator * 0.68);
    }
  }

  return best;
}

export function resolveEntityReference(reference, context = {}) {
  const ranked = currentEntities(context)
    .map((entity) => ({
      entity,
      score: scoreReference(reference, entity)
    }))
    .filter((item) => item.score >= 0.42)
    .sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));

  if (!ranked.length) {
    return {
      status: 'not-found',
      entity: null,
      score: 0,
      candidates: []
    };
  }

  const best = ranked[0];
  const second = ranked[1];
  const ambiguous = Boolean(
    second &&
    second.score >= 0.70 &&
    best.score - second.score < 0.08
  );

  return {
    status: ambiguous ? 'ambiguous' : 'resolved',
    entity: ambiguous ? null : best.entity,
    score: best.score,
    candidates: ranked.slice(0, 6).map((item) => ({
      id: item.entity.id,
      label: item.entity.label,
      type: item.entity.type,
      score: item.score
    }))
  };
}

export function resolveRoomReference(reference, context = {}) {
  const query = normalizeText(reference);
  const rooms = (context.rooms || []).map((room) => ({
    id: room.id,
    label: room.name || room.id,
    aliases: [room.id, room.name].filter(Boolean)
  }));

  const ranked = rooms
    .map((room) => ({
      room,
      score: scoreReference(query, room)
    }))
    .filter((item) => item.score >= 0.42)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return { status:'not-found', room:null, candidates:[] };
  const best = ranked[0];
  const second = ranked[1];
  if (second && second.score >= 0.70 && best.score - second.score < 0.08) {
    return {
      status:'ambiguous',
      room:null,
      candidates:ranked.slice(0,6).map((item)=>({
        id:item.room.id,label:item.room.label,score:item.score
      }))
    };
  }

  return {
    status:'resolved',
    room:best.room,
    score:best.score,
    candidates:ranked.slice(0,6).map((item)=>({
      id:item.room.id,label:item.room.label,score:item.score
    }))
  };
}

export function parseWorldQuery(input) {
  if (input && typeof input === 'object') {
    const intent = WORLD_QUERY_INTENTS.includes(input.intent)
      ? input.intent
      : 'search';
    return {
      intent,
      entity: input.entity || input.entityId || null,
      room: input.room || input.roomId || null,
      sinceMs: Number(input.sinceMs || 0) || null,
      limit: Number(input.limit || 0) || null,
      text: input.text || ''
    };
  }

  const raw = cleanReference(input || '');
  const text = normalizeText(raw);
  let match;

  if ((match = text.match(/^where (?:is|are) (.+)$/))) {
    return { intent:'where-is', entity:cleanReference(match[1]), room:null, sinceMs:null, limit:null, text:raw };
  }
  if ((match = text.match(/^(?:when (?:did you )?(?:last )?see|last seen) (.+)$/))) {
    return { intent:'last-seen', entity:cleanReference(match[1]), room:null, sinceMs:null, limit:null, text:raw };
  }
  if ((match = text.match(/^(?:where has|history of|journey of) (.+?)(?: been)?$/))) {
    return { intent:'history', entity:cleanReference(match[1]), room:null, sinceMs:null, limit:null, text:raw };
  }
  if ((match = text.match(/^who (?:had|held|was holding) (.+)$/))) {
    return { intent:'who-had', entity:cleanReference(match[1]), room:null, sinceMs:null, limit:null, text:raw };
  }
  if ((match = text.match(/^who (?:is|was) in (.+)$/))) {
    return { intent:'room-occupants', entity:null, room:cleanReference(match[1]), sinceMs:null, limit:null, text:raw };
  }
  if ((match = text.match(/^where (?:does|is) (.+?) (?:usually|normally)(?: go| stay| live| belong)?$/))) {
    return { intent:'expected-location', entity:cleanReference(match[1]), room:null, sinceMs:null, limit:null, text:raw };
  }
  if (text.includes('what changed') || text === 'what happened' || text.startsWith('what happened in ')) {
    const roomMatch = text.match(/(?:in|inside) (.+)$/);
    return { intent:'what-changed', entity:null, room:roomMatch ? cleanReference(roomMatch[1]) : null, sinceMs:null, limit:null, text:raw };
  }
  if (text.includes('anomal') || text.includes('needs attention') || text.includes('what is wrong') || text.includes('whats wrong')) {
    return { intent:'active-anomalies', entity:null, room:null, sinceMs:null, limit:null, text:raw };
  }
  if ((match = text.match(/^(?:why|explain)(?: do you think| is| )? (.+)$/))) {
    return { intent:'explain', entity:cleanReference(match[1]), room:null, sinceMs:null, limit:null, text:raw };
  }

  return {
    intent:'search',
    entity:raw || null,
    room:null,
    sinceMs:null,
    limit:null,
    text:raw
  };
}

function entityCurrentState(entity) {
  return entity?.current || null;
}

function latestAllowedHistory(entityId, context) {
  const history = context.spatialMemory?.entities?.[entityId]?.history || [];
  return [...history]
    .reverse()
    .find((entry) => historicalRoomAllowed(context, entry.roomId)) || null;
}

function confirmedExpectation(entityId, context) {
  const proposals = context.spatialMemory?.proposals || [];
  return [...proposals]
    .filter((item) => (
      item.type === 'expected-location' &&
      item.subjectId === entityId &&
      item.status === 'confirmed' &&
      historicalRoomAllowed(context, item.roomId)
    ))
    .sort((a,b) => Number(b.resolvedAt || b.updatedAt || 0) - Number(a.resolvedAt || a.updatedAt || 0))[0] || null;
}

function roomAnchorLabel(entry, context) {
  if (!entry) return null;
  if (entry.anchorLabel) return entry.anchorLabel;
  if (entry.anchorId) {
    const graphNodes = Array.isArray(context.sceneGraph?.nodes)
      ? context.sceneGraph.nodes
      : Object.values(context.sceneGraph?.nodes || {});
    return graphNodes.find((node) => node.id === entry.anchorId)?.label || entry.anchorId;
  }
  return null;
}

function freshness(lastObservedAt, now) {
  if (!lastObservedAt) return null;
  return Math.max(0, now - Number(lastObservedAt));
}

function baseAnswer(parsed, now) {
  return {
    query: parsed.text || '',
    intent: parsed.intent,
    status: 'unknown',
    summary: 'I do not have enough physical-world evidence to answer that.',
    confidence: 0,
    freshnessMs: null,
    uncertainty: [],
    facts: [],
    provenance: [],
    candidates: [],
    generatedAt: now
  };
}

function ambiguityAnswer(parsed, resolved, now) {
  return {
    ...baseAnswer(parsed, now),
    status:'ambiguous',
    summary:'That reference matches more than one physical-world entity.',
    confidence:resolved.score || 0,
    candidates:resolved.candidates || [],
    uncertainty:['entity-reference-ambiguous']
  };
}

function unknownEntityAnswer(parsed, now) {
  return {
    ...baseAnswer(parsed, now),
    status:'unknown',
    summary:'I do not have a matching physical-world entity for that reference.',
    uncertainty:['entity-not-found']
  };
}

function participantName(context, participantId) {
  const key = 'PERSON:' + participantId;
  const person = context.multiRoom?.participants?.[key];
  return person?.participantName ||
    context.spatialMemory?.entities?.[key]?.label ||
    participantId;
}

function sanitizeFacts(items) {
  return safeCopy(items || []);
}

export function buildWorldTimeline(context = {}, options = {}) {
  const now = Number(options.now || Date.now());
  const sinceMs = Number(options.sinceMs || 0);
  const cutoff = sinceMs > 0 ? now - sinceMs : -Infinity;
  const roomId = options.roomId || null;
  const entityId = options.entityId || null;
  const items = [];

  for (const transition of context.multiRoom?.transitions || []) {
    const timestamp = Number(transition.timestamp || 0);
    if (timestamp < cutoff) continue;
    const transitionRooms = [transition.fromRoomId, transition.toRoomId].filter(Boolean);
    if (roomId && !transitionRooms.includes(roomId)) continue;
    if (entityId && ![
      transition.participantId ? 'PERSON:' + transition.participantId : null,
      transition.objectId
    ].includes(entityId)) continue;
    if (transitionRooms.some((id) => !historicalRoomAllowed(context, id))) continue;

    items.push({
      id: transition.id || 'transition:' + timestamp,
      timestamp,
      type: transition.type || 'world-transition',
      source:'multi-room-world',
      roomIds:transitionRooms,
      entityId:transition.participantId
        ? 'PERSON:' + transition.participantId
        : transition.objectId || null,
      summary: transition.participantName || transition.objectLabel
        ? [
            transition.participantName || transition.objectLabel,
            transition.fromRoomId && transition.toRoomId
              ? roomLabel(context, transition.fromRoomId) + ' → ' + roomLabel(context, transition.toRoomId)
              : null
          ].filter(Boolean).join(' · ')
        : String(transition.type || 'Physical transition'),
      confidence:Number(transition.confidence || 0)
    });
  }

  for (const change of context.sceneChanges || []) {
    const timestamp = Number(change.timestamp || change.at || change.startedAt || 0);
    if (timestamp < cutoff) continue;
    const changeRoomId = change.roomId || context.activeRoomId || null;
    if (roomId && changeRoomId !== roomId) continue;
    if (changeRoomId && !historicalRoomAllowed(context, changeRoomId)) continue;
    if (entityId && ![
      change.participantId ? 'PERSON:' + change.participantId : null,
      change.objectId,
      change.entityId
    ].includes(entityId)) continue;

    items.push({
      id: change.id || 'change:' + timestamp + ':' + String(change.type || ''),
      timestamp,
      type: change.type || 'scene-change',
      source:'scene-intelligence',
      roomIds:changeRoomId ? [changeRoomId] : [],
      entityId:change.participantId
        ? 'PERSON:' + change.participantId
        : change.objectId || change.entityId || null,
      summary:change.summary || change.label || String(change.type || 'Scene change'),
      confidence:Number(change.confidence || 0.6)
    });
  }

  const anomalyCollections = [
    ...Object.values(context.anomalies?.active || {}),
    ...(context.anomalies?.history || [])
  ];

  for (const anomaly of anomalyCollections) {
    const timestamp = Number(
      anomaly.confirmedAt ||
      anomaly.lastSeenAt ||
      anomaly.resolvedAt ||
      anomaly.firstSeenAt ||
      0
    );
    if (timestamp < cutoff) continue;
    if (roomId && anomaly.roomId !== roomId) continue;
    if (anomaly.roomId && !historicalRoomAllowed(context, anomaly.roomId)) continue;
    const anomalyEntity = anomaly.subjectId || anomaly.objectId ||
      (anomaly.participantId ? 'PERSON:' + anomaly.participantId : null);
    if (entityId && anomalyEntity !== entityId) continue;

    items.push({
      id:anomaly.signature || anomaly.id || 'anomaly:' + timestamp,
      timestamp,
      type:'anomaly.' + String(anomaly.type || 'physical'),
      source:'proactive-awareness',
      roomIds:anomaly.roomId ? [anomaly.roomId] : [],
      entityId:anomalyEntity,
      summary:anomaly.summary || String(anomaly.type || 'Physical anomaly'),
      confidence:Number(anomaly.confidence || 0),
      status:anomaly.status || null,
      severity:anomaly.severity || null
    });
  }

  if (entityId) {
    for (const entry of context.spatialMemory?.entities?.[entityId]?.history || []) {
      const timestamp = Number(entry.timestamp || 0);
      if (timestamp < cutoff) continue;
      if (roomId && entry.roomId !== roomId) continue;
      if (!historicalRoomAllowed(context, entry.roomId)) continue;
      items.push({
        id:'memory:' + entityId + ':' + timestamp,
        timestamp,
        type:'spatial-memory.' + String(entry.event || 'observed'),
        source:'spatial-memory',
        roomIds:entry.roomId ? [entry.roomId] : [],
        entityId,
        summary:[
          context.spatialMemory?.entities?.[entityId]?.label || entityId,
          entry.event || 'observed',
          entry.roomId ? roomLabel(context, entry.roomId) : null,
          roomAnchorLabel(entry, context)
        ].filter(Boolean).join(' · '),
        confidence:Number(entry.confidence || 0)
      });
    }
  }

  const deduped = new Map();
  for (const item of items) {
    const key = [
      item.source,
      item.type,
      item.entityId || '',
      item.timestamp,
      item.summary
    ].join('|');
    deduped.set(key, item);
  }

  return [...deduped.values()]
    .sort((a,b) => b.timestamp - a.timestamp)
    .slice(0, Math.max(1, Number(options.limit || 100)))
    .map((item) => safeCopy(item));
}

export function buildEvidenceBundle(entityId, context = {}, now = Date.now()) {
  const entity = currentEntities(context).find((item) => item.id === entityId) || null;
  const current = entityCurrentState(entity);
  const history = (context.spatialMemory?.entities?.[entityId]?.history || [])
    .filter((entry) => historicalRoomAllowed(context, entry.roomId))
    .slice(-20);
  const expectation = confirmedExpectation(entityId, context);
  const graphNodes = Array.isArray(context.sceneGraph?.nodes)
    ? context.sceneGraph.nodes
    : Object.values(context.sceneGraph?.nodes || {});
  const graphEdges = Array.isArray(context.sceneGraph?.edges)
    ? context.sceneGraph.edges
    : Object.values(context.sceneGraph?.edges || {});
  const graphNode = graphNodes.find((node) => node.id === entityId) || null;
  const relationships = graphEdges
    .filter((edge) => edge.subjectId === entityId || edge.objectId === entityId)
    .filter((edge) => {
      const room = graphNode?.properties?.roomId || current?.roomId || null;
      return historicalRoomAllowed(context, room);
    })
    .slice(-30);
  const anomalies = [
    ...Object.values(context.anomalies?.active || {}),
    ...(context.anomalies?.history || [])
  ]
    .filter((item) => (
      item.subjectId === entityId ||
      item.objectId === entityId ||
      (item.participantId && 'PERSON:' + item.participantId === entityId)
    ))
    .filter((item) => historicalRoomAllowed(context, item.roomId))
    .slice(-20);

  const provenance = [];
  if (current) {
    provenance.push({
      source:'multi-room-world',
      kind:'current-state',
      timestamp:current.lastObservedAt || context.multiRoom?.updatedAt || now,
      confidence:Number(current.confidence || 0),
      roomId:current.roomId || current.lastKnownRoomId || null
    });
  }
  for (const item of history.slice(-5)) {
    provenance.push({
      source:item.source || 'spatial-memory',
      kind:item.event || 'observation',
      timestamp:item.timestamp,
      confidence:Number(item.confidence || 0),
      roomId:item.roomId || null
    });
  }
  if (expectation) {
    provenance.push({
      source:'confirmed-spatial-memory',
      kind:'expected-location',
      timestamp:expectation.resolvedAt || expectation.updatedAt || expectation.confirmedAt || null,
      confidence:Number(expectation.confidence || 0),
      roomId:expectation.roomId || null
    });
  }

  return safeCopy({
    entity: entity ? {
      id:entity.id,
      type:entity.type,
      label:entity.label
    } : null,
    current:current || null,
    latestHistory:history[history.length - 1] || null,
    confirmedExpectation:expectation,
    relationships,
    anomalies,
    provenance,
    generatedAt:now
  });
}

function answerWhere(parsed, context, now) {
  const resolved = resolveEntityReference(parsed.entity, context);
  if (resolved.status === 'ambiguous') return ambiguityAnswer(parsed, resolved, now);
  if (resolved.status !== 'resolved') return unknownEntityAnswer(parsed, now);

  const entity = resolved.entity;
  const current = entity.current;
  const latest = latestAllowedHistory(entity.id, context);
  const expectation = confirmedExpectation(entity.id, context);
  const answer = baseAnswer(parsed, now);

  if (current?.roomId && ['confirmed','transitioning'].includes(current.presence)) {
    const room = roomLabel(context, current.roomId);
    const anchor = latest?.roomId === current.roomId
      ? roomAnchorLabel(latest, context)
      : null;
    answer.status = 'answered';
    answer.summary = entity.label + ' is currently in ' + room +
      (anchor ? ', near ' + anchor : '') + '.';
    answer.confidence = clamp01(current.confidence);
    answer.freshnessMs = freshness(current.lastObservedAt, now);
    answer.facts.push({
      type:'current-location',
      entityId:entity.id,
      roomId:current.roomId,
      room,
      anchor:anchor || null,
      presence:current.presence,
      confidence:answer.confidence,
      lastObservedAt:current.lastObservedAt || null
    });
    answer.provenance.push({
      source:'multi-room-world',
      timestamp:current.lastObservedAt || context.multiRoom?.updatedAt || now,
      confidence:answer.confidence
    });
    return sanitizeFacts(answer);
  }

  const lastRoomId = current?.lastKnownRoomId || latest?.roomId || null;
  if (lastRoomId && historicalRoomAllowed(context, lastRoomId)) {
    const room = roomLabel(context, lastRoomId);
    const anchor = roomAnchorLabel(latest, context);
    const lastAt = current?.lastObservedAt || latest?.timestamp || null;
    answer.status = 'answered';
    answer.summary = 'I last saw ' + entity.label + ' in ' + room +
      (anchor ? ', near ' + anchor : '') + '.';
    answer.confidence = clamp01(
      Number(current?.confidence || latest?.confidence || 0.45)
    );
    answer.freshnessMs = freshness(lastAt, now);
    answer.uncertainty.push('location-is-last-known-not-current');
    answer.facts.push({
      type:'last-known-location',
      entityId:entity.id,
      roomId:lastRoomId,
      room,
      anchor:anchor || null,
      lastObservedAt:lastAt
    });
    answer.provenance.push({
      source:latest?.source || 'multi-room-world',
      timestamp:lastAt,
      confidence:answer.confidence
    });
    if (expectation) {
      answer.facts.push({
        type:'confirmed-expected-location',
        targetId:expectation.targetId,
        roomId:expectation.roomId,
        anchorId:expectation.anchorId || null,
        anchorLabel:expectation.anchorLabel || null,
        confidence:expectation.confidence
      });
    }
    return sanitizeFacts(answer);
  }

  answer.summary = 'I do not have a current or privacy-eligible last-known location for ' + entity.label + '.';
  answer.uncertainty.push('no-current-location');
  return answer;
}

function answerLastSeen(parsed, context, now) {
  const resolved = resolveEntityReference(parsed.entity, context);
  if (resolved.status === 'ambiguous') return ambiguityAnswer(parsed, resolved, now);
  if (resolved.status !== 'resolved') return unknownEntityAnswer(parsed, now);
  const entity = resolved.entity;
  const current = entity.current;
  const latest = latestAllowedHistory(entity.id, context);
  const roomId = current?.roomId || current?.lastKnownRoomId || latest?.roomId || null;

  if (roomId && !historicalRoomAllowed(context, roomId)) {
    return {
      ...baseAnswer(parsed, now),
      status:'restricted',
      summary:'Historical spatial recall is disabled for that room.',
      uncertainty:['spatial-memory-disabled-by-room-policy']
    };
  }

  const timestamp = current?.lastObservedAt || latest?.timestamp || null;
  if (!timestamp) return unknownEntityAnswer(parsed, now);

  const answer = baseAnswer(parsed, now);
  answer.status = 'answered';
  answer.summary = entity.label + ' was last observed' +
    (roomId ? ' in ' + roomLabel(context, roomId) : '') +
    (roomAnchorLabel(latest, context) ? ', near ' + roomAnchorLabel(latest, context) : '') + '.';
  answer.confidence = clamp01(Number(current?.confidence || latest?.confidence || 0.5));
  answer.freshnessMs = freshness(timestamp, now);
  answer.facts.push({
    type:'last-seen',
    entityId:entity.id,
    timestamp,
    roomId,
    anchorId:latest?.anchorId || null,
    anchorLabel:roomAnchorLabel(latest, context)
  });
  answer.provenance.push({
    source:latest?.source || 'multi-room-world',
    timestamp,
    confidence:answer.confidence
  });
  return sanitizeFacts(answer);
}

function compressedJourney(entityId, context) {
  const history = (context.spatialMemory?.entities?.[entityId]?.history || [])
    .filter((entry) => historicalRoomAllowed(context, entry.roomId));
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
      roomId:entry.roomId || null,
      room:entry.roomId ? roomLabel(context, entry.roomId) : null,
      anchorId:entry.anchorId || null,
      anchorLabel:entry.anchorLabel || null,
      holderParticipantId:entry.holderParticipantId || null,
      holderName:entry.holderParticipantId
        ? participantName(context, entry.holderParticipantId)
        : null,
      event:entry.event || 'observed',
      firstObservedAt:entry.timestamp,
      lastObservedAt:entry.timestamp,
      observations:1,
      confidence:Number(entry.confidence || 0)
    });
  }
  return journey;
}

function answerHistory(parsed, context, now) {
  const resolved = resolveEntityReference(parsed.entity, context);
  if (resolved.status === 'ambiguous') return ambiguityAnswer(parsed, resolved, now);
  if (resolved.status !== 'resolved') return unknownEntityAnswer(parsed, now);

  const entity = resolved.entity;
  const journey = compressedJourney(entity.id, context);
  const answer = baseAnswer(parsed, now);
  if (!journey.length) {
    answer.summary = 'I do not have privacy-eligible semantic history for ' + entity.label + '.';
    answer.uncertainty.push('no-semantic-history');
    return answer;
  }

  answer.status='answered';
  answer.summary = 'I have ' + journey.length + ' semantic location/custody steps for ' + entity.label + '.';
  answer.confidence = clamp01(
    journey.reduce((sum,item)=>sum+Number(item.confidence||0),0) / journey.length
  );
  answer.freshnessMs = freshness(journey[journey.length - 1].lastObservedAt, now);
  answer.facts = journey.slice(-Math.max(1, parsed.limit || 12)).map((item)=>({
    type:'journey-step',
    ...item
  }));
  answer.provenance.push({
    source:'spatial-memory',
    timestamp:journey[journey.length - 1].lastObservedAt,
    confidence:answer.confidence
  });
  return sanitizeFacts(answer);
}

function answerWhoHad(parsed, context, now) {
  const resolved = resolveEntityReference(parsed.entity, context);
  if (resolved.status === 'ambiguous') return ambiguityAnswer(parsed, resolved, now);
  if (resolved.status !== 'resolved') return unknownEntityAnswer(parsed, now);
  const entity = resolved.entity;
  const history = (context.spatialMemory?.entities?.[entity.id]?.history || [])
    .filter((entry) => entry.holderParticipantId)
    .filter((entry) => historicalRoomAllowed(context, entry.roomId));

  const answer = baseAnswer(parsed, now);
  if (!history.length) {
    answer.summary = 'I do not have recorded custody evidence for ' + entity.label + '.';
    answer.uncertainty.push('no-custody-history');
    return answer;
  }

  const byHolder = new Map();
  for (const entry of history) {
    const id = entry.holderParticipantId;
    const existing = byHolder.get(id) || {
      participantId:id,
      participantName:participantName(context,id),
      observations:0,
      firstObservedAt:entry.timestamp,
      lastObservedAt:entry.timestamp,
      confidence:0
    };
    existing.observations += 1;
    existing.firstObservedAt = Math.min(existing.firstObservedAt, entry.timestamp);
    existing.lastObservedAt = Math.max(existing.lastObservedAt, entry.timestamp);
    existing.confidence = Math.max(existing.confidence, Number(entry.confidence || 0));
    byHolder.set(id, existing);
  }

  const holders = [...byHolder.values()].sort((a,b)=>b.lastObservedAt-a.lastObservedAt);
  answer.status='answered';
  answer.summary = 'The most recent recorded holder of ' + entity.label +
    ' was ' + holders[0].participantName + '.';
  answer.confidence = clamp01(holders[0].confidence);
  answer.freshnessMs = freshness(holders[0].lastObservedAt, now);
  answer.facts = holders.map((item)=>({type:'custody',...item}));
  answer.provenance.push({
    source:'spatial-memory',
    timestamp:holders[0].lastObservedAt,
    confidence:answer.confidence
  });
  answer.uncertainty.push('possession-does-not-imply-ownership');
  return sanitizeFacts(answer);
}

function answerRoomOccupants(parsed, context, now) {
  const resolved = resolveRoomReference(parsed.room, context);
  const answer = baseAnswer(parsed, now);
  if (resolved.status === 'ambiguous') {
    answer.status='ambiguous';
    answer.summary='That room reference matches more than one room.';
    answer.candidates=resolved.candidates;
    answer.uncertainty.push('room-reference-ambiguous');
    return answer;
  }
  if (resolved.status !== 'resolved') {
    answer.summary='I do not have a matching room for that reference.';
    answer.uncertainty.push('room-not-found');
    return answer;
  }

  const roomId = resolved.room.id;
  const occupants = Object.values(context.multiRoom?.participants || {})
    .filter((person) => (
      person.roomId === roomId &&
      ['confirmed','transitioning'].includes(person.presence)
    ))
    .map((person) => ({
      participantId:person.participantId || null,
      entityId:person.id,
      name:person.participantName || person.id,
      presence:person.presence,
      confidence:Number(person.confidence || 0),
      lastObservedAt:person.lastObservedAt || null
    }));

  answer.status='answered';
  answer.summary = occupants.length
    ? roomLabel(context, roomId) + ' currently has ' + occupants.length + ' tracked participant' +
      (occupants.length === 1 ? '.' : 's.')
    : 'I do not currently see a confirmed participant in ' + roomLabel(context, roomId) + '.';
  answer.confidence = occupants.length
    ? clamp01(Math.min(...occupants.map((item)=>item.confidence)))
    : 0.75;
  answer.freshnessMs = occupants.length
    ? Math.max(...occupants.map((item)=>freshness(item.lastObservedAt, now) || 0))
    : null;
  answer.facts = occupants.map((item)=>({type:'room-occupant',roomId,...item}));
  answer.provenance.push({
    source:'multi-room-world',
    timestamp:context.multiRoom?.updatedAt || now,
    confidence:answer.confidence
  });
  return sanitizeFacts(answer);
}

function answerWhatChanged(parsed, context, now) {
  let roomId = null;
  if (parsed.room) {
    const resolved = resolveRoomReference(parsed.room, context);
    if (resolved.status !== 'resolved') {
      const answer = baseAnswer(parsed, now);
      answer.status = resolved.status === 'ambiguous' ? 'ambiguous' : 'unknown';
      answer.summary = resolved.status === 'ambiguous'
        ? 'That room reference matches more than one room.'
        : 'I do not have a matching room for that reference.';
      answer.candidates = resolved.candidates || [];
      return answer;
    }
    roomId = resolved.room.id;
  }

  const sinceMs = parsed.sinceMs || 15 * 60 * 1000;
  const timeline = buildWorldTimeline(context, {
    roomId,
    sinceMs,
    now,
    limit:parsed.limit || 20
  });
  const answer = baseAnswer(parsed, now);

  if (!timeline.length) {
    answer.status='answered';
    answer.summary='I do not have a meaningful semantic change recorded in that window.';
    answer.confidence=0.72;
    return answer;
  }

  answer.status='answered';
  answer.summary='I found ' + timeline.length + ' meaningful physical-world change' +
    (timeline.length === 1 ? '.' : 's.');
  answer.confidence=clamp01(
    timeline.reduce((sum,item)=>sum+Number(item.confidence||0.6),0) / timeline.length
  );
  answer.freshnessMs=freshness(timeline[0].timestamp,now);
  answer.facts=timeline;
  answer.provenance=[...new Set(timeline.map((item)=>item.source))]
    .map((source)=>({source}));
  return sanitizeFacts(answer);
}

function answerActiveAnomalies(parsed, context, now) {
  const active = Object.values(context.anomalies?.active || {})
    .filter((item) => historicalRoomAllowed(context, item.roomId))
    .sort((a,b) => Number(b.priority || 0) - Number(a.priority || 0));
  const answer=baseAnswer(parsed,now);
  answer.status='answered';
  answer.summary=active.length
    ? 'There are ' + active.length + ' confirmed physical-world anomal' +
      (active.length === 1 ? 'y.' : 'ies.')
    : 'There are no confirmed physical-world anomalies right now.';
  answer.confidence=active.length
    ? clamp01(Number(active[0].confidence || 0))
    : 0.95;
  answer.facts=active.map((item)=>({
    type:'active-anomaly',
    signature:item.signature,
    anomalyType:item.type,
    severity:item.severity,
    status:item.status,
    roomId:item.roomId || null,
    subjectId:item.subjectId || item.objectId || null,
    summary:item.summary,
    confidence:item.confidence,
    firstSeenAt:item.firstSeenAt,
    lastSeenAt:item.lastSeenAt
  }));
  answer.provenance.push({source:'proactive-awareness'});
  return sanitizeFacts(answer);
}

function answerExpectedLocation(parsed, context, now) {
  const resolved=resolveEntityReference(parsed.entity,context);
  if(resolved.status==='ambiguous') return ambiguityAnswer(parsed,resolved,now);
  if(resolved.status!=='resolved') return unknownEntityAnswer(parsed,now);
  const entity=resolved.entity;
  const confirmed=confirmedExpectation(entity.id,context);
  const answer=baseAnswer(parsed,now);

  if(confirmed){
    const target=confirmed.anchorLabel ||
      (confirmed.roomId ? roomLabel(context,confirmed.roomId) : confirmed.targetId);
    answer.status='answered';
    answer.summary=entity.label + ' has a confirmed expected location: ' + target + '.';
    answer.confidence=clamp01(Number(confirmed.confidence||0));
    answer.facts=[{
      type:'confirmed-expected-location',
      entityId:entity.id,
      targetId:confirmed.targetId,
      roomId:confirmed.roomId || null,
      room:confirmed.roomId ? roomLabel(context,confirmed.roomId) : null,
      anchorId:confirmed.anchorId || null,
      anchorLabel:confirmed.anchorLabel || null,
      confidence:confirmed.confidence,
      confirmedAt:confirmed.resolvedAt || confirmed.updatedAt || null
    }];
    answer.provenance.push({
      source:'confirmed-spatial-memory',
      timestamp:confirmed.resolvedAt || confirmed.updatedAt || null,
      confidence:answer.confidence
    });
    return sanitizeFacts(answer);
  }

  const evidence=context.spatialMemory?.expectedLocations?.[entity.id];
  const candidates=Object.values(evidence?.candidates||{})
    .map((item)=>({
      ...item,
      sessions:Object.keys(item.sessions||{}).length,
      averageConfidence:item.observations
        ? item.confidenceSum/item.observations
        : 0
    }))
    .sort((a,b)=>b.observations-a.observations);

  if(candidates.length){
    answer.status='unconfirmed';
    answer.summary='I have learned location evidence for ' + entity.label +
      ', but it has not been confirmed as an expected location.';
    answer.confidence=clamp01(Number(candidates[0].averageConfidence||0));
    answer.uncertainty.push('expected-location-not-confirmed');
    answer.facts=[{
      type:'unconfirmed-location-evidence',
      targetId:candidates[0].targetId,
      roomId:candidates[0].roomId,
      anchorId:candidates[0].anchorId,
      anchorLabel:candidates[0].anchorLabel,
      observations:candidates[0].observations,
      sessions:candidates[0].sessions,
      confidence:candidates[0].averageConfidence
    }];
    return sanitizeFacts(answer);
  }

  answer.summary='I have not learned a confirmed expected location for ' + entity.label + '.';
  answer.uncertainty.push('no-confirmed-expected-location');
  return answer;
}

function answerExplain(parsed, context, now) {
  const resolved=resolveEntityReference(parsed.entity,context);
  if(resolved.status==='ambiguous') return ambiguityAnswer(parsed,resolved,now);
  if(resolved.status!=='resolved') return unknownEntityAnswer(parsed,now);
  const bundle=buildEvidenceBundle(resolved.entity.id,context,now);
  const answer=baseAnswer(parsed,now);
  answer.status='answered';
  answer.summary='Here is the physical-world evidence I have for ' + resolved.entity.label + '.';
  answer.confidence=clamp01(Number(
    bundle.current?.confidence ||
    bundle.latestHistory?.confidence ||
    bundle.confirmedExpectation?.confidence ||
    0.5
  ));
  answer.freshnessMs=freshness(
    bundle.current?.lastObservedAt ||
    bundle.latestHistory?.timestamp ||
    bundle.generatedAt,
    now
  );
  answer.facts=[{
    type:'evidence-bundle',
    ...bundle
  }];
  answer.provenance=bundle.provenance || [];
  if(!bundle.current) answer.uncertainty.push('no-current-observation');
  return sanitizeFacts(answer);
}

function answerSearch(parsed, context, now) {
  const resolved=resolveEntityReference(parsed.entity,context);
  const answer=baseAnswer(parsed,now);
  if(resolved.status==='resolved'){
    answer.status='answered';
    answer.summary='I found ' + resolved.entity.label + ' in the physical-world index.';
    answer.confidence=resolved.score;
    answer.facts=[{
      type:'entity-match',
      id:resolved.entity.id,
      label:resolved.entity.label,
      entityType:resolved.entity.type
    }];
    return answer;
  }
  if(resolved.status==='ambiguous') return ambiguityAnswer(parsed,resolved,now);
  answer.summary='I did not find a matching physical-world entity.';
  answer.candidates=resolved.candidates;
  return answer;
}

export function answerPhysicalWorldQuery(input, context = {}, now = Date.now()) {
  const parsed=parseWorldQuery(input);

  switch(parsed.intent){
    case 'where-is': return answerWhere(parsed,context,now);
    case 'last-seen': return answerLastSeen(parsed,context,now);
    case 'history': return answerHistory(parsed,context,now);
    case 'who-had': return answerWhoHad(parsed,context,now);
    case 'room-occupants': return answerRoomOccupants(parsed,context,now);
    case 'what-changed': return answerWhatChanged(parsed,context,now);
    case 'active-anomalies': return answerActiveAnomalies(parsed,context,now);
    case 'expected-location': return answerExpectedLocation(parsed,context,now);
    case 'explain': return answerExplain(parsed,context,now);
    default: return answerSearch(parsed,context,now);
  }
}
