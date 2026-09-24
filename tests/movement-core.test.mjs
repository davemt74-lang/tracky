import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMotionStats,
  recordMotion,
  splitVerticalDistance,
  summarizeMotion,
  zoneForY
} from '../src/movement-core.js';

test('zoneForY divides the lane into three equal zones', () => {
  assert.equal(zoneForY(0), 0);
  assert.equal(zoneForY(0.32), 0);
  assert.equal(zoneForY(0.34), 1);
  assert.equal(zoneForY(0.66), 1);
  assert.equal(zoneForY(0.9), 2);
  assert.equal(zoneForY(1), 2);
});

test('splitVerticalDistance allocates travel across zone boundaries', () => {
  const result = splitVerticalDistance(0.2, 0.8, 3);
  assert.ok(Math.abs(result[0] - (1 / 3 - 0.2)) < 1e-9);
  assert.ok(Math.abs(result[1] - (1 / 3)) < 1e-9);
  assert.ok(Math.abs(result[2] - (0.8 - 2 / 3)) < 1e-9);
});

test('recordMotion keeps upward and downward micro movement separately', () => {
  const stats = createMotionStats();
  recordMotion(stats, 0.5, 0);
  recordMotion(stats, 0.49, 16, { noiseFloor: 0, microThreshold: 0.02 });
  recordMotion(stats, 0.5, 32, { noiseFloor: 0, microThreshold: 0.02 });
  assert.equal(stats.microEvents, 2);
  assert.equal(stats.microReversals, 1);
  assert.ok(stats.microUpTravel > 0);
  assert.ok(stats.microDownTravel > 0);
});

test('summarizeMotion reports high-volume sample rate', () => {
  const stats = createMotionStats();
  for (let i = 0; i < 60; i += 1) recordMotion(stats, 0.5 + ((i % 2) ? 0.002 : 0), i * (1000 / 60), { noiseFloor: 0 });
  const summary = summarizeMotion(stats, 1000);
  assert.ok(summary.sampleRate > 55 && summary.sampleRate < 65);
  assert.ok(summary.microEvents > 50);
  assert.ok(summary.oscillationsPerMinute > 0);
});
