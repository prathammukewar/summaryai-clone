// Backup and restore.
//
// Everything this app knows lives in one browser's IndexedDB, which the
// browser is free to throw away. A backup file is the only thing that makes
// the data survive a cleared profile, a new machine, or a bad day.
import { db } from './db.js';

export const FORMAT = 1;

const b64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

const unb64 = (data, type) => {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'audio/webm' });
};

// withAudio bloats the file enormously, so it is opt-in.
export async function build(notes, { withAudio = false, onProgress } = {}) {
  const out = {
    app: 'summaryai-clone',
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    counts: { notes: notes.length, withAudio: 0 },
    notes: notes.map(n => ({ ...n })),
    audio: {},
  };
  if (withAudio) {
    const sources = notes.filter(n => n.hasAudio);
    let done = 0;
    for (const n of sources) {
      const parts = Math.max(1, n.audioParts || 1);
      for (let p = 1; p <= parts; p++) {
        const a = await db.getAudio(n.id, p);
        if (a && a.blob) {
          out.audio[`${n.id}::${p}`] = { type: a.type || n.audioType || 'audio/webm', data: await b64(a.blob) };
          out.counts.withAudio++;
        }
      }
      done++;
      if (onProgress) onProgress(done, sources.length);
    }
  }
  return out;
}

export function filename(withAudio) {
  const d = new Date().toISOString().slice(0, 10);
  return `summary-ai-backup-${d}${withAudio ? '-with-audio' : ''}.json`;
}

export function validate(data) {
  if (!data || typeof data !== 'object') throw new Error('That file is not a backup.');
  if (data.app !== 'summaryai-clone') throw new Error('That JSON file is not a Summary AI backup.');
  if (!Array.isArray(data.notes)) throw new Error('That backup has no notes in it.');
  if (data.format > FORMAT) throw new Error('That backup was made by a newer version of the app.');
  return data;
}

// mode: "merge" keeps what is already here and adds what is missing,
//       "replace" overwrites a note when the backup has the same id.
export async function restore(data, existing, { mode = 'merge', onProgress } = {}) {
  validate(data);
  const have = new Set(existing.map(n => n.id));
  const added = [];
  let skipped = 0;
  for (const n of data.notes) {
    if (!n || !n.id) continue;
    if (have.has(n.id) && mode === 'merge') { skipped++; continue; }
    await db.putNote(n);
    added.push(n);
  }
  let audio = 0;
  const keys = Object.keys(data.audio || {});
  for (let i = 0; i < keys.length; i++) {
    const [id, part] = keys[i].split('::');
    if (mode === 'merge' && have.has(id)) continue;
    const a = data.audio[keys[i]];
    try {
      await db.putAudio(id, unb64(a.data, a.type), a.type, +part || 1);
      audio++;
    } catch (e) { /* one bad blob should not sink the restore */ }
    if (onProgress) onProgress(i + 1, keys.length);
  }
  return { added, skipped, audio };
}

// Ask the browser to stop treating this data as disposable.
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return { supported: false, persisted: false };
  try {
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const persisted = already || await navigator.storage.persist();
    return { supported: true, persisted };
  } catch (e) {
    return { supported: true, persisted: false, error: String(e) };
  }
}
