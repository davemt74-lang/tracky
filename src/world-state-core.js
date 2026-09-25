export const WORLD_KNOWLEDGE_STATES = Object.freeze([
  'observed','inferred','last-known','user-confirmed','contradicted','expired'
]);

export function evidenceQuorum(items = [], options = {}) {
  const minimumSources = Number(options.minimumSources || 2);
  const minimumConfidence = Number(options.minimumConfidence || 0.62);
  const sources = new Set(items.map((item) => item.source).filter(Boolean));
  const confidence = items.length
    ? items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / items.length
    : 0;
  return {
    met: sources.size >= minimumSources && confidence >= minimumConfidence,
    sourceCount: sources.size,
    confidence
  };
}

export function decayConfidence(confidence, ageMs, halfLifeMs) {
  const start = Math.max(0, Math.min(1, Number(confidence || 0)));
  const halfLife = Math.max(1, Number(halfLifeMs || 60000));
  return start * Math.pow(0.5, Math.max(0, Number(ageMs || 0)) / halfLife);
}

export function entityHalfLife(entity = {}) {
  const label = String(entity.label || entity.properties?.detectorLabel || '').toLowerCase();
  if (['phone','cell phone','keys','remote','cup','bottle'].includes(label)) return 5 * 60 * 1000;
  if (['laptop','backpack','book'].includes(label)) return 30 * 60 * 1000;
  if (['desk','table','couch','sofa','monitor','tv','bookshelf','door'].includes(label)) return 7 * 24 * 60 * 60 * 1000;
  if (entity.type === 'person') return 20 * 1000;
  return 60 * 60 * 1000;
}

export function detectContradictions(graph) {
  const contradictions = [];
  const locations = new Map();

  for (const edge of Object.values(graph?.edges || {})) {
    if (edge.predicate !== 'located-in' || edge.state === 'expired') continue;
    if (!locations.has(edge.subjectId)) locations.set(edge.subjectId, []);
    locations.get(edge.subjectId).push(edge);
  }

  for (const [subjectId, edges] of locations) {
    const current = edges.filter((edge) => edge.state === 'observed' || edge.state === 'user-confirmed');
    const rooms = new Set(current.map((edge) => edge.objectId));
    if (rooms.size > 1) {
      contradictions.push({
        type: 'simultaneous-location',
        subjectId,
        roomIds: [...rooms],
        evidence: current.map((edge) => edge.id)
      });
    }
  }

  return contradictions;
}

export function createPhysicalWorldState() {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    activeRoomId: null,
    environment: null,
    sceneGraph: null,
    contradictions: [],
    facts: [],
    attention: []
  };
}

export function derivePhysicalWorldState(input = {}, previous = null, now = Date.now()) {
  const state = previous || createPhysicalWorldState();
  state.updatedAt = now;
  state.activeRoomId = input.roomId || state.activeRoomId;
  state.environment = input.environment || state.environment;
  state.sceneGraph = input.sceneGraph || state.sceneGraph;
  state.contradictions = detectContradictions(input.sceneGraph || {edges:{}});

  const facts = [];
  for (const node of input.sceneGraph?.nodes || []) {
    if (node.state === 'expired') continue;
    const ageMs = now - Number(node.lastObservedAt || now);
    facts.push({
      id: 'node:' + node.id,
      subjectId: node.id,
      kind: 'entity-state',
      state: node.state,
      confidence: node.state === 'user-confirmed'
        ? Math.max(node.confidence, 0.98)
        : decayConfidence(node.confidence, ageMs, entityHalfLife(node)),
      ageMs,
      provenance: node.provenance || []
    });
  }

  for (const edge of input.sceneGraph?.edges || []) {
    if (edge.state === 'expired') continue;
    const subject = (input.sceneGraph?.nodes || []).find((node) => node.id === edge.subjectId);
    const ageMs = now - Number(edge.lastObservedAt || now);
    facts.push({
      id: 'edge:' + edge.id,
      subjectId: edge.subjectId,
      objectId: edge.objectId,
      predicate: edge.predicate,
      kind: 'relationship',
      state: edge.state,
      confidence: edge.state === 'user-confirmed'
        ? Math.max(edge.confidence, 0.98)
        : decayConfidence(edge.confidence, ageMs, entityHalfLife(subject || {})),
      ageMs,
      provenance: edge.provenance || []
    });
  }

  for (const contradiction of state.contradictions) {
    for (const fact of facts.filter((candidate) => candidate.subjectId === contradiction.subjectId)) {
      fact.state = 'contradicted';
      fact.confidence *= 0.45;
    }
  }

  state.facts = facts;
  state.attention = rankWorldAttention({
    environment: state.environment,
    contradictions: state.contradictions,
    changes: input.changes || [],
    facts
  });

  return state;
}

export function rankWorldAttention(input = {}) {
  const items = [];

  for (const contradiction of input.contradictions || []) {
    items.push({
      priority: 1,
      type: 'contradiction',
      summary: 'Conflicting physical-world evidence',
      data: contradiction
    });
  }

  if (input.environment?.classification === 'unknown') {
    items.push({
      priority: 0.95,
      type: 'unknown-environment',
      summary: 'Current environment is not recognized',
      data: input.environment
    });
  } else if (input.environment?.classification === 'uncertain') {
    items.push({
      priority: 0.78,
      type: 'uncertain-environment',
      summary: 'Environment match needs verification',
      data: input.environment
    });
  }

  if (input.environment?.drift?.likelyCameraShift) {
    items.push({
      priority: 0.86,
      type: 'camera-pose-shift',
      summary: 'Camera position appears to have shifted',
      data: input.environment.drift
    });
  } else if (Number(input.environment?.drift?.structuralDrift || 0) >= 0.35) {
    items.push({
      priority: 0.84,
      type: 'structural-drift',
      summary: 'Meaningful environment structure changed',
      data: input.environment.drift
    });
  }

  for (const change of input.changes || []) {
    if (['presence.entered','object.moved','object.picked_up','location.changed'].includes(change.type)) {
      items.push({
        priority: change.type === 'presence.entered' ? 0.72 : 0.58,
        type: 'scene-change',
        summary: change.summary || change.type,
        data: change
      });
    }
  }

  return items.sort((a,b)=>b.priority-a.priority).slice(0,12);
}

export function worldStateSnapshot(state) {
  return JSON.parse(JSON.stringify(state));
}
