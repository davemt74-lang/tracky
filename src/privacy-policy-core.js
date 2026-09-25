const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export const PRIVACY_REGION_MODES = Object.freeze([
  'ignore',
  'anonymous',
  'live-only'
]);

export const OBSERVATION_KINDS = Object.freeze([
  'participant',
  'object',
  'behavior',
  'voice',
  'transcript',
  'environment',
  'spatial-memory'
]);

export function defaultObservationPolicy(roomId = 'ROOM01') {
  return {
    roomId: String(roomId || 'ROOM01'),
    allowVisualObservation: true,
    allowParticipantIdentity: true,
    allowAnonymousTracking: true,
    allowObjectObservation: true,
    allowBehaviorAnalysis: true,
    allowRoomAudio: true,
    allowVoiceMatching: true,
    allowLiveTranscription: true,
    allowTranscriptStorage: true,
    allowSpatialMemory: true,
    allowEnvironmentComparison: true,
    retainPrimaryImages: true,
    retainAlternateViewImages: true,
    retainComparisonImages: false,
    retainChangeEvidenceImages: false,
    analyzeScreenContent: false,
    sensitiveRegions: [],
    updatedAt: Date.now()
  };
}

export function normalizePrivacyRegion(region = {}, index = 0) {
  const mode = PRIVACY_REGION_MODES.includes(region.mode)
    ? region.mode
    : 'ignore';
  const appliesTo = Array.isArray(region.appliesTo) && region.appliesTo.length
    ? [...new Set(region.appliesTo.map(String))]
    : ['participant','object','environment'];

  const x = clamp01(region.x ?? 0);
  const y = clamp01(region.y ?? 0);
  const width = Math.max(0.01, Math.min(1 - x, Number(region.width ?? 0.2)));
  const height = Math.max(0.01, Math.min(1 - y, Number(region.height ?? 0.2)));

  return {
    id: String(region.id || 'PRIV-' + String(index + 1).padStart(3, '0')),
    name: String(region.name || 'Privacy region'),
    mode,
    x,
    y,
    width,
    height,
    appliesTo,
    enabled: region.enabled !== false,
    maskImage: region.maskImage !== false,
    createdAt: Number(region.createdAt || Date.now()),
    updatedAt: Number(region.updatedAt || Date.now())
  };
}

export function normalizeObservationPolicy(policy = {}, roomId = null) {
  const defaults = defaultObservationPolicy(roomId || policy.roomId || 'ROOM01');
  return {
    ...defaults,
    ...policy,
    roomId: String(policy.roomId || defaults.roomId),
    sensitiveRegions: (policy.sensitiveRegions || [])
      .map((region, index) => normalizePrivacyRegion(region, index)),
    updatedAt: Number(policy.updatedAt || Date.now())
  };
}

export function pointInPrivacyRegion(point, region) {
  if (!point || !region?.enabled) return false;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= region.x &&
    x <= region.x + region.width &&
    y >= region.y &&
    y <= region.y + region.height
  );
}

export function matchingPrivacyRegion(policy, kind, position) {
  const normalized = normalizeObservationPolicy(policy);
  return normalized.sensitiveRegions.find((region) => (
    region.enabled &&
    region.appliesTo.includes(kind) &&
    pointInPrivacyRegion(position, region)
  )) || null;
}

function roomLevelAllowed(policy, kind) {
  switch (kind) {
    case 'participant':
      return policy.allowVisualObservation && policy.allowAnonymousTracking;
    case 'object':
      return policy.allowVisualObservation && policy.allowObjectObservation;
    case 'behavior':
      return policy.allowVisualObservation && policy.allowBehaviorAnalysis;
    case 'voice':
      return policy.allowRoomAudio;
    case 'transcript':
      return policy.allowRoomAudio && policy.allowLiveTranscription;
    case 'environment':
      return policy.allowVisualObservation && policy.allowEnvironmentComparison;
    case 'spatial-memory':
      return policy.allowSpatialMemory;
    default:
      return true;
  }
}

export function observationDecision(input = {}) {
  const policy = normalizeObservationPolicy(input.policy, input.roomId);
  const kind = String(input.kind || 'participant');
  if (!roomLevelAllowed(policy, kind)) {
    return {
      allowed: false,
      anonymize: false,
      retentionAllowed: false,
      reason: 'room-policy',
      region: null
    };
  }

  const region = matchingPrivacyRegion(policy, kind, input.position);
  if (!region) {
    return {
      allowed: true,
      anonymize: kind === 'participant' && !policy.allowParticipantIdentity,
      retentionAllowed: kind === 'transcript'
        ? policy.allowTranscriptStorage
        : kind === 'spatial-memory'
          ? policy.allowSpatialMemory
          : true,
      reason: null,
      region: null
    };
  }

  if (region.mode === 'ignore') {
    return {
      allowed: false,
      anonymize: false,
      retentionAllowed: false,
      reason: 'privacy-region-ignore',
      region
    };
  }

  if (region.mode === 'anonymous') {
    return {
      allowed: true,
      anonymize: kind === 'participant' || kind === 'behavior' || kind === 'voice' || kind === 'transcript',
      retentionAllowed: kind === 'transcript'
        ? policy.allowTranscriptStorage
        : kind === 'spatial-memory'
          ? policy.allowSpatialMemory
          : true,
      reason: 'privacy-region-anonymous',
      region
    };
  }

  return {
    allowed: true,
    anonymize: kind === 'participant' && !policy.allowParticipantIdentity,
    retentionAllowed: false,
    reason: 'privacy-region-live-only',
    region
  };
}

export function applyParticipantObservationPolicy(observation, policy) {
  if (!observation) return null;
  const decision = observationDecision({
    policy,
    kind: 'participant',
    position: observation.roomPosition,
    roomId: observation.roomId
  });
  if (!decision.allowed) return null;

  const result = {
    ...observation,
    privacy: {
      mode: decision.region?.mode || 'observe',
      regionId: decision.region?.id || null,
      retentionAllowed: decision.retentionAllowed
    }
  };

  if (decision.anonymize) {
    result.participantId = null;
    result.participantName = null;
    result.identitySource = null;
    result.faceConfidence = 0;
  }

  if (!normalizeObservationPolicy(policy).allowBehaviorAnalysis) {
    result.behavior = null;
    result.poseConfidence = 0;
  }

  return result;
}

export function applyObjectObservationPolicy(observation, policy) {
  if (!observation) return null;
  const decision = observationDecision({
    policy,
    kind: 'object',
    position: observation.roomPosition,
    roomId: observation.roomId
  });
  if (!decision.allowed) return null;

  return {
    ...observation,
    privacy: {
      mode: decision.region?.mode || 'observe',
      regionId: decision.region?.id || null,
      retentionAllowed: decision.retentionAllowed
    }
  };
}

function eventKind(type = '') {
  if (type.startsWith('object.') || type.startsWith('interaction.')) return 'object';
  if (
    type.startsWith('behavior.') ||
    type.startsWith('attention.') ||
    type.startsWith('gesture.')
  ) return 'behavior';
  if (type.startsWith('voice.')) return 'voice';
  if (type === 'transcript.turn') return 'transcript';
  if (
    type.startsWith('participant.') ||
    type.startsWith('face.') ||
    type.startsWith('body.')
  ) return 'participant';
  return null;
}

export function sanitizeEventPayload(type, payload = {}, policy) {
  const kind = eventKind(type);
  if (!kind) return { suppressed: false, payload: { ...payload }, decision: null };

  const decision = observationDecision({
    policy,
    kind,
    position: payload.roomPosition,
    roomId: policy?.roomId
  });
  if (!decision.allowed) {
    return { suppressed: true, payload: null, decision };
  }

  const next = {
    ...payload,
    privacy: {
      ...(payload.privacy || {}),
      mode: decision.region?.mode || 'observe',
      regionId: decision.region?.id || null,
      retentionAllowed: decision.retentionAllowed
    }
  };

  if (decision.anonymize) {
    next.participantId = null;
    next.participantName = null;
    if (kind === 'voice' || kind === 'transcript') {
      next.source = 'privacy-anonymous';
    }
  }

  return { suppressed: false, payload: next, decision };
}

export function transcriptRetentionAllowed(policy, roomPosition = null) {
  return observationDecision({
    policy,
    kind: 'transcript',
    position: roomPosition,
    roomId: policy?.roomId
  }).retentionAllowed;
}

export function spatialMemoryRetentionAllowed(policy, position = null) {
  return observationDecision({
    policy,
    kind: 'spatial-memory',
    position,
    roomId: policy?.roomId
  }).retentionAllowed;
}

export function imageRetentionAllowed(policy, type = 'primary') {
  const normalized = normalizeObservationPolicy(policy);
  if (type === 'primary') return normalized.retainPrimaryImages === true;
  if (type === 'alternate') return normalized.retainAlternateViewImages === true;
  if (type === 'comparison') return normalized.retainComparisonImages === true;
  if (type === 'change-evidence') return normalized.retainChangeEvidenceImages === true;
  return false;
}

export function imageMaskRegions(policy) {
  return normalizeObservationPolicy(policy).sensitiveRegions
    .filter((region) => region.enabled && region.maskImage)
    .map((region) => ({
      id: region.id,
      name: region.name,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      mode: region.mode
    }));
}

export function pixelMaskRect(region, width, height) {
  const normalized = normalizePrivacyRegion(region);
  return {
    x: Math.floor(normalized.x * width),
    y: Math.floor(normalized.y * height),
    width: Math.ceil(normalized.width * width),
    height: Math.ceil(normalized.height * height)
  };
}

export function privacySummary(policy) {
  const normalized = normalizeObservationPolicy(policy);
  return {
    roomId: normalized.roomId,
    visualObservation: normalized.allowVisualObservation,
    identity: normalized.allowParticipantIdentity,
    anonymousTracking: normalized.allowAnonymousTracking,
    objects: normalized.allowObjectObservation,
    behavior: normalized.allowBehaviorAnalysis,
    roomAudio: normalized.allowRoomAudio,
    voiceMatching: normalized.allowVoiceMatching,
    liveTranscription: normalized.allowLiveTranscription,
    transcriptStorage: normalized.allowTranscriptStorage,
    spatialMemory: normalized.allowSpatialMemory,
    regionCount: normalized.sensitiveRegions.filter((region) => region.enabled).length
  };
}
