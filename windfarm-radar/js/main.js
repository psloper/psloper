// Application entry point: wires the scenario, the assessment engine, the 3D
// view, the two flat displays and the results panel into one running tool.

import { analyse } from './analysis.js';
import {
  defaultScenario, loadScenario, saveScenario, mergeDeep,
  applyRadarPreset, applyTurbinePreset, applyTargetPreset, applyTerrainPreset,
} from './model.js';
import { SceneView } from './scene.js';
import { PpiDisplay, ProfileDisplay } from './displays.js';
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
};

const view = new SceneView(el.canvas3d);
const ppi = new PpiDisplay(el.ppi);
const profile = new ProfileDisplay(el.profile);

view.onHover = (tr) => {
  renderReadout(el.readout, tr, result);
  el.turbineTable.querySelectorAll('tbody tr').forEach((row) => {
    row.classList.toggle('is-hot', !!tr && row.dataset.id === tr.turbine.id);
  });
};

// ------------------------------------------------------------- analysis run

function run(skipCoverage) {
  const t0 = performance.now();
  try {
    result = analyse(scenario, { skipCoverage });
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
  renderFindings(el.findings, result.findings);
  renderTurbineTable(el.turbineTable, result, (id) => view.highlight(id));
  renderVerdict(el.verdictChip, el.verdictText, result);
  renderLegend(el.legend, view.shadeMode, result);
  updateNotes(noteEls, result);

  el.turbineCount.textContent = `${result.turbineResults.length}`;
  el.profileBearing.textContent = `${profile.activeBearing.toFixed(0).padStart(3, '0')}°`;
  el.ppiNote.textContent = `${result.radar.rpm} rpm · ${(result.radar.rangeResolutionM).toFixed(0)} m cells`;
  el.scalebar.textContent = `rings ${(view.ringStepM / 1000).toFixed(0)} km`
    + (view.vExag !== 1 ? ` · vertical ×${view.vExag} (heights exaggerated, geometry preserved)` : ' · true scale');

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
  updateNotes(noteEls, result);
}

function applyPreset(kind, key) {
  if (kind === 'radar') scenario = applyRadarPreset(scenario, key);
  else if (kind === 'turbine') scenario = applyTurbinePreset(scenario, key);
  else if (kind === 'target') scenario = applyTargetPreset(scenario, key);
  else if (kind === 'terrain') scenario = applyTerrainPreset(scenario, key);
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
      el.scalebar.textContent = `rings ${(view.ringStepM / 1000).toFixed(0)} km`
        + (view.vExag !== 1 ? ` · vertical ×${view.vExag} (heights exaggerated, geometry preserved)` : ' · true scale');
    }
  });
  vx.append(document.createTextNode('Vertical'), slider, out);
  el.toggles.append(vx);
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

$('#btn-export').addEventListener('click', () => $('#dlg-export').showModal());

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

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Discard this scenario and return to the defaults?')) return;
  scenario = defaultScenario();
  profile.bearingDeg = null;
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
