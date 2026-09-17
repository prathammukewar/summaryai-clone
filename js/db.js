const DB_NAME = 'summaryai-clone';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// Audio is stored per part: part 1 under the note id, later parts under
// "id::2", "id::3" and so on, so a note can be continued with a new recording.
const audioKey = (id, part = 1) => (part > 1 ? `${id}::${part}` : id);

export const db = {
  allNotes: () => tx('notes', 'readonly', s => s.getAll()),
  getNote: id => tx('notes', 'readonly', s => s.get(id)),
  putNote: n => tx('notes', 'readwrite', s => s.put(n)),

  putAudio: (id, blob, type, part = 1) =>
    tx('audio', 'readwrite', s => s.put({ id: audioKey(id, part), blob, type })),
  getAudio: (id, part = 1) => tx('audio', 'readonly', s => s.get(audioKey(id, part))),

  // Drop the audio but keep the note, for reclaiming space.
  dropAudio: (id, parts = 1) => Promise.all(
    Array.from({ length: parts }, (_, i) =>
      tx('audio', 'readwrite', s => s.delete(audioKey(id, i + 1))))),

  audioSize: async (id, parts = 1) => {
    let total = 0;
    for (let i = 1; i <= parts; i++) {
      const a = await tx('audio', 'readonly', s => s.get(audioKey(id, i)));
      if (a && a.blob) total += a.blob.size;
    }
    return total;
  },

  deleteNote: (id, parts = 1) => Promise.all([
    tx('notes', 'readwrite', s => s.delete(id)),
    ...Array.from({ length: Math.max(1, parts) }, (_, i) =>
      tx('audio', 'readwrite', s => s.delete(audioKey(id, i + 1)))),
  ]),

  clear: () => Promise.all([
    tx('notes', 'readwrite', s => s.clear()),
    tx('audio', 'readwrite', s => s.clear()),
  ]),
};
