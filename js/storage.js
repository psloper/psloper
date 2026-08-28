// Thin wrapper around localStorage so the rest of the app never has to
// worry about missing storage, JSON errors, or key names directly.

const NS = 'fpvTrainer.v1';

const DEFAULTS = {
  settings: {
    mode: 2,            // Mode 2 = throttle/yaw on left stick, pitch/roll on right (most common)
    maxRateDegPerSec: 400,
    expo: 0.45,
    throttleExpo: 0.2,
    deadzone: 0.04,
    camFovDeg: 120,
    camTiltDeg: 25,
    invertPitch: false,
    horizonLock: false,   // "self-level" assist for beginners
  },
  stats: {
    totalFlightSeconds: 0,
    totalCrashes: 0,
    totalArmedSessions: 0,
  },
  bestLaps: {},       // trackId -> seconds
};

function load() {
  try {
    const raw = localStorage.getItem(NS);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      stats: { ...DEFAULTS.stats, ...(parsed.stats || {}) },
      bestLaps: { ...(parsed.bestLaps || {}) },
    };
  } catch (e) {
    console.warn('FPV Trainer: could not read saved data, using defaults.', e);
    return structuredClone(DEFAULTS);
  }
}

let state = load();
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(NS, JSON.stringify(state));
    } catch (e) {
      console.warn('FPV Trainer: could not save data.', e);
    }
  }, 200);
}

export const Storage = {
  getSettings() {
    return state.settings;
  },
  updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    persist();
    return state.settings;
  },
  getStats() {
    return state.stats;
  },
  addFlightSeconds(s) {
    state.stats.totalFlightSeconds += s;
    persist();
  },
  addCrash() {
    state.stats.totalCrashes += 1;
    persist();
  },
  addArmedSession() {
    state.stats.totalArmedSessions += 1;
    persist();
  },
  getBestLap(trackId) {
    return state.bestLaps[trackId] ?? null;
  },
  maybeSetBestLap(trackId, seconds) {
    const current = state.bestLaps[trackId];
    if (current == null || seconds < current) {
      state.bestLaps[trackId] = seconds;
      persist();
      return true;
    }
    return false;
  },
  resetAll() {
    state = structuredClone(DEFAULTS);
    persist();
  },
};
