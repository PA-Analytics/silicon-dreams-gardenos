import * as THREE from 'three/webgpu';

/**
 * Real collision for the island: the visitor is a body with gravity, tested in 3D against the actual
 * triangles of the terrain, the tower and every prop. Whatever can be reached can be stood on, and what
 * is in the way stops you — walls, furniture, the tree, the doorway's lintel.
 *
 * Feet follow the highest solid surface under the body; three stacked spheres keep it out of anything upright.
 *
 * The island is modelled about 1.58× larger than the corridor (its door is 3.5 m tall against 2.2 m),
 * so the body is scaled by the same factor to keep the visitor's stature constant across both places.
 */
export const BODY = { radius: 0.5, height: 2.66, eye: 2.5 };
const GRAVITY = 22;
const JUMP_SPEED = 7.6; // apex ~1.3 m: enough for the TV cabinet, not for the desk
/** Ledges up to this height are simply walked onto; anything taller needs a jump. */
const STEP = 0.45;
/** Walking down a slope or a small drop keeps the feet on the ground instead of launching into the air. */
const SNAP = 0.3;
const MAX_FALL = 30;
const VOID_Y = -16; // below this the visitor has fallen off the island
/** Slopes steeper than this (normal.y) are walls: they push sideways instead of carrying weight. */
const WALKABLE_NY = 0.5;

// Same solid set the standalone explorer treats as ground or obstacle (src/explore.ts), plus the small props.
const SOLID = ['Island_Top', 'DoorStep', 'Tower_Shell', 'Tower_Door', 'Facade_Returns', 'Facade_Piers', 'Entrance_Tunnel', 'PRP_', 'Boombox', 'Desk_Crossbraces', 'Tree_Wood', 'Tree_Lower_Limb', 'Hydrangea', 'Shrub'];
const SOFT = ['Grass', 'Flower', 'Ivy', 'Leaves', 'Stems', 'FX_', 'Underside', 'Cable'];

interface Tri { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number; nx: number; ny: number; nz: number; minY: number; maxY: number }
export interface Body { x: number; y: number; z: number; vy: number; grounded: boolean; airTime: number }

export class IslandPhysics {
  private readonly tris: Tri[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly found: number[] = [];
  private readonly seen = new Set<number>();
  private readonly cp = { x: 0, y: 0, z: 0 };

  /** Index the island before its static meshes are merged (their names are how solid things are told from foliage). */
  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3(); const n = new THREE.Vector3();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) return;
      const label = mesh.name + ' ' + (mesh.parent?.name ?? '');
      if (!SOLID.some((p) => label.includes(p)) || SOFT.some((p) => label.includes(p))) return;
      if (label.includes('Island_Top') && mesh.name.endsWith('_1')) return; // the earth skirt under the turf
      const pos = mesh.geometry?.attributes?.position; if (!pos) return;
      const index = mesh.geometry.index;
      const count = index ? index.count / 3 : pos.count / 3;
      for (let i = 0; i < count; i++) {
        a.fromBufferAttribute(pos, index ? index.getX(i * 3) : i * 3).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, index ? index.getX(i * 3 + 1) : i * 3 + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, index ? index.getX(i * 3 + 2) : i * 3 + 2).applyMatrix4(mesh.matrixWorld);
        n.subVectors(b, a).cross(c.clone().sub(a));
        const len = n.length(); if (len < 1e-9) continue;
        n.divideScalar(len);
        const maxY = Math.max(a.y, b.y, c.y);
        if (maxY < -4 || Math.min(a.y, b.y, c.y) > 9) continue; // nothing the visitor can ever reach
        this.add({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z, nx: n.x, ny: n.y, nz: n.z, minY: Math.min(a.y, b.y, c.y), maxY });
      }
    });
  }

  get triangleCount(): number { return this.tris.length; }

  /** An invisible vertical wall across the X axis at depth z: closes openings the art leaves onto nothing. */
  addWall(x0: number, x1: number, y0: number, y1: number, z: number): void {
    const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Tri =>
      ({ ax, ay, az: z, bx, by, bz: z, cx, cy, cz: z, nx: 0, ny: 0, nz: 1, minY: Math.min(ay, by, cy), maxY: Math.max(ay, by, cy) });
    this.add(tri(x0, y0, x1, y0, x1, y1));
    this.add(tri(x0, y0, x1, y1, x0, y1));
  }

  private key(cx: number, cz: number): number { return ((cx + 512) << 12) | (cz + 512); }
  private add(t: Tri): void {
    const id = this.tris.push(t) - 1;
    const x0 = Math.floor(Math.min(t.ax, t.bx, t.cx)); const x1 = Math.floor(Math.max(t.ax, t.bx, t.cx));
    const z0 = Math.floor(Math.min(t.az, t.bz, t.cz)); const z1 = Math.floor(Math.max(t.az, t.bz, t.cz));
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this.key(x, z); const cell = this.cells.get(k);
      if (cell) cell.push(id); else this.cells.set(k, [id]);
    }
  }
  private query(x: number, z: number, r: number): number[] {
    const out = this.found; out.length = 0; this.seen.clear();
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
      const cell = this.cells.get(this.key(cx, cz)); if (!cell) continue;
      for (const id of cell) if (!this.seen.has(id)) { this.seen.add(id); out.push(id); }
    }
    return out;
  }

  /** Closest point on a triangle to p (Ericson, Real-Time Collision Detection 5.1.5). */
  private closest(px: number, py: number, pz: number, t: Tri): { x: number; y: number; z: number } {
    const o = this.cp;
    const abx = t.bx - t.ax; const aby = t.by - t.ay; const abz = t.bz - t.az;
    const acx = t.cx - t.ax; const acy = t.cy - t.ay; const acz = t.cz - t.az;
    const apx = px - t.ax; const apy = py - t.ay; const apz = pz - t.az;
    const d1 = abx * apx + aby * apy + abz * apz; const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { o.x = t.ax; o.y = t.ay; o.z = t.az; return o; }
    const bpx = px - t.bx; const bpy = py - t.by; const bpz = pz - t.bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz; const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { o.x = t.bx; o.y = t.by; o.z = t.bz; return o; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); o.x = t.ax + abx * v; o.y = t.ay + aby * v; o.z = t.az + abz * v; return o; }
    const cpx = px - t.cx; const cpy = py - t.cy; const cpz = pz - t.cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz; const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { o.x = t.cx; o.y = t.cy; o.z = t.cz; return o; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); o.x = t.ax + acx * w; o.y = t.ay + acy * w; o.z = t.az + acz * w; return o; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); o.x = t.bx + (t.cx - t.bx) * w; o.y = t.by + (t.cy - t.by) * w; o.z = t.bz + (t.cz - t.bz) * w; return o; }
    const den = 1 / (va + vb + vc); const v = vb * den; const w = vc * den;
    o.x = t.ax + abx * v + acx * w; o.y = t.ay + aby * v + acy * w; o.z = t.az + abz * v + acz * w;
    return o;
  }

  /** Highest surface under (x, z) that is not above `fromY`; null over the void. */
  groundBelow(x: number, z: number, fromY: number): number | null {
    let best = -Infinity;
    for (const id of this.query(x, z, 0.01)) {
      const t = this.tris[id];
      if (Math.abs(t.ny) < WALKABLE_NY || t.minY > fromY) continue; // either side: some props are modelled inside-out
      // Barycentric test in XZ, then the plane's height at that point.
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz); if (Math.abs(d) < 1e-9) continue;
      const u = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
      const v = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
      if (u < -1e-4 || v < -1e-4 || u + v > 1.0001) continue;
      const y = u * t.ay + v * t.by + (1 - u - v) * t.cy;
      if (y <= fromY && y > best) best = y;
    }
    return Number.isFinite(best) ? best : null;
  }

  spawn(x: number, z: number, fromY = 4): Body {
    const y = this.groundBelow(x, z, fromY) ?? 0;
    return { x, y, z, vy: 0, grounded: true, airTime: 0 };
  }

  /** Jump if standing (or within a short grace period after leaving an edge). */
  jump(body: Body): boolean {
    if (!body.grounded && body.airTime > 0.12) return false;
    body.vy = JUMP_SPEED; body.grounded = false; body.airTime = 1;
    return true;
  }

  /** Advance the body by a horizontal displacement and one step of gravity. Returns true if it fell into the void. */
  step(body: Body, dx: number, dz: number, dt: number): boolean {
    const wasGrounded = body.grounded;
    body.vy = Math.max(-MAX_FALL, body.vy - GRAVITY * dt);
    const dy = body.vy * dt;
    // Substeps keep each move well under the body's radius, so nothing thin is ever skipped through.
    const n = Math.max(1, Math.ceil(Math.max(Math.hypot(dx, dz), Math.abs(dy)) / 0.2));
    let grounded = false;
    for (let s = 0; s < n; s++) {
      const px = body.x; const pz = body.z;
      body.x += dx / n; body.z += dz / n;
      // Sideways: walls, furniture and trunks push the body back out. A ceiling too low to pass under stops it.
      if (this.resolve(body) && body.vy <= 0) { body.x = px; body.z = pz; }
      body.y += dy / n;
      if (body.vy > 0) {
        if (this.resolve(body)) { body.y -= dy / n; body.vy = 0; } // head against a lintel or the underside of a prop
        continue;
      }
      // Down: the highest solid surface under the feet (terrain, a step, the top of a prop) carries the body.
      const ground = this.groundBelow(body.x, body.z, body.y + STEP);
      if (ground !== null && body.y <= ground + (wasGrounded || grounded ? SNAP : 0)) { body.y = ground; body.vy = 0; grounded = true; }
    }
    body.grounded = grounded;
    body.airTime = grounded ? 0 : body.airTime + dt;
    return body.y < VOID_Y;
  }

  /**
   * Push the body (three stacked spheres, the lowest starting above step height) sideways out of everything it overlaps.
   * Returns true if something still presses down on its head.
   */
  private resolve(body: Body): boolean {
    const r = BODY.radius; let ceiling = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false; ceiling = false;
      const ids = this.query(body.x, body.z, r + 0.05);
      for (let s = 0; s < 3; s++) {
        const cy = body.y + (s === 0 ? STEP + r : s === 1 ? BODY.height * 0.5 : BODY.height - r);
        for (let i = 0; i < ids.length; i++) {
          const t = this.tris[ids[i]];
          if (t.maxY < cy - r || t.minY > cy + r) continue;
          const p = this.closest(body.x, cy, body.z, t);
          let nx = body.x - p.x; let ny = cy - p.y; let nz = body.z - p.z;
          const d2 = nx * nx + ny * ny + nz * nz;
          if (d2 >= r * r) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-6) { nx = t.nx; ny = t.ny; nz = t.nz; d = 0; } else { nx /= d; ny /= d; nz /= d; }
          const pen = r - d;
          const h = Math.hypot(nx, nz);
          if (h > 0.3) {
            // A wall, a trunk, the side of a prop: move exactly far enough sideways to clear it.
            const push = Math.min(pen / h, r);
            body.x += (nx / h) * push; body.z += (nz / h) * push; moved = true;
          } else if (ny < 0 && s > 0) ceiling = true; // flat overhead: nothing sideways can fix it
        }
      }
      if (!moved) break;
    }
    return ceiling;
  }
}
