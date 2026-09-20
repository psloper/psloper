// Build ONE self-contained .html that runs from a USB stick by double-clicking.
//
// WHY A SINGLE FILE AND NOT JUST A COPY OF THE FOLDER.
//
// Copying the project to a stick and opening index.html does not work. The app
// is ES modules, and a browser refuses to load a module over file:// : the
// origin is "null" and every import is blocked by CORS. Tested: the control
// rail does not render at all and the console shows
//   Access to script at 'file:///.../js/main.js' from origin 'null' has been
//   blocked by CORS
// The terrain fetches would fail the same way.
//
// So everything is bundled into one file: the modules through esbuild, the
// stylesheet inline, and the elevation data as base64 inside the page. No
// imports, no fetches, no server. Open it and it works, online or off.
//
// Run from the windfarm-radar directory (needs esbuild on PATH or in node_modules):
//   node tools/build_offline.mjs [outfile]

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '..');
const outFile = process.argv[2] || join(root, 'dist', 'windfarm-radar-offline.html');

const esbuild = process.env.ESBUILD || 'npx';
const esbuildArgs = process.env.ESBUILD ? [] : ['--yes', 'esbuild'];

mkdirSync(dirname(outFile), { recursive: true });
const tmp = join(root, '.offline-build');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

// The page normally resolves the bare "three" specifier through an import map.
// esbuild needs the same mapping, and an alias is the direct way to give it.
const threePath = join(repoRoot, 'js', 'vendor', 'three.module.js');

console.log('bundling modules...');
execFileSync(esbuild, [...esbuildArgs,
  join(root, 'js', 'main.js'),
  '--bundle', '--format=iife', '--target=es2022', '--platform=browser',
  `--alias:three=${threePath}`,
  `--outfile=${join(tmp, 'bundle.js')}`,
], { stdio: 'inherit', cwd: tmp });

const bundle = readFileSync(join(tmp, 'bundle.js'), 'utf8');
console.log(`  bundle ${(bundle.length / 1e6).toFixed(2)} MB`);

// The elevation data, base64 inside the page. The offline build cannot fetch
// it, so js/terrain.js reads it from this global instead.
const tdir = join(root, 'data', 'terrain');
const manifest = JSON.parse(readFileSync(join(tdir, 'manifest.json'), 'utf8'));
const embedded = {};
let terrainBytes = 0;
for (const f of readdirSync(tdir)) {
  if (!f.endsWith('.bin')) continue;
  const b = readFileSync(join(tdir, f));
  terrainBytes += b.length;
  embedded[f] = b.toString('base64');
}
manifest.encoding = 'embedded base64 in the offline single-file build';
console.log(`  terrain ${(terrainBytes / 1e6).toFixed(1)} MB binary, `
  + `${(Object.values(embedded).reduce((a, s) => a + s.length, 0) / 1e6).toFixed(1)} MB as base64`);

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script type="module"[^>]*><\/script>/, '');

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Wind Farm / Radar Interference Assessor (offline)</title>
<meta name="description" content="Self-contained offline build. No network, no server, no install." />
<style>
${css}
</style>
</head>
<body>
${body.trim()}
<script>
// Elevation data, embedded. js/terrain.js looks here before trying to fetch,
// which it cannot do from a file:// page anyway.
window.__TERRAIN_MANIFEST__ = ${JSON.stringify(manifest)};
window.__TERRAIN_FILES__ = ${JSON.stringify(embedded)};
</script>
<script>
${bundle}
</script>
</body>
</html>
`;

writeFileSync(outFile, page);
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${outFile}`);
console.log(`${(page.length / 1e6).toFixed(1)} MB, one file, no dependencies`);
