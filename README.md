# Matrix Rust SDK Log Visualiser

[![codecov](https://codecov.io/gh/manuroe/matrix-rust-sdk-log-visualiser/graph/badge.svg)](https://codecov.io/gh/manuroe/matrix-rust-sdk-log-visualiser)

A web viewer for [matrix-rust-sdk](https://github.com/matrix-org/matrix-rust-sdk) logs. **All processing runs locally in your browser** — no data is sent anywhere.

Live at **https://manuroe.github.io/matrix-rust-sdk-log-visualiser/**

![Logs view](public/demo/screenshot-logs-light.png#gh-light-mode-only)
![Logs view](public/demo/screenshot-logs-dark.png#gh-dark-mode-only)

![Summary view](public/demo/screenshot-summary-light.png#gh-light-mode-only)
![Summary view](public/demo/screenshot-summary-dark.png#gh-dark-mode-only)

![Sync waterfall](public/demo/screenshot-sync-light.png#gh-light-mode-only)
![Sync waterfall](public/demo/screenshot-sync-dark.png#gh-dark-mode-only)

## Demo mode

Click **"Try with demo logs"** on the landing page to explore the app without a real log file.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:5173

## Browser extension

The extension enhances listing pages of any [rageshake](https://github.com/matrix-org/rageshake) server deployment by replacing each log-file row with a parsed summary card and an "Open in Visualizer" button. It auto-detects rageshake listing pages using the standard `/api/listing/*` path — no configuration needed.

> **Note:** The extension is not yet published on the Chrome Web Store or Firefox Add-ons. It must be installed manually as an unpacked/temporary extension.

### Install

**Chrome / Edge**

```bash
npm run build:extension
```

Output is written to `extension-dist/`.

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (toggle, top-right).
3. Click **Load unpacked** and select the `extension-dist/` folder.

To pick up changes: run `npm run build:extension`, then click the ↺ refresh icon on the extension card.

**Firefox — temporary (session only)**

`extension-dist/` uses a Chrome-format manifest that Firefox does not support. Build the Firefox-specific bundle first:

```bash
npm run build:extension:firefox
```

Then:

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `extension-dist-firefox/manifest.json`.

To pick up changes: re-run `npm run build:extension:firefox`, click **Reload** next to the extension, then reload the rageshakes tab (Cmd+R).

The extension is removed when Firefox closes.

**Firefox — persistent (via web-ext)**

```bash
npm run webext:run
```

This builds the Firefox bundle and launches a dedicated Firefox profile with the extension pre-loaded. Preferred for active development.

### Usage

Navigate to any rageshake listing URL (e.g. `https://<your-rageshake-server>/api/listing/<id>/`). The content script runs automatically and replaces each `.log.gz` row with a summary card.

## Contributing

See [AGENTS.MD](AGENTS.MD) for architecture notes and agent/contributor guidance.
