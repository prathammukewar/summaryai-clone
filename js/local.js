// Fallbacks that run without an API key: a frequency-based extractive summary
// and a keyword lookup for questions.
export const STOP = new Set(('a an the and or but if then so of to in on at for with by from as is are was were be been being ' +
  'it its this that these those i you he she we they them his her our your their me him us what which who whom when ' +
  'where why how not no yes do does did done have has had having can could should would will shall may might must just ' +
  'also very really there here about into over under again more most some any each other than too only own same such ' +
  'like get got go going um uh okay ok yeah right well know think mean kind sort thing things lot').split(' '));

export function sentences(text) {
  const m = String(text || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
  return m.map(s => s.trim()).filter(s => s.length > 15);
}

export function words(s) { return s.toLowerCase().match(/[a-z0-9']+/g) || []; }

export function localSummary(text) {
  const sents = sentences(text);
  const freq = {};
  for (const s of sents) for (const w of words(s)) if (!STOP.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1;
  const score = s => {
    const ws = words(s).filter(w => !STOP.has(w) && w.length > 2);
    if (!ws.length) return 0;
    return ws.reduce((a, w) => a + (freq[w] || 0), 0) / Math.sqrt(ws.length);
  };
  const ranked = sents.map((s, i) => ({ s, i, sc: score(s) })).sort((a, b) => b.sc - a.sc);
  const pick = (n, exclude) => ranked.filter(x => !exclude.has(x.i)).slice(0, n).sort((a, b) => a.i - b.i);
  const overview = pick(Math.min(3, sents.length), new Set());
  const used = new Set(overview.map(x => x.i));
  const key = pick(Math.min(5, sents.length), used);
  const decisions = sents.filter(s => /\b(decided|agreed|we will|we'll|going to|plan to|approved|confirmed|settled on)\b/i.test(s)).slice(0, 5);
  const actions = sents.filter(s => /\b(need to|needs to|should|must|will handle|to do|todo|follow up|by (tomorrow|monday|tuesday|wednesday|thursday|friday|next week|end of)|due|deadline|action item|let's)\b/i.test(s)).slice(0, 6);
  const questions = sents.filter(s => /\?$/.test(s)).slice(0, 5);
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
  const title = top.length ? top.slice(0, 3).map(w => w[0].toUpperCase() + w.slice(1)).join(', ') : 'Untitled note';
  return {
    title,
    overview: overview.map(x => x.s).join(' ') || String(text || '').slice(0, 300),
    key_points: key.map(x => x.s),
    decisions,
    action_items: actions.map(task => ({ task, owner: '', due: '' })),
    open_questions: questions,
    topics: top,
  };
}

export function localAnswer(question, text) {
  const q = question.toLowerCase();
  const sum = localSummary(text);
  const list = arr => arr.map(x => '- ' + (typeof x === 'string' ? x : x.task)).join('\n');
  if (/action|to-?do|task|follow.?up|next step|who (is|was|will)/.test(q)) {
    return sum.action_items.length ? 'Possible action items (basic keyword pass, no API key set):\n\n' + list(sum.action_items) : 'No sentences in the transcript look like action items. Add a Claude API key in Settings for real answers.';
  }
  if (/decid|agree|conclu|outcome|settled/.test(q)) {
    return sum.decisions.length ? 'Sentences that sound like decisions (basic keyword pass, no API key set):\n\n' + list(sum.decisions) : 'No sentences in the transcript look like decisions. Add a Claude API key in Settings for real answers.';
  }
  if (/question|unresolved|open|unclear|left/.test(q)) {
    return sum.open_questions.length ? 'Questions raised in the transcript:\n\n' + list(sum.open_questions) : 'No questions were found in the transcript.';
  }
  if (/recap|summar|overview|about|tl;?dr|gist|main point/.test(q)) {
    return 'Basic recap (no API key set):\n\n' + sum.overview + (sum.key_points.length ? '\n\nKey points:\n' + list(sum.key_points) : '');
  }
  const qs = new Set(words(question).filter(w => !STOP.has(w) && w.length > 2));
  if (!qs.size) return 'Try asking about something specific from the notes.';
  const scored = sentences(text)
    .map(s => ({ s, n: words(s).filter(w => qs.has(w)).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  if (!scored.length) return "I couldn't find anything about that in the transcript. Add a Claude API key in Settings for real answers.";
  return 'Closest matches in the transcript (keyword search, no API key set):\n\n' + scored.map(x => '- ' + x.s).join('\n');
}
