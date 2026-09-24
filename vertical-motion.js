import { clamp01, detectColorBlob } from './src/tracker-core.js';
import { createMotionStats, recordMotion, summarizeMotion, zoneForY } from './src/movement-core.js';
import { createGameState, recordGameSample, startGame, stopGame } from './src/gameplay-core.js';
import {
  advanceScan,
  bestParticipantMatch
} from './src/participant-core.js';
import {
  BODY_OCCLUSION_GRACE_MS,
  associateFacesToBodies,
  assignBodyTracks,
  attachFacesToTracks,
  carryOccludedTracks,
  roomPresenceState
} from './src/room-tracking-core.js';
import { IdentityEngine, cropFacePhoto } from './src/identity-engine.js';
import {
  listParticipants,
  patchParticipant,
  savePendingCapture
} from './src/participant-store.js';

const $ = (s) => document.querySelector(s);

const ui = {
  start: $('#startCamera'),
  stop: $('#stopCamera'),
  reset: $('#resetSession'),
  pause: $('#pauseStats'),
  select: $('#cameraSelect'),
  video: $('#cameraVideo'),
  trackingCanvas: $('#trackingCanvas'),
  cursor: $('#laneCursor'),
  lane: $('#movementLane'),
  instructions: $('#gameInstructions'),
  cameraStatus: $('#cameraStatus'),
  trackingStatus: $('#trackingStatus'),
  identityStatus: $('#identityStatus'),
  participantCards: $('#participantCards'),
  participantHudEmpty: $('#participantHudEmpty'),
  mirror: $('#mirrorCamera'),
  sensitivity: $('#motionSensitivity'),
  pointGoal: $('#pointGoal'),
  startGame: $('#startGame'),
  endGame: $('#endGame'),
  gameScore: $('#gameScore'),
  gameReps: $('#gameReps'),
  liveY: $('#liveY'),
  liveDelta: $('#liveDelta'),
  liveZone: $('#liveZone'),
  liveHz: $('#liveHz'),
  trace: $('#motionTrace'),
  statSamples: $('#statSamples'),
  statRate: $('#statRate'),
  statTravel: $('#statTravel'),
  statRange: $('#statRange'),
  statUp: $('#statUp'),
  statDown: $('#statDown'),
  statMicro: $('#statMicro'),
  statMicroEvents: $('#statMicroEvents'),
  statReversals: $('#statReversals'),
  statMicroReversals: $('#statMicroReversals'),
  statOscillation: $('#statOscillation'),
  statTime: $('#statTime')
};

const ctx = ui.trackingCanvas.getContext('2d', { willReadFrequently: true });
const traceCtx = ui.trace.getContext('2d');

const state = {
  stream: null,
  running: false,
  paused: false,
  raf: 0,
  rawY: null,
  displayX: 0.5,
  displayY: 0.5,
  stats: createMotionStats(),
  game: createGameState(5),
  trace: [],
  lastUiUpdate: 0,
  identity: {
    engine: new IdentityEngine(),
    ready: false,
    loading: false,
    busy: false,
    lastScanAt: 0,
    tracks: [],
    participants: [],
    counter: 0
  }
};

const LANE_HEIGHT_IN = 5;
const CURSOR_RADIUS_IN = 0.09;
const MAX_TRACE_SAMPLES = 600;
const MICRO_THRESHOLD = 0.015;
const IDENTITY_SCAN_INTERVAL = 650;
const TRACK_GRACE_MS = BODY_OCCLUSION_GRACE_MS;

function detectOptions() {
  return {
    hueMin: 70,
    hueMax: 170,
    saturationMin: 35,
    valueMin: 20,
    minAreaRatio: 0.002,
    sampleStep: 2
  };
}

function inches(value) {
  return (value * LANE_HEIGHT_IN).toFixed(3) + ' in';
}

function seconds(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

function signed(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  const n = value.toFixed(digits);
  return value > 0 ? '+' + n : n;
}

function pointGoalValue() {
  const parsed = Math.round(Number(ui.pointGoal.value) || 5);
  const goal = Math.max(1, Math.min(50, parsed));
  ui.pointGoal.value = String(goal);
  return goal;
}

function setCursor(x, y, visible) {
  if (!visible) {
    ui.cursor.hidden = true;
    return;
  }

  const yEdge = CURSOR_RADIUS_IN / LANE_HEIGHT_IN;
  const xEdge = CURSOR_RADIUS_IN;
  const constrainedX = xEdge + clamp01(x) * (1 - xEdge * 2);
  const constrainedY = yEdge + clamp01(y) * (1 - yEdge * 2);
  ui.cursor.style.left = (constrainedX * 100) + '%';
  ui.cursor.style.top = (constrainedY * 100) + '%';
  ui.cursor.hidden = false;
}

function renderGame() {
  const game = state.game;
  const targetNodes = ui.lane.querySelectorAll('[data-target-zone]');
  const zoneNodes = ui.lane.querySelectorAll('.lane-zone');

  zoneNodes.forEach((node, index) => {
    node.classList.toggle('target', game.active && index === game.activeZone);
  });

  targetNodes.forEach((node) => {
    const zone = Number(node.dataset.targetZone);
    const active = game.active && zone === game.activeZone;
    node.hidden = !active;
    if (active) node.textContent = String(game.repsRemaining);
  });

  ui.gameScore.textContent = game.score + ' / ' + game.pointGoal;
  ui.gameReps.textContent = game.active ? String(game.repsRemaining) : '—';
  ui.pointGoal.disabled = game.active;
  ui.startGame.disabled = game.active;
  ui.endGame.disabled = !game.active;
  ui.startGame.textContent = game.over ? 'Play again' : 'Start game';

  if (game.over) {
    ui.instructions.innerHTML = '<strong>Game over — ' + game.score + ' points.</strong><span>You reached your selected point goal. Press Play again for a new game.</span>';
    return;
  }

  if (!game.active) {
    ui.instructions.innerHTML = '<strong>Choose your point goal and start the game.</strong><span>Each highlighted section cleared is worth one point.</span>';
    return;
  }

  const zoneNumber = game.activeZone + 1;
  if (game.lastEvent === 'outside-zone') {
    ui.instructions.innerHTML = '<strong>Move into Zone ' + zoneNumber + '.</strong><span>Only complete up → down reps inside the highlighted section count.</span>';
  } else if (game.lastEvent === 'rep') {
    ui.instructions.innerHTML = '<strong>' + game.repsRemaining + ' reps left in Zone ' + zoneNumber + '.</strong><span>Keep the up → down rhythm inside the highlighted section.</span>';
  } else if (game.lastEvent === 'round-start') {
    ui.instructions.innerHTML = '<strong>Zone ' + zoneNumber + ': ' + game.repsRemaining + ' reps.</strong><span>Complete up → down cycles inside the highlighted section.</span>';
  } else {
    ui.instructions.innerHTML = '<strong>Zone ' + zoneNumber + ': ' + game.repsRemaining + ' reps left.</strong><span>Complete up → down cycles inside the highlighted section.</span>';
  }
}

async function enumerateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const current = ui.select.value;

  ui.select.innerHTML = '';
  cameras.forEach((camera, index) => {
    const option = document.createElement('option');
    option.value = camera.deviceId;
    option.textContent = camera.label || 'Camera ' + (index + 1);
    ui.select.append(option);
  });

  if (cameras.some((camera) => camera.deviceId === current)) ui.select.value = current;
  ui.select.disabled = cameras.length < 2;
}

async function reloadIdentityParticipants() {
  try {
    state.identity.participants = await listParticipants();
  } catch (error) {
    console.error(error);
    state.identity.participants = [];
  }
}

async function initRoomIdentity() {
  if (state.identity.ready || state.identity.loading) return;
  state.identity.loading = true;
  ui.identityStatus.textContent = 'Loading identity…';

  try {
    await reloadIdentityParticipants();
    await state.identity.engine.init();
    state.identity.ready = true;
    ui.identityStatus.textContent = 'Identity online';
  } catch (error) {
    console.error(error);
    ui.identityStatus.textContent = 'Identity unavailable';
  } finally {
    state.identity.loading = false;
  }
}

function nextTrackId() {
  state.identity.counter += 1;
  return 'T' + String(state.identity.counter).padStart(3, '0');
}

function participantById(id) {
  return state.identity.participants.find((participant) => participant.id === id) || null;
}

function statusLabel(track) {
  if (track.status === 'matched') return 'FACE + BODY LOCK';
  if (track.status === 'body-lock') return 'BODY LOCK';
  if (track.status === 'occluded') return 'OCCLUSION MEMORY';
  if (track.status === 'body-detected') return 'PERSON DETECTED';
  if (track.status === 'new') return 'NO ENROLLED MATCH';
  if (track.status === 'reacquiring') return 'REACQUIRING';
  if (track.status === 'align-face') return 'ALIGN FACE';
  if (track.status === 'ready') return 'MATCHING PROFILE';
  return 'SCANNING FACE';
}

function createParticipantCard(track) {
  const card = document.createElement('article');
  card.className = 'participant-scan-card ' + (track.status || 'scanning');

  const top = document.createElement('div');
  top.className = 'participant-card-top';

  const trackLabel = document.createElement('span');
  trackLabel.textContent = track.id;

  const stateLabel = document.createElement('b');
  stateLabel.textContent = statusLabel(track);

  top.append(trackLabel, stateLabel);

  const body = document.createElement('div');
  body.className = 'participant-card-body';

  const current = document.createElement('div');
  current.className = 'participant-current-photo';
  if (track.latestPhoto) {
    const image = document.createElement('img');
    image.src = track.latestPhoto;
    image.alt = '';
    current.append(image);
  } else {
    const scan = document.createElement('span');
    scan.className = 'scan-icon mini';
    current.append(scan);
  }

  const identity = document.createElement('div');
  identity.className = 'participant-card-identity';

  const name = document.createElement('strong');
  name.textContent = track.participantName || 'Unknown participant';

  const detail = document.createElement('span');
  if (track.status === 'matched') {
    detail.textContent = Math.round(track.similarity * 100) + '% face match · full-body track active';
  } else if (track.status === 'body-lock') {
    detail.textContent = 'Face not visible · identity held by body track';
  } else if (track.status === 'occluded') {
    detail.textContent = 'Temporarily occluded · preserving room identity';
  } else if (track.status === 'body-detected') {
    detail.textContent = 'Body detected · waiting for a usable face angle';
  } else if (track.status === 'new') {
    detail.textContent = 'Ready to create participant profile';
  } else if (track.status === 'reacquiring') {
    detail.textContent = 'Person temporarily out of view';
  } else {
    detail.textContent = Math.round(track.quality * 100) + '% face quality';
  }

  const meter = document.createElement('div');
  meter.className = 'participant-scan-meter';
  const fill = document.createElement('i');
  fill.style.width = Math.round(track.scanProgress || 0) + '%';
  meter.append(fill);

  identity.append(name, detail, meter);
  body.append(current, identity);

  const participant = track.participantId ? participantById(track.participantId) : null;
  if (participant?.primaryPhoto) {
    const saved = document.createElement('img');
    saved.className = 'participant-primary-badge';
    saved.src = participant.primaryPhoto;
    saved.alt = 'Saved primary profile photo';
    saved.title = 'Saved primary profile photo';
    body.append(saved);
  }

  card.append(top, body);

  const actions = document.createElement('div');
  actions.className = 'participant-card-actions';

  if (track.participantId) {
    const updatePhoto = document.createElement('button');
    updatePhoto.type = 'button';
    updatePhoto.textContent = 'Use current photo';
    updatePhoto.disabled = !track.latestPhoto;
    updatePhoto.addEventListener('click', () => useTrackPhotoAsPrimary(track));

    const wrong = document.createElement('button');
    wrong.type = 'button';
    wrong.textContent = 'Not this person';
    wrong.addEventListener('click', () => rejectTrackMatch(track));

    const open = document.createElement('a');
    open.href = './participants.html';
    open.textContent = 'Profiles';

    actions.append(updatePhoto, wrong, open);
  } else if (track.status === 'new' && track.embedding) {
    const create = document.createElement('button');
    create.type = 'button';
    create.textContent = 'Create participant';
    create.addEventListener('click', () => createParticipantFromTrack(track));
    actions.append(create);
  }

  if (actions.children.length) card.append(actions);
  return card;
}

function renderParticipantCards() {
  ui.participantCards.replaceChildren();
  const visible = state.identity.tracks
    .filter((track) => performance.now() - track.lastSeenAt < TRACK_GRACE_MS)
    .slice(0, 6);

  ui.participantHudEmpty.hidden = visible.length > 0;

  for (const track of visible) {
    ui.participantCards.append(createParticipantCard(track));
  }
}

async function useTrackPhotoAsPrimary(track) {
  if (!track.participantId || !track.latestPhoto) return;
  try {
    await patchParticipant(track.participantId, {
      primaryPhoto: track.latestPhoto,
      latestPhoto: track.latestPhoto,
      lastSeenAt: new Date().toISOString()
    });
    await reloadIdentityParticipants();
    renderParticipantCards();
  } catch (error) {
    console.error(error);
  }
}

function rejectTrackMatch(track) {
  const live = state.identity.tracks.find((candidate) => candidate.id === track.id);
  if (!live) return;

  live.blockedParticipantIds = Array.from(new Set([
    ...(live.blockedParticipantIds || []),
    live.participantId
  ].filter(Boolean)));
  live.participantId = null;
  live.participantName = null;
  live.similarity = 0;
  live.status = 'new';
  renderParticipantCards();
}

async function createParticipantFromTrack(track) {
  try {
    const pending = await savePendingCapture({
      photo: track.latestPhoto,
      embedding: track.embedding,
      trackId: track.id
    });
    location.href = './participants.html?pending=' + encodeURIComponent(pending.id);
  } catch (error) {
    console.error(error);
  }
}

async function resolveTrackIdentity(track) {
  if (!track.embedding || track.status === 'matched') return track;

  const blocked = new Set(track.blockedParticipantIds || []);
  const candidates = state.identity.participants.filter((participant) => !blocked.has(participant.id));
  const match = bestParticipantMatch(track.embedding, candidates);

  if (!match.matched) {
    return {
      ...track,
      status: 'new',
      participantId: null,
      participantName: null,
      similarity: match.similarity
    };
  }

  const currentPhoto = track.latestPhoto || (track.face?.box ? cropFacePhoto(ui.video, track.face.box, {
    mirror: ui.mirror.checked,
    size: 300,
    quality: 0.88
  }) : null);

  const matched = {
    ...track,
    status: 'matched',
    scanProgress: 100,
    participantId: match.participant.id,
    participantName: match.participant.name,
    similarity: match.similarity,
    latestPhoto: currentPhoto
  };

  try {
    await patchParticipant(match.participant.id, {
      latestPhoto: currentPhoto || match.participant.latestPhoto || match.participant.primaryPhoto,
      lastSeenAt: new Date().toISOString()
    });
    await reloadIdentityParticipants();
  } catch (error) {
    console.error(error);
  }

  return matched;
}

async function scanRoom(now) {
  if (!state.running || !state.identity.ready || state.identity.busy || ui.video.readyState < 2) return;
  state.identity.busy = true;
  state.identity.lastScanAt = now;

  try {
    const room = await state.identity.engine.detectRoom(ui.video);
    const faces = room.faces || [];
    const bodies = room.bodies || [];
    const previous = state.identity.tracks;

    let liveTracks = assignBodyTracks(previous, bodies, now, {
      nextId: nextTrackId
    });

    const assignments = associateFacesToBodies(faces, bodies);
    liveTracks = attachFacesToTracks(liveTracks, faces, bodies, assignments, now);

    liveTracks = liveTracks.map((track) => {
      const presence = roomPresenceState(track, now);

      if (!track.face) {
        return {
          ...track,
          status: track.participantId ? presence : 'body-detected',
          scanProgress: track.participantId ? 100 : track.scanProgress
        };
      }

      if (track.participantId) {
        const photo = track.quality >= 0.52
          ? cropFacePhoto(ui.video, track.face.box, {
              mirror: ui.mirror.checked,
              size: 260,
              quality: 0.82
            })
          : null;

        return {
          ...track,
          status: 'matched',
          scanProgress: 100,
          latestPhoto: photo || track.latestPhoto
        };
      }

      const advanced = advanceScan(track, { minQuality: 0.48, increment: 24, decay: 7 });
      if (track.status === 'new' && advanced.scanProgress >= 100) advanced.status = 'new';

      if (advanced.quality >= 0.52 && advanced.face?.box) {
        advanced.latestPhoto = cropFacePhoto(ui.video, advanced.face.box, {
          mirror: ui.mirror.checked,
          size: 260,
          quality: 0.82
        }) || track.latestPhoto;
      }

      return advanced;
    });

    const carried = carryOccludedTracks(previous, liveTracks, now, TRACK_GRACE_MS);

    const resolved = [];
    for (const track of liveTracks) {
      if (
        track.scanProgress >= 100 &&
        track.embedding &&
        !track.participantId &&
        track.status !== 'new'
      ) {
        resolved.push(await resolveTrackIdentity(track));
      } else {
        resolved.push(track);
      }
    }

    state.identity.tracks = [...resolved, ...carried];

    const identified = state.identity.tracks.filter((track) => track.participantId).length;
    const bodyLocked = state.identity.tracks.filter((track) => track.status === 'body-lock').length;
    ui.identityStatus.textContent = bodies.length
      ? bodies.length + ' person' + (bodies.length === 1 ? '' : 's') +
        ' · ' + identified + ' identified' +
        (bodyLocked ? ' · ' + bodyLocked + ' body lock' : '')
      : faces.length
        ? faces.length + ' face' + (faces.length === 1 ? '' : 's') + ' · acquiring body'
        : state.identity.tracks.some((track) => track.status === 'occluded')
          ? 'Occlusion recovery active'
          : 'Scanning room';

    renderParticipantCards();
  } catch (error) {
    console.error(error);
    ui.identityStatus.textContent = 'Room tracking error';
  } finally {
    state.identity.busy = false;
  }
}

function maybeScanRoom(now) {
  if (!state.identity.ready || state.identity.busy) return;
  if (now - state.identity.lastScanAt < IDENTITY_SCAN_INTERVAL) return;
  void scanRoom(now);
}

function stopCamera() {
  state.running = false;
  cancelAnimationFrame(state.raf);
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  ui.video.srcObject = null;
  ui.start.disabled = false;
  ui.stop.disabled = true;
  ui.select.disabled = true;
  ui.cameraStatus.textContent = 'Camera stopped';
  ui.trackingStatus.textContent = 'No signal';
  ui.identityStatus.textContent = state.identity.ready ? 'Identity standby' : 'Identity offline';
  state.identity.tracks = [];
  renderParticipantCards();
  setCursor(0.5, 0.5, false);
}

async function startCamera(deviceId = '') {
  stopCamera();

  if (!navigator.mediaDevices?.getUserMedia) {
    ui.cameraStatus.textContent = 'Camera API unavailable';
    return false;
  }

  try {
    ui.cameraStatus.textContent = 'Requesting camera…';
    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60, max: 60 }
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { ideal: 'user' };

    state.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    ui.video.srcObject = state.stream;
    await ui.video.play();
    await enumerateCameras();

    state.running = true;
    ui.start.disabled = true;
    ui.stop.disabled = false;
    ui.cameraStatus.textContent = 'Camera live';
    ui.trackingStatus.textContent = 'Searching for green…';
    state.identity.lastScanAt = 0;
    void initRoomIdentity();
    state.raf = requestAnimationFrame(loop);
    return true;
  } catch (error) {
    console.error(error);
    ui.cameraStatus.textContent = window.isSecureContext ? 'Could not start camera' : 'Use localhost or HTTPS';
    return false;
  }
}

function resetSession() {
  state.stats = createMotionStats();
  state.trace = [];
  state.rawY = null;
  state.lastUiUpdate = 0;
  renderStats(performance.now());
  drawTrace();
}

async function beginGameplay() {
  const goal = pointGoalValue();

  if (!state.running) {
    const started = await startCamera(ui.select.value);
    if (!started) return;
  }

  resetSession();
  startGame(state.game, goal);
  renderGame();
}

function endGameplay() {
  stopGame(state.game);
  renderGame();
}

function pushTrace(delta, micro) {
  state.trace.push({ delta, micro });
  if (state.trace.length > MAX_TRACE_SAMPLES) {
    state.trace.splice(0, state.trace.length - MAX_TRACE_SAMPLES);
  }
}

function drawTrace() {
  const rect = ui.trace.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (ui.trace.width !== width || ui.trace.height !== height) {
    ui.trace.width = width;
    ui.trace.height = height;
  }

  traceCtx.clearRect(0, 0, width, height);
  traceCtx.strokeStyle = 'rgba(78,232,255,.14)';
  traceCtx.lineWidth = 1 * dpr;
  traceCtx.beginPath();
  traceCtx.moveTo(0, height / 2);
  traceCtx.lineTo(width, height / 2);
  traceCtx.stroke();

  if (state.trace.length < 2) return;

  let max = 0.002;
  for (const point of state.trace) max = Math.max(max, Math.abs(point.delta));
  max = Math.min(max, 0.05);

  traceCtx.strokeStyle = '#5cff9d';
  traceCtx.lineWidth = 1.5 * dpr;
  traceCtx.beginPath();

  state.trace.forEach((point, index) => {
    const x = (index / Math.max(1, MAX_TRACE_SAMPLES - 1)) * width;
    const normalized = Math.max(-1, Math.min(1, point.delta / max));
    const y = height / 2 + normalized * (height * 0.42);
    if (index === 0) traceCtx.moveTo(x, y);
    else traceCtx.lineTo(x, y);
  });
  traceCtx.stroke();
}

function renderZoneStats(summary) {
  summary.zones.forEach((zone) => {
    const root = document.querySelector('[data-zone="' + zone.index + '"]');
    if (!root) return;
    root.querySelector('[data-k="travel"]').textContent = inches(zone.totalTravel);
    root.querySelector('[data-k="micro"]').textContent = inches(zone.microTravel);
    root.querySelector('[data-k="up"]').textContent = inches(zone.upTravel);
    root.querySelector('[data-k="down"]').textContent = inches(zone.downTravel);
    root.querySelector('[data-k="reversals"]').textContent = zone.reversals.toLocaleString();
    root.querySelector('[data-k="microEvents"]').textContent = zone.microEvents.toLocaleString();
    root.querySelector('[data-k="microReversals"]').textContent = zone.microReversals.toLocaleString();
    root.querySelector('[data-k="dwell"]').textContent = seconds(zone.dwellMs);
  });
}

function renderStats(now) {
  const summary = summarizeMotion(state.stats, now);
  ui.statSamples.textContent = summary.samples.toLocaleString();
  ui.statRate.textContent = summary.sampleRate.toFixed(1) + ' Hz';
  ui.statTravel.textContent = inches(summary.totalTravel);
  ui.statRange.textContent = inches(summary.range);
  ui.statUp.textContent = inches(summary.upTravel);
  ui.statDown.textContent = inches(summary.downTravel);
  ui.statMicro.textContent = inches(summary.microTravel);
  ui.statMicroEvents.textContent = summary.microEvents.toLocaleString();
  ui.statReversals.textContent = summary.reversals.toLocaleString();
  ui.statMicroReversals.textContent = summary.microReversals.toLocaleString();
  ui.statOscillation.textContent = summary.oscillationsPerMinute.toFixed(1) + '/min';
  ui.statTime.textContent = seconds(summary.elapsedMs);
  ui.liveHz.textContent = summary.sampleRate.toFixed(1);
  renderZoneStats(summary);
}

function loop(now) {
  if (!state.running) return;
  if (ui.video.readyState < 2) {
    state.raf = requestAnimationFrame(loop);
    return;
  }

  const videoWidth = ui.video.videoWidth || 1280;
  const videoHeight = ui.video.videoHeight || 720;
  const aspect = videoWidth / videoHeight;
  ui.trackingCanvas.width = 320;
  ui.trackingCanvas.height = Math.max(180, Math.round(320 / aspect));

  ctx.drawImage(ui.video, 0, 0, ui.trackingCanvas.width, ui.trackingCanvas.height);
  const image = ctx.getImageData(0, 0, ui.trackingCanvas.width, ui.trackingCanvas.height);
  const detection = detectColorBlob(image, detectOptions());

  if (!detection) {
    ui.trackingStatus.textContent = 'Searching for green…';
    ui.liveY.textContent = '—';
    ui.liveDelta.textContent = '—';
    ui.liveZone.textContent = '—';
    setCursor(state.displayX, state.displayY, false);
  } else {
    const rawX = clamp01(ui.mirror.checked ? 1 - detection.x : detection.x);
    const rawY = clamp01(detection.y);
    state.displayX += (rawX - state.displayX) * 0.28;
    state.displayY += (rawY - state.displayY) * 0.28;
    setCursor(state.displayX, state.displayY, true);
    ui.trackingStatus.textContent = 'Object tracked';

    let motionEvent = { delta: 0, zone: zoneForY(rawY), micro: false };
    if (!state.paused) {
      motionEvent = recordMotion(state.stats, rawY, now, {
        noiseFloor: Number(ui.sensitivity.value),
        microThreshold: MICRO_THRESHOLD
      });
      pushTrace(motionEvent.delta, motionEvent.micro);
    }

    if (state.game.active) {
      const gameEvent = recordGameSample(state.game, rawY);
      if (gameEvent.type === 'rep' || gameEvent.type === 'point' || gameEvent.type === 'game-over' || gameEvent.type === 'outside-zone') {
        renderGame();
      }
    }

    state.rawY = rawY;
    ui.liveY.textContent = rawY.toFixed(4);
    ui.liveDelta.textContent = signed(motionEvent.delta);
    ui.liveZone.textContent = String(zoneForY(rawY) + 1);
  }

  maybeScanRoom(now);

  if (now - state.lastUiUpdate >= 100) {
    renderStats(now);
    if (state.game.active) renderGame();
    drawTrace();
    state.lastUiUpdate = now;
  }

  state.raf = requestAnimationFrame(loop);
}

ui.start.addEventListener('click', () => startCamera(ui.select.value));
ui.stop.addEventListener('click', () => {
  if (state.game.active) endGameplay();
  stopCamera();
});
ui.reset.addEventListener('click', resetSession);
ui.startGame.addEventListener('click', beginGameplay);
ui.endGame.addEventListener('click', endGameplay);
ui.pointGoal.addEventListener('change', () => {
  if (!state.game.active) {
    state.game.pointGoal = pointGoalValue();
    renderGame();
  }
});
ui.select.addEventListener('change', () => state.running && startCamera(ui.select.value));
ui.pause.addEventListener('click', () => {
  state.paused = !state.paused;
  ui.pause.textContent = state.paused ? 'Resume stats' : 'Pause stats';
});
window.addEventListener('resize', drawTrace);

await reloadIdentityParticipants();
renderParticipantCards();
renderStats(performance.now());
renderGame();
drawTrace();
