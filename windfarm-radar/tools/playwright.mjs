// Find playwright wherever it is installed.
//
// The browser harnesses in this directory are not part of the shipped tool and
// playwright is not a dependency of it, so `import { chromium } from
// 'playwright'` resolves only when node_modules sits above tools/. It usually
// does not, and the failure mode was bad: the verifier died on the import,
// printed a module-resolution stack, and anyone reading a pipeline's tail saw
// what looked like an ordinary pass. Resolve it explicitly instead and say
// what to do when it is missing.
//
// Order: a normal install, then PLAYWRIGHT_ROOT, then the global root npm
// reports. Set PLAYWRIGHT_ROOT to the directory that CONTAINS node_modules.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function tryImport(dir) {
  const entry = join(dir, 'node_modules', 'playwright', 'index.mjs');
  if (!existsSync(entry)) return null;
  return import(pathToFileURL(entry).href);
}

export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch { /* not installed next to the harness; keep looking */ }

  const roots = [];
  if (process.env.PLAYWRIGHT_ROOT) roots.push(process.env.PLAYWRIGHT_ROOT);
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    if (globalRoot) roots.push(globalRoot.replace(/\/node_modules$/, ''));
  } catch { /* npm not on the path */ }
  roots.push(process.cwd());

  for (const dir of roots) {
    const mod = await tryImport(dir);
    if (mod) return mod.chromium;
  }
  throw new Error('playwright not found. Install it (npm i -D playwright) or set '
    + 'PLAYWRIGHT_ROOT to the directory containing node_modules. '
    + `Looked in: ${roots.join(', ')}`);
}

/** The browser this environment ships, so nothing tries to download one. */
export const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
export const LAUNCH_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
