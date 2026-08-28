// Gate-course definitions and lap/gate-passage detection.
//
// A gate is a ring the pilot must fly through, defined by a center, a
// facing direction (its normal), and a radius. Passage is detected by
// watching the drone's position cross the gate's plane while staying
// inside the ring radius — this must happen in course order, so gates
// can't be skipped by flying backwards through a later one.

import * as THREE from 'three';
import { GROUND_CLEARANCE } from './physics.js';

// Quads spawn sitting on the ground, like a real FPV craft on the pad —
// arming mid-air would let gravity build fall speed before a gradually
// ramped throttle (especially on keyboard) can catch up, causing an
// unfair crash on liftoff.
const SPAWN_HEIGHT = GROUND_CLEARANCE;

function gate(position, lookAt, radius = 1.6) {
  const pos = new THREE.Vector3(...position);
  const target = new THREE.Vector3(...lookAt);
  const normal = target.clone().sub(pos).normalize();
  return { position: pos, normal, radius };
}

export const TRACKS = {
  gateway: {
    id: 'gateway',
    name: 'Gateway Loop',
    description: 'A gentle introductory loop — wide gates, generous spacing.',
    startPosition: new THREE.Vector3(0, SPAWN_HEIGHT, 8),
    startYawDeg: 180,
    gates: [
      gate([0, 2, 0], [0, 2, -20]),
      gate([16, 2.5, -18], [30, 3, -30]),
      gate([28, 3.5, -34], [28, 4, -50]),
      gate([10, 4, -58], [-10, 3, -58]),
      gate([-18, 3, -46], [-24, 2.5, -30]),
      gate([-14, 2, -12], [-4, 1.5, 4]),
      gate([0, 1.5, 10], [0, 1.5, 20], 1.8), // finish gate
    ],
  },
  slalom: {
    id: 'slalom',
    name: 'Tight Slalom',
    description: 'Narrow gates in a zig-zag — precision roll/yaw coordination.',
    startPosition: new THREE.Vector3(0, SPAWN_HEIGHT, 6),
    startYawDeg: 180,
    gates: [
      gate([-6, 1.6, -6], [6, 1.6, -14], 1.0),
      gate([6, 1.8, -18], [-6, 1.8, -26], 1.0),
      gate([-6, 2.0, -30], [6, 2.0, -38], 1.0),
      gate([6, 2.2, -42], [-6, 2.2, -50], 1.0),
      gate([0, 2.2, -56], [0, 2.2, -66], 1.2),
    ],
  },
};

export class GateCourse {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.nextGateIndex = 0;
    this.lapStartTime = null;
    this.currentLapElapsed = 0;
    this.lastLapTime = null;
    this.lapsCompleted = 0;
    this._prevSignedDist = null;
  }

  get nextGate() {
    return this.track.gates[this.nextGateIndex] ?? null;
  }

  /** Call once per frame with the drone's world position and the sim clock. */
  update(dronePosition, now) {
    const g = this.nextGate;
    if (!g) return { justPassedGate: false, justFinishedLap: false };

    const toDrone = dronePosition.clone().sub(g.position);
    const signedDist = toDrone.dot(g.normal);
    const radialDist = toDrone.sub(g.normal.clone().multiplyScalar(signedDist)).length();

    let justPassedGate = false;
    let justFinishedLap = false;

    if (
      this._prevSignedDist != null &&
      this._prevSignedDist < 0 &&
      signedDist >= 0 &&
      radialDist <= g.radius
    ) {
      justPassedGate = true;
      if (this.nextGateIndex === 0 && this.lapStartTime == null) {
        this.lapStartTime = now;
      }
      this.nextGateIndex++;

      if (this.nextGateIndex >= this.track.gates.length) {
        justFinishedLap = true;
        this.lastLapTime = now - this.lapStartTime;
        this.lapsCompleted++;
        this.nextGateIndex = 0;
        this.lapStartTime = now;
      }

      // We've switched targets to a different gate — its plane is
      // unrelated to the one we just measured, so drop the stale reading
      // instead of comparing against it next frame.
      this._prevSignedDist = null;
      return { justPassedGate, justFinishedLap };
    }

    this._prevSignedDist = signedDist;

    if (this.lapStartTime != null && !justFinishedLap) {
      this.currentLapElapsed = now - this.lapStartTime;
    }

    return { justPassedGate, justFinishedLap };
  }
}
