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

// Radar sites. The only columns that MUST be present are a name and a
// position. Everything else has a stated default, and the importer reports
// which defaults it applied rather than filling them in silently.
export const RADAR_SITE_FIELDS = {
  name:        ['name', 'site', 'site name', 'radar', 'radar name', 'id', 'identifier', 'ref'],
  latitude:    TURBINE_FIELDS.latitude,
  longitude:   TURBINE_FIELDS.longitude,
  easting:     TURBINE_FIELDS.easting,
  northing:    TURBINE_FIELDS.northing,
  role:        ['role', 'type', 'category', 'class', 'kind', 'function'],
  antennaHeight: ['antenna height', 'height', 'height agl', 'agl', 'mast height', 'tower height', 'aerial height'],
  groundLevel: ['ground', 'ground level', 'elevation', 'amsl', 'site elevation', 'ground amsl'],
  band:        ['band', 'frequency', 'freq', 'freq ghz', 'frequency ghz'],
  operator:    ['operator', 'owner', 'authority', 'agency'],
  notes:       ['notes', 'note', 'comment', 'comments', 'remarks', 'description'],
};

// Wind farm SITES, meaning one row per project. This is a different thing from
// a turbine schedule, which is one row per machine: use the turbine schedule
// when you have a layout and this when you have a list of projects.
export const FARM_SITE_FIELDS = {
  name:      ['name', 'site', 'site name', 'project', 'project name', 'wind farm', 'windfarm', 'scheme'],
  latitude:  TURBINE_FIELDS.latitude,
  longitude: TURBINE_FIELDS.longitude,
  easting:   TURBINE_FIELDS.easting,
  northing:  TURBINE_FIELDS.northing,
  capacity:  ['capacity', 'capacity mw', 'mw', 'installed capacity', 'rated capacity', 'output'],
  status:    ['status', 'development status', 'stage', 'planning status', 'state'],
  offshore:  ['offshore', 'onshore offshore', 'location type', 'marine', 'sea'],
  reference: ['reference', 'ref', 'repd', 'repd ref', 'repd reference', 'planning ref', 'application ref', 'id'],
  turbines:  ['turbines', 'turbine count', 'number of turbines', 'no of turbines', 'machines'],
  tipHeight: TURBINE_FIELDS.tipHeight,
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
// Site lists: radar sites and wind farm sites
// ===========================================================================

const TRUTHY = new Set(['y', 'yes', 'true', '1', 'offshore', 'marine', 'sea', 'o']);

function numberFrom(cell) {
  if (cell == null || cell === '') return null;
  const n = Number(String(cell).replace(/[^0-9eE+.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Shared front end for both site parsers: find the header, walk the rows, and
 * pull a position out of either latitude/longitude or easting/northing.
 *
 * Returns { sites, warnings, skipped, headerRow, columns }. Nothing is invented:
 * a row without a usable position is skipped and counted, and every default
 * applied is named in `warnings` so the user can see what the file did not say.
 */
function parseSiteRows(rows, fields, opts, makeSite) {
  const { originLat = null, originLon = null, radarEasting = 0, radarNorthing = 0 } = opts;
  const found = mapColumns(rows, fields);
  const warnings = [];
  const sites = [];
  let skipped = 0;

  if (found.index < 0 || found.map.name === undefined) {
    return { sites: [], warnings: ['No header row found. The sheet needs a column headed '
      + '"name" (or "site", or "project") and either latitude and longitude, or easting and '
      + 'northing.'], skipped: rows.length, headerRow: -1, columns: {} };
  }

  const hasLatLon = found.map.latitude !== undefined && found.map.longitude !== undefined;
  const hasGrid = found.map.easting !== undefined && found.map.northing !== undefined;
  if (!hasLatLon && !hasGrid) {
    return { sites: [], warnings: ['Found a name column but no position. Add either '
      + '"latitude" and "longitude", or "easting" and "northing".'],
    skipped: rows.length, headerRow: found.index, columns: found.map };
  }
  if (hasGrid && !hasLatLon && (originLat == null || originLon == null)) {
    warnings.push('The file is in eastings and northings, which are read relative to the radar '
      + 'grid position on this tab. Check that grid position is right, or the sites will be in '
      + 'the wrong place.');
  }

  for (let r = found.index + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const get = (f) => (found.map[f] === undefined ? null : row[found.map[f]]);
    const name = String(get('name') ?? '').trim();
    if (!name) { skipped += 1; continue; }

    let lat = null, lon = null, east = null, north = null;
    if (hasLatLon) {
      lat = numberFrom(get('latitude'));
      lon = numberFrom(get('longitude'));
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        skipped += 1; continue;
      }
    }
    if (hasGrid) {
      const e = numberFrom(get('easting'));
      const n = numberFrom(get('northing'));
      if (e != null && n != null) { east = e - radarEasting; north = n - radarNorthing; }
    }
    if (lat == null && east == null) { skipped += 1; continue; }

    sites.push(makeSite({ name, lat, lon, east, north, get, warnings }));
  }

  if (!sites.length) warnings.push('No usable rows. Every row was missing a name or a position.');
  return { sites, warnings, skipped, headerRow: found.index, columns: found.map };
}

const ROLE_WORDS = [
  [/en.?route|nerl|area|long.?range/i, 'en-route'],
  [/aerodrome|airport|terminal|approach|tma|psr|asr/i, 'aerodrome'],
  [/air.?defen[cs]e|military|mod|raf|rrh/i, 'air-defence'],
  [/weather|met|precip/i, 'weather'],
  [/marine|vts|port|harbour|harbor/i, 'marine'],
];

/** One row per radar site. */
export function parseRadarSiteRows(rows, opts = {}) {
  let defaultedRole = 0;
  let defaultedHeight = 0;
  const out = parseSiteRows(rows, RADAR_SITE_FIELDS, opts, ({ name, lat, lon, east, north, get }) => {
    const rawRole = String(get('role') ?? '').trim();
    let role = 'unclassified';
    if (rawRole) {
      const hit = ROLE_WORDS.find(([re]) => re.test(rawRole));
      role = hit ? hit[1] : 'unclassified';
    } else {
      defaultedRole += 1;
    }
    const h = numberFrom(get('antennaHeight'));
    if (h == null) defaultedHeight += 1;
    return {
      name, lat, lon, east, north, role,
      antennaHeightM: h,
      groundLevelM: numberFrom(get('groundLevel')),
      band: String(get('band') ?? '').trim() || null,
      operator: String(get('operator') ?? '').trim() || null,
      notes: String(get('notes') ?? '').trim() || null,
      imported: true,
    };
  });
  if (defaultedRole) {
    out.warnings.push(`${defaultedRole} site(s) had no role column, so they are listed as `
      + 'unclassified. Add a "role" column reading en-route, aerodrome, air defence, weather or '
      + 'marine to label them.');
  }
  if (defaultedHeight) {
    out.warnings.push(`${defaultedHeight} site(s) gave no antenna height. Placing one of those `
      + 'uses the height on the Radar tab, which is a guess, and antenna height drives the '
      + 'horizon directly.');
  }
  return out;
}

/** One row per wind farm PROJECT, not per turbine. */
export function parseFarmSiteRows(rows, opts = {}) {
  let noStatus = 0;
  let noCapacity = 0;
  const out = parseSiteRows(rows, FARM_SITE_FIELDS, opts, ({ name, lat, lon, east, north, get }) => {
    const status = String(get('status') ?? '').trim();
    if (!status) noStatus += 1;
    const mw = numberFrom(get('capacity'));
    if (mw == null) noCapacity += 1;
    const offRaw = String(get('offshore') ?? '').trim().toLowerCase();
    return {
      name, lat, lon, east, north,
      mw: mw ?? 0,
      status: status || 'Not stated',
      offshore: offRaw ? TRUTHY.has(offRaw) : null,
      reference: String(get('reference') ?? '').trim() || null,
      turbineCount: numberFrom(get('turbines')),
      tipHeightM: numberFrom(get('tipHeight')),
      imported: true,
    };
  });
  if (noStatus) {
    out.warnings.push(`${noStatus} site(s) had no status, so they are shown as "Not stated". `
      + 'Two thirds of the UK planning database is projects that will never be built, so a status '
      + 'column is worth having.');
  }
  if (noCapacity) out.warnings.push(`${noCapacity} site(s) had no capacity, recorded as 0 MW.`);
  const noOffshore = out.sites.filter((x) => x.offshore === null).length;
  if (noOffshore) {
    out.warnings.push(`${noOffshore} site(s) did not say onshore or offshore, so the sea surface `
      + 'is left as you set it. Add an "offshore" column reading yes or no to set it from the file.');
  }
  return out;
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
// ESRI ASCII Grid (.asc)
// ===========================================================================
//
// The format almost every public elevation model exports to: SRTM, OS Terrain
// 50, EA LIDAR, and most GIS packages. A six-line header then a raster of
// values, north row first.

export function readAsciiGrid(text) {
  const lines = text.split(/\r?\n/);
  const header = {};
  let row = 0;
  const wanted = ['ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter',
    'cellsize', 'nodata_value'];

  while (row < lines.length) {
    const m = lines[row].trim().match(/^([A-Za-z_]+)\s+(-?[\d.eE+-]+)\s*$/);
    if (!m || !wanted.includes(m[1].toLowerCase())) break;
    header[m[1].toLowerCase()] = Number(m[2]);
    row += 1;
  }

  const ncols = header.ncols;
  const nrows = header.nrows;
  const cellsize = header.cellsize;
  if (!ncols || !nrows || !cellsize) {
    throw new Error('Not a valid ESRI ASCII Grid: expected ncols, nrows and cellsize in the header.');
  }
  // Corner and centre references differ by half a cell.
  const x0 = header.xllcorner !== undefined ? header.xllcorner + cellsize / 2 : header.xllcenter;
  const y0 = header.yllcorner !== undefined ? header.yllcorner + cellsize / 2 : header.yllcenter;
  if (x0 === undefined || y0 === undefined) {
    throw new Error('Not a valid ESRI ASCII Grid: no xll/yll origin in the header.');
  }
  const nodata = header.nodata_value ?? -9999;

  const values = [];
  for (; row < lines.length; row++) {
    const line = lines[row].trim();
    if (!line) continue;
    for (const tok of line.split(/\s+/)) {
      const v = Number(tok);
      values.push(Number.isFinite(v) ? v : nodata);
    }
  }
  if (values.length < ncols * nrows) {
    throw new Error(`ASCII grid is short: header declares ${ncols}x${nrows} = ${ncols * nrows} `
      + `values but only ${values.length} were found.`);
  }

  // Row 0 of the file is the NORTHERNMOST row, so northing decreases with row.
  const points = [];
  for (let j = 0; j < nrows; j++) {
    for (let i = 0; i < ncols; i++) {
      const z = values[j * ncols + i];
      if (z === nodata) continue;
      points.push({
        easting: x0 + i * cellsize,
        northing: y0 + (nrows - 1 - j) * cellsize,
        elevation: z,
      });
    }
  }
  return { points, header, cellsize, ncols, nrows };
}

// ===========================================================================
// KML and KMZ
// ===========================================================================
//
// What comes out of Google Earth. Google Earth has no public API this tool can
// call for bulk elevation, and the Elevation API needs a paid key, a network
// connection and comes with terms on storing what it returns, none of which
// suits an offline tool. Exporting from Google Earth as KML or KMZ and reading
// it here needs none of that.
//
// A caution the tool repeats in the findings: KML altitudes are often clamped
// to the ground or are the altitude of a drawn placemark, NOT a terrain
// measurement. Points digitised in Google Earth inherit its own elevation
// model, whose vertical accuracy varies and is not survey grade. For anything
// load-bearing, use a published DEM or a real survey.

export function readKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('That KML file could not be parsed as XML.');
  }

  const points = [];
  let clamped = 0;
  let named = 0;

  for (const placemark of doc.getElementsByTagName('Placemark')) {
    const nameNode = placemark.getElementsByTagName('name')[0];
    const name = nameNode ? nameNode.textContent.trim() : '';
    if (name) named += 1;

    for (const mode of placemark.getElementsByTagName('altitudeMode')) {
      if (/clampToGround/i.test(mode.textContent)) clamped += 1;
    }

    for (const coords of placemark.getElementsByTagName('coordinates')) {
      // "lon,lat[,alt]" tuples separated by whitespace.
      for (const tuple of coords.textContent.trim().split(/\s+/)) {
        if (!tuple) continue;
        const parts = tuple.split(',').map(Number);
        if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) continue;
        points.push({
          name,
          longitude: parts[0],
          latitude: parts[1],
          elevation: Number.isFinite(parts[2]) ? parts[2] : null,
        });
      }
    }
  }

  if (!points.length) throw new Error('No placemark coordinates found in that KML file.');
  const withHeight = points.filter((p) => p.elevation !== null && p.elevation !== 0).length;
  return {
    points,
    named,
    clampedPlacemarks: clamped,
    withHeight,
    warning: withHeight === 0
      ? 'Every coordinate in this file has zero or missing altitude, which usually means the placemarks '
        + 'were clamped to the ground. Positions are usable; elevations are not.'
      : clamped > 0
        ? `${clamped} placemarks use clampToGround, so their altitudes are not independent measurements.`
        : null,
  };
}

export async function readKmz(arrayBuffer) {
  const files = await readZip(arrayBuffer);
  const dec = new TextDecoder();
  const kmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith('.kml'));
  if (!kmlName) throw new Error('That .kmz contains no .kml document.');
  return readKml(dec.decode(files[kmlName]));
}

// ===========================================================================
// Online elevation lookup
// ===========================================================================
//
// OPTIONAL, OFF BY DEFAULT, AND UNTESTED. The tool is built to work offline and
// this is the one part that is not. It was written against the documented shape
// of the public open elevation services but could NOT be exercised, because the
// environment it was built in has no outbound network access. Treat it as
// unverified until you have run it yourself.
//
// Google's Elevation API is deliberately not the default: it needs a paid API
// key, and its terms restrict storing the results, which is the opposite of
// what this tool does with them.

export const ELEVATION_ENDPOINTS = {
  'open-elevation': {
    label: 'Open-Elevation (free, no key)',
    url: 'https://api.open-elevation.com/api/v1/lookup',
    method: 'POST',
    note: 'Keyless and free. Rate limited and best-effort. Roughly SRTM resolution, about 30 m.',
  },
  'opentopodata-srtm': {
    label: 'OpenTopoData SRTM 30 m (free, no key)',
    url: 'https://api.opentopodata.org/v1/srtm30m',
    method: 'GET',
    note: 'Keyless and free. 100 points per call, 1000 calls a day on the public instance.',
  },
  'opentopodata-eudem': {
    label: 'OpenTopoData EU-DEM 25 m (free, no key)',
    url: 'https://api.opentopodata.org/v1/eudem25m',
    method: 'GET',
    note: 'Europe only, 25 m. Same public limits as above.',
  },
  'open-meteo': {
    label: 'Open-Meteo elevation (free, no key)',
    url: 'https://api.open-meteo.com/v1/elevation',
    method: 'GET-METEO',
    note: 'Keyless and free, generous limits. Copernicus DEM based, about 90 m.',
  },
};

// Free bulk sources worth using instead of any API, because a downloaded tile
// is reproducible, has a known provenance, and needs no network at run time.
// These all export formats this tool reads directly.
export const FREE_ELEVATION_SOURCES = [
  ['Copernicus DEM GLO-30', 'Global, 30 m, open licence. The current default choice for most of the world.'],
  ['NASA SRTM 30 m', 'Global to 60 degrees latitude, 30 m, free. Via USGS EarthExplorer or OpenTopography.'],
  ['OpenTopography', 'Free portal serving SRTM, Copernicus and ALOS tiles as GeoTIFF or ASCII grid.'],
  ['OS Terrain 50 (UK)', 'Free OS OpenData, 50 m, ASCII grid. Good enough for most screening in Britain.'],
  ['Environment Agency LIDAR (England)', 'Free 1 m and 2 m DTM. Survey grade where it exists, and far better than anything global.'],
  ['EU-DEM / Copernicus Land', 'Europe, 25 m, free.'],
  ['GEBCO', 'Free global bathymetry, for the seabed under an offshore array.'],
];

/**
 * Fetch ground elevations for a list of {latitude, longitude}.
 * Batched, because every public service caps points per request.
 *
 * @param {Array} coords
 * @param {object} opts {url, batchSize, onProgress, signal}
 */
export async function fetchElevations(coords, opts = {}) {
  const url = opts.url || ELEVATION_ENDPOINTS['open-elevation'].url;
  const batchSize = Math.min(opts.batchSize || 100, 100);
  const out = [];

  for (let i = 0; i < coords.length; i += batchSize) {
    if (opts.signal && opts.signal.aborted) throw new Error('Elevation lookup cancelled.');
    const batch = coords.slice(i, i + batchSize);
    const method = opts.method || 'POST';
    let res;
    if (method === 'GET') {
      // OpenTopoData style: locations=lat,lon|lat,lon
      const q = batch.map((c) => `${c.latitude.toFixed(6)},${c.longitude.toFixed(6)}`).join('|');
      res = await fetch(`${url}?locations=${encodeURIComponent(q)}`, { signal: opts.signal });
    } else if (method === 'GET-METEO') {
      // Open-Meteo style: parallel latitude and longitude lists.
      const lat = batch.map((c) => c.latitude.toFixed(6)).join(',');
      const lon = batch.map((c) => c.longitude.toFixed(6)).join(',');
      res = await fetch(`${url}?latitude=${lat}&longitude=${lon}`, { signal: opts.signal });
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: batch.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
        }),
        signal: opts.signal,
      });
    }
    if (!res.ok) {
      throw new Error(`Elevation service returned ${res.status}. Public services are rate limited; `
        + 'wait and retry, reduce the number of points, or import a DEM file instead.');
    }
    const data = await res.json();
    // Open-Meteo returns a bare array of numbers; the others return objects.
    const results = Array.isArray(data.elevation)
      ? data.elevation.map((e) => ({ elevation: e }))
      : (data.results || data.data || []);
    if (!Array.isArray(results) || results.length !== batch.length) {
      throw new Error('Elevation service returned an unexpected response shape. '
        + 'Public services change; import a DEM file instead if this keeps happening.');
    }
    results.forEach((r, k) => out.push({
      latitude: batch[k].latitude,
      longitude: batch[k].longitude,
      east: batch[k].east,
      north: batch[k].north,
      elevation: Number(r.elevation ?? r.elev ?? NaN),
    }));
    if (opts.onProgress) opts.onProgress(Math.min(i + batchSize, coords.length) / coords.length);
  }

  const bad = out.filter((p) => !Number.isFinite(p.elevation)).length;
  if (bad === out.length) throw new Error('The elevation service returned no usable values.');
  return { points: out, missing: bad };
}

/** A regular lat/lon grid covering the modelled area, for an online lookup. */
export function elevationGridRequest(originLat, originLon, halfExtentM, steps = 40) {
  const coords = [];
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * originLat * DEG);
  const mPerDegLon = 111412.84 * Math.cos(originLat * DEG);
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const east = -halfExtentM + (2 * halfExtentM * i) / (steps - 1);
      const north = -halfExtentM + (2 * halfExtentM * j) / (steps - 1);
      coords.push({
        latitude: originLat + north / mPerDegLat,
        longitude: originLon + east / mPerDegLon,
        east,
        north,
      });
    }
  }
  return coords;
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

/**
 * Read any supported elevation source into points in the tool's local frame.
 * Returns {points, note} where each point is {east, north, elevation}.
 */
export async function readElevationFile(file, opts = {}) {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.asc') || name.endsWith('.grd') || name.endsWith('.txt')) {
    const grid = readAsciiGrid(await file.text());
    return {
      points: grid.points.map((p) => ({
        east: p.easting - (opts.radarEasting ?? 0),
        north: p.northing - (opts.radarNorthing ?? 0),
        elevation: p.elevation,
      })),
      note: `ESRI ASCII Grid, ${grid.ncols} x ${grid.nrows} at ${grid.cellsize} m cells. `
        + 'Coordinates are taken as the same grid as the radar easting and northing on the Site tab.',
    };
  }

  if (name.endsWith('.kml') || name.endsWith('.kmz')) {
    if (!Number.isFinite(opts.origin?.lat)) {
      throw new Error('KML is in latitude and longitude, so set the site origin on the Site tab first.');
    }
    const kml = name.endsWith('.kmz')
      ? await readKmz(await file.arrayBuffer())
      : readKml(await file.text());
    const pts = kml.points
      .filter((p) => Number.isFinite(p.elevation))
      .map((p) => {
        const l = latLonToLocal(p.latitude, p.longitude, opts.origin.lat, opts.origin.lon);
        return { east: l.east, north: l.north, elevation: p.elevation };
      });
    if (pts.length < 4) {
      throw new Error('That KML has fewer than four coordinates carrying an altitude. Google Earth '
        + 'clamps placemarks to the ground by default, which writes zero altitude. Export with absolute '
        + 'altitudes, or use a DEM file (.asc) instead.');
    }
    return {
      points: pts,
      note: `KML: ${pts.length} coordinates with altitude from ${kml.points.length} total.`
        + (kml.warning ? ` ${kml.warning}` : '')
        + ' KML altitudes come from whatever model produced them, commonly Google Earth\u2019s own '
        + 'terrain, which is not survey grade. Use a published DEM for anything load-bearing.',
    };
  }

  const sheets = await readTable(file);
  const parsed = parseTerrainRows(sheets[0].rows, opts);
  return { points: parsed.points, note: `${parsed.points.length} elevation points from a table.` };
}
