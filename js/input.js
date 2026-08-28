// Handles all pilot input: keyboard (as a training fallback) and a
// connected gamepad / FPV transmitter presenting itself as an HID
// joystick. Produces normalized stick values in [-1, 1] (throttle in
// [0, 1]) after deadzone + expo shaping, plus edge-triggered command keys.
//
// Stick layout follows Mode 2, the most common convention for FPV pilots:
//   Left stick  (keyboard: W/S throttle, A/D yaw)
//   Right stick (keyboard: Arrow Up/Down pitch, Arrow Left/Right roll)
// Mode 1 (throttle/pitch swapped between sticks) is offered as a setting.

import { applyExpo, applyDeadzone, approach, clamp } from './utils.js';

const SPRING_RESPONSE = 0.06; // seconds for yaw/pitch/roll sticks to self-center
const THROTTLE_RAMP_PER_SEC = 1.1; // keyboard-only: how fast held keys ratchet throttle

export class InputManager {
  constructor(getSettings) {
    this.getSettings = getSettings;

    this.keys = new Set();
    this._prevKeys = new Set();

    // Keyboard-only virtual stick state (springs back to 0 except throttle).
    this.kbThrottle = 0;
    this.kbYaw = 0;
    this.kbPitch = 0;
    this.kbRoll = 0;

    this.gamepadIndex = null;
    this._prevButtons = [];

    // Public, shaped output for this frame.
    this.sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.usingGamepad = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      console.info(`FPV Trainer: gamepad connected — ${e.gamepad.id}`);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  // Edge-triggered "was this key just pressed this frame" check for
  // one-shot commands (arm toggle, reset, pause, help, camera swap).
  _pressed(code) {
    return this.keys.has(code) && !this._prevKeys.has(code);
  }

  _readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.gamepadIndex == null) return null;
    return pads[this.gamepadIndex] || null;
  }

  update(dt) {
    const settings = this.getSettings();
    const gp = this._readGamepad();
    let rawThrottle, rawYaw, rawPitch, rawRoll;

    if (gp) {
      this.usingGamepad = true;
      // Standard mapping: axes[0]=leftX, axes[1]=leftY, axes[2]=rightX, axes[3]=rightY
      // Y axes report -1 at "up" on most hardware.
      const leftX = gp.axes[0] ?? 0;
      const leftY = gp.axes[1] ?? 0;
      const rightX = gp.axes[2] ?? 0;
      const rightY = gp.axes[3] ?? 0;

      const throttleAxis = settings.mode === 1 ? -rightY : -leftY;
      const pitchAxis = settings.mode === 1 ? -leftY : -rightY;
      rawThrottle = clamp((throttleAxis + 1) / 2, 0, 1);
      rawYaw = leftX;
      rawPitch = pitchAxis;
      rawRoll = rightX;
    } else {
      this.usingGamepad = false;
      // Throttle ratchets like a real spring-less throttle stick.
      if (this.keys.has('KeyW')) this.kbThrottle += THROTTLE_RAMP_PER_SEC * dt;
      if (this.keys.has('KeyS')) this.kbThrottle -= THROTTLE_RAMP_PER_SEC * dt;
      this.kbThrottle = clamp(this.kbThrottle, 0, 1);

      const yawTarget = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      const pitchTarget = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0);
      const rollTarget = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);

      this.kbYaw = approach(this.kbYaw, yawTarget, dt, SPRING_RESPONSE);
      this.kbPitch = approach(this.kbPitch, pitchTarget, dt, SPRING_RESPONSE);
      this.kbRoll = approach(this.kbRoll, rollTarget, dt, SPRING_RESPONSE);

      rawThrottle = this.kbThrottle;
      rawYaw = this.kbYaw;
      rawPitch = this.kbPitch;
      rawRoll = this.kbRoll;
    }

    const dz = settings.deadzone ?? 0.04;
    const expo = settings.expo ?? 0.45;
    const tExpo = settings.throttleExpo ?? 0.2;

    let yaw = applyExpo(applyDeadzone(rawYaw, dz), expo);
    let pitch = applyExpo(applyDeadzone(rawPitch, dz), expo);
    let roll = applyExpo(applyDeadzone(rawRoll, dz), expo);
    if (settings.invertPitch) pitch = -pitch;

    // Throttle keeps a gentler, always-positive expo curve (no deadzone —
    // it's an absolute stick position, not a spring-centered one). Remap
    // [0,1] to [-1,1], apply the same expo curve, then remap back.
    const throttleBipolar = rawThrottle * 2 - 1;
    const throttle = clamp((applyExpo(throttleBipolar, tExpo) + 1) / 2, 0, 1);

    this.sticks = { throttle, yaw, pitch, roll };

    // One-shot commands, read from whichever device is active.
    const buttons = gp ? gp.buttons : null;
    const btn = (i) => !!(buttons && buttons[i] && buttons[i].pressed);
    const btnEdge = (i) => btn(i) && !this._prevButtons[i];

    const armPressed = this._pressed('Enter') || btnEdge(9);
    const resetPressed = this._pressed('Backspace') || btnEdge(8);
    const pausePressed = this._pressed('Escape') || this._pressed('KeyP');
    const helpPressed = this._pressed('KeyH');
    const camPressed = this._pressed('KeyC') || btnEdge(1);

    this._prevKeys = new Set(this.keys);
    this._prevButtons = buttons ? buttons.map((b) => b.pressed) : [];

    return { armPressed, resetPressed, pausePressed, helpPressed, camPressed };
  }
}
