import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGameState,
  createRepDetector,
  nextZone,
  recordGameSample,
  recordRepSample,
  startGame
} from '../src/gameplay-core.js';

test('rep detector counts one complete up then down cycle', () => {
  const detector = createRepDetector(0.03);
  const samples = [0.55, 0.53, 0.50, 0.48, 0.50, 0.53];
  const reps = samples.filter((y) => recordRepSample(detector, y)).length;
  assert.equal(reps, 1);
});

test('rep detector does not count micro jitter below gameplay excursion', () => {
  const detector = createRepDetector(0.03);
  const samples = [0.5, 0.498, 0.501, 0.497, 0.502, 0.499];
  const reps = samples.filter((y) => recordRepSample(detector, y)).length;
  assert.equal(reps, 0);
});

test('nextZone never repeats the previous section', () => {
  assert.notEqual(nextZone(0, () => 0.1), 0);
  assert.notEqual(nextZone(1, () => 0.9), 1);
  assert.notEqual(nextZone(2, () => 0.2), 2);
});

test('game starts with a 4-10 rep target and selected point goal', () => {
  const game = createGameState();
  startGame(game, 7, () => 0);
  assert.equal(game.pointGoal, 7);
  assert.equal(game.score, 0);
  assert.ok(game.roundTarget >= 4 && game.roundTarget <= 10);
  assert.equal(game.repsRemaining, game.roundTarget);
  assert.ok(game.activeZone >= 0 && game.activeZone <= 2);
});

test('samples outside highlighted zone do not count reps', () => {
  const game = createGameState(2);
  startGame(game, 2, () => 0);
  game.activeZone = 1;
  game.roundTarget = 4;
  game.repsRemaining = 4;
  const before = game.repsRemaining;
  [0.05, 0.01, 0.06, 0.02].forEach((y) => recordGameSample(game, y, () => 0));
  assert.equal(game.repsRemaining, before);
});

test('clearing a target scores one point and starts a new section', () => {
  const game = createGameState(2);
  startGame(game, 2, () => 0);
  game.activeZone = 1;
  game.roundTarget = 1;
  game.repsRemaining = 1;
  game.detector.minExcursion = 0.03;

  const oldZone = game.activeZone;
  [0.58, 0.54, 0.50, 0.54].forEach((y) => recordGameSample(game, y, () => 0));
  assert.equal(game.score, 1);
  assert.notEqual(game.activeZone, oldZone);
  assert.ok(game.repsRemaining >= 4 && game.repsRemaining <= 10);
});

test('reaching selected point goal ends the game', () => {
  const game = createGameState(1);
  startGame(game, 1, () => 0);
  game.activeZone = 1;
  game.roundTarget = 1;
  game.repsRemaining = 1;
  game.detector.minExcursion = 0.03;

  [0.58, 0.54, 0.50, 0.54].forEach((y) => recordGameSample(game, y, () => 0));
  assert.equal(game.score, 1);
  assert.equal(game.over, true);
  assert.equal(game.active, false);
});
