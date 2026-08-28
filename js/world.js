// Builds the Three.js scene: ground, sky, lighting, the drone model, and
// the visual representation of a gate course (if one is active).

import * as THREE from 'three';

export const GROUND_Y = 0;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc7ff);
  scene.fog = new THREE.Fog(0x8fc7ff, 60, 220);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a2f1e, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.far = 300;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600, 60, 60),
    new THREE.MeshStandardMaterial({ color: 0x5b8a4a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(600, 120, 0x2c4a24, 0x3f6a33);
  grid.position.y = GROUND_Y + 0.01;
  scene.add(grid);

  scatterLandmarks(scene);

  return scene;
}

// A handful of simple boxes/cylinders spread around the field so pilots
// have visual reference points for depth and speed — freestyle FPV fields
// are never featureless.
function scatterLandmarks(scene) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.8 });

  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let i = 0; i < 40; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 40 + rand() * 220;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    const tree = new THREE.Group();
    const height = 4 + rand() * 6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, height, 6), trunkMat);
    trunk.position.y = height / 2;
    trunk.castShadow = true;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.6 + rand(), 3 + rand() * 2, 8), leafMat);
    leaves.position.y = height + 1;
    leaves.castShadow = true;
    tree.add(trunk, leaves);
    tree.position.set(x, GROUND_Y, z);
    scene.add(tree);
  }

  for (let i = 0; i < 8; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 25 + rand() * 40;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6 + rand() * 4, 1.2), pillarMat);
    pillar.position.set(Math.cos(angle) * dist, GROUND_Y + pillar.geometry.parameters.height / 2, Math.sin(angle) * dist);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);
  }
}

export function createDroneModel() {
  const group = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.5, metalness: 0.3 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x393e46, roughness: 0.5 });
  const propMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, transparent: true, opacity: 0.75 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.18), frameMat);
  body.castShadow = true;
  group.add(body);

  const noseMarker = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 8), noseMat);
  noseMarker.rotation.x = -Math.PI / 2;
  noseMarker.position.set(0, 0.02, -0.13);
  group.add(noseMarker);

  const armPositions = [
    [0.16, 0, -0.16],
    [-0.16, 0, -0.16],
    [0.16, 0, 0.16],
    [-0.16, 0, 0.16],
  ];

  group.userData.props = [];

  for (const [x, y, z] of armPositions) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.24), armMat);
    arm.position.set(x / 2, 0, z / 2);
    arm.lookAt(new THREE.Vector3(x, 0, z));
    arm.castShadow = true;
    group.add(arm);

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.03, 10), frameMat);
    motor.position.set(x, 0.01, z);
    group.add(motor);

    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.004, 0.02), propMat);
    prop.position.set(x, 0.03, z);
    group.add(prop);
    group.userData.props.push(prop);
  }

  group.castShadow = true;
  return group;
}

export function spinProps(droneGroup, throttle, dt) {
  const speed = 20 + throttle * 140;
  for (const prop of droneGroup.userData.props) {
    prop.rotation.y += speed * dt;
  }
}

export function createGateMeshes(track) {
  const group = new THREE.Group();
  const meshes = [];

  track.gates.forEach((gate, index) => {
    const isFinish = index === track.gates.length - 1;
    const color = isFinish ? 0xffcc00 : 0x00c2ff;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(gate.radius, 0.06, 12, 32),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 })
    );
    ring.position.copy(gate.position);
    ring.lookAt(gate.position.clone().add(gate.normal));
    ring.castShadow = true;

    const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, gate.position.y, 8),
      poleMat
    );
    pole.position.set(gate.position.x, gate.position.y / 2, gate.position.z);

    const numberSprite = makeGateLabel(index + 1);
    numberSprite.position.copy(gate.position).add(new THREE.Vector3(0, gate.radius + 0.6, 0));

    group.add(ring, pole, numberSprite);
    meshes.push(ring);
  });

  return { group, meshes };
}

function makeGateLabel(number) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 90px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#00131a';
  ctx.lineWidth = 6;
  ctx.strokeText(String(number), 64, 68);
  ctx.fillText(String(number), 64, 68);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1, 1, 1);
  return sprite;
}
