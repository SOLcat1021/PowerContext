// The overview retains global time while sharing the day plane's spatial rotation.
export function createOverviewLayout(nodes, focusedDate, angle = .52) {
  const dates = [...new Set([...nodes.map((node) => node.date), focusedDate])].sort();
  const timestamp = (date) => Date.parse(`${date}T12:00:00Z`);
  const first = timestamp(dates[0]);
  const last = timestamp(dates.at(-1));
  const span = last - first;
  const dateY = (date) => span ? 200 - (timestamp(date) - first) / span * 160 : 120;
  return {
    dates,
    dateY,
    projectNode(node, rotation = angle) {
      const cos = Math.cos(rotation), sin = Math.sin(rotation);
      const x = Number(node.x) || 0, z = Number(node.z) || 0;
      return { x: 138 + (x * cos + z * sin) * 24, y: dateY(node.date) + (-x * sin + z * cos) * 6 };
    },
  };
}

export function overviewLinkPath(from, to, arrow = false) {
  if (!from || !to) return '';
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < .5) return '';
  const start = Math.min(3, length * .15);
  const end = Math.min(arrow ? 6 : 3, length * .2);
  return `M ${from.x + dx / length * start} ${from.y + dy / length * start} L ${to.x - dx / length * end} ${to.y - dy / length * end}`;
}
