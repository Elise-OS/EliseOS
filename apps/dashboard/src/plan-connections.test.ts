import type { PlanRoom } from '@michel/contracts';
import { describe, expect, it } from 'vitest';
import { connectionBoundary, connectionCurve } from './plan-connections';

const room: PlanRoom = {
  id: 'room',
  name: 'Salon',
  kind: 'LIVING_ROOM',
  geometry: {
    color: '#fff',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  },
};

describe('room connection geometry', () => {
  it.each([
    [
      { x: 200, y: 50 },
      { x: 100, y: 50 },
    ],
    [
      { x: -100, y: 50 },
      { x: 0, y: 50 },
    ],
    [
      { x: 50, y: -100 },
      { x: 50, y: 0 },
    ],
    [
      { x: 50, y: 200 },
      { x: 50, y: 100 },
    ],
    [
      { x: 200, y: 125 },
      { x: 100, y: 75 },
    ],
  ])('attaches to the actual wall in direction %o', (target, expected) => {
    expect(connectionBoundary(room, target)).toEqual(expected);
  });

  it('attaches to an L-shaped wall rather than the empty bounding box', () => {
    const lRoom = {
      ...room,
      geometry: {
        ...room.geometry,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 40 },
          { x: 40, y: 40 },
          { x: 40, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    };
    expect(connectionBoundary(lRoom, { x: 200, y: 20 })).toEqual({ x: 100, y: 40 });
    expect(connectionBoundary(lRoom, { x: 200, y: 200 })).toEqual({ x: 100, y: 40 });
  });

  it('keeps sub-grid precision', () => {
    expect(connectionBoundary(room, { x: 150, y: 51 }).y).toBe(50.5);
  });

  it('does not loop when two endpoints share a wall', () => {
    expect(connectionCurve({ x: 100, y: 50 }, { x: 100, y: 50 })).toBe(
      'M 100 50 C 100 50, 100 50, 100 50',
    );
  });

  it('bends toward the destination when dragging left or upward', () => {
    expect(connectionCurve({ x: 200, y: 80 }, { x: 0, y: 20 })).toBe(
      'M 200 80 C 110 80, 90 20, 0 20',
    );
    expect(connectionCurve({ x: 80, y: 200 }, { x: 20, y: 0 })).toBe(
      'M 80 200 C 80 110, 20 90, 20 0',
    );
  });
});
