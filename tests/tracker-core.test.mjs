import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMask,
  applyHomography,
  computeHomography,
  hueInRange,
  rgbToHsv
} from '../src/tracker-core.js';

test('rgbToHsv recognizes primary colors', () => {
  const green = rgbToHsv(0, 255, 0);
  assert.equal(Math.round(green.h), 120);
  assert.equal(Math.round(green.s), 100);
  assert.equal(Math.round(green.v), 100);
});

test('hueInRange handles ordinary and wrapped ranges', () => {
  assert.equal(hueInRange(120, 70, 170), true);
  assert.equal(hueInRange(20, 70, 170), false);
  assert.equal(hueInRange(355, 340, 20), true);
  assert.equal(hueInRange(10, 340, 20), true);
});

test('analyzeMask selects the largest connected component', () => {
  const width = 5;
  const height = 4;
  const mask = new Uint8Array([
    1, 0, 0, 0, 0,
    1, 0, 1, 1, 0,
    0, 0, 1, 1, 0,
    0, 0, 1, 0, 0
  ]);
  const blob = analyzeMask(mask, width, height, 1);
  assert.equal(blob.area, 5);
  assert.equal(blob.minX, 2);
  assert.equal(blob.maxX, 3);
});

test('homography maps a skewed quadrilateral to unit corners', () => {
  const src = [
    { x: 0.1, y: 0.15 },
    { x: 0.9, y: 0.1 },
    { x: 0.85, y: 0.9 },
    { x: 0.2, y: 0.85 }
  ];
  const dst = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ];
  const h = computeHomography(src, dst);
  assert.ok(h);
  src.forEach((point, index) => {
    const mapped = applyHomography(point, h);
    assert.ok(Math.abs(mapped.x - dst[index].x) < 1e-8);
    assert.ok(Math.abs(mapped.y - dst[index].y) < 1e-8);
  });
});
