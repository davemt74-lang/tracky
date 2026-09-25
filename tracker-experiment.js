import {
  applyHomography,
  clamp01,
  computeHomography,
  detectColorBlob
} from './src/tracker-core.js';

const $ = (selector) => document.querySelector(selector);

const ui = {
  start: $('#startCamera'),
  stop: $('#stopCamera'),
  select: $('#cameraSelect'),
  video: $('#cameraVideo'),
  camera: $('#cameraCanvas'),
  game: $('#gameCanvas'),
  cameraStatus: $('#cameraStatus'),
  trackingStatus: $('#trackingStatus'),
  fps: $('#fpsValue'),
  mirror: $('#mirrorCamera'),
  debug: $('#debugOverlay'),
  hueMin: $('#hueMin'),
  hueMax: $('#hueMax'),
  satMin: $('#satMin'),
  valMin: $('#valMin'),
  minArea: $('#minArea'),
  smoothing: $('#smoothing'),
  lost: $('#lostBehavior'),
  calStart: $('#calibrationStart'),
  calCapture: $('#calibrationCapture'),
  calReset: $('#calibrationReset'),
  calText: $('#calibrationText'),
  calProgress: $('#calibrationProgress'),
  rawX: $('#rawX'),
  rawY: $('#rawY'),
  smoothX: $('#smoothX'),
  smoothY: $('#smoothY'),
  velocityX: $('#velocityX'),
  velocityY: $('#velocityY'),
  speed: $('#speedValue'),
  confidence: $('#confidenceValue')
};

const values = {
  hueMin: $('#hueMinValue'),
  hueMax: $('#hueMaxValue'),
  satMin: $('#satMinValue'),
  valMin: $('#valMinValue'),
  minArea: $('#minAreaValue'),
  smoothing: $('#smoothingValue')
};

const cameraCtx = ui.camera.getContext('2d', { willReadFrequently: true });
const gameCtx = ui.game.getContext('2d');
const workCanvas = document.createElement('canvas');
const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

const state = {
  stream: null,
  running: false,
  raf: 0,
  frames: 0,
  fpsAt: performance.now(),
  last: performance.now(),
  smooth: { x: 0.5, y: 0.5 },
  prev: { x: 0.5, y: 0.5 },
  detection: null,
  calibration: {
    active: false,
    step: 0,
    points: [],
    homography: null
  }
};

const calibrationLabels = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left'
];

const calibrationDestination = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
];

function syncControls() {
  values.hueMin.textContent = ui.hueMin.value + '°';
  values.hueMax.textContent = ui.hueMax.value + '°';
  values.satMin.textContent = ui.satMin.value + '%';
  values.valMin.textContent = ui.valMin.value + '%';
  values.minArea.textContent = Number(ui.minArea.value).toFixed(2) + '%';
  values.smoothing.textContent = Number(ui.smoothing.value).toFixed(2);
}

function detectionOptions() {
  return {
    hueMin: Number(ui.hueMin.value),
    hueMax: Number(ui.hueMax.value),
    saturationMin: Number(ui.satMin.value),
    valueMin: Number(ui.valMin.value),
    minAreaRatio: Number(ui.minArea.value) / 100,
    sampleStep: 2
  };
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

async function enumerateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const current = ui.select.value;

  ui.select.replaceChildren();

  cameras.forEach((camera, index) => {
    const option = document.createElement('option');
    option.value = camera.deviceId;
    option.textContent = camera.label || 'Camera ' + (index + 1);
    ui.select.append(option);
  });

  if (cameras.some((camera) => camera.deviceId === current)) {
    ui.select.value = current;
  }
  ui.select.disabled = cameras.length < 2;
}

function stopCamera() {
  state.running = false;
  cancelAnimationFrame(state.raf);

  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.detection = null;
  ui.video.srcObject = null;

  ui.start.disabled = false;
  ui.stop.disabled = true;
  ui.select.disabled = true;
  ui.cameraStatus.textContent = 'Camera stopped';
  ui.trackingStatus.textContent = 'No signal';

  if (state.calibration.active) ui.calCapture.disabled = true;
  drawGame(true);
}

async function startCamera(deviceId = '') {
  stopCamera();

  if (!navigator.mediaDevices?.getUserMedia) {
    ui.cameraStatus.textContent = 'Camera API unavailable';
    return false;
  }

  try {
    ui.cameraStatus.textContent = 'Requesting camera…';

    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 }
    };

    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { ideal: 'user' };

    state.stream = await navigator.mediaDevices.getUserMedia({
      video,
      audio: false
    });

    ui.video.srcObject = state.stream;
    await ui.video.play();
    await enumerateCameras();

    state.running = true;
    state.last = performance.now();
    state.frames = 0;
    state.fpsAt = state.last;

    ui.start.disabled = true;
    ui.stop.disabled = false;
    ui.cameraStatus.textContent = 'Camera live';

    state.raf = requestAnimationFrame(loop);
    return true;
  } catch (error) {
    console.error(error);
    ui.cameraStatus.textContent = window.isSecureContext
      ? 'Could not start camera'
      : 'Use localhost or HTTPS';
    return false;
  }
}

function prepareCanvases() {
  const sourceWidth = ui.video.videoWidth || 1280;
  const sourceHeight = ui.video.videoHeight || 720;
  const aspect = sourceWidth / sourceHeight;

  const workWidth = 320;
  const workHeight = Math.max(180, Math.round(workWidth / aspect));
  const cameraWidth = 960;
  const cameraHeight = Math.round(cameraWidth / aspect);

  if (workCanvas.width !== workWidth) workCanvas.width = workWidth;
  if (workCanvas.height !== workHeight) workCanvas.height = workHeight;
  if (ui.camera.width !== cameraWidth) ui.camera.width = cameraWidth;
  if (ui.camera.height !== cameraHeight) ui.camera.height = cameraHeight;
}

function mapDetection(detection) {
  const point = applyHomography(
    {
      x: ui.mirror.checked ? 1 - detection.x : detection.x,
      y: detection.y
    },
    state.calibration.homography
  );

  return {
    x: clamp01(point.x),
    y: clamp01(point.y)
  };
}

function drawCamera(detection) {
  const width = ui.camera.width;
  const height = ui.camera.height;

  cameraCtx.save();
  if (ui.mirror.checked) {
    cameraCtx.translate(width, 0);
    cameraCtx.scale(-1, 1);
  }
  cameraCtx.drawImage(ui.video, 0, 0, width, height);
  cameraCtx.restore();

  if (!ui.debug.checked || !detection) return;

  const box = detection.bbox;
  const x = (ui.mirror.checked ? 1 - box.x - box.width : box.x) * width;
  const y = box.y * height;
  const centerX = (ui.mirror.checked ? 1 - detection.x : detection.x) * width;
  const centerY = detection.y * height;

  cameraCtx.strokeStyle = '#56e36f';
  cameraCtx.fillStyle = '#56e36f';
  cameraCtx.lineWidth = 4;
  cameraCtx.strokeRect(x, y, box.width * width, box.height * height);
  cameraCtx.beginPath();
  cameraCtx.arc(centerX, centerY, 8, 0, Math.PI * 2);
  cameraCtx.fill();
}

function sizeGameCanvas() {
  const rect = ui.game.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (ui.game.width !== width) ui.game.width = width;
  if (ui.game.height !== height) ui.game.height = height;

  return { width, height };
}

function drawGame(forceHidden = false) {
  const { width, height } = sizeGameCanvas();
  gameCtx.clearRect(0, 0, width, height);

  gameCtx.strokeStyle = 'rgba(255,255,255,.08)';
  for (let i = 1; i < 4; i += 1) {
    gameCtx.beginPath();
    gameCtx.moveTo(width * i / 4, 0);
    gameCtx.lineTo(width * i / 4, height);
    gameCtx.stroke();

    gameCtx.beginPath();
    gameCtx.moveTo(0, height * i / 4);
    gameCtx.lineTo(width, height * i / 4);
    gameCtx.stroke();
  }

  const visible = !forceHidden && Boolean(state.detection);
  let x = state.smooth.x;
  let y = state.smooth.y;
  let alpha = visible ? 1 : 0;

  if (!visible && ui.lost.value === 'hold') alpha = 0.35;

  if (!visible && ui.lost.value === 'center') {
    x += (0.5 - x) * 0.04;
    y += (0.5 - y) * 0.04;
    state.smooth = { x, y };
    alpha = 0.25;
  }

  if (!alpha) return;

  const px = x * width;
  const py = y * height;
  const radius = Math.max(16, Math.min(width, height) * 0.035);

  gameCtx.globalAlpha = alpha;
  gameCtx.strokeStyle = '#56e36f';
  gameCtx.fillStyle = 'rgba(86,227,111,.18)';
  gameCtx.lineWidth = Math.max(3, radius * 0.12);

  gameCtx.beginPath();
  gameCtx.arc(px, py, radius, 0, Math.PI * 2);
  gameCtx.fill();
  gameCtx.stroke();

  gameCtx.beginPath();
  gameCtx.moveTo(px - radius * 1.45, py);
  gameCtx.lineTo(px + radius * 1.45, py);
  gameCtx.moveTo(px, py - radius * 1.45);
  gameCtx.lineTo(px, py + radius * 1.45);
  gameCtx.stroke();

  gameCtx.globalAlpha = 1;
}

function renderTelemetry(raw, now, detection) {
  const dt = Math.max(0.001, (now - state.last) / 1000);
  const velocityX = (state.smooth.x - state.prev.x) / dt;
  const velocityY = (state.smooth.y - state.prev.y) / dt;

  ui.rawX.textContent = raw ? formatNumber(raw.x) : '—';
  ui.rawY.textContent = raw ? formatNumber(raw.y) : '—';
  ui.smoothX.textContent = detection ? formatNumber(state.smooth.x) : '—';
  ui.smoothY.textContent = detection ? formatNumber(state.smooth.y) : '—';
  ui.velocityX.textContent = detection ? formatNumber(velocityX, 2) : '—';
  ui.velocityY.textContent = detection ? formatNumber(velocityY, 2) : '—';
  ui.speed.textContent = detection
    ? formatNumber(Math.hypot(velocityX, velocityY), 2)
    : '—';
  ui.confidence.textContent = detection
    ? Math.round(detection.confidence * 100) + '%'
    : '—';
  ui.trackingStatus.textContent = detection
    ? 'Object tracked'
    : 'Searching for green…';
}

function updateFps(now) {
  state.frames += 1;
  if (now - state.fpsAt < 500) return;

  ui.fps.textContent = (
    state.frames * 1000 / Math.max(1, now - state.fpsAt)
  ).toFixed(1);
  state.frames = 0;
  state.fpsAt = now;
}

function loop(now) {
  if (!state.running) return;

  if (ui.video.readyState < 2) {
    state.raf = requestAnimationFrame(loop);
    return;
  }

  prepareCanvases();

  workCtx.drawImage(
    ui.video,
    0,
    0,
    workCanvas.width,
    workCanvas.height
  );

  const detection = detectColorBlob(
    workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height),
    detectionOptions()
  );

  state.detection = detection;
  state.prev = { ...state.smooth };

  let raw = null;
  if (detection) {
    raw = mapDetection(detection);
    const smoothing = Number(ui.smoothing.value);
    state.smooth.x += (raw.x - state.smooth.x) * smoothing;
    state.smooth.y += (raw.y - state.smooth.y) * smoothing;
  }

  drawCamera(detection);
  drawGame();
  renderTelemetry(raw, now, detection);
  updateFps(now);

  if (state.calibration.active) {
    ui.calCapture.disabled = !detection;
  }

  state.last = now;
  state.raf = requestAnimationFrame(loop);
}

function startCalibration() {
  state.calibration = {
    active: true,
    step: 0,
    points: [],
    homography: null
  };
  ui.calCapture.disabled = !state.detection;
  ui.calText.textContent =
    'Hold the green object at the ' +
    calibrationLabels[0] +
    ' of your play area, then capture.';
  ui.calProgress.textContent = '0 / 4 points';
}

function captureCalibrationPoint() {
  if (!state.calibration.active || !state.detection) return;

  state.calibration.points.push({
    x: ui.mirror.checked ? 1 - state.detection.x : state.detection.x,
    y: state.detection.y
  });

  state.calibration.step += 1;
  ui.calProgress.textContent = state.calibration.step + ' / 4 points';

  if (state.calibration.step === 4) {
    state.calibration.homography = computeHomography(
      state.calibration.points,
      calibrationDestination
    );
    state.calibration.active = false;
    ui.calCapture.disabled = true;
    ui.calText.textContent = state.calibration.homography
      ? 'Calibration active. Your captured corners map to the full game surface.'
      : 'Calibration failed. Reset and try again.';
    return;
  }

  ui.calText.textContent =
    'Captured. Now hold the object at the ' +
    calibrationLabels[state.calibration.step] +
    ' and capture.';
}

function resetCalibration() {
  state.calibration = {
    active: false,
    step: 0,
    points: [],
    homography: null
  };
  ui.calCapture.disabled = true;
  ui.calText.textContent =
    'Optional: map any four physical corners to the full game surface.';
  ui.calProgress.textContent = 'Not calibrated';
}

ui.start.addEventListener('click', () => startCamera(ui.select.value));
ui.stop.addEventListener('click', stopCamera);
ui.select.addEventListener('change', () => {
  if (state.running) void startCamera(ui.select.value);
});
ui.calStart.addEventListener('click', startCalibration);
ui.calCapture.addEventListener('click', captureCalibrationPoint);
ui.calReset.addEventListener('click', resetCalibration);
window.addEventListener('resize', () => drawGame());
window.addEventListener('beforeunload', stopCamera);

[
  ui.hueMin,
  ui.hueMax,
  ui.satMin,
  ui.valMin,
  ui.minArea,
  ui.smoothing
].forEach((control) => control.addEventListener('input', syncControls));

syncControls();
drawGame(true);
