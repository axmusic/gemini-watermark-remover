// ── Direct Link Configuration ──
function handleDownloadAd() { }
window.handleDownloadAd = handleDownloadAd;

function handleExportAd() { }
window.handleExportAd = handleExportAd;

// ── 1. Engine Core (alphaMap, blendModes, geometry, tuner) ──
function calculateAlphaMap(bgCaptureImageData) {
  const { width, height, data } = bgCaptureImageData;
  const alphaMap = new Float32Array(width * height);
  for (let i = 0; i < alphaMap.length; i++) {
    const idx = i * 4;
    const v = Math.max(data[idx], data[idx + 1], data[idx + 2]);
    alphaMap[i] = v <= 4 ? 0 : v / 255.0;
  }
  return alphaMap;
}

const ALPHA_THRESHOLD = 0.002;
const MAX_ALPHA = 0.99;
const LOGO_VALUE = 255;

function removeWatermark(imageData, alphaMap, position, options = {}) {
  const { x, y, width, height } = position;
  const gain = Number.isFinite(options.alphaGain) && options.alphaGain > 0
    ? options.alphaGain
    : 1;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const imgIdx = ((y + row) * imageData.width + (x + col)) * 4;
      const alphaIdx = row * width + col;

      let alpha = alphaMap[alphaIdx] * gain;
      if (alpha < ALPHA_THRESHOLD) continue;
      alpha = Math.min(alpha, MAX_ALPHA);

      for (let c = 0; c < 3; c++) {
        const watermarked = imageData.data[imgIdx + c];
        const original = (watermarked - alpha * LOGO_VALUE) / (1.0 - alpha);
        imageData.data[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
      }
    }
  }
}

function getWatermarkInfo(width, height) {
  const minDim = Math.min(width, height);
  const ratio = minDim / 1536;
  const size = Math.max(16, Math.round(96 * ratio));
  const margin = Math.max(8, Math.round(64 * ratio));

  return {
    size,
    x: Math.max(0, width - margin - size),
    y: Math.max(0, height - margin - size),
    width: size,
    height: size,
  };
}

function getRoi(width, height, wm) {
  const pad = Math.round(wm.size * 0.6);
  const rx = Math.max(0, Math.min(width - 1, wm.x - pad));
  const ry = Math.max(0, Math.min(height - 1, wm.y - pad));
  const rw = Math.max(1, Math.min(width - rx, wm.width + pad * 2));
  const rh = Math.max(1, Math.min(height - ry, wm.height + pad * 2));
  return { x: rx, y: ry, width: rw, height: rh };
}

function resolveBox(base, width, height, opts = {}) {
  const sizeScale = opts.sizeScale || 1;
  const size = Math.max(8, Math.min(Math.round(base.size * sizeScale), Math.min(width, height)));
  const x = Math.max(0, Math.min(base.x + Math.round(opts.offsetX || 0), width - size));
  const y = Math.max(0, Math.min(base.y + Math.round(opts.offsetY || 0), height - size));
  return { size, x, y, width: size, height: size };
}

function buildAlpha(bgImg, roi, wm, gain) {
  const count = roi.width * roi.height;
  const alphaMap = new Float32Array(count);
  const offX = wm.x - roi.x;
  const offY = wm.y - roi.y;

  const c = document.createElement('canvas');
  c.width = wm.size; c.height = wm.size;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bgImg, 0, 0, wm.size, wm.size);
  const data = cx.getImageData(0, 0, wm.size, wm.size).data;

  for (let row = 0; row < wm.size; row++) {
    for (let col = 0; col < wm.size; col++) {
      const ri = (offY + row) * roi.width + (offX + col);
      if (ri < 0 || ri >= count) continue;
      const o = (row * wm.size + col) * 4;
      const rawVal = Math.max(data[o], data[o + 1], data[o + 2]);
      const effectiveVal = rawVal <= 4 ? 0 : rawVal;
      const a = (effectiveVal / 255) * gain;
      alphaMap[ri] = a > 0 ? Math.min(a, 0.99) : 0;
    }
  }
  return alphaMap;
}

function cleanFrame(bgImg, imageData, width, height, base, opts = {}) {
  const wm = resolveBox(base, width, height, opts);
  const roi = getRoi(width, height, wm);
  const alpha = buildAlpha(bgImg, roi, wm, opts.gain ?? 1);
  removeWatermark(imageData, alpha, {
    x: roi.x, y: roi.y, width: roi.width, height: roi.height,
  });
  return { wm, roi };
}

// Inline Base64 Reference Images (guarantees zero CORS/Tainted Canvas errors when double clicked)
const BG_48_BASE64 = "data:image/png;base64,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";
const BG_96_BASE64 = "data:image/png;base64,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";

// ── 2. WatermarkEngine Class ──
class WatermarkEngine {
  constructor(bg48, bg96) {
    this.bg48 = bg48;
    this.bg96 = bg96;
    this.alphaMaps = {};
  }

  static async create() {
    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });

    try {
      const [bg48, bg96] = await Promise.all([
        loadImage(BG_48_BASE64),
        loadImage(BG_96_BASE64)
      ]);
      return new WatermarkEngine(bg48, bg96);
    } catch (e) {
      console.error("Failed to load watermark background assets.", e);
      throw e;
    }
  }

  getWatermarkInfo(width, height) {
    return getWatermarkInfo(width, height);
  }

  async getAlphaMap(size) {
    if (this.alphaMaps[size]) return this.alphaMaps[size];

    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(size <= 48 ? this.bg48 : this.bg96, 0, 0, size, size);

    const map = calculateAlphaMap(ctx.getImageData(0, 0, size, size));
    this.alphaMaps[size] = map;
    return map;
  }

  buildScaledAlphaMap(size) {
    if (this.alphaMaps[size]) return this.alphaMaps[size];

    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.bg96, 0, 0, size, size);

    const map = calculateAlphaMap(ctx.getImageData(0, 0, size, size));
    this.alphaMaps[size] = map;
    return map;
  }

  async process(imageFile) {
    const objectUrl = URL.createObjectURL(imageFile);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const config = this.getWatermarkInfo(canvas.width, canvas.height);

    const alphaMap = await this.getAlphaMap(config.size);
    removeWatermark(imageData, alphaMap, config);

    ctx.putImageData(imageData, 0, 0);

    return {
      blob: await new Promise(r => canvas.toBlob(r, 'image/png')),
      originalSrc: objectUrl,
      width: img.width,
      height: img.height
    };
  }

  async prepareForSize(width, height) {
    const config = this.getWatermarkInfo(width, height);
    const alphaMap = await this.getAlphaMap(config.size);
    return { config, alphaMap };
  }

  removeFromImageData(imageData, prepared) {
    const { config, alphaMap } = prepared || this._sync(imageData.width, imageData.height);
    removeWatermark(imageData, alphaMap, config);
    return imageData;
  }

  _sync(width, height) {
    const config = this.getWatermarkInfo(width, height);
    return { config, alphaMap: this.alphaMaps[config.size] };
  }
}

// ── Image Presets & Adaptive Presets ──
const IMG_PRESETS = {
  new: { gain: 0.6, offsetX: -128, offsetY: -128, sizeScale: 1 },
  classic: { gain: 1, offsetX: 0, offsetY: 0, sizeScale: 1 }
};

function getAdaptiveImagePreset(presetKey, width = 1536, height = 1536) {
  if (presetKey === 'classic') {
    return { gain: 1.0, offsetX: 0, offsetY: 0, sizeScale: 1.0 };
  }
  const minDim = Math.min(width, height || width);
  const scaleRatio = Math.max(0.25, Math.min(1.5, minDim / 1536));
  const adaptiveOffset = Math.round(-128 * scaleRatio);
  return {
    gain: 0.6,
    offsetX: adaptiveOffset,
    offsetY: adaptiveOffset,
    sizeScale: 1.0
  };
}

// ── Advanced Watermark Auto-Detection System (Fused Multi-Scale, Gradient & Dual-Polarity) ──

const alphaTemplateCache = new Map();

function getAlphaTemplateData(bgImg, size) {
  if (alphaTemplateCache.has(size)) {
    return alphaTemplateCache.get(size);
  }
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bgImg, 0, 0, size, size);
  const raw = cx.getImageData(0, 0, size, size).data;

  const alphas = new Float32Array(size * size);
  for (let i = 0; i < alphas.length; i++) {
    const o = i * 4;
    const v = Math.max(raw[o], raw[o + 1], raw[o + 2]);
    alphas[i] = v <= 4 ? 0 : v / 255.0;
  }

  const gradMag = new Float32Array(size * size);
  for (let r = 1; r < size - 1; r++) {
    for (let col = 1; col < size - 1; col++) {
      const idx = r * size + col;
      const gx = alphas[idx + 1] - alphas[idx - 1];
      const gy = alphas[(r + 1) * size + col] - alphas[(r - 1) * size + col];
      gradMag[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  const template = { raw, alphas, gradMag, size };
  alphaTemplateCache.set(size, template);
  return template;
}

function evaluateCandidateMatch(imageData, width, height, bgImg, box) {
  const { x, y, size } = box;
  if (x < 0 || y < 0 || x + size > width || y + size > height || size <= 0) {
    return { score: -1, variance: 0 };
  }

  const template = getAlphaTemplateData(bgImg, size);
  const { alphas, gradMag } = template;

  let sumL = 0, sumA = 0;
  let sumL2 = 0, sumA2 = 0;
  let sumLA = 0;

  let sumInvL = 0;
  let sumInvL2 = 0;
  let sumInvLA = 0;

  let sumG = 0, sumGA = 0;
  let sumG2 = 0, sumGA2 = 0;
  let sumGGA = 0;

  let n = 0;
  let nGrad = 0;

  const step = size > 80 ? 2 : 1;

  for (let r = 0; r < size; r += step) {
    const imgRow = y + r;
    for (let col = 0; col < size; col += step) {
      const imgCol = x + col;
      const imgIdx = (imgRow * width + imgCol) * 4;
      const alphaIdx = r * size + col;

      const rVal = imageData.data[imgIdx];
      const gVal = imageData.data[imgIdx + 1];
      const bVal = imageData.data[imgIdx + 2];
      const lum = 0.299 * rVal + 0.587 * gVal + 0.114 * bVal;
      const invLum = 255.0 - lum;
      const alpha = alphas[alphaIdx];

      sumL += lum;
      sumA += alpha;
      sumL2 += lum * lum;
      sumA2 += alpha * alpha;
      sumLA += lum * alpha;

      sumInvL += invLum;
      sumInvL2 += invLum * invLum;
      sumInvLA += invLum * alpha;
      n++;

      // Gradient analysis (high-frequency diamond sparkle edges)
      if (r > 0 && r < size - 1 && col > 0 && col < size - 1 && imgRow > 0 && imgRow < height - 1 && imgCol > 0 && imgCol < width - 1) {
        const leftIdx = (imgRow * width + (imgCol - 1)) * 4;
        const rightIdx = (imgRow * width + (imgCol + 1)) * 4;
        const upIdx = ((imgRow - 1) * width + imgCol) * 4;
        const downIdx = ((imgRow + 1) * width + imgCol) * 4;

        const lumLeft = 0.299 * imageData.data[leftIdx] + 0.587 * imageData.data[leftIdx + 1] + 0.114 * imageData.data[leftIdx + 2];
        const lumRight = 0.299 * imageData.data[rightIdx] + 0.587 * imageData.data[rightIdx + 1] + 0.114 * imageData.data[rightIdx + 2];
        const lumUp = 0.299 * imageData.data[upIdx] + 0.587 * imageData.data[upIdx + 1] + 0.114 * imageData.data[upIdx + 2];
        const lumDown = 0.299 * imageData.data[downIdx] + 0.587 * imageData.data[downIdx + 1] + 0.114 * imageData.data[downIdx + 2];

        const gx = lumRight - lumLeft;
        const gy = lumDown - lumUp;
        const imgGrad = Math.sqrt(gx * gx + gy * gy);
        const aGrad = gradMag[alphaIdx];

        sumG += imgGrad;
        sumGA += aGrad;
        sumG2 += imgGrad * imgGrad;
        sumGA2 += aGrad * aGrad;
        sumGGA += imgGrad * aGrad;
        nGrad++;
      }
    }
  }

  if (n === 0) return { score: -1, variance: 0 };

  const meanL = sumL / n;
  const meanA = sumA / n;
  const varL = Math.max(0, sumL2 / n - meanL * meanL);
  const varA = Math.max(0, sumA2 / n - meanA * meanA);

  if (varA <= 0.0001) {
    return { score: 0, variance: varL };
  }

  // White polarity NCC
  let nccWhite = 0;
  if (varL > 0.5) {
    const covLA = sumLA / n - meanL * meanA;
    nccWhite = covLA / Math.sqrt(varL * varA);
  }

  // Dark polarity NCC (for bright white backgrounds)
  let nccDark = 0;
  const meanInvL = sumInvL / n;
  const varInvL = Math.max(0, sumInvL2 / n - meanInvL * meanInvL);
  if (varInvL > 0.5 && meanL > 160) {
    const covInvLA = sumInvLA / n - meanInvL * meanA;
    nccDark = covInvLA / Math.sqrt(varInvL * varA);
  }

  const nccLum = Math.max(nccWhite, nccDark);

  // Gradient edge NCC
  let nccGrad = 0;
  if (nGrad > 10) {
    const meanG = sumG / nGrad;
    const meanGA = sumGA / nGrad;
    const varG = Math.max(0, sumG2 / nGrad - meanG * meanG);
    const varGA = Math.max(0, sumGA2 / nGrad - meanGA * meanGA);
    if (varG > 0.5 && varGA > 0.0001) {
      const covGGA = sumGGA / nGrad - meanG * meanGA;
      nccGrad = Math.max(0, covGGA / Math.sqrt(varG * varGA));
    }
  }

  let fusedScore = (nccLum * 0.65) + (nccGrad * 0.35);
  if (varL < 20) {
    fusedScore = Math.max(fusedScore, (nccLum * 0.40) + (nccGrad * 0.60));
  }

  return { score: Math.max(0, fusedScore), variance: varL };
}

function detectWatermarkCandidate(imageData, width, height, bgImg) {
  const minDim = Math.min(width, height);
  const baseRatio = minDim / 1536;
  const base = getWatermarkInfo(width, height);

  // Candidate Layout Families with Bayesian Priors:
  const layoutFamilies = [
    // 1. Gemini & Nano Banana Adaptive Inset (12.5% Inset)
    {
      presetKey: 'new',
      name: 'Gemini & Nano Banana (Adaptive)',
      baseSize: base.size,
      calcPos: (s) => {
        const m = Math.max(8, Math.round(192 * baseRatio));
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 0.6,
      prior: 1.08
    },
    // 2. Classic Corner Adaptive (4.16% Margin)
    {
      presetKey: 'classic',
      name: 'Classic Corner (Adaptive)',
      baseSize: base.size,
      calcPos: (s) => {
        const m = Math.max(8, Math.round(64 * baseRatio));
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 1.0,
      prior: 1.04
    },
    // 3. Fixed Standard (96px watermark regardless of crop/resize)
    {
      presetKey: 'new',
      name: 'Gemini & Nano Banana (Fixed 96px Inset)',
      baseSize: 96,
      calcPos: (s) => {
        const m = minDim >= 1400 ? 192 : Math.round(128 * Math.max(0.5, minDim / 1024));
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 0.6,
      prior: 1.02
    },
    // 4. Fixed 96px Classic Corner
    {
      presetKey: 'classic',
      name: 'Classic Corner (Fixed 96px)',
      baseSize: 96,
      calcPos: (s) => {
        const m = minDim >= 1024 ? 64 : 32;
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 1.0,
      prior: 1.01
    }
  ];

  // Multi-Scale search pyramid: 0.55x to 1.70x
  const scalePyramid = [0.55, 0.70, 0.85, 1.00, 1.15, 1.30, 1.50, 1.70];

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

  // Refinement: Joint 2D Position (±16px) and Scale fine-tuning (±10%)
  if (bestMatch && bestMatch.score > 0.05) {
    let refinedX = bestMatch.x;
    let refinedY = bestMatch.y;
    let refinedSize = bestMatch.size;
    let refinedScore = bestMatch.score;

    const fineSizes = [
      Math.max(16, Math.round(bestMatch.size * 0.90)),
      Math.max(16, Math.round(bestMatch.size * 0.95)),
      bestMatch.size,
      Math.min(Math.min(width, height) - 8, Math.round(bestMatch.size * 1.05)),
      Math.min(Math.min(width, height) - 8, Math.round(bestMatch.size * 1.10))
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

    // 1-pixel precision fine alignment pass
    for (let fdy = -3; fdy <= 3; fdy += 1) {
      for (let fdx = -3; fdx <= 3; fdx += 1) {
        const testX = Math.max(0, Math.min(width - refinedSize, refinedX + fdx));
        const testY = Math.max(0, Math.min(height - refinedSize, refinedY + fdy));
        const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, { x: testX, y: testY, size: refinedSize });
        const weightedScore = score * (bestMatch.layout.prior || 1.0);
        if (weightedScore > refinedScore) {
          refinedScore = weightedScore;
          refinedX = testX;
          refinedY = testY;
        }
      }
    }

    const calculatedScale = Math.round((refinedSize / base.size) * 100) / 100;

    return {
      matchFound: refinedScore >= 0.10,
      score: Math.min(1.0, refinedScore),
      presetKey: bestMatch.layout.presetKey,
      name: `${bestMatch.layout.name} (${refinedSize}px)`,
      offsetX: refinedX - base.x,
      offsetY: refinedY - base.y,
      sizeScale: Math.max(0.5, Math.min(2.5, calculatedScale)),
      gain: bestMatch.layout.gain || 0.6,
    };
  }

  const fallbackOffset = Math.round(-128 * baseRatio);
  return {
    matchFound: false,
    score: bestScore > 0 ? bestScore : 0,
    presetKey: 'new',
    name: 'Gemini & Nano Banana (Adaptive)',
    offsetX: fallbackOffset,
    offsetY: fallbackOffset,
    sizeScale: 1.0,
    gain: 0.6,
  };
}

// ── Image Frame Extractor ──
async function grabImageFrame(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const width = bmp.width;
      const height = bmp.height;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, width, height);
      const imageData = cx.getImageData(0, 0, width, height);
      bmp.close();
      return { width, height, imageData };
    } catch {
      // Fallback to Image element
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      const imageData = cx.getImageData(0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ width: w, height: h, imageData });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image file.'));
    };
    img.src = url;
  });
}

// ── Expose globals to window ──
window.calculateAlphaMap = calculateAlphaMap;
window.ALPHA_THRESHOLD = ALPHA_THRESHOLD;
window.MAX_ALPHA = MAX_ALPHA;
window.LOGO_VALUE = LOGO_VALUE;
window.removeWatermark = removeWatermark;
window.getWatermarkInfo = getWatermarkInfo;
window.getRoi = getRoi;
window.resolveBox = resolveBox;
window.buildAlpha = buildAlpha;
window.cleanFrame = cleanFrame;
window.BG_48_BASE64 = BG_48_BASE64;
window.BG_96_BASE64 = BG_96_BASE64;
window.WatermarkEngine = WatermarkEngine;
window.IMG_PRESETS = IMG_PRESETS;
window.getAdaptiveImagePreset = getAdaptiveImagePreset;
window.alphaTemplateCache = alphaTemplateCache;
window.getAlphaTemplateData = getAlphaTemplateData;
window.evaluateCandidateMatch = evaluateCandidateMatch;
window.detectWatermarkCandidate = detectWatermarkCandidate;
window.grabImageFrame = grabImageFrame;
