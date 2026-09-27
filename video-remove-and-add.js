// ── Video Remove & Add Watermark (Dual Action Single-Pass Engine) ──
// Combines mathematical Gemini watermark removal and custom watermark/logo injection
// in a SINGLE video render pass to eliminate generational compression artifacts and maximize quality.

const COMBO_REMOVAL_DEFAULTS = { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1.0 };

const COMBO_REMOVAL_PRESETS = {
  veo: { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1.0 },
  corner: { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1.0 },
  sparkle: { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1.0 }
};

function getComboAdaptivePreset(presetKey, width = 720, height = 720) {
  if (typeof getAdaptiveVideoPreset === 'function') {
    return getAdaptiveVideoPreset(presetKey, width, height);
  }
  if (presetKey === 'corner') return { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1.0 };
  if (presetKey === 'sparkle') return { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1.0 };
  const minDim = Math.min(width, height || width);
  const scaleRatio = Math.max(0.3, Math.min(1.5, minDim / 720));
  const adaptiveOffset = Math.round(-24 * scaleRatio);
  return { gain: 0.6, offsetX: adaptiveOffset, offsetY: adaptiveOffset, sizeScale: 1.0 };
}

// Ensure custom or Google font is loaded for canvas rendering
async function ensureComboFontLoaded(fontFamily, weight = '700') {
  if (typeof ensureFontLoaded === 'function') {
    return ensureFontLoaded(fontFamily, weight);
  }
  if (!fontFamily) return 'Ubuntu, sans-serif';
  let primaryName = fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  if (!primaryName) return 'Ubuntu';

  try {
    let fam = primaryName;
    let linkUrl = '';
    if (primaryName.includes('<link') && primaryName.includes('href=')) {
      const match = primaryName.match(/href=["']([^"']+)["']/i);
      if (match && match[1]) primaryName = match[1];
    }
    if (primaryName.startsWith('http://') || primaryName.startsWith('https://')) {
      try {
        const u = new URL(primaryName);
        const famParam = u.searchParams.get('family');
        if (famParam) fam = famParam.split(':')[0].replace(/\+/g, ' ');
      } catch (err) { }
      linkUrl = primaryName;
    } else {
      fam = primaryName;
      linkUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam.replace(/ /g, '+'))}:wght@300;400;500;600;700;800;900&display=swap`;
    }

    if (!document.querySelector(`link[data-font="${fam}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.setAttribute('data-font', fam);
      link.href = linkUrl;
      document.head.appendChild(link);
    }

    if (document.fonts && typeof document.fonts.load === 'function') {
      try {
        await Promise.race([
          Promise.all([
            document.fonts.load(`${weight} 42px "${fam}"`),
            document.fonts.load(`bold 42px "${fam}"`)
          ]),
          new Promise(r => setTimeout(r, 2000))
        ]);
        await document.fonts.ready;
      } catch (err) { }
    }
    return fam;
  } catch (e) {
    return primaryName;
  }
}

// ── Single-Pass Combined Processing Engine ──
class VideoRemoveAndAddEngine {
  constructor(imageEngine, adderEngine) {
    this.imageEngine = imageEngine;
    this.adderEngine = adderEngine || new VideoWatermarkAdderEngine();
    this._mb = null;
  }

  static async create() {
    const imageEngine = await WatermarkEngine.create();
    const adderEngine = new VideoWatermarkAdderEngine();
    return new VideoRemoveAndAddEngine(imageEngine, adderEngine);
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

  // Preview clean for zoomed preview canvas
  previewClean(fullImageData, width, height, opts = {}) {
    const base = this.getVeoWatermark(width, height);
    return cleanFrame(this.imageEngine.bg96, fullImageData, width, height, base, {
      ...opts,
      gain: opts.gain ?? COMBO_REMOVAL_DEFAULTS.gain,
    });
  }

  /**
   * Process video in ONE single pass:
   * 1. Decode video frames once
   * 2. Unblend Gemini watermark pixels mathematically
   * 3. Draw custom watermark (text or logo) directly onto the cleaned frame
   * 4. Encode directly into output MP4 with 100% audio passthrough
   */
  async process(file, removalConfig, adderConfig, logoImg = null, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    const gain = removalConfig.gain ?? COMBO_REMOVAL_DEFAULTS.gain;

    const mb = await this._lib();
    const {
      ALL_FORMATS, BlobSource, BufferTarget, CanvasSource,
      EncodedAudioPacketSource, EncodedPacketSink, Input,
      Mp4OutputFormat, Output, QUALITY_HIGH, VideoSampleSink, canEncodeVideo,
    } = mb;

    if (canEncodeVideo && !(await canEncodeVideo('avc'))) {
      throw new Error('Your browser cannot encode H.264 video locally. Please try Chrome, Edge, or Firefox desktop.');
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

    // Precalculate removal ROI and Alpha Map for Gemini unblending
    const base = removalConfig.mode === 'gemini'
      ? getWatermarkInfo(width, height)
      : this.getVeoWatermark(width, height);
    const wm = resolveBox(base, width, height, removalConfig);
    const roi = getRoi(width, height, wm);
    const alpha = buildAlpha(this.imageEngine.bg96, roi, wm, gain);
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

    // Audio Passthrough for 100% lossless audio preservation
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

      // 1. Draw raw source frame
      sample.draw(ctx, 0, 0, width, height);
      sample.close();

      // 2. Action A: Remove Gemini watermark mathematically via unblending
      if (removalConfig.enabled !== false) {
        const px = ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
        removeWatermark(px, alpha, region);
        const bmp = await createImageBitmap(px);
        ctx.drawImage(bmp, roi.x, roi.y);
        bmp.close();
      }

      // 3. Action B: Add custom watermark overlay in the exact same render cycle
      if (adderConfig && adderConfig.enabled !== false) {
        this.adderEngine.drawWatermark(ctx, width, height, adderConfig, logoImg);
      }

      // 4. Encode frame into output video stream
      await videoSource.add(timestamp, dur);
      if (duration) onProgress({ progress: Math.min(0.99, timestamp / duration) });
    }
    videoSource.close();

    // Stream original audio packets without re-encoding
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
        console.warn('Audio passthrough failed:', e);
      } finally {
        audioSource.close();
      }
    }

    await output.finalize();
    input.dispose?.();

    if (!target.buffer) {
      URL.revokeObjectURL(originalUrl);
      throw new Error('Video processing produced no output.');
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

// ── Bulk Video Remove & Add Queue Processor ──
class BulkVideoRemoveAndAddQueue {
  constructor(getEngineFn, grabFrameFn, loadPreviewFn) {
    this.getEngine = getEngineFn;
    this.grabFrame = grabFrameFn;
    this.loadPreview = loadPreviewFn;
    this.queue = [];
    this.isProcessing = false;
    this.isPaused = false;
    this.currentProcessingId = null;
    this.activePreviewId = null;
    this.onPreviewItem = null;
    this.onFilesAdded = null;
    this.strategy = 'auto'; // 'auto' or 'manual'

    // Configuration references
    this.removalSettings = { ...COMBO_REMOVAL_DEFAULTS };
    this.adderSettings = {
      type: 'text',
      text: '© My Brand',
      fontSize: 42,
      fontFamily: 'Ubuntu, sans-serif',
      fontWeight: '700',
      color: '#ffffff',
      outline: true,
      strokeColor: 'rgba(0, 0, 0, 0.75)',
      opacity: 0.85,
      anchor: 'bottom-right',
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      scale: 1.0,
      enabled: true
    };
    this.logoImg = null;

    // DOM bindings
    this.dropzoneBulk = document.getElementById('bulk-combo-dropzone');
    this.inputBulk = document.getElementById('bulk-combo-input');
    this.wrapperQueue = document.getElementById('bulk-combo-queue-wrapper');
    this.listQueue = document.getElementById('bulk-combo-queue-list');

    this.elTotal = document.getElementById('bulk-combo-count-total');
    this.elCompleted = document.getElementById('bulk-combo-count-completed');
    this.elProcessing = document.getElementById('bulk-combo-count-processing');
    this.elQueued = document.getElementById('bulk-combo-count-queued');

    this.elOverallProgressContainer = document.getElementById('bulk-combo-overall-progress-container');
    this.elOverallProgressBar = document.getElementById('bulk-combo-overall-progress-bar');
    this.elOverallStatusText = document.getElementById('bulk-combo-overall-status-text');
    this.elOverallPercentText = document.getElementById('bulk-combo-overall-percent-text');

    this.btnStart = document.getElementById('btn-bulk-combo-start');
    this.btnPause = document.getElementById('btn-bulk-combo-pause');
    this.btnDownloadAll = document.getElementById('btn-bulk-combo-download-all');
    this.btnClear = document.getElementById('btn-bulk-combo-clear');
    this.btnAddMore = document.getElementById('btn-bulk-combo-add-more');

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
        if (e.dataTransfer && e.dataTransfer.files) {
          this.addFiles(e.dataTransfer.files);
        }
      };
    }

    if (this.inputBulk) {
      this.inputBulk.onchange = (e) => {
        if (e.target.files) {
          this.addFiles(e.target.files);
        }
        this.inputBulk.value = '';
      };
    }

    this.btnStart?.addEventListener('click', () => this.start());
    this.btnPause?.addEventListener('click', () => this.togglePause());
    this.btnDownloadAll?.addEventListener('click', () => this.downloadAll());
    this.btnClear?.addEventListener('click', () => this.clear());
    this.btnAddMore?.addEventListener('click', () => {
      if (this.inputBulk) this.inputBulk.click();
    });
  }

  setRemovalSettings(settings) {
    this.removalSettings = { ...this.removalSettings, ...settings };
  }

  setAdderSettings(settings) {
    this.adderSettings = { ...this.adderSettings, ...settings };
  }

  setLogoImage(img) {
    this.logoImg = img;
  }

  setStrategy(strategy) {
    this.strategy = strategy;
  }

  addFiles(fileList) {
    const videoFiles = Array.from(fileList).filter(f => f.type.startsWith('video/'));
    if (!videoFiles.length) return;

    const wasEmpty = this.queue.length === 0;

    for (const f of videoFiles) {
      const id = 'combo_' + Math.random().toString(36).substring(2, 9);
      this.queue.push({
        id,
        file: f,
        name: f.name,
        size: f.size,
        status: 'queued', // 'queued' | 'processing' | 'completed' | 'error'
        progress: 0,
        result: null,
        errorMsg: null,
        detected: null
      });
    }

    if (!this.activePreviewId && this.queue.length > 0) {
      this.activePreviewId = this.queue[0].id;
    }

    this.updateStats();
    this.renderQueueList();
    this.wrapperQueue?.classList.remove('hidden');

    if (typeof this.onFilesAdded === 'function') {
      this.onFilesAdded(this.queue, wasEmpty);
    } else if (wasEmpty && typeof this.loadPreview === 'function' && videoFiles[0]) {
      this.loadPreview(videoFiles[0]);
    }
  }

  async start() {
    if (this.isProcessing) return;

    if (this.adderSettings.type === 'text' && !this.adderSettings.text.trim()) {
      alert('Please enter custom watermark text before starting bulk processing.');
      return;
    }
    if (this.adderSettings.type === 'image' && !this.logoImg) {
      alert('Please upload a watermark logo image before starting bulk processing.');
      return;
    }

    if (this.adderSettings.type === 'text') {
      try {
        await ensureComboFontLoaded(this.adderSettings.fontFamily, this.adderSettings.fontWeight);
      } catch (e) { }
    }

    this.isProcessing = true;
    this.isPaused = false;
    this.updateControls();

    while (this.isProcessing) {
      if (this.isPaused) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      const nextItem = this.queue.find(i => i.status === 'queued');
      if (!nextItem) break;

      this.currentProcessingId = nextItem.id;
      nextItem.status = 'processing';
      nextItem.progress = 0;
      this.updateItemUI(nextItem.id);
      this.updateStats();

      try {
        const engine = await this.getEngine();

        // Removal settings determination
        let itemRemovalConfig = { ...this.removalSettings };
        if (this.strategy === 'auto') {
          try {
            const frameInfo = await this.grabFrame(nextItem.file);
            if (frameInfo && typeof detectVideoWatermarkCandidate === 'function') {
              const detected = detectVideoWatermarkCandidate(frameInfo.imageData, frameInfo.width, frameInfo.height, engine.imageEngine.bg96);
              if (detected) {
                itemRemovalConfig = {
                  gain: detected.gain,
                  offsetX: detected.offsetX,
                  offsetY: detected.offsetY,
                  sizeScale: detected.sizeScale
                };
              }
            }
          } catch (e) {
            console.warn('Auto-detect fallback to default:', e);
          }
        }

        const res = await engine.process(
          nextItem.file,
          itemRemovalConfig,
          this.adderSettings,
          this.logoImg,
          {
            onProgress: ({ progress }) => {
              nextItem.progress = Math.round(progress * 100);
              this.updateItemProgress(nextItem.id, nextItem.progress);
              this.updateOverallProgress();
            }
          }
        );

        nextItem.status = 'completed';
        nextItem.progress = 100;
        nextItem.result = res;
      } catch (err) {
        console.error(`Bulk remove & add failed for ${nextItem.name}:`, err);
        nextItem.status = 'error';
        nextItem.errorMsg = err.message || 'Processing failed';
      }

      this.updateItemUI(nextItem.id);
      this.updateStats();
      this.updateOverallProgress();
    }

    this.isProcessing = false;
    this.currentProcessingId = null;
    this.updateControls();
    this.updateOverallProgress();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    if (this.btnPause) {
      this.btnPause.innerHTML = this.isPaused
        ? '<iconify-icon icon="ph:play-fill" width="16"></iconify-icon><span>Resume Processing</span>'
        : '<iconify-icon icon="ph:pause-fill" width="16"></iconify-icon><span>Pause Processing</span>';
    }
    if (this.elOverallStatusText) {
      this.elOverallStatusText.textContent = this.isPaused ? 'Processing Paused' : 'Batch Processing Active...';
    }
  }

  downloadAll() {
    const completedItems = this.queue.filter(i => i.status === 'completed' && i.result?.url);
    if (!completedItems.length) return;

    completedItems.forEach((item, index) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = item.result.url;
        a.download = `watermarked_${item.name.replace(/\.[^/.]+$/, '')}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 400);
    });
  }

  clear() {
    if (this.isProcessing && !confirm('Processing is running. Are you sure you want to cancel and clear the queue?')) {
      return;
    }
    this.isProcessing = false;
    this.isPaused = false;
    this.queue = [];
    this.activePreviewId = null;
    this.renderQueueList();
    this.updateStats();
    this.updateControls();
    this.wrapperQueue?.classList.add('hidden');
    if (typeof this.onClearQueue === 'function') {
      this.onClearQueue();
    }
  }

  removeItem(id) {
    const idx = this.queue.findIndex(i => i.id === id);
    if (idx !== -1) {
      if (this.queue[idx].status === 'processing') {
        alert('Cannot remove an item while it is actively processing.');
        return;
      }
      const wasPreviewing = this.activePreviewId === id;
      this.queue.splice(idx, 1);
      if (wasPreviewing) {
        this.activePreviewId = this.queue[0]?.id || null;
        if (this.queue[0] && typeof this.onPreviewItem === 'function') {
          this.onPreviewItem(this.queue[0]);
        }
      }
      this.renderQueueList();
      this.updateStats();
    }
  }

  updateControls() {
    if (this.btnStart) {
      if (this.isProcessing) {
        this.btnStart.classList.add('hidden');
        this.btnPause?.classList.remove('hidden');
      } else {
        this.btnStart.classList.remove('hidden');
        this.btnPause?.classList.add('hidden');
      }
    }

    const completed = this.queue.filter(i => i.status === 'completed').length;
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
      } else {
        this.elOverallProgressContainer.classList.add('hidden');
      }
    }
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

    this.updateControls();
  }

  updateOverallProgress() {
    const total = this.queue.length;
    if (!total) return;

    let totalPercentSum = 0;
    for (const item of this.queue) {
      if (item.status === 'completed') totalPercentSum += 100;
      else if (item.status === 'processing') totalPercentSum += item.progress;
    }

    const overallPct = Math.min(100, Math.round(totalPercentSum / total));
    if (this.elOverallProgressBar) this.elOverallProgressBar.style.width = `${overallPct}%`;
    if (this.elOverallPercentText) this.elOverallPercentText.textContent = `${overallPct}%`;

    if (this.elOverallStatusText) {
      if (overallPct === 100) {
        this.elOverallStatusText.textContent = 'All Videos Successfully Processed!';
      } else if (this.isPaused) {
        this.elOverallStatusText.textContent = 'Batch Processing Paused';
      } else if (this.isProcessing) {
        this.elOverallStatusText.textContent = 'Batch Processing Active...';
      }
    }
  }

  updateItemProgress(id, pct) {
    const itemEl = document.getElementById(`bulk-combo-item-${id}`);
    if (!itemEl) return;
    const barEl = itemEl.querySelector('.bulk-item-progress-bar-fill');
    const textEl = itemEl.querySelector('.bulk-item-progress-text');
    if (barEl) barEl.style.width = `${pct}%`;
    if (textEl) textEl.textContent = `${pct}%`;
  }

  updateItemUI(id) {
    const item = this.queue.find(i => i.id === id);
    if (!item) return;

    const oldEl = document.getElementById(`bulk-combo-item-${id}`);
    if (!oldEl) {
      this.renderQueueList();
      return;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.renderItemHtml(item);
    const newEl = tempDiv.firstElementChild;
    oldEl.replaceWith(newEl);
    this.bindItemEvents(newEl, item);
  }

  renderQueueList() {
    if (!this.listQueue) return;
    this.listQueue.innerHTML = '';
    this.queue.forEach(item => {
      const div = document.createElement('div');
      div.innerHTML = this.renderItemHtml(item);
      const itemEl = div.firstElementChild;
      this.listQueue.appendChild(itemEl);
      this.bindItemEvents(itemEl, item);
    });
  }

  renderItemHtml(item) {
    let badgeClass = 'badge-queued';
    let badgeText = 'Queued';

    if (item.status === 'processing') {
      badgeClass = 'badge-processing';
      badgeText = 'Processing...';
    } else if (item.status === 'completed') {
      badgeClass = 'badge-completed';
      badgeText = 'Completed';
    } else if (item.status === 'error') {
      badgeClass = 'badge-error';
      badgeText = 'Failed';
    }

    const sizeStr = typeof formatBytes === 'function' ? formatBytes(item.size) : `${(item.size / (1024 * 1024)).toFixed(1)} MB`;
    const isPreviewing = item.id === this.activePreviewId;

    return `
      <div id="bulk-combo-item-${item.id}" class="bulk-item-card status-${item.status}${isPreviewing ? ' is-previewing' : ''}" title="Click to preview on Live Stage">
        <div class="bulk-item-main">
          <div class="bulk-item-icon">
            <iconify-icon icon="ph:video-camera-bold" width="24"></iconify-icon>
          </div>
          <div class="bulk-item-info">
            <div class="bulk-item-title-row">
              <span class="bulk-item-name" title="${item.name}">${item.name}</span>
              <span class="bulk-item-badge ${badgeClass}">${badgeText}</span>
              ${isPreviewing ? `
                <span class="bulk-item-preview-badge">
                  <iconify-icon icon="ph:eye-bold" width="12"></iconify-icon> Previewing
                </span>
              ` : ''}
            </div>
            <div class="bulk-item-meta">
              <span>${sizeStr}</span>
              <span>•</span>
              <span>1-Pass Clean &amp; Watermark</span>
              <span class="text-xs text-indigo-500 font-medium ml-2 flex items-center gap-0.5">
                <iconify-icon icon="ph:cursor-click"></iconify-icon> Click to preview
              </span>
            </div>

            ${item.status === 'processing' ? `
              <div class="bulk-item-progress-box mt-2">
                <div class="progress-bar-container">
                  <div class="progress-bar-fill bulk-item-progress-bar-fill" style="width: ${item.progress}%"></div>
                </div>
                <span class="bulk-item-progress-text text-xs mt-1">${item.progress}%</span>
              </div>
            ` : ''}

            ${item.status === 'error' && item.errorMsg ? `
              <p class="bulk-item-error-msg mt-1 text-xs text-red-600">${item.errorMsg}</p>
            ` : ''}
          </div>
        </div>

        <div class="bulk-item-actions">
          ${item.status === 'completed' && item.result?.url ? `
            <a href="${item.result.url}" download="watermarked_${item.name.replace(/\.[^/.]+$/, '')}.mp4" class="btn btn-primary btn-sm">
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

  updatePreviewHighlights() {
    if (!this.listQueue) return;
    this.listQueue.querySelectorAll('.bulk-item-card').forEach(card => {
      const id = card.id.replace('bulk-combo-item-', '');
      const isMatch = id === this.activePreviewId;
      card.classList.toggle('is-previewing', isMatch);
      const titleRow = card.querySelector('.bulk-item-title-row');
      const existingBadge = titleRow ? titleRow.querySelector('.bulk-item-preview-badge') : null;
      if (isMatch && !existingBadge && titleRow) {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'bulk-item-preview-badge';
        badgeSpan.innerHTML = '<iconify-icon icon="ph:eye-bold" width="12"></iconify-icon> Previewing';
        titleRow.appendChild(badgeSpan);
      } else if (!isMatch && existingBadge) {
        existingBadge.remove();
      }
    });
  }

  bindItemEvents(itemEl, item) {
    const btnRemove = itemEl.querySelector('.btn-remove-item');
    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeItem(item.id);
      });
    }

    itemEl.addEventListener('click', (e) => {
      if (e.target.closest('a, button, .btn-remove-item')) return;
      if (this.activePreviewId === item.id) return;
      this.activePreviewId = item.id;
      this.updatePreviewHighlights();
      if (typeof this.onPreviewItem === 'function') {
        this.onPreviewItem(item);
      }
    });
  }
}

// ── UI Controller for Remove & Add Tab ──
function initVideoRemoveAndAdd() {
  const panel = document.getElementById('panel-remove-add');
  if (!panel) return;

  // Mode switcher elements
  const btnModeSingle = document.getElementById('btn-combo-mode-single');
  const btnModeBulk = document.getElementById('btn-combo-mode-bulk');
  const containerSingle = document.getElementById('combo-single-container');
  const containerBulk = document.getElementById('combo-bulk-container');
  const queueWrapper = document.getElementById('bulk-combo-queue-wrapper');

  // Single mode dropzone & inputs
  const dropzone = document.getElementById('combo-video-dropzone');
  const fileInput = document.getElementById('combo-video-input');
  const statusContainer = document.getElementById('combo-status');
  const progressBar = document.getElementById('combo-progress-bar');
  const progressText = document.getElementById('combo-progress-text');
  const resultsArea = document.getElementById('combo-results');
  const tunerContainer = document.getElementById('combo-tuner-container');

  // Tuner canvas elements
  const mainCanvas = document.getElementById('combo-main-canvas');
  const zoomCanvas = document.getElementById('combo-zoom-canvas');
  const zoomCleanedCanvas = document.getElementById('combo-zoom-cleaned-canvas');
  const detectBadge = document.getElementById('combo-detect-badge');

  // Scrubber elements
  const frameScrubber = document.getElementById('slider-combo-frame-time');
  const lblFrameTime = document.getElementById('lbl-combo-frame-time');

  // Removal Controls
  const presetButtons = document.querySelectorAll('#panel-remove-add .btn-preset[data-removal-preset]');
  const sliderGain = document.getElementById('slider-combo-gain');
  const sliderScale = document.getElementById('slider-combo-scale');
  const sliderOffsetX = document.getElementById('slider-combo-offset-x');
  const sliderOffsetY = document.getElementById('slider-combo-offset-y');
  const lblGain = document.getElementById('lbl-combo-gain');
  const lblScale = document.getElementById('lbl-combo-scale');
  const lblOffsetX = document.getElementById('lbl-combo-offset-x');
  const lblOffsetY = document.getElementById('lbl-combo-offset-y');
  const btnResetSliders = document.getElementById('btn-combo-reset-sliders');

  // Watermark Adder Controls
  const btnTypeText = document.getElementById('btn-combo-type-text');
  const btnTypeImage = document.getElementById('btn-combo-type-image');
  const textControlsBox = document.getElementById('combo-text-controls');
  const imageControlsBox = document.getElementById('combo-image-controls');
  const textInput = document.getElementById('combo-text-input');
  const selectFontFamily = document.getElementById('combo-font-family');
  const selectFontWeight = document.getElementById('combo-font-weight');
  const colorPicker = document.getElementById('combo-text-color');
  const colorPresets = document.querySelectorAll('#panel-remove-add .color-preset-pill');
  const customFontBox = document.getElementById('combo-custom-font-box');
  const customFontInput = document.getElementById('combo-custom-font-input');
  const btnLoadCustomFont = document.getElementById('btn-combo-load-custom-font');
  const fontStatusMsg = document.getElementById('combo-font-status');
  const checkOutline = document.getElementById('combo-text-outline');
  const logoDropzone = document.getElementById('combo-logo-dropzone');
  const logoInput = document.getElementById('combo-logo-input');
  const logoThumb = document.getElementById('combo-logo-thumb');
  const anchorButtons = document.querySelectorAll('#panel-remove-add .btn-combo-anchor');

  const sliderAdderSize = document.getElementById('slider-combo-adder-size');
  const sliderAdderOpacity = document.getElementById('combo-adder-opacity');
  const sliderAdderOffsetX = document.getElementById('slider-combo-adder-offset-x');
  const sliderAdderOffsetY = document.getElementById('slider-combo-adder-offset-y');
  const sliderAdderRotation = document.getElementById('slider-combo-adder-rotation');
  const lblAdderSize = document.getElementById('lbl-combo-adder-size');
  const lblAdderOpacity = document.getElementById('lbl-combo-adder-opacity');
  const lblAdderOffsetX = document.getElementById('lbl-combo-adder-offset-x');
  const lblAdderOffsetY = document.getElementById('lbl-combo-adder-offset-y');
  const lblAdderRotation = document.getElementById('lbl-combo-adder-rotation');
  const btnExport = document.getElementById('btn-combo-export');

  // Workspace Layout & Sidebar Controls
  const workspaceLayout = document.querySelector('.combo-workspace-layout');
  const btnToggleSidebarLeft = document.getElementById('btn-toggle-sidebar-left');
  const btnToggleSidebarRight = document.getElementById('btn-toggle-sidebar-right');
  const railLeft = document.getElementById('combo-rail-left');
  const railRight = document.getElementById('combo-rail-right');
  const btnRailExpandLeft = document.getElementById('btn-rail-expand-left');
  const btnRailExpandRight = document.getElementById('btn-rail-expand-right');
  const btnCinema = document.getElementById('btn-combo-cinema');
  // Stage & Bulk Workspace Elements
  const stageCard = document.getElementById('combo-stage-card');
  const singleActionBox = document.getElementById('combo-single-action-box');
  const btnChangeVideo = document.getElementById('btn-combo-change-video');
  const bulkStrategyBox = document.getElementById('combo-bulk-strategy-box');
  const btnComboStrategyAuto = document.getElementById('btn-combo-strategy-auto');
  const btnComboStrategyManual = document.getElementById('btn-combo-strategy-manual');
  const comboBulkStrategyHint = document.getElementById('combo-bulk-strategy-hint');
  const bulkAdderBadge = document.getElementById('combo-bulk-adder-badge');
  const bulkDropzone = document.getElementById('bulk-combo-dropzone');
  const bulkInput = document.getElementById('bulk-combo-input');

  // Bulk strategy buttons in queue card
  const btnBulkStrategyAuto = document.getElementById('btn-bulk-combo-strategy-auto');
  const btnBulkStrategyManual = document.getElementById('btn-bulk-combo-strategy-manual');

  // State
  let comboEngine = null;
  let currentVideoFile = null;
  let currentVideoElement = null;
  let currentPreviewFrame = null;
  let currentLogoImg = null;
  let currentComboMode = 'single';
  let isProcessing = false;

  const removalConfig = {
    gain: 0.6,
    offsetX: -24,
    offsetY: -24,
    sizeScale: 1.0,
    mode: 'veo',
    enabled: true
  };

  const adderConfig = {
    type: 'text',
    text: '© My Brand',
    fontSize: 42,
    fontFamily: 'Ubuntu, sans-serif',
    fontWeight: '700',
    color: '#ffffff',
    outline: true,
    strokeColor: 'rgba(0, 0, 0, 0.75)',
    opacity: 0.85,
    anchor: 'bottom-right',
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    scale: 1.0,
    enabled: true
  };

  const getOrInitEngine = async () => {
    if (!comboEngine) {
      comboEngine = await VideoRemoveAndAddEngine.create();
    }
    return comboEngine;
  };

  // Initialize Bulk Queue instance with preview loader
  const bulkCombo = new BulkVideoRemoveAndAddQueue(
    getOrInitEngine,
    typeof grabPreviewFrame === 'function' ? grabPreviewFrame : null,
    (file) => handleVideoFile(file, true)
  );

  // Keep Bulk Queue synchronized with latest removal & adder configurations
  function syncBulkSettings() {
    if (!bulkCombo) return;
    bulkCombo.setRemovalSettings(removalConfig);
    bulkCombo.setAdderSettings(adderConfig);
    if (currentLogoImg) bulkCombo.setLogoImage(currentLogoImg);
  }

  // Helper: update all label texts
  function updateLabels() {
    if (lblGain && sliderGain) lblGain.textContent = `${parseFloat(sliderGain.value).toFixed(2)}x`;
    if (lblScale && sliderScale) lblScale.textContent = `${parseFloat(sliderScale.value).toFixed(2)}x`;
    if (lblOffsetX && sliderOffsetX) lblOffsetX.textContent = `${sliderOffsetX.value}px`;
    if (lblOffsetY && sliderOffsetY) lblOffsetY.textContent = `${sliderOffsetY.value}px`;

    if (lblAdderSize && sliderAdderSize) {
      lblAdderSize.textContent = adderConfig.type === 'image'
        ? `${parseFloat(sliderAdderSize.value).toFixed(2)}x`
        : `${sliderAdderSize.value}px`;
    }
    if (lblAdderOpacity && sliderAdderOpacity) {
      lblAdderOpacity.textContent = `${Math.round(parseFloat(sliderAdderOpacity.value) * 100)}%`;
    }
    if (lblAdderOffsetX && sliderAdderOffsetX) lblAdderOffsetX.textContent = `${sliderAdderOffsetX.value}px`;
    if (lblAdderOffsetY && sliderAdderOffsetY) lblAdderOffsetY.textContent = `${sliderAdderOffsetY.value}px`;
    if (lblAdderRotation && sliderAdderRotation) lblAdderRotation.textContent = `${sliderAdderRotation.value}°`;
  }

  function setDropzoneLoading(loading, message = 'Loading video frame...') {
    if (!dropzone) return;
    const titleEl = dropzone.querySelector('.dropzone-title');
    if (loading) {
      dropzone.classList.add('loading');
      if (titleEl) titleEl.textContent = message;
    } else {
      dropzone.classList.remove('loading');
      if (titleEl) titleEl.textContent = 'Upload or drag a video to remove Gemini watermark & add custom watermark simultaneously';
    }
  }

  // Render combined interactive preview (Watermark Removal + Custom Watermark Addition)
  async function renderPreview() {
    if (!currentPreviewFrame || !mainCanvas || !comboEngine) return;

    const sourceCanvas = currentPreviewFrame.canvas;
    const w = currentPreviewFrame.width;
    const h = currentPreviewFrame.height;

    const MAX_PREVIEW_W = 1280;
    const MAX_PREVIEW_H = 720;
    const aspect = w / h;
    let previewW = Math.min(w, MAX_PREVIEW_W);
    let previewH = Math.round(previewW / aspect);
    if (previewH > MAX_PREVIEW_H) {
      previewH = MAX_PREVIEW_H;
      previewW = Math.round(previewH * aspect);
    }

    mainCanvas.width = previewW;
    mainCanvas.height = previewH;
    const ctx = mainCanvas.getContext('2d');
    const displayScale = previewW / w;

    // 1. Draw source video frame to an offscreen full-res canvas to perform unblending
    const cleanOffscreen = document.createElement('canvas');
    cleanOffscreen.width = w;
    cleanOffscreen.height = h;
    const cctx = cleanOffscreen.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(sourceCanvas, 0, 0, w, h);

    // 2. Perform Gemini watermark removal
    const base = removalConfig.mode === 'gemini'
      ? getWatermarkInfo(w, h)
      : comboEngine.getVeoWatermark(w, h);
    const wm = resolveBox(base, w, h, removalConfig);
    const roi = getRoi(w, h, wm);
    const alpha = buildAlpha(comboEngine.imageEngine.bg96, roi, wm, removalConfig.gain);
    const region = { x: 0, y: 0, width: roi.width, height: roi.height };

    const px = cctx.getImageData(roi.x, roi.y, roi.width, roi.height);
    removeWatermark(px, alpha, region);
    cctx.putImageData(px, roi.x, roi.y);

    // 3. Render dual zoomed comparison (Original vs Cleaned)
    if (zoomCanvas && zoomCleanedCanvas) {
      const zctxOrig = zoomCanvas.getContext('2d');
      const zctxClean = zoomCleanedCanvas.getContext('2d');
      zctxOrig.clearRect(0, 0, 200, 200);
      zctxClean.clearRect(0, 0, 200, 200);
      zctxOrig.imageSmoothingEnabled = false;
      zctxClean.imageSmoothingEnabled = false;

      // Draw original zoom
      zctxOrig.drawImage(sourceCanvas, roi.x, roi.y, roi.width, roi.height, 0, 0, 200, 200);
      // Draw cleaned zoom
      zctxClean.drawImage(cleanOffscreen, roi.x, roi.y, roi.width, roi.height, 0, 0, 200, 200);
    }

    // 4. Draw cleaned frame onto main canvas scaled
    ctx.drawImage(cleanOffscreen, 0, 0, previewW, previewH);

    // 5. Draw custom watermark overlay on main preview canvas
    const previewAdderConfig = {
      ...adderConfig,
      fontSize: Math.round(adderConfig.fontSize * displayScale),
      scale: adderConfig.scale * displayScale,
      offsetX: Math.round(adderConfig.offsetX * displayScale),
      offsetY: Math.round(adderConfig.offsetY * displayScale)
    };

    comboEngine.adderEngine.drawWatermark(ctx, previewW, previewH, previewAdderConfig, currentLogoImg);
    syncBulkSettings();
  }

  // Seek video to specific timestamp for live preview scrubber
  function seekPreviewFrame(timeSec) {
    if (!currentVideoElement) return;
    const targetTime = Math.max(0, Math.min(currentVideoElement.duration || 1, timeSec));
    currentVideoElement.onseeked = () => {
      const w = currentVideoElement.videoWidth || 720;
      const h = currentVideoElement.videoHeight || 1280;
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const cx = offscreen.getContext('2d');
      cx.drawImage(currentVideoElement, 0, 0, w, h);
      currentPreviewFrame = { width: w, height: h, canvas: offscreen };
      if (lblFrameTime) lblFrameTime.textContent = `${targetTime.toFixed(1)}s`;
      renderPreview();
    };
    currentVideoElement.currentTime = targetTime;
  }

  // Handle Removal Preset buttons
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const presetKey = btn.getAttribute('data-removal-preset');
      const p = getComboAdaptivePreset(presetKey, currentPreviewFrame?.width || 720, currentPreviewFrame?.height || 720);
      removalConfig.gain = p.gain;
      removalConfig.offsetX = p.offsetX;
      removalConfig.offsetY = p.offsetY;
      removalConfig.sizeScale = p.sizeScale;
      removalConfig.mode = presetKey;

      if (sliderGain) sliderGain.value = p.gain;
      if (sliderScale) sliderScale.value = p.sizeScale;
      if (sliderOffsetX) sliderOffsetX.value = p.offsetX;
      if (sliderOffsetY) sliderOffsetY.value = p.offsetY;

      updateLabels();
      renderPreview();
    });
  });

  // Removal Sliders input events
  sliderGain?.addEventListener('input', (e) => {
    removalConfig.gain = parseFloat(e.target.value);
    updateLabels();
    renderPreview();
  });
  sliderScale?.addEventListener('input', (e) => {
    removalConfig.sizeScale = parseFloat(e.target.value);
    updateLabels();
    renderPreview();
  });
  sliderOffsetX?.addEventListener('input', (e) => {
    removalConfig.offsetX = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });
  sliderOffsetY?.addEventListener('input', (e) => {
    removalConfig.offsetY = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });

  btnResetSliders?.addEventListener('click', () => {
    removalConfig.gain = COMBO_REMOVAL_DEFAULTS.gain;
    removalConfig.sizeScale = COMBO_REMOVAL_DEFAULTS.sizeScale;
    removalConfig.offsetX = COMBO_REMOVAL_DEFAULTS.offsetX;
    removalConfig.offsetY = COMBO_REMOVAL_DEFAULTS.offsetY;

    if (sliderGain) sliderGain.value = COMBO_REMOVAL_DEFAULTS.gain;
    if (sliderScale) sliderScale.value = COMBO_REMOVAL_DEFAULTS.sizeScale;
    if (sliderOffsetX) sliderOffsetX.value = COMBO_REMOVAL_DEFAULTS.offsetX;
    if (sliderOffsetY) sliderOffsetY.value = COMBO_REMOVAL_DEFAULTS.offsetY;

    updateLabels();
    renderPreview();
  });

  // Custom Watermark Type switcher events
  btnTypeText?.addEventListener('click', () => {
    adderConfig.type = 'text';
    btnTypeText.classList.add('active');
    btnTypeImage?.classList.remove('active');
    textControlsBox?.classList.remove('hidden');
    imageControlsBox?.classList.add('hidden');
    if (sliderAdderSize) {
      sliderAdderSize.min = 12;
      sliderAdderSize.max = 140;
      sliderAdderSize.step = 1;
      sliderAdderSize.value = adderConfig.fontSize;
    }
    updateLabels();
    renderPreview();
  });

  btnTypeImage?.addEventListener('click', () => {
    adderConfig.type = 'image';
    btnTypeImage.classList.add('active');
    btnTypeText?.classList.remove('active');
    imageControlsBox?.classList.remove('hidden');
    textControlsBox?.classList.add('hidden');
    if (sliderAdderSize) {
      sliderAdderSize.min = 0.1;
      sliderAdderSize.max = 2.0;
      sliderAdderSize.step = 0.01;
      sliderAdderSize.value = adderConfig.scale;
    }
    updateLabels();
    renderPreview();
  });

  // Text inputs events
  textInput?.addEventListener('input', (e) => {
    adderConfig.text = e.target.value;
    renderPreview();
  });


  selectFontFamily?.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val === 'custom') {
      customFontBox?.classList.remove('hidden');
      return;
    }
    customFontBox?.classList.add('hidden');
    adderConfig.fontFamily = val;
    try {
      await ensureComboFontLoaded(val, adderConfig.fontWeight);
    } catch (err) { }
    renderPreview();
  });

  selectFontWeight?.addEventListener('change', async (e) => {
    adderConfig.fontWeight = e.target.value;
    try {
      await ensureComboFontLoaded(adderConfig.fontFamily, adderConfig.fontWeight);
    } catch (err) { }
    renderPreview();
  });

  colorPicker?.addEventListener('input', (e) => {
    adderConfig.color = e.target.value;
    renderPreview();
  });

  colorPresets.forEach(pill => {
    pill.addEventListener('click', () => {
      const color = pill.getAttribute('data-color');
      if (color) {
        adderConfig.color = color;
        if (colorPicker) colorPicker.value = color;
        renderPreview();
      }
    });
  });

  async function handleLoadCustomFont() {
    const fontVal = customFontInput?.value?.trim();
    if (!fontVal) return;
    if (fontStatusMsg) {
      fontStatusMsg.textContent = 'Loading font from Google Fonts...';
      fontStatusMsg.classList.remove('hidden', 'text-red-500');
      fontStatusMsg.classList.add('text-indigo-600');
    }
    try {
      const loadedFam = await ensureComboFontLoaded(fontVal, adderConfig.fontWeight);
      adderConfig.fontFamily = `"${loadedFam}", sans-serif`;
      if (fontStatusMsg) {
        fontStatusMsg.textContent = `✓ Font "${loadedFam}" ready to render!`;
        fontStatusMsg.classList.remove('text-indigo-600', 'text-red-500');
        fontStatusMsg.classList.add('text-green-600');
      }
      renderPreview();
    } catch (err) {
      if (fontStatusMsg) {
        fontStatusMsg.textContent = `Could not load font. Please verify font name.`;
        fontStatusMsg.classList.remove('text-indigo-600', 'text-green-600');
        fontStatusMsg.classList.add('text-red-500');
      }
    }
  }

  btnLoadCustomFont?.addEventListener('click', handleLoadCustomFont);
  customFontInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLoadCustomFont();
    }
  });

  checkOutline?.addEventListener('change', (e) => {
    adderConfig.outline = e.target.checked;
    renderPreview();
  });

  // Mini Logo Dropzone handling
  logoDropzone?.addEventListener('click', () => {
    if (logoInput) logoInput.click();
  });

  logoDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    logoDropzone.classList.add('drag-over');
  });

  logoDropzone?.addEventListener('dragleave', () => {
    logoDropzone.classList.remove('drag-over');
  });

  logoDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    logoDropzone.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleLogoFile(e.dataTransfer.files[0]);
    }
  });

  logoInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleLogoFile(e.target.files[0]);
    }
  });

  function handleLogoFile(file) {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      currentLogoImg = img;
      bulkCombo?.setLogoImage(img);
      if (logoThumb) {
        logoThumb.src = url;
        logoThumb.classList.remove('hidden');
      }
      const prompt = logoDropzone?.querySelector('.adder-logo-prompt');
      if (prompt) prompt.classList.add('hidden');
      renderPreview();
    };
    img.src = url;
  }

  // Anchor corner buttons
  anchorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      anchorButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      adderConfig.anchor = btn.getAttribute('data-anchor') || 'bottom-right';
      renderPreview();
    });
  });

  // Custom Watermark Sliders
  sliderAdderSize?.addEventListener('input', (e) => {
    if (adderConfig.type === 'image') {
      adderConfig.scale = parseFloat(e.target.value);
    } else {
      adderConfig.fontSize = parseInt(e.target.value, 10);
    }
    updateLabels();
    renderPreview();
  });

  sliderAdderOpacity?.addEventListener('input', (e) => {
    adderConfig.opacity = parseFloat(e.target.value);
    updateLabels();
    renderPreview();
  });

  sliderAdderOffsetX?.addEventListener('input', (e) => {
    adderConfig.offsetX = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });

  sliderAdderOffsetY?.addEventListener('input', (e) => {
    adderConfig.offsetY = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });

  sliderAdderRotation?.addEventListener('input', (e) => {
    adderConfig.rotation = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });

  frameScrubber?.addEventListener('input', (e) => {
    seekPreviewFrame(parseFloat(e.target.value));
  });

  // Mode Switcher (Single vs Bulk)
  function switchComboMode(mode) {
    currentComboMode = mode;
    syncBulkSettings();

    if (mode === 'single') {
      btnModeSingle?.classList.add('active');
      btnModeBulk?.classList.remove('active');
      bulkStrategyBox?.classList.add('hidden');
      bulkAdderBadge?.classList.add('hidden');
      queueWrapper?.classList.add('hidden');
      containerBulk?.classList.add('hidden');

      if (currentVideoElement) {
        containerSingle?.classList.add('hidden');
        stageCard?.classList.remove('hidden');
        singleActionBox?.classList.remove('hidden');
        btnChangeVideo?.classList.remove('hidden');
        renderPreview();
      } else {
        containerSingle?.classList.remove('hidden');
        stageCard?.classList.add('hidden');
        btnChangeVideo?.classList.add('hidden');
      }
    } else {
      btnModeSingle?.classList.remove('active');
      btnModeBulk?.classList.add('active');
      bulkStrategyBox?.classList.remove('hidden');
      bulkAdderBadge?.classList.remove('hidden');
      containerSingle?.classList.add('hidden');
      singleActionBox?.classList.add('hidden');
      btnChangeVideo?.classList.add('hidden');

      if (bulkCombo && bulkCombo.queue.length > 0) {
        containerBulk?.classList.add('hidden');
        stageCard?.classList.remove('hidden');
        queueWrapper?.classList.remove('hidden');
        renderPreview();
      } else {
        containerBulk?.classList.remove('hidden');
        stageCard?.classList.add('hidden');
        queueWrapper?.classList.add('hidden');
      }
    }
  }

  btnModeSingle?.addEventListener('click', () => switchComboMode('single'));
  btnModeBulk?.addEventListener('click', () => switchComboMode('bulk'));

  // Collapsible Sidebar & Cinema Stage Handlers
  function toggleLeftSidebar(collapse) {
    if (!workspaceLayout) return;
    const shouldCollapse = collapse !== undefined ? collapse : !workspaceLayout.classList.contains('left-collapsed');
    workspaceLayout.classList.toggle('left-collapsed', shouldCollapse);
    setTimeout(renderPreview, 310);
  }

  function toggleRightSidebar(collapse) {
    if (!workspaceLayout) return;
    const shouldCollapse = collapse !== undefined ? collapse : !workspaceLayout.classList.contains('right-collapsed');
    workspaceLayout.classList.toggle('right-collapsed', shouldCollapse);
    setTimeout(renderPreview, 310);
  }

  btnToggleSidebarLeft?.addEventListener('click', () => toggleLeftSidebar(true));
  railLeft?.addEventListener('click', () => toggleLeftSidebar(false));
  btnRailExpandLeft?.addEventListener('click', (e) => { e.stopPropagation(); toggleLeftSidebar(false); });

  btnToggleSidebarRight?.addEventListener('click', () => toggleRightSidebar(true));
  railRight?.addEventListener('click', () => toggleRightSidebar(false));
  btnRailExpandRight?.addEventListener('click', (e) => { e.stopPropagation(); toggleRightSidebar(false); });

  btnCinema?.addEventListener('click', () => {
    if (!workspaceLayout) return;
    const isCinema = workspaceLayout.classList.contains('cinema-mode');
    if (isCinema) {
      workspaceLayout.classList.remove('cinema-mode', 'left-collapsed', 'right-collapsed');
      btnCinema.classList.remove('active');
    } else {
      workspaceLayout.classList.add('cinema-mode', 'left-collapsed', 'right-collapsed');
      btnCinema.classList.add('active');
    }
    setTimeout(renderPreview, 310);
  });

  // Strategy Synchronization
  function setBulkRemovalStrategy(strat) {
    if (!bulkCombo) return;
    bulkCombo.setStrategy(strat);
    if (strat === 'auto') {
      btnComboStrategyAuto?.classList.add('active');
      btnComboStrategyManual?.classList.remove('active');
      btnBulkStrategyAuto?.classList.add('active');
      btnBulkStrategyManual?.classList.remove('active');
      if (comboBulkStrategyHint) {
        comboBulkStrategyHint.textContent = 'Adaptive AI auto-detects watermark location & dimensions per video.';
      }
    } else {
      btnComboStrategyManual?.classList.add('active');
      btnComboStrategyAuto?.classList.remove('active');
      btnBulkStrategyManual?.classList.add('active');
      btnBulkStrategyAuto?.classList.remove('active');
      if (comboBulkStrategyHint) {
        comboBulkStrategyHint.textContent = 'Custom model preset and slider values below apply uniformly to all batch videos.';
      }
      bulkCombo.setRemovalSettings(removalConfig);
    }
  }

  btnComboStrategyAuto?.addEventListener('click', () => setBulkRemovalStrategy('auto'));
  btnBulkStrategyAuto?.addEventListener('click', () => setBulkRemovalStrategy('auto'));
  btnComboStrategyManual?.addEventListener('click', () => setBulkRemovalStrategy('manual'));
  btnBulkStrategyManual?.addEventListener('click', () => setBulkRemovalStrategy('manual'));

  // Hook up preview callback when queue item is clicked
  bulkCombo.onPreviewItem = async (item) => {
    if (item && item.file) {
      stageCard?.classList.remove('hidden');
      await handleVideoFile(item.file, true);
    }
  };

  // Callback when files are added to bulk queue
  bulkCombo.onFilesAdded = async (queue, wasEmpty) => {
    containerBulk?.classList.add('hidden');
    stageCard?.classList.remove('hidden');
    queueWrapper?.classList.remove('hidden');
    singleActionBox?.classList.add('hidden');
    btnChangeVideo?.classList.add('hidden');
    syncBulkSettings();

    if (wasEmpty || !currentPreviewFrame) {
      const first = bulkCombo.queue[0];
      if (first && first.file) {
        bulkCombo.activePreviewId = first.id;
        bulkCombo.updatePreviewHighlights();
        await handleVideoFile(first.file, true);
      }
    }
  };

  function onBulkFilesAdded(fileList) {
    if (!bulkCombo) return;
    bulkCombo.addFiles(fileList);
  }

  bulkCombo.onClearQueue = () => {
    if (currentComboMode === 'bulk') {
      stageCard?.classList.add('hidden');
      containerBulk?.classList.remove('hidden');
    }
  };

  btnChangeVideo?.addEventListener('click', () => {
    fileInput?.click();
  });

  // Single Dropzone drag-drop & input events
  if (dropzone) {
    dropzone.onclick = () => {
      if (fileInput) fileInput.click();
    };

    dropzone.ondragover = (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    };

    dropzone.ondragleave = () => {
      dropzone.classList.remove('drag-over');
    };

    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files) {
        if (e.dataTransfer.files.length > 1) {
          switchComboMode('bulk');
          onBulkFilesAdded(e.dataTransfer.files);
        } else if (e.dataTransfer.files[0]) {
          handleVideoFile(e.dataTransfer.files[0], false);
        }
      }
    };
  }

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 1) {
      switchComboMode('bulk');
      onBulkFilesAdded(e.target.files);
    } else if (e.target.files && e.target.files[0]) {
      handleVideoFile(e.target.files[0], false);
    }
    fileInput.value = '';
  });

  // Load video file and initialize preview
  async function handleVideoFile(file, isBulk = false) {
    if (!file.type.startsWith('video/')) return;
    if (isProcessing) return;

    if (!isBulk) {
      setDropzoneLoading(true, 'Reading video frames...');
      resultsArea?.classList.add('hidden');
      statusContainer?.classList.add('hidden');
      containerSingle?.classList.add('hidden');
    }
    currentVideoFile = file;

    try {
      await getOrInitEngine();

      // Extract initial preview frame using grabPreviewFrame for instant, 100% reliable rendering
      if (typeof grabPreviewFrame === 'function') {
        try {
          const frameInfo = await grabPreviewFrame(file);
          if (frameInfo) {
            const offscreen = document.createElement('canvas');
            offscreen.width = frameInfo.width;
            offscreen.height = frameInfo.height;
            const cx = offscreen.getContext('2d');
            if (frameInfo.canvas) {
              cx.drawImage(frameInfo.canvas, 0, 0);
            } else if (frameInfo.imageData) {
              cx.putImageData(frameInfo.imageData, 0, 0);
            }
            currentPreviewFrame = { width: frameInfo.width, height: frameInfo.height, canvas: offscreen };
            if (lblFrameTime) lblFrameTime.textContent = `0.0s`;

            // Auto-detect watermark location on this frame
            if (typeof detectVideoWatermarkCandidate === 'function') {
              const detected = detectVideoWatermarkCandidate(frameInfo.imageData, frameInfo.width, frameInfo.height, comboEngine.imageEngine.bg96);
              if (detected && detectBadge) {
                detectBadge.textContent = `✓ Auto-detected: Gemini Watermark located`;
                detectBadge.classList.remove('hidden');
              }
            }
          }
        } catch (frameErr) {
          console.warn('grabPreviewFrame error:', frameErr);
        }
      }

      // Initialize HTML5 video element for timestamp scrubbing
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.src = url;

      await new Promise((resolve) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => resolve();
        setTimeout(resolve, 3000);
      });

      currentVideoElement = v;
      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      if (frameScrubber) {
        frameScrubber.min = 0;
        frameScrubber.max = duration;
        frameScrubber.step = 0.1;
        frameScrubber.value = 0;
      }

      if (!currentPreviewFrame) {
        seekPreviewFrame(Math.min(0.5, duration / 2));
      } else {
        renderPreview();
      }

      stageCard?.classList.remove('hidden');
      if (currentComboMode === 'bulk') {
        containerBulk?.classList.add('hidden');
        singleActionBox?.classList.add('hidden');
        btnChangeVideo?.classList.add('hidden');
        queueWrapper?.classList.remove('hidden');
      } else {
        containerSingle?.classList.add('hidden');
        singleActionBox?.classList.remove('hidden');
        btnChangeVideo?.classList.remove('hidden');
        btnExport?.classList.remove('hidden');
      }
      updateLabels();
      syncBulkSettings();
      if (!isBulk && typeof smoothScrollTo === 'function') smoothScrollTo(stageCard);
    } catch (err) {
      console.error(err);
      if (!isBulk) alert('Could not initialize video preview: ' + err.message);
    } finally {
      if (!isBulk) setDropzoneLoading(false);
    }
  }

  // Export video with 1-pass dual action processing
  btnExport?.addEventListener('click', async () => {
    if (!currentVideoFile || isProcessing) return;

    if (adderConfig.type === 'text' && !adderConfig.text.trim()) {
      alert('Please enter text for your watermark.');
      return;
    }
    if (adderConfig.type === 'image' && !currentLogoImg) {
      alert('Please upload a logo image for your watermark.');
      return;
    }

    if (adderConfig.type === 'text') {
      try {
        await ensureComboFontLoaded(adderConfig.fontFamily, adderConfig.fontWeight);
      } catch (e) { }
    }

    if (btnExport) {
      btnExport.disabled = true;
      btnExport.classList.add('opacity-50', 'pointer-events-none');
    }

    stageCard?.classList.add('hidden');
    statusContainer?.classList.remove('hidden');
    resultsArea?.classList.add('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
    if (typeof smoothScrollTo === 'function') smoothScrollTo(statusContainer);

    try {
      isProcessing = true;
      const engine = await getOrInitEngine();

      const res = await engine.process(
        currentVideoFile,
        removalConfig,
        adderConfig,
        currentLogoImg,
        {
          onProgress: ({ progress }) => {
            const pct = Math.round(progress * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `${pct}% - 1-pass rendering (lossless quality)`;
          }
        }
      );

      isProcessing = false;
      if (btnExport) {
        btnExport.disabled = false;
        btnExport.classList.remove('opacity-50', 'pointer-events-none');
      }
      statusContainer?.classList.add('hidden');
      resultsArea?.classList.remove('hidden');

      resultsArea.innerHTML = `
        <div class="result-card p-4">
          <div class="result-header mb-3">
            <span class="text-green-600 font-semibold flex items-center gap-1">
              <iconify-icon icon="ph:check-circle-fill" width="20"></iconify-icon>
              Video Ready (Gemini Watermark Removed &amp; New Watermark Added in 1 Pass!)
            </span>
          </div>
          <div class="result-video-preview mb-4 text-center">
            <video src="${res.url}" controls autoplay playsinline loop class="max-w-full rounded-md shadow-md mx-auto" style="max-height: 480px;"></video>
          </div>
          <div class="result-actions flex justify-center gap-3">
            <a href="${res.url}" download="cleaned_watermarked_${currentVideoFile.name}" class="btn btn-primary">
              <iconify-icon icon="ph:download-simple-bold" width="16"></iconify-icon>
              Download Watermarked MP4
            </a>
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('combo-stage-card').classList.remove('hidden'); document.getElementById('combo-results').classList.add('hidden');">
              <iconify-icon icon="ph:sliders-horizontal"></iconify-icon> Adjust Settings
            </button>
          </div>
        </div>
      `;
      if (typeof smoothScrollTo === 'function') smoothScrollTo(resultsArea);
    } catch (err) {
      isProcessing = false;
      if (btnExport) {
        btnExport.disabled = false;
        btnExport.classList.remove('opacity-50', 'pointer-events-none');
      }
      console.error(err);
      statusContainer?.classList.add('hidden');
      stageCard?.classList.remove('hidden');
      alert(`Processing failed: ${err.message || err}`);
    }
  });
}

// ── Expose globals to window ──
window.COMBO_REMOVAL_DEFAULTS = COMBO_REMOVAL_DEFAULTS;
window.COMBO_REMOVAL_PRESETS = COMBO_REMOVAL_PRESETS;
window.getComboAdaptivePreset = getComboAdaptivePreset;
window.ensureComboFontLoaded = ensureComboFontLoaded;
window.VideoRemoveAndAddEngine = VideoRemoveAndAddEngine;
window.BulkVideoRemoveAndAddQueue = BulkVideoRemoveAndAddQueue;
window.initVideoRemoveAndAdd = initVideoRemoveAndAdd;
