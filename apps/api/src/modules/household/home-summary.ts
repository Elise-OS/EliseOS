import {
  DEFAULT_ALERT_RULE_SETTINGS,
  isBedOccupancySensorModel,
  presenceCapabilityForDevice,
  type AlertRuleSettings,
  type HomePlan,
  type HomeSummary,
} from '@michel/contracts';

export type HomeEvent = {
  id?: string;
  sensorId: string | null;
  roomId: string | null;
  capability: string;
  payload: unknown;
  quality: string;
  occurredAt: Date;
};
export type HomeSensor = {
  id: string;
  deviceId: string | null;
  roomId: string | null;
  capability: string;
  status: string;
  available: boolean;
  unit?: string | null;
  device?: { model: string | null; lastSeenAt?: Date | null } | null;
  events: HomeEvent[];
};
type Room = { id: string; name: string; kind: string };
const roomSummaryHiddenCapabilities = new Set(['battery', 'voltage', 'signal_strength']);
const TOILET_PASSAGE_GAP_MS = 10 * 60_000;

export const SHOWER_DETECTION_SETTINGS = {
  startRisePercent: 8,
  endRisePercent: 4,
  baselineWindowMs: 30 * 60_000,
  confirmationWindowMs: 15 * 60_000,
  endConfirmationMs: 10 * 60_000,
  maxDurationMs: 90 * 60_000,
  staleAfterMs: 30 * 60_000,
} as const;

type HumidityReading = { value: number; occurredAt: Date };
type ShowerEpisode = {
  startedAt: Date;
  endedAt: Date | null;
  baselineHumidity: number;
  peakHumidity: number;
  lastAboveThresholdAt: Date;
};

function numericHumidity(payload: unknown): number | null {
  const raw = record(payload).value ?? record(payload).state;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100) return raw;
  if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) {
    const value = Number(raw);
    return value >= 0 && value <= 100 ? value : null;
  }
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function minutesBetween(startedAt: Date, endedAt: Date): number {
  return Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
}

function unavailableShowerDetection(
  latest: HumidityReading | undefined,
): HomeSummary['roomSummaries'][number]['shower'] {
  return {
    state: 'UNAVAILABLE',
    currentHumidity: latest?.value ?? null,
    baselineHumidity: null,
    risePercent: null,
    startedAt: null,
    endedAt: null,
    durationMinutes: null,
    updatedAt: latest?.occurredAt.toISOString() ?? null,
  };
}

function detectShowerForReadings(
  readings: HumidityReading[],
  now: Date,
): NonNullable<HomeSummary['roomSummaries'][number]['shower']> {
  const latest = readings.at(-1);
  if (
    !latest ||
    now.getTime() - latest.occurredAt.getTime() > SHOWER_DETECTION_SETTINGS.staleAfterMs
  )
    return unavailableShowerDetection(latest)!;

  const baselineAt = (index: number) => {
    const current = readings[index]!;
    const cutoff = current.occurredAt.getTime() - SHOWER_DETECTION_SETTINGS.baselineWindowMs;
    return median(
      readings
        .slice(0, index)
        .filter(({ occurredAt }) => occurredAt.getTime() >= cutoff)
        .map(({ value }) => value),
    );
  };

  let candidate: { startedAt: Date; baselineHumidity: number } | null = null;
  let active: ShowerEpisode | null = null;
  let completed: ShowerEpisode | null = null;

  for (let index = 0; index < readings.length; index += 1) {
    const reading = readings[index]!;
    if (active) {
      const rise = reading.value - active.baselineHumidity;
      active.peakHumidity = Math.max(active.peakHumidity, reading.value);
      if (rise >= SHOWER_DETECTION_SETTINGS.startRisePercent)
        active.lastAboveThresholdAt = reading.occurredAt;
      if (
        rise <= SHOWER_DETECTION_SETTINGS.endRisePercent &&
        reading.occurredAt.getTime() - active.lastAboveThresholdAt.getTime() >=
          SHOWER_DETECTION_SETTINGS.endConfirmationMs
      ) {
        active.endedAt = reading.occurredAt;
        completed = active;
        active = null;
      } else if (
        reading.occurredAt.getTime() - active.startedAt.getTime() >=
        SHOWER_DETECTION_SETTINGS.maxDurationMs
      ) {
        active.endedAt = reading.occurredAt;
        completed = active;
        active = null;
      }
      continue;
    }

    const baseline = baselineAt(index);
    if (candidate) {
      const withinConfirmationWindow =
        reading.occurredAt.getTime() - candidate.startedAt.getTime() <=
        SHOWER_DETECTION_SETTINGS.confirmationWindowMs;
      if (
        withinConfirmationWindow &&
        reading.value - candidate.baselineHumidity >= SHOWER_DETECTION_SETTINGS.startRisePercent
      ) {
        active = {
          startedAt: candidate.startedAt,
          endedAt: null,
          baselineHumidity: candidate.baselineHumidity,
          peakHumidity: reading.value,
          lastAboveThresholdAt: reading.occurredAt,
        };
        candidate = null;
        continue;
      }
      if (
        !withinConfirmationWindow ||
        reading.value - candidate.baselineHumidity < SHOWER_DETECTION_SETTINGS.startRisePercent
      )
        candidate = null;
    }
    if (baseline !== null && reading.value - baseline >= SHOWER_DETECTION_SETTINGS.startRisePercent)
      candidate = { startedAt: reading.occurredAt, baselineHumidity: baseline };
  }

  const current = latest.value;
  if (active) {
    return {
      state: 'IN_PROGRESS',
      currentHumidity: current,
      baselineHumidity: active.baselineHumidity,
      risePercent: current - active.baselineHumidity,
      startedAt: active.startedAt.toISOString(),
      endedAt: null,
      durationMinutes: minutesBetween(active.startedAt, latest.occurredAt),
      updatedAt: latest.occurredAt.toISOString(),
    };
  }
  if (candidate) {
    return {
      state: 'RISING',
      currentHumidity: current,
      baselineHumidity: candidate.baselineHumidity,
      risePercent: current - candidate.baselineHumidity,
      startedAt: candidate.startedAt.toISOString(),
      endedAt: null,
      durationMinutes: null,
      updatedAt: latest.occurredAt.toISOString(),
    };
  }
  if (completed?.endedAt) {
    return {
      state: 'COMPLETED',
      currentHumidity: current,
      baselineHumidity: completed.baselineHumidity,
      risePercent: completed.peakHumidity - completed.baselineHumidity,
      startedAt: completed.startedAt.toISOString(),
      endedAt: completed.endedAt.toISOString(),
      durationMinutes: minutesBetween(completed.startedAt, completed.endedAt),
      updatedAt: latest.occurredAt.toISOString(),
    };
  }
  return {
    state: 'IDLE',
    currentHumidity: current,
    baselineHumidity: baselineAt(readings.length - 1),
    risePercent: null,
    startedAt: null,
    endedAt: null,
    durationMinutes: null,
    updatedAt: latest.occurredAt.toISOString(),
  };
}

export function detectShower(
  sensors: HomeSensor[],
  events: HomeEvent[],
  now: Date = new Date(),
): NonNullable<HomeSummary['roomSummaries'][number]['shower']> {
  const humiditySensors = sensors.filter(({ capability }) => capability === 'humidity');
  if (!humiditySensors.length) return unavailableShowerDetection(undefined)!;

  const eventBySensor = new Map<string, Map<number, HumidityReading>>();
  for (const sensor of humiditySensors) eventBySensor.set(sensor.id, new Map());
  for (const event of [...events, ...humiditySensors.flatMap(({ events: latest }) => latest)]) {
    if (!event.sensorId || !eventBySensor.has(event.sensorId) || event.quality !== 'good') continue;
    const value = numericHumidity(event.payload);
    if (value === null) continue;
    eventBySensor.get(event.sensorId)!.set(event.occurredAt.getTime(), {
      value,
      occurredAt: event.occurredAt,
    });
  }

  const detections = humiditySensors.map((sensor) => {
    const readings = [...(eventBySensor.get(sensor.id)?.values() ?? [])].sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    );
    const latest = readings.at(-1);
    if (!sensor.available || sensor.status !== 'ONLINE') return unavailableShowerDetection(latest)!;
    return detectShowerForReadings(readings, now);
  });
  const active = detections
    .filter(({ state }) => state === 'IN_PROGRESS' || state === 'RISING')
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))[0];
  if (active) return active;
  const completed = detections
    .filter(({ state }) => state === 'COMPLETED')
    .sort((left, right) => (right.endedAt ?? '').localeCompare(left.endedAt ?? ''))[0];
  if (completed) return completed;
  const available = detections.filter(({ state }) => state !== 'UNAVAILABLE')[0];
  return available ?? detections[0]!;
}

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
export function observedState(event: HomeEvent): boolean | null {
  const payload = record(event.payload);
  const value = ['contact', 'dry_contact'].includes(event.capability)
    ? (payload.open ?? payload.active)
    : payload.active;
  return typeof value === 'boolean' ? value : null;
}

const BED_OCCUPANCY_MIN_MS = 20 * 60_000;
const BED_EXIT_CONFIRM_MS = 30 * 60_000;
const OVERNIGHT_MIN_MS = 2 * 60 * 60_000;
const NIGHT_INTERRUPTION_MAX_MS = 2 * 60 * 60_000;

function nextLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

function localSleepTime(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

/** A wired pressure contact reports occupancy, not sleep itself. Keep only sustained
 * overnight episodes and confirm departures before showing daily landmarks. */
export function buildSleepSummary(
  sensors: HomeSensor[],
  events: HomeEvent[],
  priorStates: HomeEvent[],
  plan: HomePlan | null,
  rooms: Room[],
  timezone: string,
  now: Date,
): NonNullable<HomeSummary['sleep']> {
  const bedrooms = rooms.filter(({ kind }) => kind === 'BEDROOM');
  const bindings = (plan?.placements ?? [])
    .filter((placement) => placement.kind === 'SENSOR')
    .flatMap((placement) =>
      placement.capabilityBindings
        .filter(({ role }) => role === 'BED')
        .map((binding) => ({ placement, binding })),
    );
  const selected = bindings
    .map(({ placement, binding }) => {
      const sensor = sensors.find(
        ({ id, deviceId, capability, device }) =>
          id === binding.sensorId &&
          (['contact', 'dry_contact'].includes(capability) ||
            (capability === 'occupancy' && isBedOccupancySensorModel(device?.model))) &&
          (placement.equipmentId === id ||
            (placement.equipmentRefKind === 'DEVICE' && placement.equipmentId === deviceId)),
      );
      return {
        room: bedrooms.find(({ id }) => id === placement.roomId),
        sensor,
        occupiedWhen:
          binding.bedOccupiedWhen ?? (sensor?.capability === 'occupancy' ? 'OPEN' : 'CLOSED'),
      };
    })
    .find(({ room, sensor }) => room && sensor);
  const result: NonNullable<HomeSummary['sleep']> = {
    roomId: selected?.room?.id ?? bedrooms[0]?.id ?? null,
    configured: Boolean(selected),
    available: false,
    occupied: null,
    bedtimeAt: null,
    wakeAt: null,
  };
  if (!selected?.sensor) return result;
  const { sensor, occupiedWhen } = selected;
  const currentEvent = sensor.events[0];
  const currentOpen = currentEvent ? observedState(currentEvent) : null;
  result.available = Boolean(
    sensor.available &&
    sensor.status === 'ONLINE' &&
    currentEvent?.quality === 'good' &&
    currentOpen !== null,
  );
  if (result.available && currentOpen !== null)
    result.occupied = currentOpen === (occupiedWhen === 'OPEN');

  const series = events
    .filter(
      ({ sensorId, quality, occurredAt }) =>
        sensorId === sensor.id && quality === 'good' && occurredAt <= now,
    )
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  const prior = priorStates.find(
    ({ sensorId, quality }) => sensorId === sensor.id && quality === 'good',
  );
  const priorOpen = prior ? observedState(prior) : null;
  let occupied: boolean | null =
    priorOpen === null ? null : priorOpen === (occupiedWhen === 'OPEN');
  let startedAt: Date | null = null;
  let emptySince: Date | null = null;
  const episodes: Array<{ start: Date; end: Date | null }> = [];
  for (const event of series) {
    const open = observedState(event);
    if (open === null) continue;
    const nextOccupied = open === (occupiedWhen === 'OPEN');
    if (occupied === null) {
      occupied = nextOccupied;
      continue;
    }
    if (nextOccupied === occupied) continue;
    occupied = nextOccupied;
    if (nextOccupied) {
      if (startedAt && emptySince) {
        if (event.occurredAt.getTime() - emptySince.getTime() >= BED_EXIT_CONFIRM_MS) {
          episodes.push({ start: startedAt, end: emptySince });
          startedAt = event.occurredAt;
        }
      } else startedAt = event.occurredAt;
      emptySince = null;
    } else if (startedAt) emptySince = event.occurredAt;
  }
  if (startedAt) {
    const end =
      emptySince && now.getTime() - emptySince.getTime() >= BED_EXIT_CONFIRM_MS ? emptySince : null;
    episodes.push({ start: startedAt, end });
  }
  const today = localSleepTime(now, timezone).date;
  const byNight = new Map<string, typeof episodes>();
  for (const episode of episodes) {
    const localStart = localSleepTime(episode.start, timezone);
    if (localStart.minute >= 12 * 60 && localStart.minute < 18 * 60) continue;
    const night = localStart.minute >= 18 * 60 ? nextLocalDate(localStart.date) : localStart.date;
    const group = byNight.get(night) ?? [];
    group.push(episode);
    byNight.set(night, group);
  }
  // The daily cards describe the night that ended today. Ignore a new bedtime
  // from this evening, whose night key is tomorrow.
  const night = byNight.has(today) ? today : null;
  if (!night) return result;
  const chains: Array<typeof episodes> = [];
  for (const episode of byNight.get(night)!) {
    const lastChain = chains.at(-1);
    const previous = lastChain?.at(-1);
    if (
      !previous?.end ||
      episode.start.getTime() - previous.end.getTime() > NIGHT_INTERRUPTION_MAX_MS
    )
      chains.push([episode]);
    else lastChain!.push(episode);
  }
  const occupiedDuration = (chain: typeof episodes) =>
    chain.reduce(
      (sum, episode) => sum + (episode.end ?? now).getTime() - episode.start.getTime(),
      0,
    );
  const selectedChain = chains
    .filter((chain) => {
      const minute = localSleepTime(chain[0]!.start, timezone).minute;
      return (
        (minute >= 18 * 60 || minute < 4 * 60) && occupiedDuration(chain) >= BED_OCCUPANCY_MIN_MS
      );
    })
    .sort((left, right) => occupiedDuration(right) - occupiedDuration(left))[0];
  if (!selectedChain) return result;
  result.bedtimeAt = selectedChain[0]!.start.toISOString();
  const last = selectedChain.at(-1)!;
  if (last.end && occupiedDuration(selectedChain) >= OVERNIGHT_MIN_MS) {
    const localEnd = localSleepTime(last.end, timezone);
    if (localEnd.date === today && localEnd.minute >= 4 * 60 && localEnd.minute < 12 * 60)
      result.wakeAt = last.end.toISOString();
  }
  return result;
}

export function latestPresenceEvidence(
  sensors: HomeSensor[],
  events: HomeEvent[],
  now: Date = new Date(),
) {
  void now;
  const sensorById = new Map(sensors.map((sensor) => [sensor.id, sensor]));
  const latestBySensor = new Map<string, HomeEvent>();
  for (const event of [...events, ...sensors.flatMap((sensor) => sensor.events)]) {
    if (
      event.quality !== 'good' ||
      !event.sensorId ||
      !event.roomId ||
      !['motion', 'occupancy', 'person_presence'].includes(event.capability)
    )
      continue;
    const active = observedState(event);
    if (active === null) continue;
    const previous = latestBySensor.get(event.sensorId);
    if (!previous || event.occurredAt >= previous.occurredAt)
      latestBySensor.set(event.sensorId, event);
  }
  const candidates: Array<HomeEvent & { capability: string }> = [];
  for (const [sensorId, latest] of latestBySensor) {
    const sensor = sensorById.get(sensorId);
    if (!sensor || !sensor.available || sensor.status !== 'ONLINE') continue;
    if (observedState(latest) !== true) continue;
    const capability = presenceCapabilityForDevice(latest.capability, sensor.device?.model);
    const verifiedAt =
      capability !== 'motion' &&
      sensor.device?.lastSeenAt &&
      sensor.device.lastSeenAt > latest.occurredAt
        ? sensor.device.lastSeenAt
        : latest.occurredAt;
    candidates.push({
      ...latest,
      occurredAt: verifiedAt,
      capability,
    });
  }
  return candidates
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    .at(-1);
}

export function buildHomeCards(
  sensors: HomeSensor[],
  events: HomeEvent[],
  plan: HomePlan | null,
  rooms: Room[],
  rules: AlertRuleSettings = DEFAULT_ALERT_RULE_SETTINGS,
  now: Date = new Date(),
) {
  const cards = new Map<string, HomeSummary['cards'][number]>();
  const activityRooms: string[] = [];
  const targets = new Map<string, string>();
  const movement = new Set(['motion', 'occupancy', 'person_presence']);
  for (const sensor of sensors) {
    const placement = plan?.placements.find(
      (p) =>
        p.kind === 'SENSOR' &&
        (p.equipmentId === sensor.id ||
          (p.equipmentRefKind === 'DEVICE' && p.equipmentId === sensor.deviceId)) &&
        (!p.capabilityBindings.length ||
          p.capabilityBindings.some((b) => b.sensorId === sensor.id)),
    );
    const room = rooms.find((r) => r.id === (placement?.roomId ?? sensor.roomId));
    if (!room) continue;
    const item = plan?.levels.flatMap((l) => l.items).find((i) => i.id === placement?.targetId);
    const role = placement?.capabilityBindings.find((b) => b.sensorId === sensor.id)?.role;
    if (
      ['contact', 'dry_contact'].includes(sensor.capability) &&
      (role === 'MAIN_ENTRANCE' || role === 'BED')
    )
      continue;
    let kind: HomeSummary['cards'][number]['kind'];
    if (['contact', 'dry_contact'].includes(sensor.capability))
      kind = item?.kind === 'FRIDGE' || role === 'FRIDGE' ? 'FRIDGE' : 'OPENING';
    else if (movement.has(sensor.capability))
      kind = room.kind === 'TOILET' || /toilette|\bwc\b/i.test(room.name) ? 'TOILET' : 'ROOM';
    else if (['switch', 'power', 'energy', 'current'].includes(sensor.capability)) {
      if (
        !item &&
        sensors.some(
          (s) =>
            s.deviceId &&
            s.deviceId === sensor.deviceId &&
            (movement.has(s.capability) || s.capability === 'contact'),
        )
      )
        continue;
      kind = 'APPLIANCE';
    } else if (
      ['temperature', 'humidity', 'co2', 'voc', 'pm25', 'air_quality', 'illuminance'].includes(
        sensor.capability,
      )
    )
      kind = 'COMFORT';
    else if (
      ['water_leak', 'smoke', 'carbon_monoxide', 'fall_detection', 'button'].includes(
        sensor.capability,
      )
    )
      kind = 'SAFETY';
    else continue;
    const id = `${kind}:${item?.id ?? (['contact', 'dry_contact'].includes(sensor.capability) ? (sensor.deviceId ?? sensor.id) : room.id)}`;
    targets.set(sensor.id, id);
    const latest = sensor.events[0];
    const available = sensor.available && sensor.status === 'ONLINE' && latest?.quality === 'good';
    let state = latest && available ? observedState(latest) : null;
    if (sensor.capability === 'temperature' && latest && available) {
      const value = record(latest.payload).value;
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (rules.lowTemperature.enabled || rules.highTemperature.enabled)
      ) {
        state =
          (rules.lowTemperature.enabled && value < rules.lowTemperature.celsius) ||
          (rules.highTemperature.enabled && value > rules.highTemperature.celsius);
      }
    }
    const existing = cards.get(id);
    const updatedAt = latest?.occurredAt.toISOString() ?? null;
    const card = existing ?? {
      id,
      kind,
      label: room.name,
      available: true,
      observedToday: false,
      countToday: 0,
      lastObservedAt: null,
      state: 'UNKNOWN' as const,
      updatedAt: null,
    };
    card.available = card.available && Boolean(available);
    if (updatedAt && (!card.updatedAt || updatedAt > card.updatedAt)) card.updatedAt = updatedAt;
    if (card.state !== 'ACTIVE')
      card.state = state === null ? card.state : state ? 'ACTIVE' : 'INACTIVE';
    cards.set(id, card);
  }
  const previous = new Map<string, boolean>();
  const lastToiletMovementAt = new Map<string, number>();
  for (const event of events) {
    if (event.quality !== 'good' || !event.sensorId) continue;
    const card = cards.get(targets.get(event.sensorId) ?? '');
    if (!card) continue;
    const state = observedState(event);
    if (state === null) continue;
    const repeated = previous.get(event.sensorId) === state;
    previous.set(event.sensorId, state);
    if (!state || repeated) continue;
    card.observedToday = true;
    const occurredAt = event.occurredAt.getTime();
    const toiletMovement = card.kind === 'TOILET' && movement.has(event.capability);
    const lastToiletMovement = lastToiletMovementAt.get(card.id);
    if (
      !toiletMovement ||
      lastToiletMovement === undefined ||
      occurredAt - lastToiletMovement >= TOILET_PASSAGE_GAP_MS
    ) {
      card.countToday += 1;
    }
    if (toiletMovement) lastToiletMovementAt.set(card.id, occurredAt);
    card.lastObservedAt = event.occurredAt.toISOString();
    if (movement.has(event.capability) && !activityRooms.includes(card.label))
      activityRooms.push(card.label);
  }
  const roomSummaries = rooms.map((room) => {
    const planRoom = plan?.levels
      .flatMap((level) => level.rooms)
      .find((item) => item.id === room.id);
    const roomSensors = sensors.filter((sensor) => {
      if (roomSummaryHiddenCapabilities.has(sensor.capability)) return false;
      const placement = plan?.placements.find(
        (p) =>
          p.kind === 'SENSOR' &&
          (p.equipmentId === sensor.id ||
            (p.equipmentRefKind === 'DEVICE' && p.equipmentId === sensor.deviceId)) &&
          (!p.capabilityBindings.length ||
            p.capabilityBindings.some((b) => b.sensorId === sensor.id)),
      );
      return (placement?.roomId ?? sensor.roomId) === room.id;
    });
    const shower = room.kind === 'BATHROOM' ? detectShower(roomSensors, events, now) : null;
    return {
      roomId: room.id,
      name: room.name,
      kind: room.kind,
      color: planRoom?.geometry.color ?? null,
      shower,
      sensors: roomSensors.map((sensor) => {
        const latest = sensor.events[0];
        const payload = latest ? record(latest.payload) : {};
        const available = Boolean(
          sensor.available && sensor.status === 'ONLINE' && latest?.quality === 'good',
        );
        const raw = ['contact', 'dry_contact'].includes(sensor.capability)
          ? (payload.open ?? payload.active)
          : (payload.value ?? payload.active ?? payload.state);
        const value =
          typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
            ? raw
            : null;
        const observed = available && latest ? observedState(latest) : null;
        return {
          capability: sensor.capability,
          value,
          unit:
            typeof payload.unit === 'string'
              ? payload.unit
              : (sensor.unit ??
                (sensor.capability === 'temperature'
                  ? '°C'
                  : sensor.capability === 'humidity'
                    ? '%'
                    : null)),
          state:
            observed === null
              ? ('UNKNOWN' as const)
              : observed
                ? ('ACTIVE' as const)
                : ('INACTIVE' as const),
          available,
          updatedAt: latest?.occurredAt.toISOString() ?? null,
        };
      }),
    };
  });
  return { cards: [...cards.values()], activityRooms, roomSummaries };
}
