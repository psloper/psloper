# Validation dossier

**Wind Farm / Radar Interference Assessor — first-order screening tool**

What this tool claims, what was done to check each claim, what those checks
found, and what remains unverified. It is written to be handed to someone who
has to decide whether to rely on the tool, and it is meant to survive their
scepticism rather than deflect it.

Every figure below is produced by something in this repository that you can run
yourself. Where a number came out badly, it is here too: a validation record
that contains no failures is a record of what was not looked at.

---

## 1. The one-paragraph version

This is a **screening** tool. It answers "is there plausibly a problem here,
and roughly how big" in seconds, from public data, for any wind farm and radar
in the United Kingdom. It does not answer "is this acceptable", and it is not a
safeguarding assessment. Its physics is checked against independent reference
implementations, its terrain against surveyed summits, its turbine behaviour
against 1,068,526 records of measured operating data, and its regulatory
content against the primary documents, stored in the repository, quote by
quote. Where it cannot support a claim it says so on the page rather than in a
footnote.

## 2. What it is for, and what it replaces

The realistic alternative to this tool is one of three things:

| Instead of | Which costs | This tool gives you |
| --- | --- | --- |
| Commissioning a consultant study | Weeks and a fee, per site | Minutes, any number of sites, before you decide which are worth a study |
| A desk judgement from a map | Nothing, and it is frequently wrong about line of sight over real terrain | Terrain-screened line of sight over a national grid, with the elevation data stated |
| Doing nothing until an objection arrives | The objection | A list of which radars can see the site and by how much, before the application |

It is a filter in front of the expensive work, not a replacement for it. The
value is in what it lets you rule out, and in the fact that every ruling it
makes carries its own evidence.

## 3. The claims, and where each is checked

| Claim | Checked by | Result |
| --- | --- | --- |
| The propagation maths is right | `test/calibration.test.mjs` against the ITU-R P.526 reference equations | Agrees to better than 1e-12 dB across ν = −3 to +6 |
| The terrain is real ground | `test/terrain.test.mjs` against three surveyed summits | Ben Nevis −3 m, Scafell Pike −6 m, Snowdon −14 m |
| Turbines behave as modelled | `calibration/` against 1,068,526 SCADA records | Four assumptions contradicted and corrected |
| The regulatory content is what the documents say | Five test files against primary text stored in `docs/evidence/` | 89 CAP 670 checks: 74 confirmed, 7 corrected, 8 open |
| The antenna pattern is not optimistic | `test/physics.test.mjs` against an exact aperture pattern | Over-states off-boresight clutter by 4.6 to 12.9 dB |
| Exports actually open | `test/office.test.mjs`, by generating real files and unpacking them | 13 checks |
| It makes no network requests | `test/injection.test.mjs`, plus a run with the network off | Nothing attempted, not merely nothing blocked |
| The interface is usable | `tools/verify-a11y.mjs`, in a real browser | 25 checks, run against the built outputs too |

**337 tests, all passing.** Run `npm test`.

## 4. Physics checked against an independent implementation

Knife-edge diffraction and the Fresnel-Kirchhoff parameter are the two places
where a transcription error would be invisible and would move every result. So
they are not checked against expectations; they are checked against the ITU-R
P.526 equations implemented separately in the test file, from the published
form, and compared across the whole range.

- Knife-edge loss: maximum difference **below 1e-12 dB** over ν = −3 to +6.
- Fresnel-Kirchhoff parameter: agreement to **1 part in 1e12** across five
  geometries spanning 0.5 to 60 km and 0.03 to 0.6 m wavelength.

That is not a claim that the model of the world is right. It is a claim that
the equations are the equations, which is the part a test can settle.

Antenna aperture sizes are **derived** from each radar's own wavelength and
beamwidths rather than recalled, and the derivation is in the code: S-band
terminal 5.4 m, L-band en-route 12.4 m, marine X-band 2.5 × 0.1 m. Numbers of
this kind are exactly where a plausible-sounding recollection does most damage.

## 5. Terrain checked against ground truth

Elevation is Copernicus DEM GLO-30, resampled to a national grid. Checked
against the published heights of three summits:

| | Tool | Surveyed | Error |
| --- | --- | --- | --- |
| Ben Nevis | 1342 m | 1345 m | −3 m |
| Scafell Pike | 972 m | 978 m | −6 m |
| Snowdon | 1071 m | 1085 m | −14 m |

The sampling method was chosen by measurement, not preference. Nearest
neighbour was tried first and discards summits: Snowdon came out 33 m low.
Max-pooling recovers 19 m of that and errs toward saying a path is blocked,
which is the safe direction for a screening tool. A test fails if any tile
contains a cell above Ben Nevis.

## 6. Turbine behaviour calibrated against measured data

The fleet model was built from a literature summary of how turbines behave. It
was then checked against how five turbines actually behaved for three years:
1,068,526 five-minute records, 78 sensors, openly licensed.

**Four assumptions were contradicted.** Each is listed here because each was
wrong in a direction that flattered the tool.

1. **Rotor speed does not fall to zero below rated.** A running machine holds a
   floor near 60% of rated speed. The old model understated blade Doppler at
   low wind by about 40%, which is precisely the regime where it would
   otherwise have looked harmless. Corrected, modelled peak blade Doppler at
   3.5 m/s roughly doubles, 470 Hz to 968 Hz.
2. **Yaw scatter is peaked, not uniform.** The scale was about right, the shape
   was wrong. Measured per-turbine standard deviation 5.4°, with a tail to
   32.1° at the 99th percentile.
3. **Machines carry persistent reference offsets from each other,** up to 35°
   between medians while all were generating in the same wind. This was not in
   the model at all. A wind farm does not present one aspect angle to a radar
   even in steady wind.
4. **Stoppages cluster.** All five stopped together 0.6% of the time against
   0.004% if independent, a factor of 150.

A second pass added the one thing the first could not test, because the
substitute dataset had no turbine coordinates: **array layout**. Against the
six-turbine Kelmarsh table, nearest-neighbour spacing ratio 1.46 measured
against 1.10 modelled, and tip height above sea level spanning 31.5 m measured
against about 8 m modelled. Understating that spread by a factor of four
matters more than it sounds, because tip height above sea level is exactly what
decides which machines clear a terrain screen.

**What was deliberately not done.** One farm of six turbines is thin evidence
for a default. So the existence of mixed hub heights is modelled and the
*magnitude* is not invented: `hubHeightSpreadM` defaults to zero, and a finding
fires whenever an array has a single hub height, telling the user what the one
real array measured. Existence is evidenced, magnitude is not, and the tool
asserts only what it can support.

## 7. Regulatory traceability

Five documents are relied on. For each, the primary text is stored in
`docs/evidence/` and every quote and figure the code carries is checked
verbatim against that file by a test, so a number cannot be edited into the
tool unless the document actually contains it.

| Document | Evidence file | Checks |
| --- | --- | --- |
| CAP 670, Third Issue, Amdt 1/2019 | `cap670-*-2019.txt` (4 files) | 45 |
| CAP 764 Edition 7 draft (consultation) | `cap764-ed7-draft-consultation.txt` | 8 |
| EUROCONTROL SUR.ET1.ST01.1000-STD-01-01 (1997) | `eurocontrol-radar-surveillance-std-1997.txt` | 13 |
| EUROCONTROL ESASSP SPEC-0147 Ed 1.3 (2024) | `eurocontrol-esassp-spec-0147-ed1.3-2024.txt` | 8 |
| Def Stan 00-56 Part 1 Issue 7 (2017) | `defstan-00-56-part1-issue7-2017.txt` | 7 |

**The CAP 670 record: 89 checks, 74 confirmed, 7 corrected, 8 still open.** The
seven corrections are the part worth reading, because they are places the tool
was wrong before the document was read properly:

- Four green distance thresholds the tool printed **do not exist in Table 2**.
  They came from a third-party summary. Those four classes can now only be Red
  or Amber on distance, however far away the turbine is, and the tool says so
  on every such result, because that is what the document does.
- The angle in Appendix A is the **elevation angle of the hub above the site
  base level**, not the angular subtense of the turbine. The tool had inferred
  the latter.

Each correction records what the tool used to print and what the document says,
and a test asserts that nothing still claims to be inferred that the document
settles.

Some tests are written as negatives, which is the harder direction: the claim
that ESASSP never says "supersede" is tested by searching for the word.

## 8. The antenna pattern, checked rather than asserted

Azimuth is a Gaussian main lobe held flat at the peak sidelobe level. A flat
sidelobe region is a simplification, so it is justified rather than assumed:
against a uniform rectangular aperture, whose far-field pattern can be written
down exactly, the model meets the first sidelobe peak and sits **4.6 to 12.9 dB
above** the next five, dipping at most 0.05 dB inside the main lobe. It
therefore over-states off-boresight clutter rather than under-stating it, which
is the safe direction for screening. The aperture's −13.2615 dB first sidelobe
is derived in the test from tan(u) = u rather than recalled.

The sidelobe level itself is an **assumption**, because no datasheet available
here publishes one, and the tool reports what that assumption is worth. For a
10 dB error in it:

| farm range | worst turbine clutter cost | margin shift | tracks lost |
| --- | --- | --- | --- |
| 2 km | 38.1 dB | 20.0 dB | 0 becomes 2 |
| 3 km | 28.2 dB | 20.0 dB | 0 becomes 1 |
| 5 km | 10.8 dB | 3.0 dB | none |
| 20 km | 13.9 dB | 0.0 dB | none |

Where the dominant clutter contributor sits past the angle at which the main
lobe has fallen to the sidelobe level, the finding on the page says so and
names the assumed figure it is resting on.

## 9. What it got wrong, and how that was caught

A tool's credibility rests more on this section than on the passing tests.

- **A pulse-compression parameter was driving the antenna pattern.** The
  azimuth sidelobe level was derived from `rangeSidelobeDb`, a waveform
  property unrelated to aperture illumination, through a comparison that was
  false only at exactly the slider's minimum and so always returned the same
  answer. Found by measuring the parameter's sensitivity, not by reading it.
- **A column heading was silently swallowed.** `elevation beamwidth` was
  claimed by the alias for `elevation` (ground level) because matching took the
  first alias matching as a prefix in declaration order. The beamwidth vanished
  and nothing reported it.
- **The page title collapsed on common laptop widths.** Between 1181 and
  1500 px the heading was crushed: 6 lines at 1366 px, and at 1200 px the
  heading rendered 34 lines, one character each. The existing overflow check
  passed both, because a crushed element does not overflow, it collapses.
- **A check credited a slider with its label's height,** so a mutation
  shrinking every range control to 18 px passed. Clicking a label does not move
  a slider.
- **A first-run panel blocked the package build,** which is exactly what that
  build is for.
- **The example generator mis-attributed an output.** The workbook takes about
  32 s to write and the wait was 30 s, so it arrived late and was recorded
  against the next step. The log claimed a Markdown report had produced a
  spreadsheet.

Every check in this repository was **mutation-tested**: deliberately broken to
prove it can fail. Several needed a second pass because the first version
passed the fault it was written to reject.

## 10. Security posture

Stated in full in `docs/SECURITY.md`. The short version, for an IT review:

- A **static web page**. No Java, no applet, no plugin, no installer, no
  service, no registry keys, no admin rights, no backend, no database, no API
  keys, no accounts.
- **No third-party network requests at runtime.** Checked statically, by a test
  asserting the only fetch in the codebase reads the tool's own data from its
  own origin and never an absolute URL, and dynamically, by running it with the
  network off: nothing was blocked, because nothing was attempted.
- The single-file build makes **no network call at all**; the data is in the
  page.
- Preferred deployment is to host the folder on an internal web server, which
  is what most policies are asking for when they object to running things
  locally.

## 11. What is not verified

Listed plainly, because a dossier that omits this is worth less than no
dossier.

- **The wake model is not validated.** The dataset that would have tested it
  was unreachable.
- **Turbine radar cross sections for named aircraft types are estimates.**
  Nobody publishes them. The panel says so where you pick the aircraft.
- **Blade chord** is a known-uncertain input that moves results. It is flagged
  rather than silently corrected.
- **Multipath and ground-reflection lobing are not modelled at all,** and they
  are a first-order effect for low targets.
- **Clutter is compared against the detection threshold as if it integrated
  like noise.** Real clutter is correlated, so this is optimistic where clutter
  dominates.
- **Parts of CAP 670 could not be checked**: Appendix A's flow chart and
  Figure 3 are images, and whether a later Supplementary Amendment changes the
  tables could not be confirmed.
- **ITU-R M.1851**, which covers radar antenna pattern models for interference
  analysis, could not be retrieved: `itu.int` is blocked by the network policy
  of the environment this was built in. Nothing here is attributed to it.
- **Twenty-two of twenty-five other unretrieved sources have no reachable
  mirror.** Each carries a caution naming the hosts tried and stating that
  nothing was read and no figure from it is used as a constant.
- **Attribution for the territory boundaries is incomplete**: the supplied
  files name no creator and CC BY 4.0 requires one.
- **UK farm positions are planning-application grid references,** measured at
  1,100 m from the array at the two sites where turbine coordinates were
  obtainable. This flips the visible-or-hidden verdict on 5.6% of farms, and
  the map says so.
- **Turbine positions do not exist in any source used here.** Counts and tip
  heights come from the July 2024 DESNZ extract and cover 91% and 38% of live
  farms.

## 12. Repeating every check yourself

```bash
npm test                                  # 337 unit and traceability tests
node tools/systems_check.mjs              # whole-dataset consistency
node tools/radar_sensitivity.mjs          # which inputs actually move the answer
node tools/verify-a11y.mjs                # 25 interface checks, needs a browser
node tools/build_cap670_checklist.mjs     # rebuilds the 89-row CAP 670 record
sh tools/build_package.sh                 # regenerates every example output
```

The distribution package regenerates its own example outputs from the code in
that package, so it cannot ship a picture of an older tool.

---

*This document is generated from the state of the repository and is checked by
`test/dossier.test.mjs`, which fails if the figures quoted here drift from the
code and data they describe.*
