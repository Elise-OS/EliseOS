import { Injectable } from '@nestjs/common';
import {
  homePlanSchema,
  normalizedEventSchema,
  presenceCapabilityForDevice,
  type HomePlan,
  type NormalizedEvent,
} from '@michel/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { connectionsFromPlan, PresenceSessionService } from './presence-session.service';
import { PresenceTrackingService } from './presence-tracking.service';

function zigbeeIdentifierFromEntityId(entityId: string): string | null {
  return entityId.toLowerCase().match(/0x[0-9a-f]{16}/)?.[0] ?? null;
}

@Injectable()
export class IngestionService {
  private readonly presenceSessions = new PresenceSessionService();
  private readonly presenceTracking = new PresenceTrackingService();

  public constructor(private readonly prisma: PrismaService) {}

  public async ingest(unknownEvent: unknown): Promise<{ accepted: boolean; id?: string }> {
    const event = normalizedEventSchema.parse(unknownEvent);
    const existing = await this.prisma.observationEvent.findUnique({
      where: { sourceEventId: event.eventId },
    });
    if (existing) return { accepted: false, id: existing.id };
    return this.prisma.$transaction(async (tx) => {
      const zigbeeIdentifier = zigbeeIdentifierFromEntityId(event.source.entityId);
      const device = event.source.deviceId
        ? await tx.device.upsert({
            where: {
              homeId_sourceDeviceId: {
                homeId: event.homeId,
                sourceDeviceId: event.source.deviceId,
              },
            },
            update: {
              name: event.source.name ?? event.source.entityId,
              manufacturer: event.source.manufacturer ?? null,
              model: event.source.model ?? null,
              ...(zigbeeIdentifier
                ? {
                    networkIdentifier: zigbeeIdentifier,
                    protocol: 'zigbee',
                    integration: 'zigbee2mqtt',
                  }
                : {}),
              lastSeenAt: new Date(event.occurredAt),
            },
            create: {
              homeId: event.homeId,
              sourceDeviceId: event.source.deviceId,
              name: event.source.name ?? event.source.entityId,
              manufacturer: event.source.manufacturer ?? null,
              model: event.source.model ?? null,
              networkIdentifier: zigbeeIdentifier,
              protocol: zigbeeIdentifier ? 'zigbee' : null,
              integration: zigbeeIdentifier ? 'zigbee2mqtt' : null,
              lastSeenAt: new Date(event.occurredAt),
            },
          })
        : null;
      if (device && zigbeeIdentifier) {
        await tx.device.update({
          where: { id: device.id },
          data: {
            installationStatus: device.roomId ? 'OPERATIONAL' : 'NEEDS_PLACEMENT',
          },
        });
      }
      const sensor = await tx.sensor.upsert({
        where: { homeId_entityId: { homeId: event.homeId, entityId: event.source.entityId } },
        update: {
          capability: event.capability,
          deviceId: device?.id ?? null,
          sourceName: event.source.name ?? null,
          available: true,
          unavailableSince: null,
          removedAt: null,
          status: event.quality === 'good' ? 'ONLINE' : 'DEGRADED',
          lastSeenAt: new Date(event.occurredAt),
        },
        create: {
          homeId: event.homeId,
          entityId: event.source.entityId,
          deviceId: device?.id ?? null,
          sourceName: event.source.name ?? null,
          capability: event.capability,
          status: event.quality === 'good' ? 'ONLINE' : 'DEGRADED',
          lastSeenAt: new Date(event.occurredAt),
        },
      });
      const storedPlan = await tx.homePlan.findUnique({ where: { homeId: event.homeId } });
      const parsedPlan = storedPlan ? homePlanSchema.safeParse(storedPlan.data) : null;
      const placement = parsedPlan?.success
        ? parsedPlan.data.placements.find(
            (item) =>
              item.kind === 'SENSOR' &&
              (item.equipmentId === sensor.id ||
                (device && item.equipmentRefKind === 'DEVICE' && item.equipmentId === device.id)),
          )
        : undefined;
      const target =
        placement && parsedPlan?.success
          ? this.targetContext(
              parsedPlan.data,
              placement.targetType,
              placement.targetId ?? placement.roomId,
            )
          : null;
      const binding = placement?.capabilityBindings.find(
        (item) => item.sensorId === sensor.id || item.capability === event.capability,
      );
      const role = binding?.role ?? null;
      const context = {
        roomId: placement?.roomId ?? sensor.roomId ?? null,
        targetType: placement?.targetType ?? null,
        targetId: placement?.targetId ?? null,
        targetKind: target?.kind ?? null,
        role,
        ...(role === 'BED' ? { bedOccupiedWhen: binding?.bedOccupiedWhen ?? 'CLOSED' } : {}),
        confidence: placement ? ('HIGH' as const) : ('LOW' as const),
        summary:
          role === 'BED'
            ? 'État du lit mis à jour.'
            : target
              ? this.contextSummary(event.capability, target.label)
              : null,
      };
      const eventRoomId = context.roomId;
      const roomConfidence =
        event.quality === 'good'
          ? context.confidence
          : event.quality === 'degraded'
            ? 'MEDIUM'
            : 'LOW';
      const enrichedPayload = { ...event.payload, context };
      const saved = await tx.observationEvent.create({
        data: {
          homeId: event.homeId,
          sensorId: sensor.id,
          roomId: eventRoomId,
          roomSource: placement ? 'PLAN_PLACEMENT' : eventRoomId ? 'SENSOR_ASSIGNMENT' : null,
          roomConfidence,
          sourceEventId: event.eventId,
          capability: event.capability,
          quality: event.quality,
          payload: enrichedPayload,
          occurredAt: new Date(event.occurredAt),
          receivedAt: new Date(event.receivedAt),
        },
      });
      if (!sensor.analysisEnabled) return { accepted: true, id: saved.id };
      if (['motion', 'occupancy', 'person_presence'].includes(event.capability)) {
        const presenceCapability = presenceCapabilityForDevice(event.capability, device?.model);
        const camera =
          event.capability === 'person_presence'
            ? await tx.camera.findFirst({
                where: { homeId: event.homeId, personEntityId: event.source.entityId },
                select: { id: true },
              })
            : null;
        const residentId =
          (
            await tx.home.findUnique({
              where: { id: event.homeId },
              select: { primaryResidentId: true },
            })
          )?.primaryResidentId ?? null;
        const presenceEvidence = {
          eventId: saved.id,
          homeId: event.homeId,
          residentId,
          roomId: eventRoomId,
          sensorId: sensor.id,
          capability: presenceCapability,
          active: typeof event.payload.active === 'boolean' ? event.payload.active : null,
          occurredAt: new Date(event.occurredAt),
          confidence: roomConfidence,
          source: camera ? 'CAMERA' : 'SENSOR',
        } as const;
        const tracking = await this.presenceTracking.process(tx, {
          ...presenceEvidence,
          plan: parsedPlan?.success ? parsedPlan.data : null,
        });
        if (tracking.acceptedForSession) {
          await this.presenceSessions.process(tx, {
            ...presenceEvidence,
            confidence: tracking.confidence,
            connectedRoomIds: connectionsFromPlan(
              parsedPlan?.success ? parsedPlan.data : undefined,
            ),
          });
          if (tracking.replacementEvidence)
            await this.presenceSessions.process(tx, {
              ...tracking.replacementEvidence,
              connectedRoomIds: connectionsFromPlan(
                parsedPlan?.success ? parsedPlan.data : undefined,
              ),
            });
        }
      }
      if (event.capability === 'person_presence' && event.payload.active === true) {
        await tx.camera.updateMany({
          where: { homeId: event.homeId, personEntityId: event.source.entityId },
          data: {
            lastPersonSeenAt: new Date(event.occurredAt),
            lastSeenAt: new Date(event.occurredAt),
            status: 'ONLINE',
          },
        });
      }
      await tx.outboxMessage.create({
        data: {
          homeId: event.homeId,
          topic: 'ai.score',
          payload: this.features(event) as Prisma.InputJsonObject,
        },
      });
      const securityType =
        event.capability === 'water_leak'
          ? 'WATER_LEAK'
          : event.capability === 'smoke'
            ? 'SMOKE'
            : event.capability === 'carbon_monoxide'
              ? 'CARBON_MONOXIDE'
              : event.capability === 'button' &&
                  (role?.toUpperCase() === 'ASSISTANCE' ||
                    event.payload.action === 'sos' ||
                    event.payload.action === 'release')
                ? 'SOS'
                : null;
      const securityActive =
        securityType !== null &&
        event.payload.active !== false &&
        event.payload.action !== 'release' &&
        (securityType === 'SOS'
          ? event.payload.action === 'sos' || role?.toUpperCase() === 'ASSISTANCE'
          : event.payload.active === true);
      const securityAlert =
        securityActive && securityType === 'WATER_LEAK'
          ? {
              type: 'WATER_LEAK' as const,
              title: 'Fuite d’eau détectée',
              explanation: 'Un capteur signale de l’eau dans le logement.',
            }
          : securityActive && securityType === 'SMOKE'
            ? {
                type: 'SMOKE' as const,
                title: 'Fumée détectée',
                explanation: 'Un détecteur de fumée a été déclenché.',
              }
            : securityActive && securityType === 'CARBON_MONOXIDE'
              ? {
                  type: 'CARBON_MONOXIDE' as const,
                  title: 'Monoxyde de carbone détecté',
                  explanation: 'Un détecteur de monoxyde de carbone a été déclenché.',
                }
              : securityActive && securityType === 'SOS'
                ? {
                    type: 'SOS' as const,
                    title: 'Bouton d’assistance activé',
                    explanation: 'Le bouton d’assistance du domicile a été activé.',
                  }
                : null;
      if (securityType) {
        const ruleKey = `security:${securityType}:${sensor.id}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ruleKey}))`;
        const newerEvent = await tx.observationEvent.findFirst({
          where: { sensorId: sensor.id, occurredAt: { gt: new Date(event.occurredAt) } },
          select: { id: true },
        });
        if (newerEvent) return { accepted: true, id: saved.id };
        const current = await tx.alert.findFirst({
          where: {
            homeId: event.homeId,
            ruleKey,
          },
          orderBy: { openedAt: 'desc' },
        });
        if (!securityAlert) {
          if (current && !current.conditionClearedAt)
            await tx.alert.update({
              where: { id: current.id },
              data: { conditionClearedAt: new Date(event.occurredAt) },
            });
          return { accepted: true, id: saved.id };
        }
        const clearedForTwoMinutes =
          current?.conditionClearedAt &&
          new Date(event.occurredAt).getTime() - current.conditionClearedAt.getTime() >= 2 * 60_000;
        if (current && ['OPEN', 'ACKNOWLEDGED'].includes(current.status)) {
          if (!clearedForTwoMinutes) {
            if (current.conditionClearedAt)
              await tx.alert.update({
                where: { id: current.id },
                data: { conditionClearedAt: null },
              });
            return { accepted: true, id: saved.id };
          }
          await tx.alert.update({
            where: { id: current.id },
            data: { status: 'RESOLVED', resolvedAt: new Date(event.occurredAt) },
          });
          await tx.alertTransition.create({
            data: {
              alertId: current.id,
              userId: null,
              from: current.status,
              to: 'RESOLVED',
              note: 'Signal revenu à la normale avant une nouvelle activation',
            },
          });
          await tx.outboxMessage.create({
            data: {
              homeId: event.homeId,
              topic: 'webhook',
              payload: { event: 'alert.resolved', alertId: current.id },
            },
          });
        }
        if (current && !current.conditionClearedAt) return { accepted: true, id: saved.id };
        if (current && !clearedForTwoMinutes) return { accepted: true, id: saved.id };
        const alert = await tx.alert.create({
          data: {
            homeId: event.homeId,
            roomId: placement?.roomId ?? sensor.roomId,
            ruleKey,
            type: securityAlert.type,
            severity: 'URGENT',
            title: securityAlert.title,
            explanation: target
              ? `${securityAlert.explanation} Emplacement : ${target.label}.`
              : securityAlert.explanation,
          },
        });
        await tx.outboxMessage.create({
          data: {
            homeId: event.homeId,
            topic: 'webhook',
            payload: { event: 'alert.opened', alertId: alert.id },
          },
        });
        await tx.outboxMessage.create({
          data: {
            homeId: event.homeId,
            topic: 'camera.snapshot',
            payload: { alertId: alert.id },
          },
        });
        await tx.outboxMessage.create({
          data: {
            homeId: event.homeId,
            topic: 'push',
            payload: { event: 'alert.opened', alertId: alert.id },
          },
        });
      }
      return { accepted: true, id: saved.id };
    });
  }

  private targetContext(plan: HomePlan, type: 'ROOM' | 'ITEM' | 'OPENING' | 'STAIR', id: string) {
    if (type === 'ROOM') {
      const room = plan.levels.flatMap(({ rooms }) => rooms).find((item) => item.id === id);
      return room ? { label: room.name, kind: room.kind } : null;
    }
    if (type === 'ITEM') {
      const item = plan.levels
        .flatMap(({ items }) => items)
        .find((candidate) => candidate.id === id);
      return item ? { label: this.itemLabel(item.kind), kind: item.kind } : null;
    }
    if (type === 'OPENING') {
      const opening = plan.levels
        .flatMap(({ openings }) => openings)
        .find((candidate) => candidate.id === id);
      return opening
        ? {
            label: opening.isMainEntrance ? 'entrée principale' : opening.kind.toLowerCase(),
            kind: opening.kind,
          }
        : null;
    }
    const stair = plan.levels
      .flatMap(({ stairs }) => stairs)
      .find((candidate) => candidate.id === id);
    return stair ? { label: 'escalier', kind: 'STAIR' } : null;
  }

  private contextSummary(capability: string, label: string) {
    if (capability === 'power') return `Activité probable de ${label}.`;
    if (capability === 'contact') return `Ouverture détectée sur ${label}.`;
    if (['motion', 'occupancy', 'person_presence'].includes(capability))
      return `Présence probable près de ${label}.`;
    if (capability === 'water_leak') return `Fuite possible près de ${label}.`;
    return `Mesure contextualisée près de ${label}.`;
  }

  private itemLabel(kind: string) {
    return (
      {
        COFFEE_MACHINE: 'la cafetière',
        KETTLE: 'la bouilloire',
        FRIDGE: 'le réfrigérateur',
        SINK: 'l’évier',
        WASHING_MACHINE: 'le lave-linge',
        DISHWASHER: 'le lave-vaisselle',
        MEDICAL_DEVICE: 'l’appareil médical',
        POWER_OUTLET: 'la prise',
      }[kind] ?? kind.toLocaleLowerCase('fr').replaceAll('_', ' ')
    );
  }

  private features(event: NormalizedEvent): Record<string, unknown> {
    const timestamp = new Date(event.occurredAt);
    return {
      home_id: event.homeId,
      observed_at: event.occurredAt,
      features: {
        hour_sin: Math.sin((timestamp.getHours() / 24) * Math.PI * 2),
        hour_cos: Math.cos((timestamp.getHours() / 24) * Math.PI * 2),
        capability_code: [
          'motion',
          'occupancy',
          'person_presence',
          'contact',
          'button',
          'temperature',
          'humidity',
          'power',
          'energy',
          'battery',
        ].indexOf(event.capability),
        quality: event.quality === 'good' ? 1 : 0,
      },
    };
  }
}
