const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export const ENVIRONMENT_MATCH = Object.freeze({
  KNOWN_VIEW: 'known-view',
  KNOWN_ROOM_NEW_VIEW: 'known-room-new-view',
  UNCERTAIN: 'uncertain',
  UNKNOWN: 'unknown'
});

export const LANDMARK_STABILITY = Object.freeze({
  STRUCTURAL: 'structural',
  STABLE: 'stable',
  TEMPORARY: 'temporary'
});

const STRUCTURAL_LABELS = new Set([
  'door','window','desk','table','couch','sofa','bed','bookshelf','shelf',
  'refrigerator','oven','sink','toilet','tv','monitor'
]);

const TEMPORARY_LABELS = new Set([
  'person','cup','bottle','cell phone','phone','book','laptop','remote',
  'backpack','handbag','umbrella'
]);

export function landmarkStability(label = '') {
  const normalized = String(label).toLowerCase();
  if (STRUCTURAL_LABELS.has(normalized)) return LANDMARK_STABILITY.STRUCTURAL;
  if (TEMPORARY_LABELS.has(normalized)) return LANDMARK_STABILITY.TEMPORARY;
  return LANDMARK_STABILITY.STABLE;
}

export function fingerprintImageData(imageData, options = {}) {
  const width = Number(imageData?.width || 0);
  const height = Number(imageData?.height || 0);
  const data = imageData?.data;
  const gridX = Math.max(4, Number(options.gridX || 12));
  const gridY = Math.max(3, Number(options.gridY || 8));
  if (!width || !height || !data?.length) {
    return { gridX, gridY, values: [], mean: 0, contrast: 0, edge: 0 };
  }

  const values = [];
  let sum = 0;
  let sumSq = 0;
  let edgeSum = 0;
  let edgeCount = 0;

  for (let gy = 0; gy < gridY; gy += 1) {
    for (let gx = 0; gx < gridX; gx += 1) {
      const x0 = Math.floor(gx * width / gridX);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * width / gridX));
      const y0 = Math.floor(gy * height / gridY);
      const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * height / gridY));
      let cell = 0;
      let count = 0;

      for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 6))) {
        for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 6))) {
          const index = (y * width + x) * 4;
          const luminance =
            Number(data[index] || 0) * 0.2126 +
            Number(data[index + 1] || 0) * 0.7152 +
            Number(data[index + 2] || 0) * 0.0722;
          cell += luminance;
          count += 1;
        }
      }

      const value = count ? cell / count / 255 : 0;
      values.push(value);
      sum += value;
      sumSq += value * value;
    }
  }

  for (let y = 1; y < height; y += Math.max(1, Math.floor(height / 40))) {
    for (let x = 1; x < width; x += Math.max(1, Math.floor(width / 60))) {
      const i = (y * width + x) * 4;
      const left = (y * width + (x - 1)) * 4;
      const up = ((y - 1) * width + x) * 4;
      const lum = Number(data[i] || 0) + Number(data[i + 1] || 0) + Number(data[i + 2] || 0);
      const lumLeft = Number(data[left] || 0) + Number(data[left + 1] || 0) + Number(data[left + 2] || 0);
      const lumUp = Number(data[up] || 0) + Number(data[up + 1] || 0) + Number(data[up + 2] || 0);
      edgeSum += Math.abs(lum - lumLeft) + Math.abs(lum - lumUp);
      edgeCount += 2;
    }
  }

  const mean = values.length ? sum / values.length : 0;
  const variance = values.length
    ? Math.max(0, sumSq / values.length - mean * mean)
    : 0;

  return {
    gridX,
    gridY,
    values: values.map((value) => Number(value.toFixed(5))),
    mean: Number(mean.toFixed(5)),
    contrast: Number(Math.sqrt(variance).toFixed(5)),
    edge: Number((edgeCount ? edgeSum / edgeCount / 765 : 0).toFixed(5))
  };
}

export function fingerprintSimilarity(a, b) {
  const av = a?.values || [];
  const bv = b?.values || [];
  if (!av.length || av.length !== bv.length) return 0;

  const meanA = av.reduce((sum, value) => sum + value, 0) / av.length;
  const meanB = bv.reduce((sum, value) => sum + value, 0) / bv.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < av.length; index += 1) {
    const va = av[index] - meanA;
    const vb = bv[index] - meanB;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const correlation = normA && normB
    ? (dot / Math.sqrt(normA * normB) + 1) / 2
    : 0.5;
  const edgeSimilarity = 1 - Math.min(1, Math.abs(Number(a.edge || 0) - Number(b.edge || 0)) * 4);
  const contrastSimilarity = 1 - Math.min(1, Math.abs(Number(a.contrast || 0) - Number(b.contrast || 0)) * 4);

  return clamp01(correlation * 0.72 + edgeSimilarity * 0.16 + contrastSimilarity * 0.12);
}

export function baselineQuality(metrics = {}) {
  const brightness = clamp01(1 - Math.abs(Number(metrics.mean ?? 0.5) - 0.5) / 0.5);
  const contrast = clamp01(Number(metrics.contrast || 0) / 0.18);
  const sharpness = clamp01(Number(metrics.edge || 0) / 0.09);
  const obstruction = clamp01(1 - Number(metrics.obstructionRatio || 0));
  const landmarkCoverage = clamp01(Number(metrics.landmarkCoverage ?? 0.5));

  return {
    score: clamp01(
      brightness * 0.20 +
      contrast * 0.20 +
      sharpness * 0.28 +
      obstruction * 0.17 +
      landmarkCoverage * 0.15
    ),
    brightness,
    contrast,
    sharpness,
    obstruction,
    landmarkCoverage
  };
}

export function normalizeLandmark(landmark, index = 0) {
  const position = landmark?.position || landmark?.roomPosition || {};
  return {
    id: String(landmark?.id || 'L' + String(index + 1).padStart(3, '0')),
    label: String(landmark?.label || 'object'),
    name: String(landmark?.name || landmark?.label || 'Landmark'),
    stability: landmark?.stability || landmarkStability(landmark?.label),
    position: {
      x: clamp01(position.x ?? 0.5),
      y: clamp01(position.y ?? 0.5)
    },
    confidence: clamp01(landmark?.confidence ?? landmark?.score ?? 0.5),
    userConfirmed: landmark?.userConfirmed === true,
    source: landmark?.source || 'vision'
  };
}

export function landmarkSimilarity(current = [], reference = []) {
  const currentItems = current.map(normalizeLandmark);
  const refItems = reference.map(normalizeLandmark);
  const stableRefs = refItems.filter((item) => item.stability !== LANDMARK_STABILITY.TEMPORARY);
  if (!stableRefs.length) return { score: 0.5, matches: [], missing: [] };

  const used = new Set();
  const matches = [];
  const missing = [];

  for (const ref of stableRefs) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < currentItems.length; index += 1) {
      if (used.has(index)) continue;
      const item = currentItems[index];
      if (item.label !== ref.label) continue;
      const distance = Math.hypot(
        item.position.x - ref.position.x,
        item.position.y - ref.position.y
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && bestDistance <= 0.28) {
      used.add(bestIndex);
      const weight = ref.userConfirmed ? 1.35 : ref.stability === LANDMARK_STABILITY.STRUCTURAL ? 1.2 : 1;
      matches.push({
        referenceId: ref.id,
        label: ref.label,
        distance: bestDistance,
        confidence: clamp01((1 - bestDistance / 0.28) * weight)
      });
    } else {
      missing.push(ref);
    }
  }

  const weighted = matches.reduce((sum, match) => sum + match.confidence, 0);
  return {
    score: clamp01(weighted / Math.max(1, stableRefs.length)),
    matches,
    missing
  };
}

export function compareEnvironment(current, view) {
  const visual = fingerprintSimilarity(current.fingerprint, view.fingerprint);
  const landmarks = landmarkSimilarity(current.landmarks || [], view.landmarks || []);
  const camera = current.cameraId && view.cameraId
    ? (current.cameraId === view.cameraId ? 1 : 0.55)
    : 0.65;
  const floor = current.floor?.confidence && view.floor?.confidence
    ? 1 - Math.min(1, Math.abs(current.floor.confidence - view.floor.confidence))
    : 0.6;

  const score = clamp01(
    visual * 0.43 +
    landmarks.score * 0.39 +
    camera * 0.10 +
    floor * 0.08
  );

  return {
    score,
    visual,
    landmarks: landmarks.score,
    camera,
    floor,
    landmarkMatches: landmarks.matches,
    missingLandmarks: landmarks.missing
  };
}

export function matchEnvironment(current, rooms = []) {
  const candidates = [];
  for (const room of rooms) {
    for (const view of room.views || []) {
      const evidence = compareEnvironment(current, view);
      candidates.push({
        roomId: room.id,
        roomName: room.name,
        viewId: view.id,
        viewName: view.name,
        evidence,
        score: evidence.score
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  const second = candidates[1] || null;
  const margin = best ? best.score - Number(second?.score || 0) : 0;

  let classification = ENVIRONMENT_MATCH.UNKNOWN;
  if (best && best.score >= 0.82 && margin >= 0.05) {
    classification = ENVIRONMENT_MATCH.KNOWN_VIEW;
  } else if (best && best.score >= 0.67) {
    classification = ENVIRONMENT_MATCH.KNOWN_ROOM_NEW_VIEW;
  } else if (best && best.score >= 0.52) {
    classification = ENVIRONMENT_MATCH.UNCERTAIN;
  }

  return { classification, best, second, margin, candidates };
}

export function environmentDrift(current, view) {
  const visual = fingerprintSimilarity(current.fingerprint, view.fingerprint);
  const landmark = landmarkSimilarity(current.landmarks || [], view.landmarks || []);
  const referenceLabels = new Set((view.landmarks || []).map((item) => item.label));
  const newLandmarks = (current.landmarks || [])
    .map(normalizeLandmark)
    .filter((item) => (
      item.stability !== LANDMARK_STABILITY.TEMPORARY &&
      !referenceLabels.has(item.label)
    ));

  return {
    structuralDrift: clamp01(1 - landmark.score),
    visualDrift: clamp01(1 - visual),
    environmentStateDrift: clamp01(
      (1 - visual) * 0.36 +
      (1 - landmark.score) * 0.49 +
      Math.min(1, newLandmarks.length / 5) * 0.15
    ),
    missingLandmarks: landmark.missing,
    newLandmarks,
    matchedLandmarks: landmark.matches
  };
}

export function suggestRoomMapping(objects = [], options = {}) {
  const landmarks = (objects || [])
    .filter((object) => (
      Number(object.confidence ?? object.score ?? 0) >= 0.45 &&
      landmarkStability(object.label) !== LANDMARK_STABILITY.TEMPORARY
    ))
    .map((object, index) => normalizeLandmark({
      ...object,
      id: object.id || 'L' + String(index + 1).padStart(3, '0'),
      source: 'mapping-scan'
    }, index));

  const zones = [];
  const portals = [];

  for (const landmark of landmarks) {
    const x = clamp01(landmark.position.x - 0.12);
    const y = clamp01(landmark.position.y - 0.12);
    const width = Math.min(0.3, 1 - x);
    const height = Math.min(0.3, 1 - y);

    if (landmark.label === 'door') {
      portals.push({
        id: 'PORTAL-' + landmark.id,
        name: landmark.name + ' portal',
        landmarkId: landmark.id,
        position: landmark.position,
        confidence: landmark.confidence,
        connectsToRoomId: null,
        userConfirmed: false
      });
      zones.push({
        id: 'ZONE-' + landmark.id,
        name: 'Doorway',
        x, y, width, height,
        kind: 'transition',
        confidence: landmark.confidence
      });
    } else if (['desk','table'].includes(landmark.label)) {
      zones.push({
        id: 'ZONE-' + landmark.id,
        name: landmark.label === 'desk' ? 'Desk Area' : 'Table Area',
        x, y, width, height,
        kind: 'work-surface',
        confidence: landmark.confidence
      });
    } else if (['couch','sofa'].includes(landmark.label)) {
      zones.push({
        id: 'ZONE-' + landmark.id,
        name: 'Couch Area',
        x, y, width, height,
        kind: 'seating',
        confidence: landmark.confidence
      });
    }
  }

  const floor = {
    method: 'visual-heuristic',
    polygon: [
      { x: 0.05, y: Number(options.floorTop ?? 0.48) },
      { x: 0.95, y: Number(options.floorTop ?? 0.48) },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ],
    confidence: landmarks.length >= 3 ? 0.62 : landmarks.length ? 0.46 : 0.32,
    requiresConfirmation: true
  };

  return { landmarks, zones, portals, floor };
}
