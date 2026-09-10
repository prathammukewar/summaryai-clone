// Tells the app where its libraries live. The same files serve the website
// and the Chrome extension; only the base URL differs.
(function () {
  var ext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  var base = ext ? chrome.runtime.getURL('') : new URL('./', location.href).href;
  window.SUMMARY_PLATFORM = {
    extension: !!ext,
    sdkUrl: base + 'vendor/anthropic-sdk.js',
    transformersUrl: base + 'vendor/transformers.min.js',
    // The extension cannot load code from a CDN, so the ONNX runtime is bundled.
    // The website leaves this null and lets transformers.js fetch it from jsDelivr.
    ortWasm: ext ? {
      mjs: base + 'vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: base + 'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm'
    } : null,
    pdfUrl: base + 'vendor/pdf.min.mjs',
    pdfWorkerUrl: base + 'vendor/pdf.worker.min.mjs'
  };
})();
