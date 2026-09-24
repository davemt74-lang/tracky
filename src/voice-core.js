import { clamp, cosineSimilarity } from './participant-core.js';

export const VOICE_MATCH_THRESHOLD = 0.72;
export const CONVERSATION_DISTANCE = 0.28;
export const SPEAKING_HOLD_MS = 900;

export function rmsLevel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Number(samples[i]) || 0;
    sum += v * v;
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

export function bestVoiceMatch(embedding, participants, threshold = VOICE_MATCH_THRESHOLD) {
  let best = null;
  for (const participant of participants || []) {
    if (participant.voiceRecognitionEnabled === false) continue;
    for (const reference of participant.voiceEmbeddings || []) {
      const similarity = cosineSimilarity(embedding, reference);
      if (!best || similarity > best.similarity) best = { participant, similarity };
    }
  }

  return !best || best.similarity < threshold
    ? { matched: false, participant: null, similarity: best?.similarity || 0 }
    : { matched: true, participant: best.participant, similarity: best.similarity };
}

export function trackDistance(a, b) {
  return Math.hypot(
    Number(a?.cx ?? 0.5) - Number(b?.cx ?? 0.5),
    Number(a?.cy ?? 0.5) - Number(b?.cy ?? 0.5)
  );
}

export function nearbyParticipants(tracks, sourceTrack, maxDistance = CONVERSATION_DISTANCE) {
  return (tracks || [])
    .filter((track) => track.id !== sourceTrack.id)
    .map((track) => ({ track, distance: trackDistance(sourceTrack, track) }))
    .filter((item) => item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

export function buildConversationGroups(tracks, maxDistance = CONVERSATION_DISTANCE) {
  const active = (tracks || []).filter((track) => track.participantId);
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

export function createSpeakerTurn(input = {}) {
  return {
    id: input.id || 'turn-' + Math.random().toString(36).slice(2, 10),
    participantId: input.participantId || null,
    participantName: input.participantName || null,
    trackId: input.trackId || null,
    confidence: Number(input.confidence || 0),
    startedAt: Number(input.startedAt || 0),
    endedAt: Number(input.endedAt || input.startedAt || 0),
    durationMs: Math.max(0, Number(input.endedAt || input.startedAt || 0) - Number(input.startedAt || 0)),
    peakDb: Number.isFinite(input.peakDb) ? input.peakDb : -100,
    avgDb: Number.isFinite(input.avgDb) ? input.avgDb : -100,
    nearbyParticipantIds: Array.from(input.nearbyParticipantIds || []),
    transcript: String(input.transcript || '').trim()
  };
}

export function acknowledgeNewTrack(track, knownParticipant = null) {
  return {
    type: knownParticipant ? 'participant-arrived' : 'new-participant-detected',
    trackId: track.id,
    participantId: knownParticipant?.id || track.participantId || null,
    participantName: knownParticipant?.name || track.participantName || null,
    message: knownParticipant
      ? 'Participant detected: ' + knownParticipant.name
      : 'New participant detected: ' + track.id
  };
}

export function cloneReadiness(participant) {
  const samples = participant?.voiceSamples || [];
  const consent = participant?.voiceCloneConsent === true;
  const seconds = samples.reduce((sum, sample) => sum + Number(sample.durationSeconds || 0), 0);
  return {
    consent,
    sampleCount: samples.length,
    totalSeconds: seconds,
    ready: consent && samples.length >= 1 && seconds >= 10,
    cloned: Boolean(participant?.clonedVoiceId)
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
