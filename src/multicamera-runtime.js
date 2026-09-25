import {
  associateFacesToBodies,
  assignBodyTracks,
  attachFacesToTracks,
  augmentBodiesWithFaceFallbacks,
  carryOccludedTracks,
  dedupeParticipantAssignments,
  roomPresenceState
} from './room-tracking-core.js';
import {
  assignObjectTracks,
  carryLostObjectTracks
} from './object-core.js';
import {
  bestParticipantMatch
} from './participant-core.js';
import {
  buildBehaviorEvidence
} from './behavior-core.js';
import {
  mapCameraPoint
} from './camera-core.js';

const BODY_GRACE_MS = 6000;
const OBJECT_GRACE_MS = 2600;

function createHiddenVideo() {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.style.display = 'none';
  document.body.append(video);
  return video;
}

function nextLocalId(session, prefix) {
  session.counters[prefix] = Number(session.counters[prefix] || 0) + 1;
  return prefix + String(session.counters[prefix]).padStart(3, '0');
}

async function resolveLocalIdentities(tracks, participants) {
  const claimed = new Set(
    tracks
      .filter((track) => track.participantId)
      .map((track) => track.participantId)
  );

  const resolved = [];
  for (const track of tracks) {
    if (!track.embedding || track.participantId) {
      resolved.push(track);
      continue;
    }

    const match = bestParticipantMatch(
      track.embedding,
      (participants || []).filter((participant) => !claimed.has(participant.id))
    );

    if (match.matched) {
      claimed.add(match.participant.id);
      resolved.push({
        ...track,
        participantId: match.participant.id,
        participantName: match.participant.name,
        similarity: match.similarity,
        identitySource: 'face',
        status: 'matched'
      });
    } else {
      resolved.push(track);
    }
  }

  return resolved;
}

function participantObservation(camera, track) {
  const mapped = mapCameraPoint(camera, {
    x: Number(track.cx || 0.5),
    y: Number(track.cy || 0.5)
  });
  const behavior = track.behaviorEvidence || null;

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
    poseConfidence: Number(behavior?.poseConfidence || 0),
    continuityConfidence: track.status === 'body-lock' || track.status === 'matched'
      ? 0.92
      : track.status === 'occluded'
        ? 0.45
        : 0.68,
    status: track.status,
    behavior,
    identitySource: track.identitySource || null
  };
}

function objectObservation(camera, object) {
  return {
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
    stable: Boolean(object.stable),
    status: object.status
  };
}

export class MultiCameraSensorRuntime {
  constructor(options = {}) {
    this.identityEngine = options.identityEngine;
    this.getParticipants = options.getParticipants || (() => []);
    this.onObservation = options.onObservation || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.scanIntervalMs = options.scanIntervalMs || 850;
    this.sessions = new Map();
  }

  async start(camera) {
    if (!camera?.enabled || !camera.deviceId) return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API unavailable.');
    }

    await this.stop(camera.id);

    const video = createHiddenVideo();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: camera.deviceId },
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 20, max: 30 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    const session = {
      camera,
      video,
      stream,
      timer: 0,
      busy: false,
      tracks: [],
      objects: [],
      counters: { T: 0, O: 0 },
      startedAt: Date.now(),
      lastScanAt: 0
    };

    this.sessions.set(camera.id, session);
    this.onStatus(camera.id, 'online');
    this.schedule(session, 0);
    return true;
  }

  schedule(session, delay = this.scanIntervalMs) {
    clearTimeout(session.timer);
    if (!this.sessions.has(session.camera.id)) return;
    session.timer = setTimeout(() => void this.scan(session), delay);
  }

  setScanIntervalMs(intervalMs) {
    const next = Math.max(200, Math.min(10000, Number(intervalMs || this.scanIntervalMs)));
    if (next === this.scanIntervalMs) return next;
    this.scanIntervalMs = next;
    for (const session of this.sessions.values()) {
      if (!session.busy) this.schedule(session, next);
    }
    return next;
  }

  async scan(session) {
    if (
      session.busy ||
      !this.sessions.has(session.camera.id) ||
      session.video.readyState < 2
    ) {
      this.schedule(session);
      return;
    }

    session.busy = true;
    const now = performance.now();

    try {
      const room = await this.identityEngine.detectRoom(session.video);
      const faces = room.faces || [];
      const bodies = augmentBodiesWithFaceFallbacks(faces, room.bodies || []);
      const liveTracks = assignBodyTracks(
        session.tracks,
        bodies,
        now,
        { nextId: () => nextLocalId(session, 'T') }
      );

      const associations = associateFacesToBodies(faces, bodies);
      let tracks = attachFacesToTracks(
        liveTracks,
        faces,
        bodies,
        associations,
        now
      );

      tracks = await resolveLocalIdentities(
        tracks,
        await this.getParticipants(session.camera)
      );

      const liveIds = new Set(tracks.map((track) => track.id));
      const carried = carryOccludedTracks(
        session.tracks,
        tracks,
        now,
        BODY_GRACE_MS
      ).filter((track) => !liveIds.has(track.id));

      tracks = dedupeParticipantAssignments([...tracks, ...carried]);

      for (const track of tracks) {
        track.status = track.participantId
          ? roomPresenceState(track, now)
          : track.status || 'body-detected';
        if (!track.presenceAnnounced && now - Number(track.firstSeenAt || now) >= 900) {
          track.presenceAnnounced = true;
        }
        if (track.status !== 'occluded' && track.status !== 'reacquiring') {
          track.behaviorEvidence = buildBehaviorEvidence(track, tracks);
        }
      }

      const liveObjects = assignObjectTracks(
        session.objects,
        room.objects || [],
        now,
        { nextId: () => nextLocalId(session, 'O') }
      );
      const objectCarry = carryLostObjectTracks(
        session.objects,
        liveObjects,
        now,
        OBJECT_GRACE_MS
      );
      const objects = [...liveObjects, ...objectCarry];

      session.tracks = tracks;
      session.objects = objects;
      session.lastScanAt = Date.now();

      this.onObservation(session.camera.id, {
        camera: session.camera,
        timestamp: session.lastScanAt,
        participants: tracks
          .filter((track) => track.presenceAnnounced && track.status !== 'reacquiring')
          .map((track) => participantObservation(session.camera, track)),
        objects: objects
          .filter((object) => object.stable && object.status !== 'reacquiring')
          .map((object) => objectObservation(session.camera, object)),
        counts: {
          faces: faces.length,
          bodies: bodies.length,
          objects: (room.objects || []).length,
          hands: (room.hands || []).length
        }
      });
      this.onStatus(session.camera.id, 'online');
    } catch (error) {
      console.error('Secondary camera scan failed', session.camera.id, error);
      this.onStatus(session.camera.id, 'degraded');
    } finally {
      session.busy = false;
      this.schedule(session);
    }
  }

  async stop(cameraId) {
    const session = this.sessions.get(cameraId);
    if (!session) return false;

    clearTimeout(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
    session.video.srcObject = null;
    session.video.remove();
    this.sessions.delete(cameraId);
    this.onStatus(cameraId, 'offline');
    return true;
  }

  async stopAll() {
    for (const cameraId of [...this.sessions.keys()]) {
      await this.stop(cameraId);
    }
  }

  activeCameraIds() {
    return [...this.sessions.keys()];
  }
}
