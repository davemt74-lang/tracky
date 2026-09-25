import {
  areRoomsAdjacent,
  portalForTransition,
  shortestRoomPath
} from './room-topology-core.js';

export const PRESENCE_STATES = Object.freeze([
  'confirmed',
  'transitioning',
  'last-known',
  'uncertain',
  'absent'
]);

const TRANSITION_WINDOW_MS = 15000;
const ABSENT_AFTER_MS = 60000;

export function createMultiRoomWorld() {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    rooms: {},
    participants: {},
    objects: {},
    transitions: [],
    conversations: {},
    topologyProposals: [],
    objectAliases: {}
  };
}

function entityKey(entity) {
  return entity.participantId ? 'PERSON:' + entity.participantId : entity.id;
}

function appendTransition(state, transition, limit = 200) {
  state.transitions.push(transition);
  if (state.transitions.length > limit) {
    state.transitions.splice(0, state.transitions.length - limit);
  }
  return transition;
}


function recordTopologyProposal(state, input) {
  const key = [input.fromRoomId, input.toRoomId].sort().join('::');
  let proposal = state.topologyProposals.find((item) => item.key === key);
  if (!proposal) {
    proposal = {
      key,
      fromRoomId: input.fromRoomId,
      toRoomId: input.toRoomId,
      observedTransitionCount: 0,
      confidence: 0,
      lastObservedAt: 0,
      userConfirmed: false
    };
    state.topologyProposals.push(proposal);
  }

  proposal.observedTransitionCount += 1;
  proposal.confidence = Math.min(
    0.92,
    Math.max(
      proposal.confidence,
      Number(input.confidence || 0) * Math.min(1, proposal.observedTransitionCount / 3)
    )
  );
  proposal.lastObservedAt = input.timestamp;
  proposal.readyForConfirmation =
    proposal.observedTransitionCount >= 3 &&
    proposal.confidence >= 0.72;
  return proposal;
}

export function reconcileParticipantLocations(state, roomStates, topology, now = Date.now()) {
  const observations = new Map();

  for (const [roomId, roomState] of Object.entries(roomStates || {})) {
    for (const entity of roomState?.participants || []) {
      if (entity.status === 'last-known') continue;
      const key = entityKey(entity);
      if (!observations.has(key)) observations.set(key, []);
      observations.get(key).push({ roomId, entity });
    }
  }

  const events = [];
  const seen = new Set();

  for (const [key, candidates] of observations) {
    seen.add(key);
    const known = candidates[0].entity.participantId != null;
    const sorted = [...candidates].sort((a,b) => b.entity.confidence - a.entity.confidence);
    const best = sorted[0];
    const previous = state.participants[key];

    if (sorted.length > 1) {
      const distinctRooms = new Set(sorted.map((item) => item.roomId));
      if (distinctRooms.size > 1) {
        state.participants[key] = {
          ...previous,
          id: key,
          participantId: best.entity.participantId || null,
          participantName: best.entity.participantName || best.entity.id,
          roomId: null,
          candidateRoomIds: [...distinctRooms],
          presence: 'uncertain',
          confidence: Math.min(0.49, best.entity.confidence),
          lastObservedAt: now,
          identityAuthority: known ? 'enrolled-participant' : 'anonymous',
          localRoomEntityId: best.entity.id
        };
        events.push({
          type: 'participant.location_uncertain',
          participantId: best.entity.participantId || null,
          participantName: best.entity.participantName || best.entity.id,
          candidateRoomIds: [...distinctRooms],
          confidence: state.participants[key].confidence
        });
        continue;
      }
    }

    const roomId = best.roomId;
    const previousRoomId = previous?.roomId || previous?.lastKnownRoomId || null;
    const changedRoom = previousRoomId && previousRoomId !== roomId;

    let presence = 'confirmed';
    let confidence = best.entity.confidence;
    let transition = null;

    if (changedRoom) {
      const age = now - Number(previous?.lastObservedAt || 0);
      const adjacent = areRoomsAdjacent(topology, previousRoomId, roomId);
      const path = shortestRoomPath(topology, previousRoomId, roomId);
      const portal = adjacent ? portalForTransition(topology, previousRoomId, roomId) : null;

      if (known && adjacent && age <= TRANSITION_WINDOW_MS) {
        presence = 'confirmed';
        confidence = Math.min(1, (confidence + Number(portal?.connection?.confidence || 0.7)) / 2);
        transition = {
          id: 'PT-' + now + '-' + key.replace(/[^a-zA-Z0-9]/g,''),
          type: 'participant.room_transition',
          participantId: best.entity.participantId,
          participantName: best.entity.participantName || null,
          fromRoomId: previousRoomId,
          toRoomId: roomId,
          portalId: portal?.fromPortal?.id || null,
          path,
          confidence,
          timestamp: now
        };
      } else if (known && path.length > 1 && age <= TRANSITION_WINDOW_MS * Math.max(1, path.length - 1)) {
        presence = 'transitioning';
        confidence *= 0.7;
        transition = {
          id: 'PT-' + now + '-' + key.replace(/[^a-zA-Z0-9]/g,''),
          type: 'participant.room_transition',
          participantId: best.entity.participantId,
          participantName: best.entity.participantName || null,
          fromRoomId: previousRoomId,
          toRoomId: roomId,
          portalId: null,
          path,
          confidence,
          timestamp: now,
          inferredPath: true
        };
      } else {
        presence = 'uncertain';
        confidence = Math.min(0.58, confidence);
        if (known && age <= TRANSITION_WINDOW_MS && !path.length) {
          recordTopologyProposal(state, {
            fromRoomId: previousRoomId,
            toRoomId: roomId,
            confidence: best.entity.confidence,
            timestamp: now
          });
        }
        events.push({
          type: 'participant.location_uncertain',
          participantId: best.entity.participantId || null,
          participantName: best.entity.participantName || best.entity.id,
          fromRoomId: previousRoomId,
          candidateRoomIds: [roomId],
          confidence
        });
      }
    }

    state.participants[key] = {
      id: key,
      participantId: best.entity.participantId || null,
      participantName: best.entity.participantName || best.entity.id,
      roomId,
      lastKnownRoomId: roomId,
      presence,
      confidence,
      roomPosition: best.entity.roomPosition,
      cameraIds: best.entity.cameraIds || [],
      lastObservedAt: now,
      firstObservedAt: previous?.firstObservedAt || now,
      identityAuthority: known ? 'enrolled-participant' : 'anonymous',
      localRoomEntityId: best.entity.id
    };

    if (!previous || previous.presence === 'absent') {
      events.push({
        type: 'participant.room_enter',
        participantId: best.entity.participantId || null,
        participantName: best.entity.participantName || best.entity.id,
        roomId,
        confidence
      });
    }

    if (transition) {
      appendTransition(state, transition);
      events.push({
        type: 'participant.room_exit',
        participantId: transition.participantId,
        participantName: transition.participantName,
        roomId: transition.fromRoomId,
        confidence: transition.confidence
      });
      events.push(transition);
      events.push({
        type: 'participant.room_enter',
        participantId: transition.participantId,
        participantName: transition.participantName,
        roomId: transition.toRoomId,
        confidence: transition.confidence
      });
    }
  }

  for (const [key, participant] of Object.entries(state.participants)) {
    if (seen.has(key)) continue;
    const age = now - Number(participant.lastObservedAt || 0);
    participant.presence = age > ABSENT_AFTER_MS ? 'absent' : 'last-known';
    participant.confidence = participant.presence === 'absent'
      ? 0.15
      : Math.max(0.2, participant.confidence * 0.9);
  }

  return events;
}

function flattenRoomObjects(roomStates = {}) {
  const result = [];
  for (const [roomId, room] of Object.entries(roomStates)) {
    for (const object of room?.objects || []) {
      if (object.status === 'last-known') continue;
      result.push({roomId, object});
    }
  }
  return result;
}

function recentParticipantTransition(state, participantId, now) {
  return [...state.transitions].reverse().find((transition) => (
    transition.type === 'participant.room_transition' &&
    transition.participantId === participantId &&
    now - transition.timestamp <= TRANSITION_WINDOW_MS
  )) || null;
}

export function reconcileObjectLocations(state, roomStates, options = {}, now = Date.now()) {
  const observations = flattenRoomObjects(roomStates);
  const events = [];
  const seenIds = new Set();

  for (const { roomId, object } of observations) {
    const aliasKey = roomId + ':' + object.id;
    let key = state.objectAliases[aliasKey] || object.id;
    let previous = state.objects[key];

    if (!previous && options.custodyByLocalObjectId) {
      const custody = options.custodyByLocalObjectId[roomId + ':' + object.id];
      if (custody?.participantId) {
        const transition = recentParticipantTransition(state, custody.participantId, now);
        if (transition?.toRoomId === roomId) {
          const candidate = Object.values(state.objects).find((item) => (
            item.label === object.label &&
            item.holderParticipantId === custody.participantId &&
            item.roomId === transition.fromRoomId &&
            now - Number(item.lastObservedAt || 0) <= TRANSITION_WINDOW_MS
          ));
          if (candidate) {
            key = candidate.id;
            previous = candidate;
            state.objectAliases[aliasKey] = key;
          }
        }
      }
    }

    seenIds.add(key);
    state.objectAliases[aliasKey] = key;
    const custody = options.custodyByLocalObjectId?.[roomId + ':' + object.id] || null;
    const changedRoom = previous?.roomId && previous.roomId !== roomId;

    state.objects[key] = {
      id: key,
      label: object.label,
      roomId,
      lastKnownRoomId: roomId,
      presence: 'confirmed',
      confidence: object.confidence,
      roomPosition: object.roomPosition,
      cameraIds: object.cameraIds || [],
      holderParticipantId: custody?.participantId || previous?.holderParticipantId || null,
      localRoomObjectId: object.id,
      lastObservedAt: now,
      firstObservedAt: previous?.firstObservedAt || now
    };

    if (changedRoom && previous) {
      const holderTransition = state.objects[key].holderParticipantId
        ? recentParticipantTransition(state, state.objects[key].holderParticipantId, now)
        : null;
      const adjacent = areRoomsAdjacent(options.topology, previous.roomId, roomId);

      if (holderTransition || adjacent) {
        const transition = {
          id: 'OT-' + now + '-' + key.replace(/[^a-zA-Z0-9]/g,''),
          type: 'object.room_transition',
          objectId: key,
          objectLabel: object.label,
          fromRoomId: previous.roomId,
          toRoomId: roomId,
          holderParticipantId: state.objects[key].holderParticipantId,
          confidence: holderTransition
            ? Math.min(1, (object.confidence + holderTransition.confidence) / 2)
            : object.confidence * 0.72,
          timestamp: now
        };
        appendTransition(state, transition);
        events.push({type:'object.room_exit',objectId:key,roomId:previous.roomId,confidence:transition.confidence});
        events.push(transition);
        events.push({type:'object.room_enter',objectId:key,roomId,confidence:transition.confidence});
      }
    }
  }

  for (const [id, object] of Object.entries(state.objects)) {
    if (seenIds.has(id)) continue;
    const age = now - Number(object.lastObservedAt || 0);
    object.presence = age > ABSENT_AFTER_MS ? 'absent' : 'last-known';
    object.confidence = object.presence === 'absent'
      ? 0.12
      : Math.max(0.18, object.confidence * 0.9);
  }

  return events;
}

export function updateRoomConversations(state, roomSnapshots = {}, now = Date.now()) {
  const active = {};
  for (const [roomId, snapshot] of Object.entries(roomSnapshots)) {
    for (const group of snapshot?.conversationGroups || []) {
      const id = roomId + ':' + group.id;
      active[id] = {
        id,
        roomId,
        groupId: group.id,
        participantIds: group.participantIds || [],
        trackIds: group.trackIds || [],
        updatedAt: now
      };
    }
  }
  state.conversations = active;
  return active;
}

export function updateMultiRoomWorld(state, input = {}, now = Date.now()) {
  state.updatedAt = now;
  state.rooms = {};

  for (const room of input.rooms || []) {
    state.rooms[room.id] = {
      id: room.id,
      name: room.name || room.id,
      userConfirmed: room.userConfirmed === true,
      cameraIds: (input.cameras || [])
        .filter((camera) => camera.roomId === room.id && camera.enabled)
        .map((camera) => camera.id)
    };
  }

  const events = [
    ...reconcileParticipantLocations(state, input.roomFusionStates || {}, input.topology, now),
    ...reconcileObjectLocations(state, input.roomFusionStates || {}, {
      topology: input.topology,
      custodyByLocalObjectId: input.custodyByLocalObjectId || {}
    }, now)
  ];

  updateRoomConversations(state, input.roomSnapshots || {}, now);
  return events;
}

export function multiRoomSnapshot(state) {
  return JSON.parse(JSON.stringify({
    schemaVersion: state.schemaVersion,
    updatedAt: state.updatedAt,
    rooms: state.rooms,
    participants: state.participants,
    objects: state.objects,
    transitions: state.transitions.slice(-50),
    conversations: state.conversations,
    topologyProposals: state.topologyProposals,
    objectAliases: state.objectAliases
  }));
}
