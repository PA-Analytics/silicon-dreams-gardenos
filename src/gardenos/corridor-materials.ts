import * as THREE from 'three/webgpu';
import { abs, float, floor, fract, min, mix, mod, positionLocal, positionView, positionWorld, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { getSharedNoiseTexture, type TSLNode } from '../shaders/noise.ts';

/**
 * The corridor GLB ships flat white for every material that was procedural in Blender
 * (build_reception_v01.py). These rebuild them from the same base colours with one shared
 * noise LUT: tiled linoleum, stained plaster, institutional-green wainscot, pinholed ceiling tile.
 */
type V3 = [number, number, number];
interface Recipe { color: TSLNode; roughness: TSLNode | number; metalness?: number }

const wp: TSLNode = positionWorld;
const lp: TSLNode = positionLocal;
/** Runs along any wall: every wall plane holds one of x/z constant, so their sum is a continuous coordinate. */
const wallU: TSLNode = wp.x.add(wp.z);
const dist: TSLNode = positionView.z.negate();
const lum = (uv: TSLNode): TSLNode => (texture(getSharedNoiseTexture(), uv) as TSLNode).r;
const grain = (uv: TSLNode): TSLNode => (texture(getSharedNoiseTexture(), uv) as TSLNode).g;
const one = float(1) as TSLNode;

function linoleum(): Recipe {
  const p: TSLNode = wp.xz.add(0.2).div(0.4); // half-tile offset: no seam runs down the exact middle of the corridor
  const f: TSLNode = fract(p);
  const edge: TSLNode = min(min(f.x, one.sub(f.x)), min(f.y, one.sub(f.y)));
  const near: TSLNode = smoothstep(16, 5, dist); // seams dissolve with distance instead of shimmering at low res
  const seam: TSLNode = mix(one, smoothstep(0.0, 0.04, edge), near.mul(0.6));
  const check: TSLNode = mod(floor(p.x).add(floor(p.y)), 2);
  const mottle = lum(wp.xz.mul(0.9));
  const fine = grain(wp.xz.mul(5.3));
  // The middle of the corridor is walked dull and pale; the edges keep their wax and their dirt.
  const lane: TSLNode = smoothstep(0.8, 0.1, abs(wp.x)).mul(smoothstep(0.3, 0.7, lum(wp.xz.mul(vec2(0.6, 0.12)).add(0.31))));
  const skirt: TSLNode = smoothstep(0.8, 1.18, abs(wp.x)).mul(one.sub(smoothstep(1.2, 1.3, abs(wp.x))));
  let c: TSLNode = mix(vec3(0.2, 0.19, 0.16), vec3(0.105, 0.13, 0.112), check.mul(0.85));
  c = c.mul(mix(0.66, 1.0, mottle)).mul(mix(0.9, 1.06, fine));
  c = mix(c, c.mul(1.28).add(0.012), lane.mul(0.5));
  c = c.mul(seam).mul(one.sub(skirt.mul(0.5)));
  const roughness: TSLNode = mix(0.2, 0.46, mottle).add(lane.mul(0.24)).add(one.sub(seam).mul(0.4));
  return { color: c, roughness };
}

function plaster(base: V3): Recipe {
  const u: TSLNode = vec2(wallU, wp.y);
  const blot = lum(u.mul(0.35));
  const fine = grain(u.mul(3.1));
  const grime: TSLNode = mix(0.6, 1.0, smoothstep(0.05, 0.95, wp.y)).mul(mix(1.0, 0.72, smoothstep(2.2, 2.72, wp.y)));
  // Brown water streaks bleeding down from the ceiling line.
  const drip: TSLNode = smoothstep(0.58, 0.76, lum(vec2(wallU.mul(1.7), wp.y.mul(0.07)).add(0.53))).mul(smoothstep(1.1, 2.6, wp.y));
  let c: TSLNode = vec3(...base).mul(mix(0.76, 1.0, blot)).mul(mix(0.94, 1.05, fine)).mul(grime);
  c = mix(c, c.mul(vec3(0.6, 0.52, 0.36)), drip.mul(0.6));
  return { color: c, roughness: 0.88 };
}

function wainscot(): Recipe {
  const u: TSLNode = vec2(wallU, wp.y);
  const groove: TSLNode = mix(one, smoothstep(0.0, 0.018, abs(fract(wallU.div(0.45)).sub(0.5))), smoothstep(12, 3, dist).mul(0.5));
  const scuff: TSLNode = smoothstep(0.62, 0.8, lum(vec2(wallU.mul(0.9), wp.y.mul(7)).add(0.17))).mul(smoothstep(0.75, 0.2, wp.y));
  let c: TSLNode = vec3(0.155, 0.205, 0.175).mul(mix(0.74, 1.0, lum(u.mul(0.7)))).mul(mix(0.92, 1.05, grain(u.mul(4))));
  c = mix(c, vec3(0.3, 0.31, 0.27), scuff.mul(0.35)).mul(groove).mul(mix(0.7, 1.0, smoothstep(0.02, 0.4, wp.y)));
  return { color: c, roughness: mix(0.5, 0.82, lum(u.mul(1.3))) };
}

function ceilingTile(): Recipe {
  const holes: TSLNode = smoothstep(0.6, 0.7, grain(wp.xz.mul(9))).mul(smoothstep(9, 2.5, dist));
  const stain = lum(wp.xz.mul(0.21).add(0.7));
  const ring: TSLNode = smoothstep(0.6, 0.66, stain).mul(one.sub(smoothstep(0.7, 0.86, stain)).mul(0.6).add(0.4));
  let c: TSLNode = vec3(0.42, 0.41, 0.37).mul(mix(0.8, 1.0, lum(wp.xz.mul(1.4)))).mul(one.sub(holes.mul(0.32)));
  c = mix(c, c.mul(vec3(0.62, 0.5, 0.3)), ring.mul(0.7));
  return { color: c, roughness: 0.92 };
}

function wood(dark: V3, light: V3, roughness: number): Recipe {
  const u: TSLNode = vec2(lp.x.add(lp.z).mul(3.2), lp.y.mul(0.22));
  const g: TSLNode = lum(u).mul(0.7).add(grain(u.mul(vec2(2.7, 2.1)).add(0.37)).mul(0.3));
  const c: TSLNode = mix(vec3(...dark), vec3(...light), smoothstep(0.3, 0.7, g)).mul(mix(0.72, 1.0, smoothstep(0.0, 0.5, wp.y)));
  return { color: c, roughness };
}

function mottled(base: V3, dark: number, scale: number, roughness: number, metalness = 0): Recipe {
  const n: TSLNode = lum(wp.xz.mul(scale)).add(lum(vec2(wallU, wp.y).mul(scale).add(0.43))).mul(0.5);
  return { color: vec3(...base).mul(mix(dark, 1.0, n)), roughness, metalness };
}

const RECIPES: Record<string, () => Recipe> = {
  M_Floor_Linoleum: linoleum,
  M_Wall_Plaster: () => plaster([0.38, 0.36, 0.31]),
  M_Wall_Alcove104: () => plaster([0.33, 0.3, 0.25]),
  M_Wall_Wainscot: wainscot,
  M_Ceiling_Tile: ceilingTile,
  M_Door_Office: () => wood([0.085, 0.055, 0.035], [0.215, 0.15, 0.095], 0.62),
  M_Desk_Wood: () => wood([0.07, 0.045, 0.03], [0.18, 0.125, 0.08], 0.6),
  M_Door_Void_Exit: () => mottled([0.045, 0.05, 0.058], 0.7, 3.0, 0.42, 0.3),
  M_Concrete_Stairs: () => mottled([0.19, 0.195, 0.2], 0.6, 2.0, 0.9),
  M_Phone_Beige: () => mottled([0.46, 0.41, 0.31], 0.86, 6.0, 0.54),
  M_Prop_Cork: () => mottled([0.28, 0.19, 0.11], 0.7, 12.0, 0.92),
};

const cache = new Map<string, THREE.Material>();
/** Procedural replacement for a corridor material, or null when the GLB's own material is already right. */
export function corridorMaterial(name: string): THREE.Material | null {
  const make = RECIPES[name];
  if (!make) return null;
  let mat = cache.get(name);
  if (!mat) {
    const r = make();
    const m = new THREE.MeshStandardNodeMaterial({ name, metalness: r.metalness ?? 0 });
    m.flatShading = true;
    m.colorNode = r.color;
    if (typeof r.roughness === 'number') m.roughness = r.roughness; else m.roughnessNode = r.roughness;
    cache.set(name, (mat = m));
  }
  return mat;
}
