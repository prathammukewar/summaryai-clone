// On-device speech to text. Decodes audio on the main thread (AudioContext is
// not available in workers), then hands 16 kHz mono samples to a worker.
const PLATFORM = window.SUMMARY_PLATFORM || {};
const TF_URL = PLATFORM.transformersUrl || 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';

let worker = null, workerBroken = false, seq = 0;
const pending = new Map();
let mainPipe = null, mainLoaded = '';

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const { id, type, payload } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (type === 'progress') p.onProgress && p.onProgress(payload);
      else if (type === 'status') p.onStatus && p.onStatus(payload);
      else if (type === 'result') { pending.delete(id); p.resolve(payload); }
      else if (type === 'error') { pending.delete(id); p.reject(new Error(payload)); }
    };
    worker.onerror = ev => {
      workerBroken = true;
      for (const [id, p] of pending) { pending.delete(id); p.reject(new Error(ev.message || 'Worker failed')); }
      worker = null;
    };
  } catch (e) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

export async function decodeAudio(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let audio;
  try {
    audio = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  } finally {
    ctx.close().catch(() => {});
  }
  let data;
  if (audio.sampleRate !== 16000 || audio.numberOfChannels > 1) {
    const frames = Math.ceil(audio.duration * 16000);
    const off = new OfflineAudioContext(1, frames, 16000);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    data = rendered.getChannelData(0);
  } else {
    data = audio.getChannelData(0);
  }
  return { data: new Float32Array(data), duration: audio.duration };
}

async function transcribeOnMainThread(data, model, language, onProgress, onStatus) {
  if (!mainPipe || mainLoaded !== model) {
    onStatus && onStatus('Loading speech model');
    const mod = await import(TF_URL);
    mod.env.allowLocalModels = false;
    if (PLATFORM.ortWasm) mod.env.backends.onnx.wasm.wasmPaths = PLATFORM.ortWasm;
    const { pipeline } = mod;
    const devices = navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
    let err = null;
    mainPipe = null;
    for (const d of devices) {
      try {
        mainPipe = await pipeline('automatic-speech-recognition', model, { device: d, progress_callback: onProgress });
        mainLoaded = model;
        break;
      } catch (e) { err = e; }
    }
    if (!mainPipe) throw err || new Error('Could not load the speech model');
  }
  onStatus && onStatus('Transcribing');
  const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
  if (!model.endsWith('.en') && language) opts.language = language;
  const out = await mainPipe(data, opts);
  return { text: out.text, chunks: out.chunks };
}

export async function transcribe(blob, { model, language, onProgress, onStatus } = {}) {
  onStatus && onStatus('Decoding audio');
  const { data, duration } = await decodeAudio(blob);
  let out;
  const w = getWorker();
  if (w) {
    out = await new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, onProgress, onStatus });
      w.postMessage({ id, type: 'transcribe', payload: { buffer: data.buffer, model, language, libUrl: TF_URL, wasm: PLATFORM.ortWasm } }, [data.buffer]);
    }).catch(async err => {
      // Fall back to the main thread if the worker could not do the job.
      workerBroken = true;
      const again = await decodeAudio(blob);
      return transcribeOnMainThread(again.data, model, language, onProgress, onStatus).catch(() => { throw err; });
    });
  } else {
    out = await transcribeOnMainThread(data, model, language, onProgress, onStatus);
  }
  const segments = (out.chunks || [])
    .map(c => ({
      start: c.timestamp && c.timestamp[0] != null ? +c.timestamp[0] : 0,
      end: c.timestamp && c.timestamp[1] != null ? +c.timestamp[1] : null,
      text: (c.text || '').trim(),
    }))
    .filter(s => s.text);
  return { text: (out.text || '').trim(), segments, duration };
}
