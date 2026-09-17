import { describe, expect, it } from 'vitest';
import type { HomePlan } from '@michel/contracts';
import { buildEntranceSummary } from './entrance-summary';
import type { HomeEvent, HomeSensor } from './home-summary';
const event = (
  sensorId: string,
  seconds: number,
  active: boolean,
  quality = 'good',
): HomeEvent => ({
  sensorId,
  roomId: 'entry',
  capability: sensorId === 'door' ? 'contact' : 'motion',
  payload: sensorId === 'door' ? { open: active } : { active },
  quality,
  occurredAt: new Date(Date.UTC(2026, 8, 15, 10, 0, seconds)),
});
const plan = {
  levels: [
    {
      rooms: [
        { id: 'entry', name: 'Entrée' },
        { id: 'salon', name: 'Salon' },
      ],
      openings: [],
      stairs: [{ id: 'stairs', fromRoomId: 'entry', toRoomId: 'salon' }],
    },
  ],
  placements: [
    {
      kind: 'SENSOR',
      equipmentId: 'door',
      targetType: 'ROOM',
      targetId: null,
      roomId: 'entry',
      capabilityBindings: [{ sensorId: 'door', capability: 'contact', role: 'MAIN_ENTRANCE' }],
    },
    {
      kind: 'SENSOR',
      equipmentId: 'pir',
      targetType: 'STAIR',
      targetId: 'stairs',
      roomId: 'entry',
      capabilityBindings: [],
    },
  ],
} as unknown as HomePlan;
const sensors: HomeSensor[] = ['door', 'pir', 'salon'].map((id) => ({
  id,
  deviceId: null,
  roomId: id === 'salon' ? 'salon' : 'entry',
  capability: id === 'door' ? 'contact' : 'motion',
  status: 'ONLINE',
  available: true,
  events: [event(id, 0, false)],
}));
const at = (seconds: number) => event('door', seconds, false).occurredAt;
const infer = (events: HomeEvent[], seconds = 300) =>
  buildEntranceSummary(sensors, events, plan, at(seconds));
describe('main entrance sequence inference', () => {
  it('infers entry from door then movement on the connected stair', () => {
    expect(infer([event('door', 0, true), event('pir', 30, true)])?.state).toBe('ENTRY_LIKELY');
  });
  it('waits three minutes after closure before inferring exit', () => {
    const events = [event('pir', -30, true), event('door', 0, true), event('door', 20, false)];
    expect(infer(events, 199)?.state).toBe('PENDING');
    expect(infer(events, 200)?.state).toBe('EXIT_LIKELY');
  });
  it('does not infer exit from silence alone or a negative movement', () => {
    expect(infer([event('door', 0, true), event('door', 20, false)])?.state).toBe('UNCERTAIN');
    expect(
      infer([event('pir', -10, false), event('door', 0, true), event('door', 20, false)])?.state,
    ).toBe('UNCERTAIN');
  });
  it('invalidates an exit when activity resumes in any indoor room', () => {
    expect(
      infer([
        event('pir', -30, true),
        event('door', 0, true),
        event('door', 20, false),
        event('salon', 250, true),
      ])?.state,
    ).toBe('INSIDE_ACTIVITY');
  });
  it('keeps an unclosed door and conflicting evidence uncertain', () => {
    expect(infer([event('pir', -10, true), event('door', 0, true)])?.state).toBe('UNCERTAIN');
    expect(
      infer([
        event('pir', -10, true),
        event('door', 0, true),
        event('door', 20, false),
        event('pir', 30, true, 'degraded'),
      ])?.state,
    ).toBe('UNCERTAIN');
  });
  it('does not infer absence when a required sensor is unavailable', () => {
    expect(
      buildEntranceSummary(
        sensors.map((s) => ({ ...s, status: 'OFFLINE' })),
        [],
        plan,
        at(300),
      )?.state,
    ).toBe('UNAVAILABLE');
  });
  it('deduplicates open state repetitions without restarting the window', () => {
    expect(
      infer(
        [
          event('pir', -10, true),
          event('door', 0, true),
          event('door', 10, true),
          event('door', 20, false),
        ],
        200,
      )?.openedAt,
    ).toBe(at(0).toISOString());
  });
  it('uses the latest passage when someone returns', () => {
    expect(
      infer([
        event('pir', -10, true),
        event('door', 0, true),
        event('door', 20, false),
        event('door', 230, true),
        event('pir', 240, true),
      ])?.state,
    ).toBe('ENTRY_LIKELY');
  });
  it('ignores snapshots of a door already open before the window', () => {
    expect(
      buildEntranceSummary(sensors, [event('door', 0, true)], plan, at(300), [
        event('door', -500, true),
      ])?.state,
    ).toBe('NO_PASSAGE');
  });
  it('does not treat an unrelated stair as the entrance path', () => {
    const unrelated = {
      ...plan,
      levels: plan.levels.map((l) => ({
        ...l,
        stairs: l.stairs.map((s) => ({ ...s, fromRoomId: 'other', toRoomId: 'bedroom' })),
      })),
    };
    expect(buildEntranceSummary(sensors, [], unrelated, at(300))?.state).toBe('UNAVAILABLE');
  });
  it('does not use legacy drawn doors without a main-entrance sensor role', () => {
    const legacy = {
      ...plan,
      placements: [],
      levels: plan.levels.map((l) => ({
        ...l,
        openings: [
          {
            id: 'legacy',
            kind: 'DOOR' as const,
            isMainEntrance: true,
            roomIds: ['entry'],
            x: 0,
            y: 0,
            width: 80,
            rotation: 0,
          },
        ],
      })),
    };
    expect(buildEntranceSummary(sensors, [], legacy, at(300))).toBeNull();
  });
  it('does not invent an entrance if none is configured', () => {
    expect(buildEntranceSummary(sensors, [], null, at(300))).toBeNull();
  });
});
