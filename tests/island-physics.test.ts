import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { BODY, IslandPhysics, type Body } from '../src/gardenos/island-physics.ts';

function floor(name: string, size: number, y: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = name; mesh.position.y = y;
  return mesh;
}
function box(name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  mesh.name = name; mesh.position.set(x, y, z);
  return mesh;
}
/** 16 m square of turf at y=0, a 0.8 m cabinet at x=3, a 4 m wall at x=-4 and a leafy box nobody should feel. */
function world(): IslandPhysics {
  const root = new THREE.Group();
  root.add(floor('ENV_Island_Top', 16, 0));
  root.add(box('PRP_TVCabinet', 2, 0.8, 2, 3, 0.4, 0));
  root.add(box('ENV_Tower_Shell', 1, 4, 6, -4, 2, 0));
  root.add(box('VEG_Tree_Leaves', 2, 3, 2, 0, 1.5, 4));
  return new IslandPhysics(root);
}
const settle = (p: IslandPhysics, b: Body, seconds = 1) => { for (let i = 0; i < seconds * 60; i++) p.step(b, 0, 0, 1 / 60); };
const walk = (p: IslandPhysics, b: Body, vx: number, vz: number, seconds: number) => { let fell = false; for (let i = 0; i < seconds * 60; i++) fell = p.step(b, vx / 60, vz / 60, 1 / 60) || fell; return fell; };

test('the body rests on the ground and does not sink or drift', () => {
  const p = world();
  const b = p.spawn(0, 0);
  settle(p, b, 2);
  assert.ok(b.grounded);
  assert.ok(Math.abs(b.y) < 0.02, `feet at ${b.y}`);
  assert.ok(Math.hypot(b.x, b.z) < 1e-6);
});

test('a prop stops the walking body instead of letting it through', () => {
  const p = world();
  const b = p.spawn(0, 0);
  walk(p, b, 3, 0, 2); // toward the cabinet, whose near face is at x=2
  assert.ok(b.x < 2 - BODY.radius + 0.05, `stopped at ${b.x}`);
  assert.ok(Math.abs(b.y) < 0.05);
});

test('a jump lands on top of the prop, and it can be stood on', () => {
  const p = world();
  const b = p.spawn(0.9, 0);
  settle(p, b, 0.2);
  assert.ok(p.jump(b));
  assert.equal(p.jump(b), false, 'no double jump in the air');
  walk(p, b, 3.3, 0, 0.9);
  settle(p, b, 0.5);
  assert.ok(b.grounded);
  assert.ok(Math.abs(b.y - 0.8) < 0.03, `feet at ${b.y}, expected the cabinet top`);
  walk(p, b, 3.3, 0, 1); // walk off its far side
  settle(p, b, 0.5);
  assert.ok(Math.abs(b.y) < 0.03, 'back on the ground after stepping off');
});

test('walls are solid at every height and foliage is not', () => {
  const p = world();
  const b = p.spawn(0, 0);
  p.jump(b);
  walk(p, b, -6, 0, 1.5); // the wall's near face is at x=-3.5
  assert.ok(b.x > -3.5 + BODY.radius - 0.05, `stopped at ${b.x}`);
  const c = p.spawn(0, 1);
  walk(p, c, 0, 3, 2); // straight through the leaves at z=3..5
  assert.ok(c.z > 6);
});

test('a low ledge is walked onto, and a slab too low to pass under stops the body', () => {
  const root = new THREE.Group();
  root.add(floor('ENV_Island_Top', 16, 0));
  root.add(box('ENV_Tower_DoorStep', 2, 0.3, 2, 3, 0.15, 0)); // 0.3 m step, top at y=0.3
  root.add(box('PRP_Desk', 2, 0.2, 6, -3, 1.6, 0)); // underside at 1.5 m: lower than the body is tall
  const p = new IslandPhysics(root);
  const b = p.spawn(0, 0);
  walk(p, b, 3.3, 0, 1);
  assert.ok(b.grounded && Math.abs(b.y - 0.3) < 0.02, `feet at ${b.y}, expected the step`);
  const c = p.spawn(0, 0);
  walk(p, c, -3.3, 0, 1.5);
  assert.ok(c.x > -2 - BODY.radius, `went under the slab to ${c.x}`);
  assert.ok(Math.abs(c.y) < 0.02);
});

test('an added wall closes an opening the meshes leave', () => {
  const p = world();
  p.addWall(-2, 2, -1, 4, -5);
  const b = p.spawn(0, 0);
  walk(p, b, 0, -4, 3); // would reach z=-8, the edge, without it
  assert.ok(b.z > -5 + BODY.radius - 0.05, `stopped at ${b.z}`);
  assert.ok(b.grounded);
});

test('walking off the island falls into the void', () => {
  const p = world();
  const b = p.spawn(7, 0);
  assert.equal(walk(p, b, 3, 0, 0.5), false, 'still falling, not yet lost');
  assert.ok(!b.grounded);
  assert.ok(walk(p, b, 0, 0, 3), 'reported once it is far below the island');
});
