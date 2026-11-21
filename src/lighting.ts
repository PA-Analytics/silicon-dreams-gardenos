import * as THREE from 'three/webgpu';
import type { CrtState, LightMeta, SceneMode, TvState } from './types.ts';

/** A fixed light list: Day and Night change uniforms on the same objects, never add another rig. */
export function createSceneLighting(day: LightMeta[], night: LightMeta[]) {
  const group = new THREE.Group();
  group.name = 'SD_Shared_Lighting';
  const find = (list: LightMeta[], name: string) => {
    const meta = list.find((light) => light.name === name);
    if (!meta) throw new Error(`Missing light metadata: ${name}`);
    return meta;
  };
  const colorOf = (meta: LightMeta) => new THREE.Color().setRGB(...meta.color, THREE.SRGBColorSpace);
  const key = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  const bounce = new THREE.HemisphereLight();
  const crt = new THREE.PointLight();
  const tv = new THREE.PointLight();
  key.name = 'SD_Key';
  fill.name = 'SD_Fill';
  bounce.name = 'SD_Underside_Bounce';
  crt.name = 'LGT_Screen_CRT';
  tv.name = 'LGT_Screen_TV';
  for (const light of [key, fill]) {
    light.target.position.set(0, 3, -2);
    light.target.updateMatrixWorld();
    group.add(light, light.target);
  }
  group.add(bounce, crt, tv);

  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 20, far: 115 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 2;
  key.shadow.autoUpdate = false;

  // The two amber windows have identical settings in both modes.
  for (const meta of day.filter((light) => light.type === 'POINT')) {
    const light = new THREE.PointLight(colorOf(meta), 42, 16, 1.8);
    light.name = meta.name;
    light.position.set(...meta.position);
    group.add(light);
  }

  const states = {
    day: {
      key: find(day, 'LGT_Sun'), fill: find(day, 'LGT_SkyFill'),
      crt: find(day, 'LGT_Screen_CRT'), tv: find(day, 'LGT_Screen_TV'),
    },
    night: {
      key: find(night, 'LGT_N_Moon_Key'), fill: find(night, 'LGT_N_Moon_Rim'),
      crt: find(night, 'LGT_Screen_CRT'), tv: find(night, 'LGT_Screen_TV'),
    },
  };
  let mode: SceneMode = 'day';
  let crtState: CrtState = 2;
  let tvState: TvState = 2;
  const updateScreens = () => {
    crt.intensity = mode === 'day' ? 6.2 : [0, 9, 5, 3.8][crtState];
    tv.intensity = mode === 'day' ? 6.2 : [0, 10, 4.5][tvState];
  };
  const setDirectional = (light: THREE.DirectionalLight, meta: LightMeta, intensity: number, distance: number) => {
    light.color.copy(colorOf(meta));
    light.intensity = intensity;
    light.position.set(...meta.direction).normalize().multiplyScalar(-distance);
  };
  const setScreen = (light: THREE.PointLight, meta: LightMeta, distance: number) => {
    light.color.copy(colorOf(meta));
    light.position.set(...meta.position).addScaledVector(new THREE.Vector3(...meta.direction), 0.45);
    light.distance = distance;
    light.decay = 1.8;
  };
  const setMode = (next: SceneMode) => {
    mode = next;
    const state = states[mode];
    const isNight = mode === 'night';
    setDirectional(key, state.key, isNight ? 1.05 : 2.85, 65);
    setDirectional(fill, state.fill, isNight ? 0.44 : 0.35, isNight ? 60 : 65);
    bounce.color.set(isNight ? 0x162442 : 0x7fa4d8);
    bounce.groundColor.set(isNight ? 0x3b5896 : 0x5c7da8);
    bounce.intensity = 0.48;
    setScreen(crt, state.crt, isNight ? 8.5 : 7.5);
    setScreen(tv, state.tv, isNight ? 8.5 : 7.5);
    updateScreens();
    key.shadow.needsUpdate = true;
  };
  setMode('day');
  return {
    group,
    key,
    setMode,
    setScreenStates(nextCrt: CrtState, nextTv: TvState) {
      crtState = nextCrt;
      tvState = nextTv;
      updateScreens();
    },
  };
}
