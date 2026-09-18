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
