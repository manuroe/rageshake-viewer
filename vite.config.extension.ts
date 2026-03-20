/**
 * Vite build configuration for the browser extension.
 *
 * Produces three artefacts in `extension-dist/`:
 *
 * 1. `content.css`  — Styles injected alongside the content script (copied as-is)
 * 2. `background.js` — ES module service worker
 * 3. `viewer.html` + `assets/` — Full React app served as an extension page;
 *    the `useExtensionFile` hook auto-loads the log on open.
 *
 * The content script (`content.js`) is built separately by
 * `vite.config.extension.content.ts` as an IIFE so it can be injected
 * as a classic script.  Both configs must run to produce a usable build.
 *
 * The `extension/manifest.json` is copied verbatim into `extension-dist/`, so
 * loading `extension-dist/` as an unpacked extension in Chrome/Firefox is all
 * that is needed for development.
 *
 * Run: `npm run build:extension`
 */

import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(root, 'extension-dist');

export default defineConfig({
  plugins: [
    react(),
    // Copy manifest.json and content.css into the output directory after build.
    {
      name: 'copy-extension-assets',
      closeBundle() {
        mkdirSync(outDir, { recursive: true });
        copyFileSync(
          resolve(root, 'extension/manifest.json'),
          resolve(outDir, 'manifest.json')
        );
        copyFileSync(
          resolve(root, 'extension/src/content.css'),
          resolve(outDir, 'content.css')
        );
      },
    },
  ],
  // Resolve `../../src/...` imports inside extension/src/ correctly.
  resolve: {
    alias: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Vite alias convention uses @-prefix paths
      '@app': resolve(root, 'src'),
    },
  },
  // Use the extension viewer.html as the root HTML entry so Vite bundles the
  // full React app into extension-dist/viewer.html + assets/.
  root: resolve(root, 'extension'),
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    // Build both the viewer SPA and the two extension scripts in one pass.
    rollupOptions: {
      input: {
        // Viewer page — bundles the full React app (entry: extension/viewer.html).
        viewer: resolve(root, 'extension/viewer.html'),
        // Background service worker.
        background: resolve(root, 'extension/src/background.ts'),
        // NOTE: content.ts is built separately by vite.config.extension.content.ts
        // as an IIFE. It is intentionally omitted here so that the ESM output
        // does not overwrite the IIFE content.js produced by the second build.
      },
      output: {
        // Flat filename for background so manifest.json reference is stable.
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
});
