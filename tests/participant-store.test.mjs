import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dialogueIdsToPrune,
  isPendingCaptureExpired,
  MAX_DIALOGUE_TURNS,
  PENDING_CAPTURE_TTL_MS
} from '../src/participant-store.js';

test('pending face captures expire after the retention window', () => {
  const now = Date.parse('2026-09-24T20:00:00Z');
  const fresh = { createdAt: new Date(now - PENDING_CAPTURE_TTL_MS + 1000).toISOString() };
  const stale = { createdAt: new Date(now - PENDING_CAPTURE_TTL_MS - 1000).toISOString() };
  assert.equal(isPendingCaptureExpired(fresh, now), false);
  assert.equal(isPendingCaptureExpired(stale, now), true);
});

test('malformed pending captures are treated as expired', () => {
  assert.equal(isPendingCaptureExpired({ createdAt: 'not-a-date' }), true);
});

test('dialogue retention prunes only the oldest excess rows', () => {
  const rows = Array.from({ length: MAX_DIALOGUE_TURNS + 3 }, (_, index) => ({
    id: 'turn-' + index,
    createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString()
  }));
  const ids = dialogueIdsToPrune(rows);
  assert.deepEqual(ids, ['turn-0', 'turn-1', 'turn-2']);
});
