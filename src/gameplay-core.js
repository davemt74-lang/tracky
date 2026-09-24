import { clamp01 } from './tracker-core.js';
import { zoneForY } from './movement-core.js';

export function createRepDetector(minExcursion = 0.035) {
  return {
    phase: 'seek-up',
    anchorY: null,
    troughY: null,
    minExcursion
  };
}

export function resetRepDetector(detector) {
  detector.phase = 'seek-up';
  detector.anchorY = null;
  detector.troughY = null;
  return detector;
}

export function recordRepSample(detector, y) {
  const value = clamp01(y);

  if (detector.anchorY === null) {
    detector.anchorY = value;
    return false;
  }

  if (detector.phase === 'seek-up') {
    // Keep the highest recent point as the start of the upward leg.
    detector.anchorY = Math.max(detector.anchorY, value);
    if (detector.anchorY - value >= detector.minExcursion) {
      detector.phase = 'seek-down';
      detector.troughY = value;
    }
    return false;
  }

  detector.troughY = Math.min(detector.troughY, value);
  if (value - detector.troughY >= detector.minExcursion) {
    detector.phase = 'seek-up';
    detector.anchorY = value;
    detector.troughY = null;
    return true;
  }

  return false;
}

export function randomIntInclusive(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

export function nextZone(previousZone = null, random = Math.random) {
  if (previousZone === null || previousZone < 0 || previousZone > 2) {
    return randomIntInclusive(0, 2, random);
  }

  // Choose one of the other two zones so the game always visibly moves.
  const offset = random() < 0.5 ? 1 : 2;
  return (previousZone + offset) % 3;
}

export function createGameState(pointGoal = 5) {
  return {
    active: false,
    over: false,
    score: 0,
    pointGoal: Math.max(1, Math.min(50, Math.round(pointGoal))),
    activeZone: null,
    roundTarget: 0,
    repsRemaining: 0,
    completedRounds: 0,
    detector: createRepDetector(),
    lastEvent: 'ready'
  };
}

export function beginRound(game, random = Math.random) {
  game.activeZone = nextZone(game.activeZone, random);
  game.roundTarget = randomIntInclusive(4, 10, random);
  game.repsRemaining = game.roundTarget;
  game.lastEvent = 'round-start';
  resetRepDetector(game.detector);
  return game;
}

export function startGame(game, pointGoal, random = Math.random) {
  game.active = true;
  game.over = false;
  game.score = 0;
  game.pointGoal = Math.max(1, Math.min(50, Math.round(pointGoal)));
  game.activeZone = null;
  game.completedRounds = 0;
  game.lastEvent = 'game-start';
  return beginRound(game, random);
}

export function stopGame(game) {
  game.active = false;
  game.lastEvent = game.over ? 'game-over' : 'stopped';
  resetRepDetector(game.detector);
  return game;
}

export function recordGameSample(game, y, random = Math.random) {
  if (!game.active || game.over || game.activeZone === null) {
    return { type: 'inactive', zone: null };
  }

  const zone = zoneForY(y);
  if (zone !== game.activeZone) {
    resetRepDetector(game.detector);
    game.lastEvent = 'outside-zone';
    return { type: 'outside-zone', zone };
  }

  const rep = recordRepSample(game.detector, y);
  if (!rep) {
    game.lastEvent = 'tracking';
    return { type: 'tracking', zone };
  }

  game.repsRemaining -= 1;
  game.lastEvent = 'rep';

  if (game.repsRemaining > 0) {
    return { type: 'rep', zone, repsRemaining: game.repsRemaining };
  }

  game.score += 1;
  game.completedRounds += 1;

  if (game.score >= game.pointGoal) {
    game.over = true;
    game.active = false;
    game.lastEvent = 'game-over';
    resetRepDetector(game.detector);
    return { type: 'game-over', zone, score: game.score };
  }

  const clearedZone = game.activeZone;
  beginRound(game, random);
  return {
    type: 'point',
    clearedZone,
    score: game.score,
    nextZone: game.activeZone,
    repsRemaining: game.repsRemaining
  };
}
