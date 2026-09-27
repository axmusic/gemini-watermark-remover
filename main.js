// ── Gemini Watermark Remover ──
// main.js has been refactored into three modular files:
// 1. image-processing.js (Mathematical unblending algorithms, alpha map calculations, template matching, image watermark engine, and image frame extraction)
// 2. video-processing.js (Video watermark engine, WebCodecs / mediabunny encoding, frame extraction, video detection, and BulkVideoQueue)
// 3. ui.js (User interface controllers, tab navigation, tuner previews, sliders, event listeners, mobile menu, and custom selects)

// Backward compatibility loader: in case main.js is loaded directly or cached
if (typeof WatermarkEngine === 'undefined') {
  [
    './image-processing.js',
    './video-processing.js',
    './video-watermark-adder.js',
    './video-remove-and-add.js',
    './ui.js'
  ].forEach((src) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.head.appendChild(s);
  });
}
