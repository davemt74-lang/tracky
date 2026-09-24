import {
  dbFromRms,
  rmsLevel,
  speakingThreshold,
  updateNoiseFloor
} from './voice-core.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const WHISPER_MODEL_ID = 'Xenova/whisper-tiny.en';
const TARGET_RATE = 16000;

let transformersModulePromise = null;

async function transformers() {
  if (!transformersModulePromise) {
    transformersModulePromise = import(TRANSFORMERS_URL).then((module) => {
      module.env.allowLocalModels = false;
      module.env.useBrowserCache = true;
      return module;
    });
  }
  return transformersModulePromise;
}

export function resampleLinear(samples, sourceRate, targetRate = TARGET_RATE) {
  if (!samples?.length) return new Float32Array();
  if (sourceRate === targetRate) return Float32Array.from(samples);

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const mix = position - left;
    output[i] = samples[left] * (1 - mix) + samples[right] * mix;
  }

  return output;
}

function concatFrames(frames) {
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  const output = new Float32Array(length);
  let offset = 0;

  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }

  return output;
}

export class LocalTranscriptionEngine {
  constructor() {
    this.transcriber = null;
    this.loading = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return this;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const T = await transformers();
        this.transcriber = await T.pipeline(
          'automatic-speech-recognition',
          WHISPER_MODEL_ID,
          { dtype: 'q8' }
        );
        this.ready = true;
        return this;
      } finally {
        this.loading = null;
      }
    })();

    return this.loading;
  }

  async transcribe(samples) {
    if (!this.ready) await this.init();
    const result = await this.transcriber(samples, {
      chunk_length_s: 20,
      stride_length_s: 2,
      return_timestamps: false
    });

    return String(result?.text || '').trim();
  }
}

export class RoomAudioCapture {
  constructor(options = {}) {
    this.onLevel = options.onLevel || (() => {});
    this.onSegment = options.onSegment || (() => {});
    this.stream = null;
    this.context = null;
    this.source = null;
    this.highpass = null;
    this.lowpass = null;
    this.processor = null;
    this.mute = null;

    this.noiseFloorDb = -60;
    this.speaking = false;
    this.frames = [];
    this.levels = [];
    this.segmentStartedAt = 0;
    this.lastVoiceAt = 0;
    this.running = false;

    this.hangoverMs = options.hangoverMs ?? 650;
    this.minSegmentSeconds = options.minSegmentSeconds ?? 0.8;
    this.maxSegmentSeconds = options.maxSegmentSeconds ?? 18;
  }

  async start() {
    this.stop();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      },
      video: false
    });

    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.highpass = this.context.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 80;
    this.lowpass = this.context.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 7600;
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.mute = this.context.createGain();
    this.mute.gain.value = 0;

    this.processor.onaudioprocess = (event) => this.processFrame(event);
    this.source.connect(this.highpass);
    this.highpass.connect(this.lowpass);
    this.lowpass.connect(this.processor);
    this.processor.connect(this.mute);
    this.mute.connect(this.context.destination);

    this.running = true;
    return this;
  }

  processFrame(event) {
    if (!this.running) return;

    const now = performance.now();
    const input = event.inputBuffer.getChannelData(0);
    const frame = Float32Array.from(input);
    const db = dbFromRms(rmsLevel(frame));
    const thresholdDb = speakingThreshold(this.noiseFloorDb);
    const aboveThreshold = db >= thresholdDb && db >= -55;

    if (!this.speaking && !aboveThreshold) {
      this.noiseFloorDb = updateNoiseFloor(this.noiseFloorDb, db, false);
    }

    if (aboveThreshold) {
      if (!this.speaking) {
        this.speaking = true;
        this.frames = [];
        this.levels = [];
        this.segmentStartedAt = now;
      }

      this.frames.push(frame);
      this.levels.push(db);
      this.lastVoiceAt = now;
    } else if (this.speaking) {
      if (now - this.lastVoiceAt <= this.hangoverMs) {
        this.frames.push(frame);
        this.levels.push(db);
      } else {
        void this.finishSegment(now);
      }
    }

    const elapsedSeconds = this.speaking ? (now - this.segmentStartedAt) / 1000 : 0;
    if (this.speaking && elapsedSeconds >= this.maxSegmentSeconds) {
      void this.finishSegment(now);
    }

    this.onLevel({
      db,
      noiseFloorDb: this.noiseFloorDb,
      thresholdDb,
      speaking: this.speaking,
      elapsedSeconds
    });
  }

  async finishSegment(now = performance.now()) {
    if (!this.speaking) return;

    const frames = this.frames;
    const levels = this.levels;
    const startedAt = this.segmentStartedAt;

    this.speaking = false;
    this.frames = [];
    this.levels = [];
    this.segmentStartedAt = 0;

    const combined = concatFrames(frames);
    const sourceRate = this.context?.sampleRate || 48000;
    const durationSeconds = combined.length / sourceRate;

    if (durationSeconds < this.minSegmentSeconds) return;

    const samples = resampleLinear(combined, sourceRate, TARGET_RATE);
    const peakDb = levels.length ? Math.max(...levels) : -100;
    const avgDb = levels.length
      ? levels.reduce((sum, value) => sum + value, 0) / levels.length
      : -100;

    await this.onSegment({
      samples,
      sampleRate: TARGET_RATE,
      startedAt,
      endedAt: now,
      durationSeconds,
      peakDb,
      avgDb,
      noiseFloorDb: this.noiseFloorDb
    });
  }

  stop() {
    this.running = false;
    this.speaking = false;
    this.frames = [];
    this.levels = [];

    try { this.source?.disconnect(); } catch {}
    try { this.highpass?.disconnect(); } catch {}
    try { this.lowpass?.disconnect(); } catch {}
    try { this.processor?.disconnect(); } catch {}
    try { this.mute?.disconnect(); } catch {}

    if (this.processor) this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close().catch(() => {});

    this.stream = null;
    this.context = null;
    this.source = null;
    this.highpass = null;
    this.lowpass = null;
    this.processor = null;
    this.mute = null;
  }
}
