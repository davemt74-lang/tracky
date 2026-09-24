import { getParticipant, patchParticipant } from './src/participant-store.js';
import { cloneReadiness } from './src/voice-core.js';
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
  recognition: $('#voiceRecognitionEnabled'),
  consent: $('#voiceCloneConsent'),
  clone: $('#cloneParticipantVoice'),
  cloneStatus: $('#cloneStatus'),
  cloneSpinner: $('#cloneSpinner'),
  cloneId: $('#clonedVoiceId')
};

const state = {
  participant: null,
  engine: new VoiceIdentityEngine(),
  capture: new MicrophoneCapture(),
  recording: false,
  recordStartedAt: 0,
  meterRaf: 0,
  autoStopTimer: 0,
  stage: 'idle'
};

const CLONE_ENDPOINT = window.TRACKY_VOICE_CLONE_ENDPOINT || './api/voice-clone.php';
const AUTO_STOP_SECONDS = 15;
const MIN_RECOGNITION_SECONDS = 2;

function setStage(stage, detail) {
  state.stage = stage;
  ui.stage.textContent = String(stage || '').toUpperCase().replaceAll('-', ' ');
  ui.detail.textContent = detail || '';
  ui.orb.dataset.stage = stage;
}

function setCloneStage(stage) {
  document.querySelectorAll('[data-clone-stage]').forEach((node) => {
    const order = ['sample','consent','upload','provider','ready'];
    node.classList.toggle('active', order.indexOf(node.dataset.cloneStage) <= order.indexOf(stage));
    node.classList.toggle('current', node.dataset.cloneStage === stage);
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

function voiceSeconds(participant) {
  return (participant?.voiceSamples || []).reduce((sum, sample) => sum + Number(sample.durationSeconds || 0), 0);
}

function render() {
  const participant = state.participant;
  const saved = Boolean(participant?.id);
  const readiness = cloneReadiness(participant || {});
  const sampleCount = participant?.voiceEmbeddings?.length || 0;
  const seconds = voiceSeconds(participant);

  ui.samples.textContent = String(sampleCount);
  ui.seconds.textContent = seconds.toFixed(1) + 's';
  ui.recognition.disabled = !saved || state.recording;
  ui.consent.disabled = !saved || state.recording;
  ui.record.disabled = !saved || state.recording;
  ui.stop.disabled = !state.recording;
  ui.recognition.checked = participant?.voiceRecognitionEnabled !== false;
  ui.consent.checked = participant?.voiceCloneConsent === true;

  ui.status.textContent = !saved
    ? 'Save participant to enable voice enrollment'
    : sampleCount
      ? 'Speaker identity enrolled · ' + sampleCount + ' sample' + (sampleCount === 1 ? '' : 's')
      : 'Voice identity not enrolled';

  ui.clone.disabled = !saved || !readiness.ready || state.recording || Boolean(participant?.clonedVoiceId);
  ui.cloneStatus.textContent = participant?.clonedVoiceId
    ? 'Voice clone ready'
    : readiness.ready
      ? 'Ready to create clone'
      : !readiness.consent
        ? 'Explicit consent required'
        : seconds < 10
          ? 'Capture at least 10 seconds of voice'
          : 'Voice sample required';

  ui.cloneId.textContent = participant?.clonedVoiceId ? 'VOICE ID · ' + participant.clonedVoiceId : '';

  if (participant?.clonedVoiceId) setCloneStage('ready');
  else if (readiness.ready) setCloneStage('consent');
  else if (seconds > 0) setCloneStage('sample');
  else setCloneStage('sample');

  if (!saved && !state.recording) setStage('voice core standby', 'Save the participant profile before voice enrollment.');
  else if (saved && !state.recording && state.stage === 'idle') {
    setStage(sampleCount ? 'speaker profile ready' : 'voice enrollment ready', sampleCount
      ? 'Tracky can compare live speech against this participant locally.'
      : 'Record a clean voice sample in a quiet room.');
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
  setStage('loading speaker model', 'Preparing local speaker verification model.');

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
  ui.liveDb.textContent = level.db.toFixed(1) + ' dB';
  renderBars(level.db);

  const elapsed = Math.max(0, (performance.now() - state.recordStartedAt) / 1000);
  ui.progress.style.width = Math.min(100, elapsed / AUTO_STOP_SECONDS * 100) + '%';
  setStage('recording voice sample', elapsed.toFixed(1) + 's · speak naturally and continuously');

  state.meterRaf = requestAnimationFrame(meterLoop);
}

async function startRecording() {
  if (!state.participant?.id || state.recording) return;

  try {
    await state.capture.start();
    state.recording = true;
    state.recordStartedAt = performance.now();
    ui.progress.style.width = '0%';
    render();
    meterLoop();

    clearTimeout(state.autoStopTimer);
    state.autoStopTimer = setTimeout(() => {
      void stopRecording();
    }, AUTO_STOP_SECONDS * 1000);
  } catch (error) {
    console.error(error);
    setStage('microphone error', window.isSecureContext
      ? 'Could not open the microphone.'
      : 'Microphone access requires localhost or HTTPS.');
  }
}

async function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  cancelAnimationFrame(state.meterRaf);
  clearTimeout(state.autoStopTimer);

  setStage('finalizing sample', 'Preparing captured speech.');
  render();

  try {
    const sample = await state.capture.stop();
    ui.liveDb.textContent = '— dB';
    renderBars(-100);

    if (!sample || sample.durationSeconds < MIN_RECOGNITION_SECONDS) {
      setStage('sample too short', 'Record at least ' + MIN_RECOGNITION_SECONDS + ' seconds for speaker recognition.');
      render();
      return;
    }

    const engineReady = await ensureEngine();
    if (!engineReady) return;

    setStage('extracting speaker identity', 'Generating the local WavLM speaker embedding.');
    const embedding = await extractVoiceEmbedding(state.engine, sample.blob);

    const current = await getParticipant(state.participant.id);
    const embeddings = [...(current.voiceEmbeddings || []), embedding].slice(-5);
    const voiceSamples = [...(current.voiceSamples || []), {
      blob: sample.blob,
      durationSeconds: sample.durationSeconds,
      mimeType: sample.blob.type,
      createdAt: new Date().toISOString()
    }].slice(-5);

    state.participant = await patchParticipant(current.id, {
      voiceEmbeddings: embeddings,
      voiceSamples,
      voiceRecognitionEnabled: ui.recognition.checked,
      voiceUpdatedAt: new Date().toISOString()
    });

    setStage('speaker profile ready', 'Voice identity sample saved locally.');
    ui.progress.style.width = '100%';
    window.dispatchEvent(new CustomEvent('tracky:participant-voice-updated', { detail: { participantId: current.id } }));
  } catch (error) {
    console.error(error);
    setStage('voice enrollment error', error.message || 'Could not process voice sample.');
  } finally {
    render();
  }
}

async function saveVoicePreference(patch) {
  if (!state.participant?.id) return;
  state.participant = await patchParticipant(state.participant.id, {
    ...patch,
    voiceUpdatedAt: new Date().toISOString()
  });
  render();
  window.dispatchEvent(new CustomEvent('tracky:participant-voice-updated', { detail: { participantId: state.participant.id } }));
}

async function cloneVoice() {
  if (!state.participant?.id || !ui.consent.checked) return;

  const readiness = cloneReadiness(state.participant);
  if (!readiness.ready) {
    setStage('clone not ready', 'Explicit consent and at least 10 seconds of captured voice are required.');
    return;
  }

  ui.clone.disabled = true;
  ui.cloneSpinner.hidden = false;
  ui.cloneStatus.textContent = 'Preparing upload';
  setCloneStage('upload');
  setStage('voice clone upload', 'Sending the consented voice sample to the configured cloning provider.');

  try {
    const form = new FormData();
    form.append('participant_id', state.participant.id);
    form.append('name', state.participant.name + ' — Tracky');
    form.append('consent', 'true');

    for (let i = 0; i < state.participant.voiceSamples.length; i += 1) {
      const sample = state.participant.voiceSamples[i];
      if (!sample.blob) continue;
      const ext = sample.mimeType?.includes('ogg') ? 'ogg' : 'webm';
      form.append('files[]', sample.blob, 'voice-sample-' + (i + 1) + '.' + ext);
    }

    ui.cloneStatus.textContent = 'Provider processing';
    setCloneStage('provider');
    setStage('provider processing', 'Creating the consented voice clone. This stage is provider-controlled.');

    const response = await fetch(CLONE_ENDPOINT, { method: 'POST', body: form });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.voice_id) {
      throw new Error(result.error || 'Voice clone provider request failed.');
    }

    state.participant = await patchParticipant(state.participant.id, {
      clonedVoiceId: result.voice_id,
      clonedVoiceName: result.name || state.participant.name + ' — Tracky',
      voiceCloneConsent: true,
      voiceUpdatedAt: new Date().toISOString()
    });

    ui.cloneStatus.textContent = 'Voice ready';
    setCloneStage('ready');
    setStage('voice clone ready', 'Clone created and linked to this participant profile.');
    window.dispatchEvent(new CustomEvent('tracky:participant-voice-updated', { detail: { participantId: state.participant.id } }));
  } catch (error) {
    console.error(error);
    ui.cloneStatus.textContent = 'Clone unavailable';
    setStage('voice clone error', error.message || 'Voice clone could not be created.');
  } finally {
    ui.cloneSpinner.hidden = true;
    render();
  }
}

ui.record.addEventListener('click', startRecording);
ui.stop.addEventListener('click', stopRecording);
ui.recognition.addEventListener('change', () => saveVoicePreference({ voiceRecognitionEnabled: ui.recognition.checked }));
ui.consent.addEventListener('change', () => saveVoicePreference({ voiceCloneConsent: ui.consent.checked }));
ui.clone.addEventListener('click', cloneVoice);

window.addEventListener('tracky:participant-loaded', (event) => loadParticipant(event.detail.participantId));
window.addEventListener('tracky:participant-saved', (event) => loadParticipant(event.detail.participantId));
window.addEventListener('beforeunload', () => state.capture.stopStream());

const initialId = document.body.dataset.participantId || '';
await loadParticipant(initialId);
render();
