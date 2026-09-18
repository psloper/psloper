// Control rail, results panel, legend and readout.
//
// The controls are declared as data so that every input is bound to exactly one
// path in the scenario object, and so that adding a parameter does not mean
// touching event wiring.

import {
  RADAR_PRESETS, TURBINE_PRESETS, TARGET_PRESETS, TERRAIN_PRESETS, REFRACTION_PRESETS,
  TARGET_GROUPS, tipHeightOf, groundClearanceOf, setTipHeight,
  BLADE_CONSTRUCTIONS, TOWER_MATERIALS, DRIVETRAINS,
} from './model.js';
import { WIND_ROSE_PRESETS, operatingState as windState } from './wind.js';
import { cylinderRcsDbsm } from './rf.js';
import { SEVERITY_LABELS } from './findings.js';
import { referencesFor, STATUS_LABELS } from './references.js';
import { M_PER_FT } from './geo.js';
import { UK_WIND_FARMS, UK_RADAR_SITES, UK_MILITARY_RADAR_NOTE, LIVE_STATUSES,
  POSITION_UNCERTAINTY_M, STATED_PRECISION_M, pairingGeometry } from './uksites.js';

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = obj;
  for (const k of keys) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[last] = value;
}

const opts = (map, labelKey = 'label') =>
  Object.entries(map).map(([k, v]) => ({ value: k, label: v[labelKey] || k }));

// --------------------------------------------------------------- field specs

export const TABS = {
  radar: [
    { group: 'Radar under assessment', fields: [
      { type: 'select', path: 'radar.preset', label: 'Preset', options: opts(RADAR_PRESETS), preset: 'radar' },
      { type: 'note', id: 'radar-note' },
      { type: 'range', path: 'radar.freqHz', label: 'Frequency', min: 0.4e9, max: 10e9, step: 0.01e9,
        fmt: (v) => `${(v / 1e9).toFixed(2)} GHz` },
      { type: 'range', path: 'radar.peakPowerW', label: 'Peak power', min: 1000, max: 400000, step: 1000,
        fmt: (v) => `${(v / 1000).toFixed(0)} kW` },
      { type: 'range', path: 'radar.gainDbi', label: 'Antenna gain', min: 20, max: 50, step: 0.5, fmt: (v) => `${v} dBi` },
      { type: 'range', path: 'radar.heightAgl', label: 'Antenna height', min: 3, max: 120, step: 1, fmt: (v) => `${v} m AGL` },
      { type: 'range', path: 'radar.instrumentedRangeM', label: 'Instrumented range', min: 10000, max: 400000, step: 5000,
        fmt: (v) => `${(v / 1000).toFixed(0)} km` },
    ] },
    { group: 'Beam shape', fields: [
      { type: 'range', path: 'radar.azBeamwidthDeg', label: 'Azimuth beamwidth', min: 0.4, max: 6, step: 0.1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'radar.elBeamwidthDeg', label: 'Elevation beamwidth', min: 0.5, max: 30, step: 0.1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'radar.elPeakDeg', label: 'Beam peak elevation', min: 0, max: 15, step: 0.25, fmt: (v) => `${v}°` },
      { type: 'range', path: 'radar.cscMaxDeg', label: 'Cosecant-squared to', min: 1, max: 50, step: 1, fmt: (v) => `${v}°` },
      { type: 'hint', text: 'Elevation shape decides how strongly low turbines are illuminated compared with '
        + 'aircraft above them. A narrow, tilted beam is the single biggest lever a radar has here.' },
    ] },
    { group: 'Waveform', fields: [
      { type: 'range', path: 'radar.prfHz', label: 'PRF', min: 200, max: 3000, step: 10, fmt: (v) => `${v} Hz` },
      { type: 'range', path: 'radar.pulseWidthS', label: 'Pulse width', min: 0.2e-6, max: 200e-6, step: 0.2e-6,
        fmt: (v) => `${(v * 1e6).toFixed(1)} µs` },
      { type: 'range', path: 'radar.compressedBandwidthHz', label: 'Compressed bandwidth', min: 0, max: 5e6, step: 0.05e6,
        fmt: (v) => (v > 0 ? `${(v / 1e6).toFixed(2)} MHz` : 'uncompressed') },
      { type: 'range', path: 'radar.rpm', label: 'Scan rate', min: 1, max: 30, step: 0.5, fmt: (v) => `${v} rpm` },
      { type: 'note', id: 'waveform-note' },
    ] },
    { group: 'Receiver and processing', fields: [
      { type: 'range', path: 'radar.noiseFigureDb', label: 'Noise figure', min: 1, max: 10, step: 0.1, fmt: (v) => `${v} dB` },
      { type: 'range', path: 'radar.systemLossDb', label: 'System losses', min: 0, max: 15, step: 0.5, fmt: (v) => `${v} dB` },
      { type: 'range', path: 'radar.mtiRejectionDb', label: 'Clutter rejection', min: 10, max: 70, step: 1, fmt: (v) => `${v} dB` },
      { type: 'range', path: 'radar.mtiNotchMs', label: 'Clutter notch half-width', min: 0.5, max: 25, step: 0.5, fmt: (v) => `±${v} m/s` },
      { type: 'range', path: 'radar.dopplerSpreadGainDb', label: 'Gain against spread clutter', min: 0, max: 30, step: 1, fmt: (v) => `${v} dB` },
      { type: 'range', path: 'radar.rangeSidelobeDb', label: 'Peak range sidelobe', min: -60, max: -20, step: 1, fmt: (v) => `${v} dB` },
      { type: 'range', path: 'radar.dynamicRangeDb', label: 'Receiver dynamic range', min: 40, max: 110, step: 1, fmt: (v) => `${v} dB` },
    ] },
    { group: 'Detection criterion', fields: [
      { type: 'range', path: 'radar.pd', label: 'Probability of detection', min: 0.1, max: 0.95, step: 0.05, fmt: (v) => v.toFixed(2) },
      { type: 'select', path: 'radar.pfa', label: 'False alarm probability', numeric: true,
        options: [1e-3, 1e-4, 1e-5, 1e-6, 1e-7].map((v) => ({ value: v, label: v.toExponential(0) })) },
      { type: 'range', path: 'radar.fluctuationMarginDb', label: 'Target fluctuation margin', min: 0, max: 15, step: 0.5, fmt: (v) => `${v} dB` },
      { type: 'note', id: 'threshold-note' },
    ] },
  ],

  farm: [
    { group: 'Machine', fields: [
      { type: 'select', path: 'farm.preset', label: 'Turbine class', options: opts(TURBINE_PRESETS), preset: 'turbine' },
      { type: 'derived', id: 'tip-height', label: 'Tip height', min: 50, max: 300, step: 1,
        fmt: (v) => `${v.toFixed(0)} m`,
        read: (s) => tipHeightOf(s.farm),
        write: (s, v) => setTipHeight(s.farm, v) },
      { type: 'range', path: 'farm.hubHeightM', label: 'Hub height', min: 20, max: 280, step: 1, fmt: (v) => `${v} m` },
      { type: 'range', path: 'farm.rotorDiameterM', label: 'Rotor diameter', min: 20, max: 300, step: 2, fmt: (v) => `${v} m` },
      { type: 'range', path: 'farm.rpm', label: 'Rated rotor speed', min: 2, max: 40, step: 0.5, fmt: (v) => `${v} rpm` },
      { type: 'note', id: 'tip-note' },
    ] },
    { group: 'Structure', fields: [
      { type: 'range', path: 'farm.towerBaseDiameterM', label: 'Tower diameter at base', min: 1, max: 14, step: 0.1, fmt: (v) => `${v.toFixed(1)} m` },
      { type: 'range', path: 'farm.towerTopDiameterM', label: 'Tower diameter at nacelle', min: 0.8, max: 10, step: 0.1, fmt: (v) => `${v.toFixed(1)} m` },
      { type: 'range', path: 'farm.bladeChordM', label: 'Blade chord (width)', min: 0.3, max: 8, step: 0.1, fmt: (v) => `${v.toFixed(1)} m` },
      { type: 'range', path: 'farm.bladeCount', label: 'Blades per rotor', min: 1, max: 5, step: 1, fmt: (v) => `${v}` },
      { type: 'note', id: 'structure-note' },
      { type: 'hint', text: 'Tower diameter sets how much of the first Fresnel zone the tower blocks, so '
        + 'it changes the shadow a turbine casts. Blade chord and count set rotor solidity, which is how '
        + 'much of the swept disc is actually blade rather than air.' },
    ] },
    { group: 'Materials', fields: [
      { type: 'select', path: 'farm.construction', label: 'Blade construction', options: opts(BLADE_CONSTRUCTIONS) },
      { type: 'note', id: 'construction-note' },
      { type: 'select', path: 'farm.towerMaterial', label: 'Tower', options: opts(TOWER_MATERIALS) },
      { type: 'note', id: 'tower-material-note' },
      { type: 'select', path: 'farm.drivetrain', label: 'Drivetrain', options: opts(DRIVETRAINS) },
      { type: 'note', id: 'drivetrain-note' },
      { type: 'hint', text: 'A glass-fibre blade shell is largely transparent at microwave '
        + 'frequencies: the radar sees through it. What returns the signal is the conductive structure '
        + 'inside, mainly the carbon spar caps and the lightning protection system. The tower is '
        + 'reported as the dominant scatterer at all aspects, which is why treating only the blades '
        + 'does not solve the problem. These deltas are indicative and are applied on top of the RCS '
        + 'values below, where you can see and override them.' },
    ] },
    { group: 'Radar cross-section (assumed)', fields: [
      { type: 'range', path: 'farm.towerRcsDbsm', label: 'Tower and nacelle', min: 5, max: 55, step: 1, fmt: (v) => `${v} dBsm` },
      { type: 'range', path: 'farm.bladeRcsDbsm', label: 'Blades, rotor face-on', min: -5, max: 50, step: 1, fmt: (v) => `${v} dBsm` },
      { type: 'range', path: 'farm.bladeRcsEdgeOnDbsm', label: 'Blades, rotor edge-on', min: -5, max: 50, step: 1, fmt: (v) => `${v} dBsm` },
      { type: 'note', id: 'rcs-ceiling-note' },
      { type: 'range', path: 'farm.nacelleRcsDbsm', label: 'Nacelle, broadside', min: 0, max: 50, step: 1, fmt: (v) => `${v} dBsm` },
      { type: 'range', path: 'farm.nacelleRcsHeadOnDbsm', label: 'Nacelle, head-on', min: -5, max: 45, step: 1, fmt: (v) => `${v} dBsm` },
      { type: 'note', id: 'nacelle-note' },
      { type: 'hint', text: 'CAP 764 states that no standard RCS can be identified for wind turbines, because too '
        + 'many factors affect it. These defaults sit inside the 20 to 45 dBsm range reported in the open '
        + 'literature and exist only so the tool starts somewhere. Replace them with figures for your machine '
        + 'at your radar frequency before drawing a conclusion. Blade RCS is interpolated between the '
        + 'face-on and edge-on values by the sine squared of the rotor aspect angle; leaving them equal '
        + 'gives an aspect-independent RCS.' },
    ] },
    { group: 'Layout', fields: [
      { type: 'select', path: 'farm.layout', label: 'Arrangement', options: [
        { value: 'grid', label: 'Grid' }, { value: 'line', label: 'Single line' },
        { value: 'cluster', label: 'Cluster' }, { value: 'arc', label: 'Arc' },
      ] },
      { type: 'range', path: 'farm.count', label: 'Turbines', min: 1, max: 60, step: 1, fmt: (v) => `${v}` },
      { type: 'range', path: 'farm.rows', label: 'Rows (grid)', min: 1, max: 8, step: 1, fmt: (v) => `${v}` },
      { type: 'range', path: 'farm.spacingM', label: 'Along-row spacing', min: 200, max: 3000, step: 25, fmt: (v) => `${v} m` },
      { type: 'range', path: 'farm.rowSpacingM', label: 'Row spacing', min: 200, max: 3000, step: 25, fmt: (v) => `${v} m` },
      { type: 'range', path: 'farm.arrayBearingDeg', label: 'Array orientation', min: 0, max: 179, step: 1, fmt: (v) => `${v}°` },
      { type: 'check', path: 'farm.constrained', label: 'Let the ground decide the layout',
        note: 'Real layouts are irregular because siting depends on what is under the tower: '
          + 'bearing capacity, peat depth, slope, watercourses, access tracks and setbacks. '
          + 'Positions failing the slope or ground-level test are moved to the nearest buildable '
          + 'spot, or dropped.' },
      { type: 'range', path: 'farm.maxSlopeDeg', label: 'Maximum buildable slope', min: 3, max: 30, step: 1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'farm.minSpacingM', label: 'Minimum spacing', min: 100, max: 1200, step: 25, fmt: (v) => `${v} m` },
      { type: 'range', path: 'farm.minGroundLevelM', label: 'Minimum ground level', min: 0, max: 400, step: 5, fmt: (v) => `${v} m AMSL` },
      { type: 'note', id: 'placement-note' },
    ] },
    { group: 'Siting', fields: [
      { type: 'range', path: 'farm.centreRangeM', label: 'Distance from radar', min: 500, max: 60000, step: 250,
        fmt: (v) => `${(v / 1000).toFixed(2)} km` },
      { type: 'range', path: 'farm.centreBearingDeg', label: 'Bearing from radar', min: 0, max: 359, step: 1, fmt: (v) => `${String(v).padStart(3, '0')}°` },
      { type: 'range', path: 'farm.windFromDeg', label: 'Wind from', min: 0, max: 359, step: 5, fmt: (v) => `${String(v).padStart(3, '0')}°` },
      { type: 'note', id: 'aspect-note' },
    ] },
  ],

  terrain: [
    { group: 'Propagation and weather', fields: [
      { type: 'select', path: 'weather.refractionPreset', label: 'Refraction condition',
        options: [...opts(REFRACTION_PRESETS), { value: 'custom', label: 'Custom k-factor' }], preset: 'refraction' },
      { type: 'note', id: 'refraction-note' },
      { type: 'range', path: 'environment.kFactor', label: 'Effective earth radius factor', min: 0.6, max: 5.0, step: 0.01,
        fmt: (v) => `k = ${v.toFixed(2)}` },
      { type: 'note', id: 'k-note' },
      { type: 'range', path: 'weather.atmosphericLossDbPerKm', label: 'Atmospheric loss (two-way)', min: 0, max: 0.5, step: 0.005,
        fmt: (v) => `${v.toFixed(3)} dB/km` },
      { type: 'range', path: 'weather.rainRateMmH', label: 'Rain rate (recorded only)', min: 0, max: 100, step: 1, fmt: (v) => `${v} mm/h` },
      { type: 'hint', text: 'Gaseous absorption and rain are taken together as a single loss figure you '
        + 'supply. This tool does not assert ITU-R P.676 or P.838 coefficients it has not read: take the '
        + 'dB/km for your band and conditions from those recommendations and enter it here. Rain rate is '
        + 'recorded in the report for traceability, not modelled separately.' },
      { type: 'hint', text: 'k = 4/3 is the standard-atmosphere value. Run k = 1.0 and lower to check whether a '
        + 'masking argument survives sub-refractive conditions; run higher for ducting.' },
    ] },
    { group: 'Terrain', fields: [
      { type: 'select', path: 'environment.terrain.preset', label: 'Landform', options: opts(TERRAIN_PRESETS), preset: 'terrain' },
      { type: 'range', path: 'environment.terrain.relief', label: 'Relief', min: 0, max: 1200, step: 10, fmt: (v) => `${v} m` },
      { type: 'range', path: 'environment.terrain.featureSize', label: 'Landform scale', min: 800, max: 12000, step: 100,
        fmt: (v) => `${(v / 1000).toFixed(1)} km` },
      { type: 'range', path: 'environment.terrain.baseHeight', label: 'Base elevation', min: 0, max: 800, step: 5, fmt: (v) => `${v} m AMSL` },
      { type: 'number', path: 'environment.terrain.seed', label: 'Seed', step: 1 },
      { type: 'hint', text: 'Synthetic terrain. Useful for understanding how masking behaves; worthless as evidence '
        + 'about a real site. A real assessment needs real elevation data.' },
    ] },
    { group: 'Screening ridge', fields: [
      { type: 'check', path: 'environment.terrain.ridge.enabled', label: 'Add a screening ridge',
        note: 'Terrain masking is the one mitigation that costs the radar nothing. Put a ridge between the radar '
          + 'and the farm and watch the findings change.' },
      { type: 'range', path: 'environment.terrain.ridge.distanceM', label: 'Distance from radar', min: 500, max: 40000, step: 250,
        fmt: (v) => `${(v / 1000).toFixed(2)} km` },
      { type: 'range', path: 'environment.terrain.ridge.bearingFromRadarDeg', label: 'Bearing from radar', min: 0, max: 359, step: 1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'environment.terrain.ridge.orientationDeg', label: 'Ridge orientation', min: 0, max: 179, step: 1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'environment.terrain.ridge.height', label: 'Ridge height', min: 20, max: 900, step: 10, fmt: (v) => `${v} m` },
      { type: 'range', path: 'environment.terrain.ridge.halfWidth', label: 'Ridge half-width', min: 100, max: 3000, step: 50, fmt: (v) => `${v} m` },
      { type: 'range', path: 'environment.terrain.ridge.length', label: 'Ridge length', min: 2000, max: 40000, step: 500,
        fmt: (v) => `${(v / 1000).toFixed(1)} km` },
    ] },
  ],

  flight: [
    { group: 'Reference target', fields: [
      { type: 'select', path: 'target.preset', label: 'Aircraft type', preset: 'target',
        groups: TARGET_GROUPS, options: Object.entries(TARGET_PRESETS)
          .map(([k, v]) => ({ value: k, label: v.label, group: v.group })) },
      { type: 'note', id: 'target-note' },
      { type: 'range', path: 'target.rcsDbsm', label: 'Target RCS', min: -20, max: 30, step: 1, fmt: (v) => `${v} dBsm` },
      { type: 'range', path: 'target.speedKt', label: 'Groundspeed', min: 30, max: 500, step: 5, fmt: (v) => `${v} kt` },
      { type: 'range', path: 'target.samples', label: 'Track samples', min: 20, max: 400, step: 10, fmt: (v) => `${v}` },
    ] },
    { group: 'Profile', fields: [
      { type: 'select', path: 'target.profile', label: 'Flight profile', options: [
        { value: 'approach', label: 'Instrument approach (3° descent)' },
        { value: 'transit', label: 'Level transit' },
        { value: 'orbit', label: 'Holding orbit' },
      ] },
      { type: 'range', path: 'target.altitudeFt', label: 'Altitude', min: 200, max: 25000, step: 100, fmt: (v) => `${v} ft` },
      { type: 'range', path: 'target.endAltitudeFt', label: 'End altitude (transit)', min: 200, max: 25000, step: 100, fmt: (v) => `${v} ft` },
      { type: 'note', id: 'profile-note' },
    ] },
    { group: 'Transit geometry', fields: [
      { type: 'range', path: 'target.startRangeM', label: 'Start range', min: 1000, max: 80000, step: 500,
        fmt: (v) => `${(v / 1000).toFixed(1)} km` },
      { type: 'range', path: 'target.startBearingDeg', label: 'Start bearing', min: 0, max: 359, step: 1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'target.endRangeM', label: 'End range', min: 1000, max: 80000, step: 500,
        fmt: (v) => `${(v / 1000).toFixed(1)} km` },
      { type: 'range', path: 'target.endBearingDeg', label: 'End bearing', min: 0, max: 359, step: 1, fmt: (v) => `${v}°` },
    ] },
    { group: 'Approach geometry', fields: [
      { type: 'range', path: 'target.thresholdRangeM', label: 'Threshold range from radar', min: 200, max: 30000, step: 100,
        fmt: (v) => `${(v / 1000).toFixed(2)} km` },
      { type: 'range', path: 'target.thresholdBearingDeg', label: 'Threshold bearing', min: 0, max: 359, step: 1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'target.glideslopeDeg', label: 'Glideslope', min: 2, max: 6, step: 0.1, fmt: (v) => `${v}°` },
      { type: 'range', path: 'target.approachStartRangeM', label: 'Final approach length', min: 5000, max: 60000, step: 1000,
        fmt: (v) => `${(v / 1000).toFixed(0)} km` },
      { type: 'hint', text: 'The aircraft flies inbound on the reciprocal of the threshold bearing, so set the '
        + 'threshold on the opposite side of the radar from the farm to fly an approach over it.' },
    ] },
  ],

  site: [
    { group: 'Where the site is', fields: [
      { type: 'select', path: 'site.environment', label: 'Surface between radar and farm', options: [
        { value: 'onshore', label: 'Onshore (land)' },
        { value: 'offshore', label: 'Offshore (sea)' },
      ] },
      { type: 'note', id: 'site-note' },
      { type: 'number', path: 'site.originLat', label: 'Site origin latitude (deg)', step: 0.0001 },
      { type: 'number', path: 'site.originLon', label: 'Site origin longitude (deg)', step: 0.0001 },
      { type: 'number', path: 'site.radarEasting', label: 'Radar easting (grid)', step: 1 },
      { type: 'number', path: 'site.radarNorthing', label: 'Radar northing (grid)', step: 1 },
      { type: 'hint', text: 'These place imported data. A schedule in eastings and northings is read '
        + 'relative to the radar grid position; a schedule in latitude and longitude is projected about '
        + 'the site origin. The projection is equirectangular, accurate to well under a metre over these '
        + 'distances, and is NOT a national grid transformation.' },
    ] },
    { group: 'Real UK sites', fields: [
      { type: 'uk-picker', id: 'uk-picker' },
      { type: 'hint', text: 'Wind farm records come from the UK Renewable Energy Planning Database, '
        + 'Crown copyright under the Open Government Licence, reached through a third-party snapshot '
        + 'because data.gov.uk is not available from here. Each row is one PLANNING RECORD with one '
        + 'point: not a turbine position, and measured 1,141 m out at the one site where this tool has '
        + 'real coordinates. Two thirds of the records are projects that were refused, withdrawn or '
        + 'abandoned, which is why the status filter defaults to the live pipeline. Radar positions come '
        + 'from two community aviation sources that disagree with each other by a median of 1.4 km. NO '
        + 'military radar is included. Use this to set up a realistic geometry quickly, not to assess a '
        + 'real application.' },
    ] },
    { group: 'Import real data', fields: [
      { type: 'action', id: 'import-turbines', label: 'Turbine schedule', button: 'Choose .xlsx or .csv',
        note: 'Reads ID, position, ground level, hub height, rotor diameter, tip height, rotor speed and '
          + 'tower dimensions. Title blocks above the table are skipped automatically.' },
      { type: 'action', id: 'import-terrain', label: 'Elevation data', button: 'Choose .xlsx or .csv',
        note: 'Point elevations as easting/northing/level or latitude/longitude/level. Replaces the '
          + 'synthetic surface entirely.' },
      { type: 'note', id: 'import-status' },
      { type: 'action', id: 'clear-imports', label: 'Imported data', button: 'Clear and return to synthetic' },
      { type: 'hint', text: 'Nothing is uploaded. Files are parsed in the page. Sample files showing the '
        + 'expected shape are in the samples folder of the repository.' },
    ] },
    { group: 'Sea surface', fields: [
      { type: 'check', path: 'site.waveFromWind', label: 'Derive wave height from wind speed',
        note: 'Fully developed sea. Real sites are fetch and duration limited, so measured or hindcast '
          + 'wave data is better where you have it.' },
      { type: 'range', path: 'site.significantWaveHeightM', label: 'Significant wave height', min: 0, max: 12, step: 0.1, fmt: (v) => `${v.toFixed(1)} m` },
      { type: 'note', id: 'sea-state-note' },
      { type: 'check', path: 'site.multipath.enabled', label: 'Model surface multipath',
        note: 'Direct and surface-reflected rays interfering. A calm sea is a good mirror and puts deep '
          + 'nulls in low-level coverage; a rough sea washes the lobing out.' },
      { type: 'check', path: 'site.seaClutter.enabled', label: 'Model sea clutter' },
      { type: 'range', path: 'site.seaClutter.sigmaZeroRefDb', label: 'Reference sigma-zero', min: -70, max: -25, step: 1, fmt: (v) => `${v} dB` },
      { type: 'range', path: 'site.seaClutter.maxRejectionDb', label: 'Max clutter rejection', min: 5, max: 50, step: 1, fmt: (v) => `${v} dB` },
      { type: 'hint', text: 'Sigma-zero here is parametric: the reference value applies at 1 degree '
        + 'grazing, sea state 3, 3 GHz, and is scaled from there. It is a starting point, not authority. '
        + 'Take it from a validated model or measured data for the band and polarisation you are '
        + 'assessing.' },
    ] },
  ],

  wind: [
    { group: 'Condition being assessed', fields: [
      { type: 'range', path: 'wind.directionDeg', label: 'Wind from', min: 0, max: 359, step: 5, fmt: (v) => `${String(v).padStart(3, '0')}\u00b0` },
      { type: 'range', path: 'wind.speedMs', label: 'Wind speed', min: 0, max: 32, step: 0.5, fmt: (v) => `${v} m/s` },
      { type: 'note', id: 'wind-state-note' },
      { type: 'range', path: 'wind.yawMisalignDeg', label: 'Yaw misalignment', min: -30, max: 30, step: 1, fmt: (v) => `${v}\u00b0` },
      { type: 'note', id: 'fleet-note' },
      { type: 'hint', text: 'Turbines yaw to face into the wind, so direction sets the angle between the '
        + 'radar line of sight and the rotor axis, and peak blade Doppler goes as the sine of that angle. '
        + 'A rotor pointed at the radar shows almost no blade Doppler; one edge-on shows all of it.' },
    ] },
    { group: 'Turbine control envelope', fields: [
      { type: 'range', path: 'wind.cutInMs', label: 'Cut-in wind speed', min: 1, max: 8, step: 0.5, fmt: (v) => `${v} m/s` },
      { type: 'range', path: 'wind.ratedMs', label: 'Rated wind speed', min: 7, max: 20, step: 0.5, fmt: (v) => `${v} m/s` },
      { type: 'range', path: 'wind.cutOutMs', label: 'Cut-out wind speed', min: 15, max: 35, step: 1, fmt: (v) => `${v} m/s` },
      { type: 'range', path: 'wind.idleFraction', label: 'Idle speed when not generating', min: 0, max: 0.4, step: 0.02, fmt: (v) => `${(v * 100).toFixed(0)}% of rated` },
      { type: 'note', id: 'tsr-note' },
    ] },
    { group: 'Fleet state', fields: [
      { type: 'check', path: 'wind.fleet.wakes', label: 'Model wakes across the array',
        note: 'A turbine downstream of another sees slower air, so it turns slower and produces less '
          + 'blade Doppler. The array presents a spread, not one signature.' },
      { type: 'range', path: 'wind.fleet.yawDeadbandDeg', label: 'Yaw deadband', min: 0, max: 25, step: 1, fmt: (v) => `\u00b1${v}\u00b0` },
      { type: 'range', path: 'wind.fleet.availabilityPct', label: 'Availability', min: 70, max: 100, step: 1, fmt: (v) => `${v}%` },
      { type: 'range', path: 'wind.fleet.curtailedPct', label: 'Curtailed', min: 0, max: 50, step: 1, fmt: (v) => `${v}%` },
      { type: 'number', path: 'wind.fleet.seed', label: 'Fleet state seed', step: 1 },
      { type: 'hint', text: 'Turbines are stopped for maintenance, faults, grid constraints, and '
        + 'curtailment for noise, shadow flicker, bats or icing. A parked rotor produces no blade '
        + 'Doppler at all, which makes it a different radar target from a turning one, though it is '
        + 'still a large structure. The seed selects which machines are stopped, reproducibly.' },
    ] },
    { group: 'Wind climate', fields: [
      { type: 'select', path: 'wind.rosePreset', label: 'Wind rose', options: opts(WIND_ROSE_PRESETS), preset: 'rose' },
      { type: 'range', path: 'wind.weibullK', label: 'Weibull shape k', min: 1.2, max: 3.2, step: 0.1, fmt: (v) => `k = ${v.toFixed(1)}` },
      { type: 'action', id: 'run-rose', label: 'Sweep every direction', button: 'Run wind rose sweep' },
      { type: 'note', id: 'rose-note' },
      { type: 'hint', text: 'The single-condition view answers what happens in this wind. The sweep '
        + 'answers how often it happens across the whole climate, and which direction is worst. The '
        + 'roses here are illustrative shapes, not site data.' },
    ] },
  ],

  mitigation: [
    { mit: 'ram', title: 'Radar-absorbent blade treatment', path: 'mitigation.ram.enabled',
      note: 'Reduces turbine RCS by a fixed amount at every aspect and frequency.',
      fields: [
        { type: 'range', path: 'mitigation.ram.reductionDb', label: 'Assumed RCS reduction', min: 2, max: 30, step: 1, fmt: (v) => `${v} dB` },
        { type: 'hint', text: 'Whatever you type here is applied uniformly. Real absorbent treatment is narrowband '
          + 'and aspect-dependent, and has to survive erosion, lightning protection and a 25-year life. Unproven '
          + 'until demonstrated at your frequency.' },
      ] },
    { mit: 'enhancedDoppler', title: 'Enhanced Doppler processing', path: 'mitigation.enhancedDoppler.enabled',
      note: 'Extra rejection of spectrally spread blade returns, on top of the basic clutter filter.',
      fields: [
        { type: 'range', path: 'mitigation.enhancedDoppler.gainDb', label: 'Additional rejection', min: 3, max: 35, step: 1, fmt: (v) => `${v} dB` },
      ] },
    { mit: 'blanking', title: 'Sector blanking', path: 'mitigation.blanking.enabled',
      note: 'Suppresses all plots in a range/azimuth volume over the farm, real aircraft included.',
      fields: [
        { type: 'check', path: 'mitigation.blanking.autoFit', label: 'Fit the sector to the farm automatically' },
        { type: 'range', path: 'mitigation.blanking.marginM', label: 'Range margin', min: 0, max: 8000, step: 250, fmt: (v) => `${v} m` },
        { type: 'range', path: 'mitigation.blanking.marginDeg', label: 'Azimuth margin', min: 0, max: 15, step: 0.5, fmt: (v) => `${v}°` },
        { type: 'hint', text: 'Watch the coverage hole this creates on the plan display and in the findings. '
          + 'Blanking does not solve the problem, it moves it.' },
      ] },
    { mit: 'naiz', title: 'Non-automatic initiation zone', path: 'mitigation.naiz.enabled',
      note: 'The tracker will not start a new track inside the zone; an established track coasts through.',
      fields: [
        { type: 'range', path: 'mitigation.naiz.marginM', label: 'Range margin', min: 0, max: 12000, step: 250, fmt: (v) => `${v} m` },
        { type: 'range', path: 'mitigation.naiz.marginDeg', label: 'Azimuth margin', min: 0, max: 20, step: 0.5, fmt: (v) => `${v}°` },
      ] },
    { mit: 'infill', title: 'In-fill radar', path: 'mitigation.infill.enabled',
      note: 'A second sensor covering the airspace the primary cannot see.',
      fields: [
        { type: 'range', path: 'mitigation.infill.rangeM', label: 'Distance from primary', min: 1000, max: 50000, step: 500,
          fmt: (v) => `${(v / 1000).toFixed(1)} km` },
        { type: 'range', path: 'mitigation.infill.bearingDeg', label: 'Bearing from primary', min: 0, max: 359, step: 1, fmt: (v) => `${v}°` },
        { type: 'range', path: 'mitigation.infill.heightAgl', label: 'Antenna height', min: 3, max: 90, step: 1, fmt: (v) => `${v} m AGL` },
        { type: 'range', path: 'mitigation.infill.gainDbi', label: 'Antenna gain', min: 20, max: 45, step: 0.5, fmt: (v) => `${v} dBi` },
        { type: 'range', path: 'mitigation.infill.peakPowerW', label: 'Peak power', min: 1000, max: 100000, step: 1000,
          fmt: (v) => `${(v / 1000).toFixed(0)} kW` },
        { type: 'range', path: 'mitigation.infill.instrumentedRangeM', label: 'Instrumented range', min: 5000, max: 120000, step: 5000,
          fmt: (v) => `${(v / 1000).toFixed(0)} km` },
        { type: 'hint', text: 'An in-fill only helps if it sees what the primary cannot AND is not itself corrupted '
          + 'by the same farm. Check its own turbine returns before calling this solved.' },
      ] },
    { mit: 'curtail', title: 'Turbine curtailment', path: 'mitigation.curtail.enabled',
      note: 'Rotors stopped. The theoretical best case: it shows how much of the problem is rotation rather than '
        + 'structure. Rarely operationally acceptable, because it removes the generation.',
      fields: [] },
  ],
};

// ---------------------------------------------------------------- rail build

export function buildRail(container, tab, scenario, onChange, onPreset) {
  container.innerHTML = '';
  const spec = TABS[tab] || [];
  const noteEls = {};

  for (const block of spec) {
    if (block.mit) {
      const wrap = document.createElement('div');
      wrap.className = 'mit-block';
      const on = !!getPath(scenario, block.path);
      wrap.classList.toggle('is-on', on);

      const head = document.createElement('label');
      head.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = on;
      cb.addEventListener('change', () => {
        setPath(scenario, block.path, cb.checked);
        wrap.classList.toggle('is-on', cb.checked);
        onChange();
      });
      const txt = document.createElement('span');
      txt.innerHTML = `<strong>${block.title}</strong><span class="check-note">${block.note}</span>`;
      head.append(cb, txt);
      wrap.append(head);

      if (block.fields.length) {
        const body = document.createElement('div');
        body.className = 'mit-body';
        for (const f of block.fields) body.append(makeField(f, scenario, onChange, onPreset, noteEls));
        wrap.append(body);
      }
      container.append(wrap);
      continue;
    }

    const g = document.createElement('section');
    g.className = 'group';
    const h = document.createElement('h3');
    h.textContent = block.group;
    g.append(h);
    for (const f of block.fields) g.append(makeField(f, scenario, onChange, onPreset, noteEls));
    container.append(g);
  }
  return noteEls;
}

// The picker writes several scenario fields at once (range, bearing, origin,
// and the land/sea surface), so the rail has to be rebuilt or those controls
// show stale values. A rebuild destroys the picker, so it remembers what was
// selected and puts it back.
const ukPickerState = { scope: 'live', farm: '', radar: '' };

function makeField(f, scenario, onChange, onPreset, noteEls) {
  if (f.type === 'hint') {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = f.text;
    return p;
  }

  if (f.type === 'note') {
    const p = document.createElement('p');
    p.className = 'hint';
    p.dataset.note = f.id;
    noteEls[f.id] = p;
    return p;
  }

  if (f.type === 'derived') {
    const label = document.createElement('label');
    label.className = 'field';
    const head = document.createElement('span');
    head.className = 'field-label';
    const name = document.createElement('span');
    name.textContent = f.label;
    const val = document.createElement('span');
    val.className = 'val';
    head.append(name, val);
    label.append(head);

    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = f.min; inp.max = f.max; inp.step = f.step;
    const show = () => {
      const actual = f.read(scenario);
      inp.value = actual;
      val.textContent = f.fmt(actual);
    };
    show();
    inp.addEventListener('input', () => {
      // write() returns what was actually achieved, which can differ from what
      // was asked for when a physical constraint bites.
      const achieved = f.write(scenario, Number(inp.value));
      val.textContent = f.fmt(achieved);
      if (Math.abs(achieved - Number(inp.value)) > 0.5) inp.value = achieved;
      onChange();
    });
    label.append(inp);
    return label;
  }

  if (f.type === 'uk-picker') {
    const wrap = document.createElement('div');
    wrap.className = 'field action-field';
    const head = document.createElement('span');
    head.className = 'field-label';
    head.innerHTML = '<span>Place a real pairing</span>'
      + `<span class="field-value">${UK_WIND_FARMS.length} farms, ${UK_RADAR_SITES.length} radar sites</span>`;
    wrap.append(head);

    // Most rows in the planning database are NOT wind farms: they are projects
    // that were refused, withdrawn or abandoned. Default to the ones that exist
    // or are expected to, and make including the rest a deliberate act.
    const scopeSel = document.createElement('select');
    scopeSel.style.width = '100%';
    scopeSel.innerHTML = [
      ['live', 'Built or in the pipeline'],
      ['Operational', 'Operational only'],
      ['Under Construction', 'Under construction only'],
      ['Awaiting Construction', 'Consented, awaiting construction'],
      ['Application Submitted', 'Application submitted'],
      ['all', 'Every record, including refused and abandoned'],
    ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    wrap.append(scopeSel);

    const farmSel = document.createElement('select');
    farmSel.style.width = '100%';
    farmSel.style.marginTop = '6px';
    const fillFarms = () => {
      const scope = scopeSel.value;
      const keep = (r) => (scope === 'all' ? true
        : scope === 'live' ? LIVE_STATUSES.includes(r[4])
          : r[4] === scope);
      const rows = UK_WIND_FARMS
        .map((r, i) => ({ i, name: r[0], mw: r[3], status: r[4], off: r[5] === 1, keep: keep(r) }))
        .filter((r) => r.keep)
        .sort((a, b) => a.name.localeCompare(b.name));
      farmSel.innerHTML = `<option value="">Choose one of ${rows.length} \u2026</option>`
        + rows.map((r) => `<option value="${r.i}">${r.name} \u2014 ${r.mw} MW`
          + `${r.off ? ', offshore' : ''}${scope === 'live' || scope === 'all' ? ` [${r.status}]` : ''}`
          + '</option>').join('');
    };
    scopeSel.value = ukPickerState.scope;
    fillFarms();
    scopeSel.addEventListener('change', () => {
      ukPickerState.scope = scopeSel.value; ukPickerState.farm = '';
      fillFarms(); recompute();
    });
    wrap.append(farmSel);

    const radarSel = document.createElement('select');
    radarSel.style.width = '100%';
    radarSel.style.marginTop = '6px';
    radarSel.innerHTML = '<option value="">Nearest radar (automatic)</option>'
      + UK_RADAR_SITES
        .map((r, i) => [i, r[0], r[1]])
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([i, name, role]) => `<option value="${i}">${name} \u2014 ${role}</option>`)
        .join('');
    wrap.append(radarSel);

    const note = document.createElement('p');
    note.className = 'hint';
    note.style.marginTop = '8px';
    note.textContent = 'Pick a farm to see its true range and bearing to a radar.';
    wrap.append(note);

    const btn = document.createElement('button');
    btn.className = 'btn action-btn';
    btn.type = 'button';
    btn.textContent = 'Place this pairing';
    btn.disabled = true;
    btn.style.marginTop = '8px';
    wrap.append(btn);

    let geom = null;
    const MAX_RANGE_M = 60000; // the distance slider tops out here

    const describe = () => {
      if (!geom) {
        note.textContent = 'Pick a farm to see its true range and bearing to a radar.';
        btn.disabled = true;
        return;
      }
      const km = (geom.rangeM / 1000).toFixed(1);
      const f = geom.farm;
      const parts = [
        `${f.name} \u2014 ${f.mw} MW, ${f.offshore ? 'offshore' : 'onshore'}, `
        + `status ${f.status.toLowerCase()}, REPD reference ${f.repdRef}.`,
        `${km} km from ${geom.radar.name} (${geom.radar.role}) on a bearing of `
        + `${geom.bearingDeg.toFixed(0)}\u00b0 from the radar.`,
      ];
      if (!f.live) {
        parts.push('THIS PROJECT IS NOT BEING BUILT as recorded: the planning database has it as '
          + `${f.status.toLowerCase()}. It is here because you asked to see every record.`);
      }
      if (geom.rangeM > MAX_RANGE_M) {
        parts.push(`The distance control stops at ${MAX_RANGE_M / 1000} km, so this will be placed at `
          + `${MAX_RANGE_M / 1000} km, not ${km} km. The bearing is real; the range is not.`);
      }
      if (geom.radar.disagreementM) {
        parts.push(`The two radar sources put this site ${geom.radar.disagreementM} m apart, `
          + 'so treat the range as good to roughly that.');
      } else if (geom.radar.sources.length === 1) {
        parts.push(`Only one source carries this site (${geom.radar.sources[0]}), so its position is `
          + 'unchecked.');
      }
      if (geom.tangentPlaneWarning) {
        parts.push('Over 100 km the flat-plane geometry this tool draws in is no longer a fair picture '
          + 'of the real surface.');
      }
      // Precision and accuracy, side by side, because the five decimal places in
      // the table invite the reader to believe them.
      const pct = 100 * geom.uncertaintyFraction;
      parts.push(`Position: written to \u00b1${STATED_PRECISION_M} m of PRECISION, measured to about `
        + `\u00b1${POSITION_UNCERTAINTY_M} m of ACCURACY. That is ${pct.toFixed(0)} per cent of this `
        + 'range. The figure comes from the only two sites where this tool has real turbine '
        + 'coordinates: Kelmarsh, where the record sits 1,140 m from the array centre and 695 m from '
        + 'even the nearest machine, and Penmanshiel, 1,121 m from a known turbine.');
      if (pct > 20) {
        parts.push('AT THIS RANGE THE POSITION ERROR IS A LARGE FRACTION OF THE RANGE ITSELF. The '
          + 'geometry below is an illustration of a plausible case, not an assessment of this site. '
          + 'Get the surveyed turbine schedule before reading anything into it.');
      }
      note.textContent = parts.join(' ');
      btn.disabled = false;
    };

    const recompute = () => {
      const fi = farmSel.value === '' ? null : Number(farmSel.value);
      if (fi == null) { geom = null; describe(); return; }
      const ri = radarSel.value === '' ? null : Number(radarSel.value);
      geom = pairingGeometry(fi, ri);
      describe();
    };
    farmSel.addEventListener('change', () => { ukPickerState.farm = farmSel.value; recompute(); });
    radarSel.addEventListener('change', () => { ukPickerState.radar = radarSel.value; recompute(); });
    // Put back whatever was selected before the last rebuild.
    if (ukPickerState.farm && farmSel.querySelector(`option[value="${ukPickerState.farm}"]`)) {
      farmSel.value = ukPickerState.farm;
    }
    radarSel.value = ukPickerState.radar;
    recompute();

    btn.addEventListener('click', () => {
      if (!geom) return;
      scenario.site.originLat = Number(geom.farm.lat.toFixed(4));
      scenario.site.originLon = Number(geom.farm.lon.toFixed(4));
      scenario.farm.centreBearingDeg = Math.round(geom.bearingDeg);
      scenario.farm.centreRangeM = Math.round(Math.min(geom.rangeM, MAX_RANGE_M) / 250) * 250;
      // Land or sea now comes from the data rather than being left to the user.
      scenario.site.environment = geom.farm.offshore ? 'offshore' : 'onshore';
      scenario.farm.ukPairing = {
        farm: geom.farm.name, radar: geom.radar.name, role: geom.radar.role,
        status: geom.farm.status, offshore: geom.farm.offshore, repdRef: geom.farm.repdRef,
        trueRangeM: Math.round(geom.rangeM), clamped: geom.rangeM > MAX_RANGE_M,
        uncertaintyM: geom.uncertaintyM,
        uncertaintyFraction: geom.uncertaintyFraction,
      };
      onChange();
      // Deferred so this handler finishes before its own element is replaced.
      setTimeout(() => wrap.dispatchEvent(new CustomEvent('rail-rebuild', { bubbles: true })), 0);
    });

    const mil = document.createElement('p');
    mil.className = 'hint';
    mil.style.marginTop = '8px';
    mil.textContent = 'Military air defence radar is absent from both sources and from this tool. '
      + UK_MILITARY_RADAR_NOTE.caution
      + ' Sites named in search results, unverified: '
      + UK_MILITARY_RADAR_NOTE.sites.map((x) => x.name).join(', ') + '.';
    wrap.append(mil);

    return wrap;
  }

  if (f.type === 'action') {
    const wrap = document.createElement('div');
    wrap.className = 'field action-field';
    const head = document.createElement('span');
    head.className = 'field-label';
    head.innerHTML = `<span>${f.label}</span>`;
    wrap.append(head);
    const btn = document.createElement('button');
    btn.className = 'btn action-btn';
    btn.type = 'button';
    btn.textContent = f.button;
    btn.dataset.action = f.id;
    wrap.append(btn);
    if (f.note) {
      const n = document.createElement('p');
      n.className = 'hint';
      n.style.marginTop = '6px';
      n.textContent = f.note;
      wrap.append(n);
    }
    return wrap;
  }

  if (f.type === 'check') {
    const label = document.createElement('label');
    label.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!getPath(scenario, f.path);
    cb.addEventListener('change', () => { setPath(scenario, f.path, cb.checked); onChange(); });
    const span = document.createElement('span');
    span.innerHTML = f.note ? `${f.label}<span class="check-note">${f.note}</span>` : f.label;
    label.append(cb, span);
    return label;
  }

  const label = document.createElement('label');
  label.className = 'field';
  const head = document.createElement('span');
  head.className = 'field-label';
  const name = document.createElement('span');
  name.textContent = f.label;
  const val = document.createElement('span');
  val.className = 'val';
  head.append(name, val);
  label.append(head);

  if (f.type === 'select') {
    val.remove();
    const sel = document.createElement('select');
    if (f.groups) {
      for (const g of f.groups) {
        const og = document.createElement('optgroup');
        og.label = g;
        for (const o of f.options.filter((x) => x.group === g)) {
          const opt = document.createElement('option');
          opt.value = String(o.value);
          opt.textContent = o.label;
          og.append(opt);
        }
        sel.append(og);
      }
    } else {
      for (const o of f.options) {
        const opt = document.createElement('option');
        opt.value = String(o.value);
        opt.textContent = o.label;
        sel.append(opt);
      }
    }
    sel.value = String(getPath(scenario, f.path));
    sel.addEventListener('change', () => {
      const v = f.numeric ? Number(sel.value) : sel.value;
      if (f.preset && onPreset) onPreset(f.preset, v);
      else { setPath(scenario, f.path, v); onChange(); }
    });
    label.append(sel);
    return label;
  }

  if (f.type === 'number') {
    val.remove();
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = f.step ?? 1;
    inp.value = getPath(scenario, f.path);
    inp.addEventListener('change', () => { setPath(scenario, f.path, Number(inp.value)); onChange(); });
    label.append(inp);
    return label;
  }

  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = f.min; inp.max = f.max; inp.step = f.step;
  const current = Number(getPath(scenario, f.path));
  inp.value = current;
  val.textContent = f.fmt ? f.fmt(current) : String(current);
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    val.textContent = f.fmt ? f.fmt(v) : String(v);
    setPath(scenario, f.path, v);
    onChange();
  });
  label.append(inp);
  return label;
}

// --------------------------------------------------------------- live notes

export function updateNotes(noteEls, result, extra = {}) {
  if (!result) return;
  const r = result.radar;
  const set = (id, text) => { if (noteEls[id]) noteEls[id].textContent = text; };

  set('radar-note', RADAR_PRESETS[r.preset]
    ? `${RADAR_PRESETS[r.preset].note} Values are representative, not from a datasheet.`
    : 'Custom parameters.');

  set('waveform-note',
    `Range resolution ${r.rangeResolutionM.toFixed(0)} m · unambiguous range `
    + `${(r.unambiguousRangeM / 1000).toFixed(0)} km · first blind speed `
    + `${r.firstBlindSpeedMs.toFixed(1)} m/s (${(r.firstBlindSpeedMs / 0.514444).toFixed(0)} kt) · `
    + `${r.pulsesPerScan.toFixed(0)} pulses on target per scan.`);

  set('threshold-note',
    `Required single-pulse SNR ${r.requiredSnrDb.toFixed(1)} dB`
    + (r.albersheimValid ? '.' : '. WARNING: outside the validity range of the approximation used.'));

  const farm = result.scenario.farm;
  const tip = tipHeightOf(farm);
  const clearance = groundClearanceOf(farm);
  const maxTip = result.turbineResults.reduce((a, t) => Math.max(a, t.vTipMs), 0);
  set('tip-note', `Tip ${tip.toFixed(0)} m, hub ${farm.hubHeightM.toFixed(0)} m, rotor `
    + `${farm.rotorDiameterM.toFixed(0)} m, ground clearance ${clearance.toFixed(0)} m. `
    + `Tip speed ${maxTip.toFixed(0)} m/s (${(maxTip / 0.514444).toFixed(0)} kt), peak blade Doppler `
    + `${result.summary.maxDopplerHz.toFixed(0)} Hz.`
    + (tip > 200 ? ' Above the ~200 m that is typical onshore today.' : ''));

  const aspects = result.turbineResults.map((t) => t.aspectDeg);
  set('aspect-note', aspects.length
    ? `Rotor aspect to radar ${Math.min(...aspects).toFixed(0)}° to ${Math.max(...aspects).toFixed(0)}° off face-on. `
      + '0° means the rotor faces the radar and shows almost no blade Doppler; 90° means it is edge-on and shows all of it.'
    : '');

  set('k-note', `Surface horizon for a ${r.heightAgl} m antenna: ${(r.horizonM / 1000).toFixed(1)} km. `
    + `A ${(result.scenario.farm.hubHeightM + result.scenario.farm.rotorDiameterM / 2).toFixed(0)} m tip is visible to `
    + `${((r.horizonM + Math.sqrt(2 * result.ae * (result.scenario.farm.hubHeightM + result.scenario.farm.rotorDiameterM / 2))) / 1000).toFixed(1)} km over a smooth surface.`);

  // --- site, sea, wind and structure
  const sc = result.scenario;
  const surf = result.surface;
  set('site-note', sc.site.environment === 'offshore'
    ? 'Offshore: no terrain masking, and the sea is a good reflector, so surface multipath and sea '
      + 'clutter are modelled. Ducting is also more common over water.'
    : 'Onshore: terrain masking applies and surface multipath is off by default, because a two-ray '
      + 'model does not describe a rough vegetated surface well.');

  if (surf) {
    set('sea-state-note', sc.site.environment === 'offshore'
      ? `Sea state ${surf.seaState.code} (${surf.seaState.label}), Hs `
        + `${surf.significantWaveHeightM.toFixed(2)} m, RMS surface ${surf.rmsHeightM.toFixed(2)} m. `
        + 'A calmer sea deepens the multipath nulls; a rougher one raises clutter.'
      : 'Sea settings apply only when the site is offshore.');
  }

  const windCfg = sc.wind;
  const st = windState(windCfg.speedMs, windCfg);
  const t0 = result.turbineResults.length ? result.turbineResults[0] : null;
  set('wind-state-note', t0
    ? `${st} \u2014 rotor at ${t0.rpm.toFixed(1)} rpm, tip speed ${t0.vTipMs.toFixed(0)} m/s, `
      + `rotor aspect ${t0.aspectDeg.toFixed(0)}\u00b0 off face-on, peak blade Doppler `
      + `${result.summary.maxDopplerHz.toFixed(0)} Hz.`
    : '');

  const tsr = t0 && t0.ratedTipSpeedMs ? t0.ratedTipSpeedMs / Math.max(windCfg.ratedMs, 0.1) : NaN;
  set('tsr-note', Number.isFinite(tsr)
    ? `Tip-speed ratio at rated: ${tsr.toFixed(1)}. Modern three-blade machines sit around 7 to 9; a `
      + 'figure far outside that usually means rated rpm and rated wind speed came from different machines.'
    : '');

  set('structure-note', `Rotor solidity ${(result.turbines[0]?.solidity * 100 || 0).toFixed(1)}% `
    + `(${sc.farm.bladeCount} blades of ${sc.farm.bladeChordM} m chord across the swept disc). `
    + `Tower tapers ${sc.farm.towerBaseDiameterM} m to ${sc.farm.towerTopDiameterM} m.`);

  set('rcs-ceiling-note', `Specular ceiling for this tower geometry at `
    + `${(r.freqHz / 1e9).toFixed(2)} GHz: ${cylinderRcsDbsm(sc.farm.towerBaseDiameterM / 2, sc.farm.hubHeightM, r.lambdaM).toFixed(0)} dBsm. `
    + 'Assumed values well below that are expected; above it is not physical.');

  const pl = result.turbines.placement;
  set('placement-note', !sc.farm.constrained
    ? 'Off: turbines sit on the nominal layout regardless of the ground under them.'
    : pl
      ? `${result.turbines.length} placed, ${pl.moved.length} moved to buildable ground`
        + `${pl.moved.length ? ` (mean ${(pl.moved.reduce((a, m) => a + m.distanceM, 0) / pl.moved.length).toFixed(0)} m)` : ''}`
        + `, ${pl.rejected.length} dropped as unbuildable.`
      : '');

  const runningCount = result.turbines.filter((t) => t.running).length;
  const dops = result.turbineResults.filter((t) => t.turbine.running).map((t) => t.fdMaxHz);
  set('fleet-note', result.turbines.length
    ? `${runningCount} of ${result.turbines.length} turning. Inflow `
      + `${Math.min(...result.turbines.map((t) => t.inflowMs)).toFixed(1)} to `
      + `${Math.max(...result.turbines.map((t) => t.inflowMs)).toFixed(1)} m/s across the array`
      + (dops.length ? `, blade Doppler ${Math.min(...dops).toFixed(0)} to ${Math.max(...dops).toFixed(0)} Hz.` : '.')
    : '');

  const bc = BLADE_CONSTRUCTIONS[sc.farm.construction];
  set('construction-note', bc
    ? `${bc.note} Applies ${bc.bladeDeltaDb >= 0 ? '+' : ''}${bc.bladeDeltaDb} dB to blade RCS.` : '');
  const tm = TOWER_MATERIALS[sc.farm.towerMaterial];
  set('tower-material-note', tm
    ? `${tm.note} Applies ${tm.towerDeltaDb >= 0 ? '+' : ''}${tm.towerDeltaDb} dB to tower RCS.` : '');

  const dt = DRIVETRAINS[sc.farm.drivetrain];
  set('drivetrain-note', dt
    ? `${dt.note} Applies ${dt.nacelleDeltaDb >= 0 ? '+' : ''}${dt.nacelleDeltaDb} dB to the nacelle.` : '');
  const t1 = result.turbineResults[0];
  set('nacelle-note', t1
    ? `The nacelle cover is transparent, so the generator, gearbox and shafts inside it are `
      + `illuminated. Its specular lobe is broadside, which is the same aspect that maximises blade `
      + `Doppler. At the current aspect of ${t1.aspectDeg.toFixed(0)}\u00b0 the nacelle contributes `
      + `${t1.nacelleAspectDbsm.toFixed(1)} dBsm, against ${sc.farm.towerRcsDbsm} dBsm of tower. No `
      + 'published split between the generator and the rest of the nacelle was found, so they are '
      + 'modelled together.'
    : '');

  const refr = REFRACTION_PRESETS[sc.weather.refractionPreset];
  set('refraction-note', refr
    ? `${refr.note} k = ${refr.k.toFixed(2)}.`
    : 'Custom k-factor: set it directly below.');

  set('import-status', extra.importedTerrain
    ? `Imported terrain active: ${sc.environment.terrain.importMeta?.file || 'file'}, `
      + `${(extra.importedTerrain.coverage * 100).toFixed(0)}% coverage, `
      + `${extra.importedTerrain.min.toFixed(0)} to ${extra.importedTerrain.max.toFixed(0)} m.`
    : (sc.farm.manual ? `${sc.farm.manual.length} imported turbines active. Terrain is still synthetic.`
      : 'No data imported. Terrain is synthetic and the layout is generated.'));

  set('rose-note', extra.roseResult
    ? `Swept: plots present ${(extra.roseResult.exposureWithPlots * 100).toFixed(0)}% of the year, `
      + `track degraded ${(extra.roseResult.exposureUntracked * 100).toFixed(0)}%. Worst direction `
      + `${String(Math.round(extra.roseResult.worstPlots.directionDeg)).padStart(3, '0')}\u00b0.`
    : 'Not swept yet. The single-direction view can easily land on a benign case.');

  const tp = TARGET_PRESETS[sc.target.preset];
  set('target-note', tp
    ? `${tp.group}. Representative RCS for the class, not a figure for any particular aircraft: real `
      + 'values swing by tens of decibels with aspect and frequency, and figures for specific military '
      + 'platforms are controlled. Use it to explore sensitivity, not to assert performance.'
    : '');

  const first = result.points[0];
  const last = result.points[result.points.length - 1];
  set('profile-note', first && last
    ? `Modelled flight: ${(first.geom.ground / 1000).toFixed(1)} km / ${(first.amsl / M_PER_FT).toFixed(0)} ft `
      + `to ${(last.geom.ground / 1000).toFixed(1)} km / ${(last.amsl / M_PER_FT).toFixed(0)} ft, `
      + `${(last.timeS / 60).toFixed(1)} minutes.`
    : '');
}

// ------------------------------------------------------------------- panel

export function renderMetrics(el, result) {
  const s = result.summary;
  const r = result.radar;
  const worst = s.worstPoint;

  const tiles = [
    {
      label: 'Turbine plots per scan',
      value: String(s.displayedPlotCount),
      sub: s.suppressedPlotCount
        ? `${s.suppressedPlotCount} more blanked, not removed`
        : `of ${s.turbineCount} turbines`,
      level: s.displayedPlotCount > 0 ? 'bad' : s.suppressedPlotCount ? 'warn' : 'ok',
    },
    {
      label: 'Track held',
      value: `${(100 * (1 - s.untrackedFraction)).toFixed(0)}%`,
      sub: s.longestGapSeconds > 0 ? `worst gap ${s.longestGapSeconds.toFixed(0)} s` : 'no gaps',
      level: s.untrackedFraction > 0.15 ? 'bad' : s.untrackedFraction > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Worst detection margin',
      value: worst ? `${worst.effectiveMarginDb >= 0 ? '+' : ''}${worst.effectiveMarginDb.toFixed(1)}` : 'n/a',
      sub: 'dB vs threshold',
      level: !worst ? '' : worst.effectiveMarginDb < 0 ? 'bad' : worst.effectiveMarginDb < 3 ? 'warn' : 'ok',
    },
    {
      label: 'In line of sight',
      value: `${s.visibleCount}/${s.turbineCount}`,
      sub: `nearest ${(s.nearestTurbineM / 1000).toFixed(1)} km`,
      level: s.visibleCount === 0 ? 'ok' : s.visibleCount === s.turbineCount ? 'warn' : '',
    },
  ];

  el.innerHTML = tiles.map((t) => `
    <div class="metric"${t.level ? ` data-level="${t.level}"` : ''}>
      <span class="m-label">${t.label}</span>
      <span class="m-value">${t.value}</span>
      <span class="m-sub">${t.sub}</span>
    </div>`).join('');
}

export function renderFindings(el, findings) {
  if (!findings.length) {
    el.innerHTML = '<p class="hint">No findings.</p>';
    return;
  }
  el.innerHTML = findings.map((f, i) => {
    const metrics = f.metrics && Object.keys(f.metrics).length
      ? `<dl class="finding-metrics">${Object.entries(f.metrics)
          .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
      : '';
    const source = f.source ? `<p class="finding-source">${esc(f.source)}</p>` : '';
    const refs = referencesFor(f.id);
    const evidence = refs.length
      ? `<div class="finding-evidence"><span class="ev-label">Evidence</span>${refs.map((r) => `
          <span class="ev-item" title="${esc(STATUS_LABELS[r.status])}">
            <span class="ev-dot" data-status="${r.status}"></span>${esc(r.title.length > 64 ? `${r.title.slice(0, 61)}...` : r.title)}
          </span>`).join('')}</div>`
      : '';
    return `
      <details class="finding" data-sev="${f.severity}"${i < 2 ? ' open' : ''}>
        <summary>
          <span class="sev-tag">${SEVERITY_LABELS[f.severity] || f.severity}</span>
          <span class="finding-title">${esc(f.title)}</span>
        </summary>
        <div class="finding-body">
          <p>${esc(f.detail)}</p>
          ${metrics}
          ${evidence}
          ${source}
          <span class="basis-tag">basis: ${esc(f.basis)}</span>
        </div>
      </details>`;
  }).join('');
}

export function renderTurbineTable(table, result, onHover) {
  const tbody = table.querySelector('tbody');
  const dot = (c) => `<span class="dot" style="background:${c}"></span>`;
  tbody.innerHTML = result.turbineResults.map((t) => {
    const colour = t.visibility === 'masked' ? '#5d6b78'
      : t.falsePlot ? '#e8524a'
        : t.snrEffDb > result.radar.requiredSnrDb - 10 ? '#f0a83a' : '#3fd18b';
    return `<tr data-id="${t.turbine.id}">
      <td>${dot(colour)}${t.turbine.id}</td>
      <td>${(t.hub.ground / 1000).toFixed(2)}</td>
      <td>${t.hub.bearing.toFixed(0).padStart(3, '0')}</td>
      <td>${t.visibility === 'masked' ? 'masked' : t.visibility === 'clear' ? 'clear' : t.visibility}</td>
      <td>${t.aspectDeg.toFixed(0)}&deg;</td>
      <td>${t.fdMaxHz.toFixed(0)}</td>
      <td>${t.snrEffDb.toFixed(1)}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('mouseenter', () => onHover(tr.dataset.id));
    tr.addEventListener('mouseleave', () => onHover(null));
  });
}

export function renderVerdict(chip, text, result) {
  const f = result.findings;
  const crit = f.filter((x) => x.severity === 'critical');
  const major = f.filter((x) => x.severity === 'major');
  if (crit.length) {
    chip.dataset.level = 'critical';
    chip.textContent = `${crit.length} critical`;
    text.textContent = crit[0].title;
  } else if (major.length) {
    chip.dataset.level = 'major';
    chip.textContent = `${major.length} major`;
    text.textContent = major[0].title;
  } else if (f.some((x) => x.severity === 'minor')) {
    chip.dataset.level = 'minor';
    chip.textContent = 'Minor only';
    text.textContent = f.find((x) => x.severity === 'minor').title;
  } else {
    chip.dataset.level = 'info';
    chip.textContent = 'No issues found';
    text.textContent = 'No critical or major issues in this configuration.';
  }
}

export function renderReadout(el, tr, result) {
  if (!tr) {
    el.innerHTML = '<span class="readout-hint">Drag to orbit &middot; scroll to zoom &middot; hover a turbine for its numbers</span>';
    return;
  }
  const t = tr.turbine;
  const rows = [
    ['Ground range', `${(tr.hub.ground / 1000).toFixed(2)} km`],
    ['Slant range', `${(tr.hub.slant / 1000).toFixed(2)} km`],
    ['Bearing', `${tr.hub.bearing.toFixed(1).padStart(5, '0')}°`],
    ['Elevation', `${tr.hub.elevationDeg.toFixed(2)}°`],
    ['Tip height', `${(t.hubHeightM + t.rotorRadiusM).toFixed(0)} m AGL`],
    ['Line of sight', tr.visibility],
    ['Terrain loss', `${tr.terrainLossHubDb.toFixed(1)} dB (2-way)`],
    ['Rotor aspect', `${tr.aspectDeg.toFixed(0)}° off face-on`],
    ['Tip speed', `${tr.vTipMs.toFixed(0)} m/s`],
    ['Peak radial', `${tr.vRadMaxMs.toFixed(0)} m/s`],
    ['Doppler', `${tr.fdMaxHz.toFixed(0)} Hz`],
    ['Folded speed', `${tr.apparentSpeedKt.toFixed(0)} kt`],
    ['Through filter', `${(tr.passFraction * 100).toFixed(0)}%`],
    ['Effective RCS', `${tr.effectiveRcsDbsm.toFixed(1)} dBsm`],
    ['Return', `${tr.snrEffDb.toFixed(1)} dB SNR`],
    ['Above threshold', tr.falsePlot ? 'YES' : 'no'],
  ];
  el.innerHTML = `<h4>${t.id}</h4><dl>${rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

export function renderLegend(el, mode, result) {
  if (mode === 'coverage') {
    el.innerHTML = `
      <h4>Detection margin vs threshold</h4>
      <div class="legend-ramp" style="background:linear-gradient(90deg,#5a1410,#e8524a,#f0a83a,#2f5a46,#3fd18b,#1b3d4a)"></div>
      <div class="legend-scale"><span>-20 dB</span><span>0</span><span>+25 dB</span></div>
      <div class="legend-row" style="margin-top:6px">Shaded at ${(result.coverage ? result.coverage.amsl / M_PER_FT : 0).toFixed(0)} ft, target ${result.scenario.target.rcsDbsm} dBsm</div>`;
    return;
  }
  if (mode === 'delta') {
    el.innerHTML = `
      <h4>Margin lost to the wind farm</h4>
      <div class="legend-ramp" style="background:linear-gradient(90deg,#27313a,#2f4a55,#d9a13a,#e06a3c,#b51f18)"></div>
      <div class="legend-scale"><span>0 dB</span><span>12</span><span>25+ dB</span></div>
      <div class="legend-row" style="margin-top:6px">Difference between this site and the same site with no turbines</div>`;
    return;
  }
  el.innerHTML = `
    <h4>Turbines and track</h4>
    <div class="legend-row"><span class="swatch" style="background:#e8524a"></span>Returns above the detection threshold</div>
    <div class="legend-row"><span class="swatch" style="background:#f0a83a"></span>In sight, below threshold</div>
    <div class="legend-row"><span class="swatch" style="background:#3fd18b"></span>Detected / clear</div>
    <div class="legend-row"><span class="swatch" style="background:#5d6b78"></span>Terrain-masked</div>
    <div class="legend-row"><span class="swatch" style="background:#45b8d8"></span>Radar beam and coverage envelope</div>
    <div class="legend-row"><span class="swatch" style="background:#8d7fe8"></span>Mitigation zone</div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
