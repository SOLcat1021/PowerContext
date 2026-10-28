import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVectorScene } from '../src/vector-scene.js';

function fixture() {
  const paths = [];
  const svg = {
    attributes: new Map(),
    set innerHTML(markup) { paths.length = 0; for (const _ of markup.matchAll(/class="vector-guide"/g)) paths.push({ setAttribute(name, value) { this[name] = value; } }); },
    querySelectorAll(selector) { return selector === '.vector-guide' ? paths : []; },
    getAttribute(name) { return this.attributes.get(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return { camera, paths, scene: createVectorScene(svg, camera) };
}

test('vector guides match the same 3D camera under perspective and rotated parent transforms', () => {
  const { camera, paths, scene } = fixture();
  const positions = [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)];
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(positions), new THREE.LineBasicMaterial());
  const parent = new THREE.Group(); parent.rotation.y = .64; parent.position.set(.5, -.3, 0); parent.add(line); parent.updateMatrixWorld(true);
  scene.setObjects([line], []); scene.update(600, 600);
  const actual = paths[0].d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  positions.concat(positions.slice(0, 1)).forEach((point, index) => {
    const projected = point.clone().applyMatrix4(line.matrixWorld).project(camera);
    assert.ok(Math.abs(actual[index * 2] - (projected.x * .5 + .5) * 600) < .01);
    assert.ok(Math.abs(actual[index * 2 + 1] - (-projected.y * .5 + .5) * 600) < .01);
  });
});

test('near-plane crossing is clipped and never produces NaN or Infinity', () => {
  const { camera, paths, scene } = fixture();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 11), new THREE.Vector3(.01, 0, 0)]), new THREE.LineBasicMaterial());
  line.updateMatrixWorld(); scene.setObjects([line], []); scene.update(600, 600);
  assert.match(paths[0].d, /^M/);
  assert.ok(!/NaN|Infinity/.test(paths[0].d));
  const numbers = paths[0].d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.ok(numbers.every(Number.isFinite));
  assert.ok(numbers[0] >= 0 && numbers[0] <= 600);
});
