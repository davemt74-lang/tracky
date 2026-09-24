import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleLinear } from '../src/room-audio-engine.js';

test('resampleLinear preserves approximate duration', () => {
  const source = new Float32Array(48000);
  const target = resampleLinear(source, 48000, 16000);
  assert.equal(target.length, 16000);
});

test('resampleLinear preserves a constant signal', () => {
  const source = new Float32Array(100).fill(0.25);
  const target = resampleLinear(source, 100, 50);
  assert.ok(target.every((value) => Math.abs(value - 0.25) < 1e-6));
});
