// The committed elevation data is only worth having if it is right. These
// tests decode the actual files in data/terrain and check them against heights
// that can be looked up independently.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  decodeBlock, sampleBlock, blocksFor, blocksForExtent, createRealTerrain,
  loadTerrain, TERRAIN_SOURCE, NODATA,
} from '../js/terrain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'data/terrain');
const read = async (p) => {
  const b = await readFile(resolve(dir, p));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));

// Known heights. Summits are published values; the sea points are open water.
const CHECKS = [
  { name: 'Ben Nevis summit', lat: 56.79685, lon: -5.00362, known: 1345, tol: 12 },
  { name: 'Scafell Pike summit', lat: 54.45420, lon: -3.21160, known: 978, tol: 20 },
  { name: 'Snowdon summit', lat: 53.06855, lon: -4.07626, known: 1085, tol: 20 },
  { name: 'Loch Linnhe, open water', lat: 56.64, lon: -5.36, known: 0, tol: 2 },
  { name: 'Sound of Mull, open water', lat: 56.52, lon: -5.80, known: 0, tol: 2 },
];

test('the manifest describes what the data is and what it is not', () => {
  assert.match(manifest.source, /Copernicus DEM GLO-30/);
  assert.match(manifest.model, /surface model/i);
  assert.match(manifest.model, /not bare earth/i);
  assert.ok(manifest.licence.includes('Copernicus'));
  assert.equal(manifest.nodata, NODATA);
  assert.ok(manifest.coarse && manifest.blocks.length > 0);
});

test('the coarse national grid decodes and covers the British Isles', async () => {
  const c = await decodeBlock(await read(manifest.coarse.file));
  assert.equal(c.nlat, manifest.coarse.nlat);
  assert.equal(c.nlon, manifest.coarse.nlon);
  assert.ok(c.data.length === c.nlat * c.nlon);
  // Corners of the box, and a point in the middle of the North Sea.
  assert.ok(c.lat0 <= 49.0 && c.lat0 + c.nlat * c.dlat >= 60.8);
  assert.ok(c.lon0 <= -8.6 && c.lon0 + c.nlon * c.dlon >= 1.7);
});

test('every fine block decodes, and its header matches the manifest', async () => {
  // Decoding all 30 is the point: a truncated or mis-delta'd file must fail here.
  let below20 = 0;
  let cells = 0;
  for (const meta of manifest.blocks) {
    const b = await decodeBlock(await read(meta.file));
    assert.equal(b.nlat, meta.nlat, `${meta.file}: row count`);
    assert.equal(b.nlon, meta.nlon, `${meta.file}: column count`);
    assert.ok(Math.abs(b.lat0 - meta.lat0) < 1e-9, `${meta.file}: lat origin`);
    assert.ok(Math.abs(b.lon0 - meta.lon0) < 1e-9, `${meta.file}: lon origin`);
    // Spreading a typed array into Math.min blows the stack, so walk it.
    let real = 0; let lo = Infinity; let hi = -Infinity; let belowHere = 0;
    for (const v of b.data) {
      if (v === NODATA) continue;
      real += 1;
      if (v < -20) belowHere += 1;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    assert.ok(real > 0, `${meta.file} holds no data at all`);
    // A handful of cells genuinely sit below sea level: quarries, polders and
    // Copernicus artefacts near the Channel coast. Measured across all 85.3
    // million cells, 34 are below -20 m and the lowest is -65 m at 50.83N
    // 1.75E. What must not happen is a whole row going wrong, which is what a
    // broken delta chain looks like.
    assert.ok(lo > -100, `${meta.file}: implausible low value ${lo} m`);
    assert.ok(hi < 1400, `${meta.file}: ${hi} m is above Ben Nevis, the highest point in the isles`);
    below20 += belowHere;
    cells += real;
  }
  // If a delta chain broke, this would be a large fraction rather than a trace.
  assert.ok(below20 / cells < 1e-5,
    `${below20} of ${cells} cells are below -20 m, which is too many to be quarries and polders`);
});

test('the 100 m data reproduces heights that can be looked up independently', async () => {
  for (const c of CHECKS) {
    const metas = blocksFor(manifest, c.lat, c.lon);
    assert.ok(metas.length > 0, `${c.name}: no block covers it`);
    let got = null;
    for (const m of metas) {
      const v = sampleBlock(await decodeBlock(await read(m.file)), c.lat, c.lon);
      if (v !== null) { got = v; break; }
    }
    assert.ok(got !== null, `${c.name}: block has no data there`);
    assert.ok(Math.abs(got - c.known) <= c.tol,
      `${c.name}: read ${got.toFixed(1)} m, published ${c.known} m, tolerance ${c.tol} m`);
  }
});

test('the coarse grid reads zero over open ocean, away from any coast', async () => {
  const coarse = await decodeBlock(await read(manifest.coarse.file));
  // NOT at the coastal points used for the fine grid. The build max-pools, so a
  // 500 m cell anywhere near land takes the highest post in it and reads as
  // land. That is deliberate. These points are well offshore.
  for (const [name, lat, lon] of [
    ['North Sea, 90 km off the Humber', 53.80, 1.20],
    ['Irish Sea, mid channel', 53.60, -4.80],
  ]) {
    const v = sampleBlock(coarse, lat, lon);
    assert.ok(v !== null && Math.abs(v) <= 2, `${name}: coarse grid reads ${v}`);
  }
});

test('max-pooling deliberately raises a coastal cell rather than averaging the cliff away', async () => {
  const coarse = await decodeBlock(await read(manifest.coarse.file));
  // A 500 m cell straddling the Sound of Mull shoreline takes the land height,
  // not the water. Reading the water here would mean the resample had thrown
  // away an obstruction, which is the failure mode this build is designed
  // against: it makes a beam look as though it clears ground it does not.
  const v = sampleBlock(coarse, 56.52, -5.80);
  assert.ok(v > 0, `coastal coarse cell reads ${v}, so the shoreline was averaged away`);
});

test('a terrain object built on the real data reads the right height at its own anchor', async () => {
  // Anchor on Ben Nevis and ask for the height at east=0, north=0.
  const loaded = await loadTerrain({
    lat: 56.79685, lon: -5.00362, halfExtentM: 5000, fetchFn: read,
  });
  const t = createRealTerrain({
    anchorLat: 56.79685, anchorLon: -5.00362,
    coarse: loaded.coarse, blocks: loaded.blocks,
  });
  const h = t.heightAt(0, 0);
  assert.ok(Math.abs(h - 1345) <= 12, `anchor height ${h.toFixed(1)} m against 1345 m`);
  assert.equal(t.real, true);
  assert.equal(t.coverage(), 1);
});

test('walking east from a summit goes downhill, which a synthetic surface cannot fake', async () => {
  const loaded = await loadTerrain({
    lat: 56.79685, lon: -5.00362, halfExtentM: 12000, fetchFn: read,
  });
  const t = createRealTerrain({
    anchorLat: 56.79685, anchorLon: -5.00362,
    coarse: loaded.coarse, blocks: loaded.blocks,
  });
  const summit = t.heightAt(0, 0);
  for (const d of [1000, 2000, 4000]) {
    assert.ok(t.heightAt(0, -d) < summit,
      `${d} m south of Ben Nevis should be lower than the summit`);
  }
});

test('the anchor has to be given, because east and north mean nothing without it', () => {
  assert.throws(() => createRealTerrain({ coarse: null, blocks: [] }), /anchorLat/);
});

test('missing data falls back to sea level and is counted rather than hidden', async () => {
  const loaded = await loadTerrain({ lat: 56.0, lon: -5.0, halfExtentM: 1000, fetchFn: read });
  const t = createRealTerrain({
    anchorLat: 56.0, anchorLon: -5.0, coarse: loaded.coarse, blocks: loaded.blocks,
  });
  // Far outside the committed box: mid-Atlantic.
  t.heightAt(-2_000_000, 0);
  assert.equal(t.stats.fallback, 1);
  assert.ok(t.coverage() < 1);
});

test('the module states the CORS finding that forced the pre-bake', () => {
  assert.equal(TERRAIN_SOURCE.corsBlocked, true);
  assert.match(TERRAIN_SOURCE.corsEvidence, /403/);
  assert.match(TERRAIN_SOURCE.model, /surface model/i);
});

test('an extent request picks up every block it straddles', () => {
  // A point near a 2-degree block corner must pull more than one block.
  const many = blocksForExtent(manifest, 55.0, -3.0, 60000);
  assert.ok(many.length >= 2, `expected several blocks at a corner, got ${many.length}`);
  const one = blocksForExtent(manifest, 56.5, -4.5, 5000);
  assert.equal(one.length, 1);
});

test('resampling keeps summits rather than averaging them away', async () => {
  // The build max-pools the 30 m source onto the 100 m grid. Nearest-neighbour
  // sampling lost 33 m at Snowdon and 11 m at Scafell Pike, which would make a
  // beam look as though it clears a hill it does not. Every summit above must
  // now read at or above the value nearest neighbour gave, and within 12 m.
  const WAS_NEAREST = { 'Snowdon summit': 1052.2, 'Scafell Pike summit': 967.0 };
  for (const c of CHECKS.filter((x) => x.known > 0)) {
    const metas = blocksFor(manifest, c.lat, c.lon);
    let got = null;
    for (const m of metas) {
      const v = sampleBlock(await decodeBlock(await read(m.file)), c.lat, c.lon);
      if (v !== null) { got = v; break; }
    }
    const before = WAS_NEAREST[c.name];
    if (before !== undefined) {
      assert.ok(got > before,
        `${c.name}: max-pooling gave ${got.toFixed(1)} m, no better than the ${before} m `
        + 'that nearest neighbour gave');
    }
  }
});

test('a block with a missing corner refuses to interpolate rather than guessing', () => {
  // The committed data has no NODATA cells: a cell with no Copernicus tile is
  // open sea and is stored as 0 m. So nothing in data/terrain exercises this
  // guard, and without a made-up block it would be untested dead code that the
  // fallback path in createRealTerrain quietly depends on.
  const b = {
    lat0: 50, lon0: -5, dlat: 0.001, dlon: 0.001, nlat: 4, nlon: 4, nodata: NODATA,
    data: new Int16Array([
      10, 10, 10, 10,
      10, 10, 10, 10,
      10, 10, NODATA, 10,
      10, 10, 10, 10,
    ]),
  };
  // The hole is at row 2, column 2, so only the quad at rows 0-1 and columns
  // 0-1 avoids it. That one interpolates normally.
  assert.equal(sampleBlock(b, 50.0010, -4.9990), 10);
  // Any quad touching the hole refuses, so the caller can fall back rather
  // than averaging a -32768 into the answer.
  assert.equal(sampleBlock(b, 50.0015, -4.9985), null);
  assert.equal(sampleBlock(b, 50.0025, -4.9975), null);
  // Outside the block entirely.
  assert.equal(sampleBlock(b, 51, -5), null);
});

test('a terrain object falls back when its fine block has a hole', () => {
  const holed = {
    lat0: 50, lon0: -5, dlat: 0.001, dlon: 0.001, nlat: 4, nlon: 4, nodata: NODATA,
    data: new Int16Array(16).fill(NODATA),
  };
  const t = createRealTerrain({
    anchorLat: 50.002, anchorLon: -4.998, coarse: null, blocks: [holed], seaLevel: 0,
  });
  assert.equal(t.heightAt(0, 0), 0);
  assert.equal(t.stats.fallback, 1);
  assert.equal(t.stats.fine, 0);
});
