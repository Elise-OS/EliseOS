import type { PlanRoom } from '@michel/contracts';

type Point = { x: number; y: number };

/** Intersect the direction of travel with the actual polygon, including L-shaped rooms. */
export function connectionBoundary(room: PlanRoom, target: Point): Point {
  const points = room.geometry.points;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const origin = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  const direction = { x: target.x - origin.x, y: target.y - origin.y };
  if (Math.hypot(direction.x, direction.y) < 0.001) direction.y = -1;
  const hits: { point: Point; t: number }[] = [];
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length]!;
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const cross = direction.x * edge.y - direction.y * edge.x;
    if (Math.abs(cross) < 0.00001) return;
    const offset = { x: a.x - origin.x, y: a.y - origin.y };
    const t = (offset.x * edge.y - offset.y * edge.x) / cross;
    const u = (offset.x * direction.y - offset.y * direction.x) / cross;
    if (t >= 0 && u >= 0 && u <= 1)
      hits.push({ point: { x: origin.x + t * direction.x, y: origin.y + t * direction.y }, t });
  });
  const hit = hits.sort((a, b) => b.t - a.t)[0];
  if (hit) return hit.point;
  // The bounding-box center can sit in the cutout of a concave room.
  return points
    .map((a, index) => {
      const b = points[(index + 1) % points.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
      );
      return { x: a.x + t * dx, y: a.y + t * dy };
    })
    .sort(
      (a, b) =>
        Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y),
    )[0]!;
}

export function connectionCurve(start: Point, end: Point): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // Controls scale down to zero for touching walls, avoiding loops at short distances.
  return Math.abs(dx) >= Math.abs(dy)
    ? `M ${start.x} ${start.y} C ${start.x + dx * 0.45} ${start.y}, ${end.x - dx * 0.45} ${end.y}, ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} C ${start.x} ${start.y + dy * 0.45}, ${end.x} ${end.y - dy * 0.45}, ${end.x} ${end.y}`;
}
