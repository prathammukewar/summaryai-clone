// Claude calls go straight from the browser to Anthropic with the user's own key.
import { settings } from './settings.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.124.0/+esm';
let Anthropic = null;

export class NoKeyError extends Error {
  constructor() { super('Add your Anthropic API key in Settings to use AI features.'); this.name = 'NoKeyError'; }
}

export function hasKey() { return !!(settings.apiKey && settings.apiKey.trim()); }

async function client() {
  if (!hasKey()) throw new NoKeyError();
  if (!Anthropic) Anthropic = (await import(SDK_URL)).default;
  return new Anthropic({ apiKey: settings.apiKey.trim(), dangerouslyAllowBrowser: true });
}

function buildParams(base) {
  const model = settings.model;
  const p = { model, max_tokens: 16000, ...base };
  // Opus 5 and Fable can decline a request on safety grounds; let the API
  // re-run it on Anthropic's recommended fallback model instead of failing.
  if (/^claude-(opus-5|fable)/.test(model)) {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  if (!/haiku/.test(model)) {
    p.output_config = { ...(p.output_config || {}), effort: 'medium' };
  }
  return p;
}

// Streams a single completion. Returns the concatenated text.
export async function complete({ system, messages, schema, onText, maxTokens }) {
  const c = await client();
  const base = { system, messages };
  if (schema) base.output_config = { format: { type: 'json_schema', schema } };
  if (maxTokens) base.max_tokens = maxTokens;
  const p = buildParams(base);
  const stream = p.betas ? c.beta.messages.stream(p) : c.messages.stream(p);
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && onText) onText(ev.delta.text);
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    const why = msg.stop_details && msg.stop_details.explanation;
    throw new Error('The model declined this request' + (why ? ': ' + why : '.'));
  }
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

export async function ping() {
  return complete({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64 });
}

export function describeError(e) {
  if (e instanceof NoKeyError) return e.message;
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError) return 'That API key was rejected. Check it in Settings.';
    if (e instanceof Anthropic.PermissionDeniedError) return 'This key is not allowed to use that model. Try another model in Settings.';
    if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Try again in a moment.';
    if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your connection.';
    if (e instanceof Anthropic.APIError) return 'API error ' + (e.status || '') + ': ' + e.message;
  }
  return e && e.message ? e.message : String(e);
}
