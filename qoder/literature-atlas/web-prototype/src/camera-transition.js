import * as THREE from 'three';

// Orbit about the interpolated focus instead of cutting through it along a straight line.
// A new destination starts from the displayed pose, including during an earlier transition.
export function createCameraTransition(camera, focus) {
  let transition = null;
  const look = new THREE.Matrix4();
  const offset = new THREE.Vector3();
  const startRotation = new THREE.Quaternion(), endRotation = new THREE.Quaternion();

  function apply(t) {
    const step = t * t * (3 - 2 * t);
    focus.lerpVectors(transition.fromFocus, transition.toFocus, step);
    camera.quaternion.slerpQuaternions(startRotation, endRotation, step);
    const distance = Math.exp(THREE.MathUtils.lerp(Math.log(transition.fromDistance), Math.log(transition.toDistance), step));
    offset.set(0, 0, distance).applyQuaternion(camera.quaternion);
    camera.position.copy(focus).add(offset);
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (t >= 1) {
      camera.position.copy(transition.position); focus.copy(transition.toFocus); camera.up.copy(transition.up);
      camera.lookAt(focus);
      transition = null;
    }
  }

  return {
    get active() { return transition !== null; },
    get destination() { return transition; },
    start(position, target, up, now = performance.now(), duration = 760) {
      startRotation.copy(camera.quaternion);
      endRotation.setFromRotationMatrix(look.lookAt(position, target, up));
      transition = {
        fromFocus: focus.clone(), toFocus: target.clone(), position: position.clone(), up: up.clone(),
        fromDistance: Math.max(.1, camera.position.distanceTo(focus)), toDistance: Math.max(.1, position.distanceTo(target)),
        started: now, duration,
      };
    },
    update(now) {
      if (!transition) return false;
      apply(THREE.MathUtils.clamp((now - transition.started) / transition.duration, 0, 1));
      return true;
    },
    finish() { if (transition) { apply(1); camera.updateMatrixWorld(); } },
  };
}
