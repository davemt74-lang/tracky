function pointInPolygon(point, polygon = []) {
  if (!point || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].x), yi = Number(polygon[i].y);
    const xj = Number(polygon[j].x), yj = Number(polygon[j].y);
    const intersects = (
      (yi > point.y) !== (yj > point.y) &&
      point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-9) + xi
    );
    if (intersects) inside = !inside;
  }
  return inside;
}

export function cameraCanSeePosition(camera, position) {
  if (!camera?.enabled || !position) return false;
  const polygon = camera.roomPoints || [];
  return pointInPolygon(position, polygon);
}

export function occluderContains(position, occluder) {
  if (!position || !occluder) return false;
  if (occluder.polygon) return pointInPolygon(position, occluder.polygon);
  if (occluder.x == null || occluder.y == null) return false;
  return (
    position.x >= occluder.x &&
    position.x <= occluder.x + Number(occluder.width || 0) &&
    position.y >= occluder.y &&
    position.y <= occluder.y + Number(occluder.height || 0)
  );
}

export function classifyVisibility(input = {}) {
  const cameras = (input.cameras || []).filter((camera) => camera.enabled);
  const online = cameras.filter((camera) => (
    !input.cameraStatuses ||
    ['online','starting'].includes(input.cameraStatuses[camera.id] || 'online')
  ));

  if (!input.position) {
    return {
      state: 'unknown-position',
      expectedCameraIds: [],
      confidence: 0.25
    };
  }

  const expected = online.filter((camera) => cameraCanSeePosition(camera, input.position));
  if (!expected.length) {
    return {
      state: online.length ? 'outside-coverage' : 'no-online-camera',
      expectedCameraIds: [],
      confidence: 0.92
    };
  }

  const observedBy = new Set(input.observedCameraIds || []);
  if (expected.some((camera) => observedBy.has(camera.id))) {
    return {
      state: 'visible',
      expectedCameraIds: expected.map((camera) => camera.id),
      confidence: 0.98
    };
  }

  const occluders = input.occluders || [];
  const blocked = occluders.some((occluder) => occluderContains(input.position, occluder));
  if (blocked) {
    return {
      state: 'expected-occlusion',
      expectedCameraIds: expected.map((camera) => camera.id),
      confidence: 0.72
    };
  }

  return {
    state: 'missing-unexpected',
    expectedCameraIds: expected.map((camera) => camera.id),
    confidence: 0.8
  };
}

export function visibilityOccludersFromGraph(graph = {}) {
  return (graph.nodes || Object.values(graph.nodes || {}))
    .filter((node) => (
      node.position &&
      node.properties?.occluder === true &&
      node.state !== 'expired'
    ))
    .map((node) => ({
      id: node.id,
      x: Math.max(0, node.position.x - Number(node.properties?.occlusionRadius || 0.08)),
      y: Math.max(0, node.position.y - Number(node.properties?.occlusionRadius || 0.08)),
      width: Number(node.properties?.occlusionRadius || 0.08) * 2,
      height: Number(node.properties?.occlusionRadius || 0.08) * 2
    }));
}
