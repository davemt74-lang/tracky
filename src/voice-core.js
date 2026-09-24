import { clamp, cosineSimilarity, robustProfileSimilarity } from './participant-core.js';

export const VOICE_MATCH_THRESHOLD = 0.72;
export const CONVERSATION_DISTANCE = 0.28;
export const DEFAULT_SPEECH_MARGIN_DB = 12;
export const MIN_TRANSCRIPT_SIGNAL_DB = 8;

export function rmsLevel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Number(samples[i]) || 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function dbFromRms(rms) {
  if (!rms || rms <= 0) return -100;
  return Math.max(-100, 20 * Math.log10(rms));
}

export function normalizeAudio(samples) {
  if (!samples?.length) return new Float32Array();
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak < 1e-8) return Float32Array.from(samples);
  const scale = 0.95 / peak;
  return Float32Array.from(samples, (sample) => sample * scale);
}

export function bestVoiceMatch(
  embedding,
  participants,
  threshold = VOICE_MATCH_THRESHOLD,
  minMargin = 0.05
) {
  const candidates = [];

  for (const participant of participants || []) {
    if (participant.voiceRecognitionEnabled === false) continue;
    if (!voiceProfileReadiness(participant).ready) continue;

    candidates.push({
      participant,
      similarity: robustProfileSimilarity(embedding, participant.voiceEmbeddings || [])
    });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const best = candidates[0] || null;
  const second = candidates[1] || null;
  const margin = best ? best.similarity - (second?.similarity || 0) : 0;
  const matched = Boolean(best && best.similarity >= threshold && margin >= minMargin);

  return {
    matched,
    participant: matched ? best.participant : null,
    similarity: best?.similarity || 0,
    secondSimilarity: second?.similarity || 0,
    margin,
    ambiguous: Boolean(best && best.similarity >= threshold && margin < minMargin)
  };
}

export function voiceProfileReadiness(participant) {
  const samples = participant?.voiceProfileSamples || [];
  const embeddingCount = participant?.voiceEmbeddings?.length || 0;
  const seconds = samples.reduce((sum, sample) => sum + Number(sample.durationSeconds || 0), 0);
  return {
    sampleCount: samples.length,
    embeddingCount,
    totalSeconds: seconds,
    ready: embeddingCount >= 3 && seconds >= 15
  };
}

export function speakingThreshold(noiseFloorDb, marginDb = DEFAULT_SPEECH_MARGIN_DB) {
  return Math.max(-48, Number(noiseFloorDb || -60) + marginDb);
}

export function updateNoiseFloor(currentDb, observedDb, speaking = false, alpha = 0.04) {
  if (speaking || !Number.isFinite(observedDb)) return currentDb;
  const base = Number.isFinite(currentDb) ? currentDb : -60;
  return base * (1 - alpha) + observedDb * alpha;
}

export function signalToNoiseDb(levelDb, noiseFloorDb) {
  return Number(levelDb || -100) - Number(noiseFloorDb || -100);
}

export function transcriptSignalGate(input = {}) {
  const signalDb = signalToNoiseDb(input.levelDb, input.noiseFloorDb);
  const voiceConfidence = clamp(Number(input.voiceConfidence || 0));
  const bodyConfirmed = Boolean(input.bodyConfirmed);
  const vadConfirmed = Boolean(input.vadConfirmed);

  const confidence = clamp(
    (vadConfirmed ? 0.25 : 0) +
    clamp(signalDb / 24) * 0.25 +
    voiceConfidence * 0.40 +
    (bodyConfirmed ? 0.10 : 0)
  );

  return {
    accept: vadConfirmed && signalDb >= MIN_TRANSCRIPT_SIGNAL_DB && confidence >= 0.48,
    confidence,
    signalDb,
    vadConfirmed,
    bodyConfirmed,
    voiceConfidence
  };
}

export function trackSpatialPoint(track) {
  const box = track?.box;
  if (box && Number.isFinite(box.x) && Number.isFinite(box.y)) {
    const height = Math.max(0.05, Number(box.height || 0.5));
    return {
      x: Number.isFinite(box.cx) ? box.cx : box.x + Number(box.width || 0) / 2,
      y: box.y + height,
      height
    };
  }

  return {
    x: Number(track?.cx ?? 0.5),
    y: Number(track?.cy ?? 0.5),
    height: 0.5
  };
}

export function trackDistance(a, b) {
  const pa = trackSpatialPoint(a);
  const pb = trackSpatialPoint(b);
  const horizontal = Math.abs(pa.x - pb.x);
  const groundDepth = Math.abs(pa.y - pb.y) * 0.55;
  const scaleMismatch = Math.min(1, Math.abs(Math.log(pa.height / pb.height))) * 0.18;
  return Math.hypot(horizontal, groundDepth) + scaleMismatch;
}

export function nearbyParticipants(tracks, sourceTrack, maxDistance = CONVERSATION_DISTANCE) {
  return (tracks || [])
    .filter((track) => track.id !== sourceTrack.id)
    .filter((track) => track.participantId)
    .map((track) => ({ track, distance: trackDistance(sourceTrack, track) }))
    .filter((item) => item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

export function buildConversationGroups(tracks, maxDistance = CONVERSATION_DISTANCE) {
  const active = (tracks || []).filter(
    (track) =>
      track.id &&
      track.status !== 'occluded' &&
      track.status !== 'reacquiring'
  );
  const visited = new Set();
  const groups = [];

  for (const track of active) {
    if (visited.has(track.id)) continue;

    const queue = [track];
    const group = [];
    visited.add(track.id);

    while (queue.length) {
      const current = queue.shift();
      group.push(current);

      for (const candidate of active) {
        if (visited.has(candidate.id)) continue;
        if (trackDistance(current, candidate) <= maxDistance) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

export function conversationGroupForTrack(groups, trackId) {
  const index = (groups || []).findIndex((group) => group.some((track) => track.id === trackId));
  if (index < 0) return null;
  return {
    index,
    id: 'G' + String(index + 1).padStart(2, '0'),
    tracks: groups[index]
  };
}

export function createSpeakerTurn(input = {}) {
  return {
    id: input.id || 'turn-' + Math.random().toString(36).slice(2, 10),
    participantId: input.participantId || null,
    participantName: input.participantName || null,
    trackId: input.trackId || null,
    groupId: input.groupId || null,
    confidence: Number(input.confidence || 0),
    voiceConfidence: Number(input.voiceConfidence || 0),
    signalConfidence: Number(input.signalConfidence || 0),
    startedAt: Number(input.startedAt || 0),
    endedAt: Number(input.endedAt || input.startedAt || 0),
    durationMs: Math.max(0, Number(input.endedAt || input.startedAt || 0) - Number(input.startedAt || 0)),
    peakDb: Number.isFinite(input.peakDb) ? input.peakDb : -100,
    avgDb: Number.isFinite(input.avgDb) ? input.avgDb : -100,
    noiseFloorDb: Number.isFinite(input.noiseFloorDb) ? input.noiseFloorDb : -100,
    nearbyParticipantIds: Array.from(input.nearbyParticipantIds || []),
    nearbyParticipantNames: Array.from(input.nearbyParticipantNames || []),
    transcript: String(input.transcript || '').trim(),
    attribution: input.attribution || 'unknown'
  };
}

export function acknowledgeNewTrack(track, knownParticipant = null) {
  return {
    type: knownParticipant ? 'participant-arrived' : 'new-participant-detected',
    trackId: track.id,
    participantId: knownParticipant?.id || track.participantId || null,
    participantName: knownParticipant?.name || track.participantName || null,
    message: knownParticipant
      ? 'Participant recognized: ' + knownParticipant.name
      : 'New participant tracked: ' + track.id
  };
}

export function voiceEnrollmentConsistency(
  embedding,
  existingEmbeddings,
  minSimilarity = 0.65
) {
  const references = existingEmbeddings || [];
  if (!references.length) {
    return { accept: true, similarity: 1, reason: 'first-sample' };
  }

  const similarity = robustProfileSimilarity(embedding, references);
  return {
    accept: similarity >= minSimilarity,
    similarity,
    reason: similarity >= minSimilarity ? 'consistent' : 'speaker-mismatch'
  };
}

export function assessVoiceSampleLevels(levels, options = {}) {
  const clean = (levels || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) {
    return {
      accept: false,
      peakDb: -100,
      averageDb: -100,
      noiseFloorDb: -100,
      speechFraction: 0,
      signalDb: 0
    };
  }

  const peakDb = clean[clean.length - 1];
  const averageDb = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const floorIndex = Math.min(clean.length - 1, Math.floor(clean.length * 0.25));
  const noiseFloorDb = clean[floorIndex];
  const speechThresholdDb = Math.max(
    options.minAbsoluteSpeechDb ?? -50,
    noiseFloorDb + (options.minSignalDb ?? 9)
  );
  const speechFrames = clean.filter((value) => value >= speechThresholdDb).length;
  const speechFraction = speechFrames / clean.length;
  const signalDb = peakDb - noiseFloorDb;
  const accept = (
    peakDb >= (options.minPeakDb ?? -48) &&
    signalDb >= (options.minSignalDb ?? 9) &&
    speechFraction >= (options.minSpeechFraction ?? 0.20)
  );

  return {
    accept,
    peakDb,
    averageDb,
    noiseFloorDb,
    speechFraction,
    signalDb
  };
}

export function speakingState(levelDb, thresholdDb = -42) {
  return levelDb >= thresholdDb ? 'speaking' : 'quiet';
}

export function mergeVoicePresence(track, voice = {}, now = 0) {
  return {
    ...track,
    voiceLevelDb: Number.isFinite(voice.levelDb) ? voice.levelDb : track.voiceLevelDb ?? -100,
    voiceMatchConfidence: Number(voice.confidence ?? track.voiceMatchConfidence ?? 0),
    voiceParticipantId: voice.participantId ?? track.voiceParticipantId ?? null,
    voiceParticipantName: voice.participantName ?? track.voiceParticipantName ?? null,
    lastVoiceAt: voice.speaking ? now : track.lastVoiceAt ?? null,
    speaking: Boolean(voice.speaking)
  };
}
