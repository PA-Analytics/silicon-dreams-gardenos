import * as THREE from 'three/webgpu';
import { uniform, clamp, color, float, mix, positionLocal, sin, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { LightMeta, NightMeta, SceneMeta, ScreenBounds } from '../types.ts';
import { createCloudMaterial, createSkyDome, createTwilightEnvironment, createNightBackdrop, createNightEnvironment, createNightMist } from '../shaders/sky.ts';
import { createNightMaterialControls, createSiliconMaterialLibrary, upgradeNightExtras, upgradeSceneMaterials } from '../shaders/materials.ts';
import { createSceneLighting } from '../lighting.ts';
import { buildIslandCollider, DEFAULT_EXPLORE_SPAWN, findNearestPoi, ISLAND_POIS, type IslandCollider, type IslandPoi } from '../explore.ts';
import { getLang, tr } from './i18n.ts';
import { BODY, IslandPhysics } from './island-physics.ts';
import type { TSLNode } from "../shaders/noise.ts";
import type { ProjectDossier } from "./ingest.ts";
import { createIslandScreenRig, type ScreenApplyOpts } from "./crt-canvas.ts";
import { createDeskHologram } from "./hologram-desk.ts";
const DEFAULT_CRT_BOUNDS: ScreenBounds = { minX: -0.1544, maxX: 1.1744, minY: 0.52162, maxY: 1.54838 };
const DEFAULT_TV_BOUNDS: ScreenBounds = { minX: -1.12242, maxX: 0.12242, minY: 0.25495, maxY: 1.35505 };
const DAY_FOG = new THREE.Color(0x3270c4);
const NIGHT_FOG = new THREE.Color(0x0c162b);
/** Above this night mix the island counts as dark: the Seraph and the tunnel's Vera may show. */
const NIGHT_GATE = 0.35;
/** Vera stands 1.98 m in her file; the island is built 1.58× larger than the corridor she was met in. */
const VERA_SCALE = 1.52;
const SERAPH_SCALE = 3.6;
/** How far above its resting place the Seraph waits before it comes down. */
const SERAPH_DROP = 4;
// Fallbacks for the build as shipped, used only if the named meshes are missing from the model.
const FALLBACK_TUNNEL = new THREE.Box3(new THREE.Vector3(-1.18, -0.55, -6.45), new THREE.Vector3(1.2, 3.08, -1.0));
const FALLBACK_TOWER = new THREE.Box3(new THREE.Vector3(-3.67, -2.1, -13.0), new THREE.Vector3(3.89, 18.47, -0.87));

const smooth = (k: number): number => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };

function makeProjectScreenMaterial(
  tex: THREE.CanvasTexture,
  bounds: ScreenBounds,
  nightMix: TSLNode,
  scanCount: number,
): THREE.MeshStandardNodeMaterial {
  const w = Math.max(bounds.maxX - bounds.minX, 0.01);
  const h = Math.max(bounds.maxY - bounds.minY, 0.01);
  const u = clamp(positionLocal.x.sub(bounds.minX).div(w), 0.0, 1.0);
  const v = clamp(positionLocal.y.sub(bounds.minY).div(h), 0.0, 1.0);
  const img: TSLNode = texture(tex, vec2(u, v)).rgb;
  const scan: TSLNode = float(0.9).add(sin(v.mul(scanCount * Math.PI * 2)).mul(0.1));
  const dx = u.sub(0.5);
  const dy = v.sub(0.5);
  const vig: TSLNode = float(1.0).sub(clamp(dx.mul(dx).add(dy.mul(dy)).mul(1.25), 0.0, 0.42));
  const boost: TSLNode = mix(float(1.42), float(1.82), nightMix);

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.14, metalness: 0.0 });
  mat.colorNode = color(0x091216);
  mat.emissiveNode = img.mul(scan).mul(vig).mul(boost).add(vec3(0.012, 0.022, 0.026));
  return mat;
}

/** A presence that eases in and out; `update` is fed the 0/1 it should be heading for. */
interface Presence {
  root: THREE.Object3D;
  update(dt: number, timeMs: number, wanted: boolean): void;
}

/**
 * The Archive Seraph over the tower. It waits small and high, comes down to `rest` as night settles and goes
 * back up when day returns; its armillary, reel and dial keep turning slowly while it is out.
 */
function createSeraph(gltf: GLTF, rest: THREE.Vector3, reduceMotion: boolean): Presence {
  const root = new THREE.Group();
  root.name = 'GARDEN_ArchiveSeraph';
  root.add(gltf.scene);
  root.position.copy(rest).setY(rest.y + SERAPH_DROP);
  root.scale.setScalar(SERAPH_SCALE);
  root.visible = false;

  const glow: Array<{ mat: THREE.MeshStandardMaterial; base: number; gain: number }> = [];
  const seen = new Set<THREE.Material>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false; m.receiveShadow = false; // the key light's shadow map is static: nothing new may enter it
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      mat.flatShading = true;
      if (mat.name === 'GLB_MAT_oph_screen_eye') glow.push({ mat, base: mat.emissiveIntensity, gain: 1.7 });
      else if (mat.name === 'GLB_MAT_amber_light') glow.push({ mat, base: mat.emissiveIntensity, gain: 2.6 });
    }
  });

  // Only the parts exported as separate, safely pivoted nodes turn (same set as the archive viewer).
  const spinners: Array<{ node: THREE.Object3D; base: THREE.Quaternion; axis: THREE.Vector3; speed: number }> = [];
  const spin = (name: string, axis: THREE.Vector3, speed: number) => {
    const node = gltf.scene.getObjectByName(name);
    if (node) spinners.push({ node, base: node.quaternion.clone(), axis: axis.normalize(), speed });
  };
  spin('SERAPH_orbit_armillary', new THREE.Vector3(0.72, 0.31, 0.62), 0.11);
  spin('SERAPH_orbit_reel', new THREE.Vector3(0.1, 1.0, 0.28), -0.17);
  spin('SERAPH_dial_tabs', new THREE.Vector3(0, 0, 1), 0.06);
  const q = new THREE.Quaternion();
  let k = 0;
  let angle = 0;

  return {
    root,
    update(dt, timeMs, wanted) {
      const want = wanted ? 1 : 0;
      if (k !== want) {
        const next = reduceMotion ? want : k + (want - k) * Math.min(1, dt * 0.7);
        k = Math.abs(next - want) < 0.003 ? want : next;
      }
      root.visible = k > 0.004;
      if (!root.visible) return;
      const e = smooth(k);
      const t = timeMs / 1000;
      root.position.y = rest.y + SERAPH_DROP * (1 - e) + (reduceMotion ? 0 : Math.sin(t * 0.33) * 0.28 * e);
      root.scale.setScalar(SERAPH_SCALE * (0.5 + 0.5 * e)); // it arrives from far above, not out of thin air
      if (!reduceMotion) {
        angle += dt;
        root.rotation.y = Math.sin(t * 0.07) * 0.14;
        for (const s of spinners) s.node.quaternion.copy(s.base).multiply(q.setFromAxisAngle(s.axis, angle * s.speed));
      }
      for (const g of glow) g.mat.emissiveIntensity = g.base * (0.25 + e * g.gain * (reduceMotion ? 1 : 0.9 + 0.1 * Math.sin(t * 1.3)));
    },
  };
}

/**
 * Vera, waiting at the far end of the tower's open tunnel and facing its entrance (+Z).
 * No light may be added to the island after it is built, so she is read the other way round: an amber halo card
 * glows behind her at the bottom of the tunnel and her own line lamp is pushed well past its file value, leaving
 * a dark silhouette with one live point of light.
 */
function createTunnelVera(gltf: GLTF | null, tunnel: THREE.Box3, groundY: number, reduceMotion: boolean): Presence {
  const root = new THREE.Group();
  root.name = 'GARDEN_TunnelVera';
  root.visible = false;
  const cx = (tunnel.min.x + tunnel.max.x) / 2;
  const width = tunnel.max.x - tunnel.min.x;
  const height = Math.max(1, tunnel.max.y - groundY);

  const glowU: TSLNode = uniform(0);
  const haloMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const d: TSLNode = uv().sub(vec2(0.5, 0.58)).mul(vec2(1.0, 1.3)).length();
  const core: TSLNode = float(1.0).sub(smoothstep(0.04, 0.5, d));
  haloMat.colorNode = vec3(1.0, 0.5, 0.13).mul(core.mul(core)).mul(glowU);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.94, height * 0.96), haloMat);
  halo.position.set(cx, groundY + height * 0.48, tunnel.min.z + 0.5); // just in front of the tunnel's invisible back wall
  halo.renderOrder = 3;
  root.add(halo);

  let lamp: THREE.MeshStandardMaterial | null = null;
  let lampBase = 1;
  if (gltf) {
    const vera = new THREE.Group();
    vera.add(gltf.scene);
    vera.position.set(cx, groundY, tunnel.min.z + 1.3);
    vera.scale.setScalar(VERA_SCALE);
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false; m.receiveShadow = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.flatShading = true;
      if (mat.name === 'GLB_MAT_amber_light') { lamp = mat; lampBase = mat.emissiveIntensity; }
    });
    root.add(vera);
  }
  let k = 0;

  return {
    root,
    update(dt, timeMs, wanted) {
      const want = wanted ? 1 : 0;
      if (k !== want) {
        const next = reduceMotion ? want : k + (want - k) * Math.min(1, dt * 1.6);
        k = Math.abs(next - want) < 0.003 ? want : next;
      }
      root.visible = k > 0.004;
      if (!root.visible) return;
      const e = smooth(k);
      const t = timeMs / 1000;
      const breath = reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(t * 0.8);
      glowU.value = 0.85 * e * breath;
      // The "line in use" lamp: a slow, uneven pulse, as if the line were being held open.
      const pulse = reduceMotion ? 0.8 : 0.55 + 0.45 * Math.sin(t * 2.3) * Math.sin(t * 0.61 + 0.4);
      if (lamp) (lamp as THREE.MeshStandardMaterial).emissiveIntensity = lampBase * (1 + e * (2.4 + 1.6 * pulse));
    },
  };
}


/** Eye height above the island ground: the corridor's 1.58 m scaled to the island's larger build (see island-physics.ts). */
export const ISLAND_EYE = BODY.eye;
/** The tower's doorway stands open onto a dark tunnel, so its notes cannot say it is shut. */
const POIS: IslandPoi[] = ISLAND_POIS.map((p) => (p.id !== 'door' ? p : {
  ...p,
  label: 'Umbral de la Torre',
  lines: [
    'El umbral est\u00e1 abierto. La luz del d\u00eda no pasa del marco.',
    'El t\u00fanel se queda sin luz a los pocos pasos. Al fondo zumba algo el\u00e9ctrico.',
    'Alguien dej\u00f3 una luz encendida en los pisos altos.',
  ],
}));

export interface Island {
  scene: THREE.Scene;
  collider: IslandCollider;
  /** Gravity and 3D collision against the island's real meshes: what the walking visitor is moved by. */
  physics: IslandPhysics;
  /** Where the visitor lands after the corridor's last door, facing the tower. */
  spawn: { x: number; z: number; groundY: number; yaw: number; pitch: number };
  /** Exposure for GardenOS's Neutral tone mapping (updates smoothly between Day and Night). */
  readonly exposure: number;
  readonly isNight: boolean;
  poiAt(x: number, eyeY: number, z: number, yaw: number): IslandPoi | null;
  /**
   * Paints the visitor's real project material onto the island's PC monitor, its two desk holograms and the TV.
   * The former `(dossier, discoveredCrt, discoveredTv)` call is still accepted.
   */
  applyDossier(dossier: ProjectDossier, opts: ScreenApplyOpts | boolean, discoveredTv?: boolean): void;
  /** Smoothly (or instantly with reduced motion) transitions between luminous Day and starry Night. */
  setNight(night: boolean, instant?: boolean): void;
  /**
   * Opens or folds the holograms over the PC desk. `diverted` turns the right panel amber, repaints the screens
   * in their diverted state and sends the pulse from the desk to the TV.
   */
  setHologram(deployed: boolean, diverted: boolean, beamActive?: boolean): void;
  /**
   * Shows or hides Vera at the end of the tower's tunnel. Until this is called she simply follows the night.
   * `calm` (the `archive` verdict) puts out the watching eyes of the night dressing and leaves a quiet night;
   * it keeps its last value when omitted.
   */
  setTunnelVera(visible: boolean, calm?: boolean): void;
  /** Lets the Archive Seraph come down over the tower, or sends it away. It only ever shows at night. */
  setSeraph(visible: boolean): void;
  /** Steps Day ↔ Night, the desk holograms, the Seraph and Vera; returns the current tone-mapping exposure. */
  update(dt: number, timeMs?: number): number;
}

/**
 * The daytime island of index.html, assembled as a scene GardenOS can render through its own PS2 pipeline.
 * Same order as src/main.ts: the collider is indexed BEFORE upgradeSceneMaterials merges the static meshes.
 */
export async function loadIsland(renderer: THREE.WebGPURenderer, options: { reduceMotion?: boolean } = {}): Promise<Island> {
      const reduceMotion = options.reduceMotion
        ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
      const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
      const texLoader = new THREE.TextureLoader();
      // Night dressing and the two characters are optional: a missing file costs that piece, never the island.
      const optionalModel = (url: string): Promise<GLTF | null> => loader.loadAsync(url).catch(() => null);
      const screenTexture = (name: string): Promise<THREE.Texture | null> =>
        texLoader.loadAsync(`/screens/${name}.webp`).then((tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          tex.needsUpdate = true;
          return tex as THREE.Texture | null;
        }).catch(() => null);
      const [meta, main, clouds, nightMeta, extras, crtEye, crtSignal, tvEyes, vegEye, winEye, seraphGltf, veraGltf] = await Promise.all([
        fetch('/scene-meta.json').then((r) => r.json() as Promise<SceneMeta>),
        loader.loadAsync('/models/silicon-dreams-v1.glb'),
        loader.loadAsync('/models/clouds-v1.glb'),
        fetch('/night-meta.json').then((r) => r.json() as Promise<NightMeta>),
        optionalModel('/models/night-extras-v1.glb'),
        screenTexture('crt_eye'),
        screenTexture('crt_signal_overlay'),
        screenTexture('tv_multi_eyes'),
        screenTexture('veg_eye'),
        screenTexture('window_eye'),
        optionalModel('/models/characters/ArchiveSeraph.glb'),
        optionalModel('/models/characters/TelephoneOperator.glb'),
      ]);

      const scene = new THREE.Scene();
      const fog = new THREE.FogExp2(DAY_FOG.getHex(), 0.0012);
      scene.fog = fog;
      const controls = createNightMaterialControls();
      if (crtEye) controls.crtEyeTex.value = crtEye;
      if (crtSignal) controls.crtSignalTex.value = crtSignal;
      if (tvEyes) controls.tvEyesTex.value = tvEyes;
      if (vegEye) controls.vegEyeTex.value = vegEye;
      if (winEye) controls.winEyeTex.value = winEye;
      const dreamTear = uniform(0);
      const sky = createSkyDome(uniform(0.65), uniform(0.45), controls.nightMix, dreamTear);
      sky.matrixAutoUpdate = false; sky.updateMatrix();
      scene.add(sky);

      const dayEnv = createTwilightEnvironment(renderer);
      let nightEnv: THREE.Texture | null = null;
      scene.environment = dayEnv;
      scene.environmentIntensity = 0.72;

      const screenRig = createIslandScreenRig(reduceMotion);
      const collider = buildIslandCollider(main.scene);
      const physics = new IslandPhysics(main.scene); // like the collider: before the static meshes are merged
      // The tower's doorway is open: a dark tunnel that the model leaves uncapped over the hollow shell. Close its far end.
      const tunnel = main.scene.getObjectByName('V2_Entrance_Tunnel');
      let tunnelBox = FALLBACK_TUNNEL;
      if (tunnel) {
        const box = new THREE.Box3().setFromObject(tunnel);
        physics.addWall(box.min.x - 0.5, box.max.x + 0.5, box.min.y - 1, box.max.y + 1, box.min.z + 0.2);
        tunnelBox = box;
      }

      // Measured on the real meshes, like the collider, before upgradeSceneMaterials merges them away.
      main.scene.updateMatrixWorld(true);
      const boxOfMaterial = (name: string): THREE.Box3 | null => {
        const box = new THREE.Box3();
        main.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !Array.isArray(m.material) && m.material.name === name) box.expandByObject(m);
        });
        return box.isEmpty() ? null : box;
      };
      const crtGlass = boxOfMaterial('SD_Screen_CRT');
      const tvGlass = boxOfMaterial('SD_Screen_TV');
      const deskTop = main.scene.getObjectByName('PRP_Desk');
      const deskBox = deskTop ? new THREE.Box3().setFromObject(deskTop) : null;
      const towerShell = main.scene.getObjectByName('ENV_Tower_Shell');
      const towerBox = towerShell ? new THREE.Box3().setFromObject(towerShell) : FALLBACK_TOWER;

      const matLib = createSiliconMaterialLibrary(controls);
      // V1.2 centerpiece: project the visitor's actual project material onto the island's PC & TV screens.
      const bounds = nightMeta.screenBounds ?? {};
      matLib.set('SD_Screen_CRT', makeProjectScreenMaterial(screenRig.crtTexture, bounds.SD_Screen_CRT ?? bounds.CRT ?? DEFAULT_CRT_BOUNDS, controls.nightMix, 140));
      matLib.set('SD_Screen_TV', makeProjectScreenMaterial(screenRig.tvTexture, bounds.SD_Screen_TV ?? bounds.TV ?? DEFAULT_TV_BOUNDS, controls.nightMix, 110));
      upgradeSceneMaterials(main.scene, matLib);
      scene.add(main.scene);

      const sun = meta.lights.find((l) => l.name === 'LGT_Sun');
      const sunDir = sun ? new THREE.Vector3(...sun.direction).negate().normalize() : new THREE.Vector3(-0.6, 0.57, 0.56).normalize();
      const cloudMat = createCloudMaterial(sunDir, uniform(1.0), controls.nightMix);
      clouds.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = cloudMat; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2;
        m.matrixAutoUpdate = false; m.updateMatrix();
      });
      scene.add(clouds.scene);

      const nightBackdrop = createNightBackdrop();
      nightBackdrop.visible = false;
      scene.add(nightBackdrop);

      const nightMist = createNightMist(nightMeta.mist.position, nightMeta.mist.size);
      nightMist.visible = false;
      scene.add(nightMist);

      // Night dressing (the two watching eyes and the cobwebs): hidden by day, shown with the night.
      const nightExtras = extras ? extras.scene : null;
      const nightEyes: THREE.Object3D[] = [];
      if (nightExtras) {
        nightExtras.name = 'SD_Night_Extras';
        upgradeNightExtras(nightExtras, controls);
        nightExtras.traverse((o) => { if (o.name.startsWith('EYE_')) nightEyes.push(o); });
        nightExtras.visible = false;
        scene.add(nightExtras);
      }

      // Fixed 7-light rig shared with the standalone island: Day and Night only flip uniforms/intensities.
      // Nothing below adds a light: the holograms, Vera's halo and the Seraph's eye are unlit or emissive surfaces.
      const lighting = createSceneLighting(meta.lights, nightMeta.lights);
      lighting.setMode('day');
      scene.add(lighting.group);

      // The desk's holograms sit on the real glass of the monitor and the TV. night-meta's screen lights give the
      // facing (and the position, should the glass not be found in the model).
      const screenLight = (name: string): LightMeta | undefined => nightMeta.lights.find((l) => l.name === name);
      const anchorOf = (glass: THREE.Box3 | null, light: LightMeta | undefined, fallback: [number, number, number]) => {
        const yaw = light ? Math.atan2(light.direction[0], light.direction[2]) : undefined;
        if (glass) {
          const size = glass.getSize(new THREE.Vector3());
          // The glass is a thin sheet turned about Y, so its width is the diagonal of its footprint.
          return { pos: glass.getCenter(new THREE.Vector3()), yaw, width: Math.hypot(size.x, size.z), height: size.y };
        }
        return { pos: new THREE.Vector3(...(light?.position ?? fallback)), yaw, width: undefined, height: undefined };
      };
      const crtAnchor = anchorOf(crtGlass, screenLight('LGT_Screen_CRT'), [-7.93957, 2.67482, 1.19039]);
      const tvAnchor = anchorOf(tvGlass, screenLight('LGT_Screen_TV'), [6.01052, 1.74047, 0.08854]);
      const deskHologram = createDeskHologram(
        crtAnchor.pos, tvAnchor.pos,
        { crt: screenRig.crtTexture, left: screenRig.leftPanelTexture, right: screenRig.rightPanelTexture },
        reduceMotion,
        {
          crtYaw: crtAnchor.yaw, tvYaw: tvAnchor.yaw,
          screenWidth: crtAnchor.width, screenHeight: crtAnchor.height,
          tvWidth: tvAnchor.width, tvHeight: tvAnchor.height,
          deskTopY: deskBox ? deskBox.max.y : undefined,
        },
      );
      scene.add(deskHologram.group);

      // The Seraph hangs over the front of the tower's roof. Directly behind the tower it could never be seen:
      // from anywhere the visitor can stand, the 18 m shell covers everything behind it up to twice its height.
      const towerTop = towerBox.max.y;
      const seraph = seraphGltf
        ? createSeraph(seraphGltf, new THREE.Vector3((towerBox.min.x + towerBox.max.x) / 2, towerTop + 3.5, towerBox.max.z - 3.6), reduceMotion)
        : null;
      if (seraph) scene.add(seraph.root);

      // Vera stands on the tunnel's own floor, 1.3 m from its far end.
      const tunnelFloor = physics.groundBelow((tunnelBox.min.x + tunnelBox.max.x) / 2, tunnelBox.min.z + 1.3, tunnelBox.min.y + 1.2);
      const veraGround = tunnelFloor !== null && tunnelFloor > tunnelBox.min.y - 0.3 ? tunnelFloor : tunnelBox.min.y + 0.02;
      const vera = createTunnelVera(veraGltf, tunnelBox, veraGround, reduceMotion);
      scene.add(vera.root);

      let targetNight = false;
      let mixVal = 0;
      let appliedMode: 'day' | 'night' = 'day';
      let exposure = 1.0;
      let calmNight = false;
      let fogBoost = 0;
      /** null = follow the night; a boolean is what GardenOS asked for. */
      let veraWanted: boolean | null = null;
      let seraphAllowed = true;
      let lastDossier: ProjectDossier | null = null;
      let lastOpts: ScreenApplyOpts = { discoveredCrt: false, diverted: false, discoveredTv: false };

      const applyMix = (k: number) => {
        mixVal = k;
        controls.nightMix.value = k;
        fog.color.lerpColors(DAY_FOG, NIGHT_FOG, k);
        fog.density = THREE.MathUtils.lerp(0.0012 + fogBoost * 0.0008, 0.0076 + fogBoost * 0.0036, k);
        dreamTear.value = k * (calmNight ? 0.35 : 0.95);
        scene.environmentIntensity = THREE.MathUtils.lerp(0.72, 0.42, k);
        exposure = THREE.MathUtils.lerp(1.0, 1.12, k);
        const wantMode = k >= 0.45 ? 'night' : 'day';
        if (wantMode !== appliedMode) {
          appliedMode = wantMode;
          lighting.setMode(wantMode);
          if (wantMode === 'night') {
            nightEnv ??= createNightEnvironment(renderer);
            scene.environment = nightEnv;
            nightBackdrop.visible = true;
            nightMist.visible = true;
          } else {
            scene.environment = dayEnv;
            nightBackdrop.visible = false;
            nightMist.visible = false;
          }
          if (nightExtras) nightExtras.visible = wantMode === 'night';
        }
      };

      // Land at the end of the front path, far enough back that the first thing seen is the whole tower against the sky.
      const far = collider.isWalkable(0, 6.6);
      const s = far ? { ...DEFAULT_EXPLORE_SPAWN, z: 6.6, pitch: 0.2 } : DEFAULT_EXPLORE_SPAWN;
      const ground = far ?? collider.isWalkable(s.x, s.z) ?? collider.isWalkable(0, 5.8);
      const groundY = ground ? ground.y : -0.45;
      const at = collider.resolveObstacles(s.x, s.z, groundY);
      return {
        scene, collider, physics,
        spawn: { x: at.x, z: at.z, groundY, yaw: s.yaw, pitch: s.pitch },
        get exposure() { return exposure; },
        get isNight() { return targetNight; },
        poiAt: (x, eyeY, z, yaw) => {
          const hit = findNearestPoi(x, eyeY, z, yaw, POIS);
          if (!hit) return null;
          const lang = getLang();
          const labels: Record<string, [string, string]> = {
            door: ['Tower Threshold', 'Umbral de la Torre'],
            crt: ['Origin PC', 'PC del Inicio'],
            tv: ['TV & Boombox', 'Televisor y Boombox'],
            tree: ['Cliff Tree', 'Árbol del acantilado'],
            hydrangeas: ['Hydrangeas', 'Hortensias'],
            overlook: ['Overlook', 'Mirador frontal'],
          };
          const pair = labels[hit.id];
          return pair ? { ...hit, label: tr(pair[0], pair[1], lang) } : hit;
        },
        applyDossier(dossier, opts, discoveredTv) {
          lastDossier = dossier;
          const todoIdx = typeof opts === 'object' && opts !== null && 'activeTodoIndex' in opts ? Number((opts as { activeTodoIndex?: number }).activeTodoIndex ?? 0) : dossier.activeTodoIndex;
          lastOpts = typeof opts === 'boolean'
            ? { discoveredCrt: opts, diverted: deskHologram.diverted, discoveredTv: discoveredTv === true, activeTodoIndex: dossier.activeTodoIndex }
            : { discoveredCrt: opts.discoveredCrt === true, diverted: opts.diverted === true, discoveredTv: opts.discoveredTv === true, activeTodoIndex: todoIdx };
          fogBoost = Math.min(1, ((dossier.todos?.length ?? 0) * 0.14) + (dossier.knownTotalFiles > 500 ? 0.3 : 0.1));
          applyMix(mixVal);
          screenRig.applyDossier(dossier, lastOpts);
        },
        setNight(night, instant = false) {
          targetNight = night;
          if (instant) applyMix(night ? 1 : 0);
        },
        setHologram(deployed, diverted, beamActive = !lastOpts.discoveredTv) {
          deskHologram.setDeployed(deployed);
          deskHologram.setDiverted(diverted, beamActive);
          if (lastDossier && lastOpts.diverted !== diverted) {
            lastOpts = { ...lastOpts, diverted };
            screenRig.applyDossier(lastDossier, lastOpts);
          }
        },
        setTunnelVera(visible, calm) {
          veraWanted = visible;
          if (calm !== undefined && calm !== calmNight) {
            calmNight = calm;
            for (const eye of nightEyes) eye.visible = !calm;
          }
        },
        setSeraph(visible) {
          seraphAllowed = visible;
        },
        update(dt, timeMs = performance.now()) {
          const want = targetNight ? 1 : 0;
          if (Math.abs(mixVal - want) > 0.001) {
            const next = mixVal + (want - mixVal) * Math.min(1, dt * 1.8);
            applyMix(Math.abs(next - want) < 0.004 ? want : next);
          }
          const dark = mixVal > NIGHT_GATE;
          screenRig.update(timeMs);
          deskHologram.update(dt, timeMs);
          seraph?.update(dt, timeMs, seraphAllowed && dark);
          vera.update(dt, timeMs, veraWanted ?? dark);
          return exposure;
        },
      };
}
