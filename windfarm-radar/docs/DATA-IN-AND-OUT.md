# Getting data in and out

Written to be followed, not skimmed. Nothing here needs a login, an internet
connection, or any software you do not already have. Every file is read inside
the page: **nothing you open is uploaded anywhere.**

---

# Part 1: Getting data OUT

## Step 1. Set the scenario up the way you want it reported

Everything exported is a snapshot of what is on screen at that moment. Change a
slider after exporting and the export does not change with it.

## Step 2. Click **Export** in the top bar

A panel opens listing everything available.

## Step 3. Pick what you need

| You want | Choose | You get | Opens in |
| --- | --- | --- | --- |
| Something to send someone | **Assessment report** | `.md` | Word, Notepad, any editor, GitHub |
| The numbers to work on yourself | **Assessment** | `.csv` | Excel |
| The turbine-by-turbine results | **Turbines** | `.csv` | Excel |
| The aircraft track | **Flight track** | `.csv` | Excel |
| To reload this exact set-up later | **Scenario** | `.json` | this tool |
| A picture of a sweep | Heat map **PNG** or **SVG** | image | anything |

## Step 4. Click the button. The file saves to your Downloads folder

**If nothing downloads**, the page is running somewhere that blocks downloads.
Use the **View / copy** button beside it instead, then select all the text and
copy it into a file yourself. The content is identical.

## Step 5. To reload a scenario later

Export **Scenario** as `.json`, keep the file, and open it with the scenario
import. Everything comes back, including imported turbine schedules.

---

# Part 2: Getting data IN

There are **four** separate things you can import. They are different, and
picking the wrong one is the commonest mistake.

| What you have | Use | One row per |
| --- | --- | --- |
| A layout: every turbine, with coordinates | **Turbine schedule** | machine |
| A list of projects | **Wind farm site list** | project |
| A list of radar sites | **Radar site list** | radar |
| Ground heights | **Elevation data** | point |

All four live on the **Site & data** tab, under **Import real data**.

---

## Before you start: get your coordinates right

You can use **either** of these. Not a mixture.

**Option A, latitude and longitude.** Decimal degrees, WGS84.
Correct: `55.37770` and `-3.75300`.
**Wrong:** `55° 22' 39" N`. Convert it first: degrees + minutes/60 + seconds/3600,
and put a minus sign in front for west or south.

**Option B, eastings and northings.** Whole metres, in whatever grid your survey
used. You must then also set **Radar easting** and **Radar northing** on the
Site & data tab to the radar's position in that same grid, because the tool
reads your coordinates relative to it. Get that wrong and everything lands in
the wrong place.

> If in doubt use latitude and longitude. It needs no other settings.

---

## Import 1: a wind farm site list (one row per project)

### Step 1. Open the template

`samples/windfarm-sites-template.csv`. Double-click it; it opens in Excel.

### Step 2. Look at what the columns mean

| Column | Required? | What it is | If you leave it out |
| --- | --- | --- | --- |
| `name` | **Required** | Anything you will recognise | The row is skipped |
| `latitude`, `longitude` | **Required*** | Decimal degrees | The row is skipped |
| `easting`, `northing` | **Required*** | Metres in your grid | The row is skipped |
| `capacity mw` | Optional | Megawatts, a number | Recorded as 0 MW |
| `status` | Optional | Operational, Under Construction, Awaiting Construction, Application Submitted, Refused, Withdrawn | Shown as "Not stated" |
| `offshore` | Optional | `yes` or `no` | Sea or land stays as you set it |
| `reference` | Optional | Your planning or job reference | Nothing |
| `turbines` | Optional | How many machines | Nothing |
| `tip height` | Optional | Metres to blade tip | Nothing |

\* You need **one** of the two position pairs, not both.

### Step 3. Delete the example rows and type yours in

Keep the header row exactly as it is. You may add columns the tool does not
know about; they are ignored rather than causing an error.

### Step 4. Save as CSV or XLSX

Excel: **File → Save As →** pick `CSV UTF-8 (Comma delimited)` or
`Excel Workbook (.xlsx)`. Both work. If Excel warns you about losing
formatting, that is fine; say yes.

### Step 5. Import it

Site & data tab → **Wind farm site list** → **Choose .xlsx or .csv** → pick
your file.

### Step 6. Read the message underneath

It tells you how many rows came in, how many were skipped and why, and **every
column you left out**. It does not fill anything in silently.

### Step 7. Use them

**Real UK sites** picker → your file appears as its own group at the top of the
list, above the UK planning database. Pick one, pick a radar, press **Place this
pairing**.

---

## Import 2: a radar site list (one row per radar)

### Step 1. Open `samples/radar-sites-template.csv`

### Step 2. The columns

| Column | Required? | What it is | If you leave it out |
| --- | --- | --- | --- |
| `name` | **Required** | The site name | The row is skipped |
| `latitude`, `longitude` | **Required*** | Decimal degrees | The row is skipped |
| `easting`, `northing` | **Required*** | Metres in your grid | The row is skipped |
| `role` | Optional | `en-route`, `aerodrome`, `air defence`, `weather`, `marine` | Listed as unclassified |
| `antenna height` | **Strongly advised** | Metres above ground to the aerial | Falls back to the Radar tab value, which is a guess |
| `ground level` | Optional | Metres above sea level at the site | Nothing |
| `band` | Optional | L-band, S-band, C-band, X-band | Nothing |
| `operator` | Optional | Who runs it | Nothing |
| `notes` | Optional | Anything, for example how sure you are of the position | Nothing |

\* One of the two pairs.

> **Antenna height is the one to get right.** It sets the radio horizon
> directly: the distance a radar can see goes as the square root of its height.
> A 10 m error moves the horizon by kilometres.

### Step 3 to 7: exactly as above

Same save, same import button, same message, same picker. Imported radars appear
in the radar dropdown as their own group.

---

## Import 3: a turbine schedule (one row per machine)

Use this when you have a real layout, not a list of projects.

| Column | Required? | Notes |
| --- | --- | --- |
| `id` | Recommended | Anything: WTG01, T1, a number |
| position | **Required** | `latitude`/`longitude` **or** `easting`/`northing` |
| `ground level` | Recommended | Metres above sea level at the base. Survey data beats anything the tool models |
| `hub height` | Recommended | Metres |
| `rotor diameter` | Recommended | Metres |
| `tip height` | Optional | Used if hub height is missing |
| `rpm` | Optional | Rotor speed |
| `tower base diameter`, `tower top diameter` | Optional | Metres |
| `blade chord` | Optional | Metres, the widest part of the blade |
| `blades` | Optional | Usually 3 |

Title blocks and blank rows above the table are skipped automatically, so a
schedule straight from a consultant usually imports as it stands.

Sample: `samples/turbines-example.xlsx` and `.csv`.

---

## Import 4: elevation data

| Format | Extension | Where it comes from |
| --- | --- | --- |
| ESRI ASCII Grid | `.asc` | What almost every free elevation source exports. **The best option** |
| Google Earth | `.kml`, `.kmz` | Export a path or points |
| A spreadsheet | `.xlsx`, `.csv` | Columns: position plus `elevation` |

After importing, the tool reports what fraction of the modelled area your file
actually covers. If that is low, the edges fall back to the synthetic surface
and any masking conclusion near the edges is worthless.

---

# Part 3: When it goes wrong

| Message or symptom | What it means | Fix |
| --- | --- | --- |
| "No header row found" | The tool could not find your column names | Check the header spelling against the tables above. It looks in the first 12 rows |
| "Found a name column but no position" | No coordinates | Add `latitude` and `longitude`, or `easting` and `northing` |
| "N rows skipped" | Those rows had no name or no usable position | Look for blank names, text in a number column, or degrees-and-minutes instead of decimals |
| Everything lands in the sea | Latitude and longitude swapped | In the UK, latitude is roughly 50 to 61 and longitude roughly −8 to +2 |
| Sites are in the wrong county | Eastings and northings, wrong radar grid position | Set **Radar easting** and **Radar northing** on the Site & data tab |
| Nothing downloads | The page cannot save files where it is running | Use **View / copy** and paste into a file |
| Numbers import as text | Excel formatted the column as text | Select the column, **Data → Text to Columns → Finish** |

---

# Part 4: A note you should not skip

The built-in UK wind farm positions are **planning records, not survey data**.
Measured against the two sites where real turbine coordinates were available,
they are out by about **1,100 m**. If you import your own surveyed positions,
the tool says so and stops applying that figure, because it has no idea how
accurate your file is.

Nothing this tool produces can support a planning submission. It is for finding
the obvious problems early.
