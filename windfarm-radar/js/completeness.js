// What a radar record needs before its answer means anything, and what to do
// when it is missing.
//
// The tool always accepted a sparse radar import and quietly fell back to the
// values on the Radar tab, which are representative rather than real. That is
// the right default, but it left no way to tell a site whose numbers came from
// an operator from one where almost everything was assumed, and no way to know
// which missing number to go and chase first.
//
// The ranking here is not an opinion. Each figure is the measured effect on
// the worst detection margin from tools/radar_sensitivity.mjs, recorded in
// docs/RADAR-PARAMETERS-TO-ASK-FOR.md. Sorting by it means the prompt asks for
// antenna height before it asks for pulse repetition frequency, which is the
// difference between a useful request and a shopping list.

/** Ranked by measured effect on the worst detection margin. */
export const RADAR_FIELDS = [
  {
    key: 'antennaHeightM', label: 'Antenna height above ground', unit: 'm',
    tier: 'decides', movesDb: 10.6, error: 'out by 10 m',
    why: 'Radio horizon goes as the square root of height, so a 10 m error moves '
      + 'the horizon by kilometres and changes which turbines the radar can see at all.',
  },
  {
    key: 'azBeamwidthDeg', label: 'Azimuth beamwidth', unit: 'deg',
    tier: 'decides', movesDb: 8.2, error: 'out by 0.4 deg',
    why: 'Sets how much of the beam a turbine intercepts.',
  },
  {
    key: 'elBeamwidthDeg', label: 'Elevation beamwidth', unit: 'deg',
    tier: 'decides', movesDb: 8.0, error: 'out by 1 deg',
    why: 'Sets the vertical extent of the beam over the array.',
  },
  {
    key: 'elPeakDeg', label: 'Beam tilt, the elevation of peak gain', unit: 'deg',
    tier: 'decides', movesDb: 7.5, error: 'out by 2 deg',
    why: 'Decides how much energy reaches ground level at the farm.',
  },
  {
    key: 'freqHz', label: 'Transmit frequency', unit: 'Hz',
    tier: 'decides', movesDb: 6.7, error: 'S-band assumed, actually L-band',
    why: 'A band name alone pins this only to somewhere within an octave.',
  },
  {
    key: 'gainDbi', label: 'Antenna gain', unit: 'dBi',
    tier: 'decides', movesDb: 6.0, error: 'out by 3 dB',
    why: 'Enters the range equation twice, once out and once back.',
  },
  { key: 'peakPowerW', label: 'Transmit power', unit: 'W', tier: 'useful', movesDb: 3.0, error: 'halved' },
  { key: 'compressedBandwidthHz', label: 'Compressed bandwidth', unit: 'Hz', tier: 'useful', movesDb: 3.0 },
  { key: 'systemLossDb', label: 'System loss', unit: 'dB', tier: 'useful', movesDb: 3.0 },
  { key: 'noiseFigureDb', label: 'Noise figure', unit: 'dB', tier: 'useful', movesDb: 2.0 },
  { key: 'rpm', label: 'Scan rate', unit: 'rpm', tier: 'useful', movesDb: 1.1 },
  { key: 'prfHz', label: 'Pulse repetition frequency', unit: 'Hz', tier: 'useful', movesDb: 0.7 },
  {
    key: 'mtiRejectionDb', label: 'MTI rejection depth', unit: 'dB',
    tier: 'conditional', movesDb: 20.0,
    why: '0.0 dB for turning rotors and 20 dB for parked ones. A turning blade puts '
      + 'its Doppler far outside the clutter notch, so the figure never applies. Ask '
      + 'for it only when parked machines are part of the assessment.',
  },
];

export const TIER_LABELS = {
  decides: 'Decides the answer',
  useful: 'Worth having, not worth delaying for',
  conditional: 'Only if parked rotors are in scope',
};

/** A value counts as present only if it is a usable number. */
export function hasValue(site, key) {
  const v = site?.[key];
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * What is missing across a set of imported radar sites.
 *
 * Reports per field rather than per site, because the request that comes out
 * of it goes to one operator and asks for one list of things.
 */
export function auditRadarSites(sites = []) {
  const total = sites.length;
  const fields = RADAR_FIELDS.map((f) => {
    const missingNames = sites.filter((s) => !hasValue(s, f.key)).map((s) => s.name);
    return {
      ...f,
      present: total - missingNames.length,
      missing: missingNames.length,
      missingNames,
      complete: missingNames.length === 0,
    };
  });
  const decides = fields.filter((f) => f.tier === 'decides');
  return {
    total,
    fields,
    // The single number that says how much of the answer is resting on
    // defaults: the largest measured effect among the figures nobody supplied.
    worstMissingDb: decides.filter((f) => f.missing).reduce((m, f) => Math.max(m, f.movesDb), 0),
    decidingMissing: decides.filter((f) => f.missing).length,
    complete: decides.every((f) => f.complete),
  };
}

/**
 * A request somebody can send, rather than a list they have to turn into one.
 *
 * Ordered by measured effect and states that effect, because an operator who
 * is told WHY a number matters is far more likely to go and find it than one
 * handed an unexplained list of twelve parameters.
 */
export function requestText(audit, { siteLabel = 'the radar sites below' } = {}) {
  const wanted = audit.fields.filter((f) => f.missing > 0 && f.tier !== 'conditional');
  if (!wanted.length) return '';
  const lines = [];
  lines.push('Request for radar parameters');
  lines.push('');
  lines.push(`We are running a first-order screening assessment of wind turbine effects on `
    + `${siteLabel}. The following parameters are not in the data we hold. They are listed `
    + `in the order they affect the result, with the measured effect of getting each one wrong.`);
  lines.push('');
  for (const tier of ['decides', 'useful']) {
    const group = wanted.filter((f) => f.tier === tier);
    if (!group.length) continue;
    lines.push(`${TIER_LABELS[tier]}:`);
    for (const f of group) {
      const scope = f.missing === audit.total
        ? 'all sites'
        : `${f.missing} of ${audit.total} sites`;
      lines.push(`  - ${f.label}${f.unit ? ` (${f.unit})` : ''}`
        + ` - missing for ${scope}`
        + (f.movesDb ? `; ${f.error ? `${f.error} ` : ''}moves the result by ${f.movesDb.toFixed(1)} dB` : ''));
    }
    lines.push('');
  }
  lines.push('Where a figure varies by mode, the value used in normal surveillance operation '
    + 'is the one we need.');
  return lines.join('\n');
}
