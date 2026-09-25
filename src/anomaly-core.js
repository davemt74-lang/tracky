const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export const ANOMALY_SEVERITIES = Object.freeze([
  'info',
  'low',
  'medium',
  'high',
  'critical'
]);

export const ANOMALY_TYPES = Object.freeze([
  'world-contradiction',
  'environment-unrecognized',
  'environment-structural-drift',
  'camera-pose-shift',
  'camera-quality-degraded',
  'expected-location-deviation',
  'expected-object-missing',
  'new-object-presence'
]);

const TYPE_RULES = Object.freeze({
  'world-contradiction': {
    minimumObservations: 1,
    persistenceMs: 0,
    clearGraceMs: 5000,
    severity: 'critical'
  },
  'environment-unrecognized': {
    minimumObservations: 2,
    persistenceMs: 5000,
    clearGraceMs: 20000,
    severity: 'medium'
  },
  'environment-structural-drift': {
    minimumObservations: 2,
    persistenceMs: 10000,
    clearGraceMs: 30000,
    severity: 'high'
  },
  'camera-pose-shift': {
    minimumObservations: 2,
    persistenceMs: 5000,
    clearGraceMs: 20000,
    severity: 'medium'
  },
  'camera-quality-degraded': {
    minimumObservations: 3,
    persistenceMs: 8000,
    clearGraceMs: 15000,
    severity: 'medium'
  },
  'expected-location-deviation': {
    minimumObservations: 3,
    persistenceMs: 5000,
    clearGraceMs: 10000,
    severity: 'medium'
  },
  'expected-object-missing': {
    minimumObservations: 3,
    persistenceMs: 12000,
    clearGraceMs: 15000,
    severity: 'high'
  },
  'new-object-presence': {
    minimumObservations: 4,
    persistenceMs: 20000,
    clearGraceMs: 15000,
    severity: 'low'
  }
});

const SEVERITY_PRIORITY = Object.freeze({
  info: 0.2,
  low: 0.4,
  medium: 0.62,
  high: 0.82,
  critical: 1
});

export function createAnomalyState() {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    candidates: {},
    active: {},
    history: [],
    suppressedUntil: {},
    stats: {
      confirmed: 0,
      cleared: 0,
      dismissed: 0
    }
  };
}

export function anomalyRule(type) {
  return {
    minimumObservations: 2,
    persistenceMs: 5000,
    clearGraceMs: 15000,
    severity: 'medium',
    ...(TYPE_RULES[type] || {})
  };
}

export function anomalySignature(signal = {}) {
  return [
    signal.type || 'anomaly',
    signal.subjectId || signal.objectId || signal.participantId || '',
    signal.roomId || '',
    signal.targetId || signal.expectedTargetId || ''
  ].join('::');
}

export function normalizeAnomalySignal(signal = {}, now = Date.now()) {
  const rule = anomalyRule(signal.type);
  return {
    type: ANOMALY_TYPES.includes(signal.type)
      ? signal.type
      : String(signal.type || 'world-contradiction'),
    signature: signal.signature || anomalySignature(signal),
    category: signal.category || (
      String(signal.type || '').includes('environment') ||
      String(signal.type || '').includes('camera')
        ? 'environment'
        : String(signal.type || '').includes('object') ||
          String(signal.type || '').includes('location')
          ? 'object'
          : 'system'
    ),
    severity: ANOMALY_SEVERITIES.includes(signal.severity)
      ? signal.severity
      : rule.severity,
    confidence: clamp01(signal.confidence ?? 0.5),
    priority: clamp01(
      signal.priority ??
      SEVERITY_PRIORITY[signal.severity || rule.severity] ??
      0.6
    ),
    summary: String(signal.summary || signal.type || 'Physical-world anomaly'),
    subjectId: signal.subjectId || signal.objectId || signal.participantId || null,
    objectId: signal.objectId || null,
    participantId: signal.participantId || null,
    roomId: signal.roomId || null,
    targetId: signal.targetId || null,
    expectedTargetId: signal.expectedTargetId || null,
    evidence: signal.evidence || null,
    observedAt: Number(signal.observedAt || now),
    rule
  };
}

function anomalyId(signature, timestamp) {
  let hash = 0;
  for (const char of signature) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return 'ANOM-' + Math.abs(hash).toString(36) + '-' + Number(timestamp).toString(36);
}

function boundedHistory(state, record, limit = 300) {
  state.history.push(record);
  if (state.history.length > limit) {
    state.history.splice(0, state.history.length - limit);
  }
}

export function observeAnomalySignals(state, signals = [], now = Date.now()) {
  const events = [];
  const seen = new Set();

  for (const raw of signals) {
    const signal = normalizeAnomalySignal(raw, now);
    const signature = signal.signature;
    seen.add(signature);

    if (Number(state.suppressedUntil[signature] || 0) > now) {
      continue;
    }

    const active = state.active[signature];
    if (active) {
      active.lastSeenAt = now;
      active.observations += 1;
      active.confidence = Math.max(active.confidence, signal.confidence);
      active.priority = Math.max(active.priority, signal.priority);
      active.summary = signal.summary;
      active.evidence = signal.evidence;
      continue;
    }

    const candidate = state.candidates[signature] || {
      id: anomalyId(signature, now),
      signature,
      type: signal.type,
      category: signal.category,
      severity: signal.severity,
      confidence: signal.confidence,
      priority: signal.priority,
      summary: signal.summary,
      subjectId: signal.subjectId,
      objectId: signal.objectId,
      participantId: signal.participantId,
      roomId: signal.roomId,
      targetId: signal.targetId,
      expectedTargetId: signal.expectedTargetId,
      evidence: signal.evidence,
      firstSeenAt: now,
      lastSeenAt: now,
      observations: 0,
      status: 'candidate',
      rule: signal.rule
    };

    candidate.lastSeenAt = now;
    candidate.observations += 1;
    candidate.confidence = Math.max(candidate.confidence, signal.confidence);
    candidate.priority = Math.max(candidate.priority, signal.priority);
    candidate.summary = signal.summary;
    candidate.evidence = signal.evidence;
    state.candidates[signature] = candidate;

    const persistentEnough =
      now - candidate.firstSeenAt >= candidate.rule.persistenceMs;
    if (
      candidate.observations >= candidate.rule.minimumObservations &&
      persistentEnough
    ) {
      candidate.status = 'active';
      candidate.confirmedAt = now;
      state.active[signature] = candidate;
      delete state.candidates[signature];
      state.stats.confirmed += 1;
      events.push({
        type: 'confirmed',
        anomaly: JSON.parse(JSON.stringify(candidate))
      });
    }
  }

  for (const [signature, candidate] of Object.entries(state.candidates)) {
    if (seen.has(signature)) continue;
    if (now - Number(candidate.lastSeenAt || 0) > 5000) {
      delete state.candidates[signature];
    }
  }

  for (const [signature, anomaly] of Object.entries(state.active)) {
    if (seen.has(signature)) continue;
    if (
      now - Number(anomaly.lastSeenAt || 0) >
      Number(anomaly.rule?.clearGraceMs || 15000)
    ) {
      const cleared = {
        ...anomaly,
        status: 'cleared',
        clearedAt: now
      };
      boundedHistory(state, cleared);
      delete state.active[signature];
      state.stats.cleared += 1;
      events.push({
        type: 'cleared',
        anomaly: JSON.parse(JSON.stringify(cleared))
      });
    }
  }

  state.updatedAt = now;
  return events;
}

export function acknowledgeAnomaly(state, signature, now = Date.now()) {
  const anomaly = state.active[signature];
  if (!anomaly) return null;
  anomaly.status = 'acknowledged';
  anomaly.acknowledgedAt = now;
  state.updatedAt = now;
  return anomaly;
}

export function dismissAnomaly(state, signature, now = Date.now(), suppressMs = 60 * 60 * 1000) {
  const anomaly = state.active[signature] || state.candidates[signature];
  if (!anomaly) return null;

  const dismissed = {
    ...anomaly,
    status: 'dismissed',
    dismissedAt: now
  };
  boundedHistory(state, dismissed);
  delete state.active[signature];
  delete state.candidates[signature];
  state.suppressedUntil[signature] = now + Math.max(0, Number(suppressMs || 0));
  state.stats.dismissed += 1;
  state.updatedAt = now;
  return dismissed;
}

function roomPolicyAllowsObject(context, roomId) {
  const policy = context.policies?.[roomId];
  return !policy || (
    policy.allowVisualObservation !== false &&
    policy.allowObjectObservation !== false
  );
}

function currentExpectedTarget(object, landmarks = []) {
  if (!object?.roomId) return null;
  if (!object.roomPosition) return 'ROOM:' + object.roomId;

  let best = null;
  let bestDistance = Infinity;
  for (const landmark of landmarks) {
    const point = landmark.position || landmark.roomPosition;
    if (!point) continue;
    const distance = Math.hypot(
      object.roomPosition.x - point.x,
      object.roomPosition.y - point.y
    );
    if (distance < bestDistance && distance <= 0.22) {
      best = landmark;
      bestDistance = distance;
    }
  }
  return best?.id || ('ROOM:' + object.roomId);
}

export function deriveAnomalySignals(context = {}, now = Date.now()) {
  const signals = [];

  for (const contradiction of context.physicalWorld?.contradictions || []) {
    signals.push({
      type: 'world-contradiction',
      severity: 'critical',
      confidence: 1,
      priority: 1,
      subjectId: contradiction.subjectId || null,
      roomId: contradiction.roomIds?.[0] || null,
      summary: 'Conflicting physical-world evidence requires resolution',
      evidence: contradiction
    });
  }

  const environment = context.environment;
  if (environment?.classification === 'unknown') {
    signals.push({
      type: 'environment-unrecognized',
      confidence: Math.max(0.55, 1 - Number(environment.best?.score || 0)),
      roomId: context.activeRoomId || null,
      summary: 'Current environment is not confidently recognized',
      evidence: {
        best: environment.best || null
      }
    });
  }

  const drift = environment?.drift;
  if (drift?.likelyCameraShift) {
    signals.push({
      type: 'camera-pose-shift',
      confidence: clamp01(drift.cameraPoseDrift || 0.5),
      roomId: context.activeRoomId || null,
      summary: 'Camera position appears persistently shifted',
      evidence: drift
    });
  } else if (Number(drift?.structuralDrift || 0) >= 0.35) {
    signals.push({
      type: 'environment-structural-drift',
      confidence: clamp01(0.55 + Number(drift.structuralDrift || 0) * 0.45),
      roomId: context.activeRoomId || null,
      summary: 'Environment structure differs from the confirmed baseline',
      evidence: drift
    });
  }

  const quality = context.currentEnvironment?.quality;
  if (quality && Number(quality.score || 0) < 0.22) {
    signals.push({
      type: 'camera-quality-degraded',
      confidence: clamp01(1 - Number(quality.score || 0)),
      roomId: context.activeRoomId || null,
      summary: 'Camera view quality is persistently degraded',
      evidence: quality
    });
  }

  for (const expected of context.confirmedExpectedLocations || []) {
    const object = context.multiRoom?.objects?.[expected.entityId] || null;
    if (!roomPolicyAllowsObject(context, expected.roomId)) continue;

    if (object?.presence === 'confirmed') {
      const currentTarget = currentExpectedTarget(
        object,
        context.landmarksByRoom?.[object.roomId] || []
      );
      const expectedTarget = expected.anchorId ||
        (expected.roomId ? 'ROOM:' + expected.roomId : null);

      const roomMismatch = Boolean(
        expected.roomId &&
        object.roomId &&
        expected.roomId !== object.roomId
      );
      const anchorMismatch = Boolean(
        !roomMismatch &&
        expected.anchorId &&
        currentTarget &&
        currentTarget !== expected.anchorId &&
        !String(currentTarget).startsWith('ROOM:')
      );

      if (roomMismatch || anchorMismatch) {
        signals.push({
          type: 'expected-location-deviation',
          severity: 'medium',
          confidence: clamp01(
            (Number(object.confidence || 0.5) +
              Number(expected.confidence || 0.8)) / 2
          ),
          objectId: object.id,
          subjectId: object.id,
          roomId: object.roomId,
          targetId: currentTarget,
          expectedTargetId: expectedTarget,
          summary: (object.label || object.id) +
            ' is away from its confirmed expected location',
          evidence: {
            expected,
            current: {
              roomId: object.roomId,
              targetId: currentTarget,
              presence: object.presence
            }
          }
        });
      }
      continue;
    }

    const lastKnown = object;
    const localId = lastKnown?.localRoomObjectId || expected.entityId;
    const visibility = context.roomVisibility?.[expected.roomId]?.objects?.[localId];
    if (
      ['last-known','absent'].includes(lastKnown?.presence) &&
      visibility?.state === 'missing-unexpected'
    ) {
      signals.push({
        type: 'expected-object-missing',
        severity: 'high',
        confidence: clamp01(
          (Number(lastKnown?.confidence || 0.5) +
            Number(visibility.confidence || 0.7) +
            Number(expected.confidence || 0.8)) / 3
        ),
        objectId: expected.entityId,
        subjectId: expected.entityId,
        roomId: expected.roomId,
        expectedTargetId: expected.anchorId || ('ROOM:' + expected.roomId),
        summary: (lastKnown?.label || expected.entityId) +
          ' is not visible where it is confirmed to be expected',
        evidence: {
          expected,
          visibility
        }
      });
    }
  }

  const knownView = environment?.classification === 'known-view';
  if (knownView && roomPolicyAllowsObject(context, context.activeRoomId)) {
    for (const change of context.sceneChanges || []) {
      if (
        change.type !== 'object.appeared' ||
        now - Number(change.timestamp || 0) > 60000
      ) continue;
      signals.push({
        type: 'new-object-presence',
        severity: 'low',
        confidence: clamp01(change.confidence || 0.6),
        objectId: change.objectId || null,
        subjectId: change.objectId || null,
        roomId: context.activeRoomId || null,
        summary: (change.objectLabel || 'A new object') +
          ' has remained in the known environment',
        evidence: {
          sceneChangeId: change.id,
          firstObservedAt: change.timestamp,
          zoneId: change.zoneId || null,
          zoneName: change.zoneName || null
        }
      });
    }
  }

  return signals;
}

export function anomalySnapshot(state) {
  return JSON.parse(JSON.stringify({
    schemaVersion: state.schemaVersion,
    updatedAt: state.updatedAt,
    active: Object.values(state.active)
      .sort((a,b) => b.priority - a.priority),
    candidates: Object.values(state.candidates),
    history: state.history.slice(-100),
    suppressedUntil: state.suppressedUntil,
    stats: state.stats
  }));
}

export function proactiveAwarenessSummary(state) {
  const active = Object.values(state.active);
  return {
    activeCount: active.length,
    critical: active.filter((item) => item.severity === 'critical').length,
    high: active.filter((item) => item.severity === 'high').length,
    medium: active.filter((item) => item.severity === 'medium').length,
    low: active.filter((item) => item.severity === 'low').length,
    top: active.sort((a,b) => b.priority - a.priority)[0] || null
  };
}
