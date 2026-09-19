# Real UK wind farm and radar positions: what was obtainable, and what it says

The question this answers: **do we have physical data for the locations of UK
wind farms and radar, and what type of radar are they?**

**Wind farm positions: yes, and the accuracy is measurable rather than assumed.**
2,489 records covering the whole UK planning pipeline, current and planned, each
with a development status. At the one site where this tool has ground truth the
recorded point is **1,141 m** from the true centre of the array, which is 2.4
times the radius of the array itself. Coordinates are written to five decimal
places; that is precision, not accuracy.

**Civil radar positions: yes, 55 sites, but only from community sources**, and
the two independent ones disagree with each other by a median of 1.4 km.

**Radar types: partly, and not reliably.**

**Military air defence radar: no**, and that is the one that most often decides
a real UK wind farm application.

Everything below was produced by `calibration/fetch_uksites.py` (download),
`calibration/build_uksites.py` (generate `js/uksites.js`) and
`calibration/uk_sites.mjs` (the correlation, which runs on this tool's own
propagation and radar maths).

## What the network would and would not allow

This matters more than anything else here, so it goes first. Outbound traffic
in this environment goes through a policy proxy. Every one of these was
refused with a 403 on CONNECT:

| Wanted | Host | Result |
| --- | --- | --- |
| REPD, the primary wind farm source | `data.gov.uk`, `assets.publishing.service.gov.uk` | blocked |
| NATS radar safeguarding maps | `nats.aero` | blocked |
| CAP 764 and CAP 670 | `caa.co.uk`, `consultations.caa.co.uk` | blocked |
| Turbine positions from OpenStreetMap | `overpass-api.de`, `overpass.kumi.systems`, `api.openstreetmap.org` | blocked |
| Crown Estate offshore data | `opendata-thecrownestate.opendata.arcgis.com`, `services.arcgis.com` | blocked |
| Penmanshiel / Kelmarsh SCADA | `zenodo.org`, `doi.org` | blocked |
| Turbine RCS measurement paper | `amt.copernicus.org` | blocked |
| KIS-ORCA offshore structures | `kis-orca.org` | blocked |

What was allowed: `raw.githubusercontent.com` and the GitHub API. So every
dataset below exists in the tool because somebody mirrored it on GitHub, not
because the authoritative source was reachable. That is a real constraint on
how much weight any of it can carry.

## Source A: wind farms, and whether the positions are accurate

`Ventusltd/globalgrid2050`, `testcode/<snapshot>/atlas/data/repd-identities/*.json`.
A snapshot of the **UK Renewable Energy Planning Database**, Crown copyright
under the **Open Government Licence v3**, which permits reuse with attribution.
The mirroring repository declares no licence of its own; what is used here are
the OGL-licensed facts, and both the REPD and the mirror are attributed.

**2,489 wind records with valid geometry**, each carrying a development status.

### Status, which is most of the answer

| Status | Sites | Capacity |
| --- | --- | --- |
| Operational | 832 | 31,519 MW |
| Under Construction | 44 | 13,883 MW |
| Awaiting Construction | 220 | 38,017 MW |
| Application Submitted | 179 | 28,900 MW |
| **Current or planned** | **1,275** | **89,199 MW** |
| Application Refused | 370 | 9,366 MW |
| Application Withdrawn | 268 | 7,328 MW |
| Revised (superseded) | 225 | 5,378 MW |
| Appeal Refused | 200 | 4,233 MW |
| Abandoned, expired, appeal withdrawn, decommissioned | 150 | 3,140 MW |

**Two thirds of the table is not a wind farm.** Treating every row as one
overstates the fleet roughly threefold. The tool filters on status by default
and makes including the rest a deliberate act.

85 of the 1,275 live records are offshore, carrying 54,003 MW of the 89,199 MW.
The snapshot is current enough to contain Hornsea 3 and 4, Dogger Bank A to D,
Berwick Bank, Morgan and Mona.

### The accuracy test, at two sites

Stated precision and measured accuracy are different quantities and the gap here
is three orders of magnitude.

| | Value | What it is |
| --- | --- | --- |
| Stated precision | **±1.1 m** | five decimal places, as written in the table |
| Measured accuracy | **±1,100 m** | what happens when you check against ground truth |

There are two UK sites where real turbine coordinates were obtainable.

**Kelmarsh**, all six turbine positions known, from the Zenodo static table
recovered out of a notebook on GitHub.

| Quantity | Value |
| --- | --- |
| True array centroid | 52.401461, −0.943105 |
| Array radius | 483 m |
| Longest span across the array | 935 m |
| REPD record | 52.40280, −0.95980 |
| **Error against the centroid** | **1,140 m = 2.4 × the array radius** |
| Distance to the *nearest* turbine | 695 m |
| Distance to the *furthest* turbine | 1,623 m |

The sharpest way to say it: **the whole array lies between 0.7 and 1.6 km from
the recorded point.** Not one of the six machines is within half a kilometre of
where the record puts the project.

**Penmanshiel**, one turbine position known, published independently by two
third parties who both took it from the same Zenodo static table.

| Reference | Value | REPD error against it |
| --- | --- | --- |
| `NinaEffenberger/wind-variability` | 55.902502, −2.306389 | **1,121 m** |
| `CSomers3/uq4wind` | 55.904000, −2.305000 | **1,289 m** |

Those two differ from each other by 188 m, which is the rounding in the second.
The same author gives Kelmarsh as 52.400604, −0.947133, which is *exactly*
turbine Kelmarsh 1 in the static table, so these are single turbines rather than
array centres. At Kelmarsh, turbine 1 sits 289 m from the centroid, so a few
hundred metres of the Penmanshiel figure is that offset rather than REPD error.

**Two unrelated sites, both out by about 1.1 km.** That is why the tool now
carries `POSITION_UNCERTAINTY_M = 1100` as a measured quantity with its working
attached, rather than repeating the "about a kilometre" the REPD is generally
described as carrying.

**n = 2.** Two measurements are not an error distribution either. They are
enough to say the scale of the error is a kilometre and that it is not peculiar
to one site. They are not enough to bound it.

### Why it is wrong, which the record says itself

The Kelmarsh record is named *"Kelmarsh Wind Farm (Resubmission)"*. It is a
planning application, and the coordinate is the grid reference on the
application, filed before the layout was fixed. **88 records carry
planning-process wording in their names**: resubmission, revised application,
extension, repowering, phase.

### What it means in practice

The error is roughly constant in metres, so what matters is the range it is
compared against.

| Range to radar | 1.1 km as a share of it | What that does |
| --- | --- | --- |
| 50 km | 2% | negligible |
| 10 km | 11% | noticeable in the shadow geometry |
| 2 km | 55% | the geometry is about a hypothetical site |
| 0.9 km | **126%** | the error exceeds the whole range |

**Six live projects sit where the position error exceeds a fifth of the range.**
The worst is Rivox, 208 MW with an application submitted, 0.87 km from the
Lowther Hill en-route radar, where the error is **126 per cent of the range**.
The closer and more alarming the pairing, the less the position can be trusted,
which is exactly backwards from what you want. The tool raises this as a major
finding rather than leaving it in a footnote.

### Independence, established before treating agreement as confirmation

The previous version of this dataset was the WRI Global Power Plant Database.
Comparing the two gives a median disagreement of about 3 m across 531 exact name
matches. That looks like powerful corroboration. It is worth nothing.

**The Global Power Plant Database records its own ancestry, per row.** Its
`geolocation_source` column reads `UK Renewable Energy Planning Database` for
**771 of its 780 UK wind rows**. That is documentary, not inferred. Comparing
the two compares the REPD with itself.

The agreement distribution shows the same thing without needing the metadata:

| Disagreement | Records | Share |
| --- | --- | --- |
| 0–1 m | 36 | 6.8% |
| 1–10 m | 477 | 89.8% |
| **10–100 m** | **0** | **0.0%** |
| 100–1,000 m | 6 | 1.1% |
| over 1 km | 12 | 2.3% |

**Nothing at all between 10 m and 100 m.** Two independent measurements of the
same place produce a continuous spread. A gap like that is the fingerprint of
one measurement copied twice; the 3.4 per cent tail is name collisions between
different projects, not disagreement about the same one.

No genuinely independent UK position source was reachable. Overpass,
openstreetmap.org, the Geofabrik extracts, OpenInfraMap and Wikidata are all
refused by this environment's network policy, and the OSM-derived and aviation
obstacle datasets that are mirrored on GitHub cover Berlin, Slovakia and China
rather than the UK. **Everything in this tool traces to the REPD, and the only
check on it is the two ground-truth sites above.**

## Sources B and C: civil radar positions

Two community sets, merged on **position** rather than name, because they name
the same installations differently.

| | Source B | Source C |
| --- | --- | --- |
| Repository | `VATSIM-UK/UK-Sector-File` | `open-air-data/atc-radar` |
| File | `Misc Other/Radar Sites.txt` | `data/radars.geojson` |
| Licence | **none declared** | ODbL / DbCL |
| Purpose | flight simulation sector file | ATC radar site geodata, mostly FAA |
| UK content | 17 NATS En Route sites, 32 aerodrome sites | 23 features in the UK and Ireland box |

Because source C is ODbL, the merged radar list derived from it is offered
under ODbL, and attribution to both projects is required. Source B declares no
licence, so its file is read and its coordinates derived, but the file itself
is not redistributed here.

Merging gives **55 distinct sites**: 17 en-route, 32 aerodrome, 6 carried only
by source C (including four in Ireland).

### The cross-check, which is the useful part

17 sites appear in both sources. That gives an independent check on position,
which is the only one available here.

| Site | Separation between the two sources |
| --- | --- |
| Claxby | 3 m |
| Great Dun Fell | 173 m |
| Glasgow | 422 m |
| Pease Pottage | 836 m |
| Lowther Hill | 978 m |
| Debden | 1,412 m |
| Sumburgh | 1,416 m |
| Heathrow | 1,479 m |
| Gatwick | 1,642 m |
| Stansted | 1,682 m |
| Clee Hill | 2,643 m |
| St Annes | 2,971 m |
| Burrington | 3,206 m |
| Cromer | 3,970 m |
| Tiree | 5,891 m |

**Median 1,416 m. Maximum 5,891 m.**

How much does that matter? Re-running the whole screening with every
dual-sourced site moved to its alternative position:

- farms within 30 km of a radar: **278 to 280**
- farms in smooth-earth line of sight: **647 to 646**

So a 1.4 km site error barely moves an aggregate, and matters a great deal to
any individual close pairing. Use these positions to set up a realistic
geometry. Do not use them to decide whether one particular farm is a problem.

### Naming, which is its own hazard

The two sources disagree on names as well as positions. **Sandwick** (source B)
and **STORNOWAY** (source C) are the same installation, 10 m apart. Source B
spells it **Allanshill**, source C **ALANSHILL**, and puts it 5.4 km away.
Matching on name would have produced duplicate sites and missed cross-checks;
matching on position did not.

### What was deliberately thrown away

The sector file carries numeric columns after each coordinate that look like
site elevation in feet. They were **not used**. Great Dun Fell is given as
1,428 ft, and the summit it stands on is about 2,780 ft. Whatever that column
means, it is not the thing it appears to be, and the range columns are
similarly suspect: en-route sites are given a 200 NM "primary" range, which is
long for any primary surveillance radar. Only the coordinates were taken.

## Radar types: a partial and unreliable answer

The user asked what type the radars are. Honestly:

- **Source C carries a `type` field** with values like `ASR9-MDS`, `ARSR-4`,
  `ATCBI-6`, `FPS-117`. **Every UK and Ireland feature has it empty.** The
  field is populated for FAA sites only.
- **Source B carries no type at all.**
- So the tool holds **no verified radar type for any UK site**.

From search summaries, not retrieved documents, and therefore not in the data:
NATS replaced its en-route radar network and contracted Raytheon in 2016 to
supply Mode S monopulse secondary radar to 23 NATS radar sites. BAE Systems
produces the Watchman family used at UK aerodromes and developed a "Watchman
Update" aimed at wind farm returns. None of that was read from a primary
source and none of it is asserted as fact by the tool.

## Military radar: absent, and that is the important gap

**No military radar is in either source, and none is in the tool.**

The evidence for the absence is direct: source B's file ends with the literal
line `;Mil Radars TBA` where military sites would go. The open aviation data
sets do not carry them.

MOD safeguarding of air defence radar is what most often decides a UK wind farm
application. The MOD safeguards communication, navigation and surveillance
sites through consultation zones, described in the material found as circles of
30 km radius around a technical site, with site-specific maps issued on request
in shapefile and PDF form. None of that was obtainable here.

The tool records the following site names and radar types from **search
summaries only**, with **no coordinates asserted**, so that a user knows which
authority to approach rather than so the tool can pretend to model them:

| Site | Radar reported | Confidence |
| --- | --- | --- |
| RRH Benbecula | Lockheed Martin AN/TPS-77 (AMES Type 92) | search summary |
| RRH Buchan | Lockheed Martin AN/TPS-77 (AMES Type 92) | search summary |
| RRH Saxa Vord | re-established; type unconfirmed | search summary |
| RRH Staxton Wold | Indra LTR-25 deployable air defence radar | search summary |
| RRH Portreath | BAE Systems Type 102 | search summary |
| RRH Brizlee Wood | not established | none |
| RRH Trimingham | AN/TPS-77, reported dismantled 2023 | search summary |

Treat all of it as unverified. For a real assessment, the Defence
Infrastructure Organisation is the source.

## What the real geometry actually says

Run `node calibration/uk_sites.mjs`. It runs on the live pipeline only; pass
`--all` to include refused and abandoned projects. Output as of this commit:

```
records: 2489 total, 1275 in scope (built or in the pipeline)
  offshore in scope: 85 sites, 54003 MW of 89199 MW

=== UK wind farms vs nearest civil radar site ===
farms: 1275   radar sites: 55
nearest-radar distance: min 0.9 km, p10 17, median 38, p90 86, max 250 km
  within 10 km: 37 farms (2.9%), 1604 MW
  within 15 NM (SSR): 411 farms (32.2%), 11965 MW
  within 30 km (MOD technical site): 472 farms (37.0%), 14669 MW

=== smooth-earth line of sight to a 150 m tip (k = 4/3, NO terrain) ===
farms inside nearest-radar line of sight: 1040 of 1275 (81.6%)
  capacity inside: 51658 MW of 89199 MW

=== single-turbine clutter-to-noise at the real range (40 dBsm, main beam) ===
clutter-to-noise across 1040 in-sight farms: min 41 dB, median 57 dB, max 127 dB
  above 60 dB (well past any MTI rejection the presets model): 403 (38.8%)
```

Read that carefully, because two of those numbers are easy to misuse.

**81.6 per cent in line of sight is an upper bound, not a finding.** It is
smooth-earth geometry with no terrain at all, so nothing is ever shielded by a
hill. The real figure is lower, and by how much depends entirely on terrain this
environment could not fetch: the free DEM sources the tool can import are all
behind blocked hosts. The number is worth having precisely because it is an
upper bound.

**The clutter-to-noise figures are single-turbine, main-beam, 40 dBsm.** They
assume the radar is looking straight at the machine with full antenna gain. The
number says how much signal is there to be rejected, not how much gets through:
that is what the rest of the tool computes.

The three thresholds (10 km, 15 NM, 30 km) are **bins, not rules**. They appear
in UK safeguarding practice as described in retrievable summaries. The documents
that would define them were blocked.

## Worst pairings the data produces

| Wind farm | Status | Nearest radar | Range | Single-turbine C/N |
| --- | --- | --- | --- | --- |
| Rivox, 208 MW | **Application Submitted** | Lowther Hill (en-route) | 0.9 km | 127 dB |
| Stornoway (second resubmission), 196 MW | **Awaiting Construction** | Sandwick (en-route) | 1.8 km | 115 dB |
| East Midlands Airport, 1 MW | Operational | East Midlands (aerodrome) | 1.1 km | 111 dB |
| Greenhill Croft | Operational | Allanshill (en-route) | 5.8 km | 95 dB |
| Arnish Moor | Operational | Sandwick (en-route) | 6.0 km | 94 dB |
| Rosehill | Operational | Kincardine (en-route) | 6.4 km | 93 dB |
| Mains of Hatton | Operational | Allanshill (en-route) | 6.6 km | 92 dB |
| Beinn Thulabaigh | Operational | Sandwick (en-route) | 7.2 km | 91 dB |
| Point Wind / Beinn Ghrideag | Operational | Sandwick (en-route) | 7.2 km | 91 dB |
| House O'Hill | Operational | Allanshill (en-route) | 7.7 km | 90 dB |

Every one of these is a **candidate to look at**, not a problem found. Several of
them operate today, which is the point: a large clutter return at short range is
normal and is dealt with by the radar's processing and by mitigation. The tool
exists to work out what is left after that.

The top two only appear because the dataset now carries the planning pipeline.
Both are live cases rather than history, and both sit inside a kilometre or two
of a NATS en-route radar, which is where the position error matters most and can
be trusted least.

## Using it

The tool's Site tab has a **Real UK sites** group. Choose a scope, choose a wind
farm, choose a radar or take the nearest automatically, and press **Place this
pairing**. It sets the site origin to the farm's recorded position and places
the farm at its true bearing and range from that radar.

The scope selector defaults to **built or in the pipeline**, and can be narrowed
to operational only, under construction, consented, or applications submitted,
or opened to every record including the refused and abandoned. Picking a record
that will not be built says so in capitals.

Three behaviours to know about:

- **Land or sea is now set from the data.** The record carries whether the
  project is offshore, and placing a pairing sets the surface accordingly. That
  was a gap in the previous version.
- The distance control stops at 60 km. A pairing further out is **clamped**, the
  bearing stays real and the range does not, and the note says so. The report
  records the true range alongside the clamped one.
- The note names the **REPD reference** for the record, so a real assessment can
  start from the actual planning file rather than from this tool.

## Reproducing

```sh
python3 calibration/fetch_uksites.py   # writes data/uk-*.json
python3 calibration/build_uksites.py   # writes js/uksites.js
node calibration/uk_sites.mjs          # the correlation above
node calibration/uk_sites.mjs --all    # including refused and abandoned
node --test test/*.test.mjs            # 85 assertions, 12 of them on this data
```

## Attribution

- Wind farm records: the UK Renewable Energy Planning Database, Crown copyright,
  Open Government Licence v3, reached through the `Ventusltd/globalgrid2050`
  snapshot because data.gov.uk is not reachable from this environment.
- Kelmarsh ground truth: Cubico Sustainable Investments, CC BY 4.0, via
  `charlie9578/CubicoOpenData`.
- Radar positions: `open-air-data/atc-radar` (ODbL) and
  `VATSIM-UK/UK-Sector-File`. The derived radar database is offered under ODbL.
