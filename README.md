# Design to CAD to Print

Type a description of a part. Claude writes a parametric CAD script for it,
runs it to produce a 3D model, and you can review it in the browser before
sending it straight to your 3D printer.

## Pipeline

```
your text prompt
      |  Claude writes CadQuery (Python) code
      v
CadQuery script  --(run in a subprocess)-->  STL file
      |  you review the 3D preview in the browser
      v
"Slice & send to printer"
      |  PrusaSlicer CLI slices the STL using YOUR printer profile
      v
G-code file
      |  uploaded to OctoPrint, which starts the print
      v
printer
```

Two things worth knowing going in:
- **STL alone can't print.** A printer needs G-code, which depends on your
  specific printer, nozzle, and filament. So there's a slicing step in the
  middle, and it needs a real profile for your printer (see below) — this
  is not optional and there's no sane universal default.
- **This talks to your printer through OctoPrint.** If you're on Klipper/
  Moonraker, a Bambu printer, or something else, see "Using a different
  printer backend" below — everything else in this project is unaffected.

## Setup

### 1. Install dependencies

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

`cadquery` pulls in a real geometry kernel and can take a few minutes to
install. It needs Python 3.10 or 3.11.

### 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

- `ANTHROPIC_API_KEY` — your Claude API key.
- `OCTOPRINT_URL` / `OCTOPRINT_API_KEY` — your OctoPrint instance and its
  API key (OctoPrint → Settings → API). Leave blank if you only want to
  generate and preview models for now; printing will just tell you what's
  missing.
- `PRUSASLICER_PATH` — path to the PrusaSlicer executable, or just
  `prusa-slicer` if it's on your `PATH`. [Download PrusaSlicer](https://www.prusa3d.com/page/prusaslicer_424/)
  if you don't have it — the CLI mode ships with the normal app, no separate
  install.

### 3. Set up your printer profile

This is the part that's actually specific to your hardware, and the app
deliberately refuses to guess at it:

1. Open PrusaSlicer normally, set up your printer, nozzle size, and filament
   the way you would for any manual print.
2. Export it: right-click the printer/filament profile → **Export**, or
   **File → Export → Export Config Bundle**. Save as an `.ini` file.
3. Put that file at `profiles/default.ini` (or anywhere, and point
   `PRINTER_PROFILE` in `.env` at it).

Until you do this, "Slice & send to printer" will fail with a clear error
telling you exactly this.

### 4. Run it

```bash
cd backend
python app.py
```

Open `http://127.0.0.1:5000`.

## Using a different printer backend

`backend/printer.py` is the only file that knows about OctoPrint. It
exposes two functions the rest of the app calls: `upload_and_print(gcode_path)`
and `get_job_status()`. To support Klipper/Moonraker, a Bambu printer, Duet,
etc., rewrite those two functions against that system's API — nothing in
`app.py` or the frontend needs to change.

Same idea for the slicer: `backend/slicer.py` wraps the PrusaSlicer CLI.
Swap in CuraEngine or SuperSlicer's CLI (same shape, since SuperSlicer is a
PrusaSlicer fork) by changing that one file.

## Security notes — read this before using it regularly

This project runs **AI-generated Python code** on your machine (the
CadQuery script Claude writes). That's inherently more risk than reading AI
text output. What's in place, and what isn't:

- The script is checked against a blocklist of dangerous patterns (file I/O,
  `os`/`subprocess`/`socket`/`requests` imports, `eval`/`exec`) before it
  runs, and only `cadquery`/`math` imports are allowed.
- It runs in a separate subprocess, in Python's isolated mode (`-I`, which
  ignores your environment and site-packages tweaks), with an empty
  environment, a memory limit, and a timeout.
- **This is a best-effort filter, not a real sandbox.** A blocklist can
  miss things a determined or unlucky generation finds. There's no
  container, VM, or OS-level seccomp/namespace isolation here.

Given that, treat this as a personal, single-user, local-network tool — not
something you expose to the internet or let other people submit prompts to.
If you want stronger isolation, the natural next step is running the
generation subprocess inside a locked-down Docker container (no network,
read-only filesystem except the STL output path); that's a deliberate
follow-up, not included here, since it adds a Docker dependency.

## Project layout

```
backend/
  app.py            Flask routes
  cad_generator.py  prompt -> Claude -> CadQuery script -> STL (with retry-on-error)
  slicer.py         STL -> G-code via PrusaSlicer CLI
  printer.py        G-code -> OctoPrint (upload, print, status, cancel)
  jobs.py           in-memory job store
  config.py         env-based configuration
frontend/
  index.html, app.js, style.css   prompt box, three.js STL viewer, print controls
profiles/
  default.ini       your exported PrusaSlicer printer profile goes here
generated/          STL/G-code output per job (gitignored)
```
