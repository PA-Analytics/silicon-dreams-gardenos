import * as THREE from 'three/webgpu';
import {
  clamp,
  color,
  float,
  mix,
  smoothstep,
  texture,
} from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TSLNode = any;

// Tileable 256x256 procedural noise LUT:
// R = 3-octave FBM, G = high-freq grain, B = Worley F1, A = Worley edge (cracks)
let sharedNoiseTex: THREE.DataTexture | null = null;

function hash2(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);

  const a = hash2(x0, y0, period, seed);
  const b = hash2(x0 + 1, y0, period, seed);
  const c = hash2(x0, y0 + 1, period, seed);
  const d = hash2(x0 + 1, y0 + 1, period, seed);

  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

function worley2D(u: number, v: number, cells: number, seed: number): [number, number] {
  const px = u * cells;
  const py = v * cells;
  const cx = Math.floor(px);
  const cy = Math.floor(py);

  let d1 = 99;
  let d2 = 99;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      const jx = hash2(nx, ny, cells, seed) * 0.85 + 0.075;
      const jy = hash2(nx, ny, cells, seed + 97) * 0.85 + 0.075;
      const fx = nx + jx - px;
      const fy = ny + jy - py;
      const dist = Math.sqrt(fx * fx + fy * fy);
      if (dist < d1) {
        d2 = d1;
        d1 = dist;
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }
  return [Math.min(1, d1), Math.min(1, d2 - d1)];
}

export function getSharedNoiseTexture(): THREE.DataTexture {
  if (sharedNoiseTex) return sharedNoiseTex;

  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // R: 3-octave FBM centered cleanly in [0, 1]
      const f1 = valueNoise2D(u, v, 8, 11);
      const f2 = valueNoise2D(u, v, 16, 29);
      const f3 = valueNoise2D(u, v, 32, 47);
      const fbm = f1 * 0.56 + f2 * 0.28 + f3 * 0.16;

      // G: fine surface grain
      const g1 = valueNoise2D(u, v, 48, 71);
      const g2 = valueNoise2D(u, v, 96, 103);
      const grain = g1 * 0.6 + g2 * 0.4;

      // B/A: Worley F1 & edge distance
      const [w1, edge] = worley2D(u, v, 12, 131);

      const idx = (y * size + x) * 4;
      data[idx] = Math.round(Math.min(1, Math.max(0, fbm)) * 255);
      data[idx + 1] = Math.round(Math.min(1, Math.max(0, grain)) * 255);
      data[idx + 2] = Math.round(Math.min(1, Math.max(0, w1)) * 255);
      data[idx + 3] = Math.round(Math.min(1, Math.max(0, edge)) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  sharedNoiseTex = tex;
  return tex;
}

/**
 * Convert an sRGB hex color into a linear TSL color node.
 */
export function linColor(hex: string | number): TSLNode {
  const c = new THREE.Color(hex);
  return color(c.r, c.g, c.b);
}

/**
 * Ultra-fast hardware-filtered noise replacing expensive per-pixel 3D Perlin loops.
 * Evaluates 2 planar lookups so 3D geometry never stretches on vertical walls.
 */
export function bNoise(
  pos: TSLNode,
  scale: number,
  octaves = 3,
  _roughness = 0.6,
): TSLNode {
  const tex = getSharedNoiseTexture();
  const s = scale * 0.085;
  const uvA = pos.xy.mul(s);
  const uvB = pos.zy.mul(s).add(float(0.37));
  const sa = texture(tex, uvA);
  const sb = texture(tex, uvB);
  const sample = octaves <= 2 ? sa.g.add(sb.g).mul(0.5) : sa.r.add(sb.r).mul(0.5);
  return clamp(sample, 0.0, 1.0);
}

/**
 * Fast 3D domain-warp offset vector in [0, 1]^3.
 */
export function bNoiseVec3(
  pos: TSLNode,
  scale: number,
  _octaves = 2,
  _roughness = 0.6,
): TSLNode {
  const tex = getSharedNoiseTexture();
  const s = scale * 0.085;
  const t1 = texture(tex, pos.xy.mul(s));
  const t2 = texture(tex, pos.xz.mul(s).add(float(0.23)));
  return clamp(t1.rgb.add(t2.gbr).mul(0.5), 0.0, 1.0);
}

/**
 * Fast hardware-filtered Voronoi F1 in [0, 1].
 */
export function bVoronoi(pos: TSLNode, scale: number): TSLNode {
  const tex = getSharedNoiseTexture();
  const s = scale * 0.06;
  const a = texture(tex, pos.xy.mul(s)).b;
  const b = texture(tex, pos.zy.mul(s).add(float(0.19))).b;
  return clamp(a.add(b).mul(0.5), 0.0, 1.0);
}

/**
 * Fast hardware-filtered Voronoi Distance-To-Edge for concrete cracks.
 */
export function bVoronoiEdge(pos: TSLNode, scale: number): TSLNode {
  const tex = getSharedNoiseTexture();
  const s = scale * 0.06;
  const a = texture(tex, pos.xy.mul(s)).a;
  const b = texture(tex, pos.zy.mul(s).add(float(0.41))).a;
  return clamp(a.min(b), 0.0, 1.0);
}

/**
 * Piecewise linear RGB ColorRamp matching Blender's ShaderNodeValToRGB.
 */
export function colorRamp(
  t: TSLNode,
  stops: Array<[number, string | number | [number, number, number]]>,
): TSLNode {
  const toCol = (v: string | number | [number, number, number]) =>
    Array.isArray(v) ? color(v[0], v[1], v[2]) : linColor(v);

  let acc = toCol(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const [p0] = stops[i - 1];
    const [p1, c1] = stops[i];
    const f = smoothstep(float(p0), float(p1), t);
    acc = mix(acc, toCol(c1), f);
  }
  return acc;
}

