// Real elevation data, pre-baked into this repository.
//
// WHY IT IS PRE-BAKED AND NOT FETCHED FROM A MAPPING SERVICE.
//
// The only elevation source reachable from the environment this tool was built
// in is the Copernicus DEM GLO-30 bucket on AWS Open Data. It serves HTTP range
// requests, but it sends NO CORS headers: an OPTIONS preflight carrying an
// Origin returns 403, and a ranged GET comes back with no
// Access-Control-Allow-Origin. A browser cannot read it. So the data is fetched
// by tools/build_terrain.py at build time and committed, and the page loads it
// from its own origin like any other asset. Nothing is sent anywhere.
//
// WHAT THE DATA IS, AND WHAT IT IS NOT.
//
// Copernicus DEM GLO-30 is a digital SURFACE model. It includes trees and
// buildings; it is not bare earth. For working out whether a radar beam clears
// a hill that is arguably the right thing. For setting the ground level at a
// turbine base it reads high wherever there is forest or built-up land.
//
// Validated against known heights when the pipeline was built: Ben Nevis reads
// 1342 m against a published 1345 m, and two open-water points read exactly
// 0.0 m. test/terrain.test.mjs repeats those checks against the committed data.
//
// ACCURACY IS NOT THE SAME AS PRECISION. The grid is 100 m, but the position
// you sample it at carries its own error. The UK planning-record wind farm
// positions in this tool are out by about 1,100 m, and within that radius the
// ground height varies by a median of 232 m in coastal terrain and 543 m in
// upland. Real terrain sampled at an uncertain position is not automatically
// better than an obviously synthetic surface: it is a precise number with a
// large unknown error. Use it with surveyed positions, or treat it as
// indicative.

const MAGIC = 'UKDEM1\0\0';
export const NODATA = -32768;

export const TERRAIN_SOURCE = {
  name: 'Copernicus DEM GLO-30',
  fullName: 'COP-DEM_GLO-30-DGED, Copernicus Digital Elevation Model',
  via: 'AWS Open Data, copernicus-dem-30m.s3.amazonaws.com',
  model: 'digital surface model: includes trees and buildings, not bare earth',
  licence: 'Free, full and open under the Copernicus programme. Credit ESA / Copernicus.',
  nativeSpacingM: 30,
  corsBlocked: true,
  corsEvidence: 'OPTIONS preflight with an Origin header returns 403; a ranged GET '
    + 'returns no Access-Control-Allow-Origin. Probed 2026-09-20.',
};

/**
 * Decode one .bin produced by tools/build_terrain.py: gzip over a small header
 * and row-wise delta-encoded int16 metres.
 */
export async function decodeBlock(buffer) {
  let bytes = new Uint8Array(buffer);

  // The published copy of this tool carries the same bytes as base64 text,
  // because the artifact host serves no binary type. The repository keeps the
  // real .bin files. Gzip starts 0x1f 0x8b, and base64 of that starts "H4sI",
  // so the two are never ambiguous.
  if (bytes[0] === 0x48 && bytes[1] === 0x34) {
    const text = new TextDecoder().decode(bytes).replace(/\s+/g, '');
    const bin = atob(text);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }

  // gzip magic. Everything the builder writes is compressed, but accept plain
  // too so a file can be inspected without tooling.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot ungzip the terrain data (no DecompressionStream).');
    }
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== MAGIC) throw new Error('Not a terrain block: bad magic bytes.');

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lat0 = dv.getFloat64(8, true);
  const lon0 = dv.getFloat64(16, true);
  const dlat = dv.getFloat64(24, true);
  const dlon = dv.getFloat64(32, true);
  const nlat = dv.getUint32(40, true);
  const nlon = dv.getUint32(44, true);
  const nodata = dv.getInt16(48, true);

  const HEADER = 56;
  const expect = HEADER + nlat * nlon * 2;
  if (bytes.byteLength < expect) {
    throw new Error(`Terrain block is short: ${bytes.byteLength} bytes, expected ${expect}.`);
  }

  // Undo the row-wise delta. Column 0 of each row holds the absolute value.
  const delta = new Int16Array(bytes.buffer.slice(
    bytes.byteOffset + HEADER, bytes.byteOffset + expect));
  const data = new Int16Array(nlat * nlon);
  for (let i = 0; i < nlat; i++) {
    const row = i * nlon;
    let acc = delta[row];
    data[row] = acc;
    for (let j = 1; j < nlon; j++) {
      acc += delta[row + j];
      data[row + j] = acc;
    }
  }

  return { lat0, lon0, dlat, dlon, nlat, nlon, nodata, data };
}

/** Bilinear sample, in metres AMSL, or null where the block has no data. */
export function sampleBlock(b, lat, lon) {
  const fi = (lat - b.lat0) / b.dlat - 0.5;
  const fj = (lon - b.lon0) / b.dlon - 0.5;
  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= b.nlat || j0 + 1 >= b.nlon) return null;
  const ti = fi - i0;
  const tj = fj - j0;

  const a = b.data[i0 * b.nlon + j0];
  const c = b.data[i0 * b.nlon + j0 + 1];
  const d = b.data[(i0 + 1) * b.nlon + j0];
  const e = b.data[(i0 + 1) * b.nlon + j0 + 1];
  // One missing corner poisons the interpolation, so refuse rather than guess.
  if (a === b.nodata || c === b.nodata || d === b.nodata || e === b.nodata) return null;

  return (a * (1 - tj) + c * tj) * (1 - ti) + (d * (1 - tj) + e * tj) * ti;
}

/** Which 100 m blocks in the manifest could hold this point. */
export function blocksFor(manifest, lat, lon) {
  return manifest.blocks.filter((b) => lat >= b.lat0 && lat < b.lat0 + b.nlat * b.dlat
    && lon >= b.lon0 && lon < b.lon0 + b.nlon * b.dlon);
}

/** Every block needed to cover a box of halfExtentM around a point. */
export function blocksForExtent(manifest, lat, lon, halfExtentM) {
  const dLat = halfExtentM / 111320;
  const dLon = halfExtentM / (111320 * Math.cos(lat * Math.PI / 180));
  return manifest.blocks.filter((b) => {
    const top = b.lat0 + b.nlat * b.dlat;
    const right = b.lon0 + b.nlon * b.dlon;
    return top > lat - dLat && b.lat0 < lat + dLat
      && right > lon - dLon && b.lon0 < lon + dLon;
  });
}

/**
 * A terrain object with the same shape as createTerrain in geo.js, backed by
 * the real data. east and north are metres from the SCENE ORIGIN, which is the
 * radar, so anchorLat and anchorLon must be the radar's position.
 *
 * Heights come from the finest block that covers the point, then the coarse
 * national grid, and finally `seaLevel` where neither has data. Whether a
 * sample was real or fell back is counted, so the tool can say how much of the
 * modelled area it actually covered.
 */
export function createRealTerrain({ anchorLat, anchorLon, coarse, blocks = [], seaLevel = 0 }) {
  if (!Number.isFinite(anchorLat) || !Number.isFinite(anchorLon)) {
    throw new Error('createRealTerrain needs the radar position as anchorLat and anchorLon.');
  }
  const DEG = Math.PI / 180;
  // Same local projection the importers use, so real terrain and imported
  // positions land in the same place.
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * anchorLat * DEG)
    + 1.175 * Math.cos(4 * anchorLat * DEG);
  const mPerDegLon = 111412.84 * Math.cos(anchorLat * DEG)
    - 93.5 * Math.cos(3 * anchorLat * DEG);

  const stats = { fine: 0, coarse: 0, fallback: 0 };

  function heightAt(east, north) {
    const lat = anchorLat + north / mPerDegLat;
    const lon = anchorLon + east / mPerDegLon;
    for (const b of blocks) {
      const v = sampleBlock(b, lat, lon);
      if (v !== null) { stats.fine += 1; return v; }
    }
    if (coarse) {
      const v = sampleBlock(coarse, lat, lon);
      if (v !== null) { stats.coarse += 1; return v; }
    }
    stats.fallback += 1;
    return seaLevel;
  }

  return {
    heightAt,
    stats,
    anchorLat,
    anchorLon,
    base: seaLevel,
    real: true,
    source: TERRAIN_SOURCE,
    /** Fraction of samples so far that came from real data, fine or coarse. */
    coverage() {
      const n = stats.fine + stats.coarse + stats.fallback;
      return n ? (stats.fine + stats.coarse) / n : 0;
    },
    config: { source: 'real', spacingM: blocks.length ? 100 : 500 },
  };
}

/**
 * Load the manifest, the coarse grid, and the fine blocks covering a box.
 * `fetchFn` exists so tests can read from disk instead of the network.
 */
export async function loadTerrain({ baseUrl = 'data/terrain/', lat, lon, halfExtentM = 40000,
  fetchFn = null, fine = true } = {}) {
  // The offline single-file build embeds the data in the page, because a
  // file:// page cannot fetch anything at all: every request is blocked as a
  // cross-origin request from origin "null".
  const embedded = typeof globalThis !== 'undefined' && globalThis.__TERRAIN_FILES__;
  const fromEmbedded = embedded && ((path) => {
    const b64 = embedded[path];
    if (b64 === undefined) throw new Error(`${path} is not embedded in this build`);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  });

  const get = fetchFn || fromEmbedded || (async (path) => {
    const r = await fetch(baseUrl + path);
    if (!r.ok) throw new Error(`Could not load ${path}: ${r.status}`);
    return r.arrayBuffer();
  });
  const getJson = (embedded && !fetchFn && globalThis.__TERRAIN_MANIFEST__)
    ? async () => globalThis.__TERRAIN_MANIFEST__
    : fetchFn
    ? async (p) => JSON.parse(new TextDecoder().decode(await get(p)))
    : async (p) => {
      const r = await fetch(baseUrl + p);
      if (!r.ok) throw new Error(`Could not load ${p}: ${r.status}`);
      return r.json();
    };

  const manifest = await getJson('manifest.json');
  const coarse = await decodeBlock(await get(manifest.coarse.file));
  const wanted = fine ? blocksForExtent(manifest, lat, lon, halfExtentM) : [];
  const blocks = [];
  for (const meta of wanted) blocks.push(await decodeBlock(await get(meta.file)));
  return { manifest, coarse, blocks, blockMeta: wanted };
}
