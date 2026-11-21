import * as THREE from 'three/webgpu';

export interface TriData {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  ny: number;
  minY: number;
  maxY: number;
}

export interface GroundHit {
  y: number;
  ny: number;
}

export interface IslandPoi {
  id: string;
  label: string;
  actionLabel: string;
  position: [number, number, number];
  radius: number;
  lines: string[];
}

export const ISLAND_POIS: IslandPoi[] = [
  {
    id: 'door',
    label: 'Puerta de la Torre',
    actionLabel: 'Examinar puerta',
    position: [0.0, 0.9, -1.0],
    radius: 3.1,
    lines: [
      'La madera está húmeda. Cerrada desde dentro.',
      'Se percibe un zumbido eléctrico detrás del umbral.',
      'Alguien dejó una luz encendida en los pisos altos.',
    ],
  },
  {
    id: 'crt',
    label: 'Terminal CRT / PC',
    actionLabel: 'Cambiar señal CRT',
    position: [-7.7, 2.3, 1.1],
    radius: 3.6,
    lines: [
      'El monitor sigue tibio. El cable baja directo hacia la tierra.',
      'Señal local sin red. Solo responde cuando cae la noche.',
    ],
  },
  {
    id: 'tv',
    label: 'Televisor y Boombox',
    actionLabel: 'Cambiar señal TV',
    position: [6.0, 1.0, 0.0],
    radius: 3.6,
    lines: [
      'La cinta del boombox está detenida a mitad de cara.',
      'La pantalla guarda estática residual en el cristal.',
    ],
  },
  {
    id: 'tree',
    label: 'Árbol del acantilado',
    actionLabel: 'Observar árbol',
    position: [-9.8, 1.2, -1.3],
    radius: 3.5,
    lines: [
      'Las raíces sujetan el borde oeste de la isla sobre el vacío.',
      'Entre los arbustos de atrás algo suele mirar de noche.',
    ],
  },
  {
    id: 'hydrangeas',
    label: 'Hortensias',
    actionLabel: 'Observar flores',
    position: [9.6, 0.2, -1.2],
    radius: 3.3,
    lines: [
      'Hortensias azul-violeta creciendo junto al hormigón.',
      'El aire aquí huele a lluvia reciente y tierra fría.',
    ],
  },
  {
    id: 'overlook',
    label: 'Mirador frontal',
    actionLabel: 'Alternar Día / Noche',
    position: [0.0, -1.35, 7.0],
    radius: 3.2,
    lines: [
      'El sendero termina justo sobre el mar de nubes.',
    ],
  },
];

export interface ExploreSpawn {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

const CAMERA_SPAWNS: Record<string, ExploreSpawn> = {
  CAM_BIBLE_04_computer: { x: -4.8, z: 3.2, yaw: 0.85, pitch: 0.02 },
  CAM_BIBLE_05_television: { x: 3.5, z: 2.3, yaw: -0.78, pitch: 0.0 },
  CAM_BIBLE_06_tree: { x: -5.8, z: 3.4, yaw: 0.72, pitch: 0.06 },
  CAM_BIBLE_09_entrance: { x: 0.0, z: 2.3, yaw: 0.0, pitch: 0.08 },
  CAM_03_rear: { x: 0.0, z: -13.7, yaw: Math.PI, pitch: 0.08 },
};

export const DEFAULT_EXPLORE_SPAWN: ExploreSpawn = {
  x: 0.0,
  z: 4.8,
  yaw: 0.0,
  pitch: 0.09,
};

export function getExploreSpawn(cameraName?: string): ExploreSpawn {
  if (cameraName && CAMERA_SPAWNS[cameraName]) {
    return { ...CAMERA_SPAWNS[cameraName] };
  }
  return { ...DEFAULT_EXPLORE_SPAWN };
}

class SpatialTriGrid {
  readonly cellSize: number;
  readonly tris: TriData[] = [];
  private readonly cells = new Map<number, number[]>();

  constructor(cellSize = 1.0) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cz: number): number {
    return ((cx + 512) << 12) | (cz + 512);
  }

  addTriangle(tri: TriData): void {
    const idx = this.tris.length;
    this.tris.push(tri);
    const minCx = Math.floor(Math.min(tri.ax, tri.bx, tri.cx) / this.cellSize);
    const maxCx = Math.floor(Math.max(tri.ax, tri.bx, tri.cx) / this.cellSize);
    const minCz = Math.floor(Math.min(tri.az, tri.bz, tri.cz) / this.cellSize);
    const maxCz = Math.floor(Math.max(tri.az, tri.bz, tri.cz) / this.cellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const k = this.key(cx, cz);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(idx);
      }
    }
  }

  queryCell(x: number, z: number): number[] {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return this.cells.get(this.key(cx, cz)) ?? [];
  }

  queryBox(minX: number, maxX: number, minZ: number, maxZ: number, out: number[], seen: Set<number>): void {
    out.length = 0;
    seen.clear();
    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCz = Math.floor(minZ / this.cellSize);
    const maxCz = Math.floor(maxZ / this.cellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.cells.get(this.key(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i];
          if (!seen.has(id)) {
            seen.add(id);
            out.push(id);
          }
        }
      }
    }
  }
}

function closestPointOnTri3D(
  px: number, py: number, pz: number,
  t: TriData,
  out: THREE.Vector3,
): THREE.Vector3 {
  const abx = t.bx - t.ax; const aby = t.by - t.ay; const abz = t.bz - t.az;
  const acx = t.cx - t.ax; const acy = t.cy - t.ay; const acz = t.cz - t.az;
  const apx = px - t.ax; const apy = py - t.ay; const apz = pz - t.az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return out.set(t.ax, t.ay, t.az);

  const bpx = px - t.bx; const bpy = py - t.by; const bpz = pz - t.bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return out.set(t.bx, t.by, t.bz);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return out.set(t.ax + abx * v, t.ay + aby * v, t.az + abz * v);
  }

  const cpx = px - t.cx; const cpy = py - t.cy; const cpz = pz - t.cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return out.set(t.cx, t.cy, t.cz);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return out.set(t.ax + acx * w, t.ay + acy * w, t.az + acz * w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return out.set(
      t.bx + (t.cx - t.bx) * w,
      t.by + (t.cy - t.by) * w,
      t.bz + (t.cz - t.bz) * w,
    );
  }

  const denom = 1.0 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return out.set(
    t.ax + abx * v + acx * w,
    t.ay + aby * v + acy * w,
    t.az + abz * v + acz * w,
  );
}

function pointInTriXZ(
  px: number, pz: number,
  t: TriData,
): number | null {
  const v0x = t.cx - t.ax;
  const v0z = t.cz - t.az;
  const v1x = t.bx - t.ax;
  const v1z = t.bz - t.az;
  const v2x = px - t.ax;
  const v2z = pz - t.az;

  const dot00 = v0x * v0x + v0z * v0z;
  const dot01 = v0x * v1x + v0z * v1z;
  const dot02 = v0x * v2x + v0z * v2z;
  const dot11 = v1x * v1x + v1z * v1z;
  const dot12 = v1x * v2x + v1z * v2z;

  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-10) return null;
  const inv = 1.0 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  const eps = -0.002;
  if (u >= eps && v >= eps && u + v <= 1.0 - eps) {
    return t.ay + (t.cy - t.ay) * u + (t.by - t.ay) * v;
  }
  return null;
}

const WALKABLE_PATTERNS = ['Island_Top', 'DoorStep'];
const OBSTACLE_PATTERNS = [
  'Tower_Shell',
  'Facade_Returns',
  'Facade_Piers',
  'Tower_Door',
  'Entrance_Tunnel',
  'PRP_Desk',
  'PRP_CRT',
  'PRP_Chair',
  'PRP_PCTower',
  'PRP_DesktopCase',
  'PRP_TVCabinet',
  'PRP_TV',
  'PRP_Boombox',
  'Tree_Wood',
  'Hydrangea',
  'Shrub',
];
const IGNORE_PATTERNS = ['DoorStep', 'Grass', 'Flower', 'Ivy', 'Leaves', 'Stems', 'FX_', 'Underside'];

function matchesAny(label: string, patterns: string[]): boolean {
  for (let i = 0; i < patterns.length; i++) {
    if (label.includes(patterns[i])) return true;
  }
  return false;
}

export class IslandCollider {
  private readonly groundGrid = new SpatialTriGrid(1.0);
  private readonly obstacleGrid = new SpatialTriGrid(1.0);
  private readonly queryScratch: number[] = [];
  private readonly seenScratch = new Set<number>();
  private readonly cpScratch = new THREE.Vector3();

  get groundTriCount(): number {
    return this.groundGrid.tris.length;
  }

  get obstacleTriCount(): number {
    return this.obstacleGrid.tris.length;
  }

  addMesh(mesh: THREE.Mesh, role: 'ground' | 'obstacle'): void {
    const geo = mesh.geometry;
    const pos = geo?.attributes?.position;
    if (!pos) return;
    const mat = mesh.matrixWorld;
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const n = new THREE.Vector3();

    const index = geo.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    for (let i = 0; i < triCount; i++) {
      const i0 = index ? index.getX(i * 3) : i * 3;
      const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      va.fromBufferAttribute(pos, i0).applyMatrix4(mat);
      vb.fromBufferAttribute(pos, i1).applyMatrix4(mat);
      vc.fromBufferAttribute(pos, i2).applyMatrix4(mat);

      ab.subVectors(vb, va);
      ac.subVectors(vc, va);
      n.crossVectors(ab, ac);
      const lenSq = n.lengthSq();
      if (lenSq < 1e-10) continue;
      n.multiplyScalar(1.0 / Math.sqrt(lenSq));

      const minY = Math.min(va.y, vb.y, vc.y);
      const maxY = Math.max(va.y, vb.y, vc.y);

      if (role === 'ground') {
        if (n.y < 0.45 || maxY < -1.95) continue;
        this.groundGrid.addTriangle({
          ax: va.x, ay: va.y, az: va.z,
          bx: vb.x, by: vb.y, bz: vb.z,
          cx: vc.x, cy: vc.y, cz: vc.z,
          ny: n.y,
          minY,
          maxY,
        });
      } else {
        if (maxY < -1.7 || minY > 3.2) continue;
        this.obstacleGrid.addTriangle({
          ax: va.x, ay: va.y, az: va.z,
          bx: vb.x, by: vb.y, bz: vb.z,
          cx: vc.x, cy: vc.y, cz: vc.z,
          ny: n.y,
          minY,
          maxY,
        });
      }
    }
  }

  sampleGround(x: number, z: number, maxAllowedY = 4.0): GroundHit | null {
    const bucket = this.groundGrid.queryCell(x, z);
    let bestY = -Infinity;
    let bestNy = 0;
    for (let i = 0; i < bucket.length; i++) {
      const t = this.groundGrid.tris[bucket[i]];
      if (t.minY > maxAllowedY) continue;
      const y = pointInTriXZ(x, z, t);
      if (y !== null && y <= maxAllowedY && y > bestY) {
        bestY = y;
        bestNy = t.ny;
      }
    }
    if (!Number.isFinite(bestY)) return null;
    return { y: bestY, ny: bestNy };
  }

  isWalkable(x: number, z: number, refY?: number): GroundHit | null {
    const maxY = refY !== undefined ? refY + 1.15 : 4.0;
    const center = this.sampleGround(x, z, maxY);
    if (!center || center.ny < 0.56 || center.y < -1.75) return null;

    // Keep a small rim margin from steep island cliffs so the player never steps off into the void
    const rim = 0.24;
    const offsets: Array<[number, number]> = [
      [rim, 0],
      [-rim, 0],
      [0, rim],
      [0, -rim],
    ];
    for (let i = 0; i < offsets.length; i++) {
      const probe = this.sampleGround(x + offsets[i][0], z + offsets[i][1], maxY);
      if (!probe || probe.ny < 0.48 || probe.y < -1.85) return null;
    }
    return center;
  }

  resolveObstacles(x: number, z: number, groundY: number, radius = 0.42): { x: number; z: number } {
    let px = x;
    let pz = z;
    const minBandY = groundY + 0.28;
    const maxBandY = groundY + 1.62;
    const sampleHeights = [groundY + 0.52, groundY + 1.02];

    for (let iter = 0; iter < 2; iter++) {
      this.obstacleGrid.queryBox(
        px - radius - 0.1,
        px + radius + 0.1,
        pz - radius - 0.1,
        pz + radius + 0.1,
        this.queryScratch,
        this.seenScratch,
      );
      for (let i = 0; i < this.queryScratch.length; i++) {
        const tri = this.obstacleGrid.tris[this.queryScratch[i]];
        if (tri.maxY < minBandY || tri.minY > maxBandY) continue;
        if (Math.abs(tri.ny) > 0.9) continue;

        for (let h = 0; h < sampleHeights.length; h++) {
          const py = sampleHeights[h];
          const cp = closestPointOnTri3D(px, py, pz, tri, this.cpScratch);
          const dx = px - cp.x;
          const dy = py - cp.y;
          const dz = pz - cp.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < radius * radius) {
            const horizSq = dx * dx + dz * dz;
            if (horizSq > 1e-8) {
              const horiz = Math.sqrt(horizSq);
              const maxHoriz = Math.sqrt(Math.max(0, radius * radius - dy * dy));
              if (horiz < maxHoriz) {
                const push = (maxHoriz - horiz) / horiz;
                px += dx * push;
                pz += dz * push;
              }
            }
          }
        }
      }
    }
    return { x: px, z: pz };
  }

  stepMove(
    fromX: number,
    fromZ: number,
    fromGroundY: number,
    targetX: number,
    targetZ: number,
    radius = 0.42,
  ): { x: number; z: number; groundY: number; moved: boolean } {
    const resolvedFull = this.resolveObstacles(targetX, targetZ, fromGroundY, radius);
    const fullHit = this.isWalkable(resolvedFull.x, resolvedFull.z, fromGroundY);
    if (fullHit && Math.abs(fullHit.y - fromGroundY) <= 0.65) {
      return {
        x: resolvedFull.x,
        z: resolvedFull.z,
        groundY: fullHit.y,
        moved: true,
      };
    }

    // Slide along X only
    const resolvedX = this.resolveObstacles(targetX, fromZ, fromGroundY, radius);
    const hitX = this.isWalkable(resolvedX.x, resolvedX.z, fromGroundY);
    if (hitX && Math.abs(hitX.y - fromGroundY) <= 0.65) {
      return {
        x: resolvedX.x,
        z: resolvedX.z,
        groundY: hitX.y,
        moved: true,
      };
    }

    // Slide along Z only
    const resolvedZ = this.resolveObstacles(fromX, targetZ, fromGroundY, radius);
    const hitZ = this.isWalkable(resolvedZ.x, resolvedZ.z, fromGroundY);
    if (hitZ && Math.abs(hitZ.y - fromGroundY) <= 0.65) {
      return {
        x: resolvedZ.x,
        z: resolvedZ.z,
        groundY: hitZ.y,
        moved: true,
      };
    }

    return { x: fromX, z: fromZ, groundY: fromGroundY, moved: false };
  }
}

export function buildIslandCollider(root: THREE.Object3D): IslandCollider {
  const collider = new IslandCollider();
  root.updateMatrixWorld(true);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) return;
    const label = `${mesh.name} ${mesh.parent?.name ?? ''}`;
    if (!mesh.name.endsWith('_1') && matchesAny(label, WALKABLE_PATTERNS)) {
      collider.addMesh(mesh, 'ground');
      return;
    }
    if (!matchesAny(label, IGNORE_PATTERNS) && matchesAny(label, OBSTACLE_PATTERNS)) {
      collider.addMesh(mesh, 'obstacle');
    }
  });

  return collider;
}

export function findNearestPoi(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pois: IslandPoi[] = ISLAND_POIS,
): IslandPoi | null {
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  let best: IslandPoi | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i];
    const dx = poi.position[0] - x;
    const dy = poi.position[1] - y;
    const dz = poi.position[2] - z;
    const dist = Math.hypot(dx, dy * 0.5, dz);
    if (dist > poi.radius) continue;
    const horiz = Math.hypot(dx, dz) || 1;
    const facing = (dx * fwdX + dz * fwdZ) / horiz;
    if (facing < -0.15 && dist > 1.8) continue;
    const score = facing * 1.4 - dist * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = poi;
    }
  }
  return best;
}
