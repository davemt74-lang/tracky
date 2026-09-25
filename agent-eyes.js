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
import {
  POSE_CONNECTIONS,
  buildBehaviorEvidence,
  inferWave,
  keypointMap
} from './src/behavior-core.js';
import {
  OBJECT_TRACK_GRACE_MS,
  assignObjectTracks,
  bestObjectInteractions,
  carryLostObjectTracks,
  interactionKey
} from './src/object-core.js';
import {
  SCENE_CHANGE_TYPES,
  createSceneState,
  normalizeZone,
  replaceSceneZones,
  sceneStateSnapshot,
  updateSceneState
} from './src/scene-core.js';
import {
  clearSceneMemory,
  listSceneChanges,
  listSceneEpisodes,
  loadSceneZones,
  saveSceneChanges,
  saveSceneEpisodes,
  saveSceneZones
} from './src/scene-store.js';
import {
  cameraCalibrationValid,
  cameraCoveragePolygon,
  cameraWithCoverage,
  mapCameraBox,
  mapCameraPoint,
  normalizeCameraConfig
} from './src/camera-core.js';
import {
  deleteCameraConfig,
  listCameraConfigs,
  saveCameraConfig
} from './src/camera-store.js';
import {
  updateWorldFusion
} from './src/fusion-core.js';
import {
  MultiCameraSensorRuntime
} from './src/multicamera-runtime.js';

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
  behaviorStatus: $('#eyesBehaviorStatus'),
  objectStatus: $('#eyesObjectStatus'),
  sceneStatus: $('#eyesSceneStatus'),
  fusionStatus: $('#eyesFusionStatus'),
  peopleCount: $('#eyesPeopleCount'),
  knownCount: $('#eyesKnownCount'),
  groupCount: $('#eyesGroupCount'),
  faceCount: $('#eyesFaceCount'),
  bodyCount: $('#eyesBodyCount'),
  micDb: $('#eyesMicDb'),
  noiseDb: $('#eyesNoiseDb'),
  vad: $('#eyesVad'),
  audioPath: $('#eyesAudioPath'),
  poseCount: $('#eyesPoseCount'),
  attentionCount: $('#eyesAttentionCount'),
  objectCount: $('#eyesObjectCount'),
  handCount: $('#eyesHandCount'),
  interactionCount: $('#eyesInteractionCount'),
  poseOverlay: $('#eyesPoseOverlay'),
  attentionOverlay: $('#eyesAttentionOverlay'),
  objectOverlay: $('#eyesObjectOverlay'),
  sceneOverlay: $('#eyesSceneOverlay'),
  radarZones: $('#agentRadarZones'),
  radarTracks: $('#agentRadarTracks'),
  participants: $('#eyesParticipants'),
  objects: $('#eyesObjects'),
  objectRuntimeStatus: $('#objectRuntimeStatus'),
  sceneRuntimeStatus: $('#sceneRuntimeStatus'),
  sceneActivityCount: $('#sceneActivityCount'),
  sceneMemoryObjectCount: $('#sceneMemoryObjectCount'),
  sceneEpisodeCount: $('#sceneEpisodeCount'),
  sceneChangeCount: $('#sceneChangeCount'),
  clearSceneMemory: $('#clearSceneMemory'),
  sceneChangeFeed: $('#sceneChangeFeed'),
  sceneEpisodeFeed: $('#sceneEpisodeFeed'),
  sceneChangeStatus: $('#sceneChangeStatus'),
  sceneEpisodeStatus: $('#sceneEpisodeStatus'),
  sceneZoneStatus: $('#sceneZoneStatus'),
  sceneZoneForm: $('#sceneZoneForm'),
  sceneZoneName: $('#sceneZoneName'),
  sceneZoneX: $('#sceneZoneX'),
  sceneZoneY: $('#sceneZoneY'),
  sceneZoneWidth: $('#sceneZoneWidth'),
  sceneZoneHeight: $('#sceneZoneHeight'),
  sceneZoneList: $('#sceneZoneList'),
  cameraNetworkStatus: $('#cameraNetworkStatus'),
  cameraRegistryForm: $('#cameraRegistryForm'),
  cameraRegistryDevice: $('#cameraRegistryDevice'),
  cameraRegistryName: $('#cameraRegistryName'),
  cameraRegistryRoom: $('#cameraRegistryRoom'),
  cameraCoverageX: $('#cameraCoverageX'),
  cameraCoverageY: $('#cameraCoverageY'),
  cameraCoverageWidth: $('#cameraCoverageWidth'),
  cameraCoverageHeight: $('#cameraCoverageHeight'),
  cameraRegistryList: $('#cameraRegistryList'),
  worldMapStatus: $('#worldMapStatus'),
  worldMapCoverage: $('#worldMapCoverage'),
  worldMapEntities: $('#worldMapEntities'),
  worldCameraCount: $('#worldCameraCount'),
  worldPersonCount: $('#worldPersonCount'),
  worldObjectCount: $('#worldObjectCount'),
  worldOverlapCount: $('#worldOverlapCount'),
  activeSpeaker: $('#agentActiveSpeaker'),
  activeSpeakerName: $('#agentActiveSpeakerName'),
  activeSpeakerMeta: $('#agentActiveSpeakerMeta'),
  stateJson: $('#roomStateJson'),
  copyState: $('#copyRoomState'),
  events: $('#eyesEventFeed'),
  dialogue: $('#eyesDialogue'),
  dialogueStatus: $('#eyesDialogueStatus'),
  eventBusStatus: $('#eventBusStatus'),
  inspector: $('#evidenceInspector'),
  inspectorName: $('#inspectorName'),
  inspectorTrack: $('#inspectorTrack'),
  inspectorIdentity: $('#inspectorIdentity'),
  inspectorPose: $('#inspectorPose'),
  inspectorOrientation: $('#inspectorOrientation'),
  inspectorPosture: $('#inspectorPosture'),
  inspectorMotion: $('#inspectorMotion'),
  inspectorGesture: $('#inspectorGesture'),
  inspectorAttention: $('#inspectorAttention'),
  inspectorAddressing: $('#inspectorAddressing'),
  inspectorSignals: $('#inspectorSignals'),
  inspectorLandmarkCount: $('#inspectorLandmarkCount'),
  inspectorLandmarks: $('#inspectorLandmarks'),
  inspectorJson: $('#inspectorJson'),
  closeInspector: $('#closeEvidenceInspector'),
  objectInspector: $('#objectEvidenceInspector'),
  objectInspectorName: $('#objectInspectorName'),
  objectInspectorTrack: $('#objectInspectorTrack'),
  objectInspectorClass: $('#objectInspectorClass'),
  objectInspectorConfidence: $('#objectInspectorConfidence'),
  objectInspectorStatus: $('#objectInspectorStatus'),
  objectInspectorHolder: $('#objectInspectorHolder'),
  objectInspectorMotion: $('#objectInspectorMotion'),
  objectInspectorInteraction: $('#objectInspectorInteraction'),
  objectInspectorSignals: $('#objectInspectorSignals'),
  objectInspectorJson: $('#objectInspectorJson'),
  closeObjectInspector: $('#closeObjectEvidenceInspector'),
  sceneInspector: $('#sceneEvidenceInspector'),
  sceneInspectorTitle: $('#sceneInspectorTitle'),
  sceneInspectorMeta: $('#sceneInspectorMeta'),
  sceneInspectorType: $('#sceneInspectorType'),
  sceneInspectorConfidence: $('#sceneInspectorConfidence'),
  sceneInspectorParticipant: $('#sceneInspectorParticipant'),
  sceneInspectorObject: $('#sceneInspectorObject'),
  sceneInspectorZone: $('#sceneInspectorZone'),
  sceneInspectorDuration: $('#sceneInspectorDuration'),
  sceneInspectorSummary: $('#sceneInspectorSummary'),
  sceneInspectorEvidence: $('#sceneInspectorEvidence'),
  sceneInspectorJson: $('#sceneInspectorJson'),
  closeSceneInspector: $('#closeSceneEvidenceInspector'),
  cameraCalibrationInspector: $('#cameraCalibrationInspector'),
  cameraCalibrationName: $('#cameraCalibrationName'),
  cameraCalibrationMeta: $('#cameraCalibrationMeta'),
  cameraCalibrationForm: $('#cameraCalibrationForm'),
  cameraTLX: $('#cameraTLX'),
  cameraTLY: $('#cameraTLY'),
  cameraTRX: $('#cameraTRX'),
  cameraTRY: $('#cameraTRY'),
  cameraBRX: $('#cameraBRX'),
  cameraBRY: $('#cameraBRY'),
  cameraBLX: $('#cameraBLX'),
  cameraBLY: $('#cameraBLY'),
  cameraCalibrationEnabled: $('#cameraCalibrationEnabled'),
  cameraCalibrationJson: $('#cameraCalibrationJson'),
  closeCameraCalibration: $('#closeCameraCalibration')
};

const overlayCtx = ui.overlay.getContext('2d');

const bus = new PerceptionEventBus();
const roomState = createRoomState('agent-eyes-room');
const sceneState = createSceneState(roomState.roomId);
const sceneListeners = new Set();
const cameraFusionListeners = new Set();

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
  objects: [],
  rawObjects: [],
  hands: [],
  gestures: [],
  objectCounter: 0,
  activeInteractions: new Map(),
  interactionCandidates: new Map(),
  relationDistances: new Map(),
  selectedObjectId: null,
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
  lastFrameAt: 0,
  behaviorByTrack: new Map(),
  wristHistory: new Map(),
  lastGestureAt: new Map(),
  selectedTrackId: null,
  selectedSceneRecord: null,
  cameraConfigs: [],
  cameraDevices: [],
  cameraStatuses: new Map(),
  cameraObservations: new Map(),
  fusionState: {
    schemaVersion: 1,
    roomId: 'ROOM01',
    updatedAt: Date.now(),
    participants: [],
    objects: []
  },
  worldObjectCounter: 0,
  selectedCalibrationCameraId: null,
  secondaryCameras: null,
  identityInference: Promise.resolve()
};

const SCAN_INTERVAL_MS = 550;
const TRACK_GRACE_MS = BODY_OCCLUSION_GRACE_MS;
const PHOTO_REFRESH_INTERVAL_MS = 5000;
const GESTURE_COOLDOWN_MS = 2500;
const OBJECT_GRACE_MS = OBJECT_TRACK_GRACE_MS;
const INTERACTION_COOLDOWN_MS = 900;

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
  getSceneState() {
    return sceneStateSnapshot(sceneState);
  },
  getWorldState() {
    return {
      room: roomStateSnapshot(roomState),
      scene: sceneStateSnapshot(sceneState),
      cameraFusion: structuredClone(runtime.fusionState)
    };
  },
  getCameraFusionState() {
    return structuredClone(runtime.fusionState);
  },
  getCameras() {
    return runtime.cameraConfigs.map((camera) => ({
      ...camera,
      homography: undefined
    }));
  },
  getChanges() {
    return sceneState.changes.slice();
  },
  getEpisodes() {
    return sceneState.episodes.slice();
  },
  subscribe(type, listener) {
    return bus.subscribe(type, listener);
  },
  subscribeScene(listener) {
    sceneListeners.add(listener);
    return () => sceneListeners.delete(listener);
  },
  subscribeCameraFusion(listener) {
    cameraFusionListeners.add(listener);
    return () => cameraFusionListeners.delete(listener);
  },
  eventTypes: PERCEPTION_EVENT_TYPES,
  sceneChangeTypes: SCENE_CHANGE_TYPES
});



function nextWorldObjectId() {
  runtime.worldObjectCounter += 1;
  return 'WO' + String(runtime.worldObjectCounter).padStart(3, '0');
}

function cameraById(cameraId) {
  return runtime.cameraConfigs.find((camera) => camera.id === cameraId) || null;
}

function primaryCameraConfig() {
  return runtime.cameraConfigs.find((camera) => camera.primary) || null;
}

function cameraDeviceLabel(deviceId) {
  return runtime.cameraDevices.find((device) => device.deviceId === deviceId)?.label || 'Camera';
}

async function detectRoomSerial(input) {
  const task = runtime.identityInference.then(
    () => runtime.identity.detectRoom(input),
    () => runtime.identity.detectRoom(input)
  );
  runtime.identityInference = task.catch(() => {});
  return task;
}

function emitCameraStatus(cameraId, status) {
  const previous = runtime.cameraStatuses.get(cameraId);
  runtime.cameraStatuses.set(cameraId, status);
  if (previous === status) return;

  const camera = cameraById(cameraId);
  emit('camera.status', {
    source: 'camera-network',
    confidence: status === 'online' ? 1 : 0,
    data: {
      cameraId,
      cameraName: camera?.name || cameraId,
      status
    }
  });
}

function onSecondaryCameraStatus(cameraId, status) {
  emitCameraStatus(cameraId, status);
  if (status === 'offline') runtime.cameraObservations.delete(cameraId);
  renderCameraNetwork();
  updateCameraFusion(Date.now(), false);
}

function onSecondaryCameraObservation(cameraId, observation) {
  runtime.cameraObservations.set(cameraId, observation);
  updateCameraFusion(observation.timestamp || Date.now(), true);
}

function primaryParticipantObservations(camera) {
  if (!camera) return [];

  return runtime.tracks
    .filter((track) => track.presenceAnnounced && track.status !== 'reacquiring')
    .map((track) => {
      const mapped = mapCameraPoint(camera, {
        x: Number(track.cx || 0.5),
        y: Number(track.cy || 0.5)
      });
      return {
        kind: 'participant',
        cameraId: camera.id,
        roomId: camera.roomId,
        localTrackId: track.id,
        participantId: track.participantId || null,
        participantName: track.participantName || null,
        roomPosition: mapped,
        localPosition: {
          x: Number(track.cx || 0.5),
          y: Number(track.cy || 0.5)
        },
        faceConfidence: Number(track.similarity || track.quality || 0),
        bodyConfidence: Number(track.bodyScore || 0),
        poseConfidence: Number(track.behaviorEvidence?.poseConfidence || 0),
        continuityConfidence: track.status === 'matched' || track.status === 'body-lock'
          ? 0.94
          : track.status === 'occluded'
            ? 0.45
            : 0.68,
        status: track.status,
        behavior: track.behaviorEvidence || null,
        identitySource: track.identitySource || null
      };
    });
}

function primaryObjectObservations(camera) {
  if (!camera) return [];

  return runtime.objects
    .filter((object) => object.stable && object.status !== 'reacquiring')
    .map((object) => ({
      kind: 'object',
      cameraId: camera.id,
      roomId: camera.roomId,
      localObjectId: object.id,
      label: object.label,
      roomPosition: mapCameraPoint(camera, {
        x: Number(object.cx || 0.5),
        y: Number(object.cy || 0.5)
      }),
      localPosition: {
        x: Number(object.cx || 0.5),
        y: Number(object.cy || 0.5)
      },
      confidence: Number(object.score || 0),
      stable: true,
      status: object.status
    }));
}

function publishPrimaryCameraObservation(timestamp = Date.now()) {
  const camera = primaryCameraConfig();
  if (!camera || !runtime.running) return;

  runtime.cameraObservations.set(camera.id, {
    camera,
    timestamp,
    participants: primaryParticipantObservations(camera),
    objects: primaryObjectObservations(camera),
    counts: {
      faces: runtime.faces.length,
      bodies: runtime.bodies.length,
      objects: runtime.rawObjects.length,
      hands: runtime.hands.length
    }
  });
  emitCameraStatus(camera.id, 'online');
}

function publishFusionEvent(event) {
  if (event.type === 'camera.handoff') {
    emit('camera.handoff', {
      participantId: event.participantId,
      participantName: event.participantName,
      confidence: event.confidence,
      source: 'multi-camera-fusion',
      roomPosition: event.roomPosition,
      data: {
        fromCameraId: event.fromCameraId,
        toCameraId: event.toCameraId
      }
    });
  }

  if (event.type === 'camera.overlap_fused') {
    emit('camera.overlap_fused', {
      participantId: event.participantId,
      participantName: event.participantName,
      confidence: event.confidence,
      source: 'multi-camera-fusion',
      roomPosition: event.roomPosition,
      data: {
        cameraIds: event.cameraIds
      }
    });
  }
}

function updateCameraFusion(now = Date.now(), updateScene = false) {
  const activeObservations = [...runtime.cameraObservations.values()]
    .filter((observation) => now - Number(observation.timestamp || 0) <= 3000);

  const participantObservations = activeObservations.flatMap(
    (observation) => observation.participants || []
  );
  const objectObservations = activeObservations.flatMap(
    (observation) => observation.objects || []
  );

  const result = updateWorldFusion(
    runtime.fusionState,
    participantObservations,
    objectObservations,
    now,
    {
      roomId: primaryCameraConfig()?.roomId || runtime.fusionState.roomId || 'ROOM01',
      nextId: nextWorldObjectId
    }
  );

  runtime.fusionState = result.state;
  for (const event of result.events) publishFusionEvent(event);

  const detail = structuredClone(runtime.fusionState);
  for (const listener of cameraFusionListeners) listener(detail);
  window.dispatchEvent(new CustomEvent('tracky:camera-fusion', {
    detail
  }));

  renderCameraNetwork();
  renderWorldMap();
  renderRoomState();

  if (updateScene) updateSceneIntelligence(now);
}

function sceneInputSnapshot() {
  const room = roomStateSnapshot(roomState);
  const fused = runtime.fusionState;
  const roomKnown = new Map(
    (room.participants || []).map((participant) => [participant.id, participant])
  );

  const participants = (fused.participants || []).map((entity) => {
    const local = entity.participantId
      ? roomKnown.get(entity.participantId)
      : null;
    const bestObservation = entity.observations?.[0] || null;

    return {
      id: entity.participantId || null,
      name: entity.participantName || entity.id,
      trackId: entity.id,
      presence: entity.status === 'last-known' ? 'active' : 'active',
      position: entity.roomPosition,
      behavior: bestObservation?.behavior || local?.behavior || null,
      attention: local?.attention || null,
      addressing: local?.addressing || null,
      conversationGroup: local?.conversationGroup || null,
      voiceStatus: local?.voiceStatus || 'quiet',
      cameraIds: entity.cameraIds,
      primaryCameraId: entity.primaryCameraId,
      fusionConfidence: entity.confidence
    };
  });

  const primaryId = primaryCameraConfig()?.id;
  const objectIdMap = new Map();
  for (const object of fused.objects || []) {
    for (const observation of object.observations || []) {
      objectIdMap.set(
        observation.cameraId + ':' + observation.localObjectId,
        object.id
      );
    }
  }

  const interactions = (room.interactions || []).map((interaction) => ({
    ...interaction,
    objectId: objectIdMap.get(
      (primaryId || '') + ':' + interaction.objectId
    ) || interaction.objectId
  }));

  return {
    ...room,
    participants,
    objects: (fused.objects || [])
      .filter((object) => object.status === 'visible')
      .map((object) => ({
        id: object.id,
        label: object.label,
        score: object.confidence,
        position: object.roomPosition,
        holderParticipantId: null,
        cameraIds: object.cameraIds,
        primaryCameraId: object.primaryCameraId
      })),
    interactions,
    conversationGroups: room.conversationGroups || []
  };
}

function publishSceneChanges(changes) {
  for (const change of changes) {
    for (const listener of sceneListeners) listener(change);
    window.dispatchEvent(new CustomEvent('tracky:scene-change', {
      detail: change
    }));
  }
}

function updateSceneIntelligence(now = Date.now()) {
  const previousEpisodeIds = new Set(
    sceneState.episodes.map((episode) => episode.id)
  );

  const changes = updateSceneState(
    sceneState,
    sceneInputSnapshot(),
    now
  );

  const completedEpisodes = sceneState.episodes.filter(
    (episode) => !previousEpisodeIds.has(episode.id)
  );

  if (changes.length) {
    publishSceneChanges(changes);
    void saveSceneChanges(changes).catch((error) => {
      console.error('Could not persist scene changes', error);
    });
  }

  if (completedEpisodes.length) {
    void saveSceneEpisodes(completedEpisodes).catch((error) => {
      console.error('Could not persist scene episodes', error);
    });
  }

  renderSceneIntelligence();
  return changes;
}

async function initializeSceneMemory() {
  try {
    const [zones, changes, episodes] = await Promise.all([
      loadSceneZones(),
      listSceneChanges(120),
      listSceneEpisodes(120)
    ]);

    replaceSceneZones(sceneState, zones);
    sceneState.changes = changes;
    sceneState.episodes = episodes;
    ui.sceneStatus.textContent = 'Memory online';
  } catch (error) {
    console.error('Could not load scene memory', error);
    ui.sceneStatus.textContent = 'Memory unavailable';
  }

  renderSceneIntelligence();
}

async function replaceZonesAndPersist(zones) {
  replaceSceneZones(sceneState, zones);
  try {
    await saveSceneZones(sceneState.zones);
  } catch (error) {
    console.error('Could not persist scene zones', error);
  }
  renderSceneIntelligence();
  renderRadar();
  drawOverlay();
}

async function addSceneZone(event) {
  event.preventDefault();

  const zone = normalizeZone({
    name: ui.sceneZoneName.value.trim() || 'Zone',
    x: Number(ui.sceneZoneX.value) / 100,
    y: Number(ui.sceneZoneY.value) / 100,
    width: Number(ui.sceneZoneWidth.value) / 100,
    height: Number(ui.sceneZoneHeight.value) / 100
  });

  await replaceZonesAndPersist([...sceneState.zones, zone]);
  ui.sceneZoneName.value = '';
}

async function deleteSceneZone(zoneId) {
  await replaceZonesAndPersist(
    sceneState.zones.filter((zone) => zone.id !== zoneId)
  );
}

async function clearSavedSceneMemory() {
  if (!window.confirm(
    'Clear locally saved scene changes and completed episodes? Named room zones will be preserved.'
  )) return;

  try {
    await clearSceneMemory({ preserveZones: true });
    sceneState.changes = [];
    sceneState.episodes = [];
    runtime.selectedSceneRecord = null;
    ui.sceneInspector.hidden = true;
    renderSceneIntelligence();
  } catch (error) {
    console.error('Could not clear scene memory', error);
  }
}

function nextTrackId() {
  runtime.trackCounter += 1;
  return 'T' + String(runtime.trackCounter).padStart(3, '0');
}

function nextObjectId() {
  runtime.objectCounter += 1;
  return 'O' + String(runtime.objectCounter).padStart(3, '0');
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
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  runtime.cameraDevices = cameras;

  const current = ui.cameraSelect.value;
  ui.cameraSelect.replaceChildren();
  ui.cameraRegistryDevice.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select camera';
  ui.cameraRegistryDevice.append(placeholder);

  cameras.forEach((camera, index) => {
    const label = camera.label || 'Camera ' + (index + 1);

    const mainOption = document.createElement('option');
    mainOption.value = camera.deviceId;
    mainOption.textContent = label;
    ui.cameraSelect.append(mainOption);

    const registryOption = document.createElement('option');
    registryOption.value = camera.deviceId;
    registryOption.textContent = label;
    ui.cameraRegistryDevice.append(registryOption);
  });

  if (cameras.some((camera) => camera.deviceId === current)) {
    ui.cameraSelect.value = current;
  }

  ui.cameraSelect.disabled = cameras.length < 2;
  renderCameraNetwork();
  return cameras;
}

function nextCameraId() {
  const used = new Set(runtime.cameraConfigs.map((camera) => camera.id));
  let index = 1;
  while (used.has('CAM' + String(index).padStart(2, '0'))) index += 1;
  return 'CAM' + String(index).padStart(2, '0');
}

async function reloadCameraRegistry() {
  try {
    runtime.cameraConfigs = await listCameraConfigs();
  } catch (error) {
    console.error('Could not load camera registry', error);
    runtime.cameraConfigs = [];
  }
  renderCameraNetwork();
  renderWorldMap();
  return runtime.cameraConfigs;
}

async function ensurePrimaryCameraConfig(deviceId) {
  await reloadCameraRegistry();

  let camera = runtime.cameraConfigs.find(
    (candidate) => candidate.deviceId === deviceId
  );

  if (!camera) {
    camera = normalizeCameraConfig({
      id: nextCameraId(),
      name: cameraDeviceLabel(deviceId),
      deviceId,
      roomId: 'ROOM01',
      primary: true,
      enabled: true
    }, runtime.cameraConfigs.length);
  } else {
    camera = normalizeCameraConfig({
      ...camera,
      primary: true,
      enabled: true,
      name: camera.name || cameraDeviceLabel(deviceId)
    });
  }

  await saveCameraConfig(camera);
  await reloadCameraRegistry();
  return runtime.cameraConfigs.find((candidate) => candidate.primary) || camera;
}

function createSecondaryRuntime() {
  if (runtime.secondaryCameras) return runtime.secondaryCameras;

  runtime.secondaryCameras = new MultiCameraSensorRuntime({
    identityEngine: {
      detectRoom(input) {
        return detectRoomSerial(input);
      }
    },
    getParticipants() {
      return runtime.participants;
    },
    onObservation: onSecondaryCameraObservation,
    onStatus: onSecondaryCameraStatus,
    scanIntervalMs: 850
  });

  return runtime.secondaryCameras;
}

async function startSecondaryCameras() {
  if (!runtime.running || !runtime.identityReady) return;

  const primary = primaryCameraConfig();
  const manager = createSecondaryRuntime();
  await manager.stopAll();

  for (const camera of runtime.cameraConfigs) {
    if (
      !camera.enabled ||
      camera.primary ||
      !camera.deviceId ||
      camera.deviceId === primary?.deviceId ||
      camera.roomId !== primary?.roomId
    ) {
      continue;
    }

    try {
      emitCameraStatus(camera.id, 'starting');
      await manager.start(camera);
    } catch (error) {
      console.error('Could not start secondary camera', camera.id, error);
      emitCameraStatus(camera.id, 'error');
    }
  }

  renderCameraNetwork();
}

async function addCameraConfig(event) {
  event.preventDefault();

  const deviceId = ui.cameraRegistryDevice.value;
  if (!deviceId) return;

  const existing = runtime.cameraConfigs.find(
    (camera) => camera.deviceId === deviceId
  );
  const base = existing || normalizeCameraConfig({
    id: nextCameraId(),
    deviceId,
    name: ui.cameraRegistryName.value.trim() || cameraDeviceLabel(deviceId),
    roomId: ui.cameraRegistryRoom.value.trim() || primaryCameraConfig()?.roomId || 'ROOM01',
    enabled: true,
    primary: false
  }, runtime.cameraConfigs.length);

  const camera = cameraWithCoverage({
    ...base,
    name: ui.cameraRegistryName.value.trim() || base.name,
    roomId: ui.cameraRegistryRoom.value.trim() || base.roomId,
    primary: base.primary
  }, {
    x: Number(ui.cameraCoverageX.value) / 100,
    y: Number(ui.cameraCoverageY.value) / 100,
    width: Number(ui.cameraCoverageWidth.value) / 100,
    height: Number(ui.cameraCoverageHeight.value) / 100
  });

  await saveCameraConfig(camera);
  await reloadCameraRegistry();

  ui.cameraRegistryName.value = '';
  if (runtime.running) await startSecondaryCameras();
}

async function toggleCameraEnabled(cameraId) {
  const camera = cameraById(cameraId);
  if (!camera || camera.primary) return;

  await saveCameraConfig({
    ...camera,
    enabled: !camera.enabled
  });
  await reloadCameraRegistry();

  if (runtime.running) await startSecondaryCameras();
}

async function removeCamera(cameraId) {
  const camera = cameraById(cameraId);
  if (!camera || camera.primary) return;

  await runtime.secondaryCameras?.stop(cameraId);
  await deleteCameraConfig(cameraId);
  runtime.cameraObservations.delete(cameraId);
  runtime.cameraStatuses.delete(cameraId);
  await reloadCameraRegistry();
  updateCameraFusion(Date.now(), true);
}

async function makeCameraPrimary(cameraId) {
  const camera = cameraById(cameraId);
  if (!camera?.deviceId) return;

  await saveCameraConfig({
    ...camera,
    primary: true,
    enabled: true
  });
  await reloadCameraRegistry();

  ui.cameraSelect.value = camera.deviceId;
  if (runtime.running) await startEyes(camera.deviceId);
}

function openCameraCalibration(cameraId) {
  const camera = cameraById(cameraId);
  if (!camera) return;

  runtime.selectedCalibrationCameraId = camera.id;
  const points = camera.roomPoints;

  ui.cameraCalibrationName.textContent = camera.name;
  ui.cameraCalibrationMeta.textContent =
    camera.id + ' · ' + camera.roomId + ' · ' +
    (camera.primary ? 'MAIN CAMERA' : 'SECONDARY CAMERA');

  const fields = [
    [ui.cameraTLX, ui.cameraTLY, points[0]],
    [ui.cameraTRX, ui.cameraTRY, points[1]],
    [ui.cameraBRX, ui.cameraBRY, points[2]],
    [ui.cameraBLX, ui.cameraBLY, points[3]]
  ];

  for (const [xField, yField, point] of fields) {
    xField.value = (point.x * 100).toFixed(1);
    yField.value = (point.y * 100).toFixed(1);
  }

  ui.cameraCalibrationEnabled.checked = camera.enabled;
  ui.cameraCalibrationJson.textContent = JSON.stringify({
    cameraId: camera.id,
    roomId: camera.roomId,
    sourcePoints: camera.sourcePoints,
    roomPoints: camera.roomPoints,
    calibrationValid: cameraCalibrationValid(camera)
  }, null, 2);
  ui.cameraCalibrationInspector.hidden = false;
}

function closeCameraCalibration() {
  runtime.selectedCalibrationCameraId = null;
  ui.cameraCalibrationInspector.hidden = true;
}

async function saveCameraCalibrationForm(event) {
  event.preventDefault();

  const camera = cameraById(runtime.selectedCalibrationCameraId);
  if (!camera) return;

  const values = [
    [ui.cameraTLX, ui.cameraTLY],
    [ui.cameraTRX, ui.cameraTRY],
    [ui.cameraBRX, ui.cameraBRY],
    [ui.cameraBLX, ui.cameraBLY]
  ].map(([xField, yField]) => ({
    x: Number(xField.value) / 100,
    y: Number(yField.value) / 100
  }));

  const updated = normalizeCameraConfig({
    ...camera,
    roomPoints: values,
    enabled: ui.cameraCalibrationEnabled.checked,
    updatedAt: Date.now()
  });

  if (!cameraCalibrationValid(updated)) {
    ui.cameraCalibrationMeta.textContent = 'Invalid calibration polygon — adjust the room corners.';
    return;
  }

  await saveCameraConfig(updated);
  await reloadCameraRegistry();
  closeCameraCalibration();

  if (runtime.running) await startSecondaryCameras();
  publishPrimaryCameraObservation(Date.now());
  updateCameraFusion(Date.now(), true);
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
    emitSensor('objects', 'online');
    emitSensor('hands', 'online');
    return true;
  } catch (error) {
    console.error(error);
    ui.identityStatus.textContent = 'Unavailable';
    emitSensor('identity', 'error');
    emitSensor('objects', 'error');
    emitSensor('hands', 'error');
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
  await runtime.secondaryCameras?.stopAll();
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

    const activeDeviceId =
      runtime.stream.getVideoTracks()[0]?.getSettings()?.deviceId ||
      deviceId ||
      ui.cameraSelect.value;
    await ensurePrimaryCameraConfig(activeDeviceId);
    if (activeDeviceId) ui.cameraSelect.value = activeDeviceId;

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
    if (identityReady) {
      await startSecondaryCameras();
      scheduleScan(0);
    }
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

  void runtime.secondaryCameras?.stopAll();
  runtime.stream?.getTracks().forEach((track) => track.stop());
  runtime.stream = null;
  ui.video.srcObject = null;
  ui.offline.hidden = false;
  ui.startEyes.disabled = false;
  ui.cameraSelect.disabled = true;
  ui.cameraStatus.textContent = 'Offline';
  ui.objectStatus.textContent = 'Standby';
  emitSensor('camera', 'offline');

  runtime.faces = [];
  runtime.bodies = [];
  runtime.tracks = [];
  runtime.objects = [];
  runtime.rawObjects = [];
  runtime.hands = [];
  runtime.gestures = [];
  runtime.activeInteractions.clear();
  runtime.interactionCandidates.clear();
  runtime.relationDistances.clear();
  runtime.selectedObjectId = null;
  runtime.previousTrackIds.clear();
  runtime.previousKnownByTrack.clear();
  runtime.previousStatuses.clear();
  runtime.previousGroups.clear();
  runtime.cameraObservations.clear();
  runtime.cameraStatuses.clear();
  runtime.fusionState = {
    schemaVersion: 1,
    roomId: primaryCameraConfig()?.roomId || 'ROOM01',
    updatedAt: Date.now(),
    participants: [],
    objects: []
  };
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
  const camera = primaryCameraConfig();
  if (!camera) {
    return {
      x: Number(track.cx || 0.5),
      y: Number(track.cy || 0.5),
      box: track.box ? { ...track.box } : null,
      cameraId: null
    };
  }

  const point = mapCameraPoint(camera, {
    x: Number(track.cx || 0.5),
    y: Number(track.cy || 0.5)
  });

  return {
    ...point,
    box: track.box ? mapCameraBox(camera, track.box) : null,
    cameraId: camera.id
  };
}

function emitTrackTransitions(previousTracks, currentTracks, now) {
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

    const stablePresence = (
      !track.presenceAnnounced &&
      now - Number(track.firstSeenAt || now) >= 900
    );
    if (stablePresence) {
      track.presenceAnnounced = true;
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
    if (currentById.has(previous.id) || !previous.presenceAnnounced) continue;
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
      return;
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

function behaviorSignature(behavior) {
  if (!behavior) return '';
  return [
    behavior.orientation?.horizontal || 'unknown',
    behavior.orientation?.vertical || 'unknown',
    behavior.posture?.posture || 'unknown',
    behavior.motion?.motion || 'unknown',
    behavior.gesture?.type || 'none',
    behavior.attention?.targetName || behavior.attention?.targetType || 'none',
    behavior.addressing?.addressing ? behavior.addressing.targetName || 'target' : 'none'
  ].join('|');
}

function compactBehavior(behavior) {
  return {
    orientation: behavior.orientation?.horizontal || 'unknown',
    verticalOrientation: behavior.orientation?.vertical || 'unknown',
    orientationConfidence: Number(behavior.orientation?.confidence || 0),
    posture: behavior.posture?.posture || 'unknown',
    postureConfidence: Number(behavior.posture?.confidence || 0),
    motion: behavior.motion?.motion || 'unknown',
    motionSpeed: Number(behavior.motion?.speed || 0),
    gesture: behavior.gesture?.type || null,
    gestureConfidence: Number(behavior.gesture?.confidence || 0),
    poseConfidence: Number(behavior.poseConfidence || 0)
  };
}

function gestureHistory(track, side, now) {
  const points = keypointMap(track.keypoints || []);
  const wrist = points.get(side + 'Wrist');
  const shoulder = points.get(side + 'Shoulder');
  const key = track.id + ':' + side;
  const history = runtime.wristHistory.get(key) || [];

  if (!wrist || !shoulder || wrist.y >= shoulder.y - 0.03) {
    runtime.wristHistory.delete(key);
    return null;
  }

  history.push({ x: wrist.x, y: wrist.y, at: now });
  while (history.length > 8) history.shift();
  runtime.wristHistory.set(key, history);
  return inferWave(history);
}

function emitGestureIfReady(track, gesture, confidence, now) {
  if (!gesture) return;
  const key = track.id + ':' + gesture;
  const last = Number(runtime.lastGestureAt.get(key) || 0);
  if (now - last < GESTURE_COOLDOWN_MS) return;

  runtime.lastGestureAt.set(key, now);
  emit('gesture.detected', {
    participantId: track.participantId || null,
    participantName: track.participantName || null,
    trackId: track.id,
    confidence,
    source: 'pose-landmarks',
    roomPosition: roomPosition(track),
    conversationGroup: track.conversationGroupId || null,
    data: { gesture }
  });
}

function analyzeBehaviors(now) {
  const liveIds = new Set(runtime.tracks.map((track) => track.id));

  for (const key of runtime.behaviorByTrack.keys()) {
    if (!liveIds.has(key)) runtime.behaviorByTrack.delete(key);
  }

  for (const track of runtime.tracks) {
    if (track.status === 'occluded' || track.status === 'reacquiring') {
      track.behaviorEvidence = null;
      continue;
    }

    const speaking = Boolean(
      roomState.activeSpeaker &&
      (
        roomState.activeSpeaker.trackId === track.id ||
        (
          track.participantId &&
          roomState.activeSpeaker.participantId === track.participantId
        )
      )
    );

    const behavior = buildBehaviorEvidence(
      track,
      runtime.tracks,
      { speaking }
    );
    track.behaviorEvidence = behavior;

    if (!track.presenceAnnounced) continue;

    const previous = runtime.behaviorByTrack.get(track.id);
    const signature = behaviorSignature(behavior);
    const previousSignature = previous?.signature || '';

    if (
      signature !== previousSignature &&
      behavior.poseConfidence >= 0.28
    ) {
      emit('behavior.changed', {
        participantId: track.participantId || null,
        participantName: track.participantName || null,
        trackId: track.id,
        confidence: Math.max(
          behavior.poseConfidence,
          behavior.orientation?.confidence || 0
        ),
        source: 'pose+face',
        roomPosition: roomPosition(track),
        conversationGroup: track.conversationGroupId || null,
        evidence: behavior,
        data: {
          behavior: compactBehavior(behavior),
          addressing: behavior.addressing
        }
      });
    }

    const attentionKey = [
      behavior.attention?.targetType || 'unknown',
      behavior.attention?.targetTrackId || '',
      behavior.attention?.targetParticipantId || ''
    ].join(':');

    if (
      attentionKey !== previous?.attentionKey &&
      Number(behavior.attention?.confidence || 0) >= 0.32
    ) {
      emit('attention.changed', {
        participantId: track.participantId || null,
        participantName: track.participantName || null,
        trackId: track.id,
        confidence: behavior.attention.confidence,
        source: 'head-orientation+spatial',
        roomPosition: roomPosition(track),
        conversationGroup: track.conversationGroupId || null,
        evidence: behavior.attention.evidence,
        data: { attention: behavior.attention }
      });
    }

    if (
      behavior.gesture?.type &&
      behavior.gesture.confidence >= 0.55 &&
      behavior.gesture.type !== previous?.gestureType
    ) {
      emitGestureIfReady(
        track,
        behavior.gesture.type,
        behavior.gesture.confidence,
        now
      );
    }

    for (const side of ['left', 'right']) {
      const wave = gestureHistory(track, side, now);
      if (wave?.detected) {
        emitGestureIfReady(
          track,
          side + '-hand-wave',
          wave.confidence,
          now
        );
      }
    }

    runtime.behaviorByTrack.set(track.id, {
      signature,
      attentionKey,
      gestureType: behavior.gesture?.type || null
    });
  }

  ui.behaviorStatus.textContent = runtime.tracks.some((track) => track.behaviorEvidence)
    ? 'Analyzing ' + runtime.tracks.filter((track) => track.behaviorEvidence).length
    : runtime.running ? 'Waiting for pose' : 'Standby';
}



function objectRoomPosition(objectTrack) {
  const camera = primaryCameraConfig();
  if (!camera) {
    return {
      x: Number(objectTrack.cx || 0.5),
      y: Number(objectTrack.cy || 0.5),
      box: objectTrack.box ? { ...objectTrack.box } : null,
      cameraId: null
    };
  }

  const point = mapCameraPoint(camera, {
    x: Number(objectTrack.cx || 0.5),
    y: Number(objectTrack.cy || 0.5)
  });

  return {
    ...point,
    box: objectTrack.box ? mapCameraBox(camera, objectTrack.box) : null,
    cameraId: camera.id
  };
}

function emitObjectTransitions(previousObjects, currentObjects) {
  const previousById = new Map(previousObjects.map((object) => [object.id, object]));
  const currentById = new Map(currentObjects.map((object) => [object.id, object]));

  for (const object of currentObjects) {
    const previous = previousById.get(object.id);

    if (object.stable && !previous?.stable) {
      emit('object.detected', {
        confidence: object.score,
        source: 'object-detector',
        roomPosition: objectRoomPosition(object),
        evidence: {
          detectorId: object.detectorId,
          classId: object.classId,
          observations: object.observations
        },
        data: {
          objectId: object.id,
          label: object.label,
          status: object.status
        }
      });
    } else if (
      object.stable &&
      previous?.status === 'reacquiring' &&
      object.status !== 'reacquiring'
    ) {
      emit('object.reacquired', {
        confidence: object.score,
        source: 'object-continuity',
        roomPosition: objectRoomPosition(object),
        data: {
          objectId: object.id,
          label: object.label,
          status: object.status
        }
      });
    }

    if (object.stable && object.status !== 'reacquiring') {
      emit('object.updated', {
        confidence: object.score,
        source: 'object-detector',
        roomPosition: objectRoomPosition(object),
        data: {
          objectId: object.id,
          label: object.label,
          status: object.status
        }
      });
    }
  }

  for (const previous of previousObjects) {
    if (!previous.stable || currentById.has(previous.id)) continue;
    emit('object.lost', {
      confidence: previous.score,
      source: 'object-continuity',
      roomPosition: objectRoomPosition(previous),
      data: {
        objectId: previous.id,
        label: previous.label,
        status: 'lost'
      }
    });
  }
}

function interactionPayload(interaction, interactionId) {
  const object = runtime.objects.find(
    (candidate) => candidate.id === interaction.objectTrackId
  );

  return {
    participantId: interaction.participantId || null,
    participantName: interaction.participantName || null,
    trackId: interaction.participantTrackId || null,
    confidence: interaction.confidence,
    source: 'person-object-fusion',
    roomPosition: object ? objectRoomPosition(object) : null,
    evidence: interaction.evidence || null,
    data: {
      interactionId,
      type: interaction.type,
      objectId: interaction.objectTrackId,
      objectLabel: interaction.objectLabel
    }
  };
}

function synchronizeObjectInteractions(now) {
  const observations = bestObjectInteractions(
    runtime.tracks.filter((track) => track.presenceAnnounced),
    runtime.objects.filter(
      (object) => object.stable && object.status !== 'reacquiring'
    ),
    runtime.hands,
    runtime.relationDistances
  );

  const seen = new Set();

  for (const interaction of observations) {
    const key = interactionKey(interaction);
    seen.add(key);

    const existing = runtime.activeInteractions.get(key);
    if (existing) {
      runtime.activeInteractions.set(key, {
        ...existing,
        ...interaction,
        lastSeenAt: now
      });
      runtime.interactionCandidates.delete(key);
      continue;
    }

    const candidate = runtime.interactionCandidates.get(key);
    const nextCandidate = candidate
      ? {
          ...candidate,
          ...interaction,
          count: Number(candidate.count || 1) + 1,
          lastSeenAt: now
        }
      : {
          ...interaction,
          count: 1,
          firstSeenAt: now,
          lastSeenAt: now
        };

    runtime.interactionCandidates.set(key, nextCandidate);

    if (nextCandidate.count < 2) continue;

    runtime.interactionCandidates.delete(key);
    const entry = {
      ...interaction,
      startedAt: now,
      lastSeenAt: now
    };
    runtime.activeInteractions.set(key, entry);

    const payload = interactionPayload(interaction, key);
    emit('interaction.started', payload);

    if (interaction.type === 'holding') {
      const object = runtime.objects.find(
        (candidateObject) => candidateObject.id === interaction.objectTrackId
      );
      if (object) {
        object.holderTrackId = interaction.participantTrackId || null;
        object.holderParticipantId = interaction.participantId || null;
        object.interaction = 'holding';
      }

      emit('object.picked_up', {
        ...payload,
        data: {
          ...payload.data,
          objectId: interaction.objectTrackId,
          label: interaction.objectLabel
        }
      });
    }
  }

  for (const [key, candidate] of [...runtime.interactionCandidates.entries()]) {
    if (seen.has(key)) continue;
    if (now - Number(candidate.lastSeenAt || now) >= SCAN_INTERVAL_MS * 1.6) {
      runtime.interactionCandidates.delete(key);
    }
  }

  for (const [key, interaction] of [...runtime.activeInteractions.entries()]) {
    if (seen.has(key)) continue;
    if (now - Number(interaction.lastSeenAt || now) < INTERACTION_COOLDOWN_MS) continue;

    runtime.activeInteractions.delete(key);
    emit('interaction.ended', interactionPayload(interaction, key));

    if (interaction.type === 'holding') {
      const object = runtime.objects.find(
        (candidate) => candidate.id === interaction.objectTrackId
      );
      if (object) {
        object.holderTrackId = null;
        object.holderParticipantId = null;
        object.interaction = null;
      }

      emit('object.put_down', {
        ...interactionPayload(interaction, key),
        data: {
          ...interactionPayload(interaction, key).data,
          objectId: interaction.objectTrackId,
          label: interaction.objectLabel
        }
      });
    }
  }

  const activePersonIds = new Set(runtime.tracks.map((track) => track.id));
  const activeObjectIds = new Set(runtime.objects.map((object) => object.id));
  for (const key of [...runtime.relationDistances.keys()]) {
    const [personId, objectId] = key.split(':');
    if (!activePersonIds.has(personId) || !activeObjectIds.has(objectId)) {
      runtime.relationDistances.delete(key);
    }
  }

  const holdingByObject = new Map(
    [...runtime.activeInteractions.values()]
      .filter((interaction) => interaction.type === 'holding')
      .map((interaction) => [interaction.objectTrackId, interaction])
  );

  for (const object of runtime.objects) {
    const holding = holdingByObject.get(object.id);
    if (holding) {
      object.holderTrackId = holding.participantTrackId || null;
      object.holderParticipantId = holding.participantId || null;
      object.interaction = 'holding';
    } else if (object.interaction === 'holding') {
      object.interaction = null;
    }
  }
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
  const previousObjects = runtime.objects;

  try {
    const room = await detectRoomSerial(ui.video);
    runtime.faces = room.faces || [];
    runtime.bodies = augmentBodiesWithFaceFallbacks(
      runtime.faces,
      room.bodies || []
    );
    runtime.rawObjects = room.objects || [];
    runtime.hands = room.hands || [];
    runtime.gestures = room.gestures || [];

    const liveObjects = assignObjectTracks(
      previousObjects,
      runtime.rawObjects,
      now,
      { nextId: nextObjectId }
    );
    const carriedObjects = carryLostObjectTracks(
      previousObjects,
      liveObjects,
      now,
      OBJECT_GRACE_MS
    );
    runtime.objects = [...liveObjects, ...carriedObjects];

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
    analyzeBehaviors(now);
    emitTrackTransitions(previousTracks, runtime.tracks, now);
    emitObjectTransitions(previousObjects, runtime.objects);
    synchronizeObjectInteractions(now);
    const fusionNow = Date.now();
    publishPrimaryCameraObservation(fusionNow);
    updateCameraFusion(fusionNow, false);
    updateSceneIntelligence(fusionNow);
    drawOverlay();
    renderAll();

    ui.identityStatus.textContent =
      runtime.tracks.length + ' tracked · ' +
      runtime.tracks.filter((track) => track.participantId).length + ' known';
    ui.objectStatus.textContent = runtime.objects.length
      ? runtime.objects.filter((object) => object.stable).length + ' persistent'
      : 'Scanning';
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


function canvasPoint(point, width, height) {
  return {
    x: (1 - Number(point.x || 0)) * width,
    y: Number(point.y || 0) * height
  };
}

function drawPoseSkeleton(track, width, height, selected = false) {
  if (!ui.poseOverlay.checked || !track.keypoints?.length) return;

  const points = keypointMap(track.keypoints);
  const color = track.participantId ? '#5cff9d' : '#4ee8ff';

  overlayCtx.save();
  overlayCtx.strokeStyle = color;
  overlayCtx.fillStyle = color;
  overlayCtx.lineWidth = selected
    ? Math.max(3, width / 500)
    : Math.max(1.5, width / 800);
  overlayCtx.globalAlpha = selected ? 0.95 : 0.7;

  for (const [aName, bName] of POSE_CONNECTIONS) {
    const a = points.get(aName);
    const b = points.get(bName);
    if (!a || !b) continue;
    const pa = canvasPoint(a, width, height);
    const pb = canvasPoint(b, width, height);
    overlayCtx.beginPath();
    overlayCtx.moveTo(pa.x, pa.y);
    overlayCtx.lineTo(pb.x, pb.y);
    overlayCtx.stroke();
  }

  for (const point of points.values()) {
    const p = canvasPoint(point, width, height);
    overlayCtx.beginPath();
    overlayCtx.arc(
      p.x,
      p.y,
      selected ? Math.max(3, width / 320) : Math.max(2, width / 500),
      0,
      Math.PI * 2
    );
    overlayCtx.fill();
  }

  overlayCtx.restore();
}

function drawAttentionRay(track, width, height) {
  if (!ui.attentionOverlay.checked) return;
  const attention = track.behaviorEvidence?.attention;
  if (!attention || Number(attention.confidence || 0) < 0.32) return;

  const points = keypointMap(track.keypoints || []);
  const head = points.get('nose') || points.get('leftEye') || points.get('rightEye');
  const start = head
    ? canvasPoint(head, width, height)
    : {
        x: (1 - Number(track.cx || 0.5)) * width,
        y: Number(track.box?.y || track.cy || 0.5) * height
      };

  let end = null;
  if (attention.targetTrackId) {
    const target = runtime.tracks.find(
      (candidate) => candidate.id === attention.targetTrackId
    );
    if (target) {
      end = {
        x: (1 - Number(target.cx || 0.5)) * width,
        y: Number(target.cy || 0.5) * height
      };
    }
  } else if (attention.targetType === 'camera') {
    end = {
      x: start.x,
      y: Math.max(10, start.y - Math.max(35, height * 0.11))
    };
  } else {
    const direction = track.behaviorEvidence?.orientation?.horizontal === 'left'
      ? 1
      : -1;
    end = {
      x: start.x + direction * Math.max(45, width * 0.10),
      y: start.y
    };
  }

  if (!end) return;

  overlayCtx.save();
  overlayCtx.strokeStyle = '#ffd166';
  overlayCtx.fillStyle = '#ffd166';
  overlayCtx.lineWidth = Math.max(1.5, width / 850);
  overlayCtx.setLineDash([8, 6]);
  overlayCtx.globalAlpha = 0.82;
  overlayCtx.beginPath();
  overlayCtx.moveTo(start.x, start.y);
  overlayCtx.lineTo(end.x, end.y);
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
  overlayCtx.beginPath();
  overlayCtx.arc(end.x, end.y, Math.max(3, width / 360), 0, Math.PI * 2);
  overlayCtx.fill();
  overlayCtx.restore();
}


function activeInteractionForObject(objectId) {
  return [...runtime.activeInteractions.values()]
    .filter((interaction) => interaction.objectTrackId === objectId)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;
}

function drawObjectOverlays(width, height) {
  if (!ui.objectOverlay.checked) return;

  for (const object of runtime.objects) {
    if (!object.stable || !object.box || object.status === 'reacquiring') continue;

    const x = (1 - object.box.x - object.box.width) * width;
    const y = object.box.y * height;
    const w = object.box.width * width;
    const h = object.box.height * height;
    const selected = runtime.selectedObjectId === object.id;
    const interaction = activeInteractionForObject(object.id);

    overlayCtx.save();
    overlayCtx.strokeStyle = interaction?.type === 'holding' ? '#ff9f43' : '#ffd166';
    overlayCtx.fillStyle = overlayCtx.strokeStyle;
    overlayCtx.lineWidth = selected
      ? Math.max(3, width / 480)
      : Math.max(1.5, width / 850);
    overlayCtx.setLineDash(interaction ? [] : [6, 5]);
    overlayCtx.strokeRect(x, y, w, h);
    overlayCtx.setLineDash([]);

    const label = [
      object.id,
      object.label,
      interaction?.type
    ].filter(Boolean).join(' · ');

    overlayCtx.font = Math.max(10, width / 80) + 'px ui-monospace, monospace';
    const labelWidth = overlayCtx.measureText(label).width + 12;
    const labelHeight = Math.max(18, height / 30);
    overlayCtx.globalAlpha = 0.9;
    overlayCtx.fillRect(x, Math.max(0, y - labelHeight), labelWidth, labelHeight);
    overlayCtx.globalAlpha = 1;
    overlayCtx.fillStyle = '#161006';
    overlayCtx.fillText(
      label,
      x + 6,
      Math.max(13, y - labelHeight + labelHeight * 0.72)
    );

    if (interaction?.participantTrackId) {
      const person = runtime.tracks.find(
        (track) => track.id === interaction.participantTrackId
      );
      if (person) {
        const from = {
          x: (1 - Number(person.cx || 0.5)) * width,
          y: Number(person.cy || 0.5) * height
        };
        const to = {
          x: (1 - Number(object.cx || 0.5)) * width,
          y: Number(object.cy || 0.5) * height
        };
        overlayCtx.strokeStyle = interaction.type === 'holding' ? '#ff9f43' : '#ffd166';
        overlayCtx.globalAlpha = 0.62;
        overlayCtx.lineWidth = Math.max(1, width / 950);
        overlayCtx.beginPath();
        overlayCtx.moveTo(from.x, from.y);
        overlayCtx.lineTo(to.x, to.y);
        overlayCtx.stroke();
      }
    }

    overlayCtx.restore();
  }
}

function drawSceneZones(width, height) {
  if (!ui.sceneOverlay.checked) return;

  overlayCtx.save();
  overlayCtx.setLineDash([10, 7]);
  overlayCtx.font = Math.max(10, width / 90) + 'px ui-monospace, monospace';

  for (const zone of sceneState.zones) {
    if (!zone.enabled) continue;

    const x = (1 - zone.x - zone.width) * width;
    const y = zone.y * height;
    const w = zone.width * width;
    const h = zone.height * height;

    overlayCtx.strokeStyle = 'rgba(184,120,255,.72)';
    overlayCtx.fillStyle = 'rgba(184,120,255,.72)';
    overlayCtx.lineWidth = Math.max(1.2, width / 1000);
    overlayCtx.strokeRect(x, y, w, h);
    overlayCtx.fillText(zone.name.toUpperCase(), x + 6, y + 15);
  }

  overlayCtx.restore();
}

function drawOverlay() {
  resizeOverlay();
  const width = ui.overlay.width;
  const height = ui.overlay.height;
  overlayCtx.clearRect(0, 0, width, height);
  drawSceneZones(width, height);
  drawObjectOverlays(width, height);

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

    const selected = runtime.selectedTrackId === track.id;
    drawPoseSkeleton(track, width, height, selected);
    drawAttentionRay(track, width, height);

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


function confidenceText(value) {
  return Number.isFinite(Number(value))
    ? Math.round(Number(value) * 100) + '%'
    : '—';
}

function appendInspectorSignal(label, value, confidence, detail = '') {
  const row = document.createElement('div');
  row.className = 'evidence-signal-row';

  const top = document.createElement('div');
  const key = document.createElement('span');
  const val = document.createElement('b');
  key.textContent = label;
  val.textContent = value + (Number.isFinite(Number(confidence)) ? ' · ' + confidenceText(confidence) : '');
  top.append(key, val);

  const meter = document.createElement('div');
  meter.className = 'evidence-confidence-meter';
  const fill = document.createElement('i');
  fill.style.width = Math.round(Math.max(0, Math.min(1, Number(confidence || 0))) * 100) + '%';
  meter.append(fill);

  row.append(top, meter);

  if (detail) {
    const note = document.createElement('small');
    note.textContent = detail;
    row.append(note);
  }

  ui.inspectorSignals.append(row);
}

function renderEvidenceInspector() {
  if (!runtime.selectedTrackId) {
    ui.inspector.hidden = true;
    return;
  }

  const track = runtime.tracks.find(
    (candidate) => candidate.id === runtime.selectedTrackId
  );

  if (!track) {
    runtime.selectedTrackId = null;
    ui.inspector.hidden = true;
    return;
  }

  const participant = track.participantId
    ? participantById(track.participantId)
    : null;
  const voice = voiceProfileReadiness(participant || {});
  const behavior = track.behaviorEvidence;

  ui.inspector.hidden = false;
  ui.inspectorName.textContent = track.participantName || 'Unknown participant';
  ui.inspectorTrack.textContent = track.id + ' · ' + statusText(track);
  ui.inspectorIdentity.textContent = track.participantId
    ? confidenceText(track.similarity || 0)
    : 'UNRESOLVED';
  ui.inspectorPose.textContent = behavior
    ? confidenceText(behavior.poseConfidence)
    : '—';
  ui.inspectorOrientation.textContent = behavior
    ? [
        behavior.orientation?.horizontal,
        behavior.orientation?.vertical
      ].filter((value) => value && value !== 'unknown').join(' / ') || 'unknown'
    : '—';
  ui.inspectorPosture.textContent = behavior?.posture?.posture || '—';
  ui.inspectorMotion.textContent = behavior?.motion?.motion || '—';
  ui.inspectorGesture.textContent = behavior?.gesture?.type || 'none';
  ui.inspectorAttention.textContent =
    behavior?.attention?.targetName ||
    behavior?.attention?.targetType ||
    'unknown';
  ui.inspectorAddressing.textContent =
    behavior?.addressing?.addressing
      ? 'Likely → ' + (behavior.addressing.targetName || 'participant')
      : 'Not established';

  ui.inspectorSignals.replaceChildren();

  appendInspectorSignal(
    'FACE IDENTITY',
    track.face ? (track.participantName || 'face visible') : 'face not visible',
    track.face ? (track.similarity || track.quality || 0) : 0,
    track.face
      ? 'Face descriptor / enrolled participant evidence.'
      : 'No current face evidence; body continuity may still preserve identity.'
  );

  appendInspectorSignal(
    'BODY CONTINUITY',
    track.status === 'occluded' ? 'occlusion memory' : 'body track active',
    track.status === 'occluded'
      ? 0.55
      : Math.max(0.4, Number(track.bodyScore || 0)),
    'Persistent track ' + track.id + ' with motion and bounding-box continuity.'
  );

  appendInspectorSignal(
    'VOICE PROFILE',
    participant
      ? (voice.ready ? 'profile ready' : voice.embeddingCount + '/3 samples')
      : 'no enrolled participant',
    voice.ready ? 0.8 : Math.min(0.65, voice.embeddingCount / 3),
    'Voice identity is an independent signal and is not inferred from body shape.'
  );

  appendInspectorSignal(
    'POSE LANDMARKS',
    (track.keypoints?.length || 0) + ' landmarks',
    behavior?.poseConfidence || 0,
    'Named shoulders, wrists, hips, knees, ankles and head landmarks when visible.'
  );

  appendInspectorSignal(
    'HEAD ORIENTATION',
    behavior?.orientation?.horizontal || 'unknown',
    behavior?.orientation?.confidence || 0,
    behavior?.orientation?.source === 'face-rotation'
      ? 'Derived from face yaw/pitch.'
      : 'Fallback uses shoulder geometry only; exact left/right is not claimed.'
  );

  appendInspectorSignal(
    'POSTURE',
    behavior?.posture?.posture || 'unknown',
    behavior?.posture?.confidence || 0,
    'Uses hip, knee and ankle geometry; partial bodies remain uncertain.'
  );

  appendInspectorSignal(
    'ATTENTION',
    behavior?.attention?.targetName || behavior?.attention?.targetType || 'unknown',
    behavior?.attention?.confidence || 0,
    'Approximate head direction + spatial position. This is not precise eye-gaze tracking.'
  );

  appendInspectorSignal(
    'ADDRESSING',
    behavior?.addressing?.addressing
      ? behavior.addressing.targetName || 'participant'
      : 'not established',
    behavior?.addressing?.confidence || 0,
    'Requires speaking + likely attention target + shared conversation group.'
  );

  const objectInteractions = [...runtime.activeInteractions.values()]
    .filter((interaction) => interaction.participantTrackId === track.id)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));

  appendInspectorSignal(
    'OBJECT INTERACTIONS',
    objectInteractions.length
      ? objectInteractions
          .slice(0, 3)
          .map((interaction) => interaction.type + ' ' + interaction.objectLabel)
          .join(' · ')
      : 'none established',
    objectInteractions[0]?.confidence || 0,
    objectInteractions.length
      ? 'Person↔object conclusions are fused from persistent object tracks, pose landmarks, hand evidence, and relative motion.'
      : 'No current person↔object relationship passes the semantic confidence gates.'
  );

  const points = keypointMap(track.keypoints || []);
  ui.inspectorLandmarks.replaceChildren();
  ui.inspectorLandmarkCount.textContent = points.size + ' visible';

  for (const point of [...points.values()].sort((a, b) => String(a.part).localeCompare(String(b.part)))) {
    const chip = document.createElement('span');
    const name = document.createElement('b');
    const score = document.createElement('i');
    name.textContent = point.part;
    score.textContent = confidenceText(point.score);
    chip.append(name, score);
    ui.inspectorLandmarks.append(chip);
  }

  ui.inspectorJson.textContent = JSON.stringify({
    trackId: track.id,
    participantId: track.participantId || null,
    participantName: track.participantName || null,
    status: track.status,
    identity: {
      source: track.identitySource || null,
      confidence: track.similarity || 0,
      faceVisible: Boolean(track.face),
      bodyScore: track.bodyScore || 0
    },
    voiceProfile: {
      ready: voice.ready,
      sampleCount: voice.embeddingCount,
      totalSeconds: voice.totalSeconds
    },
    behavior,
    objectInteractions,
    conversationGroup: track.conversationGroupId || null,
    roomPosition: roomPosition(track),
    landmarkCount: points.size
  }, null, 2);
}

function openEvidenceInspector(trackId) {
  runtime.selectedObjectId = null;
  runtime.selectedSceneRecord = null;
  ui.objectInspector.hidden = true;
  ui.sceneInspector.hidden = true;
  runtime.selectedTrackId = trackId;
  renderEvidenceInspector();
  drawOverlay();
}

function closeEvidenceInspector() {
  runtime.selectedTrackId = null;
  ui.inspector.hidden = true;
  drawOverlay();
}


function appendObjectInspectorSignal(label, value, confidence, detail = '') {
  const row = document.createElement('div');
  row.className = 'evidence-signal-row';

  const top = document.createElement('div');
  const key = document.createElement('span');
  const val = document.createElement('b');
  key.textContent = label;
  val.textContent = value + (
    Number.isFinite(Number(confidence))
      ? ' · ' + confidenceText(confidence)
      : ''
  );
  top.append(key, val);

  const meter = document.createElement('div');
  meter.className = 'evidence-confidence-meter';
  const fill = document.createElement('i');
  fill.style.width = Math.round(
    Math.max(0, Math.min(1, Number(confidence || 0))) * 100
  ) + '%';
  meter.append(fill);
  row.append(top, meter);

  if (detail) {
    const note = document.createElement('small');
    note.textContent = detail;
    row.append(note);
  }

  ui.objectInspectorSignals.append(row);
}

function renderObjectEvidenceInspector() {
  if (!runtime.selectedObjectId) {
    ui.objectInspector.hidden = true;
    return;
  }

  const object = runtime.objects.find(
    (candidate) => candidate.id === runtime.selectedObjectId
  );

  if (!object) {
    runtime.selectedObjectId = null;
    ui.objectInspector.hidden = true;
    return;
  }

  const interactions = [...runtime.activeInteractions.values()]
    .filter((interaction) => interaction.objectTrackId === object.id)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const primary = interactions[0] || null;
  const holder = object.holderTrackId
    ? runtime.tracks.find((track) => track.id === object.holderTrackId)
    : null;

  ui.objectInspector.hidden = false;
  ui.objectInspectorName.textContent = object.label;
  ui.objectInspectorTrack.textContent = object.id + ' · ' + object.status;
  ui.objectInspectorClass.textContent = object.label;
  ui.objectInspectorConfidence.textContent = confidenceText(object.score);
  ui.objectInspectorStatus.textContent = object.status;
  ui.objectInspectorHolder.textContent =
    holder?.participantName || holder?.id || 'none';
  ui.objectInspectorMotion.textContent =
    Math.hypot(Number(object.vx || 0), Number(object.vy || 0)) >= 0.08
      ? 'moving'
      : 'stable';
  ui.objectInspectorInteraction.textContent = primary?.type || 'none';

  ui.objectInspectorSignals.replaceChildren();

  appendObjectInspectorSignal(
    'OBJECT DETECTOR',
    object.label,
    object.score,
    'Human object classification confidence. Tracky does not infer a unique real-world identity from the class label.'
  );

  appendObjectInspectorSignal(
    'TRACK CONTINUITY',
    object.status,
    Math.min(1, Number(object.observations || 0) / 5),
    object.observations + ' observations under persistent ' + object.id + '.'
  );

  if (primary) {
    appendObjectInspectorSignal(
      'PERSON RELATION',
      primary.type + ' · ' + (primary.participantName || primary.participantTrackId || 'participant'),
      primary.confidence,
      primary.type === 'holding'
        ? 'Uses wrist/object proximity with optional hand-detector reinforcement.'
        : primary.type === 'pointing-at'
          ? 'Uses elbow→wrist ray alignment toward the object.'
          : 'Uses participant↔object distance change over time.'
    );
  } else {
    appendObjectInspectorSignal(
      'PERSON RELATION',
      'none established',
      0,
      'No person↔object relationship currently passes its confidence threshold.'
    );
  }

  ui.objectInspectorJson.textContent = JSON.stringify({
    id: object.id,
    label: object.label,
    classId: object.classId,
    detectorId: object.detectorId,
    confidence: object.score,
    status: object.status,
    observations: object.observations,
    position: objectRoomPosition(object),
    velocity: {
      x: object.vx || 0,
      y: object.vy || 0
    },
    holder: holder ? {
      trackId: holder.id,
      participantId: holder.participantId || null,
      participantName: holder.participantName || null
    } : null,
    interactions
  }, null, 2);
}

function openObjectEvidenceInspector(objectId) {
  runtime.selectedTrackId = null;
  runtime.selectedSceneRecord = null;
  ui.inspector.hidden = true;
  ui.sceneInspector.hidden = true;
  runtime.selectedObjectId = objectId;
  renderObjectEvidenceInspector();
  drawOverlay();
}

function closeObjectEvidenceInspector() {
  runtime.selectedObjectId = null;
  ui.objectInspector.hidden = true;
  drawOverlay();
}

function renderObjects() {
  ui.objects.replaceChildren();

  const objects = runtime.objects
    .filter((object) => object.stable && object.status !== 'reacquiring')
    .slice(0, 16);

  ui.objectRuntimeStatus.textContent = objects.length
    ? objects.length + ' tracked'
    : runtime.running ? 'Scanning' : 'Standby';

  if (!objects.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent = 'No persistent objects are currently tracked.';
    ui.objects.append(empty);
    return;
  }

  for (const object of objects) {
    const interactions = [...runtime.activeInteractions.values()]
      .filter((interaction) => interaction.objectTrackId === object.id)
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    const primary = interactions[0] || null;
    const holder = object.holderTrackId
      ? runtime.tracks.find((track) => track.id === object.holderTrackId)
      : null;

    const card = document.createElement('article');
    card.className = 'agent-object-card';
    if (primary) card.classList.add('active');

    const identity = document.createElement('div');
    identity.className = 'agent-object-id';
    identity.textContent = object.id;

    const copy = document.createElement('div');
    copy.className = 'agent-object-copy';

    const name = document.createElement('strong');
    name.textContent = object.label;

    const meta = document.createElement('span');
    meta.textContent = [
      confidenceText(object.score),
      object.status,
      primary?.type,
      holder ? 'holder ' + (holder.participantName || holder.id) : null
    ].filter(Boolean).join(' · ');

    copy.append(name, meta);

    const inspect = document.createElement('button');
    inspect.className = 'agent-entity-action';
    inspect.type = 'button';
    inspect.textContent = 'Inspect';
    inspect.addEventListener('click', () => openObjectEvidenceInspector(object.id));

    card.append(identity, copy, inspect);
    ui.objects.append(card);
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

    const behavior = track.behaviorEvidence;
    const rows = [
      ['FACE', track.face ? Math.round((track.similarity || track.quality || 0) * 100) + '%' : 'NOT VISIBLE'],
      ['BODY', track.status === 'occluded' ? 'MEMORY' : 'LOCK'],
      ['VOICE', participant ? (voice.ready ? 'PROFILE READY' : voice.embeddingCount + '/3') : 'UNKNOWN'],
      ['POSE', behavior ? Math.round((behavior.poseConfidence || 0) * 100) + '%' : '—'],
      ['FACING', behavior?.orientation?.horizontal || '—'],
      ['POSTURE', behavior?.posture?.posture || '—'],
      ['MOTION', behavior?.motion?.motion || '—'],
      ['ATTENTION', behavior?.attention?.targetName || behavior?.attention?.targetType || '—']
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

    const actions = document.createElement('div');
    actions.className = 'agent-entity-actions';

    const inspect = document.createElement('button');
    inspect.className = 'agent-entity-action';
    inspect.type = 'button';
    inspect.textContent = 'Inspect';
    inspect.addEventListener('click', () => openEvidenceInspector(track.id));
    actions.append(inspect);

    if (!track.participantId && track.embedding && track.latestPhoto) {
      const identify = document.createElement('button');
      identify.className = 'agent-entity-action';
      identify.type = 'button';
      identify.textContent = 'Identify';
      identify.addEventListener('click', () => enrollUnknownTrack(track));
      actions.append(identify);
    }

    card.append(actions);
    ui.participants.append(card);
  }
}

function formatSceneDuration(milliseconds) {
  if (!Number.isFinite(Number(milliseconds))) return '—';
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
}

function closeSceneEvidenceInspector() {
  runtime.selectedSceneRecord = null;
  ui.sceneInspector.hidden = true;
}

function openSceneEvidenceInspector(record, kind = 'change') {
  runtime.selectedTrackId = null;
  runtime.selectedObjectId = null;
  ui.inspector.hidden = true;
  ui.objectInspector.hidden = true;
  runtime.selectedSceneRecord = { record, kind };
  renderSceneEvidenceInspector();
}

function renderSceneEvidenceInspector() {
  const selected = runtime.selectedSceneRecord;
  if (!selected?.record) {
    ui.sceneInspector.hidden = true;
    return;
  }

  const record = selected.record;
  const isEpisode = selected.kind === 'episode';
  const durationMs = isEpisode
    ? (
        record.durationMs ??
        (record.endedAt
          ? record.endedAt - record.startedAt
          : Date.now() - Number(record.startedAt || Date.now()))
      )
    : null;

  ui.sceneInspector.hidden = false;
  ui.sceneInspectorTitle.textContent = isEpisode
    ? record.label || record.type || 'Episode'
    : record.summary || record.type || 'Scene change';
  ui.sceneInspectorMeta.textContent = isEpisode
    ? (record.endedAt ? 'COMPLETED EPISODE' : 'ACTIVE EPISODE')
    : new Date(record.timestamp).toLocaleString();
  ui.sceneInspectorType.textContent = record.type || '—';
  ui.sceneInspectorConfidence.textContent = confidenceText(record.confidence);
  ui.sceneInspectorParticipant.textContent =
    record.participantName || record.participantId || record.trackId || '—';
  ui.sceneInspectorObject.textContent =
    record.objectLabel || record.objectId || '—';
  ui.sceneInspectorZone.textContent =
    record.zoneName || record.zoneId || '—';
  ui.sceneInspectorDuration.textContent = isEpisode
    ? formatSceneDuration(durationMs)
    : 'instant';
  ui.sceneInspectorSummary.textContent = isEpisode
    ? (
        (record.participantName ? record.participantName + ' · ' : '') +
        (record.label || record.type || 'episode')
      )
    : (record.summary || record.type || 'scene change');
  ui.sceneInspectorEvidence.textContent = JSON.stringify(
    record.evidence || {},
    null,
    2
  );
  ui.sceneInspectorJson.textContent = JSON.stringify(record, null, 2);
}

function createSceneRow(record, kind) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'episode'
    ? 'scene-episode-row'
    : 'scene-change-row';
  button.addEventListener('click', () => openSceneEvidenceInspector(record, kind));

  const top = document.createElement('div');
  const type = document.createElement('i');
  const time = document.createElement('span');
  type.textContent = record.type || kind;
  time.textContent = new Date(
    kind === 'episode'
      ? Number(record.startedAt || Date.now())
      : Number(record.timestamp || Date.now())
  ).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  top.append(type, time);

  const summary = document.createElement('strong');
  summary.textContent = kind === 'episode'
    ? (
        (record.participantName ? record.participantName + ' · ' : '') +
        (record.label || record.type || 'episode')
      )
    : (record.summary || record.type);

  const meta = document.createElement('small');
  if (kind === 'episode') {
    const duration = record.endedAt
      ? Number(record.durationMs || record.endedAt - record.startedAt)
      : Date.now() - Number(record.startedAt || Date.now());
    meta.textContent = [
      record.endedAt ? formatSceneDuration(duration) : 'ACTIVE',
      record.zoneName,
      record.objectLabel,
      confidenceText(record.confidence)
    ].filter(Boolean).join(' · ');
  } else {
    meta.textContent = [
      record.zoneName,
      record.objectLabel,
      confidenceText(record.confidence)
    ].filter(Boolean).join(' · ');
  }

  button.append(top, summary, meta);
  return button;
}

function renderSceneChanges() {
  ui.sceneChangeFeed.replaceChildren();
  const changes = sceneState.changes.slice(-24).reverse();

  if (!changes.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent = 'No meaningful scene changes yet.';
    ui.sceneChangeFeed.append(empty);
    return;
  }

  for (const change of changes) {
    ui.sceneChangeFeed.append(createSceneRow(change, 'change'));
  }
}

function renderSceneEpisodes() {
  ui.sceneEpisodeFeed.replaceChildren();

  const active = Object.values(sceneState.activeEpisodes)
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
  const completed = sceneState.episodes.slice(-16).reverse();
  const records = [
    ...active.map((record) => ({ record, active: true })),
    ...completed.map((record) => ({ record, active: false }))
  ].slice(0, 24);

  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent = 'Stable activities and conversations will become episodes.';
    ui.sceneEpisodeFeed.append(empty);
    ui.sceneEpisodeStatus.textContent = 'No episodes';
    return;
  }

  for (const item of records) {
    const row = createSceneRow(item.record, 'episode');
    if (item.active) row.classList.add('active');
    ui.sceneEpisodeFeed.append(row);
  }

  ui.sceneEpisodeStatus.textContent =
    active.length + ' active · ' + sceneState.episodes.length + ' completed';
}

function renderSceneZones() {
  ui.sceneZoneList.replaceChildren();
  ui.radarZones.replaceChildren();

  if (!sceneState.zones.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent = 'Add named zones such as Desk, Doorway, Couch, or Workstation.';
    ui.sceneZoneList.append(empty);
  }

  for (const zone of sceneState.zones) {
    const row = document.createElement('div');
    row.className = 'scene-zone-row';

    const copy = document.createElement('div');
    const name = document.createElement('strong');
    const meta = document.createElement('span');
    name.textContent = zone.name;
    meta.textContent = [
      'x ' + Math.round(zone.x * 100) + '%',
      'y ' + Math.round(zone.y * 100) + '%',
      Math.round(zone.width * 100) + '×' + Math.round(zone.height * 100) + '%'
    ].join(' · ');
    copy.append(name, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'agent-entity-action';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void deleteSceneZone(zone.id));

    row.append(copy, remove);
    ui.sceneZoneList.append(row);

    if (zone.enabled && ui.sceneOverlay.checked) {
      const region = document.createElement('div');
      region.className = 'radar-zone';
      region.style.left = (zone.x * 100) + '%';
      region.style.top = (zone.y * 100) + '%';
      region.style.width = (zone.width * 100) + '%';
      region.style.height = (zone.height * 100) + '%';

      const label = document.createElement('span');
      label.textContent = zone.name;
      region.append(label);
      ui.radarZones.append(region);
    }
  }

  ui.sceneZoneStatus.textContent = sceneState.zones.length + ' zones';
}

function cameraStatusFor(camera) {
  if (camera.primary) return runtime.running ? 'online' : 'offline';
  return runtime.cameraStatuses.get(camera.id) || 'offline';
}

function renderCameraNetwork() {
  ui.cameraRegistryList.replaceChildren();

  const cameras = runtime.cameraConfigs;
  const onlineCount = cameras.filter(
    (camera) => cameraStatusFor(camera) === 'online'
  ).length;

  ui.cameraNetworkStatus.textContent =
    cameras.length + ' configured · ' + onlineCount + ' online';

  if (!cameras.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    empty.textContent =
      'Start Agent Eyes to register the main camera, then add secondary room sensors.';
    ui.cameraRegistryList.append(empty);
  }

  for (const camera of cameras) {
    const card = document.createElement('article');
    card.className = 'camera-registry-card';
    if (camera.primary) card.classList.add('primary-camera');

    const head = document.createElement('div');
    head.className = 'camera-registry-card-head';

    const title = document.createElement('div');
    const name = document.createElement('strong');
    const meta = document.createElement('span');
    name.textContent = camera.name;
    meta.textContent = [
      camera.id,
      camera.roomId,
      camera.primary ? 'MAIN' : 'SECONDARY',
      camera.enabled ? 'ENABLED' : 'DISABLED'
    ].join(' · ');
    title.append(name, meta);

    const status = document.createElement('b');
    const statusValue = cameraStatusFor(camera);
    status.className = 'camera-state ' + statusValue;
    status.textContent = statusValue.toUpperCase();

    head.append(title, status);

    const details = document.createElement('div');
    details.className = 'camera-registry-details';

    const calibration = document.createElement('span');
    calibration.textContent = cameraCalibrationValid(camera)
      ? '4-point calibration valid'
      : 'calibration invalid';

    const coverage = cameraCoveragePolygon(camera);
    const coverageText = document.createElement('span');
    coverageText.textContent = coverage
      .map((point) => (
        Math.round(point.x * 100) + ',' + Math.round(point.y * 100)
      ))
      .join(' → ');

    const device = document.createElement('span');
    device.textContent = cameraDeviceLabel(camera.deviceId);

    details.append(calibration, coverageText, device);

    const actions = document.createElement('div');
    actions.className = 'camera-registry-actions';

    const calibrate = document.createElement('button');
    calibrate.type = 'button';
    calibrate.className = 'agent-entity-action';
    calibrate.textContent = 'Calibrate';
    calibrate.addEventListener('click', () => openCameraCalibration(camera.id));
    actions.append(calibrate);

    if (!camera.primary) {
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'agent-entity-action';
      main.textContent = 'Use as main';
      main.addEventListener('click', () => void makeCameraPrimary(camera.id));

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'agent-entity-action';
      toggle.textContent = camera.enabled ? 'Disable' : 'Enable';
      toggle.addEventListener('click', () => void toggleCameraEnabled(camera.id));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'agent-entity-action';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => void removeCamera(camera.id));

      actions.append(main, toggle, remove);
    }

    card.append(head, details, actions);
    ui.cameraRegistryList.append(card);
  }

  const configuredSecondaries = cameras.filter(
    (camera) => !camera.primary && camera.enabled
  ).length;
  ui.fusionStatus.textContent = configuredSecondaries
    ? onlineCount + ' cameras online'
    : 'Single camera';
}

function mapPolygonCss(points) {
  return points
    .map((point) => (
      (point.x * 100).toFixed(2) + '% ' +
      (point.y * 100).toFixed(2) + '%'
    ))
    .join(', ');
}

function renderWorldMap() {
  ui.worldMapCoverage.replaceChildren();
  ui.worldMapEntities.replaceChildren();

  for (const camera of runtime.cameraConfigs) {
    if (!camera.enabled || !cameraCalibrationValid(camera)) continue;

    const polygon = document.createElement('div');
    polygon.className = 'world-camera-coverage';
    if (camera.primary) polygon.classList.add('primary');
    if (cameraStatusFor(camera) !== 'online') polygon.classList.add('offline');
    polygon.style.clipPath = 'polygon(' + mapPolygonCss(cameraCoveragePolygon(camera)) + ')';

    const label = document.createElement('span');
    const points = cameraCoveragePolygon(camera);
    const center = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
    label.textContent = camera.id;
    label.style.left = (center.x * 100) + '%';
    label.style.top = (center.y * 100) + '%';
    polygon.append(label);
    ui.worldMapCoverage.append(polygon);
  }

  for (const entity of runtime.fusionState.participants || []) {
    const dot = document.createElement('div');
    dot.className = 'world-entity participant ' +
      (entity.participantId ? 'known' : 'unknown');
    if (entity.overlap) dot.classList.add('overlap');
    if (entity.status === 'last-known') dot.classList.add('last-known');
    if (entity.positionConflict) dot.classList.add('conflict');

    dot.style.left = (entity.roomPosition.x * 100) + '%';
    dot.style.top = (entity.roomPosition.y * 100) + '%';

    const label = document.createElement('span');
    label.textContent = [
      entity.participantName || entity.id,
      entity.cameraIds?.join('+'),
      entity.positionConflict ? 'CALIBRATION CONFLICT' : null
    ].filter(Boolean).join(' · ');
    dot.append(label);

    if (entity.participantId) {
      const local = runtime.tracks.find(
        (track) => track.participantId === entity.participantId
      );
      if (local) {
        dot.tabIndex = 0;
        dot.setAttribute('role', 'button');
        dot.addEventListener('click', () => openEvidenceInspector(local.id));
      }
    }

    ui.worldMapEntities.append(dot);
  }

  for (const object of runtime.fusionState.objects || []) {
    const dot = document.createElement('div');
    dot.className = 'world-entity object';
    if (object.overlap) dot.classList.add('overlap');
    if (object.status === 'last-known') dot.classList.add('last-known');

    dot.style.left = (object.roomPosition.x * 100) + '%';
    dot.style.top = (object.roomPosition.y * 100) + '%';

    const label = document.createElement('span');
    label.textContent = [
      object.id,
      object.label,
      object.cameraIds?.join('+')
    ].filter(Boolean).join(' · ');
    dot.append(label);

    const primaryId = primaryCameraConfig()?.id;
    const primaryObservation = object.observations?.find(
      (observation) => observation.cameraId === primaryId
    );
    if (primaryObservation) {
      dot.tabIndex = 0;
      dot.setAttribute('role', 'button');
      dot.addEventListener('click', () => (
        openObjectEvidenceInspector(primaryObservation.localObjectId)
      ));
    }

    ui.worldMapEntities.append(dot);
  }

  const onlineCount = runtime.cameraConfigs.filter(
    (camera) => cameraStatusFor(camera) === 'online'
  ).length;
  const people = runtime.fusionState.participants || [];
  const objects = runtime.fusionState.objects || [];
  const overlaps =
    people.filter((entity) => entity.overlap).length +
    objects.filter((object) => object.overlap).length;

  ui.worldCameraCount.textContent = String(onlineCount);
  ui.worldPersonCount.textContent = String(
    people.filter((entity) => entity.status !== 'last-known').length
  );
  ui.worldObjectCount.textContent = String(
    objects.filter((object) => object.status !== 'last-known').length
  );
  ui.worldOverlapCount.textContent = String(overlaps);

  ui.worldMapStatus.textContent = onlineCount > 1
    ? onlineCount + ' cameras fused'
    : onlineCount === 1
      ? 'Single camera'
      : 'Offline';
}

function renderSceneIntelligence() {
  const snapshot = sceneStateSnapshot(sceneState);
  const activeActivities = snapshot.activeEpisodes.filter(
    (episode) => episode.type !== 'conversation'
  ).length;
  const memoryObjects = snapshot.objects.filter(
    (object) => object.status === 'last-known'
  ).length;

  ui.sceneActivityCount.textContent = String(activeActivities);
  ui.sceneMemoryObjectCount.textContent = String(memoryObjects);
  ui.sceneEpisodeCount.textContent = String(
    snapshot.activeEpisodes.length + snapshot.recentEpisodes.length
  );
  ui.sceneChangeCount.textContent = String(sceneState.changes.length);
  ui.sceneRuntimeStatus.textContent = runtime.running
    ? 'Observing'
    : 'Memory ready';
  ui.sceneStatus.textContent = runtime.running
    ? 'Temporal online'
    : 'Memory online';

  renderSceneChanges();
  renderSceneEpisodes();
  renderSceneZones();
  renderSceneEvidenceInspector();
}

function renderRadar() {
  ui.radarTracks.replaceChildren();
  renderSceneZones();

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
    dot.tabIndex = 0;
    dot.setAttribute('role', 'button');
    dot.addEventListener('click', () => openEvidenceInspector(track.id));
    dot.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEvidenceInspector(track.id);
      }
    });
    ui.radarTracks.append(dot);
  }

  for (const object of runtime.objects) {
    if (!object.stable || object.status === 'reacquiring') continue;

    const dot = document.createElement('div');
    dot.className = 'radar-track object';
    if (activeInteractionForObject(object.id)) dot.classList.add('interacting');
    dot.style.left = (Number(object.cx || 0.5) * 100) + '%';
    dot.style.top = (Number(object.cy || 0.5) * 100) + '%';
    dot.tabIndex = 0;
    dot.setAttribute('role', 'button');

    const label = document.createElement('span');
    label.textContent = object.id + ' · ' + object.label;
    dot.append(label);

    dot.addEventListener('click', () => openObjectEvidenceInspector(object.id));
    dot.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openObjectEvidenceInspector(object.id);
      }
    });

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
    case 'behavior.changed':
      return (event.participantName || event.trackId || 'Participant') + ' behavior → ' +
        [
          event.data?.behavior?.posture,
          event.data?.behavior?.motion,
          event.data?.behavior?.orientation
        ].filter(Boolean).join(' · ');
    case 'attention.changed':
      return (event.participantName || event.trackId || 'Participant') + ' attention → ' +
        (event.data?.attention?.targetName || event.data?.attention?.targetType || 'unknown');
    case 'gesture.detected':
      return (event.participantName || event.trackId || 'Participant') + ' gesture → ' +
        String(event.data?.gesture || 'gesture');
    case 'object.detected':
      return (event.data?.objectId || 'Object') + ' detected · ' +
        String(event.data?.label || 'object');
    case 'object.reacquired':
      return (event.data?.objectId || 'Object') + ' reacquired · ' +
        String(event.data?.label || 'object');
    case 'object.lost':
      return (event.data?.objectId || 'Object') + ' lost · ' +
        String(event.data?.label || 'object');
    case 'object.picked_up':
      return (event.participantName || event.trackId || 'Participant') +
        ' picked up ' + String(event.data?.label || event.data?.objectLabel || 'object');
    case 'object.put_down':
      return (event.participantName || event.trackId || 'Participant') +
        ' put down ' + String(event.data?.label || event.data?.objectLabel || 'object');
    case 'interaction.started':
      return (event.participantName || event.trackId || 'Participant') + ' · ' +
        String(event.data?.type || 'interaction') + ' · ' +
        String(event.data?.objectLabel || event.data?.objectId || 'object');
    case 'interaction.ended':
      return (event.participantName || event.trackId || 'Participant') + ' ended ' +
        String(event.data?.type || 'interaction') + ' · ' +
        String(event.data?.objectLabel || event.data?.objectId || 'object');
    case 'transcript.turn':
      return (event.participantName || 'Unknown speaker') + ': ' + String(event.data?.text || '');
    case 'camera.status':
      return String(event.data?.cameraName || event.data?.cameraId || 'Camera') +
        ' → ' + String(event.data?.status || '');
    case 'camera.handoff':
      return (event.participantName || event.participantId || 'Participant') +
        ' camera handoff · ' +
        String(event.data?.fromCameraId || '—') + ' → ' +
        String(event.data?.toCameraId || '—');
    case 'camera.overlap_fused':
      return (event.participantName || event.participantId || 'Participant') +
        ' fused across ' + String(event.data?.cameraIds?.join(' + ') || 'cameras');
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
  const world = {
    room: snapshot,
    scene: sceneStateSnapshot(sceneState),
    cameraFusion: runtime.fusionState
  };
  ui.stateJson.textContent = JSON.stringify(world, null, 2);

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
  ui.poseCount.textContent = String(
    runtime.tracks.filter((track) => track.behaviorEvidence?.poseConfidence >= 0.28).length
  );
  ui.attentionCount.textContent = String(
    runtime.tracks.filter((track) => Number(track.behaviorEvidence?.attention?.confidence || 0) >= 0.32).length
  );
  ui.objectCount.textContent = String(
    runtime.objects.filter((object) => object.stable && object.status !== 'reacquiring').length
  );
  ui.handCount.textContent = String(runtime.hands.length);
  ui.interactionCount.textContent = String(runtime.activeInteractions.size);
}

function renderAll() {
  renderCameraNetwork();
  renderWorldMap();
  renderParticipants();
  renderObjects();
  renderRadar();
  renderSignals();
  renderRoomState();
  renderEvidenceInspector();
  renderObjectEvidenceInspector();
  renderSceneIntelligence();
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
    if (!runtime.startedAt) runtime.startedAt = Date.now();
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
  const text = JSON.stringify({
    room: roomStateSnapshot(roomState),
    scene: sceneStateSnapshot(sceneState),
    cameraFusion: runtime.fusionState
  }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    ui.copyState.textContent = 'Copied';
    setTimeout(() => {
      ui.copyState.textContent = 'Copy world JSON';
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
ui.closeInspector.addEventListener('click', closeEvidenceInspector);
ui.closeObjectInspector.addEventListener('click', closeObjectEvidenceInspector);
ui.closeSceneInspector.addEventListener('click', closeSceneEvidenceInspector);
ui.sceneZoneForm.addEventListener('submit', (event) => void addSceneZone(event));
ui.clearSceneMemory.addEventListener('click', () => void clearSavedSceneMemory());
ui.poseOverlay.addEventListener('change', drawOverlay);
ui.attentionOverlay.addEventListener('change', drawOverlay);
ui.objectOverlay.addEventListener('change', drawOverlay);
ui.sceneOverlay.addEventListener('change', () => {
  renderSceneZones();
  drawOverlay();
});
window.addEventListener('resize', () => {
  resizeOverlay();
  drawOverlay();
});
window.addEventListener('beforeunload', stopPerception);

await reloadParticipants();
await initializeSceneMemory();
renderAll();
renderEventFeed();
renderRoomState();
setHealth('standby');
setInterval(updateClock, 1000);
