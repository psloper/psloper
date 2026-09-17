// Exports, and the method/limits text that goes with every one of them.
//
// Any number that leaves this tool goes out with its provenance attached. A
// screening result that gets forwarded without its assumptions is worse than
// no result.

import { M_PER_FT } from './geo.js';
import { SEVERITY_LABELS } from './findings.js';

export const METHOD_HTML = `
<div class="warn-box">
  <strong>This is a first-order screening model, not a technical assessment.</strong>
  It is built to explore how the variables interact and to find the obvious problems
  early. It cannot support a planning submission, a safety case, or an objection.
  A formal assessment needs the radar operator's own validated model, the real
  radar parameters, real terrain data, and measured or modelled turbine radar
  cross-section at the relevant frequency and aspect angles.
</div>

<h3>What is computed from published results</h3>
<ul>
  <li><strong>Earth curvature and line of sight.</strong> Equivalent-earth method.
      Heights are reduced by <code>d²/(2·a<sub>e</sub>)</code> where
      <code>a<sub>e</sub> = k·R<sub>earth</sub></code>, so a straight line in the model
      (and in the 3D view) is a real ray. At the default <code>k = 4/3</code> this
      reproduces the familiar <code>d<sub>km</sub> = 4.12·√h<sub>m</sub></code> horizon
      rule, which the test suite checks.</li>
  <li><strong>Radar range equation.</strong> Monostatic point-target form:
      <span class="formula">Pr = Pt · G² · λ² · σ / ( (4π)³ · R⁴ · L )</span>
      Noise is <code>k·T₀·B·F</code> with <code>T₀ = 290 K</code>.</li>
  <li><strong>Detection threshold.</strong> Albersheim's closed-form approximation for
      the single-pulse SNR needed to reach a given P<sub>d</sub> at a given
      P<sub>fa</sub> after non-coherent integration, for a non-fluctuating target.
      Quoted validity is 0.1 ≤ P<sub>d</sub> ≤ 0.9 and 1e-7 ≤ P<sub>fa</sub> ≤ 1e-3;
      the tool warns when you leave that range. Target fluctuation is handled as a
      margin you set, not as a second model.</li>
  <li><strong>Diffraction.</strong> Single knife-edge, ITU-R P.526 form:
      <span class="formula">v = h · √( (2/λ) · (1/d₁ + 1/d₂) )
J(v) = 6.9 + 20·log₁₀( √((v−0.1)² + 1) + v − 0.1 )   dB,  v > −0.78</span>
      Two internal checks hold this honest: J(0) must be 6.02 dB (the textbook
      grazing value) and J(−0.78) must be exactly 0 dB. Both are in the test suite.</li>
  <li><strong>Doppler.</strong> <code>f_d = 2·v_r·f/c</code>. For a rotor the blade
      velocity is tangential, so the largest radial component over a revolution is
      <code>v_tip · sin θ</code>, where θ is the angle between the line of sight and
      the rotor axis. This is why wind direction changes the answer: a turbine facing
      the radar shows almost no blade Doppler, one presenting its rotor edge-on shows
      the full tip speed.</li>
  <li><strong>Blind speeds.</strong> <code>v_b = n·PRF·λ/2</code>, with reported
      velocity folded into the unambiguous interval.</li>
  <li><strong>Antenna pattern.</strong> Gaussian main beam
      (<code>−12·(θ/θ₃dB)²</code>, exactly −3 dB at half the 3 dB beamwidth) with
      cosecant-squared elevation shaping above the beam peak.</li>
</ul>

<h3>Engineering approximations made for this tool</h3>
<p>These are not published models. They are stated here so they can be argued with.</p>
<ul>
  <li><strong>Turbine as two scatterers.</strong> The tower and nacelle are treated as
      a stationary return that a clutter filter can cancel; the blades are treated as a
      moving return that it largely cannot. Real turbine returns are a time-varying
      signature with blade flash, hub lines and tower-blade interaction that this
      split does not reproduce.</li>
  <li><strong>Blade Doppler spectrum.</strong> Blade return power is taken as uniformly
      distributed in radial velocity between zero and the tip value. The real
      distribution is weighted by the RCS and chord distribution along the span.</li>
  <li><strong>Rotor as a partially filling screen.</strong> The swept disc is mostly
      empty air, so blockage is taken as the rotor solidity rather than treating the
      whole disc as opaque. Loss is <code>−20·log₁₀(1 − fill)</code>.</li>
  <li><strong>Narrow obstacle correction.</strong> The classical knife edge is
      infinitely wide. A turbine tower is not, so its knife-edge loss is scaled by the
      fraction of the first Fresnel zone the tower actually spans. This has the right
      limits at both ends but is not a validated model.</li>
  <li><strong>Range sidelobes.</strong> Contamination of neighbouring range cells uses a
      parametric skirt from a peak sidelobe level you set, not a real compression
      waveform.</li>
  <li><strong>Integration and clutter.</strong> Clutter is compared against the
      detection threshold as if it integrated like noise. Real clutter is correlated,
      so this is optimistic where clutter dominates.</li>
  <li><strong>Tracker.</strong> Two plots to initiate, three scans of coast. Real
      trackers are considerably more sophisticated, and a real system's plot extractor
      may reject or merge turbine plots before the tracker ever sees them.</li>
</ul>

<h3>Not modelled at all</h3>
<ul>
  <li>Ground-reflection multipath and lobing, which can move detection performance by
      many dB at low elevation and is a first-order effect for low targets.</li>
  <li>Secondary surveillance radar: reflections, garbling and false replies. This tool
      is primary radar only.</li>
  <li>Real terrain. The surface here is synthetic and controlled by the terrain panel.
      Masking conclusions from synthetic terrain mean nothing for a real site.</li>
  <li>Wind farm effects on communications, navigation aids, or seismic arrays.</li>
  <li>Aerodrome obstacle limitation surfaces and physical safeguarding.</li>
  <li>Weather radar product corruption beyond the generic clutter treatment.</li>
</ul>

<h3>Sources retrieved for this build</h3>
<p>Egress was restricted in the environment where this tool was written, so the
primary standards documents could not be fetched and read directly. The formulas
above are stated in their standard reference form and validated against values
that are independently known (6.02 dB at grazing incidence, 0 dB at the v = −0.78
cut-off, 13.1 dB required SNR for P<sub>d</sub> = 0.9 / P<sub>fa</sub> = 1e-6, the
4.12·√h horizon rule). What follows was confirmed at search-summary level only:</p>
<ul>
  <li>UK CAA <strong>CAP 764</strong>, <em>Policy and Guidelines on Wind Turbines</em>:
      30 km guide distance for assessing radar impact; 10 km for considering effects on
      secondary surveillance radar; and the statement that no 'standard' radar cross
      section can be identified for micro, medium or large turbines given the number of
      factors involved. The default RCS values in this tool are therefore starting
      points, not authority.</li>
  <li>Published measurement and simulation work puts turbine RCS across roughly
      20 to 45 dBsm at microwave frequencies, varying strongly with blade pitch, yaw
      orientation and rotation.</li>
  <li>Reported turbine blade tip speeds of roughly 70 to 105 m/s for machines in
      current service, which is what puts blade Doppler inside a conventional clutter
      filter's pass band.</li>
  <li>Mitigation practice described in the literature and by industry: blanking,
      non-automatic initiation zones, in-fill radar, post-detection range/azimuth
      gating, and advanced signal processing. CAA CAP 670 SUR 13 is cited by CAP 764 as
      holding the detailed analysis; that document was not retrieved.</li>
</ul>
<p><strong>Verify every one of these against the current edition before citing
them.</strong> None was read in full.</p>
`;

// ------------------------------------------------------------------ helpers

function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const num = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '');
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

// ------------------------------------------------------------------ exports

export function exportTurbinesCsv(result) {
  const rows = [[
    'id', 'east_m', 'north_m', 'ground_amsl_m', 'hub_height_m', 'rotor_diameter_m', 'rpm',
    'ground_range_m', 'slant_range_m', 'bearing_deg', 'elevation_deg',
    'visibility', 'terrain_loss_two_way_db',
    'rotor_aspect_deg', 'tip_speed_ms', 'max_radial_ms', 'doppler_hz',
    'folded_velocity_ms', 'apparent_speed_kt', 'clutter_pass_fraction',
    'raw_rcs_dbsm', 'effective_rcs_dbsm', 'return_snr_db', 'above_threshold',
    'reaches_display', 'saturating',
  ]];
  for (const t of result.turbineResults) {
    rows.push([
      t.turbine.id, num(t.turbine.east, 0), num(t.turbine.north, 0), num(t.turbine.groundM, 1),
      num(t.turbine.hubHeightM, 1), num(t.turbine.rotorDiameterM, 1), num(t.rpm, 2),
      num(t.hub.ground, 0), num(t.hub.slant, 0), num(t.hub.bearing, 2), num(t.hub.elevationDeg, 3),
      t.visibility, num(t.terrainLossHubDb, 2),
      num(t.aspectDeg, 1), num(t.vTipMs, 1), num(t.vRadMaxMs, 1), num(t.fdMaxHz, 1),
      num(t.foldedMs, 2), num(t.apparentSpeedKt, 1), num(t.passFraction, 4),
      num(t.rawRcsDbsm, 2), num(t.effectiveRcsDbsm, 2), num(t.snrEffDb, 2),
      t.falsePlot ? 'yes' : 'no', t.plotted ? 'yes' : 'no', t.saturating ? 'yes' : 'no',
    ]);
  }
  download(`turbines-${stamp()}.csv`, csv(rows), 'text/csv');
}

export function exportTrackCsv(result) {
  const rows = [[
    'time_s', 'along_track_m', 'east_m', 'north_m', 'altitude_ft', 'heading_deg',
    'ground_range_m', 'slant_range_m', 'bearing_deg', 'elevation_deg',
    'terrain_loss_db', 'turbine_shadow_loss_db', 'snr_db', 'sinr_db', 'scr_db',
    'clutter_cost_db', 'radial_velocity_ms', 'mti_response_db',
    'margin_db', 'status', 'blanked', 'in_naiz', 'plot', 'tracked', 'recovered_by_infill',
  ]];
  for (const p of result.points) {
    rows.push([
      num(p.timeS, 1), num(p.alongM, 0), num(p.east, 0), num(p.north, 0),
      num(p.amsl / M_PER_FT, 0), num(p.headingDeg, 1),
      num(p.geom.ground, 0), num(p.geom.slant, 0), num(p.geom.bearing, 2), num(p.geom.elevationDeg, 3),
      num(p.terrainLossDb, 2), num(p.shadowLossDb, 2), num(p.snrDb, 2), num(p.sinrDb, 2),
      Number.isFinite(p.scrDb) ? num(p.scrDb, 2) : 'inf',
      num(p.clutterCostDb, 2), num(p.radialMs, 1), num(p.targetMtiDb, 2),
      num(p.effectiveMarginDb, 2), p.status,
      p.blanked ? 'yes' : 'no', p.inNaiz ? 'yes' : 'no',
      p.plot ? 'yes' : 'no', p.tracked ? 'yes' : 'no', p.recoveredByInfill ? 'yes' : 'no',
    ]);
  }
  download(`flight-track-${stamp()}.csv`, csv(rows), 'text/csv');
}

export function exportScenario(scenario) {
  download(`scenario-${stamp()}.json`, JSON.stringify(scenario, null, 2), 'application/json');
}

// Split out from exportJson so the payload can be built and checked without a
// browser. Everything that leaves this tool goes through here or
// buildReportMarkdown, so both are worth testing.
export function buildAssessmentPayload(result) {
  return {
    generated: new Date().toISOString(),
    tool: 'Wind Farm / Radar Interference Assessor',
    disclaimer: 'First-order screening model. Not a technical or safety assessment. '
      + 'See the method and limits section before using any figure.',
    scenario: result.scenario,
    derived: {
      effectiveEarthRadiusM: result.ae,
      lambdaM: result.radar.lambdaM,
      requiredSnrDb: result.radar.requiredSnrDb,
      albersheimWithinValidity: result.radar.albersheimValid,
      pulsesPerScan: result.radar.pulsesPerScan,
      rangeResolutionM: result.radar.rangeResolutionM,
      unambiguousRangeM: result.radar.unambiguousRangeM,
      firstBlindSpeedMs: result.radar.firstBlindSpeedMs,
      surfaceHorizonM: result.radar.horizonM,
      farFieldM: result.radar.farFieldM,
      noisePowerDbw: 10 * Math.log10(result.radar.noiseW),
    },
    summary: {
      ...result.summary,
      worstPoint: undefined, worstClutter: undefined, worstShadow: undefined,
      gapStart: undefined, gapEnd: undefined,
    },
    findings: result.findings.map((f) => ({
      id: f.id, severity: f.severity, basis: f.basis,
      title: f.title, detail: f.detail, metrics: f.metrics, source: f.source,
    })),
    turbines: result.turbineResults.map((t) => ({
      id: t.turbine.id,
      position: { east: t.turbine.east, north: t.turbine.north, groundAmslM: t.turbine.groundM },
      hubHeightM: t.turbine.hubHeightM,
      rotorDiameterM: t.turbine.rotorDiameterM,
      rpm: t.rpm,
      groundRangeM: t.hub.ground, slantRangeM: t.hub.slant,
      bearingDeg: t.hub.bearing, elevationDeg: t.hub.elevationDeg,
      visibility: t.visibility, terrainLossTwoWayDb: t.terrainLossHubDb,
      rotorAspectDeg: t.aspectDeg, tipSpeedMs: t.vTipMs, maxRadialMs: t.vRadMaxMs,
      dopplerHz: t.fdMaxHz, foldedVelocityMs: t.foldedMs, apparentSpeedKt: t.apparentSpeedKt,
      clutterPassFraction: t.passFraction,
      rawRcsDbsm: t.rawRcsDbsm, effectiveRcsDbsm: t.effectiveRcsDbsm,
      returnSnrDb: t.snrEffDb, aboveThreshold: t.falsePlot,
      blankedFromDisplay: !!t.blanked, reachesDisplay: !!t.plotted, saturating: t.saturating,
    })),
    track: result.points.map((p) => ({
      timeS: p.timeS, altitudeFt: p.amsl / M_PER_FT,
      groundRangeM: p.geom.ground, bearingDeg: p.geom.bearing, elevationDeg: p.geom.elevationDeg,
      snrDb: p.snrDb, sinrDb: p.sinrDb, marginDb: p.effectiveMarginDb,
      terrainLossDb: p.terrainLossDb, shadowLossDb: p.shadowLossDb,
      status: p.status, plot: p.plot, tracked: p.tracked,
      blanked: p.blanked, recoveredByInfill: !!p.recoveredByInfill,
    })),
    mitigationZones: { blanking: result.blankZone, nonAutoInitiation: result.naizZone },
  };
}

export function exportJson(result) {
  download(`assessment-${stamp()}.json`,
    JSON.stringify(buildAssessmentPayload(result), null, 2), 'application/json');
}

export function buildReportMarkdown(result, delta) {
  const s = result.scenario;
  const r = result.radar;
  const sum = result.summary;
  const L = [];
  const P = (x) => L.push(x);

  P(`# Wind farm / radar screening assessment`);
  P('');
  P(`**${s.name}**  `);
  P(`Generated ${new Date().toISOString()}`);
  P('');
  P('> **First-order screening model. Not a technical or safety assessment.**  ');
  P('> Figures below come from closed-form approximations and synthetic terrain. They are');
  P('> for exploring the problem, not for submission. See "Method and limits" at the end.');
  P('');

  P('## Headline');
  P('');
  const top = result.findings.filter((f) => f.severity === 'critical' || f.severity === 'major');
  if (top.length) {
    for (const f of top) P(`- **${SEVERITY_LABELS[f.severity]}**: ${f.title}`);
  } else {
    P('- No critical or major issues found in this configuration.');
  }
  P('');

  P('## Configuration');
  P('');
  P('| Item | Value |');
  P('| --- | --- |');
  P(`| Radar | ${r.label || r.preset} |`);
  P(`| Frequency | ${(r.freqHz / 1e9).toFixed(3)} GHz (λ = ${(r.lambdaM * 100).toFixed(1)} cm) |`);
  P(`| Peak power / gain | ${(r.peakPowerW / 1000).toFixed(1)} kW / ${r.gainDbi} dBi |`);
  P(`| Beamwidths (az × el) | ${r.azBeamwidthDeg}° × ${r.elBeamwidthDeg}°, peak at ${r.elPeakDeg}° |`);
  P(`| PRF / scan rate | ${r.prfHz} Hz / ${r.rpm} rpm |`);
  P(`| Antenna height | ${r.heightAgl} m AGL (${r.amslM.toFixed(0)} m AMSL) |`);
  P(`| Detection criterion | Pd ${r.pd}, Pfa ${r.pfa.toExponential(0)}, +${r.fluctuationMarginDb} dB fluctuation margin |`);
  P(`| Required single-pulse SNR | ${r.requiredSnrDb.toFixed(1)} dB (${r.pulsesPerScan.toFixed(0)} pulses per scan) |`);
  P(`| Range resolution | ${r.rangeResolutionM.toFixed(0)} m |`);
  P(`| Unambiguous range | ${(r.unambiguousRangeM / 1000).toFixed(1)} km |`);
  P(`| First blind speed | ${r.firstBlindSpeedMs.toFixed(1)} m/s (${(r.firstBlindSpeedMs / 0.514444).toFixed(0)} kt) |`);
  P(`| Clutter filter | ±${r.mtiNotchMs} m/s notch, ${r.mtiRejectionDb} dB rejection |`);
  P(`| k-factor | ${s.environment.kFactor.toFixed(3)} (surface horizon ${(r.horizonM / 1000).toFixed(1)} km) |`);
  P('');
  P(`| Wind farm | Value |`);
  P('| --- | --- |');
  P(`| Turbines | ${sum.turbineCount} (${s.farm.layout} layout) |`);
  P(`| Machine | ${s.farm.preset}: hub ${s.farm.hubHeightM} m, rotor ${s.farm.rotorDiameterM} m, ${s.farm.rpm} rpm |`);
  P(`| Tip height | ${(s.farm.hubHeightM + s.farm.rotorDiameterM / 2).toFixed(0)} m AGL |`);
  P(`| Assumed RCS | tower ${s.farm.towerRcsDbsm} dBsm, blades ${s.farm.bladeRcsDbsm} dBsm (NOT authoritative) |`);
  P(`| Distance from radar | ${(sum.nearestTurbineM / 1000).toFixed(2)} to ${(sum.farthestTurbineM / 1000).toFixed(2)} km |`);
  P(`| Wind direction | from ${s.farm.windFromDeg}° |`);
  P('');
  P(`| Reference target | Value |`);
  P('| --- | --- |');
  P(`| Type | ${s.target.preset} |`);
  P(`| RCS | ${s.target.rcsDbsm} dBsm |`);
  P(`| Profile | ${s.target.profile}, ${s.target.speedKt} kt, ${s.target.altitudeFt} ft |`);
  P('');

  P('## Results');
  P('');
  P('| Metric | Value |');
  P('| --- | --- |');
  P(`| Turbines in line of sight | ${sum.visibleCount} of ${sum.turbineCount} |`);
  P(`| Turbine returns above the detection threshold | ${sum.falsePlotCount} |`);
  P(`| Turbine plots reaching the display | ${sum.displayedPlotCount}`
    + `${sum.suppressedPlotCount ? ` (${sum.suppressedPlotCount} suppressed by blanking)` : ''} |`);
  P(`| Peak blade Doppler | ${sum.maxDopplerHz.toFixed(0)} Hz |`);
  P(`| Worst apparent (folded) speed | ${sum.maxApparentSpeedKt.toFixed(0)} kt |`);
  P(`| Strongest turbine return | ${sum.maxTurbineSnrDb.toFixed(1)} dB SNR |`);
  P(`| Track samples without a track | ${sum.untrackedCount} of ${sum.trackPoints} |`);
  P(`| Longest track gap | ${sum.longestGapSeconds.toFixed(0)} s (${(sum.longestGapMetres / 1000).toFixed(1)} km) |`);
  if (sum.blankedAreaKm2) P(`| Coverage removed by blanking | ${sum.blankedAreaKm2.toFixed(0)} km² |`);
  if (sum.naizAreaKm2) P(`| Non-auto-initiation zone area | ${sum.naizAreaKm2.toFixed(0)} km² |`);
  if (sum.recoveredCount) P(`| Samples recovered by in-fill | ${sum.recoveredCount} |`);
  P('');

  P('## Findings');
  P('');
  for (const f of result.findings) {
    P(`### [${SEVERITY_LABELS[f.severity]}] ${f.title}`);
    P('');
    P(f.detail);
    P('');
    if (f.metrics && Object.keys(f.metrics).length) {
      P('| | |');
      P('| --- | --- |');
      for (const [k, v] of Object.entries(f.metrics)) P(`| ${k} | ${v} |`);
      P('');
    }
    P(`*Basis: ${f.basis}.*`);
    if (f.source) P(`*Source: ${f.source}*`);
    P('');
  }

  if (delta) {
    P('## Effect of the selected mitigation');
    P('');
    P('| Metric | Without mitigation | With mitigation | Change |');
    P('| --- | --- | --- | --- |');
    for (const row of delta) {
      P(`| ${row.label} | ${row.before} | ${row.after} | ${row.change} |`);
    }
    P('');
  }

  P('## Turbine detail');
  P('');
  P('| ID | Range km | Brg | Sight | Aspect | Tip m/s | Doppler Hz | Folded kt | Eff RCS dBsm | Return dB | Plot |');
  P('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of result.turbineResults) {
    P(`| ${t.turbine.id} | ${(t.hub.ground / 1000).toFixed(2)} | ${t.hub.bearing.toFixed(0)}° | `
      + `${t.visibility} | ${t.aspectDeg.toFixed(0)}° | ${t.vTipMs.toFixed(0)} | `
      + `${t.fdMaxHz.toFixed(0)} | ${t.apparentSpeedKt.toFixed(0)} | ${t.effectiveRcsDbsm.toFixed(1)} | `
      + `${t.snrEffDb.toFixed(1)} | ${t.falsePlot ? 'YES' : 'no'} |`);
  }
  P('');

  P('## Method and limits');
  P('');
  P(htmlToMarkdown(METHOD_HTML));
  P('');
  return L.join('\n');
}

function htmlToMarkdown(html) {
  return html
    .replace(/<div class="warn-box">([\s\S]*?)<\/div>/g, (_, i) => `> ${i.trim().replace(/\s+/g, ' ')}\n`)
    .replace(/<h3>(.*?)<\/h3>/g, '\n### $1\n')
    .replace(/<span class="formula">([\s\S]*?)<\/span>/g, (_, i) => `\n\`\`\`\n${i.trim()}\n\`\`\`\n`)
    .replace(/<li>([\s\S]*?)<\/li>/g, (_, i) => `- ${i.trim().replace(/\s+/g, ' ')}`)
    .replace(/<\/?(ul|p)>/g, '\n')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<sub>(.*?)<\/sub>/g, '_$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function exportReport(result, delta) {
  download(`assessment-report-${stamp()}.md`, buildReportMarkdown(result, delta), 'text/markdown');
}

// ------------------------------------------------------- mitigation delta

export function buildDelta(before, after) {
  const fmt = (v, unit = '', d = 0) => `${Number.isFinite(v) ? v.toFixed(d) : 'n/a'}${unit}`;
  const rows = [];
  const push = (label, b, a, unit, d, lowerIsBetter = true) => {
    const change = a - b;
    const dir = Math.abs(change) < (d ? Math.pow(10, -d) / 2 : 0.5) ? 'same'
      : (lowerIsBetter ? (change < 0 ? 'better' : 'worse') : (change > 0 ? 'better' : 'worse'));
    rows.push({
      label,
      before: fmt(b, unit, d), after: fmt(a, unit, d),
      change: `${change > 0 ? '+' : ''}${fmt(change, unit, d)}`,
      dir,
    });
  };

  push('Turbine plots reaching the display', before.summary.displayedPlotCount, after.summary.displayedPlotCount, '', 0);
  push('Turbine returns above threshold', before.summary.falsePlotCount, after.summary.falsePlotCount, '', 0);
  push('Strongest turbine return', before.summary.maxTurbineSnrDb, after.summary.maxTurbineSnrDb, ' dB', 1);
  push('Track samples without a track', before.summary.untrackedCount, after.summary.untrackedCount, '', 0);
  push('Longest track gap', before.summary.longestGapSeconds, after.summary.longestGapSeconds, ' s', 0);
  push('Track samples below threshold', before.summary.lostCount, after.summary.lostCount, '', 0);
  push('Worst clutter cost on track',
    before.summary.worstClutter ? before.summary.worstClutter.clutterCostDb : 0,
    after.summary.worstClutter ? after.summary.worstClutter.clutterCostDb : 0, ' dB', 1);
  push('Coverage removed by mitigation', before.summary.blankedAreaKm2, after.summary.blankedAreaKm2, ' km²', 0);
  push('Non-auto-initiation zone', before.summary.naizAreaKm2, after.summary.naizAreaKm2, ' km²', 0);
  return rows;
}
