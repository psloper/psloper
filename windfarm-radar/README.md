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

Four effects, each of which is a separate real-world problem:

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

**Not modelled at all:** ground-reflection multipath and lobing, secondary
surveillance radar, real terrain, communications and navigation aid effects,
aerodrome obstacle limitation surfaces.

## Tests

The physics core is covered by tests that check it against independently known
values, so a regression fails loudly rather than producing a plausible-looking
but wrong assessment:

```bash
cd windfarm-radar && npm test
```

Anchors include grazing-incidence knife-edge loss of 6.02 dB, exactly 0 dB at the
v = −0.78 cut-off, 13.1 dB required SNR for Pd = 0.9 / Pfa = 1e-6, the 4.12·√h
horizon rule, and a cosecant-squared check that the pattern compensates R⁻⁴
exactly for a constant-altitude target. The behavioural tests check that the
engine responds the way the physics says it must: masking a farm cannot increase
false plots, clutter cannot improve a detection margin, stopping the rotors
removes the blade Doppler, and wind direction changes the answer.

## Vertical exaggeration

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
test/
  physics.test.mjs  Formula validation against known values
  analysis.test.mjs Behavioural tests on the engine
```
