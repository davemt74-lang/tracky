import { faceQuality, normalizeBox } from './participant-core.js';
import { bodyDetection } from './room-tracking-core.js';

const HUMAN_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js';
const MODEL_BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/';

export class IdentityEngine {
  constructor() {
    this.human = null;
    this.ready = false;
    this.loading = null;
    this.lastError = null;
  }

  async init() {
    if (this.ready) return this;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const H = await import(HUMAN_URL);
        this.human = new H.Human({
          backend: 'webgl',
          debug: false,
          cacheSensitivity: 0.05,
          modelBasePath: MODEL_BASE,
          filter: { enabled: true, equalization: true, flip: false },
          face: {
            enabled: true,
            detector: {
              enabled: true,
              rotation: true,
              return: true,
              maxDetected: 8,
              minConfidence: 0.35
            },
            mesh: { enabled: true },
            description: { enabled: true },
            iris: { enabled: false },
            emotion: { enabled: false },
            antispoof: { enabled: false },
            liveness: { enabled: false }
          },
          body: {
            enabled: true,
            maxDetected: 8,
            minConfidence: 0.25
          },
          hand: { enabled: false },
          object: { enabled: false },
          gesture: { enabled: false },
          segmentation: { enabled: false }
        });

        await this.human.load();
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

  async detectRoom(input) {
    if (!this.ready) await this.init();
    const result = await this.human.detect(input);
    const frameWidth = Number(input.videoWidth || input.width || 1);
    const frameHeight = Number(input.videoHeight || input.height || 1);

    const faces = (result.face || []).map((face) => ({
      raw: face,
      box: normalizeBox(face.box, frameWidth, frameHeight),
      embedding: face.embedding ? Array.from(face.embedding) : null,
      score: Number(face.score || 0),
      quality: faceQuality(face, frameWidth, frameHeight),
      rotation: face.rotation || null
    }));

    const bodies = (result.body || []).map((body) => bodyDetection(body, frameWidth, frameHeight));

    return { faces, bodies, raw: result };
  }

  async detect(input) {
    const room = await this.detectRoom(input);
    return room.faces;
  }

  similarity(a, b) {
    if (!this.human || !a || !b) return 0;
    return this.human.match.similarity(a, b);
  }
}

export function cropFacePhoto(video, normalizedBox, options = {}) {
  if (!video || !normalizedBox) return null;

  const sourceWidth = video.videoWidth || 0;
  const sourceHeight = video.videoHeight || 0;
  if (!sourceWidth || !sourceHeight) return null;

  const margin = options.margin ?? 0.35;
  const boxWidth = normalizedBox.width * sourceWidth;
  const boxHeight = normalizedBox.height * sourceHeight;
  const size = Math.max(boxWidth, boxHeight) * (1 + margin * 2);
  const centerX = normalizedBox.cx * sourceWidth;
  const centerY = normalizedBox.cy * sourceHeight;

  let sx = centerX - size / 2;
  let sy = centerY - size / 2;
  sx = Math.max(0, Math.min(sourceWidth - size, sx));
  sy = Math.max(0, Math.min(sourceHeight - size, sy));
  const sw = Math.min(size, sourceWidth - sx);
  const sh = Math.min(size, sourceHeight - sy);

  const canvas = document.createElement('canvas');
  const target = options.size || 320;
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');

  if (options.mirror) {
    ctx.translate(target, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, target, target);
  return canvas.toDataURL('image/jpeg', options.quality || 0.88);
}

export function qualityMessage(quality) {
  if (quality >= 0.78) return 'FACE LOCK · CAPTURE READY';
  if (quality >= 0.60) return 'ALIGNING · HOLD POSITION';
  if (quality >= 0.42) return 'MOVE CLOSER · FACE CAMERA';
  return 'SEARCHING FOR CLEAN FACE ANGLE';
}
