/**
 * Profiling and reconciling a spreadsheet whose format nobody has told us.
 *
 * The importers in importers.js answer "read this file, I know what is in it".
 * This answers the two questions you have when you do NOT: what IS this, and
 * how does it differ from what we already hold?
 *
 * The design rule throughout is REPORT, NEVER MERGE. A file that disagrees
 * with the built-in table is evidence about one of them, and which one is
 * wrong is not a decision this code can make. So nothing here writes to the
 * site tables; it produces a description and a difference list for a person to
 * read. The one thing worse than not knowing your data is a tool that quietly
 * resolves the disagreement for you.
 */

import { mapColumns, FARM_SITE_FIELDS } from './importers.js';
import { greatCircleM } from './uksites.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Strip the decoration real schedules carry: "12.5 MW", "1,234", "c. 50". */
function numberFrom(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const cleaned = String(cell).replace(/,/g, '').match(/-?\d+(\.\d+)?([eE][-+]?\d+)?/);
  if (!cleaned) return null;
  const n = Number(cleaned[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Is the WHOLE cell a number?
 *
 * numberFrom above digs a number out of anything, which is right for reading a
 * value someone wrote as "12.5 MW". It is wrong for deciding what a column
 * HOLDS: run on the real database it turned a postcode column into integers,
 * because "NR32" contains 32, and a planning reference column into numbers,
 * because "EN010056" contains 10056. Deciding a column's type needs the strict
 * test; reading a value out of it can stay lenient.
 */
function strictNumber(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const t = String(cell).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * What a column looks like from its VALUES, independent of what it is called.
 *
 * Name matching alone fails on exactly the files this exists for: a column
 * headed "X" is an easting in one schedule and a cross-reference in another,
 * and plenty of real exports head their coordinates "Column 4". Ranges are
 * harder to fake. These bounds are the British National Grid and the
 * latitude/longitude window that covers the UK, Ireland and the islands, so a
 * column that fits one of them almost certainly is one.
 */
export const VALUE_SHAPES = [
  { kind: 'latitude', test: (n) => n >= 49 && n <= 62, note: 'inside the UK and Ireland latitude band' },
  { kind: 'longitude', test: (n) => n >= -11 && n <= 3, note: 'inside the UK and Ireland longitude band' },
  // ONE grid shape, not two. Eastings run 0 to 700,000 and northings 0 to
  // 1,300,000, so every easting is also a valid northing and most northings
  // are valid eastings. Offering both let whichever was listed first win, and
  // a column of northings was confidently reported as eastings. Which of the
  // pair a column is cannot be told from its range, so this says 'grid' and
  // leaves the heading to say which, rather than guessing and sounding sure.
  { kind: 'grid', test: (n) => n >= 0 && n <= 1300000 && Number.isInteger(n) && n > 1000, note: 'British National Grid coordinate range' },
  // Excel writes dates as a day count from 1900, and those land squarely
  // inside the grid range: the real database's date columns were every one of
  // them reported as grid coordinates. The two cannot be told apart by range,
  // so both are reported and the reader decides.
  { kind: 'date serial', test: (n) => n >= 25569 && n <= 55000 && Number.isInteger(n), note: 'Excel date serial range, 1970 to 2050' },
];

/**
 * A coordinate column has many DIFFERENT values in it.
 *
 * Requiring that stops a column of fifty-odd repeated 0.9s being announced as
 * longitudes, which is what the real database's Renewable Obligation banding
 * column did: 0.9 is inside the longitude band and every row agreed.
 *
 * The floor scales with the column, because a flat "ten distinct values" makes
 * any small file unclassifiable: with fewer than ten values it asks for all of
 * them to differ instead. A three-row sample can still be recognised; a long
 * column of one repeated number cannot.
 */
function enoughVariety(distinct, filled) {
  return distinct >= Math.min(10, filled);
}

/**
 * Describe every column of a table: how full it is, what it holds, and what it
 * might be. `rows` is an array of arrays, as readCsv and readXlsx return.
 */
export function profileTable(rows, { fields = FARM_SITE_FIELDS, maxSamples = 4 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { headerRow: -1, rowCount: 0, columns: [], note: 'The file has no rows.' };
  }
  // Reuse the importer's header finder so the profile and the import agree
  // about where the table starts. They disagreeing would be its own bug.
  const header = mapColumns(rows, fields);
  const headerRow = header.index >= 0 ? header.index : 0;
  const names = rows[headerRow] || [];
  const body = rows.slice(headerRow + 1).filter((r) => r && r.some((c) => c != null && c !== ''));
  const width = rows.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);

  // Which column each known field landed on, so the profile can say so.
  const byColumn = {};
  for (const [field, col] of Object.entries(header.map || {})) byColumn[col] = field;

  const columns = [];
  for (let c = 0; c < width; c += 1) {
    const raw = body.map((r) => (r ? r[c] : undefined));
    const filled = raw.filter((v) => v != null && v !== '');
    const nums = filled.map(strictNumber).filter((n) => n !== null);
    const numeric = filled.length > 0 && nums.length >= filled.length * 0.9;
    const distinct = new Set(filled.map((v) => String(v))).size;

    let kind = 'empty';
    let shapes = [];
    if (filled.length === 0) {
      kind = 'empty';
    } else if (numeric) {
      kind = nums.every((n) => Number.isInteger(n)) ? 'integer' : 'number';
      // A shape only counts if nearly every value fits it. One stray row
      // inside the latitude band does not make a column of latitudes. ALL
      // matching shapes are reported, not the first: a grid coordinate and an
      // Excel date serial occupy the same numbers, and picking one silently
      // would state something the values cannot settle.
      if (enoughVariety(distinct, filled.length)) {
        shapes = VALUE_SHAPES.filter(
          (sh) => nums.filter((n) => sh.test(n)).length >= nums.length * 0.95);
      }
    } else {
      kind = 'text';
    }
    const shape = shapes[0] || null;
    columns.push({
      index: c,
      name: String(names[c] ?? '').trim() || `(column ${c + 1})`,
      kind,
      valueShape: shapes.length ? shapes.map((sh) => sh.kind).join(' or ') : null,
      valueShapeNote: shape ? shape.note : null,
      ambiguousShape: shapes.length > 1,
      mappedField: byColumn[c] || null,
      fillRate: body.length ? filled.length / body.length : 0,
      distinct,
      // A column with one repeated value carries no information, and one where
      // every value differs is an identifier, not a category. Both are worth
      // seeing before anyone maps a column to a meaning.
      constant: distinct === 1,
      unique: filled.length > 0 && distinct === filled.length,
      min: nums.length ? Math.min(...nums) : null,
      max: nums.length ? Math.max(...nums) : null,
      samples: filled.slice(0, maxSamples).map((v) => String(v).slice(0, 40)),
    });
  }

  return {
    headerRow,
    rowCount: body.length,
    columnCount: width,
    columns,
    recognisedFields: Object.keys(header.map || {}),
    // Named so nobody reads a profile as a verdict on the file's quality.
    note: 'A description of what is in the file, not a judgement about whether '
      + 'it is right. Columns are identified by their VALUES as well as their headings, '
      + 'because a coordinate column headed "X" or "Column 4" is common.',
  };
}

/**
 * Where a profiled column disagrees with the heading it carries.
 *
 * This is the check that earns the value-shape work: a column headed
 * "Northing" whose numbers sit in the latitude band is a column somebody has
 * already converted and not relabelled, and importing it as a northing puts
 * the site in the North Sea.
 */
export function headingConflicts(profile) {
  const out = [];
  const expect = {
    latitude: 'latitude', longitude: 'longitude',
    easting: 'easting', northing: 'northing',
  };
  for (const col of profile.columns) {
    const want = expect[col.mappedField];
    if (!want || !col.valueShape) continue;
    // With more than one candidate shape, a conflict needs EVERY candidate to
    // be in the wrong family. A column that could be a grid reference or a
    // date serial does not contradict an "Easting" heading.
    const candidates = col.valueShape.split(' or ');
    // Easting and northing share a numeric range at the low end, so only
    // flag a swap between the coordinate FAMILIES, which is the damaging one.
    const family = (k) => (k === 'latitude' || k === 'longitude' ? 'degrees' : 'grid');
    // 'grid' already IS the family, so a grid column under an easting or
    // northing heading agrees; only a degrees/grid mismatch is the fault.
    if (candidates.every((k) => family(want) !== family(k))) {
      out.push({
        column: col.name,
        index: col.index,
        headingSays: want,
        valuesLookLike: col.valueShape,
        why: col.valueShapeNote,
      });
    }
  }
  return out;
}

const MATCH = {
  reference: 'the planning reference matches exactly',
  name: 'the site name matches once punctuation and case are ignored',
  position: 'no name or reference matched, but a known site is close by',
  none: 'nothing matched',
};

/**
 * Compare rows from an unknown file against the records we already hold.
 *
 * Matching is tried in descending order of how much it can be trusted:
 * reference, then name, then position. The method used is reported per row,
 * because a position match at 900 m is a guess and a reference match is not,
 * and a reader must be able to tell them apart.
 */
export function reconcileFarms(rows, known, { map = {}, nearM = 2000 } = {}) {
  const byRef = new Map();
  const byName = new Map();
  for (const k of known) {
    if (k.repdRef) byRef.set(String(k.repdRef), k);
    const n = norm(k.name);
    if (n && !byName.has(n)) byName.set(n, k);
  }

  const cell = (row, field) => (map[field] === undefined ? undefined : row[map[field]]);
  const results = [];

  for (const row of rows) {
    const ref = cell(row, 'reference');
    const name = cell(row, 'name');
    let lat = numberFrom(cell(row, 'latitude'));
    let lon = numberFrom(cell(row, 'longitude'));
    if (lat === null || lon === null) { lat = null; lon = null; }

    let match = null;
    let how = 'none';
    if (ref != null && byRef.has(String(ref).trim())) {
      match = byRef.get(String(ref).trim()); how = 'reference';
    } else if (name && byName.has(norm(name))) {
      match = byName.get(norm(name)); how = 'name';
    } else if (lat !== null && lon !== null) {
      let best = null, bestD = Infinity;
      for (const k of known) {
        const d = greatCircleM(lat, lon, k.lat, k.lon);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best && bestD <= nearM) { match = best; how = 'position'; }
    }

    const diff = {
      name: name ?? null,
      reference: ref ?? null,
      matchedBy: how,
      matchExplanation: MATCH[how],
      matched: match ? { name: match.name, repdRef: match.repdRef, index: match.index } : null,
      positionDeltaM: null,
      capacityDelta: null,
      turbineDelta: null,
    };
    if (match) {
      if (lat !== null && lon !== null) {
        diff.positionDeltaM = Math.round(greatCircleM(lat, lon, match.lat, match.lon));
      }
      const mw = numberFrom(cell(row, 'capacity'));
      if (mw !== null && match.mwKnown) diff.capacityDelta = +(mw - match.mw).toFixed(2);
      const t = numberFrom(cell(row, 'turbines'));
      if (t !== null && match.turbines) diff.turbineDelta = t - match.turbines;
    }
    results.push(diff);
  }

  const matched = results.filter((r) => r.matchedBy !== 'none');
  const deltas = matched.map((r) => r.positionDeltaM).filter((d) => d !== null).sort((a, b) => a - b);
  return {
    rows: results,
    summary: {
      total: results.length,
      matched: matched.length,
      unmatched: results.length - matched.length,
      byReference: results.filter((r) => r.matchedBy === 'reference').length,
      byName: results.filter((r) => r.matchedBy === 'name').length,
      byPosition: results.filter((r) => r.matchedBy === 'position').length,
      medianPositionDeltaM: deltas.length ? deltas[Math.floor(deltas.length / 2)] : null,
      maxPositionDeltaM: deltas.length ? deltas[deltas.length - 1] : null,
      // Counted separately because a big position delta on a REFERENCE match is
      // a real disagreement about where a known project is, while the same
      // delta on a position match is just a weak match.
      referenceMatchesOver1km: matched.filter(
        (r) => r.matchedBy === 'reference' && r.positionDeltaM !== null && r.positionDeltaM > 1000).length,
    },
    note: 'Differences only. Nothing here has been written to the site tables, and '
      + 'a difference does not say which side is wrong: the built-in positions are '
      + 'planning references measured at about 1,100 m from the array.',
  };
}
