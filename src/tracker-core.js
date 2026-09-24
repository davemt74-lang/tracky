export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }

  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  return { h, s: s * 100, v: max * 100 };
}

export function hueInRange(h, min, max) {
  if (min <= max) return h >= min && h <= max;
  return h >= min || h <= max;
}

export function analyzeMask(mask, width, height, minArea = 1) {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = null;

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || visited[i]) continue;

    let stackSize = 0;
    stack[stackSize++] = i;
    visited[i] = 1;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (stackSize > 0) {
      const index = stack[--stackSize];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const left = index - 1;
      const right = index + 1;
      const up = index - width;
      const down = index + width;

      if (x > 0 && mask[left] && !visited[left]) {
        visited[left] = 1;
        stack[stackSize++] = left;
      }
      if (x < width - 1 && mask[right] && !visited[right]) {
        visited[right] = 1;
        stack[stackSize++] = right;
      }
      if (y > 0 && mask[up] && !visited[up]) {
        visited[up] = 1;
        stack[stackSize++] = up;
      }
      if (y < height - 1 && mask[down] && !visited[down]) {
        visited[down] = 1;
        stack[stackSize++] = down;
      }
    }

    if (area >= minArea && (!best || area > best.area)) {
      best = { area, x: sumX / area, y: sumY / area, minX, minY, maxX, maxY };
    }
  }

  return best;
}

export function detectColorBlob(imageData, options = {}) {
  const {
    hueMin = 70,
    hueMax = 170,
    saturationMin = 35,
    valueMin = 20,
    minAreaRatio = 0.002,
    sampleStep = 2
  } = options;

  const sourceWidth = imageData.width;
  const sourceHeight = imageData.height;
  const gridWidth = Math.ceil(sourceWidth / sampleStep);
  const gridHeight = Math.ceil(sourceHeight / sampleStep);
  const mask = new Uint8Array(gridWidth * gridHeight);
  const data = imageData.data;

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const sy = Math.min(gy * sampleStep, sourceHeight - 1);
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const sx = Math.min(gx * sampleStep, sourceWidth - 1);
      const pixel = (sy * sourceWidth + sx) * 4;
      const hsv = rgbToHsv(data[pixel], data[pixel + 1], data[pixel + 2]);
      if (
        hueInRange(hsv.h, hueMin, hueMax) &&
        hsv.s >= saturationMin &&
        hsv.v >= valueMin
      ) {
        mask[gy * gridWidth + gx] = 1;
      }
    }
  }

  const minArea = Math.max(1, Math.round(gridWidth * gridHeight * minAreaRatio));
  const blob = analyzeMask(mask, gridWidth, gridHeight, minArea);
  if (!blob) return null;

  const x = gridWidth > 1 ? blob.x / (gridWidth - 1) : 0.5;
  const y = gridHeight > 1 ? blob.y / (gridHeight - 1) : 0.5;
  const areaRatio = blob.area / (gridWidth * gridHeight);
  const confidence = Math.min(1, areaRatio / 0.03);

  return {
    x,
    y,
    confidence,
    areaRatio,
    bbox: {
      x: blob.minX / gridWidth,
      y: blob.minY / gridHeight,
      width: (blob.maxX - blob.minX + 1) / gridWidth,
      height: (blob.maxY - blob.minY + 1) / gridHeight
    }
  };
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    const divisor = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row[n]);
}

export function computeHomography(sourcePoints, destinationPoints) {
  if (sourcePoints.length !== 4 || destinationPoints.length !== 4) return null;

  const A = [];
  const b = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = sourcePoints[i];
    const { x: u, y: v } = destinationPoints[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(point, h) {
  if (!h) return point;
  const denominator = h[6] * point.x + h[7] * point.y + h[8];
  if (Math.abs(denominator) < 1e-10) return point;
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator
  };
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
