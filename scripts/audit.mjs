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
  'src/object-core.js'
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
  'src/object-core.js'
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
if (packageJson.version !== '1.0.0') {
  fail('package.json version must be 1.0.0');
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

const agentEyes = read('agent-eyes.js');
if (!/window\.TrackyAgentEyes/.test(agentEyes)) {
  fail('Agent Eyes must expose the browser Agent integration interface');
}
if (!/tracky:perception/.test(agentEyes)) {
  fail('Agent Eyes must emit browser-level perception events');
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
if (!/tracky-v1\.0-deploy\.zip/.test(workflow)) {
  fail('CI must build the V1.0 deploy ZIP');
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
  ' release files, Agent Eyes DOM contracts, person/object perception interfaces, evidence inspectors, provider configuration, imports, model pins, runtime safety, experiments, and deploy manifest.'
);
