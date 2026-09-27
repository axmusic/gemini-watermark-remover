// ── Video Watermark Processing Engine & Batch Processing ──

const VIDEO_DEFAULTS = { gain: 1.0, offsetX: -24, offsetY: -24, sizeScale: 1 };

const VIDEO_PRESETS = {
  veo: { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1 },
  corner: { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1 },
  sparkle: { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1 }
};

function getAdaptiveVideoPreset(presetKey, width = 720, height = 720) {
  if (presetKey === 'corner') {
    return { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1.0 };
  }
  if (presetKey === 'sparkle') {
    const minDim = Math.min(width, height || width);
    const m = Math.max(16, Math.round(192 * (minDim / 1536)));
    const s = Math.max(24, Math.round(96 * (minDim / 1536)));
    const baseDim = Math.min(width, height);
    const veoBase = {
      size: Math.max(24, Math.min(Math.round(baseDim / 15), baseDim)),
      margin: Math.round(baseDim / 10),
    };
    const baseX = Math.max(0, width - veoBase.margin - veoBase.size);
    const baseY = Math.max(0, height - veoBase.margin - veoBase.size);
    return {
      gain: 0.6,
      offsetX: Math.max(0, width - m - s) - baseX,
      offsetY: Math.max(0, height - m - s) - baseY,
      sizeScale: 1.0
    };
  }
  const minDim = Math.min(width, height || width);
  const scaleRatio = Math.max(0.3, Math.min(1.5, minDim / 720));
  const adaptiveOffset = Math.round(-24 * scaleRatio);
  return {
    gain: 0.6,
    offsetX: adaptiveOffset,
    offsetY: adaptiveOffset,
    sizeScale: 1.0
  };
}

class VideoWatermarkEngine {
  constructor(engine) {
    this.engine = engine;
    this._mb = null;
  }

  static async create() {
    const engine = await WatermarkEngine.create();
    return new VideoWatermarkEngine(engine);
  }

  static isSupported() {
    return (
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoDecoder !== 'undefined'
    );
  }

  async _lib() {
    if (!this._mb) this._mb = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.52.3/+esm');
    return this._mb;
  }

  get sparkleImage() {
    return this.engine.bg96;
  }

  getVeoWatermark(width, height) {
    const base = Math.min(width, height);
    const size = Math.max(24, Math.min(Math.round(base / 15), base));
    const margin = Math.round(base / 10);
    return {
      size,
      x: Math.max(0, width - margin - size),
      y: Math.max(0, height - margin - size),
      width: size,
      height: size,
    };
  }

  previewClean(fullImageData, width, height, opts = {}) {
    const base = this.getVeoWatermark(width, height);
    return cleanFrame(this.engine.bg96, fullImageData, width, height, base, {
      ...opts,
      gain: opts.gain ?? VIDEO_DEFAULTS.gain,
    });
  }

  async process(file, opts = {}) {
    const onProgress = opts.onProgress || (() => { });
    const gain = opts.gain ?? VIDEO_DEFAULTS.gain;

    const mb = await this._lib();
    const {
      ALL_FORMATS, BlobSource, BufferTarget, CanvasSource,
      EncodedAudioPacketSource, EncodedPacketSink, Input,
      Mp4OutputFormat, Output, QUALITY_HIGH, VideoSampleSink, canEncodeVideo,
    } = mb;

    if (canEncodeVideo && !(await canEncodeVideo('avc'))) {
      throw new Error(
        'Your browser cannot encode H.264 video locally. Please try Chrome or Edge desktop.'
      );
    }

    const originalUrl = URL.createObjectURL(file);
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      input.dispose?.();
      URL.revokeObjectURL(originalUrl);
      throw new Error('No decodable video track found.');
    }

    const width = videoTrack.displayWidth ?? videoTrack.codedWidth;
    const height = videoTrack.displayHeight ?? videoTrack.codedHeight;
    const duration = await input.computeDuration().catch(() => 0);

    let frameRate = 30;
    try {
      const stats = await videoTrack.computePacketStats(120);
      if (stats?.averagePacketRate) frameRate = Math.round(stats.averagePacketRate);
    } catch { }

    const base = opts.mode === 'gemini' ? getWatermarkInfo(width, height) : this.getVeoWatermark(width, height);
    const wm = resolveBox(base, width, height, opts);
    const roi = getRoi(width, height, wm);
    const alpha = buildAlpha(this.engine.bg96, roi, wm, gain);
    const region = { x: 0, y: 0, width: roi.width, height: roi.height };

    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: QUALITY_HIGH,
      keyFrameInterval: 2,
      sizeChangeBehavior: 'passThrough',
    });
    output.addVideoTrack(videoSource, { frameRate });

    let audioSource = null;
    let audioTrack = null;
    let audioDecoderConfig = null;
    try {
      audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        const audioCodec = await audioTrack.getCodec();
        audioDecoderConfig = await audioTrack.getDecoderConfig().catch(() => null);
        if (audioCodec && audioDecoderConfig) {
          audioSource = new EncodedAudioPacketSource(audioCodec);
          output.addAudioTrack(audioSource);
        }
      }
    } catch {
      audioSource = null;
    }

    await output.start();

    const fallbackDur = frameRate > 0 ? 1 / frameRate : 1 / 30;
    const sink = new VideoSampleSink(videoTrack);
    let firstTimestamp = null;
    let lastTimestamp = -1;
    for await (const sample of sink.samples()) {
      if (firstTimestamp === null) firstTimestamp = sample.timestamp;
      let timestamp = sample.timestamp - firstTimestamp;
      if (!(timestamp >= 0)) timestamp = 0;
      if (timestamp <= lastTimestamp) timestamp = lastTimestamp + fallbackDur;
      const dur = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : fallbackDur;
      lastTimestamp = timestamp;

      sample.draw(ctx, 0, 0, width, height);
      sample.close();

      const px = ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
      removeWatermark(px, alpha, region);

      // Force GPU texture sync for WebCodecs by using ImageBitmap
      const bmp = await createImageBitmap(px);
      ctx.drawImage(bmp, roi.x, roi.y);
      bmp.close();

      await videoSource.add(timestamp, dur);
      if (duration) onProgress({ progress: Math.min(0.99, timestamp / duration) });
    }
    videoSource.close();

    if (audioSource) {
      try {
        const offset = firstTimestamp ?? 0;
        const aSink = new EncodedPacketSink(audioTrack);
        let isFirstAudio = true;
        let lastAudioTs = -1;
        for await (const packet of aSink.packets()) {
          let newTs = packet.timestamp - offset;
          if (newTs < 0) continue;
          if (newTs <= lastAudioTs) newTs = lastAudioTs + 1e-6;
          lastAudioTs = newTs;
          let outPacket = packet;
          if (newTs !== packet.timestamp && typeof packet.clone === 'function') {
            outPacket = packet.clone({ timestamp: newTs });
          }
          await audioSource.add(
            outPacket,
            isFirstAudio && audioDecoderConfig ? { decoderConfig: audioDecoderConfig } : undefined
          );
          isFirstAudio = false;
        }
      } catch (e) {
        console.warn('Audio passthrough failed.', e);
      } finally {
        audioSource.close();
      }
    }

    await output.finalize();
    input.dispose?.();

    if (!target.buffer) {
      URL.revokeObjectURL(originalUrl);
      throw new Error('Video export produced no output.');
    }

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    onProgress({ progress: 1 });

    return {
      blob,
      url: URL.createObjectURL(blob),
      originalUrl,
      ext: 'mp4',
      mime: 'video/mp4',
      width,
      height,
    };
  }
}

function detectVideoWatermarkCandidate(imageData, width, height, bgImg) {
  const baseDim = Math.min(width, height);
  const veoBase = {
    size: Math.max(24, Math.min(Math.round(baseDim / 15), baseDim)),
    margin: Math.round(baseDim / 10),
  };

  const layoutFamilies = [
    // 1. Gemini Omni & Google Flow Adaptive Inset
    {
      presetKey: 'veo',
      name: 'Gemini Omni & Google Flow (Adaptive Inset)',
      baseSize: veoBase.size,
      calcPos: (s) => {
        const adaptiveOffset = Math.round(-24 * (baseDim / 720));
        const baseX = Math.max(0, width - veoBase.margin - veoBase.size);
        const baseY = Math.max(0, height - veoBase.margin - veoBase.size);
        return {
          x: Math.max(0, Math.min(width - s, baseX + adaptiveOffset)),
          y: Math.max(0, Math.min(height - s, baseY + adaptiveOffset))
        };
      },
      gain: 0.6,
      prior: 1.06
    },
    // 2. Veo Classic Corner
    {
      presetKey: 'corner',
      name: 'Gemini Veo & Flow (Corner)',
      baseSize: veoBase.size,
      calcPos: (s) => {
        const baseX = Math.max(0, width - veoBase.margin - veoBase.size);
        const baseY = Math.max(0, height - veoBase.margin - veoBase.size);
        return {
          x: Math.max(0, Math.min(width - s, baseX)),
          y: Math.max(0, Math.min(height - s, baseY))
        };
      },
      gain: 0.6,
      prior: 1.02
    },
    // 3. Gemini Sparkle Image-style on Video
    {
      presetKey: 'sparkle',
      name: 'Gemini Sparkle (Standard Video)',
      baseSize: Math.max(24, Math.round(96 * (baseDim / 1536))),
      calcPos: (s) => {
        const m = Math.max(16, Math.round(192 * (baseDim / 1536)));
        return {
          x: Math.max(0, width - m - s),
          y: Math.max(0, height - m - s)
        };
      },
      gain: 0.6,
      prior: 1.01
    }
  ];

  const scalePyramid = [0.65, 0.85, 1.00, 1.20, 1.45];

  let bestMatch = null;
  let bestScore = -1;

  for (const layout of layoutFamilies) {
    for (const scale of scalePyramid) {
      const s = Math.max(16, Math.min(Math.round(layout.baseSize * scale), Math.min(width, height) - 8));
      const pos = layout.calcPos(s);
      const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, { x: pos.x, y: pos.y, size: s });
      const weightedScore = score * (layout.prior || 1.0);

      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestMatch = {
          layout,
          size: s,
          scale,
          x: pos.x,
          y: pos.y,
          score: weightedScore
        };
      }
    }
  }

  const baseX = Math.max(0, width - veoBase.margin - veoBase.size);
  const baseY = Math.max(0, height - veoBase.margin - veoBase.size);

  if (bestMatch && bestMatch.score > 0.05) {
    let refinedX = bestMatch.x;
    let refinedY = bestMatch.y;
    let refinedSize = bestMatch.size;
    let refinedScore = bestMatch.score;

    const fineSizes = [
      Math.max(16, Math.round(bestMatch.size * 0.92)),
      bestMatch.size,
      Math.min(Math.min(width, height) - 8, Math.round(bestMatch.size * 1.08))
    ];
    const uniqueSizes = [...new Set(fineSizes)];

    for (const testSize of uniqueSizes) {
      for (let dy = -16; dy <= 16; dy += 4) {
        for (let dx = -16; dx <= 16; dx += 4) {
          const testX = Math.max(0, Math.min(width - testSize, bestMatch.x + dx));
          const testY = Math.max(0, Math.min(height - testSize, bestMatch.y + dy));
          const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, { x: testX, y: testY, size: testSize });
          const weightedScore = score * (bestMatch.layout.prior || 1.0);

          if (weightedScore > refinedScore) {
            refinedScore = weightedScore;
            refinedX = testX;
            refinedY = testY;
            refinedSize = testSize;
          }
        }
      }
    }

    const calculatedScale = Math.round((refinedSize / veoBase.size) * 100) / 100;

    return {
      matchFound: refinedScore >= 0.08,
      score: Math.min(1.0, refinedScore),
      name: `${bestMatch.layout.name} (${refinedSize}px)`,
      offsetX: refinedX - baseX,
      offsetY: refinedY - baseY,
      sizeScale: Math.max(0.5, Math.min(2.5, calculatedScale)),
      gain: bestMatch.layout.gain || 0.6,
    };
  }

  const fallbackOffset = Math.round(-24 * (baseDim / 720));
  return {
    matchFound: false,
    score: bestScore > 0 ? bestScore : 0,
    presetKey: 'veo',
    name: 'Gemini Omni & Google Flow (Adaptive Inset)',
    offsetX: fallbackOffset,
    offsetY: fallbackOffset,
    sizeScale: 1.0,
    gain: 0.6,
  };
}

// ── Video Frame Quality Analysis & Seeker ──
function isFrameMeaningful(imageData) {
  const data = imageData.data;
  let sum = 0, sumSq = 0;
  const len = data.length;
  const step = Math.max(4, Math.floor(len / 2000) * 4);
  let samples = 0;
  for (let i = 0; i < len; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
    samples++;
  }
  if (samples === 0) return false;
  const mean = sum / samples;
  const variance = (sumSq / samples) - (mean * mean);
  return mean > 12 && mean < 245 && variance > 10;
}

function grabPreviewFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    let cleanedUp = false;
    const cleanup = () => {
      if (!cleanedUp) {
        cleanedUp = true;
        URL.revokeObjectURL(url);
        v.removeAttribute('src');
        v.load();
      }
    };

    const globalTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for video frame extraction.'));
    }, 10000);

    v.onerror = () => {
      clearTimeout(globalTimeout);
      cleanup();
      reject(new Error('Could not read this video file.'));
    };

    const onReady = async () => {
      v.onloadedmetadata = null;
      v.onloadeddata = null;

      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      const ratios = [0.35, 0.50, 0.20, 0.65, 0.10];
      const timestamps = ratios.map(r => Math.min(Math.max(duration * r, 0.05), Math.max(0.05, duration - 0.05)));

      let bestFrame = null;
      let highestVariance = -1;

      const w = v.videoWidth || 720;
      const h = v.videoHeight || 1280;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });

      const seekAndCapture = (time) => {
        return new Promise((res) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(seekTimer);
            v.removeEventListener('seeked', onSeeked);
            try {
              cx.drawImage(v, 0, 0, w, h);
              const imageData = cx.getImageData(0, 0, w, h);
              res(imageData);
            } catch {
              res(null);
            }
          };

          const onSeeked = () => {
            setTimeout(finish, 20);
          };

          const seekTimer = setTimeout(() => {
            finish();
          }, 1200);

          v.addEventListener('seeked', onSeeked, { once: true });
          try {
            if (Math.abs(v.currentTime - time) < 0.01) {
              finish();
            } else {
              v.currentTime = time;
            }
          } catch {
            finish();
          }
        });
      };

      for (const t of timestamps) {
        const imageData = await seekAndCapture(t);
        if (!imageData) continue;

        if (isFrameMeaningful(imageData)) {
          clearTimeout(globalTimeout);
          cleanup();
          resolve({ width: w, height: h, imageData });
          return;
        }

        const data = imageData.data;
        let sum = 0, sumSq = 0, samples = 0;
        const step = Math.max(4, Math.floor(data.length / 1000) * 4);
        for (let i = 0; i < data.length; i += step) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += lum;
          sumSq += lum * lum;
          samples++;
        }
        const mean = sum / (samples || 1);
        const variance = (sumSq / (samples || 1)) - (mean * mean);
        if (variance > highestVariance) {
          highestVariance = variance;
          bestFrame = imageData;
        }
      }

      clearTimeout(globalTimeout);
      cleanup();
      if (bestFrame) {
        resolve({ width: w, height: h, imageData: bestFrame });
      } else {
        reject(new Error('Could not extract a readable frame from this video.'));
      }
    };

    if (v.readyState >= 1) {
      onReady();
    } else {
      v.onloadedmetadata = onReady;
      v.onloadeddata = onReady;
    }
  });
}

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ── Bulk Video Queue Processor ──
class BulkVideoQueue {
  constructor(getVideoEngineFn, grabPreviewFrameFn) {
    this.getVideoEngine = getVideoEngineFn;
    this.grabPreviewFrame = grabPreviewFrameFn;
    this.queue = [];
    this.isProcessing = false;
    this.isPaused = false;
    this.currentProcessingId = null;

    this.containerSingle = document.getElementById('video-single-container');
    this.containerBulk = document.getElementById('video-bulk-container');
    this.dropzoneBulk = document.getElementById('bulk-video-dropzone');
    this.inputBulk = document.getElementById('bulk-video-input');
    this.wrapperQueue = document.getElementById('bulk-queue-wrapper');
    this.listQueue = document.getElementById('bulk-queue-list');

    this.elTotal = document.getElementById('bulk-count-total');
    this.elCompleted = document.getElementById('bulk-count-completed');
    this.elProcessing = document.getElementById('bulk-count-processing');
    this.elQueued = document.getElementById('bulk-count-queued');

    this.elOverallProgressContainer = document.getElementById('bulk-overall-progress-container');
    this.elOverallProgressBar = document.getElementById('bulk-overall-progress-bar');
    this.elOverallStatusText = document.getElementById('bulk-overall-status-text');
    this.elOverallPercentText = document.getElementById('bulk-overall-percent-text');

    this.btnStart = document.getElementById('btn-bulk-start');
    this.btnPause = document.getElementById('btn-bulk-pause');
    this.btnDownloadAll = document.getElementById('btn-bulk-download-all');
    this.btnClear = document.getElementById('btn-bulk-clear');
    this.btnAddMore = document.getElementById('btn-bulk-add-more');

    this.initEvents();
  }

  initEvents() {
    if (this.dropzoneBulk) {
      this.dropzoneBulk.onclick = () => {
        if (this.inputBulk) this.inputBulk.click();
      };

      this.dropzoneBulk.ondragover = (e) => {
        e.preventDefault();
        this.dropzoneBulk.classList.add('drag-over');
      };

      this.dropzoneBulk.ondragleave = () => {
        this.dropzoneBulk.classList.remove('drag-over');
      };

      this.dropzoneBulk.ondrop = (e) => {
        e.preventDefault();
        this.dropzoneBulk.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
          this.addFiles(e.dataTransfer.files);
        }
      };
    }

    if (this.inputBulk) {
      this.inputBulk.onchange = (e) => {
        if (e.target.files.length) {
          this.addFiles(e.target.files);
        }
        this.inputBulk.value = '';
      };
    }

    this.btnStart?.addEventListener('click', () => this.start());
    this.btnPause?.addEventListener('click', () => this.pause());
    this.btnDownloadAll?.addEventListener('click', () => this.downloadAll());
    this.btnClear?.addEventListener('click', () => this.clear());
    this.btnAddMore?.addEventListener('click', () => {
      if (this.inputBulk) this.inputBulk.click();
    });
  }

  addFiles(fileList) {
    const validFiles = Array.from(fileList).filter(f => f.type.startsWith('video/'));
    if (!validFiles.length) return;

    for (const file of validFiles) {
      const id = 'vid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      this.queue.push({
        id,
        file,
        name: file.name,
        size: file.size,
        formattedSize: formatBytes(file.size),
        status: 'queued',
        progress: 0,
        settings: { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1 },
        detectedName: 'Gemini Omni & Flow (Adaptive)',
        result: null,
        errorMsg: ''
      });
    }

    if (this.wrapperQueue) this.wrapperQueue.classList.remove('hidden');
    this.render();
    this.updateStats();
  }

  async start() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.isPaused = false;
    this.updateStats();

    let videoEngine;
    try {
      videoEngine = await this.getVideoEngine();
    } catch (e) {
      alert('Could not initialize video processing engine: ' + e.message);
      this.isProcessing = false;
      this.updateStats();
      return;
    }

    while (this.isProcessing && !this.isPaused) {
      const nextItem = this.queue.find(item => item.status === 'queued');
      if (!nextItem) break;

      this.currentProcessingId = nextItem.id;
      nextItem.status = 'processing';
      nextItem.progress = 0;
      this.renderItem(nextItem.id);
      this.updateStats();

      try {
        if (!nextItem.detected) {
          try {
            const previewFrame = await this.grabPreviewFrame(nextItem.file);
            const detected = detectVideoWatermarkCandidate(
              previewFrame.imageData,
              previewFrame.width,
              previewFrame.height,
              videoEngine.sparkleImage
            );
            if (detected) {
              nextItem.settings = {
                gain: detected.gain,
                offsetX: detected.offsetX,
                offsetY: detected.offsetY,
                sizeScale: detected.sizeScale
              };
              nextItem.detectedName = detected.name;
              nextItem.detected = true;
            }
          } catch (detErr) {
            console.warn(`Watermark detection skipped for ${nextItem.name}:`, detErr);
          }
        }

        const res = await videoEngine.process(nextItem.file, {
          ...nextItem.settings,
          onProgress: ({ progress }) => {
            nextItem.progress = Math.round(progress * 100);
            this.renderItemProgress(nextItem.id);
            this.updateStats();
          }
        });

        nextItem.status = 'completed';
        nextItem.progress = 100;
        nextItem.result = res;
      } catch (err) {
        console.error(`Bulk processing failed for ${nextItem.name}:`, err);
        nextItem.status = 'error';
        nextItem.errorMsg = err.message || 'Video processing failed';
      }

      this.renderItem(nextItem.id);
      this.updateStats();
    }

    this.isProcessing = false;
    this.currentProcessingId = null;
    this.updateStats();
  }

  pause() {
    this.isPaused = true;
    this.isProcessing = false;
    this.updateStats();
  }

  removeItem(id) {
    const idx = this.queue.findIndex(i => i.id === id);
    if (idx !== -1) {
      const item = this.queue[idx];
      if (item.result && item.result.url) {
        URL.revokeObjectURL(item.result.url);
      }
      this.queue.splice(idx, 1);
      if (this.queue.length === 0 && this.wrapperQueue) {
        this.wrapperQueue.classList.add('hidden');
      }
      this.render();
      this.updateStats();
    }
  }

  clear() {
    this.pause();
    for (const item of this.queue) {
      if (item.result && item.result.url) {
        URL.revokeObjectURL(item.result.url);
      }
    }
    this.queue = [];
    if (this.wrapperQueue) this.wrapperQueue.classList.add('hidden');
    this.render();
    this.updateStats();
  }

  downloadAll() {
    const completedItems = this.queue.filter(i => i.status === 'completed' && i.result?.url);
    if (!completedItems.length) return;

    completedItems.forEach((item, index) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = item.result.url;
        a.download = `clean_${item.name.replace(/\.[^/.]+$/, '')}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 400);
    });
  }

  updateStats() {
    const total = this.queue.length;
    const completed = this.queue.filter(i => i.status === 'completed').length;
    const processing = this.queue.filter(i => i.status === 'processing').length;
    const queued = this.queue.filter(i => i.status === 'queued').length;

    if (this.elTotal) this.elTotal.textContent = total;
    if (this.elCompleted) this.elCompleted.textContent = completed;
    if (this.elProcessing) this.elProcessing.textContent = processing;
    if (this.elQueued) this.elQueued.textContent = queued;

    if (this.btnStart && this.btnPause) {
      if (this.isProcessing) {
        this.btnStart.classList.add('hidden');
        this.btnPause.classList.remove('hidden');
      } else {
        this.btnStart.classList.remove('hidden');
        this.btnPause.classList.add('hidden');
        this.btnStart.disabled = queued === 0;
      }
    }

    if (this.btnDownloadAll) {
      if (completed > 0) {
        this.btnDownloadAll.classList.remove('hidden');
      } else {
        this.btnDownloadAll.classList.add('hidden');
      }
    }

    if (this.elOverallProgressContainer) {
      if (this.isProcessing || completed > 0) {
        this.elOverallProgressContainer.classList.remove('hidden');
        let overallPct = 0;
        if (total > 0) {
          const sumProgress = this.queue.reduce((acc, item) => {
            if (item.status === 'completed') return acc + 100;
            if (item.status === 'processing') return acc + item.progress;
            return acc;
          }, 0);
          overallPct = Math.round(sumProgress / total);
        }
        if (this.elOverallProgressBar) this.elOverallProgressBar.style.width = `${overallPct}%`;
        if (this.elOverallPercentText) this.elOverallPercentText.textContent = `${overallPct}%`;
        if (this.elOverallStatusText) {
          if (completed === total && total > 0) {
            this.elOverallStatusText.textContent = '🎉 All Videos Processed Successfully!';
          } else if (this.isProcessing) {
            this.elOverallStatusText.textContent = `Processing Video (${completed + 1} of ${total})...`;
          } else {
            this.elOverallStatusText.textContent = 'Batch Paused';
          }
        }
      } else {
        this.elOverallProgressContainer.classList.add('hidden');
      }
    }
  }

  renderItemProgress(id) {
    const item = this.queue.find(i => i.id === id);
    if (!item) return;
    const itemEl = document.getElementById(`bulk-item-${id}`);
    if (!itemEl) return;

    const barEl = itemEl.querySelector('.bulk-item-progress-bar-fill');
    const textEl = itemEl.querySelector('.bulk-item-progress-text');
    if (barEl) barEl.style.width = `${item.progress}%`;
    if (textEl) textEl.textContent = `${item.progress}%`;
  }

  renderItem(id) {
    const item = this.queue.find(i => i.id === id);
    if (!item) return;

    const oldEl = document.getElementById(`bulk-item-${id}`);
    const newHtml = this.getItemHtml(item);
    if (oldEl) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = newHtml;
      const newChild = tempDiv.firstElementChild;
      oldEl.replaceWith(newChild);
      this.bindItemEvents(newChild, item);
    } else if (this.listQueue) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = newHtml;
      const newChild = tempDiv.firstElementChild;
      this.listQueue.appendChild(newChild);
      this.bindItemEvents(newChild, item);
    }
  }

  render() {
    if (!this.listQueue) return;
    this.listQueue.innerHTML = this.queue.map(item => this.getItemHtml(item)).join('');
    this.queue.forEach(item => {
      const itemEl = document.getElementById(`bulk-item-${item.id}`);
      if (itemEl) this.bindItemEvents(itemEl, item);
    });
  }

  getItemHtml(item) {
    let badgeClass = 'badge-queued';
    let badgeText = 'Queued';

    if (item.status === 'processing') {
      badgeClass = 'badge-processing';
      badgeText = `Processing (${item.progress}%)`;
    } else if (item.status === 'completed') {
      badgeClass = 'badge-completed';
      badgeText = 'Completed';
    } else if (item.status === 'error') {
      badgeClass = 'badge-error';
      badgeText = 'Failed';
    }

    return `
      <div id="bulk-item-${item.id}" class="bulk-item-card status-${item.status}">
        <div class="bulk-item-main">
          <div class="bulk-item-icon">
            <iconify-icon icon="${item.status === 'completed' ? 'ph:check-circle-fill' : 'ph:video-camera-bold'}" width="24"></iconify-icon>
          </div>
          <div class="bulk-item-info">
            <div class="bulk-item-title-row">
              <span class="bulk-item-name" title="${item.name}">${item.name}</span>
              <span class="bulk-item-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="bulk-item-meta">
              <span>${item.formattedSize}</span> • 
              <span class="text-indigo-600">${item.detectedName || 'Gemini Preset'}</span>
            </div>

            ${item.status === 'processing' ? `
              <div class="bulk-item-progress-box mt-2">
                <div class="progress-bar-container mini">
                  <div class="progress-bar-fill bulk-item-progress-bar-fill" style="width: ${item.progress}%"></div>
                </div>
                <span class="bulk-item-progress-text text-xs mt-1">${item.progress}%</span>
              </div>
            ` : ''}

            ${item.status === 'error' ? `
              <p class="bulk-item-error-msg mt-1 text-xs text-red-600">${item.errorMsg}</p>
            ` : ''}
          </div>
        </div>

        <div class="bulk-item-actions">
          ${item.status === 'completed' && item.result?.url ? `
            <a href="${item.result.url}" download="clean_${item.name.replace(/\.[^/.]+$/, '')}.mp4" class="btn btn-primary btn-sm">
              <iconify-icon icon="ph:download-simple-bold" width="14"></iconify-icon>
              <span>Download MP4</span>
            </a>
          ` : ''}

          <button type="button" class="btn-remove-item" data-id="${item.id}" title="Remove from queue">
            <iconify-icon icon="ph:x-bold" width="16"></iconify-icon>
          </button>
        </div>
      </div>
    `;
  }

  bindItemEvents(itemEl, item) {
    const btnRemove = itemEl.querySelector('.btn-remove-item');
    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeItem(item.id);
      });
    }
  }
}

// ── Expose globals to window ──
window.VIDEO_DEFAULTS = VIDEO_DEFAULTS;
window.VIDEO_PRESETS = VIDEO_PRESETS;
window.getAdaptiveVideoPreset = getAdaptiveVideoPreset;
window.VideoWatermarkEngine = VideoWatermarkEngine;
window.detectVideoWatermarkCandidate = detectVideoWatermarkCandidate;
window.isFrameMeaningful = isFrameMeaningful;
window.grabPreviewFrame = grabPreviewFrame;
window.formatBytes = formatBytes;
window.BulkVideoQueue = BulkVideoQueue;
