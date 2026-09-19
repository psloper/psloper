# Calibration against measured SCADA

The fleet model in this tool was built from a literature summary of how wind
turbines behave. This is the record of checking it against how five turbines
actually behaved for three years.

## What was used, and what was not

**Intended:** Penmanshiel (14 turbines) or Kelmarsh (6 turbines), both UK,
both with turbine coordinates, both openly licensed on Zenodo. **These could
not be obtained.** Zenodo is blocked by the network policy of the environment
this tool was built in. Every catalogue route to them points at Zenodo.

**Used instead:** the Fuhrländer FL2500 2.5 MW dataset by Alejandro Blanco-M,
Eclipse Public License v2.0, hosted on GitHub and therefore reachable. Five
turbines, 2012 to 2014, five-minute resolution, 78 sensors reported as min,
max, mean and standard deviation.

**1,068,526 records** were extracted and analysed, covering nacelle position,
wind direction, wind speed, rotor speed, active power and availability.

**The substitution costs one thing outright: there are no turbine coordinates,
so the wake model could not be tested at all.** Everything below concerns yaw,
rotor speed and availability only.

## Reproducing it

```bash
git clone https://github.com/alecuba16/fuhrlander
python3 extract_scada.py fuhrlander/dataset/turbine_80.json.bz2 t80.json
```

The files are column-oriented JSON at roughly 350 MB uncompressed each, so
`extract_scada.py` streams them and captures only the columns named in its
`WANTED` list rather than loading them whole. One turbine takes about 15 s.

Relevant IEC 61400-25 variable names:

| Variable | Meaning |
| --- | --- |
| `wnac_avg_Dir` | Nacelle position, absolute |
| `wnac_avg_Wdir1` | Wind direction, absolute |
| `wnac_avg_WVaneDir1` | Wind vane direction relative to the nacelle |
| `wnac_avg_WSpd1` | Nacelle wind speed |
| `wgen_avg_RtrSpd_IGR` | Rotor speed, rpm |
| `wgdc_avg_TriGri_PwrAt` | Active power |
| `availability` | Availability flag |

## What the data contradicted

### 1. Rotor speed does not fall proportionally to zero below rated

The model had rotor speed proportional to wind speed from cut-in up to rated.
It does not work that way. A running machine holds a **floor at about 60% of
rated**.

| Wind | Measured median rpm (running) | Old model | Corrected |
| --- | --- | --- | --- |
| 3 to 4 m/s | 8.8 | 5.1 | 8.8 |
| 4 to 5 m/s | 9.0 | 6.6 | 8.8 |
| 5 to 6 m/s | 9.4 | 8.0 | 8.8 |
| 7 to 8 m/s | 12.1 | 10.2 | 10.2 |
| 9 to 10 m/s | 14.0 | 13.1 | 13.1 |

Rated is 14.6 rpm. **The old model understated blade Doppler at low wind by
about 40%**, which is exactly the regime where it would otherwise have looked
harmless. After correction, modelled peak blade Doppler at 3.5 m/s roughly
doubles, from 470 Hz to 968 Hz.

A residual disagreement remains: between 5 and 9 m/s the real curve is steeper
than the corrected model, reaching rated earlier. The model is still
conservative there by 1 to 2 rpm.

### 2. Yaw scatter is peaked, not uniform

The model spread turbines uniformly across a ±8° deadband. Measured pairwise
difference between the four well-behaved machines:

| | |
| --- | --- |
| Median | 7.3° |
| 75th percentile | 13.3° |
| 90th percentile | 19.8° |
| 99th percentile | 32.1° |
| Implied per-turbine standard deviation | 5.4° |

So the scale was about right but the **shape was wrong**: the real distribution
is peaked near zero with a tail, where a uniform deadband has neither. Now
drawn from a normal distribution with an occasional larger excursion.

### 3. Machines carry persistent reference offsets from each other

This was not in the model at all, and it matters more than the scatter.
Median nacelle position **differed between machines by up to 35°** while all
were generating in the same wind:

| Pair | Median nacelle offset |
| --- | --- |
| T80 / T82 | −1.2° |
| T80 / T81 | +3.6° |
| T81 / T84 | +25.4° |
| T82 / T84 | +35.2° |
| T83 / T84 | +60.9° |

The wind-direction sensors show the same offsets, so these are reference
offsets rather than genuine yaw behaviour. **For radar the cause does not
matter.** The rotors really are pointing in different directions, so the fleet
does not share one aspect angle even in perfectly steady wind, and the
single-aspect assumption was wrong.

One machine, T83, was plainly anomalous: residual yaw difference against every
other turbine had a median of 31 to 58° and a 90th percentile above 100°. It is
reported separately rather than averaged in, because averaging it would have
hidden both it and the others.

### 4. Stoppages cluster, they do not occur independently

The model picked stopped machines independently. Measured, with all five in
operating wind (134,103 samples):

| Number stopped | Observed | If independent |
| --- | --- | --- |
| 0 | 61.3% | 53.5% |
| 1 | 25.8% | 35.7% |
| 2 | 7.9% | 9.5% |
| 3 | 3.1% | 1.3% |
| 4 | 1.3% | 0.08% |
| 5 | 0.6% | 0.004% |

Both tails are fatter than independence predicts. All-running and all-stopped
are each far more common than they should be, because site-wide causes stop
machines together: grid events, storm shutdown, curtailment regimes, shared
access. The model now has a site-wide state on top of independent per-machine
stoppages.

### 5. Availability is much lower than the headline figure

| Turbine | Stopped while wind was in the operating band |
| --- | --- |
| T80 | 6.7% |
| T81 | 10.8% |
| T82 | 9.9% |
| T83 | 10.1% |
| T84 | 23.8% |
| **Fleet** | **12.2%** |

The model defaulted to 3%. **These are different questions**: the 2 to 3%
commonly quoted is time-based unavailability, whereas this counts every reason
a rotor was still while the wind was usable, including curtailment and idling.
For radar the second question is the relevant one, because what matters is
whether the blades were turning. The default is now 88% availability.

## What still is not tested

- **The wake model, entirely.** No coordinates in this dataset.
- **Offshore behaviour.** This is an onshore site.
- **Other machine types.** One model, one manufacturer, five units.
- **Modern large machines.** This is a 2.5 MW machine from 2012 to 2014, well
  below current onshore sizes, let alone offshore.

Obtaining Penmanshiel or Kelmarsh would close the first of those and broaden
the rest.

---

# Second pass: pulling the unretrieved register items

The brief: go through everything in the evidence register that had not been
retrieved, try to pull it from any reachable mirror, say which host was tried
and whether it worked, cross-check anything covered by two sources, and correct
the model wherever a source contradicts it.

## What is reachable, measured rather than assumed

Thirty-three hosts were probed directly. **Two answered.**

| Host | Result |
| --- | --- |
| `raw.githubusercontent.com`, `github.com`, `codeload.github.com` | reachable |
| `gitlab.com` | reachable (301) |
| `arxiv.org`, `export.arxiv.org` | 403 on CONNECT |
| `api.openalex.org`, `api.semanticscholar.org`, `core.ac.uk`, `europepmc.org` | 403 |
| `pmc.ncbi.nlm.nih.gov`, `www.ncbi.nlm.nih.gov` | 403 |
| `downloads.hindawi.com`, `onlinelibrary.wiley.com`, `www.mdpi.com` | 403 |
| `journals.ametsoc.org`, `amt.copernicus.org` | 403 |
| `its.bldrdoc.gov`, `www.ntia.gov`, `www.nrel.gov`, `www.osti.gov`, `apps.dtic.mil` | 403 |
| `www.itu.int`, `www.icao.int`, `publicapps.caa.co.uk`, `consultations.caa.co.uk` | 403 |
| `zenodo.org`, `doi.org`, `orbit.dtu.dk`, `gitlab.windenergy.dtu.dk` | 403 |
| `patents.google.com`, `citeseerx.ist.psu.edu`, `www.researchgate.net` | 403 |
| `archive.org`, `web.archive.org`, `scholar.archive.org` | 403 |
| `huggingface.co`, `codeberg.org` | 403 |

`WebFetch` was tested separately against `arxiv.org` and `its.bldrdoc.gov` and
returns the same block, so it shares the allowlist rather than bypassing it.

**So the answer to "pull them from any reachable mirror" is: only if somebody
mirrored it on GitHub.** Two of the twenty-five unretrieved items turned out to
be, and both changed the model.

## Item 1: ITU-R P.526, blocked → cross-checked

**Host tried:** `www.itu.int`. Refused.

**Mirror that worked:** `eeveetza/Py452` on GitHub, the ITU-R Study Group 3
reference implementation of Recommendation ITU-R P.452, published as source by
its maintainer.

The point: the single knife-edge approximation this tool uses from P.526 also
appears as **equation (13) of P.452**, and the Fresnel-Kirchhoff parameter as
**equation (20)**. Both are in that code, written by the ITU, and both were
compared against this tool's implementation directly.

| Quantity | Agreement |
| --- | --- |
| Knife-edge loss J(ν), −3 ≤ ν ≤ 6 | max difference **7 × 10⁻¹⁵ dB** |
| Fresnel-Kirchhoff ν, five geometries | max relative difference **2 × 10⁻¹⁶** |

That is floating-point rounding. The two implementations are the same formula.

**One correction to the register's own claim.** It said the formula was checked
against "6.02 dB at grazing incidence". The approximation actually gives
**6.0329 dB**; 6.02 dB is the exact theoretical value the approximation
approaches. The test now asserts 6.0329.

**What this does not establish.** P.526 itself is still unread. What was checked
is an ITU-authored implementation of the same equation as it appears in a
different Recommendation. If the two Recommendations state it differently, this
would not show it. The register status is `cross-checked`, which is a new status
meaning exactly that, and no stronger.

## Item 2: Penmanshiel and Kelmarsh SCADA, search-summary → analysed

**Host tried:** `zenodo.org` and `doi.org`. Both refused, as in the first pass.

**Mirror that worked:** `charlie9578/CubicoOpenData`, notebooks by the person who
published those datasets. The datasets are not in the repository. **The saved
cell outputs are**, and they carry real Kelmarsh data:

1. The static table: six Senvion MM92, 2050 kW, 92 m rotor, with latitude,
   longitude, ground elevation and hub height per machine.
2. Power against wind speed, binned, per machine, 0 to 6.85 m/s.
3. Power against generator speed, binned, per machine, 826 to 1802 rpm.

Items 2 and 3 compose: invert the second and feed it the first, and you get the
speed the machines actually run at by wind speed. That is precisely the curve
this tool models.

### The model assumption that was wrong

**`rotorRpm` tied rotor speed to the rated *power* wind speed.** It assumed speed
rises in proportion to wind all the way to rated power at 12 m/s.

That is not how a variable-speed turbine runs. There are three regions:

| Region | What is happening |
| --- | --- |
| 2 | the controller holds a constant tip-speed ratio, so speed rises with wind |
| 2.5 | **speed is already at its maximum**; torque rises, so power keeps climbing |
| 3 | rated power; blade pitch holds both speed and power |

Tying speed to rated power collapses 2.5 and 3 together and puts the speed
saturation about 3 m/s too late. Measured against 1.07 million Fuhrländer
records:

| Wind | Measured rpm | Old model | Error |
| --- | --- | --- | --- |
| 6.5 m/s | 10.51 | 8.76 | −16.7% |
| 7.0 | 11.33 | 8.76 | −22.7% |
| **7.5** | **12.17** | **9.13** | **−25.0%** |
| 8.0 | 12.93 | 9.73 | −24.7% |
| 9.0 | 13.87 | 10.95 | −21.1% |
| 10.0 | 14.01 | 12.17 | −13.2% |

Worse than 10% low right across 6 to 10 m/s, which at most UK sites is the most
probable wind band there is. **Blade Doppler is linear in rotor speed**, so this
was a 25% Doppler error exactly where it matters most for deciding whether
turbine returns fall inside or outside an MTI notch.

### Cross-checking the two datasets against each other

The two sources agree on the **shape** and disagree on two **constants**.

| | Fuhrländer FL2500 | Kelmarsh Senvion MM92 | Disagreement |
| --- | --- | --- | --- |
| Slope in the proportional region | 11.07 %rated per m/s | 12.0 %rated per m/s | **8%** |
| Minimum speed of a running machine | 60.0% of rated | 53% of rated | **7 points** |
| Saturation wind speed | 9.5–10 m/s (measured) | ~8.3 m/s (extrapolated) | not comparable |

Both say the same thing qualitatively: a floor, then a proportional region, then
saturation well below the rated-power wind speed. Neither supports the old model.

Two caveats on the Kelmarsh numbers, both of which matter:

- It reports **generator** speed, not rotor speed. The *ratio* to rated is valid
  without knowing the gearbox ratio, so the 53% floor and the 12.0 %/m/s slope
  stand. The absolute tip-speed ratio does not: getting that needs the MM92's
  rated rotor speed, which was not retrieved.
- The generator-speed bins **start at 800 rpm** because that is where the
  notebook's bin range starts. Anything slower was discarded before plotting, so
  53% is a censored lower bound on what can be observed, not the machine's floor.

### The correction

Rotor speed is now limited by **tip-speed ratio**, not by rated power:

```
omega = smooth_min( lambda * v / R,  omega_rated ),  floored at omega_min
```

- **λ = 7.63**, measured. Across 6.5 to 8.5 m/s the Fuhrländer data gives rotor
  tip speed over wind speed as 7.63, constant to within **0.3%**, which is the
  signature of a controller holding tip-speed ratio. This is a measurement, not
  a recalled textbook range.
- **The approach to rated speed is soft, not a corner.** SCADA is a ten-minute
  mean and a machine in a fluctuating wind spends only part of each interval
  against its limit, so the averaged curve asymptotes: the measured machine sat
  at 95% of rated at the nominal saturation wind and reached 100% only near
  13 m/s. A hard clamp ran 4 to 5% high across 9 to 11 m/s.
- **ω_min defaults to 0.60**, the value measured directly as a rotor-speed ratio.
  Kelmarsh says 0.53 for a different machine. Both are real; the parameter is
  exposed and the 0.53 to 0.60 spread is stated, because it moves low-wind blade
  Doppler by 13%.

| | Worst error | Mean absolute error |
| --- | --- | --- |
| Before | **−25.0%** at 7.5 m/s | 10.4% |
| After | **−5.1%** at 5.0 m/s | **1.46%** |

Six tests in `test/calibration.test.mjs` hold it there.

## Item 3: the Kelmarsh layout, which the first pass could not test at all

The Fuhrländer dataset had **no turbine coordinates**, which is why the first
pass said plainly that the wake model and the layout model could not be tested.
The Kelmarsh static table has them.

```
turbine          east    north  hub m  ground m
Kelmarsh 1       -273      -95   78.5     145.6
Kelmarsh 2       -436      121   78.5     156.6
Kelmarsh 3        -74      264   68.5     153.5
Kelmarsh 4        133     -298   78.5     146.3
Kelmarsh 5        174       94   78.5     142.9
Kelmarsh 6        476      -86   68.5     135.0
```

Two more assumptions contradicted.

**Spacing is far less regular than the generator was producing.** Nearest
neighbours run from **2.94 to 4.29 rotor diameters**, a max/min ratio of
**1.46**. The default jitter of 60 m produced 1.10. It is now 210 m, which
reproduces 1.46.

**Two of the six machines are 10 m shorter than the other four** — 68.5 m hub
against 78.5 m. The model had no way to express that at all. Combined with
ground levels spanning 21.5 m, the real array spans **31.5 m in tip height above
sea level**, against about **8 m** from the model.

That last number is the one that matters for a radar tool. Tip height above sea
level is exactly what decides which machines clear a horizon or a terrain
screen. Collapsing a 31.5 m spread to 8 m understates how mixed the visibility
across a real farm is by roughly a factor of four.

| | Model before | Model after | Measured |
| --- | --- | --- | --- |
| Nearest-neighbour ratio | 1.10 | **1.47** | 1.46 |
| Hub heights in the array | 1 | 1 or 2, configurable | 2 |
| Tip AMSL spread | 7.2 m | 16.7 m with a 10 m hub spread | 31.5 m |

**What was deliberately not done.** One farm of six turbines is thin evidence for
a default. The spacing figure is fitted to it and says so. The *magnitude* of the
hub-height difference is site specific, so the tool does not invent one:
`hubHeightSpreadM` defaults to **zero**, and a new finding, `uniform-hub-height`,
fires whenever an array has a single hub height and tells the user what the one
real array measured. Existence is evidenced; magnitude is not; the tool asserts
only what it can support.

The residual gap, 31.5 m measured against 16.7 m modelled, is synthetic terrain
being too flat at farm scale. That is a reason to import real terrain, not a
reason to tune the terrain generator to one farm.

## Everything else: not reachable, and that is the whole answer

Twenty-two of the twenty-five unretrieved items have no GitHub mirror. Each now
carries a caution in the register naming the hosts tried and stating that
nothing was read and that no figure from it is used as a constant in the model.

| Item | Hosts tried |
| --- | --- |
| CAP 764, CAP 670 | `publicapps.caa.co.uk`, `consultations.caa.co.uk` |
| EUR Doc 015, ICAO Annex 14 | `www.icao.int` |
| Jenn & Ton 2012, Ella 2022 | `onlinelibrary.wiley.com`, `downloads.hindawi.com` |
| Applied Sciences 2019 | `www.mdpi.com` |
| NTIA TR-08-454 | `its.bldrdoc.gov`, `www.ntia.gov` |
| Wang 2013 | `downloads.hindawi.com` |
| JTECH 2009 | `journals.ametsoc.org` |
| AMT 2021 turbine RCS | `amt.copernicus.org` |
| RAM and blade patents | `patents.google.com` |
| DOE WTRIM | `www.nrel.gov`, `www.osti.gov` |
| Yaw deadband, availability literature | `arxiv.org`, `core.ac.uk` |
| Jensen wake model reference | `gitlab.windenergy.dtu.dk`, `orbit.dtu.dk` |

The `DTUWindEnergy/PyWake` GitHub repository is a pointer to DTU's GitLab and
contains only a README, so **the Jensen wake model still has no independent
reference implementation to check against**, and the wake model in this tool
remains unvalidated. Albersheim, Skolnik, Ament and Pierson-Moskowitz stay
`recalled`: they are textbook and journal material with no code mirror, and the
existing checks against independently known values are all the confidence there
is.

## Reproducing

```sh
node --test test/calibration.test.mjs   # the measured curves and the ITU comparison
node --test test/*.test.mjs             # 82 assertions
```
