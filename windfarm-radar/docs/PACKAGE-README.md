# Wind farm and radar screening tool

Developer: Paul Sloper
Packaged: 2026-09-22

## Run it

Double-click **windfarm-radar-offline-200m.html**. It opens in Chrome, Edge or
Firefox and works with the network unplugged. Nothing is installed, no admin
rights are needed, and the page makes no outbound request of any kind.

**windfarm-radar-offline-500m.html** is the same tool with coarser ground
(500 m spacing instead of 200 m). It is a quarter of the size, so use it if the
big file is slow to open or too large to email.

Both files carry everything inside them: the 3D engine, the UK wind farm and
radar site lists, and the elevation data. That is why they are large.

## What is in this package

| File or folder | What it is |
| --- | --- |
| `windfarm-radar-offline-200m.html` | The tool. 14.9 MB, one file, runs offline. Start here. |
| `windfarm-radar-offline-500m.html` | Same tool, coarser ground, 3.8 MB. |
| `docs/SECURITY.md` | For your IT security team. What the page can and cannot do, and how to check that yourself. |
| `docs/OFFLINE.md` | Why it is one file, how to run it from a USB stick, and what a `file://` page is allowed to do. |
| `docs/TERRAIN.md` | Where the ground heights come from, how they were resampled, and the heights I checked them against. |
| `docs/CAP670-VERIFICATION.md` | Every CAP 670 figure the tool uses, checked line by line against the document, including the places the document contradicts itself. |
| `docs/CAP670-verification-checklist.xlsx` | The same checks as a spreadsheet, 89 rows. |
| `docs/RADAR-PARAMETERS-TO-ASK-FOR.md` | The list to send a radar operator when you need real numbers instead of the presets. |
| `docs/DATA-IN-AND-OUT.md` | Every file format the tool reads and writes. |
| `docs/evidence/` | Raw output from the checks, so you can see the workings rather than take my word. |
| `samples/` | Example imports: turbine lists as CSV, Excel and KML, a terrain grid, and blank templates for your own sites. |
| `example-outputs/` | What the tool produces: a Word report, an Excel workbook, CSV, JSON and three images. |
| `source/` | The full source code, for review. |

## For IT security

Read `docs/SECURITY.md` first. The short version:

- It is a single HTML file. No installer, no service, no registry change, no
  admin rights, no browser extension.
- It makes no network request when you run it. There is no `XMLHttpRequest`,
  no WebSocket, no `sendBeacon`, no `EventSource`, no `eval` and no external
  script or stylesheet tag anywhere in the file.
- **This was measured, not just reasoned about.** The packaged file was opened
  from `file://` with no server running, driven through the control tabs, the
  national map and the evidence register, with every request the page attempted
  recorded. Total requests: **one**, the file itself. External requests: none.
  You can repeat this yourself: open the file, press F12, go to the Network
  tab, and reload. You should see one entry.
- Grep it and you will find two `fetch(` calls. Both are in the terrain loader
  and both are dead code in this build: the elevation data is already inside
  the page, so the loader takes the embedded branch and the `fetch` branch is
  never reached. Both would request a relative path such as
  `data/terrain/uk-500m.bin`, with no host, so neither could reach an outside
  server even if it did run. They exist for the server-hosted version of the
  same code.
- Grep it for `https://` and you will find about twenty. They are all text, not
  requests: XML namespace identifiers written into the Word and Excel files the
  tool exports (`schemas.openxmlformats.org`, `w3.org`, `purl.org`), and source
  citations printed in the tool's own notes (the Copernicus elevation bucket,
  two GitHub data sets, a three.js release note). Nothing loads any of them.
- A test in the source tree enforces the first two points and fails if anyone
  adds a network call: `test/injection.test.mjs`, "the only network call in the
  tool reads its own files". It allows network code in `js/terrain.js` only,
  and fails outright if that file ever fetches an absolute URL.
- Nothing you load leaves the machine. Files you import are read in the browser
  and never sent anywhere. Files you export are written by the browser's own
  download.
- The source in `source/` is the source the file was built from. `source/tools/build_offline.mjs`
  is the script that produced it.

## What changed since the last package

- **A national map** of the UK and Ireland: 2,694 planning records and 55 civil
  radar sites, screened for line of sight over the 500 m national grid. Click a
  radar to drop into its full assessment.
- **Turbine counts and heights** from the July 2024 planning database extract,
  covering 91% and 38% of live farms. The map reports how much of its answer
  rests on recorded figures and how much on an assumption.
- **Every site is tagged with its territory**, so you can see the split between
  England, Scotland, Wales and Northern Ireland. That tagging also cross-checks
  the offshore flag against the geography, and found nine records where the two
  disagree, one of which is a genuine error in the source data.
- **Named aircraft types** rather than generic classes: A320, 737-800, 787-9,
  A350-900, ATR 72, E190, C172, PA-28, SR22, H135, AW139, Typhoon, F-35B,
  A400M, MQ-9 and a quadcopter. Dimensions are the airframers'; the radar cross
  sections are estimates and the tool says so where you pick one.
- **An inspector for data nobody has described.** Feed it a spreadsheet and it
  works out what each column holds from the VALUES as well as the heading, then
  reports how it differs from the built-in table. It never writes to the site
  tables: a file that disagrees is evidence about one of the two, and which one
  is wrong is not a decision the tool can make for you.
- The aircraft, turbines and radar installations are drawn properly now, and
  three rendered harnesses check their shape and not just their size.

## Honest limits

- Ground heights are a **surface** model: they include trees and buildings, not
  bare earth. That makes hilltops read slightly high.
- The 200 m and 500 m spacings are resampled from 30 m data by taking the
  highest cell in each patch, so summits survive. `docs/TERRAIN.md` names the
  peaks I checked and by how much each is off.
- Radar presets are starting points from published datasheets. For a real
  assessment, get the operator's own numbers. `docs/RADAR-PARAMETERS-TO-ASK-FOR.md`
  lists what to ask for.
- This is a screening tool. It tells you where a problem is likely, not whether
  an objection will be raised.
- Parts of CAP 670 could not be checked: Appendix A's flow chart and Figure 3
  are images, and I could not confirm whether a later Supplementary Amendment
  supersedes the 1 August 2019 edition. `docs/CAP670-VERIFICATION.md` says so
  in each place it matters.
- The wake model has not been validated against a reference implementation.

## Running from source

The source tree needs a local web server, because a browser blocks module
loading from a `file://` page:

```
cd source
python3 -m http.server 8000
```

then open http://localhost:8000. Tests: `node --test test/*.test.mjs` (185 tests).

`source/data/terrain/` carries the 500 m national grid only. The 100 m blocks
are 27 MB and are in the git repository rather than this package. Without them
the source tree still runs and uses the 500 m grid.
