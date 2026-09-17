const KEY = 'summaryai-clone.settings';

export const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5',
  whisperModel: 'onnx-community/whisper-tiny.en',
  speechLang: 'en-US',
  outputLang: 'English',
  autoSummarize: true,
  theme: 'system',
  speed: 1,
  summaryTemplate: 'auto',
  wordTimestamps: true,
};

export const MODELS = [
  ['claude-opus-5', 'Claude Opus 5 (default)'],
  ['claude-sonnet-5', 'Claude Sonnet 5'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5'],
];

export const WHISPER_MODELS = [
  ['onnx-community/whisper-tiny.en', 'Tiny, English only (fastest, about 40 MB)'],
  ['onnx-community/whisper-base.en', 'Base, English only (more accurate, about 75 MB)'],
  ['onnx-community/whisper-tiny', 'Tiny, multilingual (about 40 MB)'],
  ['onnx-community/whisper-base', 'Base, multilingual (about 75 MB)'],
];

export const SPEECH_LANGS = [
  ['auto', 'Detect automatically (multilingual models only)'],
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'],
  ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'],
  ['pt-BR', 'Portuguese (Brazil)'], ['hi-IN', 'Hindi'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'],
  ['zh-CN', 'Chinese (Mandarin)'], ['ar-SA', 'Arabic'], ['ru-RU', 'Russian'], ['nl-NL', 'Dutch'],
  ['tr-TR', 'Turkish'], ['pl-PL', 'Polish'], ['id-ID', 'Indonesian'], ['vi-VN', 'Vietnamese'],
];

export const LANGS = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Hindi', 'Marathi', 'Bengali', 'Tamil',
  'Japanese', 'Korean', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Arabic', 'Russian', 'Dutch',
  'Turkish', 'Polish', 'Indonesian', 'Vietnamese', 'Thai', 'Swedish', 'Greek', 'Hebrew', 'Ukrainian',
];

// How the summary is shaped. "auto" picks from the transcript itself.
export const SUMMARY_TEMPLATES = {
  auto: { label: 'Choose automatically', hint: '' },
  lecture: {
    label: 'Lecture or class',
    hint: `This is a lecture or class. key_points are the concepts taught, each stated so it could be revised from. decisions carry anything administrative that was settled (deadlines, what is on the exam, what moved). action_items are what the student has to do, with the due date the lecturer gave. open_questions are what the lecturer left hanging or told the room to think about. Put anything the lecturer flagged as important or examinable into key_points first.`,
  },
  meeting: {
    label: 'Meeting or standup',
    hint: `This is a work meeting. Lead with what was decided and who owes what. decisions must be things actually agreed, not things discussed. Every action_item needs an owner when a name was said, and a due date when one was given. open_questions are blockers and unresolved disagreements.`,
  },
  interview: {
    label: 'Interview or user call',
    hint: `This is an interview or a call with a user or customer. key_points are what the interviewee said, in their framing, not the interviewer's. Prefer their own words. decisions are commitments either side made. open_questions are what to follow up on next time. topics are the themes worth tagging for later synthesis.`,
  },
  podcast: {
    label: 'Podcast or talk',
    hint: `This is a talk, podcast, or presentation with no participants to assign work to. Expect action_items and decisions to be empty, and do not invent them. Put the weight into overview and key_points, and make key_points substantive claims rather than topic labels.`,
  },
  reading: {
    label: 'Paper or document',
    hint: `This is a written document rather than speech. key_points are the claims the document makes. decisions is normally empty. open_questions are the limitations, gaps, or questions the document leaves. Say in overview what kind of document it is and what it argues.`,
  },
};

function load() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch (e) { return { ...DEFAULTS }; }
}

export const settings = load();

export function update(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
}
