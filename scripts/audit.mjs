import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const requiredFiles = [
  'index.html',
  'agent-eyes.js',
  'participants.html',
  'participants.js',
  'participant-voice.js',
  'experiments.html',
  'tracker.html',
  'tracker-experiment.js',
  'games.html',
  'vertical-motion.html',
  'vertical-motion.js',
  'styles.css',
  'README.md',
  'package.json',
  'src/tracker-core.js',
  'src/movement-core.js',
  'src/gameplay-core.js',
  'src/participant-core.js',
  'src/participant-store.js',
  'src/identity-engine.js',
  'src/room-tracking-core.js',
  'src/voice-core.js',
  'src/voice-engine.js',
  'src/room-audio-engine.js',
  'src/room-audio-worklet.js',
  'src/model-config.js',
  'src/perception-core.js',
  'src/behavior-core.js',
  'src/object-core.js',
  'src/scene-core.js',
  'src/scene-store.js',
  'src/camera-core.js',
  'src/camera-store.js',
  'src/fusion-core.js',
  'src/multicamera-runtime.js',
  'src/environment-core.js',
  'src/environment-runtime.js',
  'src/environment-store.js',
  'src/scene-graph-core.js',
  'src/world-state-core.js',
  'src/perception-replay-core.js',
  'src/multiroom-core.js',
  'src/visibility-core.js',
  'src/room-topology-core.js',
  'src/spatial-memory-store.js',
  'src/spatial-memory-core.js',
  'src/privacy-policy-core.js',
  'src/attention-core.js',
  'src/attention-store.js',
  'src/anomaly-store.js',
  'src/world-query-store.js',
  'src/world-query-core.js',
  'src/agent-context-core.js',
  'src/world-watch-core.js',
  'src/world-watch-store.js',
  'src/world-watch-language-core.js',
  'src/agent-briefing-core.js',
  'src/agent-briefing-store.js',
  'src/briefing-delivery-policy.js',
  'src/briefing-queue-core.js',
  'src/anomaly-core.js'
];

const runtimeJs = [
  'agent-eyes.js',
  'tracker-experiment.js',
  'vertical-motion.js',
  'participants.js',
  'participant-voice.js',
  'src/tracker-core.js',
  'src/movement-core.js',
  'src/gameplay-core.js',
  'src/participant-core.js',
  'src/participant-store.js',
  'src/identity-engine.js',
  'src/room-tracking-core.js',
  'src/voice-core.js',
  'src/voice-engine.js',
  'src/room-audio-engine.js',
  'src/room-audio-worklet.js',
  'src/model-config.js',
  'src/perception-core.js',
  'src/behavior-core.js',
  'src/object-core.js',
  'src/scene-core.js',
  'src/scene-store.js',
  'src/camera-core.js',
  'src/camera-store.js',
  'src/fusion-core.js',
  'src/multicamera-runtime.js',
  'src/environment-core.js',
  'src/environment-runtime.js',
  'src/environment-store.js',
  'src/scene-graph-core.js',
  'src/world-state-core.js',
  'src/perception-replay-core.js',
  'src/multiroom-core.js',
  'src/visibility-core.js',
  'src/room-topology-core.js',
  'src/spatial-memory-store.js',
  'src/spatial-memory-core.js',
  'src/privacy-policy-core.js',
  'src/attention-core.js',
  'src/attention-store.js',
  'src/anomaly-store.js',
  'src/world-query-store.js',
  'src/world-query-core.js',
  'src/agent-context-core.js',
  'src/world-watch-core.js',
  'src/world-watch-store.js',
  'src/world-watch-language-core.js',
  'src/agent-briefing-core.js',
  'src/agent-briefing-store.js',
  'src/briefing-delivery-policy.js',
  'src/briefing-queue-core.js',
  'src/anomaly-core.js'
];

const htmlContracts = [
  ['index.html', ['agent-eyes.js']],
  ['participants.html', ['participants.js', 'participant-voice.js']],
  ['tracker.html', ['tracker-experiment.js']],
  ['vertical-motion.html', ['vertical-motion.js']]
];

function fail(message) {
  failures.push(message);
}

function read(file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    fail('Missing required file: ' + file);
    return '';
  }
  return fs.readFileSync(absolute, 'utf8');
}

for (const file of requiredFiles) read(file);

const packageJson = JSON.parse(read('package.json') || '{}');
if (packageJson.version !== '2.3.0') {
  fail('package.json version must be 2.3.0');
}
if (packageJson.type !== 'module') {
  fail('package.json must use ESM via type=module');
}
if (!packageJson.scripts?.audit?.includes('scripts/audit.mjs')) {
  fail('package.json must expose the release audit script');
}
if (!packageJson.scripts?.validate) {
  fail('package.json must expose a validate script');
}
if (!packageJson.scripts?.test?.includes('agent-eyes.js')) {
  fail('test script must syntax-check Agent Eyes');
}
if (!packageJson.scripts?.test?.includes('src/perception-core.js')) {
  fail('test script must syntax-check perception core');
}
if (!packageJson.scripts?.test?.includes('src/behavior-core.js')) {
  fail('test script must syntax-check behavior core');
}
if (!packageJson.scripts?.test?.includes('src/object-core.js')) {
  fail('test script must syntax-check object core');
}
if (!packageJson.scripts?.test?.includes('src/scene-core.js')) {
  fail('test script must syntax-check scene core');
}
if (!packageJson.scripts?.test?.includes('src/scene-store.js')) {
  fail('test script must syntax-check scene store');
}
for (const file of [
  'src/camera-core.js',
  'src/camera-store.js',
  'src/fusion-core.js',
  'src/multicamera-runtime.js',
  'src/environment-core.js',
  'src/environment-runtime.js',
  'src/environment-store.js',
  'src/scene-graph-core.js',
  'src/world-state-core.js',
  'src/perception-replay-core.js',
  'src/room-topology-core.js',
  'src/visibility-core.js',
  'src/multiroom-core.js',
  'src/spatial-memory-core.js',
  'src/spatial-memory-store.js',
  'src/privacy-policy-core.js',
  'src/attention-core.js',
  'src/attention-store.js',
  'src/anomaly-core.js',
  'src/anomaly-store.js',
  'src/world-query-core.js',
  'src/world-query-store.js',
  'src/agent-context-core.js',
  'src/world-watch-core.js',
  'src/world-watch-store.js',
  'src/world-watch-language-core.js',
  'src/agent-briefing-core.js',
  'src/agent-briefing-store.js',
  'src/briefing-delivery-policy.js',
  'src/briefing-queue-core.js'
]) {
  if (!packageJson.scripts?.test?.includes(file)) {
    fail('test script must syntax-check ' + file);
  }
}

for (const file of runtimeJs) {
  const source = read(file);
  if (!source) continue;

  const banned = [
    ['innerHTML', /\.innerHTML\s*=/],
    ['eval()', /\beval\s*\(/],
    ['new Function()', /\bnew\s+Function\s*\(/],
    ['document.write()', /\bdocument\.write\s*\(/],
    ['insecure HTTP URL', /http:\/\//i]
  ];

  for (const [label, pattern] of banned) {
    if (pattern.test(source)) {
      fail(file + ' contains banned runtime pattern: ' + label);
    }
  }

  if (/clone/i.test(source)) {
    fail(file + ' contains obsolete voice-clone terminology');
  }

  const imports = [
    ...source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)
  ].map((match) => match[1]);

  for (const specifier of imports) {
    if (!specifier.startsWith('.')) continue;
    const resolved = path.resolve(root, path.dirname(file), specifier);
    const candidates = [
      resolved,
      resolved + '.js',
      path.join(resolved, 'index.js')
    ];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      fail(file + ' imports missing local module: ' + specifier);
    }
  }
}

for (const [htmlFile, jsFiles] of htmlContracts) {
  const html = read(htmlFile);
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1]);
  const seen = new Set();

  for (const id of ids) {
    if (seen.has(id)) fail(htmlFile + ' contains duplicate id #' + id);
    seen.add(id);
  }

  const externalScripts = [
    ...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)
  ]
    .map((match) => match[1])
    .filter((src) => /^https?:\/\//i.test(src));

  if (externalScripts.length) {
    fail(htmlFile + ' contains external script tags: ' + externalScripts.join(', '));
  }

  for (const jsFile of jsFiles) {
    const source = read(jsFile);
    const refs = new Set();

    for (const match of source.matchAll(/\$\(\s*['"]#([^'"]+)['"]\s*\)/g)) {
      refs.add(match[1]);
    }
    for (const match of source.matchAll(/document\.querySelector\(\s*['"]#([^'"]+)['"]\s*\)/g)) {
      refs.add(match[1]);
    }
    for (const match of source.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      refs.add(match[1]);
    }

    for (const id of refs) {
      if (!seen.has(id)) {
        fail(jsFile + ' references missing ' + htmlFile + ' element #' + id);
      }
    }
  }

  for (const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = match[1];
    if (!ref.startsWith('./') && !ref.startsWith('../')) continue;
    const clean = ref.split(/[?#]/)[0];
    const resolved = path.resolve(root, path.dirname(htmlFile), clean);
    if (!fs.existsSync(resolved)) {
      fail(htmlFile + ' references missing asset: ' + ref);
    }
  }
}

for (const htmlFile of ['index.html','participants.html','experiments.html','tracker.html','games.html','vertical-motion.html']) {
  const html = read(htmlFile);
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) fail(htmlFile + ' contains duplicate id #' + id);
    seen.add(id);
  }
}

const indexHtml = read('index.html');
if (!/Agent Eyes/.test(indexHtml) || !/PERCEPTION RUNTIME/.test(indexHtml)) {
  fail('index.html must be the Agent Eyes perception landing page');
}
if (/Camera Tracking Core/.test(indexHtml)) {
  fail('index.html must not remain the legacy tracker landing page');
}

const experimentsHtml = read('experiments.html');
if (!/tracker\.html/.test(experimentsHtml) || !/vertical-motion\.html/.test(experimentsHtml)) {
  fail('Experiments page must preserve tracker and Vertical Motion entry points');
}

const perceptionCore = read('src/perception-core.js');
for (const symbol of [
  'PerceptionEventBus',
  'createRoomState',
  'applyPerceptionEvent',
  'roomStateSnapshot'
]) {
  if (!perceptionCore.includes(symbol)) {
    fail('Perception core is missing required Agent interface: ' + symbol);
  }
}

const behaviorCore = read('src/behavior-core.js');
for (const symbol of [
  'buildBehaviorEvidence',
  'likelyAttentionTarget',
  'inferRaisedHands',
  'inferWave',
  'POSE_CONNECTIONS'
]) {
  if (!behaviorCore.includes(symbol)) {
    fail('Behavior core is missing required perception interface: ' + symbol);
  }
}

const objectCore = read('src/object-core.js');
for (const symbol of [
  'assignObjectTracks',
  'carryLostObjectTracks',
  'inferHolding',
  'inferPointingAt',
  'bestObjectInteractions',
  'interactionKey'
]) {
  if (!objectCore.includes(symbol)) {
    fail('Object core is missing required perception interface: ' + symbol);
  }
}

const sceneCore = read('src/scene-core.js');
for (const symbol of [
  'createSceneState',
  'updateSceneState',
  'sceneStateSnapshot',
  'replaceSceneZones',
  'deriveParticipantActivity',
  'SCENE_CHANGE_TYPES'
]) {
  if (!sceneCore.includes(symbol)) {
    fail('Scene core is missing required temporal interface: ' + symbol);
  }
}

const sceneStore = read('src/scene-store.js');
for (const symbol of [
  'saveSceneChanges',
  'saveSceneEpisodes',
  'listSceneChanges',
  'listSceneEpisodes',
  'saveSceneZones',
  'loadSceneZones',
  'clearSceneMemory'
]) {
  if (!sceneStore.includes(symbol)) {
    fail('Scene store is missing required local memory interface: ' + symbol);
  }
}

const cameraCore = read('src/camera-core.js');
for (const symbol of [
  'normalizeCameraConfig',
  'mapCameraPoint',
  'mapCameraBox',
  'cameraCoveragePolygon',
  'cameraCalibrationValid'
]) {
  if (!cameraCore.includes(symbol)) {
    fail('Camera core is missing required room-mapping interface: ' + symbol);
  }
}

const cameraStore = read('src/camera-store.js');
for (const symbol of [
  'listCameraConfigs',
  'saveCameraConfig',
  'deleteCameraConfig',
  'normalizeCameraList'
]) {
  if (!cameraStore.includes(symbol)) {
    fail('Camera store is missing required registry interface: ' + symbol);
  }
}

const fusionCore = read('src/fusion-core.js');
for (const symbol of [
  'fuseParticipantObservations',
  'fuseWorldObjects',
  'updateWorldFusion',
  'camera.handoff',
  'anonymous-spatial-overlap'
]) {
  if (!fusionCore.includes(symbol)) {
    fail('Fusion core is missing required multi-camera interface: ' + symbol);
  }
}

const multiCameraRuntime = read('src/multicamera-runtime.js');
if (!/class MultiCameraSensorRuntime/.test(multiCameraRuntime)) {
  fail('Secondary camera runtime class is missing');
}
if (!/presenceAnnounced/.test(multiCameraRuntime)) {
  fail('Secondary camera runtime must stabilize body presence before fusion');
}

const environmentCore = read('src/environment-core.js');
for (const symbol of [
  'fingerprintImageData',
  'baselineQuality',
  'matchEnvironment',
  'environmentDrift',
  'suggestRoomMapping',
  'estimateCameraPoseDrift',
  'canonicalLandmarkLabel'
]) {
  if (!environmentCore.includes(symbol)) {
    fail('Environment core is missing required baseline/mapping interface: ' + symbol);
  }
}

const environmentRuntime = read('src/environment-runtime.js');
for (const symbol of [
  'captureBestEnvironmentFrame',
  'buildEnvironmentObservation',
  'analyzeEnvironmentObservation',
  'assistedMappingFromObservation',
  'environmentProviderContract'
]) {
  if (!environmentRuntime.includes(symbol)) {
    fail('Environment runtime is missing required capture/matching interface: ' + symbol);
  }
}

const environmentStore = read('src/environment-store.js');
for (const symbol of [
  'listEnvironmentRooms',
  'saveEnvironmentRoom',
  'saveEnvironmentView',
  'saveEnvironmentHistory',
  'defaultEnvironmentPolicy',
  'loadEnvironmentPolicy',
  'saveEnvironmentPolicy'
]) {
  if (!environmentStore.includes(symbol)) {
    fail('Environment store is missing required persistence/privacy interface: ' + symbol);
  }
}

const sceneGraphCore = read('src/scene-graph-core.js');
for (const symbol of [
  'buildRoomSceneGraph',
  'confirmGraphNode',
  'confirmGraphEdge',
  'nearestGraphNode',
  'graphFactsForEntity',
  'sceneGraphSnapshot'
]) {
  if (!sceneGraphCore.includes(symbol)) {
    fail('Scene graph core is missing required physical-world interface: ' + symbol);
  }
}

const worldStateCore = read('src/world-state-core.js');
for (const symbol of [
  'derivePhysicalWorldState',
  'evidenceQuorum',
  'detectContradictions',
  'rankWorldAttention',
  'worldStateSnapshot'
]) {
  if (!worldStateCore.includes(symbol)) {
    fail('World state core is missing required confidence/attention interface: ' + symbol);
  }
}

const replayCore = read('src/perception-replay-core.js');
for (const symbol of [
  'appendReplayFrame',
  'replayFrames',
  'simulateEnvironmentScenario'
]) {
  if (!replayCore.includes(symbol)) {
    fail('Perception replay core is missing required regression interface: ' + symbol);
  }
}

const topologyCore = read('src/room-topology-core.js');
for (const symbol of [
  'buildWorldTopology',
  'areRoomsAdjacent',
  'shortestRoomPath',
  'portalForTransition',
  'proposeTopologyConnection'
]) {
  if (!topologyCore.includes(symbol)) {
    fail('Room topology core is missing required interface: ' + symbol);
  }
}

const visibilityCore = read('src/visibility-core.js');
for (const symbol of [
  'cameraCanSeePosition',
  'classifyVisibility',
  'visibilityOccludersFromGraph'
]) {
  if (!visibilityCore.includes(symbol)) {
    fail('Visibility core is missing required interface: ' + symbol);
  }
}

const multiRoomCore = read('src/multiroom-core.js');
for (const symbol of [
  'createMultiRoomWorld',
  'reconcileParticipantLocations',
  'reconcileObjectLocations',
  'updateRoomConversations',
  'updateMultiRoomWorld',
  'multiRoomSnapshot'
]) {
  if (!multiRoomCore.includes(symbol)) {
    fail('Multi-room core is missing required continuity interface: ' + symbol);
  }
}

const spatialMemoryCore = read('src/spatial-memory-core.js');
for (const symbol of [
  'createSpatialMemoryState',
  'observeSpatialMemory',
  'expectedLocationFor',
  'confirmedExpectedLocationFor',
  'entityHistory',
  'entityJourney',
  'recordCirculationTransition',
  'resolveMemoryProposal',
  'ignoreMemoryProposal',
  'spatialMemorySnapshot'
]) {
  if (!spatialMemoryCore.includes(symbol)) {
    fail('Spatial memory core is missing required learned-knowledge interface: ' + symbol);
  }
}
if (!spatialMemoryCore.includes("'owned-by'") || !spatialMemoryCore.includes("'belongs-to'")) {
  fail('Spatial memory must explicitly exclude inferred ownership relationships');
}

const spatialMemoryStore = read('src/spatial-memory-store.js');
for (const symbol of [
  'loadSpatialMemory',
  'saveSpatialMemory',
  'clearSpatialMemory'
]) {
  if (!spatialMemoryStore.includes(symbol)) {
    fail('Spatial memory store is missing required local persistence interface: ' + symbol);
  }
}

const privacyPolicyCore = read('src/privacy-policy-core.js');
for (const symbol of [
  'defaultObservationPolicy',
  'normalizePrivacyRegion',
  'normalizeObservationPolicy',
  'observationDecision',
  'applyParticipantObservationPolicy',
  'applyObjectObservationPolicy',
  'sanitizeEventPayload',
  'transcriptRetentionAllowed',
  'spatialMemoryRetentionAllowed',
  'imageRetentionAllowed',
  'imageMaskRegions',
  'privacySummary'
]) {
  if (!privacyPolicyCore.includes(symbol)) {
    fail('Privacy policy core is missing required enforcement interface: ' + symbol);
  }
}
for (const mode of ['ignore','anonymous','live-only']) {
  if (!privacyPolicyCore.includes("'" + mode + "'")) {
    fail('Privacy policy core is missing privacy region mode: ' + mode);
  }
}

const attentionCore = read('src/attention-core.js');
for (const symbol of [
  'TASK_MODES',
  'createAttentionState',
  'setActiveTask',
  'clearActiveTask',
  'prioritizeAttention',
  'upsertAttentionItems',
  'resolveAttentionItem',
  'computePerceptionBudget',
  'taskDerivedSignals',
  'privacyCaps',
  'attentionSnapshot'
]) {
  if (!attentionCore.includes(symbol)) {
    fail('Attention core is missing required V1.9 interface: ' + symbol);
  }
}
for (const mode of [
  'general',
  'find-object',
  'follow-participant',
  'conversation',
  'environment-watch',
  'mapping',
  'low-power'
]) {
  if (!attentionCore.includes("'" + mode + "'")) {
    fail('Attention core is missing task mode: ' + mode);
  }
}
if (!/allowVisualObservation/.test(attentionCore) || !/allowRoomAudio/.test(attentionCore)) {
  fail('Attention budget must preserve privacy policy capability caps');
}

const attentionStore = read('src/attention-store.js');
for (const symbol of ['loadAttentionState','saveAttentionState']) {
  if (!attentionStore.includes(symbol)) {
    fail('Attention store is missing persistence interface: ' + symbol);
  }
}

const anomalyCore = read('src/anomaly-core.js');
for (const symbol of [
  'ANOMALY_TYPES',
  'createAnomalyState',
  'deriveAnomalySignals',
  'observeAnomalySignals',
  'acknowledgeAnomaly',
  'dismissAnomaly',
  'anomalySnapshot',
  'proactiveAwarenessSummary',
  'anomalySignature'
]) {
  if (!anomalyCore.includes(symbol)) {
    fail('Anomaly core is missing required V1.9 interface: ' + symbol);
  }
}
for (const anomalyType of [
  'world-contradiction',
  'environment-unrecognized',
  'environment-structural-drift',
  'camera-pose-shift',
  'camera-quality-degraded',
  'expected-location-deviation',
  'expected-object-missing',
  'new-object-presence'
]) {
  if (!anomalyCore.includes("'" + anomalyType + "'")) {
    fail('Anomaly core is missing V1.9 anomaly type: ' + anomalyType);
  }
}
if (!/minimumObservations/.test(anomalyCore) || !/persistenceMs/.test(anomalyCore)) {
  fail('Anomaly engine must enforce observation and persistence thresholds');
}
if (!/evidenceId/.test(anomalyCore) || !/lastEvidenceId/.test(anomalyCore)) {
  fail('Anomaly engine must deduplicate repeated reads of the same evidence');
}
if (!/allowEnvironmentComparison/.test(anomalyCore) || !/allowObjectObservation/.test(anomalyCore)) {
  fail('Anomaly reasoning must preserve room privacy capability caps');
}

const anomalyStore = read('src/anomaly-store.js');
for (const symbol of ['loadAnomalyState','saveAnomalyState']) {
  if (!anomalyStore.includes(symbol)) {
    fail('Anomaly store is missing persistence interface: ' + symbol);
  }
}

const environmentStorePolicy = read('src/environment-store.js');
for (const symbol of ['loadEnvironmentPolicy','saveEnvironmentPolicy','defaultObservationPolicy']) {
  if (!environmentStorePolicy.includes(symbol)) {
    fail('Environment policy store is missing V1.9 interface: ' + symbol);
  }
}

const environmentRuntimePrivacy = read('src/environment-runtime.js');
const maskIndex = environmentRuntimePrivacy.indexOf('context.fillRect');
const fingerprintIndex = environmentRuntimePrivacy.indexOf('fingerprintImageData(imageData)');
if (maskIndex < 0 || fingerprintIndex < 0 || maskIndex > fingerprintIndex) {
  fail('Sensitive environment pixels must be masked before fingerprint generation');
}

const worldQueryCore = read('src/world-query-core.js');
for (const symbol of [
  'parseWorldQuery',
  'resolveEntityReference',
  'resolveRoomReference',
  'buildWorldTimeline',
  'buildEvidenceBundle',
  'answerPhysicalWorldQuery'
]) {
  if (!worldQueryCore.includes(symbol)) {
    fail('World query core is missing required recall interface: ' + symbol);
  }
}
for (const sensitive of [
  'embedding',
  'descriptor',
  'imageDataUrl'
]) {
  if (!worldQueryCore.includes('SENSITIVE_KEYS')) {
    fail('World query core must explicitly sanitize sensitive evidence fields');
  }
}

const worldQueryStore = read('src/world-query-store.js');
for (const symbol of [
  'saveWorldQuery',
  'listWorldQueries',
  'clearWorldQueries'
]) {
  if (!worldQueryStore.includes(symbol)) {
    fail('World query store is missing required compact history interface: ' + symbol);
  }
}

const agentContextCore = read('src/agent-context-core.js');
for (const symbol of [
  'AGENT_CONTEXT_SCHEMA_VERSION',
  'sanitizeAgentContext',
  'buildAgentContext',
  'diffAgentContext'
]) {
  if (!agentContextCore.includes(symbol)) {
    fail('Agent context core is missing required V2.0 interface: ' + symbol);
  }
}
for (const boundary of [
  'semantic-context-only',
  'no-raw-sensor-payloads',
  'no-autonomous-physical-control',
  'privacy-policy-remains-authoritative'
]) {
  if (!agentContextCore.includes(boundary)) {
    fail('Agent context core is missing authority boundary: ' + boundary);
  }
}

const worldWatchCore = read('src/world-watch-core.js');
for (const symbol of [
  'WORLD_WATCH_SCHEMA_VERSION',
  'WORLD_WATCH_TYPES',
  'normalizeWorldWatch',
  'evaluateWorldWatch',
  'evaluateWorldWatches'
]) {
  if (!worldWatchCore.includes(symbol)) {
    fail('World watch core is missing required V2.1 interface: ' + symbol);
  }
}
for (const boundary of [
  'semantic-context-only',
  'privacy-governed-context',
  'no-autonomous-physical-control'
]) {
  if (!worldWatchCore.includes(boundary)) {
    fail('World watch core is missing authority boundary: ' + boundary);
  }
}

const worldWatchStore = read('src/world-watch-store.js');
for (const symbol of [
  'saveWorldWatch',
  'listWorldWatches',
  'deleteWorldWatch',
  'saveWorldWatchTrigger',
  'listWorldWatchHistory',
  'clearWorldWatchHistory'
]) {
  if (!worldWatchStore.includes(symbol)) {
    fail('World watch store is missing required V2.1 persistence interface: ' + symbol);
  }
}

const worldWatchLanguageCore = read('src/world-watch-language-core.js');
for (const symbol of [
  'parseWorldWatchCommand',
  'resolveWorldWatchCommand',
  'interpretWorldWatchCommand'
]) {
  if (!worldWatchLanguageCore.includes(symbol)) {
    fail('World watch language core is missing required V2.2 interface: ' + symbol);
  }
}
if (!/ambiguous/.test(worldWatchLanguageCore) || !/not-found/.test(worldWatchLanguageCore)) {
  fail('V2.2 natural-language watch resolution must preserve ambiguity and unresolved references');
}

const agentBriefingCore = read('src/agent-briefing-core.js');
for (const symbol of [
  'buildAgentBriefing',
  'acknowledgeAgentBriefing',
  'pendingAgentBriefings'
]) {
  if (!agentBriefingCore.includes(symbol)) {
    fail('Agent briefing core is missing required V2.2 interface: ' + symbol);
  }
}
for (const boundary of [
  'semantic-briefing-only',
  'privacy-governed-context',
  'no-autonomous-physical-control'
]) {
  if (!agentBriefingCore.includes(boundary)) {
    fail('Agent briefing core is missing authority boundary: ' + boundary);
  }
}

const agentBriefingStore = read('src/agent-briefing-store.js');
for (const symbol of [
  'saveAgentBriefing',
  'listAgentBriefings',
  'clearAgentBriefings'
]) {
  if (!agentBriefingStore.includes(symbol)) {
    fail('Agent briefing store is missing required V2.2 persistence interface: ' + symbol);
  }
}

const briefingDeliveryPolicy = read('src/briefing-delivery-policy.js');
for (const symbol of [
  'BRIEFING_DELIVERY_SCHEMA_VERSION',
  'DELIVERY_STATES',
  'normalizeDeliveryContext',
  'planBriefingDelivery',
  'deliveryHandoff'
]) {
  if (!briefingDeliveryPolicy.includes(symbol)) {
    fail('Briefing delivery policy is missing required V2.3 interface: ' + symbol);
  }
}
for (const boundary of [
  'delivery-policy-only',
  'no-direct-tts',
  'no-ui-interruption-authority',
  'no-autonomous-physical-control'
]) {
  if (!briefingDeliveryPolicy.includes(boundary)) {
    fail('Briefing delivery policy is missing authority boundary: ' + boundary);
  }
}

const briefingQueueCore = read('src/briefing-queue-core.js');
for (const symbol of [
  'enqueueBriefing',
  'reevaluateBriefingQueue',
  'markBriefingSurfaced',
  'deferBriefing',
  'acknowledgeQueuedBriefing',
  'readyBriefings',
  'buildBriefingDigest'
]) {
  if (!briefingQueueCore.includes(symbol)) {
    fail('Briefing queue core is missing required V2.3 interface: ' + symbol);
  }
}

const agentEyes = read('agent-eyes.js');
if (!/window\.TrackyAgentEyes/.test(agentEyes)) {
  fail('Agent Eyes must expose the browser Agent integration interface');
}
if (!/tracky:perception/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level perception events');
}

for (const symbol of [
  'getAnomalyState',
  'getProactiveAwareness',
  'acknowledgeAnomaly',
  'dismissAnomaly',
  'subscribeAnomalies'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing proactive awareness Agent API: ' + symbol);
  }
}
if (!/tracky:anomaly-state/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level anomaly state');
}
if (!/tracky:world-query/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level world query results');
}
for (const symbol of [
  'queryPhysicalWorld',
  'getWorldTimeline',
  'getWorldEvidence',
  'getRecentWorldQueries',
  'subscribeWorldQueries'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V1.9 world recall API: ' + symbol);
  }
}

for (const symbol of [
  'getAgentContext',
  'getAgentContextDelta',
  'subscribeAgentContext'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V2.0 Agent context API: ' + symbol);
  }
}
if (!/tracky:agent-context/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level V2.0 Agent context deltas');
}

for (const symbol of [
  'addWorldWatch',
  'removeWorldWatch',
  'getWorldWatches',
  'getWorldWatchHistory',
  'clearWorldWatchHistory',
  'subscribeWorldWatches'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V2.1 physical-world watch API: ' + symbol);
  }
}
if (!/tracky:world-watch/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level V2.1 world-watch triggers');
}
if (!/from ['"]\.\/src\/world-watch-core\.js['"]/.test(agentEyes) ||
    !/from ['"]\.\/src\/world-watch-store\.js['"]/.test(agentEyes)) {
  fail('Agent Eyes must explicitly import the V2.1 world-watch runtime dependencies');
}

for (const symbol of [
  'interpretWorldWatch',
  'processWorldWatchCommand',
  'getAgentBriefings',
  'getPendingAgentBriefings',
  'acknowledgeAgentBriefing',
  'clearAgentBriefings',
  'subscribeAgentBriefings'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V2.2 conversational-watch/briefing API: ' + symbol);
  }
}
if (!/tracky:agent-briefing/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level V2.2 Agent briefings');
}

for (const symbol of [
  'getAgentDeliveryContext',
  'setAgentDeliveryContext',
  'getAgentBriefingQueue',
  'getReadyAgentBriefings',
  'getNextAgentBriefing',
  'getAgentBriefingDigest',
  'markAgentBriefingSurfaced',
  'deferAgentBriefing',
  'subscribeAgentDelivery'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V2.3 proactive briefing delivery API: ' + symbol);
  }
}
if (!/tracky:agent-delivery-ready/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level V2.3 delivery-ready handoffs');
}
for (const modulePath of [
  './src/briefing-delivery-policy.js',
  './src/briefing-queue-core.js'
]) {
  if (!agentEyes.includes("from '" + modulePath + "'")) {
    fail('Agent Eyes must explicitly import V2.3 runtime dependency: ' + modulePath);
  }
}
if (!/delivery-timer/.test(agentEyes)) {
  fail('Agent Eyes must reevaluate due V2.3 delivery windows');
}
for (const modulePath of [
  './src/world-watch-language-core.js',
  './src/agent-briefing-core.js',
  './src/agent-briefing-store.js'
]) {
  if (!agentEyes.includes("from '" + modulePath + "'")) {
    fail('Agent Eyes must explicitly import V2.2 runtime dependency: ' + modulePath);
  }
}
if (!/from ['"]\.\/src\/world-query-core\.js['"]/.test(agentEyes) ||
    !/from ['"]\.\/src\/world-query-store\.js['"]/.test(agentEyes)) {
  fail('Agent Eyes must explicitly import the V1.9 world-query runtime dependencies');
}
if (!/from ['"]\.\/src\/agent-context-core\.js['"]/.test(agentEyes)) {
  fail('Agent Eyes must explicitly import the V2.0 Agent context core');
}
if (!/worldQueryForm/.test(indexHtml) || !/worldQueryAnswer/.test(indexHtml) || !/worldQueryEvidence/.test(indexHtml)) {
  fail('Agent Eyes must expose V1.9 recall query and evidence UI');
}
if (!perceptionCore.includes('world_query.answered')) {
  fail('Perception core is missing V1.9 world query event');
}
if (!/renderProactiveAwareness/.test(agentEyes)) {
  fail('Agent Eyes must render proactive anomaly state');
}
for (const id of [
  'eyesAnomalyStatus',
  'proactiveStatus',
  'proactiveActiveList',
  'proactiveCandidateList',
  'proactiveHistoryList'
]) {
  if (!indexHtml.includes('id="' + id + '"')) {
    fail('Agent Eyes proactive awareness UI is missing #' + id);
  }
}
for (const eventName of [
  'anomaly.confirmed',
  'anomaly.cleared',
  'anomaly.acknowledged',
  'anomaly.dismissed',
  'proactive_awareness.updated'
]) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing proactive awareness event: ' + eventName);
  }
}
if (!/saveDialogueTurn/.test(agentEyes)) {
  fail('Agent Eyes must persist accepted dialogue turns');
}
if (!/evidenceInspector/.test(read('index.html')) || !/renderEvidenceInspector/.test(agentEyes)) {
  fail('Agent Eyes must include the perception evidence inspector');
}
if (!/behavior\.changed/.test(perceptionCore) || !/attention\.changed/.test(perceptionCore) || !/gesture\.detected/.test(perceptionCore)) {
  fail('Perception core must expose behavior, attention, and gesture events');
}
for (const eventName of [
  'object.detected',
  'object.updated',
  'object.lost',
  'object.picked_up',
  'object.put_down',
  'interaction.started',
  'interaction.ended'
]) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing object event: ' + eventName);
  }
}
if (!/objectEvidenceInspector/.test(indexHtml) || !/renderObjectEvidenceInspector/.test(agentEyes)) {
  fail('Agent Eyes must include the object evidence inspector');
}
if (!/eyesObjects/.test(indexHtml) || !/renderObjects/.test(agentEyes)) {
  fail('Agent Eyes must expose persistent room objects');
}
if (!/sceneEvidenceInspector/.test(indexHtml) || !/renderSceneEvidenceInspector/.test(agentEyes)) {
  fail('Agent Eyes must include the scene evidence inspector');
}
if (!/sceneChangeFeed/.test(indexHtml) || !/renderSceneChanges/.test(agentEyes)) {
  fail('Agent Eyes must expose a change-only semantic scene feed');
}
if (!/sceneZoneForm/.test(indexHtml) || !/replaceZonesAndPersist/.test(agentEyes)) {
  fail('Agent Eyes must expose persistent named room zones');
}
if (!/getSceneState/.test(agentEyes) || !/subscribeScene/.test(agentEyes) || !/tracky:scene-change/.test(agentEyes)) {
  fail('Agent Eyes must expose the temporal Agent integration interface');
}
if (!/getWorldState/.test(agentEyes)) {
  fail('Agent Eyes must expose combined Current World State');
}
if (!/getCameraFusionState/.test(agentEyes) || !/subscribeCameraFusion/.test(agentEyes)) {
  fail('Agent Eyes must expose the camera fusion Agent interface');
}
if (!/tracky:camera-fusion/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level camera fusion state');
}
if (!/cameraCalibrationInspector/.test(indexHtml) || !/openCameraCalibration/.test(agentEyes)) {
  fail('Agent Eyes must expose four-point camera calibration UI');
}
if (!/cameraRegistryForm/.test(indexHtml) || !/renderCameraNetwork/.test(agentEyes)) {
  fail('Agent Eyes must expose the persisted camera network registry');
}
if (!/worldMap/.test(indexHtml) || !/renderWorldMap/.test(agentEyes)) {
  fail('Agent Eyes must expose the fused room world map');
}
if (!/worldMapVectors/.test(indexHtml) || !/updateWorldTrails/.test(agentEyes)) {
  fail('Agent Eyes must expose fused participant trails');
}
if (!/environmentPrimaryImage/.test(indexHtml) || !/environmentCurrentImage/.test(indexHtml)) {
  fail('Agent Eyes must expose Primary and Current Environment reference images');
}
if (!/capturePrimaryEnvironment/.test(indexHtml) || !/scanEnvironment/.test(indexHtml)) {
  fail('Agent Eyes must expose explicit environment capture and assisted mapping controls');
}
if (!/physicalWorldJson/.test(indexHtml) || !/physicalAttentionFeed/.test(indexHtml)) {
  fail('Agent Eyes must expose Physical World State and attention evidence');
}
for (const symbol of [
  'getEnvironmentState',
  'getSceneGraph',
  'getPhysicalWorldState',
  'subscribeWorld',
  'teachPhysicalEntity',
  'teachPhysicalRelationship',
  'teachAtPoint',
  'getPhysicalFacts'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing physical-world Agent API: ' + symbol);
  }
}
if (!/tracky:world-state/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level physical world state');
}
for (const symbol of [
  'getRooms',
  'getRoomState',
  'getParticipantLocation',
  'getObjectLocation',
  'getWorldTopology',
  'getMultiRoomWorld',
  'subscribeRoom'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing multi-room Agent API: ' + symbol);
  }
}
if (!/tracky:multi-room-world/.test(agentEyes) || !/tracky:room-state/.test(agentEyes)) {
  fail('Agent Eyes must emit multi-room and room-scoped browser state');
}
for (const symbol of [
  'getSpatialMemory',
  'getExpectedLocation',
  'getExpectedLocationEvidence',
  'getEntityHistory',
  'getEntityJourney',
  'subscribeSpatialMemory',
  'confirmMemoryProposal',
  'ignoreMemoryProposal'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing spatial memory Agent API: ' + symbol);
  }
}
if (!/tracky:spatial-memory/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level spatial memory state');
}
for (const symbol of [
  'getObservationPolicy',
  'setObservationPolicy',
  'getPrivacyStats',
  'policyForRoom',
  'saveObservationPolicy',
  'renderPrivacyPolicy',
  'renderPrivacyMasks'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V1.9 privacy interface: ' + symbol);
  }
}
if (!/privacyPolicyStatus/.test(indexHtml) || !/privacyRegionForm/.test(indexHtml)) {
  fail('Agent Eyes must expose privacy policy and sensitive-region controls');
}
if (!/privacyCameraMasks/.test(indexHtml) || !/privacyRadarMasks/.test(indexHtml)) {
  fail('Agent Eyes must visibly expose active sensitive-region masks');
}
if (!/privacy\.policy_changed/.test(perceptionCore)) {
  fail('Perception core must expose privacy.policy_changed');
}
for (const eventName of [
  'task.started',
  'task.cleared',
  'attention.updated',
  'attention.resolved',
  'perception.budget_changed'
]) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing V1.9 attention event: ' + eventName);
  }
}
for (const symbol of [
  'getAttentionState',
  'getActiveTask',
  'getPerceptionBudget',
  'setTask',
  'clearTask',
  'resolveAttention',
  'dismissAttention',
  'subscribeAttention'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V1.9 attention API: ' + symbol);
  }
}
if (!/attentionTaskForm/.test(indexHtml) || !/attentionQueueList/.test(indexHtml)) {
  fail('Agent Eyes must expose task and attention queue controls');
}
if (!/renderAttentionController/.test(agentEyes) || !/updateAttentionController/.test(agentEyes)) {
  fail('Agent Eyes must render and run task-conditioned attention');
}
if (!/currentPerceptionBudget/.test(agentEyes) || !/environmentCheckMs/.test(agentEyes)) {
  fail('Agent Eyes must apply adaptive perception budget to runtime cadence');
}
if (!/setScanIntervalMs/.test(read('src/multicamera-runtime.js'))) {
  fail('Secondary camera runtime must expose governed adaptive scan cadence');
}
if (!/tracky:attention-state/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level attention state');
}
for (const eventName of [
  'anomaly.confirmed',
  'anomaly.cleared',
  'anomaly.acknowledged',
  'anomaly.dismissed',
  'proactive_awareness.updated'
]) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing V1.9 anomaly event: ' + eventName);
  }
}
for (const symbol of [
  'getAnomalyState',
  'getProactiveAwareness',
  'acknowledgeAnomaly',
  'dismissAnomaly',
  'subscribeAnomalies'
]) {
  if (!agentEyes.includes(symbol)) {
    fail('Agent Eyes is missing V1.9 proactive-awareness API: ' + symbol);
  }
}
if (!/proactiveActiveList/.test(indexHtml) || !/proactiveCandidateList/.test(indexHtml) || !/proactiveHistoryList/.test(indexHtml)) {
  fail('Agent Eyes must expose active anomaly, verification, and history UI');
}
if (!/renderProactiveAwareness/.test(agentEyes) || !/updateAnomalyAwareness/.test(agentEyes)) {
  fail('Agent Eyes must render and run proactive anomaly awareness');
}
if (!/anomalyAttentionItems/.test(agentEyes)) {
  fail('Confirmed anomalies must feed the governed Agent attention queue');
}
if (!/tracky:anomaly-state/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level anomaly state');
}
if (!/proactiveAwareness/.test(agentEyes)) {
  fail('Current World State must include proactive awareness');
}
if (!/applyParticipantObservationPolicy/.test(agentEyes) || !/applyObjectObservationPolicy/.test(agentEyes)) {
  fail('Agent Eyes must apply room privacy policy before camera fusion');
}
if (!/transcriptRetentionAllowed/.test(agentEyes) || !/event\.privacy\?\.retentionAllowed/.test(agentEyes)) {
  fail('Transcript persistence must be gated by privacy retention policy');
}
if (!/spatialMemoryRetentionAllowed/.test(agentEyes)) {
  fail('Spatial memory training must be gated by privacy retention policy');
}
if (!/allowVisualObservation/.test(agentEyes) || !/Disabled by privacy/.test(agentEyes)) {
  fail('Agent Eyes must stop visual inference when room visual observation is disabled');
}
if (!/getParticipants\(session\.camera\)/.test(read('src/multicamera-runtime.js'))) {
  fail('Secondary camera runtime must pass camera context to participant lookup');
}
if (!/getParticipants\(camera\)/.test(agentEyes)) {
  fail('Agent Eyes must use camera room context when supplying secondary identity profiles');
}
if (!/spatialMemoryFacts/.test(indexHtml) || !/spatialProposalList/.test(indexHtml) || !/spatialJourneyList/.test(indexHtml)) {
  fail('Agent Eyes must expose spatial memory facts, proposal review, and journey UI');
}
if (!/renderSpatialMemory/.test(agentEyes) || !/confirmSpatialMemoryProposal/.test(agentEyes)) {
  fail('Agent Eyes must render and explicitly confirm learned spatial knowledge');
}
for (const eventName of [
  'spatial_memory.proposed',
  'spatial_memory.confirmed',
  'spatial_memory.ignored'
]) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing V1.9 spatial memory event: ' + eventName);
  }
}
if (!/globalRoomMap/.test(indexHtml) || !/topologyConnectForm/.test(indexHtml)) {
  fail('Agent Eyes must expose global room topology UI');
}
if (!/renderMultiRoomWorld/.test(agentEyes) || !/confirmTopologyConnection/.test(agentEyes)) {
  fail('Agent Eyes must render and confirm room topology');
}
for (const eventName of [
  'participant.room_exit',
  'participant.room_enter',
  'participant.room_transition',
  'participant.location_uncertain',
  'object.room_transition',
  'portal.crossing',
  'world.topology_changed',
  'visibility.changed'
]) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing V1.9 world event: ' + eventName);
  }
}
for (const eventName of [
  'environment.captured',
  'environment.matched',
  'environment.unknown',
  'environment.changed',
  'environment.mapping_updated',
  'world.attention'
]) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing environment/world event: ' + eventName);
  }
}
for (const eventName of ['camera.status','camera.handoff','camera.overlap_fused']) {
  if (!perceptionCore.includes(eventName)) {
    fail('Perception core is missing camera event: ' + eventName);
  }
}

const identityEngine = read('src/identity-engine.js');
if (!/object:\s*\{[\s\S]*?enabled:\s*true/.test(identityEngine)) {
  fail('Identity engine must enable the object perception provider');
}
if (!/hand:\s*\{[\s\S]*?enabled:\s*true/.test(identityEngine)) {
  fail('Identity engine must enable the hand perception provider');
}
if (!/gesture:\s*\{\s*enabled:\s*true\s*\}/.test(identityEngine)) {
  fail('Identity engine must enable gesture fusion');
}

const modelConfig = read('src/model-config.js');
if (!/@huggingface\/transformers@3\.8\.1\/\+esm/.test(modelConfig)) {
  fail('Transformers.js browser dependency is not pinned to 3.8.1 ESM');
}
if (!/@vladmandic\/human@3\.3\.6\//.test(modelConfig)) {
  fail('Human browser dependency is not pinned to 3.3.6');
}
if (!/VOICE_MODEL_REVISION\s*=\s*['"][0-9a-f]{40}['"]/.test(modelConfig)) {
  fail('Voice model must be pinned to a full commit revision');
}
if (!/TRANSCRIPTION_MODEL_REVISION\s*=\s*['"][0-9a-f]{7,40}['"]/.test(modelConfig)) {
  fail('Transcription model must be pinned to a commit revision');
}
if (/REVISION\s*=\s*['"](?:main|master)['"]/.test(modelConfig)) {
  fail('Model revision may not use a moving main/master ref');
}

const workflow = read('.github/workflows/test.yml');
if (!/npm run validate/.test(workflow)) {
  fail('CI must execute npm run validate');
}
if (!/tracky-v2\.3-deploy\.zip/.test(workflow)) {
  fail('CI must build the V2.3 deploy ZIP');
}
if (!workflow.includes('src/attention-core.js') || !workflow.includes('src/attention-store.js')) {
  fail('CI V1.9 deploy package must include attention core and store');
}
if (!workflow.includes('src/anomaly-core.js') || !workflow.includes('src/anomaly-store.js')) {
  fail('CI V1.9 deploy package must include anomaly core and store');
}
if (!workflow.includes('src/agent-context-core.js')) {
  fail('CI V2.0 deploy package must include Agent context core');
}
if (!workflow.includes('src/world-watch-core.js') || !workflow.includes('src/world-watch-store.js')) {
  fail('CI V2.1 deploy package must include world-watch core and store');
}

for (const file of [
  'src/world-watch-language-core.js',
  'src/agent-briefing-core.js',
  'src/agent-briefing-store.js'
]) {
  if (!workflow.includes(file)) {
    fail('CI V2.2 deploy package must include ' + file);
  }
}

for (const file of [
  'src/briefing-delivery-policy.js',
  'src/briefing-queue-core.js'
]) {
  if (!workflow.includes(file)) {
    fail('CI V2.3 deploy package must include ' + file);
  }
}
if (!workflow.includes('src/privacy-policy-core.js')) {
  fail('CI V1.9 deploy package must include privacy policy core');
}

for (const file of requiredFiles.filter((file) => !['README.md','package.json'].includes(file))) {
  const filename = path.basename(file);
  if (!workflow.includes(filename)) {
    fail('CI deploy manifest does not mention required runtime file: ' + file);
  }
}

const worklet = read('src/room-audio-worklet.js');
if (!/registerProcessor\(['"]tracky-pcm-processor['"]/.test(worklet)) {
  fail('AudioWorklet processor registration is missing');
}

const roomAudio = read('src/room-audio-engine.js');
if (!/audioWorklet\.addModule/.test(roomAudio) || !/createScriptProcessor/.test(roomAudio)) {
  fail('Room audio must provide AudioWorklet primary path and ScriptProcessor fallback');
}

if (failures.length) {
  console.error('\nTracky release audit: FAIL\n');
  for (const failure of failures) console.error(' - ' + failure);
  console.error('\n' + failures.length + ' issue(s) found.');
  process.exit(1);
}

console.log('Tracky release audit: PASS');
console.log(
  'Checked ' + requiredFiles.length +
  ' release files, Agent Eyes DOM contracts, person/object/scene/camera/environment/multi-room interfaces, temporal memory, multi-camera fusion, environment baselines, assisted mapping, room topology, cross-room continuity, visibility reasoning, learned spatial memory, expected-location evidence, entity journeys, proposal governance, privacy zones, observation-policy enforcement, anonymization, retention gating, masked environment capture, task-conditioned perception, adaptive budgets, attention queue governance, proactive anomaly verification, persistent anomaly history, privacy-gated anomaly derivation, physical-world recall, provenance-backed explanations, privacy-aware timeline queries, compact query history, natural-language watch interpretation, ambiguity-safe watch management, persistent Agent briefings, briefing acknowledgement, proactive delivery policy, delivery queue coalescing, reconnect recovery, digest delivery, voice handoff boundaries, scene graph, physical world state, privacy policy, replay contracts, calibration, evidence inspectors, provider configuration, imports, model pins, runtime safety, experiments, and deploy manifest.'
);
