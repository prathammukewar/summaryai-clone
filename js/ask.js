// Ask a question across every note, not just the open one.
//
// The whole library will not fit in one request and most of it is irrelevant
// anyway, so this scores notes against the question, keeps the best few, and
// sends their summaries plus the passages that actually matched.
import * as ai from './ai.js';
import { settings } from './settings.js';
import { STOP, words, sentences } from './local.js';
import * as exp from './export.js';

const MAX_NOTES = 6;
const MAX_CHARS = 42000;          // context budget across all notes
const MAX_EXCERPT = 2600;         // per note

function terms(q) {
  return [...new Set(words(q).filter(w => !STOP.has(w) && w.length > 2))];
}

// "deadlines" has to find "deadline", so match the stem plus a short suffix
// rather than the literal word.
const reCache = new Map();
function termRe(t) {
  if (reCache.has(t)) return reCache.get(t);
  const stem = t.length > 4 && /s$/.test(t) ? t.slice(0, -1) : t;
  const re = new RegExp('\\b' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w{0,3}\\b', 'gi');
  reCache.set(t, re);
  return re;
}

function countIn(text, ts) {
  if (!text) return 0;
  let n = 0;
  for (const t of ts) {
    const re = termRe(t);
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) n += m.length;
  }
  return n;
}

// Everything in a summary is worth searching, not just the overview.
function summaryText(n) {
  const s = n.summary;
  if (!s) return '';
  return [
    s.overview,
    ...(s.key_points || []),
    ...(s.decisions || []),
    ...(s.open_questions || []),
    ...(s.topics || []),
    ...(s.action_items || []).map(a => [a.task, a.owner, a.due].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' ');
}

// Title matches count for more than body matches, and a summary match for more
// than a passing mention in the transcript.
export function rank(notes, question) {
  const ts = terms(question);
  if (!ts.length) return notes.slice(0, MAX_NOTES).map(n => ({ note: n, score: 0 }));
  const scored = notes.map(n => {
    const score = countIn(n.title, ts) * 6
      + countIn(summaryText(n), ts) * 3
      + countIn(n.transcript, ts)
      + countIn(n.folder, ts) * 2;
    return { note: n, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_NOTES);
}

// The sentences in a note that actually mention the question's words. When the
// match was in the summary rather than the transcript, quote the summary lines,
// otherwise the excerpt shows an irrelevant opening paragraph.
function summaryHits(note, ts, limit) {
  const s = note.summary;
  if (!s) return '';
  const lines = [
    ...(s.key_points || []).map(x => ['Key point', x]),
    ...(s.decisions || []).map(x => ['Decision', x]),
    ...(s.open_questions || []).map(x => ['Open question', x]),
    ...(s.action_items || []).map(a => ['Action', a.task + (a.owner ? ` (${a.owner})` : '') + (a.due ? `, due ${a.due}` : '')]),
  ].filter(([, x]) => x && countIn(x, ts) > 0);
  if (!lines.length) return '';
  return lines.slice(0, 8).map(([k, x]) => `${k}: ${x}`).join('\n').slice(0, limit);
}

export function excerpt(note, question, limit = MAX_EXCERPT) {
  const ts = terms(question);
  const sents = sentences(note.transcript);
  if (!ts.length) return note.transcript.slice(0, limit);
  if (!sents.length) return summaryHits(note, ts, limit) || note.transcript.slice(0, limit);
  const hits = sents
    .map((sent, i) => ({ s: sent, i, n: countIn(sent, ts) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)
    .sort((a, b) => a.i - b.i);
  if (!hits.length) {
    const fromSummary = summaryHits(note, ts, limit);
    if (fromSummary) return fromSummary;
    return note.transcript.slice(0, limit);
  }
  const keep = new Set();
  hits.forEach(h => { keep.add(h.i - 1); keep.add(h.i); keep.add(h.i + 1); });
  let out = '', last = -2;
  for (let i = 0; i < sents.length && out.length < limit; i++) {
    if (!keep.has(i)) continue;
    if (i > last + 1) out += (out ? '\n\n… ' : '');
    out += sents[i] + ' ';
    last = i;
  }
  return out.trim().slice(0, limit);
}

export function buildContext(notes, question) {
  const picked = rank(notes, question);
  const blocks = [];
  let used = 0;
  picked.forEach(({ note }, i) => {
    if (used > MAX_CHARS) return;
    const head = `<note index="${i + 1}" title="${note.title.replace(/"/g, "'")}" date="${new Date(note.createdAt).toLocaleDateString()}"${note.folder ? ` folder="${note.folder.replace(/"/g, "'")}"` : ''}>`;
    const body = (note.summary ? exp.summaryMarkdown(note.summary) + '\n\n' : '')
      + 'Transcript excerpt:\n' + excerpt(note, question);
    const block = head + '\n' + body + '\n</note>';
    used += block.length;
    blocks.push(block);
  });
  return { picked, text: blocks.join('\n\n') };
}

const system = () => `You answer questions about the user's own saved notes. You are given the notes that best match the question, each with an index, a title, and a date.

Rules:
- Answer only from the notes given. If they do not cover it, say so plainly and say what they do cover.
- Cite the note you took each claim from with its index in square brackets, like [2]. Cite every specific claim.
- When several notes disagree or cover the same ground at different times, say so and give the dates.
- Be concise. Use markdown lists where they help.
- Write in ${settings.outputLang}.`;

// Returns { text, picked } so the UI can link the citations back to the notes.
export async function askAll(notes, question, history, onText) {
  const { picked, text } = buildContext(notes, question);
  if (!picked.length) {
    return { text: 'Nothing in your notes mentions that. Try different words, or check that the note you mean has finished transcribing.', picked: [] };
  }
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.text })),
    { role: 'user', content: `<notes>\n${text}\n</notes>\n\nQuestion: ${question}` },
  ];
  const answer = await ai.complete({ system: system(), messages, onText });
  return { text: answer, picked };
}

// Keyword fallback when there is no API key.
export function localAskAll(notes, question) {
  const picked = rank(notes, question);
  if (!picked.length) return { text: 'No note mentions that. Add a Claude API key in Settings for real answers across your notes.', picked: [] };
  const body = picked.slice(0, 4).map(({ note }, i) => {
    const ex = excerpt(note, question, 320);
    return `**[${i + 1}] ${note.title}**\n\n${ex}`;
  }).join('\n\n');
  return { text: `Keyword matches across ${picked.length} note${picked.length === 1 ? '' : 's'} (no API key set):\n\n${body}`, picked };
}
