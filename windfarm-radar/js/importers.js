// Reading real data in: turbine schedules, site coordinates and terrain.
//
// Spreadsheets are how this data actually arrives, so the tool reads .xlsx and
// .csv directly. The .xlsx reader is built on the browser's own
// DecompressionStream rather than a library, because an .xlsx file is a ZIP of
// XML and the platform can already unzip: that keeps the tool a static,
// offline, dependency-free drop, which is the whole point of it.
//
// Nothing is uploaded. Parsing happens in the page.

import { DEG, EARTH_RADIUS_M, clamp } from './geo.js';

// ===========================================================================
// ZIP
// ===========================================================================

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

function findEocd(view) {
  // The end-of-central-directory record sits at the end, after a comment of up
  // to 64 KiB, so scan backwards for its signature.
  const max = Math.min(view.byteLength, 65557);
  for (let i = 22; i <= max; i++) {
    const off = view.byteLength - i;
    if (view.getUint32(off, true) === SIG_EOCD) return off;
  }
  return -1;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot decompress .xlsx files. Save the sheet as CSV instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a ZIP archive into a map of path -> Uint8Array.
 * Handles stored (method 0) and deflated (method 8) entries, which is all an
 * .xlsx ever uses.
 */
export async function readZip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP directory found).');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const files = {};

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // The local header repeats the name and extra fields, with its own lengths.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    files[name] = method === 0 ? raw : { deflated: raw };
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  // Inflate lazily but eagerly enough to keep callers simple.
  for (const [name, value] of Object.entries(files)) {
    if (value && value.deflated) files[name] = await inflateRaw(value.deflated);
  }
  return files;
}

// ===========================================================================
// XLSX
// ===========================================================================

function textOf(node) {
  return node ? node.textContent : '';
}

function colIndex(ref) {
  // "BC12" -> 54 (zero-based column)
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

/**
 * Parse an .xlsx into a list of sheets, each a rectangular array of cell
 * values (strings and numbers). Formulas are read at their cached value,
 * which is what a spreadsheet stores alongside them.
 */
export async function readXlsx(arrayBuffer) {
  const files = await readZip(arrayBuffer);
  const dec = new TextDecoder();
  const parser = new DOMParser();

  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const doc = parser.parseFromString(dec.decode(files['xl/sharedStrings.xml']), 'application/xml');
    for (const si of doc.getElementsByTagName('si')) {
      // A string can be split across several runs; concatenate their <t> nodes.
      shared.push([...si.getElementsByTagName('t')].map(textOf).join(''));
    }
  }

  // Sheet names, in workbook order.
  const names = [];
  if (files['xl/workbook.xml']) {
    const wb = parser.parseFromString(dec.decode(files['xl/workbook.xml']), 'application/xml');
    for (const sh of wb.getElementsByTagName('sheet')) names.push(sh.getAttribute('name'));
  }

  const sheets = [];
  const sheetPaths = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10)));

  for (let si = 0; si < sheetPaths.length; si++) {
    const doc = parser.parseFromString(dec.decode(files[sheetPaths[si]]), 'application/xml');
    const rows = [];
    for (const row of doc.getElementsByTagName('row')) {
      const out = [];
      for (const c of row.getElementsByTagName('c')) {
        const idx = colIndex(c.getAttribute('r') || '');
        const type = c.getAttribute('t');
        let value;
        if (type === 's') {
          value = shared[Number(textOf(c.getElementsByTagName('v')[0])) || 0] ?? '';
        } else if (type === 'inlineStr') {
          value = [...c.getElementsByTagName('t')].map(textOf).join('');
        } else if (type === 'b') {
          value = textOf(c.getElementsByTagName('v')[0]) === '1';
        } else {
          const raw = textOf(c.getElementsByTagName('v')[0]);
          value = raw === '' ? '' : Number(raw);
          if (Number.isNaN(value)) value = raw;
        }
        if (idx >= 0) out[idx] = value;
      }
      rows.push(out);
    }
    sheets.push({ name: names[si] || `Sheet${si + 1}`, rows });
  }

  if (!sheets.length) throw new Error('No worksheets found in that .xlsx file.');
  return sheets;
}

// ===========================================================================
// CSV
// ===========================================================================

export function readCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const delim = guessDelimiter(text);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  return [{
    name: 'CSV',
    rows: rows
      .filter((r) => r.some((c) => String(c).trim() !== ''))
      .map((r) => r.map((c) => {
        const t = String(c).trim();
        if (t === '') return '';
        const n = Number(t.replace(/,/g, ''));
        return t !== '' && Number.isFinite(n) && /^[-+]?[\d.,eE+-]+$/.test(t) ? n : t;
      })),
  }];
}

function guessDelimiter(text) {
  const head = text.slice(0, 4000);
  const counts = [[',', 0], [';', 0], ['\t', 0], ['|', 0]];
  for (const c of counts) c[1] = (head.split(c[0]).length - 1);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// ===========================================================================
// Column mapping
// ===========================================================================

// Header synonyms, in the vocabulary these schedules actually use.
export const TURBINE_FIELDS = {
  id:            ['id', 'turbine', 'turbine id', 'wtg', 'wtg id', 'name', 'ref', 'reference', 'number', 'no'],
  easting:       ['easting', 'east', 'x', 'e', 'x coord', 'x_coord', 'xcoordinate', 'osgb east', 'utm east'],
  northing:      ['northing', 'north', 'y', 'n', 'y coord', 'y_coord', 'ycoordinate', 'osgb north', 'utm north'],
  latitude:      ['latitude', 'lat', 'lat deg', 'lat (deg)', 'wgs84 lat'],
  longitude:     ['longitude', 'lon', 'long', 'lng', 'lon deg', 'wgs84 lon'],
  groundLevel:   ['ground', 'ground level', 'base', 'base level', 'elevation', 'terrain', 'agl base', 'ground amsl', 'base amsl', 'seabed'],
  hubHeight:     ['hub height', 'hub', 'hub ht', 'hubheight', 'tower height', 'nacelle height'],
  rotorDiameter: ['rotor diameter', 'rotor', 'rotor dia', 'diameter', 'rotordiameter'],
  tipHeight:     ['tip height', 'tip', 'tip ht', 'blade tip', 'overall height', 'total height'],
  rpm:           ['rpm', 'rotor speed', 'rated rpm', 'speed'],
  towerBase:     ['tower base diameter', 'tower base', 'base diameter', 'monopile diameter', 'base dia'],
  towerTop:      ['tower top diameter', 'tower top', 'top diameter', 'top dia'],
  bladeChord:    ['blade chord', 'chord', 'blade width', 'max chord'],
  bladeCount:    ['blades', 'blade count', 'number of blades'],
};

export const TERRAIN_FIELDS = {
  easting:   TURBINE_FIELDS.easting,
  northing:  TURBINE_FIELDS.northing,
  latitude:  TURBINE_FIELDS.latitude,
  longitude: TURBINE_FIELDS.longitude,
  elevation: ['elevation', 'z', 'height', 'amsl', 'level', 'alt', 'altitude', 'dtm', 'dsm', 'ground'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Find the header row and map its columns onto known fields. The header row is
 * whichever of the first few rows matches the most field names, which copes
 * with the title blocks and blank rows real schedules carry above the table.
 */
export function mapColumns(rows, fields) {
  let best = { score: 0, index: -1, map: {} };
  const limit = Math.min(rows.length, 12);

  for (let r = 0; r < limit; r++) {
    const map = {};
    let score = 0;
    rows[r].forEach((cell, c) => {
      const n = norm(cell);
      if (!n) return;
      for (const [field, synonyms] of Object.entries(fields)) {
        if (map[field] !== undefined) continue;
        if (synonyms.some((s) => n === s || n.startsWith(`${s} `) || n === `${s}s`)) {
          map[field] = c;
          score += 1;
          return;
        }
      }
    });
    if (score > best.score) best = { score, index: r, map };
  }
  return best;
}

// ===========================================================================
// Coordinates
// ===========================================================================

/**
 * Local east/north metres from latitude and longitude, about a site origin.
 * Equirectangular about the origin latitude, which is accurate to well under a
 * metre over the tens of kilometres this tool works across. It is NOT a
 * national grid transformation: if the schedule is in OSGB or UTM eastings and
 * northings, import those directly instead.
 */
export function latLonToLocal(lat, lon, originLat, originLon) {
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * originLat * DEG)
    + 1.175 * Math.cos(4 * originLat * DEG);
  const mPerDegLon = 111412.84 * Math.cos(originLat * DEG)
    - 93.5 * Math.cos(3 * originLat * DEG);
  return {
    east: (lon - originLon) * mPerDegLon,
    north: (lat - originLat) * mPerDegLat,
  };
}

// ===========================================================================
// Turbine schedules
// ===========================================================================

/**
 * Turn a parsed sheet into turbine positions in the tool's local frame.
 *
 * @param {Array} rows
 * @param {object} opts {origin:{lat,lon}|null, radarEasting, radarNorthing, defaults}
 * @returns {{turbines:Array, warnings:Array, mapping:object, headerRow:number}}
 */
export function parseTurbineRows(rows, opts = {}) {
  const found = mapColumns(rows, TURBINE_FIELDS);
  const warnings = [];
  if (found.index < 0) {
    throw new Error('Could not find a header row. Expected columns such as '
      + '"Easting"/"Northing" or "Latitude"/"Longitude", plus "Hub height" and "Rotor diameter".');
  }
  const m = found.map;

  const hasGrid = m.easting !== undefined && m.northing !== undefined;
  const hasGeo = m.latitude !== undefined && m.longitude !== undefined;
  if (!hasGrid && !hasGeo) {
    throw new Error('No position columns found. Provide Easting and Northing, or Latitude and Longitude.');
  }
  if (hasGeo && !hasGrid && !(opts.origin && Number.isFinite(opts.origin.lat))) {
    throw new Error('This sheet uses latitude and longitude, so the site origin '
      + 'latitude and longitude must be set on the Site tab before importing.');
  }

  const out = [];
  const num = (row, key) => {
    const v = m[key] === undefined ? undefined : row[m[key]];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };

  for (let r = found.index + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some((c) => c !== '' && c !== undefined)) continue;

    let east;
    let north;
    if (hasGrid && num(row, 'easting') !== undefined && num(row, 'northing') !== undefined) {
      // Absolute grid coordinates are made relative to the radar, which is the
      // tool's origin.
      east = num(row, 'easting') - (opts.radarEasting ?? 0);
      north = num(row, 'northing') - (opts.radarNorthing ?? 0);
    } else if (hasGeo && num(row, 'latitude') !== undefined && num(row, 'longitude') !== undefined) {
      const p = latLonToLocal(num(row, 'latitude'), num(row, 'longitude'),
        opts.origin.lat, opts.origin.lon);
      east = p.east;
      north = p.north;
    } else {
      warnings.push(`Row ${r + 1}: no usable position, skipped.`);
      continue;
    }

    const d = opts.defaults || {};
    let hubHeightM = num(row, 'hubHeight');
    let rotorDiameterM = num(row, 'rotorDiameter');
    const tipHeightM = num(row, 'tipHeight');

    // A schedule often gives tip height rather than both hub and rotor.
    if (hubHeightM === undefined && tipHeightM !== undefined && rotorDiameterM !== undefined) {
      hubHeightM = tipHeightM - rotorDiameterM / 2;
    } else if (rotorDiameterM === undefined && tipHeightM !== undefined && hubHeightM !== undefined) {
      rotorDiameterM = 2 * (tipHeightM - hubHeightM);
    }
    if (hubHeightM === undefined) {
      hubHeightM = d.hubHeightM;
      if (r === found.index + 1) warnings.push('No hub height column; using the machine set on the Wind farm tab.');
    }
    if (rotorDiameterM === undefined) {
      rotorDiameterM = d.rotorDiameterM;
      if (r === found.index + 1) warnings.push('No rotor diameter column; using the machine set on the Wind farm tab.');
    }

    const idCell = m.id === undefined ? undefined : row[m.id];
    out.push({
      id: idCell === undefined || idCell === '' ? `WTG${String(out.length + 1).padStart(2, '0')}` : String(idCell),
      east, north,
      groundLevelM: num(row, 'groundLevel'),
      hubHeightM,
      rotorDiameterM,
      rpm: num(row, 'rpm') ?? d.rpm,
      towerBaseDiameterM: num(row, 'towerBase') ?? d.towerBaseDiameterM,
      towerTopDiameterM: num(row, 'towerTop') ?? d.towerTopDiameterM,
      bladeChordM: num(row, 'bladeChord') ?? d.bladeChordM,
      bladeCount: num(row, 'bladeCount') ?? d.bladeCount,
    });
  }

  if (!out.length) throw new Error('Header row found, but no data rows with usable positions below it.');
  if (out.length > 300) {
    warnings.push(`${out.length} turbines found; the first 300 are used to keep the tool interactive.`);
    out.length = 300;
  }
  return { turbines: out, warnings, mapping: m, headerRow: found.index };
}

// ===========================================================================
// Terrain
// ===========================================================================

/**
 * Build a terrain sampler from imported elevation points.
 *
 * Points are binned onto a regular raster and gaps are filled by a small
 * inverse-distance search, so a regular grid, a scattered survey, or a
 * decimated DTM export all work. Cells with no data within the search radius
 * keep the fallback height and are reported, because a terrain model with
 * holes in it must not be mistaken for a complete one.
 */
export function buildImportedTerrain(points, { halfExtent, size = 384, fallbackHeight = 0 }) {
  const n = Math.max(32, size | 0);
  const step = (2 * halfExtent) / (n - 1);
  const sum = new Float64Array(n * n);
  const count = new Uint32Array(n * n);
  let min = Infinity;
  let max = -Infinity;
  let inside = 0;

  for (const p of points) {
    if (!Number.isFinite(p.east) || !Number.isFinite(p.north) || !Number.isFinite(p.elevation)) continue;
    const i = Math.round((p.east + halfExtent) / step);
    const j = Math.round((p.north + halfExtent) / step);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    sum[j * n + i] += p.elevation;
    count[j * n + i] += 1;
    inside += 1;
    if (p.elevation < min) min = p.elevation;
    if (p.elevation > max) max = p.elevation;
  }

  if (!inside) {
    throw new Error('None of the imported elevation points fall inside the modelled area. '
      + 'Check the coordinate system and the site origin.');
  }

  const data = new Float32Array(n * n);
  const filled = new Uint8Array(n * n);
  for (let k = 0; k < data.length; k++) {
    if (count[k]) { data[k] = sum[k] / count[k]; filled[k] = 1; }
  }

  // Inverse-distance fill over a widening search, so small gaps close and
  // large voids are left visible.
  const maxRadius = Math.max(3, Math.round(n / 24));
  let holes = 0;
  const out = Float32Array.from(data);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (filled[k]) continue;
      let w = 0;
      let acc = 0;
      for (let r = 1; r <= maxRadius && w === 0; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
            const jj = j + dj;
            const ii = i + di;
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            const kk = jj * n + ii;
            if (!filled[kk]) continue;
            const d = Math.hypot(di, dj);
            acc += data[kk] / d;
            w += 1 / d;
          }
        }
      }
      if (w > 0) out[k] = acc / w;
      else { out[k] = fallbackHeight; holes += 1; }
    }
  }

  function heightAt(east, north) {
    const fx = clamp((east + halfExtent) / step, 0, n - 1.0001);
    const fz = clamp((north + halfExtent) / step, 0, n - 1.0001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const a = out[j * n + i];
    const b = out[j * n + i + 1];
    const c = out[(j + 1) * n + i];
    const d = out[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  return {
    heightAt,
    data: out,
    size: n,
    step,
    halfExtent,
    min,
    max,
    pointsUsed: inside,
    coveredCells: filled.reduce((a, b) => a + b, 0),
    unfilledCells: holes,
    coverage: 1 - holes / (n * n),
  };
}

export function parseTerrainRows(rows, opts = {}) {
  const found = mapColumns(rows, TERRAIN_FIELDS);
  if (found.index < 0 || found.map.elevation === undefined) {
    throw new Error('Could not find an elevation column. Expected "Elevation" or "Z", '
      + 'plus either "Easting"/"Northing" or "Latitude"/"Longitude".');
  }
  const m = found.map;
  const hasGrid = m.easting !== undefined && m.northing !== undefined;
  const hasGeo = m.latitude !== undefined && m.longitude !== undefined;
  if (!hasGrid && !hasGeo) throw new Error('No position columns found in the elevation data.');
  if (hasGeo && !hasGrid && !(opts.origin && Number.isFinite(opts.origin.lat))) {
    throw new Error('This file uses latitude and longitude, so set the site origin first.');
  }

  const points = [];
  for (let r = found.index + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const z = row[m.elevation];
    if (typeof z !== 'number' || !Number.isFinite(z)) continue;
    let east;
    let north;
    if (hasGrid && typeof row[m.easting] === 'number' && typeof row[m.northing] === 'number') {
      east = row[m.easting] - (opts.radarEasting ?? 0);
      north = row[m.northing] - (opts.radarNorthing ?? 0);
    } else if (hasGeo && typeof row[m.latitude] === 'number' && typeof row[m.longitude] === 'number') {
      const p = latLonToLocal(row[m.latitude], row[m.longitude], opts.origin.lat, opts.origin.lon);
      east = p.east;
      north = p.north;
    } else continue;
    points.push({ east, north, elevation: z });
  }

  if (points.length < 4) {
    throw new Error(`Only ${points.length} usable elevation points found. Need at least four.`);
  }
  return { points, mapping: m, headerRow: found.index };
}

// ===========================================================================
// Entry point
// ===========================================================================

export async function readTable(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    return readXlsx(await file.arrayBuffer());
  }
  if (name.endsWith('.xls')) {
    throw new Error('The old binary .xls format is not supported. '
      + 'Save it as .xlsx or .csv and import that.');
  }
  return readCsv(await file.text());
}
