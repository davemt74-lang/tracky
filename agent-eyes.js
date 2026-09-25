import {
  advanceScan,
  bestParticipantMatch
} from './src/participant-core.js';
import {
  BODY_OCCLUSION_GRACE_MS,
  associateFacesToBodies,
  assignBodyTracks,
  attachFacesToTracks,
  augmentBodiesWithFaceFallbacks,
  carryOccludedTracks,
  dedupeParticipantAssignments,
  roomPresenceState
} from './src/room-tracking-core.js';
import { IdentityEngine, cropFacePhoto } from './src/identity-engine.js';
import {
  bestVoiceMatch,
  buildConversationGroups,
  conversationGroupForTrack,
  transcriptSignalGate,
  voiceProfileReadiness
} from './src/voice-core.js';
import { VoiceIdentityEngine } from './src/voice-engine.js';
import {
  LocalTranscriptionEngine,
  RoomAudioCapture
} from './src/room-audio-engine.js';
import {
  listParticipants,
  patchParticipant,
  saveDialogueTurn,
  savePendingCapture
} from './src/participant-store.js';
import {
  PERCEPTION_EVENT_TYPES,
  PerceptionEventBus,
  applyPerceptionEvent,
  createRoomState,
  roomStateSnapshot
} from './src/perception-core.js';

const $ = (selector) => document.querySelector(selector);

const ui = {
  startEyes: $('#startEyes'),
  startEars: $('#startEars'),
  stop: $('#stopPerception'),
  cameraSelect: $('#eyesCameraSelect'),
  spokenAcks: $('#eyesSpokenAcks'),
  clock: $('#agentRuntimeClock'),
  video: $('#eyesVideo'),
  overlay: $('#eyesOverlay'),
  offline: $('#agentCameraOffline'),
  cameraStatus: $('#eyesCameraStatus'),
  identityStatus: $('#eyesIdentityStatus'),
  micStatus: $('#eyesMicStatus'),
  voiceStatus: $('#eyesVoiceStatus'),
  transcriptStatus: $('#eyesTranscriptStatus'),
  healthStatus: $('#eyesHealthStatus'),
  peopleCount: $('#eyesPeopleCount'),
  knownCount: $('#eyesKnownCount'),
  groupCount: $('#eyesGroupCount'),
  faceCount: $('#eyesFaceCount'),
  bodyCount: $('#eyesBodyCount'),
  micDb: $('#eyesMicDb'),
  noiseDb: $('#eyesNoiseDb'),
  vad: $('#eyesVad'),
  audioPath: $('#eyesAudioPath'),
  radarTracks: $('#agentRadarTracks'),
  participants: $('#eyesParticipants'),
  activeSpeaker: $('#agentActiveSpeaker'),
  activeSpeakerName: $('#agentActiveSpeakerName'),
  activeSpeakerMeta: $('#agentActiveSpeakerMeta'),
  stateJson: $('#roomStateJson'),
  copyState: $('#copyRoomState'),
  events: $('#eyesEventFeed'),
  dialogue: $('#eyesDialogue'),
  dialogueStatus: $('#eyesDialogueStatus'),
  eventBusStatus: $('#eventBusStatus')
};

const overlayCtx = ui.overlay.getContext('2d');

const bus = new PerceptionEventBus();
const roomState = createRoomState('agent-eyes-room');

const runtime = {
  stream: null,
  running: false,
  scanTimer: 0,
  scanBusy: false,
  identity: new IdentityEngine(),
  identityReady: false,
  identityLoading: false,
  tracks: [],
  participants: [],
  trackCounter: 0,
  previousTrackIds: new Set(),
  previousKnownByTrack: new Map(),
  previousStatuses: new Map(),
  previousGroups: new Map(),
  faces: [],
  bodies: [],
  audio: null,
  audioActive: false,
  voiceEngine: new VoiceIdentityEngine(),
  voiceReady: false,
  voiceLoading: false,
  transcriber: new LocalTranscriptionEngine(),
  transcriptReady: false,
  transcriptLoading: false,
  audioQueue: [],
  audioProcessing: false,
  audioGeneration: 0,
  micDb: -100,
  noiseFloorDb: -60,
  vad: false,
  audioPath: 'offline',
  ttsPending: 0,
  startedAt: null,
  lastFrameAt: 0
};

const SCAN_INTERVAL_MS = 550;
const TRACK_GRACE_MS = BODY_OCCLUSION_GRACE_MS;
const PHOTO_REFRESH_INTERVAL_MS = 5000;

function emit(type, payload = {}) {
  return bus.emit(type, payload, {
    roomId: roomState.roomId,
    timestamp: Date.now()
  });
}

bus.subscribe('*', (event) => {
  applyPerceptionEvent(roomState, event);
  window.dispatchEvent(new CustomEvent('tracky:perception', {
    detail: event
  }));
  renderEventFeed();
  renderRoomState();
});

window.TrackyAgentEyes = Object.freeze({
  getState() {
    return roomStateSnapshot(roomState);
  },
  subscribe(type, listener) {
    return bus.subscribe(type, listener);
  },
  eventTypes: PERCEPTION_EVENT_TYPES
});

function nextTrackId() {
  runtime.trackCounter += 1;
  return 'T' + String(runtime.trackCounter).padStart(3, '0');
}

function participantById(id) {
  return runtime.participants.find((participant) => participant.id === id) || null;
}

async function reloadParticipants() {
  try {
    runtime.participants = await listParticipants();
  } catch (error) {
    console.error(error);
    runtime.participants = [];
  }
}

function emitSensor(sensor, status) {
  emit('sensor.status', {
    source: sensor,
    data: { sensor, status }
  });
}

function setHealth(status, warning = null) {
  const warningIsNew = Boolean(
    warning && !roomState.health.warnings.includes(warning)
  );
  if (
    roomState.health.perception === status &&
    !warningIsNew
  ) {
    return;
  }

  if (warningIsNew) roomState.health.warnings.push(warning);

  emit('room.state_changed', {
    source: 'perception-runtime',
    data: {
      status: runtime.running || runtime.audioActive ? 'active' : 'standby',
      health: status
    }
  });
}

async function enumerateCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const current = ui.cameraSelect.value;

  ui.cameraSelect.replaceChildren();
  cameras.forEach((camera, index) => {
    const option = document.createElement('option');
    option.value = camera.deviceId;
    option.textContent = camera.label || 'Camera ' + (index + 1);
    ui.cameraSelect.append(option);
  });

  if (cameras.some((camera) => camera.deviceId === current)) {
    ui.cameraSelect.value = current;
  }
  ui.cameraSelect.disabled = cameras.length < 2;
}

async function ensureIdentity() {
  if (runtime.identityReady) return true;
  if (runtime.identityLoading) {
    try {
      await runtime.identity.init();
      runtime.identityReady = true;
      return true;
    } catch {
      return false;
    }
  }

  runtime.identityLoading = true;
  ui.identityStatus.textContent = 'Loading models…';
  emitSensor('identity', 'loading');

  try {
    await runtime.identity.init();
    runtime.identityReady = true;
    ui.identityStatus.textContent = 'Online';
    emitSensor('identity', 'online');
    return true;
  } catch (error) {
    console.error(error);
    ui.identityStatus.textContent = 'Unavailable';
    emitSensor('identity', 'error');
    setHealth('degraded', 'Identity model unavailable');
    return false;
  } finally {
    runtime.identityLoading = false;
  }
}

async function ensureVoice() {
  if (runtime.voiceReady) return true;
  if (runtime.voiceLoading) {
    try {
      await runtime.voiceEngine.init();
      runtime.voiceReady = true;
      return true;
    } catch {
      return false;
    }
  }

  runtime.voiceLoading = true;
  ui.voiceStatus.textContent = 'Loading…';
  emitSensor('voice', 'loading');

  try {
    await runtime.voiceEngine.init();
    runtime.voiceReady = true;
    ui.voiceStatus.textContent = 'Online';
    emitSensor('voice', 'online');
    return true;
  } catch (error) {
    console.error(error);
    ui.voiceStatus.textContent = 'Unavailable';
    emitSensor('voice', 'error');
    setHealth('degraded', 'Voice Profile model unavailable');
    return false;
  } finally {
    runtime.voiceLoading = false;
  }
}

async function ensureTranscriber() {
  if (runtime.transcriptReady) return true;
  if (runtime.transcriptLoading) {
    try {
      await runtime.transcriber.init();
      runtime.transcriptReady = true;
      return true;
    } catch {
      return false;
    }
  }

  runtime.transcriptLoading = true;
  ui.transcriptStatus.textContent = 'Loading…';
  emitSensor('transcription', 'loading');

  try {
    await runtime.transcriber.init();
    runtime.transcriptReady = true;
    ui.transcriptStatus.textContent = 'Online';
    emitSensor('transcription', 'online');
    return true;
  } catch (error) {
    console.error(error);
    ui.transcriptStatus.textContent = 'Unavailable';
    emitSensor('transcription', 'error');
    setHealth('degraded', 'Transcription model unavailable');
    return false;
  } finally {
    runtime.transcriptLoading = false;
  }
}

async function startEyes(deviceId = '') {
  stopCamera();

  if (!navigator.mediaDevices?.getUserMedia) {
    ui.cameraStatus.textContent = 'Unsupported';
    emitSensor('camera', 'unsupported');
    return false;
  }

  try {
    await reloadParticipants();
    ui.cameraStatus.textContent = 'Requesting…';

    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 }
    };

    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { ideal: 'user' };

    runtime.stream = await navigator.mediaDevices.getUserMedia({
      video,
      audio: false
    });

    ui.video.srcObject = runtime.stream;
    await ui.video.play();
    await enumerateCameras();

    runtime.running = true;
    runtime.startedAt = Date.now();
    ui.offline.hidden = true;
    ui.startEyes.disabled = true;
    ui.stop.disabled = false;
    ui.cameraStatus.textContent = 'Live';
    emitSensor('camera', 'online');
    setHealth('online');

    resizeOverlay();
    const identityReady = await ensureIdentity();
    if (identityReady) scheduleScan(0);
    return true;
  } catch (error) {
    console.error(error);
    ui.cameraStatus.textContent = window.isSecureContext ? 'Unavailable' : 'HTTPS required';
    emitSensor('camera', 'error');
    setHealth('degraded', 'Camera unavailable');
    return false;
  }
}

function stopCamera() {
  clearTimeout(runtime.scanTimer);
  runtime.scanTimer = 0;
  runtime.running = false;
  runtime.scanBusy = false;

  runtime.stream?.getTracks().forEach((track) => track.stop());
  runtime.stream = null;
  ui.video.srcObject = null;
  ui.offline.hidden = false;
  ui.startEyes.disabled = false;
  ui.cameraSelect.disabled = true;
  ui.cameraStatus.textContent = 'Offline';
  emitSensor('camera', 'offline');

  runtime.faces = [];
  runtime.bodies = [];
  runtime.tracks = [];
  runtime.previousTrackIds.clear();
  runtime.previousKnownByTrack.clear();
  runtime.previousStatuses.clear();
  runtime.previousGroups.clear();
  drawOverlay();
  renderAll();
}

function stopPerception() {
  stopRoomAudio();
  stopCamera();
  ui.stop.disabled = true;
  setHealth('standby');
}

function scheduleScan(delay = SCAN_INTERVAL_MS) {
  clearTimeout(runtime.scanTimer);
  if (!runtime.running || !runtime.identityReady) return;
  runtime.scanTimer = setTimeout(() => void scanRoom(), delay);
}

function facePhoto(track) {
  if (!track.face?.box) return null;
  return cropFacePhoto(ui.video, track.face.box, {
    mirror: true,
    size: 260,
    quality: 0.84
  });
}

async function resolveIdentity(track, excludedParticipantIds) {
  if (!track.embedding || track.participantId) return track;

  const blocked = new Set([
    ...(track.blockedParticipantIds || []),
    ...excludedParticipantIds
  ]);

  const match = bestParticipantMatch(
    track.embedding,
    runtime.participants.filter((participant) => !blocked.has(participant.id))
  );

  if (!match.matched) {
    return {
      ...track,
      status: match.ambiguous ? 'ambiguous' : 'new',
      similarity: match.similarity
    };
  }

  const resolved = {
    ...track,
    participantId: match.participant.id,
    participantName: match.participant.name,
    similarity: match.similarity,
    status: 'matched',
    scanProgress: 100,
    identitySource: 'face'
  };

  try {
    await patchParticipant(match.participant.id, {
      latestPhoto: track.latestPhoto || match.participant.latestPhoto || match.participant.primaryPhoto,
      lastSeenAt: new Date().toISOString()
    });
    await reloadParticipants();
  } catch (error) {
    console.error('Could not refresh recognized participant profile', error);
  }

  return resolved;
}

function roomPosition(track) {
  return {
    x: Number(track.cx || 0.5),
    y: Number(track.cy || 0.5),
    box: track.box ? {
      x: track.box.x,
      y: track.box.y,
      width: track.box.width,
      height: track.box.height
    } : null
  };
}

function emitTrackTransitions(previousTracks, currentTracks) {
  const previousById = new Map(previousTracks.map((track) => [track.id, track]));
  const currentById = new Map(currentTracks.map((track) => [track.id, track]));

  for (const track of currentTracks) {
    const previous = previousById.get(track.id);
    const participant = track.participantId ? participantById(track.participantId) : null;
    const payload = {
      participantId: track.participantId || null,
      participantName: track.participantName || participant?.name || null,
      trackId: track.id,
      confidence: track.similarity || 0,
      source: track.identitySource || 'body',
      roomPosition: roomPosition(track),
      conversationGroup: track.conversationGroupId || null,
      evidence: {
        bodyScore: track.bodyScore || 0,
        faceQuality: track.quality || 0,
        faceVisible: Boolean(track.face)
      }
    };

    if (!previous) {
      emit('participant.detected', payload);
      emit('participant.entered', payload);
    }

    if (track.face && !previous?.face) {
      emit('face.visible', payload);
    }
    if (!track.face && previous?.face) {
      emit('face.hidden', payload);
    }

    if (track.participantId && (!previous?.participantId || previous.participantId !== track.participantId)) {
      emit('face.matched', payload);
      emit('participant.recognized', payload);
    }

    const previousStatus = previous?.status || null;
    if (track.status === 'matched' || track.status === 'body-lock') {
      if (previousStatus === 'occluded' || previousStatus === 'reacquiring') {
        emit('body.reacquired', payload);
        emit('participant.reacquired', payload);
      } else if (previousStatus !== 'matched' && previousStatus !== 'body-lock') {
        emit('body.locked', payload);
      }
    }

    if (track.status === 'occluded' && previousStatus !== 'occluded') {
      emit('body.occluded', payload);
    }

    if (
      !track.participantId &&
      track.scanProgress >= 100 &&
      track.embedding &&
      previous?.scanProgress < 100
    ) {
      emit('face.capture_ready', payload);
    }
  }

  for (const previous of previousTracks) {
    if (currentById.has(previous.id)) continue;
    emit('participant.left', {
      participantId: previous.participantId || null,
      participantName: previous.participantName || null,
      trackId: previous.id,
      source: 'body',
      roomPosition: roomPosition(previous)
    });
  }
}

function updateGroups() {
  const groups = buildConversationGroups(runtime.tracks);
  const nextGroups = new Map();

  groups.forEach((group, index) => {
    if (group.length < 2) {
      for (const track of group) track.conversationGroupId = 'SOLO';
      return;
    }

    const groupId = 'G' + String(index + 1).padStart(2, '0');
    const participantIds = group.map((track) => track.participantId).filter(Boolean);
    const trackIds = group.map((track) => track.id);
    const signature = [...trackIds].sort().join('|');

    nextGroups.set(groupId, { groupId, participantIds, trackIds, signature });

    for (const track of group) track.conversationGroupId = groupId;

    const previous = runtime.previousGroups.get(groupId);
    if (!previous) {
      emit('conversation.started', {
        conversationGroup: groupId,
        source: 'body-proximity',
        data: { participantIds, trackIds }
      });
      continue;
    }

    if (previous.signature !== signature) {
      const oldTracks = new Set(previous.trackIds || []);
      const newTracks = new Set(trackIds);

      for (const track of group) {
        if (!oldTracks.has(track.id)) {
          emit('conversation.participant_joined', {
            participantId: track.participantId || null,
            participantName: track.participantName || null,
            trackId: track.id,
            conversationGroup: groupId,
            source: 'body-proximity',
            roomPosition: roomPosition(track)
          });
        }
      }

      for (const oldTrackId of oldTracks) {
        if (!newTracks.has(oldTrackId)) {
          const old = runtime.tracks.find((track) => track.id === oldTrackId);
          emit('conversation.participant_left', {
            participantId: old?.participantId || null,
            participantName: old?.participantName || null,
            trackId: oldTrackId,
            conversationGroup: groupId,
            source: 'body-proximity'
          });
        }
      }
    }
  });

  for (const [groupId, previous] of runtime.previousGroups) {
    if (nextGroups.has(groupId)) continue;
    emit('conversation.ended', {
      conversationGroup: groupId,
      source: 'body-proximity',
      data: {
        participantIds: previous.participantIds,
        trackIds: previous.trackIds
      }
    });
  }

  runtime.previousGroups = nextGroups;
}

async function scanRoom() {
  if (
    !runtime.running ||
    runtime.scanBusy ||
    !runtime.identityReady ||
    ui.video.readyState < 2
  ) {
    scheduleScan();
    return;
  }

  runtime.scanBusy = true;
  const now = performance.now();
  const previousTracks = runtime.tracks;

  try {
    const room = await runtime.identity.detectRoom(ui.video);
    runtime.faces = room.faces || [];
    runtime.bodies = augmentBodiesWithFaceFallbacks(
      runtime.faces,
      room.bodies || []
    );

    let liveTracks = assignBodyTracks(
      previousTracks,
      runtime.bodies,
      now,
      { nextId: nextTrackId }
    );

    const assignments = associateFacesToBodies(runtime.faces, runtime.bodies);
    liveTracks = attachFacesToTracks(
      liveTracks,
      runtime.faces,
      runtime.bodies,
      assignments,
      now
    );

    liveTracks = liveTracks.map((track) => {
      if (!track.face) {
        return {
          ...track,
          status: track.participantId
            ? roomPresenceState(track, now)
            : 'body-detected',
          scanProgress: track.participantId ? 100 : track.scanProgress
        };
      }

      if (track.participantId) {
        const shouldRefresh = (
          track.quality >= 0.52 &&
          (
            !track.latestPhoto ||
            now - Number(track.lastPhotoCaptureAt || 0) >= PHOTO_REFRESH_INTERVAL_MS
          )
        );
        const photo = shouldRefresh ? facePhoto(track) : null;

        return {
          ...track,
          status: 'matched',
          scanProgress: 100,
          latestPhoto: photo || track.latestPhoto,
          lastPhotoCaptureAt: photo ? now : track.lastPhotoCaptureAt
        };
      }

      const advanced = advanceScan(track, {
        minQuality: 0.48,
        increment: 24,
        decay: 7
      });

      if (
        advanced.face?.box &&
        advanced.quality >= 0.52 &&
        (
          !advanced.latestPhoto ||
          now - Number(advanced.lastPhotoCaptureAt || 0) >= PHOTO_REFRESH_INTERVAL_MS
        )
      ) {
        const photo = facePhoto(advanced);
        if (photo) {
          advanced.latestPhoto = photo;
          advanced.lastPhotoCaptureAt = now;
        }
      }

      return advanced;
    });

    const carried = carryOccludedTracks(
      previousTracks,
      liveTracks,
      now,
      TRACK_GRACE_MS
    );

    const claimed = new Set(
      liveTracks
        .filter((track) => track.participantId)
        .map((track) => track.participantId)
    );

    const resolved = [];
    for (const track of liveTracks) {
      if (
        track.scanProgress >= 100 &&
        track.embedding &&
        !track.participantId &&
        track.status !== 'new'
      ) {
        const next = await resolveIdentity(track, claimed);
        if (next.participantId) claimed.add(next.participantId);
        resolved.push(next);
      } else {
        resolved.push(track);
      }
    }

    const liveKnownIds = new Set(
      resolved.filter((track) => track.participantId).map((track) => track.participantId)
    );

    runtime.tracks = dedupeParticipantAssignments([
      ...resolved,
      ...carried.filter(
        (track) => !track.participantId || !liveKnownIds.has(track.participantId)
      )
    ]);

    updateGroups();
    emitTrackTransitions(previousTracks, runtime.tracks);
    drawOverlay();
    renderAll();

    ui.identityStatus.textContent =
      runtime.tracks.length + ' tracked · ' +
      runtime.tracks.filter((track) => track.participantId).length + ' known';
    setHealth('online');
  } catch (error) {
    console.error(error);
    ui.identityStatus.textContent = 'Scan error';
    setHealth('degraded', 'Room scan error');
  } finally {
    runtime.scanBusy = false;
    scheduleScan();
  }
}

function resizeOverlay() {
  const rect = ui.video.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (ui.overlay.width !== width) ui.overlay.width = width;
  if (ui.overlay.height !== height) ui.overlay.height = height;
}

function drawOverlay() {
  resizeOverlay();
  const width = ui.overlay.width;
  const height = ui.overlay.height;
  overlayCtx.clearRect(0, 0, width, height);

  for (const track of runtime.tracks) {
    if (!track.box) continue;

    const mirroredX = 1 - track.box.x - track.box.width;
    const x = mirroredX * width;
    const y = track.box.y * height;
    const w = track.box.width * width;
    const h = track.box.height * height;

    const known = Boolean(track.participantId);
    overlayCtx.strokeStyle = known ? '#5cff9d' : '#4ee8ff';
    overlayCtx.fillStyle = known ? '#5cff9d' : '#4ee8ff';
    overlayCtx.lineWidth = Math.max(2, width / 600);
    overlayCtx.strokeRect(x, y, w, h);

    const label = (
      (track.participantName || track.id) +
      (track.conversationGroupId && track.conversationGroupId !== 'SOLO'
        ? ' · ' + track.conversationGroupId
        : '')
    );

    overlayCtx.font = Math.max(12, width / 65) + 'px ui-monospace, monospace';
    const labelWidth = overlayCtx.measureText(label).width + 16;
    const labelHeight = Math.max(22, height / 24);

    overlayCtx.globalAlpha = 0.86;
    overlayCtx.fillRect(x, Math.max(0, y - labelHeight), labelWidth, labelHeight);
    overlayCtx.globalAlpha = 1;
    overlayCtx.fillStyle = '#021014';
    overlayCtx.fillText(
      label,
      x + 8,
      Math.max(16, y - labelHeight + labelHeight * 0.7)
    );

    if (track.face?.box) {
      const face = track.face.box;
      const fx = (1 - face.x - face.width) * width;
      const fy = face.y * height;
      overlayCtx.strokeStyle = '#ffd166';
      overlayCtx.lineWidth = Math.max(1, width / 900);
      overlayCtx.strokeRect(
        fx,
        fy,
        face.width * width,
        face.height * height
      );
    }
  }
}

function statusText(track) {
  if (track.status === 'matched') return 'FACE + BODY LOCK';
  if (track.status === 'body-lock') return 'BODY LOCK';
  if (track.status === 'occluded') return 'OCCLUSION MEMORY';
  if (track.status === 'ambiguous') return 'IDENTITY AMBIGUOUS';
  if (track.status === 'new') return 'NEW PARTICIPANT';
  return 'TRACKING';
}

async function enrollUnknownTrack(track) {
  if (!track.embedding || !track.latestPhoto) return;

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

function renderParticipants() {
  ui.participants.replaceChildren();

  const tracks = runtime.tracks
    .filter((track) => performance.now() - Number(track.lastBodySeenAt || track.lastSeenAt || 0) < TRACK_GRACE_MS)
    .slice(0, 10);

  if (!tracks.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent = 'No participants are currently tracked.';
    ui.participants.append(empty);
    return;
  }

  for (const track of tracks) {
    const participant = track.participantId ? participantById(track.participantId) : null;
    const voice = voiceProfileReadiness(participant || {});

    const card = document.createElement('article');
    card.className = 'agent-entity-card';
    if (track.participantId) card.classList.add('known');
    if (track.status === 'occluded') card.classList.add('occluded');

    const portrait = document.createElement('div');
    portrait.className = 'agent-entity-photo';
    const photo = track.latestPhoto || participant?.primaryPhoto;
    if (photo) {
      const img = document.createElement('img');
      img.src = photo;
      img.alt = '';
      portrait.append(img);
    } else {
      portrait.textContent = (track.participantName || track.id).slice(0, 1);
    }

    const copy = document.createElement('div');
    copy.className = 'agent-entity-copy';

    const name = document.createElement('strong');
    name.textContent = track.participantName || 'Unknown participant';

    const meta = document.createElement('span');
    meta.textContent = track.id + ' · ' + statusText(track);

    const signals = document.createElement('div');
    signals.className = 'agent-entity-signals';

    const rows = [
      ['FACE', track.face ? Math.round((track.similarity || track.quality || 0) * 100) + '%' : 'NOT VISIBLE'],
      ['BODY', track.status === 'occluded' ? 'MEMORY' : 'LOCK'],
      ['VOICE', participant ? (voice.ready ? 'PROFILE READY' : voice.embeddingCount + '/3') : 'UNKNOWN'],
      ['GROUP', track.conversationGroupId || '—']
    ];

    for (const [label, value] of rows) {
      const item = document.createElement('span');
      const key = document.createElement('i');
      const val = document.createElement('b');
      key.textContent = label;
      val.textContent = value;
      item.append(key, val);
      signals.append(item);
    }

    copy.append(name, meta, signals);
    card.append(portrait, copy);

    if (!track.participantId && track.embedding && track.latestPhoto) {
      const action = document.createElement('button');
      action.className = 'agent-entity-action';
      action.type = 'button';
      action.textContent = 'Identify';
      action.addEventListener('click', () => enrollUnknownTrack(track));
      card.append(action);
    }

    ui.participants.append(card);
  }
}

function renderRadar() {
  ui.radarTracks.replaceChildren();

  for (const track of runtime.tracks) {
    const dot = document.createElement('div');
    dot.className = 'radar-track ' + (track.participantId ? 'identified' : 'unknown');
    if (track.status === 'occluded') dot.classList.add('occluded');
    if (
      roomState.activeSpeaker &&
      (
        roomState.activeSpeaker.trackId === track.id ||
        roomState.activeSpeaker.participantId === track.participantId
      )
    ) {
      dot.classList.add('speaking');
    }

    dot.style.left = (Number(track.cx || 0.5) * 100) + '%';
    dot.style.top = (Number(track.cy || 0.5) * 100) + '%';

    const label = document.createElement('span');
    label.textContent =
      (track.participantName || track.id) +
      (track.conversationGroupId && track.conversationGroupId !== 'SOLO'
        ? ' · ' + track.conversationGroupId
        : '');

    dot.append(label);
    ui.radarTracks.append(dot);
  }
}

function eventLabel(event) {
  switch (event.type) {
    case 'participant.detected':
      return 'New room track ' + (event.trackId || '');
    case 'participant.recognized':
      return 'Participant recognized: ' + (event.participantName || event.participantId);
    case 'participant.left':
      return (event.participantName || event.trackId || 'Participant') + ' left tracking';
    case 'participant.reacquired':
      return (event.participantName || event.trackId) + ' reacquired';
    case 'body.occluded':
      return (event.participantName || event.trackId) + ' temporarily occluded';
    case 'face.capture_ready':
      return (event.trackId || 'Face') + ' capture ready';
    case 'voice.activity_started':
      return 'Speaker: ' + (event.participantName || 'Unknown voice');
    case 'conversation.started':
      return 'Conversation ' + event.conversationGroup + ' detected';
    case 'conversation.ended':
      return 'Conversation ' + event.conversationGroup + ' ended';
    case 'face.hidden':
      return (event.participantName || event.trackId || 'Face') + ' face out of view';
    case 'conversation.participant_joined':
      return (event.participantName || event.trackId) + ' joined ' + event.conversationGroup;
    case 'transcript.turn':
      return (event.participantName || 'Unknown speaker') + ': ' + String(event.data?.text || '');
    case 'sensor.status':
      return String(event.data?.sensor || 'sensor') + ' → ' + String(event.data?.status || '');
    default:
      return event.type;
  }
}

function renderEventFeed() {
  ui.events.replaceChildren();
  const events = roomState.recentEvents.slice(-20).reverse();

  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent = 'Waiting for perception events.';
    ui.events.append(empty);
    return;
  }

  for (const event of events) {
    const row = document.createElement('div');
    row.className = 'agent-event-row';

    const time = document.createElement('span');
    time.textContent = new Date(event.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const type = document.createElement('i');
    type.textContent = event.type;

    const message = document.createElement('b');
    message.textContent = eventLabel(event);

    row.append(time, type, message);
    ui.events.append(row);
  }
}

function renderDialogue() {
  ui.dialogue.replaceChildren();
  const turns = roomState.transcript.slice(-12).reverse();

  if (!turns.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent = runtime.audioActive
      ? 'Listening for an accepted speech turn.'
      : 'Enable room audio to begin speaker-attributed dialogue.';
    ui.dialogue.append(empty);
    return;
  }

  for (const turn of turns) {
    const card = document.createElement('article');
    card.className = 'agent-dialogue-turn';

    const top = document.createElement('div');
    const speaker = document.createElement('strong');
    speaker.textContent = turn.participantName || 'Unknown speaker';
    const meta = document.createElement('span');
    meta.textContent = [
      turn.conversationGroup,
      turn.trackId,
      Math.round((turn.confidence || 0) * 100) + '%'
    ].filter(Boolean).join(' · ');
    top.append(speaker, meta);

    const text = document.createElement('p');
    text.textContent = turn.text || '[speech turn]';

    const nearby = document.createElement('small');
    nearby.textContent = turn.nearbyParticipants?.length
      ? 'Nearby: ' + turn.nearbyParticipants.join(', ')
      : 'No nearby participant context';

    card.append(top, text, nearby);
    ui.dialogue.append(card);
  }
}

function renderActiveSpeaker() {
  const speaker = roomState.activeSpeaker;
  ui.activeSpeaker.hidden = !speaker;
  if (!speaker) return;

  ui.activeSpeakerName.textContent =
    speaker.participantName || speaker.trackId || 'Unknown voice';
  ui.activeSpeakerMeta.textContent = [
    speaker.conversationGroup,
    speaker.confidence ? Math.round(speaker.confidence * 100) + '% voice' : null
  ].filter(Boolean).join(' · ') || 'speech detected';
}

function renderRoomState() {
  const snapshot = roomStateSnapshot(roomState);
  ui.stateJson.textContent = JSON.stringify(snapshot, null, 2);

  ui.peopleCount.textContent = String(
    snapshot.participants.length + snapshot.unknownTracks.length
  );
  ui.knownCount.textContent = String(snapshot.participants.length);
  ui.groupCount.textContent = String(
    snapshot.conversationGroups.filter((group) => group.trackIds?.length > 1).length
  );

  ui.healthStatus.textContent = snapshot.health.perception;
  renderDialogue();
  renderActiveSpeaker();
}

function renderSignals() {
  ui.faceCount.textContent = String(runtime.faces.length);
  ui.bodyCount.textContent = String(runtime.bodies.length);
  ui.micDb.textContent = Number.isFinite(runtime.micDb)
    ? runtime.micDb.toFixed(1) + ' dB'
    : '— dB';
  ui.noiseDb.textContent = Number.isFinite(runtime.noiseFloorDb)
    ? runtime.noiseFloorDb.toFixed(1) + ' dB'
    : '— dB';
  ui.vad.textContent = runtime.vad ? 'SPEECH' : 'QUIET';
  ui.vad.dataset.active = runtime.vad ? 'true' : 'false';
  ui.audioPath.textContent =
    runtime.audioPath === 'audio-worklet'
      ? 'AudioWorklet'
      : runtime.audioPath === 'script-processor-fallback'
        ? 'Compatibility'
        : 'Offline';
}

function renderAll() {
  updateGroups();
  renderParticipants();
  renderRadar();
  renderSignals();
  renderRoomState();
}

function suppressMicForSpeech() {
  runtime.ttsPending += 1;
  runtime.audio?.setSuppressed(true);
}

function releaseMicAfterSpeech() {
  runtime.ttsPending = Math.max(0, runtime.ttsPending - 1);
  if (runtime.ttsPending !== 0) return;
  setTimeout(() => {
    if (runtime.ttsPending === 0) runtime.audio?.setSuppressed(false);
  }, 350);
}

function speak(message) {
  if (!ui.spokenAcks.checked || !('speechSynthesis' in window)) return;

  suppressMicForSpeech();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 1.02;
  utterance.pitch = 0.92;
  utterance.volume = 0.72;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    releaseMicAfterSpeech();
  };

  const timer = setTimeout(release, 12000);
  utterance.addEventListener('end', release, { once: true });
  utterance.addEventListener('error', release, { once: true });

  try {
    speechSynthesis.speak(utterance);
  } catch (error) {
    console.error(error);
    release();
  }
}

bus.subscribe('participant.recognized', (event) => {
  if (event.participantName) speak('Participant recognized. ' + event.participantName + '.');
});

bus.subscribe('participant.detected', (event) => {
  if (!event.participantId) speak('New participant detected.');
});

function onAudioLevel(level) {
  runtime.micDb = level.db;
  runtime.noiseFloorDb = level.noiseFloorDb;
  runtime.vad = level.speaking;
  runtime.audioPath = level.captureMode || runtime.audioPath;
  ui.micStatus.textContent = level.speaking ? 'Speech detected' : 'Listening';
  renderSignals();
}

function roomTrackSnapshot() {
  return runtime.tracks.map((track) => ({
    id: track.id,
    participantId: track.participantId || null,
    participantName: track.participantName || null,
    cx: track.cx,
    cy: track.cy,
    status: track.status,
    conversationGroupId: track.conversationGroupId || null,
    box: track.box ? { ...track.box } : null
  }));
}

function queueAudioSegment(segment) {
  runtime.audioQueue.push({
    ...segment,
    generation: runtime.audioGeneration,
    roomTracks: roomTrackSnapshot()
  });
  if (runtime.audioQueue.length > 6) {
    runtime.audioQueue.splice(0, runtime.audioQueue.length - 6);
  }
  void drainAudioQueue();
}

function segmentIsCurrent(segment) {
  return runtime.audioActive && segment.generation === runtime.audioGeneration;
}

async function drainAudioQueue() {
  if (runtime.audioProcessing) return;
  const segment = runtime.audioQueue.shift();
  if (!segment) return;

  runtime.audioProcessing = true;
  try {
    await processSpeechSegment(segment);
  } finally {
    runtime.audioProcessing = false;
    if (runtime.audioQueue.length) void drainAudioQueue();
  }
}

async function processSpeechSegment(segment) {
  if (!segmentIsCurrent(segment)) return;

  const voiceReady = await ensureVoice();
  if (!voiceReady || !segmentIsCurrent(segment)) return;

  const embedding = await runtime.voiceEngine.embedding(segment.samples);
  if (!segmentIsCurrent(segment)) return;

  const voiceMatch = bestVoiceMatch(embedding, runtime.participants);
  const participant = voiceMatch.matched ? voiceMatch.participant : null;
  const tracks = segment.roomTracks || [];
  const groups = buildConversationGroups(tracks);
  const track = participant
    ? tracks.find((candidate) => candidate.participantId === participant.id)
    : null;

  const group = track ? conversationGroupForTrack(groups, track.id) : null;
  const nearby = (group?.tracks || [])
    .filter((candidate) => candidate.id !== track?.id)
    .map((candidate) => candidate.participantName || candidate.id);

  const gate = transcriptSignalGate({
    levelDb: segment.avgDb,
    noiseFloorDb: segment.noiseFloorDb,
    voiceConfidence: voiceMatch.matched ? voiceMatch.similarity : 0,
    bodyConfirmed: Boolean(track),
    vadConfirmed: true
  });

  const groupId = group
    ? (group.tracks.length > 1 ? group.id : 'SOLO')
    : null;

  emit('voice.activity_started', {
    participantId: participant?.id || null,
    participantName: participant?.name || null,
    trackId: track?.id || null,
    confidence: voiceMatch.matched ? voiceMatch.similarity : 0,
    source: 'voice-profile',
    roomPosition: track ? roomPosition(track) : null,
    nearbyParticipants: nearby,
    conversationGroup: groupId,
    evidence: {
      signalDb: gate.signalDb,
      ambiguous: voiceMatch.ambiguous,
      bodyConfirmed: Boolean(track)
    }
  });

  if (participant) {
    emit('voice.matched', {
      participantId: participant.id,
      participantName: participant.name,
      trackId: track?.id || null,
      confidence: voiceMatch.similarity,
      source: 'voice-profile',
      conversationGroup: groupId
    });
  }

  if (gate.accept && segmentIsCurrent(segment)) {
    const transcriptionReady = await ensureTranscriber();
    if (transcriptionReady && segmentIsCurrent(segment)) {
      const text = await runtime.transcriber.transcribe(segment.samples);
      if (segmentIsCurrent(segment) && text) {
        const event = emit('transcript.turn', {
          participantId: participant?.id || null,
          participantName: participant?.name || null,
          trackId: track?.id || null,
          confidence: gate.confidence,
          source: participant
            ? (track ? 'voice+body' : 'voice-profile')
            : 'unattributed',
          roomPosition: track ? roomPosition(track) : null,
          nearbyParticipants: nearby,
          conversationGroup: groupId,
          evidence: {
            voiceConfidence: voiceMatch.similarity,
            signalConfidence: gate.confidence,
            noiseFloorDb: segment.noiseFloorDb,
            peakDb: segment.peakDb
          },
          data: { text }
        });

        try {
          await saveDialogueTurn({
            id: event.id,
            participantId: participant?.id || null,
            participantName: participant?.name || null,
            trackId: track?.id || null,
            groupId,
            confidence: gate.confidence,
            voiceConfidence: voiceMatch.similarity,
            signalConfidence: gate.confidence,
            nearbyParticipantNames: nearby,
            transcript: text,
            createdAt: new Date(event.timestamp).toISOString(),
            sessionId: roomState.roomId
          });
        } catch (error) {
          console.error('Could not persist Agent Eyes dialogue turn', error);
        }
      }
    }
  }

  emit('voice.activity_stopped', {
    participantId: participant?.id || null,
    participantName: participant?.name || null,
    trackId: track?.id || null,
    source: 'voice-profile',
    conversationGroup: groupId
  });
}

async function startRoomAudio() {
  if (runtime.audioActive) return;

  runtime.audioGeneration += 1;

  try {
    await reloadParticipants();
    runtime.audio = new RoomAudioCapture({
      minSegmentSeconds: 1.05,
      hangoverMs: 650,
      onLevel: onAudioLevel,
      onSegment: async (segment) => queueAudioSegment(segment)
    });

    await runtime.audio.start();
    if (runtime.ttsPending > 0) runtime.audio.setSuppressed(true);

    runtime.audioActive = true;
    runtime.audioPath = runtime.audio.captureMode;
    ui.startEars.disabled = true;
    ui.stop.disabled = false;
    ui.micStatus.textContent = 'Listening';
    ui.dialogueStatus.textContent = 'Listening';
    ui.dialogueStatus.classList.add('ok');
    emitSensor('microphone', 'online');
    renderAll();
    void ensureVoice();
  } catch (error) {
    console.error(error);
    ui.micStatus.textContent = window.isSecureContext ? 'Unavailable' : 'HTTPS required';
    emitSensor('microphone', 'error');
    setHealth('degraded', 'Microphone unavailable');
  }
}

function stopRoomAudio() {
  runtime.audioGeneration += 1;
  void runtime.audio?.stop();
  runtime.audio = null;
  runtime.audioActive = false;
  runtime.audioQueue = [];
  runtime.vad = false;
  runtime.micDb = -100;
  runtime.audioPath = 'offline';
  ui.startEars.disabled = false;
  ui.micStatus.textContent = 'Offline';
  ui.dialogueStatus.textContent = 'Room audio off';
  ui.dialogueStatus.classList.remove('ok');
  emitSensor('microphone', 'offline');
  renderAll();
}

async function copySnapshot() {
  const text = JSON.stringify(roomStateSnapshot(roomState), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    ui.copyState.textContent = 'Copied';
    setTimeout(() => {
      ui.copyState.textContent = 'Copy JSON';
    }, 1200);
  } catch (error) {
    console.error(error);
    ui.stateJson.focus();
  }
}

function updateClock() {
  if (!runtime.running && !runtime.audioActive) {
    ui.clock.textContent = 'ROOM STANDBY';
    return;
  }

  const elapsed = runtime.startedAt
    ? Math.max(0, Date.now() - runtime.startedAt)
    : 0;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  ui.clock.textContent =
    'ROOM LIVE · ' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds % 60).padStart(2, '0');
}

ui.startEyes.addEventListener('click', () => void startEyes(ui.cameraSelect.value));
ui.startEars.addEventListener('click', () => void startRoomAudio());
ui.stop.addEventListener('click', stopPerception);
ui.cameraSelect.addEventListener('change', () => {
  if (runtime.running) void startEyes(ui.cameraSelect.value);
});
ui.copyState.addEventListener('click', () => void copySnapshot());
window.addEventListener('resize', () => {
  resizeOverlay();
  drawOverlay();
});
window.addEventListener('beforeunload', stopPerception);

await reloadParticipants();
renderAll();
renderEventFeed();
renderRoomState();
setHealth('standby');
setInterval(updateClock, 1000);
