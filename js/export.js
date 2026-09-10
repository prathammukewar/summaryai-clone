export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' : '') + (h ? String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}

export function summaryMarkdown(s) {
  if (!s) return '';
  const list = arr => (arr && arr.length ? arr.map(x => '- ' + x).join('\n') : '_None_');
  const actions = s.action_items && s.action_items.length
    ? s.action_items.map(a => '- [ ] ' + a.task + (a.owner ? ' (' + a.owner + ')' : '') + (a.due ? ' due ' + a.due : '')).join('\n')
    : '_None_';
  return [
    '## Overview', s.overview || '', '',
    '## Key points', list(s.key_points), '',
    '## Decisions', list(s.decisions), '',
    '## Action items', actions, '',
    '## Open questions', list(s.open_questions), '',
  ].join('\n');
}

export function transcriptText(n) {
  if (n.segments && n.segments.length) {
    return n.segments.map(s => (s.start != null ? '[' + fmtTime(s.start) + '] ' : '') + (s.speaker ? s.speaker + ': ' : '') + s.text).join('\n');
  }
  return n.transcript || '';
}

export function noteMarkdown(n) {
  return '# ' + n.title + '\n\n' + new Date(n.createdAt).toLocaleString() + (n.duration ? ' · ' + fmtTime(n.duration) : '') + '\n\n'
    + (n.summary ? summaryMarkdown(n.summary) + '\n' : '')
    + '## Transcript\n\n' + transcriptText(n) + '\n';
}

export function toSRT(segments) {
  const t = s => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + ',' + String(r).padStart(3, '0');
  };
  const segs = (segments || []).filter(s => s.start != null);
  return segs.map((s, i) => {
    const end = s.end != null ? s.end : (segs[i + 1] ? segs[i + 1].start : s.start + 3);
    return (i + 1) + '\n' + t(s.start) + ' --> ' + t(end) + '\n' + (s.speaker ? s.speaker + ': ' : '') + s.text + '\n';
  }).join('\n');
}

export function download(name, content, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function copyText(t) { return navigator.clipboard.writeText(t); }

export async function share(title, text) {
  if (!navigator.share) return false;
  await navigator.share({ title, text });
  return true;
}

export function speak(text) {
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  speechSynthesis.speak(u);
}
export function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
export function isSpeaking() { return 'speechSynthesis' in window && speechSynthesis.speaking; }
