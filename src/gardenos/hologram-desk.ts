import * as THREE from 'three/webgpu';
import { abs, float, fract, max, mix, pow, sin, smoothstep, step, texture, uniform, uv, vec3 } from 'three/tsl';
import type { TSLNode } from '../shaders/noise.ts';

export interface DeskHologramTextures {
  crt: THREE.CanvasTexture;
  left: THREE.CanvasTexture;
  right: THREE.CanvasTexture;
}

export interface DeskHologramOptions {
  crtYaw?: number;
  tvYaw?: number;
  screenWidth?: number;
  screenHeight?: number;
  tvWidth?: number;
  tvHeight?: number;
  deskTopY?: number;
}

export interface DeskHologram {
  group: THREE.Group;
  readonly deployed: boolean;
  readonly diverted: boolean;
  setDeployed(on: boolean): void;
  /** beamActive controls whether the amber arc to the TV stays visible (turns off once TV is activated). */
  setDiverted(on: boolean, beamActive?: boolean): void;
  update(dt: number, timeMs: number): void;
  dispose(): void;
}

const PANEL_YAW = THREE.MathUtils.degToRad(22);
const PANEL_LEAN = 0.14;
const smooth = (k: number): number => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };

export function createDeskHologram(
  crtPos: THREE.Vector3,
  tvPos: THREE.Vector3,
  textures: DeskHologramTextures,
  reduceMotion: boolean,
  options: DeskHologramOptions = {},
): DeskHologram {
  const crtYaw = options.crtYaw ?? 0.3316;
  const tvYaw = options.tvYaw ?? -0.1571;
  const screenW = options.screenWidth ?? 1.36;
  const screenH = options.screenHeight ?? 1.03;
  const tvW = options.tvWidth ?? 1.27;
  const tvH = options.tvHeight ?? 1.1;
  const deskTopY = options.deskTopY ?? crtPos.y - 1.385;

  const root = new THREE.Group();
  root.name = 'GARDEN_DeskHologram';
  root.visible = false;

  const timeU: TSLNode = uniform(0);
  const divertU: TSLNode = uniform(0);
  const pulseU: TSLNode = uniform(1);
  const reachU: TSLNode = uniform(0);
  const beamU: TSLNode = uniform(0);

  const cyanC = new THREE.Color('#5fe6ff');
  const amberC = new THREE.Color('#f2a84b');
  const cyan: TSLNode = vec3(cyanC.r, cyanC.g, cyanC.b);
  const amber: TSLNode = vec3(amberC.r, amberC.g, amberC.b).mul(1.2);
  const amberPulse: TSLNode = amber.mul(pulseU);
  const rightTint: TSLNode = mix(cyan, amberPulse, divertU);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const additive = (): THREE.MeshBasicNodeMaterial => {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    materials.push(mat);
    return mat;
  };

  interface PanelSpec {
    w: number; h: number;
    map: THREE.Texture | null;
    texGain: number;
    lines: number;
    glass: number;
    backing: number;
    frame: 'full' | 'brackets';
    phase: number;
    tint: TSLNode;
    wire: boolean;
    fanDrop: number;
    fanX: number;
  }
  interface Panel { anchor: THREE.Group; pivot: THREE.Group; open: TSLNode; restY: number; phase: number }

  const makePanel = (spec: PanelSpec): Panel => {
    const open: TSLNode = uniform(0);
    const anchor = new THREE.Group();
    anchor.rotation.order = 'YXZ';
    const pivot = new THREE.Group();
    anchor.add(pivot);

    const geo = new THREE.PlaneGeometry(spec.w, spec.h);
    geo.translate(0, spec.h / 2, 0);
    geometries.push(geo);

    const aspect = spec.w / spec.h;
    const u: TSLNode = uv();
    const ax: TSLNode = abs(u.x.sub(0.5));
    const ay: TSLNode = abs(u.y.sub(0.5));
    const tx = 0.008; const ty = tx * aspect;
    const corner = 0.11;
    const border: TSLNode = max(step(float(0.5 - tx), ax), step(float(0.5 - ty), ay));
    const inCorner: TSLNode = step(float(0.5 - corner), ax).mul(step(float(0.5 - corner * aspect), ay));
    const bracket: TSLNode = max(step(float(0.5 - tx * 2.3), ax), step(float(0.5 - ty * 2.3), ay)).mul(inCorner);
    const frame: TSLNode = spec.frame === 'brackets' ? bracket : max(border.mul(0.45), bracket);
    const fine: TSLNode = sin(u.y.mul(spec.lines * Math.PI * 2)).mul(0.5).add(0.5);
    const sweepY: TSLNode = float(1).sub(fract(timeU.mul(0.15).add(spec.phase)));
    const sweep: TSLNode = float(1).sub(smoothstep(0.0, 0.05, abs(u.y.sub(sweepY))));
    const flicker: TSLNode = float(0.97).add(sin(timeU.mul(29).add(spec.phase * 19)).mul(0.02));
    const image: TSLNode = spec.map ? texture(spec.map, u).rgb.mul(spec.texGain).mul(float(0.92).add(fine.mul(0.08))) : vec3(0, 0, 0);
    const glow: TSLNode = spec.tint.mul(frame.mul(1.15).add(sweep.mul(0.08)).add(fine.mul(spec.glass)));

    const mat = additive();
    mat.colorNode = image.add(glow).mul(flicker).mul(open);
    const pane = new THREE.Mesh(geo, mat);
    pane.renderOrder = 11;
    pane.frustumCulled = false;
    pivot.add(pane);

    if (spec.backing > 0) {
      const back = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
      back.colorNode = vec3(0.012, 0.028, 0.036);
      back.opacityNode = open.mul(spec.backing);
      materials.push(back);
      const plate = new THREE.Mesh(geo, back);
      plate.position.z = -0.005;
      plate.renderOrder = 10;
      plate.frustumCulled = false;
      pivot.add(plate);
    }

    if (spec.fanDrop > 0) {
      // Smooth translucent projector sheet without coarse diagonal stripes, anchored neatly to the desk.
      const fan = new THREE.BufferGeometry();
      fan.setAttribute('position', new THREE.Float32BufferAttribute([
        spec.fanX - 0.14, -spec.fanDrop, -0.1, spec.fanX + 0.14, -spec.fanDrop, -0.1,
        spec.w * 0.46, 0, 0, -spec.w * 0.46, 0, 0,
      ], 3));
      fan.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      fan.setIndex([0, 1, 2, 0, 2, 3]);
      geometries.push(fan);
      const fu: TSLNode = uv();
      const edgeFade: TSLNode = smoothstep(0.0, 0.18, fu.x).mul(smoothstep(1.0, 0.82, fu.x));
      const fall: TSLNode = pow(float(1).sub(fu.y), 2.2).mul(0.24).add(0.02);
      const fanMat = additive();
      fanMat.colorNode = spec.tint.mul(fall).mul(edgeFade).mul(open);
      const throwMesh = new THREE.Mesh(fan, fanMat);
      throwMesh.renderOrder = 9;
      throwMesh.frustumCulled = false;
      anchor.add(throwMesh);
    }
    return { anchor, pivot, open, restY: 0, phase: spec.phase };
  };

  // Desk rig: clean corner brackets outside the monitor bezel (no overlapping ghost title over the real CRT glass).
  const desk = new THREE.Group();
  desk.position.copy(crtPos);
  desk.rotation.y = crtYaw;
  root.add(desk);

  const centerW = screenW * 1.05; const centerH = screenH * 1.06;
  const center = makePanel({
    w: centerW, h: centerH, map: null, texGain: 0, lines: 80, glass: 0.0, backing: 0,
    frame: 'brackets', phase: 0.0, tint: cyan, wire: false, fanDrop: 0, fanX: 0,
  });
  center.restY = -centerH / 2;
  center.anchor.position.set(0, center.restY, 0.08);
  desk.add(center.anchor);

  const sideW = 1.24; const sideH = sideW * 0.75;
  const sideBottom = -screenH / 2 - 0.08;
  const sideX = screenW / 2 + 0.34 + (sideW / 2) * Math.cos(PANEL_YAW);
  const fanDrop = Math.max(0.18, crtPos.y + sideBottom - deskTopY);
  const leftPanel = makePanel({
    w: sideW, h: sideH, map: textures.left, texGain: 0.96, lines: 96, glass: 0.012, backing: 0.88,
    frame: 'full', phase: 0.37, tint: cyan, wire: false, fanDrop, fanX: 0.28,
  });
  leftPanel.restY = sideBottom;
  leftPanel.anchor.position.set(-sideX, sideBottom, 0.28);
  leftPanel.anchor.rotation.set(PANEL_LEAN, PANEL_YAW, 0);
  desk.add(leftPanel.anchor);

  const rightPanel = makePanel({
    w: sideW, h: sideH, map: textures.right, texGain: 0.96, lines: 96, glass: 0.012, backing: 0.88,
    frame: 'full', phase: 0.71, tint: rightTint, wire: false, fanDrop, fanX: -0.28,
  });
  rightPanel.restY = sideBottom;
  rightPanel.anchor.position.set(sideX, sideBottom, 0.28);
  rightPanel.anchor.rotation.set(PANEL_LEAN, -PANEL_YAW, 0);
  desk.add(rightPanel.anchor);

  // TV brackets: tight to the actual TV glass (never overhanging onto the black bezel).
  const tvFwd = new THREE.Vector3(Math.sin(tvYaw), 0, Math.cos(tvYaw));
  const tvRight = new THREE.Vector3(Math.cos(tvYaw), 0, -Math.sin(tvYaw));
  const tvFrameH = tvH * 0.96;
  const tvFrame = makePanel({
    w: tvW * 0.96, h: tvFrameH, map: null, texGain: 0, lines: 80, glass: 0.0, backing: 0,
    frame: 'brackets', phase: 0.55, tint: amberPulse, wire: false, fanDrop: 0, fanX: 0,
  });
  tvFrame.restY = tvPos.y - tvFrameH / 2;
  tvFrame.anchor.position.copy(tvPos).addScaledVector(tvFwd, 0.06);
  tvFrame.anchor.position.y = tvFrame.restY;
  tvFrame.anchor.rotation.y = tvYaw;
  root.add(tvFrame.anchor);

  // Diversion arc lands on the TV's upper-right antenna/bezel edge (never across the middle of the glass text).
  root.updateMatrixWorld(true);
  const beamStart = rightPanel.anchor.localToWorld(new THREE.Vector3(0, sideH * 0.5, 0.02));
  const beamEnd = tvPos.clone().addScaledVector(tvFwd, 0.05).addScaledVector(tvRight, tvW * 0.44);
  beamEnd.y = tvPos.y + tvH * 0.46;
  const points = [beamStart];
  for (const t of [0.2, 0.4, 0.6, 0.8]) {
    const p = beamStart.clone().lerp(beamEnd, t);
    const arch = Math.sin(Math.PI * t);
    p.z += 2.3 * arch;
    p.y += 1.25 * arch;
    points.push(p);
  }
  points.push(beamEnd);
  const beamGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), 120, 0.028, 6, false);
  geometries.push(beamGeo);
  const bu: TSLNode = uv().x;
  const comet: TSLNode = pow(fract(bu.mul(3.0).sub(timeU.mul(0.8))), 7.0);
  const drawn: TSLNode = float(1).sub(step(reachU, bu));
  const lead: TSLNode = smoothstep(reachU.sub(0.07), reachU, bu);
  const tips: TSLNode = smoothstep(0.0, 0.03, bu).mul(float(1).sub(smoothstep(0.985, 1.0, bu)));
  const beamMat = additive();
  beamMat.colorNode = amber.mul(float(0.1).add(comet.mul(1.5)).add(lead.mul(2.0))).mul(drawn).mul(tips).mul(beamU);
  const pulseBeam = new THREE.Mesh(beamGeo, beamMat);
  pulseBeam.name = 'GARDEN_PulseBeam';
  pulseBeam.renderOrder = 12;
  pulseBeam.frustumCulled = false;
  root.add(pulseBeam);

  let deployed = false;
  let diverted = false;
  let beamAllowed = true;
  let deployK = 0;
  let divertK = 0;
  let beamK = 0;
  let reach = 0;

  const setPanel = (panel: Panel, k: number, t: number) => {
    const e = smooth(k);
    panel.open.value = e;
    panel.pivot.scale.y = Math.max(e, 0.0001);
    panel.anchor.visible = e > 0.001;
    panel.anchor.position.y = panel.restY + (reduceMotion ? 0 : Math.sin(t * 0.9 + panel.phase * 6.283) * 0.009 * e);
  };

  return {
    group: root,
    get deployed() { return deployed; },
    get diverted() { return diverted; },
    setDeployed(on) { deployed = on; },
    setDiverted(on, beamActive = true) { diverted = on; beamAllowed = on && beamActive; },
    update(dt, timeMs) {
      const stepDt = Math.min(Math.max(dt, 0), 0.1);
      const approach = (cur: number, target: number, rate: number): number => {
        if (reduceMotion) return target;
        const next = cur + (target - cur) * Math.min(1, stepDt * rate);
        return Math.abs(next - target) < 0.002 ? target : next;
      };
      deployK = approach(deployK, deployed ? 1 : 0, 3.4);
      divertK = approach(divertK, diverted ? 1 : 0, 3.0);
      beamK = approach(beamK, beamAllowed ? 1 : 0, 3.6);
      if (diverted) reach = reduceMotion ? 1 : Math.min(1, reach + stepDt / 1.6);
      else if (divertK === 0) reach = 0;

      root.visible = deployK > 0 || divertK > 0;
      if (!root.visible) return;

      const t = (timeMs / 1000) % 3600;
      if (!reduceMotion) timeU.value = t;
      divertU.value = divertK;
      pulseU.value = reduceMotion ? 1 : 0.85 + 0.25 * Math.sin(t * 4.8) * divertK;
      reachU.value = reach;
      beamU.value = beamK;
      pulseBeam.visible = beamK > 0.004;

      setPanel(center, deployK / 0.72, t);
      setPanel(leftPanel, (deployK - 0.12) / 0.74, t);
      setPanel(rightPanel, (deployK - 0.24) / 0.76, t);
      setPanel(tvFrame, ((reach - 0.82) / 0.18) * beamK, t);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}