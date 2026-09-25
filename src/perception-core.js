export const PERCEPTION_EVENT_TYPES = Object.freeze([
  'participant.detected',
  'participant.recognized',
  'participant.entered',
  'participant.left',
  'participant.reacquired',
  'face.visible',
  'face.hidden',
  'face.capture_ready',
  'face.matched',
  'body.locked',
  'body.occluded',
  'body.reacquired',
  'behavior.changed',
  'attention.changed',
  'gesture.detected',
  'object.detected',
  'object.updated',
  'object.lost',
  'object.reacquired',
  'object.picked_up',
  'object.put_down',
  'interaction.started',
  'interaction.ended',
  'voice.activity_started',
  'voice.activity_stopped',
  'voice.matched',
  'conversation.started',
  'conversation.ended',
  'conversation.participant_joined',
  'conversation.participant_left',
  'transcript.turn',
  'room.state_changed',
  'sensor.status',
  'camera.status',
  'camera.handoff',
  'camera.overlap_fused',
  'environment.captured',
  'environment.matched',
  'environment.unknown',
  'environment.changed',
  'environment.mapping_updated',
  'world.attention',
  'participant.room_exit',
  'participant.room_enter',
  'participant.room_transition',
  'participant.location_uncertain',
  'object.room_exit',
  'object.room_enter',
  'object.room_transition',
  'portal.crossing',
  'world.topology_changed',
  'visibility.changed',
  'spatial_memory.proposed',
  'spatial_memory.confirmed',
  'spatial_memory.ignored',
  'privacy.policy_changed',
  'task.started',
  'task.cleared',
  'attention.updated',
  'attention.resolved',
  'perception.budget_changed',
  'anomaly.confirmed',
  'anomaly.cleared',
  'anomaly.acknowledged',
  'anomaly.dismissed',
  'proactive_awareness.updated'
]);

const KNOWN_TYPES = new Set(PERCEPTION_EVENT_TYPES);

export function createPerceptionEvent(type, payload = {}, options = {}) {
  if (!KNOWN_TYPES.has(type)) {
    throw new Error('Unknown perception event type: ' + type);
  }

  return {
    id: options.id || 'evt-' + Math.random().toString(36).slice(2, 10),
    type,
    timestamp: Number(options.timestamp ?? Date.now()),
    roomId: options.roomId || payload.roomId || 'default-room',
    participantId: payload.participantId || null,
    participantName: payload.participantName || null,
    trackId: payload.trackId || null,
    confidence: Number(payload.confidence || 0),
    source: payload.source || null,
    roomPosition: payload.roomPosition || null,
    nearbyParticipants: Array.from(payload.nearbyParticipants || []),
    conversationGroup: payload.conversationGroup || null,
    evidence: payload.evidence || null,
    data: payload.data || null
  };
}

export class PerceptionEventBus {
  constructor() {
    this.listeners = new Map();
    this.anyListeners = new Set();
  }

  subscribe(type, listener) {
    if (type === '*') {
      this.anyListeners.add(listener);
      return () => this.anyListeners.delete(listener);
    }

    if (!KNOWN_TYPES.has(type)) {
      throw new Error('Unknown perception event type: ' + type);
    }

    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  emit(type, payload = {}, options = {}) {
    const event = createPerceptionEvent(type, payload, options);
    for (const listener of this.listeners.get(type) || []) listener(event);
    for (const listener of this.anyListeners) listener(event);
    return event;
  }
}

export function createRoomState(roomId = 'default-room') {
  return {
    schemaVersion: 2,
    roomId,
    status: 'standby',
    updatedAt: Date.now(),
    participants: {},
    unknownTracks: {},
    objects: {},
    interactions: {},
    activeSpeaker: null,
    conversationGroups: {},
    recentEvents: [],
    transcript: [],
    sensors: {
      camera: 'offline',
      microphone: 'offline',
      identity: 'standby',
      objects: 'standby',
      hands: 'standby',
      voice: 'standby',
      transcription: 'standby'
    },
    health: {
      perception: 'standby',
      warnings: []
    },
    privacy: {
      mode: 'observe',
      regionCount: 0,
      identity: true,
      transcriptStorage: true,
      spatialMemory: true
    }
  };
}

function ensureParticipant(state, event) {
  const participantId = event.participantId;
  if (!participantId) return null;

  const current = state.participants[participantId] || {
    id: participantId,
    name: event.participantName || 'Participant',
    trackId: null,
    presence: 'unknown',
    faceVisible: false,
    bodyStatus: 'unknown',
    voiceStatus: 'quiet',
    voiceConfidence: 0,
    faceConfidence: 0,
    conversationGroup: null,
    position: null,
    nearbyParticipants: [],
    lastSeenAt: null,
    lastSpokeAt: null,
    behavior: null,
    attention: null,
    addressing: null,
    lastGesture: null
  };

  state.participants[participantId] = current;
  return current;
}

function ensureUnknownTrack(state, trackId, event) {
  if (!trackId) return null;

  const current = state.unknownTracks[trackId] || {
    trackId,
    presence: 'active',
    bodyStatus: 'detected',
    faceVisible: false,
    conversationGroup: null,
    position: null,
    nearbyParticipants: [],
    firstSeenAt: event.timestamp,
    lastSeenAt: event.timestamp,
    behavior: null,
    attention: null,
    addressing: null,
    lastGesture: null
  };

  state.unknownTracks[trackId] = current;
  return current;
}

function rememberEvent(state, event, maxEvents = 80) {
  if (event.type === 'object.updated') return;

  state.recentEvents.push(event);
  if (state.recentEvents.length > maxEvents) {
    state.recentEvents.splice(0, state.recentEvents.length - maxEvents);
  }
}

function updateLocation(entity, event) {
  if (!entity) return;
  if (event.roomPosition) entity.position = event.roomPosition;
  if (event.conversationGroup !== null) entity.conversationGroup = event.conversationGroup;
  if (event.nearbyParticipants?.length) {
    entity.nearbyParticipants = Array.from(event.nearbyParticipants);
  }
}

function pruneLostObjects(state, now, ttlMs = 60000) {
  for (const [objectId, object] of Object.entries(state.objects || {})) {
    if (
      object.status === 'lost' &&
      now - Number(object.lastSeenAt || 0) > ttlMs
    ) {
      delete state.objects[objectId];
    }
  }
}

export function applyPerceptionEvent(state, event) {
  if (!state || !event) return state;

  state.updatedAt = event.timestamp;
  pruneLostObjects(state, event.timestamp);
  state.status = 'active';
  rememberEvent(state, event);

  const participant = ensureParticipant(state, event);
  const unknown = !event.participantId
    ? ensureUnknownTrack(state, event.trackId, event)
    : null;

  if (participant) {
    if (event.participantName) participant.name = event.participantName;
    if (event.trackId) participant.trackId = event.trackId;
    participant.lastSeenAt = event.timestamp;
    updateLocation(participant, event);
    if (event.trackId) delete state.unknownTracks[event.trackId];
  }

  if (unknown) {
    unknown.lastSeenAt = event.timestamp;
    updateLocation(unknown, event);
  }

  switch (event.type) {
    case 'participant.detected':
    case 'participant.entered':
      if (participant) participant.presence = 'active';
      if (unknown) unknown.presence = 'active';
      break;

    case 'participant.recognized':
      if (participant) {
        participant.presence = 'active';
        participant.faceConfidence = Math.max(participant.faceConfidence || 0, event.confidence || 0);
      }
      break;

    case 'participant.left':
      if (participant) participant.presence = 'left';
      if (unknown) unknown.presence = 'left';
      break;

    case 'participant.reacquired':
      if (participant) participant.presence = 'active';
      if (unknown) unknown.presence = 'active';
      break;

    case 'face.visible':
      if (participant) participant.faceVisible = true;
      if (unknown) unknown.faceVisible = true;
      break;

    case 'face.hidden':
      if (participant) participant.faceVisible = false;
      if (unknown) unknown.faceVisible = false;
      break;

    case 'face.matched':
      if (participant) {
        participant.faceVisible = true;
        participant.faceConfidence = event.confidence;
      }
      break;

    case 'body.locked':
    case 'body.reacquired':
      if (participant) participant.bodyStatus = 'locked';
      if (unknown) unknown.bodyStatus = 'locked';
      break;

    case 'body.occluded':
      if (participant) participant.bodyStatus = 'occluded';
      if (unknown) unknown.bodyStatus = 'occluded';
      break;

    case 'behavior.changed': {
      const target = participant || unknown;
      if (target) {
        target.behavior = event.data?.behavior || null;
        target.addressing = event.data?.addressing || null;
      }
      break;
    }

    case 'attention.changed': {
      const target = participant || unknown;
      if (target) target.attention = event.data?.attention || null;
      break;
    }

    case 'gesture.detected': {
      const target = participant || unknown;
      if (target) {
        target.lastGesture = {
          type: event.data?.gesture || null,
          confidence: event.confidence,
          timestamp: event.timestamp
        };
      }
      break;
    }

    case 'object.detected':
    case 'object.updated':
    case 'object.reacquired': {
      const objectId = event.data?.objectId;
      if (!objectId) break;
      const current = state.objects[objectId] || {
        id: objectId,
        label: event.data?.label || 'object',
        firstSeenAt: event.timestamp,
        lastSeenAt: event.timestamp,
        status: 'tracked',
        score: 0,
        position: null,
        holderParticipantId: null,
        holderTrackId: null
      };
      current.label = event.data?.label || current.label;
      current.score = Number(event.confidence || current.score || 0);
      current.status = event.type === 'object.reacquired' ? 'tracked' : (event.data?.status || 'tracked');
      current.position = event.roomPosition || current.position;
      current.lastSeenAt = event.timestamp;
      state.objects[objectId] = current;
      break;
    }

    case 'object.lost': {
      const objectId = event.data?.objectId;
      if (objectId && state.objects[objectId]) {
        state.objects[objectId].status = 'lost';
        state.objects[objectId].lastSeenAt = event.timestamp;
      }
      break;
    }

    case 'object.picked_up': {
      const objectId = event.data?.objectId;
      if (objectId && state.objects[objectId]) {
        state.objects[objectId].holderParticipantId = event.participantId || null;
        state.objects[objectId].holderTrackId = event.trackId || null;
      }
      break;
    }

    case 'object.put_down': {
      const objectId = event.data?.objectId;
      if (objectId && state.objects[objectId]) {
        state.objects[objectId].holderParticipantId = null;
        state.objects[objectId].holderTrackId = null;
      }
      break;
    }

    case 'interaction.started': {
      const interactionId = event.data?.interactionId;
      if (!interactionId) break;
      state.interactions[interactionId] = {
        id: interactionId,
        type: event.data?.type || 'interaction',
        participantId: event.participantId || null,
        participantName: event.participantName || null,
        trackId: event.trackId || null,
        objectId: event.data?.objectId || null,
        objectLabel: event.data?.objectLabel || null,
        confidence: event.confidence,
        startedAt: event.timestamp,
        updatedAt: event.timestamp,
        evidence: event.evidence || null
      };
      break;
    }

    case 'interaction.ended': {
      const interactionId = event.data?.interactionId;
      if (interactionId) delete state.interactions[interactionId];
      break;
    }

    case 'voice.activity_started':
      state.activeSpeaker = {
        participantId: event.participantId,
        participantName: event.participantName,
        trackId: event.trackId,
        confidence: event.confidence,
        conversationGroup: event.conversationGroup,
        startedAt: event.timestamp
      };
      if (participant) {
        participant.voiceStatus = 'speaking';
        participant.voiceConfidence = event.confidence;
        participant.lastSpokeAt = event.timestamp;
      }
      break;

    case 'voice.activity_stopped':
      if (
        state.activeSpeaker &&
        (
          state.activeSpeaker.participantId === event.participantId ||
          state.activeSpeaker.trackId === event.trackId
        )
      ) {
        state.activeSpeaker = null;
      }
      if (participant) participant.voiceStatus = 'quiet';
      break;

    case 'voice.matched':
      if (participant) participant.voiceConfidence = event.confidence;
      break;

    case 'conversation.started':
      if (event.conversationGroup) {
        const participantIds = Array.from(event.data?.participantIds || []);
        const trackIds = Array.from(event.data?.trackIds || []);
        state.conversationGroups[event.conversationGroup] = {
          id: event.conversationGroup,
          participantIds,
          trackIds,
          startedAt: event.timestamp,
          updatedAt: event.timestamp
        };

        for (const participantId of participantIds) {
          if (state.participants[participantId]) {
            state.participants[participantId].conversationGroup = event.conversationGroup;
          }
        }
        for (const trackId of trackIds) {
          if (state.unknownTracks[trackId]) {
            state.unknownTracks[trackId].conversationGroup = event.conversationGroup;
          }
        }
      }
      break;

    case 'conversation.ended':
      if (event.conversationGroup) {
        delete state.conversationGroups[event.conversationGroup];
      }
      for (const entity of Object.values(state.participants)) {
        if (entity.conversationGroup === event.conversationGroup) entity.conversationGroup = null;
      }
      for (const entity of Object.values(state.unknownTracks)) {
        if (entity.conversationGroup === event.conversationGroup) entity.conversationGroup = null;
      }
      break;

    case 'conversation.participant_joined': {
      const group = state.conversationGroups[event.conversationGroup];
      if (group) {
        if (event.participantId && !group.participantIds.includes(event.participantId)) {
          group.participantIds.push(event.participantId);
        }
        if (event.trackId && !group.trackIds.includes(event.trackId)) {
          group.trackIds.push(event.trackId);
        }
        group.updatedAt = event.timestamp;
      }
      break;
    }

    case 'conversation.participant_left': {
      const group = state.conversationGroups[event.conversationGroup];
      if (group) {
        group.participantIds = group.participantIds.filter((id) => id !== event.participantId);
        group.trackIds = group.trackIds.filter((id) => id !== event.trackId);
        group.updatedAt = event.timestamp;
      }
      if (event.participantId && state.participants[event.participantId]) {
        state.participants[event.participantId].conversationGroup = null;
      }
      if (event.trackId && state.unknownTracks[event.trackId]) {
        state.unknownTracks[event.trackId].conversationGroup = null;
      }
      break;
    }

    case 'transcript.turn':
      state.transcript.push({
        id: event.id,
        timestamp: event.timestamp,
        participantId: event.participantId,
        participantName: event.participantName,
        trackId: event.trackId,
        confidence: event.confidence,
        conversationGroup: event.conversationGroup,
        nearbyParticipants: Array.from(event.nearbyParticipants || []),
        text: String(event.data?.text || '')
      });
      if (state.transcript.length > 100) {
        state.transcript.splice(0, state.transcript.length - 100);
      }
      break;

    case 'privacy.policy_changed':
      state.privacy = {
        ...state.privacy,
        ...(event.data?.summary || {})
      };
      break;

    case 'sensor.status':
      if (event.data?.sensor && event.data?.status) {
        state.sensors[event.data.sensor] = event.data.status;
      }
      break;

    case 'room.state_changed':
      if (event.data?.status) state.status = event.data.status;
      if (event.data?.health) state.health.perception = event.data.health;
      break;

    default:
      break;
  }

  return state;
}

export function roomStateSnapshot(state) {
  return {
    schemaVersion: state.schemaVersion || 2,
    roomId: state.roomId,
    status: state.status,
    updatedAt: state.updatedAt,
    participants: Object.values(state.participants)
      .filter((participant) => participant.presence !== 'left')
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    unknownTracks: Object.values(state.unknownTracks)
      .filter((track) => track.presence !== 'left')
      .sort((a, b) => String(a.trackId).localeCompare(String(b.trackId))),
    objects: Object.values(state.objects)
      .filter((object) => object.status !== 'lost')
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    interactions: Object.values(state.interactions)
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    activeSpeaker: state.activeSpeaker,
    conversationGroups: Object.values(state.conversationGroups),
    recentEvents: state.recentEvents.slice(-30),
    transcript: state.transcript.slice(-30),
    sensors: { ...state.sensors },
    health: {
      perception: state.health.perception,
      warnings: Array.from(state.health.warnings || [])
    },
    privacy: { ...(state.privacy || {}) }
  };
}
