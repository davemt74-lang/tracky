const FACT_STATES = new Set([
  'observed','inferred','last-known','user-confirmed','contradicted','expired'
]);

export const WORLD_FACT_STATES = Object.freeze([...FACT_STATES]);

export function createSceneGraph(roomId = 'ROOM01') {
  return {
    schemaVersion: 1,
    roomId,
    updatedAt: Date.now(),
    nodes: {},
    edges: {}
  };
}

export function createGraphNode(input = {}) {
  return {
    id: String(input.id),
    type: String(input.type || 'entity'),
    label: String(input.label || input.id || 'Entity'),
    state: FACT_STATES.has(input.state) ? input.state : 'observed',
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.5))),
    position: input.position || null,
    properties: input.properties || {},
    provenance: Array.isArray(input.provenance) ? input.provenance : [],
    firstObservedAt: Number(input.firstObservedAt || Date.now()),
    lastObservedAt: Number(input.lastObservedAt || Date.now())
  };
}

export function upsertGraphNode(graph, input) {
  const existing = graph.nodes[input.id];
  const preserveConfirmed = (
    existing?.state === 'user-confirmed' &&
    input.state !== 'user-confirmed'
  );
  graph.nodes[input.id] = createGraphNode({
    ...existing,
    ...input,
    type: preserveConfirmed ? existing.type : input.type,
    label: preserveConfirmed ? existing.label : input.label,
    properties: {
      ...(existing?.properties || {}),
      ...(input.properties || {})
    },
    state: preserveConfirmed ? 'user-confirmed' : input.state,
    confidence: preserveConfirmed
      ? Math.max(Number(existing?.confidence || 0), Number(input.confidence || 0))
      : input.confidence,
    firstObservedAt: existing?.firstObservedAt || input.firstObservedAt,
    provenance: mergeProvenance(existing?.provenance || [], input.provenance || [])
  });
  graph.updatedAt = Date.now();
  return graph.nodes[input.id];
}

export function edgeId(subjectId, predicate, objectId) {
  return [subjectId, predicate, objectId].join('::');
}

export function upsertGraphEdge(graph, input) {
  const id = input.id || edgeId(input.subjectId, input.predicate, input.objectId);
  const existing = graph.edges[id];
  const preserveConfirmed = (
    existing?.state === 'user-confirmed' &&
    input.state !== 'user-confirmed'
  );
  graph.edges[id] = {
    id,
    subjectId: input.subjectId,
    predicate: input.predicate,
    objectId: input.objectId,
    state: preserveConfirmed
      ? 'user-confirmed'
      : (FACT_STATES.has(input.state) ? input.state : 'observed'),
    confidence: Math.max(0, Math.min(
      1,
      preserveConfirmed
        ? Math.max(Number(existing?.confidence || 0), Number(input.confidence || 0))
        : Number(input.confidence ?? 0.5)
    )),
    provenance: mergeProvenance(existing?.provenance || [], input.provenance || []),
    firstObservedAt: existing?.firstObservedAt || Number(input.firstObservedAt || Date.now()),
    lastObservedAt: Number(input.lastObservedAt || Date.now()),
    properties: { ...(existing?.properties || {}), ...(input.properties || {}) }
  };
  graph.updatedAt = Date.now();
  return graph.edges[id];
}

export function mergeProvenance(a = [], b = []) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const key = [item.source,item.cameraId,item.eventId,item.timestamp,item.kind].join('|');
    map.set(key, { ...item });
  }
  return [...map.values()].slice(-20);
}

export function spatialRelation(a, b) {
  if (!a?.position || !b?.position) return null;
  const dx = Number(b.position.x) - Number(a.position.x);
  const dy = Number(b.position.y) - Number(a.position.y);
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.10) return 'near';
  if (Math.abs(dx) > Math.abs(dy) * 1.35) return dx > 0 ? 'right-of' : 'left-of';
  if (Math.abs(dy) > Math.abs(dx) * 1.35) return dy > 0 ? 'below' : 'above';
  return 'near';
}

export function buildRoomSceneGraph(input = {}, previous = null, now = Date.now()) {
  const graph = previous || createSceneGraph(input.roomId || 'ROOM01');
  graph.roomId = input.roomId || graph.roomId;

  upsertGraphNode(graph, {
    id: graph.roomId,
    type: 'room',
    label: input.roomName || graph.roomId,
    state: input.roomUserConfirmed ? 'user-confirmed' : 'observed',
    confidence: Number(input.roomConfidence ?? 1),
    lastObservedAt: now,
    provenance: input.provenance || []
  });

  for (const landmark of input.landmarks || []) {
    const node = upsertGraphNode(graph, {
      id: landmark.id,
      type: landmark.label === 'door' ? 'portal-landmark' : 'landmark',
      label: landmark.name || landmark.label,
      state: landmark.userConfirmed ? 'user-confirmed' : 'observed',
      confidence: landmark.confidence,
      position: landmark.position,
      properties: {
        detectorLabel: landmark.label,
        stability: landmark.stability,
        occluder: ['desk','table','couch','sofa','bookshelf','shelf','bed']
          .includes(String(landmark.label || '').toLowerCase()),
        occlusionRadius: ['couch','sofa','bed'].includes(String(landmark.label || '').toLowerCase())
          ? 0.14
          : 0.09
      },
      lastObservedAt: now,
      provenance: [{
        kind:'landmark',
        source:landmark.source || 'vision',
        timestamp:now
      }]
    });
    upsertGraphEdge(graph, {
      subjectId: graph.roomId,
      predicate: 'contains',
      objectId: node.id,
      confidence: node.confidence,
      lastObservedAt: now,
      provenance: node.provenance
    });
  }

  for (const portal of input.portals || []) {
    const node = upsertGraphNode(graph, {
      id: portal.id,
      type: 'portal',
      label: portal.name,
      state: portal.userConfirmed ? 'user-confirmed' : 'inferred',
      confidence: portal.confidence,
      position: portal.position,
      properties: {
        landmarkId: portal.landmarkId,
        connectsToRoomId: portal.connectsToRoomId || null
      },
      lastObservedAt: now,
      provenance: [{kind:'mapping',source:'assisted-room-mapping',timestamp:now}]
    });
    upsertGraphEdge(graph, {
      subjectId: graph.roomId,
      predicate: 'has-portal',
      objectId: node.id,
      confidence: node.confidence,
      lastObservedAt: now
    });
  }

  for (const participant of input.participants || []) {
    const id = participant.participantId
      ? 'PERSON:' + participant.participantId
      : 'TRACK:' + participant.id;
    const node = upsertGraphNode(graph, {
      id,
      type: 'person',
      label: participant.participantName || participant.id,
      state: participant.status === 'last-known' ? 'last-known' : 'observed',
      confidence: participant.confidence,
      position: participant.roomPosition,
      properties: {
        participantId: participant.participantId || null,
        cameraIds: participant.cameraIds || []
      },
      lastObservedAt: participant.lastSeenAt || now,
      provenance: (participant.observations || []).map((observation) => ({
        kind:'camera-observation',
        source:'camera',
        cameraId:observation.cameraId,
        timestamp:participant.lastSeenAt || now
      }))
    });
    upsertGraphEdge(graph, {
      subjectId: id,
      predicate: 'located-in',
      objectId: graph.roomId,
      confidence: node.confidence,
      state: node.state,
      lastObservedAt: node.lastObservedAt,
      provenance: node.provenance
    });
  }

  for (const object of input.objects || []) {
    const node = upsertGraphNode(graph, {
      id: object.id,
      type: 'object',
      label: object.label,
      state: object.status === 'last-known' ? 'last-known' : 'observed',
      confidence: object.confidence,
      position: object.roomPosition,
      properties: {
        detectorLabel: object.label,
        cameraIds: object.cameraIds || []
      },
      lastObservedAt: object.lastSeenAt || now,
      provenance: (object.observations || []).map((observation) => ({
        kind:'camera-observation',
        source:'camera',
        cameraId:observation.cameraId,
        timestamp:object.lastSeenAt || now
      }))
    });
    upsertGraphEdge(graph, {
      subjectId: object.id,
      predicate: 'located-in',
      objectId: graph.roomId,
      confidence: node.confidence,
      state: node.state,
      lastObservedAt: node.lastObservedAt,
      provenance: node.provenance
    });
  }

  const spatialNodes = Object.values(graph.nodes)
    .filter((node) => node.position && ['person','object','landmark','portal'].includes(node.type));

  for (let a = 0; a < spatialNodes.length; a += 1) {
    for (let b = a + 1; b < spatialNodes.length; b += 1) {
      const left = spatialNodes[a];
      const right = spatialNodes[b];
      const relation = spatialRelation(left, right);
      if (!relation) continue;
      const distance = Math.hypot(
        right.position.x - left.position.x,
        right.position.y - left.position.y
      );
      if (distance > 0.28) continue;
      upsertGraphEdge(graph, {
        subjectId: left.id,
        predicate: relation,
        objectId: right.id,
        confidence: Math.max(0.45, 1 - distance / 0.4),
        state: 'inferred',
        lastObservedAt: now,
        provenance: [{kind:'spatial-inference',source:'scene-graph',timestamp:now}]
      });
    }
  }

  return graph;
}

export function markGraphFactsStale(graph, now = Date.now(), options = {}) {
  const lastKnownMs = Number(options.lastKnownMs || 15000);
  const expireMs = Number(options.expireMs || 24 * 60 * 60 * 1000);

  for (const node of Object.values(graph.nodes)) {
    if (node.state === 'user-confirmed') continue;
    const age = now - Number(node.lastObservedAt || 0);
    if (age > expireMs) node.state = 'expired';
    else if (age > lastKnownMs && node.state === 'observed') node.state = 'last-known';
  }

  for (const edge of Object.values(graph.edges)) {
    if (edge.state === 'user-confirmed') continue;
    const age = now - Number(edge.lastObservedAt || 0);
    if (age > expireMs) edge.state = 'expired';
    else if (age > lastKnownMs && edge.state === 'observed') edge.state = 'last-known';
  }

  return graph;
}


export function confirmGraphNode(graph, input = {}, now = Date.now()) {
  if (!input.id) throw new Error('Confirmed graph node requires an id.');
  return upsertGraphNode(graph, {
    ...input,
    state: 'user-confirmed',
    confidence: Math.max(0.98, Number(input.confidence || 0)),
    lastObservedAt: now,
    provenance: [
      ...(input.provenance || []),
      { kind:'user-confirmation', source:input.source || 'user', timestamp:now }
    ]
  });
}

export function confirmGraphEdge(graph, input = {}, now = Date.now()) {
  if (!input.subjectId || !input.predicate || !input.objectId) {
    throw new Error('Confirmed graph edge requires subjectId, predicate, and objectId.');
  }
  return upsertGraphEdge(graph, {
    ...input,
    state: 'user-confirmed',
    confidence: Math.max(0.98, Number(input.confidence || 0)),
    lastObservedAt: now,
    provenance: [
      ...(input.provenance || []),
      { kind:'user-confirmation', source:input.source || 'user', timestamp:now }
    ]
  });
}

export function nearestGraphNode(graph, position, options = {}) {
  if (!position) return null;
  const maxDistance = Number(options.maxDistance || 0.18);
  const types = options.types ? new Set(options.types) : null;
  let best = null;
  let bestDistance = Infinity;

  for (const node of Object.values(graph?.nodes || {})) {
    if (!node.position || node.state === 'expired') continue;
    if (types && !types.has(node.type)) continue;
    const distance = Math.hypot(
      Number(node.position.x || 0) - Number(position.x || 0),
      Number(node.position.y || 0) - Number(position.y || 0)
    );
    if (distance < bestDistance && distance <= maxDistance) {
      best = node;
      bestDistance = distance;
    }
  }

  return best ? { node: best, distance: bestDistance } : null;
}

export function graphFactsForEntity(graph, entityId) {
  return {
    node: graph?.nodes?.[entityId] || null,
    outgoing: Object.values(graph?.edges || {}).filter((edge) => edge.subjectId === entityId),
    incoming: Object.values(graph?.edges || {}).filter((edge) => edge.objectId === entityId)
  };
}

export function sceneGraphSnapshot(graph) {
  return {
    schemaVersion: graph.schemaVersion,
    roomId: graph.roomId,
    updatedAt: graph.updatedAt,
    nodes: Object.values(graph.nodes).filter((node) => node.state !== 'expired'),
    edges: Object.values(graph.edges).filter((edge) => edge.state !== 'expired')
  };
}
