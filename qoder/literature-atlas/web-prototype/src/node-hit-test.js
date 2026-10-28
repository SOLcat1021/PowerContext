// Screen pixels keep node and edge hit areas consistent through zoom and perspective.
export function findNearestNode(points, x, y, radius) {
  let nearest = null;
  let nearestDistance = radius * radius;
  for (const point of points) {
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance > nearestDistance || !Number.isFinite(distance)) continue;
    if (nearest && distance === nearestDistance && point.depth >= nearest.depth) continue;
    nearest = point;
    nearestDistance = distance;
  }
  return nearest?.id || null;
}

export function findNearestEdge(segments, x, y, radius) {
  let nearest = null, nearestDistance = radius * radius;
  for (const segment of segments) {
    const dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < .25) continue;
    const t = Math.max(0, Math.min(1, ((x - segment.from.x) * dx + (y - segment.from.y) * dy) / lengthSquared));
    const distance = (x - segment.from.x - t * dx) ** 2 + (y - segment.from.y - t * dy) ** 2;
    if (Number.isFinite(distance) && distance <= nearestDistance) { nearest = segment.id; nearestDistance = distance; }
  }
  return nearest;
}
