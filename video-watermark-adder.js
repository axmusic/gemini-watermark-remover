// ── Video Watermark Adder Engine & UI Controller ──

const loadedFontsSet = new Set(['Ubuntu', 'Arial', 'Impact', 'Georgia', 'Courier New', 'Trebuchet MS']);

async function ensureFontLoaded(fontFamily, weight = '700') {
  if (!fontFamily) return 'Ubuntu, sans-serif';
  let primaryName = fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  if (!primaryName) return 'Ubuntu';

  try {
    let fam = primaryName;
    let linkUrl = '';

    // Handle user pasting HTML <link ... href="..." /> snippet
    if (primaryName.includes('<link') && primaryName.includes('href=')) {
      const match = primaryName.match(/href=["']([^"']+)["']/i);
      if (match && match[1]) {
        primaryName = match[1];
      }
    }

    // Handle full Google Fonts URL (e.g. https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400..700&display=swap)
    if (primaryName.startsWith('http://') || primaryName.startsWith('https://')) {
      try {
        const u = new URL(primaryName);
        const famParam = u.searchParams.get('family');
        if (famParam) {
          fam = famParam.split(':')[0].replace(/\+/g, ' ');
        }
      } catch (err) {
        console.warn('URL parse warning:', err);
      }
      linkUrl = primaryName;
    } else {
      fam = primaryName;
      linkUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam.replace(/ /g, '+'))}:wght@300;400;500;600;700;800;900&display=swap`;
    }

    // Append Google Font link tag if not already added to DOM
    if (!document.querySelector(`link[data-font="${fam}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.setAttribute('data-font', fam);
      link.href = linkUrl;
      document.head.appendChild(link);
    }

    // Wait for canvas font renderer to load typeface glyphs with specified weight
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
      } catch (err) {
        console.warn('document.fonts.load notice:', err);
      }
    }

    loadedFontsSet.add(fam);
    return fam;
  } catch (e) {
    console.warn('Font load error:', e);
    return primaryName;
  }
}

class VideoWatermarkAdderEngine {
  constructor() {
    this._mb = null;
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

  calculatePosition(canvasWidth, canvasHeight, anchor, offsetX, offsetY, wmWidth, wmHeight) {
    const margin = Math.max(16, Math.round(Math.min(canvasWidth, canvasHeight) * 0.04));
    let x = 0;
    let y = 0;

    switch (anchor) {
      case 'top-left':
        x = margin + offsetX;
        y = margin + offsetY;
        break;
      case 'top-right':
        x = canvasWidth - margin - wmWidth + offsetX;
        y = margin + offsetY;
        break;
      case 'bottom-left':
        x = margin + offsetX;
        y = canvasHeight - margin - wmHeight + offsetY;
        break;
      case 'bottom-right':
        x = canvasWidth - margin - wmWidth + offsetX;
        y = canvasHeight - margin - wmHeight + offsetY;
        break;
      case 'center':
      default:
        x = (canvasWidth - wmWidth) / 2 + offsetX;
        y = (canvasHeight - wmHeight) / 2 + offsetY;
        break;
    }

    return { x, y };
  }

  drawWatermark(ctx, canvasWidth, canvasHeight, config, logoImg = null) {
    ctx.save();

    const opacity = Number.isFinite(config.opacity) ? Math.max(0.05, Math.min(1, config.opacity)) : 0.85;
    const rotationDeg = Number.isFinite(config.rotation) ? config.rotation : 0;
    const rotationRad = (rotationDeg * Math.PI) / 180;
    const anchor = config.anchor || 'bottom-right';
    const offsetX = config.offsetX || 0;
    const offsetY = config.offsetY || 0;

    if (config.type === 'text') {
      const text = config.text || '';
      if (!text.trim()) {
        ctx.restore();
        return;
      }

      const fontSize = Math.max(10, config.fontSize || 36);
      const fontWeight = config.fontWeight || '700';
      const fontFamily = config.fontFamily || 'Ubuntu, sans-serif';
      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.textBaseline = 'top';

      const metrics = ctx.measureText(text);
      const textWidth = metrics.width;
      const textHeight = fontSize * 1.15;

      const pos = this.calculatePosition(canvasWidth, canvasHeight, anchor, offsetX, offsetY, textWidth, textHeight);
      const centerX = pos.x + textWidth / 2;
      const centerY = pos.y + textHeight / 2;

      ctx.translate(centerX, centerY);
      if (rotationRad !== 0) ctx.rotate(rotationRad);
      ctx.globalAlpha = opacity;

      // Optional contrast outline / shadow for clear visibility on both dark and bright backgrounds
      if (config.outline !== false) {
        ctx.strokeStyle = config.strokeColor || 'rgba(0, 0, 0, 0.75)';
        const weightNum = parseInt(config.fontWeight, 10) || 700;
        const strokeFactor = weightNum <= 400 ? 0.08 : 0.12;
        ctx.lineWidth = Math.max(1.5, Math.round(fontSize * strokeFactor));
        ctx.lineJoin = 'round';
        ctx.strokeText(text, -textWidth / 2, -textHeight / 2);
      }

      ctx.fillStyle = config.color || '#ffffff';
      ctx.fillText(text, -textWidth / 2, -textHeight / 2);
    } else if (config.type === 'image' && logoImg) {
      const scale = Number.isFinite(config.scale) ? Math.max(0.05, config.scale) : 1;
      const imgWidth = (logoImg.naturalWidth || logoImg.width || 120) * scale;
      const imgHeight = (logoImg.naturalHeight || logoImg.height || 120) * scale;

      const pos = this.calculatePosition(canvasWidth, canvasHeight, anchor, offsetX, offsetY, imgWidth, imgHeight);
      const centerX = pos.x + imgWidth / 2;
      const centerY = pos.y + imgHeight / 2;

      ctx.translate(centerX, centerY);
      if (rotationRad !== 0) ctx.rotate(rotationRad);
      ctx.globalAlpha = opacity;

      ctx.drawImage(logoImg, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
    }

    ctx.restore();
  }

  async process(videoFile, config, logoImg = null, opts = {}) {
    const onProgress = opts.onProgress || (() => { });

    const mb = await this._lib();
    const {
      ALL_FORMATS, BlobSource, BufferTarget, CanvasSource,
      EncodedAudioPacketSource, EncodedPacketSink, Input,
      Mp4OutputFormat, Output, QUALITY_HIGH, VideoSampleSink, canEncodeVideo,
    } = mb;

    if (canEncodeVideo && !(await canEncodeVideo('avc'))) {
      throw new Error('Your browser cannot encode H.264 video locally. Please try Chrome, Edge, or Firefox desktop.');
    }

    const originalUrl = URL.createObjectURL(videoFile);
    const input = new Input({ source: new BlobSource(videoFile), formats: ALL_FORMATS });

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

      // Draw original video frame
      sample.draw(ctx, 0, 0, width, height);
      sample.close();

      // Render custom watermark overlay onto frame
      this.drawWatermark(ctx, width, height, config, logoImg);

      await videoSource.add(timestamp, dur);
      if (duration) onProgress({ progress: Math.min(0.99, timestamp / duration) });
    }
    videoSource.close();

    // Stream audio packets without re-encoding
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
      throw new Error('Video watermark export produced no output.');
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

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ── Bulk Video Watermark Adder Queue Processor ──
class BulkVideoAdderQueue {
  constructor(adderEngine, getConfigFn, getLogoImgFn, loadPreviewFn) {
    this.adderEngine = adderEngine;
    this.getConfig = getConfigFn;
    this.getLogoImg = getLogoImgFn;
    this.loadPreview = loadPreviewFn;

    this.queue = [];
    this.isProcessing = false;
    this.isPaused = false;
    this.currentProcessingId = null;

    this.dropzoneBulk = document.getElementById('bulk-adder-dropzone');
    this.inputBulk = document.getElementById('bulk-adder-input');
    this.wrapperQueue = document.getElementById('bulk-adder-queue-wrapper');
    this.listQueue = document.getElementById('bulk-adder-queue-list');

    this.elTotal = document.getElementById('bulk-adder-count-total');
    this.elCompleted = document.getElementById('bulk-adder-count-completed');
    this.elProcessing = document.getElementById('bulk-adder-count-processing');
    this.elQueued = document.getElementById('bulk-adder-count-queued');

    this.elOverallProgressContainer = document.getElementById('bulk-adder-overall-progress-container');
    this.elOverallProgressBar = document.getElementById('bulk-adder-overall-progress-bar');
    this.elOverallStatusText = document.getElementById('bulk-adder-overall-status-text');
    this.elOverallPercentText = document.getElementById('bulk-adder-overall-percent-text');

    this.btnStart = document.getElementById('btn-bulk-adder-start');
    this.btnPause = document.getElementById('btn-bulk-adder-pause');
    this.btnDownloadAll = document.getElementById('btn-bulk-adder-download-all');
    this.btnClear = document.getElementById('btn-bulk-adder-clear');
    this.btnAddMore = document.getElementById('btn-bulk-adder-add-more');

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

    const wasEmpty = this.queue.length === 0;

    for (const file of validFiles) {
      const id = 'adder_vid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      this.queue.push({
        id,
        file,
        name: file.name,
        size: file.size,
        formattedSize: formatBytes(file.size),
        status: 'queued',
        progress: 0,
        result: null,
        errorMsg: ''
      });
    }

    if (this.wrapperQueue) this.wrapperQueue.classList.remove('hidden');

    // Automatically load preview from the first video if not already previewing
    if (wasEmpty && typeof this.loadPreview === 'function') {
      this.loadPreview(validFiles[0]);
    }

    this.render();
    this.updateStats();
  }

  async start() {
    if (this.isProcessing) return;

    const config = this.getConfig();
    const logoImg = this.getLogoImg();

    if (config.type === 'text' && !config.text.trim()) {
      alert('Please enter watermark text before starting bulk processing.');
      return;
    }
    if (config.type === 'image' && !logoImg) {
      alert('Please upload a watermark logo image before starting bulk processing.');
      return;
    }

    if (config.type === 'text') {
      try {
        await ensureFontLoaded(config.fontFamily, config.fontWeight);
      } catch (e) {
        console.warn('Font load error:', e);
      }
    }

    this.isProcessing = true;
    this.isPaused = false;
    this.updateStats();

    while (this.isProcessing && !this.isPaused) {
      const nextItem = this.queue.find(item => item.status === 'queued');
      if (!nextItem) break;

      this.currentProcessingId = nextItem.id;
      nextItem.status = 'processing';
      nextItem.progress = 0;
      this.renderItem(nextItem.id);
      this.updateStats();

      try {
        const res = await this.adderEngine.process(nextItem.file, config, logoImg, {
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
        console.error(`Bulk watermark failed for ${nextItem.name}:`, err);
        nextItem.status = 'error';
        nextItem.errorMsg = err.message || 'Watermarking failed';
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
        a.download = `watermarked_${item.name.replace(/\.[^/.]+$/, '')}.mp4`;
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
            this.elOverallStatusText.textContent = '🎉 All Videos Watermarked Successfully!';
          } else if (this.isProcessing) {
            this.elOverallStatusText.textContent = `Watermarking Video (${completed + 1} of ${total})...`;
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
    const itemEl = document.getElementById(`bulk-adder-item-${id}`);
    if (!itemEl) return;

    const barEl = itemEl.querySelector('.bulk-item-progress-bar-fill');
    const textEl = itemEl.querySelector('.bulk-item-progress-text');
    if (barEl) barEl.style.width = `${item.progress}%`;
    if (textEl) textEl.textContent = `${item.progress}%`;
  }

  renderItem(id) {
    const item = this.queue.find(i => i.id === id);
    if (!item) return;

    const oldEl = document.getElementById(`bulk-adder-item-${id}`);
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
      const itemEl = document.getElementById(`bulk-adder-item-${item.id}`);
      if (itemEl) this.bindItemEvents(itemEl, item);
    });
  }

  getItemHtml(item) {
    let badgeClass = 'badge-queued';
    let badgeText = 'Queued';

    if (item.status === 'processing') {
      badgeClass = 'badge-processing';
      badgeText = `Watermarking (${item.progress}%)`;
    } else if (item.status === 'completed') {
      badgeClass = 'badge-completed';
      badgeText = 'Completed';
    } else if (item.status === 'error') {
      badgeClass = 'badge-error';
      badgeText = 'Failed';
    }

    const cfg = this.getConfig();
    const watermarkBadge = cfg.type === 'text'
      ? `Text: "${(cfg.text || 'Watermark').slice(0, 18)}"`
      : 'Logo Overlay';

    return `
      <div id="bulk-adder-item-${item.id}" class="bulk-item-card status-${item.status}">
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
              <span class="text-indigo-600">${watermarkBadge}</span>
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

// ── UI Controller for Video Watermark Adder ──
function initVideoWatermarkAdder() {
  const dropzone = document.getElementById('adder-video-dropzone');
  const fileInput = document.getElementById('adder-video-input');
  const tunerContainer = document.getElementById('adder-tuner-container');
  const mainCanvas = document.getElementById('adder-main-canvas');
  const statusContainer = document.getElementById('adder-status');
  const progressBar = document.getElementById('adder-progress-bar');
  const progressText = document.getElementById('adder-progress-text');
  const resultsArea = document.getElementById('adder-results');

  // Mode Switcher Elements
  const btnModeSingle = document.getElementById('btn-adder-mode-single');
  const btnModeBulk = document.getElementById('btn-adder-mode-bulk');
  const containerSingle = document.getElementById('adder-single-container');
  const containerBulk = document.getElementById('adder-bulk-container');
  const queueWrapper = document.getElementById('bulk-adder-queue-wrapper');

  // Type Switcher
  const btnTypeText = document.getElementById('btn-adder-type-text');
  const btnTypeImage = document.getElementById('btn-adder-type-image');
  const textControlsBox = document.getElementById('adder-text-controls');
  const imageControlsBox = document.getElementById('adder-image-controls');

  // Text inputs
  const textInput = document.getElementById('adder-text-input');
  const textColorInput = document.getElementById('adder-text-color');
  const fontSelect = document.getElementById('adder-font-family');
  const fontWeightSelect = document.getElementById('adder-font-weight');
  const customFontBox = document.getElementById('adder-custom-font-box');
  const customFontInput = document.getElementById('adder-custom-font-input');
  const btnLoadCustomFont = document.getElementById('btn-load-custom-font');
  const fontStatusMsg = document.getElementById('adder-font-status');
  const outlineCheckbox = document.getElementById('adder-text-outline');
  const colorPresetButtons = document.querySelectorAll('.color-preset-pill');

  // Image logo inputs
  const logoDropzone = document.getElementById('adder-logo-dropzone');
  const logoInput = document.getElementById('adder-logo-input');
  const logoPreviewThumb = document.getElementById('adder-logo-thumb');

  // Position Presets
  const anchorButtons = document.querySelectorAll('.btn-adder-anchor');

  // Sliders & Labels
  const sliderSize = document.getElementById('slider-adder-size');
  const sliderOpacity = document.getElementById('slider-adder-opacity');
  const sliderOffsetX = document.getElementById('slider-adder-offset-x');
  const sliderOffsetY = document.getElementById('slider-adder-offset-y');
  const sliderRotation = document.getElementById('slider-adder-rotation');

  const lblSize = document.getElementById('lbl-adder-size');
  const lblOpacity = document.getElementById('lbl-adder-opacity');
  const lblOffsetX = document.getElementById('lbl-adder-offset-x');
  const lblOffsetY = document.getElementById('lbl-adder-offset-y');
  const lblRotation = document.getElementById('lbl-adder-rotation');

  // Video Frame Scrubber
  const frameScrubber = document.getElementById('slider-adder-frame-time');
  const lblFrameTime = document.getElementById('lbl-adder-frame-time');

  const btnReset = document.getElementById('btn-adder-reset');
  const btnExport = document.getElementById('btn-adder-export');

  if (!dropzone || !fileInput) return;

  let currentVideoFile = null;
  let currentVideoElement = null;
  let currentPreviewFrame = null;
  let currentLogoImg = null;
  let isProcessing = false;
  let adderEngine = new VideoWatermarkAdderEngine();

  const config = {
    type: 'text', // 'text' | 'image'
    text: '© AXWON GROUP',
    fontSize: 42,
    fontWeight: '400',
    fontFamily: 'Ubuntu, sans-serif',
    color: '#ffffff',
    strokeColor: 'rgba(0, 0, 0, 0.8)',
    outline: true,
    scale: 0.6,
    opacity: 0.85,
    anchor: 'bottom-right',
    offsetX: 0,
    offsetY: 0,
    rotation: 0
  };

  function updateLabels() {
    if (lblSize) {
      lblSize.textContent = config.type === 'text' ? `${config.fontSize}px` : `${config.scale.toFixed(2)}x`;
    }
    if (lblOpacity) lblOpacity.textContent = `${Math.round(config.opacity * 100)}%`;
    if (lblOffsetX) lblOffsetX.textContent = `${config.offsetX}px`;
    if (lblOffsetY) lblOffsetY.textContent = `${config.offsetY}px`;
    if (lblRotation) lblRotation.textContent = `${config.rotation}°`;
  }

  function setDropzoneLoading(loading, message = 'Loading video frame...') {
    isProcessing = loading;
    if (loading) {
      dropzone.classList.add('loading');
      dropzone.innerHTML = `
        <div class="dropzone-loader">
          <div class="dropzone-spinner"></div>
          <p class="dropzone-title text-indigo-600">${message}</p>
          <p class="dropzone-sub">Extracting video canvas for live watermark preview...</p>
        </div>
      `;
    } else {
      dropzone.classList.remove('loading');
      dropzone.innerHTML = `
        <div class="dropzone-icon">
          <iconify-icon icon="ph:video-camera-bold"></iconify-icon>
        </div>
        <p class="dropzone-title">Upload or drag a video to add watermark</p>
        <p class="dropzone-sub">Supports MP4, WebM, MOV</p>
      `;
    }
  }

  function renderPreview() {
    if (!currentPreviewFrame || !mainCanvas) return;
    const { width, height, canvas: sourceCanvas } = currentPreviewFrame;

    const maxDisplayW = 680;
    const displayScale = Math.min(1, maxDisplayW / width);
    mainCanvas.width = Math.round(width * displayScale);
    mainCanvas.height = Math.round(height * displayScale);

    const ctx = mainCanvas.getContext('2d');
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

    // Draw video frame scaled to preview size
    ctx.drawImage(sourceCanvas, 0, 0, mainCanvas.width, mainCanvas.height);

    // Create a temporary scaled config matching preview canvas size
    const previewConfig = {
      ...config,
      fontSize: Math.round(config.fontSize * displayScale),
      scale: config.scale * displayScale,
      offsetX: Math.round(config.offsetX * displayScale),
      offsetY: Math.round(config.offsetY * displayScale)
    };

    adderEngine.drawWatermark(ctx, mainCanvas.width, mainCanvas.height, previewConfig, currentLogoImg);
  }

  // Seek video to specific timestamp for live preview scrubber
  function seekPreviewFrame(timeSec) {
    if (!currentVideoElement) return;
    currentVideoElement.currentTime = Math.max(0, Math.min(currentVideoElement.duration || 1, timeSec));
    currentVideoElement.onseeked = () => {
      const w = currentVideoElement.videoWidth || 720;
      const h = currentVideoElement.videoHeight || 1280;
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const cx = offscreen.getContext('2d');
      cx.drawImage(currentVideoElement, 0, 0, w, h);
      currentPreviewFrame = { width: w, height: h, canvas: offscreen };
      if (lblFrameTime) lblFrameTime.textContent = `${timeSec.toFixed(1)}s`;
      renderPreview();
    };
  }

  // Type switcher events
  btnTypeText?.addEventListener('click', () => {
    config.type = 'text';
    btnTypeText.classList.add('active');
    btnTypeImage.classList.remove('active');
    textControlsBox?.classList.remove('hidden');
    imageControlsBox?.classList.add('hidden');
    if (sliderSize) {
      sliderSize.min = 12;
      sliderSize.max = 140;
      sliderSize.step = 1;
      sliderSize.value = config.fontSize;
    }
    updateLabels();
    renderPreview();
  });

  btnTypeImage?.addEventListener('click', () => {
    config.type = 'image';
    btnTypeImage.classList.add('active');
    btnTypeText.classList.remove('active');
    imageControlsBox?.classList.remove('hidden');
    textControlsBox?.classList.add('hidden');
    if (sliderSize) {
      sliderSize.min = 0.1;
      sliderSize.max = 2.0;
      sliderSize.step = 0.01;
      sliderSize.value = config.scale;
    }
    updateLabels();
    renderPreview();
  });

  // Text inputs events
  textInput?.addEventListener('input', (e) => {
    config.text = e.target.value;
    renderPreview();
  });

  textColorInput?.addEventListener('input', (e) => {
    config.color = e.target.value;
    renderPreview();
  });

  colorPresetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.getAttribute('data-color');
      if (col) {
        config.color = col;
        if (textColorInput) textColorInput.value = col;
        renderPreview();
      }
    });
  });

  // Dynamic font switching & custom Google Fonts loading
  fontSelect?.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val === 'custom') {
      if (customFontBox) {
        customFontBox.classList.remove('hidden');
        customFontInput?.focus();
      }
    } else {
      if (customFontBox) customFontBox.classList.add('hidden');
      if (fontStatusMsg) fontStatusMsg.classList.add('hidden');
      try {
        await ensureFontLoaded(val, config.fontWeight);
        config.fontFamily = val;
      } catch (err) {
        console.warn('Font switch load:', err);
        config.fontFamily = val;
      }
      renderPreview();
    }
  });

  fontWeightSelect?.addEventListener('change', async (e) => {
    config.fontWeight = e.target.value;
    try {
      const fam = config.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      await ensureFontLoaded(fam, config.fontWeight);
    } catch (err) {
      console.warn('Font weight change warning:', err);
    }
    renderPreview();
  });

  async function handleLoadCustomFont() {
    if (!customFontInput) return;
    const rawVal = customFontInput.value.trim();
    if (!rawVal) {
      if (fontStatusMsg) {
        fontStatusMsg.textContent = 'Please enter a Google Font name or CSS link.';
        fontStatusMsg.className = 'adder-font-status-msg error';
        fontStatusMsg.classList.remove('hidden');
      }
      return;
    }

    if (fontStatusMsg) {
      fontStatusMsg.textContent = 'Fetching font from Google Fonts...';
      fontStatusMsg.className = 'adder-font-status-msg';
      fontStatusMsg.classList.remove('hidden');
    }

    try {
      const famName = await ensureFontLoaded(rawVal);
      const fontVal = `"${famName}", sans-serif`;
      config.fontFamily = fontVal;

      // Add to select or find existing option
      let existingOpt = Array.from(fontSelect?.options || []).find(
        opt => opt.value.toLowerCase().includes(famName.toLowerCase()) || opt.text.toLowerCase().includes(famName.toLowerCase())
      );
      if (!existingOpt && fontSelect) {
        const customGroup = fontSelect.querySelector('optgroup[label="Custom Google Font"]') || fontSelect;
        existingOpt = document.createElement('option');
        existingOpt.value = fontVal;
        existingOpt.textContent = `⭐ ${famName} (Loaded)`;
        customGroup.insertBefore(existingOpt, customGroup.firstChild);
      }
      if (existingOpt && fontSelect) {
        fontSelect.value = existingOpt.value;
      }

      if (fontStatusMsg) {
        fontStatusMsg.textContent = `✓ Loaded "${famName}" successfully! Applied to watermark.`;
        fontStatusMsg.className = 'adder-font-status-msg success';
        fontStatusMsg.classList.remove('hidden');
      }

      renderPreview();
    } catch (err) {
      if (fontStatusMsg) {
        fontStatusMsg.textContent = `Could not load font: ${err.message || 'Check connection or name'}`;
        fontStatusMsg.className = 'adder-font-status-msg error';
        fontStatusMsg.classList.remove('hidden');
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

  outlineCheckbox?.addEventListener('change', (e) => {
    config.outline = e.target.checked;
    renderPreview();
  });

  // Logo uploader
  logoDropzone?.addEventListener('click', () => logoInput?.click());
  logoInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        currentLogoImg = img;
        if (logoPreviewThumb) {
          logoPreviewThumb.src = url;
          logoPreviewThumb.classList.remove('hidden');
        }
        renderPreview();
      };
      img.src = url;
    }
  });

  // Position anchors
  anchorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      anchorButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      config.anchor = btn.getAttribute('data-anchor') || 'bottom-right';
      renderPreview();
    });
  });

  // Sliders binding
  sliderSize?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (config.type === 'text') {
      config.fontSize = val;
    } else {
      config.scale = val;
    }
    updateLabels();
    renderPreview();
  });

  sliderOpacity?.addEventListener('input', (e) => {
    config.opacity = parseFloat(e.target.value);
    updateLabels();
    renderPreview();
  });

  sliderOffsetX?.addEventListener('input', (e) => {
    config.offsetX = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });

  sliderOffsetY?.addEventListener('input', (e) => {
    config.offsetY = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });

  sliderRotation?.addEventListener('input', (e) => {
    config.rotation = parseInt(e.target.value, 10);
    updateLabels();
    renderPreview();
  });

  frameScrubber?.addEventListener('input', (e) => {
    const time = parseFloat(e.target.value);
    seekPreviewFrame(time);
  });

  btnReset?.addEventListener('click', () => {
    config.offsetX = 0;
    config.offsetY = 0;
    config.rotation = 0;
    config.opacity = 0.85;
    config.fontWeight = '700';
    if (fontWeightSelect) fontWeightSelect.value = '700';
    if (config.type === 'text') {
      config.fontSize = 42;
      if (sliderSize) sliderSize.value = 42;
    } else {
      config.scale = 0.6;
      if (sliderSize) sliderSize.value = 0.6;
    }
    if (sliderOffsetX) sliderOffsetX.value = 0;
    if (sliderOffsetY) sliderOffsetY.value = 0;
    if (sliderRotation) sliderRotation.value = 0;
    if (sliderOpacity) sliderOpacity.value = 0.85;
    updateLabels();
    renderPreview();
  });

  // Adder Mode Switcher Logic
  let currentAdderMode = 'single';
  function switchAdderMode(mode) {
    currentAdderMode = mode;
    if (mode === 'single') {
      btnModeSingle?.classList.add('active');
      btnModeBulk?.classList.remove('active');
      containerSingle?.classList.remove('hidden');
      containerBulk?.classList.add('hidden');
      queueWrapper?.classList.add('hidden');
      if (btnExport) btnExport.classList.remove('hidden');
    } else {
      btnModeBulk?.classList.add('active');
      btnModeSingle?.classList.remove('active');
      containerBulk?.classList.remove('hidden');
      containerSingle?.classList.add('hidden');
      if (bulkAdder && bulkAdder.queue.length > 0) {
        queueWrapper?.classList.remove('hidden');
      }
      if (btnExport) btnExport.classList.add('hidden');
    }
  }

  btnModeSingle?.addEventListener('click', () => switchAdderMode('single'));
  btnModeBulk?.addEventListener('click', () => switchAdderMode('bulk'));

  const bulkAdder = new BulkVideoAdderQueue(
    adderEngine,
    () => config,
    () => currentLogoImg,
    (file) => handleVideoFile(file, true)
  );

  // Video Drag and Drop
  dropzone.onclick = () => {
    if (!isProcessing) fileInput.click();
  };

  dropzone.ondragover = (e) => {
    e.preventDefault();
    if (!isProcessing) dropzone.classList.add('drag-over');
  };

  dropzone.ondragleave = () => dropzone.classList.remove('drag-over');

  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (isProcessing) return;
    if (e.dataTransfer.files.length > 1) {
      switchAdderMode('bulk');
      bulkAdder.addFiles(e.dataTransfer.files);
    } else if (e.dataTransfer.files.length === 1) {
      handleVideoFile(e.dataTransfer.files[0]);
    }
  };

  fileInput.onchange = (e) => {
    if (isProcessing) return;
    if (e.target.files.length > 1) {
      switchAdderMode('bulk');
      bulkAdder.addFiles(e.target.files);
    } else if (e.target.files.length === 1) {
      handleVideoFile(e.target.files[0]);
    }
    fileInput.value = '';
  };

  async function handleVideoFile(file, isBulk = false) {
    if (!file.type.startsWith('video/')) return;
    if (isProcessing) return;

    if (!isBulk) {
      setDropzoneLoading(true, 'Reading video frames...');
      resultsArea?.classList.add('hidden');
      statusContainer?.classList.add('hidden');
      tunerContainer?.classList.add('hidden');
    }
    currentVideoFile = file;

    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.src = url;

      await new Promise((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error('Could not read video metadata.'));
      });

      currentVideoElement = v;
      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      if (frameScrubber) {
        frameScrubber.min = 0;
        frameScrubber.max = duration;
        frameScrubber.step = 0.1;
        frameScrubber.value = Math.min(0.5, duration / 2);
      }

      seekPreviewFrame(Math.min(0.5, duration / 2));

      tunerContainer?.classList.remove('hidden');
      if (currentAdderMode === 'bulk') {
        btnExport?.classList.add('hidden');
      } else {
        btnExport?.classList.remove('hidden');
      }
      updateLabels();
      if (!isBulk && typeof smoothScrollTo === 'function') smoothScrollTo(tunerContainer);
    } catch (err) {
      console.error(err);
      if (!isBulk) alert('Could not initialize video preview: ' + err.message);
    } finally {
      if (!isBulk) setDropzoneLoading(false);
    }
  }

  // Export video with watermark overlay
  btnExport?.addEventListener('click', async () => {
    if (!currentVideoFile) return;

    if (config.type === 'text' && !config.text.trim()) {
      alert('Please enter text for your watermark.');
      return;
    }
    if (config.type === 'image' && !currentLogoImg) {
      alert('Please upload a logo image for your watermark.');
      return;
    }

    if (config.type === 'text') {
      try {
        await ensureFontLoaded(config.fontFamily, config.fontWeight);
      } catch (e) {
        console.warn('Ensure font error before export:', e);
      }
    }

    tunerContainer?.classList.add('hidden');
    statusContainer?.classList.remove('hidden');
    resultsArea?.classList.add('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
    if (typeof smoothScrollTo === 'function') smoothScrollTo(statusContainer);

    try {
      const res = await adderEngine.process(currentVideoFile, config, currentLogoImg, {
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressText) progressText.textContent = `${pct}% — keep tab open`;
        }
      });

      statusContainer?.classList.add('hidden');
      resultsArea?.classList.remove('hidden');

      resultsArea.innerHTML = `
        <div class="card">
          <h3 class="font-bold text-center mb-4">Video Watermark Added Successfully!</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p class="text-xs mb-2">Original Video</p>
              <video src="${res.originalUrl}" controls playsinline style="width:100%; max-height:280px;"></video>
            </div>
            <div>
              <p class="text-xs mb-2 text-green-600">Watermarked Video</p>
              <video src="${res.url}" controls playsinline style="width:100%; max-height:280px;"></video>
            </div>
          </div>
          <div class="mt-4 text-center">
            <a href="${res.url}" download="watermarked_${currentVideoFile.name}" class="btn btn-primary">
              <iconify-icon icon="ph:download-simple-bold" width="16"></iconify-icon>
              Download Watermarked MP4
            </a>
          </div>
        </div>
      `;
      if (typeof smoothScrollTo === 'function') smoothScrollTo(resultsArea);
    } catch (err) {
      console.error(err);
      statusContainer?.classList.add('hidden');
      tunerContainer?.classList.remove('hidden');
      alert(`Watermark processing failed: ${err.message || err}`);
    }
  });
}

// ── Expose globals to window ──
window.VideoWatermarkAdderEngine = VideoWatermarkAdderEngine;
window.BulkVideoAdderQueue = BulkVideoAdderQueue;
window.initVideoWatermarkAdder = initVideoWatermarkAdder;
