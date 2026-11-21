import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  color,
  dot,
  float,
  max,
  mix,
  normalView,
  normalWorld,
  positionViewDirection,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  time,
  vec3, vec2, floor, fract, sin } from 'three/tsl';
import { bNoise, colorRamp, type TSLNode } from './noise.ts';

/**
 * Sky Dome matching SILICON_V1.0.blend SD_World:
 * - Twilight blue vertical gradient
 * - Soft drifting cloud wisps
 * - Subtle atmospheric rainbow arc
 */
export function createSkyDome(
  rainbowStrength: TSLNode,
  cloudAmount: TSLNode,
  nightMix: TSLNode,
  dreamTear: TSLNode = float(0),
): THREE.Mesh {
  const dir = positionWorld.sub(cameraPosition).normalize();
  // Map world Y in [-1, 1] -> [0, 1] for Blender's Z gradient
  const t = dir.y.mul(0.5).add(0.5);

  // Saturated 2000s nostalgic weirdcore day sky (bright cerulean horizon -> deep cobalt zenith)
  const skyGrad = colorRamp(t, [
    [0.0, [0.10, 0.32, 0.72]],
    [0.40, [0.14, 0.42, 0.88]],
    [0.52, [0.095, 0.31, 0.78]],
    [0.66, [0.048, 0.17, 0.52]],
    [0.84, [0.024, 0.088, 0.30]],
    [1.0, [0.014, 0.048, 0.18]],
  ]);

  // Cloud wisps (squashed vertically like Blender's z * 2.6, with slow gentle drift)
  const cloudCoord = vec3(dir.x, dir.z.negate(), dir.y.mul(2.6)).add(
    vec3(time.mul(0.002), 0.0, 0.0),
  );
  const n1 = bNoise(cloudCoord, 8.5, 3, 0.52);
  const n2 = bNoise(cloudCoord.add(vec3(-0.042, 0.039, 0.11)), 8.5, 3, 0.52);

  // Stronger cloud sea below horizon, fading near horizon band
  const belowHorizon = smoothstep(float(0.08), float(-0.18), dir.y);
  const maskVal = clamp(n1.add(belowHorizon.mul(0.06)), 0.0, 1.0);
  const cloudMask = smoothstep(float(0.46), float(0.64), maskVal)
    .mul(smoothstep(float(0.02), float(0.28), abs(dir.y)))
    .mul(cloudAmount);

  const lit = clamp(n1.sub(n2).mul(5.0).add(0.5), 0.0, 1.0);
  const cloudCol = mix(color(0.36, 0.46, 0.65), color(0.98, 0.96, 0.92), lit);
  const skyWithClouds = mix(skyGrad, cloudCol, cloudMask);

  // Dreamcore rainbow arc: framed visibly behind the tower in front/3-4 views
  const absFwd = max(abs(dir.z), float(0.01));
  const u = dir.x.div(absFwd).div(0.48).add(0.82);
  const v = dir.y.div(absFwd).div(0.36).sub(0.92);
  const r = sqrt(u.mul(u).add(v.mul(v)));
  const bandT = r.sub(2.05).mul(5.4);
  const rainbowArc = colorRamp(clamp(bandT, 0.0, 1.0), [
    [0.0, [0.34, 0.20, 0.76]],
    [0.18, [0.12, 0.56, 0.96]],
    [0.38, [0.18, 0.88, 0.52]],
    [0.58, [0.98, 0.86, 0.18]],
    [0.78, [0.98, 0.34, 0.22]],
    [1.0, [0.74, 0.18, 0.46]],
  ]);
  const arcFade = max(float(0.0), float(1.0).sub(abs(bandT.sub(0.5)).mul(2.0)));
  const skyHemisphere = smoothstep(float(-0.1), float(0.25), dir.z.negate())
    .mul(smoothstep(float(-0.05), float(0.15), dir.y));
  const daySky = mix(
    skyWithClouds,
    skyWithClouds.add(rainbowArc.mul(0.82)),
    clamp(arcFade.mul(rainbowStrength).mul(float(1.0).sub(nightMix)).mul(skyHemisphere), 0.0, 1.0),
  );

  // Night horror void: near-black obsidian zenith -> eerie liminal crimson-indigo mist horizon
  const tNight = clamp(dir.y.add(0.18).div(1.15), 0.0, 1.0);
  const nightGrad = colorRamp(tNight, [
    [0.0, [0.004, 0.003, 0.010]],
    [0.24, [0.002, 0.003, 0.009]],
    [0.55, [0.0008, 0.001, 0.0035]],
    [1.0, [0.0002, 0.0003, 0.0010]],
  ]);
  const veilNoise = bNoise(dir.add(vec3(time.mul(0.0012), 0.0, 0.0)), 2.2, 3, 0.62);
  const veilMask = smoothstep(float(0.46), float(0.84), veilNoise);
  const abyssTint = mix(color(0.005, 0.009, 0.022), color(0.016, 0.004, 0.012), smoothstep(float(-0.4), float(0.5), dir.x));
  // Subtle bruised violet-indigo horizon mist band so distant silhouettes read clearly against the void
  const horizonBand = smoothstep(float(0.14), float(-0.04), dir.y)
    .mul(smoothstep(float(-0.26), float(-0.04), dir.y));
  const horizonGlow = horizonBand.mul(0.75);

  // Faint round pinpoint stars in upper hemisphere
  const starGrid = vec2(dir.x.mul(310.0), dir.y.mul(310.0).add(dir.z.mul(180.0)));
  const starCell = floor(starGrid);
  const starUv = fract(starGrid).sub(0.5);
  const starHash = fract(sin(dot(starCell, vec2(127.1, 311.7))).mul(43758.5453));
  const starDot = smoothstep(float(0.30), float(0.04), starUv.length());
  const starMask = smoothstep(float(0.9945), float(0.9995), starHash)
    .mul(starDot)
    .mul(smoothstep(float(0.03), float(0.26), dir.y))
    .mul(float(1.0).sub(veilMask.mul(0.85)));
  const stars = color(0.48, 0.58, 0.85).mul(starMask).mul(0.65);

  // Uncanny eclipse crescent moon positioned clear of the top-right HUD
  const moonDir = vec3(0.245, 0.145, -0.959).normalize();
  const moonCos = dot(dir, moonDir);
  const moonHalo = pow(clamp(moonCos, 0.0, 1.0), float(85.0)).mul(0.28);
  const moonRing = smoothstep(float(0.9989), float(0.99925), moonCos)
    .mul(float(1.0).sub(smoothstep(float(0.99925), float(0.99955), moonCos)));
  const moonCore = smoothstep(float(0.99915), float(0.99938), moonCos);
  const eclipseOffset = dot(dir, vec3(0.237, 0.151, -0.960).normalize());
  const eclipseBite = smoothstep(float(0.9992), float(0.99945), eclipseOffset);
  const crescent = max(float(0.0), moonCore.sub(eclipseBite));
  const moonCol = color(0.94, 0.82, 0.72).mul(crescent.mul(1.15).add(moonRing.mul(0.22)))
    .add(color(0.24, 0.08, 0.16).mul(moonHalo));

  const nightBase = mix(
    nightGrad.add(abyssTint.mul(veilMask).mul(0.42)).add(stars).add(moonCol),
    color(0.026, 0.017, 0.042),
    horizonGlow,
  );

  // Sky-Tear Dreams (HYPOTHESIS §6.2): two jagged phosphor rifts high in the night dome revealing dormant code grids.
  const tearNoise = bNoise(dir.mul(4.5).add(vec3(0.1, 0.3, 0.2)), 5.0, 2, 0.55);
  const tear1Dist = abs(dir.x.add(0.42).mul(1.6).add(dir.y.sub(0.36).mul(0.95)).add(tearNoise.sub(0.5).mul(0.11)));
  const tear1Box = smoothstep(float(0.18), float(0.28), dir.y).mul(smoothstep(float(0.58), float(0.45), dir.y)).mul(smoothstep(float(-0.75), float(-0.55), dir.x)).mul(smoothstep(float(-0.08), float(-0.2), dir.x));
  const tear1Open = smoothstep(float(0.045), float(0.018), tear1Dist).mul(tear1Box);
  const tear1Rim = smoothstep(float(0.072), float(0.042), tear1Dist).mul(float(1.0).sub(tear1Open)).mul(tear1Box);
  const tearGrid = smoothstep(float(0.86), float(0.96), abs(fract(dir.x.mul(36.0).add(time.mul(0.04))).sub(0.5)).mul(2.0))
    .add(smoothstep(float(0.86), float(0.96), abs(fract(dir.y.mul(48.0)).sub(0.5)).mul(2.0)));
  const dreamVoid: TSLNode = vec3(0.02, 0.08, 0.11).add(vec3(0.16, 0.62, 0.66).mul(clamp(tearGrid, 0.0, 1.0)).mul(0.35));
  const tearMask = clamp(tear1Open.mul(dreamTear), 0.0, 1.0);
  const tearGlow: TSLNode = vec3(0.92, 0.62, 0.28).mul(tear1Rim).mul(dreamTear).mul(0.68);
  const nightSky = mix(nightBase, dreamVoid, tearMask).add(tearGlow);

  const finalSky = mix(daySky, nightSky, nightMix);

  const mat = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: true,
    fog: false,
  });
  mat.colorNode = finalSky;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(420, 48, 32), mat);
  mesh.name = 'SD_SkyDome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/**
 * Volumetric-style soft billow cloud shader for ENV_Cloud_* meshes (SD_Cloud_V4).
 * Fades silhouette at grazing angles + 3D noise breakup + directional sun shading.
 */
export function createCloudMaterial(
  sunDir: THREE.Vector3,
  cloudOpacity: TSLNode,
  nightMix: TSLNode,
): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: true,
  });

  // Soft silhouette fade so overlapping icosphere lobes blend into cohesive banks
  const facing = abs(dot(normalView.normalize(), positionViewDirection.normalize()));
  const edgeFade = pow(clamp(facing, 0.0, 1.0), float(1.15));

  // Cohesive world-space billow breakup
  const driftPos = positionWorld.add(vec3(time.mul(0.08), 0.0, time.mul(0.025)));
  const broad = bNoise(driftPos, 0.24, 3, 0.5);
  const fine = bNoise(driftPos, 0.65, 2, 0.58);
  const billow = smoothstep(float(0.32), float(0.64), broad)
    .mul(smoothstep(float(0.28), float(0.72), fine).mul(0.55).add(0.45));

  const sunVec = vec3(sunDir.x, sunDir.y, sunDir.z).normalize();
  const topLight = clamp(dot(normalWorld.normalize(), sunVec).mul(0.5).add(0.5), 0.0, 1.0);
  const topLift = smoothstep(float(-0.25), float(0.85), normalWorld.y);
  const shade = clamp(mix(topLight, topLift, 0.55), 0.0, 1.0);

  const cloudBase = color(0.18, 0.22, 0.30);
  const cloudTop = color(0.58, 0.62, 0.69);
  const sunWarm = color(0.76, 0.74, 0.71);
  const dayCol = mix(cloudBase, mix(cloudTop, sunWarm, pow(topLight, float(2.0)).mul(0.3)), shade);

  // Dark bruised storm-void clouds at night
  const nightBase = color(0.003, 0.004, 0.010);
  const nightTop = color(0.018, 0.022, 0.042);
  const moonRim = color(0.045, 0.038, 0.068);
  const nightCol = mix(nightBase, mix(nightTop, moonRim, pow(topLight, float(2.2)).mul(0.35)), shade);

  const col = mix(dayCol, nightCol, nightMix);

  // Fade near camera and at very far horizon so clouds never clip or pop
  const dist = positionWorld.sub(cameraPosition).length();
  const nearFade = smoothstep(float(22.0), float(52.0), dist);
  const farFade = smoothstep(float(320.0), float(135.0), dist);

  const opacityBase = mix(float(0.62), float(0.48), nightMix);
  mat.colorNode = col;
  mat.opacityNode = clamp(edgeFade.mul(billow).mul(opacityBase).mul(nearFade).mul(farFade).mul(cloudOpacity), 0.0, 1.0);
  return mat;
}

/**
 * Generate a cool twilight PMREM environment map matching Blender's
 * "Ambient cool fill" (0.32, 0.39, 0.50 @ 0.60) + subtle warm horizon glow.
 */
export function createTwilightEnvironment(renderer: THREE.WebGPURenderer): THREE.Texture {
  const envScene = new THREE.Scene();

  const dir = positionWorld.normalize();
  const horizonGlow = smoothstep(float(0.35), float(0.0), abs(dir.y)).mul(0.18);
  const skyBase = mix(
    color(0.24, 0.36, 0.42), // bright meadow/cloud sea bounce
    color(0.38, 0.56, 0.88), // vivid dreamcore sky fill
    smoothstep(float(-0.4), float(0.7), dir.y),
  );
  const warmKeyLobe = pow(
    max(float(0.0), dot(dir, vec3(-0.55, 0.55, 0.55).normalize())),
    float(4.0),
  ).mul(0.32);

  const envMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  envMat.colorNode = skyBase
    .add(color(0.28, 0.32, 0.38).mul(horizonGlow))
    .add(color(1.0, 0.85, 0.67).mul(warmKeyLobe));

  const envDome = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), envMat);
  envScene.add(envDome);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.04);
  envDome.geometry.dispose();
  envMat.dispose();
  pmrem.dispose();
  return rt.texture;
}

/**
 * Generate a cool midnight-blue PMREM environment map matching Blender's
 * SD_NIGHT_WORLD ambient bounce (Strength 2.6) so night silhouettes stay legible.
 */
export function createNightEnvironment(renderer: THREE.WebGPURenderer): THREE.Texture {
  const envScene = new THREE.Scene();

  const dir = positionWorld.normalize();
  const horizonGlow = smoothstep(float(0.35), float(0.0), abs(dir.y)).mul(0.08);
  const skyBase = mix(
    color(0.012, 0.018, 0.042), // dark abyssal bounce
    color(0.004, 0.006, 0.018), // near-black midnight dome
    smoothstep(float(-0.3), float(0.75), dir.y),
  );
  const moonKeyLobe = pow(
    max(float(0.0), dot(dir, vec3(-0.55, 0.70, 0.45).normalize())),
    float(5.0),
  ).mul(0.11);

  const envMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  envMat.colorNode = skyBase
    .add(color(0.025, 0.022, 0.055).mul(horizonGlow))
    .add(color(0.52, 0.66, 1.0).mul(moonKeyLobe));

  const envDome = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), envMat);
  envScene.add(envDome);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.04);
  envDome.geometry.dispose();
  envMat.dispose();
  pmrem.dispose();
  return rt.texture;
}

/**
 * Volumetric-style 3D drifting mist bank hugging the island top (NIGHT_Mist_Low).
 * Built as 44 soft edge-faded ellipsoid lobes in a single InstancedMesh draw call
 * so mist looks atmospheric from ground, 3/4, AND top-down aerial angles with no flat card seams.
 */
export function createNightMist(
  center: [number, number, number],
  size: [number, number, number],
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'NIGHT_Mist_Low';

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: true,
  });

  // Smooth silhouette fade so overlapping volumetric lobes dissolve completely at their rim
  const facing = abs(dot(normalView.normalize(), positionViewDirection.normalize()));
  const edgeFade = pow(clamp(facing, 0.0, 1.0), float(2.35));

  const p = positionWorld;
  const driftA = p.add(vec3(time.mul(0.26), time.mul(0.03), time.mul(0.11)));
  const driftB = p.add(vec3(time.mul(-0.16), float(0.0), time.mul(0.15)));
  const wispA = bNoise(driftA, 0.34, 3, 0.55);
  const wispB = bNoise(driftB, 0.68, 2, 0.55);
  const wispMask = smoothstep(float(0.22), float(0.76), wispA.mul(0.65).add(wispB.mul(0.35)));

  // Keep close-up inspection cameras (CRT/TV/window) crystal clear
  const distCam = p.sub(cameraPosition).length();
  const nearFade = smoothstep(float(4.5), float(11.0), distCam);

  // Dreamcore scattering: cool indigo-teal mist + warm amber/violet spill near tower & glowing screens
  const towerDist = p.xz.sub(vec2(0.0, -1.5)).length();
  const warmSpill = smoothstep(float(10.5), float(2.0), towerDist).mul(0.32);
  const crtSpill = smoothstep(float(7.5), float(1.5), p.xz.sub(vec2(-7.5, 1.0)).length()).mul(0.35);
  const coolMist = color(0.13, 0.20, 0.42);
  const cyanMist = color(0.24, 0.52, 0.68);
  const amberMist = color(0.48, 0.26, 0.36);
  const mistCol = mix(mix(coolMist, amberMist, warmSpill), cyanMist, crtSpill);

  mat.colorNode = mistCol;
  mat.opacityNode = clamp(edgeFade.mul(wispMask).mul(nearFade).mul(0.32), 0.0, 0.36);

  const lobeGeo = new THREE.IcosahedronGeometry(1.0, 2);
  const count = 44;
  const inst = new THREE.InstancedMesh(lobeGeo, mat, count);
  inst.name = 'NIGHT_Mist_Lobes';
  inst.renderOrder = 3;
  inst.frustumCulled = false;

  // Deterministic pseudo-random helper so mist layout is consistent across reloads
  const rand = (seed: number) => {
    const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  // Fit tightly inside the island ellipse (~28m x 22m) instead of a protruding 46m X-axis slab
  const rx = Math.min(size[0] * 0.30, 13.5);
  const rz = Math.min(size[2] * 0.31, 11.2);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2.0 + (rand(i + 1) - 0.5) * 0.45;
    // Bias puffs toward a ring around the tower/rim + scattered inner pockets
    const ring = i < 28 ? 0.48 + rand(i + 41) * 0.52 : 0.18 + rand(i + 41) * 0.42;
    const px = center[0] + Math.cos(angle) * rx * ring;
    const pz = center[2] + Math.sin(angle) * rz * ring;
    const py = center[1] - 0.25 + rand(i + 83) * 1.9;

    const sx = 2.4 + rand(i + 127) * 2.6;
    const sy = 1.05 + rand(i + 173) * 1.15;
    const sz = 2.2 + rand(i + 211) * 2.4;

    dummy.position.set(px, py, pz);
    dummy.rotation.set(0, rand(i + 257) * Math.PI, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.matrixAutoUpdate = false;
  inst.updateMatrix();

  group.add(inst);
  return group;
}
/**
 * Distant surreal horror silhouettes along the misty night horizon (crooked liminal
 * doorframes, tilted monoliths, and utility poles framing the abyss).
 */
export function createNightBackdrop(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SD_Night_Backdrop';

  const silhouetteMat = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0x010104),
    fog: false,
  });

  // Subtle recessed void tint inside crooked distant doors (no bright neon bars)
  const doorwayInteriorMat = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0x0d060b),
    fog: true,
  });

  const postGeo = new THREE.BoxGeometry(1, 1, 1);

  const addDistantDoor = (
    x: number,
    y: number,
    z: number,
    ry: number,
    rz: number,
    scale: number,
  ) => {
    const door = new THREE.Group();
    door.position.set(x, y, z);
    door.rotation.set(0, ry, rz);
    door.scale.setScalar(scale);

    const left = new THREE.Mesh(postGeo, silhouetteMat);
    left.scale.set(0.38, 5.4, 0.45);
    left.position.set(-1.35, 2.7, 0);

    const right = new THREE.Mesh(postGeo, silhouetteMat);
    right.scale.set(0.38, 5.4, 0.45);
    right.position.set(1.35, 2.7, 0);

    const top = new THREE.Mesh(postGeo, silhouetteMat);
    top.scale.set(3.1, 0.42, 0.45);
    top.position.set(0, 5.3, 0);

    const leaf = new THREE.Mesh(postGeo, silhouetteMat);
    leaf.scale.set(2.2, 4.9, 0.16);
    leaf.position.set(0.35, 2.55, 0.78);
    leaf.rotation.y = -0.68;

    const interior = new THREE.Mesh(postGeo, doorwayInteriorMat);
    interior.scale.set(2.2, 4.8, 0.08);
    interior.position.set(0, 2.55, -0.05);

    door.add(left, right, top, leaf, interior);
    group.add(door);
  };

  const addMonolith = (x: number, y: number, z: number, w: number, h: number, rz: number) => {
    const m = new THREE.Mesh(postGeo, silhouetteMat);
    m.position.set(x, y, z);
    m.scale.set(w, h, w * 0.9);
    m.rotation.set(0.04, rz * 2.1, rz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
  };

  // Placed along the misty horizon band (silhouette cleanly against the bruised violet mist)
  addDistantDoor(-34, -8, -78, 0.42, -0.05, 1.9);
  addDistantDoor(38, -7, -76, -0.48, 0.07, 1.85);
  addDistantDoor(32, -9, 74, 2.75, -0.05, 1.9);

  addMonolith(-64, -18, -56, 3.8, 36, 0.08);
  addMonolith(66, -20, -48, 4.2, 38, -0.07);
  addMonolith(18, -22, -96, 5.2, 42, 0.03);
  addMonolith(-58, -16, 52, 3.4, 30, -0.08);
  addMonolith(62, -16, 56, 3.0, 28, 0.06);

  // Crooked utility-pole silhouette on the right horizon
  const pole = new THREE.Mesh(postGeo, silhouetteMat);
  pole.position.set(24, -4, -84);
  pole.scale.set(0.48, 22, 0.48);
  pole.rotation.z = 0.09;
  const cross = new THREE.Mesh(postGeo, silhouetteMat);
  cross.position.set(23.2, 4.5, -84);
  cross.scale.set(5.8, 0.36, 0.36);
  cross.rotation.z = 0.09;
  group.add(pole, cross);

  group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  });

  return group;
}
