# Rageshake Viewer

[![codecov](https://codecov.io/gh/manuroe/rageshake-viewer/graph/badge.svg)](https://codecov.io/gh/manuroe/rageshake-viewer)

A web viewer for **rageshake logs** produced by the [Matrix Rust SDK](https://github.com/matrix-org/matrix-rust-sdk) and Element X apps ([Android](https://github.com/element-hq/element-x-android), [iOS](https://github.com/element-hq/element-x-ios)). **All processing runs locally in your browser** — no data is sent anywhere.

Live at **https://manuroe.github.io/rageshake-viewer/**

![Summary view](public/demo/screenshot-summary-light.png#gh-light-mode-only)
![Summary view](public/demo/screenshot-summary-dark.png#gh-dark-mode-only)

![Logs view](public/demo/screenshot-logs-light.png#gh-light-mode-only)
![Logs view](public/demo/screenshot-logs-dark.png#gh-dark-mode-only)

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

The extension enhances listing pages of any [rageshake](https://github.com/matrix-org/rageshake) server deployment by redirecting `/api/listing/*` pages into the bundled viewer and rendering them with the same archive-style screen used by the web app. It auto-detects rageshake archive pages using the standard `/api/listing/*` path — no configuration needed.

<table>
	<tr>
		<td align="center"><strong>Without extension</strong></td>
		<td align="center"><strong>With extension</strong></td>
	</tr>
	<tr>
		<td>
			<img src="public/demo/screenshot-extension-before-light.png#gh-light-mode-only" alt="Rageshake listing page without extension" />
			<img src="public/demo/screenshot-extension-before-dark.png#gh-dark-mode-only" alt="Rageshake listing page without extension" />
		</td>
		<td>
			<img src="public/demo/screenshot-extension-light.png#gh-light-mode-only" alt="Rageshake listing page enhanced by extension" />
			<img src="public/demo/screenshot-extension-dark.png#gh-dark-mode-only" alt="Rageshake listing page enhanced by extension" />
		</td>
	</tr>
</table>

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

Navigate to any rageshake listing URL (e.g. `https://<your-rageshake-server>/api/listing/<id>/`). The content script runs automatically and opens the bundled archive-style viewer for that listing, including per-file summaries, `details.json` metadata, and screenshot thumbnails when present.

## Contributing

See [AGENTS.MD](AGENTS.MD) for architecture notes and agent/contributor guidance.
