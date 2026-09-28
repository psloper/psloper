# What radar information the tool actually needs

Reproduce every number here with `node tools/radar_sensitivity.mjs` from the
`windfarm-radar` directory. The tool perturbs one radar parameter at a time by
a realistic error and measures how far the worst-case detection margin moves,
across wind farms at 5, 9, 20 and 40 km. The ranking is measured, not judged.

## The six that decide the answer

Ask for these first. Getting any one of them wrong can flip a result.

| Parameter | A plausible error | Moves the worst margin by | Changes turbine plots by |
|---|---|---|---|
| Antenna height above ground | out by 10 m | **10.6 dB** | 11 |
| Azimuth beamwidth | out by 0.4 deg | **8.2 dB** | 2 |
| Elevation beamwidth | out by 1 deg | **8.0 dB** | 4 |
| Beam tilt (elevation of peak gain) | out by 2 deg | **7.5 dB** | 12 |
| Transmit frequency | S-band assumed, actually L-band | **6.7 dB** | 11 |
| Antenna gain | out by 3 dB | **6.0 dB** | 1 |

Antenna height is worth chasing hardest. Radio horizon goes as the square root
of height, so a 10 m error moves the horizon by kilometres and changes which
turbines the radar can see at all.

## Worth having, but not worth delaying for

Transmit power (3.0 dB for a halving), compressed bandwidth (3.0 dB),
system loss (3.0 dB), noise figure (2.0 dB), scan rate (1.1 dB),
pulse repetition frequency (0.7 dB).

## Ask for these only in one specific case

MTI rejection depth changes the answer by **0.0 dB** for turning rotors and by
**20 dB** for parked ones. A turning blade puts its Doppler far outside the
clutter notch, so the rejection figure never applies; a stopped rotor sits
inside it. Ask for MTI figures only when parked machines are part of the
assessment.

The peak **azimuth sidelobe level** behaves the same way, but the condition is
the geometry rather than the rotor. Measured against farm range, with a 10 dB
error in the level:

| farm range | worst turbine clutter cost | margin shift | tracks lost |
|---|---|---|---|
| 2 km | 38.1 dB | 20.0 dB | 0 becomes 2 |
| 3 km | 28.2 dB | 20.0 dB | 0 becomes 1 |
| 4 km | 19.3 dB | 8.7 dB | none |
| 5 km | 10.8 dB | 3.0 dB | none |
| 9 km | 24.4 dB | 0.2 dB | none |
| 20 km | 13.9 dB | 0.0 dB | none |

A turbine only sits in the sidelobe region once the array subtends more than
about 1.7 beamwidths, so the closer the farm the more this one number decides.
Ask for it whenever the array is inside about 5 km. It is an antenna property.
It is **not** the pulse-compression range sidelobe level, which is what
operators tend to send when asked for "the sidelobe level", and which the tool
used to use for both until this was corrected.

## What makes no measurable difference

Instrumented range, dynamic range, pulse width, range sidelobe level,
cosecant-squared coverage limit and MTI notch width all came out at 0.0 to
0.3 dB. Do not spend a meeting on them.

## Worked example: the Thales STAR NG datasheet

The published STAR NG / RSM NG military ATM datasheet (THALES LAS France,
15 June 2023) was read in full. The text is stored verbatim at
`docs/evidence/thales-star-ng-datasheet-2023-06-15.txt` and every figure the
tool quotes from it is checked against that file by the test suite.

It supplies **none of the six parameters above.** What it does supply:

| From the datasheet | Where it sits in the ranking |
|---|---|
| Scan rate from 10 to 15 RPM | 1.1 dB, thirteenth |
| Range up to 120 NM with PSR | 0.0 dB, last |
| S Band | pins frequency only to somewhere between 2 and 4 GHz |

That is the general lesson, not a complaint about Thales. A sales datasheet
sells capability, and the parameters that decide an interference assessment
are not selling points. They come from the operator or from a site survey.

Two further things the datasheet states that matter here:

- **"STAR NG has a dedicated, and field proven, processing to mitigate
  windfarm impact."** No figure is given. The `star-ng` preset therefore
  credits it with nothing (0 dB). Results for this radar are an **upper bound
  on the turbine problem, not a prediction.** If you are assessing against a
  real STAR NG, ask the operator what that processing is worth in dB and what
  it costs in probability of detection, because the answer is likely to be the
  single largest term in the assessment.
- **3D detection.** The preset copies a 2D terminal PSR's elevation behaviour,
  which will be pessimistic. No elevation pattern is published.

Everything in the `star-ng` preset other than band, scan rate and maximum
range is copied from the generic terminal PSR preset and is **not the real
radar.** `RADAR_PRESET_PROVENANCE` in `js/model.js` lists exactly which is
which, and the test suite fails if that list and the numbers drift apart.
