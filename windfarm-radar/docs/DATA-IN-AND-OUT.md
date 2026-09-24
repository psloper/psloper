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
| Something to print or email | **Assessment report .pdf** | a print view | choose "Save as PDF" in the print dialog |
| Something to edit and send | **Assessment report .docx** | `.docx` | Word, Google Docs, LibreOffice |
| Every table in one workbook | **All tables .xlsx** | `.xlsx` | Excel, Google Sheets, LibreOffice |
| Something to send someone | **Assessment report** | `.md` | Word, Notepad, any editor, GitHub |
| The numbers to work on yourself | **Assessment** | `.csv` | Excel |
| The turbine-by-turbine results | **Turbines** | `.csv` | Excel |
| The aircraft track | **Flight track** | `.csv` | Excel |
| To keep everything, including data you imported | **Backup: settings and imported data** | `.json` | this tool |
| A picture of a sweep | Heat map **PNG** or **SVG** | image | anything |

## Step 3a. If you chose PDF

A new tab opens with the report laid out for print, and the print dialog
appears. In the **Destination** or **Printer** list choose **Save as PDF**, then
**Save**. The browser writes the PDF, which is why the text stays selectable and
the page breaks fall in sensible places.

**If nothing opens**, your browser blocked the pop-up. Allow pop-ups for this
page and press PDF again, or download the Word file and print that to PDF.

## Step 3b. What is in the Excel workbook

Four sheets, one per table:

| Sheet | What is on it |
| --- | --- |
| Summary | Every number in the assessment, as item and value |
| Turbines | One row per machine, 26 columns, numbers stored as numbers |
| Flight track | One row per second of the aircraft track |
| Evidence | The whole evidence register, with each source's status and caution |

Numbers are written as numbers, not text, so you can total and chart them
without converting anything first.

## Step 4. Click the button. The file saves to your Downloads folder

**If nothing downloads**, the page is running somewhere that blocks downloads.
Use the **View / copy** button beside it instead, then select all the text and
copy it into a file yourself. The content is identical.

## Step 5. Backups

Export **Backup: settings and imported data** as `.json`. It carries the whole
scenario, every site list you imported, and any radar you marked out of
service. Open it later with **Load a saved backup**.

**What a backup does not carry: imported elevation data.** A raster runs to
megabytes and would not fit alongside everything else, so keep the `.asc` or
`.csv` next to the backup and re-import it. The backup file says so inside
itself rather than leaving you to find out.

Your imported site lists also persist on their own, without a backup: close
the tab, come back, and they are still there. The backup is for moving them to
another machine, or keeping a copy before you change something.

A backup file written by an older build held the settings alone. Those still
open; the tool says the file carried no site lists rather than silently
restoring nothing.

Older wording, for anyone with a file from before: export **Scenario** as
`.json`, keep the file, and open it with the scenario
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
| "row(s) skipped for no name or no position" | Exactly that: those rows had neither | Look for blank names, text in a number column, or degrees-and-minutes instead of decimals |
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

## The national map

The **UK map** button opens a view of the whole country: every radar in the
built-in list, every wind farm in the planning database, and which of them can
see which.

### What the colours mean

The heat map shows **how many radars can see the turbines in that area**. It is
not a probability of interference, not a measure of severity, and not a
forecast of whether anyone will object. A farm that four radars can see glows
four times as brightly as one a single radar can see, and that is all it says.

The screen behind it is **line of sight and range only**. It asks one question,
geometrically: standing at the antenna, with the earth curving away at standard
refraction, is the top of a turbine above the intervening ground? It does not
ask whether the return would cross a detection threshold, survive the clutter
filter, or ever reach a controller. Click a radar for that.

That choice is deliberate. A national map coloured by detection margin would
have to invent radar parameters for 55 sites whose real numbers nobody has, and
would look far more authoritative than it could be. Geometry needs positions,
heights and ground, and all three are real.

### The assumptions, and which one matters most

| Assumption | Value | Why it matters |
|---|---|---|
| Turbine tip height | 150 m | The planning database gives no height. **This is the biggest lever on the result.** A 100 m tip sees less; a 200 m tip sees more. |
| Antenna height | 20 m above ground | No mounting is published for most sites. A lattice tower at 30 m reaches noticeably further. |
| Refraction | k = 4/3 | Under a surface duct the radar sees further, so a farm called hidden may not be. |
| Terrain | 500 m national grid, 48 samples per profile | The per-site assessment uses 128 samples and 100 or 200 m ground, so a narrow ridge can be missed here and caught there. |
| Farm position | planning centroid | Out by about 1,100 m in the median case. At the margin of visibility that error decides the answer. |

Terrain matters more than any of them: with real ground **2,283 pairings are in
line of sight; treating the country as flat sea level gives 5,229**. More than
half of what a flat earth would show is hidden by hills.

### Ireland

The Irish coastline is drawn and four Irish radar points are shown, but those
four are marked *unclassified* and come from a low-confidence source. **No
Republic of Ireland wind farm data is loaded at all.** Nothing in the built-in
list is south of the border. Use the site list import to add it.

### Adding your own data

Two buttons on the map take a wind farm site list or a radar site list, as
`.xlsx` or `.csv`, one row per site with a name and a position. Templates are in
`samples/`. Imported sites are drawn alongside the built-in lists, are included
in the screen, and are marked as imported in the panel.

Imported sites carry **no position uncertainty figure**. The 1,100 m the
planning database was measured to carry does not apply to them, and this tool
does not know how yours were surveyed.

### Clicking through to an assessment

Click a radar once to select it and read its counts. Click the same radar again
to load it, against its nearest operational or under-construction farm, into
the full 3D assessment. That replaces the current scenario, which is why it
takes two clicks rather than one.

### The coastline

Natural Earth 1:10m Admin 0 Countries, public domain, simplified to about 440 m
and shipped in the repository because this tool makes no network request. It is
**for drawing only**. Do not measure anything off it and do not use it to decide
whether a point is on land. Distances in the screen come from the coordinates,
not from the outline.
