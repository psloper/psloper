// Application entry point: wires the scenario, the assessment engine, the 3D
// view, the two flat displays and the results panel into one running tool.

import { analyse, analyseWindRose } from './analysis.js';
import {
  defaultScenario, loadScenario, saveScenario, mergeDeep,
  applyRadarPreset, applyTurbinePreset, applyTargetPreset, applyTerrainPreset,
} from './model.js';
import { SceneView } from './scene.js';
import { PpiDisplay, ProfileDisplay, WindRoseDisplay } from './displays.js';
import { deriveWindRoseFindings } from './findings.js';
import { REFERENCES, STATUS_LABELS, statusCounts } from './references.js';
import { WIND_ROSE_PRESETS } from './wind.js';
import { SWEEP_PARAMS, SWEEP_METRICS, runSweep, sweepToCsv } from './sweep.js';
import { drawSweep, cellAt, sweepToPng, sweepToSvg } from './heatmap.js';
import {
  readTable, readElevationFile, parseTurbineRows, buildImportedTerrain,
  FREE_ELEVATION_SOURCES,
} from './importers.js';
import {
  buildRail, updateNotes, renderMetrics, renderFindings, renderTurbineTable,
  renderVerdict, renderReadout, renderLegend,
} from './ui.js';
import {
  METHOD_HTML, buildDelta, buildExport, downloadExport, downloadsAvailable,
} from './report.js';

// ------------------------------------------------------------------- state

let scenario = loadScenario() || defaultScenario();
let result = null;
let noteEls = {};
let activeTab = 'radar';
let fullTimer = null;
let importedTerrain = null;     // held outside the scenario: a raster is not a setting
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
      ? ` \u00b7 vertical \u00d7${view.vExag} (heights exaggerated, geometry preserved)`
      : ' \u00b7 true scale')
    + (view.girthExag > 1.5
      ? ` \u00b7 girth \u00d7${view.girthExag} (every structural width; spans are true)` : '');
}

function run(skipCoverage) {
  const t0 = performance.now();
  try {
    result = analyse(scenario, { skipCoverage, importedTerrain });
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

function rebuildRail() {
  noteEls = buildRail(el.rail, activeTab, scenario, schedule, applyPreset);
  updateNotes(noteEls, result, { importedTerrain, roseResult });
  el.rail.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => railAction(btn.dataset.action, btn));
  });
}

// A control that writes several scenario fields at once asks for the rail to be
// rebuilt, so the other controls stop showing stale values.
el.rail.addEventListener('rail-rebuild', () => rebuildRail());

// ------------------------------------------------------------ file imports

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
  else if (id === 'import-terrain') importTerrain();
  else if (id === 'clear-imports') clearImports();
  else if (id === 'run-rose') runRoseSweep(btn);
}

function applyPreset(kind, key) {
  if (kind === 'radar') scenario = applyRadarPreset(scenario, key);
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
      <strong>${counts.read || 0} of ${REFERENCES.length} entries were read in full.</strong>
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
    if (btn.dataset.mode === 'download') {
      downloadExport(kind, result, currentDelta());
      return;
    }
    const built = buildExport(kind, result, currentDelta());
    if (!built) return;
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
