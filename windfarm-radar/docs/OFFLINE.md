# Running it offline, and whether an installed version would be better

## Short answer

**No. The single file is the better option for this tool.** Everything works
from it, it needs no admin rights, and an installer would add cost and friction
without buying anything measurable.

## What was tested

Chromium in offline mode, `navigator.onLine` false, every non-`file://` request
aborted with `internetdisconnected`, opening the single file by path.

| | Result |
|---|---|
| Network requests attempted | **none** |
| Control rail ready | 1.8 s (500 m build), 2.1 s (200 m), 2.7 s (100 m) |
| Real UK pairing placed | works |
| Copernicus terrain loaded | works, 100% coverage, masks 12 of 12 at Earlsburn |
| Parameter sweep, 196 analyses | works |
| Turbine schedule import | works |
| Wind farm site list import | works |
| Radar site list import | works |
| Export .md, .json, .csv, .docx, .xlsx, .png | **all six land on disk** |
| PDF print view | opens |
| Scenario persists between runs | yes, via localStorage |
| Page errors | none |

## Startup: a figure that was wrong

An earlier note said first paint took about 10 seconds. That was wrong: it
measured a fixed wait in the test, not the application. Measured from the
navigation timing API, the control rail is populated in **1.8 to 2.7 seconds**
depending on which build, and the embedded terrain accounts for under a second
of the difference between the 3.5 MB and 38.6 MB builds.

## Why not package it

An Electron or Tauri build would add roughly 100 to 150 MB per platform, a
build machine for each of Windows, macOS and Linux, and code signing. Without
signing, an unsigned executable is far more likely to be blocked on a managed
aviation or air traffic machine than a plain `.html` file is. Installing
usually needs admin rights; opening a file does not.

It would also create an update obligation. A single file is copied over and
that is the update.

## When to revisit it

Three situations would change the answer:

1. **A managed machine that blocks JavaScript on local files.** Some locked-down
   policies do. That cannot be tested from here. If it happens, the fallback is
   to serve the folder over `http://localhost` with the launcher route rather
   than to package an app.
2. **Needing to work across many scenario files at once.** The File System
   Access API, which would allow opening a project folder rather than picking
   files one at a time, needs a secure context and is not available on
   `file://`.
3. **A machine with no current browser.** Packaging bundles one. Unlikely.

## The three builds

    node tools/build_offline.mjs            38.6 MB, 100 m terrain
    node tools/build_offline.mjs --200m     14.6 MB, 200 m terrain
    node tools/build_offline.mjs --coarse    3.5 MB, 500 m terrain

All three are one file, open by double-clicking, and send nothing anywhere.

Why a plain copy of the project folder does not work: the app is ES modules,
and a browser blocks every import over `file://` because the origin is `null`.
The control rail does not render at all.
