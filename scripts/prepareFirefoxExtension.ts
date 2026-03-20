import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface ExtensionManifest {
  readonly background?: {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- browser extension manifest requires snake_case keys
    readonly service_worker?: string;
    readonly scripts?: readonly string[];
    readonly type?: 'module' | 'classic';
  };
  readonly [key: string]: unknown;
}

const sourceDir = resolve(process.cwd(), 'extension-dist');
const targetDir = resolve(process.cwd(), 'extension-dist-firefox');
const manifestPath = resolve(targetDir, 'manifest.json');

async function prepareFirefoxExtension(): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });

  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(rawManifest) as ExtensionManifest;
  const serviceWorkerFileName = manifest.background?.service_worker ?? 'background.js';

  const firefoxManifest: ExtensionManifest = {
    ...manifest,
    background: {
      scripts: [serviceWorkerFileName],
      type: 'module',
    },
  };

  await writeFile(manifestPath, `${JSON.stringify(firefoxManifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`Prepared Firefox extension build at ${targetDir}\n`);
}

void prepareFirefoxExtension().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
