> **This repository holds two independent browser tools.** This README covers the
> FPV drone trainer at the repository root. The other is the
> [Wind Farm / Radar Interference Assessor](windfarm-radar/) under
> `windfarm-radar/`, a 3D screening tool for wind turbine effects on primary
> surveillance radar. Both are static, dependency-free, and share the vendored
> copy of Three.js in `js/vendor/`. Serve the repository root and open
> `/` for the drone trainer or `/windfarm-radar/` for the radar tool.

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
