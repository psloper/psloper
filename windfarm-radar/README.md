# Wind Farm / Radar Interference Assessor

A browser-based 3D screening tool for the interaction between wind turbines and
primary surveillance radar. Set up a radar, a wind farm, terrain and a flight
profile; see what the radar actually does with them; try the mitigations and see
what each one costs as well as what it fixes.

No build step, no install, no network. Vanilla JavaScript and the copy of
[Three.js](https://threejs.org/) already vendored in this repository under
`js/vendor/`.

> **This is a first-order screening model, not a technical assessment.**
> It is built to explore how the variables interact and to find the obvious
> problems early. It cannot support a planning submission, a safety case, or an
> objection. A formal assessment needs the radar operator's own validated model,
> the real radar parameters, real terrain data, and measured or modelled turbine
> radar cross-section at the relevant frequency and aspect angles. The tool says
> so on its own "Method and limits" panel, and every exported report repeats it.

## Running it

ES modules need to be served over `http://` rather than opened as a `file://`
URL. From the repository root:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/windfarm-radar/
```

Or from this directory, `npm start` does the same thing.

## What it computes

### Wind is a first-class variable

Blade Doppler is not a property of a turbine. It is a property of the
conditions, through two separate mechanisms:

- **Direction drives yaw.** Turbines yaw into the wind, so wind direction sets
  the angle between the radar line of sight and the rotor axis. Peak blade
  radial velocity is `v_tip · sin θ` against that angle. A rotor pointed at the
  radar shows almost no blade Doppler; one edge-on shows all of it. In the
  default scenario that is the difference between 210 Hz and 1613 Hz.
- **Speed drives rotor speed.** A variable-speed, pitch-regulated machine holds
  close to a constant tip-speed ratio below rated, roughly constant rotor speed
  from rated to cut-out, and idles outside that band. So Doppler rises with
  wind, plateaus at rated, and collapses above cut-out.

Because a single direction can easily be a benign one, the **wind rose sweep**
runs all twelve sectors and weights each by how often that direction occurs and
how much of that time the machine is actually turning. The output is "plots are
present for 86% of the year", not "plots are present in today's wind", and the
tool says so when the direction you are assessing is not the worst one.

### Onshore or offshore

Offshore, the sea is both a clutter source and a mirror, and wave height drives
both in opposite directions:

- **Multipath** is the standard two-ray formulation with the Ament roughness
  factor. A calm sea is the *harder* case, not the easier one: a smooth surface
  reflects well, so the direct and reflected rays interfere and low-level
  coverage breaks into lobes and nulls. At sea state 2 this run swings between
  −58 dB and +12 dB relative to free space; at sea state 6 the lobing is washed
  out to a few dB.
- **Sea clutter** is distributed: sigma-zero times the illuminated cell area,
  with a wind-driven Doppler spread. It matters most for small, slow targets.

### Four radar effects

Each is a separate real-world problem:

1. **False plots.** A turbine's blades move fast enough (typically 70 to 105 m/s
   at the tip) that their Doppler shift falls outside a conventional
   zero-velocity clutter notch. The tower can be cancelled; the blades largely
   cannot. The tool computes the blade Doppler spectrum, how much of it survives
   the clutter filter, and whether what is left clears the detection threshold.
2. **Doppler ambiguity.** Blade velocities usually exceed the first blind speed,
   so they fold into the unambiguous interval and can present as an aircraft-like
   radial speed. The tool reports the folded velocity in knots, because that is
   the number that decides whether a tracker can reject the return.
3. **Desensitisation.** Strong turbine returns leak into neighbouring range and
   azimuth cells through the antenna pattern and range sidelobes, reducing the
   detection margin over and around the farm, not only behind it.
4. **Shadowing.** The tower and rotor take signal out of the path to a target
   behind them, and the effect accumulates through a deep array.

Plus the things that decide whether any of it matters at all: radio line of
sight with earth curvature at a chosen k-factor, terrain masking, the antenna's
elevation pattern, and where the aircraft actually flies.

## What you see

- **3D view.** Terrain with curvature applied, the radar with its rotating beam
  and coverage envelope, turbines to scale and turning at the modelled rate and
  yaw, lines of sight coloured by visibility, geometric shadows, the flight track
  coloured by detection state, and any mitigation zones as the volumes they are.
  The terrain can be shaded by elevation, by detection margin, or by the margin
  the wind farm takes away.
- **Plan position indicator.** What the picture looks like: turbine plots,
  desensitised regions, blanked sectors drawn as the holes they are, and the
  aircraft's plots and dropouts.
- **Vertical section.** The view that explains *why*. Masking, beam elevation
  and earth curvature are vertical effects that a plan view cannot show. Click
  the left or right half of the section to rotate its bearing.
- **Findings panel.** Ranked issues, each with the numbers behind it and a
  stated basis: `computed` (falls out of the model), `screening` (a threshold you
  or a published guide set), or `check` (something the tool cannot decide).

## Real data in

Nothing is uploaded. Every file is parsed in the page.

| Source | Format | Notes |
| --- | --- | --- |
| Turbine schedule | `.xlsx`, `.csv` | Title blocks above the table are skipped. Reads ID, position, ground level, hub height, rotor diameter, tip height, rotor speed, tower dimensions. |
| Elevation | `.asc` (ESRI ASCII Grid) | What almost every free DEM exports to. The best option. |
| Elevation | `.kml`, `.kmz` | What Google Earth exports. |
| Elevation | `.xlsx`, `.csv` | Point elevations as easting/northing/level or lat/lon/level. |

### Real UK sites, built in

The Site tab has a **Real UK sites** picker holding the whole UK wind pipeline
and 55 real UK civil radar sites. Choose a scope, choose a project, choose a
radar or take the nearest automatically, and the tool places it at its true
bearing and range and sets land or sea from the record.

| What | Count | Source | Licence |
| --- | --- | --- | --- |
| UK wind records | 2,489 | UK Renewable Energy Planning Database, via a GitHub snapshot | OGL v3 (Crown copyright) |
| of which current or planned | 1,275 (89.2 GW) | 832 operational, 44 under construction, 220 consented, 179 submitted | |
| UK civil radar sites | 55 (17 en-route, 32 aerodrome) | `VATSIM-UK/UK-Sector-File` and `open-air-data/atc-radar`, merged on position | derived set is ODbL |

Four things you must know before using it:

- **Two thirds of the wind records will not be built as recorded.** They are
  refused, withdrawn, abandoned, expired or superseded. The picker filters on
  status by default; opening it up is a deliberate act.
- **The positions are planning records, not surveyed turbine positions.** Measured
  at the two sites where real turbine coordinates were obtainable, the record is
  out by **1,140 m** at Kelmarsh and **1,121 m** at Penmanshiel. At Kelmarsh that
  is 2.4 times the array radius, and the whole array lies between 0.7 and 1.6 km
  from the recorded point. Coordinates are written to five decimal places, so the
  tool carries stated precision (±1.1 m) and measured accuracy (±1,100 m) as two
  separate numbers and shows both.
- **Agreement between sources was checked for independence before being believed.**
  The previous dataset agreed with this one to a median of 3 m, and that is worth
  nothing: it records per row that its coordinates came from the same database.
- The two radar sources **disagree with each other** by a median of 1.4 km and by
  up to 5.9 km. Neither is official.
- **No military radar is included.** MOD safeguarding of air defence radar is what
  most often decides a real UK application, and this tool carries none of it.

The full provenance, the accuracy test and the source-versus-source cross-check
are in [`calibration/UK-SITES.md`](calibration/UK-SITES.md).

The `.xlsx` reader is built on the browser's own `DecompressionStream` rather
than a library, because an `.xlsx` is a ZIP of XML and the platform can already
unzip. That keeps the tool a static, offline, dependency-free drop.

Imported terrain reports the fraction of the modelled area it actually covers,
and cells with no data are counted as holes rather than filled with invented
ground.

### Why these free sources, and not Google Earth's API

Google Earth has **no public API** for bulk elevation. The Google Elevation API
is a different product: it needs a paid key, it needs a network connection, and
its terms restrict storing what it returns. All three are the opposite of what
this tool is. Exporting from Google Earth as KML or KMZ and reading it here
needs none of them.

A caution the tool repeats: KML altitudes are commonly clamped to the ground,
which writes zero, and where they are not, they come from Google Earth's own
terrain model, which is not survey grade.

Free bulk sources, all of which export formats this tool reads directly:

| Source | Why |
| --- | --- |
| **Copernicus DEM GLO-30** | Global, 30 m, open licence. The default choice for most of the world. |
| **NASA SRTM 30 m** | Global to 60° latitude, free, long established. |
| **OpenTopography** | Free portal serving SRTM, Copernicus and ALOS as GeoTIFF or ASCII grid. |
| **OS Terrain 50** (UK) | Free OS OpenData, 50 m. Adequate for screening in Britain. |
| **Environment Agency LIDAR** (England) | Free 1 m and 2 m DTM. Survey grade where it exists, and far better than anything global. Use this for UK onshore. |
| **EU-DEM / Copernicus Land** | Europe, 25 m, free. |
| **GEBCO** | Free global bathymetry, for the seabed under an offshore array. |

A **keyless online lookup** is also wired in (Open-Elevation, OpenTopoData
SRTM and EU-DEM, Open-Meteo), off by default. It is **unverified**: it could not
be exercised, because the environment this tool was built in has no outbound
network access. A downloaded tile is better anyway, because it is reproducible
and has a known provenance.

## Parameter sweeps and heat maps

The single-scenario view answers *is this a problem*. A sweep answers *how much
would have to change*. Vary any two of twenty parameters against each other,
colour by any of eight metrics, and read the boundary off the map. Tip height
against distance draws the radio-horizon curve directly. Wind direction against
wind speed shows the Doppler plateau above rated and the collapse above cut-out.

A 12×12 grid is 144 complete re-analyses and runs in about 400 ms.

Colour follows the metric's job. A signed quantity measured against a threshold,
such as detection margin, is **diverging** about a neutral midpoint pinned to
zero. An unsigned magnitude is **sequential**: one hue, monotonic in lightness.
Never a rainbow.

Exports: heat maps as PNG, standalone SVG (one `<title>` per cell, so values
survive on hover) and CSV; plus PNG capture of the 3D view, the plan display,
the vertical section and the wind rose.

## Reference targets

Twenty-five aircraft across four classes: uncrewed (4), general aviation (7),
commercial (5) and military (9).

**RCS is a class figure, never a platform figure.** It varies by tens of
decibels with aspect, frequency and polarisation, and real values for specific
military platforms are controlled information. The library exists to show how
target size interacts with turbine clutter, not to assert the performance of any
aircraft. The point it makes is that the same farm can be harmless against a
widebody and decisive against a light aircraft or a small uncrewed aircraft, and
a finding states explicitly which smaller classes a given result would not hold
for.

## Mitigations

Each one changes the computation, not just a label, and each one reports its
cost as well as its benefit:

| Mitigation | What it does here |
| --- | --- |
| Radar-absorbent blade treatment | Reduces turbine RCS by an amount you set. Flagged as unproven, because it is. |
| Enhanced Doppler processing | Extra rejection of spectrally spread blade returns. |
| Sector blanking | Suppresses plots over the farm, and reports the coverage hole in km². |
| Non-automatic initiation zone | Blocks new track starts in the zone; established tracks coast through. Reports the initiations it blocks. |
| In-fill radar | A second sensor. Only credited where it genuinely sees what the primary cannot. |
| Turbine curtailment | Rotors stopped. The theoretical best case, so you can see how much of the problem is rotation rather than structure. |
| Terrain screening | Not a checkbox: put a ridge between the radar and the farm on the Terrain tab. The one mitigation that costs the radar nothing. |

"Mitigation delta" compares the current set against the same scenario with
everything switched off.

## Exports

Assessment report (Markdown), full results (JSON), turbine table (CSV), flight
track results (CSV), and the scenario alone (JSON, reloadable). Every export
carries the method and limits with it. Everything happens in the browser;
nothing is uploaded.

## Physics and provenance

The formulas, with their sources and their validity, are set out in full on the
tool's own "Method and limits" panel and repeated in every exported report. In
summary:

| Quantity | Basis |
| --- | --- |
| Earth curvature, line of sight | Equivalent-earth method, `h − d²/(2·a_e)`, `a_e = k·R`. Reproduces `d_km = 4.12·√h_m` at k = 4/3. |
| Detection | Monostatic radar range equation; noise `k·T₀·B·F`. |
| Threshold SNR | Albersheim's approximation (validity 0.1 ≤ Pd ≤ 0.9, 1e-7 ≤ Pfa ≤ 1e-3; the tool warns outside it). |
| Diffraction | Single knife-edge, ITU-R P.526 form. |
| Doppler | `f_d = 2·v_r·f/c`; rotor radial velocity `v_tip·sin θ` against the line of sight. |
| Blind speeds | `v_b = n·PRF·λ/2`, with velocity folding. |
| Antenna | Gaussian main beam with cosecant-squared elevation shaping. |

A handful of engineering approximations are made on top of those: the
tower/blade scatterer split, the blade Doppler distribution, rotor solidity as a
partially filling screen, the narrow-obstacle Fresnel correction, and a
parametric range-sidelobe skirt. They are listed explicitly in the method panel
so they can be argued with.

Wind, sea and atmosphere add: rotor yaw and the control curve (exact geometry
and a standard control description), a Weibull wind climate, two-ray multipath
with the Ament roughness factor, distributed sea clutter (parametric, every
constant an input), fully-developed wave height from the Pierson-Moskowitz form,
and refraction expressed as the effective earth radius factor.

**Not modelled at all:** secondary surveillance radar, communications and
navigation aid effects, aerodrome obstacle limitation surfaces, and rain clutter
beyond a user-supplied attenuation figure.

## Regulatory position

**This tool does not assess conformance with anything, and says so on its own
face.** Nothing in it has been checked against ICAO, EUROCONTROL or any national
requirement, and no such document was retrieved or read: the environment it was
built in had no access to them. A permanent finding states this, lists the
instruments an assessment of this kind normally engages with, and says plainly
that the list itself is written from general knowledge rather than read from the
documents. Confirm the current edition, number and applicability of every one
before relying on it, and engage the ANSP and the regulator.

The same discipline runs through the rest of the tool. Where a figure could not
be verified against a primary source, it is an input you supply rather than a
constant the tool asserts: sigma-zero for sea clutter, atmospheric attenuation,
turbine RCS, and the wind rose itself.

## Tests

The physics core is covered by tests that check it against independently known
values, so a regression fails loudly rather than producing a plausible-looking
but wrong assessment:

```bash
cd windfarm-radar && npm test
```

92 assertions. Anchors include grazing-incidence knife-edge loss of 6.02 dB, exactly 0 dB at the
v = −0.78 cut-off, 13.1 dB required SNR for Pd = 0.9 / Pfa = 1e-6, the 4.12·√h
horizon rule, and a cosecant-squared check that the pattern compensates R⁻⁴
exactly for a constant-altitude target. The behavioural tests check that the
engine responds the way the physics says it must: masking a farm cannot increase
false plots, clutter cannot improve a detection margin, stopping the rotors
removes the blade Doppler, and wind direction changes the answer.

## How the turbines are drawn

Every dimension in the drawing comes from the model. The audit that established
that, and what it found, is below.

| Dimension | Source | Was it model-driven before? |
| --- | --- | --- |
| Hub height | `hubHeightM` | yes |
| Tower base and top diameter | `towerBaseDiameterM`, `towerTopDiameterM` | **no, drawn from the scene extent** |
| Blade span | `rotorRadiusM` | yes |
| Blade chord and thickness | `bladeChordM` | **no, a multiple of the tower radius** |
| Blade count | `bladeCount` | yes |
| Nacelle length, width, height | `nacelleLengthM`, `nacelleWidthM`, `nacelleHeightM` | **no, and the model had no nacelle size at all** |
| Hub and spinner diameter | `hubDiameterM` | **no, a multiple of the tower radius** |
| Yaw | `yawDeg` | yes |

Four of the eight were arbitrary constants, and the nacelle and hub dimensions
did not exist in the model. They do now, per preset, and the nacelle is a
scatterer the model already gave a broadside and a head-on RCS to, so having its
physical size is coherent rather than decorative.

Blade planform is a shape rather than a dimension: aerofoil sections lofted from
a chord, twist and thickness distribution, circular at the root, widest at about
a fifth of span, untwisting to the tip. The distribution is representative of a
modern three-blade machine and is not taken from any particular one. Everything
it is scaled by comes from the model.

### Two exaggerations, and why they cannot be one

Both are named in the badge over the viewport and both are under your control.

- **Vertical**, applied to every height in the scene, as everything here is.
- **Girth**, applied to every structural WIDTH: tower diameters, nacelle width
  and height, hub diameter, blade chord and thickness. A 5.5 m tower across a
  40 km scene is a fraction of a pixel, so widths have to be drawn heavier
  than life.

**Girth is never applied to a span.** Blade span, hub height and nacelle length
stay true, so tip heights and the ground area the rotor covers are real.

That means girth and span cannot both be to scale. It is a property of the
problem, not a fudge, and the consequence is visible: turn the girth up and the
blades get fat, because the factor is uniform. The earlier version hid this
behind three different factors, one for the tower, its square root for the
nacelle and a third capped one for chord, which meant the drawn machine had the
proportions of no machine at all. One factor, stated, is worth more than three
tuned by eye.

### Verified by measurement

`tools/verify-geometry.mjs` drives the real page, varies one model parameter at
a time, and measures the bounding boxes of the meshes the scene actually built.

```
case                     towerBaseD  towerTopD    chord     span     hubY    nacL    nacW    hubD  blades
baseline                      44.00      25.60    23.62    75.00   440.00   14.00   33.60   32.00      3
towerBaseDiameterM x2         88.00      25.60    23.62    75.00   440.00   14.00   33.60   32.00      3
towerTopDiameterM x2          44.00      51.20    23.62    75.00   440.00   14.00   33.60   32.00      3
bladeChordM x2                44.00      25.60    47.24    75.00   440.00   14.00   33.60   32.00      3
rotorDiameterM x2             44.00      25.60    23.62   150.00   440.00   14.00   33.60   32.00      3
hubHeightM x2                 44.00      25.60    23.62    75.00   880.00   14.00   33.60   32.00      3
nacelleLengthM x2             44.00      25.60    23.62    75.00   440.00   28.00   33.60   32.00      3
nacelleWidthM x2              44.00      25.60    23.62    75.00   440.00   14.00   67.20   32.00      3
hubDiameterM x2               44.00      25.60    23.62    75.00   440.00   14.00   33.60   64.00      3
bladeCount 3 -> 2             44.00      25.60    23.62    75.00   440.00   14.00   33.60   32.00      2
girth x2                      88.00      51.20    47.24    75.00   440.00   14.00   67.20   64.00      3
```

Doubling any model parameter doubles exactly one drawn dimension and leaves
every other at 1.00. Doubling the girth factor doubles **every** girth and **no**
span, which is the uniformity claim tested rather than asserted.

`tools/turbine-harness.html` renders one machine at true scale for looking at.

## Vertical exaggeration## Vertical exaggeration

Heights can be multiplied for legibility, because a 185 m turbine inside a 40 km
scene is a hairline at true scale. Every height in the view goes through the same
multiplier: terrain, curvature drop, turbine heights, ray heights, beam
envelope. Scaling all heights by one constant is a linear map, so straight lines
stay straight and every "does A block B" relationship in the picture stays
exactly as the maths has it. The badge at the top of the view says what
multiplier is in force.

## Keyboard

| Key | Action |
| --- | --- |
| `1` `2` `3` `4` | Orbit / from-radar / plan / section camera |
| `C` | Cycle terrain shading |
| `Space` | Pause or resume the animation |

## Files

```
index.html          Layout: control rail, 3D viewport, displays, findings panel
css/style.css       Console styling
js/
  main.js           Bootstrap, wiring, render loop
  geo.js            Coordinates, earth curvature, terrain, line of sight
  rf.js             Radar equation, antenna patterns, diffraction, Doppler
  model.js          Scenario defaults, presets, layout and flight-path builders
  analysis.js       The assessment engine
  findings.js       Turns the numbers into ranked, sourced findings
  scene.js          Three.js view, orbit camera, all 3D geometry
  displays.js       Plan position indicator and vertical section
  ui.js             Declarative control rail, panel rendering
  report.js         Exports, and the method/limits text that goes with them
  wind.js           Rotor control curve, Weibull climate, wind roses
  sea.js            Wave height, sea state, sea clutter, surface multipath
  importers.js      xlsx, csv, ESRI ASCII grid, KML/KMZ, optional online lookup
  sweep.js          Two-parameter sweeps over the whole model
  heatmap.js        Heat map rendering, PNG and SVG export
  uksites.js        Real UK wind farm and civil radar positions (generated)
  references.js     The evidence register
test/
  physics.test.mjs  Formula validation against known values
  analysis.test.mjs Behavioural tests on the engine
  report.test.mjs   Exports carry their caveats and contain no formatting failures
  uksites.test.mjs  The UK data is sane, and states its limits where users see them
  geometry.test.mjs Every drawn dimension exists in the model; one girth factor only
  calibration.test.mjs  The control curve matches measured SCADA; diffraction
                    matches the ITU's own reference implementation
data/
  uk-wind-farms.json    2,489 UK wind records, current and planned, with status
  uk-radar-sites.json   55 UK civil radar sites, with source disagreement recorded
calibration/
  README.md          SCADA calibration, two passes: seven model assumptions corrected
  UK-SITES.md        UK site data: provenance, cross-check, and what it says
  extract_scada.py   Streaming extractor for the SCADA dataset
  fetch_uksites.py   Downloads the UK source data
  build_uksites.py   Generates js/uksites.js from it
  uk_sites.mjs       Correlates all 780 farms against all 55 radar sites
samples/
  turbines-example.xlsx / .csv / .kml
  terrain-example.asc / .csv
```
