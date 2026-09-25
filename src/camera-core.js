import {
  applyHomography,
  clamp01,
  computeHomography
} from './tracker-core.js';

export const DEFAULT_ROOM_ID = 'ROOM01';

export function unitCorners() {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ];
}

export function normalizeCameraConfig(camera = {}, index = 0) {
  const id = String(camera.id || 'CAM' + String(index + 1).padStart(2, '0'));
  const sourcePoints = normalizePoints(camera.sourcePoints || unitCorners());
  const roomPoints = normalizePoints(camera.roomPoints || unitCorners());

  return {
    id,
    name: String(camera.name || id),
    deviceId: String(camera.deviceId || ''),
    roomId: String(camera.roomId || DEFAULT_ROOM_ID),
    enabled: camera.enabled !== false,
    primary: camera.primary === true,
    sourcePoints,
    roomPoints,
    homography: computeHomography(sourcePoints, roomPoints),
    createdAt: Number(camera.createdAt || Date.now()),
    updatedAt: Number(camera.updatedAt || Date.now())
  };
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizePoints(points) {
  const fallback = unitCorners();
  return fallback.map((point, index) => ({
    x: clamp01(finiteOr(points?.[index]?.x, point.x)),
    y: clamp01(finiteOr(points?.[index]?.y, point.y))
  }));
}

export function rectangleRoomPoints(x = 0, y = 0, width = 1, height = 1) {
  const left = clamp01(finiteOr(x, 0));
  const top = clamp01(finiteOr(y, 0));
  const safeWidth = Math.max(0.02, finiteOr(width, 1));
  const safeHeight = Math.max(0.02, finiteOr(height, 1));
  const right = clamp01(left + safeWidth);
  const bottom = clamp01(top + safeHeight);

  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];
}

export function cameraWithCoverage(camera, coverage = {}) {
  return normalizeCameraConfig({
    ...camera,
    roomPoints: rectangleRoomPoints(
      coverage.x,
      coverage.y,
      coverage.width,
      coverage.height
    ),
    updatedAt: Date.now()
  });
}

export function mapCameraPoint(camera, point) {
  const config = normalizeCameraConfig(camera);
  const mapped = applyHomography(point, config.homography);
  return {
    x: clamp01(mapped.x),
    y: clamp01(mapped.y)
  };
}

export function mapCameraBox(camera, box) {
  if (!box) return null;

  const corners = [
    mapCameraPoint(camera, { x: box.x, y: box.y }),
    mapCameraPoint(camera, { x: box.x + box.width, y: box.y }),
    mapCameraPoint(camera, { x: box.x + box.width, y: box.y + box.height }),
    mapCameraPoint(camera, { x: box.x, y: box.y + box.height })
  ];

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
    cx: (x + right) / 2,
    cy: (y + bottom) / 2,
    corners
  };
}

export function cameraCoveragePolygon(camera) {
  return normalizeCameraConfig(camera).roomPoints.map((point) => ({ ...point }));
}

export function coverageBounds(camera) {
  const points = cameraCoveragePolygon(camera);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    cx: (x + right) / 2,
    cy: (y + bottom) / 2
  };
}

export function cameraCalibrationValid(camera) {
  const config = normalizeCameraConfig(camera);
  if (!config.homography) return false;

  const area = polygonArea(config.roomPoints);
  return area >= 0.0025;
}

export function polygonArea(points = []) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function roomDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(
    Number(a.x || 0) - Number(b.x || 0),
    Number(a.y || 0) - Number(b.y || 0)
  );
}
