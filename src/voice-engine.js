import { dbFromRms, normalizeAudio, rmsLevel } from './voice-core.js';
import {
  TRANSFORMERS_ESM_URL,
  VOICE_MODEL_ID,
  VOICE_MODEL_REVISION
} from './model-config.js';

const TARGET_SAMPLE_RATE = 16000;

export class VoiceIdentityEngine {
  constructor() {
    this.processor = null;
    this.model = null;
    this.ready = false;
    this.loading = null;
    this.lastError = null;
  }

  async init() {
    if (this.ready) return this;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const T = await import(TRANSFORMERS_ESM_URL);
        T.env.allowLocalModels = false;
        T.env.useBrowserCache = true;
        this.processor = await T.AutoProcessor.from_pretrained(VOICE_MODEL_ID, {
          revision: VOICE_MODEL_REVISION
        });
        this.model = await T.AutoModel.from_pretrained(VOICE_MODEL_ID, {
          dtype: 'q8',
          revision: VOICE_MODEL_REVISION
        });
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

  async embedding(samples) {
    if (!this.ready) await this.init();
    const normalized = normalizeAudio(samples);
    if (normalized.length < TARGET_SAMPLE_RATE) {
      throw new Error('Voice sample is too short for speaker matching.');
    }

    const inputs = await this.processor(normalized);
    const result = await this.model(inputs);
    const tensor = result.embeddings || result.logits;
    if (!tensor?.data) throw new Error('Speaker model did not return an embedding.');
    return Array.from(tensor.data);
  }
}

export class MicrophoneCapture {
  constructor() {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  async start() {
    this.stopStream();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not supported in this browser.');
    }
    if (!window.MediaRecorder) {
      throw new Error('MediaRecorder is not supported in this browser.');
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('Web Audio is not supported in this browser.');
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

    this.context = new AudioContextCtor();
    if (this.context.state === 'suspended') {
      await this.context.resume().catch(() => {});
    }
    this.source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;
    this.source.connect(this.analyser);

    this.chunks = [];
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus'
    ].find((type) => window.MediaRecorder.isTypeSupported?.(type)) || '';

    this.mediaRecorder = new window.MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined
    );
    this.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    });
    this.startedAt = performance.now();
    this.mediaRecorder.start(250);
    return this;
  }

  level() {
    if (!this.analyser) return { rms: 0, db: -100 };
    const values = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(values);
    const rms = rmsLevel(values);
    return { rms, db: dbFromRms(rms) };
  }

  async stop() {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return null;

    const recorder = this.mediaRecorder;
    const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.stop();
    await stopped;

    const durationSeconds = Math.max(0, (performance.now() - this.startedAt) / 1000);
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
    this.stopStream();

    return { blob, durationSeconds };
  }

  stopStream() {
    try { this.mediaRecorder?.state !== 'inactive' && this.mediaRecorder?.stop(); } catch {}
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    try { this.source?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    this.context?.close().catch(() => {});
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.mediaRecorder = null;
  }
}

export async function decodeAndResample(blob, targetRate = TARGET_SAMPLE_RATE) {
  if (!blob?.arrayBuffer) throw new Error('Invalid recorded voice sample.');

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextCtor || !OfflineAudioContextCtor) {
    throw new Error('Web Audio decoding is not supported in this browser.');
  }

  const arrayBuffer = await blob.arrayBuffer();
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const source = decoded.numberOfChannels === 1
      ? decoded.getChannelData(0)
      : mixToMono(decoded);

    if (decoded.sampleRate === targetRate) return Float32Array.from(source);

    const targetLength = Math.ceil(source.length * targetRate / decoded.sampleRate);
    const offline = new OfflineAudioContextCtor(1, targetLength, targetRate);
    const buffer = offline.createBuffer(1, source.length, decoded.sampleRate);
    buffer.copyToChannel(source, 0);
    const node = offline.createBufferSource();
    node.buffer = buffer;
    node.connect(offline.destination);
    node.start();
    const rendered = await offline.startRendering();
    return Float32Array.from(rendered.getChannelData(0));
  } finally {
    await context.close().catch(() => {});
  }
}

function mixToMono(audioBuffer) {
  const output = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) output[i] += data[i] / audioBuffer.numberOfChannels;
  }
  return output;
}

export async function extractVoiceEmbedding(engine, blob) {
  const audio = await decodeAndResample(blob, TARGET_SAMPLE_RATE);
  return engine.embedding(audio);
}
