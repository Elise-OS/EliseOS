import { digestShiftDate, digestWeekDays, type HomePlan } from '@elise/contracts';
import { describe, expect, it } from 'vitest';
import type { HomeEvent, HomeSensor } from '../household/home-summary';
import { computeWeekMetrics, type WeekMetricsInput } from './week-metrics';

const tz = 'Europe/Paris';
const WEEK = '2026-11-16';
const DAYS = digestWeekDays(WEEK);
/** Paris is UTC+1 in November. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`);

const rooms = [
  { id: 'bedroom', name: 'Chambre', kind: 'BEDROOM' },
  { id: 'kitchen', name: 'Cuisine', kind: 'KITCHEN' },
  { id: 'hall', name: 'Entrée', kind: 'ENTRANCE' },
  { id: 'living', name: 'Salon', kind: 'LIVING_ROOM' },
];
const sensor = (id: string, capability: string, roomId: string): HomeSensor => ({
  id,
  deviceId: `device-${id}`,
  roomId,
  capability,
  status: 'ONLINE',
  available: true,
  device: { model: null },
  events: [],
});
const sensors = [
  sensor('bed', 'contact', 'bedroom'),
  sensor('fridge', 'contact', 'kitchen'),
  sensor('door', 'contact', 'hall'),
  sensor('kitchen-motion', 'motion', 'kitchen'),
  sensor('hall-motion', 'motion', 'hall'),
  sensor('living-motion', 'motion', 'living'),
];
const placement = (id: string, roomId: string, role?: string) => ({
  id: `placement-${id}`,
  kind: 'SENSOR' as const,
  equipmentId: id,
  roomId,
  floorId: 'ground',
  openingId: null,
  targetType: 'ROOM' as const,
  targetId: null,
  capabilityBindings: role ? [{ sensorId: id, capability: 'contact', role }] : [],
  x: 0,
  y: 0,
  rotation: 0,
});
const plan = {
  placements: [
    placement('bed', 'bedroom', 'BED'),
    placement('fridge', 'kitchen', 'FRIDGE'),
    placement('door', 'hall', 'MAIN_ENTRANCE'),
  ],
  levels: [],
} as unknown as HomePlan;

let sequence = 0;
const event = (sensorId: string, time: Date, payload: Record<string, unknown>): HomeEvent => ({
  id: `event-${(sequence += 1)}`,
  sensorId,
  roomId: sensors.find((item) => item.id === sensorId)?.roomId ?? null,
  capability: sensors.find((item) => item.id === sensorId)?.capability ?? 'motion',
  payload,
  quality: 'good',
  occurredAt: time,
});
const motion = (sensorId: string, time: Date) => event(sensorId, time, { active: true });
// The bed contact is closed while someone lies on it.
const bed = (time: Date, occupied: boolean) => event('bed', time, { open: !occupied });
const contact = (sensorId: string, time: Date, open: boolean) => event(sensorId, time, { open });

/** An ordinary day: night ending that morning, three meals, one outing in the afternoon. */
function ordinaryDay(date: string, options: { wake?: string; outing?: boolean } = {}) {
  const evening = digestShiftDate(date, -1);
  const wake = options.wake ?? '07:15';
  const events = [
    motion('living-motion', at(evening, '22:00')),
    bed(at(evening, '22:10'), true),
    // A trip to the toilet at night: out of bed for 6 minutes.
    bed(at(date, '03:00'), false),
    bed(at(date, '03:06'), true),
    bed(at(date, wake), false),
    motion('kitchen-motion', at(date, '08:00')),
    contact('fridge', at(date, '08:02'), true),
    contact('fridge', at(date, '08:03'), false),
    motion('kitchen-motion', at(date, '12:10')),
    motion('kitchen-motion', at(date, '12:14')),
    motion('kitchen-motion', at(date, '12:20')),
    contact('fridge', at(date, '19:05'), true),
    contact('fridge', at(date, '19:06'), false),
  ];
  if (options.outing !== false)
    events.push(
      motion('hall-motion', at(date, '15:00')),
      contact('door', at(date, '15:01'), true),
      contact('door', at(date, '15:02'), false),
      contact('door', at(date, '16:10'), true),
      motion('hall-motion', at(date, '16:10')),
      contact('door', at(date, '16:11'), false),
    );
  return events;
}

const allDevices = (days: string[]) =>
  new Map(sensors.map((item) => [item.deviceId!, new Set(days)]));

function input(overrides: Partial<WeekMetricsInput> = {}): WeekMetricsInput {
  return {
    weekStart: WEEK,
    timezone: tz,
    now: at('2026-11-23', '10:00'),
    sensors,
    events: DAYS.flatMap((date) => ordinaryDay(date)),
    // Before the week: bed empty, doors closed.
    priorStates: [
      bed(at('2026-11-15', '12:00'), false),
      contact('fridge', at('2026-11-15', '12:00'), false),
      contact('door', at('2026-11-15', '12:00'), false),
    ],
    plan,
    rooms,
    homeDays: new Set(DAYS),
    deviceDays: allDevices([digestShiftDate(WEEK, -1), ...DAYS]),
    simultaneousPresence: [],
    calls: [],
    ...overrides,
  };
}

describe('computeWeekMetrics', () => {
  it('measures a full week: nights, meals, outings', () => {
    const metrics = computeWeekMetrics(input());
    expect(metrics.weekStart).toBe(WEEK);
    expect(metrics.days.every((day) => day.hasData)).toBe(true);
    expect(metrics.nights.source).toBe('BED');
    expect(metrics.nights.days[0]).toEqual({
      date: WEEK,
      bedtimeMinute: 22 * 60 + 10,
      wakeMinute: 7 * 60 + 15,
      inBedMinutes: 545,
      risings: 1,
    });
    expect(metrics.meals.equipped).toBe(true);
    expect(metrics.meals.days[0]).toEqual({
      date: WEEK,
      meals: { BREAKFAST: 'SEEN', LUNCH: 'SEEN', DINNER: 'SEEN' },
      fridgeOpenings: 2,
    });
    expect(metrics.outings.equipped).toBe(true);
    expect(metrics.outings.days.map((day) => day.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(metrics.outings.days[0]!.minutes).toBe(69);
  });

  it('sees a meal with no kitchen activity, and a later getting up', () => {
    const events = DAYS.flatMap((date, index) =>
      ordinaryDay(date, index === 2 ? { wake: '08:20' } : {}).filter(
        (item) =>
          !(
            index === 3 &&
            item.sensorId === 'kitchen-motion' &&
            item.occurredAt.getUTCHours() === 11
          ),
      ),
    );
    const metrics = computeWeekMetrics(input({ events }));
    expect(metrics.nights.days[2]!.wakeMinute).toBe(8 * 60 + 20);
    expect(metrics.meals.days[3]!.meals.LUNCH).toBe('NOT_SEEN');
    expect(metrics.meals.days[3]!.meals.DINNER).toBe('SEEN');
  });

  it('does not take a still person for an outing', () => {
    const date = DAYS[0]!;
    const events = [
      ...ordinaryDay(date, { outing: false }),
      // Someone opens the door to the nurse, then sits down: movement inside before it opens again.
      motion('hall-motion', at(date, '15:00')),
      contact('door', at(date, '15:01'), true),
      contact('door', at(date, '15:02'), false),
      motion('living-motion', at(date, '15:20')),
      contact('door', at(date, '16:10'), true),
      contact('door', at(date, '16:11'), false),
    ];
    const metrics = computeWeekMetrics(input({ events }));
    expect(metrics.outings.days[0]!.count).toBe(0);
  });

  it('says "unknown" for days without data instead of "nothing happened"', () => {
    const silent = new Set([DAYS[1]!, DAYS[2]!]);
    const metrics = computeWeekMetrics(
      input({
        events: DAYS.filter((date) => !silent.has(date)).flatMap((date) => ordinaryDay(date)),
        homeDays: new Set(DAYS.filter((date) => !silent.has(date))),
        deviceDays: allDevices([
          digestShiftDate(WEEK, -1),
          ...DAYS.filter((date) => !silent.has(date)),
        ]),
      }),
    );
    expect(metrics.days.filter((day) => !day.hasData).map((day) => day.date)).toEqual([
      DAYS[1],
      DAYS[2],
    ]);
    expect(metrics.meals.days[1]!.meals).toEqual({
      BREAKFAST: 'UNKNOWN',
      LUNCH: 'UNKNOWN',
      DINNER: 'UNKNOWN',
    });
    expect(metrics.meals.days[1]!.fridgeOpenings).toBeNull();
    expect(metrics.outings.days[1]!.count).toBeNull();
    expect(metrics.nights.days[2]!.wakeMinute).toBeNull();
  });

  it('says what is not equipped', () => {
    const metrics = computeWeekMetrics(
      input({ sensors: [sensor('living-motion', 'motion', 'living')], plan: null, calls: null }),
    );
    expect(metrics.meals.equipped).toBe(false);
    expect(metrics.outings.equipped).toBe(false);
    expect(metrics.outings.days.every((day) => day.count === null)).toBe(true);
    expect(metrics.calls.available).toBe(false);
    expect(metrics.sharedPresence.equipped).toBe(false);
    // Without a bed sensor, nights are estimated from movements.
    expect(metrics.nights.source).toBe('MOTION');
  });

  it('estimates nights from movements outside the bedroom without a bed sensor', () => {
    const date = DAYS[0]!;
    const evening = digestShiftDate(date, -1);
    const events = [
      motion('living-motion', at(evening, '21:30')),
      motion('living-motion', at(evening, '22:20')),
      motion('hall-motion', at(date, '02:40')),
      motion('kitchen-motion', at(date, '07:30')),
      motion('kitchen-motion', at(date, '07:35')),
      motion('living-motion', at(date, '07:45')),
      motion('kitchen-motion', at(date, '07:50')),
    ];
    const metrics = computeWeekMetrics(
      input({ sensors: sensors.filter((item) => item.id !== 'bed'), events }),
    );
    expect(metrics.nights.source).toBe('MOTION');
    expect(metrics.nights.days[0]).toMatchObject({
      bedtimeMinute: 22 * 60 + 20,
      wakeMinute: 7 * 60 + 30,
      risings: 1,
    });
  });

  it('counts video calls that really took place, and moments with two rooms at once', () => {
    const date = DAYS[4]!;
    const metrics = computeWeekMetrics(
      input({
        calls: [
          {
            startedAt: at(date, '17:00').getTime(),
            endedAt: at(date, '17:20').getTime(),
            result: 'ended',
          },
          {
            startedAt: at(date, '18:00').getTime(),
            endedAt: at(date, '18:00').getTime() + 20_000,
            result: 'ended',
          },
          {
            startedAt: at(date, '19:00').getTime(),
            endedAt: at(date, '19:05').getTime(),
            result: 'refused',
          },
        ],
        simultaneousPresence: [at(date, '10:00'), at(date, '10:10'), at(date, '15:00')],
      }),
    );
    expect(metrics.calls.days[4]).toEqual({ date, count: 1, minutes: 20 });
    expect(metrics.sharedPresence.days[4]).toEqual({ date, count: 2 });
    expect(metrics.sharedPresence.days[0]).toEqual({ date: DAYS[0], count: 0 });
  });

  it('leaves the evening meals of an unfinished Sunday unknown', () => {
    const metrics = computeWeekMetrics(input({ now: at(DAYS[6]!, '20:05') }));
    expect(metrics.meals.days[6]!.meals.DINNER).toBe('UNKNOWN');
    expect(metrics.meals.days[6]!.meals.LUNCH).toBe('SEEN');
  });
});
