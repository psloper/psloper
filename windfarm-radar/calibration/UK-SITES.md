# Real UK wind farm and radar positions: what was obtainable, and what it says

The question this answers: **do we have physical data for the locations of UK
wind farms and radar, and what type of radar are they?**

Short answer. Wind farm positions: yes, 780 of them, from the UK government's
own planning database at one remove, and they are now in the tool. Civil radar
positions: yes, 55 sites, but only from community sources, and the two
independent ones disagree with each other by a median of 1.4 km. Radar **types**:
partly, and not reliably. Military air defence radar: **no**, and that is the
one that most often decides a real UK wind farm application.

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

## Source A: wind farm positions

`wri/global-power-plant-database`, `output_database/global_power_plant_database.csv`.
WRI Global Power Plant Database v1.3.0, **CC BY 4.0**.

- 780 UK wind facilities, 23,203 MW total, all geolocated.
- **771 of the 780** carry `geolocation_source = "UK Renewable Energy Planning
  Database"`. This is REPD data, laundered through WRI.

Three limits, all of which matter:

1. **These are facility centroids, not turbine positions.** One point per wind
   farm. No layout can be taken from this, which is a real loss given how much
   of this tool is about where individual machines sit.
2. **The snapshot is stale.** WRI stopped maintaining the database in early
   2022. 23.2 GW is well short of the UK fleet today.
3. **The REPD's own grid references can be about a kilometre out**, because many
   are recorded early in the planning process before the layout is decided.
   That is documented by users of the REPD, not a guess.

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

Run `node calibration/uk_sites.mjs`. Output as of this commit:

```
=== UK wind farms vs nearest civil radar site ===
farms: 780   radar sites: 55
nearest-radar distance: min 1.1 km, p10 17, median 37, p90 83, max 142 km
  within 10 km: 19 farms (2.4%), 255 MW
  within 15 NM (SSR): 241 farms (30.9%), 4217 MW
  within 30 km (MOD technical site): 278 farms (35.6%), 5449 MW

=== smooth-earth line of sight to a 150 m tip (k = 4/3, NO terrain) ===
radio horizon: en-route antenna 20 m -> 18.4 km, terminal 12 m -> 14.3 km, 150 m tip -> 50.5 km
farms inside nearest-radar line of sight: 647 of 780 (82.9%)
  capacity inside: 18699 MW of 23203 MW

=== single-turbine clutter-to-noise at the real range (40 dBsm, main beam) ===
clutter-to-noise across 647 in-sight farms: min 41 dB, median 56 dB, max 111 dB
  above 60 dB (well past any MTI rejection the presets model): 240 (37.1%)
```

Read that carefully, because two of those numbers are easy to misuse.

**82.9 per cent in line of sight is an upper bound, not a finding.** It is
smooth-earth geometry with no terrain at all, so nothing is ever shielded by a
hill. The real figure is lower, and by how much depends entirely on terrain
this environment could not fetch: the free DEM sources the tool can import
(Copernicus, SRTM) are all behind blocked hosts. The number is worth having
precisely because it is an upper bound: it says no more than 83 per cent of UK
wind capacity can possibly be visible to the nearest civil radar, and the
remaining 17 per cent is already beyond the horizon before terrain is
considered.

**The clutter-to-noise figures are single-turbine, main-beam, 40 dBsm.** They
assume the radar is looking straight at the machine with full antenna gain. A
real farm is off-boresight most of the time and the elevation pattern matters.
The number says how much signal is there to be rejected, not how much gets
through: that is what the rest of the tool computes.

The three thresholds (10 km, 15 NM, 30 km) are **bins, not rules**. They appear
in UK safeguarding practice as described in retrievable summaries. The
documents that would define them were blocked. They are used here only to sort
distances into groups.

## Worst pairings the data produces

| Wind farm | Nearest radar | Range | Single-turbine C/N |
| --- | --- | --- | --- |
| East Midlands Airport | East Midlands | 1.1 km | 111 dB |
| Greenhill Croft | Allanshill | 5.8 km | 95 dB |
| Arnish Moor | Sandwick | 6.0 km | 94 dB |
| Rosehill Wind Turbines | Kincardine | 6.4 km | 93 dB |
| Mains of Hatton | Allanshill | 6.6 km | 92 dB |
| Point Wind / Beinn Ghrideag | Sandwick | 7.2 km | 91 dB |
| House O'Hill | Allanshill | 7.7 km | 90 dB |
| European Offshore Wind Deployment Centre | Perwinnes Hill | 8.1 km | 89 dB |
| Little Byth | Allanshill | 8.4 km | 88 dB |
| Denzell Downs | Newquay | 4.3 km | 88 dB |

Every one of these is a **candidate to look at**, not a problem found. Several
of them exist and operate today, which is itself the point: a large clutter
return at short range is normal and is dealt with by the radar's processing
and by mitigation. The tool exists to work out what is left after that.

## Using it

The tool's Site tab now has a **Real UK sites** group. Pick a wind farm, pick a
radar (or take the nearest automatically), and press **Place this pairing**. It
sets the site origin to the farm's real position and places the farm at its
true bearing and range from that radar.

Two behaviours to know about:

- The distance control stops at 60 km. A pairing further out than that is
  **clamped**, the bearing stays real and the range does not, and the note says
  so. The report records the true range alongside the clamped one.
- **Land or sea is not set from this data.** Nothing in the source distinguishes
  an offshore farm from an onshore one reliably, so the surface stays whatever
  you chose.

## Reproducing

```sh
python3 calibration/fetch_uksites.py   # writes data/uk-*.json
python3 calibration/build_uksites.py   # writes js/uksites.js
node calibration/uk_sites.mjs          # the correlation above
node --test test/*.test.mjs            # 75 assertions, 9 of them on this data
```

## Attribution

- Wind farm positions: WRI Global Power Plant Database v1.3.0, CC BY 4.0,
  derived from the UK Renewable Energy Planning Database.
- Radar positions: `open-air-data/atc-radar` (ODbL) and `VATSIM-UK/UK-Sector-File`.
  The derived radar database is offered under ODbL.
