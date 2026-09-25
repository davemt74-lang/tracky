const ACTIVE_STATES = new Set(['candidate','verifying','confirmed']);

export const AWARENESS_TYPES = Object.freeze([
  'unknown-environment',
  'uncertain-environment',
  'camera-pose-shift',
  'structural-drift',
  'world-contradiction',
  'expected-location-deviation',
  'expected-object-missing',
  'watched-entity-missing',
  'camera-degraded'
]);

export function defaultAwarenessPolicy() {
  return {
    enabled: true,
    minConfirmations: 3,
    minVerifyMs: 1600,
    clearGraceMs: 3200,
    incidentRetention: 200,
    speakHighSeverity: false,
    notifyNewObjects: false,
    watchedEntityIds: [],
    watchedRoomIds: [],
    disabledTypes: []
  };
}

export function createAwarenessState() {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    incidents: {},
    recent: [],
    suppressions: {},
    lastVerificationRequestAt: {}
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function severityRank(value) {
  return {info:1,warning:2,high:3,critical:4}[value] || 1;
}

export function anomalyKey(type, subjectId = '', roomId = '') {
  return [type, subjectId || 'WORLD', roomId || ''].join('::');
}

function candidate(input) {
  return {
    type: input.type,
    key: input.key || anomalyKey(input.type, input.subjectId, input.roomId),
    subjectId: input.subjectId || null,
    subjectLabel: input.subjectLabel || null,
    roomId: input.roomId || null,
    severity: input.severity || 'warning',
    confidence: clamp01(input.confidence ?? 0.5),
    summary: String(input.summary || input.type),
    evidence: input.evidence || {},
    source: input.source || 'awareness-engine',
    requestedEvidence: input.requestedEvidence || null
  };
}

function activeRoomObject(world, id) {
  return world?.objects?.[id] || null;
}

function currentTargetForObject(object, landmarksByRoom = {}) {
  if (!object?.roomId) return null;
  const landmarks = landmarksByRoom[object.roomId] || [];
  let best = null;
  let distance = Infinity;
  for (const landmark of landmarks) {
    const point = landmark.position || landmark.roomPosition;
    if (!point || !object.roomPosition) continue;
    const d = Math.hypot(
      Number(point.x || 0) - Number(object.roomPosition.x || 0),
      Number(point.y || 0) - Number(object.roomPosition.y || 0)
    );
    if (d < distance && d <= 0.22) {
      best = landmark;
      distance = d;
    }
  }
  return best?.id || ('ROOM:' + object.roomId);
}

function visibilityForObject(input, object) {
  if (!object?.lastKnownRoomId) return null;
  const room = input.roomVisibility?.[object.lastKnownRoomId];
  return room?.objects?.[object.localRoomObjectId || object.id] || null;
}

export function collectAwarenessCandidates(input = {}, now = Date.now()) {
  const policy = {...defaultAwarenessPolicy(), ...(input.policy || {})};
  if (!policy.enabled) return [];
  const disabled = new Set(policy.disabledTypes || []);
  const results = [];
  const push = (item) => {
    if (!disabled.has(item.type)) results.push(candidate(item));
  };

  const environment = input.environment || {};
  if (environment.classification === 'unknown') {
    push({
      type:'unknown-environment',
      severity:'high',
      confidence:Math.max(.65, 1 - Number(environment.best?.score || 0)),
      summary:'Current environment is not recognized.',
      roomId:environment.best?.roomId || null,
      evidence:{environment},
      requestedEvidence:'environment-refresh'
    });
  } else if (environment.classification === 'uncertain') {
    push({
      type:'uncertain-environment',
      severity:'warning',
      confidence:Math.max(.5, Number(environment.best?.score || 0)),
      summary:'Environment match remains uncertain.',
      roomId:environment.best?.roomId || null,
      evidence:{environment},
      requestedEvidence:'environment-refresh'
    });
  }

  if (environment.drift?.likelyCameraShift) {
    push({
      type:'camera-pose-shift',
      severity:'warning',
      confidence:Number(environment.drift.cameraPoseDrift || .6),
      summary:'Camera position appears to have shifted.',
      roomId:environment.best?.roomId || null,
      evidence:{drift:environment.drift},
      requestedEvidence:'environment-refresh'
    });
  } else if (Number(environment.drift?.structuralDrift || 0) >= .35) {
    push({
      type:'structural-drift',
      severity:'warning',
      confidence:Math.min(1,.55 + Number(environment.drift.structuralDrift || 0) * .45),
      summary:'Persistent room structure may have changed.',
      roomId:environment.best?.roomId || null,
      evidence:{drift:environment.drift},
      requestedEvidence:'environment-refresh'
    });
  }

  for (const contradiction of input.physicalWorld?.contradictions || []) {
    push({
      type:'world-contradiction',
      severity:'high',
      confidence:.96,
      subjectId:contradiction.subjectId,
      summary:'Physical-world evidence conflicts for ' + String(contradiction.subjectId || 'an entity') + '.',
      evidence:{contradiction}
    });
  }

  const confirmedExpectations = (input.spatialMemory?.proposals || [])
    .filter((proposal) => proposal.type === 'expected-location' && proposal.status === 'confirmed');

  for (const expectation of confirmedExpectations) {
    const object = activeRoomObject(input.multiRoom, expectation.subjectId);
    if (!object) continue;

    if (object.presence === 'confirmed') {
      const currentTarget = currentTargetForObject(object, input.landmarksByRoom || {});
      if (currentTarget && currentTarget !== expectation.targetId) {
        push({
          type:'expected-location-deviation',
          severity:(policy.watchedEntityIds || []).includes(expectation.subjectId)
            ? 'high'
            : 'warning',
          confidence:Math.min(
            1,
            Number(object.confidence || 0) * .65 +
            Number(expectation.confidence || 0) * .35
          ),
          subjectId:expectation.subjectId,
          subjectLabel:input.spatialMemory?.entities?.[expectation.subjectId]?.label || object.label,
          roomId:object.roomId,
          summary:(input.spatialMemory?.entities?.[expectation.subjectId]?.label || object.label || expectation.subjectId) +
            ' is away from its confirmed expected location.',
          evidence:{
            expected:{
              roomId:expectation.roomId,
              anchorId:expectation.anchorId,
              anchorLabel:expectation.anchorLabel,
              targetId:expectation.targetId
            },
            current:{
              roomId:object.roomId,
              targetId:currentTarget,
              position:object.roomPosition
            }
          }
        });
      }
    } else if (['last-known','absent'].includes(object.presence)) {
      const visibility = visibilityForObject(input, object);
      if (visibility?.state === 'missing-unexpected') {
        push({
          type:'expected-object-missing',
          severity:(policy.watchedEntityIds || []).includes(expectation.subjectId)
            ? 'high'
            : 'warning',
          confidence:Math.min(
            .95,
            Number(visibility.confidence || .7) * .6 +
            Number(expectation.confidence || .8) * .4
          ),
          subjectId:expectation.subjectId,
          subjectLabel:input.spatialMemory?.entities?.[expectation.subjectId]?.label || object.label,
          roomId:object.lastKnownRoomId,
          summary:(input.spatialMemory?.entities?.[expectation.subjectId]?.label || object.label || expectation.subjectId) +
            ' is not visible where it is expected.',
          evidence:{expected:expectation, visibility},
          requestedEvidence:'continued-visual-observation'
        });
      }
    }
  }

  const watched = new Set(policy.watchedEntityIds || []);
  for (const id of watched) {
    if (confirmedExpectations.some((item) => item.subjectId === id)) continue;
    const entity = input.multiRoom?.objects?.[id] || input.multiRoom?.participants?.[id];
    if (!entity || !['last-known','absent'].includes(entity.presence)) continue;
    const roomId = entity.lastKnownRoomId || entity.roomId;
    const visibility = input.roomVisibility?.[roomId]?.objects?.[entity.localRoomObjectId || id] ||
      input.roomVisibility?.[roomId]?.participants?.[entity.localRoomEntityId || id];
    if (visibility?.state !== 'missing-unexpected') continue;

    push({
      type:'watched-entity-missing',
      severity:'high',
      confidence:Number(visibility.confidence || .75),
      subjectId:id,
      subjectLabel:entity.label || entity.participantName || id,
      roomId,
      summary:(entity.label || entity.participantName || id) + ' is unexpectedly missing from camera coverage.',
      evidence:{visibility, lastKnownRoomId:roomId},
      requestedEvidence:'continued-visual-observation'
    });
  }

  for (const camera of input.cameras || []) {
    if (!camera.enabled || !camera.deviceId) continue;
    const status = input.cameraStatuses?.[camera.id] || 'offline';
    if (!['degraded','error'].includes(status)) continue;
    push({
      type:'camera-degraded',
      severity:'warning',
      confidence:status === 'error' ? .95 : .78,
      subjectId:camera.id,
      subjectLabel:camera.name || camera.id,
      roomId:camera.roomId,
      summary:(camera.name || camera.id) + ' perception is ' + status + '.',
      evidence:{cameraId:camera.id,status,roomId:camera.roomId}
    });
  }

  return results.sort((a,b) => (
    severityRank(b.severity) - severityRank(a.severity) ||
    b.confidence - a.confidence
  ));
}

function evidenceSignature(item) {
  return JSON.stringify({
    source:item.source,
    type:item.type,
    roomId:item.roomId,
    subjectId:item.subjectId,
    requestedEvidence:item.requestedEvidence,
    evidence:item.evidence
  }).slice(0,1800);
}

function appendObservation(record, item, now) {
  const signature = evidenceSignature(item);
  const previous = record.observations[record.observations.length - 1];
  if (previous?.signature === signature && now - previous.timestamp < 350) return;

  record.observations.push({
    timestamp:now,
    confidence:item.confidence,
    source:item.source,
    signature,
    evidence:item.evidence
  });
  if (record.observations.length > 20) record.observations.shift();
  record.confirmations += 1;
  record.confidenceSum += item.confidence;
}

function recentRecord(state, record) {
  state.recent.push({
    id:record.id,
    key:record.key,
    type:record.type,
    state:record.state,
    severity:record.severity,
    subjectId:record.subjectId,
    subjectLabel:record.subjectLabel,
    roomId:record.roomId,
    confidence:record.confidence,
    summary:record.summary,
    firstSeenAt:record.firstSeenAt,
    lastSeenAt:record.lastSeenAt,
    confirmedAt:record.confirmedAt || null,
    clearedAt:record.clearedAt || null,
    acknowledgedAt:record.acknowledgedAt || null
  });
  if (state.recent.length > 200) state.recent.shift();
}

export function processAwareness(state, candidates = [], policyInput = {}, now = Date.now()) {
  const policy = {...defaultAwarenessPolicy(), ...policyInput};
  state.updatedAt = now;
  const seen = new Set();
  const events = [];

  for (const item of candidates) {
    if (state.suppressions[item.key] && state.suppressions[item.key] > now) continue;
    seen.add(item.key);

    let record = state.incidents[item.key];
    if (!record || ['cleared','dismissed'].includes(record.state)) {
      record = {
        id:'AW-' + Math.random().toString(36).slice(2,10),
        key:item.key,
        type:item.type,
        state:'candidate',
        severity:item.severity,
        subjectId:item.subjectId,
        subjectLabel:item.subjectLabel,
        roomId:item.roomId,
        summary:item.summary,
        confidence:item.confidence,
        confirmations:0,
        confidenceSum:0,
        observations:[],
        firstSeenAt:now,
        lastSeenAt:now,
        lastCandidateAt:now,
        confirmedAt:null,
        clearedAt:null,
        acknowledgedAt:null,
        requestedEvidence:item.requestedEvidence
      };
      state.incidents[item.key] = record;
      events.push({type:'awareness.candidate',record:{...record}});
    }

    record.lastSeenAt = now;
    record.lastCandidateAt = now;
    record.summary = item.summary;
    record.severity = severityRank(item.severity) > severityRank(record.severity)
      ? item.severity
      : record.severity;
    record.requestedEvidence = item.requestedEvidence || record.requestedEvidence;
    appendObservation(record,item,now);
    record.confidence = record.confirmations
      ? clamp01(record.confidenceSum / record.confirmations)
      : item.confidence;

    if (record.state === 'candidate' && record.confirmations >= 2) {
      record.state = 'verifying';
      events.push({type:'awareness.verifying',record:{...record}});
    }

    const verificationAge = now - record.firstSeenAt;
    if (
      record.state !== 'confirmed' &&
      record.confirmations >= Math.max(1, Number(policy.minConfirmations || 3)) &&
      verificationAge >= Math.max(0, Number(policy.minVerifyMs || 1600))
    ) {
      record.state = 'confirmed';
      record.confirmedAt = now;
      events.push({type:'awareness.confirmed',record:{...record}});
    }
  }

  for (const [key, record] of Object.entries(state.incidents)) {
    if (!ACTIVE_STATES.has(record.state) || seen.has(key)) continue;
    const absentFor = now - Number(record.lastCandidateAt || record.lastSeenAt || now);
    if (absentFor < Number(policy.clearGraceMs || 3200)) continue;

    const wasConfirmed = record.state === 'confirmed';
    record.state = 'cleared';
    record.clearedAt = now;
    record.lastSeenAt = now;
    recentRecord(state,record);
    events.push({
      type:'awareness.cleared',
      record:{...record},
      wasConfirmed
    });
  }

  const entries = Object.values(state.incidents);
  if (entries.length > Number(policy.incidentRetention || 200)) {
    const removable = entries
      .filter((record) => !ACTIVE_STATES.has(record.state))
      .sort((a,b) => Number(a.lastSeenAt || 0) - Number(b.lastSeenAt || 0));
    const removeCount = entries.length - Number(policy.incidentRetention || 200);
    for (const record of removable.slice(0,removeCount)) {
      delete state.incidents[record.key];
    }
  }

  return events;
}

export function acknowledgeIncident(state, key, now = Date.now()) {
  const record = state.incidents[key];
  if (!record) return null;
  record.acknowledgedAt = now;
  return record;
}

export function dismissIncident(state, key, options = {}, now = Date.now()) {
  const record = state.incidents[key];
  if (!record) return null;
  record.state = 'dismissed';
  record.dismissedAt = now;
  record.lastSeenAt = now;
  const suppressMs = Math.max(0, Number(options.suppressMs || 10 * 60 * 1000));
  if (suppressMs) state.suppressions[key] = now + suppressMs;
  recentRecord(state,record);
  return record;
}

export function activeAwareness(state) {
  return Object.values(state.incidents)
    .filter((record) => ACTIVE_STATES.has(record.state))
    .sort((a,b) => (
      severityRank(b.severity) - severityRank(a.severity) ||
      Number(b.confidence || 0) - Number(a.confidence || 0)
    ));
}

export function confirmedAlerts(state) {
  return activeAwareness(state)
    .filter((record) => record.state === 'confirmed' && !record.acknowledgedAt);
}

export function verificationRequests(state, policyInput = {}, now = Date.now()) {
  const policy = {...defaultAwarenessPolicy(), ...policyInput};
  const requests = [];

  for (const record of activeAwareness(state)) {
    if (!record.requestedEvidence || record.state === 'confirmed') continue;
    const last = Number(state.lastVerificationRequestAt[record.key] || 0);
    if (last && now - last < 2500) continue;
    state.lastVerificationRequestAt[record.key] = now;
    requests.push({
      key:record.key,
      type:record.requestedEvidence,
      incidentType:record.type,
      subjectId:record.subjectId,
      roomId:record.roomId
    });
  }

  return requests;
}

export function awarenessSnapshot(state) {
  return JSON.parse(JSON.stringify({
    schemaVersion:state.schemaVersion,
    updatedAt:state.updatedAt,
    incidents:state.incidents,
    recent:state.recent.slice(-50),
    suppressions:state.suppressions
  }));
}
