import {
  WEEKLY_DIGEST_MEALS,
  WEEKLY_DIGEST_MEAL_WINDOWS,
  digestLocalClock,
  digestShiftDate,
  digestWeekDays,
  digestZonedTime,
  presenceCapabilityForDevice,
  type HomePlan,
  type WeeklyDigestMeal,
  type WeeklyDigestMealState,
  type WeeklyDigestMetrics,
  type WeeklyDigestNightDay,
} from '@elise/contracts';
import {
  bedEpisodes,
  bedNight,
  findBedSensor,
  observedState,
  type HomeEvent,
  type HomeSensor,
} from '../household/home-summary';

/**
 * Measures of one week for the digest, from the events kept on the box. Pure: the service reads
 * the database, this turns rows into numbers. Every value is an estimate; a day whose sensors
 * stayed silent is "unknown", never "nothing happened".
 */

const MINUTE = 60_000;
const MOVEMENT = new Set(['motion', 'occupancy', 'person_presence']);
const CONTACTS = new Set(['contact', 'dry_contact']);
/** A door that stays closed this long with no movement inside starts a probable outing. */
const OUTING_MIN_MS = 10 * MINUTE;
/** Movement right after the door closes is still the person leaving the hall. */
const OUTING_GRACE_MS = 45_000;
/** Movement that close before the door opens shows someone walked to it from inside. */
const OUTING_APPROACH_MS = 5 * MINUTE;
const NIGHT_RISING_GAP_MS = 10 * MINUTE;
const BED_EXIT_MIN_MS = MINUTE;
const SHARED_PRESENCE_GAP_MS = 30 * MINUTE;
/** Calls shorter than this (missed, refused, cut at once) are not counted. */
const CALL_MIN_MS = MINUTE;

type Room = { id: string; name: string; kind: string };

export interface WeekMetricsInput {
  weekStart: string;
  timezone: string;
  now: Date;
  sensors: HomeSensor[];
  /** Contact and movement events of the week, from the Sunday evening before. */
  events: HomeEvent[];
  /** The last state of each sensor before those events. */
  priorStates: HomeEvent[];
  plan: HomePlan | null;
  rooms: Room[];
  /** Local days when the home sent at least one event of any kind. */
  homeDays: ReadonlySet<string>;
  /** Local days when each device (or sensor without device) sent anything, battery included. */
  deviceDays: ReadonlyMap<string, ReadonlySet<string>>;
  /** Starts of presence sessions marked "two rooms at the same time". */
  simultaneousPresence: Date[];
  /** Video calls of the TV, or null when they are not known for this week. */
  calls: Array<{ startedAt: number; endedAt: number; result: string }> | null;
  /** Meal habits given for the resident (local minutes), widening the default windows. */
  mealHabits?: Partial<Record<WeeklyDigestMeal, { startMinute: number; endMinute: number }>>;
}

const deviceKey = (sensor: Pick<HomeSensor, 'id' | 'deviceId'>) => sensor.deviceId ?? sensor.id;

export function computeWeekMetrics(input: WeekMetricsInput): WeeklyDigestMetrics {
  const { weekStart, timezone, plan } = input;
  const days = digestWeekDays(weekStart);
  const weekFrom = digestZonedTime(weekStart, 0, timezone);
  const weekTo = digestZonedTime(digestShiftDate(weekStart, 7), 0, timezone);
  const until = new Date(Math.min(input.now.getTime(), weekTo.getTime()));
  const local = (at: Date) => digestLocalClock(at, timezone);
  const at = (date: string, minute: number) => digestZonedTime(date, minute, timezone);
  const roomById = new Map(input.rooms.map((room) => [room.id, room]));

  const placementFor = (sensor: HomeSensor) =>
    plan?.placements.find(
      (placement) =>
        placement.kind === 'SENSOR' &&
        (placement.equipmentId === sensor.id ||
          (placement.equipmentRefKind === 'DEVICE' && placement.equipmentId === sensor.deviceId)) &&
        (!placement.capabilityBindings.length ||
          placement.capabilityBindings.some((binding) => binding.sensorId === sensor.id)),
    );
  const roleOf = (sensor: HomeSensor) =>
    placementFor(sensor)?.capabilityBindings.find((binding) => binding.sensorId === sensor.id)
      ?.role;
  const roomOf = (sensor: HomeSensor) => {
    const id = placementFor(sensor)?.roomId ?? sensor.roomId;
    return id ? roomById.get(id) : undefined;
  };
  const itemKindOf = (sensor: HomeSensor) => {
    const placement = placementFor(sensor);
    if (placement?.targetType !== 'ITEM') return null;
    return (
      plan?.levels.flatMap((level) => level.items).find((item) => item.id === placement.targetId)
        ?.kind ?? null
    );
  };
  const alive = (sensors: HomeSensor[], date: string) =>
    sensors.some((sensor) => input.deviceDays.get(deviceKey(sensor))?.has(date));

  const bed = findBedSensor(input.sensors, plan, input.rooms);
  const bedSensorId = bed.sensor?.id;
  const movementSensors = input.sensors.filter(
    (sensor) =>
      MOVEMENT.has(presenceCapabilityForDevice(sensor.capability, sensor.device?.model)) &&
      sensor.id !== bedSensorId &&
      roomOf(sensor),
  );
  const isBedroom = (room: Room | undefined) => room?.kind === 'BEDROOM';
  const isKitchen = (room: Room | undefined) =>
    room?.kind === 'KITCHEN' || /cuisine|kitchen|cocina|cucina|cozinha/i.test(room?.name ?? '');
  const doorSensors = input.sensors.filter(
    (sensor) => CONTACTS.has(sensor.capability) && roleOf(sensor) === 'MAIN_ENTRANCE',
  );
  const fridgeSensors = input.sensors.filter(
    (sensor) =>
      CONTACTS.has(sensor.capability) &&
      (roleOf(sensor) === 'FRIDGE' || itemKindOf(sensor) === 'FRIDGE'),
  );
  const kitchenSensors = movementSensors.filter((sensor) => isKitchen(roomOf(sensor)));
  const outsideBedroom = new Set(
    movementSensors.filter((sensor) => !isBedroom(roomOf(sensor))).map((sensor) => sensor.id),
  );
  const movementIds = new Set(movementSensors.map((sensor) => sensor.id));

  const ordered = input.events
    .filter((event) => event.quality === 'good' && event.sensorId && event.occurredAt <= until)
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  const activeMovement = ordered.filter(
    (event) => movementIds.has(event.sensorId!) && observedState(event) === true,
  );

  /** Changes to "open" of the given contact sensors, repeated reports ignored. */
  const openings = (sensorIds: Set<string>) => {
    const previous = new Map<string, boolean>();
    for (const event of input.priorStates) {
      const state = observedState(event);
      if (event.sensorId && sensorIds.has(event.sensorId) && state !== null)
        previous.set(event.sensorId, state);
    }
    const changes: Array<{ sensorId: string; open: boolean; at: Date }> = [];
    for (const event of ordered) {
      if (!sensorIds.has(event.sensorId!)) continue;
      const state = observedState(event);
      if (state === null || previous.get(event.sensorId!) === state) continue;
      previous.set(event.sensorId!, state);
      changes.push({ sensorId: event.sensorId!, open: state, at: event.occurredAt });
    }
    return changes;
  };

  // Nights ---------------------------------------------------------------------------------
  const nightSource = bed.sensor ? 'BED' : movementSensors.length ? 'MOTION' : null;
  const emptyNight = (date: string): WeeklyDigestNightDay => ({
    date,
    bedtimeMinute: null,
    wakeMinute: null,
    inBedMinutes: null,
    risings: null,
  });
  const eveningMinute = (time: Date, night: string) => {
    const clock = local(time);
    return clock.dateKey === night ? clock.minute + 1440 : clock.minute;
  };
  let nightDays: WeeklyDigestNightDay[];
  if (nightSource === 'BED' && bed.sensor) {
    const sensor = bed.sensor;
    const episodes = bedEpisodes(sensor.id, bed.occupiedWhen, ordered, input.priorStates, until);
    const bedChanges = (() => {
      const changes: Array<{ occupied: boolean; at: Date }> = [];
      let previous: boolean | null = null;
      for (const event of ordered) {
        if (event.sensorId !== sensor.id) continue;
        const open = observedState(event);
        if (open === null) continue;
        const occupied = open === (bed.occupiedWhen === 'OPEN');
        if (occupied === previous) continue;
        previous = occupied;
        changes.push({ occupied, at: event.occurredAt });
      }
      return changes;
    })();
    nightDays = days.map((date) => {
      if (!alive([sensor], date) && !alive([sensor], digestShiftDate(date, -1)))
        return emptyNight(date);
      const night = bedNight(episodes, date, timezone, until);
      if (!night) return emptyNight(date);
      const end = night.wakeAt ?? new Date(night.bedtimeAt.getTime() + 14 * 60 * MINUTE);
      // Bed exits of at least a minute, followed by a return before getting up.
      let risings = 0;
      for (let index = 0; index < bedChanges.length - 1; index += 1) {
        const change = bedChanges[index]!;
        const next = bedChanges[index + 1]!;
        if (
          !change.occupied &&
          next.occupied &&
          change.at > night.bedtimeAt &&
          next.at < end &&
          next.at.getTime() - change.at.getTime() >= BED_EXIT_MIN_MS
        )
          risings += 1;
      }
      return {
        date,
        bedtimeMinute: eveningMinute(night.bedtimeAt, date),
        wakeMinute: night.wakeAt ? local(night.wakeAt).minute : null,
        inBedMinutes: Math.round(night.inBedMs / MINUTE),
        risings,
      };
    });
  } else if (nightSource === 'MOTION') {
    const outside = activeMovement.filter((event) => outsideBedroom.has(event.sensorId!));
    nightDays = days.map((date) => {
      if (!input.homeDays.has(date)) return emptyNight(date);
      const evening = digestShiftDate(date, -1);
      const windowStart = at(evening, 19 * 60).getTime();
      const latestBedtime = at(date, 3 * 60).getTime();
      const windowEnd = at(date, 12 * 60).getTime();
      const inWindow = outside.filter(
        (event) =>
          event.occurredAt.getTime() >= windowStart && event.occurredAt.getTime() < windowEnd,
      );
      // Bedtime: the last movement outside the bedroom followed by 90 quiet minutes.
      let bedtime: Date | null = null;
      for (let index = 0; index < inWindow.length; index += 1) {
        const event = inWindow[index]!;
        if (event.occurredAt.getTime() > latestBedtime) break;
        const next = inWindow[index + 1];
        if (!next || next.occurredAt.getTime() - event.occurredAt.getTime() >= 90 * MINUTE) {
          bedtime = event.occurredAt;
          break;
        }
      }
      if (!bedtime) return emptyNight(date);
      // Getting up: the first movement after 04:30 that starts sustained activity.
      const earliestWake = Math.max(
        bedtime.getTime() + 2 * 60 * MINUTE,
        at(date, 4 * 60 + 30).getTime(),
      );
      let wake: Date | null = null;
      for (let index = 0; index < inWindow.length; index += 1) {
        const event = inWindow[index]!;
        if (event.occurredAt.getTime() < earliestWake) continue;
        const following = inWindow
          .slice(index + 1)
          .filter((item) => item.occurredAt.getTime() - event.occurredAt.getTime() <= 30 * MINUTE);
        if (following.length >= 3) {
          wake = event.occurredAt;
          break;
        }
      }
      let risings = 0;
      let last = 0;
      for (const event of inWindow) {
        const time = event.occurredAt.getTime();
        if (time <= bedtime.getTime() + 15 * MINUTE || (wake && time >= wake.getTime())) continue;
        if (!wake && time >= earliestWake) continue;
        if (time - last >= NIGHT_RISING_GAP_MS) risings += 1;
        last = time;
      }
      return {
        date,
        bedtimeMinute: eveningMinute(bedtime, date),
        wakeMinute: wake ? local(wake).minute : null,
        inBedMinutes: wake ? Math.round((wake.getTime() - bedtime.getTime()) / MINUTE) : null,
        risings: wake ? risings : null,
      };
    });
  } else nightDays = days.map(emptyNight);

  // Meals ----------------------------------------------------------------------------------
  const fridgeOpenings = openings(new Set(fridgeSensors.map((sensor) => sensor.id))).filter(
    (change) => change.open,
  );
  const kitchenIds = new Set(kitchenSensors.map((sensor) => sensor.id));
  const kitchenMovement = activeMovement.filter((event) => kitchenIds.has(event.sensorId!));
  const mealWindow = (meal: WeeklyDigestMeal): readonly [number, number] => {
    const habit = input.mealHabits?.[meal];
    const [start, end] = WEEKLY_DIGEST_MEAL_WINDOWS[meal];
    return habit
      ? [Math.min(start, habit.startMinute - 60), Math.max(end, habit.endMinute + 90)]
      : [start, end];
  };
  const mealDays = days.map((date) => {
    const kitchenAlive = alive([...kitchenSensors, ...fridgeSensors], date);
    const meals = Object.fromEntries(
      WEEKLY_DIGEST_MEALS.map((meal) => {
        const [startMinute, endMinute] = mealWindow(meal);
        const start = at(date, startMinute);
        const end = at(date, endMinute);
        let state: WeeklyDigestMealState;
        if (end > until || !kitchenAlive) state = 'UNKNOWN';
        else {
          const fridge = fridgeOpenings.some((change) => change.at >= start && change.at < end);
          const minutes = new Set(
            kitchenMovement
              .filter((event) => event.occurredAt >= start && event.occurredAt < end)
              .map((event) => Math.floor(event.occurredAt.getTime() / MINUTE)),
          );
          state = fridge || minutes.size >= 3 ? 'SEEN' : 'NOT_SEEN';
        }
        return [meal, state];
      }),
    ) as Record<WeeklyDigestMeal, WeeklyDigestMealState>;
    return {
      date,
      meals,
      fridgeOpenings:
        fridgeSensors.length && alive(fridgeSensors, date)
          ? fridgeOpenings.filter((change) => local(change.at).dateKey === date).length
          : null,
    };
  });

  // Outings: the main door opens and closes, then nothing moves inside until it opens again.
  const outingsEquipped = doorSensors.length > 0 && movementSensors.length > 0;
  const outingsByDay = new Map<string, { count: number; minutes: number }>();
  if (outingsEquipped) {
    const doorChanges = openings(new Set(doorSensors.map((sensor) => sensor.id)));
    let lastReturn: Date | null = null;
    for (let index = 0; index < doorChanges.length; index += 1) {
      const opened = doorChanges[index]!;
      if (!opened.open || opened.at < weekFrom) continue;
      const closed = doorChanges
        .slice(index + 1)
        .find((change) => change.sensorId === opened.sensorId && !change.open);
      if (!closed || closed.at.getTime() - opened.at.getTime() > 30 * MINUTE) continue;
      // The door that ends an outing does not start another one.
      if (lastReturn && opened.at.getTime() === lastReturn.getTime()) continue;
      const approached = activeMovement.some(
        (event) =>
          event.occurredAt < opened.at &&
          opened.at.getTime() - event.occurredAt.getTime() <= OUTING_APPROACH_MS,
      );
      if (!approached) continue;
      const nextOpening = doorChanges.slice(index + 1).find((change) => change.open);
      const back = nextOpening?.at ?? until;
      const movedInside = activeMovement.some(
        (event) =>
          event.occurredAt.getTime() > closed.at.getTime() + OUTING_GRACE_MS &&
          event.occurredAt < back,
      );
      if (movedInside || back.getTime() - closed.at.getTime() < OUTING_MIN_MS) continue;
      lastReturn = nextOpening?.at ?? null;
      const day = local(opened.at).dateKey;
      const entry = outingsByDay.get(day) ?? { count: 0, minutes: 0 };
      entry.count += 1;
      entry.minutes += Math.round(
        (Math.min(back.getTime(), weekTo.getTime()) - opened.at.getTime()) / MINUTE,
      );
      outingsByDay.set(day, entry);
    }
  }
  const dayStarted = (date: string) => at(date, 0) < until;

  // Moments when two distant rooms moved together.
  const presenceEquipped =
    new Set(movementSensors.map((sensor) => roomOf(sensor)?.id).filter(Boolean)).size >= 2;
  const presenceByDay = new Map<string, number>();
  let lastMoment = 0;
  for (const start of [...input.simultaneousPresence].sort((a, b) => a.getTime() - b.getTime())) {
    if (start < weekFrom || start >= weekTo) continue;
    if (start.getTime() - lastMoment >= SHARED_PRESENCE_GAP_MS) {
      const day = local(start).dateKey;
      presenceByDay.set(day, (presenceByDay.get(day) ?? 0) + 1);
    }
    lastMoment = start.getTime();
  }

  // Video calls of the TV.
  const callsByDay = new Map<string, { count: number; minutes: number }>();
  for (const call of input.calls ?? []) {
    if (call.result !== 'ended' || call.endedAt - call.startedAt < CALL_MIN_MS) continue;
    const started = new Date(call.startedAt);
    if (started < weekFrom || started >= weekTo) continue;
    const day = local(started).dateKey;
    const entry = callsByDay.get(day) ?? { count: 0, minutes: 0 };
    entry.count += 1;
    entry.minutes += Math.round((call.endedAt - call.startedAt) / MINUTE);
    callsByDay.set(day, entry);
  }

  return {
    version: 1,
    weekStart,
    days: days.map((date) => ({ date, hasData: input.homeDays.has(date) })),
    nights: { source: nightSource, days: nightDays },
    meals: { equipped: fridgeSensors.length > 0 || kitchenSensors.length > 0, days: mealDays },
    outings: {
      equipped: outingsEquipped,
      days: days.map((date) => {
        const known = outingsEquipped && dayStarted(date) && alive(doorSensors, date);
        const entry = outingsByDay.get(date);
        return {
          date,
          count: known ? (entry?.count ?? 0) : null,
          minutes: known ? (entry?.minutes ?? 0) : null,
        };
      }),
    },
    calls: {
      available: input.calls !== null,
      days: days.map((date) => {
        const entry = callsByDay.get(date);
        return input.calls !== null && dayStarted(date)
          ? { date, count: entry?.count ?? 0, minutes: entry?.minutes ?? 0 }
          : { date, count: null, minutes: null };
      }),
    },
    sharedPresence: {
      equipped: presenceEquipped,
      days: days.map((date) => ({
        date,
        count: presenceEquipped && input.homeDays.has(date) ? (presenceByDay.get(date) ?? 0) : null,
      })),
    },
  };
}
