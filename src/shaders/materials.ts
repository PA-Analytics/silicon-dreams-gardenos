import * as THREE from 'three/webgpu';
import {
  abs,
  bumpMap,
  clamp,
  color,
  float,
  floor,
  fract,
  mix,
  normalLocal,
  normalView,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  sin,
  smoothstep,
  sqrt,
  time,
  uv,
  vec2,
  vec3, texture, dot, max, step, uniform, uniformTexture, vertexColor } from 'three/tsl';
import { bNoise, bNoiseVec3, bVoronoi, bVoronoiEdge, colorRamp, linColor, type TSLNode, getSharedNoiseTexture } from './noise.ts';
import type { ScreenBounds } from '../types.ts';

export interface NightMaterialControls {
  nightMix: TSLNode;
  crtState: TSLNode;
  tvState: TSLNode;
  eyeEmerge: TSLNode;
  crtEyeTex: ReturnType<typeof uniformTexture>;
  crtSignalTex: ReturnType<typeof uniformTexture>;
  tvEyesTex: ReturnType<typeof uniformTexture>;
  winEyeTex: ReturnType<typeof uniformTexture>;
  vegEyeTex: ReturnType<typeof uniformTexture>;
}

function createPlaceholderTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createNightMaterialControls(): NightMaterialControls {
  const blank = createPlaceholderTexture();
  return {
    nightMix: uniform(0.0),
    crtState: uniform(2.0),
    tvState: uniform(2.0),
    eyeEmerge: uniform(1.0),
    crtEyeTex: uniformTexture(blank),
    crtSignalTex: uniformTexture(blank),
    tvEyesTex: uniformTexture(blank),
    winEyeTex: uniformTexture(blank),
    vegEyeTex: uniformTexture(blank),
  };
}

function withWindSway(strength: TSLNode | number, useUvY = false): TSLNode {
  const heightMask = useUvY
    ? smoothstep(float(0.05), float(0.9), uv(0).y)
    : float(1.0);
  const amp: ReturnType<typeof float> = typeof strength === 'number' ? float(strength) : strength;
  const phase = time.mul(1.35)
    .add(positionWorld.x.mul(0.55))
    .add(positionWorld.z.mul(0.45));
  const swayX = sin(phase).mul(amp).mul(heightMask);
  const swayZ = sin(phase.mul(0.83).add(1.3)).mul(amp).mul(0.65).mul(heightMask);
  return positionLocal.add(vec3(swayX, float(0.0), swayZ));
}

function makeConcrete(isV4: boolean): THREE.MeshStandardNodeMaterial {
  // Use world coordinates so 0.28m formwork seams, vertical streaks, and cracks align seamlessly
  const p = positionWorld;
  const x = p.x;
  const y = p.y; // world height (Blender Z)
  const z = p.z.negate(); // Blender Y

  const drift = bNoise(p, 0.16, 3, 0.55);
  let base = colorRamp(drift, [
    [0.25, '#6f6e6a'],
    [0.5, '#8a8882'],
    [0.78, '#9c978c'],
  ]);

  // Horizontal 0.28m formwork board-to-board variation
  const boardIdx = floor(y.add(1.6).div(0.28));
  const boardRand = fract(sin(boardIdx.mul(12.9898)).mul(43758.5453));
  const boardTone = boardRand.mul(0.16).add(0.92);
  base = base.mul(boardTone);

  // Timber-grain imprint & vertical rain streaks
  const grain = bNoise(vec3(x.mul(1.2), z.mul(1.2), y.mul(42.0)), 1.0, 2, 0.6);
  const streak = bNoise(vec3(x.mul(2.6), z.mul(2.6), y.mul(0.22)), 1.0, 3, 0.62);
  const streakM = smoothstep(float(0.47), float(0.72), streak);
  const belowSill = smoothstep(float(0.55), float(1.0), fract(y.sub(4.4).div(2.8)));
  const wet = clamp(streakM.mul(belowSill.mul(0.75).add(0.3)), 0.0, 1.0);
  base = mix(base, linColor('#3f3d38'), wet.mul(0.62));

  // Mossy damp base band
  const dampBand = float(1.0).sub(smoothstep(float(-0.2), float(2.2), y.add(bNoise(p, 0.9, 2, 0.6).mul(1.6))));
  base = mix(base, linColor('#454a3c'), dampBand.mul(0.7));

  // Warm dust
  const dust = smoothstep(float(0.55), float(0.8), bNoise(p, 0.45, 2, 0.6));
  base = mix(base, linColor('#a59c8b'), dust.mul(0.35));

  // Wandering Voronoi cracks
  const warp = mix(p, bNoiseVec3(p, 0.55, 2, 0.6), float(0.16));
  const crackDist = bVoronoiEdge(warp, 0.3);
  const crackGate = smoothstep(float(0.5), float(0.62), bNoise(p, 0.21, 2, 0.5));
  const crackM = float(1.0).sub(smoothstep(float(0.0), float(0.012), crackDist)).mul(crackGate);
  base = mix(base, linColor('#2b2a27'), crackM.mul(0.55));

  // Formwork tie holes on 1.2 x 0.84 m grid
  const fx = fract(x.add(z).add(0.3).div(1.2)).sub(0.5);
  const fy = fract(y.add(0.2).div(0.84)).sub(0.5);
  const dd = sqrt(fx.mul(1.2).pow(2.0).add(fy.mul(0.84).pow(2.0)));
  const hole = float(1.0).sub(smoothstep(float(0.022), float(0.036), dd));
  base = mix(base, linColor('#35332f'), hole.mul(0.7));

  if (isV4) {
    // V4 sill-runoff & foundation dampness packed in uv(1).x
    const dampAttr = clamp(uv(1).x, 0.0, 0.55);
    base = mix(base, base.mul(linColor('#6e756c')), dampAttr);
  }

  // Fine surface pores + lightweight procedural bump (keeps crack/grain albedo without heavy bump derivatives)
  const pores = bNoise(p, 38.0, 1, 0.6);
  const h = pores.mul(0.6).sub(hole.mul(1.0));

  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 1.0,
  });
  mat.colorNode = base;
  mat.normalNode = bumpMap(h, float(0.45));
  if (isV4) {
    const rNoise = bNoise(p, 8.0, 2, 0.5);
    mat.roughnessNode = mix(float(0.8), float(0.95), smoothstep(float(0.15), float(0.85), rNoise));
  } else {
    mat.roughnessNode = clamp(wet.mul(-0.18).add(0.93), 0.72, 0.96);
  }
  return mat;
}

function makeEarth(
  a: string,
  b: string,
  c3: string,
  bandScale: number,
  roughLo: number,
  roughHi: number,
  useSoilCollar = false,
): THREE.MeshStandardNodeMaterial {
  const tex = getSharedNoiseTexture();
  const p = positionWorld;
  const s = bandScale * 0.085;
  const sa = texture(tex, p.xy.mul(s));
  const sb = texture(tex, p.zy.mul(s).add(float(0.37)));
  const sc = texture(tex, p.xz.mul(0.45).add(vec2(p.y.mul(0.18), p.y.mul(0.23))));

  const bands = sa.r.add(sb.r).mul(0.5);
  const grit = sa.g.add(sb.g).mul(0.5);
  const cracks = float(1.0).sub(smoothstep(float(0.03), float(0.22), sa.a.min(sb.a)));
  const strata = sin(p.y.mul(4.8).add(bands.mul(4.5))).mul(0.5).add(0.5);

  let col = colorRamp(bands, [
    [0.25, a],
    [0.52, b],
    [0.78, c3],
  ]);

  col = mix(col, linColor('#26231f'), cracks.mul(0.42));
  col = mix(col, linColor('#888074'), smoothstep(float(0.55), float(0.88), strata).mul(0.22));
  col = mix(col, linColor('#2d2924'), smoothstep(float(0.58), float(0.85), grit).mul(0.26));

  if (useSoilCollar) {
    const collarNoise = clamp(uv(1).x.add(sc.r.sub(0.5).mul(0.35)), 0.0, 1.0);
    const collarMask = smoothstep(float(0.22), float(0.88), collarNoise);
    const collarSoil = mix(linColor('#3c3127'), linColor('#564739'), bands);
    col = mix(col, collarSoil, collarMask);
  }

  // Lightweight bump: 1 extra texture tap + analytical strata sine
  const hgt = sc.r.mul(0.5).add(sc.g.mul(0.35)).add(strata.mul(0.35));

  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 1.0 });
  mat.colorNode = col;
  mat.roughnessNode = mix(float(roughLo), float(roughHi), smoothstep(float(0.15), float(0.85), grit));
  mat.normalNode = bumpMap(hgt, float(0.68));
  return mat;
}

function makeLawn(): THREE.MeshStandardNodeMaterial {
  const p = positionWorld;
  const path = clamp(uv(1).x, 0.0, 1.0);
  const v4Soil = clamp(uv(1).y, 0.0, 0.8);

  const patchN = bNoise(p, 0.22, 3, 0.6);
  const turf = colorRamp(patchN, [
    [0.28, '#26531c'],
    [0.55, '#3b7322'],
    [0.82, '#538e2b'],
  ]);
  const dirtN = bNoise(p, 1.3, 4, 0.65);
  let dirt = colorRamp(dirtN, [
    [0.25, '#4f4334'],
    [0.55, '#7a6a50'],
    [0.8, '#93835f'],
  ]);
  const peb = bVoronoi(p, 9.0);
  dirt = mix(dirt, linColor('#3b352b'), float(1.0).sub(smoothstep(float(0.0), float(0.22), peb)).mul(0.55));

  const pf = smoothstep(float(0.25), float(0.75), path.add(dirtN.sub(0.5).mul(0.5)));
  let col: TSLNode = mix(turf, dirt, pf);
  // V4 worn meadow earth where grass is sparse
  col = mix(col, color(0.115, 0.077, 0.043), v4Soil);

  const bumpH = peb.mul(pf).add(bNoise(p, 6.0, 3, 0.6).mul(0.4));
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.94 });
  mat.colorNode = col;
  mat.normalNode = bumpMap(bumpH, float(0.55));
  return mat;
}

function makeLeaf(
  cols: [string, string, string, string],
  roughLo: number,
  roughHi: number,
  swayAmp: number,
  side: THREE.Side = THREE.DoubleSide,
): THREE.MeshStandardNodeMaterial {
  const p = positionWorld;
  const tint = clamp(uv(1).x, 0.0, 1.0);
  let c = colorRamp(tint, [
    [0.0, cols[0]],
    [0.5, cols[1]],
    [1.0, cols[2]],
  ]);
  const wn = bNoise(p, 0.5, 2, 0.5);
  c = mix(c, linColor(cols[3]), smoothstep(float(0.5), float(0.8), wn).mul(0.35));

  const rNoise = bNoise(p, 7.5, 2, 0.5);
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 1.0,
    side,
  });
  mat.colorNode = c;
  mat.roughnessNode = mix(float(roughLo), float(roughHi), smoothstep(float(0.15), float(0.85), rNoise));
  // Subtle backlit translucency feel without washing out shadows
  mat.emissiveNode = c.mul(0.06);
  if (swayAmp > 0) {
    mat.positionNode = withWindSway(swayAmp, false);
  }
  return mat;
}

function makeGrass(): THREE.MeshStandardNodeMaterial {
  const p = positionWorld;
  const uvy = clamp(uv(0).y, 0.0, 1.0);
  const pn = bNoise(p, 0.2, 3, 0.6);
  const rootCol = colorRamp(pn, [
    [0.3, '#254e1a'],
    [0.7, '#386a20'],
  ]);
  const tipCol = colorRamp(bNoise(p, 0.55, 3, 0.6), [
    [0.25, '#4b8627'],
    [0.52, '#69a332'],
    [0.80, '#8cbe3f'],
  ]);
  let c = mix(rootCol, tipCol, smoothstep(float(0.05), float(0.95), uvy));
  const dry = smoothstep(float(0.62), float(0.8), bNoise(p, 1.7, 2, 0.5));
  c = mix(c, linColor('#8f8754'), dry.mul(0.4));

  const rNoise = bNoise(p, 12.0, 2, 0.5);
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 1.0,
    side: THREE.DoubleSide,
  });
  mat.colorNode = c;
  mat.roughnessNode = mix(float(0.65), float(0.82), smoothstep(float(0.15), float(0.85), rNoise));
  mat.emissiveNode = c.mul(0.05).mul(uvy);
  mat.positionNode = withWindSway(0.032, true);
  return mat;
}

function makeAbsPlastic(
  clean: string,
  yellow: string,
  grime: string,
  roughLo: number,
  roughHi: number,
  withCurvatureDust = false,
): THREE.MeshStandardNodeMaterial {
  const p = positionLocal;
  const blot = bNoise(p, 1.1, 3, 0.6);
  // Upward yellowing in local/world Y
  const up = smoothstep(float(0.0), float(1.6), positionWorld.y.add(blot.mul(1.2)));
  let c: TSLNode = mix(linColor(clean), linColor(yellow), up);

  const dirt = smoothstep(float(0.55), float(0.85), bNoise(p, 3.0, 4, 0.7));
  c = mix(c, linColor(grime), dirt.mul(0.4));

  if (withCurvatureDust) {
    // Upper-face dust + subtle cavity grime from TX_Curvature in uv(1).x
    const upFace = smoothstep(float(0.35), float(0.88), normalWorld.y);
    const dustBreakup = bNoise(positionWorld, 4.5, 3, 0.55);
    const dustMask = upFace.mul(dustBreakup).mul(0.08);
    c = mix(c, linColor('#cfc7b4'), dustMask);
  }

  const scr = bNoise(vec3(p.x.mul(60.0), p.y.mul(60.0), p.z.mul(2.0)), 1.0, 2, 0.5);
  const rNoise = bNoise(p, 18.0, 2, 0.5);
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 1.0 });
  mat.colorNode = c;
  mat.roughnessNode = clamp(mix(float(roughLo), float(roughHi), smoothstep(float(0.15), float(0.85), rNoise)).add(dirt.mul(0.15)), 0.25, 0.95);
  mat.normalNode = bumpMap(scr, float(0.06));
  return mat;
}

function makeWoody(a: string, b: string, scale: [number, number, number], roughLo: number, roughHi: number): THREE.MeshStandardNodeMaterial {
  const p = positionLocal;
  const n = bNoise(vec3(p.x.mul(scale[0]), p.y.mul(scale[2]), p.z.mul(scale[1])), 1.0, 4, 0.7);
  const c = colorRamp(n, [
    [0.3, a],
    [0.7, b],
  ]);
  const rNoise = bNoise(p, 5.0, 2, 0.5);
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 1.0 });
  mat.colorNode = c;
  mat.roughnessNode = mix(float(roughLo), float(roughHi), smoothstep(float(0.15), float(0.85), rNoise));
  mat.normalNode = bumpMap(n, float(0.45));
  return mat;
}

function makeGlass(): THREE.MeshPhysicalNodeMaterial {
  const p = positionWorld;
  const dirt = smoothstep(float(0.4), float(0.8), bNoise(p, 1.6, 4, 0.7));
  const c = mix(linColor('#0c1014'), linColor('#3a4046'), dirt);
  const rNoise = bNoise(p, 5.0, 2, 0.5);
  const baseRough = mix(float(0.055), float(0.14), smoothstep(float(0.15), float(0.85), rNoise));

  const mat = new THREE.MeshPhysicalNodeMaterial({
    metalness: 0.0,
    roughness: 1.0,
    ior: 1.5,
    transparent: true,
    depthWrite: false,
  });
  mat.colorNode = c;
  mat.roughnessNode = clamp(baseRough.add(dirt.mul(0.28)), 0.05, 0.75);
  // Subtle fresnel reflection + dirt opacity so backlit amber curtains shine cleanly
  const fresnel = pow(
    float(1.0).sub(abs(normalView.normalize().dot(positionViewDirection.normalize()))),
    float(3.0),
  );
  mat.opacityNode = clamp(float(0.24).add(dirt.mul(0.32)).add(fresnel.mul(0.38)), 0.18, 0.85);
  return mat;
}

function makeCurtainLit(nightMix: TSLNode): THREE.MeshStandardNodeMaterial {
  const p = positionLocal;
  const fold = float(1.0).sub(smoothstep(float(0.05), float(0.75), abs(normalLocal.x)).mul(0.55));
  const core = clamp(
    float(1.0).sub(abs(p.x).mul(0.3).add(abs(p.y).mul(0.22))),
    0.0,
    1.0,
  );
  const glow = fold.mul(core.mul(1.0).add(0.35));
  const ec = colorRamp(clamp(glow.div(1.35), 0.0, 1.0), [
    [0.15, '#c8641c'],
    [0.55, '#ffa53c'],
    [1.0, '#ffd98a'],
  ]);

  const mat = new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color('#b78a4a'),
    roughness: 0.8,
    metalness: 0.0,
  });
  // Day 5.8 -> Night 2.4 (44%) so amber windows stay detailed against dark sky
  const nightScale = mix(float(1.0), float(0.44), nightMix);
  mat.emissiveNode = ec.mul(glow.mul(3.8).add(0.8)).mul(nightScale);
  return mat;
}

function hash21(p: TSLNode): TSLNode {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123));
}

function makeDualScreen(
  kind: 'CRT' | 'TV',
  controls: NightMaterialControls,
  bounds: ScreenBounds,
): THREE.MeshStandardNodeMaterial {
  // Day branch: cyan glow
  const pw = positionWorld;
  const dayScan = sin(pw.y.mul(220.0).sub(time.mul(6.0))).mul(0.09).add(0.91);
  const dayHaze = bNoise(pw, 2.2, 2, 0.5);
  const dayCol = colorRamp(dayHaze, [
    [0.3, '#58b4d4'],
    [0.7, '#9fe0f2'],
  ]);
  const dayEmissive = dayCol.mul(dayScan).mul(2.4);

  // Night branch: object-space UV matching Blender 02_screen_states.py
  const w = Math.max(bounds.maxX - bounds.minX, 0.01);
  const h = Math.max(bounds.maxY - bounds.minY, 0.01);
  const u = clamp(positionLocal.x.sub(bounds.minX).div(w), 0.0, 1.0);
  const v = clamp(positionLocal.y.sub(bounds.minY).div(h), 0.0, 1.0);

  const isCrt = kind === 'CRT';
  const nx = isCrt ? 256.0 : 200.0;
  const ny = isCrt ? 192.0 : 150.0;
  const scanLines = isCrt ? 190.0 : 150.0;
  const tint = isCrt ? color(0.8, 0.96, 1.0) : color(0.92, 0.97, 1.0);

  // 24 fps quantized time for crisp analog CRT static flicker
  const frameStep = floor(time.mul(24.0)).mul(0.137);
  const row = floor(v.mul(ny));
  const rown = hash21(vec2(row, frameStep));

  const roll = fract(v.mul(0.9).sub(time.mul(0.28)));
  const band = max(float(0.0), float(1.0).sub(abs(roll.sub(0.5)).mul(2.0)));
  const bandS = pow(band, float(6.0));
  const tear = rown.sub(0.5).mul(float(0.002).add(bandS.mul(0.02)));

  const uq = floor(u.add(tear).mul(nx));
  const nval = hash21(vec2(uq.add(frameStep.mul(13.0)), row.add(frameStep.mul(7.0))));
  const nval2 = pow(nval, float(1.6));
  const staticI = nval2.mul(1.15).add(bandS.mul(0.25)).mul(float(0.78).add(rown.mul(0.5)));
  const staticCol = tint.mul(staticI);

  const scan = float(0.86).add(sin(v.mul(scanLines * Math.PI * 2.0)).mul(0.14));
  const rr = u.sub(0.5).pow(2.0).add(v.sub(0.5).pow(2.0)).sqrt();
  const vig = float(1.0).sub(clamp(rr.sub(0.38), 0.0, 0.5).mul(1.15));
  const shade = scan.mul(vig);

  const sampleClip = (texNode: ReturnType<typeof uniformTexture>, su: TSLNode, sv: TSLNode) => {
    const inside = step(float(0.0), su)
      .mul(step(su, float(1.0)))
      .mul(step(float(0.0), sv))
      .mul(step(sv, float(1.0)));
    const s = texture(texNode, vec2(clamp(su, 0.0, 1.0), clamp(sv, 0.0, 1.0)));
    return { rgb: s.rgb.mul(inside), a: s.a.mul(inside) };
  };

  let nightEmissive: TSLNode;
  if (isCrt) {
    const kx = 1.0 / 0.95;
    const ky = 1.0 / 0.769;
    const sv = v.sub(0.5).mul(ky).add(0.5);
    const suR = u.add(tear).sub(0.007).sub(0.5).mul(kx).add(0.5);
    const suG = u.add(tear).sub(0.5).mul(kx).add(0.5);
    const suB = u.add(tear).add(0.007).sub(0.5).mul(kx).add(0.5);

    const sR = sampleClip(controls.crtEyeTex, suR, sv);
    const sG = sampleClip(controls.crtEyeTex, suG, sv);
    const sB = sampleClip(controls.crtEyeTex, suB, sv);
    const eyeRGB = vec3(sR.rgb.r, sG.rgb.g, sB.rgb.b);
    const aE = sG.a.mul(controls.eyeEmerge);
    const baseStatic = staticCol.mul(float(1.0).sub(aE.mul(0.9))).mul(0.19);
    const ghost = nval.sub(0.5).mul(0.22);
    const eyeCol = eyeRGB.mul(tint).mul(1.12).mul(float(1.0).add(ghost));
    const eyeFinal = mix(baseStatic, eyeCol, aE).mul(shade);

    // SIGNAL state
    const sSig = sampleClip(controls.crtSignalTex, u.add(tear), v);
    const sigBg = color(0.02, 0.075, 0.095).mul(
      float(1.0).add(bandS.mul(0.5)).add(nval.sub(0.5).mul(0.12)),
    );
    const blink = step(float(0.5), fract(time));
    const curU = step(abs(u.sub(0.155)), float(0.012)).mul(step(abs(v.sub(0.575)), float(0.028)));
    const cur = curU.mul(blink);
    const sigComp = mix(sigBg, sSig.rgb.mul(1.2), sSig.a);
    const sigFinal = mix(sigComp, color(0.55, 1.0, 0.95), cur).mul(shade);

    const w1 = step(abs(controls.crtState.sub(1.0)), float(0.25));
    const w2 = step(abs(controls.crtState.sub(2.0)), float(0.25));
    const w3 = step(abs(controls.crtState.sub(3.0)), float(0.25));
    nightEmissive = staticCol
      .mul(shade)
      .mul(w1)
      .add(eyeFinal.mul(w2))
      .add(sigFinal.mul(w3))
      .mul(1.18);
  } else {
    const throb = float(1.0).add(sin(time.mul(1.8)).mul(0.1));
    const sR = sampleClip(controls.tvEyesTex, u.add(tear).sub(0.006), v);
    const sG = sampleClip(controls.tvEyesTex, u.add(tear), v);
    const sB = sampleClip(controls.tvEyesTex, u.add(tear).add(0.006), v);
    const eyesRGB = vec3(sR.rgb.r, sG.rgb.g, sB.rgb.b);
    const ghost = nval.sub(0.5).mul(0.3);
    const eyesFinal = eyesRGB
      .mul(tint)
      .mul(float(1.05).add(ghost))
      .mul(throb)
      .mul(shade);

    const w1 = step(abs(controls.tvState.sub(1.0)), float(0.25));
    const w2 = step(abs(controls.tvState.sub(2.0)), float(0.25));
    nightEmissive = staticCol.mul(shade).mul(w1).add(eyesFinal.mul(w2)).mul(1.45);
  }

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: isCrt ? 0.1 : 0.16,
    metalness: 0.0,
  });
  mat.colorNode = mix(linColor('#0b1418'), color(0.003, 0.006, 0.008), controls.nightMix);
  mat.emissiveNode = mix(dayEmissive, nightEmissive, controls.nightMix);
  return mat;
}

function makeWindowGlow(nightMix: TSLNode): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  // Soft radial falloff from UV center so glow boxes don't show hard rectangular edges
  const d = uv(0).sub(vec2(0.5, 0.5)).length().mul(2.0);
  const falloff = pow(clamp(float(1.0).sub(d), 0.0, 1.0), float(2.2));
  const nightScale = mix(float(1.0), float(0.48), nightMix);
  mat.colorNode = linColor('#ffb060').mul(falloff).mul(0.65).mul(nightScale);
  mat.opacityNode = falloff.mul(0.55).mul(nightScale);
  return mat;
}

const DEFAULT_CRT_BOUNDS: ScreenBounds = {
  minX: -0.1544,
  maxX: 1.1744,
  minY: 0.52162,
  maxY: 1.54838,
};

const DEFAULT_TV_BOUNDS: ScreenBounds = {
  minX: -1.12242,
  maxX: 0.12242,
  minY: 0.25495,
  maxY: 1.35505,
};

interface PropBakedSpec {
  colA: THREE.Color;
  colB: THREE.Color;
  rough: number;
  metal: number;
  scale: number;
}

interface LeafBakedSpec {
  stops: [THREE.Color, THREE.Color, THREE.Color];
  sway: number;
}

const linC = (hex: string) => new THREE.Color(hex);

export const PROP_BAKED_SPECS: Record<string, PropBakedSpec> = {
  SD_Concrete_Interior: { colA: linC('#33322f'), colB: linC('#55534e'), rough: 0.92, metal: 0.0, scale: 0.6 },
  SD_Concrete_Broken: { colA: linC('#5d5a54'), colB: linC('#938d82'), rough: 0.97, metal: 0.0, scale: 1.8 },
  SD_RoomWall: { colA: linC('#b79a6a'), colB: linC('#d6bd8e'), rough: 0.85, metal: 0.0, scale: 0.8 },
  V3_Entrance_Interior: { colA: new THREE.Color(0.015, 0.016, 0.019), colB: new THREE.Color(0.015, 0.016, 0.019), rough: 0.98, metal: 0.0, scale: 1.0 },
  SD_Bark: { colA: linC('#3a322a'), colB: linC('#5f5547'), rough: 0.9, metal: 0.0, scale: 4.5 },
  SD_Stem: { colA: linC('#2f2a1c'), colB: linC('#4b4428'), rough: 0.88, metal: 0.0, scale: 4.5 },
  SD_Wood_V4: { colA: linC('#4a2f1b'), colB: linC('#7a5433'), rough: 0.75, metal: 0.0, scale: 6.0 },
  SD_Wood: { colA: linC('#4a2f1b'), colB: linC('#7a5433'), rough: 0.75, metal: 0.0, scale: 6.0 },
  SD_Wood_Cabinet_V4: { colA: linC('#3c2415'), colB: linC('#6a4226'), rough: 0.68, metal: 0.0, scale: 7.0 },
  SD_Wood_Cabinet: { colA: linC('#3c2415'), colB: linC('#6a4226'), rough: 0.68, metal: 0.0, scale: 7.0 },
  SD_ABS_Beige_V4: { colA: linC('#c9bfa5'), colB: linC('#c3b07c'), rough: 0.48, metal: 0.0, scale: 1.4 },
  SD_ABS_Beige: { colA: linC('#c9bfa5'), colB: linC('#c3b07c'), rough: 0.48, metal: 0.0, scale: 1.4 },
  SD_ABS_Beige_Dark_V4: { colA: linC('#a89e86'), colB: linC('#9d8c5f'), rough: 0.54, metal: 0.0, scale: 1.4 },
  SD_ABS_Beige_Dark: { colA: linC('#a89e86'), colB: linC('#9d8c5f'), rough: 0.54, metal: 0.0, scale: 1.4 },
  SD_Chair_Plastic: { colA: linC('#cfcbbf'), colB: linC('#c5bc9e'), rough: 0.46, metal: 0.0, scale: 1.6 },
  SD_DeskTop: { colA: linC('#bdbbb3'), colB: linC('#b6b09c'), rough: 0.40, metal: 0.0, scale: 1.5 },
  SD_Boombox_Grey: { colA: linC('#8b8d8e'), colB: linC('#7f7e78'), rough: 0.42, metal: 0.0, scale: 2.2 },
  SD_TV_Body: { colA: linC('#4a4038'), colB: linC('#3d342b'), rough: 0.45, metal: 0.0, scale: 2.0 },
  SD_Paper: { colA: linC('#c9c2a9'), colB: linC('#bfb288'), rough: 0.82, metal: 0.0, scale: 2.5 },
  SD_Book_A: { colA: linC('#5a2620'), colB: linC('#6b3b34'), rough: 0.7, metal: 0.0, scale: 3.0 },
  SD_Book_B: { colA: linC('#22324c'), colB: linC('#374963'), rough: 0.7, metal: 0.0, scale: 3.0 },
  SD_Book_C: { colA: linC('#2c4030'), colB: linC('#3e5242'), rough: 0.7, metal: 0.0, scale: 3.0 },
  SD_ABS_Charcoal: { colA: linC('#1c1c1d'), colB: linC('#232325'), rough: 0.5, metal: 0.0, scale: 2.0 },
  SD_Speaker_Dark: { colA: linC('#151515'), colB: linC('#1d1d1d'), rough: 0.65, metal: 0.0, scale: 12.0 },
  SD_Metal_Painted: { colA: linC('#77797a'), colB: linC('#8a8884'), rough: 0.5, metal: 0.4, scale: 4.5 },
  SD_Chrome_Dull: { colA: linC('#b9b9b6'), colB: linC('#c5c5c2'), rough: 0.32, metal: 1.0, scale: 2.0 },
  SD_Rebar: { colA: linC('#3a2219'), colB: linC('#6b3d26'), rough: 0.85, metal: 0.3, scale: 8.0 },
  SD_WinFrame: { colA: linC('#3b3d40'), colB: linC('#55585b'), rough: 0.55, metal: 0.5, scale: 3.5 },
};

export const LEAF_BAKED_SPECS: Record<string, LeafBakedSpec> = {
  SD_Leaf_Ivy_V4: { stops: [linC('#234c1c'), linC('#3b7125'), linC('#5e9632')], sway: 0.012 },
  SD_Leaf_Ivy: { stops: [linC('#234c1c'), linC('#3b7125'), linC('#5e9632')], sway: 0.012 },
  SD_Leaf_Tree_V4: { stops: [linC('#4b7e26'), linC('#6a9e33'), linC('#8ec044')], sway: 0.022 },
  SD_Leaf_Tree: { stops: [linC('#4b7e26'), linC('#6a9e33'), linC('#8ec044')], sway: 0.022 },
  SD_Leaf_Dark: { stops: [linC('#193317'), linC('#264c1f'), linC('#3a6627')], sway: 0.01 },
  SD_Hydrangea_Petal: { stops: [linC('#5459b8'), linC('#7378d4'), linC('#9c97e6')], sway: 0.008 },
};

function makeUnifiedPropMaterial(): THREE.MeshStandardNodeMaterial {
  const tex = getSharedNoiseTexture();
  const micro = texture(tex, positionWorld.xy.mul(0.28)).r;
  const grain = micro.sub(0.5).mul(0.14).add(1.0);
  const vc = vertexColor(0).rgb;

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 1.0,
    metalness: 1.0,
  });
  mat.colorNode = vc.mul(grain);
  mat.roughnessNode = clamp(uv(1).x.add(micro.sub(0.5).mul(0.08)), 0.25, 0.99);
  mat.metalnessNode = uv(1).y;
  return mat;
}

function makeUnifiedLeafMaterial(): THREE.MeshStandardNodeMaterial {
  const tex = getSharedNoiseTexture();
  const wn = texture(tex, positionWorld.xz.mul(0.08)).r;
  const vc = vertexColor(0).rgb;
  const col = mix(vc, vc.mul(1.15), smoothstep(float(0.45), float(0.82), wn).mul(0.32));

  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 1.0,
    side: THREE.DoubleSide,
  });
  mat.colorNode = col;
  mat.roughnessNode = mix(float(0.48), float(0.72), wn);
  mat.emissiveNode = col.mul(0.055);
  mat.positionNode = withWindSway(uv(1).y, false);
  return mat;
}

export function createSiliconMaterialLibrary(
  nightControls: NightMaterialControls,
): Map<string, THREE.Material> {
  const libs = new Map<string, THREE.Material>();

  // Hero structural materials (full multi-layer procedural shaders)
  const concreteMat = makeConcrete(true);
  libs.set('SD_Concrete', concreteMat);
  libs.set('SD_Concrete_V4', concreteMat);

  const lawnMat = makeLawn();
  libs.set('SD_Lawn_V4', lawnMat);
  libs.set('SD_Lawn', lawnMat);

  const soilMat = makeEarth('#45392d', '#625343', '#7f6e5b', 1.6, 0.85, 0.97, false);
  libs.set('SD_Soil_V4', soilMat);
  libs.set('SD_Soil', soilMat);

  const rockMat = makeEarth('#3b3732', '#554f47', '#736b60', 2.2, 0.80, 0.95, true);
  libs.set('SD_Rock_V4', rockMat);
  libs.set('SD_Rock', rockMat);

  // Instanced grass & flowers
  const grassMat = makeGrass();
  libs.set('SD_Grass_V4', grassMat);
  libs.set('SD_Grass', grassMat);
  libs.set('SD_Flower_White', new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#d9d6c8'), roughness: 0.6 }));
  libs.set('SD_Flower_Violet', new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#8f7fc0'), roughness: 0.6 }));

  // Consolidated single-shader buckets (cuts ~25 WGSL pipelines & draw calls down to 2)
  const unifiedPropMat = makeUnifiedPropMaterial();
  libs.set('__UNIFIED_PROP__', unifiedPropMat);
  for (const name of Object.keys(PROP_BAKED_SPECS)) {
    libs.set(name, unifiedPropMat);
  }

  const unifiedLeafMat = makeUnifiedLeafMaterial();
  libs.set('__UNIFIED_LEAF__', unifiedLeafMat);
  for (const name of Object.keys(LEAF_BAKED_SPECS)) {
    libs.set(name, unifiedLeafMat);
  }

  const led = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#1c3a22'), roughness: 0.4 });
  led.emissiveNode = linColor('#54ff7a').mul(2.2);
  libs.set('SD_LED_Green', led);

  // Glass, curtains & screens
  const glassMat = makeGlass();
  libs.set('SD_Glass_V4', glassMat);
  libs.set('SD_Glass', glassMat);

  const curtain = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
  curtain.colorNode = colorRamp(
    bNoise(vec3(positionWorld.x.mul(9.0), positionWorld.y.mul(0.3), positionWorld.z.mul(9.0)), 1.0, 3, 0.6),
    [
      [0.3, '#2a3038'],
      [0.7, '#4d5560'],
    ],
  );
  libs.set('SD_Curtain', curtain);

  libs.set('SD_Curtain_Lit', makeCurtainLit(nightControls.nightMix));
  libs.set('SD_Glow', makeWindowGlow(nightControls.nightMix));

  // Distinct instances so CRT and TV screens never get merged into one mesh
  libs.set('SD_Screen_CRT', makeDualScreen('CRT', nightControls, DEFAULT_CRT_BOUNDS));
  libs.set('SD_Screen_TV', makeDualScreen('TV', nightControls, DEFAULT_TV_BOUNDS));

  return libs;
}

function bakeVertexColorAndMeta(
  geo: THREE.BufferGeometry,
  worldMat: THREE.Matrix4,
  origMatName: string,
): void {
  const posAttr = geo.attributes.position;
  const count = posAttr.count;
  const colArr = new Float32Array(count * 3);
  const uv1Existing = geo.attributes.uv1;
  const uv1Arr = new Float32Array(count * 2);

  const propSpec = PROP_BAKED_SPECS[origMatName];
  const leafSpec = LEAF_BAKED_SPECS[origMatName];

  if (propSpec) {
    const { colA, colB, rough, metal, scale } = propSpec;
    const e = worldMat.elements;
    for (let i = 0; i < count; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i);
      const lz = posAttr.getZ(i);
      const wx = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
      const wy = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
      const wz = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
      const n = 0.5 + 0.5 * Math.sin(wx * scale + wy * scale * 0.73 + wz * scale * 1.17);
      const i3 = i * 3;
      colArr[i3] = colA.r + (colB.r - colA.r) * n;
      colArr[i3 + 1] = colA.g + (colB.g - colA.g) * n;
      colArr[i3 + 2] = colA.b + (colB.b - colA.b) * n;
      const i2 = i * 2;
      uv1Arr[i2] = rough;
      uv1Arr[i2 + 1] = metal;
    }
  } else if (leafSpec) {
    const [c0, c1, c2] = leafSpec.stops;
    for (let i = 0; i < count; i++) {
      const t = uv1Existing ? Math.min(1, Math.max(0, uv1Existing.getX(i))) : 0.5;
      let r: number;
      let g: number;
      let b: number;
      if (t < 0.5) {
        const u = t * 2.0;
        r = c0.r + (c1.r - c0.r) * u;
        g = c0.g + (c1.g - c0.g) * u;
        b = c0.b + (c1.b - c0.b) * u;
      } else {
        const u = (t - 0.5) * 2.0;
        r = c1.r + (c2.r - c1.r) * u;
        g = c1.g + (c2.g - c1.g) * u;
        b = c1.b + (c2.b - c1.b) * u;
      }
      const i3 = i * 3;
      colArr[i3] = r;
      colArr[i3 + 1] = g;
      colArr[i3 + 2] = b;
      const i2 = i * 2;
      uv1Arr[i2] = t;
      uv1Arr[i2 + 1] = leafSpec.sway;
    }
  } else {
    colArr.fill(1.0);
    if (uv1Existing) {
      for (let i = 0; i < count; i++) {
        uv1Arr[i * 2] = uv1Existing.getX(i);
        uv1Arr[i * 2 + 1] = uv1Existing.getY(i);
      }
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1Arr, 2));
}

export function upgradeSceneMaterials(
  root: THREE.Object3D,
  matLib: Map<string, THREE.Material>,
): { meshes: number; instances: number; upgraded: number } {
  let instances = 0;
  let upgraded = 0;

  const mergeBuckets = new Map<
    string,
    {
      material: THREE.Material;
      castShadow: boolean;
      receiveShadow: boolean;
      usesColor: boolean;
      sources: Array<{ mesh: THREE.Mesh; origMatName: string }>;
    }
  >();

  let keptMeshes = 0;
  root.updateMatrixWorld(true);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    const inst = obj as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      instances += inst.count;
      keptMeshes++;
      let instOrigMatName = '';
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => {
          instOrigMatName = m.name;
          return matLib.get(m.name) ?? m;
        });
      } else if (mesh.material) {
        instOrigMatName = mesh.material.name;
        mesh.material = matLib.get(mesh.material.name) ?? mesh.material;
      }
      if (!mesh.geometry.attributes.uv1 || ((PROP_BAKED_SPECS[instOrigMatName] || LEAF_BAKED_SPECS[instOrigMatName]) && !mesh.geometry.attributes.color)) {
        if (PROP_BAKED_SPECS[instOrigMatName] || LEAF_BAKED_SPECS[instOrigMatName]) {
          bakeVertexColorAndMeta(mesh.geometry, mesh.matrixWorld, instOrigMatName);
        } else {
          const count = mesh.geometry.attributes.position.count;
          mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
      }
      // Grass blades & tiny flowers receive shadows without submitting ~100k tris into shadow map
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      return;
    }

    let origMatName = '';
    const swap = (m: THREE.Material): THREE.Material => {
      origMatName = m.name;
      const replacement = matLib.get(m.name);
      if (replacement) {
        upgraded++;
        return replacement;
      }
      return m;
    };

    let hasGlassOrGlow = false;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => {
        if (m.name.includes('Glass') || m.name === 'SD_Glow' || m.name === 'SD_Curtain_Lit') {
          hasGlassOrGlow = true;
        }
        return swap(m);
      });
    } else if (mesh.material) {
      const m = mesh.material;
      if (m.name.includes('Glass') || m.name === 'SD_Glow' || m.name === 'SD_Curtain_Lit') {
        hasGlassOrGlow = true;
      }
      mesh.material = swap(m);
    }

    const isTinyStem = origMatName === 'SD_Stem' || obj.name.includes('Stems');
    const castShadow = !hasGlassOrGlow && !obj.name.startsWith('FX_') && !isTinyStem;
    const receiveShadow = obj.name !== 'SD_Glow' && !obj.name.startsWith('FX_');
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    if (!Array.isArray(mesh.material) && mesh.material && !obj.name.startsWith('FX_')) {
      const usesColor = Boolean(PROP_BAKED_SPECS[origMatName] || LEAF_BAKED_SPECS[origMatName]);
      const key = `${mesh.material.uuid}_${castShadow ? 1 : 0}_${receiveShadow ? 1 : 0}`;
      let bucket = mergeBuckets.get(key);
      if (!bucket) {
        bucket = {
          material: mesh.material,
          castShadow,
          receiveShadow,
          usesColor,
          sources: [],
        };
        mergeBuckets.set(key, bucket);
      }
      if (usesColor) bucket.usesColor = true;
      bucket.sources.push({ mesh, origMatName });
    } else {
      if (!mesh.geometry.attributes.uv1) {
        const count = mesh.geometry.attributes.position.count;
        mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      keptMeshes++;
    }
  });

  const mergedGroup = new THREE.Group();
  mergedGroup.name = 'SD_Merged_Static';

  for (const bucket of mergeBuckets.values()) {
    if (bucket.sources.length <= 1) {
      for (const s of bucket.sources) {
        if (bucket.usesColor) {
          bakeVertexColorAndMeta(s.mesh.geometry, s.mesh.matrixWorld, s.origMatName);
        } else if (!s.mesh.geometry.attributes.uv1) {
          const count = s.mesh.geometry.attributes.position.count;
          s.mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        keptMeshes++;
      }
      continue;
    }

    const prepared: THREE.BufferGeometry[] = [];
    for (const { mesh: src, origMatName } of bucket.sources) {
      const g = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone();
      if (bucket.usesColor) {
        bakeVertexColorAndMeta(g, src.matrixWorld, origMatName);
      }
      g.applyMatrix4(src.matrixWorld);
      const count = g.attributes.position.count;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      if (!g.attributes.uv1) {
        g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      for (const attrName of Object.keys(g.attributes)) {
        const keep =
          attrName === 'position' ||
          attrName === 'normal' ||
          attrName === 'uv' ||
          attrName === 'uv1' ||
          (bucket.usesColor && attrName === 'color');
        if (!keep) g.deleteAttribute(attrName);
      }
      prepared.push(g);
    }

    let totalVerts = 0;
    for (const g of prepared) totalVerts += g.attributes.position.count;

    const posArr = new Float32Array(totalVerts * 3);
    const nrmArr = new Float32Array(totalVerts * 3);
    const uvArr = new Float32Array(totalVerts * 2);
    const uv1Arr = new Float32Array(totalVerts * 2);
    const colArr = bucket.usesColor ? new Float32Array(totalVerts * 3) : null;

    let off3 = 0;
    let off2 = 0;
    for (const g of prepared) {
      const p = g.attributes.position.array as Float32Array;
      const n = g.attributes.normal.array as Float32Array;
      const u0 = g.attributes.uv.array as Float32Array;
      const u1 = g.attributes.uv1.array as Float32Array;
      posArr.set(p, off3);
      nrmArr.set(n, off3);
      uvArr.set(u0, off2);
      uv1Arr.set(u1, off2);
      if (colArr && g.attributes.color) {
        colArr.set(g.attributes.color.array as Float32Array, off3);
      }
      off3 += p.length;
      off2 += u0.length;
      g.dispose();
    }

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    mergedGeo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3));
    mergedGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    mergedGeo.setAttribute('uv1', new THREE.BufferAttribute(uv1Arr, 2));
    if (colArr) mergedGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    mergedGeo.computeBoundingSphere();

    const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    mergedMesh.matrixAutoUpdate = false;
    mergedMesh.updateMatrix();
    mergedGroup.add(mergedMesh);
    keptMeshes++;

    for (const { mesh: src } of bucket.sources) {
      src.removeFromParent();
      src.geometry.dispose();
    }
  }

  root.add(mergedGroup);
  return { meshes: keptMeshes, instances, upgraded };
}

export function upgradeNightExtras(
  root: THREE.Object3D,
  controls: NightMaterialControls,
): void {
  const makeEyeMat = (
    texNode: ReturnType<typeof uniformTexture>,
    strength: number,
    alphaK: number,
    aspectY: number,
  ) => {
    const u = uv(0);
    const s = texture(texNode, u);
    const d = u.sub(vec2(0.5, 0.5)).mul(vec2(1.02, aspectY)).length();
    // Smooth radial vignette dissolves eye perimeter seamlessly into pitch-black room void
    const vig = smoothstep(float(0.48), float(0.21), d);
    const darkEye = pow(max(s.rgb, vec3(0.0)), vec3(1.28));

    const mat = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(0.004, 0.004, 0.008),
      roughness: 0.45,
      metalness: 0.0,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      alphaTest: 0.01,
    });
    mat.emissiveNode = darkEye.mul(strength).mul(vig);
    mat.opacityNode = s.a.mul(vig).mul(alphaK);
    return mat;
  };

  const voidMat = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0x010103),
    side: THREE.DoubleSide,
  });

  // Soft elliptical shadow pocket for foliage eye so no hard rectangular card ever shows
  const vegVoidMat = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0x020406),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const vd = uv(0).sub(vec2(0.5, 0.5)).mul(vec2(1.0, 1.25)).length();
  vegVoidMat.opacityNode = smoothstep(float(0.48), float(0.14), vd).mul(0.88);

  const winEyeMat = makeEyeMat(controls.winEyeTex, 0.65, 0.94, 1.38);
  const vegEyeMat = makeEyeMat(controls.vegEyeTex, 0.36, 0.88, 1.35);

  const webMat = new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color(0.78, 0.82, 0.88),
    roughness: 0.35,
    metalness: 0.0,
    emissive: new THREE.Color(0.55, 0.68, 0.9),
    emissiveIntensity: 0.06,
    opacity: 0.55,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = obj.name.includes('Cobweb');
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    const matName = (mesh.material as THREE.Material)?.name ?? '';
    if (obj.name.includes('Foliage_Void')) {
      mesh.material = vegVoidMat;
      mesh.receiveShadow = false;
      mesh.renderOrder = 0;
    } else if (obj.name.includes('Void') || matName === 'SD_N_Void_Black') {
      mesh.material = voidMat;
      mesh.receiveShadow = false;
      mesh.renderOrder = 0;
    } else if (obj.name.includes('Window') || matName === 'SD_N_Eye_Window') {
      mesh.material = winEyeMat;
      mesh.renderOrder = 1;
    } else if (obj.name.includes('Foliage') || matName === 'SD_N_Eye_Foliage') {
      mesh.material = vegEyeMat;
      mesh.renderOrder = 1;
    } else if (obj.name.includes('Cobweb') || matName === 'SD_N_Cobweb') {
      mesh.material = webMat;
      mesh.renderOrder = 1;
    }
  });
}
