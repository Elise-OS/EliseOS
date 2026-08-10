import { Injectable } from '@nestjs/common';
import { normalizedEventSchema, type NormalizedEvent } from '@michel/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';

@Injectable()
export class IngestionService {
  public constructor(private readonly prisma: PrismaService) {}

  public async ingest(unknownEvent: unknown): Promise<{ accepted: boolean; id?: string }> {
    const event = normalizedEventSchema.parse(unknownEvent);
    const existing = await this.prisma.observationEvent.findUnique({
      where: { sourceEventId: event.eventId },
    });
    if (existing) return { accepted: false, id: existing.id };
    return this.prisma.$transaction(async (tx) => {
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
              lastSeenAt: new Date(event.occurredAt),
            },
            create: {
              homeId: event.homeId,
              sourceDeviceId: event.source.deviceId,
              name: event.source.name ?? event.source.entityId,
              manufacturer: event.source.manufacturer ?? null,
              model: event.source.model ?? null,
              lastSeenAt: new Date(event.occurredAt),
            },
          })
        : null;
      const sensor = await tx.sensor.upsert({
        where: { homeId_entityId: { homeId: event.homeId, entityId: event.source.entityId } },
        update: {
          capability: event.capability,
          deviceId: device?.id ?? null,
          sourceName: event.source.name ?? null,
          available: true,
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
      const saved = await tx.observationEvent.create({
        data: {
          homeId: event.homeId,
          sensorId: sensor.id,
          sourceEventId: event.eventId,
          capability: event.capability,
          quality: event.quality,
          payload: event.payload as Prisma.InputJsonObject,
          occurredAt: new Date(event.occurredAt),
          receivedAt: new Date(event.receivedAt),
        },
      });
      await tx.outboxMessage.create({
        data: {
          homeId: event.homeId,
          topic: 'ai.score',
          payload: this.features(event) as Prisma.InputJsonObject,
        },
      });
      if (event.capability === 'button' && event.payload.action === 'sos') {
        const alert = await tx.alert.create({
          data: {
            homeId: event.homeId,
            type: 'SOS',
            severity: 'URGENT',
            title: 'Bouton SOS activé',
            explanation: 'Le bouton SOS du domicile a été activé.',
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
            topic: 'push',
            payload: { event: 'alert.opened', alertId: alert.id },
          },
        });
      }
      return { accepted: true, id: saved.id };
    });
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
