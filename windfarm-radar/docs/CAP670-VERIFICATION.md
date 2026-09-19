# CAP 670: what was checked, and what changed

The document was read on 2026-09-19 from a `.docx` copy: **CAP 670, Third Issue,
Amendment 1/2019, 1 June 2019, effective 1 August 2019.** The relevant text is
stored in this repository so the checks can be repeated:

- `docs/evidence/cap670-partB-s4-gen01-gen02-2019.txt` (GEN 01, GEN 02, Appendix A to GEN 02)
- `docs/evidence/cap670-partC-s3-sur13-2019.txt` (SUR 13, the radar requirement)

Every figure and quote in `js/cap670.js` is checked against those files by
`test/cap670.test.mjs`. A figure cannot be edited into the module unless CAP 670
actually contains it.

**80 checks: 70 confirmed, 7 corrected, 3 still open.** The full record is
`docs/CAP670-verification-checklist.xlsx`, rebuilt by
`node tools/build_cap670_checklist.mjs`.

## The four things the tool was getting wrong

### 1. Four green distance thresholds that do not exist

The tool printed green distances of 1.8, 3.5, 5.8 and 10.5 km for the Small,
Medium, Large and Reference classes. **Table 2 leaves those four cells empty.**
It publishes a Green distance for Large Industrial only, 17.2 km. The four
numbers came from the third-party summary, not from CAP 670.

A distance can now only be Red or Amber for those four classes, however far away
the turbine is, and the tool says so on every such result. That is what the
document does, not a limitation of the tool.

### 2. The angle is an elevation angle, not a subtense

The tool inferred that the angle column was the angular subtense of the turbine
seen from the site. Appendix A states the two zonal parameters plainly:

> Minimum separation between turbine and infrastructure site assuming a flat earth
>
> Angular displacement of turbine hub with respect to infrastructure site base level

So it is the **elevation angle of the hub above the radio site base level**, on a
flat earth. A subtense grows as a turbine gets closer and ignores height; an
elevation angle does the opposite. This was the largest single unknown in the
module and it is now settled.

### 3. Table 3 was harsher than the document in four of nine cells

Only one cell of Table 3 had been supplied. The other eight were inferred by
taking the worse of the distance and angle verdicts. All nine are now read:

| Distance | Angle | Overall | Rationale |
|---|---|---|---|
| Red | Red | Red | Excessive impact |
| Red | Amber | **Amber** | Terrain sloping downwards |
| Red | Green | Green | Terrain sloping downwards |
| Amber | Red | Red | Excessive impact |
| Amber | Amber | Amber | Indeterminate impact |
| Amber | Green | **Green** | Terrain sloping downwards |
| Green | Red | **Amber** | Terrain sloping upwards |
| Green | Amber | **Green** | Marginal impact |
| Green | Green | Green | Acceptable impact |

The four in bold are the ones the inference got wrong, all of them harsher than
CAP 670. Read as a rule: the angle decides, except that a green distance softens
a red angle to amber.

### 4. Table 1 is now implemented

The height bands were previously unavailable, so the class was inferred from
rotor diameter alone. Table 1 gives bands for hub height, rotor diameter **and**
tip height, and the document's rule is that each dimension is classified on its
own and the largest resulting class wins. Its own worked example confirms it: a
turbine with a 20 m hub, an 18 m rotor and a 29 m tip is Medium *"due to the
rotor diameter exceeding 15 metres"*.

## How much did this change?

Measured, not asserted. `node tools/cap670_correction_impact.mjs` runs 7,410
geometries (rotor 15 to 150 m, 0.15 to 30 km, 1 to 30 turbines, turbine ground
80 m below to 80 m above the radio site) through the superseded logic and the
current logic:

| | Changed | |
|---|---|---|
| Turbine class | 6,270 | 84.6% |
| Zonal verdict | 1,926 | 26.0% |
| Routing outcome | 852 | 11.5% |

Of the zonal changes, the old logic was harsher in 1,164 cases (15.7%) and more
permissive in 762 (10.3%). **On balance the tool was harsher than CAP 670**, so
it would have raised objections the document does not require. But it was
permissive in one case in ten, which is the expensive direction to be wrong in.

## Three things are still open

### The process flow chart, and Figure 3

Both are **images**. The text of the document was extracted and read; the
pictures were not. So the reported inversion of the last decision box
("Operational impact identified? YES leads to no objection", which reads
backwards against the surrounding text) is unresolved. The tool takes the
conservative reading: an operational impact leads to an objection.

### Table 3 contradicts the Red zone definition

The Red zone is defined as:

> Violation of this parameter will result in automatic rejection of the
> development proposal.

Yet Table 3 turns a Red distance with a Green angle into an overall **Green**.
Both are printed in CAP 670. The table is applied as printed and the
contradiction is reported on any result that hits it, because resolving it
either way would be this tool deciding what the regulator meant.

### Tables 4 and 5 are internally inconsistent for the Large class

Found by running the document's own scaling formula against its own tables:

    Monostatic RCS = 10 log(23281 * (Rotor Diameter / 90)^2 * Frequency / 461) dBm^2

| Class | Table 1 rotor top | Formula, VHF | Published, VHF | Implied rotor |
|---|---|---|---|---|
| Large Industrial | 126 m | 40.99 | 41.0 | 126.1 m |
| Reference | 90 m | 38.07 | 38.1 | 90.3 m |
| **Large** | **60 m** | **34.55** | **33.8** | **55.0 m** |
| Medium | 35 m | 29.87 | 29.9 | 35.1 m |
| Small | 15 m | 22.51 | 22.5 | 15.0 m |

Four of the five classes scale exactly from the top of their published rotor
band. The Large class does not: its figures correspond to a 55 m rotor against a
published band top of 60 m. The gap is 0.75 dB in VHF and 0.77 dB in UHF, the
same in both bands, so it is one wrong input diameter rather than rounding.

The direction is permissive: the published value is the lower one. The published
values are used as printed and nothing is corrected, because correcting it would
mean this tool printing a number CAP 670 does not contain. This confirms the
Large-class RCS mismatch flagged before the document was available, and pins it.

## SUR 13, the radar requirement

Read in full. It places duties on an air navigation service provider: inform the
CAA Regional Inspector of known effects, conduct a Line Of Sight Analysis where
there is reasonable doubt, justify the mitigation by local safety assessment,
comply with the listed interoperability and ICAO provisions.

**It contains no radar performance thresholds, no RCS figures and no acceptance
criteria a tool can compute against.** So nothing in this tool is gated on it.
The line of sight analysis the tool performs is the kind SUR 13.5 requires, but
SUR 13 sets no pass or fail criterion for it, so what the tool reports is
geometry, not compliance.

## What was not checked

Whether a Supplementary Amendment supersedes the 1 August 2019 edition. The CAA
is unreachable from the environment this was built in.
