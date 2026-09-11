import { homePlanSchema, type HomePlan, type SensorOnboardingCompletion } from '@michel/contracts';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Assignment = {
  homeId: string;
  equipmentId: string;
  standalone: boolean;
  sensors: Array<{ id: string; capability: string }>;
  input: SensorOnboardingCompletion;
  resolve: (
    plan: HomePlan,
    roomId: string,
    target: NonNullable<SensorOnboardingCompletion['target']>,
    capabilities: string[],
  ) => { x: number; y: number };
};

/** Called inside the same transaction as the device update. Revision checks
 * protect against an editor saving over a concurrent installation. */
export async function assignSensorToPlan(tx: Prisma.TransactionClient, assignment: Assignment) {
  const { homeId, equipmentId, standalone, sensors, input, resolve } = assignment;
  const record = await tx.homePlan.findUnique({ where: { homeId } });
  if (!record) {
    if (input.target)
      throw new UnprocessableEntityException('Le logement ne possède pas encore de plan.');
    return;
  }
  const plan = homePlanSchema.parse(record.data);
  const sensorIds = new Set(sensors.map(({ id }) => id));
  const belongs = (placement: HomePlan['placements'][number]) =>
    placement.kind === 'SENSOR' &&
    ((placement.equipmentRefKind === 'DEVICE' &&
      !standalone &&
      placement.equipmentId === equipmentId) ||
      (placement.equipmentRefKind !== 'DEVICE' && sensorIds.has(placement.equipmentId)));
  const previous = plan.placements.find(belongs);
  plan.placements = plan.placements.filter((placement) => !belongs(placement));
  if (input.roomId) {
    const floor = plan.levels.find(({ rooms }) => rooms.some(({ id }) => id === input.roomId));
    if (!floor)
      throw new UnprocessableEntityException('La pièce n’existe pas dans le plan enregistré.');
    // A rename/reassignment within the same room must not erase an opening binding.
    const target =
      input.target ??
      (previous?.roomId === input.roomId && previous.targetId
        ? { type: previous.targetType, id: previous.targetId }
        : { type: 'ROOM' as const, id: input.roomId });
    const at = resolve(
      plan,
      input.roomId,
      target,
      sensors.map(({ capability }) => capability),
    );
    plan.placements.push({
      id: previous?.id ?? `placement-sensor-${equipmentId}`,
      kind: 'SENSOR',
      equipmentId,
      equipmentRefKind: standalone ? 'SENSOR_ENTITY' : 'DEVICE',
      roomId: input.roomId,
      floorId: floor.id,
      targetType: target.type,
      targetId: target.id,
      openingId: target.type === 'OPENING' ? target.id : null,
      placementNote:
        input.placementNote === undefined ? previous?.placementNote : input.placementNote,
      capabilityBindings: sensors.map((sensor) => ({
        sensorId: sensor.id,
        capability: sensor.capability,
        role:
          previous?.capabilityBindings.find(({ sensorId }) => sensorId === sensor.id)?.role ??
          (sensor.capability === 'button'
            ? (input.buttonRole ?? 'ASSISTANCE')
            : sensor.capability.toUpperCase()),
      })),
      ...at,
      rotation: previous?.rotation ?? 0,
    });
  }
  plan.revision = record.revision + 1;
  const result = await tx.homePlan.updateMany({
    where: { id: record.id, revision: record.revision },
    data: { data: plan, revision: plan.revision },
  });
  if (result.count !== 1)
    throw new ConflictException('Le plan a déjà été modifié. Réessayez l’association.');
}
