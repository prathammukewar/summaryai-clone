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

export const db = {
  allNotes: () => tx('notes', 'readonly', s => s.getAll()),
  getNote: id => tx('notes', 'readonly', s => s.get(id)),
  putNote: n => tx('notes', 'readwrite', s => s.put(n)),
  deleteNote: id => Promise.all([
    tx('notes', 'readwrite', s => s.delete(id)),
    tx('audio', 'readwrite', s => s.delete(id)),
  ]),
  putAudio: (id, blob, type) => tx('audio', 'readwrite', s => s.put({ id, blob, type })),
  getAudio: id => tx('audio', 'readonly', s => s.get(id)),
  clear: () => Promise.all([
    tx('notes', 'readwrite', s => s.clear()),
    tx('audio', 'readwrite', s => s.clear()),
  ]),
};
