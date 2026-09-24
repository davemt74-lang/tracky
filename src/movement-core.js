import { clamp01 } from './tracker-core.js';

export const ZONE_LABELS = ['Top', 'Middle', 'Bottom'];

export function zoneForY(y, zoneCount = 3) {
  const safe = clamp01(y);
  return Math.min(zoneCount - 1, Math.floor(safe * zoneCount));
}

export function splitVerticalDistance(y0, y1, zoneCount = 3) {
  const start = clamp01(y0);
  const end = clamp01(y1);
  if (start === end) return Array(zoneCount).fill(0);

  const direction = end > start ? 1 : -1;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const distances = Array(zoneCount).fill(0);

  for (let zone = 0; zone < zoneCount; zone += 1) {
    const zoneLow = zone / zoneCount;
    const zoneHigh = (zone + 1) / zoneCount;
    const overlap = Math.max(0, Math.min(high, zoneHigh) - Math.max(low, zoneLow));
    distances[zone] = overlap * direction;
  }
  return distances;
}

function freshZone() {
  return {
    samples: 0,
    dwellMs: 0,
    movementEvents: 0,
    reversals: 0,
    totalTravel: 0,
    upTravel: 0,
    downTravel: 0,
    microEvents: 0,
    microReversals: 0,
    microTravel: 0,
    microUpTravel: 0,
    microDownTravel: 0,
    lastDirection: 0,
    lastMicroDirection: 0
  };
}

export function createMotionStats(zoneCount = 3) {
  return {
    startedAt: null,
    lastTimestamp: null,
    lastY: null,
    lastZone: null,
    samples: 0,
    movementEvents: 0,
    reversals: 0,
    totalTravel: 0,
    upTravel: 0,
    downTravel: 0,
    microEvents: 0,
    microReversals: 0,
    microTravel: 0,
    microUpTravel: 0,
    microDownTravel: 0,
    minY: 1,
    maxY: 0,
    lastDirection: 0,
    lastMicroDirection: 0,
    zones: Array.from({ length: zoneCount }, freshZone)
  };
}

export function recordMotion(stats, y, timestamp, options = {}) {
  const {
    noiseFloor = 0.0002,
    microThreshold = 0.015,
    zoneCount = stats.zones.length
  } = options;

  const value = clamp01(y);
  const zone = zoneForY(value, zoneCount);

  if (stats.startedAt === null) stats.startedAt = timestamp;
  if (stats.lastTimestamp !== null && stats.lastZone !== null) {
    stats.zones[stats.lastZone].dwellMs += Math.max(0, timestamp - stats.lastTimestamp);
  }

  stats.samples += 1;
  stats.zones[zone].samples += 1;
  stats.minY = Math.min(stats.minY, value);
  stats.maxY = Math.max(stats.maxY, value);

  if (stats.lastY === null) {
    stats.lastY = value;
    stats.lastTimestamp = timestamp;
    stats.lastZone = zone;
    return { delta: 0, direction: 0, micro: false, zone };
  }

  const previousY = stats.lastY;
  const delta = value - previousY;
  const distance = Math.abs(delta);

  stats.lastY = value;
  stats.lastTimestamp = timestamp;
  stats.lastZone = zone;

  if (distance < noiseFloor) {
    return { delta, direction: 0, micro: false, zone };
  }

  const direction = delta < 0 ? -1 : 1;
  const isMicro = distance <= microThreshold;
  const split = splitVerticalDistance(previousY, value, zoneCount);

  stats.movementEvents += 1;
  stats.totalTravel += distance;
  if (direction < 0) stats.upTravel += distance;
  else stats.downTravel += distance;
  if (stats.lastDirection && stats.lastDirection !== direction) stats.reversals += 1;
  stats.lastDirection = direction;

  if (isMicro) {
    stats.microEvents += 1;
    stats.microTravel += distance;
    if (direction < 0) stats.microUpTravel += distance;
    else stats.microDownTravel += distance;
    if (stats.lastMicroDirection && stats.lastMicroDirection !== direction) stats.microReversals += 1;
    stats.lastMicroDirection = direction;
  }

  split.forEach((signedDistance, index) => {
    if (!signedDistance) return;
    const zoneStats = stats.zones[index];
    const d = Math.abs(signedDistance);
    const zoneDirection = signedDistance < 0 ? -1 : 1;

    zoneStats.movementEvents += 1;
    zoneStats.totalTravel += d;
    if (zoneDirection < 0) zoneStats.upTravel += d;
    else zoneStats.downTravel += d;
    if (zoneStats.lastDirection && zoneStats.lastDirection !== zoneDirection) zoneStats.reversals += 1;
    zoneStats.lastDirection = zoneDirection;

    if (isMicro) {
      zoneStats.microEvents += 1;
      zoneStats.microTravel += d;
      if (zoneDirection < 0) zoneStats.microUpTravel += d;
      else zoneStats.microDownTravel += d;
      if (zoneStats.lastMicroDirection && zoneStats.lastMicroDirection !== zoneDirection) zoneStats.microReversals += 1;
      zoneStats.lastMicroDirection = zoneDirection;
    }
  });

  return { delta, direction, micro: isMicro, zone };
}

export function summarizeMotion(stats, now = 0) {
  const elapsedMs = stats.startedAt === null ? 0 : Math.max(0, now - stats.startedAt);
  const elapsedSeconds = elapsedMs / 1000;
  return {
    elapsedMs,
    sampleRate: elapsedSeconds > 0 ? stats.samples / elapsedSeconds : 0,
    samples: stats.samples,
    movementEvents: stats.movementEvents,
    reversals: stats.reversals,
    totalTravel: stats.totalTravel,
    upTravel: stats.upTravel,
    downTravel: stats.downTravel,
    microEvents: stats.microEvents,
    microReversals: stats.microReversals,
    microTravel: stats.microTravel,
    microUpTravel: stats.microUpTravel,
    microDownTravel: stats.microDownTravel,
    oscillationsPerMinute: elapsedSeconds > 0 ? (stats.microReversals / 2) * (60 / elapsedSeconds) : 0,
    range: Math.max(0, stats.maxY - stats.minY),
    zones: stats.zones.map((zone, index) => ({
      index,
      label: ZONE_LABELS[index] || 'Zone ' + (index + 1),
      ...zone
    }))
  };
}
