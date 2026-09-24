import { voiceProfileReadiness } from './src/voice-core.js';
import { IdentityEngine, cropFacePhoto, qualityMessage } from './src/identity-engine.js';
import {
  deleteParticipant,
  deletePendingCapture,
  getParticipant,
  getPendingCapture,
  listParticipants,
  saveParticipant
} from './src/participant-store.js';

const $ = (selector) => document.querySelector(selector);

const ui = {
  modelStatus: $('#modelStatus'),
  participantCount: $('#participantCount'),
  cameraStatus: $('#participantCameraStatus'),
  list: $('#participantList'),
  newParticipant: $('#newParticipant'),
  formModeLabel: $('#formModeLabel'),
  formTitle: $('#formTitle'),
  enrollmentStatus: $('#enrollmentStatus'),
  video: $('#participantVideo'),
  cameraStage: $('#identityCameraStage'),
  cameraPlaceholder: $('#cameraPlaceholder'),
  reticle: $('#faceReticle'),
  qualityText: $('#faceQualityText'),
  qualityValue: $('#faceQualityValue'),
  qualityBar: $('#faceQualityBar'),
  startCamera: $('#startParticipantCamera'),
  stopCamera: $('#stopParticipantCamera'),
  capturePrimary: $('#capturePrimary'),
  primaryPhoto: $('#primaryPhotoPreview'),
  primaryEmpty: $('#primaryPhotoEmpty'),
  latestPhoto: $('#latestPhotoPreview'),
  latestEmpty: $('#latestPhotoEmpty'),
  useLatestPrimary: $('#useLatestPrimary'),
  name: $('#participantName'),
  nickname: $('#participantNickname'),
  notes: $('#participantNotes'),
  recognitionEnabled: $('#recognitionEnabled'),
  sampleCount: $('#sampleCount'),
  enrollmentDots: $('#enrollmentDots'),
  captureSample: $('#captureSample'),
  message: $('#formMessage'),
  save: $('#saveParticipant'),
  reset: $('#resetParticipantForm'),
  delete: $('#deleteParticipant')
};

const state = {
  participants: [],
  editingId: null,
  stream: null,
  engine: new IdentityEngine(),
  engineReady: false,
  scanning: false,
  scanTimer: 0,
  currentFace: null,
  primaryPhoto: null,
  latestPhoto: null,
  embeddings: [],
  pendingId: null
};

function setMessage(message = '', kind = '') {
  ui.message.textContent = message;
  ui.message.dataset.kind = kind;
}

function setPhoto(img, empty, value) {
  img.hidden = !value;
  empty.hidden = Boolean(value);
  if (value) img.src = value;
  else img.removeAttribute('src');
}

function updateEnrollmentUi() {
  ui.sampleCount.textContent = String(state.embeddings.length);
  [...ui.enrollmentDots.children].forEach((dot, index) => {
    dot.classList.toggle('complete', index < state.embeddings.length);
  });

  const enough = state.embeddings.length >= 3;
  ui.enrollmentStatus.textContent = enough ? 'Recognition ready' : state.embeddings.length ? 'Enrollment in progress' : 'Not enrolled';
  ui.enrollmentStatus.classList.toggle('ok', enough);
}

function updatePhotos() {
  setPhoto(ui.primaryPhoto, ui.primaryEmpty, state.primaryPhoto);
  setPhoto(ui.latestPhoto, ui.latestEmpty, state.latestPhoto);
  ui.useLatestPrimary.disabled = !state.latestPhoto;
}

function clearForm() {
  state.editingId = null;
  document.body.dataset.participantId = '';
  state.primaryPhoto = null;
  state.latestPhoto = null;
  state.embeddings = [];
  state.currentFace = null;

  ui.formModeLabel.textContent = 'PARTICIPANT ONBOARDING';
  ui.formTitle.textContent = 'Create participant';
  ui.name.value = '';
  ui.nickname.value = '';
  ui.notes.value = '';
  ui.recognitionEnabled.checked = true;
  ui.delete.hidden = true;

  updatePhotos();
  updateEnrollmentUi();
  setMessage('');
}

function renderParticipantList() {
  ui.participantCount.textContent = String(state.participants.length);
  ui.list.replaceChildren();

  if (!state.participants.length) {
    const empty = document.createElement('div');
    empty.className = 'roster-empty';
    empty.innerHTML = '<strong>No enrolled participants</strong><span>Create the first participant to enable recognition.</span>';
    ui.list.append(empty);
    return;
  }

  state.participants.forEach((participant) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'roster-card';
    button.dataset.id = participant.id;

    const photo = document.createElement('div');
    photo.className = 'roster-photo';
    if (participant.primaryPhoto) {
      const img = document.createElement('img');
      img.src = participant.primaryPhoto;
      img.alt = '';
      photo.append(img);
    } else {
      photo.textContent = (participant.name || '?').slice(0, 1).toUpperCase();
    }

    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = participant.name || 'Unnamed participant';
    const meta = document.createElement('span');
    const sampleText = (participant.embeddings?.length || 0) + ' face samples';
    const voiceReady = voiceProfileReadiness(participant);
    const voiceText = voiceReady.ready
      ? ' · voice profile ready'
      : voiceReady.embeddingCount
        ? ' · voice ' + voiceReady.embeddingCount + '/3'
        : ' · no voice profile';
    const seen = participant.lastSeenAt ? ' · seen ' + new Date(participant.lastSeenAt).toLocaleDateString() : '';
    meta.textContent = sampleText + voiceText + seen;
    copy.append(title, meta);

    const status = document.createElement('i');
    status.className = participant.recognitionEnabled === false ? 'off' : 'on';
    status.title = participant.recognitionEnabled === false ? 'Recognition disabled' : 'Recognition enabled';

    button.append(photo, copy, status);
    button.addEventListener('click', () => loadParticipant(participant.id));
    ui.list.append(button);
  });
}

async function reloadParticipants() {
  try {
    state.participants = await listParticipants();
    renderParticipantList();
  } catch (error) {
    console.error(error);
    setMessage('Local participant storage is unavailable in this browser.', 'error');
  }
}

async function loadParticipant(id) {
  const participant = await getParticipant(id);
  if (!participant) return;

  state.editingId = participant.id;
  document.body.dataset.participantId = participant.id;
  window.dispatchEvent(new CustomEvent('tracky:participant-loaded', { detail: { participantId: participant.id } }));
  state.primaryPhoto = participant.primaryPhoto || null;
  state.latestPhoto = participant.latestPhoto || null;
  state.embeddings = (participant.embeddings || []).map((value) => Array.from(value));

  ui.formModeLabel.textContent = 'PARTICIPANT PROFILE';
  ui.formTitle.textContent = participant.name || 'Participant';
  ui.name.value = participant.name || '';
  ui.nickname.value = participant.nickname || '';
  ui.notes.value = participant.notes || '';
  ui.recognitionEnabled.checked = participant.recognitionEnabled !== false;
  ui.delete.hidden = false;

  updatePhotos();
  updateEnrollmentUi();
  setMessage('Profile loaded. Capture a new primary photo or add enrollment samples at any time.');
}

async function ensureEngine() {
  if (state.engineReady) return true;
  ui.modelStatus.textContent = 'Loading models…';

  try {
    await state.engine.init();
    state.engineReady = true;
    ui.modelStatus.textContent = 'Identity core online';
    return true;
  } catch (error) {
    console.error(error);
    ui.modelStatus.textContent = 'Model unavailable';
    setMessage('Face models could not load. Participant profiles still work, but face enrollment is unavailable.', 'error');
    return false;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage('Camera access is not supported in this browser.', 'error');
    return;
  }

  stopCamera();

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
        facingMode: { ideal: 'user' }
      },
      audio: false
    });

    ui.video.srcObject = state.stream;
    await ui.video.play();
    ui.cameraPlaceholder.hidden = true;
    ui.startCamera.disabled = true;
    ui.stopCamera.disabled = false;
    ui.cameraStatus.textContent = 'Live';

    await ensureEngine();
    if (state.engineReady) {
      state.scanning = true;
      scheduleScan(80);
    }
  } catch (error) {
    console.error(error);
    ui.cameraStatus.textContent = 'Denied / unavailable';
    setMessage(window.isSecureContext ? 'Could not open camera.' : 'Camera access requires localhost or HTTPS.', 'error');
  }
}

function stopCamera() {
  state.scanning = false;
  clearTimeout(state.scanTimer);
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  ui.video.srcObject = null;
  ui.cameraPlaceholder.hidden = false;
  ui.startCamera.disabled = false;
  ui.stopCamera.disabled = true;
  ui.cameraStatus.textContent = 'Offline';
  ui.reticle.hidden = true;
  ui.capturePrimary.disabled = true;
  ui.captureSample.disabled = true;
  state.currentFace = null;
}

function scheduleScan(delay = 500) {
  clearTimeout(state.scanTimer);
  if (!state.scanning) return;
  state.scanTimer = setTimeout(scanFace, delay);
}

function positionReticle(face) {
  const box = face.box;
  ui.reticle.style.left = (box.x * 100) + '%';
  ui.reticle.style.top = (box.y * 100) + '%';
  ui.reticle.style.width = (box.width * 100) + '%';
  ui.reticle.style.height = (box.height * 100) + '%';
  ui.reticle.hidden = false;
}

async function scanFace() {
  if (!state.scanning || !state.engineReady || ui.video.readyState < 2) {
    scheduleScan(500);
    return;
  }

  try {
    const faces = await state.engine.detect(ui.video);
    const face = faces.sort((a, b) => b.quality - a.quality)[0] || null;
    state.currentFace = face;

    if (!face) {
      ui.reticle.hidden = true;
      ui.qualityValue.textContent = '0%';
      ui.qualityBar.style.width = '0%';
      ui.capturePrimary.disabled = true;
      ui.captureSample.disabled = true;
      scheduleScan(450);
      return;
    }

    positionReticle(face);
    const percent = Math.round(face.quality * 100);
    ui.qualityValue.textContent = percent + '%';
    ui.qualityBar.style.width = percent + '%';
    ui.qualityText.textContent = qualityMessage(face.quality);

    const captureReady = face.quality >= 0.55 && Boolean(face.embedding);
    ui.capturePrimary.disabled = !captureReady;
    ui.captureSample.disabled = !captureReady || state.embeddings.length >= 5;
  } catch (error) {
    console.error(error);
    ui.modelStatus.textContent = 'Identity scan error';
  } finally {
    scheduleScan(550);
  }
}

function captureCurrentPhoto() {
  if (!state.currentFace) return null;
  return cropFacePhoto(ui.video, state.currentFace.box, { mirror: true, size: 360, quality: 0.9 });
}

function capturePrimaryPhoto() {
  if (!state.currentFace || state.currentFace.quality < 0.55) return;
  const photo = captureCurrentPhoto();
  if (!photo) return;

  state.primaryPhoto = photo;
  state.latestPhoto = photo;
  updatePhotos();

  if (state.currentFace.embedding && state.embeddings.length === 0) {
    state.embeddings.push(Array.from(state.currentFace.embedding));
    updateEnrollmentUi();
  }

  setMessage('Primary photo captured. Add at least three face samples for stronger recognition.', 'ok');
}

function captureFaceSample() {
  if (!state.currentFace?.embedding || state.currentFace.quality < 0.55) return;
  if (state.embeddings.length >= 5) return;

  state.embeddings.push(Array.from(state.currentFace.embedding));
  state.latestPhoto = captureCurrentPhoto() || state.latestPhoto;
  updatePhotos();
  updateEnrollmentUi();

  const remaining = Math.max(0, 3 - state.embeddings.length);
  setMessage(
    remaining
      ? 'Face sample saved locally. Capture ' + remaining + ' more clean sample' + (remaining === 1 ? '' : 's') + '.'
      : 'Recognition enrollment is ready. Additional angles are optional.',
    'ok'
  );
}

async function saveForm() {
  const name = ui.name.value.trim();
  if (!name) {
    setMessage('Enter a participant name before saving.', 'error');
    ui.name.focus();
    return;
  }

  if (ui.recognitionEnabled.checked && state.embeddings.length < 3) {
    setMessage('Capture at least three face samples, or disable recognition for this participant.', 'error');
    return;
  }

  const existing = state.editingId ? await getParticipant(state.editingId) : null;
  const record = await saveParticipant({
    ...(existing || {}),
    id: state.editingId || undefined,
    name,
    nickname: ui.nickname.value,
    notes: ui.notes.value,
    primaryPhoto: state.primaryPhoto,
    latestPhoto: state.latestPhoto || state.primaryPhoto,
    embeddings: state.embeddings,
    recognitionEnabled: ui.recognitionEnabled.checked
  });

  state.editingId = record.id;
  document.body.dataset.participantId = record.id;
  window.dispatchEvent(new CustomEvent('tracky:participant-saved', { detail: { participantId: record.id } }));
  ui.formModeLabel.textContent = 'PARTICIPANT PROFILE';
  ui.formTitle.textContent = record.name;
  ui.delete.hidden = false;

  if (state.pendingId) {
    await deletePendingCapture(state.pendingId).catch(() => {});
    state.pendingId = null;
    history.replaceState(null, '', './participants.html');
  }

  await reloadParticipants();
  setMessage('Participant saved locally.', 'ok');
}

async function removeCurrentParticipant() {
  if (!state.editingId) return;
  const participant = await getParticipant(state.editingId);
  if (!participant) return;

  if (!window.confirm('Delete ' + participant.name + ' and their local face enrollment?')) return;
  await deleteParticipant(participant.id);
  clearForm();
  await reloadParticipants();
  setMessage('Participant deleted from this device.', 'ok');
}

async function loadPendingFromUrl() {
  const params = new URLSearchParams(location.search);
  const pendingId = params.get('pending');
  if (!pendingId) return;

  const pending = await getPendingCapture(pendingId);
  if (!pending) return;

  clearForm();
  state.pendingId = pendingId;
  state.primaryPhoto = pending.photo || null;
  state.latestPhoto = pending.photo || null;
  if (pending.embedding) state.embeddings = [Array.from(pending.embedding)];

  updatePhotos();
  updateEnrollmentUi();
  setMessage('Live room capture imported. Enter the participant details and capture additional face angles.', 'ok');
}

ui.newParticipant.addEventListener('click', clearForm);
ui.startCamera.addEventListener('click', startCamera);
ui.stopCamera.addEventListener('click', stopCamera);
ui.capturePrimary.addEventListener('click', capturePrimaryPhoto);
ui.captureSample.addEventListener('click', captureFaceSample);
ui.useLatestPrimary.addEventListener('click', () => {
  if (!state.latestPhoto) return;
  state.primaryPhoto = state.latestPhoto;
  updatePhotos();
  setMessage('Latest capture selected as primary photo. Save the profile to keep the change.', 'ok');
});
ui.save.addEventListener('click', saveForm);
ui.reset.addEventListener('click', clearForm);
ui.delete.addEventListener('click', removeCurrentParticipant);
window.addEventListener('beforeunload', stopCamera);

clearForm();
await reloadParticipants();
await loadPendingFromUrl();


window.addEventListener('tracky:participant-voice-updated', async () => {
  await reloadParticipants();
});
