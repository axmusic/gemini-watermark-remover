// ── UI Controller, Tab Management, and DOM Interactions ──

let currentTab = 'image';
let watermarkEngine = null;
let videoEngine = null;

function smoothScrollTo(element, offset = 75) {
  if (!element) return;
  setTimeout(() => {
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const targetY = rect.top + scrollTop - offset;
    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: 'smooth'
    });
  }, 100);
}

function stepSlider(slider, direction) {
  if (!slider) return;
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const step = parseFloat(slider.step) || 1;
  const currentVal = parseFloat(slider.value) || 0;

  const stepStr = (slider.step || '').toString();
  const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;

  let nextVal = currentVal + direction * step;
  if (Number.isFinite(min)) nextVal = Math.max(min, nextVal);
  if (Number.isFinite(max)) nextVal = Math.min(max, nextVal);

  slider.value = nextVal.toFixed(decimals);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

function initSliderButtons() {
  document.querySelectorAll('.btn-slider-step').forEach((btn) => {
    const targetId = btn.getAttribute('data-target');
    const dir = parseFloat(btn.getAttribute('data-dir')) || 1;
    let stepTimer = null;
    let repeatInterval = null;

    const doStep = () => {
      const slider = document.getElementById(targetId);
      if (slider) {
        stepSlider(slider, dir);
      }
    };

    const stopRepeat = () => {
      if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
      if (repeatInterval) { clearInterval(repeatInterval); repeatInterval = null; }
    };

    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      doStep();
      stepTimer = setTimeout(() => {
        repeatInterval = setInterval(doStep, 70);
      }, 300);
    });

    btn.addEventListener('mouseup', stopRepeat);
    btn.addEventListener('mouseleave', stopRepeat);

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      doStep();
      stepTimer = setTimeout(() => {
        repeatInterval = setInterval(doStep, 70);
      }, 300);
    }, { passive: false });

    btn.addEventListener('touchend', stopRepeat);
    btn.addEventListener('touchcancel', stopRepeat);
  });
}

function init() {
  initTabs();
  initImageRemover();
  initVideoRemover();
  if (typeof initVideoWatermarkAdder === 'function') {
    initVideoWatermarkAdder();
  }
  initSliderButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function initTabs() {
  const tabImage = document.getElementById('tab-image');
  const tabVideo = document.getElementById('tab-video');
  const tabAddWatermark = document.getElementById('tab-add-watermark');
  const panelImage = document.getElementById('panel-image');
  const panelVideo = document.getElementById('panel-video');
  const panelAddWatermark = document.getElementById('panel-add-watermark');

  if (!tabImage || !tabVideo || !panelImage || !panelVideo) return;

  function switchTab(target, updateHash = false) {
    if (target === 'image') {
      currentTab = 'image';
      try { sessionStorage.setItem('activeTab', 'image'); } catch (e) { }
      tabImage.classList.add('active');
      tabVideo.classList.remove('active');
      tabAddWatermark?.classList.remove('active');
      panelImage.style.display = 'block';
      panelVideo.style.display = 'none';
      if (panelAddWatermark) panelAddWatermark.style.display = 'none';
      panelImage.classList.remove('hidden');
      panelVideo.classList.add('hidden');
      if (panelAddWatermark) panelAddWatermark.classList.add('hidden');
      if (updateHash && (window.location.hash.toLowerCase().includes('video') || window.location.hash.toLowerCase().includes('watermark'))) {
        try {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch (e) { }
      }
    } else if (target === 'video') {
      currentTab = 'video';
      try { sessionStorage.setItem('activeTab', 'video'); } catch (e) { }
      tabVideo.classList.add('active');
      tabImage.classList.remove('active');
      tabAddWatermark?.classList.remove('active');
      panelVideo.style.display = 'block';
      panelImage.style.display = 'none';
      if (panelAddWatermark) panelAddWatermark.style.display = 'none';
      panelVideo.classList.remove('hidden');
      panelImage.classList.add('hidden');
      if (panelAddWatermark) panelAddWatermark.classList.add('hidden');
      if (updateHash) {
        try {
          history.replaceState(null, '', window.location.pathname + window.location.search + '#video');
        } catch (e) { }
      }
    } else if (target === 'add-watermark') {
      currentTab = 'add-watermark';
      try { sessionStorage.setItem('activeTab', 'add-watermark'); } catch (e) { }
      tabAddWatermark?.classList.add('active');
      tabImage.classList.remove('active');
      tabVideo.classList.remove('active');
      if (panelAddWatermark) panelAddWatermark.style.display = 'block';
      panelImage.style.display = 'none';
      panelVideo.style.display = 'none';
      if (panelAddWatermark) panelAddWatermark.classList.remove('hidden');
      panelImage.classList.add('hidden');
      panelVideo.classList.add('hidden');
      if (updateHash) {
        try {
          history.replaceState(null, '', window.location.pathname + window.location.search + '#add-watermark');
        } catch (e) { }
      }
    }
  }

  tabImage.onclick = (e) => {
    e.preventDefault();
    switchTab('image', true);
  };

  tabVideo.onclick = (e) => {
    e.preventDefault();
    switchTab('video', true);
  };

  if (tabAddWatermark) {
    tabAddWatermark.onclick = (e) => {
      e.preventDefault();
      switchTab('add-watermark', true);
    };
  }

  // Deep-link check for video or add-watermark intent (from search engines or internal links)
  function checkUrlIntent() {
    const hash = (window.location.hash || '').toLowerCase();
    const urlParams = new URLSearchParams(window.location.search);
    const param = (urlParams.get('tab') || urlParams.get('type') || '').toLowerCase();

    if (hash === '#add-watermark' || hash === '#panel-add-watermark' || param === 'add-watermark' || param === 'watermark' || param === 'adder') {
      switchTab('add-watermark');
      return true;
    }
    if (hash === '#video' || hash === '#panel-video' || param === 'video') {
      switchTab('video');
      return true;
    }
    return false;
  }

  if (!checkUrlIntent()) {
    try {
      const savedTab = sessionStorage.getItem('activeTab');
      if (savedTab === 'add-watermark') {
        switchTab('add-watermark');
      } else if (savedTab === 'video') {
        switchTab('video');
      } else if (savedTab === 'image') {
        switchTab('image');
      }
    } catch (e) { }
  }

  window.addEventListener('hashchange', () => {
    checkUrlIntent();
  });

  // Attach click listeners to any links pointing to video or add-watermark tab
  document.querySelectorAll('a[href="#panel-video"], a[href="#video"]').forEach(link => {
    link.addEventListener('click', () => {
      switchTab('video', true);
    });
  });

  document.querySelectorAll('a[href="#panel-add-watermark"], a[href="#add-watermark"]').forEach(link => {
    link.addEventListener('click', () => {
      switchTab('add-watermark', true);
    });
  });
}

function initImageRemover() {
  const dropzone = document.getElementById('img-dropzone');
  const fileInput = document.getElementById('img-input');
  const resultsArea = document.getElementById('img-results');

  const tunerContainer = document.getElementById('img-tuner-container');
  const mainCanvas = document.getElementById('img-main-canvas');
  const zoomCanvas = document.getElementById('img-zoom-canvas');
  const zoomCleanedCanvas = document.getElementById('img-zoom-cleaned-canvas');

  const sliderGain = document.getElementById('slider-img-gain');
  const sliderScale = document.getElementById('slider-img-scale');
  const sliderOffsetX = document.getElementById('slider-img-offset-x');
  const sliderOffsetY = document.getElementById('slider-img-offset-y');

  const lblGain = document.getElementById('lbl-img-gain');
  const lblScale = document.getElementById('lbl-img-scale');
  const lblOffsetX = document.getElementById('lbl-img-offset-x');
  const lblOffsetY = document.getElementById('lbl-img-offset-y');

  const btnResetSliders = document.getElementById('btn-img-reset-sliders');
  const btnExport = document.getElementById('btn-img-export');

  if (!dropzone || !fileInput) return;

  let currentFile = null;
  let currentPreviewFrame = null;
  let currentBase = null;
  let currentOriginalBitmap = null;
  let currentDetected = null;
  let isProcessing = false;

  const currentSettings = { gain: 0.6, offsetX: -128, offsetY: -128, sizeScale: 1 };

  function setDropzoneLoading(loading, message = 'Processing image...') {
    isProcessing = loading;
    if (loading) {
      dropzone.classList.add('loading');
      dropzone.innerHTML = `
        <div class="dropzone-loader">
          <div class="dropzone-spinner"></div>
          <p class="dropzone-title text-indigo-600">${message}</p>
          <p class="dropzone-sub">Please wait, analyzing watermark...</p>
        </div>
      `;
    } else {
      dropzone.classList.remove('loading');
      dropzone.innerHTML = `
        <div class="dropzone-icon">
          <iconify-icon icon="ph:upload-simple-bold"></iconify-icon>
        </div>
        <p class="dropzone-title">Upload or drag your Gemini Image</p>
        <p class="dropzone-sub">Supports PNG, JPG, WebP</p>
      `;
    }
  }

  function updateSliderLabels() {
    if (lblGain) lblGain.textContent = `${currentSettings.gain.toFixed(2)}x`;
    if (lblScale) lblScale.textContent = `${currentSettings.sizeScale.toFixed(2)}x`;
    if (lblOffsetX) lblOffsetX.textContent = `${currentSettings.offsetX}px`;
    if (lblOffsetY) lblOffsetY.textContent = `${currentSettings.offsetY}px`;
  }

  function updateDetectBadge() {
    const badgeEl = document.getElementById('img-detect-badge');
    if (!badgeEl) return;
    if (currentDetected) {
      if (currentDetected.matchFound) {
        badgeEl.className = 'detect-badge';
        badgeEl.innerHTML = `<iconify-icon icon="ph:scan" width="16" style="color: #6366f1;"></iconify-icon> <span>Auto-Detected: <strong>${currentDetected.name}</strong> (${Math.round(currentDetected.score * 100)}% match)</span>`;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.className = 'detect-badge warning';
        badgeEl.innerHTML = `<iconify-icon icon="ph:info" width="16" style="color: #d97706;"></iconify-icon> <span>Standard Preset Applied (${currentDetected.name})</span>`;
        badgeEl.classList.remove('hidden');
      }
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  function applyAutoSettings() {
    const w = currentPreviewFrame ? currentPreviewFrame.width : 1536;
    const h = currentPreviewFrame ? currentPreviewFrame.height : 1536;

    let p;
    if (currentDetected) {
      p = {
        gain: currentDetected.gain,
        offsetX: currentDetected.offsetX,
        offsetY: currentDetected.offsetY,
        sizeScale: currentDetected.sizeScale
      };
    } else {
      p = getAdaptiveImagePreset('new', w, h);
    }
    Object.assign(currentSettings, p);

    if (sliderOffsetX) {
      sliderOffsetX.min = -Math.round(w * 0.45);
      sliderOffsetX.max = Math.round(w * 0.2);
      sliderOffsetX.value = currentSettings.offsetX;
    }
    if (sliderOffsetY) {
      sliderOffsetY.min = -Math.round(h * 0.45);
      sliderOffsetY.max = Math.round(h * 0.2);
      sliderOffsetY.value = currentSettings.offsetY;
    }
    if (sliderGain) sliderGain.value = currentSettings.gain;
    if (sliderScale) sliderScale.value = currentSettings.sizeScale;

    const activeKey = (currentDetected && currentDetected.presetKey) || 'new';
    document.querySelectorAll('#panel-image .btn-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.preset === activeKey);
    });

    updateSliderLabels();
    updateDetectBadge();
    renderTuner();
  }

  const imgPresetButtons = document.querySelectorAll('#panel-image .btn-preset');
  imgPresetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      imgPresetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const presetKey = btn.dataset.preset;
      const w = currentPreviewFrame ? currentPreviewFrame.width : 1536;
      const h = currentPreviewFrame ? currentPreviewFrame.height : 1536;
      const p = getAdaptiveImagePreset(presetKey, w, h);
      Object.assign(currentSettings, p);
      if (sliderOffsetX) sliderOffsetX.value = currentSettings.offsetX;
      if (sliderOffsetY) sliderOffsetY.value = currentSettings.offsetY;
      if (sliderGain) sliderGain.value = currentSettings.gain;
      if (sliderScale) sliderScale.value = currentSettings.sizeScale;
      updateSliderLabels();
      renderTuner();
    });
  });

  function bindSlider(element, prop, isFloat = false) {
    if (!element) return;
    element.addEventListener('input', (e) => {
      currentSettings[prop] = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
      updateSliderLabels();
      renderTuner();
    });
  }

  bindSlider(sliderGain, 'gain', true);
  bindSlider(sliderScale, 'sizeScale', true);
  bindSlider(sliderOffsetX, 'offsetX', false);
  bindSlider(sliderOffsetY, 'offsetY', false);

  btnResetSliders?.addEventListener('click', () => {
    applyAutoSettings();
  });

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
    if (e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0]);
  };

  fileInput.onchange = (e) => {
    if (isProcessing) return;
    if (e.target.files.length) handleImageFile(e.target.files[0]);
    fileInput.value = '';
  };

  function renderTuner() {
    if (!currentPreviewFrame || !mainCanvas || !watermarkEngine) return;
    const { width, height, imageData } = currentPreviewFrame;

    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;

    const copy = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
    const { wm, roi } = cleanFrame(watermarkEngine.bg96, copy, width, height, currentBase, currentSettings);
    offscreen.getContext('2d').putImageData(copy, 0, 0);

    const maxW = 360;
    const scale = Math.min(1, maxW / width);
    mainCanvas.width = Math.round(width * scale);
    mainCanvas.height = Math.round(height * scale);
    const mctx = mainCanvas.getContext('2d');
    mctx.drawImage(offscreen, 0, 0, mainCanvas.width, mainCanvas.height);
    mctx.strokeStyle = '#6366f1';
    mctx.lineWidth = 2;
    mctx.strokeRect(wm.x * scale, wm.y * scale, wm.width * scale, wm.height * scale);

    if (zoomCanvas && currentOriginalBitmap) {
      const zctx = zoomCanvas.getContext('2d');
      zctx.imageSmoothingEnabled = false;
      zctx.clearRect(0, 0, zoomCanvas.width, zoomCanvas.height);
      zctx.drawImage(currentOriginalBitmap, roi.x, roi.y, roi.width, roi.height, 0, 0, zoomCanvas.width, zoomCanvas.height);
      const sx = zoomCanvas.width / roi.width;
      const sy = zoomCanvas.height / roi.height;
      zctx.strokeStyle = '#2563eb';
      zctx.lineWidth = 2;
      zctx.strokeRect((wm.x - roi.x) * sx, (wm.y - roi.y) * sy, wm.width * sx, wm.height * sy);
    }

    if (zoomCleanedCanvas) {
      const zctx = zoomCleanedCanvas.getContext('2d');
      zctx.imageSmoothingEnabled = false;
      zctx.clearRect(0, 0, zoomCleanedCanvas.width, zoomCleanedCanvas.height);

      zctx.drawImage(offscreen, roi.x, roi.y, roi.width, roi.height, 0, 0, zoomCleanedCanvas.width, zoomCleanedCanvas.height);

      const sx = zoomCleanedCanvas.width / roi.width;
      const sy = zoomCleanedCanvas.height / roi.height;
      zctx.strokeStyle = '#16a34a';
      zctx.lineWidth = 2;
      zctx.strokeRect((wm.x - roi.x) * sx, (wm.y - roi.y) * sy, wm.width * sx, wm.height * sy);
    }
  }

  async function handleImageFile(file) {
    if (!file.type.startsWith('image/')) return;
    if (isProcessing) return;

    setDropzoneLoading(true, 'Processing & Detecting Watermark...');
    currentFile = file;

    resultsArea.classList.add('hidden');
    tunerContainer.classList.add('hidden');

    try {
      if (!watermarkEngine) {
        watermarkEngine = await WatermarkEngine.create();
      }

      currentPreviewFrame = await grabImageFrame(file);
      currentBase = watermarkEngine.getWatermarkInfo(currentPreviewFrame.width, currentPreviewFrame.height);
      if (currentOriginalBitmap) currentOriginalBitmap.close();
      currentOriginalBitmap = await createImageBitmap(currentPreviewFrame.imageData);

      // Run Auto-Detection
      currentDetected = detectWatermarkCandidate(currentPreviewFrame.imageData, currentPreviewFrame.width, currentPreviewFrame.height, watermarkEngine.bg96);

      tunerContainer.classList.remove('hidden');
      applyAutoSettings();
      smoothScrollTo(tunerContainer);
    } catch (err) {
      console.error(err);
    } finally {
      setDropzoneLoading(false);
    }
  }

  btnExport?.addEventListener('click', async () => {
    if (!currentFile || !watermarkEngine || !currentPreviewFrame) return;

    tunerContainer.classList.add('hidden');
    resultsArea.classList.add('hidden');

    try {
      const { width, height, imageData } = currentPreviewFrame;
      const copy = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
      cleanFrame(watermarkEngine.bg96, copy, width, height, currentBase, currentSettings);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').putImageData(copy, 0, 0);

      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const originalUrl = URL.createObjectURL(currentFile);
      const url = URL.createObjectURL(blob);

      resultsArea.classList.remove('hidden');
      resultsArea.innerHTML = `
        <div class="card">
          <h3 class="font-bold text-center mb-4">Image Watermark Cleaned Successfully!</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p class="text-xs mb-2">Original (${width}x${height}px)</p>
              <div class="checker p-2 text-center">
                <img src="${originalUrl}" alt="Original image with watermark (${width}x${height}px)" style="max-height: 250px; margin: 0 auto; object-fit: contain; width: 100%;" />
              </div>
            </div>
            <div>
              <p class="text-xs mb-2 text-green-600">Cleaned Result</p>
              <div class="checker p-2 text-center">
                <img src="${url}" alt="Cleaned result image without watermark" style="max-height: 250px; margin: 0 auto; object-fit: contain; width: 100%;" />
              </div>
            </div>
          </div>
          <div class="mt-4 text-center">
            <a href="${url}" download="clean_${currentFile.name}" class="btn btn-primary">
              <iconify-icon icon="ph:download-simple-bold" width="16"></iconify-icon>
              Download Cleaned PNG
            </a>
          </div>
          ${getPromoCardHtml('image')}
        </div>
      `;
      smoothScrollTo(resultsArea);
    } catch (err) {
      console.error(err);
      alert('Error exporting image: ' + err.message);
    }
  });
}

function initVideoRemover() {
  const dropzone = document.getElementById('video-dropzone');
  const fileInput = document.getElementById('video-input');
  const statusContainer = document.getElementById('video-status');
  const progressBar = document.getElementById('video-progress-bar');
  const progressText = document.getElementById('video-progress-text');
  const resultsArea = document.getElementById('video-results');

  const tunerContainer = document.getElementById('video-tuner-container');
  const mainCanvas = document.getElementById('video-main-canvas');
  const zoomCanvas = document.getElementById('video-zoom-canvas');
  const zoomCleanedCanvas = document.getElementById('video-zoom-cleaned-canvas');

  const sliderGain = document.getElementById('slider-video-gain');
  const sliderScale = document.getElementById('slider-video-scale');
  const sliderOffsetX = document.getElementById('slider-video-offset-x');
  const sliderOffsetY = document.getElementById('slider-video-offset-y');

  const lblGain = document.getElementById('lbl-video-gain');
  const lblScale = document.getElementById('lbl-video-scale');
  const lblOffsetX = document.getElementById('lbl-video-offset-x');
  const lblOffsetY = document.getElementById('lbl-video-offset-y');

  const btnResetSliders = document.getElementById('btn-video-reset-sliders');
  const btnExport = document.getElementById('btn-video-export');

  // Video Mode Switcher Buttons
  const btnModeSingle = document.getElementById('btn-video-mode-single');
  const btnModeBulk = document.getElementById('btn-video-mode-bulk');
  const containerSingle = document.getElementById('video-single-container');
  const containerBulk = document.getElementById('video-bulk-container');

  if (!dropzone || !fileInput) return;

  let currentFile = null;
  let currentPreviewFrame = null;
  let currentBase = null;
  let currentOriginalBitmap = null;
  let currentDetected = null;
  let isProcessing = false;

  const currentSettings = { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1 };

  const getOrInitVideoEngine = async () => {
    if (!videoEngine) {
      videoEngine = await VideoWatermarkEngine.create();
    }
    return videoEngine;
  };

  const bulkProcessor = new BulkVideoQueue(getOrInitVideoEngine, grabPreviewFrame);

  function switchVideoMode(mode) {
    if (mode === 'single') {
      btnModeSingle?.classList.add('active');
      btnModeBulk?.classList.remove('active');
      containerSingle?.classList.remove('hidden');
      containerBulk?.classList.add('hidden');
    } else {
      btnModeBulk?.classList.add('active');
      btnModeSingle?.classList.remove('active');
      containerBulk?.classList.remove('hidden');
      containerSingle?.classList.add('hidden');
    }
  }

  btnModeSingle?.addEventListener('click', () => switchVideoMode('single'));
  btnModeBulk?.addEventListener('click', () => switchVideoMode('bulk'));

  function setDropzoneLoading(loading, message = 'Extracting best frame...') {
    isProcessing = loading;
    if (loading) {
      dropzone.classList.add('loading');
      dropzone.innerHTML = `
        <div class="dropzone-loader">
          <div class="dropzone-spinner"></div>
          <p class="dropzone-title text-indigo-600">${message}</p>
          <p class="dropzone-sub">Scanning video frames & auto-detecting watermark...</p>
        </div>
      `;
    } else {
      dropzone.classList.remove('loading');
      dropzone.innerHTML = `
        <div class="dropzone-icon">
          <iconify-icon icon="ph:video-bold"></iconify-icon>
        </div>
        <p class="dropzone-title">Upload or drag a Gemini Veo 3 video</p>
        <p class="dropzone-sub">Supports MP4, WebM, MOV (Drop multiple files for Bulk Mode)</p>
      `;
    }
  }

  function updateSliderLabels() {
    if (lblGain) lblGain.textContent = `${currentSettings.gain.toFixed(2)}x`;
    if (lblScale) lblScale.textContent = `${currentSettings.sizeScale.toFixed(2)}x`;
    if (lblOffsetX) lblOffsetX.textContent = `${currentSettings.offsetX}px`;
    if (lblOffsetY) lblOffsetY.textContent = `${currentSettings.offsetY}px`;
  }

  function updateDetectBadge() {
    const badgeEl = document.getElementById('video-detect-badge');
    if (!badgeEl) return;
    if (currentDetected) {
      if (currentDetected.matchFound) {
        badgeEl.className = 'detect-badge';
        badgeEl.innerHTML = `<iconify-icon icon="ph:scan" width="16" style="color: #6366f1;"></iconify-icon> <span>Auto-Detected: <strong>${currentDetected.name}</strong> (${Math.round(currentDetected.score * 100)}% match)</span>`;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.className = 'detect-badge warning';
        badgeEl.innerHTML = `<iconify-icon icon="ph:info" width="16" style="color: #d97706;"></iconify-icon> <span>Standard Preset Applied (${currentDetected.name})</span>`;
        badgeEl.classList.remove('hidden');
      }
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  function applyAutoSettings() {
    const w = currentPreviewFrame ? currentPreviewFrame.width : 720;
    const h = currentPreviewFrame ? currentPreviewFrame.height : 720;

    let p;
    if (currentDetected) {
      p = {
        gain: currentDetected.gain,
        offsetX: currentDetected.offsetX,
        offsetY: currentDetected.offsetY,
        sizeScale: currentDetected.sizeScale
      };
    } else {
      p = getAdaptiveVideoPreset('veo', w, h);
    }
    Object.assign(currentSettings, p);

    if (sliderOffsetX) {
      sliderOffsetX.min = -Math.round(w * 0.45);
      sliderOffsetX.max = Math.round(w * 0.2);
      sliderOffsetX.value = currentSettings.offsetX;
    }
    if (sliderOffsetY) {
      sliderOffsetY.min = -Math.round(h * 0.45);
      sliderOffsetY.max = Math.round(h * 0.2);
      sliderOffsetY.value = currentSettings.offsetY;
    }
    if (sliderGain) sliderGain.value = currentSettings.gain;
    if (sliderScale) sliderScale.value = currentSettings.sizeScale;

    const activeKey = (currentDetected && currentDetected.presetKey) || 'veo';
    document.querySelectorAll('#panel-video .btn-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.preset === activeKey);
    });

    updateSliderLabels();
    updateDetectBadge();
    renderTuner();
  }

  const vidPresetButtons = document.querySelectorAll('#panel-video .btn-preset');
  vidPresetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      vidPresetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const presetKey = btn.dataset.preset;
      const w = currentPreviewFrame ? currentPreviewFrame.width : 720;
      const h = currentPreviewFrame ? currentPreviewFrame.height : 720;
      const p = getAdaptiveVideoPreset(presetKey, w, h);
      Object.assign(currentSettings, p);
      if (sliderOffsetX) sliderOffsetX.value = currentSettings.offsetX;
      if (sliderOffsetY) sliderOffsetY.value = currentSettings.offsetY;
      if (sliderGain) sliderGain.value = currentSettings.gain;
      if (sliderScale) sliderScale.value = currentSettings.sizeScale;
      updateSliderLabels();
      renderTuner();
    });
  });

  function bindSlider(element, prop, isFloat = false) {
    if (!element) return;
    element.addEventListener('input', (e) => {
      currentSettings[prop] = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
      updateSliderLabels();
      renderTuner();
    });
  }

  bindSlider(sliderGain, 'gain', true);
  bindSlider(sliderScale, 'sizeScale', true);
  bindSlider(sliderOffsetX, 'offsetX', false);
  bindSlider(sliderOffsetY, 'offsetY', false);

  btnResetSliders?.addEventListener('click', () => {
    applyAutoSettings();
  });

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
      switchVideoMode('bulk');
      bulkProcessor.addFiles(e.dataTransfer.files);
    } else if (e.dataTransfer.files.length === 1) {
      handleVideoFile(e.dataTransfer.files[0]);
    }
  };

  fileInput.onchange = (e) => {
    if (isProcessing) return;
    if (e.target.files.length > 1) {
      switchVideoMode('bulk');
      bulkProcessor.addFiles(e.target.files);
    } else if (e.target.files.length === 1) {
      handleVideoFile(e.target.files[0]);
    }
    fileInput.value = '';
  };

  function renderTuner() {
    if (!currentPreviewFrame || !mainCanvas || !videoEngine) return;
    const { width, height, imageData } = currentPreviewFrame;

    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;

    const copy = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
    const { wm, roi } = cleanFrame(videoEngine.sparkleImage, copy, width, height, currentBase, currentSettings);
    offscreen.getContext('2d').putImageData(copy, 0, 0);

    const maxW = 360;
    const scale = Math.min(1, maxW / width);
    mainCanvas.width = Math.round(width * scale);
    mainCanvas.height = Math.round(height * scale);
    const mctx = mainCanvas.getContext('2d');
    mctx.drawImage(offscreen, 0, 0, mainCanvas.width, mainCanvas.height);
    mctx.strokeStyle = '#6366f1';
    mctx.lineWidth = 2;
    mctx.strokeRect(wm.x * scale, wm.y * scale, wm.width * scale, wm.height * scale);

    if (zoomCanvas && currentOriginalBitmap) {
      const zctx = zoomCanvas.getContext('2d');
      zctx.imageSmoothingEnabled = false;
      zctx.clearRect(0, 0, zoomCanvas.width, zoomCanvas.height);
      zctx.drawImage(currentOriginalBitmap, roi.x, roi.y, roi.width, roi.height, 0, 0, zoomCanvas.width, zoomCanvas.height);
      const sx = zoomCanvas.width / roi.width;
      const sy = zoomCanvas.height / roi.height;
      zctx.strokeStyle = '#2563eb';
      zctx.lineWidth = 2;
      zctx.strokeRect((wm.x - roi.x) * sx, (wm.y - roi.y) * sy, wm.width * sx, wm.height * sy);
    }

    if (zoomCleanedCanvas) {
      const zctx = zoomCleanedCanvas.getContext('2d');
      zctx.imageSmoothingEnabled = false;
      zctx.clearRect(0, 0, zoomCleanedCanvas.width, zoomCleanedCanvas.height);
      zctx.drawImage(offscreen, roi.x, roi.y, roi.width, roi.height, 0, 0, zoomCleanedCanvas.width, zoomCleanedCanvas.height);
      const sx = zoomCleanedCanvas.width / roi.width;
      const sy = zoomCleanedCanvas.height / roi.height;
      zctx.strokeStyle = '#16a34a';
      zctx.lineWidth = 2;
      zctx.strokeRect((wm.x - roi.x) * sx, (wm.y - roi.y) * sy, wm.width * sx, wm.height * sy);
    }
  }

  async function handleVideoFile(file) {
    if (!file.type.startsWith('video/')) return;
    if (isProcessing) return;

    setDropzoneLoading(true, 'Extracting Best Frame & Analyzing...');
    currentFile = file;

    resultsArea.classList.add('hidden');
    statusContainer.classList.add('hidden');
    tunerContainer.classList.add('hidden');

    try {
      const engine = await getOrInitVideoEngine();

      currentPreviewFrame = await grabPreviewFrame(file);
      currentBase = engine.getVeoWatermark(currentPreviewFrame.width, currentPreviewFrame.height);
      if (currentOriginalBitmap) currentOriginalBitmap.close();
      currentOriginalBitmap = await createImageBitmap(currentPreviewFrame.imageData);

      currentDetected = detectVideoWatermarkCandidate(currentPreviewFrame.imageData, currentPreviewFrame.width, currentPreviewFrame.height, engine.sparkleImage);

      tunerContainer.classList.remove('hidden');
      applyAutoSettings();
      smoothScrollTo(tunerContainer);
    } catch (err) {
      console.error(err);
      alert('Could not generate preview frame for video: ' + (err.message || err));
    } finally {
      setDropzoneLoading(false);
    }
  }

  btnExport?.addEventListener('click', async () => {
    if (!currentFile) return;

    tunerContainer.classList.add('hidden');
    statusContainer.classList.remove('hidden');
    resultsArea.classList.add('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    smoothScrollTo(statusContainer);

    try {
      const engine = await getOrInitVideoEngine();
      const res = await engine.process(currentFile, {
        ...currentSettings,
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `${pct}% — keep tab open`;
        }
      });

      statusContainer.classList.add('hidden');
      resultsArea.classList.remove('hidden');

      resultsArea.innerHTML = `
        <div class="card">
          <h3 class="font-bold text-center mb-4">Video Watermark Cleaned Successfully!</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p class="text-xs mb-2">Original Video</p>
              <video src="${res.originalUrl}" controls playsinline style="width:100%; max-height:280px;"></video>
            </div>
            <div>
              <p class="text-xs mb-2 text-green-600">Cleaned Video</p>
              <video src="${res.url}" controls playsinline style="width:100%; max-height:280px;"></video>
            </div>
          </div>
          <div class="mt-4 text-center">
            <a href="${res.url}" download="clean_${currentFile.name}" class="btn btn-primary">
              <iconify-icon icon="ph:download-simple-bold" width="16"></iconify-icon>
              Download Cleaned Video MP4
            </a>
          </div>
          ${getPromoCardHtml('video')}
        </div>
      `;
      smoothScrollTo(resultsArea);
    } catch (err) {
      console.error(err);
      statusContainer.classList.add('hidden');
      tunerContainer.classList.remove('hidden');
      alert(`Video processing failed: ${err.message || err}`);
    }
  });
}

// ── Results Screen Promo Card Generator ──
function getPromoCardHtml(type = 'image') {
  return '';
}

// ── GitHub Star Count Fetcher ──
async function fetchGitHubStars() {
  const starCountEl = document.getElementById('star-count-num');
  if (!starCountEl) return;
  try {
    const res = await fetch('https://api.github.com/repos/axmusic/gemini-watermark-remover');
    if (res.ok) {
      const data = await res.json();
      if (typeof data.stargazers_count === 'number') {
        starCountEl.textContent = data.stargazers_count;
      }
    }
  } catch (e) {
    console.warn('Could not fetch GitHub star count:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  fetchGitHubStars();
  initCustomSelects();
  initMobileMenu();
  initAutoFavicons();
});
fetchGitHubStars();

// ── Automatic Favicon Resolver for Tools ──
function initAutoFavicons() {
  document.querySelectorAll('[data-auto-favicon]').forEach((el) => {
    const targetUrl = el.getAttribute('data-auto-favicon') || el.getAttribute('href');
    if (!targetUrl) return;

    const img = el.querySelector('.tool-favicon-img');
    if (!img) return;

    try {
      const parsedUrl = new URL(targetUrl, window.location.href);
      const domain = parsedUrl.hostname;
      const directFavicon = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, '')}/assets/favicon-96x96.png`;
      const fallbackFavicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

      img.onerror = () => {
        if (img.src !== fallbackFavicon) {
          img.src = fallbackFavicon;
        }
      };

      if (!img.src || img.src.includes('undefined')) {
        img.src = directFavicon;
      }
    } catch (e) {
      console.warn('Auto favicon parsing failed:', e);
    }
  });
}

// ── Mobile Hamburger Menu & Navbar Interactions ──
function initMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const headerActions = document.getElementById('header-actions');
  if (!menuBtn || !headerActions) return;

  const iconHamburger = menuBtn.querySelector('.icon-hamburger');
  const iconClose = menuBtn.querySelector('.icon-close');

  const closeMenu = () => {
    headerActions.classList.remove('open');
    menuBtn.classList.remove('active');
    menuBtn.setAttribute('aria-expanded', 'false');
    if (iconHamburger && iconClose) {
      iconHamburger.classList.remove('hidden');
      iconClose.classList.add('hidden');
    }
  };

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = headerActions.classList.toggle('open');
    menuBtn.classList.toggle('active', isOpen);
    menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (iconHamburger && iconClose) {
      iconHamburger.classList.toggle('hidden', isOpen);
      iconClose.classList.toggle('hidden', !isOpen);
    }
  });

  // Close mobile menu when clicking nav links or promo links
  headerActions.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      closeMenu();
    });
  });

  document.addEventListener('click', (e) => {
    if (!headerActions.contains(e.target) && !menuBtn.contains(e.target)) {
      closeMenu();
    }
  });

  // Tools dropdown click toggle (for touch/click accessibility)
  const toolsDropdown = document.getElementById('tools-dropdown');
  const toolsBtn = document.getElementById('tools-dropdown-btn');
  if (toolsDropdown && toolsBtn) {
    toolsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = toolsDropdown.classList.toggle('open');
      toolsBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!toolsDropdown.contains(e.target)) {
        toolsDropdown.classList.remove('open');
        toolsBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

// ── Custom Select Component Logic ──
function initCustomSelects() {
  document.querySelectorAll('.custom-select').forEach((selectEl) => {
    const targetId = selectEl.getAttribute('data-select-target');
    const nativeSelect = document.getElementById(targetId);
    if (!nativeSelect) return;

    const trigger = selectEl.querySelector('.custom-select-trigger');
    const valueDisplay = selectEl.querySelector('.custom-select-value');
    const options = selectEl.querySelectorAll('.custom-option');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.custom-select.open').forEach((other) => {
        if (other !== selectEl) other.classList.remove('open');
      });
      selectEl.classList.toggle('open');
    });

    options.forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');
        const text = opt.querySelector('.option-title').textContent;

        valueDisplay.textContent = text;
        options.forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');

        nativeSelect.value = val;
        nativeSelect.dispatchEvent(new Event('change'));

        selectEl.classList.remove('open');
      });
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select.open').forEach((s) => s.classList.remove('open'));
  });
}
