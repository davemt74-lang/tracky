import {
  baselineQuality,
  environmentDrift,
  fingerprintImageData,
  matchEnvironment,
  normalizeLandmark,
  suggestRoomMapping
} from './environment-core.js';
import { pixelMaskRect } from './privacy-policy-core.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function videoFrameDimensions(video, maxWidth = 720) {
  const sourceWidth = Number(video?.videoWidth || 0);
  const sourceHeight = Number(video?.videoHeight || 0);
  if (!sourceWidth || !sourceHeight) return null;
  const scale = Math.min(1, maxWidth / sourceWidth);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

export function captureEnvironmentFrame(video, options = {}) {
  const dimensions = videoFrameDimensions(video, Number(options.maxWidth || 720));
  if (!dimensions) throw new Error('Camera frame is not ready.');

  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  for (const region of options.maskRegions || []) {
    const rect = pixelMaskRect(region, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const fingerprint = fingerprintImageData(imageData);
  const quality = baselineQuality({
    ...fingerprint,
    obstructionRatio: Number(options.obstructionRatio || 0),
    landmarkCoverage: Number(options.landmarkCoverage ?? 0.5)
  });

  return {
    capturedAt: Date.now(),
    width: canvas.width,
    height: canvas.height,
    imageDataUrl: canvas.toDataURL('image/jpeg', Number(options.quality || 0.82)),
    fingerprint,
    quality
  };
}

export async function captureBestEnvironmentFrame(video, options = {}) {
  const count = Math.max(1, Math.min(8, Number(options.count || 4)));
  const intervalMs = Math.max(40, Number(options.intervalMs || 120));
  const frames = [];

  for (let index = 0; index < count; index += 1) {
    frames.push(captureEnvironmentFrame(video, options));
    if (index < count - 1) await sleep(intervalMs);
  }

  return frames.sort((a, b) => b.quality.score - a.quality.score)[0];
}

export function landmarksFromWorldObjects(objects = []) {
  return (objects || [])
    .filter((object) => object.status !== 'last-known')
    .map((object, index) => normalizeLandmark({
      id: 'L-' + object.id,
      label: object.label,
      name: object.label,
      position: object.roomPosition,
      confidence: object.confidence,
      source: 'multi-camera-object-fusion'
    }, index));
}

export function buildEnvironmentObservation(input = {}) {
  return {
    capturedAt: input.frame?.capturedAt || Date.now(),
    imageDataUrl: input.frame?.imageDataUrl || null,
    fingerprint: input.frame?.fingerprint || null,
    quality: input.frame?.quality || null,
    cameraId: input.cameraId || null,
    roomHint: input.roomHint || null,
    floor: input.floor || null,
    landmarks: input.landmarks || landmarksFromWorldObjects(input.objects || []),
    calibration: input.calibration || null
  };
}

export function analyzeEnvironmentObservation(observation, rooms = []) {
  const match = matchEnvironment(observation, rooms);
  const room = match.best
    ? rooms.find((candidate) => candidate.id === match.best.roomId)
    : null;
  const view = room?.views?.find((candidate) => candidate.id === match.best?.viewId) || null;
  const drift = view ? environmentDrift(observation, view) : null;

  return {
    ...match,
    drift,
    room,
    view
  };
}

export function assistedMappingFromObservation(observation, objects = []) {
  const suggestions = suggestRoomMapping(
    landmarksFromWorldObjects(objects).map((landmark) => ({
      id: landmark.id,
      label: landmark.label,
      roomPosition: landmark.position,
      confidence: landmark.confidence
    }))
  );

  return {
    ...suggestions,
    capturedAt: observation?.capturedAt || Date.now(),
    source: 'environment-reference-frame',
    provider: 'human-object-plus-floor-heuristic',
    confidence: suggestions.floor.confidence,
    requiresConfirmation: true
  };
}

export function environmentProviderContract() {
  return Object.freeze({
    schemaVersion: 1,
    accepts: ['reference-frame','world-objects','camera-calibration'],
    mayReturn: ['floor','landmarks','zones','portals','structural-boundaries'],
    rule: 'provider output is evidence; user-confirmed structure outranks inferred structure'
  });
}
