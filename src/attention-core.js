const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export const TASK_MODES = Object.freeze([
  'general',
  'find-object',
  'follow-participant',
  'conversation',
  'environment-watch',
  'mapping',
  'low-power'
]);

export const ATTENTION_STATES = Object.freeze([
  'pending',
  'active',
  'resolved',
  'dismissed',
  'expired'
]);

const DEFAULT_WEIGHTS = Object.freeze({
  contradiction: 1,
  privacy: 1,
  participant: 0.72,
  object: 0.68,
  conversation: 0.66,
  environment: 0.70,
  mapping: 0.64,
  memory: 0.60,
  system: 0.58
});

const TASK_WEIGHTS = Object.freeze({
  general: {},
  'find-object': { object: 1, memory: 0.88, participant: 0.45, conversation: 0.35 },
  'follow-participant': { participant: 1, conversation: 0.72, object: 0.42, environment: 0.55 },
  conversation: { conversation: 1, participant: 0.9, object: 0.3, environment: 0.42 },
  'environment-watch': { environment: 1, mapping: 0.8, object: 0.62, participant: 0.45 },
  mapping: { mapping: 1, environment: 0.92, participant: 0.38, object: 0.72 },
  'low-power': { system: 0.72, privacy: 1, contradiction: 1, participant: 0.45, object: 0.38, conversation: 0.4, environment: 0.52 }
});

export function normalizeTask(task = {}) {
  const mode = TASK_MODES.includes(task.mode) ? task.mode : 'general';
  return {
    id: String(task.id || 'task-' + Date.now()),
    mode,
    label: String(task.label || mode.replaceAll('-', ' ')),
    targetId: task.targetId || null,
    targetLabel: task.targetLabel || null,
    roomId: task.roomId || null,
    sticky: task.sticky === true,
    startedAt: Number(task.startedAt || Date.now()),
    expiresAt: task.expiresAt == null ? null : Number(task.expiresAt),
    status: task.status === 'paused' ? 'paused' : 'active',
    source: task.source || 'user'
  };
}

export function taskExpired(task, now = Date.now()) {
  return Boolean(task?.expiresAt && now >= task.expiresAt);
}

export function createAttentionState() {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    activeTask: normalizeTask({id:'task-general',mode:'general',label:'General awareness',source:'system'}),
    items: [],
    history: [],
    lastMeaningfulActivityAt: Date.now()
  };
}

export function setActiveTask(state, task, now = Date.now()) {
  const normalized = normalizeTask({...task, startedAt: task.startedAt || now});
  state.activeTask = normalized;
  state.updatedAt = now;
  return normalized;
}

export function clearActiveTask(state, now = Date.now()) {
  state.activeTask = normalizeTask({
    id:'task-general-' + now,
    mode:'general',
    label:'General awareness',
    source:'system',
    startedAt:now
  });
  state.updatedAt = now;
  return state.activeTask;
}

export function taskWeights(task = {}) {
  const mode = TASK_MODES.includes(task.mode) ? task.mode : 'general';
  return {...DEFAULT_WEIGHTS, ...(TASK_WEIGHTS[mode] || {})};
}

export function attentionCategory(item = {}) {
  const type = String(item.type || '');
  if (type.includes('contradiction') || type.includes('conflict')) return 'contradiction';
  if (type.includes('privacy')) return 'privacy';
  if (type.includes('participant') || type.includes('person')) return 'participant';
  if (type.includes('conversation') || type.includes('voice') || type.includes('speaker')) return 'conversation';
  if (type.includes('object') || type.includes('holding') || type.includes('missing')) return 'object';
  if (type.includes('environment') || type.includes('camera-pose') || type.includes('structural')) return 'environment';
  if (type.includes('mapping') || type.includes('calibration') || type.includes('topology')) return 'mapping';
  if (type.includes('memory') || type.includes('expected-location')) return 'memory';
  return item.category || 'system';
}

function targetBoost(item, task) {
  if (!task?.targetId && !task?.targetLabel) return 0;
  const haystack = JSON.stringify(item).toLowerCase();
  if (task.targetId && haystack.includes(String(task.targetId).toLowerCase())) return 0.22;
  if (task.targetLabel && haystack.includes(String(task.targetLabel).toLowerCase())) return 0.18;
  return 0;
}

export function scoreAttentionItem(item, task) {
  const category = attentionCategory(item);
  const weights = taskWeights(task);
  const base = clamp01(item.priority ?? item.confidence ?? 0.5);
  const weighted = clamp01(base * Number(weights[category] || 0.5) + targetBoost(item, task));
  return {
    ...item,
    category,
    taskPriority: weighted
  };
}

export function prioritizeAttention(items = [], task = {}) {
  return items
    .map((item) => scoreAttentionItem(item, task))
    .sort((a,b) => (
      b.taskPriority - a.taskPriority ||
      Number(b.priority || 0) - Number(a.priority || 0)
    ));
}

function itemKey(item) {
  return String(item.key || [
    item.type || item.category || 'attention',
    item.subjectId || item.participantId || item.objectId || '',
    item.targetId || item.roomId || item.summary || ''
  ].join('::'));
}

export function upsertAttentionItems(state, items = [], now = Date.now(), options = {}) {
  const ttlMs = Number(options.ttlMs || 30000);
  const byKey = new Map(state.items.map((item) => [item.key, item]));

  for (const candidate of prioritizeAttention(items, state.activeTask)) {
    const key = itemKey(candidate);
    const existing = byKey.get(key);
    if (existing) {
      Object.assign(existing, candidate, {
        key,
        state: existing.state === 'resolved' ? 'pending' : existing.state,
        lastSeenAt: now,
        expiresAt: now + ttlMs
      });
    } else {
      const record = {
        ...candidate,
        key,
        state: 'pending',
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + ttlMs
      };
      state.items.push(record);
      byKey.set(key, record);
    }
  }

  for (const item of state.items) {
    if (
      ['resolved','dismissed'].includes(item.state) &&
      now - Number(item.lastSeenAt || 0) > ttlMs
    ) {
      item.state = 'expired';
    } else if (
      item.state !== 'active' &&
      Number(item.expiresAt || Infinity) <= now
    ) {
      item.state = 'expired';
    }
  }

  state.items = state.items
    .filter((item) => item.state !== 'expired')
    .sort((a,b) => Number(b.taskPriority || 0) - Number(a.taskPriority || 0))
    .slice(0, 40);
  state.updatedAt = now;
  return state.items;
}

export function resolveAttentionItem(state, key, resolution = 'resolved', now = Date.now()) {
  const item = state.items.find((candidate) => candidate.key === key);
  if (!item) return null;
  item.state = resolution === 'dismissed' ? 'dismissed' : 'resolved';
  item.resolvedAt = now;
  state.history.push({...item});
  if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
  state.updatedAt = now;
  return item;
}

export function markMeaningfulActivity(state, now = Date.now()) {
  state.lastMeaningfulActivityAt = now;
  state.updatedAt = now;
}

export function privacyCaps(policy = {}) {
  return {
    visual: policy.allowVisualObservation !== false,
    identity: policy.allowVisualObservation !== false && policy.allowParticipantIdentity !== false,
    objects: policy.allowVisualObservation !== false && policy.allowObjectObservation !== false,
    behavior: policy.allowVisualObservation !== false && policy.allowBehaviorAnalysis !== false,
    audio: policy.allowRoomAudio !== false,
    voice: policy.allowRoomAudio !== false && policy.allowVoiceMatching !== false,
    transcription: policy.allowRoomAudio !== false && policy.allowLiveTranscription !== false,
    memory: policy.allowSpatialMemory !== false,
    environment: policy.allowVisualObservation !== false && policy.allowEnvironmentComparison !== false
  };
}

const MODE_BUDGETS = Object.freeze({
  general: { scanIntervalMs:550, secondaryIntervalMs:850, environmentCheckMs:60000, intensity:'balanced' },
  'find-object': { scanIntervalMs:300, secondaryIntervalMs:500, environmentCheckMs:45000, intensity:'high' },
  'follow-participant': { scanIntervalMs:325, secondaryIntervalMs:500, environmentCheckMs:60000, intensity:'high' },
  conversation: { scanIntervalMs:425, secondaryIntervalMs:700, environmentCheckMs:90000, intensity:'focused' },
  'environment-watch': { scanIntervalMs:700, secondaryIntervalMs:900, environmentCheckMs:15000, intensity:'focused' },
  mapping: { scanIntervalMs:300, secondaryIntervalMs:500, environmentCheckMs:10000, intensity:'high' },
  'low-power': { scanIntervalMs:1500, secondaryIntervalMs:2200, environmentCheckMs:180000, intensity:'low' }
});

export function computePerceptionBudget(input = {}) {
  const task = normalizeTask(input.task || {});
  const base = {...(MODE_BUDGETS[task.mode] || MODE_BUDGETS.general)};
  const activityAgeMs = Math.max(0, Number(input.activityAgeMs || 0));
  const caps = privacyCaps(input.policy || {});

  if (task.mode === 'general' && activityAgeMs > 30000) {
    base.scanIntervalMs = Math.max(base.scanIntervalMs, 900);
    base.secondaryIntervalMs = Math.max(base.secondaryIntervalMs, 1200);
    base.intensity = 'idle';
  }
  if (task.mode === 'general' && activityAgeMs > 120000) {
    base.scanIntervalMs = 1300;
    base.secondaryIntervalMs = 1800;
    base.environmentCheckMs = 120000;
    base.intensity = 'low';
  }

  return {
    ...base,
    capabilities: caps,
    taskMode: task.mode,
    targetId: task.targetId,
    targetLabel: task.targetLabel
  };
}

export function taskDerivedSignals(task, context = {}) {
  const normalized = normalizeTask(task || {});
  const signals = [];

  if (normalized.mode === 'find-object') {
    const objects = Object.values(context.multiRoom?.objects || {});
    const target = objects.find((object) => (
      (normalized.targetId && object.id === normalized.targetId) ||
      (normalized.targetLabel && String(object.label || '').toLowerCase() === String(normalized.targetLabel).toLowerCase())
    ));
    if (target?.presence === 'confirmed') {
      signals.push({
        type:'task.object-found',
        category:'object',
        priority:1,
        objectId:target.id,
        roomId:target.roomId,
        summary:(target.label || target.id) + ' found in ' + target.roomId
      });
    } else {
      const evidence = normalized.targetId
        ? context.expectedLocationEvidence?.[normalized.targetId]
        : null;
      signals.push({
        type:'task.object-search',
        category:'object',
        priority:0.88,
        objectId:normalized.targetId || null,
        roomId:evidence?.roomId || null,
        targetId:evidence?.anchorId || evidence?.targetId || null,
        summary:evidence
          ? 'Search expected location first'
          : 'Target object not currently confirmed'
      });
    }
  }

  if (normalized.mode === 'follow-participant') {
    const id = normalized.targetId
      ? 'PERSON:' + normalized.targetId.replace(/^PERSON:/,'')
      : null;
    const person = id ? context.multiRoom?.participants?.[id] : null;
    if (!person || ['uncertain','last-known','absent'].includes(person.presence)) {
      signals.push({
        type:'task.participant-continuity',
        category:'participant',
        priority:0.96,
        participantId:normalized.targetId,
        roomId:person?.lastKnownRoomId || null,
        summary:person
          ? 'Participant continuity requires reacquisition'
          : 'Target participant is not currently confirmed'
      });
    }
  }

  if (normalized.mode === 'conversation') {
    if (!context.policy?.allowRoomAudio || !context.policy?.allowLiveTranscription) {
      signals.push({
        type:'task.conversation-blocked',
        category:'privacy',
        priority:1,
        summary:'Conversation task is limited by room privacy policy'
      });
    } else if (!context.audioActive) {
      signals.push({
        type:'task.conversation-audio-off',
        category:'conversation',
        priority:0.82,
        summary:'Room audio is not enabled'
      });
    }
  }

  if (normalized.mode === 'environment-watch') {
    const drift = Number(context.environment?.drift?.environmentStateDrift || 0);
    if (drift >= 0.25) {
      signals.push({
        type:'task.environment-drift',
        category:'environment',
        priority:Math.min(1, 0.7 + drift * 0.3),
        summary:'Environment change deserves attention'
      });
    }
  }

  if (normalized.mode === 'mapping') {
    if (!context.mappingProposal) {
      signals.push({
        type:'task.mapping-needed',
        category:'mapping',
        priority:0.88,
        summary:'Capture or review an assisted room mapping proposal'
      });
    }
  }

  return signals;
}

export function attentionSnapshot(state) {
  return JSON.parse(JSON.stringify({
    schemaVersion:state.schemaVersion,
    updatedAt:state.updatedAt,
    activeTask:state.activeTask,
    items:state.items,
    history:state.history.slice(-50),
    lastMeaningfulActivityAt:state.lastMeaningfulActivityAt
  }));
}
