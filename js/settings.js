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

function load() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch (e) { return { ...DEFAULTS }; }
}

export const settings = load();

export function update(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
}
