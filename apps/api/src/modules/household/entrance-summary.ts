import type { EntranceSummary, HomePlan } from '@michel/contracts';
import { observedState, type HomeEvent, type HomeSensor } from './home-summary';

export const ENTRANCE_WINDOW_MS = 3 * 60_000;
const motion = new Set(['motion', 'occupancy', 'person_presence']);

/** Infer a passage from the configured main entrance and its connected indoor path.
 * This describes an anonymous probable passage, never a resident identification.
 */
export function buildEntranceSummary(
  sensors: HomeSensor[],
  events: HomeEvent[],
  plan: HomePlan | null,
  now: Date,
  priorStates: HomeEvent[] = [],
): EntranceSummary | null {
  if (!plan) return null;
  const mainPlacements = plan.placements.filter(
    (p) =>
      p.kind === 'SENSOR' &&
      p.capabilityBindings.some((b) => b.capability === 'contact' && b.role === 'MAIN_ENTRANCE'),
  );
  const roomId =
    new Set(mainPlacements.map((p) => p.roomId)).size === 1 ? mainPlacements[0]?.roomId : undefined;
  if (!roomId) return null;
  const roomName =
    plan.levels.flatMap((l) => l.rooms).find((r) => r.id === roomId)?.name ?? 'Entrée';
  const stairs = new Set(
    plan.levels
      .flatMap((l) => l.stairs)
      .filter((s) => s.fromRoomId === roomId || s.toRoomId === roomId)
      .map((s) => s.id),
  );
  const placementFor = (sensor: HomeSensor) =>
    plan.placements.find(
      (p) =>
        p.kind === 'SENSOR' &&
        (p.equipmentId === sensor.id ||
          (p.equipmentRefKind === 'DEVICE' && p.equipmentId === sensor.deviceId)) &&
        (!p.capabilityBindings.length ||
          p.capabilityBindings.some((b) => b.sensorId === sensor.id)),
    );
  const doorSensors = sensors.filter((s) => {
    const p = placementFor(s);
    return (
      s.capability === 'contact' &&
      p &&
      p.roomId === roomId &&
      p.capabilityBindings.some((b) => b.sensorId === s.id && b.role === 'MAIN_ENTRANCE')
    );
  });
  const pathSensors = sensors.filter((s) => {
    const p = placementFor(s);
    return (
      motion.has(s.capability) &&
      p &&
      (p.targetType === 'STAIR'
        ? stairs.has(p.targetId ?? '')
        : p.targetType === 'ROOM' && p.roomId === roomId)
    );
  });
  const result: EntranceSummary = {
    state: 'NO_PASSAGE',
    reason: 'NO_OPENING',
    roomName,
    openedAt: null,
    closedAt: null,
    evidenceAt: null,
    evaluateAfter: null,
    windowSeconds: ENTRANCE_WINDOW_MS / 1000,
  };
  const healthy = (s: HomeSensor) =>
    s.available && s.status === 'ONLINE' && s.events[0]?.quality === 'good';
  if (
    !doorSensors.length ||
    !pathSensors.length ||
    ![...doorSensors, ...pathSensors].every(healthy)
  )
    return { ...result, state: 'UNAVAILABLE', reason: 'SENSOR_UNAVAILABLE' };
  const doors = new Set(doorSensors.map((s) => s.id));
  const paths = new Set(pathSensors.map((s) => s.id));
  const indoors = new Set(
    sensors
      .filter((s) => motion.has(s.capability) && (placementFor(s)?.roomId ?? s.roomId))
      .map((s) => s.id),
  );
  const ordered = events
    .filter((e) => e.quality === 'good' && e.occurredAt <= now && e.sensorId)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const previous = new Map<string, boolean>();
  for (const e of priorStates) {
    const state = observedState(e);
    if (e.sensorId && e.quality === 'good' && state !== null) previous.set(e.sensorId, state);
  }
  let opened: HomeEvent | undefined;
  let closed: HomeEvent | undefined;
  for (const event of ordered) {
    if (!doors.has(event.sensorId!)) continue;
    const state = observedState(event);
    if (state === null || previous.get(event.sensorId!) === state) continue;
    previous.set(event.sensorId!, state);
    if (state) {
      opened = event;
      closed = undefined;
    } else if (opened && event.sensorId === opened.sensorId) closed = event;
  }
  if (!opened) return result;
  const openTime = opened.occurredAt.getTime();
  const closeTime = closed?.occurredAt.getTime();
  const deadline = (closeTime ?? openTime) + ENTRANCE_WINDOW_MS;
  result.openedAt = opened.occurredAt.toISOString();
  result.closedAt = closed?.occurredAt.toISOString() ?? null;
  result.evaluateAfter = new Date(deadline).toISOString();
  const active = ordered.filter((e) => observedState(e) === true && indoors.has(e.sensorId!));
  const following = active.find(
    (e) =>
      paths.has(e.sensorId!) &&
      e.occurredAt.getTime() > openTime &&
      e.occurredAt.getTime() <= deadline,
  );
  if (following)
    return {
      ...result,
      state: 'ENTRY_LIKELY',
      reason: 'FOLLOWED_BY_MOVEMENT',
      evidenceAt: following.occurredAt.toISOString(),
    };
  const later = active.find((e) => e.occurredAt.getTime() > openTime);
  if (later)
    return {
      ...result,
      state: 'INSIDE_ACTIVITY',
      reason: 'LATER_ACTIVITY',
      evidenceAt: later.occurredAt.toISOString(),
    };
  if (!closed)
    return {
      ...result,
      state: now.getTime() < deadline ? 'PENDING' : 'UNCERTAIN',
      reason: now.getTime() < deadline ? 'WAITING' : 'INSUFFICIENT_SEQUENCE',
    };
  if (now.getTime() < deadline) return { ...result, state: 'PENDING', reason: 'WAITING' };
  const before = active
    .filter(
      (e) =>
        paths.has(e.sensorId!) &&
        e.occurredAt.getTime() < openTime &&
        e.occurredAt.getTime() >= openTime - ENTRANCE_WINDOW_MS,
    )
    .at(-1);
  // Missing data is not evidence of absence. A bad observation during the episode invalidates an exit inference.
  const broken = events.some(
    (e) =>
      e.occurredAt.getTime() >= openTime &&
      e.quality !== 'good' &&
      (doors.has(e.sensorId ?? '') || paths.has(e.sensorId ?? '')),
  );
  if (!before || broken) return { ...result, state: 'UNCERTAIN', reason: 'INSUFFICIENT_SEQUENCE' };
  return {
    ...result,
    state: 'EXIT_LIKELY',
    reason: 'NO_MOVEMENT_AFTER_EXIT',
    evidenceAt: before.occurredAt.toISOString(),
  };
}
