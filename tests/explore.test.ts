import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import {
  IslandCollider,
  buildIslandCollider,
  findNearestPoi,
  getExploreSpawn,
} from '../src/explore.ts';

function makeFlatFloor(name: string, width: number, depth: number, y = 0): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.position.y = y;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function makeBoxMesh(name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('IslandCollider extracts walkable ground and solid obstacles, ignoring grass/leaves', () => {
  const root = new THREE.Group();
  root.add(makeFlatFloor('V4_ENV_Island_Top', 16, 16, -0.45));
  root.add(makeFlatFloor('V4_ENV_Tower_DoorStep', 3, 1, -0.36));
  root.add(makeBoxMesh('V4_ENV_Tower_Shell', 4, 10, 4, 0, 4, -5));
  root.add(makeBoxMesh('V4_PRP_CRT', 1.2, 1.2, 1.2, -6, 0.5, 1));
  root.add(makeBoxMesh('V4_VEG_Tree_Leaves', 4, 3, 4, -7, 4, -2));

  const collider = buildIslandCollider(root);
  assert.ok(collider.groundTriCount >= 4);
  assert.ok(collider.obstacleTriCount >= 12);

  const center = collider.isWalkable(0, 4);
  if (!center) throw new Error('expected center walkable');
  assert.ok(Math.abs(center.y - (-0.45)) < 0.01);

  const step = collider.isWalkable(0, 0);
  if (!step) throw new Error('expected step walkable');
  assert.ok(Math.abs(step.y - (-0.36)) < 0.01);

  // Off the island edge should not be walkable
  assert.equal(collider.isWalkable(0, 10), null);
});

test('IslandCollider blocks walking off cliffs and slides along tower walls', () => {
  const root = new THREE.Group();
  root.add(makeFlatFloor('ENV_Island_Top', 12, 12, -0.45));
  root.add(makeBoxMesh('ENV_Tower_Shell', 4, 6, 4, 0, 2, -2));

  const collider: IslandCollider = buildIslandCollider(root);
  // Try walking straight into the tower wall at z=0 (wall front face is at z=0)
  const hitWall = collider.stepMove(0, 1.2, -0.45, 0, 0.1);
  assert.ok(hitWall.z > 0.35, `expected player pushed outside wall, got z=${hitWall.z}`);

  // Try walking diagonally against the wall: should slide along X while staying outside Z
  const slide = collider.stepMove(0, 0.6, -0.45, 0.8, 0.1);
  assert.ok(slide.x > 0.2, `expected sliding along X, got x=${slide.x}`);
  assert.ok(slide.z > 0.35, `expected staying outside wall Z, got z=${slide.z}`);

  // Try stepping off the cliff rim (z=6 edge)
  const cliff = collider.stepMove(0, 5.5, -0.45, 0, 6.2);
  assert.ok(cliff.z < 5.8, `expected cliff containment, got z=${cliff.z}`);
});

test('findNearestPoi selects landmark in front of the player within radius', () => {
  const nearDoor = findNearestPoi(0.0, 1.1, 0.8, 0);
  assert.equal(nearDoor?.id, 'door');

  // Facing away from the door at distance > 1.8 should not pick door
  const facingAway = findNearestPoi(0.0, 1.1, 1.2, Math.PI);
  assert.equal(facingAway, null);

  const nearCrt = findNearestPoi(-5.6, 1.2, 2.2, 0.9);
  assert.equal(nearCrt?.id, 'crt');
});

test('getExploreSpawn returns landmark-aware spawns and default front path', () => {
  const def = getExploreSpawn('CAM_02_threequarter');
  assert.deepEqual(def, { x: 0.0, z: 4.8, yaw: 0.0, pitch: 0.09 });

  const crt = getExploreSpawn('CAM_BIBLE_04_computer');
  assert.ok(crt.x < -3 && crt.yaw > 0);
});
