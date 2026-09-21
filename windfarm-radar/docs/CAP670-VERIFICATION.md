# CAP 670: what was checked, and what changed

The document was read on 2026-09-19 from a `.docx` copy: **CAP 670, Third Issue,
Amendment 1/2019, 1 June 2019, effective 1 August 2019.** The relevant text is
stored in this repository so the checks can be repeated:

- `docs/evidence/cap670-partB-s4-gen01-gen02-2019.txt` (GEN 01, GEN 02, Appendix A to GEN 02)
- `docs/evidence/cap670-partC-s3-sur13-2019.txt` (SUR 13, the radar requirement)

Every figure and quote in `js/cap670.js` is checked against those files by
`test/cap670.test.mjs`. A figure cannot be edited into the module unless CAP 670
actually contains it.

**89 checks: 74 confirmed, 7 corrected, 8 still open.** The full record is
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

## Second pass: figures elsewhere in the tool

The first pass audited `js/cap670.js`. A second pass swept every other figure in
the tool that CAP 670 could adjudicate, and read Appendix A to SUR 13, the
guidance on the mitigation techniques the tool models.

**No verdict changed.** Every finding id, severity and title is byte-identical
across 12 scenarios (4 separations by 3 mitigation states, 192 findings) before
and after. What changed is provenance and the conditions attached to a
mitigation, not a number.

### Four things CAP 670 does settle

| Figure | Where | Effect |
|---|---|---|
| Sector blanking is permitted only with a robust safety argument that **total** loss of surveillance in the blanked area causes no safety impact | SUR 13.40, and 13.41 on the traffic strategy | The blanking finding now carries this. It did not before. |
| A threshold assessment must account for a **1 m²** target | SUR 13.44 | The only numeric target size CAP 670 names anywhere in its wind turbine material. |
| The mitigations are **guidance only and not CAA-endorsed** | SUR 13A.107 | Recorded. |
| The 10 km SSR proximity figure | SUR 13A.75 | Was carried on a CAP 764 search summary alone. Now corroborated by a document that was read. |

### Five figures CAP 670 cannot adjudicate

Listed rather than filled in:

- **The 30 km primary radar assessment guide.** The string "30 km" does not appear anywhere in CAP 670. It is CAP 764's figure and CAP 764 is still a search summary.
- **Radar absorbent material, 10 dB default.** SUR 13A.105 describes RAM as ferrite paints or polymer layers with crystalline graphite and gives no figure at all.
- **Enhanced Doppler processing, 15 dB default.** CAP 670 sets conditions on amplitude, CFAR and clutter map processing but publishes no rejection figure for any of them.
- **Turbine curtailment.** Not mentioned in CAP 670 anywhere. It is in the tool as a theoretical best case, not a recognised mitigation.
- **Turbine RCS at microwave frequencies.** Tables 4 and 5 are calculated at 127 and 368 MHz. This tool models 1.25 to 9.4 GHz. The scaling formula is linear in frequency and would extrapolate, but a factor of seven beyond the highest frequency the document states is outside what it supports, and turbine RCS does not scale that simply once the wavelength is short against the blade chord. Nothing was extrapolated.

## The target used for proving detection

Asked directly: is there a defined aircraft used for testing radar detection?
No. CAP 670 specifies a **radar cross section**, not an airframe.

| What the document says | Clause | Status |
|---|---|---|
| "Detection at the edge of coverage shall be confirmed with a target of 1 m2 RCS." | SUR 12.35 | **Shall.** Now a selectable target in the tool: "CAP 670 test target, 1 m²", 0 dBsm. |
| "The threshold set shall take in to account ... a 1m2 target likely to fly within the area of interest." | SUR 13.44 | **Shall.** Same size, reached independently in the wind turbine material. |
| "The test should include slices at 1,000, 2,000, 4,000, 6,000, 10,000, and 20,000 ft above the aerodrome reference point" | SUR 12.37 | **Recommendation.** Recorded as `TEST_ALTITUDES`. Datum is the aerodrome reference point, not sea level. |
| "Probability of detection shall be defined for the intended application." | SUR 02.37 | **Shall.** The number belongs to the operator, so no tool can assert it for a site. |
| "Probability of detection should be at least 90% for conventional radars and exceed 97% for Monopulse and Mode S radars" | SUR 02.40 | **Recommendation.** The tool's default Pd of 0.9 matches the conventional figure. |

Every quote above is checked verbatim against
`docs/evidence/cap670-partC-s3-sur02-sur12-2019.txt` by `test/cap670.test.mjs`.
Changing the quoted size from 1 m² to 2 m², or adding an altitude slice the
document does not list, both fail the suite; that was tested rather than
assumed.

### What SUR 12.35 does not say

Recorded in `TEST_TARGET.notSpecified` so the gaps stay gaps:

- No aircraft type, model or manufacturer.
- No airframe dimensions. The span and length the tool draws for this target
  are a light single's, chosen so it can be drawn, and they feed nothing in the
  physics, which treats every target as a point.
- No Swerling case or other fluctuation model for the 1 m² target.
- No polarisation, aspect angle or frequency band at which the 1 m² applies.
  Real RCS varies by tens of decibels with all three, so 1 m² is nominal.
- No separate figure for en-route as against terminal radars.

### Every other target in the tool is an estimate

This is now stated in the tool itself, next to the selector, rather than left
to be inferred. `TARGET_PROVENANCE` marks the CAP 670 target as `standard` and
everything else as `representative`: class-typical, order-of-magnitude, not
from a measurement, a datasheet or a standard.

## Is there a known flight check for wind farms?

No. CAP 670 defines no wind farm flight check: no named profile, no orbit
pattern, no prescribed radial, no pass mark. What it defines is a **duty to
assess performance**, with a flight trial as one of two acceptable methods.

| What the document says | Clause | Status |
|---|---|---|
| "...shall be assessed by a suitable performance assessment method (e.g. targets of opportunity study, flight trial)." | SUR 13.47, and SUR 13.69 for adaptive MTI | **Shall assess.** A flight trial is an example, not a requirement. A targets-of-opportunity study is equally acceptable. |
| "Where antenna beam tilt is adjusted ... flight trials or targets of opportunity traffic analysis shall confirm the performance of the radar meets the operational requirement." | SUR 13.28 | **Shall confirm.** Still either method. |
| "The likelihood of loss of target detection shall be assessed by a comparison of targets detected prior to and after the threshold implementation." | SUR 13.46 | **Shall.** This is a before-and-after of switching a *mitigation* on, not of a wind farm being built. |
| "The assessment period shall be agreed with the relevant CAA Regional Inspector." | SUR 13.48, SUR 13.70 | **Shall.** Scope and duration are settled case by case, not by the document. |

If a trial is flown, the geometry comes from SUR 12, which is about proving a
surveillance system generally and says nothing about wind turbines:

- **SUR 12.22** assess inside the coverage volume where the service is provided, using the system's own data
- **SUR 12.35** confirm detection at the edge of coverage with a 1 m² target
- **SUR 12.38** inbound (centripetal), outbound (centrifugal) and tangential motion
- **SUR 12.39** at least one climb or descent, ideally bottom to top of coverage
- **SUR 12.40** a 360° horizontal profile at the base, the top and a middle level

This tool's own profiles map onto three of those: a level transit is the
inbound and outbound case, a holding orbit is the tangential case, and the 3°
approach is a descent, though SUR 12.39 wants one running the full depth of
coverage. **The tool does not fly the 360° profile of SUR 12.40.** The wind
rose sweep covers every direction statistically, which is not the same thing.

Two things worth not confusing:

- **CAP 670 sets no requirement to fly a baseline before a wind farm is built
  and repeat it afterwards.** The before-and-after in SUR 13.46 is about a
  mitigation being switched on.
- **"Flight inspection" in CAP 670 is not this.** The term appears 169 times,
  almost all in the FLI section about navigation aids such as ILS and VOR,
  citing ICAO Doc 8071 **Volume II**. A surveillance radar flight trial is a
  different activity and none of the FLI requirements carry across.

## What was not checked

Whether a Supplementary Amendment supersedes the 1 August 2019 edition. The CAA
is unreachable from the environment this was built in.

Whether **ICAO Annex 10 Volume IV** itself defines a primary radar reference
target. Every Annex 10 citation inside CAP 670 is about SSR Mode A/C, Mode S,
extended squitter or multilateration, and none carries a primary radar target
size; but Annex 10 was not available here, so its absence of a PSR target is
unverified rather than established.

The **EUROCONTROL Standard for Radar Surveillance in En-Route Airspace and
Major Terminal Areas**, which is the document most likely to carry a different
reference target figure. `eurocontrol.int` is blocked by the network policy of
the environment this was built in. Nothing from it is asserted here.

**ICAO Doc 8071 Volume 3, Testing of Surveillance Radar Systems.** CAP 670
points at it twice as where radar testing methods live (SUR 13A.246, and a note
under SUR 04). It was not available here, so nothing in this tool says what it
specifies for a radar flight trial. If you need the actual method rather than
the duty, that is the document to get.
