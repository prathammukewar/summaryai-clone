import { db } from './db.js';
import { settings, update as updateSettings, MODELS, WHISPER_MODELS, SPEECH_LANGS, LANGS } from './settings.js';
import { createRecorder } from './recorder.js';
import * as whisper from './whisper.js';
import * as ai from './ai.js';
import { localSummary, localAnswer } from './local.js';
import { extractPdf, readText } from './importers.js';
import * as exp from './export.js';
import { md, esc } from './markdown.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const main = $('#main');

let notes = [];
let current = null;
let tab = 'summary';
let route = { view: 'notes' };
let query = '';
let playerUrl = null;
let listAnimated = false;
let recorder = null;
const busy = new Map();

/* ---------- helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let toastTimer;
function toast(msg, ms = 3400, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.classList.remove('show'); action.run(); });
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? Math.max(ms, 12000) : ms);
}

// Open a settings page the user can fix a permission on. Works from the
// extension (Chrome lets extensions open chrome:// and x-apple URLs in a tab)
// and degrades to window.open on the website.
function openSettingsUrl(url) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
  else window.open(url, '_blank');
}
const MAC_MIC_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const MAC_SOUND_SETTINGS = 'x-apple.systempreferences:com.apple.preference.sound';
const chromeSiteSettings = () => 'chrome://settings/content/siteDetails?site=' + encodeURIComponent(location.origin);

// Turn a getUserMedia failure into a sentence that names the real cause and
// the place to fix it. The error names are the browser's; the messages vary.
function micFailure(e) {
  const name = (e && e.name) || '';
  const msg = String((e && e.message) || '');
  const mac = /mac/i.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
  if (name === 'NotAllowedError' && /system|operating|os level|by the os/i.test(msg)) {
    return { text: 'Your Mac is blocking the microphone for Chrome, not the extension. In System Settings go to Privacy & Security, then Microphone, and turn on Google Chrome. If it still fails afterwards, quit Chrome fully and reopen it.', action: { label: 'Open System Settings', run: () => openSettingsUrl(MAC_MIC_SETTINGS) } };
  }
  if (name === 'NotAllowedError') {
    return { text: 'Chrome is blocking the microphone for this extension. Open its site settings and set Microphone to Allow.' + (PLATFORM.extension ? ' If Chrome never asked you at all, open the app in a full tab and start a recording there once; the side panel cannot always show the permission prompt.' : '') + (mac ? ' If Chrome says the microphone is allowed, the block is in your Mac\'s Privacy & Security settings instead.' : ''), action: { label: 'Open Chrome site settings', run: () => openSettingsUrl(chromeSiteSettings()) } };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return { text: 'No microphone was found. Check that one is connected and selected as the input in Sound settings.', action: mac ? { label: 'Open Sound settings', run: () => openSettingsUrl(MAC_SOUND_SETTINGS) } : null };
  }
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
    return { text: 'The microphone is busy or unavailable, usually because another app or tab is using it. Close that and try again.', action: null };
  }
  if (name === 'SecurityError') {
    return { text: 'This page is not allowed to use the microphone in this context. Open the app in a full tab and try there.', action: null };
  }
  return { text: 'Microphone access failed' + (name ? ' (' + name + (msg ? ': ' + msg : '') + ')' : '') + '.', action: { label: 'Open Chrome site settings', run: () => openSettingsUrl(chromeSiteSettings()) } };
}
const fmtDate = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const icon = (id, cls = '') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const sourceIcon = src => ({ recording: 'i-mic', upload: 'i-upload', pdf: 'i-file-text', text: 'i-text-align-start' })[src] || 'i-text-align-start';
const srcClass = src => 'src-' + (['recording', 'upload', 'pdf', 'text'].includes(src) ? src : 'text');
// Escape first, then wrap matches, so a search term can never inject markup.
function mark(text, q) {
  const safe = esc(text);
  if (!q || !q.trim()) return safe;
  const rx = new RegExp('(' + q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return safe.replace(rx, '<mark>$1</mark>');
}
function fmtBytes(n) {
  if (!n) return '0 MB';
  const mb = n / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb >= 10 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB';
}
const relDate = iso => {
  const d = new Date(iso), now = new Date();
  const days = Math.floor((now.setHours(0,0,0,0) - new Date(iso).setHours(0,0,0,0)) / 86400000);
  if (days === 0) return 'Today, ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday, ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return fmtDate(iso);
};
const sourceLabel = src => ({ recording: 'Recording', upload: 'Uploaded file', pdf: 'PDF', text: 'Text' })[src] || 'Note';
const langCode = l => (l || 'en').split('-')[0];
function modelLabel() { const m = MODELS.find(x => x[0] === settings.model); return m ? m[1].replace(' (default)', '') : settings.model; }
function progressText(p) {
  if (!p) return 'Loading speech model';
  if (p.status === 'progress' && p.file) return `Downloading ${p.file.split('/').pop()} ${Math.round(p.progress || 0)}%`;
  if (p.status === 'initiate') return 'Preparing speech model';
  return 'Loading speech model';
}
function showProgress(text) { $('#progress-text').textContent = text; $('#progress-overlay').hidden = false; }
function hideProgress() { $('#progress-overlay').hidden = true; }

/* ---------- persistence ---------- */
async function createNote(partial) {
  const now = new Date().toISOString();
  const n = {
    id: uid(), title: 'Untitled note', createdAt: now, updatedAt: now, folder: '', source: 'text',
    duration: null, transcript: '', segments: null, summary: null, summaryMode: null, translations: {},
    chat: [], hasAudio: false, audioType: '', status: 'ready', ...partial,
  };
  notes.unshift(n);
  await db.putNote(n);
  renderFolders();
  return n;
}
async function saveNote(n) { n.updatedAt = new Date().toISOString(); await db.putNote(n); }
function setBusy(id, text) {
  busy.set(id, text);
  if (route.view === 'note' && current && current.id === id) {
    const el = $('#note-status');
    if (el) { el.hidden = false; el.querySelector('span').textContent = text; }
    const ps = $('#panel-status');
    if (ps) ps.textContent = text;
  } else if (route.view === 'notes') {
    const pill = $(`[data-status="${id}"]`);
    if (pill) pill.textContent = text;
  }
}
function clearBusy(id) { busy.delete(id); }
function refresh(n) {
  if (route.view === 'note' && current && current.id === n.id) renderNote();
  else if (route.view === 'notes') renderListItems();
}

/* ---------- routing ---------- */
function parseHash() {
  const parts = (location.hash || '#/notes').replace(/^#/, '').split('/').filter(Boolean);
  if (parts[0] === 'settings') return { view: 'settings' };
  if (parts[0] === 'folder') return { view: 'notes', folder: decodeURIComponent(parts[1] || '') };
  if (parts[0] === 'notes' && parts[1]) return { view: 'note', id: parts[1] };
  return { view: 'notes' };
}
function render() {
  route = parseHash();
  exp.stopSpeaking();
  if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; }
  $('#side').classList.remove('open');
  if (route.view === 'settings') { current = null; renderSettings(); }
  else if (route.view === 'note') {
    current = notes.find(n => n.id === route.id);
    if (!current) { location.hash = '#/notes'; return; }
    tab = 'summary';
    renderNote();
  } else { current = null; renderList(); }
  highlightNav();
  window.scrollTo(0, 0);
}
function highlightNav() {
  $$('.nav a').forEach(a => a.classList.remove('active'));
  let el = null;
  if (route.view === 'settings') el = $('[data-nav="settings"]');
  else if (route.folder) el = $$('#folder-list a').find(a => a.dataset.folder === route.folder);
  else if (route.view === 'notes') el = $('[data-nav="notes"]');
  if (el) el.classList.add('active');
}
const folders = () => [...new Set(notes.map(n => n.folder).filter(Boolean))].sort();
function renderFolders() {
  const fl = folders();
  $('#folder-list').innerHTML = fl.length
    ? fl.map(f => {
        const n = notes.filter(x => x.folder === f).length;
        return `<a href="#/folder/${encodeURIComponent(f)}" data-folder="${esc(f)}">${icon('i-folder')}<span>${esc(f)}</span><span class="count">${n}</span></a>`;
      }).join('')
    : '<div class="nav-empty">No folders yet</div>';
  const c = $('#nav-count');
  if (c) c.textContent = notes.length || '';
  highlightNav();
  updateStorage();
}

// Rough storage read, so the sidebar can show what the browser has given us.
async function updateStorage() {
  const box = $('#storage');
  if (!box || !navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota) return;
    box.hidden = false;
    $('#storage-used').textContent = fmtBytes(usage);
    $('#storage-fill').style.width = Math.max(1.5, Math.min(100, (usage / quota) * 100)) + '%';
    const audio = notes.filter(n => n.hasAudio).length;
    $('#storage-note').textContent = audio
      ? `${notes.length} note${notes.length === 1 ? '' : 's'}, ${audio} with audio`
      : 'Notes stay in this browser';
  } catch (e) { /* storage estimate unavailable */ }
}

/* ---------- list view ---------- */
function visibleNotes() {
  const q = query.trim().toLowerCase();
  return notes
    .filter(n => !route.folder || n.folder === route.folder)
    .filter(n => !q || (n.title + ' ' + n.transcript + ' ' + (n.summary ? n.summary.overview + ' ' + (n.summary.topics || []).join(' ') : '')).toLowerCase().includes(q));
}
function renderList() {
  const title = route.folder ? route.folder : 'All notes';
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>${esc(title)}</h1><div class="sub" id="list-sub"></div></div>
        <label class="search">${icon('i-search')}<input id="search" type="search" placeholder="Search notes and transcripts" value="${esc(query)}"><span class="kbd">/</span></label>
      </div>
      <div id="list-body"></div>
    </div>`;
  listAnimated = false;
  $('#search').addEventListener('input', e => { query = e.target.value; renderListItems(); });
  renderListItems();
}
function renderListItems() {
  const body = $('#list-body');
  if (!body) return;
  const list = visibleNotes();
  const sub = $('#list-sub');
  if (sub) sub.textContent = notes.length ? `${list.length} of ${notes.length} note${notes.length === 1 ? '' : 's'}` : 'Nothing saved yet';
  if (notes.length === 0) body.innerHTML = welcomeHTML();
  else if (list.length === 0) body.innerHTML = `<div class="empty"><div class="empty-ic">${icon('i-search')}</div><h3>No matches</h3><p>Nothing here matches “${esc(query.trim())}”. Try a different word, or clear the search.</p><button class="btn" type="button" data-act="clear-search">Clear search</button></div>`;
  else {
    body.innerHTML = `<div class="notes">${list.map(cardHTML).join('')}</div>`;
    listAnimated = true;
  }
  $$('.note-card', body).forEach(c => c.addEventListener('click', () => { location.hash = '#/notes/' + c.dataset.id; }));
  $$('[data-act]', body).forEach(b => b.addEventListener('click', () => {
    if (b.dataset.act === 'clear-search') { query = ''; const f = $('#search'); if (f) f.value = ''; renderListItems(); return; }
    actions[b.dataset.act]();
  }));
}
function cardHTML(n, i) {
  const st = busy.get(n.id) || (n.status !== 'ready' ? n.status : '');
  const q = query.trim();
  let snippet = n.summary ? n.summary.overview : n.transcript;
  // when searching, show the part of the note that actually matched
  if (q && snippet) {
    const hay = (n.transcript || '') + ' ' + snippet;
    const at = hay.toLowerCase().indexOf(q.toLowerCase());
    if (at > -1) snippet = (at > 60 ? '…' : '') + hay.slice(Math.max(0, at - 60), at + 180).trim();
  }
  const pill = st
    ? `<span class="pill processing working" data-status="${n.id}">${esc(st)}</span>`
    : n.summary
      ? `<span class="pill ready">${icon(n.summaryMode === 'claude' ? 'i-sparkles' : 'i-check')}${n.summaryMode === 'claude' ? 'AI' : 'Basic'}</span>`
      : '';
  const meta = [relDate(n.createdAt), n.duration ? exp.fmtTime(n.duration) : '', n.folder || '']
    .filter(Boolean).map(esc).join('<span class="dot"></span>');
  const anim = listAnimated ? 'animation:none' : `animation-delay:${Math.min(i * 28, 220)}ms`;
  return `<button class="note-card" data-id="${n.id}" type="button" style="${anim}">
    <span class="note-ic ${srcClass(n.source)}">${icon(sourceIcon(n.source))}</span>
    <span class="note-body">
      <span class="note-title">${mark(n.title, q)}</span>
      <span class="note-meta">${meta}</span>
      ${snippet ? `<span class="note-snip">${mark(snippet.slice(0, 240), q)}</span>` : ''}
    </span>${pill}</button>`;
}
function welcomeHTML() {
  return `<div class="welcome">
    <div class="welcome-art"><span class="halo"></span><span class="disc">${icon('i-audio-lines')}</span></div>
    <h2>Turn any conversation into notes</h2>
    <p>Record a meeting or lecture, upload a file, or import a document. Transcription runs on this device. Summaries, Ask AI, and translation use Claude with your own API key${ai.hasKey() ? '.' : '. Basic summaries work without one.'}</p>
    <div class="welcome-actions">
      <button class="btn primary lg" data-act="record" type="button">${icon('i-mic')}Start recording</button>
      <button class="btn lg" data-act="upload" type="button">${icon('i-upload')}Upload a file</button>
      <button class="btn lg" data-act="import" type="button">${icon('i-file-text')}Import a document</button>
    </div>
    <button class="link-btn" data-act="sample" type="button">No microphone handy? Try a 17-second sample recording</button>
    ${ai.hasKey() ? '' : '<a class="welcome-link" href="#/settings">Add a Claude API key for full AI features</a>'}
  </div>`;
}

/* ---------- note view ---------- */
async function renderNote() {
  const n = current;
  const st = busy.get(n.id);
  const hasTs = !!(n.segments && n.segments.some(s => s.start != null));
  main.innerHTML = `
  <div class="page note-page">
    <a class="back" href="${route.folder ? '#/folder/' + encodeURIComponent(route.folder) : '#/notes'}">${icon('i-chevron-left')}Notes</a>
    <div class="note-head">
      <input class="title-input" id="title" value="${esc(n.title)}" aria-label="Note title">
      <div class="meta-row">
        <span class="chip-src ${srcClass(n.source)}">${icon(sourceIcon(n.source))}${sourceLabel(n.source)}</span>
        <span>${esc(relDate(n.createdAt))}</span>${n.duration ? `<span>· ${exp.fmtTime(n.duration)}</span>` : ''}
        <label class="folder-pick">${icon('i-folder')}<select id="folder" aria-label="Folder"><option value="">No folder</option>${folders().map(f => `<option ${f === n.folder ? 'selected' : ''} value="${esc(f)}">${esc(f)}</option>`).join('')}<option value="__new">New folder…</option></select></label>
      </div>
      <div id="note-status" class="status" ${st ? '' : 'hidden'}>${icon('i-loader-circle', 'spin')}<span>${esc(st || '')}</span></div>
      <div class="toolbar">
        <button class="btn primary sm" id="btn-summarize" type="button" ${n.transcript.trim() && n.status === 'ready' ? '' : 'disabled'}>${icon('i-sparkles')}<span>${n.summary ? 'Regenerate' : 'Summarize'}</span></button>
        <button class="btn sm" id="btn-speak" type="button" ${'speechSynthesis' in window ? '' : 'disabled'}>${icon('i-volume-2')}<span>Read aloud</span></button>
        <details class="menu"><summary class="btn sm">${icon('i-download')}<span>Export</span></summary><div class="menu-list">
          <button type="button" data-x="md">${icon('i-download')}Download Markdown</button>
          <button type="button" data-x="txt">${icon('i-file-text')}Download transcript (.txt)</button>
          ${hasTs ? `<button type="button" data-x="srt">${icon('i-file-music')}Download subtitles (.srt)</button>` : ''}
          <button type="button" data-x="copy">${icon('i-copy')}Copy ${n.summary ? 'summary' : 'transcript'}</button>
          ${navigator.share ? `<button type="button" data-x="share">${icon('i-external-link')}Share…</button>` : ''}
        </div></details>
        <button class="btn sm danger" id="btn-delete" type="button">${icon('i-trash')}<span>Delete</span></button>
      </div>
    </div>
    ${n.hasAudio ? `<div class="player">
      <audio id="player" controls preload="metadata"></audio>
      <div class="speed" role="group" aria-label="Playback speed">
        ${[1, 1.25, 1.5, 2].map(r => `<button type="button" data-speed="${r}" aria-pressed="${settings.speed === r}">${r}x</button>`).join('')}
      </div>
    </div>` : ''}
    <div class="tabs" role="tablist">${[['summary', 'Summary', 'i-sparkles'], ['transcript', 'Transcript', 'i-text-align-start'], ['chat', 'Ask AI', 'i-message-square-quote'], ['translate', 'Translate', 'i-languages']].map(([t, label, ic]) =>
      `<button role="tab" type="button" data-tab="${t}" class="${tab === t ? 'active' : ''}">${icon(ic)}<span>${label}</span></button>`).join('')}</div>
    <div class="panel" id="panel"></div>
  </div>`;

  $('#title').addEventListener('change', async e => { n.title = e.target.value.trim() || 'Untitled note'; await saveNote(n); });
  $('#folder').addEventListener('change', async e => {
    let v = e.target.value;
    if (v === '__new') { v = (prompt('Folder name') || '').trim(); if (!v) { e.target.value = n.folder; return; } }
    n.folder = v; await saveNote(n); renderFolders(); renderNote();
  });
  $('#btn-summarize').addEventListener('click', () => summarizeNote(n));
  $$('[data-speed]').forEach(b => b.addEventListener('click', () => {
    const rate = +b.dataset.speed;
    updateSettings({ speed: rate });
    const pl = $('#player');
    if (pl) pl.playbackRate = rate;
    $$('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.speed === rate)));
  }));
  $('#btn-speak').addEventListener('click', () => toggleSpeak(n));
  $$('.menu-list button').forEach(b => b.addEventListener('click', () => { $('.menu').removeAttribute('open'); exportNote(n, b.dataset.x); }));
  $('#btn-delete').addEventListener('click', async () => {
    if (!confirm('Delete this note' + (n.hasAudio ? ' and its audio' : '') + '?')) return;
    notes = notes.filter(x => x.id !== n.id);
    await db.deleteNote(n.id);
    renderFolders();
    location.hash = '#/notes';
    toast('Note deleted.');
  });
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    renderPanel();
  }));
  renderPanel();
  if (n.hasAudio) {
    const a = await db.getAudio(n.id);
    const p = $('#player');
    if (a && a.blob && p && current === n) {
      playerUrl = URL.createObjectURL(a.blob);
      p.src = playerUrl;
      p.playbackRate = settings.speed || 1;
      p.addEventListener('timeupdate', highlightSegment);
    }
  }
}

function renderPanel() {
  const n = current;
  const p = $('#panel');
  if (!p || !n) return;
  if (tab === 'summary') p.innerHTML = summaryHTML(n);
  else if (tab === 'transcript') p.innerHTML = transcriptHTML(n);
  else if (tab === 'chat') p.innerHTML = chatHTML(n);
  else p.innerHTML = translateHTML(n);
  bindPanel();
}

// A determinate ring while a model downloads, a spinner otherwise.
function workingHTML(n, fallback) {
  const label = busy.get(n.id) || fallback;
  const m = /(\d+)%/.exec(label);
  if (m) {
    const pct = +m[1], C = 2 * Math.PI * 25;
    return `<div class="empty small">
      <div class="ring"><svg viewBox="0 0 58 58"><circle class="track" cx="29" cy="29" r="25"/><circle class="bar" cx="29" cy="29" r="25" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/></svg><span class="pct">${pct}%</span></div>
      <p id="panel-status">${esc(label.replace(/\s*\d+%$/, ''))}</p>
      <p class="muted small">The speech model downloads once, then stays cached.</p>
    </div>`;
  }
  return `<div class="empty small">${icon('i-loader-circle', 'spin big')}<p id="panel-status">${esc(label)}</p></div>`;
}

function section(ic, title, body) {
  return `<section><div class="sec-head">${icon(ic)}<h3>${title}</h3></div>${body}</section>`;
}

function summaryHTML(n) {
  const s = n.summary;
  if (n.status === 'summarizing') return workingHTML(n, 'Summarizing');
  if (n.status === 'transcribing') return workingHTML(n, 'Transcribing');
  if (!s) return `<div class="empty small"><div class="empty-ic">${icon('i-sparkles')}</div><h3>No summary yet</h3><p>${n.transcript.trim() ? 'Pull the key points, decisions, and action items out of the transcript.' : 'There is no transcript to summarize.'}</p>${n.transcript.trim() ? `<button class="btn primary lg" type="button" data-do="summarize">${icon('i-sparkles')}Summarize</button>` : ''}</div>`;
  const list = (arr, empty) => arr && arr.length ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;
  const done = (s.action_items || []).filter(a => a.done).length;
  return `${n.summaryMode === 'local'
    ? `<div class="banner">${icon('i-circle-alert')}<span>Basic on-device summary. <a href="#/settings">Add a Claude API key</a> for a real one.</span></div>`
    : `<div class="banner soft">${icon('i-sparkles')}<span>Generated by ${esc(modelLabel())}</span></div>`}
    ${section('i-message-square-quote', 'Overview', `<p class="lead">${esc(s.overview)}</p>`)}
    ${section('i-list-checks', 'Key points', list(s.key_points, 'None noted.'))}
    ${section('i-check', 'Decisions', list(s.decisions, 'No decisions recorded.'))}
    ${section('i-list-checks', `Action items${(s.action_items || []).length ? ` <span class="muted">${done}/${s.action_items.length}</span>` : ''}`,
      s.action_items && s.action_items.length
        ? `<ul class="actions-list">${s.action_items.map((a, i) => `<li class="${a.done ? 'done' : ''}"><input type="checkbox" data-task="${i}" ${a.done ? 'checked' : ''} aria-label="Mark done"><span class="task">${esc(a.task)}</span>${a.owner ? `<span class="chip">${esc(a.owner)}</span>` : ''}${a.due ? `<span class="chip soft">${icon('i-clock')}${esc(a.due)}</span>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">No action items.</p>')}
    ${section('i-circle-alert', 'Open questions', list(s.open_questions, 'None.'))}
    ${s.topics && s.topics.length ? section('i-star', 'Topics', `<div class="chips">${s.topics.map(t => `<span class="chip soft">${esc(t)}</span>`).join('')}</div>`) : ''}`;
}

function transcriptHTML(n) {
  if (n.status === 'transcribing') {
    return workingHTML(n, 'Transcribing') + (n.transcript ? `<div class="banner soft">${icon('i-audio-lines')}<span>Live captions so far: ${esc(n.transcript.slice(-400))}</span></div>` : '');
  }
  const tools = `<div class="panel-tools">
    ${n.hasAudio ? `<button class="btn sm" type="button" data-do="retranscribe">${icon('i-rotate-ccw')}Re-transcribe</button>` : ''}
    ${n.transcript.trim() ? `<button class="btn sm" type="button" data-do="speakers">${icon('i-users')}Label speakers</button><button class="btn sm" type="button" data-do="edit">${icon('i-pencil')}Edit</button>` : ''}
  </div>`;
  if (!n.transcript.trim()) return `<div class="empty small"><div class="empty-ic">${icon('i-audio-lines')}</div><h3>No transcript</h3><p>${n.hasAudio ? 'Transcription produced no text. Try re-transcribing, or check the spoken language in Settings.' : 'Nothing here yet.'}</p>${tools}</div>`;
  if (n.segments && n.segments.length) {
    const speakers = [...new Set(n.segments.map(x => x.speaker).filter(Boolean))];
    return tools + `<div class="segments">${n.segments.map((sg, i) => {
      const sp = speakers.indexOf(sg.speaker);
      return `<div class="seg" data-i="${i}" ${sg.start != null ? `data-start="${sg.start}"` : ''}>${sg.start != null ? `<button class="ts" type="button" data-seek="${sg.start}">${exp.fmtTime(sg.start)}</button>` : ''}<div class="seg-body">${sg.speaker ? `<span class="speaker sp-${sp % 5}">${esc(sg.speaker)}</span><br>` : ''}${esc(sg.text)}</div></div>`;
    }).join('')}</div>`;
  }
  return tools + `<div class="prose">${n.transcript.split(/\n+/).filter(p => p.trim()).map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
}

function chatHTML(n) {
  const sugg = ['What were the action items?', 'What was decided?', 'Give me a two-sentence recap', 'What questions were left open?'];
  return `<div class="chat">
    ${ai.hasKey() ? '' : `<div class="banner">${icon('i-circle-alert')}<span>Without an API key, answers are keyword matches from the transcript. <a href="#/settings">Add a key</a> for real answers.</span></div>`}
    <div class="chat-log" id="chat-log">${n.chat.length ? n.chat.map(bubble).join('') : `<div class="chat-empty">${icon('i-message-square-quote', 'ic')}<p>Ask anything about this note.</p><div class="chips">${sugg.map(s => `<button class="chip btnchip" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`}</div>
    <form class="chat-form" id="chat-form"><input id="chat-input" placeholder="Ask about this note" autocomplete="off" ${n.transcript.trim() ? '' : 'disabled'}><button class="btn primary sm" type="submit" ${n.transcript.trim() ? '' : 'disabled'}>Ask</button></form>
  </div>`;
}
const bubble = (m, i) => `<div class="bubble ${m.role}" data-i="${i}">${m.role === 'assistant' ? (m.text ? md(m.text) : '<span class="typing"><i></i><i></i><i></i></span>') : esc(m.text)}</div>`;

function translateHTML(n) {
  const keys = Object.keys(n.translations || {});
  return `<div class="translate">
    ${ai.hasKey() ? '' : `<div class="banner">${icon('i-circle-alert')}<span>Translation needs a Claude API key. <a href="#/settings">Add one in Settings</a>.</span></div>`}
    <div class="panel-tools">
      <select id="tr-lang" aria-label="Language">${LANGS.map(l => `<option ${l === (n.lastLang || 'Spanish') ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="tr-what" aria-label="What to translate"><option value="summary" ${n.summary ? '' : 'disabled'}>Summary</option><option value="transcript" ${n.summary ? '' : 'selected'}>Transcript</option></select>
      <button class="btn primary sm" type="button" data-do="translate" ${ai.hasKey() && n.transcript.trim() ? '' : 'disabled'}>${icon('i-languages')}Translate</button>
    </div>
    <div id="tr-out" class="prose">${keys.length ? keys.map(k => `<section><h3>${esc(k.replace(':', ' · '))}</h3>${md(n.translations[k])}</section>`).join('') : '<p class="muted">Translations appear here.</p>'}</div>
  </div>`;
}

function bindPanel() {
  const n = current;
  const handlers = {
    summarize: () => summarizeNote(n),
    retranscribe: () => retranscribe(n),
    speakers: () => labelSpeakers(n),
    edit: () => editTranscript(n),
    translate: () => translateNote(n),
  };
  $$('#panel [data-do]').forEach(b => b.addEventListener('click', () => handlers[b.dataset.do]()));
  $$('#panel [data-seek]').forEach(b => b.addEventListener('click', () => {
    const p = $('#player'); if (!p) return; p.currentTime = +b.dataset.seek; p.play();
  }));
  $$('#panel .btnchip').forEach(b => b.addEventListener('click', () => ask(n, b.dataset.q)));
  $$('#panel [data-task]').forEach(b => b.addEventListener('click', async () => {
    const item = n.summary && n.summary.action_items[+b.dataset.task];
    if (!item) return;
    item.done = b.checked;
    b.closest('li').classList.toggle('done', b.checked);
    const head = $('#panel .sec-head h3 .muted');
    if (head) head.textContent = `${n.summary.action_items.filter(a => a.done).length}/${n.summary.action_items.length}`;
    await saveNote(n);
  }));
  const f = $('#chat-form');
  if (f) f.addEventListener('submit', e => {
    e.preventDefault();
    const i = $('#chat-input'); const q = i.value.trim();
    if (!q) return; i.value = ''; ask(n, q);
  });
  const log = $('#chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

function highlightSegment(e) {
  const t = e.target.currentTime;
  const segs = $$('.seg[data-start]');
  segs.forEach((el, i) => {
    const s = +el.dataset.start;
    const next = segs[i + 1];
    const end = next ? +next.dataset.start : Infinity;
    el.classList.toggle('active', t >= s && t < end);
  });
}

/* ---------- transcription ---------- */
async function transcribeNote(n, blob) {
  n.status = 'transcribing';
  setBusy(n.id, 'Preparing');
  refresh(n);
  try {
    const r = await whisper.transcribe(blob, {
      model: settings.whisperModel,
      language: langCode(settings.speechLang),
      onProgress: p => setBusy(n.id, progressText(p)),
      onStatus: s => setBusy(n.id, s),
    });
    if (r.text) { n.transcript = r.text; n.segments = r.segments.length ? r.segments : null; }
    if (!n.duration && r.duration) n.duration = Math.round(r.duration);
  } catch (e) {
    console.error(e);
    toast(n.transcript ? 'On-device transcription failed, so the live captions were kept.' : 'Transcription failed: ' + (e.message || e), 5000);
  }
  n.status = 'ready';
  clearBusy(n.id);
  await saveNote(n);
  refresh(n);
  if (settings.autoSummarize && n.transcript.trim()) summarizeNote(n);
}
async function retranscribe(n) {
  const a = await db.getAudio(n.id);
  if (!a || !a.blob) { toast('The audio for this note is missing.'); return; }
  transcribeNote(n, a.blob);
}
function editTranscript(n) {
  const p = $('#panel');
  p.innerHTML = `<p class="muted small">Editing replaces the transcript text${n.segments ? ' and removes timestamps and speaker labels' : ''}.</p>
    <textarea class="input edit-area" id="edit-area">${esc(n.transcript)}</textarea>
    <div class="row end"><button class="btn sm" type="button" id="edit-cancel">Cancel</button><button class="btn primary sm" type="button" id="edit-save">Save</button></div>`;
  $('#edit-cancel').addEventListener('click', renderPanel);
  $('#edit-save').addEventListener('click', async () => {
    const v = $('#edit-area').value.trim();
    if (v !== n.transcript) { n.transcript = v; n.segments = null; await saveNote(n); }
    renderPanel();
  });
}

/* ---------- AI features ---------- */
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    overview: { type: 'string' },
    key_points: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    action_items: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } }, required: ['task', 'owner', 'due'], additionalProperties: false } },
    open_questions: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'overview', 'key_points', 'decisions', 'action_items', 'open_questions', 'topics'],
  additionalProperties: false,
};
const LABEL_SCHEMA = { type: 'object', properties: { labels: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, speaker: { type: 'string' } }, required: ['index', 'speaker'], additionalProperties: false } } }, required: ['labels'], additionalProperties: false };
const TURNS_SCHEMA = { type: 'object', properties: { turns: { type: 'array', items: { type: 'object', properties: { speaker: { type: 'string' }, text: { type: 'string' } }, required: ['speaker', 'text'], additionalProperties: false } } }, required: ['turns'], additionalProperties: false };

const summarySystem = () => `You are Summary AI, a note-taking assistant. You receive the transcript of a meeting, lecture, call, or document and turn it into faithful, concise notes.

Rules:
- Only include what the transcript supports. Never invent names, dates, or numbers.
- title: short and specific, under 8 words.
- overview: 2 to 4 sentences.
- key_points: the most important facts or ideas, one sentence each, at most 8.
- decisions: things that were explicitly decided or agreed. Empty if none.
- action_items: concrete follow-ups. owner and due are empty strings when not stated.
- open_questions: unresolved questions or things to check. Empty if none.
- topics: 2 to 6 short topic tags.
- Write everything in ${settings.outputLang}.`;

const chatSystem = n => [{
  type: 'text',
  text: `You are the assistant inside Summary AI. Answer questions about the user's note using only the transcript and summary below. If the answer is not in them, say so plainly. Be concise, use markdown lists when they help, and reply in ${settings.outputLang} unless the user writes in another language.

<summary>
${n.summary ? exp.summaryMarkdown(n.summary) : '(no summary yet)'}
</summary>

<transcript>
${n.transcript}
</transcript>`,
  cache_control: { type: 'ephemeral' },
}];

async function summarizeNote(n) {
  if (!n.transcript.trim()) { toast('Nothing to summarize yet.'); return; }
  if (n.status !== 'ready') return;
  n.status = 'summarizing';
  setBusy(n.id, ai.hasKey() ? 'Summarizing with ' + modelLabel() : 'Building a basic summary');
  refresh(n);
  try {
    if (ai.hasKey()) {
      const text = await ai.complete({
        system: summarySystem(),
        messages: [{ role: 'user', content: '<transcript>\n' + n.transcript + '\n</transcript>\n\nProduce the structured notes.' }],
        schema: SUMMARY_SCHEMA,
      });
      n.summary = JSON.parse(text);
      n.summaryMode = 'claude';
    } else {
      n.summary = localSummary(n.transcript);
      n.summaryMode = 'local';
    }
    if (n.summary.title && /^(Recording |Untitled note)/.test(n.title)) n.title = n.summary.title;
  } catch (e) {
    console.error(e);
    toast(ai.describeError(e), 5000);
  }
  n.status = 'ready';
  clearBusy(n.id);
  await saveNote(n);
  refresh(n);
}

async function ask(n, q) {
  n.chat.push({ role: 'user', text: q });
  const idx = n.chat.push({ role: 'assistant', text: '', pending: true }) - 1;
  if (tab === 'chat') renderPanel();
  try {
    if (ai.hasKey()) {
      const history = n.chat.slice(0, idx).map(m => ({ role: m.role, content: m.text }));
      const answer = await ai.complete({
        system: chatSystem(n),
        messages: history,
        onText: t => {
          n.chat[idx].text += t;
          const el = $(`.bubble[data-i="${idx}"]`);
          if (el && current === n) { el.innerHTML = md(n.chat[idx].text); const log = $('#chat-log'); if (log) log.scrollTop = log.scrollHeight; }
        },
      });
      n.chat[idx].text = answer;
    } else {
      n.chat[idx].text = localAnswer(q, n.transcript);
    }
  } catch (e) {
    n.chat[idx].text = 'Error: ' + ai.describeError(e);
  }
  delete n.chat[idx].pending;
  await saveNote(n);
  if (tab === 'chat' && current === n) renderPanel();
}

async function translateNote(n) {
  if (!ai.hasKey()) { toast(new ai.NoKeyError().message); return; }
  const lang = $('#tr-lang').value;
  const what = $('#tr-what').value;
  const src = what === 'summary' ? exp.summaryMarkdown(n.summary) : exp.transcriptText(n);
  if (!src.trim()) { toast('Nothing to translate.'); return; }
  const key = lang + ':' + what;
  n.lastLang = lang;
  const out = $('#tr-out');
  out.innerHTML = `<section><h3>${esc(lang)} · ${what}</h3><div id="tr-live" class="prose"></div></section>`;
  const live = $('#tr-live');
  let acc = '';
  try {
    acc = await ai.complete({
      system: `Translate the user's notes into ${lang}. Keep the markdown structure, headings, lists, timestamps, and speaker labels. Return only the translation.`,
      messages: [{ role: 'user', content: src }],
      onText: t => { acc += t; if (live) live.innerHTML = md(acc); },
    });
    n.translations = n.translations || {};
    n.translations[key] = acc;
    await saveNote(n);
    if (tab === 'translate' && current === n) renderPanel();
  } catch (e) {
    toast(ai.describeError(e), 5000);
    if (tab === 'translate' && current === n) renderPanel();
  }
}

async function labelSpeakers(n) {
  if (!ai.hasKey()) { toast(new ai.NoKeyError().message); return; }
  if (n.status !== 'ready') return;
  n.status = 'summarizing';
  setBusy(n.id, 'Identifying speakers');
  refresh(n);
  try {
    if (n.segments && n.segments.length) {
      const numbered = n.segments.map((s, i) => i + ': ' + s.text).join('\n');
      const text = await ai.complete({
        system: 'You label speakers in transcripts. The user gives numbered transcript segments. Infer the distinct speakers from turn-taking and content and return a label for every index. Use consistent names such as "Speaker 1", "Speaker 2", or a real name only when the transcript clearly states it. Every index must get exactly one label.',
        messages: [{ role: 'user', content: numbered }],
        schema: LABEL_SCHEMA,
      });
      const map = new Map(JSON.parse(text).labels.map(l => [l.index, l.speaker]));
      n.segments.forEach((s, i) => { if (map.has(i)) s.speaker = map.get(i); });
    } else {
      const text = await ai.complete({
        system: 'You label speakers in transcripts. Split the user\'s transcript into turns and assign each turn a speaker, inferred from turn-taking and content. Keep every word of the original text in order; only add the split and the labels. Use consistent names such as "Speaker 1", "Speaker 2", or a real name only when the transcript clearly states it.',
        messages: [{ role: 'user', content: n.transcript }],
        schema: TURNS_SCHEMA,
      });
      const turns = JSON.parse(text).turns.filter(t => t.text && t.text.trim());
      if (turns.length) n.segments = turns.map(t => ({ start: null, end: null, text: t.text.trim(), speaker: t.speaker }));
    }
  } catch (e) {
    console.error(e);
    toast(ai.describeError(e), 5000);
  }
  n.status = 'ready';
  clearBusy(n.id);
  await saveNote(n);
  tab = 'transcript';
  refresh(n);
}

/* ---------- speak and export ---------- */
function toggleSpeak(n) {
  const btn = $('#btn-speak span');
  if (exp.isSpeaking()) { exp.stopSpeaking(); if (btn) btn.textContent = 'Read aloud'; return; }
  const s = n.summary;
  const text = s
    ? [s.overview, 'Key points.', ...(s.key_points || []), (s.action_items || []).length ? 'Action items.' : '', ...(s.action_items || []).map(a => a.task)].filter(Boolean).join(' ')
    : n.transcript.slice(0, 6000);
  if (!text.trim()) { toast('Nothing to read yet.'); return; }
  exp.speak(text);
  if (btn) btn.textContent = 'Stop reading';
}
async function exportNote(n, what) {
  const safe = (n.title || 'note').replace(/[^\w\- ]+/g, '').trim() || 'note';
  try {
    if (what === 'md') exp.download(safe + '.md', exp.noteMarkdown(n), 'text/markdown');
    else if (what === 'txt') exp.download(safe + '.txt', exp.transcriptText(n));
    else if (what === 'srt') exp.download(safe + '.srt', exp.toSRT(n.segments));
    else if (what === 'copy') { await exp.copyText(n.summary ? exp.summaryMarkdown(n.summary) : exp.transcriptText(n)); toast('Copied.'); }
    else if (what === 'share') await exp.share(n.title, exp.noteMarkdown(n));
  } catch (e) {
    if (!e || e.name !== 'AbortError') toast('Export failed: ' + (e && e.message ? e.message : e));
  }
}

/* ---------- settings view ---------- */
function renderSettings() {
  main.innerHTML = `<div class="page settings">
    <h1>Settings</h1>
    <section class="card">
      <div class="card-head">${icon('i-sparkles')}<h3>Claude API key</h3></div>
      <p class="muted">Powers summaries, Ask AI, translation, and speaker labels. The key is stored only in this browser and requests go straight to Anthropic.</p>
      <div class="row start">
        <input id="s-key" type="password" placeholder="sk-ant-…" value="${esc(settings.apiKey)}" autocomplete="off" spellcheck="false" aria-label="API key">
        <button class="btn" type="button" id="s-show">Show</button>
        <button class="btn" type="button" id="s-test">${icon('i-check')}Test</button>
      </div>
      <label class="field">Model<select id="s-model">${MODELS.map(m => `<option value="${m[0]}" ${m[0] === settings.model ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></label>
      <label class="field">Write summaries and answers in<select id="s-out">${LANGS.map(l => `<option ${l === settings.outputLang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="s-auto" ${settings.autoSummarize ? 'checked' : ''}> Summarize automatically after transcribing or importing</label>
      <p class="muted small">Keys come from console.anthropic.com and usage is billed to that account. Without a key you still get on-device transcription and a basic summary.</p>
    </section>
    <section class="card">
      <div class="card-head">${icon('i-audio-lines')}<h3>Transcription</h3></div>
      <p class="muted">Runs on this device with Whisper. The model downloads once and is cached by the browser. Bigger models are more accurate and slower.</p>
      <label class="field">Whisper model<select id="s-whisper">${WHISPER_MODELS.map(m => `<option value="${m[0]}" ${m[0] === settings.whisperModel ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></label>
      <label class="field">Spoken language<select id="s-lang">${SPEECH_LANGS.map(l => `<option value="${l[0]}" ${l[0] === settings.speechLang ? 'selected' : ''}>${l[1]}</option>`).join('')}</select></label>
      <p class="muted small">Live captions while recording use the browser's own speech recognition where available. For languages other than English pick a multilingual model.</p>
      <div class="row start"><button class="btn" type="button" id="s-mic">${icon('i-mic')}Check microphone</button><span class="muted small" id="s-mic-result">Finds out exactly why recording fails, if it does.</span></div>
      <div id="s-mic-fix" hidden></div>
    </section>
    <section class="card">
      <div class="card-head">${icon('i-folder-open')}<h3>Data</h3></div>
      <p class="muted">${notes.length} note${notes.length === 1 ? '' : 's'} stored in this browser. Nothing is synced anywhere.</p>
      <button class="btn danger" type="button" id="s-clear">${icon('i-trash')}Delete all notes and audio</button>
    </section>
    <p class="fineprint">Unofficial recreation of the Summary AI web app, built as a front-end exercise. Not affiliated with Summary AI.</p>
  </div>`;
  const key = $('#s-key');
  key.addEventListener('input', () => updateSettings({ apiKey: key.value.trim() }));
  $('#s-show').addEventListener('click', e => { key.type = key.type === 'password' ? 'text' : 'password'; e.target.textContent = key.type === 'password' ? 'Show' : 'Hide'; });
  $('#s-test').addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Testing…';
    try { await ai.ping(); toast('Key works with ' + modelLabel() + '.'); }
    catch (err) { toast(ai.describeError(err), 5000); }
    e.target.disabled = false; e.target.textContent = 'Test';
  });
  $('#s-model').addEventListener('change', e => updateSettings({ model: e.target.value }));
  $('#s-out').addEventListener('change', e => updateSettings({ outputLang: e.target.value }));
  $('#s-auto').addEventListener('change', e => updateSettings({ autoSummarize: e.target.checked }));
  $('#s-whisper').addEventListener('change', e => updateSettings({ whisperModel: e.target.value }));
  $('#s-lang').addEventListener('change', e => updateSettings({ speechLang: e.target.value }));
  $('#s-mic').addEventListener('click', async e => {
    const out = $('#s-mic-result');
    e.target.disabled = true; out.textContent = 'Asking for the microphone…';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const label = (stream.getAudioTracks()[0] || {}).label || 'a microphone';
      stream.getTracks().forEach(t => t.stop());
      out.textContent = 'Microphone works: ' + label + '.';
      $('#s-mic-fix').hidden = true;
    } catch (err) {
      console.error(err);
      const f = micFailure(err);
      out.textContent = f.text;
      const fix = $('#s-mic-fix');
      fix.innerHTML = '';
      if (f.action) {
        const b = document.createElement('button');
        b.className = 'btn primary'; b.type = 'button'; b.textContent = f.action.label;
        b.addEventListener('click', f.action.run);
        fix.appendChild(b);
      }
      fix.hidden = !f.action;
    }
    e.target.disabled = false;
  });
  $('#s-clear').addEventListener('click', async () => {
    if (!confirm('Delete every note and recording stored in this browser?')) return;
    await db.clear(); notes = []; renderFolders(); toast('All notes deleted.'); renderSettings();
  });
}

/* ---------- recording ---------- */
const PLATFORM = window.SUMMARY_PLATFORM || {};

// A scrolling history waveform, the way a voice recorder draws it: new
// samples enter at the right and the whole history slides left.
let waveHistory = [];
function resetWave() { waveHistory = []; }
function drawLevels(buf, paused) {
  const c = $('#rec-wave');
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = c.clientWidth || 520, cssH = 92;
  if (c.width !== Math.round(cssW * dpr)) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const level = paused ? 0 : Math.min(1, Math.sqrt(sum / buf.length) / 96);
  waveHistory.push(level);

  const barW = 3, gap = 2, step = barW + gap;
  const bars = Math.floor(cssW / step);
  if (waveHistory.length > bars) waveHistory = waveHistory.slice(-bars);

  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--rec').trim() || '#E11D48';
  const idle = css.getPropertyValue('--border-strong').trim() || '#D2D7E4';
  ctx.clearRect(0, 0, cssW, cssH);
  const mid = cssH / 2;
  for (let i = 0; i < waveHistory.length; i++) {
    const v = waveHistory[i];
    const h = Math.max(3, v * (cssH - 10));
    const x = cssW - (waveHistory.length - i) * step;
    // older bars fade out toward the left edge
    const age = i / Math.max(1, waveHistory.length - 1);
    ctx.globalAlpha = paused ? 0.35 : 0.35 + age * 0.65;
    ctx.fillStyle = paused ? idle : accent;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, mid - h / 2, barW, h, barW / 2);
    else ctx.rect(x, mid - h / 2, barW, h);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Extension only: capture the audio of the active tab.
async function getTabStream() {
  if (!PLATFORM.extension || typeof chrome === 'undefined' || !chrome.tabs) throw new Error('Tab capture only works inside the Chrome extension.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab to capture.');
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    const r = await chrome.runtime.sendMessage({ type: 'tab-stream-id', tabId: tab.id }).catch(() => null);
    if (!r || r.error) throw new Error(r && r.error ? r.error : (e && e.message) || String(e));
    streamId = r.id;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  return { stream, title: tab.title || '' };
}
function tabErrorText(e) {
  const m = String((e && e.message) || e);
  if (/invoked|gesture|activeTab|Extension has not been/i.test(m)) return 'Chrome only lets the extension capture a tab after you click its icon on that tab. Click the Summary AI icon on the tab you want to record, then start again.';
  if (/chrome:\/\/|Cannot capture|not capturable/i.test(m)) return 'This tab cannot be captured. Chrome pages and the Web Store are off limits.';
  return 'Could not capture the tab: ' + m;
}

function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot record audio.'); return; }
  if (recorder) return;
  if (PLATFORM.extension) {
    $('#rec-setup').hidden = false;
    $('#rec-live').hidden = true;
    $('#rec-overlay').hidden = false;
    return;
  }
  beginRecording('mic');
}
async function beginRecording(source) {
  const ov = $('#rec-overlay');
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  $('#rec-time').textContent = '0:00';
  resetWave();
  $('#rec-captions').innerHTML = '<span class="muted">' + (source === 'tab'
    ? 'Recording the tab. The transcript is created when you stop.'
    : hasSR ? 'Live captions appear here while you talk.' : 'Live captions are not available here. The transcript is created when you stop.') + '</span>';
  $('#rec-pause').querySelector('span').textContent = 'Pause';
  $('#rec-pause').querySelector('use').setAttribute('href', '#i-pause');
  $('#rec-dot').classList.remove('paused');
  $('#rec-title').textContent = { mic: 'Recording', tab: 'Recording this tab', both: 'Recording tab and mic' }[source] || 'Recording';
  recorder = createRecorder({
    source,
    getTabStream,
    lang: settings.speechLang,
    onTick: s => { $('#rec-time').textContent = exp.fmtTime(s); },
    onLevels: drawLevels,
    onCaption: (f, i) => {
      const el = $('#rec-captions');
      el.innerHTML = esc(f) + '<span class="interim">' + esc(i) + '</span>';
      el.scrollTop = el.scrollHeight;
    },
    onEnded: () => { toast('The captured tab stopped, so the recording was saved.'); stopRecording(); },
  });
  try { await recorder.start(); }
  catch (e) {
    recorder = null;
    ov.hidden = true;
    console.error(e);
    if (source === 'mic' || (e && e.name && !/tab/i.test(String(e.message)) && e.name !== 'Error')) {
      const f = micFailure(e);
      toast(f.text, 9000, f.action);
    } else {
      toast(tabErrorText(e), 8000);
    }
    return;
  }
  $('#rec-setup').hidden = true;
  $('#rec-live').hidden = false;
  ov.hidden = false;
}
async function stopRecording() {
  if (!recorder) return;
  const r = recorder;
  recorder = null;
  const { blob, duration, captions, type, tabTitle } = await r.stop();
  $('#rec-overlay').hidden = true;
  if (!blob.size) { toast('Nothing was recorded.'); return; }
  const when = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const n = await createNote({
    title: tabTitle ? tabTitle.slice(0, 80) : 'Recording ' + when,
    source: 'recording', duration, hasAudio: true, audioType: type, transcript: captions, status: 'transcribing',
  });
  await db.putAudio(n.id, blob, type);
  location.hash = '#/notes/' + n.id;
  transcribeNote(n, blob);
}
function cancelRecording() {
  if (recorder) { recorder.cancel(); recorder = null; }
  $('#rec-overlay').hidden = true;
}
function togglePause() {
  if (!recorder) return;
  const btn = $('#rec-pause');
  if (recorder.paused) {
    recorder.resume();
    btn.querySelector('span').textContent = 'Pause';
    btn.querySelector('use').setAttribute('href', '#i-pause');
    $('#rec-dot').classList.remove('paused');
  } else {
    recorder.pause();
    btn.querySelector('span').textContent = 'Resume';
    btn.querySelector('use').setAttribute('href', '#i-play');
    $('#rec-dot').classList.add('paused');
  }
}

/* ---------- imports ---------- */
async function importAudioFile(f) {
  const n = await createNote({ title: f.name.replace(/\.[^.]+$/, ''), source: 'upload', hasAudio: true, audioType: f.type, status: 'transcribing' });
  await db.putAudio(n.id, f, f.type);
  location.hash = '#/notes/' + n.id;
  transcribeNote(n, f);
}
async function importDocFile(f) {
  showProgress('Importing ' + f.name);
  try {
    const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    const text = isPdf ? await extractPdf(f, showProgress) : await readText(f);
    hideProgress();
    if (!text.trim()) { toast('No text found in that file.'); return; }
    const n = await createNote({ title: f.name.replace(/\.[^.]+$/, ''), source: isPdf ? 'pdf' : 'text', transcript: text.trim() });
    location.hash = '#/notes/' + n.id;
    if (settings.autoSummarize) summarizeNote(n);
  } catch (e) {
    hideProgress();
    console.error(e);
    toast('Import failed: ' + (e.message || e), 5000);
  }
}
async function createFromText() {
  const body = $('#text-body').value.trim();
  if (!body) { toast('Paste some text first.'); return; }
  const title = $('#text-title').value.trim() || body.split(/\s+/).slice(0, 6).join(' ');
  $('#text-overlay').hidden = true;
  $('#text-body').value = ''; $('#text-title').value = '';
  const n = await createNote({ title, source: 'text', transcript: body });
  location.hash = '#/notes/' + n.id;
  if (settings.autoSummarize) summarizeNote(n);
}

async function importSample() {
  showProgress('Fetching the sample');
  try {
    const r = await fetch('samples/meeting-sample.wav');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const b = await r.blob();
    hideProgress();
    importAudioFile(new File([b], 'Sample planning meeting.wav', { type: 'audio/wav' }));
  } catch (e) {
    hideProgress();
    toast('Could not load the sample: ' + (e.message || e));
  }
}

const actions = {
  sample: importSample,
  record: startRecording,
  upload: () => $('#file-audio').click(),
  import: () => $('#file-doc').click(),
  paste: () => { $('#text-overlay').hidden = false; $('#text-body').focus(); },
};

/* ---------- boot ---------- */
function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === mode)));
}

function bindGlobal() {
  applyTheme(settings.theme);
  $$('[data-theme-set]').forEach(b => b.addEventListener('click', () => {
    updateSettings({ theme: b.dataset.themeSet });
    applyTheme(b.dataset.themeSet);
  }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme('system');
  });
  $('#act-record').addEventListener('click', actions.record);
  $('#act-upload').addEventListener('click', actions.upload);
  $('#act-import').addEventListener('click', actions.import);
  $('#act-paste').addEventListener('click', actions.paste);
  $('#menu-btn').addEventListener('click', e => {
    const open = $('#side').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  $('#file-audio').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importAudioFile(f); });
  $('#file-doc').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importDocFile(f); });
  $('#rec-stop').addEventListener('click', stopRecording);
  $('#rec-cancel').addEventListener('click', cancelRecording);
  $('#rec-pause').addEventListener('click', togglePause);
  $('#rec-start').addEventListener('click', () => {
    const picked = document.querySelector('input[name="rec-source"]:checked');
    beginRecording(picked ? picked.value : 'mic');
  });
  $$('#rec-setup-cancel, #rec-setup-cancel-2').forEach(b => b.addEventListener('click', () => { $('#rec-overlay').hidden = true; }));
  $('#act-open-tab').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  });
  $('#text-save').addEventListener('click', createFromText);
  $('#text-cancel').addEventListener('click', () => { $('#text-overlay').hidden = true; });
  $('#text-close').addEventListener('click', () => { $('#text-overlay').hidden = true; });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (!$('#text-overlay').hidden) $('#text-overlay').hidden = true;
      else if (!$('#rec-overlay').hidden && $('#rec-setup') && !$('#rec-setup').hidden) $('#rec-overlay').hidden = true;
      const m = $('.menu[open]'); if (m) m.removeAttribute('open');
      if (typing) e.target.blur();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { const f = $('#search'); if (f) { e.preventDefault(); f.focus(); f.select(); } }
    else if (e.key.toLowerCase() === 'r' && $('#rec-overlay').hidden) { e.preventDefault(); actions.record(); }
    else if (e.key.toLowerCase() === 'n' && $('#rec-overlay').hidden) { e.preventDefault(); actions.paste(); }
  });
  document.addEventListener('click', e => { const m = $('.menu[open]'); if (m && !m.contains(e.target)) m.removeAttribute('open'); });
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', e => { if (recorder) { e.preventDefault(); e.returnValue = ''; } });
}

async function init() {
  try {
    notes = await db.allNotes();
  } catch (e) {
    console.error(e);
    toast('Could not open local storage. Notes will not be saved.', 6000);
    notes = [];
  }
  notes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  notes.forEach(n => { if (n.status !== 'ready') n.status = 'ready'; n.chat = (n.chat || []).map(m => ({ role: m.role, text: m.text })); });
  bindGlobal();
  if (PLATFORM.extension) {
    document.documentElement.classList.add('extension');
    $('#act-open-tab').hidden = false;
  }
  renderFolders();
  render();
  updateStorage();
}

// Exposed for automated checks and debugging.
window.summaryAI = { importAudioFile, importDocFile, get notes() { return notes; } };

init();
