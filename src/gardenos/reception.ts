import * as THREE from 'three/webgpu';
import { abs, attribute, color, cos, dot, float, normalView, positionLocal, positionView, positionViewDirection, pow, sin, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { TSLNode } from '../shaders/noise.ts';
import { corridorMaterial } from './corridor-materials.ts';
import { receptionCues } from './story.ts';

interface CamMeta { position: [number, number, number]; quaternion: [number, number, number, number]; lensMm: number; sensorWidthMm: number }
interface LightMeta { name: string; type: string; position: [number, number, number]; color: [number, number, number]; energy: number }
interface DoorMeta { pivot: [number, number, number]; restRotY: number; openRotY: number }
interface ReceptionMeta {
  exposure: number;
  veraAnchor: { position: [number, number, number]; rotY: number };
  doors: Record<string, DoorMeta>;
  cameras: Record<string, CamMeta>;
  lights: LightMeta[];
}

export const RECEPTION_VIEWS: Array<[string, string]> = [
  ['CAM_RECEP_SPAWN', 'Entrada'], ['CAM_RECEP_PHONE_BACK', 'Tel\u00e9fono'], ['CAM_RECEP_VERA_104', 'Vera'], ['CAM_RECEP_STAIRS', 'Escaleras'], ['CAM_RECEP_VOID_DOOR', 'Puerta'],
];
/** Walkable box in three.js axes: the corridor is 2.4 m wide, runs from z=+0.6 to the last door at z=-23.4. */
export const WALK = { minX: -0.85, maxX: 0.85, minZ: -23.2, maxZ: 1.0 }; // invisible wall just behind the spawn, before the dark tail
/** Blender watts → three.js intensity. Higher than the room's 0.85: these walls now carry their real (dark) albedo. */
const LIGHT_GAIN = 1.5;
const HEMI = 0.6;
const LINE_1 = 'I\u2019m Vera, at Reception. Your project arrived before you did.';
const LINE_2 = 'The far door is yours. Open it whenever you are ready.';
/** Where the visitor stands and which way they face along the corridor (-1 = toward the final door). */
export interface Viewer { x: number; z: number; dirZ: number }

export interface Reception {
  scene: THREE.Scene;
  meta: ReceptionMeta;
  /** Restart the arrival sequence: silence, phone, door, Vera. 'demo' compresses it into ~14 s. */
  begin(pace?: 'demo' | 'full'): void;
  update(dt: number, timeMs: number, viewer: Viewer): void;
  /** Open the final door (the island reveal comes later). */
  openExit(): void;
  /** Show every hidden piece (Vera, her afterimages) so compileAsync builds their pipelines before the scare, not during it. */
  warm(on: boolean): void;
  setLine(cb: (text: string) => void): void;
  /** Customize Vera's three reception lines to reflect the visitor's actual ingested project. */
  setLines(lines: [string, string, string]): void;
  setRing(cb: () => void): void;
  setDoor(cb: () => void): void;
  /** Scare beats: lights die, Vera dashes in, she lands in the visitor's face. */
  setScare(cb: (beat: 'blackout' | 'dash' | 'hit') => void): void;
  /** Camera direction for main.ts: where to look, how hard (0..1), FOV punch (0..1), shake (0..1), post-fx scare (0..1). */
  readonly fx: { target: THREE.Vector3; focus: number; zoom: number; shake: number; scare: number };
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Deterministic tube flicker: hard on/off steps, never a per-frame random strobe. */
const flicker = (t: number) => { const s = Math.sin(t * 31) * Math.sin(t * 13.7 + 1.1) + Math.sin(t * 5.3) * 0.4; return s > 0.35 ? 0.12 : s > 0.1 ? 0.55 : 1; };

/** Soft additive cone of light hanging under a tube: fake volumetrics in the fog. */
function makeShaft(pos: [number, number, number], col: [number, number, number], gain: TSLNode): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.28, 1.15, 2.55, 20, 1, true);
  geo.translate(0, -1.275, 0);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const facing = abs(dot(normalView, positionViewDirection));
  const along = pow(uv().y, float(1.6)); // bright at the tube, gone at the floor
  const near = smoothstep(0.8, 4.5, positionView.z.negate()); // fade when the camera walks into the cone, so overlaps never blow out
  const k: TSLNode = along.mul(facing).mul(facing).mul(near).mul(gain).mul(0.055);
  mat.colorNode = color(new THREE.Color().setRGB(...col, THREE.LinearSRGBColorSpace)).mul(k);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1] - 0.06, pos[2]);
  m.renderOrder = 2; m.frustumCulled = false;
  return m;
}

export interface DustOptions { min: [number, number, number]; max: [number, number, number]; count: number; color: [number, number, number]; gain: TSLNode | number }
/** Dust hanging in the air of a box-shaped volume; one-pixel specks suit the low-res PS2 frame. */
export function makeDust({ min, max, count: N, color: tint, gain }: DustOptions): THREE.Points {
  const p = new Float32Array(N * 3); const s = new Float32Array(N);
  for (let i = 0; i < N; i++) { for (let a = 0; a < 3; a++) p[i * 3 + a] = min[a] + Math.random() * (max[a] - min[a]); s[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('seed', new THREE.BufferAttribute(s, 1));
  const mat = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const seed = attribute('seed', 'float');
  const t = time.mul(seed.mul(0.4).add(0.15));
  mat.positionNode = positionLocal.add(vec3(sin(t.add(seed.mul(40))).mul(0.07), sin(t.mul(0.7).add(seed.mul(17))).mul(0.12), cos(t.mul(0.9).add(seed.mul(29))).mul(0.07)));
  const twinkle = sin(time.mul(2.3).add(seed.mul(60))).mul(0.5).add(0.5);
  // Brighter toward the top of the volume, where the lamps are.
  mat.colorNode = vec3(...tint).mul(smoothstep(min[1], max[1], positionLocal.y).mul(0.7).add(0.15)).mul(twinkle.mul(0.6).add(0.4)).mul(gain);
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

export async function loadReception(): Promise<Reception> {
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const [meta, room, vera] = await Promise.all([
    fetch('/reception-meta.json').then((r) => r.json() as Promise<ReceptionMeta>),
    loader.loadAsync('/models/reception-v01.glb'),
    loader.loadAsync('/models/characters/TelephoneOperator.glb').catch(() => null),
  ]);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020403);
  scene.fog = new THREE.FogExp2(0x030605, 0.042); // the corridor dissolves into green-black, as in the brief
  scene.add(room.scene);
  room.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.flatShading = true;
    const procedural = corridorMaterial(mat.name);
    if (procedural) { m.material = procedural; mat.dispose(); }
  });

  const hemi = new THREE.HemisphereLight(0x25322f, 0x0a0806, HEMI);
  scene.add(hemi);
  const lamps: Record<string, THREE.PointLight> = {};
  const base: Record<string, number> = {};
  const lightGain = uniform(1); const flickGain = uniform(1);
  for (const l of meta.lights) {
    const c = new THREE.Color().setRGB(...l.color, THREE.LinearSRGBColorSpace);
    const intensity = (l.energy / (4 * Math.PI)) * LIGHT_GAIN;
    const p = new THREE.PointLight(c, intensity, 0, 2);
    p.name = l.name; p.position.set(...l.position);
    lamps[l.name] = p; base[l.name] = intensity;
    scene.add(p);
    if (l.name.startsWith('LGT_Fluor_')) scene.add(makeShaft(l.position, l.color, l.name.endsWith('_Flicker') ? flickGain : lightGain));
  }
  scene.add(makeDust({ min: [-1.1, 0.15, -23.5], max: [1.1, 2.65, 1], count: 900, color: [0.75, 0.82, 0.78], gain: lightGain.mul(0.42) }));

  const door = (name: string) => room.scene.getObjectByName(name) as THREE.Object3D | undefined;
  const alcove = door('SM_Door_Vera_104');
  const exit = door('SM_Door_Void_Exit');
  const veraRoot = new THREE.Group();
  veraRoot.rotation.order = 'YXZ'; // lean and head-tilt are applied after the yaw, around her own hips
  let headY = 1.55;
  /** The "line in use" lamp on her head: it pulses while she speaks. */
  let lineLamp: THREE.MeshStandardMaterial | null = null;
  // Afterimages: cold additive copies trailing her during the dash so the motion reads as one smear, not a teleport.
  const GHOSTS = [0.035, 0.07, 0.11];
  const ghosts: Array<{ root: THREE.Group; op: TSLNode }> = [];
  if (vera) {
    const box = new THREE.Box3().setFromObject(vera.scene);
    if (!box.isEmpty()) headY = box.min.y + (box.max.y - box.min.y) * 0.9;
    veraRoot.add(vera.scene);
    veraRoot.position.set(...meta.veraAnchor.position);
    veraRoot.rotation.y = meta.veraAnchor.rotY;
    vera.scene.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.flatShading = true; m.frustumCulled = false;
      if (mat.name === 'GLB_MAT_amber_light') lineLamp = mat;
    });
    veraRoot.visible = false;
    scene.add(veraRoot);
    for (let i = 0; i < GHOSTS.length; i++) {
      const op = uniform(0);
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      mat.colorNode = vec3(0.35, 0.62, 0.75).mul(op);
      const copy = cloneSkinned(vera.scene);
      copy.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = mat; m.frustumCulled = false; m.renderOrder = 3; } });
      const root = new THREE.Group(); root.rotation.order = 'YXZ'; root.add(copy); root.visible = false;
      scene.add(root);
      ghosts.push({ root, op });
    }
  }
  // A cold key light that only lives during the scare: it rides with Vera so her face reads in the dark.
  // What waits behind the last door: a card of open sky, far brighter than anything in the corridor, so it blooms as the door swings.
  const dayGlow = uniform(0);
  {
    const mat = new THREE.MeshBasicNodeMaterial({ fog: false });
    const k: TSLNode = dayGlow.mul(5);
    mat.colorNode = vec3(0.5, 0.74, 1.0).mul(uv().y.mul(0.5).add(0.75)).mul(k);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.26), mat);
    card.position.set(0, 1.13, -24.22);
    scene.add(card);
  }
  const exitCold = lamps.LGT_Fluor_Bay5_Exit ? lamps.LGT_Fluor_Bay5_Exit.color.clone() : new THREE.Color(0xc8e0ff);
  const exitDay = new THREE.Color(0xbfdcff);
  const faceLight = new THREE.PointLight(0xbfe8ff, 0, 3.2, 2);
  scene.add(faceLight);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fx = { target: new THREE.Vector3(), focus: 0, zoom: 0, shake: 0, scare: 0 };
  let onLine: (t: string) => void = () => {};
  let onRing: () => void = () => {};
  let onDoor: () => void = () => {};
  let onScare: (beat: 'blackout' | 'dash' | 'hit') => void = () => {};
    let doorFired = false; let veraPlaced = false; let line1 = false; let line2 = false; let line3 = false; let cleared = false;
    let lines: [string, string, string] = [LINE_1, LINE_2, 'Cross the far door or press Tab for the Direct Dossier.'];
    let seq = 0;
    let rings = 0;
    let doorOpen = 0; let doorTarget = 0; let exitTarget = 0; let exitOpen = 0;
    let dashFrom = 0; let dashTo = 0; let holdZ = 0; let restZ = 0; let dashSign = -1;
    let dashFired = false; let hitFired = false; let dim = 1; let lean = 0; let lastZ = 0;
    // Timeline (s): lights die; she starts sprinting in the dark, so when they stutter back she is already coming. Lands, holds, steps back.
    let BLACKOUT = 4.5; let RELIGHT = 4.95; let DASH = RELIGHT - 0.07; const DASH_LEN = 0.5; let HIT = DASH + DASH_LEN;
    let pace: 'demo' | 'full' = 'full';
    let T = receptionCues(lines, pace, reduceMotion);
    let RING_AT: number[] = [0.9, 2.4];
    let DOOR_AT = 3.7;
    let EXIT_HINT_AT = Infinity; let EXIT_HINT_TARGET = 0; let exitHintFired = false;
    /** Pace presets: 'demo' fits the whole arrival into ~14 s; 'full' keeps the atmospheric cadence. */
    const setTimeline = (next: 'demo' | 'full') => {
      pace = next;
      exitHintFired = false;
      // Vera's lines get the time they take to type: a long personalized line delays the next cue instead of being cut.
      T = receptionCues(lines, pace, reduceMotion);
      if (pace === 'demo') {
        BLACKOUT = 2.5; RELIGHT = 2.95; DASH = RELIGHT - 0.07; HIT = DASH + DASH_LEN;
        RING_AT = [0.5]; DOOR_AT = 1.8;
        EXIT_HINT_AT = 11.5; EXIT_HINT_TARGET = 0.35; // the last door cracks open: the blue sky invites the visitor to cross
      } else {
        BLACKOUT = 4.5; RELIGHT = 4.95; DASH = RELIGHT - 0.07; HIT = DASH + DASH_LEN;
        RING_AT = [0.9, 2.4]; DOOR_AT = 3.7;
        EXIT_HINT_AT = Infinity; EXIT_HINT_TARGET = 0;
      }
    };
  const hist: Array<{ t: number; x: number; z: number; yaw: number; lean: number }> = [];

  const placeGhosts = (show: number) => {
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      const want = seq - GHOSTS[i];
      let h = hist[hist.length - 1];
      for (let k = hist.length - 1; k >= 0; k--) { h = hist[k]; if (hist[k].t <= want) break; }
      g.root.visible = show > 0.01 && !!h;
      if (!g.root.visible) continue;
      g.root.position.set(h.x, 0, h.z); g.root.rotation.set(h.lean, h.yaw, 0);
      // Trails only exist while she moves: copies that have caught up with her fade out instead of glowing on top of her.
      const gap = Math.abs(h.z - veraRoot.position.z);
      g.op.value = show * (0.42 - i * 0.11) * Math.min(1, gap / 0.9);
    }
  };

  return {
    scene, meta, fx,
      setLine(cb) { onLine = cb; },
      setLines(next) { lines = [...next] as [string, string, string]; T = receptionCues(lines, pace, reduceMotion); },
      setRing(cb) { onRing = cb; },
    setDoor(cb) { onDoor = cb; },
    setScare(cb) { onScare = cb; },
    warm(on) {
      veraRoot.visible = on;
      for (const g of ghosts) { g.root.visible = on; g.op.value = 0; }
    },
    begin(pace: 'demo' | 'full' = 'full') {
      setTimeline(pace);
      seq = 0; rings = 0; doorOpen = 0; doorTarget = 0; exitOpen = 0; exitTarget = 0;
              doorFired = false; veraPlaced = false; line1 = line2 = line3 = cleared = false; dashFired = hitFired = false;
      dim = 1; lean = 0; hist.length = 0; fx.focus = fx.zoom = fx.shake = fx.scare = 0;
      veraRoot.visible = false; veraRoot.rotation.set(0, 0, 0); faceLight.intensity = 0;
      for (const g of ghosts) g.root.visible = false;
      onLine('');
    },
    openExit() { exitTarget = 1; },
    update(dt, timeMs, viewer) {
      seq += dt;
      if (rings < RING_AT.length && seq > RING_AT[rings]) { rings++; onRing(); }
      if (seq > DOOR_AT && !doorFired) { doorFired = true; doorTarget = 1; onDoor(); }
      if (seq > EXIT_HINT_AT && !exitHintFired) { exitHintFired = true; exitTarget = EXIT_HINT_TARGET; }
      if (seq > BLACKOUT && !veraPlaced) {
        veraPlaced = true;
        if (vera) {
          let sign = Math.abs(viewer.dirZ) < 0.2 ? -1 : Math.sign(viewer.dirZ);
          const room = (s: number) => (s < 0 ? viewer.z - WALK.minZ : WALK.maxZ + 4 - viewer.z);
          if (room(sign) < 4) sign = -sign; // no room ahead: she comes from behind and the camera whips round
          dashSign = sign;
          dashFrom = THREE.MathUtils.clamp(viewer.z + sign * 8.5, -23, 5);
          dashTo = viewer.z + sign * 1.05; // her face stops just short of the lens, never inside it
          holdZ = viewer.z + sign * 1.35;
          restZ = THREE.MathUtils.clamp(viewer.z + sign * 2.6, -22.5, 5);
          veraRoot.position.set(viewer.x * 0.4, 0, reduceMotion ? restZ : dashFrom);
          lastZ = veraRoot.position.z;
          veraRoot.visible = true;
          if (!reduceMotion) onScare('blackout');
        }
      }
      let ghostShow = 0;
      if (veraPlaced && vera) {
        let z = veraRoot.position.z; let tilt = 0;
        // Lights: dead, then one hard stutter back on. She never stands and waits: the first lit frame already has her mid-sprint.
        if (!reduceMotion) dim = seq < RELIGHT ? Math.max(0.02, 1 - (seq - BLACKOUT) / 0.06) : seq < RELIGHT + 0.16 ? flicker(seq - RELIGHT) : 1;
        if (reduceMotion) { dim = 1; z = restZ; }
        else if (seq < DASH) z = dashFrom;
        else if (seq < HIT) {
          if (!dashFired) { dashFired = true; onScare('dash'); }
          const k = (seq - DASH) / DASH_LEN;
          // Quick wind-up, near-constant top speed, hard brake in the last fifth: reads as a sprint, not a slide.
          const e = k < 0.15 ? 0.5 * (k / 0.15) ** 2 * 0.15 : k < 0.8 ? 0.075 + (k - 0.15) * 1.15 : 0.8225 + (1 - (1 - (k - 0.8) / 0.2) ** 2) * 0.1775;
          z = THREE.MathUtils.lerp(dashFrom, dashTo, Math.min(1, e));
          ghostShow = 1;
        } else {
          if (!hitFired) { hitFired = true; onScare('hit'); fx.shake = 1; fx.scare = 1; }
          const h = seq - HIT;
          // Damped spring from the overshoot back to arm's length, then a slow, polite step back.
          const spring = holdZ + (dashTo - holdZ) * Math.exp(-h * 5.5) * Math.cos(h * 10);
          z = THREE.MathUtils.lerp(spring, restZ, smooth(1.3, 3.0, h));
          tilt = Math.sin(seq * 9.1) * Math.sin(seq * 3.3 + 0.7) * 0.14 * (1 - smooth(0.6, 1.6, h)); // the head lolls: she is not quite right
          dim = h < 0.35 ? flicker(h + 3.1) * 0.5 + 0.5 : 1;
          tilt += Math.sin(seq * 0.9) * 0.012 * smooth(2.4, 3.6, h); // once settled she sways, barely: a person, not a prop
          ghostShow = Math.max(0, 1 - h / 0.22);
        }
        if (lineLamp) lineLamp.emissiveIntensity = line1 && !cleared ? 1.6 + Math.sin(seq * 11) * 1.1 : 1;
        const vel = ((z - lastZ) / Math.max(dt, 1e-4)) * -dashSign; lastZ = z;
        // Lean follows speed through a quick low-pass, so it builds and relaxes instead of snapping.
        lean += (THREE.MathUtils.clamp(vel / 40, -0.12, 0.24) - lean) * Math.min(1, dt * 14);
        veraRoot.position.z = z;
        const yaw = Math.atan2(viewer.x - veraRoot.position.x, viewer.z - veraRoot.position.z); // the model faces +Z at rotY 0
        veraRoot.rotation.set(lean, yaw, tilt);
        hist.push({ t: seq, x: veraRoot.position.x, z, yaw, lean });
        while (hist.length > 2 && hist[0].t < seq - 0.3) hist.shift();
        // Head position follows lean (forward) and loll (sideways), so the camera frames her face, not where it was.
        const fwd = Math.sin(lean) * headY; const side = -Math.sin(tilt) * headY;
        fx.target.set(
          veraRoot.position.x + Math.sin(yaw) * fwd + Math.cos(yaw) * side,
          Math.cos(lean) * Math.cos(tilt) * headY,
          veraRoot.position.z + Math.cos(yaw) * fwd - Math.sin(yaw) * side,
        );
        const since = seq - BLACKOUT;
        fx.focus = since < 5 ? 1 : Math.max(0, 1 - (since - 5) / 1.5);
        fx.zoom = reduceMotion ? fx.focus * 0.25
          : seq < HIT ? smooth(DASH, HIT, seq) * 0.15
          : 0.15 + Math.exp(-(seq - HIT) * 4) * 0.2 - smooth(HIT + 1.3, HIT + 3, seq) * 0.15;
        const fl = reduceMotion ? 0 : seq < RELIGHT ? 0 : 1 - smooth(HIT + 1.0, HIT + 2.8, seq);
        faceLight.position.set(fx.target.x + Math.sin(yaw) * 0.6, fx.target.y - 0.55, fx.target.z + Math.cos(yaw) * 0.6);
        faceLight.intensity = fl * 1.2 * dim;
      }
      placeGhosts(reduceMotion ? 0 : ghostShow);
      fx.shake *= Math.exp(-dt * 3.5); fx.scare *= Math.exp(-dt * 2.4);
        if (seq > T.l1 && !line1) { line1 = true; onLine(lines[0]); }
        if (seq > T.l2 && !line2) { line2 = true; onLine(lines[1]); }
        if (seq > T.l3 && !line3) { line3 = true; onLine(lines[2]); }
        if (seq > T.clr && !cleared) { cleared = true; onLine(''); }
      doorOpen += (doorTarget - doorOpen) * Math.min(1, dt * 1.6);
      exitOpen += (exitTarget - exitOpen) * Math.min(1, dt * 1.2);
      if (alcove) alcove.rotation.y = THREE.MathUtils.lerp(meta.doors.SM_Door_Vera_104.restRotY, meta.doors.SM_Door_Vera_104.openRotY, doorOpen);
      if (exit) exit.rotation.y = THREE.MathUtils.lerp(meta.doors.SM_Door_Void_Exit.restRotY, meta.doors.SM_Door_Void_Exit.openRotY, exitOpen);
      for (const k in lamps) lamps[k].intensity = base[k] * dim;
      // Daylight from beyond the last door pours into the end of the corridor as it swings open.
      const out = lamps.LGT_Fluor_Bay5_Exit;
      dayGlow.value = exitOpen;
      if (out) { out.intensity = base.LGT_Fluor_Bay5_Exit * (dim + exitOpen * 5); out.color.lerpColors(exitCold, exitDay, exitOpen); }
      hemi.intensity = HEMI * Math.max(dim, 0.15);
      lightGain.value = dim;
      // The tired tube near the end of the corridor stutters.
      const f = lamps.LGT_Fluor_Bay4_Flicker;
      const fs = Math.sin(timeMs * 0.021) * Math.sin(timeMs * 0.0071 + 1.3);
      const fk = fs > 0.55 ? 0.15 : fs > 0.2 ? 0.7 : 1;
      if (f) f.intensity = base.LGT_Fluor_Bay4_Flicker * dim * fk;
      flickGain.value = dim * fk;
    },
  };
}
