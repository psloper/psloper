// A deliberately simplified "acro mode" quadcopter model.
//
// This is NOT a full aerodynamic simulation — it models what matters for
// stick-time training: rate-based rotation with configurable max rate and
// expo (exactly what a flight controller's acro/rate mode gives a pilot),
// gravity, thrust along the airframe's up axis, and drag so the craft
// feels like it has momentum rather than being directly position-controlled.

import * as THREE from 'three';
import { clamp, DEG2RAD } from './utils.js';

const GRAVITY = 9.81;

// Prop clearance above ground level — also used as the standard spawn
// height so quads arm sitting on the ground, like a real FPV craft.
export const GROUND_CLEARANCE = 0.06;

export class QuadPhysics {
  constructor() {
    this.mass = 0.5; // kg — a typical 5" freestyle quad
    this.thrustToWeight = 2.2; // headroom above hover throttle
    this.maxThrust = this.mass * GRAVITY * this.thrustToWeight;

    this.linearDrag = 0.45; // opposes velocity, keeps top speed sane
    this.angularResponseTau = 0.07; // seconds — how "twitchy" the FC feels

    this.position = new THREE.Vector3(0, 1.5, 0);
    this.velocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();

    // Current angular rates (rad/s) in the body frame, smoothed toward
    // whatever the sticks are commanding this frame.
    this.angularVelocity = new THREE.Vector3(); // (pitchRate, yawRate, rollRate)

    this.armed = false;
    this.crashed = false;
    this.landed = true;

    this._scratchQuat = new THREE.Quaternion();
    this._scratchVec = new THREE.Vector3();
  }

  reset(position, orientation) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.orientation.copy(orientation ?? new THREE.Quaternion());
    this.crashed = false;
    this.landed = true;
  }

  setArmed(armed) {
    // Real flight controllers refuse to arm with throttle raised, to avoid
    // a prop-strike surprise — small realism touch, enforced by the caller.
    this.armed = armed;
    if (!armed) {
      this.angularVelocity.set(0, 0, 0);
    }
  }

  /**
   * @param {number} dt seconds
   * @param {{throttle:number, yaw:number, pitch:number, roll:number}} sticks shaped [-1,1] (throttle [0,1])
   * @param {{maxRateDegPerSec:number, horizonLock:boolean}} settings
   * @param {number} groundY world Y of the ground plane
   */
  step(dt, sticks, settings, groundY) {
    if (this.crashed) return;

    const maxRate = settings.maxRateDegPerSec * DEG2RAD;

    let targetPitchRate = 0;
    let targetYawRate = 0;
    let targetRollRate = 0;
    let throttle = 0;

    if (this.armed) {
      throttle = clamp(sticks.throttle, 0, 1);
      targetPitchRate = sticks.pitch * maxRate;
      targetYawRate = sticks.yaw * maxRate;
      targetRollRate = sticks.roll * maxRate;

      if (settings.horizonLock) {
        // Beginner assist: gently steer attitude back toward level instead
        // of holding a pure rate, similar to a "Horizon" flight mode.
        const euler = new THREE.Euler().setFromQuaternion(this.orientation, 'YXZ');
        targetPitchRate += -euler.x * 3.0;
        targetRollRate += -euler.z * 3.0;
      }
    }

    // Smooth toward target rates (simulates motor/FC response lag) rather
    // than snapping instantly — makes the craft feel physical.
    const t = 1 - Math.exp(-dt / this.angularResponseTau);
    this.angularVelocity.x += (targetPitchRate - this.angularVelocity.x) * t;
    this.angularVelocity.y += (targetYawRate - this.angularVelocity.y) * t;
    this.angularVelocity.z += (targetRollRate - this.angularVelocity.z) * t;

    // Integrate orientation using body-frame angular velocity.
    const angSpeed = this.angularVelocity.length();
    if (angSpeed > 1e-6) {
      const axis = this._scratchVec.copy(this.angularVelocity).normalize();
      const deltaQ = this._scratchQuat.setFromAxisAngle(axis, angSpeed * dt);
      this.orientation.multiply(deltaQ);
      this.orientation.normalize();
    }

    // Thrust acts along the airframe's local +Y, rotated into world space.
    const thrustMag = this.armed ? throttle * this.maxThrust : 0;
    const thrustWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(this.orientation).multiplyScalar(thrustMag);

    const gravity = new THREE.Vector3(0, -GRAVITY * this.mass, 0);
    const drag = this.velocity.clone().multiplyScalar(-this.linearDrag * this.velocity.length());

    const accel = thrustWorld.add(gravity).add(drag).divideScalar(this.mass);
    this.velocity.addScaledVector(accel, dt);
    this.position.addScaledVector(this.velocity, dt);

    this._handleGround(groundY);
  }

  _handleGround(groundY) {
    const clearance = GROUND_CLEARANCE;
    if (this.position.y > groundY + clearance) {
      this.landed = false;
      return;
    }

    const euler = new THREE.Euler().setFromQuaternion(this.orientation, 'YXZ');
    const tiltRad = Math.max(Math.abs(euler.x), Math.abs(euler.z));
    const impactSpeed = -this.velocity.y;
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    const hardImpact = impactSpeed > 2.2 || tiltRad > 45 * DEG2RAD || horizontalSpeed > 3.5;

    this.position.y = groundY + clearance;

    if (hardImpact && this.armed) {
      this.crashed = true;
      this.armed = false;
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      return;
    }

    // Gentle touchdown: settle on the ground instead of crashing.
    this.velocity.y = Math.max(this.velocity.y, 0);
    this.velocity.x *= 0.9;
    this.velocity.z *= 0.9;
    this.landed = true;
  }
}
