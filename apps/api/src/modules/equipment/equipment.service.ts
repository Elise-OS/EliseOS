import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  capabilitySchema,
  homeAssistantInventorySchema,
  homeAssistantStateSchema,
  mappingTransformSchema,
  type Capability,
} from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { IngestionService } from '../sensing/ingestion.service';

const ADMIN_ROLES = ['OWNER', 'ADMINISTRATOR'] as const;

@Injectable()
export class EquipmentService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  public async ingestInventory(payload: unknown): Promise<void> {
    const inventory = homeAssistantInventorySchema.parse(payload);
    const home = await this.prisma.home.findUnique({
      where: { id: inventory.homeId },
      select: { id: true },
    });
    if (!home) return;

    await this.prisma.$transaction(async (tx) => {
      const deviceIds = new Map<string, string>();
      for (const source of inventory.devices) {
        const device = await tx.device.upsert({
          where: {
            homeId_sourceDeviceId: { homeId: inventory.homeId, sourceDeviceId: source.deviceId },
          },
          update: {
            name: source.name,
            manufacturer: source.manufacturer ?? null,
            model: source.model ?? null,
            lastSeenAt: new Date(inventory.generatedAt),
          },
          create: {
            homeId: inventory.homeId,
            sourceDeviceId: source.deviceId,
            name: source.name,
            manufacturer: source.manufacturer ?? null,
            model: source.model ?? null,
            lastSeenAt: new Date(inventory.generatedAt),
          },
        });
        deviceIds.set(source.deviceId, device.id);
      }

      const seenEntityIds: string[] = [];
      for (const entity of inventory.entities) {
        seenEntityIds.push(entity.entityId);
        await tx.sensor.upsert({
          where: { homeId_entityId: { homeId: inventory.homeId, entityId: entity.entityId } },
          update: {
            deviceId: entity.deviceId ? (deviceIds.get(entity.deviceId) ?? null) : null,
            sourceName: entity.name,
            domain: entity.domain,
            deviceClass: entity.deviceClass ?? null,
            unit: entity.unit ?? null,
            capability: entity.capability ?? 'unknown',
            compatibility: entity.compatibility,
            available: entity.available,
            status: entity.available ? 'ONLINE' : 'OFFLINE',
            removedAt: null,
          },
          create: {
            homeId: inventory.homeId,
            deviceId: entity.deviceId ? (deviceIds.get(entity.deviceId) ?? null) : null,
            entityId: entity.entityId,
            sourceName: entity.name,
            domain: entity.domain,
            deviceClass: entity.deviceClass ?? null,
            unit: entity.unit ?? null,
            capability: entity.capability ?? 'unknown',
            compatibility: entity.compatibility,
            available: entity.available,
            status: entity.available ? 'ONLINE' : 'OFFLINE',
          },
        });
      }

      if (inventory.full) {
        await tx.sensor.updateMany({
          where: { homeId: inventory.homeId, entityId: { notIn: seenEntityIds } },
          data: { available: false, status: 'OFFLINE', removedAt: new Date() },
        });
      }

      await tx.equipmentSyncState.upsert({
        where: { homeId: inventory.homeId },
        update: {
          bridgeConnected: true,
          homeAssistantSeenAt: new Date(),
          inventorySeenAt: new Date(inventory.generatedAt),
          entityCount: inventory.entities.length,
          deviceCount: inventory.devices.length,
          lastError: null,
        },
        create: {
          homeId: inventory.homeId,
          bridgeConnected: true,
          homeAssistantSeenAt: new Date(),
          inventorySeenAt: new Date(inventory.generatedAt),
          entityCount: inventory.entities.length,
          deviceCount: inventory.devices.length,
        },
      });
    });
  }

  public async ingestMappedState(payload: unknown): Promise<void> {
    const state = homeAssistantStateSchema.parse(payload);
    const sensor = await this.prisma.sensor.findUnique({
      where: { homeId_entityId: { homeId: state.homeId, entityId: state.entityId } },
      include: { mapping: true, device: true },
    });
    if (!sensor?.mapping?.enabled) return;
    const transformed = this.transform(
      sensor.mapping.capability as Capability,
      sensor.mapping.transform,
      state.state,
    );
    if (!transformed) return;
    await this.ingestion.ingest({
      schemaVersion: '1.0',
      eventId: state.eventId,
      occurredAt: state.occurredAt,
      receivedAt: new Date().toISOString(),
      homeId: state.homeId,
      source: {
        platform: 'home-assistant',
        entityId: state.entityId,
        deviceId: sensor.device?.sourceDeviceId,
        name: sensor.sourceName,
        manufacturer: sensor.device?.manufacturer,
        model: sensor.device?.model,
      },
      capability: sensor.mapping.capability,
      quality: state.state === 'unknown' || state.state === 'unavailable' ? 'degraded' : 'good',
      payload: transformed,
    });
  }

  public async status(userId: string) {
    const home = await this.homeFor(userId);
    const state = await this.prisma.equipmentSyncState.findUnique({ where: { homeId: home.id } });
    return {
      homeAssistant: {
        connected: state?.bridgeConnected ?? false,
        lastSeenAt: state?.homeAssistantSeenAt ?? null,
      },
      inventory: {
        lastSyncAt: state?.inventorySeenAt ?? null,
        lastRequestedAt: state?.lastSyncRequestedAt ?? null,
        entities: state?.entityCount ?? 0,
        devices: state?.deviceCount ?? 0,
      },
      pairing: {
        active: Boolean(
          state?.pairingActive && state.pairingExpiresAt && state.pairingExpiresAt > new Date(),
        ),
        expiresAt: state?.pairingExpiresAt ?? null,
      },
      lastError: state?.lastError ?? null,
    };
  }

  public async candidates(userId: string) {
    const home = await this.homeFor(userId);
    return this.prisma.sensor.findMany({
      where: { homeId: home.id },
      orderBy: [{ available: 'desc' }, { sourceName: 'asc' }, { entityId: 'asc' }],
      include: { mapping: true, device: true, room: true },
    });
  }

  public async updateMapping(userId: string, entityId: string, body: unknown) {
    const parsed = {
      capability: capabilitySchema.parse((body as Record<string, unknown>)?.capability),
      transform: mappingTransformSchema.parse((body as Record<string, unknown>)?.transform),
      enabled: (body as Record<string, unknown>)?.enabled !== false,
    };
    const home = await this.homeFor(userId, true);
    const sensor = await this.prisma.sensor.findUnique({
      where: { homeId_entityId: { homeId: home.id, entityId } },
    });
    if (!sensor) throw new NotFoundException('Entité Home Assistant introuvable.');
    const mapping = await this.prisma.sensorMapping.upsert({
      where: { sensorId: sensor.id },
      update: parsed,
      create: { sensorId: sensor.id, ...parsed },
    });
    await this.prisma.sensor.update({
      where: { id: sensor.id },
      data: { capability: parsed.capability, compatibility: 'PARTIAL' },
    });
    return mapping;
  }

  public async markSyncRequested(userId: string): Promise<string> {
    const home = await this.homeFor(userId, true);
    await this.prisma.equipmentSyncState.upsert({
      where: { homeId: home.id },
      update: { lastSyncRequestedAt: new Date() },
      create: { homeId: home.id, lastSyncRequestedAt: new Date() },
    });
    return home.id;
  }

  public async setPairing(
    userId: string,
    active: boolean,
    durationSeconds = 180,
  ): Promise<{ homeId: string; expiresAt: Date | null }> {
    const home = await this.homeFor(userId, true);
    const expiresAt = active
      ? new Date(Date.now() + Math.min(Math.max(durationSeconds, 60), 600) * 1_000)
      : null;
    await this.prisma.equipmentSyncState.upsert({
      where: { homeId: home.id },
      update: { pairingActive: active, pairingExpiresAt: expiresAt },
      create: { homeId: home.id, pairingActive: active, pairingExpiresAt: expiresAt },
    });
    return { homeId: home.id, expiresAt };
  }

  public async bridgeStatus(payload: unknown): Promise<void> {
    const status = payload as { status?: string; homeId?: string };
    const home = status.homeId
      ? await this.prisma.home.findUnique({ where: { id: status.homeId }, select: { id: true } })
      : await this.prisma.home.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!home) return;
    await this.prisma.equipmentSyncState.upsert({
      where: { homeId: home.id },
      update: { bridgeConnected: status.status === 'online', homeAssistantSeenAt: new Date() },
      create: {
        homeId: home.id,
        bridgeConnected: status.status === 'online',
        homeAssistantSeenAt: new Date(),
      },
    });
  }

  private transform(
    capability: Capability,
    transform: string,
    state: string | number | boolean | null,
  ) {
    if (state === null || state === 'unknown' || state === 'unavailable') return null;
    if (transform === 'NUMERIC') {
      const value = Number(state);
      return Number.isFinite(value) ? { value } : null;
    }
    if (transform === 'EVENT_ACTION') return { action: String(state) };
    const normalized = String(state).toLowerCase();
    const positive = ['on', 'open', 'true', '1', 'active', 'detected'].includes(normalized);
    if (transform === 'OPEN_CLOSED' || capability === 'contact') return { open: positive };
    return { active: positive };
  }

  private async homeFor(userId: string, admin = false) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              ...(admin ? { systemRole: { in: [...ADMIN_ROLES] } } : {}),
            },
          },
        },
      },
      select: { id: true },
    });
    if (!home) throw new ForbiddenException('Accès au domicile refusé.');
    return home;
  }
}
