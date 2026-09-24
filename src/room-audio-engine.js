import {
  dbFromRms,
  rmsLevel,
  speakingThreshold,
  updateNoiseFloor
} from './voice-core.js';
import {
  TRANSCRIPTION_MODEL_ID,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSFORMERS_ESM_URL
} from './model-config.js';

const TARGET_RATE = 16000;
const WORKLET_NAME = 'tracky-pcm-processor';

let transformersModulePromise = null;

async function transformers() {
  if (!transformersModulePromise) {
    transformersModulePromise = import(TRANSFORMERS_ESM_URL).then((module) => {
      module.env.allowLocalModels = false;
      module.env.useBrowserCache = true;
      return module;
    });
  }
  return transformersModulePromise;
}

export function resampleLinear(samples, sourceRate, targetRate = TARGET_RATE) {
  if (!samples?.length) return new Float32Array();
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new Error('Invalid source sample rate.');
  }
  if (!Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('Invalid target sample rate.');
  }
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
    this.lastError = null;
  }

  async init() {
    if (this.ready) return this;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const T = await transformers();
        this.transcriber = await T.pipeline(
          'automatic-speech-recognition',
          TRANSCRIPTION_MODEL_ID,
          {
            dtype: 'q8',
            revision: TRANSCRIPTION_MODEL_REVISION
          }
        );
        this.ready = true;
        return this;
      } catch (error) {
        this.lastError = error;
        this.ready = false;
        throw error;
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
    this.worklet = null;
    this.processor = null;
    this.mute = null;

    this.noiseFloorDb = -60;
    this.speaking = false;
    this.frames = [];
    this.levels = [];
    this.segmentStartedAt = 0;
    this.lastVoiceAt = 0;
    this.running = false;
    this.suppressed = false;
    this.captureMode = 'offline';

    this.hangoverMs = options.hangoverMs ?? 650;
    this.minSegmentSeconds = options.minSegmentSeconds ?? 0.8;
    this.maxSegmentSeconds = options.maxSegmentSeconds ?? 18;
  }

  async start() {
    await this.stop({ flush: false });

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not supported in this browser.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      },
      video: false
    });

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
      throw new Error('Web Audio is not supported in this browser.');
    }

    this.context = new AudioContextCtor({ latencyHint: 'interactive' });
    if (this.context.state === 'suspended') {
      await this.context.resume().catch(() => {});
    }

    this.source = this.context.createMediaStreamSource(this.stream);
    this.highpass = this.context.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 80;

    this.lowpass = this.context.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 7600;

    this.mute = this.context.createGain();
    this.mute.gain.value = 0;

    this.source.connect(this.highpass);
    this.highpass.connect(this.lowpass);

    const workletReady = await this.setupAudioWorklet();
    if (!workletReady) this.setupScriptProcessorFallback();

    this.running = true;
    this.suppressed = false;
    return this;
  }

  async setupAudioWorklet() {
    if (!this.context?.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      return false;
    }

    try {
      const moduleUrl = new URL('./room-audio-worklet.js', import.meta.url);
      await this.context.audioWorklet.addModule(moduleUrl);

      this.worklet = new AudioWorkletNode(this.context, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1
      });

      this.worklet.port.onmessage = (event) => {
        if (event.data?.length) {
          this.processFrame(Float32Array.from(event.data));
        }
      };

      this.lowpass.connect(this.worklet);
      this.worklet.connect(this.mute);
      this.mute.connect(this.context.destination);
      this.captureMode = 'audio-worklet';
      return true;
    } catch (error) {
      console.warn('AudioWorklet unavailable, using ScriptProcessor fallback.', error);
      this.worklet = null;
      return false;
    }
  }

  setupScriptProcessorFallback() {
    if (!this.context?.createScriptProcessor) {
      throw new Error('No supported PCM audio capture path is available.');
    }

    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      this.processFrame(Float32Array.from(input));
    };

    this.lowpass.connect(this.processor);
    this.processor.connect(this.mute);
    this.mute.connect(this.context.destination);
    this.captureMode = 'script-processor-fallback';
  }

  processFrame(frame, now = performance.now()) {
    if (!this.running || !frame?.length) return;

    const db = dbFromRms(rmsLevel(frame));
    const thresholdDb = speakingThreshold(this.noiseFloorDb);

    if (this.suppressed) {
      this.discardSegment();
      this.onLevel({
        db,
        noiseFloorDb: this.noiseFloorDb,
        thresholdDb,
        speaking: false,
        elapsedSeconds: 0,
        suppressed: true,
        captureMode: this.captureMode
      });
      return;
    }

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
      elapsedSeconds,
      suppressed: false,
      captureMode: this.captureMode
    });
  }

  discardSegment() {
    this.speaking = false;
    this.frames = [];
    this.levels = [];
    this.segmentStartedAt = 0;
    this.lastVoiceAt = 0;
  }

  setSuppressed(value) {
    this.suppressed = Boolean(value);
    if (this.suppressed) this.discardSegment();
  }

  async finishSegment(now = performance.now()) {
    if (!this.speaking) return null;

    const frames = this.frames;
    const levels = this.levels;
    const startedAt = this.segmentStartedAt;
    const sourceRate = this.context?.sampleRate || 48000;

    this.discardSegment();

    const combined = concatFrames(frames);
    const durationSeconds = combined.length / sourceRate;
    if (durationSeconds < this.minSegmentSeconds) return null;

    const samples = resampleLinear(combined, sourceRate, TARGET_RATE);
    const peakDb = levels.length ? Math.max(...levels) : -100;
    const avgDb = levels.length
      ? levels.reduce((sum, value) => sum + value, 0) / levels.length
      : -100;

    const segment = {
      samples,
      sampleRate: TARGET_RATE,
      startedAt,
      endedAt: now,
      durationSeconds,
      peakDb,
      avgDb,
      noiseFloorDb: this.noiseFloorDb
    };

    await this.onSegment(segment);
    return segment;
  }

  async stop(options = {}) {
    const flush = options.flush === true;
    this.running = false;

    if (flush && this.speaking && !this.suppressed) {
      await this.finishSegment(performance.now()).catch(() => {});
    } else {
      this.discardSegment();
    }

    try { this.source?.disconnect(); } catch {}
    try { this.highpass?.disconnect(); } catch {}
    try { this.lowpass?.disconnect(); } catch {}
    try { this.worklet?.disconnect(); } catch {}
    try { this.processor?.disconnect(); } catch {}
    try { this.mute?.disconnect(); } catch {}

    if (this.worklet) this.worklet.port.onmessage = null;
    if (this.processor) this.processor.onaudioprocess = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close().catch(() => {});

    this.stream = null;
    this.context = null;
    this.source = null;
    this.highpass = null;
    this.lowpass = null;
    this.worklet = null;
    this.processor = null;
    this.mute = null;
    this.suppressed = false;
    this.captureMode = 'offline';
  }
}
