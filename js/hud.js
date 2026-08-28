// Drives the on-screen display (OSD) overlay — the HUD FPV pilots are used
// to seeing burned into their goggles feed: armed state, timer, battery,
// throttle, speed/altitude, and gate/lap progress.

import { formatTime } from './utils.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {
      armed: root.querySelector('[data-hud="armed"]'),
      timer: root.querySelector('[data-hud="timer"]'),
      battery: root.querySelector('[data-hud="battery"]'),
      batteryFill: root.querySelector('[data-hud="battery-fill"]'),
      throttleFill: root.querySelector('[data-hud="throttle-fill"]'),
      throttleValue: root.querySelector('[data-hud="throttle-value"]'),
      speed: root.querySelector('[data-hud="speed"]'),
      altitude: root.querySelector('[data-hud="altitude"]'),
      gate: root.querySelector('[data-hud="gate"]'),
      lap: root.querySelector('[data-hud="lap"]'),
      lapTime: root.querySelector('[data-hud="lap-time"]'),
      bestLap: root.querySelector('[data-hud="best-lap"]'),
      message: root.querySelector('[data-hud="message"]'),
      input: root.querySelector('[data-hud="input"]'),
      callsign: root.querySelector('[data-hud="callsign"]'),
    };
  }

  setMessage(text, kind = 'info') {
    if (!this.el.message) return;
    this.el.message.textContent = text || '';
    this.el.message.dataset.kind = kind;
    this.el.message.classList.toggle('hidden', !text);
  }

  update({ armed, crashed, elapsedFlightTime, batteryVoltage, batteryFraction, throttle, speed, altitude, course, usingGamepad }) {
    if (this.el.armed) {
      this.el.armed.textContent = crashed ? 'CRASHED' : armed ? 'ARMED' : 'DISARMED';
      this.el.armed.dataset.state = crashed ? 'crashed' : armed ? 'armed' : 'disarmed';
    }
    if (this.el.timer) this.el.timer.textContent = formatTime(elapsedFlightTime);
    if (this.el.battery) this.el.battery.textContent = `${batteryVoltage.toFixed(2)}V`;
    if (this.el.batteryFill) {
      this.el.batteryFill.style.width = `${Math.max(0, batteryFraction) * 100}%`;
      this.el.batteryFill.dataset.low = String(batteryFraction < 0.2);
    }
    if (this.el.throttleFill) this.el.throttleFill.style.height = `${throttle * 100}%`;
    if (this.el.throttleValue) this.el.throttleValue.textContent = `${Math.round(throttle * 100)}%`;
    if (this.el.speed) this.el.speed.textContent = `${speed.toFixed(1)} m/s`;
    if (this.el.altitude) this.el.altitude.textContent = `${altitude.toFixed(1)} m`;
    if (this.el.input) this.el.input.textContent = usingGamepad ? 'GAMEPAD' : 'KEYBOARD';

    if (course) {
      if (this.el.gate) this.el.gate.textContent = course.nextGate ? `${course.nextGateIndex + 1} / ${course.total}` : '--';
      if (this.el.lap) this.el.lap.textContent = String(course.lapsCompleted);
      if (this.el.lapTime) this.el.lapTime.textContent = formatTime(course.currentLapElapsed);
      if (this.el.bestLap) this.el.bestLap.textContent = course.bestLap != null ? formatTime(course.bestLap) : '--:--.---';
    }
  }
}
