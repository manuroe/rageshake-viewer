/**
 * Vite build configuration for the extension content script only.
 *
 * Produces `extension-dist/content.js` as an IIFE so the browser can inject
 * and execute it as a classic content script without any module loader.
 *
 * This config is intentionally separate from `vite.config.extension.ts`
 * because Rollup cannot emit IIFE and ESM formats for different entries in a
 * single output pass — the background service worker requires ESM while the
 * content script requires IIFE.  Running two sequential builds avoids the
 * need for duplicated output blocks that each have to discard unwanted entries.
 *
 * Run: `npm run build:extension` (calls this automatically after the main build)
 */

import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { resolve } from 'path';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(root, 'extension-dist');

export default defineConfig({
  resolve: {
    alias: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Vite alias convention uses @-prefix paths
      '@app': resolve(root, 'src'),
    },
  },
  build: {
    outDir,
    // Preserve the output from the main extension build — only overwrite content.js.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(root, 'extension/src/content.ts'),
      output: {
        // Emit a single self-contained IIFE file at the root of extension-dist/
        // so the manifest `"js": ["content.js"]` reference resolves correctly.
        entryFileNames: 'content.js',
        format: 'iife',
        name: 'ContentScript',
        // Inline any dynamic imports so the IIFE is fully self-contained.
        inlineDynamicImports: true,
      },
    },
  },
});
