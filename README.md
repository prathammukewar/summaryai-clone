# Summary AI clone

A working recreation of the Summary AI note taker, packaged as a Chrome extension. Record a meeting, a lecture, or whatever is playing in a tab, get a transcript with timestamps, then let Claude turn it into structured notes you can chat with, translate, and export. Everything runs locally except the optional Claude calls.

The same files also run as a plain website: https://prathammukewar.github.io/summaryai-clone/

## Install the extension

1. Clone or download this repo.
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and pick the repo folder.
3. Click the Summary AI icon in the toolbar. The app opens in the side panel. Use "Open in a full tab" from the panel if you want more room.

To record an online meeting or a video, open that tab, click the extension icon on it, then choose **This tab** or **Tab and microphone** when you start a recording. Chrome only allows tab capture after the icon was clicked on that tab. Keep the panel open while recording; closing it stops the recording.

The first recording downloads the Whisper model (about 40 MB) from Hugging Face and caches it.

## What it does

- **Record** from the microphone, from the current tab (extension only), or both mixed together, with a live level meter and live captions. Pause and resume mid-recording.
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

There is a short sample recording on the welcome screen if you want to try it without a microphone.

Notes and audio live in IndexedDB in your browser. There is no backend and no account.

## AI features

Summaries, chat, translation, and speaker labels call the Claude API directly from the browser using your own key, which you paste into Settings. The key is stored in localStorage and never leaves your machine except in requests to Anthropic. The default model is Claude Opus 5, with Sonnet 5 and Haiku 4.5 as options. Summaries use structured outputs so the response always matches the schema the UI expects.

Without a key the app still transcribes and produces a basic extractive summary, and the chat falls back to keyword lookup, so you can try everything before deciding.

## Running it as a website

No build step. Serve the folder with any static server, since ES modules and workers do not load from `file://`:

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Microphone recording needs `localhost` or HTTPS. Tab capture is not available outside the extension.

## Layout

```
manifest.json       Chrome extension manifest (Manifest V3)
background.js       service worker: opens the side panel, hands out tab capture stream IDs
platform.js         tells the app where the vendored libraries live
index.html          app shell, dialogs, icon sprite
styles.css
vendor/             Anthropic SDK (bundled), transformers.js, ONNX runtime, pdf.js
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

Chrome extensions cannot load code from a CDN, so the libraries are vendored: the Anthropic TypeScript SDK (bundled once with esbuild into a single file), transformers.js, the ONNX runtime it needs, and pdf.js. The website uses the same files.

## Not included

The real product also joins calendar meetings with a bot, transcribes YouTube links, and syncs across devices through an account. None of that is possible from a static page, so it is out of scope here.

This is a front-end exercise and is not affiliated with Summary AI.
