// Application entry point: wires together the scene, physics, input,
// HUD, and menu/pause/settings UI into a running simulator.

import * as THREE from 'three';
import { QuadPhysics, GROUND_CLEARANCE } from './physics.js';
import { InputManager } from './input.js';
import { Hud } from './hud.js';
import { Storage } from './storage.js';
import { TRACKS, GateCourse } from './track.js';
import { clamp, DEG2RAD, formatTime } from './utils.js';
import {
  GROUND_Y,
  createRenderer,
  createScene,
  createDroneModel,
  createGateMeshes,
  spinProps,
} from './world.js';

const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 10;
const BATTERY_CAPACITY_SECONDS = 180; // ~3 minutes of mixed-throttle flight per "pack"
const ARM_THROTTLE_GUARD = 0.05;

// ---------------------------------------------------------------- DOM refs
const canvas = document.getElementById('scene');
const hudRoot = document.getElementById('hud');
const menuScreen = document.getElementById('menu');
const pauseScreen = document.getElementById('pause');
const settingsScreen = document.getElementById('settings');
const helpScreen = document.getElementById('help');
const crashFlash = document.getElementById('crash-flash');
const statsStrip = document.getElementById('stats-strip');

const hud = new Hud(hudRoot);

// ---------------------------------------------------------------- Three.js
const renderer = createRenderer(canvas);
const scene = createScene();
const droneGroup = createDroneModel();
scene.add(droneGroup);

const fpvCamera = new THREE.PerspectiveCamera(120, 1, 0.05, 2000);
fpvCamera.position.set(0, 0.06, -0.02);
droneGroup.add(fpvCamera);

const chaseCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 2000);
scene.add(chaseCamera);

let activeCamera = fpvCamera;
let courseGatesGroup = null;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  fpvCamera.aspect = w / h;
  fpvCamera.updateProjectionMatrix();
  chaseCamera.aspect = w / h;
  chaseCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- Audio (tiny synthesized beeps — no assets needed)
let audioCtx = null;
function beep(freq, duration = 0.12, type = 'square', gain = 0.06) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(audioCtx.destination);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Audio isn't essential — ignore if the browser blocks it pre-gesture.
  }
}
const sfx = {
  arm: () => beep(880, 0.08, 'square', 0.05),
  disarm: () => beep(440, 0.1, 'square', 0.05),
  gate: () => beep(1200, 0.09, 'sine', 0.05),
  lap: () => { beep(1400, 0.09, 'sine', 0.06); setTimeout(() => beep(1800, 0.12, 'sine', 0.06), 90); },
  crash: () => beep(90, 0.35, 'sawtooth', 0.09),
  low: () => beep(660, 0.15, 'triangle', 0.04),
};

// ---------------------------------------------------------------- Sim state
const physics = new QuadPhysics();
const input = new InputManager(() => Storage.getSettings());

let gameState = 'menu'; // 'menu' | 'flying' | 'paused'
let currentTrack = null; // track definition, or null for free flight
let course = null; // GateCourse instance
let simClock = 0;
let armedAt = 0;
let elapsedFlightTime = 0;
let wasCrashed = false;
let batteryUsedEnergy = 0;
let batteryFraction = 1;
let lastLowBatteryBeep = 0;

applySettingsToCamera();

// ---------------------------------------------------------------- Settings UI
const settingsFields = {
  mode: document.getElementById('set-mode'),
  rate: document.getElementById('set-rate'),
  expo: document.getElementById('set-expo'),
  texpo: document.getElementById('set-texpo'),
  deadzone: document.getElementById('set-deadzone'),
  fov: document.getElementById('set-fov'),
  tilt: document.getElementById('set-tilt'),
  invert: document.getElementById('set-invert'),
  horizon: document.getElementById('set-horizon'),
};
const outputs = {
  rate: document.getElementById('out-rate'),
  expo: document.getElementById('out-expo'),
  texpo: document.getElementById('out-texpo'),
  deadzone: document.getElementById('out-deadzone'),
  fov: document.getElementById('out-fov'),
  tilt: document.getElementById('out-tilt'),
};

function syncSettingsUI() {
  const s = Storage.getSettings();
  settingsFields.mode.value = String(s.mode);
  settingsFields.rate.value = s.maxRateDegPerSec;
  settingsFields.expo.value = s.expo;
  settingsFields.texpo.value = s.throttleExpo;
  settingsFields.deadzone.value = s.deadzone;
  settingsFields.fov.value = s.camFovDeg;
  settingsFields.tilt.value = s.camTiltDeg;
  settingsFields.invert.checked = !!s.invertPitch;
  settingsFields.horizon.checked = !!s.horizonLock;
  outputs.rate.textContent = s.maxRateDegPerSec;
  outputs.expo.textContent = s.expo;
  outputs.texpo.textContent = s.throttleExpo;
  outputs.deadzone.textContent = s.deadzone;
  outputs.fov.textContent = s.camFovDeg;
  outputs.tilt.textContent = s.camTiltDeg;
}
syncSettingsUI();

function applySettingsToCamera() {
  const s = Storage.getSettings();
  fpvCamera.fov = s.camFovDeg;
  fpvCamera.rotation.x = s.camTiltDeg * DEG2RAD;
  fpvCamera.updateProjectionMatrix();
}

function onSettingChange() {
  Storage.updateSettings({
    mode: Number(settingsFields.mode.value),
    maxRateDegPerSec: Number(settingsFields.rate.value),
    expo: Number(settingsFields.expo.value),
    throttleExpo: Number(settingsFields.texpo.value),
    deadzone: Number(settingsFields.deadzone.value),
    camFovDeg: Number(settingsFields.fov.value),
    camTiltDeg: Number(settingsFields.tilt.value),
    invertPitch: settingsFields.invert.checked,
    horizonLock: settingsFields.horizon.checked,
  });
  syncSettingsUI();
  applySettingsToCamera();
}
Object.values(settingsFields).forEach((el) => el.addEventListener('input', onSettingChange));

// ---------------------------------------------------------------- Screen management
function showScreen(el) { el.classList.remove('hidden'); }
function hideScreen(el) { el.classList.add('hidden'); }

function openSettings() { showScreen(settingsScreen); }
function closeSettings() { hideScreen(settingsScreen); }
function openHelp() { showScreen(helpScreen); }
function closeHelp() { hideScreen(helpScreen); }

document.getElementById('open-settings').addEventListener('click', openSettings);
document.getElementById('close-settings').addEventListener('click', closeSettings);
document.getElementById('open-help').addEventListener('click', openHelp);
document.getElementById('close-help').addEventListener('click', closeHelp);
document.getElementById('pause-settings-btn').addEventListener('click', openSettings);
document.getElementById('reset-stats').addEventListener('click', () => {
  if (confirm('Reset all saved stats, best laps, and settings?')) {
    Storage.resetAll();
    syncSettingsUI();
    applySettingsToCamera();
    renderStatsStrip();
  }
});

document.querySelectorAll('[data-start-mode]').forEach((btn) => {
  btn.addEventListener('click', () => startFlight(btn.dataset.startMode));
});
document.getElementById('resume-btn').addEventListener('click', resumeFlight);
document.getElementById('quit-btn').addEventListener('click', quitToMenu);

function renderStatsStrip() {
  const stats = Storage.getStats();
  const bestGateway = Storage.getBestLap('gateway');
  const bestSlalom = Storage.getBestLap('slalom');
  statsStrip.innerHTML = `
    <span>Total flight time: <strong>${formatTime(stats.totalFlightSeconds)}</strong></span>
    <span>Crashes: <strong>${stats.totalCrashes}</strong></span>
    <span>Best Gateway lap: <strong>${bestGateway != null ? formatTime(bestGateway) : '--'}</strong></span>
    <span>Best Slalom lap: <strong>${bestSlalom != null ? formatTime(bestSlalom) : '--'}</strong></span>
  `;
}
renderStatsStrip();

// ---------------------------------------------------------------- Flight lifecycle
function startFlight(modeId) {
  hideScreen(menuScreen);
  hideScreen(pauseScreen);
  hideScreen(settingsScreen);
  hideScreen(helpScreen);
  showScreen(hudRoot);

  if (courseGatesGroup) {
    scene.remove(courseGatesGroup);
    courseGatesGroup = null;
  }

  if (modeId === 'free') {
    currentTrack = null;
    course = null;
    hudRoot.querySelector('[data-hud-section="course"]').classList.add('hidden');
    physics.reset(new THREE.Vector3(0, GROUND_CLEARANCE, 0));
  } else {
    currentTrack = TRACKS[modeId];
    course = new GateCourse(currentTrack);
    hudRoot.querySelector('[data-hud-section="course"]').classList.remove('hidden');

    const { group } = createGateMeshes(currentTrack);
    courseGatesGroup = group;
    scene.add(courseGatesGroup);

    const startOrientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, currentTrack.startYawDeg * DEG2RAD, 0, 'YXZ')
    );
    physics.reset(currentTrack.startPosition, startOrientation);
  }

  simClock = 0;
  elapsedFlightTime = 0;
  batteryUsedEnergy = 0;
  batteryFraction = 1;
  wasCrashed = false;
  hud.setMessage('Throttle to zero, then press ENTER / START to arm', 'info');

  gameState = 'flying';
}

function resumeFlight() {
  hideScreen(pauseScreen);
  gameState = 'flying';
}

function quitToMenu() {
  physics.setArmed(false);
  hideScreen(hudRoot);
  hideScreen(pauseScreen);
  hideScreen(settingsScreen);
  hideScreen(helpScreen);
  showScreen(menuScreen);
  renderStatsStrip();
  gameState = 'menu';
}

function respawn() {
  const spawnPos = currentTrack ? currentTrack.startPosition : new THREE.Vector3(0, GROUND_CLEARANCE, 0);
  const spawnYaw = currentTrack ? currentTrack.startYawDeg : 0;
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spawnYaw * DEG2RAD, 0, 'YXZ'));
  physics.reset(spawnPos, orientation);
  if (course) course.reset();
  wasCrashed = false;
  hud.setMessage('', 'info');
}

// ---------------------------------------------------------------- Command handling
function handleCommands(cmds) {
  if (cmds.pausePressed) {
    if (gameState === 'flying') {
      gameState = 'paused';
      showScreen(pauseScreen);
    } else if (gameState === 'paused') {
      resumeFlight();
    }
    return;
  }

  if (gameState !== 'flying') return;

  if (cmds.helpPressed) {
    helpScreen.classList.toggle('hidden');
  }

  if (cmds.camPressed) {
    activeCamera = activeCamera === fpvCamera ? chaseCamera : fpvCamera;
  }

  if (cmds.resetPressed) {
    respawn();
  }

  if (cmds.armPressed) {
    if (physics.crashed) {
      respawn();
    } else if (!physics.armed) {
      if (input.sticks.throttle > ARM_THROTTLE_GUARD) {
        hud.setMessage('LOWER THROTTLE TO ARM', 'danger');
      } else {
        physics.setArmed(true);
        armedAt = simClock;
        elapsedFlightTime = 0;
        Storage.addArmedSession();
        hud.setMessage('', 'info');
        sfx.arm();
      }
    } else {
      physics.setArmed(false);
      Storage.addFlightSeconds(elapsedFlightTime);
      sfx.disarm();
    }
  }
}

function triggerCrashFlash() {
  crashFlash.classList.remove('hidden');
  crashFlash.style.animation = 'none';
  void crashFlash.offsetWidth; // force reflow so the animation restarts from frame 0
  crashFlash.style.animation = '';
  setTimeout(() => crashFlash.classList.add('hidden'), 900);
}

// ---------------------------------------------------------------- Main loop
let lastNow = performance.now();
let accumulator = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const frameDt = clamp((now - lastNow) / 1000, 0, 0.1);
  lastNow = now;

  if (gameState === 'flying') {
    const cmds = input.update(frameDt);
    handleCommands(cmds);

    if (gameState === 'flying') {
      const settings = Storage.getSettings();
      accumulator += frameDt;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        physics.step(FIXED_DT, input.sticks, settings, GROUND_Y);
        if (physics.armed) simClock += FIXED_DT;
        accumulator -= FIXED_DT;
        steps++;
      }
      postPhysicsUpdate(frameDt);
    }
  }

  render();
}

function postPhysicsUpdate(frameDt) {
  // Battery drains only while armed, faster at higher throttle.
  if (physics.armed) {
    elapsedFlightTime = simClock - armedAt;
    batteryUsedEnergy += frameDt * (0.35 + 0.65 * input.sticks.throttle);
    batteryFraction = clamp(1 - batteryUsedEnergy / BATTERY_CAPACITY_SECONDS, 0, 1);

    if (batteryFraction <= 0) {
      physics.setArmed(false);
      Storage.addFlightSeconds(elapsedFlightTime);
      hud.setMessage('BATTERY DEPLETED', 'danger');
      sfx.disarm();
    } else if (batteryFraction < 0.2 && simClock - lastLowBatteryBeep > 3) {
      lastLowBatteryBeep = simClock;
      sfx.low();
    }
  }

  // Crash transition (edge-triggered).
  if (physics.crashed && !wasCrashed) {
    Storage.addCrash();
    Storage.addFlightSeconds(elapsedFlightTime);
    hud.setMessage('CRASHED — Backspace / Select to respawn', 'danger');
    triggerCrashFlash();
    sfx.crash();
  }
  wasCrashed = physics.crashed;

  // Gate course bookkeeping.
  if (course && physics.armed) {
    const { justPassedGate, justFinishedLap } = course.update(physics.position, simClock);
    if (justFinishedLap) {
      const isNewBest = Storage.maybeSetBestLap(currentTrack.id, course.lastLapTime);
      hud.setMessage(
        `LAP ${course.lapsCompleted} — ${formatTime(course.lastLapTime)}${isNewBest ? ' — NEW BEST!' : ''}`,
        'success'
      );
      sfx.lap();
      setTimeout(() => { if (hud.el.message.textContent.startsWith('LAP')) hud.setMessage('', 'info'); }, 2200);
    } else if (justPassedGate) {
      sfx.gate();
    }
  }

  // Sync visuals to physics state.
  droneGroup.position.copy(physics.position);
  droneGroup.quaternion.copy(physics.orientation);
  spinProps(droneGroup, physics.armed ? input.sticks.throttle : 0, frameDt);

  if (activeCamera === chaseCamera) {
    const yawOnly = new THREE.Euler().setFromQuaternion(physics.orientation, 'YXZ');
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawOnly.y, 0, 'YXZ'));
    const behind = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQuat).multiplyScalar(4.2);
    const desired = physics.position.clone().add(behind).add(new THREE.Vector3(0, 1.9, 0));
    chaseCamera.position.lerp(desired, 1 - Math.exp(-frameDt / 0.2));
    chaseCamera.lookAt(physics.position.clone().add(new THREE.Vector3(0, 0.15, 0)));
  }

  const speed = physics.velocity.length();
  const altitude = Math.max(0, physics.position.y - GROUND_Y);

  hud.update({
    armed: physics.armed,
    crashed: physics.crashed,
    elapsedFlightTime,
    batteryVoltage: 14.0 + batteryFraction * 2.8,
    batteryFraction,
    throttle: physics.armed ? input.sticks.throttle : 0,
    speed,
    altitude,
    usingGamepad: input.usingGamepad,
    course: course
      ? {
          nextGate: course.nextGate,
          nextGateIndex: course.nextGateIndex,
          total: currentTrack.gates.length,
          lapsCompleted: course.lapsCompleted,
          currentLapElapsed: course.currentLapElapsed,
          bestLap: Storage.getBestLap(currentTrack.id),
        }
      : null,
  });
}

function render() {
  renderer.render(scene, activeCamera);
}

requestAnimationFrame(tick);
