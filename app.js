(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var KEY = 'summaryai-clone.notes';
  var home = $('#view-home');
  var app = $('#view-app');

  /* ---------- routing (#/home, #/app) ---------- */
  function route() {
    if (!location.hash) {
      history.replaceState(null, '', '#/home');
    }
    var path = location.hash.replace(/^#/, '').split('?')[0];
    var inApp = path === '/app' || path.indexOf('/app/') === 0;
    home.hidden = inApp;
    app.hidden = !inApp;
    document.title = inApp ? 'Your notes | Summary AI' : 'Summary AI';
    if (inApp) renderNotes();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  /* ---------- welcome screen ---------- */
  $('#btn-google').addEventListener('click', function () {
    toast('Google sign-in is a placeholder here. Try Start as Guest.');
  });
  $('#btn-apple').addEventListener('click', function () {
    toast('Apple sign-in is a placeholder here. Try Start as Guest.');
  });
  $('#btn-guest').addEventListener('click', function () {
    location.hash = '#/app';
  });
  $('#btn-signout').addEventListener('click', function () {
    location.hash = '#/home';
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-soon]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      toast('Only Notes is built out in this clone.');
    });
  });

  /* ---------- notes storage ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch (e) { /* private mode etc. */ }
  }
  var notes = load();

  function fmtDur(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(id, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#' + id);
    s.appendChild(u);
    if (cls) s.setAttribute('class', cls);
    return s;
  }

  function renderNotes() {
    var list = $('#notes'), empty = $('#empty'), count = $('#count');
    list.innerHTML = '';
    empty.hidden = notes.length > 0;
    list.hidden = notes.length === 0;
    count.textContent = notes.length ? notes.length + (notes.length === 1 ? ' note' : ' notes') : '';
    notes.forEach(function (n) {
      var card = el('button', 'note');
      card.type = 'button';
      var ic = el('span', 'note-ic');
      ic.appendChild(icon('i-mic'));
      var body = el('div');
      body.appendChild(el('div', 'note-title', n.title));
      body.appendChild(el('div', 'note-meta', fmtDate(n.createdAt) + '  ·  ' + fmtDur(n.duration)));
      var pill = el('span', 'pill ' + n.status, n.status === 'ready' ? 'Ready' : 'Processing');
      card.appendChild(ic);
      card.appendChild(body);
      card.appendChild(pill);
      card.addEventListener('click', function () { openNote(n.id); });
      list.appendChild(card);
    });
  }

  /* ---------- recorder ---------- */
  var rec = $('#rec'), recTime = $('#rec-time');
  var t0 = 0, tick = null;

  function startRec() {
    t0 = Date.now();
    recTime.textContent = '0:00';
    rec.hidden = false;
    tick = setInterval(function () {
      recTime.textContent = fmtDur(Math.floor((Date.now() - t0) / 1000));
    }, 250);
    $('#rec-stop').focus();
  }
  function closeRec() {
    clearInterval(tick);
    tick = null;
    rec.hidden = true;
  }
  $('#btn-record').addEventListener('click', startRec);
  $('#rec-cancel').addEventListener('click', closeRec);
  $('#rec-stop').addEventListener('click', function () {
    var dur = Math.max(1, Math.round((Date.now() - t0) / 1000));
    closeRec();
    var id = Date.now().toString(36);
    var n = {
      id: id,
      title: 'Recording ' + (notes.length + 1),
      createdAt: new Date().toISOString(),
      duration: dur,
      status: 'processing'
    };
    notes.unshift(n);
    save();
    renderNotes();
    toast('Saved. Summarizing...');
    setTimeout(function () {
      n.status = 'ready';
      save();
      if (!app.hidden) renderNotes();
      if (!detail.hidden && detail.dataset.id === id) openNote(id);
    }, 1800);
  });

  /* ---------- note detail ---------- */
  var detail = $('#detail');
  function openNote(id) {
    var n = notes.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    detail.dataset.id = id;
    $('#d-title').textContent = n.title;
    $('#d-meta').textContent = fmtDate(n.createdAt) + '  ·  ' + fmtDur(n.duration) + '  ·  ' + (n.status === 'ready' ? 'Ready' : 'Processing');
    var body = $('#d-body');
    body.innerHTML = '';
    if (n.status !== 'ready') {
      body.appendChild(el('p', 'muted', 'Working on the summary. This takes a couple of seconds in the demo.'));
    } else {
      body.appendChild(el('div', 'section-title', 'Summary'));
      var sum = el('div', 'summary');
      var ul = el('ul');
      [
        'Sample summary. In the real app this would be pulled from the transcript.',
        'Key points, decisions, and action items would be listed here.',
        'Open questions to follow up on would close out the note.'
      ].forEach(function (s) { ul.appendChild(el('li', null, s)); });
      sum.appendChild(ul);
      body.appendChild(sum);
      body.appendChild(el('div', 'section-title', 'Transcript'));
      body.appendChild(el('p', 'transcript', 'No audio was captured, so there is nothing to transcribe. The recording lasted ' + fmtDur(n.duration) + '.'));
    }
    detail.hidden = false;
    $('#d-close').focus();
  }
  function closeDetail() { detail.hidden = true; }
  $('#d-close').addEventListener('click', closeDetail);
  $('#d-delete').addEventListener('click', function () {
    var id = detail.dataset.id;
    notes = notes.filter(function (x) { return x.id !== id; });
    save();
    closeDetail();
    renderNotes();
    toast('Note deleted.');
  });
  [rec, detail].forEach(function (ov) {
    ov.addEventListener('click', function (e) { if (e.target === ov && ov === detail) closeDetail(); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!detail.hidden) closeDetail();
      else if (!rec.hidden) closeRec();
    }
  });

  route();
})();
