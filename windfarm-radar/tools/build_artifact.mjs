// Build the single-page form of the tool for publishing as an Artifact.
//
// The app normally runs as index.html plus css/ and js/. An Artifact serves
// the page and its supporting files from one root, so this inlines the
// stylesheet, shortens the title to a name, and repoints the three.js import
// at js/vendor/ inside that root. Nothing else is transformed: the JavaScript
// is published as it is, so what you click on is the code in this repository.
//
// Run from the windfarm-radar directory: node tools/build_artifact.mjs [outdir]

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '..');
const outDir = process.argv[2] || join(root, 'build', 'artifact');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');

const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
if (!body.includes('<header class="topbar">')) throw new Error('body markers moved');

const page = `<title>Wind Farm Radar Assessor</title>

<script type="importmap">
{ "imports": { "three": "./js/vendor/three.module.js" } }
</script>

<style>
${css}
</style>

${body.trim()}
`;

mkdirSync(join(outDir, 'js', 'vendor'), { recursive: true });
writeFileSync(join(outDir, 'index.html'), page);

const modules = readFileSync(join(root, 'js', 'main.js'), 'utf8');
if (!modules) throw new Error('js/main.js is empty');

// Every module the page loads, plus three.js from the repository root.
const js = [
  'analysis', 'cap670', 'displays', 'findings', 'geo', 'heatmap', 'importers',
  'main', 'model', 'officewriter', 'references', 'report', 'rf', 'scene',
  'sea', 'sweep', 'ui', 'uksites', 'wind',
];
for (const name of js) copyFileSync(join(root, 'js', `${name}.js`), join(outDir, 'js', `${name}.js`));
copyFileSync(join(repoRoot, 'js', 'vendor', 'three.module.js'), join(outDir, 'js', 'vendor', 'three.module.js'));

console.log(`built ${js.length + 2} files into ${outDir}`);
console.log(`index.html ${(page.length / 1024).toFixed(1)} kB`);
