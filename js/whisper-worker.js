// Runs Whisper (via transformers.js) off the main thread. The main thread tells
// the worker where the library and the ONNX runtime live.
let mod = null;

async function lib(url, wasm) {
  if (!mod) {
    mod = await import(url);
    mod.env.allowLocalModels = false;
    if (wasm) mod.env.backends.onnx.wasm.wasmPaths = wasm;
  }
  return mod;
}

let pipe = null, loaded = '', device = '';

self.onmessage = async e => {
  const { id, type, payload } = e.data;
  if (type !== 'transcribe') return;
  try {
    const { buffer, model, language, libUrl, wasm } = payload;
    const { pipeline } = await lib(libUrl, wasm);
    const data = new Float32Array(buffer);
    if (!pipe || loaded !== model) {
      pipe = null;
      const devices = self.navigator && self.navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
      let err = null;
      for (const d of devices) {
        try {
          self.postMessage({ id, type: 'status', payload: 'Loading speech model' });
          pipe = await pipeline('automatic-speech-recognition', model, {
            device: d,
            progress_callback: p => self.postMessage({ id, type: 'progress', payload: { status: p.status, file: p.file, progress: p.progress } }),
          });
          loaded = model; device = d;
          break;
        } catch (er) { err = er; }
      }
      if (!pipe) throw err || new Error('Could not load the speech model');
    }
    self.postMessage({ id, type: 'status', payload: 'Transcribing' });
    const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
    if (!model.endsWith('.en') && language) opts.language = language;
    const out = await pipe(data, opts);
    self.postMessage({ id, type: 'result', payload: { text: out.text, chunks: out.chunks, device } });
  } catch (err) {
    self.postMessage({ id, type: 'error', payload: String((err && err.message) || err) });
  }
};
