const DEFAULT_LIMITS = Object.freeze({
  changes: 120,
  episodes: 120,
  objectMemoryMs: 15 * 60 * 1000,
  zoneCommitMs: 1200,
  activityCommitMs: 1400,
  objectMoveThreshold: 0.08,
  objectMoveCooldownMs: 1800
});

export const SCENE_CHANGE_TYPES = Object.freeze([
  'presence.entered',
  'presence.left',
  'location.changed',
  'activity.started',
  'activity.ended',
  'conversation.started',
  'conversation.ended',
  'object.appeared',
  'object.moved',
  'object.last_known',
  'object.returned',
  'object.picked_up',
  'object.put_down'
]);

const CHANGE_TYPES = new Set(SCENE_CHANGE_TYPES);

function id(prefix = 'scene') {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

export function normalizeZone(zone) {
  const x = clamp01(Number(zone?.x || 0));
  const y = clamp01(Number(zone?.y || 0));
  const width = Math.max(0.02, Math.min(1 - x, Number(zone?.width || 0.2)));
  const height = Math.max(0.02, Math.min(1 - y, Number(zone?.height || 0.2)));

  return {
    id: String(zone?.id || id('zone')),
    name: String(zone?.name || 'Zone').trim() || 'Zone',
    x,
    y,
    width,
    height,
    enabled: zone?.enabled !== false
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function pointInZone(position, zone) {
  if (!position || !zone?.enabled) return false;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  return (
    x >= zone.x &&
    x <= zone.x + zone.width &&
    y >= zone.y &&
    y <= zone.y + zone.height
  );
}

export function zoneForPosition(position, zones = []) {
  const matches = zones
    .filter((zone) => pointInZone(position, zone))
    .sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return matches[0] || null;
}

export function createSceneChange(type, payload = {}, timestamp = Date.now()) {
  if (!CHANGE_TYPES.has(type)) {
    throw new Error('Unknown scene change type: ' + type);
  }

  return {
    id: payload.id || id('chg'),
    type,
    timestamp: Number(timestamp),
    participantId: payload.participantId || null,
    participantName: payload.participantName || null,
    trackId: payload.trackId || null,
    objectId: payload.objectId || null,
    objectLabel: payload.objectLabel || null,
    zoneId: payload.zoneId || null,
    zoneName: payload.zoneName || null,
    conversationGroup: payload.conversationGroup || null,
    confidence: Number(payload.confidence || 0),
    summary: String(payload.summary || ''),
    evidence: payload.evidence || null,
    data: payload.data || null
  };
}

export function createSceneState(roomId = 'default-room', zones = []) {
  return {
    schemaVersion: 1,
    roomId,
    updatedAt: Date.now(),
    zones: zones.map(normalizeZone),
    participants: {},
    objects: {},
    conversations: {},
    activeEpisodes: {},
    episodes: [],
    changes: [],
    pending: {
      zones: {},
      activities: {}
    }
  };
}

export function deriveParticipantActivity(participant, snapshot) {
  const interactions = (snapshot?.interactions || [])
    .filter((interaction) => (
      interaction.participantId === participant.id ||
      interaction.trackId === participant.trackId
    ));

  const holding = interactions.find((interaction) => interaction.type === 'holding');
  if (holding) {
    return {
      key: 'holding:' + (holding.objectId || holding.objectLabel || 'object'),
      type: 'holding-object',
      label: 'holding ' + (holding.objectLabel || 'object'),
      confidence: Number(holding.confidence || 0),
      evidence: { interaction: holding }
    };
  }

  const pointing = interactions.find((interaction) => interaction.type === 'pointing-at');
  if (pointing) {
    return {
      key: 'pointing:' + (pointing.objectId || pointing.objectLabel || 'object'),
      type: 'pointing-at-object',
      label: 'pointing at ' + (pointing.objectLabel || 'object'),
      confidence: Number(pointing.confidence || 0),
      evidence: { interaction: pointing }
    };
  }

  if (participant.conversationGroup) {
    const group = (snapshot?.conversationGroups || [])
      .find((candidate) => candidate.id === participant.conversationGroup);
    if (group && (group.trackIds?.length || group.participantIds?.length || 0) >= 2) {
      return {
        key: 'conversation:' + group.id,
        type: 'conversing',
        label: 'in conversation ' + group.id,
        confidence: participant.voiceStatus === 'speaking' ? 0.9 : 0.72,
        evidence: { conversationGroup: group.id, speaking: participant.voiceStatus === 'speaking' }
      };
    }
  }

  const behavior = participant.behavior || {};
  if (behavior.motion === 'moving') {
    return {
      key: 'moving',
      type: 'moving',
      label: 'moving through room',
      confidence: Number(behavior.motionSpeed ? Math.min(1, behavior.motionSpeed * 3) : 0.62),
      evidence: { behavior }
    };
  }

  if (behavior.posture === 'sitting') {
    return {
      key: 'seated',
      type: 'seated',
      label: 'seated',
      confidence: Number(behavior.postureConfidence || 0.65),
      evidence: { behavior }
    };
  }

  if (behavior.motion === 'stationary') {
    return {
      key: 'stationary',
      type: 'stationary',
      label: 'stationary',
      confidence: 0.6,
      evidence: { behavior }
    };
  }

  return {
    key: 'present',
    type: 'present',
    label: 'present',
    confidence: 0.5,
    evidence: { behavior }
  };
}

function participantKey(participant) {
  return participant.id || participant.trackId;
}

function appendChange(state, change, limit = DEFAULT_LIMITS.changes) {
  state.changes.push(change);
  if (state.changes.length > limit) {
    state.changes.splice(0, state.changes.length - limit);
  }
  return change;
}

function appendEpisode(state, episode, limit = DEFAULT_LIMITS.episodes) {
  state.episodes.push(episode);
  if (state.episodes.length > limit) {
    state.episodes.splice(0, state.episodes.length - limit);
  }
}

function openEpisode(state, key, input, now) {
  const episode = {
    id: id('ep'),
    key,
    type: input.type,
    label: input.label,
    participantId: input.participantId || null,
    participantName: input.participantName || null,
    trackId: input.trackId || null,
    objectId: input.objectId || null,
    objectLabel: input.objectLabel || null,
    conversationGroup: input.conversationGroup || null,
    zoneId: input.zoneId || null,
    zoneName: input.zoneName || null,
    confidence: Number(input.confidence || 0),
    startedAt: now,
    updatedAt: now,
    endedAt: null,
    durationMs: null,
    evidence: input.evidence || null
  };
  state.activeEpisodes[key] = episode;
  return episode;
}

function closeEpisode(state, key, now) {
  const episode = state.activeEpisodes[key];
  if (!episode) return null;
  episode.endedAt = now;
  episode.updatedAt = now;
  episode.durationMs = Math.max(0, now - episode.startedAt);
  delete state.activeEpisodes[key];
  appendEpisode(state, { ...episode });
  return episode;
}

function commitZone(state, participant, zone, now, changes) {
  const key = participantKey(participant);
  const sceneParticipant = state.participants[key];
  const previousZoneId = sceneParticipant?.zoneId || null;
  const nextZoneId = zone?.id || null;
  if (previousZoneId === nextZoneId) return;

  if (sceneParticipant) {
    sceneParticipant.zoneId = nextZoneId;
    sceneParticipant.zoneName = zone?.name || null;
    sceneParticipant.zoneChangedAt = now;
  }

  changes.push(appendChange(state, createSceneChange('location.changed', {
    participantId: participant.id || null,
    participantName: participant.name || null,
    trackId: participant.trackId || null,
    zoneId: zone?.id || null,
    zoneName: zone?.name || null,
    confidence: 0.82,
    summary: participant.name + ' moved to ' + (zone?.name || 'unmapped room area'),
    evidence: {
      previousZoneId,
      nextZoneId,
      position: participant.position || null
    }
  }, now)));
}

function updateZoneCandidate(state, participant, zone, now, options, changes) {
  const key = participantKey(participant);
  const target = zone?.id || null;
  const current = state.participants[key]?.zoneId || null;
  if (target === current) {
    delete state.pending.zones[key];
    return;
  }

  const pending = state.pending.zones[key];
  if (!pending || pending.target !== target) {
    state.pending.zones[key] = { target, since: now };
    return;
  }

  if (now - pending.since >= options.zoneCommitMs) {
    commitZone(state, participant, zone, now, changes);
    delete state.pending.zones[key];
  }
}

function commitActivity(state, participant, activity, now, changes) {
  const key = participantKey(participant);
  const sceneParticipant = state.participants[key];
  const oldActivity = sceneParticipant?.activity || null;
  if (oldActivity?.key === activity.key) return;

  if (oldActivity) {
    const oldEpisodeKey = 'activity:' + key;
    const closed = closeEpisode(state, oldEpisodeKey, now);
    changes.push(appendChange(state, createSceneChange('activity.ended', {
      participantId: participant.id || null,
      participantName: participant.name || null,
      trackId: participant.trackId || null,
      confidence: oldActivity.confidence,
      summary: participant.name + ' stopped ' + oldActivity.label,
      evidence: closed?.evidence || oldActivity.evidence
    }, now)));
  }

  sceneParticipant.activity = activity;
  sceneParticipant.activityChangedAt = now;

  openEpisode(state, 'activity:' + key, {
    type: activity.type,
    label: activity.label,
    participantId: participant.id || null,
    participantName: participant.name || null,
    trackId: participant.trackId || null,
    confidence: activity.confidence,
    zoneId: sceneParticipant.zoneId,
    zoneName: sceneParticipant.zoneName,
    evidence: activity.evidence
  }, now);

  changes.push(appendChange(state, createSceneChange('activity.started', {
    participantId: participant.id || null,
    participantName: participant.name || null,
    trackId: participant.trackId || null,
    zoneId: sceneParticipant.zoneId,
    zoneName: sceneParticipant.zoneName,
    confidence: activity.confidence,
    summary: participant.name + ' is now ' + activity.label,
    evidence: activity.evidence
  }, now)));
}

function updateActivityCandidate(state, participant, activity, now, options, changes) {
  const key = participantKey(participant);
  const current = state.participants[key]?.activity?.key || null;
  if (activity.key === current) {
    delete state.pending.activities[key];
    return;
  }

  const pending = state.pending.activities[key];
  if (!pending || pending.key !== activity.key) {
    state.pending.activities[key] = { key: activity.key, activity, since: now };
    return;
  }

  if (now - pending.since >= options.activityCommitMs) {
    commitActivity(state, participant, activity, now, changes);
    delete state.pending.activities[key];
  }
}

function syncParticipants(state, snapshot, now, options, changes) {
  const activeKeys = new Set();

  for (const participant of snapshot.participants || []) {
    const key = participantKey(participant);
    if (!key) continue;
    activeKeys.add(key);

    const existing = state.participants[key];
    if (!existing || existing.presence === 'left') {
      state.participants[key] = {
        id: participant.id || null,
        name: participant.name || participant.trackId || 'Participant',
        trackId: participant.trackId || null,
        presence: 'active',
        enteredAt: now,
        leftAt: null,
        lastSeenAt: now,
        position: participant.position || null,
        zoneId: null,
        zoneName: null,
        activity: null,
        activityChangedAt: null
      };
      changes.push(appendChange(state, createSceneChange('presence.entered', {
        participantId: participant.id || null,
        participantName: participant.name || participant.trackId || 'Participant',
        trackId: participant.trackId || null,
        confidence: 0.95,
        summary: (participant.name || participant.trackId || 'Participant') + ' entered the scene',
        evidence: { presence: participant.presence }
      }, now)));
    } else {
      existing.presence = 'active';
      existing.lastSeenAt = now;
      existing.position = participant.position || existing.position;
      if (participant.name) existing.name = participant.name;
      if (participant.trackId) existing.trackId = participant.trackId;
    }

    const zone = zoneForPosition(participant.position, state.zones);
    updateZoneCandidate(state, participant, zone, now, options, changes);

    const activity = deriveParticipantActivity(participant, snapshot);
    updateActivityCandidate(state, participant, activity, now, options, changes);
  }

  for (const [key, participant] of Object.entries(state.participants)) {
    if (participant.presence !== 'active' || activeKeys.has(key)) continue;
    participant.presence = 'left';
    participant.leftAt = now;
    delete state.pending.zones[key];
    delete state.pending.activities[key];

    closeEpisode(state, 'activity:' + key, now);

    changes.push(appendChange(state, createSceneChange('presence.left', {
      participantId: participant.id,
      participantName: participant.name,
      trackId: participant.trackId,
      zoneId: participant.zoneId,
      zoneName: participant.zoneName,
      confidence: 0.95,
      summary: participant.name + ' left the scene',
      evidence: { lastPosition: participant.position }
    }, now)));
  }
}

function objectDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0));
}

function syncObjects(state, snapshot, now, options, changes) {
  const visibleIds = new Set();

  for (const object of snapshot.objects || []) {
    visibleIds.add(object.id);
    const current = state.objects[object.id];

    if (!current) {
      state.objects[object.id] = {
        id: object.id,
        label: object.label,
        status: 'visible',
        firstSeenAt: now,
        lastSeenAt: now,
        missingSince: null,
        lastKnownPosition: object.position || null,
        lastReportedPosition: object.position || null,
        lastMoveReportedAt: now,
        holderParticipantId: null
      };

      changes.push(appendChange(state, createSceneChange('object.appeared', {
        objectId: object.id,
        objectLabel: object.label,
        confidence: object.score,
        summary: object.label + ' appeared in the scene',
        evidence: { position: object.position }
      }, now)));
      continue;
    }

    const returned = current.status === 'last-known';
    current.status = 'visible';
    current.lastSeenAt = now;
    current.missingSince = null;
    if (returned) {
      changes.push(appendChange(state, createSceneChange('object.returned', {
        objectId: object.id,
        objectLabel: object.label,
        confidence: object.score,
        summary: object.label + ' returned to view',
        evidence: {
          previousPosition: current.lastKnownPosition,
          position: object.position
        }
      }, now)));
    }

    const distance = objectDistance(current.lastReportedPosition, object.position);
    if (
      distance >= options.objectMoveThreshold &&
      now - Number(current.lastMoveReportedAt || 0) >= options.objectMoveCooldownMs
    ) {
      changes.push(appendChange(state, createSceneChange('object.moved', {
        objectId: object.id,
        objectLabel: object.label,
        confidence: object.score,
        summary: object.label + ' moved',
        evidence: {
          from: current.lastReportedPosition,
          to: object.position,
          normalizedDistance: distance
        }
      }, now)));
      current.lastReportedPosition = object.position || current.lastReportedPosition;
      current.lastMoveReportedAt = now;
    }

    current.lastKnownPosition = object.position || current.lastKnownPosition;
  }

  for (const [objectId, object] of Object.entries(state.objects)) {
    if (visibleIds.has(objectId) || object.status === 'expired') continue;

    if (!object.missingSince) object.missingSince = now;

    if (object.status !== 'last-known') {
      object.status = 'last-known';
      changes.push(appendChange(state, createSceneChange('object.last_known', {
        objectId,
        objectLabel: object.label,
        confidence: 0.65,
        summary: object.label + ' is no longer visible; preserving last known position',
        evidence: { lastKnownPosition: object.lastKnownPosition }
      }, now)));
    }

    if (now - object.missingSince > options.objectMemoryMs) {
      object.status = 'expired';
    }
  }
}

function syncConversations(state, snapshot, now, changes) {
  const currentGroups = new Set();

  for (const group of snapshot.conversationGroups || []) {
    if (!group.id) continue;
    currentGroups.add(group.id);
    if (!state.conversations[group.id]) {
      state.conversations[group.id] = {
        id: group.id,
        startedAt: now,
        updatedAt: now,
        participantIds: [...(group.participantIds || [])],
        trackIds: [...(group.trackIds || [])]
      };
      openEpisode(state, 'conversation:' + group.id, {
        type: 'conversation',
        label: 'conversation ' + group.id,
        conversationGroup: group.id,
        confidence: 0.8,
        evidence: group
      }, now);
      changes.push(appendChange(state, createSceneChange('conversation.started', {
        conversationGroup: group.id,
        confidence: 0.8,
        summary: 'Conversation ' + group.id + ' started',
        evidence: group
      }, now)));
    } else {
      state.conversations[group.id].updatedAt = now;
      state.conversations[group.id].participantIds = [...(group.participantIds || [])];
      state.conversations[group.id].trackIds = [...(group.trackIds || [])];
    }
  }

  for (const [groupId, group] of Object.entries(state.conversations)) {
    if (currentGroups.has(groupId)) continue;
    closeEpisode(state, 'conversation:' + groupId, now);
    delete state.conversations[groupId];
    changes.push(appendChange(state, createSceneChange('conversation.ended', {
      conversationGroup: groupId,
      confidence: 0.8,
      summary: 'Conversation ' + groupId + ' ended',
      evidence: group
    }, now)));
  }
}

function syncPickupChanges(state, snapshot, now, changes) {
  const currentHolding = new Map(
    (snapshot.interactions || [])
      .filter((interaction) => interaction.type === 'holding')
      .map((interaction) => [interaction.objectId, interaction])
  );

  for (const [objectId, sceneObject] of Object.entries(state.objects)) {
    const holding = currentHolding.get(objectId);
    const previousHolder = sceneObject.holderParticipantId || null;
    const nextHolder = holding?.participantId || null;

    if (nextHolder && nextHolder !== previousHolder) {
      sceneObject.holderParticipantId = nextHolder;
      changes.push(appendChange(state, createSceneChange('object.picked_up', {
        participantId: holding.participantId,
        participantName: holding.participantName,
        trackId: holding.trackId,
        objectId,
        objectLabel: holding.objectLabel || sceneObject.label,
        confidence: holding.confidence,
        summary: (holding.participantName || holding.trackId || 'Participant') +
          ' picked up ' + (holding.objectLabel || sceneObject.label),
        evidence: holding.evidence
      }, now)));
    } else if (!nextHolder && previousHolder) {
      changes.push(appendChange(state, createSceneChange('object.put_down', {
        participantId: previousHolder,
        objectId,
        objectLabel: sceneObject.label,
        confidence: 0.78,
        summary: sceneObject.label + ' was put down',
        evidence: { previousHolder }
      }, now)));
      sceneObject.holderParticipantId = null;
    }
  }
}

export function updateSceneState(state, snapshot, now = Date.now(), overrides = {}) {
  const options = { ...DEFAULT_LIMITS, ...overrides };
  state.updatedAt = now;
  const changes = [];

  syncParticipants(state, snapshot, now, options, changes);
  syncObjects(state, snapshot, now, options, changes);
  syncConversations(state, snapshot, now, changes);
  syncPickupChanges(state, snapshot, now, changes);

  return changes;
}

export function sceneStateSnapshot(state) {
  return {
    schemaVersion: state.schemaVersion,
    roomId: state.roomId,
    updatedAt: state.updatedAt,
    zones: state.zones.map((zone) => ({ ...zone })),
    participants: Object.values(state.participants)
      .filter((participant) => participant.presence === 'active')
      .map((participant) => ({ ...participant })),
    objects: Object.values(state.objects)
      .filter((object) => object.status !== 'expired')
      .map((object) => ({ ...object })),
    conversations: Object.values(state.conversations).map((conversation) => ({ ...conversation })),
    activeEpisodes: Object.values(state.activeEpisodes).map((episode) => ({ ...episode })),
    recentEpisodes: state.episodes.slice(-30).map((episode) => ({ ...episode })),
    recentChanges: state.changes.slice(-40).map((change) => ({ ...change }))
  };
}

export function replaceSceneZones(state, zones) {
  state.zones = (zones || []).map(normalizeZone);
  state.pending.zones = {};
  return state.zones;
}
