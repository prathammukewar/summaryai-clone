# Summary AI clone

A working recreation of the Summary AI note taker that runs entirely as a static site on GitHub Pages. Record or upload audio, get a transcript with timestamps, then let Claude turn it into structured notes you can chat with, translate, and export.

Live: https://prathammukewar.github.io/summaryai-clone/

## What it does

- **Record** from the microphone with a live level meter and live captions (where the browser supports speech recognition). Pause and resume mid-recording.
- **Transcribe on device.** Whisper runs in the browser through transformers.js, inside a web worker, on WebGPU when available and WASM otherwise. The model downloads once (about 40 to 75 MB) and is cached. Nothing is uploaded anywhere.
- **Upload audio or video** (mp3, m4a, wav, webm, mp4 and anything else the browser can decode) and transcribe it the same way.
- **Import PDFs and text files**, or paste text straight in.
- **Summarize** into an overview, key points, decisions, action items with owners and due dates, open questions, and topic tags.
- **Ask AI** questions about a note, with streaming answers grounded in the transcript.
- **Translate** the summary or transcript into 25+ languages.
- **Label speakers** in a transcript without losing timestamps.
- **Play back** a recording and click any transcript line to jump to it.
- **Export** as Markdown, plain text, or SRT subtitles, copy to the clipboard, share through the system share sheet, or have the notes read aloud.
- **Organize** notes into folders and search across titles, transcripts, and summaries.

Notes and audio live in IndexedDB in your browser. There is no backend and no account.

## AI features

Summaries, chat, translation, and speaker labels call the Claude API directly from the browser using your own key, which you paste into Settings. The key is stored in localStorage and never leaves your machine except in requests to Anthropic. The default model is Claude Opus 5, with Sonnet 5 and Haiku 4.5 as options. Summaries use structured outputs so the response always matches the schema the UI expects.

Without a key the app still transcribes and produces a basic extractive summary, and the chat falls back to keyword lookup, so you can try everything before deciding.

## Running it locally

No build step. Serve the folder with any static server, since ES modules and workers do not load from `file://`:

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Microphone recording needs `localhost` or HTTPS.

## Layout

```
index.html          app shell, dialogs, icon sprite
styles.css
js/app.js           views, routing, note lifecycle
js/db.js            IndexedDB wrapper (notes and audio blobs)
js/recorder.js      MediaRecorder, level meter, live captions
js/whisper.js       audio decoding and worker bridge
js/whisper-worker.js  transformers.js pipeline off the main thread
js/ai.js            Anthropic SDK calls, streaming, error mapping
js/local.js         no-key fallbacks (extractive summary, keyword answers)
js/importers.js     PDF (pdf.js) and text import
js/export.js        Markdown, SRT, download, share, read aloud
js/markdown.js      small markdown renderer and HTML escaping
js/settings.js      persisted settings and option lists
```

Libraries load from CDNs at runtime: the Anthropic TypeScript SDK, transformers.js, and pdf.js.

## Not included

The real product also joins calendar meetings with a bot, transcribes YouTube links, and syncs across devices through an account. None of that is possible from a static page, so it is out of scope here.

This is a front-end exercise and is not affiliated with Summary AI.
