import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleLinear, RoomAudioCapture } from '../src/room-audio-engine.js';

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


test('resampleLinear rejects invalid sample rates', () => {
  assert.throws(() => resampleLinear(new Float32Array([1, 2]), 0, 16000), /Invalid source/);
  assert.throws(() => resampleLinear(new Float32Array([1, 2]), 48000, 0), /Invalid target/);
});

test('room audio suppression discards an in-progress speech segment', () => {
  const capture = new RoomAudioCapture();
  capture.speaking = true;
  capture.frames = [new Float32Array([0.2, 0.1])];
  capture.levels = [-20];
  capture.segmentStartedAt = 100;
  capture.lastVoiceAt = 200;

  capture.setSuppressed(true);

  assert.equal(capture.suppressed, true);
  assert.equal(capture.speaking, false);
  assert.equal(capture.frames.length, 0);
  assert.equal(capture.levels.length, 0);
});

test('room audio suppression can be released after acknowledgement audio', () => {
  const capture = new RoomAudioCapture();
  capture.setSuppressed(true);
  capture.setSuppressed(false);
  assert.equal(capture.suppressed, false);
});
