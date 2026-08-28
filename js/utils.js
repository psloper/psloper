// Small shared math/formatting helpers used across the simulator.

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Exponential smoothing toward a target that is framerate independent.
// `responseTime` is the approximate time (seconds) to close ~63% of the gap.
export function approach(current, target, dt, responseTime) {
  if (responseTime <= 0) return target;
  const t = 1 - Math.exp(-dt / responseTime);
  return lerp(current, target, t);
}

// Standard RC "expo" curve: keeps stick response soft near center for
// precision, while still reaching full deflection at the stick's edges.
// x is in [-1, 1], expo is in [0, 1].
export function applyExpo(x, expo) {
  const clamped = clamp(x, -1, 1);
  return Math.sign(clamped) * (Math.abs(clamped) * (1 - expo) + Math.pow(Math.abs(clamped), 3) * expo);
}

export function applyDeadzone(x, deadzone) {
  if (Math.abs(x) < deadzone) return 0;
  const sign = Math.sign(x);
  return sign * (Math.abs(x) - deadzone) / (1 - deadzone);
}

export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function formatSigned(n, digits = 0) {
  const v = n.toFixed(digits);
  return n >= 0 ? `+${v}` : v;
}
