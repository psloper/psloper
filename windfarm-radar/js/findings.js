// Turns the numbers into a ranked list of issues.
//
// Every finding carries a `basis` so it is obvious where it came from:
//   computed  - falls directly out of the model's physics
//   screening - a threshold or distance guide you or a published guide set
//   check     - something this tool cannot decide, raised for you to confirm
//
// `source` names a published document where one applies. Where a figure could
// not be verified against a primary source from this environment, it says so
// rather than implying more confidence than exists.

import { M_PER_FT, M_PER_NM, RAD } from './geo.js';
import { linToDb, dbToLin } from './rf.js';

const SEV_ORDER = { critical: 0, major: 1, minor: 2, info: 3 };

const km = (m) => `${(m / 1000).toFixed(1)} km`;
const nm = (m) => `${(m / M_PER_NM).toFixed(1)} NM`;
const pct = (f) => `${(f * 100).toFixed(0)}%`;
const db = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)} dB`;

export function deriveFindings(scenario, radar, turbineResults, points, summary, blankZone, naizZone, infill) {
  const f = [];
  const add = (x) => f.push(x);
  const mit = scenario.mitigation;

  // ------------------------------------------------- line of sight to the farm
  if (summary.visibleCount > 0) {
    const worst = turbineResults
      .filter((t) => t.visibility !== 'masked')
      .sort((a, b) => b.snrEffDb - a.snrEffDb)[0];
    add({
      id: 'los',
      severity: summary.visibleCount === summary.turbineCount ? 'major' : 'minor',
      title: `${summary.visibleCount} of ${summary.turbineCount} turbines are in radar line of sight`,
      detail: `Nearest turbine ${km(summary.nearestTurbineM)} (${nm(summary.nearestTurbineM)}) from the radar. `
        + `Strongest return is ${worst.turbine.id} at ${worst.snrEffDb.toFixed(1)} dB SNR after clutter filtering, `
        + `against a ${radar.requiredSnrDb.toFixed(1)} dB detection threshold.`,
      basis: 'computed',
      metrics: {
        'Visible turbines': `${summary.visibleCount} / ${summary.turbineCount}`,
        'Terrain-masked': `${summary.maskedCount}`,
        'Nearest turbine': km(summary.nearestTurbineM),
        'Strongest return': `${worst.snrEffDb.toFixed(1)} dB SNR (${worst.turbine.id})`,
      },
    });
  } else {
    add({
      id: 'los-clear',
      severity: 'info',
      title: 'No turbine is in radar line of sight',
      detail: 'Every turbine is screened by terrain or falls below the radio horizon at the modelled '
        + `k-factor of ${scenario.environment.kFactor.toFixed(2)}. Terrain masking is the one mitigation that `
        + 'costs the radar nothing, but it is sensitive to the refraction assumption: re-check at k = 1.0 '
        + 'and at sub-refractive conditions before relying on it.',
      basis: 'computed',
      metrics: { 'Radio horizon': km(radar.horizonM), 'k-factor': scenario.environment.kFactor.toFixed(3) },
    });
  }

  // ------------------------------------------------------- false plots / Doppler
  if (summary.falsePlotCount > 0) {
    const worst = turbineResults.filter((t) => t.falsePlot)
      .sort((a, b) => b.snrEffDb - a.snrEffDb)[0];
    add({
      id: 'false-plots',
      severity: 'critical',
      title: `${summary.falsePlotCount} turbines return above the detection threshold after clutter filtering`,
      detail: `Blade rotation puts the return outside the zero-Doppler notch, so the clutter filter does not `
        + `remove it. Worst case ${worst.turbine.id}: tip speed ${worst.vTipMs.toFixed(0)} m/s, rotor `
        + `${worst.aspectDeg.toFixed(0)}° off face-on to the radar, giving a peak radial velocity of `
        + `${worst.vRadMaxMs.toFixed(0)} m/s and a Doppler shift of ${worst.fdMaxHz.toFixed(0)} Hz. `
        + `${(worst.passFraction * 100).toFixed(0)}% of the blade return power falls in the filter pass band.`,
      basis: 'computed',
      metrics: {
        'Turbines above threshold': `${summary.falsePlotCount}`,
        'Reaching the display': `${summary.displayedPlotCount}`
          + (summary.suppressedPlotCount ? ` (${summary.suppressedPlotCount} blanked)` : ''),
        'Peak Doppler': `${summary.maxDopplerHz.toFixed(0)} Hz`,
        'Peak blade return': `${summary.maxTurbineSnrDb.toFixed(1)} dB SNR`,
        'MTI notch': `±${radar.mtiNotchMs} m/s`,
      },
    });
    if (summary.suppressedPlotCount) {
      add({
        id: 'plots-suppressed',
        severity: 'minor',
        title: `${summary.suppressedPlotCount} of those plots are hidden by blanking, not removed`,
        detail: 'The returns are still above the detection threshold and still arriving. Blanking '
          + 'discards the cells they land in, along with anything real in the same cells. If the '
          + 'blanking is ever lifted, narrowed, or its sector drifts relative to the farm, the plots '
          + 'come straight back.',
        basis: 'computed',
        metrics: {
          'Above threshold': `${summary.falsePlotCount}`,
          'Suppressed by blanking': `${summary.suppressedPlotCount}`,
          'Still reaching the display': `${summary.displayedPlotCount}`,
        },
      });
    }
  }

  // ------------------------------------------------------- Doppler ambiguity
  const aliasing = turbineResults.filter(
    (t) => t.falsePlot && t.apparentSpeedKt > 40 && t.apparentSpeedKt < 400);
  if (aliasing.length) {
    const worst = aliasing.sort((a, b) => b.snrEffDb - a.snrEffDb)[0];
    add({
      id: 'doppler-alias',
      severity: 'critical',
      title: `Blade returns fold to aircraft-like radial speeds (up to ${summary.maxApparentSpeedKt.toFixed(0)} kt)`,
      detail: `At ${(radar.prfHz).toFixed(0)} Hz PRF the first blind speed is `
        + `${radar.firstBlindSpeedMs.toFixed(0)} m/s (${(radar.firstBlindSpeedMs / 0.514444).toFixed(0)} kt), so blade `
        + `velocities fold into the unambiguous interval. ${worst.turbine.id} reports an apparent radial speed of `
        + `${worst.apparentSpeedKt.toFixed(0)} kt. A tracker has no velocity cue to reject these against a real aircraft.`,
      basis: 'computed',
      metrics: {
        'Affected turbines': `${aliasing.length}`,
        'First blind speed': `${radar.firstBlindSpeedMs.toFixed(1)} m/s`,
        'Worst apparent speed': `${worst.apparentSpeedKt.toFixed(0)} kt`,
      },
    });
  }

  // ------------------------------------------------------------- saturation
  if (summary.saturatingCount > 0) {
    const worst = turbineResults.filter((t) => t.saturating)
      .sort((a, b) => b.snrRawDb - a.snrRawDb)[0];
    add({
      id: 'saturation',
      severity: 'major',
      title: `${summary.saturatingCount} turbines return above the modelled receiver dynamic range`,
      detail: `${worst.turbine.id} presents ${worst.snrRawDb.toFixed(0)} dB of raw return against a `
        + `${radar.dynamicRangeDb} dB dynamic range. A saturated receiver loses linearity, which degrades clutter `
        + 'cancellation across the whole range cell, not just at the turbine. Confirm the real receiver dynamic '
        + 'range and STC law with the radar operator.',
      basis: 'screening',
      metrics: {
        'Worst raw return': `${worst.snrRawDb.toFixed(0)} dB SNR`,
        'Modelled dynamic range': `${radar.dynamicRangeDb} dB`,
      },
    });
  }

  // ---------------------------------------------------------- track integrity
  if (summary.untrackedCount > 0) {
    const severity = summary.untrackedFraction > 0.25 ? 'critical'
      : summary.untrackedFraction > 0.05 ? 'major' : 'minor';
    const gapDetail = summary.longestGapPoints > 0
      ? ` The longest continuous gap is ${summary.longestGapSeconds.toFixed(0)} s `
        + `(${km(summary.longestGapMetres)} of track).`
      : '';
    add({
      id: 'track-gap',
      severity,
      title: `Target track is not held for ${pct(summary.untrackedFraction)} of the modelled flight`,
      detail: `${summary.untrackedCount} of ${summary.trackPoints} samples inside cover have no track.`
        + gapDetail
        + (summary.blankedCount ? ` ${summary.blankedCount} samples are inside a blanked sector.` : '')
        + (summary.lostCount ? ` ${summary.lostCount} samples fall below the detection threshold.` : ''),
      basis: 'computed',
      metrics: {
        'Samples without track': `${summary.untrackedCount} / ${summary.trackPoints}`,
        'Longest gap': `${summary.longestGapSeconds.toFixed(0)} s`,
        'Below threshold': `${summary.lostCount}`,
        'Blanked': `${summary.blankedCount}`,
      },
    });
  } else if (summary.trackPoints > 0) {
    add({
      id: 'track-held',
      severity: 'info',
      title: 'Target track is held for the whole modelled flight',
      detail: `Worst detection margin along the track is ${db(summary.worstPoint ? summary.worstPoint.effectiveMarginDb : 0)} `
        + `relative to the ${radar.requiredSnrDb.toFixed(1)} dB threshold.`,
      basis: 'computed',
      metrics: {
        'Worst margin': summary.worstPoint ? db(summary.worstPoint.effectiveMarginDb) : 'n/a',
        'Marginal samples': `${summary.marginalCount}`,
      },
    });
  }

  // ------------------------------------------------------------ clutter cost
  if (summary.worstClutter && summary.worstClutter.clutterCostDb > 1) {
    const w = summary.worstClutter;
    const top = w.clutterContributors[0];
    add({
      id: 'desense',
      severity: w.clutterCostDb > 10 ? 'major' : 'minor',
      title: `Turbine clutter costs up to ${w.clutterCostDb.toFixed(1)} dB of detection margin on the track`,
      detail: `Worst at ${km(w.geom.ground)} range, ${w.geom.bearing.toFixed(0)}° bearing, `
        + `${(w.amsl / M_PER_FT).toFixed(0)} ft: signal-to-clutter ${w.scrDb.toFixed(1)} dB`
        + (top ? `, dominated by ${top.id} at ${Math.abs(top.dR).toFixed(0)} m range offset and `
          + `${Math.abs(top.dAz).toFixed(2)}° in azimuth` : '')
        + `. This is the desensitisation region: reduced probability of detection over and around the farm, `
        + 'not only directly behind it.',
      basis: 'computed',
      metrics: {
        'Worst clutter cost': db(-w.clutterCostDb),
        'Worst signal-to-clutter': `${w.scrDb.toFixed(1)} dB`,
        'Range sidelobe floor': `${radar.rangeSidelobeDb} dB`,
      },
    });
  }

  // ----------------------------------------------------------- shadow effects
  if (summary.worstShadow && summary.worstShadow.shadowLossDb > 0.5) {
    const w = summary.worstShadow;
    add({
      id: 'shadow',
      severity: w.shadowLossDb > 6 ? 'major' : 'minor',
      title: `Up to ${w.shadowLossDb.toFixed(1)} dB two-way shadowing through the array`,
      detail: `${w.shadowContributors.length} turbines sit on the radar-to-target path at the worst point `
        + `(${km(w.geom.ground)}, ${w.geom.bearing.toFixed(0)}°). Shadowing accumulates through a deep array, `
        + 'so turbine rows aligned along the radar bearing are worse than rows across it.',
      basis: 'computed',
      metrics: {
        'Worst two-way shadow loss': `${w.shadowLossDb.toFixed(1)} dB`,
        'Turbines on path': `${w.shadowContributors.length}`,
      },
    });
  }

  // ------------------------------------------------ mitigation side effects
  if (blankZone) {
    add({
      id: 'blanking-hole',
      severity: summary.blankedCount > 0 ? 'major' : 'minor',
      title: `Blanking removes ${summary.blankedAreaKm2.toFixed(0)} km² of surveillance coverage`,
      detail: `Sector ${blankZone.centreDeg.toFixed(0)}° ± ${blankZone.halfWidthDeg.toFixed(1)}°, `
        + `${km(blankZone.rangeMinM)} to ${km(blankZone.rangeMaxM)}. Blanking suppresses the turbine returns and `
        + 'every real target in the same volume, at every altitude. It trades a false-plot problem for a '
        + 'coverage hole, and the hole has to be acceptable operationally or filled by another sensor.'
        + (summary.blankedCount ? ` The modelled flight spends ${summary.blankedCount} samples inside it.` : ''),
      basis: 'computed',
      metrics: {
        'Blanked area': `${summary.blankedAreaKm2.toFixed(0)} km²`,
        'Track samples lost to blanking': `${summary.blankedCount}`,
      },
    });
  }

  if (naizZone) {
    const blocked = points.filter((p) => p.initiationBlocked).length;
    add({
      id: 'naiz',
      severity: blocked > 0 ? 'major' : 'info',
      title: blocked > 0
        ? `Non-auto-initiation zone prevents track start on ${blocked} samples`
        : 'Non-auto-initiation zone active, no track starts blocked on this flight',
      detail: 'Inside the zone the tracker will not start a new track, though an established track coasts '
        + 'through. An aircraft that first appears inside the zone, for example departing an airfield under '
        + 'the farm or a target emerging from terrain masking, will not be tracked automatically.'
        + ` Zone area ${summary.naizAreaKm2.toFixed(0)} km².`,
      basis: 'computed',
      metrics: {
        'Zone area': `${summary.naizAreaKm2.toFixed(0)} km²`,
        'Blocked initiations': `${blocked}`,
      },
    });
  }

  if (infill) {
    add({
      id: 'infill',
      severity: summary.recoveredCount > 0 ? 'info' : 'minor',
      title: summary.recoveredCount > 0
        ? `In-fill radar recovers ${summary.recoveredCount} track samples the primary loses`
        : 'In-fill radar adds no recovery on this flight',
      detail: `In-fill sited ${km(mit.infill.rangeM)} on ${mit.infill.bearingDeg.toFixed(0)}° from the primary. `
        + 'An in-fill only helps if it sees the airspace the primary cannot AND is not itself corrupted by the '
        + 'same farm. Check its own turbine returns in the turbine table before treating this as solved.',
      basis: 'computed',
      metrics: { 'Samples recovered': `${summary.recoveredCount}` },
    });
  }

  if (mit.ram.enabled) {
    add({
      id: 'ram',
      severity: 'check',
      severityKey: 'check',
      title: `Radar-absorbent treatment assumed to give ${mit.ram.reductionDb} dB of RCS reduction`,
      detail: 'This figure is whatever you typed, applied uniformly across aspect angle and frequency. Real '
        + 'absorbent treatment is narrowband, aspect-dependent, and has to survive blade erosion, lightning '
        + 'protection and a 25-year service life. Treat any RAM benefit as unproven until the supplier '
        + 'demonstrates it at your radar frequency and the relevant aspect angles.',
      basis: 'check',
      metrics: { 'Assumed reduction': `${mit.ram.reductionDb} dB` },
    });
  }

  if (mit.curtail.enabled) {
    add({
      id: 'curtail',
      severity: 'info',
      title: 'Turbines modelled as stopped (curtailment)',
      detail: 'With the rotor stationary the blade Doppler disappears and the whole turbine behaves as fixed '
        + 'clutter that a clutter map can cancel. This is the theoretical best case and shows how much of the '
        + 'problem is rotation rather than structure. It is rarely an acceptable operational mitigation because '
        + 'it removes the generation the scheme exists for.',
      basis: 'computed',
      metrics: {},
    });
  }

  // ------------------------------------------------------- screening distances
  const nearest = summary.nearestTurbineM;
  if (isFinite(nearest)) {
    if (nearest < 30000) {
      add({
        id: 'cap764-30km',
        severity: 'minor',
        title: `Farm is within the 30 km primary-radar assessment guide (${km(nearest)})`,
        detail: 'CAP 764 gives 30 km as a guide distance for assessing radar impact, with the actual impact '
          + 'depending on whether the operating turbines are detectable by the radar. Being inside the guide '
          + 'distance triggers assessment; it does not by itself mean there is an effect.',
        basis: 'screening',
        source: 'UK CAA CAP 764, Policy and Guidelines on Wind Turbines (30 km assessment guide; '
          + 'retrieved via search summary, primary document not reachable from this environment)',
        metrics: { 'Nearest turbine': km(nearest), 'Guide distance': '30 km' },
      });
    }
    if (nearest < 10000) {
      add({
        id: 'cap764-ssr',
        severity: 'minor',
        title: `Farm is within 10 km, so secondary radar effects are in scope as well (${km(nearest)})`,
        detail: 'CAP 764 advises that effects on secondary surveillance radar are relevant to consider when '
          + 'turbines are less than 10 km from the SSR. This tool models primary radar only: SSR reflection '
          + 'and multipath effects are NOT assessed here and need separate work.',
        basis: 'screening',
        source: 'UK CAA CAP 764 (10 km SSR consideration distance; retrieved via search summary, '
          + 'primary document not reachable from this environment)',
        metrics: { 'Nearest turbine': km(nearest), 'SSR consideration distance': '10 km' },
      });
    }
  }

  // ------------------------------------------------------------- near field
  const nearField = turbineResults.filter((t) => t.hub.slant < radar.farFieldM);
  if (nearField.length) {
    add({
      id: 'near-field',
      severity: 'major',
      title: `${nearField.length} turbines are inside the radar's far-field distance (${km(radar.farFieldM)})`,
      detail: `With an aperture of about ${radar.apertureM.toFixed(1)} m implied by the ${radar.azBeamwidthDeg}° `
        + 'azimuth beamwidth, the far-field boundary is 2D²/λ. Inside it the antenna pattern is not yet formed '
        + 'and the range equation used here does not apply, so these results understate the problem rather '
        + 'than overstate it.',
      basis: 'computed',
      metrics: {
        'Far-field distance': km(radar.farFieldM),
        'Implied aperture': `${radar.apertureM.toFixed(1)} m`,
        'Turbines inside': `${nearField.length}`,
      },
    });
  }

  // ------------------------------------------------ range ambiguity / folding
  const sta = turbineResults.filter((t) => t.secondTimeAround && t.visibility !== 'masked');
  if (sta.length) {
    add({
      id: 'second-time-around',
      severity: 'major',
      title: `${sta.length} turbines lie beyond the unambiguous range (${km(radar.unambiguousRangeM)})`,
      detail: `At ${radar.prfHz.toFixed(0)} Hz PRF the unambiguous range is ${km(radar.unambiguousRangeM)}. `
        + `Returns from beyond it are displayed at a false, shorter range - ${sta[0].turbine.id} would appear at `
        + `${km(sta[0].apparentRangeM)} instead of ${km(sta[0].hub.slant)}. Staggered or multiple-PRF `
        + 'operation normally resolves this; confirm what the radar actually does.',
      basis: 'computed',
      metrics: {
        'Unambiguous range': km(radar.unambiguousRangeM),
        'Turbines beyond it': `${sta.length}`,
      },
    });
  }

  // ------------------------------------------- obstacle / physical safeguarding
  const tipAgl = scenario.farm.hubHeightM + scenario.farm.rotorDiameterM / 2;
  if (tipAgl >= 150) {
    add({
      id: 'lighting',
      severity: 'check',
      title: `Tip height is ${tipAgl.toFixed(0)} m above ground level`,
      detail: 'Structures at or above 150 m AGL commonly trigger en-route obstacle lighting and charting '
        + 'requirements. This tool does NOT verify that against any jurisdiction: the applicable threshold, '
        + 'lighting specification and charting duty must be confirmed against the relevant national '
        + 'requirements and the CAA/ANSP for the site. Flagged here only so it is not missed.',
      basis: 'check',
      metrics: { 'Tip height AGL': `${tipAgl.toFixed(0)} m`, 'Common trigger height': '150 m' },
    });
  }

  const tallest = turbineResults.reduce((a, t) => (t.turbine.tipAmslM > (a ? a.turbine.tipAmslM : -1e9) ? t : a), null);
  if (tallest && tallest.tip.elevationDeg > radar.elPeakDeg - radar.elBeamwidthDeg / 2) {
    add({
      id: 'in-beam',
      severity: 'major',
      title: `Turbine tips reach into the main beam (${tallest.tip.elevationDeg.toFixed(1)}° elevation)`,
      detail: `${tallest.turbine.id} presents its rotor at ${tallest.tip.elevationDeg.toFixed(2)}° elevation, `
        + `against a beam peak at ${radar.elPeakDeg}° and a ${radar.elBeamwidthDeg}° elevation beamwidth. `
        + 'Turbines illuminated near the beam peak return far more energy than the low-elevation case usually '
        + 'assumed, and they compete directly with aircraft at similar elevation.',
      basis: 'computed',
      metrics: {
        'Highest tip elevation': `${tallest.tip.elevationDeg.toFixed(2)}°`,
        'Beam peak': `${radar.elPeakDeg}°`,
        'Elevation beamwidth': `${radar.elBeamwidthDeg}°`,
      },
    });
  }

  // ------------------------------------------------------- rotor aspect / wind
  const edgeOn = turbineResults.filter((t) => t.aspectDeg > 60);
  if (edgeOn.length && !mit.curtail.enabled) {
    add({
      id: 'aspect',
      severity: 'info',
      title: `${edgeOn.length} turbines present their rotor plane edge-on to the radar in the modelled wind`,
      detail: `Wind from ${scenario.farm.windFromDeg}° yaws the rotors so the radar sees up to `
        + `${Math.max(...turbineResults.map((t) => t.aspectDeg)).toFixed(0)}° off face-on. Maximum blade Doppler `
        + 'scales with the sine of that angle, so a wind direction change alone moves this assessment. '
        + 'Re-run across the site wind rose rather than assessing a single direction.',
      basis: 'computed',
      metrics: {
        'Wind from': `${scenario.farm.windFromDeg}°`,
        'Max rotor aspect': `${Math.max(...turbineResults.map((t) => t.aspectDeg)).toFixed(0)}°`,
      },
    });
  }

  // ----------------------------------------------------------- method warnings
  if (!radar.albersheimValid) {
    add({
      id: 'albersheim-range',
      severity: 'check',
      title: 'Detection threshold is outside the validity range of the approximation used',
      detail: `Albersheim's approximation is quoted for 0.1 ≤ Pd ≤ 0.9 and 1e-7 ≤ Pfa ≤ 1e-3. `
        + `This run uses Pd = ${radar.pd} and Pfa = ${radar.pfa.toExponential(0)}. The required-SNR figure is `
        + 'an extrapolation and should not be relied on.',
      basis: 'check',
      metrics: { Pd: `${radar.pd}`, Pfa: radar.pfa.toExponential(0) },
    });
  }

  f.sort((a, b) => (SEV_ORDER[a.severity] ?? 2) - (SEV_ORDER[b.severity] ?? 2));
  return f;
}

export const SEVERITY_LABELS = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  info: 'Information',
  check: 'Needs confirmation',
};
