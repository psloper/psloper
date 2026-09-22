// Application entry point: wires the scenario, the assessment engine, the 3D
// view, the two flat displays and the results panel into one running tool.

import { analyse, analyseWindRose } from './analysis.js';
import { AUTHOR, authorLine } from './authorship.js';
import {
  defaultScenario, loadScenario, saveScenario, mergeDeep,
  applyRadarPreset, applyTurbinePreset, applyTargetPreset, applyTerrainPreset,
  applyRadarMount, antennaHeightAgl,
} from './model.js';
import { SceneView } from './scene.js';
import { PpiDisplay, ProfileDisplay, WindRoseDisplay } from './displays.js';
import { deriveWindRoseFindings } from './findings.js';
import { REFERENCES, STATUS_LABELS, statusCounts } from './references.js';
import { loadTerrain, createRealTerrain } from './terrain.js';
import { profileTable, headingConflicts, reconcileFarms } from './profile.js';
import { WIND_ROSE_PRESETS } from './wind.js';
import { SWEEP_PARAMS, SWEEP_METRICS, runSweep, sweepToCsv } from './sweep.js';
import { COASTLINE, COASTLINE_SOURCE } from './coastline.js';
import { UkMap, MAP_COLORS } from './ukmap.js';
import { nationalScreen, ACTIVE_STATUSES } from './national.js';
import { UK_WIND_FARMS, UK_RADAR_SITES, farmRecord, farmCapacityLabel,
  farmAttributeCoverage, offshoreFlagConflicts, territoryCounts } from './uksites.js';
import { drawSweep, cellAt, sweepToPng, sweepToSvg } from './heatmap.js';
import {
  readTable, readElevationFile, parseTurbineRows, buildImportedTerrain,
  FREE_ELEVATION_SOURCES,
  parseRadarSiteRows, parseFarmSiteRows, mapColumns, FARM_SITE_FIELDS,
} from './importers.js';
import {
  buildRail, updateNotes, renderMetrics, renderFindings, renderTurbineTable,
  renderVerdict, renderReadout, renderLegend, setImportedSites,
} from './ui.js';
import {
  METHOD_HTML, IMPORT_HTML, buildDelta, buildExport, downloadExport, downloadsAvailable,
  printReport,
} from './report.js';

// ------------------------------------------------------------------- state

let scenario = loadScenario() || defaultScenario();
let result = null;
let noteEls = {};
let activeTab = 'radar';
let fullTimer = null;
let importedTerrain = null;     // held outside the scenario: a raster is not a setting
let realTerrain = null;         // likewise: real elevation data is not a setting
// The 500 m national grid, kept separately from realTerrain because that one
// is anchored on a single radar and the national map needs to anchor on 55.
let terrainCoarseBlock = null;
let roseResult = null;
let roseFindings = [];
let sweepResult = null;
let sweepLayout = null;

const $ = (sel) => document.querySelector(sel);

const el = {
  rail: $('#rail-body'),
  tabs: document.querySelectorAll('.rail-tab'),
  canvas3d: $('#scene3d'),
  ppi: $('#ppi'),
  profile: $('#profile'),
  metrics: $('#metrics'),
  findings: $('#findings'),
  turbineTable: $('#turbine-table'),
  turbineCount: $('#turbine-count'),
  verdictChip: $('#verdict-chip'),
  verdictText: $('#verdict-text'),
  readout: $('#readout'),
  legend: $('#legend'),
  toggles: $('#layer-toggles'),
  scalebar: $('#scalebar'),
  ppiNote: $('#ppi-note'),
  profileBearing: $('#profile-bearing'),
  windrose: $('#windrose'),
  roseCaption: $('#rose-caption'),
};

const view = new SceneView(el.canvas3d);
const ppi = new PpiDisplay(el.ppi);
const profile = new ProfileDisplay(el.profile);
const windrose = new WindRoseDisplay(el.windrose);

view.onHover = (tr) => {
  renderReadout(el.readout, tr, result);
  el.turbineTable.querySelectorAll('tbody tr').forEach((row) => {
    row.classList.toggle('is-hot', !!tr && row.dataset.id === tr.turbine.id);
  });
};

// ------------------------------------------------------------- analysis run


// The badge over the viewport. TWO factors are in force and they are different,
// so both are named: heights go through the vertical multiplier, structural
// widths through the girth multiplier, and spans through neither.
function updateScalebar() {
  el.scalebar.textContent = `rings ${(view.ringStepM / 1000).toFixed(0)} km`
    + (view.vExag !== 1
      ? ` \u00b7 vertical \u00d7${view.vExag} (terrain heights, and whole turbines; spacing between them is true)`
      : ' \u00b7 true scale')
    + (view.girthExag > 1.5
      ? ` \u00b7 girth \u00d7${view.girthExag} (every structural width; spans are true)`
      + (view.aircraftScale > 1.5 ? ` \u00b7 aircraft \u00d7${view.aircraftScale.toFixed(0)} (a point target in the maths; drawn to be visible)` : '') : '');
}

function run(skipCoverage) {
  // heightAgl is derived from how the radar is mounted, so keep it in step
  // before every analysis. Everything downstream reads heightAgl, and a
  // stale one silently answers with the wrong radio horizon.
  if (scenario.radar.mount) scenario.radar.heightAgl = antennaHeightAgl(scenario.radar);
  const t0 = performance.now();
  try {
    result = analyse(scenario, { skipCoverage, importedTerrain, realTerrain });
  } catch (err) {
    console.error(err);
    el.verdictChip.dataset.level = 'critical';
    el.verdictChip.textContent = 'Error';
    el.verdictText.textContent = `The assessment failed: ${err.message}`;
    return;
  }
  const ms = performance.now() - t0;

  view.build(result);
  ppi.setResult(result);
  profile.setResult(result);

  renderMetrics(el.metrics, result);
  renderFindings(el.findings, [...result.findings, ...roseFindings]);
  renderTurbineTable(el.turbineTable, result, (id) => view.highlight(id));
  renderVerdict(el.verdictChip, el.verdictText,
    { ...result, findings: [...result.findings, ...roseFindings] });
  windrose.setRose(roseResult, scenario.wind.directionDeg);
  el.roseCaption.textContent = roseResult
    ? `${(roseResult.exposureWithPlots * 100).toFixed(0)}% of the year`
    : 'not yet swept';
  renderLegend(el.legend, view.shadeMode, result);
  updateNotes(noteEls, result, { importedTerrain, roseResult });

  el.turbineCount.textContent = `${result.turbineResults.length}`;
  el.profileBearing.textContent = `${profile.activeBearing.toFixed(0).padStart(3, '0')}°`;
  el.ppiNote.textContent = `${result.radar.rpm} rpm · ${(result.radar.rangeResolutionM).toFixed(0)} m cells`;
  updateScalebar();

  if (!skipCoverage && ms > 400) {
    console.info(`Full assessment took ${ms.toFixed(0)} ms.`);
  }
  saveScenario(scenario);
}

// A full assessment, coverage grid included, runs in well under 100 ms on the
// scenarios this tool is built for, so a single short debounce is enough and
// a slider drag stays responsive.
function schedule() {
  clearTimeout(fullTimer);
  fullTimer = setTimeout(() => run(false), 60);
}

// Imported site lists live alongside the built-in ones and are offered in the
// same pickers. They are kept separate from the built-in data so that a user's
// own survey positions are never confused with planning-database positions.
export const importedSites = { radars: [], farms: [], source: {} };

function rebuildRail() {
  setImportedSites(importedSites);
  noteEls = buildRail(el.rail, activeTab, scenario, schedule, applyPreset);
  updateNotes(noteEls, result, { importedTerrain, roseResult });
  el.rail.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => railAction(btn.dataset.action, btn));
  });
}

// A control that writes several scenario fields at once asks for the rail to be
// rebuilt, so the other controls stop showing stale values.
// The byline reads from js/authorship.js, so the name appears in exactly one
// place in the source and everywhere it is needed in the output.
{
  const by = document.getElementById('byline');
  if (by) by.textContent = ` \u00b7 ${authorLine()}`;
}

el.rail.addEventListener('rail-rebuild', () => rebuildRail());

// ------------------------------------------------------------ file imports

// One escaper for HTML built in this module. Two functions below still carry
// their own local copies, which shadow this; anything new uses this one. It
// escapes the quote as well, so a value is safe in an attribute and not only
// in text.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    input.click();
  });
}

function importStatus(text, level) {
  const n = noteEls['import-status'];
  if (!n) return;
  n.textContent = text;
  n.style.color = level === 'error' ? 'var(--bad)' : level === 'ok' ? 'var(--ok)' : '';
}

async function importTurbines() {
  const file = await pickFile('.xlsx,.xlsm,.csv,.tsv,.txt');
  if (!file) return;
  importStatus(`Reading ${file.name}...`);
  try {
    const sheets = await readTable(file);
    const { turbines, warnings } = parseTurbineRows(sheets[0].rows, {
      origin: { lat: scenario.site.originLat, lon: scenario.site.originLon },
      radarEasting: scenario.site.radarEasting,
      radarNorthing: scenario.site.radarNorthing,
      defaults: scenario.farm,
    });
    scenario.farm.manual = turbines;
    scenario.farm.count = turbines.length;
    run(false);
    rebuildRail();
    importStatus(`${turbines.length} turbines imported from ${file.name}.`
      + (warnings.length ? ` ${warnings.join(' ')}` : ''), 'ok');
  } catch (err) {
    importStatus(err.message, 'error');
  }
}

function siteImportReport(kind, file, res) {
  const parts = [`${res.sites.length} ${kind} imported from ${file.name}.`];
  if (res.skipped) parts.push(`${res.skipped} row(s) skipped for no name or no position.`);
  if (res.headerRow > 0) parts.push(`Header found on row ${res.headerRow + 1}.`);
  parts.push(...res.warnings);
  return parts.join(' ');
}

async function importRadarSites() {
  const file = await pickFile('.xlsx,.xlsm,.csv,.tsv,.txt');
  if (!file) return;
  importStatus(`Reading ${file.name}...`);
  try {
    const sheets = await readTable(file);
    const res = parseRadarSiteRows(sheets[0].rows, {
      originLat: scenario.site.originLat, originLon: scenario.site.originLon,
      radarEasting: scenario.site.radarEasting, radarNorthing: scenario.site.radarNorthing,
    });
    if (!res.sites.length) { importStatus(res.warnings.join(' '), 'error'); return; }
    importedSites.radars = res.sites;
    importedSites.source.radars = file.name;
    rebuildRail();
    refreshMapData();
    importStatus(siteImportReport('radar sites', file, res), res.warnings.length ? '' : 'ok');
  } catch (err) {
    importStatus(err.message, 'error');
  }
}

async function importFarmSites() {
  const file = await pickFile('.xlsx,.xlsm,.csv,.tsv,.txt');
  if (!file) return;
  importStatus(`Reading ${file.name}...`);
  try {
    const sheets = await readTable(file);
    const res = parseFarmSiteRows(sheets[0].rows, {
      originLat: scenario.site.originLat, originLon: scenario.site.originLon,
      radarEasting: scenario.site.radarEasting, radarNorthing: scenario.site.radarNorthing,
    });
    if (!res.sites.length) { importStatus(res.warnings.join(' '), 'error'); return; }
    importedSites.farms = res.sites;
    importedSites.source.farms = file.name;
    rebuildRail();
    refreshMapData();
    importStatus(siteImportReport('wind farm sites', file, res), res.warnings.length ? '' : 'ok');
  } catch (err) {
    importStatus(err.message, 'error');
  }
}

/**
 * Inspect a file nobody has described, and say how it differs from what we
 * hold. Deliberately separate from the import buttons: this one NEVER changes
 * the site tables. It answers "what is this and does it agree with us", which
 * is the question you have before you are willing to import anything.
 */
async function inspectUnknownFile() {
  const file = await pickFile('.xlsx,.xlsm,.csv,.tsv,.txt');
  if (!file) return;
  importStatus(`Reading ${file.name}...`);
  try {
    const sheets = await readTable(file);
    const rows = sheets[0].rows;
    const prof = profileTable(rows);
    const conflicts = headingConflicts(prof);
    const header = mapColumns(rows, FARM_SITE_FIELDS);
    const body = rows.slice(prof.headerRow + 1)
      .filter((r) => r && r.some((c) => c != null && c !== ''));
    const known = UK_WIND_FARMS.map((_, i) => farmRecord(i));
    const rec = reconcileFarms(body, known, { map: header.map || {} });

    const pct = (n) => `${Math.round(n * 100)}%`;
    let html = `<h3>${esc(file.name)}</h3>`
      + `<p>${esc(prof.rowCount)} rows, ${esc(prof.columnCount)} columns, `
      + `header on row ${esc(prof.headerRow + 1)}. `
      + `Recognised fields: ${prof.recognisedFields.length
        ? esc(prof.recognisedFields.join(', ')) : 'none'}.</p>`;

    if (conflicts.length) {
      html += '<div class="warn-box"><strong>Headings that disagree with their values.</strong> '
        + 'A column converted to degrees but still labelled as a grid reference puts the site '
        + 'in the sea if it is imported as written.<ul>'
        + conflicts.map((c) => `<li><code>${esc(c.column)}</code> is headed `
          + `<strong>${esc(c.headingSays)}</strong> but its values are ${esc(c.why)}.</li>`).join('')
        + '</ul></div>';
    }

    html += '<h3>Columns</h3><table class="delta-table"><thead><tr>'
      + '<th>Column</th><th>Holds</th><th>Looks like</th><th>Filled</th>'
      + '<th>Distinct</th><th>Example</th></tr></thead><tbody>'
      + prof.columns.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.kind)}</td>`
        + `<td>${esc(c.valueShape || (c.mappedField ? `${c.mappedField} (by name)` : ''))}</td>`
        + `<td>${esc(pct(c.fillRate))}</td>`
        + `<td>${esc(c.distinct)}${c.constant ? ' (constant)' : ''}${c.unique ? ' (unique)' : ''}</td>`
        + `<td>${esc(c.samples.join(', '))}</td></tr>`).join('')
      + '</tbody></table>';

    const su = rec.summary;
    html += '<h3>Against the built-in table</h3>'
      + '<table class="delta-table"><tbody>'
      + `<tr><td>Rows</td><td>${esc(su.total)}</td></tr>`
      + `<tr><td>Matched</td><td>${esc(su.matched)}</td></tr>`
      + `<tr><td>&nbsp;&nbsp;by planning reference</td><td>${esc(su.byReference)}</td></tr>`
      + `<tr><td>&nbsp;&nbsp;by name</td><td>${esc(su.byName)}</td></tr>`
      + `<tr><td>&nbsp;&nbsp;by position only</td><td>${esc(su.byPosition)}</td></tr>`
      + `<tr><td>Not matched</td><td>${esc(su.unmatched)}</td></tr>`
      + `<tr><td>Median position difference</td><td>${su.medianPositionDeltaM === null
        ? 'no positions to compare' : `${esc(su.medianPositionDeltaM)} m`}</td></tr>`
      + `<tr><td>Largest position difference</td><td>${su.maxPositionDeltaM === null
        ? '&mdash;' : `${esc(su.maxPositionDeltaM)} m`}</td></tr>`
      + `<tr><td>Reference matches over 1 km apart</td><td>${esc(su.referenceMatchesOver1km)}</td></tr>`
      + '</tbody></table>'
      + `<p>${esc(rec.note)}</p>`;

    const worst = rec.rows
      .filter((r) => r.matchedBy === 'reference' && r.positionDeltaM !== null)
      .sort((a, b) => b.positionDeltaM - a.positionDeltaM).slice(0, 12);
    if (worst.length) {
      html += '<h3>Biggest disagreements on a matched reference</h3>'
        + '<table class="delta-table"><thead><tr><th>Row</th><th>Ours</th>'
        + '<th>Apart</th><th>Capacity</th><th>Turbines</th></tr></thead><tbody>'
        + worst.map((r) => `<tr><td>${esc(r.name ?? r.reference ?? '')}</td>`
          + `<td>${esc(r.matched.name)}</td><td>${esc(r.positionDeltaM)} m</td>`
          + `<td>${r.capacityDelta === null ? '&mdash;' : esc(r.capacityDelta)}</td>`
          + `<td>${r.turbineDelta === null ? '&mdash;' : esc(r.turbineDelta)}</td></tr>`).join('')
        + '</tbody></table>';
    }

    // The status line is set BEFORE the innerHTML assignment on purpose. It
    // writes textContent, so it needs no escaping, but the injection test
    // scans the sixteen lines after any innerHTML assignment and would flag it
    // as an unescaped interpolation. Reordering keeps the guard strict rather
    // than adding an exception to it.
    importStatus(`${file.name}: ${su.matched} of ${su.total} rows matched a known project.`, 'ok');
    // This dialog is shared with the import help, so set ITS heading.
    // #text-title belongs to a different dialog, and setting that left this
    // one headed "Getting data in and out" over a file inspection.
    $('#import-help-title').textContent = `Inspect: ${file.name}`;
    $('#import-help-body').innerHTML = html;
    $('#dlg-import-help').showModal();
  } catch (err) {
    // Report into the DIALOG, not only the rail's status line. importStatus
    // writes to an element that exists only while the rail's data tab is
    // built, so when this is run from the map, where its own button lives, a
    // failure wrote to nothing and the whole thing looked like a hang.
    importStatus(err.message, 'error');
    $('#import-help-title').textContent = 'Inspect';
    // Concatenated, not interpolated: this is textContent and needs no
    // escaping, but it sits inside the injection guard's window after the
    // innerHTML assignment above, and a template literal there would read as
    // an unescaped interpolation. Keeping the guard strict is worth a plus.
    $('#import-help-body').textContent = 'Could not read that file: ' + err.message;
    $('#dlg-import-help').showModal();
  }
}

function clearImportedSites() {
  importedSites.radars = [];
  importedSites.farms = [];
  importedSites.source = {};
  rebuildRail();
  importStatus('Imported site lists cleared. The built-in UK data is unchanged.', 'ok');
}

/**
 * Load the pre-baked Copernicus elevation data for wherever the radar is.
 *
 * The data ships with this tool because the Copernicus bucket sends no CORS
 * headers and a browser cannot read it directly. These fetches are to this
 * tool's own files, not to any third party, and nothing leaves the page.
 */
async function loadRealTerrain() {
  const lat = scenario.site.radarLat;
  const lon = scenario.site.radarLon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    importStatus('Place a UK pairing first. Real elevation is anchored on the radar, and this '
      + 'scenario has no radar position.');
    return;
  }
  importStatus('Loading elevation data...');
  try {
    const extent = result ? result.extent : 40000;
    const loaded = await loadTerrain({ lat, lon, halfExtentM: extent });
    terrainCoarseBlock = loaded.coarse;
    realTerrain = createRealTerrain({
      anchorLat: lat, anchorLon: lon,
      coarse: loaded.coarse, blocks: loaded.blocks,
    });
    scenario.environment.terrain.source = 'real';
    scenario.environment.terrain.importMeta = {
      file: `${loaded.blockMeta.length} block(s) at 100 m plus the 500 m national grid`,
      points: null,
      source: loaded.manifest.source,
      model: loaded.manifest.model,
      spacingM: loaded.blockMeta.length ? 100 : 500,
    };
    run(false);
    rebuildRail();
    const cov = realTerrain.coverage();
    const spacing = loaded.blockMeta.length
      ? `${loaded.blockMeta[0].spacingM} m`
      : `${loaded.manifest.coarse.spacingM} m, no finer block in this build`;
    importStatus(`${loaded.manifest.source}, ${spacing}. Real data for `
      + `${(cov * 100).toFixed(0)}% of the modelled area. SURFACE model: includes trees and `
      + 'buildings. Sampled at the radar position you placed, whose own error this does not fix.');
  } catch (err) {
    realTerrain = null;
    importStatus(`Could not load the elevation data: ${err.message}`);
  }
}

async function importTerrain() {
  const file = await pickFile('.asc,.grd,.kml,.kmz,.xlsx,.xlsm,.csv,.tsv,.txt');
  if (!file) return;
  importStatus(`Reading ${file.name}...`);
  try {
    const { points, note } = await readElevationFile(file, {
      origin: { lat: scenario.site.originLat, lon: scenario.site.originLon },
      radarEasting: scenario.site.radarEasting,
      radarNorthing: scenario.site.radarNorthing,
    });
    const extent = result ? result.extent : 20000;
    importedTerrain = buildImportedTerrain(points, {
      halfExtent: extent, size: 384,
      fallbackHeight: scenario.environment.terrain.baseHeight,
    });
    scenario.environment.terrain.source = 'imported';
    scenario.environment.terrain.importMeta = {
      file: file.name,
      points: points.length,
      coverage: importedTerrain.coverage,
      minM: importedTerrain.min,
      maxM: importedTerrain.max,
      note,
    };
    run(false);
    rebuildRail();
    const cov = importedTerrain.coverage;
    importStatus(`${note} Covers ${(cov * 100).toFixed(0)}% of the modelled area`
      + (cov < 0.95 ? '; the rest falls back to the base elevation and is NOT real data.' : '.'),
      cov < 0.6 ? 'error' : 'ok');
  } catch (err) {
    importedTerrain = null;
    realTerrain = null;
    importStatus(err.message, 'error');
  }
}

function clearImports() {
  importedTerrain = null;
  scenario.environment.terrain.source = 'synthetic';
  scenario.environment.terrain.importMeta = null;
  scenario.farm.manual = null;
  run(false);
  rebuildRail();
  importStatus('Imported data cleared. Back to the synthetic surface and generated layout.');
}

// ------------------------------------------------------------ rose sweep

async function runRoseSweep(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sweeping all 12 directions...';
  await new Promise((r) => setTimeout(r, 20));
  try {
    roseResult = analyseWindRose(scenario, { importedTerrain });
    roseFindings = deriveWindRoseFindings(scenario, roseResult);
    run(false);
  } catch (err) {
    console.error(err);
    roseResult = null;
    roseFindings = [];
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    rebuildRail();
  }
}

function railAction(id, btn) {
  if (id === 'import-turbines') importTurbines();
  else if (id === 'import-radar-sites') importRadarSites();
  else if (id === 'import-farm-sites') importFarmSites();
  else if (id === 'clear-site-imports') clearImportedSites();
  else if (id === 'import-terrain') importTerrain();
  else if (id === 'load-real-terrain') loadRealTerrain();
  else if (id === 'clear-imports') clearImports();
  else if (id === 'run-rose') runRoseSweep(btn);
}

function applyPreset(kind, key) {
  if (kind === 'radar') scenario = applyRadarPreset(scenario, key);
  else if (kind === 'radarMount') scenario = applyRadarMount(scenario, key);
  else if (kind === 'turbine') scenario = applyTurbinePreset(scenario, key);
  else if (kind === 'target') scenario = applyTargetPreset(scenario, key);
  else if (kind === 'terrain') scenario = applyTerrainPreset(scenario, key);
  else if (kind === 'rose') {
    const r = WIND_ROSE_PRESETS[key];
    if (r) {
      scenario.wind.rosePreset = key;
      scenario.wind.rose = JSON.parse(JSON.stringify(r.rose));
      scenario.wind.weibullK = r.weibullK;
      roseResult = null;
      roseFindings = [];
    }
  } else if (kind === 'refraction') {
    scenario.weather.refractionPreset = key;
  }
  run(false);
  rebuildRail();
}

// -------------------------------------------------------------- rail tabs

el.tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    el.tabs.forEach((b) => b.classList.toggle('is-active', b === btn));
    activeTab = btn.dataset.tab;
    rebuildRail();
  });
});

// ------------------------------------------------------------ view controls

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b === btn));
    view.setView(btn.dataset.view);
  });
});

document.querySelectorAll('[data-shade]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-shade]').forEach((b) => b.classList.toggle('is-active', b === btn));
    const mode = btn.dataset.shade;
    if (mode !== 'terrain' && (!result || !result.coverage)) run(false);
    view.shadeTerrain(mode);
    renderLegend(el.legend, mode, result);
  });
});

// --------------------------------------------------------- layer toggles

const LAYERS = [
  ['beam', 'Rotating beam'],
  ['envelope', 'Coverage envelope'],
  ['shadows', 'Turbine shadows'],
  ['los', 'Lines of sight'],
  ['track', 'Flight track'],
  ['zones', 'Mitigation zones'],
  ['rings', 'Range rings'],
];

function buildToggles() {
  el.toggles.innerHTML = '';
  for (const [key, label] of LAYERS) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = view.layers[key];
    cb.addEventListener('change', () => { view.layers[key] = cb.checked; view.applyLayers(); });
    l.append(cb, document.createTextNode(label));
    el.toggles.append(l);
  }

  const anim = document.createElement('label');
  const acb = document.createElement('input');
  acb.type = 'checkbox';
  acb.checked = view.animate;
  acb.addEventListener('change', () => { view.animate = acb.checked; });
  anim.append(acb, document.createTextNode('Animate'));
  el.toggles.append(anim);

  const vx = document.createElement('label');
  vx.style.marginTop = '4px';
  const out = document.createElement('span');
  out.style.fontFamily = 'var(--mono)';
  out.textContent = `×${view.vExag}`;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 1; slider.max = 20; slider.step = 1;
  slider.value = view.vExag;
  slider.style.width = '86px';
  slider.addEventListener('input', () => {
    view.vExag = Number(slider.value);
    out.textContent = `×${view.vExag}`;
    if (result) {
      view.build(result);
      updateScalebar();
    }
  });
  vx.append(document.createTextNode('Vertical'), slider, out);
  el.toggles.append(vx);

  // Structural girth. ONE factor for every width in the machine, so the drawn
  // turbine has consistent proportions; spans are never touched.
  const gx = document.createElement('label');
  const gout = document.createElement('span');
  gout.style.fontFamily = 'var(--mono)';
  const gslider = document.createElement('input');
  gslider.type = 'range';
  gslider.min = 1; gslider.max = 40; gslider.step = 1;
  gslider.style.width = '86px';
  const syncGirth = () => {
    gslider.value = view.girthExag ?? 1;
    gout.textContent = `\u00d7${view.girthExag ?? 1}`;
  };
  syncGirth();
  gslider.addEventListener('input', () => {
    view.girthExag = Number(gslider.value);
    gout.textContent = `\u00d7${view.girthExag}`;
    if (result) { view.build(result); updateScalebar(); }
  });
  gx.append(document.createTextNode('Girth'), gslider, gout);
  gx.title = 'How much thicker than life every structural width is drawn. Spans, and so tip '
    + 'heights and the ground area the rotor covers, are never scaled.';
  el.toggles.append(gx);
  view._syncGirth = syncGirth;
}

// ----------------------------------------------------------- section bearing

el.profile.addEventListener('click', (e) => {
  // Click left of centre to step the section bearing back, right to step on.
  const rect = el.profile.getBoundingClientRect();
  const dir = (e.clientX - rect.left) < rect.width / 2 ? -5 : 5;
  profile.bearingDeg = ((profile.activeBearing + dir) % 360 + 360) % 360;
  el.profileBearing.textContent = `${profile.activeBearing.toFixed(0).padStart(3, '0')}°`;
});
el.profile.title = 'Click the left or right half to rotate the section bearing';

// --------------------------------------------------------------- dialogs

$('#btn-import-help').addEventListener('click', () => {
  // The inspector borrows this dialog and retitles it, so restore the heading.
  $('#import-help-title').textContent = 'Getting data in and out';
  $('#import-help-body').innerHTML = IMPORT_HTML;
  $('#dlg-import-help').showModal();
});

$('#btn-method').addEventListener('click', () => {
  $('#method-body').innerHTML = METHOD_HTML;
  $('#dlg-method').showModal();
});

// Downloads are inert inside a sandboxed frame. Rather than leave buttons that
// silently do nothing, the tool hides them there and says why.
const canDownload = downloadsAvailable();
if (!canDownload) {
  $('#download-note').hidden = false;
  document.querySelectorAll('[data-mode="download"]').forEach((b) => b.remove());
  document.querySelectorAll('[data-mode="view"]').forEach((b) => b.classList.remove('ghost'));
}

$('#btn-evidence').addEventListener('click', () => {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const counts = statusCounts();
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v} ${STATUS_LABELS[k].toLowerCase()}`).join(', ');
  $('#evidence-body').innerHTML = `
    <div class="warn-box">
      <strong>${counts.read || 0} of ${REFERENCES.length} entries ${(counts.read || 0) === 1 ? 'was' : 'were'} read in full.</strong>
      Of the rest: ${esc(summary)}. The environment this tool was built in had no general outbound
      network access. Where a formula came from a standard reference, it was validated against values
      that are independently known instead, which is a different kind of confidence and is recorded on
      each entry. Read the status before relying on anything here.
    </div>
    ${REFERENCES.map((r) => `
      <article class="ev-entry" data-status="${r.status}">
        <h4>${esc(r.title)}</h4>
        <p class="ev-meta">${esc([r.authors, r.org, r.venue, r.year, r.type].filter(Boolean).join(' \u00b7 '))}</p>
        <p class="ev-status"><span class="ev-dot" data-status="${r.status}"></span>${esc(STATUS_LABELS[r.status])}</p>
        ${r.reports ? `<p><strong>What it reports.</strong> ${esc(r.reports)}</p>` : ''}
        ${r.validation ? `<p><strong>How this tool checked it.</strong> ${esc(r.validation)}</p>` : ''}
        ${r.caution ? `<p class="ev-caution"><strong>Caution.</strong> ${esc(r.caution)}</p>` : ''}
        ${r.supports?.length ? `<p class="ev-supports">Supports: ${esc(r.supports.join('; '))}</p>` : ''}
      </article>`).join('')}`;
  $('#dlg-evidence').showModal();
});

$('#btn-export').addEventListener('click', () => $('#dlg-export').showModal());

// --------------------------------------------------------------- UK map
//
// The national view. Built lazily on first open, because the screen touches
// every radar against every farm and there is no reason to pay for that
// before anyone asks to see it.
let ukMap = null;
let ukScreen = null;

// The site lists are stored as compact arrays to keep the bundle small, and
// reading the wrong index is silent, so there is exactly ONE mapping and it
// lives with the data in uksites.js.
//
// It did not, for a while. There were three hand-written copies of this
// mapping: here, in uksites.js, and a third in the test file. When the July
// 2024 extract added a turbine count and a tip height, updating one of the
// three meant the sensitivity tool saw the new heights, the test did not, and
// the application itself did not either. Three copies is three chances to
// forget, and the forgetting is invisible because a missing field reads as
// undefined and falls back to an assumption.
export function farmRowToObject(r, i) {
  return farmRecord(i);
}

export function radarRowToObject(r, i) {
  return {
    index: i, name: r[0], role: r[1], lat: r[2], lon: r[3],
    sources: r[4], disagreementM: r[5],
  };
}

function mapFarms() {
  // Imported farms sit alongside the built-in table and are marked, so the
  // map can show them differently and the panel can say where a row came from.
  return [
    ...UK_WIND_FARMS.map(farmRowToObject),
    ...importedSites.farms.map((f) => ({
      name: f.name, lat: f.lat, lon: f.lon, mw: f.mw,
      status: f.status || 'Operational', offshore: !!f.offshore,
      authority: f.authority || '', imported: true,
    })),
  ];
}

function mapRadars() {
  return [
    ...UK_RADAR_SITES.map(radarRowToObject),
    ...importedSites.radars.map((r) => ({
      name: r.name, role: r.role || 'unclassified', lat: r.lat, lon: r.lon,
      heightAgl: r.heightAgl, imported: true,
    })),
  ];
}

function runNationalScreen() {
  const farms = mapFarms();
  const radars = mapRadars();
  // Real ground if the elevation data is loaded, flat sea level if not. The
  // panel says which, because it changes the answer by more than half.
  const coarse = terrainCoarseBlock;
  const t0 = performance.now();
  ukScreen = nationalScreen({ radars, farms, coarse });
  ukScreen.tookMs = Math.round(performance.now() - t0);
  return ukScreen;
}

function mapPanel(hit) {
  const el = $('#map-panel');
  if (!el || !ukMap) return;
  const s = ukScreen;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (hit && hit.kind === 'radar') {
    const r = ukMap.radars[hit.index];
    const b = s.byRadar[hit.index];
    const near = ukMap.nearestFarmTo(hit.index, ACTIVE_STATUSES);
    el.innerHTML = `<h4>Radar</h4><div class="big">${esc(r.name)}</div>`
      + `<div>${esc(r.role)}${r.imported ? ' &middot; imported' : ''}</div><hr>`
      + '<table>'
      + `<tr><td>Operational or building, in sight</td><td>${esc(b.visibleActive)}</td></tr>`
      + `<tr><td>All records in sight</td><td>${esc(b.visible)}</td></tr>`
      + `<tr><td>In range but hidden by terrain</td><td>${esc(b.hidden)}</td></tr>`
      + `<tr><td>Nearest visible</td><td>${Number.isFinite(b.nearestVisibleM)
        ? (b.nearestVisibleM / 1000).toFixed(1) + ' km' : 'none'}</td></tr>`
      + (near ? `<tr><td>Nearest active farm</td><td>${(near.distanceM / 1000).toFixed(1)} km</td></tr>` : '')
      + '</table><hr>'
      + `<p>Click again to load <strong>${esc(r.name)}</strong> against its nearest active `
      + 'farm into the full assessment.</p>';
    return;
  }
  if (hit && hit.kind === 'farm') {
    const f = ukMap.farms[hit.index];
    const b = s.byFarm[hit.index];
    el.innerHTML = `<h4>Wind farm</h4><div class="big">${esc(f.name || '(unnamed record)')}</div>`
      + `<div>${esc(f.status)}${f.imported ? ' &middot; imported' : ''}</div><hr>`
      + '<table>'
      + `<tr><td>Capacity</td><td>${esc(farmCapacityLabel(f))}</td></tr>`
      + `<tr><td>${f.offshore ? 'Offshore' : 'Onshore'}</td><td>${esc(f.authority || '')}</td></tr>`
      + `<tr><td>Radars that can see it</td><td>${esc(b.seenBy)}</td></tr>`
      + `<tr><td>Radars in range but blocked</td><td>${esc(b.hiddenFrom)}</td></tr>`
      + `<tr><td>Nearest radar</td><td>${Number.isFinite(b.nearestRadarM)
        ? (b.nearestRadarM / 1000).toFixed(1) + ' km' : 'none in range'}</td></tr>`
      + '</table>';
    return;
  }
  const a = s.assumptions;
  const cov = farmAttributeCoverage();
  // Two independent facts about each record, compared. Small is expected;
  // growing would mean the boundaries or the flag have moved.
  const fc = offshoreFlagConflicts();
  const conflicts = fc.onshoreInSea.length + fc.offshoreOnLand.length;
  const terr = territoryCounts();
  el.innerHTML = '<h4>National screen</h4>'
    + '<table>'
    + `<tr><td>Radars</td><td>${esc(s.summary.radars)}</td></tr>`
    + `<tr><td>Planning records screened</td><td>${esc(s.summary.farms)}</td></tr>`
    + `<tr><td>of which operational or building</td><td>${esc(s.summary.activeFarms)}</td></tr>`
    + `<tr><td>Visible pairings</td><td>${esc(s.summary.visiblePairings)}</td></tr>`
    + `<tr><td>Farms seen by a radar</td><td>${esc(s.summary.farmsSeenByAtLeastOne)}</td></tr>`
    + `<tr><td>Farms seen by three or more</td><td>${esc(s.summary.farmsSeenByThreeOrMore)}</td></tr>`
    + `<tr><td>Radars seeing nothing</td><td>${esc(s.summary.radars - s.summary.radarsSeeingSomething)}</td></tr>`
    + `<tr><td>Terrain profiles run</td><td>${esc(s.profiles)} in ${esc(s.tookMs)} ms</td></tr>`
    + '</table>'
    // How much of the answer rests on recorded figures and how much on an
    // assumption. A screen that cannot say which is which invites its numbers
    // to be read as measurements.
    + '<hr><h4>What the data carries</h4>'
    + '<table>'
    + `<tr><td>Turbines counted</td><td>${esc(cov.turbines.toLocaleString('en-GB'))}</td></tr>`
    + `<tr><td>Farms with a turbine count</td><td>${esc(cov.withCount)} of ${esc(cov.live)}</td></tr>`
    + `<tr><td>Farms with a recorded tip height</td><td>${esc(cov.withHeight)} of ${esc(cov.live)}</td></tr>`
    + `<tr><td>Records whose offshore flag and position disagree</td><td>${esc(conflicts)}</td></tr>`
    + `<tr><td>Pairings at a recorded height</td><td>${esc(s.tipHeights.recorded)}</td></tr>`
    + `<tr><td>Pairings at the ${esc(s.tipHeights.fallbackM)} m fallback</td><td>${esc(s.tipHeights.assumed)}</td></tr>`
    + '</table>'
    + '<h4>By territory</h4><table>'
    + Object.entries(terr).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')
    + '</table>'
    + '<p>Turbine COUNTS and heights come from the planning database. Turbine POSITIONS do not: '
    + 'every farm here is one point, and at the two sites with ground truth that point is about '
    + '1.1 km from the array. Import a layout on the Site and data tab to assess a real one.</p>'
    + '<hr>'
    + '<h4>What this is</h4>'
    + '<p>Line of sight and range only. It asks whether the top of a turbine would be above the '
    + 'intervening ground as seen from the antenna. It does NOT say a return would cross a '
    + 'detection threshold, survive the clutter filter, or ever reach a controller. Click a radar '
    + 'for that.</p>'
    + `<p>Ground: ${esc(s.terrainUsed)}.</p>`
    + '<h4 class="warn">Assumptions</h4>'
    + `<p>${esc(a.tipHeightNote)}</p>`
    + `<p>${esc(a.antennaHeightNote)}</p>`
    + `<p>${esc(a.positionNote)}</p>`
    + `<p>${esc(a.samplesNote)}</p>`
    + '<hr><h4>Ireland</h4>'
    + '<p>The coastline is drawn, and four Irish radar points are shown, but they are '
    + 'unclassified and from a low-confidence source. <strong>No Republic of Ireland wind farm '
    + 'data is loaded.</strong> Use the site list import on the Site &amp; data tab to add it.</p>'
    + `<hr><p>Coastline: ${esc(COASTLINE_SOURCE.source)}. ${esc(COASTLINE_SOURCE.licence)}</p>`;
}

function mapLegend() {
  const el = $('#map-legend');
  if (!el) return;
  // Built from nodes rather than an HTML string. The colours are constants, but
  // a legend is not worth an exception to the rule that nothing is assembled
  // into innerHTML, and this version cannot be made unsafe by a later edit.
  el.textContent = '';
  const title = document.createElement('div');
  title.className = 'legend-title';
  title.textContent = 'MAP';
  el.append(title);
  const row = (colour, text) => {
    const d = document.createElement('div');
    d.className = 'legend-row';
    if (colour) {
      const sw = document.createElement('span');
      sw.className = 'map-swatch';
      sw.style.background = colour;
      d.append(sw);
    }
    d.append(document.createTextNode(text));
    el.append(d);
    return d;
  };
  row(MAP_COLORS.farmActive, 'Farm a radar can see');
  row(MAP_COLORS.farmHidden, 'Farm no radar can see');
  row(MAP_COLORS.farmPipeline, 'In planning (layer off by default)');
  row(MAP_COLORS.radar, 'Radar with farms in sight');
  row(MAP_COLORS.radarQuiet, 'Radar with none');
  row(MAP_COLORS.radarMil, 'Imported air defence site (not in the built-in list)');
  row(null, 'Heat: how many radars can see the turbines there. '
    + 'Not a probability of anything.').style.marginTop = '6px';
}

function buildMapLayers() {
  const el = $('#map-layers');
  if (!el) return;
  const rows = [
    ['active', 'Operational and under construction'],
    ['pipeline', 'Consented or in planning'],
    ['dead', 'Refused, withdrawn or abandoned'],
    ['radars', 'Radars'],
    ['heat', 'Heat map'],
    ['sightlines', 'Sight lines'],
    ['coverage', 'Horizon circles'],
  ];
  el.innerHTML = '';
  for (const [key, label] of rows) {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!ukMap.layers[key];
    cb.addEventListener('change', () => ukMap.setLayer(key, cb.checked));
    lab.append(cb, document.createTextNode(' ' + label));
    el.append(lab);
  }
}

// The national screen needs the 500 m grid. Without it every pairing is flat
// sea level, which roughly doubles the number of farms called visible, so the
// map loads it on first open rather than waiting for someone to ask for real
// ground on the Site tab.
async function ensureNationalTerrain() {
  if (terrainCoarseBlock) return true;
  try {
    // fine: false asks for the national grid only. Loading the 100 m blocks
    // for the whole country would be 27 MB and is not what this needs.
    const loaded = await loadTerrain({ lat: 55, lon: -3, halfExtentM: 0, fine: false });
    terrainCoarseBlock = loaded.coarse;
    return true;
  } catch {
    return false;
  }
}

async function openUkMap() {
  const dlg = $('#dlg-map');
  dlg.showModal();
  const canvas = $('#map-canvas');
  if (!ukMap) {
    ukMap = new UkMap(canvas, {
      rings: COASTLINE,
      farms: mapFarms(),
      radars: mapRadars(),
      onHover: (hit) => mapPanel(hit),
      onSelectRadar: (i, repeat) => {
        if (i === null) { mapPanel(null); return; }
        // First click selects and reports. A second click on the SAME radar
        // loads it into the assessment, because loading replaces the current
        // scenario and should not happen by brushing past a marker.
        if (repeat) { loadPairingFromMap(i); return; }
        mapPanel({ kind: 'radar', index: i });
      },
    });
    buildMapLayers();
    buildMapImport();
    mapLegend();
    window.addEventListener('resize', () => { if (dlg.open) ukMap.resize(); });
  } else {
    ukMap.farms = mapFarms();
    ukMap.radars = mapRadars();
  }
  ukMap.resize();
  $('#map-readout').textContent = 'Loading the 500 m national elevation grid\u2026';
  // Draw once on flat ground so the country appears immediately, then redraw
  // with real terrain. The panel always says which one is on screen.
  ukMap.setScreen(runNationalScreen());
  mapPanel(null);
  const ok = await ensureNationalTerrain();
  ukMap.setScreen(runNationalScreen());
  mapPanel(null);
  $('#map-readout').textContent = (ok
    ? 'Real ground, 500 m grid. '
    : 'ELEVATION DATA DID NOT LOAD: every pairing is flat sea level, which overstates what a radar can see. ')
    + 'Drag to pan \u00b7 scroll to zoom \u00b7 click a radar, then click it again to load it '
    + 'into the assessment';
}

function loadPairingFromMap(radarIndex) {
  const r = ukMap.radars[radarIndex];
  const near = ukMap.nearestFarmTo(radarIndex, ACTIVE_STATUSES);
  if (!near) {
    $('#map-readout').textContent = `${r.name}: no operational or under-construction farm found `
      + 'to pair it with. Import a site list to add one.';
    return;
  }
  const f = near.farm;
  const bearing = (Math.atan2(
    (f.lon - r.lon) * Math.cos((f.lat + r.lat) / 2 * Math.PI / 180),
    f.lat - r.lat,
  ) * 180 / Math.PI + 360) % 360;
  scenario.site.originLat = Number(f.lat.toFixed(4));
  scenario.site.originLon = Number(f.lon.toFixed(4));
  scenario.site.radarLat = Number(r.lat.toFixed(5));
  scenario.site.radarLon = Number(r.lon.toFixed(5));
  scenario.farm.centreBearingDeg = Math.round(bearing);
  scenario.farm.centreRangeM = Math.round(Math.min(near.distanceM, 60000) / 250) * 250;
  scenario.site.environment = f.offshore ? 'offshore' : 'onshore';
  scenario.farm.ukPairing = {
    farm: f.name, radar: r.name, role: r.role,
    status: f.status, offshore: !!f.offshore, repdRef: f.repdRef || 'n/a',
    trueRangeM: Math.round(near.distanceM), clamped: near.distanceM > 60000,
    uncertaintyM: f.imported ? null : 1100,
    uncertaintyFraction: f.imported ? null : 1100 / Math.max(near.distanceM, 1),
    placedFrom: 'the national map',
  };
  run(false);
  rebuildRail();
  $('#dlg-map').close();
}

// Uploaded sites have to reach the map without a trip back to the Site tab,
// and the map has to rerun the screen to include them.
function refreshMapData() {
  if (!ukMap) return;
  ukMap.farms = mapFarms();
  ukMap.radars = mapRadars();
  ukMap.selected = null;
  ukMap.setScreen(runNationalScreen());
  mapPanel(null);
  const src = [importedSites.source.farms && `farms from ${importedSites.source.farms}`,
    importedSites.source.radars && `radars from ${importedSites.source.radars}`]
    .filter(Boolean).join(', ');
  if (src) $('#map-readout').textContent = `Added ${src}. The screen has been rerun.`;
}

function buildMapImport() {
  const el = $('#map-import');
  if (!el) return;
  el.textContent = '';
  const h = document.createElement('h4');
  h.textContent = 'Add your own data';
  el.append(h);
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.style.width = '100%';
    b.style.marginTop = '6px';
    b.textContent = label;
    b.addEventListener('click', fn);
    el.append(b);
  };
  mk('Wind farm site list (.xlsx or .csv)', importFarmSites);
  mk('Radar site list (.xlsx or .csv)', importRadarSites);
  mk('Inspect an unknown file (no import)', inspectUnknownFile);
  const p = document.createElement('p');
  p.style.marginTop = '8px';
  p.textContent = 'One row per site, with a name and a position. Templates are in '
    + 'samples/. Imported sites are drawn alongside the built-in lists and are '
    + 'included in the screen. They carry no position uncertainty figure, because '
    + 'this tool does not know how yours were surveyed.';
  el.append(p);
}

$('#btn-map').addEventListener('click', openUkMap);

// Views export as images. The 3D view has to be captured in the same tick as a
// render, or the drawing buffer has already been cleared.
document.querySelectorAll('[data-image]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const kind = btn.dataset.image;
    let url;
    if (kind === 'scene') {
      view.render(0);
      url = view.renderer.domElement.toDataURL('image/png');
    } else {
      const c = { ppi: el.ppi, profile: el.profile, windrose: el.windrose }[kind];
      url = c ? c.toDataURL('image/png') : null;
    }
    if (url) saveOrShow(`${kind}-${Date.now()}.png`, 'image/png', url, true);
  });
});

document.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!result) return;
    const kind = btn.dataset.export;
    if (kind === 'pdf') {
      // The browser writes the PDF, so the user gets real pagination and
      // selectable text. A blocked pop-up is the one way this fails.
      const opened = printReport(result, currentDelta());
      if (!opened) {
        $('#text-title').textContent = 'PDF';
        $('#text-body').value = 'The print window was blocked by the browser.\n\n'
          + 'Allow pop-ups for this page and press PDF again, or export the Word '
          + 'file and print that to PDF instead.';
        $('#dlg-export').close();
        $('#dlg-text').showModal();
      }
      return;
    }
    if (btn.dataset.mode === 'download') {
      const b = btn;
      const was = b.textContent;
      b.disabled = true; b.textContent = 'Building...';
      downloadExport(kind, result, currentDelta())
        .catch((err) => { b.textContent = 'Failed'; console.error(err); })
        .finally(() => { setTimeout(() => { b.disabled = false; b.textContent = was; }, 600); });
      return;
    }
    const built = buildExport(kind, result, currentDelta());
    if (!built) return;
    if (built.binary) {
      $('#text-title').textContent = `${built.label} (.${built.extension})`;
      $('#text-body').value = `A .${built.extension} file is a ZIP of XML, so there is nothing `
        + 'useful to show here. Use the download button beside this one.';
      $('#dlg-export').close();
      $('#dlg-text').showModal();
      return;
    }
    $('#text-title').textContent = `${built.label} (.${built.extension})`;
    $('#text-body').value = built.text;
    $('#dlg-export').close();
    $('#dlg-text').showModal();
    $('#text-body').scrollTop = 0;
  });
});

$('#btn-copy').addEventListener('click', async () => {
  const area = $('#text-body');
  const btn = $('#btn-copy');
  try {
    await navigator.clipboard.writeText(area.value);
    btn.textContent = 'Copied';
  } catch (err) {
    // Clipboard access can be refused; selecting the text still lets the
    // reader copy it themselves.
    area.focus();
    area.select();
    btn.textContent = 'Selected, press Ctrl/Cmd+C';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 2500);
});

$('#import-scenario').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    scenario = mergeDeep(defaultScenario(), JSON.parse(text));
    run(false);
    rebuildRail();
    $('#dlg-export').close();
  } catch (err) {
    alert(`Could not read that scenario file: ${err.message}`);
  }
  e.target.value = '';
});

function anyMitigation() {
  const m = scenario.mitigation;
  return m.ram.enabled || m.curtail.enabled || m.enhancedDoppler.enabled
    || m.blanking.enabled || m.naiz.enabled || m.infill.enabled;
}

function currentDelta() {
  if (!anyMitigation()) return null;
  const bare = mergeDeep(scenario, {
    mitigation: {
      ram: { enabled: false }, curtail: { enabled: false },
      enhancedDoppler: { enabled: false }, blanking: { enabled: false },
      naiz: { enabled: false }, infill: { enabled: false },
    },
  });
  return buildDelta(analyse(bare, { skipCoverage: true }), result);
}

$('#btn-baseline').addEventListener('click', () => {
  const body = $('#delta-body');
  if (!anyMitigation()) {
    body.innerHTML = '<p class="dlg-lead">No mitigation is enabled, so there is nothing to compare. '
      + 'Turn something on in the Mitigation tab and come back.</p>';
  } else {
    const rows = currentDelta();
    body.innerHTML = `
      <p class="dlg-lead">Current mitigation set measured against the same scenario with every mitigation
      switched off. A mitigation that improves one row while making another worse is doing exactly what
      mitigations do: trading one problem for another.</p>
      <table class="delta-table">
        <thead><tr><th>Metric</th><th>No mitigation</th><th>With mitigation</th><th>Change</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${r.label}</td><td>${r.before}</td><td>${r.after}</td>
          <td class="delta-${r.dir}">${r.change}</td></tr>`).join('')}</tbody>
      </table>`;
  }
  $('#dlg-delta').showModal();
});

// ------------------------------------------------------------ sweep dialog

function fillSelect(sel, entries, current) {
  sel.innerHTML = '';
  for (const [key, def] of entries) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    sel.append(o);
  }
  sel.value = current;
}

function drawSweepCanvas(hover) {
  const c = $('#sweep-canvas');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = c.clientWidth || 900;
  const h = c.clientHeight || 520;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!sweepResult) {
    ctx.fillStyle = '#080b0e';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  sweepLayout = drawSweep(ctx, sweepResult, {
    width: w, height: h, hover, scale: 1,
    title: `${SWEEP_METRICS[sweepResult.metricKey].label} across `
      + `${SWEEP_PARAMS[sweepResult.xParam].label.toLowerCase()} and `
      + `${SWEEP_PARAMS[sweepResult.yParam].label.toLowerCase()}`,
    subtitle: sweepSubtitle(),
  });
}

function sweepSubtitle() {
  const r = scenario;
  return `${r.radar.label || r.radar.preset} \u00b7 ${r.farm.count} x ${r.farm.preset} \u00b7 `
    + `${r.site.environment} \u00b7 wind ${r.wind.directionDeg}\u00b0 at ${r.wind.speedMs} m/s \u00b7 `
    + `k=${r.environment.kFactor.toFixed(2)} \u00b7 screening model, not a technical assessment`;
}

async function doSweep() {
  const btn = $('#sweep-run');
  const bar = $('#sweep-bar');
  const prog = $('#sweep-progress');
  btn.disabled = true;
  prog.hidden = false;
  bar.style.width = '0%';
  $('#sweep-readout').textContent = 'Running...';
  try {
    sweepResult = await runSweep(scenario, {
      xParam: $('#sweep-x').value,
      yParam: $('#sweep-y').value,
      metric: $('#sweep-metric').value,
      steps: Number($('#sweep-steps').value),
      onProgress: (t) => { bar.style.width = `${(t * 100).toFixed(0)}%`; },
    });
    drawSweepCanvas(null);
    const n = sweepResult.steps * sweepResult.steps;
    $('#sweep-readout').textContent = `${n} analyses. `
      + `${sweepResult.metric.label} ranges from ${sweepResult.metric.format(sweepResult.min)} to `
      + `${sweepResult.metric.format(sweepResult.max)} ${sweepResult.metric.unit}. `
      + 'Hover a cell for its values; the outlined cell is the scenario you have set up.';
  } catch (err) {
    $('#sweep-readout').textContent = `Sweep failed: ${err.message}`;
  } finally {
    btn.disabled = false;
    prog.hidden = true;
  }
}

$('#export-to-sweep')?.addEventListener('click', (e) => {
  e.preventDefault();
  $('#dlg-export').close();
  $('#btn-sweep').click();
});

$('#btn-sweep').addEventListener('click', () => {
  fillSelect($('#sweep-x'), Object.entries(SWEEP_PARAMS), $('#sweep-x').value || 'distance');
  fillSelect($('#sweep-y'), Object.entries(SWEEP_PARAMS), $('#sweep-y').value || 'tipHeight');
  fillSelect($('#sweep-metric'), Object.entries(SWEEP_METRICS), $('#sweep-metric').value || 'plots');
  $('#sweep-steps-out').textContent = `${$('#sweep-steps').value} x ${$('#sweep-steps').value}`;
  $('#dlg-sweep').showModal();
  requestAnimationFrame(() => drawSweepCanvas(null));
});

$('#sweep-steps').addEventListener('input', (e) => {
  $('#sweep-steps-out').textContent = `${e.target.value} x ${e.target.value}`;
});
$('#sweep-run').addEventListener('click', doSweep);

$('#sweep-canvas').addEventListener('pointermove', (e) => {
  if (!sweepResult || !sweepLayout) return;
  const r = e.target.getBoundingClientRect();
  const cell = cellAt(sweepLayout, e.clientX - r.left, e.clientY - r.top);
  drawSweepCanvas(cell);
  if (!cell) return;
  const v = sweepResult.values[cell.j * sweepResult.steps + cell.i];
  const px = SWEEP_PARAMS[sweepResult.xParam];
  const py = SWEEP_PARAMS[sweepResult.yParam];
  $('#sweep-readout').textContent =
    `${px.label} ${sweepResult.xs[cell.i]} ${px.unit} \u00b7 `
    + `${py.label} ${sweepResult.ys[cell.j]} ${py.unit} \u2192 `
    + `${Number.isFinite(v) ? sweepResult.metric.format(v) : 'no result'} ${sweepResult.metric.unit}`;
});
$('#sweep-canvas').addEventListener('pointerleave', () => drawSweepCanvas(null));

function saveOrShow(name, mime, content, isDataUrl) {
  if (canDownload) {
    const a = document.createElement('a');
    a.href = isDataUrl ? content : URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  // Sandboxed: downloads are inert, so show the content instead.
  if (isDataUrl) {
    const win = window.open();
    if (win) {
      win.document.write(`<img src="${content}" style="max-width:100%">`);
    } else {
      $('#text-title').textContent = name;
      $('#text-body').value = content;
      $('#dlg-text').showModal();
    }
    return;
  }
  $('#text-title').textContent = name;
  $('#text-body').value = content;
  $('#dlg-text').showModal();
}

$('#sweep-png').addEventListener('click', () => {
  if (!sweepResult) return;
  saveOrShow(`sweep-${Date.now()}.png`, 'image/png',
    sweepToPng(sweepResult, {
      title: `${sweepResult.metric.label} across ${SWEEP_PARAMS[sweepResult.xParam].label.toLowerCase()} `
        + `and ${SWEEP_PARAMS[sweepResult.yParam].label.toLowerCase()}`,
      subtitle: sweepSubtitle(),
    }), true);
});
$('#sweep-svg').addEventListener('click', () => {
  if (!sweepResult) return;
  saveOrShow(`sweep-${Date.now()}.svg`, 'image/svg+xml',
    sweepToSvg(sweepResult, {
      title: `${sweepResult.metric.label} across ${SWEEP_PARAMS[sweepResult.xParam].label.toLowerCase()} `
        + `and ${SWEEP_PARAMS[sweepResult.yParam].label.toLowerCase()}`,
      subtitle: sweepSubtitle(),
    }), false);
});
$('#sweep-csv').addEventListener('click', () => {
  if (!sweepResult) return;
  saveOrShow(`sweep-${Date.now()}.csv`, 'text/csv', sweepToCsv(sweepResult), false);
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Discard this scenario and return to the defaults?')) return;
  scenario = defaultScenario();
  profile.bearingDeg = null;
  importedTerrain = null;
  roseResult = null;
  roseFindings = [];
  sweepResult = null;
  run(false);
  rebuildRail();
});

// ------------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  view.render(dt);
  ppi.draw(view.time);
  profile.draw();
  windrose.draw();
  requestAnimationFrame(frame);
}

const ro = new ResizeObserver(() => view.resize());
ro.observe(el.canvas3d);
window.addEventListener('resize', () => view.resize());

// ------------------------------------------------------------------- start

buildToggles();
run(false);
rebuildRail();
view.setView('orbit');
requestAnimationFrame(frame);

// Keyboard shortcuts for the things worth reaching for quickly.
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const views = { 1: 'orbit', 2: 'radar', 3: 'plan', 4: 'profile' };
  if (views[e.key]) {
    const btn = document.querySelector(`[data-view="${views[e.key]}"]`);
    btn?.click();
  } else if (e.key === 'c' || e.key === 'C') {
    const modes = ['terrain', 'coverage', 'delta'];
    const cur = modes.indexOf(view.shadeMode);
    document.querySelector(`[data-shade="${modes[(cur + 1) % modes.length]}"]`)?.click();
  } else if (e.key === ' ') {
    e.preventDefault();
    view.animate = !view.animate;
    buildToggles();
  }
});
