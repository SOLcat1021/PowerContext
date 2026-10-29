// Velocities use world units / millisecond and radians / millisecond.
export function navigationSensitivity(width, height, distance, fov, verticalProjection) {
  return {
    rotation: Math.max(.0075, Math.min(.016, Math.PI * 1.5 / Math.max(1, width))),
    pan: distance * 2 * Math.tan(fov * Math.PI / 360) / Math.max(1, height) / Math.max(.25, verticalProjection) * 1.25,
  };
}

export function sampleVelocity(previous, rotation, pan, elapsed) {
  const dt = Math.max(4, elapsed);
  const blend = previous ? 1 - Math.exp(-dt / 45) : 1;
  const angular = Math.max(-.012, Math.min(.012, rotation / dt));
  const vertical = Math.max(-.08, Math.min(.08, pan / dt));
  return {
    rotation: (previous?.rotation || 0) * (1 - blend) + angular * blend,
    pan: (previous?.pan || 0) * (1 - blend) + vertical * blend,
  };
}

export function releaseVelocity(velocity, age) {
  const freshness = Math.max(0, 1 - age / 100);
  return { rotation: (velocity?.rotation || 0) * freshness, pan: (velocity?.pan || 0) * freshness };
}

export function advanceInertia(velocity, elapsed) {
  const decay = Math.exp(-elapsed / 210);
  const travel = 210 * (1 - decay);
  return {
    rotation: velocity.rotation * travel,
    pan: velocity.pan * travel,
    velocity: { rotation: velocity.rotation * decay, pan: velocity.pan * decay },
    active: Math.abs(velocity.rotation * decay) > .000025 || Math.abs(velocity.pan * decay) > .0002,
  };
}
