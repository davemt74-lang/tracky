const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export const PORTAL_TYPES = Object.freeze([
  'doorway',
  'opening',
  'hallway',
  'stairs',
  'elevator',
  'passage',
  'unknown'
]);

export function normalizePortal(portal = {}, roomId = null, index = 0) {
  return {
    id: String(portal.id || 'PORTAL-' + String(index + 1).padStart(3, '0')),
    roomId: String(portal.roomId || roomId || ''),
    name: String(portal.name || 'Portal'),
    type: PORTAL_TYPES.includes(portal.type) ? portal.type : 'unknown',
    position: portal.position ? {
      x: clamp01(portal.position.x),
      y: clamp01(portal.position.y)
    } : null,
    connectsToRoomId: portal.connectsToRoomId || null,
    connectsToPortalId: portal.connectsToPortalId || null,
    confidence: clamp01(portal.confidence ?? 0.5),
    userConfirmed: portal.userConfirmed === true,
    enabled: portal.enabled !== false,
    source: portal.source || 'room-map'
  };
}

export function roomPortals(room) {
  return (room?.topology?.portals || room?.portals || [])
    .map((portal, index) => normalizePortal(portal, room.id, index))
    .filter((portal) => portal.enabled);
}

export function buildWorldTopology(rooms = []) {
  const roomMap = new Map(rooms.map((room) => [room.id, room]));
  const portals = [];
  const connections = [];
  const warnings = [];

  for (const room of rooms) {
    for (const portal of roomPortals(room)) {
      portals.push(portal);

      if (!portal.connectsToRoomId) continue;
      const targetRoom = roomMap.get(portal.connectsToRoomId);
      if (!targetRoom) {
        warnings.push({
          type: 'missing-target-room',
          portalId: portal.id,
          roomId: room.id,
          targetRoomId: portal.connectsToRoomId
        });
        continue;
      }

      const targetPortal = portal.connectsToPortalId
        ? roomPortals(targetRoom).find((candidate) => candidate.id === portal.connectsToPortalId)
        : null;

      const pairKey = [room.id, portal.connectsToRoomId].sort().join('::');
      if (!connections.some((connection) => connection.key === pairKey)) {
        connections.push({
          key: pairKey,
          roomA: room.id,
          roomB: portal.connectsToRoomId,
          portalA: portal.id,
          portalB: targetPortal?.id || null,
          confidence: portal.userConfirmed
            ? Math.max(0.98, portal.confidence)
            : portal.confidence,
          userConfirmed: portal.userConfirmed === true &&
            (targetPortal ? targetPortal.userConfirmed === true : false),
          bidirectional: Boolean(targetPortal?.connectsToRoomId === room.id)
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name || room.id,
      userConfirmed: room.userConfirmed === true,
      primaryViewId: room.primaryViewId || null
    })),
    portals,
    connections,
    warnings
  };
}

export function adjacentRooms(topology, roomId) {
  const result = [];
  for (const connection of topology?.connections || []) {
    if (connection.roomA === roomId) {
      result.push({ roomId: connection.roomB, connection });
    } else if (connection.roomB === roomId) {
      result.push({ roomId: connection.roomA, connection });
    }
  }
  return result;
}

export function areRoomsAdjacent(topology, roomA, roomB) {
  return adjacentRooms(topology, roomA).some((item) => item.roomId === roomB);
}

export function shortestRoomPath(topology, fromRoomId, toRoomId) {
  if (!fromRoomId || !toRoomId) return [];
  if (fromRoomId === toRoomId) return [fromRoomId];

  const queue = [[fromRoomId]];
  const visited = new Set([fromRoomId]);

  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];

    for (const { roomId } of adjacentRooms(topology, current)) {
      if (visited.has(roomId)) continue;
      const next = [...path, roomId];
      if (roomId === toRoomId) return next;
      visited.add(roomId);
      queue.push(next);
    }
  }

  return [];
}

export function portalForTransition(topology, fromRoomId, toRoomId) {
  const connection = (topology?.connections || []).find((item) => (
    (item.roomA === fromRoomId && item.roomB === toRoomId) ||
    (item.roomB === fromRoomId && item.roomA === toRoomId)
  ));
  if (!connection) return null;

  const fromPortalId = connection.roomA === fromRoomId
    ? connection.portalA
    : connection.portalB;
  const toPortalId = connection.roomA === fromRoomId
    ? connection.portalB
    : connection.portalA;

  return {
    connection,
    fromPortal: (topology.portals || []).find((portal) => portal.id === fromPortalId) || null,
    toPortal: (topology.portals || []).find((portal) => portal.id === toPortalId) || null
  };
}

export function proposeTopologyConnection(input = {}) {
  const confidence = clamp01(input.confidence ?? 0);
  const count = Math.max(0, Number(input.verifiedTransitionCount || 0));
  return {
    fromRoomId: input.fromRoomId || null,
    toRoomId: input.toRoomId || null,
    fromPortalId: input.fromPortalId || null,
    toPortalId: input.toPortalId || null,
    verifiedTransitionCount: count,
    confidence: clamp01(confidence * Math.min(1, count / 3)),
    readyForConfirmation: count >= 3 && confidence >= 0.72,
    userConfirmed: false
  };
}
