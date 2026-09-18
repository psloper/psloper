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

import { M_PER_FT, M_PER_NM } from './geo.js';
import { cylinderRcsDbsm, wavelength } from './rf.js';
import { operatingState, tipSpeedRatioAtRated, operatingFractions } from './wind.js';
import {
  REFRACTION_PRESETS, TARGET_PRESETS, BLADE_CONSTRUCTIONS, TOWER_MATERIALS, DRIVETRAINS,
  tipHeightOf, groundClearanceOf,
} from './model.js';

const SEV_ORDER = { critical: 0, major: 1, minor: 2, info: 3 };

// Radial velocity as a single-PRF processor reports it: folded into the
// unambiguous interval, signed.
function foldedSigned(v, blindSpeed) {
  if (!(blindSpeed > 0)) return v;
  const m = ((v % blindSpeed) + blindSpeed) % blindSpeed;
  return m > blindSpeed / 2 ? m - blindSpeed : m;
}

const km = (m) => `${(m / 1000).toFixed(1)} km`;
const nm = (m) => `${(m / M_PER_NM).toFixed(1)} NM`;
const pct = (f) => `${(f * 100).toFixed(0)}%`;
const db = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)} dB`;

export function deriveFindings(scenario, radar, turbineResults, points, summary, blankZone, naizZone, infill, surface) {
  const f = [];
  const add = (x) => f.push(x);
  const mit = scenario.mitigation;

  // Height geometry, declared once because several findings turn on it.
  const tipHeightM = tipHeightOf(scenario.farm);
  const clearance = groundClearanceOf(scenario.farm);

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
  if (summary.worstClutter && summary.worstClutter.turbineClutterCostDb > 1) {
    const w = summary.worstClutter;
    const top = w.clutterContributors[0];
    add({
      id: 'desense',
      // Clutter only matters if it pushes detection toward the threshold. A
      // large cost that still leaves ample margin is not an operational
      // problem, and reporting it as one would cry wolf.
      severity: w.effectiveMarginDb < 0 ? 'critical'
        : w.effectiveMarginDb < 6 ? 'major'
          : w.turbineClutterCostDb > 10 ? 'minor' : 'minor',
      title: `Turbine clutter costs up to ${w.turbineClutterCostDb.toFixed(1)} dB of detection margin on the track`,
      detail: `Worst at ${km(w.geom.ground)} range, ${w.geom.bearing.toFixed(0)}° bearing, `
        + `${(w.amsl / M_PER_FT).toFixed(0)} ft: signal-to-clutter ${w.scrDb.toFixed(1)} dB`
        + (top ? `, dominated by ${top.id} at ${Math.abs(top.dR).toFixed(0)} m range offset and `
          + `${Math.abs(top.dAz).toFixed(2)}° in azimuth` : '')
        + `. This is the desensitisation region: reduced probability of detection over and around the farm, `
        + 'not only directly behind it.',
      basis: 'computed',
      metrics: {
        'Worst clutter cost': db(-w.turbineClutterCostDb),
        'Detection margin there': db(w.effectiveMarginDb),
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
  if (tipHeightM >= 150) {
    add({
      id: 'lighting',
      severity: 'check',
      title: `Tip height is ${tipHeightM.toFixed(0)} m above ground level`,
      detail: 'Structures at or above 150 m AGL commonly trigger en-route obstacle lighting and charting '
        + 'requirements. This tool does NOT verify that against any jurisdiction: the applicable threshold, '
        + 'lighting specification and charting duty must be confirmed against the relevant national '
        + 'requirements and the CAA/ANSP for the site. Flagged here only so it is not missed.',
      basis: 'check',
      metrics: { 'Tip height AGL': `${tipHeightM.toFixed(0)} m`, 'Common trigger height': '150 m' },
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

  // ------------------------------------------------- wind operating condition
  const wind = scenario.wind;
  const state = operatingState(wind.speedMs, wind);
  if (state !== 'at rated') {
    const worst = turbineResults.reduce((a, t) => Math.max(a, t.vTipMs), 0);
    const ratedTip = turbineResults.reduce((a, t) => Math.max(a, t.ratedTipSpeedMs || 0), 0);
    add({
      id: 'wind-condition',
      severity: state === 'below cut-in' || state === 'above cut-out' ? 'check' : 'minor',
      title: `Assessed at ${wind.speedMs} m/s, which is ${state} for this machine`,
      detail: state === 'below cut-in'
        ? `Below the ${wind.cutInMs} m/s cut-in speed the turbine is not generating and the rotor is `
          + 'idling, so blade Doppler is near its minimum. This is the easiest condition, not a '
          + 'representative one. Assess at or above rated before concluding anything.'
        : state === 'above cut-out'
          ? `Above the ${wind.cutOutMs} m/s cut-out speed the machine shuts down and feathers. Again the `
            + 'easiest condition, and one that occurs for a very small fraction of the year.'
          : `Rotor speed tracks the wind below the ${wind.ratedMs} m/s rated speed, so tip speed is `
            + `${worst.toFixed(0)} m/s against ${ratedTip.toFixed(0)} m/s at rated. Blade Doppler scales with `
            + 'it, so this is not the worst case. Sweep the wind rose to find the worst case.',
      basis: 'computed',
      metrics: {
        'Assessed wind speed': `${wind.speedMs} m/s`,
        'Operating state': state,
        'Tip speed now': `${worst.toFixed(0)} m/s`,
        'Tip speed at rated': `${ratedTip.toFixed(0)} m/s`,
      },
    });
  }

  const tsr = tipSpeedRatioAtRated(scenario.farm.rotorDiameterM / 2, scenario.farm.rpm, wind.ratedMs);
  if (tsr < 4 || tsr > 12) {
    add({
      id: 'tsr',
      severity: 'check',
      title: `Rated rotor speed and rated wind speed imply a tip-speed ratio of ${tsr.toFixed(1)}`,
      detail: 'Modern three-blade machines run at a tip-speed ratio of roughly 7 to 9 at rated. A figure '
        + 'well outside that usually means the rated rpm and the rated wind speed have come from '
        + 'different machines, which makes every Doppler figure here unreliable. Check them against the '
        + 'turbine datasheet.',
      basis: 'check',
      metrics: {
        'Tip-speed ratio at rated': tsr.toFixed(2),
        'Rated rotor speed': `${scenario.farm.rpm} rpm`,
        'Rated wind speed': `${wind.ratedMs} m/s`,
      },
    });
  }

  // ------------------------------------------------------------- refraction
  const refraction = REFRACTION_PRESETS[scenario.weather.refractionPreset];
  if (scenario.weather.refractionPreset !== 'standard') {
    add({
      id: 'refraction',
      severity: scenario.weather.refractionPreset === 'duct' ? 'major' : 'minor',
      title: `Assessed under ${refraction ? refraction.label.toLowerCase() : 'custom'} conditions `
        + `(k = ${scenario.environment.kFactor.toFixed(2)})`,
      detail: (refraction ? `${refraction.note} ` : '')
        + `The surface horizon is ${km(radar.horizonM)} at this k-factor, against `
        + `${km(radar.horizonM * Math.sqrt((4 / 3) / scenario.environment.kFactor))} under standard refraction.`,
      basis: 'computed',
      metrics: {
        'k-factor': scenario.environment.kFactor.toFixed(3),
        'Surface horizon': km(radar.horizonM),
      },
    });
  } else if (summary.maskedCount > 0) {
    add({
      id: 'masking-fragile',
      severity: 'check',
      title: `${summary.maskedCount} turbines are masked under standard refraction only`,
      detail: 'Terrain screening is the strongest mitigation available, but it is an argument about '
        + 'propagation conditions, not just geometry. Under super-refraction or in a surface duct the '
        + 'beam bends further and masked turbines come into view. Re-run this scenario at k = 2 and at '
        + 'the surface duct setting on the Weather tab before relying on a masking argument, and note '
        + 'that ducting is common over the sea.',
      basis: 'check',
      metrics: { 'Masked at k = 4/3': `${summary.maskedCount}`, 'Re-check at': 'k = 2.0 and duct' },
    });
  }

  // ------------------------------------------------------ sea surface effects
  if (surface && surface.offshore) {
    const inCover = points.filter((p) => !p.outOfRange);
    const worstNull = inCover.reduce((a, p) => Math.min(a, p.multipathDb ?? 0), 0);
    const bestLobe = inCover.reduce((a, p) => Math.max(a, p.multipathDb ?? 0), 0);
    if (worstNull < -6) {
      add({
        id: 'multipath',
        severity: worstNull < -15 ? 'major' : 'minor',
        title: `Sea-surface multipath puts up to ${Math.abs(worstNull).toFixed(0)} dB of null on the track`,
        detail: `Significant wave height ${surface.significantWaveHeightM.toFixed(1)} m (sea state `
          + `${surface.seaState.code}, ${surface.seaState.label.toLowerCase()}). A smooth sea is a good `
          + 'mirror, so the direct and reflected rays interfere and low-level coverage breaks into lobes '
          + `and nulls: this run swings between ${worstNull.toFixed(0)} dB and +${bestLobe.toFixed(0)} dB `
          + 'relative to free space. A calmer sea makes this worse, not better, because the nulls deepen. '
          + 'The divergence factor is neglected, so the modelled lobing is a worst case at long range.',
        basis: 'computed',
        metrics: {
          'Significant wave height': `${surface.significantWaveHeightM.toFixed(2)} m`,
          'Sea state': `${surface.seaState.code} (${surface.seaState.label})`,
          'Deepest null': `${worstNull.toFixed(1)} dB`,
          'Strongest lobe': `+${bestLobe.toFixed(1)} dB`,
        },
      });
    }
    const worstSea = inCover.reduce((a, p) => Math.max(a, p.seaClutterCostDb || 0), 0);
    if (worstSea > 0.5) {
      const sample = inCover.find((p) => (p.seaClutterCostDb || 0) > worstSea - 0.01);
      // The point where sea clutter costs the most is often directly overhead,
      // where there is so much signal that the cost is harmless. What matters
      // is the smallest margin it leaves anywhere on the track.
      const tightest = inCover.reduce(
        (a, p) => ((p.seaClutterCostDb || 0) > 0.5 && p.effectiveMarginDb < a.effectiveMarginDb ? p : a),
        { effectiveMarginDb: Infinity });
      const leftMargin = Number.isFinite(tightest.effectiveMarginDb)
        ? tightest.effectiveMarginDb : Infinity;
      add({
        id: 'sea-clutter',
        severity: leftMargin < 0 ? 'critical' : leftMargin < 6 ? 'major' : 'minor',
        title: `Sea clutter costs up to ${worstSea.toFixed(1)} dB of detection margin`,
        detail: `At sea state ${surface.seaState.code}, clutter from the sea surface competes with the `
          + `target in the same resolution cell${sample ? ` (worst at ${km(sample.geom.ground)})` : ''}. `
          + 'Sea clutter rises steeply with sea state and with radar frequency, and it matters most for '
          + 'small, slow targets. A large cost where the signal is already very strong, such as directly '
          + 'overhead, is not an operational problem; what matters is the margin it leaves. Every constant '
          + 'in this reflectivity model is an input, not a published figure: take sigma-zero from a '
          + 'validated model or measured data before relying on it.',
        basis: 'screening',
        metrics: {
          'Worst sea clutter cost': `${worstSea.toFixed(1)} dB`,
          'Tightest margin where it bites': Number.isFinite(leftMargin) ? db(leftMargin) : 'n/a',
          'Sea state': `${surface.seaState.code}`,
          'Assumed sigma-zero reference': `${scenario.site.seaClutter.sigmaZeroRefDb} dB`,
        },
      });
    }
    if (scenario.site.waveFromWind && surface.significantWaveHeightM > 8) {
      add({
        id: 'wave-fetch',
        severity: 'check',
        title: `Derived wave height of ${surface.significantWaveHeightM.toFixed(1)} m assumes unlimited fetch`,
        detail: 'Wave height here is derived from wind speed for a fully developed sea. Real sites are '
          + 'fetch-limited and duration-limited, and a swell-dominated sea does not follow this at all. '
          + 'At this wind speed the figure is almost certainly too high. Set the wave height directly '
          + 'from measured or hindcast data on the Site tab.',
        basis: 'check',
        metrics: { 'Derived Hs': `${surface.significantWaveHeightM.toFixed(1)} m`, 'Wind speed': `${wind.speedMs} m/s` },
      });
    }
  }

  // ------------------------------------------------- RCS against the geometry
  const lambdaM = radar.lambdaM;
  const ceiling = cylinderRcsDbsm(scenario.farm.towerBaseDiameterM / 2, scenario.farm.hubHeightM, lambdaM);
  if (scenario.farm.towerRcsDbsm > ceiling) {
    add({
      id: 'rcs-ceiling',
      severity: 'major',
      title: `Assumed tower RCS of ${scenario.farm.towerRcsDbsm} dBsm exceeds what this geometry can return`,
      detail: `A smooth conducting cylinder of ${scenario.farm.towerBaseDiameterM} m diameter and `
        + `${scenario.farm.hubHeightM} m height returns at most ${ceiling.toFixed(0)} dBsm at broadside, `
        + 'from the standard physical-optics result 2*pi*a*h^2/lambda. An assumed RCS above that ceiling '
        + 'is not physical for the stated dimensions. Either the RCS or the geometry is wrong.',
      basis: 'computed',
      metrics: {
        'Assumed tower RCS': `${scenario.farm.towerRcsDbsm} dBsm`,
        'Specular ceiling for this geometry': `${ceiling.toFixed(1)} dBsm`,
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

  // ------------------------------------------------------ structure and height
  if (clearance < 15) {
    add({
      id: 'ground-clearance',
      severity: clearance < 5.5 ? 'major' : 'check',
      title: `Blade tips pass within ${clearance.toFixed(0)} m of the ground`,
      detail: 'Hub height and rotor diameter imply a very small ground clearance. Real machines leave '
        + 'far more, typically 20 to 40 m. Either the geometry is wrong, or the tip height you asked '
        + 'for is lower than this rotor can physically reach: the tool holds the hub at the minimum '
        + 'that keeps the blades clear rather than accepting an impossible machine. Reduce the rotor '
        + 'diameter if you need a lower tip.',
      basis: 'computed',
      metrics: {
        'Hub height': `${scenario.farm.hubHeightM.toFixed(0)} m`,
        'Rotor radius': `${(scenario.farm.rotorDiameterM / 2).toFixed(0)} m`,
        'Ground clearance': `${clearance.toFixed(0)} m`,
        'Tip height': `${tipHeightM.toFixed(0)} m`,
      },
    });
  }

  if (tipHeightM > 200) {
    add({
      id: 'tip-height-large',
      severity: 'info',
      title: `Tip height of ${tipHeightM.toFixed(0)} m is above the ~200 m typical onshore today`,
      detail: 'Larger machines reach further above the terrain that would otherwise screen them, so '
        + 'line of sight, the lighting and charting threshold and the consultation footprint can all '
        + 'change together. Offshore machines already exceed this routinely. Sweep tip height against '
        + 'distance to see where the radio horizon boundary actually falls for this radar.',
      basis: 'screening',
      metrics: {
        'Tip height': `${tipHeightM.toFixed(0)} m AGL`,
        'Hub height': `${scenario.farm.hubHeightM.toFixed(0)} m`,
        'Rotor diameter': `${scenario.farm.rotorDiameterM.toFixed(0)} m`,
      },
    });
  }

  // ------------------------------------------------------------- materials
  const strongest = turbineResults
    .filter((t) => t.visibility !== 'masked')
    .sort((a, b) => b.snrEffDb - a.snrEffDb)[0];
  if (strongest) {
    const towerLin = Math.pow(10, strongest.towerEffDbsm / 10);
    const bladeLin = Math.pow(10, strongest.bladeEffDbsm / 10);
    const towerShare = towerLin / (towerLin + bladeLin);
    const bc = BLADE_CONSTRUCTIONS[scenario.farm.construction];
    const tm = TOWER_MATERIALS[scenario.farm.towerMaterial];
    add({
      id: 'scatterer-split',
      severity: 'info',
      title: towerShare > 0.5
        ? `After clutter filtering, the tower contributes ${(towerShare * 100).toFixed(0)}% of the return`
        : `After clutter filtering, the blades contribute ${((1 - towerShare) * 100).toFixed(0)}% of the return`,
      detail: 'A glass-fibre blade shell is largely transparent at microwave frequencies. What returns '
        + 'the signal is the conductive structure inside it: the carbon-fibre spar caps and the '
        + 'lightning protection system. The tower is a large conducting cylinder and open work reports '
        + 'it as the dominant scatterer at all aspect angles. The split here is after clutter '
        + 'filtering, which is what matters operationally: the tower is stationary and a clutter filter '
        + 'can cancel it, while the blades move and it largely cannot. That is why the blades can '
        + 'dominate what survives even when the tower dominates what arrives.',
      basis: 'computed',
      metrics: {
        'Blade construction': bc ? bc.label : 'custom',
        'Tower': tm ? tm.label : 'custom',
        'Structure (tower + nacelle)': `${strongest.structureDbsm.toFixed(1)} dBsm before filtering`,
        'Structure after filtering': `${strongest.towerEffDbsm.toFixed(1)} dBsm`,
        'Blades after filtering': `${strongest.bladeEffDbsm.toFixed(1)} dBsm`,
      },
    });
  }

  if (scenario.farm.construction === 'ram-treated' || mit.ram.enabled) {
    add({
      id: 'ram-lightning',
      severity: 'check',
      title: 'Radar-absorbent treatment has to coexist with the lightning protection system',
      detail: 'A blade lightning protection system exists to be the most conductive path available, '
        + 'from receptors at the tip down to the hub. Absorbent treatment works by not reflecting. The '
        + 'two pull in opposite directions, and reconciling them is a real engineering problem rather '
        + 'than a detail: there is a body of patent work specifically about making absorbent layers '
        + 'compatible with lightning protection. Treatment also has to survive leading-edge erosion at '
        + 'tip speeds approaching 90 m/s for a 25-year life. Ask the supplier for demonstrated '
        + 'performance at your radar frequency and the relevant aspect angles, and for the erosion and '
        + 'lightning certification alongside it.',
      basis: 'check',
      source: 'Open reporting of the QinetiQ and Vestas stealth blade trial (a 44 m prototype blade on '
        + 'a V90 in Norfolk, 2009) describes absorbent materials integrated into blades, nacelle and '
        + 'tower, with reductions reported as in line with expectations. Retrieved at search-summary '
        + 'level only; no primary source was read, and no figure from it is used in this model.',
      metrics: {
        'Assumed reduction': mit.ram.enabled ? `${mit.ram.reductionDb} dB` : 'construction delta only',
        'Verified here': 'No',
      },
    });
  }

  // --------------------------------------------------------------- fleet state
  const fleet = turbineResults.map((t) => t.turbine);
  const running = fleet.filter((t) => t.running);
  const stopped = fleet.filter((t) => !t.running);
  const runningDop = turbineResults.filter((t) => t.turbine.running).map((t) => t.fdMaxHz);

  if (stopped.length) {
    const byReason = {};
    for (const t of stopped) byReason[t.stoppedReason] = (byReason[t.stoppedReason] || 0) + 1;
    add({
      id: 'fleet-stopped',
      severity: 'info',
      title: `${stopped.length} of ${fleet.length} turbines are not turning in this fleet state`,
      detail: 'A parked rotor produces no blade Doppler, so a clutter filter can cancel it the way it '
        + 'cancels any fixed structure. It is still a large object and still returns, but it is a '
        + 'fundamentally different radar target from a turning one. Turbines stop for maintenance, '
        + 'faults and grid constraints, and are curtailed for noise, shadow flicker, bats and icing, '
        + 'so a real array is rarely all turning. Vary the fleet seed to see other states, and do not '
        + 'assume either extreme.',
      basis: 'computed',
      metrics: {
        'Turning': `${running.length} of ${fleet.length}`,
        ...Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k === 'unavailable' ? 'Unavailable' : 'Curtailed', String(v)])),
      },
    });
  }

  if (runningDop.length > 1) {
    const lo = Math.min(...runningDop);
    const hi = Math.max(...runningDop);
    const waked = fleet.filter((t) => t.waked);
    if (hi > lo * 1.5 || waked.length) {
      add({
        id: 'fleet-spread',
        severity: 'info',
        title: `Blade Doppler varies from ${lo.toFixed(0)} to ${hi.toFixed(0)} Hz across the array`,
        detail: `${waked.length} of ${fleet.length} turbines sit in the wake of another and see slower `
          + `air, down to ${Math.min(...fleet.map((t) => t.inflowMs)).toFixed(1)} m/s against a free `
          + `stream of ${scenario.wind.speedMs} m/s, so they turn more slowly. Yaw control works on a `
          + `deadband of \u00b1${scenario.wind.fleet.yawDeadbandDeg}\u00b0, so the machines sit `
          + 'scattered around the wind rather than on it. The array therefore presents a spread of '
          + 'signatures rather than one, which is worth remembering before treating any single number '
          + 'as the answer.',
        basis: 'computed',
        metrics: {
          'Turbines in wake': `${waked.length} of ${fleet.length}`,
          'Inflow range': `${Math.min(...fleet.map((t) => t.inflowMs)).toFixed(1)} to `
            + `${Math.max(...fleet.map((t) => t.inflowMs)).toFixed(1)} m/s`,
          'Doppler range': `${lo.toFixed(0)} to ${hi.toFixed(0)} Hz`,
        },
      });
    }
  }

  // Real arrays mix hub heights. If this one does not, say so, because tip
  // height above sea level is exactly what decides which machines clear a
  // horizon or a terrain screen and which do not.
  if (fleet.length > 1) {
    const hubs = new Set(fleet.map((t) => t.hubHeightM));
    const tips = fleet.map((t) => t.tipAmslM);
    const tipRange = Math.max(...tips) - Math.min(...tips);
    if (hubs.size === 1) {
      add({
        id: 'uniform-hub-height',
        severity: 'info',
        title: `Every turbine has the same hub height, and tip heights span only ${tipRange.toFixed(0)} m`,
        detail: 'All '
          + `${fleet.length} machines are modelled at ${fleet[0].hubHeightM} m hub height, so the only `
          + 'spread in tip height above sea level comes from the ground under them. The one real layout '
          + 'this tool has been checked against, six Senvion MM92 at Kelmarsh, carries TWO hub heights '
          + '10 m apart across six machines, over ground spanning 21.5 m, for a tip-height spread of '
          + `31.5 m against the ${tipRange.toFixed(0)} m here. Tip height above sea level is what decides `
          + 'which machines clear a horizon or a terrain screen, so a uniform-height array understates '
          + 'how mixed the visibility across a real farm is. Set a hub height spread, or import a real '
          + 'schedule with per-machine heights, before reading anything into a single visibility answer.',
        basis: 'check',
        metrics: {
          'Hub heights in this array': `1 (${fleet[0].hubHeightM} m)`,
          'Tip height spread': `${tipRange.toFixed(1)} m`,
          'Measured at Kelmarsh': '2 hub heights, 31.5 m tip spread over 6 machines',
        },
        source: 'kelmarsh-static',
      });
    }
  }

  const placement = turbineResults.length ? turbineResults[0].turbine.placementInfo : null;
  if (scenario.farm.constrained && points && fleet.length) {
    add({
      id: 'placement',
      severity: 'info',
      title: 'Layout is following the buildable ground rather than a grid',
      detail: 'Where a turbine can stand depends on what is under it: bearing capacity, peat depth, '
        + 'slope, watercourses, access track routing and setbacks. Positions failing the slope or '
        + 'ground-level test have been moved to the nearest buildable spot or dropped, which is why '
        + 'the layout is irregular. This models the geometry of that constraint, not the consenting, '
        + 'and it cannot know a real site\u2019s real constraints. For those, import the schedule.',
      basis: 'screening',
      metrics: {
        'Turbines placed': `${fleet.length} of ${Math.round(scenario.farm.count)} requested`,
        'Maximum buildable slope': `${scenario.farm.maxSlopeDeg}\u00b0`,
        'Minimum spacing': `${scenario.farm.minSpacingM} m`,
      },
    });
  }

  // ------------------------------------------------- nacelle specular lobe
  const broadside = turbineResults.filter((t) => t.aspectDeg > 60 && t.visibility !== 'masked');
  if (broadside.length && !mit.curtail.enabled) {
    const w = broadside.sort((a, b) => b.nacelleAspectDbsm - a.nacelleAspectDbsm)[0];
    const dt = DRIVETRAINS[scenario.farm.drivetrain];
    add({
      id: 'nacelle-lobe',
      severity: 'minor',
      title: 'The nacelle specular lobe and peak blade Doppler occur at the same aspect',
      detail: 'The nacelle cover is glass-fibre and largely transparent, so the generator, gearbox and '
        + 'shafts inside it are illuminated, and its specular lobe is broadside to the rotor axis. That '
        + 'is the same aspect at which the rotor plane is edge-on and blade Doppler is greatest. So a '
        + 'wind direction that puts the rotor edge-on to the radar gives both the strongest fixed '
        + 'return and the most moving return at once. They do not trade off against each other.'
        + ' No published split between the generator and the rest of the nacelle was found, so this '
        + 'model treats them together as drivetrain mass.',
      basis: 'computed',
      metrics: {
        'Drivetrain': dt ? dt.label : 'custom',
        'Worst aspect': `${w.aspectDeg.toFixed(0)}\u00b0 off face-on (${w.turbine.id})`,
        'Nacelle there': `${w.nacelleAspectDbsm.toFixed(1)} dBsm`,
        'Head-on would be': `${scenario.farm.nacelleRcsHeadOnDbsm} dBsm`,
      },
    });
  }

  // ------------------------------------------------------------ blind speeds
  //
  // Nothing to do with the wind farm, but it will dominate any result it
  // touches, and a tool that silently produced "target not detected" without
  // saying why would be actively misleading.
  const notched = points.filter((p) => !p.outOfRange && Math.abs(p.targetMtiDb) > 3);
  if (notched.length) {
    const worst = notched.reduce((a, p) => (p.targetMtiDb < a.targetMtiDb ? p : a), notched[0]);
    const vb = radar.firstBlindSpeedMs;
    const tangential = notched.filter((p) => Math.abs(p.radialMs) < radar.mtiNotchMs * 1.5).length;
    add({
      id: 'blind-speed',
      severity: notched.length > points.length * 0.2 ? 'critical' : 'major',
      title: tangential > notched.length / 2
        ? `Target is flying tangentially for ${notched.length} samples, inside the clutter notch`
        : `Target radial speed folds into the clutter notch for ${notched.length} samples`,
      detail: tangential > notched.length / 2
        ? 'A target crossing the radar\u2019s line of sight has almost no radial velocity, so a Doppler '
          + 'clutter filter cannot separate it from stationary ground. This is a property of the geometry, '
          + 'not of the wind farm, but it stacks with turbine clutter in exactly the wrong way.'
        : `At ${radar.prfHz.toFixed(0)} Hz PRF and ${(radar.lambdaM * 100).toFixed(1)} cm wavelength the `
          + `first blind speed is ${vb.toFixed(1)} m/s (${(vb / 0.514444).toFixed(0)} kt). The target is `
          + `flying at ${scenario.target.speedKt} kt, whose radial component folds to `
          + `${foldedSigned(worst.radialMs, vb).toFixed(1)} m/s, `
          + `inside the \u00b1${radar.mtiNotchMs} m/s notch. The radar rejects it as clutter. Real systems `
          + 'stagger the PRF or use multiple PRFs precisely to avoid this; if the radar you are modelling '
          + 'does that, this finding is an artefact of a single-PRF model and should be discounted.',
      basis: 'computed',
      metrics: {
        'Samples affected': `${notched.length} of ${points.length}`,
        'Worst rejection': `${worst.targetMtiDb.toFixed(1)} dB`,
        'First blind speed': `${vb.toFixed(1)} m/s (${(vb / 0.514444).toFixed(0)} kt)`,
        'Target speed': `${scenario.target.speedKt} kt`,
      },
    });
  }

  // ------------------------------------------------------- target sensitivity
  //
  // The same farm can be harmless against one class of traffic and decisive
  // against another, so the assessment is only as good as the target it used.
  const tgt = TARGET_PRESETS[scenario.target.preset];
  if (summary.worstPoint && Number.isFinite(summary.worstPoint.effectiveMarginDb)) {
    const margin = summary.worstPoint.effectiveMarginDb;
    // How much smaller a target could be before the worst point drops below
    // threshold. Two-way, so RCS maps one-for-one onto margin in dB.
    const headroomDb = margin;
    const breakEven = scenario.target.rcsDbsm - headroomDb;
    const smaller = Object.entries(TARGET_PRESETS)
      .filter(([, t]) => t.rcsDbsm < breakEven)
      .sort((a, b) => b[1].rcsDbsm - a[1].rcsDbsm);
    if (headroomDb > 0 && smaller.length) {
      add({
        id: 'target-sensitivity',
        severity: 'info',
        title: `This result holds for a ${(tgt ? tgt.label : 'target').toLowerCase()}; `
          + `${smaller.length} smaller classes would be lost`,
        detail: `The worst point on the track clears the threshold by ${db(margin)}, and RCS maps one for `
          + `one onto that margin. A target below about ${breakEven.toFixed(0)} dBsm would not clear it at `
          + `the same point. That includes ${smaller.slice(0, 4).map(([, t]) => t.label.toLowerCase()).join(', ')}`
          + `${smaller.length > 4 ? ` and ${smaller.length - 4} others` : ''}. Assess against the smallest `
          + 'traffic the radar is relied on to see, not the largest.',
        basis: 'computed',
        metrics: {
          'Assessed target': `${tgt ? tgt.label : 'custom'} at ${scenario.target.rcsDbsm} dBsm`,
          'Margin at the worst point': db(margin),
          'Break-even target RCS': `${breakEven.toFixed(0)} dBsm`,
          'Classes that would be lost': `${smaller.length}`,
        },
      });
    }
  }

  // -------------------------------------------------- regulatory framework
  //
  // This finding is always present. It is the most important thing the tool
  // has to say about itself, and it must not be possible to lose it in a list.
  add({
    id: 'regulatory',
    severity: 'check',
    title: 'Regulatory conformance is NOT assessed by this tool',
    detail: 'Nothing here has been checked against ICAO, EUROCONTROL, or any national requirement. '
      + 'The tool computes physics; it does not know what any authority requires, what thresholds '
      + 'trigger an objection, what an aerodrome safeguarding case has to contain, or what evidence a '
      + 'planning submission needs. Do not present any output of this tool as showing conformance with '
      + 'anything. The instruments below are the ones an assessment of this kind normally engages with, '
      + 'listed so they are not overlooked. THE LIST ITSELF IS UNVERIFIED: it is written from general '
      + 'knowledge, not read from the documents, because the environment this tool was built in had no '
      + 'access to them. Confirm the current edition, number and applicability of every one before '
      + 'relying on it.',
    basis: 'check',
    source: 'Unverified. Typically engaged: ICAO Annex 14 Vol I (aerodromes and obstacle limitation '
      + 'surfaces); ICAO Annex 10 (aeronautical telecommunications); ICAO Doc 8168 PANS-OPS (procedure '
      + 'design); ICAO EUR Doc 015 (European guidance on building restricted areas around CNS '
      + 'facilities); EUROCONTROL guidance on wind turbines and radar; in the UK, CAA CAP 764 (wind '
      + 'turbine policy), CAP 670 including SUR 13 (surveillance requirements) and CAP 168 (aerodrome '
      + 'licensing); and the relevant ITU-R P-series recommendations for propagation. None of these was '
      + 'retrieved or read.',
    metrics: {
      'Conformance assessed': 'No',
      'Documents read': 'None',
      'Required before use': 'Engagement with the ANSP and the regulator',
    },
  });

  f.sort((a, b) => (SEV_ORDER[a.severity] ?? 2) - (SEV_ORDER[b.severity] ?? 2));
  return f;
}

/**
 * Findings that only exist once the wind rose has been swept, because they are
 * statements about the whole wind climate rather than one condition.
 */
export function deriveWindRoseFindings(scenario, rose) {
  const out = [];
  const pct1 = (x) => `${(x * 100).toFixed(1)}%`;
  const brg = (d) => String(Math.round(d)).padStart(3, '0');

  out.push({
    id: 'rose-exposure',
    severity: rose.exposureWithPlots > 0.5 ? 'critical'
      : rose.exposureWithPlots > 0.1 ? 'major'
        : rose.exposureWithPlots > 0 ? 'minor' : 'info',
    title: rose.exposureWithPlots > 0
      ? `Turbine plots are present for about ${pct1(rose.exposureWithPlots)} of the year`
      : 'No wind direction in the modelled climate produces turbine plots',
    detail: `Across all twelve direction sectors, weighted by how often each occurs and by how much of `
      + `that time the machine is turning. The turbines generate ${pct1(rose.generatingFraction)} of the `
      + 'year overall; outside that they are below cut-in or shut down above cut-out, when blade Doppler '
      + 'largely disappears. This is the figure an operational assessment needs: not whether there is an '
      + 'effect, but how much of the time there is one.',
    basis: 'computed',
    metrics: {
      'Plots present': pct1(rose.exposureWithPlots),
      'Turbines generating': pct1(rose.generatingFraction),
      'Track degraded': pct1(rose.exposureUntracked),
    },
  });

  // The classic assessment error: assessing one convenient direction.
  const assessed = rose.assessed;
  const worst = rose.worstPlots;
  const worstDop = rose.worstDoppler;
  if (worst && assessed && worst.plots > assessed.plots) {
    out.push({
      id: 'rose-wrong-direction',
      severity: 'major',
      title: `The assessed wind direction is not the worst one`,
      detail: `You are assessing wind from ${brg(rose.assessedDirectionDeg)}°, which gives `
        + `${assessed.plots} turbine plots and occurs about ${pct1(assessed.frequency)} of the time. Wind `
        + `from ${brg(worst.directionDeg)}° gives ${worst.plots} and occurs about `
        + `${pct1(worst.frequency)} of the time. Assess the worst case the climate actually produces, not `
        + 'a single convenient direction.',
      basis: 'computed',
      metrics: {
        'Assessed direction': `${brg(rose.assessedDirectionDeg)}° (${pct1(assessed.frequency)} of the time)`,
        'Worst direction': `${brg(worst.directionDeg)}° (${pct1(worst.frequency)} of the time)`,
        'Plots, assessed vs worst': `${assessed.plots} vs ${worst.plots}`,
      },
    });
  }

  if (worstDop && rose.quietest && worstDop.maxDopplerHz > rose.quietest.maxDopplerHz * 1.5) {
    out.push({
      id: 'rose-doppler-spread',
      severity: 'info',
      title: `Blade Doppler varies from ${rose.quietest.maxDopplerHz.toFixed(0)} to `
        + `${worstDop.maxDopplerHz.toFixed(0)} Hz across the wind rose`,
      detail: `Rotor yaw follows the wind, so the angle between the radar line of sight and the rotor `
        + `axis changes with direction, and peak blade Doppler goes as the sine of that angle. Wind from `
        + `${brg(worstDop.directionDeg)}° presents the rotor plane most nearly edge-on and produces the `
        + `most Doppler; wind from ${brg(rose.quietest.directionDeg)}° points it most nearly at the radar `
        + 'and produces the least. A single-direction assessment can land anywhere in that range.',
      basis: 'computed',
      metrics: {
        'Most Doppler': `${worstDop.maxDopplerHz.toFixed(0)} Hz from ${brg(worstDop.directionDeg)}°`,
        'Least Doppler': `${rose.quietest.maxDopplerHz.toFixed(0)} Hz from ${brg(rose.quietest.directionDeg)}°`,
      },
    });
  }

  if (rose.worstTrack && rose.worstTrack.untrackedFraction > 0.05) {
    out.push({
      id: 'rose-worst-track',
      severity: rose.worstTrack.untrackedFraction > 0.25 ? 'critical' : 'major',
      title: `Worst direction loses track for ${pct1(rose.worstTrack.untrackedFraction)} of the flight`,
      detail: `Wind from ${brg(rose.worstTrack.directionDeg)}°, which occurs about `
        + `${pct1(rose.worstTrack.frequency)} of the year. Weighted across the whole climate, the track is `
        + `degraded for about ${pct1(rose.exposureUntracked)} of the time.`,
      basis: 'computed',
      metrics: {
        'Worst direction': `${brg(rose.worstTrack.directionDeg)}°`,
        'Track lost there': pct1(rose.worstTrack.untrackedFraction),
        'Weighted across the year': pct1(rose.exposureUntracked),
      },
    });
  }

  out.push({
    id: 'rose-source',
    severity: 'check',
    title: 'The wind rose used here is illustrative, not site data',
    detail: 'The direction frequencies and mean speeds come from a shaped preset, not from measurement. '
      + 'Every percentage above inherits that. Replace the rose with the site\u2019s own measured or '
      + 'reanalysis wind climate before quoting any of these figures.',
    basis: 'check',
    metrics: {
      'Rose': scenario.wind.rosePreset,
      'Weibull shape k': String(scenario.wind.weibullK),
      'Mean wind speed': `${rose.climate.meanSpeedMs.toFixed(1)} m/s`,
    },
  });

  return out;
}

export const SEVERITY_LABELS = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  info: 'Information',
  check: 'Needs confirmation',
};
