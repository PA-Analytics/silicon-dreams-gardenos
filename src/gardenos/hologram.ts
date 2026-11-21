import * as THREE from 'three/webgpu';

export interface Hologram {
  group: THREE.Group;
  /** Meshes that count as "the PC" when clicked while the call-to-action is showing. */
  hitTargets: THREE.Object3D[];
  /** Advances the animation; returns true on the frame the arrow reaches its lowest point (for the "pi"). */
  update(timeMs: number, dt: number, show: boolean): boolean;
}

const CYCLE_MS = 1150;
const TEXT_W = 0.66;
const TEXT_H = TEXT_W / 4;
const ARROW_SCALE = 0.8;
const TIP_REST = 0.07; // lowest tip height above the monitor top: it never touches the casing
const TIP_TRAVEL = 0.04;
const TEXT_BOTTOM = 0.215;

function textTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d')!;
  const family = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Franklin Gothic Condensed", sans-serif';
  let size = 200;
  ctx.font = `900 ${size}px ${family}`;
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '8px';
  const label = 'CLICK THE PC';
  const w = ctx.measureText(label).width;
  size = Math.floor(size * Math.min(1, 940 / w));
  ctx.font = `900 ${size}px ${family}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff9a2e';
  ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 12;
  ctx.fillText(label, 512, 132); ctx.fillText(label, 512, 132);
  ctx.shadowBlur = 0;
  // Faint hologram scanlines, carved out of the glyphs only.
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.32)';
  for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 1024, 1.6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeArrow(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const bar = (w: number, h: number, x: number, y: number, rz: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mat);
    m.position.set(x, y, 0); m.rotation.z = rz; g.add(m);
  };
  // Tip at the local origin, pointing down: two stems and a chevron, as in the sketch.
  bar(0.013, 0.1, -0.02, 0.09, 0); bar(0.013, 0.1, 0.02, 0.09, 0);
  bar(0.013, 0.078, -0.0265, 0.0265, Math.PI / 4); bar(0.013, 0.078, 0.0265, 0.0265, -Math.PI / 4);
  g.scale.setScalar(ARROW_SCALE);
  return g;
}

/** World-anchored 3D call-to-action floating above the monitor. It never follows or faces the camera. */
export function createHologram(monitorTop: THREE.Vector3, reduceMotion: boolean): Hologram {
  const group = new THREE.Group();
  group.name = 'CTA_Hologram';
  group.position.copy(monitorTop);

  const orange = new THREE.Color('#ff9a2e');
  const textMat = new THREE.MeshBasicMaterial({ map: textTexture(), transparent: true, depthWrite: false, toneMapped: false });
  const text = new THREE.Mesh(new THREE.PlaneGeometry(TEXT_W, TEXT_H), textMat);
  text.position.y = TEXT_BOTTOM + TEXT_H / 2;
  group.add(text);

  const mats = [1, 0.34, 0.16].map((a) => {
    const m = new THREE.MeshBasicMaterial({ color: orange.clone().multiplyScalar(1.5), transparent: true, depthWrite: false, toneMapped: false });
    m.userData.base = a; return m;
  });
  const arrows = mats.map((m) => { const a = makeArrow(m); group.add(a); return a; });
  const hitTargets: THREE.Object3D[] = [text];
  arrows[0].traverse((o) => { if ((o as THREE.Mesh).isMesh) hitTargets.push(o); });

  let alpha = 0;
  let lastCycle = -1;
  group.visible = false;

  return {
    group,
    hitTargets,
    update(timeMs, dt, show) {
      alpha += ((show ? 1 : 0) - alpha) * Math.min(1, dt * 7);
      group.visible = alpha > 0.01;
      if (!group.visible) { lastCycle = -1; return false; }
      const s = timeMs / 1000;
      textMat.opacity = alpha;
      textMat.color.setScalar(1.45 + 0.1 * Math.sin(s * 2.1));
      text.position.y = TEXT_BOTTOM + TEXT_H / 2 + (reduceMotion ? 0 : Math.sin(s * 1.7) * 0.005);
      text.rotation.y = reduceMotion ? 0 : Math.sin(s * 0.7) * 0.03;
      arrows.forEach((a, i) => {
        const phase = reduceMotion ? 0.5 : (((timeMs - i * 85) / CYCLE_MS) % 1 + 1) % 1;
        a.position.y = TIP_REST + TIP_TRAVEL * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
        mats[i].opacity = alpha * (mats[i].userData.base as number);
      });
      // The arrow is lowest at phase 0.5, so the beep fires when that point is crossed.
      const cycle = Math.floor(timeMs / CYCLE_MS + 0.5);
      const started = cycle !== lastCycle;
      lastCycle = cycle;
      return started && !reduceMotion;
    },
  };
}
