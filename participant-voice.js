import { getParticipant, patchParticipant } from './src/participant-store.js';
import { voiceProfileReadiness } from './src/voice-core.js';
import {
  MicrophoneCapture,
  VoiceIdentityEngine,
  extractVoiceEmbedding
} from './src/voice-engine.js';

const $ = (selector) => document.querySelector(selector);

const ui = {
  status: $('#voiceEnrollmentStatus'),
  orb: $('#voiceOrb'),
  samples: $('#voiceSampleCount'),
  seconds: $('#voiceTotalSeconds'),
  liveDb: $('#voiceLiveDb'),
  model: $('#voiceModelState'),
  bars: $('#voiceWaveBars'),
  progress: $('#voiceCaptureProgress'),
  stage: $('#voiceStageLabel'),
  detail: $('#voiceStageDetail'),
  record: $('#recordVoiceSample'),
  stop: $('#stopVoiceSample'),
  recognition: $('#voiceRecognitionEnabled')
};

const state = {
  participant: null,
  engine: new VoiceIdentityEngine(),
  capture: new MicrophoneCapture(),
  recording: false,
  recordStartedAt: 0,
  meterRaf: 0,
  autoStopTimer: 0,
  levels: [],
  stage: 'idle'
};

const AUTO_STOP_SECONDS = 8;
const MIN_SAMPLE_SECONDS = 4;
const MIN_PEAK_DB = -48;

function setStage(stage, detail) {
  state.stage = stage;
  ui.stage.textContent = String(stage || '').toUpperCase().replaceAll('-', ' ');
  ui.detail.textContent = detail || '';
  ui.orb.dataset.stage = stage;
}

function setPipeline(stage) {
  const order = ['capture', 'clean', 'embed', 'redundancy', 'ready'];
  document.querySelectorAll('[data-voice-stage]').forEach((node) => {
    const current = order.indexOf(stage);
    const item = order.indexOf(node.dataset.voiceStage);
    node.classList.toggle('active', current >= 0 && item <= current);
    node.classList.toggle('current', node.dataset.voiceStage === stage);
  });
}

function renderBars(db) {
  const normalized = Math.max(0, Math.min(1, (db + 65) / 50));
  [...ui.bars.children].forEach((bar, index, all) => {
    const center = (all.length - 1) / 2;
    const shape = 1 - Math.abs(index - center) / Math.max(1, center + 1);
    const level = Math.max(0.08, normalized * (0.42 + shape * 0.78));
    bar.style.transform = 'scaleY(' + level.toFixed(3) + ')';
    bar.classList.toggle('hot', db > -28);
  });
}

function sampleSeconds(participant) {
  return (participant?.voiceProfileSamples || []).reduce(
    (sum, sample) => sum + Number(sample.durationSeconds || 0),
    0
  );
}

function render() {
  const participant = state.participant;
  const saved = Boolean(participant?.id);
  const readiness = voiceProfileReadiness(participant || {});
  const sampleCount = participant?.voiceEmbeddings?.length || 0;

  ui.samples.textContent = sampleCount + ' / 3';
  ui.seconds.textContent = readiness.totalSeconds.toFixed(1) + 's';
  ui.recognition.disabled = !saved || state.recording;
  ui.record.disabled = !saved || state.recording;
  ui.stop.disabled = !state.recording;
  ui.recognition.checked = participant?.voiceRecognitionEnabled !== false;

  ui.status.textContent = !saved
    ? 'Save participant to enable voice profiling'
    : readiness.ready
      ? 'Voice profile ready · redundant speaker samples active'
      : sampleCount
        ? 'Voice profile building · ' + sampleCount + ' / 3 samples'
        : 'Voice profile not enrolled';

  if (readiness.ready) setPipeline('ready');
  else if (sampleCount >= 2) setPipeline('redundancy');
  else if (sampleCount >= 1) setPipeline('embed');
  else setPipeline('capture');

  if (!saved && !state.recording) {
    setStage('voice core standby', 'Save the participant profile before voice enrollment.');
  } else if (saved && !state.recording && state.stage === 'idle') {
    setStage(
      readiness.ready ? 'voice profile ready' : 'voice profile enrollment',
      readiness.ready
        ? 'Tracky can use this participant voice signature for live speaker tracking.'
        : 'Capture three clean speech samples from slightly different phrases.'
    );
  }
}

async function loadParticipant(participantId) {
  if (!participantId) {
    state.participant = null;
    state.stage = 'idle';
    render();
    return;
  }

  state.participant = await getParticipant(participantId);
  state.stage = 'idle';
  render();
}

async function ensureEngine() {
  if (state.engine.ready) return true;
  ui.model.textContent = 'Loading WavLM…';
  setStage('loading speaker model', 'Preparing the local voice-profile model.');

  try {
    await state.engine.init();
    ui.model.textContent = 'WavLM online';
    return true;
  } catch (error) {
    console.error(error);
    ui.model.textContent = 'Model unavailable';
    setStage('voice model error', 'Speaker model could not load. Check network access and try again.');
    return false;
  }
}

function meterLoop() {
  if (!state.recording) return;

  const level = state.capture.level();
  state.levels.push(level.db);
  ui.liveDb.textContent = level.db.toFixed(1) + ' dB';
  renderBars(level.db);

  const elapsed = Math.max(0, (performance.now() - state.recordStartedAt) / 1000);
  ui.progress.style.width = Math.min(100, elapsed / AUTO_STOP_SECONDS * 100) + '%';
  setStage('capturing voice profile', elapsed.toFixed(1) + 's · speak naturally at your normal level');
  setPipeline('capture');

  state.meterRaf = requestAnimationFrame(meterLoop);
}

async function startRecording() {
  if (!state.participant?.id || state.recording) return;

  try {
    await state.capture.start();
    state.recording = true;
    state.recordStartedAt = performance.now();
    state.levels = [];
    ui.progress.style.width = '0%';
    render();
    meterLoop();

    clearTimeout(state.autoStopTimer);
    state.autoStopTimer = setTimeout(() => void stopRecording(), AUTO_STOP_SECONDS * 1000);
  } catch (error) {
    console.error(error);
    setStage(
      'microphone error',
      window.isSecureContext ? 'Could not open the microphone.' : 'Microphone access requires localhost or HTTPS.'
    );
  }
}

async function stopRecording() {
  if (!state.recording) return;

  state.recording = false;
  cancelAnimationFrame(state.meterRaf);
  clearTimeout(state.autoStopTimer);

  setStage('noise gate', 'Checking level and rejecting unusable background-only audio.');
  setPipeline('clean');
  render();

  try {
    const sample = await state.capture.stop();
    ui.liveDb.textContent = '— dB';
    renderBars(-100);

    if (!sample || sample.durationSeconds < MIN_SAMPLE_SECONDS) {
      setStage('sample too short', 'Capture at least ' + MIN_SAMPLE_SECONDS + ' seconds of natural speech.');
      return;
    }

    const levels = state.levels.filter(Number.isFinite);
    const peakDb = levels.length ? Math.max(...levels) : -100;
    const avgDb = levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : -100;

    if (peakDb < MIN_PEAK_DB) {
      setStage('sample rejected', 'Speech was too quiet relative to the microphone floor. Try again closer to the microphone.');
      return;
    }

    const engineReady = await ensureEngine();
    if (!engineReady) return;

    setPipeline('embed');
    setStage('extracting voice identity', 'Converting the clean speech sample into a local speaker signature.');
    const embedding = await extractVoiceEmbedding(state.engine, sample.blob);

    const current = await getParticipant(state.participant.id);
    const embeddings = [...(current.voiceEmbeddings || []), embedding].slice(-5);
    const profileSamples = [...(current.voiceProfileSamples || []), {
      durationSeconds: sample.durationSeconds,
      peakDb,
      avgDb,
      createdAt: new Date().toISOString()
    }].slice(-5);

    const readiness = voiceProfileReadiness({
      ...current,
      voiceEmbeddings: embeddings,
      voiceProfileSamples: profileSamples
    });

    setPipeline(readiness.ready ? 'ready' : 'redundancy');
    setStage(
      readiness.ready ? 'voice profile ready' : 'building redundancy',
      readiness.ready
        ? 'Three or more voice signatures are available for live speaker tracking.'
        : 'Sample saved. Capture additional phrases so Tracky can verify the speaker redundantly.'
    );

    state.participant = await patchParticipant(current.id, {
      voiceEmbeddings: embeddings,
      voiceProfileSamples: profileSamples,
      voiceProfileReady: readiness.ready,
      voiceRecognitionEnabled: ui.recognition.checked,
      voiceUpdatedAt: new Date().toISOString()
    });

    ui.progress.style.width = '100%';
    window.dispatchEvent(new CustomEvent('tracky:participant-voice-updated', {
      detail: { participantId: current.id }
    }));
  } catch (error) {
    console.error(error);
    setStage('voice profile error', error.message || 'Could not process voice profile sample.');
  } finally {
    render();
  }
}

async function saveRecognitionPreference() {
  if (!state.participant?.id) return;
  state.participant = await patchParticipant(state.participant.id, {
    voiceRecognitionEnabled: ui.recognition.checked,
    voiceUpdatedAt: new Date().toISOString()
  });
  render();
  window.dispatchEvent(new CustomEvent('tracky:participant-voice-updated', {
    detail: { participantId: state.participant.id }
  }));
}

ui.record.addEventListener('click', startRecording);
ui.stop.addEventListener('click', stopRecording);
ui.recognition.addEventListener('change', saveRecognitionPreference);

window.addEventListener('tracky:participant-loaded', (event) => loadParticipant(event.detail.participantId));
window.addEventListener('tracky:participant-saved', (event) => loadParticipant(event.detail.participantId));
window.addEventListener('beforeunload', () => state.capture.stopStream());

const initialId = document.body.dataset.participantId || '';
await loadParticipant(initialId);
render();
