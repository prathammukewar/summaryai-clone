// Microphone recording with a live level meter and optional live captions
// from the browser's SpeechRecognition (Chrome, Edge, Safari).
export function createRecorder({ onTick, onLevels, onCaption, lang } = {}) {
  let stream, rec, ctx, analyser, raf, timer, recog;
  const chunks = [];
  let startAt = 0, pausedTotal = 0, pauseAt = 0, active = false;
  let finalText = '', interim = '';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function elapsed() {
    const now = Date.now();
    return Math.max(0, Math.floor((now - startAt - pausedTotal - (pauseAt ? now - pauseAt : 0)) / 1000));
  }

  function startCaptions() {
    if (!SR) return;
    recog = new SR();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = lang || 'en-US';
    recog.onresult = e => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript.trim() + ' ';
        else interim += r[0].transcript;
      }
      if (onCaption) onCaption(finalText, interim);
    };
    recog.onend = () => { if (active && !pauseAt) { try { recog.start(); } catch (e) { /* already running */ } } };
    recog.onerror = () => { /* keep recording even if captions fail */ };
    try { recog.start(); } catch (e) { /* unsupported */ }
  }

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(1000);

    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(buf);
      if (onLevels) onLevels(buf, !!pauseAt);
      raf = requestAnimationFrame(loop);
    };
    loop();

    startAt = Date.now();
    active = true;
    timer = setInterval(() => { if (onTick) onTick(elapsed()); }, 250);
    startCaptions();
  }

  function pause() {
    if (!rec || rec.state !== 'recording') return;
    rec.pause();
    pauseAt = Date.now();
    try { recog && recog.stop(); } catch (e) { /* ignore */ }
  }

  function resume() {
    if (!rec || rec.state !== 'paused') return;
    rec.resume();
    pausedTotal += Date.now() - pauseAt;
    pauseAt = 0;
    try { recog && recog.start(); } catch (e) { /* ignore */ }
  }

  function cleanup() {
    active = false;
    clearInterval(timer);
    cancelAnimationFrame(raf);
    try { recog && recog.stop(); } catch (e) { /* ignore */ }
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ctx) ctx.close().catch(() => {});
  }

  function stop() {
    return new Promise(resolve => {
      const duration = elapsed();
      active = false;
      const finish = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        cleanup();
        resolve({ blob, duration, captions: finalText.trim(), type: blob.type });
      };
      if (rec.state !== 'inactive') { rec.onstop = finish; rec.stop(); }
      else finish();
    });
  }

  function cancel() {
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* ignore */ }
    cleanup();
  }

  return {
    start, stop, pause, resume, cancel,
    get paused() { return !!pauseAt; },
    hasCaptions: !!SR,
  };
}
