/**
 * Captures screenshots of the app using the demo log.
 * Requires a build with VITE_BASE=/ (handled automatically by this script).
 * Output: public/demo/screenshot-*.png
 *
 * Usage: npm run screenshots
 */
import { chromium } from '@playwright/test';
import { spawnSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { parseLogFile } from '../src/utils/logParser.ts';
import { summarizeLogResult } from '../extension/src/summarize.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = dirname(currentFilePath);
const ROOT = resolve(currentDirPath, '..');
const OUT_DIR = resolve(ROOT, 'public', 'demo');
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
const VITE_BIN = resolve(ROOT, 'node_modules', '.bin', 'vite');
const EXTENSION_DIST = resolve(ROOT, 'extension-dist');
const EXTENSION_LISTING_SCREENSHOT_CLIP = {
  x: 0,
  y: 0,
  width: 1280,
  height: 320,
} as const;

// Build the app with VITE_BASE=/ so assets resolve correctly on localhost
console.warn('Building app...');
const buildResult = spawnSync(VITE_BIN, ['build'], {
  cwd: ROOT,
  stdio: 'inherit',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  env: { ...process.env, VITE_BASE: '/' },
});
if (buildResult.status !== 0) {
  console.error('Build failed.');
  process.exit(1);
}

// Build the extension so content.js and content.css are up to date.
console.warn('Building extension...');
const extensionBuildResult = spawnSync('npm', ['run', 'build:extension'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});
if (extensionBuildResult.status !== 0) {
  console.error('Extension build failed.');
  process.exit(1);
}

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      // Any HTTP response means the server is up
      if (res.status) return;
    } catch {
      // Not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

const server = spawn(VITE_BIN, ['preview', '--port', String(PORT), '--base', '/'], {
  cwd: ROOT,
  stdio: 'inherit',
});

async function main(): Promise<void> {
  await waitForServer(BASE_URL);
  console.warn('Preview server ready.');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  async function setTheme(theme: 'light' | 'dark'): Promise<void> {
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    // Let CSS transitions settle
    await page.waitForTimeout(300);
  }

  function arePngsVisuallyEqual(existingPng: Buffer, nextPng: Buffer): boolean {
    const existingImage = PNG.sync.read(existingPng);
    const nextImage = PNG.sync.read(nextPng);

    if (
      existingImage.width !== nextImage.width ||
      existingImage.height !== nextImage.height
    ) {
      return false;
    }

    const differentPixels = pixelmatch(
      existingImage.data,
      nextImage.data,
      undefined,
      existingImage.width,
      existingImage.height,
      { threshold: 0 },
    );

    return differentPixels === 0;
  }

  async function shot(
    name: string,
    options?: { readonly clip?: { x: number; y: number; width: number; height: number } },
  ): Promise<void> {
    const outputPath = resolve(OUT_DIR, `screenshot-${name}.png`);
    const nextPng = await page.screenshot({ type: 'png', clip: options?.clip });

    try {
      const existingPng = await readFile(outputPath);
      const hasVisualChanges = !arePngsVisuallyEqual(existingPng, nextPng);
      if (!hasVisualChanges) {
        console.warn(`↺ screenshot-${name}.png unchanged (no visual diff)`);
        return;
      }
    } catch (error: unknown) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }

    await writeFile(outputPath, nextPng);
    console.warn(`✓ screenshot-${name}.png updated`);
  }

  // Landing page
  await page.goto(`${BASE_URL}/#/`, { waitUntil: 'networkidle' });
  // Extra wait for React to complete its initial render
  await page.waitForTimeout(800);
  await setTheme('light');
  await shot('landing-light');
  await setTheme('dark');
  await shot('landing-dark');

  // Load demo data.
  await setTheme('light');
  const demoTrigger = page.locator('button, a', { hasText: 'Try with demo logs' }).first();
  await demoTrigger.waitFor({ state: 'visible', timeout: 15_000 });
  await demoTrigger.click();
  await page.waitForURL(/\/#\/summary/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  // Extra wait for charts to finish rendering after navigation
  await page.waitForTimeout(600);

  // Summary
  await shot('summary-light');
  await setTheme('dark');
  await shot('summary-dark');

  // Logs
  await page.goto(`${BASE_URL}/#/logs`);
  await page.waitForTimeout(600);
  await setTheme('light');
  await shot('logs-light');
  await setTheme('dark');
  await shot('logs-dark');

  // HTTP requests
  await page.goto(`${BASE_URL}/#/http_requests`);
  await page.waitForTimeout(600);
  await setTheme('light');
  await shot('http-light');
  await setTheme('dark');
  await shot('http-dark');

  // Sync waterfall
  await page.goto(`${BASE_URL}/#/http_requests/sync`);
  await page.waitForTimeout(600);
  await setTheme('light');
  await shot('sync-light');
  await setTheme('dark');
  await shot('sync-dark');

  // Extension listing page — navigate to the demo rageshake-style HTML, inject
  // a chrome API shim returning real parsed data from the demo log, then run
  // the actual content script IIFE so the DOM transformation is the real thing.
  const demoLogText = await readFile(resolve(ROOT, 'public', 'demo', 'demo.log'), 'utf-8');
  const demoSummary = summarizeLogResult(parseLogFile(demoLogText));

  await page.goto(`${BASE_URL}/demo/api/listing/demo/`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);

  // Before extension enhancement
  await page.evaluate(() => { document.documentElement.removeAttribute('data-rs-theme'); });
  await shot('extension-before-light', { clip: EXTENSION_LISTING_SCREENSHOT_CLIP });
  await page.evaluate(() => { document.documentElement.setAttribute('data-rs-theme', 'dark'); });
  await page.waitForTimeout(300);
  await shot('extension-before-dark', { clip: EXTENSION_LISTING_SCREENSHOT_CLIP });

  // Set up chrome global before the content script runs so chrome.storage and
  // chrome.runtime.sendMessage resolve with the real demo summary instead of
  // requiring an actual extension context.
  // Pass as a string (not a function) so that tsx/esbuild does not transform
  // the code — transformed output references __name which is undefined in the
  // browser when Playwright serialises the function via .toString().
  await page.evaluate(`
    window.chrome = {
      storage: { local: { get: function() { return Promise.resolve({}); } } },
      runtime: {
        sendMessage: function() {
          return Promise.resolve({ ok: true, summary: ${JSON.stringify(demoSummary)} });
        }
      }
    };
  `);

  await page.addStyleTag({ path: resolve(EXTENSION_DIST, 'content.css') });
  await page.addScriptTag({ path: resolve(EXTENSION_DIST, 'content.js') });

  // Wait until all loading placeholders have been replaced with real data.
  await page.waitForFunction(
    () => document.querySelectorAll('.rs-loading').length === 0,
    { timeout: 15_000 },
  );

  // Extension uses data-rs-theme (not data-theme like the main app).
  await page.evaluate(() => { document.documentElement.removeAttribute('data-rs-theme'); });
  await shot('extension-light', { clip: EXTENSION_LISTING_SCREENSHOT_CLIP });
  await page.evaluate(() => { document.documentElement.setAttribute('data-rs-theme', 'dark'); });
  await page.waitForTimeout(300);
  await shot('extension-dark', { clip: EXTENSION_LISTING_SCREENSHOT_CLIP });

  await browser.close();
  console.warn('All screenshots captured.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
  });
