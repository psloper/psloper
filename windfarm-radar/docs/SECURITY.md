# Security posture

For an IT security review. Every claim here is checkable against the source or
by running the tool; where something was found and fixed, it says so.

## What it is

A **static web page**. HTML, CSS and JavaScript. It opens in a browser.

- **Not Java.** No JRE, no applet, no plugin, no ActiveX, no Flash.
- **Not an installer.** No executable, no service, no registry keys, no admin
  rights, nothing written outside the browser profile.
- **No backend.** No server-side code, no database, no API keys, no accounts.

## Deployment options, in order of what IT usually prefers

1. **Host the folder on an internal web server.** It is static files. Any
   intranet server, IIS, nginx or Apache will serve it. No runtime to install
   and nothing to patch on the server beyond the web server itself. Users open
   a URL; nothing runs locally in the sense that phrase usually means.
2. **A single self-contained file** (`node tools/build_offline.mjs`) opened
   from a network share or a USB stick. Verified to work with the network
   disconnected.

If your policy blocks scripts on local files, option 1 is the answer, not an
installed application.

## Network behaviour

**The tool makes no third-party network requests.** Verified two ways:

- **Statically.** `test/injection.test.mjs` asserts the only network call in
  the codebase is `js/terrain.js` reading the tool's own data files from its
  own origin, and that it never fetches an absolute URL. The test fails the
  build otherwise.
- **Dynamically.** Run with the browser in offline mode, `navigator.onLine`
  false and every non-local request aborted. Nothing was blocked, because
  nothing was attempted. Terrain loaded, a 196-cell parameter sweep ran and
  every export completed.

In the single-file build there is no network call at all: the data is embedded
in the page.

### One thing that was found and removed

An earlier version of `js/importers.js` contained `fetchElevations`, which
could call `api.open-elevation.com`, `api.open-meteo.com` and
`api.opentopodata.org`. It was never reachable from any button, but it was
present in the source. It has been **deleted**, and a test now fails the build
if any third-party call is reintroduced.

## Data handling

- **Nothing is uploaded.** Files you import are read in the page with the
  browser's FileReader. They never leave the machine.
- **File access is user-initiated only.** The tool can read a file you pick in
  a file dialog. It has no other file access, and cannot browse the disk.
- **Storage:** one browser localStorage key, `windfarm-radar-scenario-v1`,
  holding the current scenario settings. No personal data, no credentials, no
  cookies, no IndexedDB, no telemetry, no analytics.
- **Exports** are generated in the page and saved through the browser's normal
  download path.

## Code execution

- **No `eval`, no `new Function`, no `importScripts`, no string-valued
  timers.** Asserted by test across every module.
- **HTML injection:** imported CSV and XLSX files are untrusted input, and the
  parser deliberately keeps name and id columns verbatim rather than mangling
  a user's labels. Every value that reaches `innerHTML` is escaped. A test
  scans all modules for an unescaped interpolation and fails the build.

  This was a real finding, not a hypothetical: the turbine table, the hover
  readout and the site pickers interpolated imported names unescaped. They are
  fixed.

## Third-party code

| Component | Version | Licence | Purpose |
|---|---|---|---|
| three.js | bundled in `js/vendor/` | MIT | 3D rendering |

**That is the entire dependency list at runtime.** No package manager is
involved in what ships. There are no CDN references, no web fonts, no
analytics, no tag managers. Build-time tools (esbuild, numpy, tifffile) never
reach the user.

## Data provenance

| Data | Source | Licence |
|---|---|---|
| Elevation | Copernicus DEM GLO-30, via AWS Open Data | Free, full and open. Credit ESA / Copernicus |
| UK wind farm positions | UK planning records | Public |
| UK civil radar sites | Public sources, listed in the evidence register | Public |
| CAP 670 figures | CAP 670, Third Issue, Amendment 1/2019 | CAA publication |

All of it was fetched at build time and committed. The running tool fetches
nothing.

## Verifying what you received

```
dist/windfarm-radar-offline-200m.html
size    14575475 bytes
sha256  8253f12acfe7a6015a151fce29ab68d7d0d0ccd5ce9656e7aa583caa6f45624a
```

Recompute with `sha256sum` or `Get-FileHash`. The file is plain text: it can
be opened in an editor and read.

## What it does not claim

It is a screening tool. It is not accredited, not assured to any software
safety standard, and nothing it produces should support a planning submission
or a safety case on its own. That is stated inside the tool as well.
