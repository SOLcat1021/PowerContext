import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraTransition } from '../src/camera-transition.js';

function fixture() {
  const camera = new THREE.PerspectiveCamera(38, .5, .1, 150);
  const target = new THREE.Vector3(1, -3, 0);
  camera.position.set(1, 8, 25); camera.lookAt(target);
  return { camera, target, motion: createCameraTransition(camera, target) };
}
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-8, `${a.toArray()} != ${b.toArray()}`);

test('mode changes during a plane transition complete at the latest global destination', () => {
  const { camera, target, motion } = fixture();
  const global = camera.position.clone(), focus = target.clone();
  motion.start(new THREE.Vector3(0, 38, .001), new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0);
  motion.update(300);
  const intermediate = camera.position.clone();
  assert.ok(intermediate.distanceTo(global) > 1);
  motion.start(global, focus, new THREE.Vector3(0, 1, 0), 300);
  motion.update(300);
  close(camera.position, intermediate);
  motion.update(1061);
  close(camera.position, global); close(target, focus);
  assert.equal(motion.active, false);
});

test('rapid reversals retain the displayed orientation and converge to the last request', () => {
  const { camera, target, motion } = fixture();
  for (let i = 0; i < 8; i++) {
    const displayed = camera.quaternion.clone(), position = camera.position.clone();
    motion.start(new THREE.Vector3(i, i % 2 ? 6 : 42, i % 2 ? 28 : .001), new THREE.Vector3(i, 0, 0), new THREE.Vector3(0, i % 2 ? 1 : 0, i % 2 ? 0 : -1), i * 100);
    motion.update(i * 100);
    close(camera.position, position);
    assert.ok(camera.quaternion.angleTo(displayed) < 1e-6);
    motion.update(i * 100 + 70);
  }
  motion.update(2000);
  close(camera.position, new THREE.Vector3(7, 6, 28));
  close(target, new THREE.Vector3(7, 0, 0));
  assert.equal(motion.active, false);
});

test('global to top view keeps a finite orbit distance, orthonormal camera and exact endpoint', () => {
  const { camera, target, motion } = fixture();
  const top = new THREE.Vector3(0, 40, .001), focus = new THREE.Vector3();
  const fromDistance = camera.position.distanceTo(target), toDistance = top.distanceTo(focus);
  motion.start(top, focus, new THREE.Vector3(0, 0, -1), 0);
  for (let t = 0; t <= 800; t += 8) {
    motion.update(t);
    const d = camera.position.distanceTo(target);
    assert.ok(d >= Math.min(fromDistance, toDistance) - 1e-8 && d <= Math.max(fromDistance, toDistance) + 1e-8);
    assert.ok([...camera.position, ...camera.quaternion, ...camera.up].every(Number.isFinite));
    const view = camera.getWorldDirection(new THREE.Vector3());
    assert.ok(view.dot(target.clone().sub(camera.position).normalize()) > .999999);
  }
  close(camera.position, top); close(target, focus);
});

test('taking over a transition for a real drag finishes at its intended view', () => {
  const { camera, target, motion } = fixture();
  const top = new THREE.Vector3(0, 30, .001);
  motion.start(top, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0);
  motion.update(180); motion.finish();
  close(camera.position, top); close(target, new THREE.Vector3());
  assert.equal(motion.active, false);
  assert.equal(motion.update(300), false);
});
