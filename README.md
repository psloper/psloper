# FPV Drone Pilot Trainer

A browser-based FPV (First-Person View) drone flight simulator for practicing
**acro/rate-mode** stick skills — the same skill acro pilots build on
simulators like Liftoff or DRL before ever risking a real quad. No install,
no build step: open it in a browser and fly.

Built with vanilla JavaScript and [Three.js](https://threejs.org/) (vendored
locally under `js/vendor/`, wired in via an import map — no bundler, no CDN
dependency, works fully offline once served).

## Quick start

Because the app uses ES modules, it needs to be served over `http://`
rather than opened directly as a `file://` URL. From the project root, run
any static file server, for example:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080` in a browser (Chrome/Edge recommended for
best Gamepad API support) and pick a mode from the menu.

## Features

- **Realistic acro-mode physics** — rate-based rotation (configurable max
  rate + expo, exactly like a flight controller's acro mode), gravity,
  momentum/drag, and a short response-lag on the rates so the craft feels
  physical rather than snapping instantly to your stick input.
- **Keyboard or gamepad/transmitter input** — plug in an Xbox/PS-style
  gamepad, or many FPV transmitters (in joystick/HID mode) work directly
  via the browser's Gamepad API. Mode 1 and Mode 2 stick layouts are both
  supported, with configurable rates, expo, and deadzone.
- **FPV-accurate arming behavior** — throttle must be at zero to arm, just
  like a real flight controller refusing to arm hot.
- **OSD-style HUD** — armed state, flight timer, simulated 4S battery
  voltage that drains with throttle usage (and force-disarms at 0%), speed,
  altitude, throttle gauge, and gate/lap info.
- **Three flight modes**:
  - *Free Flight* — open field sandbox, no timer.
  - *Gateway Loop* — a 7-gate introductory course with generous spacing.
  - *Tight Slalom* — narrow zig-zag gates for precision roll/yaw work.
- **Lap timing with persisted best laps** (via `localStorage`), gate-pass
  detection that enforces course order (no skipping gates backwards).
- **Crash detection** — hard ground impact (based on descent speed, tilt,
  or horizontal speed) disarms and "crashes" the craft; gentle touchdowns
  just land. Respawn instantly with Backspace / the gamepad's Select button.
  Crashed frames drain the same battery pack — resets your stick discipline,
  not your battery.
- **FPV / chase camera toggle** (`C`) — practice from the pilot's seat, or
  watch the flight path from a following third-person camera.
- **Beginner assist** — an optional "Horizon"-style self-leveling toggle in
  Settings for pilots still building rate-mode muscle memory.
- All settings and stats persist locally in the browser (`localStorage`) —
  nothing is sent over the network.

## Controls

| Action | Keyboard | Gamepad / Transmitter |
| --- | --- | --- |
| Throttle | `W` / `S` (ratchets, no self-center) | Left stick Y |
| Yaw | `A` / `D` | Left stick X |
| Pitch | `↑` / `↓` | Right stick Y |
| Roll | `←` / `→` | Right stick X |
| Arm / Disarm | `Enter` | Start / Options |
| Respawn | `Backspace` | Select / Back |
| Toggle camera | `C` | — |
| Pause | `Esc` / `P` | — |
| Help | `H` | — |

(Mode 1 swaps throttle/pitch between the two sticks — toggle it in
Settings.)

## Project structure

```
index.html          Markup: HUD, menu, pause/settings/help overlays
css/style.css        OSD + UI styling
js/
  main.js            App bootstrap, game loop, UI wiring
  physics.js         QuadPhysics — rate-based acro flight model
  input.js           Keyboard + Gamepad API handling, expo/deadzone shaping
  world.js            Three.js scene, drone model, gate-course visuals
  track.js           Gate course definitions + lap/gate-passage detection
  hud.js             OSD DOM updates
  storage.js         localStorage-backed settings/stats/best-laps
  utils.js           Small math/formatting helpers
  vendor/three.module.js   Vendored Three.js r160 (minified UMD-free ES module)
```

## Notes on the flight model

This is intentionally a simplified model, tuned for how it *feels* to fly
rather than for aerodynamic accuracy: no motor/prop-level simulation, no
wind, no ground-effect. It captures what actually matters for stick-time
training — rate response, momentum, and the throttle/attitude coupling that
makes acro flight require constant correction. Physics runs on a fixed
120 Hz sub-step accumulator (decoupled from render rate) for consistent feel
across displays with different refresh rates.

## Ideas for extending this

- Wind gusts / turbulence toggle for advanced training.
- Additional tracks (freestyle gap course, tight technical track).
- Ghost/replay of your best lap to race against.
- Fisheye-style lens distortion shader for a more authentic FPV camera feel.

---

# Sea Kayak Conditions (`kayak/`)

A second, independent app in this repo: a planning tool for sea kayakers
that pulls wind, waves, swell, currents, modelled tides, water temperature,
visibility and daylight for a launch spot, then rates every hour of the next
72 as **GO**, **CAUTION** or **NO-GO** against *your own* limits.

Open `http://localhost:8080/kayak/` after starting the server above.

## Data sources

All from [Open-Meteo](https://open-meteo.com/) (free, no API key, CC BY 4.0),
called directly from the browser:

| Need | Open-Meteo API | Variables |
| --- | --- | --- |
| Wind, gusts, air temp, rain, sky, visibility | Forecast | `wind_speed_10m`, `wind_gusts_10m`, `wind_direction_10m`, `temperature_2m`, `visibility`, ... |
| Waves, swell, sea temp, currents, tide | Marine | `wave_height`, `swell_wave_height`, `sea_surface_temperature`, `ocean_current_velocity`, `sea_level_height_msl` |
| Sunrise / sunset | Forecast (daily) | `sunrise`, `sunset` |
| Place search | Geocoding | `name` search |

## How an hour is rated

| Check | NO-GO when | CAUTION when |
| --- | --- | --- |
| Wind, gusts, waves, current | above your limit | above 80% of your limit |
| Offshore wind (needs beach bearing) | above your offshore limit | 5 kn or more |
| Wind against current (current 1 kn+, wind 10 kn+) | | wind within 45 degrees of opposing the flow |
| Visibility | under 1 km | under 4 km |
| Thunderstorm (weather codes 95, 96, 99) | always | |
| Darkness | | outside sunrise to sunset |

The worst single check sets the hour's rating. Profiles (beginner,
intermediate, advanced) only preload default limits; every limit is editable
and saved in the browser.

## Limitations (read these)

- Tide times come from a global ocean model's sea level, not a harbour tide
  table. Timing and height can be off, especially in estuaries, sounds and
  sheltered inlets. Always confirm with an official tide source.
- Current direction is assumed to be "flowing towards" (oceanographic
  convention); wind direction is "blowing from".
- Model grids are kilometres wide: no tide races, overfalls, headland
  acceleration or surf behaviour.

## Modelled versus official data

Every number on the page is a forecast from computer models. Tide times,
tide heights and tidal current are **not official** and are labelled
"model" on the page. The page also says which sea model point the wave, tide
and current data come from, and warns when it is more than 5 km from your
launch or has no sea data (inland).

| Shown | Status | Official UK source to check against |
| --- | --- | --- |
| Tide times and heights | Modelled sea level from a global ocean model | [Admiralty EasyTide](https://easytide.admiralty.co.uk/) |
| Tidal current | Modelled ocean current, coarse grid | Tidal stream atlas or chart tidal diamonds |
| Wind, waves, visibility | Model forecast | [Met Office inshore waters forecast](https://www.metoffice.gov.uk/weather/specialist-forecasts/coast-and-sea/inshore-waters-forecast) |

### Tide reliability badge

The tide panel shows a reliability badge for your launch, with a direct link
to official times:

| Badge | When | Official link |
| --- | --- | --- |
| MEDIUM | Within a checked open-coast area (Oban, Rhoscolyn) | That area's EasyTide station |
| LOW | Within a checked area where the model was badly out (Portland, Hamble, Itchen, Poole), or anywhere unchecked whose sea model point is more than 5 km away | Station if checked, otherwise EasyTide search |
| NOT CHECKED | Unchecked area with a nearby sea model point | EasyTide search |
| NO DATA | No sea data (inland) | EasyTide search |

Station links use EasyTide's `?PortID=` format. Only the six stations seen
in the check are linked; the app does not carry a full station list.

### How far out the modelled tides were (one-off check, 27 September 2026)

Live Open-Meteo sea level for six UK spots, turned into high and low water
times with the app's own method, compared with Admiralty EasyTide for about
four days (roughly 15 turns per spot):

| Spot | Official station | Model timing vs official | Tidal range, official vs model |
| --- | --- | --- | --- |
| Oban | Oban | 17 to 36 min early | 3.3 m vs 3.6 m |
| Rhoscolyn | Trearddur Bay | 14 to 36 min early | 4.5 m vs 4.4 m |
| Portland Bill | Portland | high water about 50 min early, low water within 15 min | 1.9 m vs 3.4 m |
| Hamble | Warsash | 80 to 133 min early | 3.7 m vs 1.8 m |
| Itchen | Southampton | 80 to 122 min early | 4.0 m vs 1.8 m |
| Poole | Poole Harbour | 109 to 163 min early | 1.9 m vs 1.7 m |

Hamble and Itchen get the *same* sea model point, in the Solent 8 to 13 km
away: the model does not reach Southampton Water. This is one check over a
few days, not a long-term accuracy study.

## Structure and tests

```
kayak/index.html         Page markup
kayak/style.css          Styling (light and dark, phone friendly)
kayak/app.js             Fetching, settings, rendering (chart, table, cards)
kayak/logic.js           Pure logic: merging, units, tides, rating, place ranking
kayak/logic.test.mjs     Unit tests:        npm test
kayak/browser.test.mjs   Browser tests:     npm install && npm run test:browser
kayak/mutants.mjs        Proof tests fail:  npm run test:mutants
```

The browser tests serve the repo locally, answer every Open-Meteo call with
fixed data, and drive headless Chromium. There is one test per UK spot
(Oban, Rhoscolyn, Portland Bill, Hamble, Itchen, Poole) using the real
search result order and real sea model point from the live check; the
weather and tide values in them are synthetic. They need the `playwright`
dev dependency and a Chromium it can find (`npx playwright install chromium`).

GitHub Actions runs all three test commands on every push or pull request
that touches the app (`.github/workflows/kayak-tests.yml`).

`npm run test:mutants` breaks one feature at a time in a scratch copy
(38 deliberate breaks), checks the named tests fail, and checks every test
failed for at least one break. It exits non-zero if any break goes unnoticed.

## Not yet verified

- **Live runs from this repo's own test setup.** The build environment
  blocks Open-Meteo, so the live check above was done once, outside it.
  The tests use copies of what it returned, not live calls.
- **Current direction convention.** Assumed "flowing towards". The model
  currents do reverse roughly every six hours, so they include tidal
  streams, but the direction convention was not confirmed.
- **Current strength in races.** Around Portland the model peaked at about
  3.5 kn. Tide races there run much faster; the model cannot show them.
- **Tide accuracy beyond the six spots and four days checked.**
