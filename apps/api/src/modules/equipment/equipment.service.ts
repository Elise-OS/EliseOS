import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  capabilitySchema,
  equipmentActionSchema,
  equipmentActionRequestSchema,
  equipmentDiscoverySnapshotSchema,
  homeAssistantInventorySchema,
  homeAssistantStateSchema,
  mappingTransformSchema,
  type Capability,
  type HomeAssistantInventory,
} from '@michel/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { rolesFor } from '../auth/access-policy';
import { IngestionService } from '../sensing/ingestion.service';

const ADMIN_ROLES = rolesFor('configuration:manage');
const SENSOR_ENTITY_DOMAINS = new Set(['binary_sensor', 'event', 'sensor', 'switch']);
const INTERNAL_HOME_ASSISTANT_INTEGRATIONS = new Set([
  'analytics',
  'backup',
  'recorder',
  'sun',
  'systemmonitor',
  'time_date',
  'uptime',
  'version',
]);

function isBridgeControlEntity(entity: HomeAssistantInventory['entities'][number]) {
  const normalized = `${entity.entityId} ${entity.name}`.toLowerCase().replaceAll('_', ' ');
  return normalized.includes('permit join');
}

export function sensorInventoryOnly(inventory: HomeAssistantInventory): HomeAssistantInventory {
  const entities = inventory.entities.filter(
    (entity) =>
      SENSOR_ENTITY_DOMAINS.has(entity.domain) &&
      !INTERNAL_HOME_ASSISTANT_INTEGRATIONS.has(entity.integration ?? '') &&
      !isBridgeControlEntity(entity),
  );
  const referencedDeviceIds = new Set(
    entities.flatMap((entity) => (entity.deviceId ? [entity.deviceId] : [])),
  );
  return {
    ...inventory,
    entities,
    devices: inventory.devices.filter((device) => referencedDeviceIds.has(device.deviceId)),
  };
}

export function activeZigbeeInventoryOnly(
  inventory: HomeAssistantInventory,
  joinedIdentifiers: ReadonlySet<string>,
): HomeAssistantInventory {
  const identifier = (value: string) => value.toLowerCase().match(/0x[0-9a-f]{16}/)?.[0];
  const deviceIdentifiers = new Map<string, string>();
  for (const entity of inventory.entities) {
    const ieee = identifier(entity.entityId);
    if (entity.deviceId && ieee) deviceIdentifiers.set(entity.deviceId, ieee);
  }
  const absentDeviceIds = new Set(
    inventory.devices
      .filter((device) => {
        const ieee =
          (device.networkIdentifier && identifier(device.networkIdentifier)) ||
          deviceIdentifiers.get(device.deviceId);
        return ieee && !joinedIdentifiers.has(ieee);
      })
      .map((device) => device.deviceId),
  );
  return {
    ...inventory,
    devices: inventory.devices.filter((device) => !absentDeviceIds.has(device.deviceId)),
    entities: inventory.entities.filter((entity) => {
      if (entity.deviceId && absentDeviceIds.has(entity.deviceId)) return false;
      const ieee = identifier(entity.entityId);
      return !ieee || joinedIdentifiers.has(ieee);
    }),
  };
}

@Injectable()
export class EquipmentService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  public async ingestInventory(
    payload: unknown,
    joinedZigbeeIdentifiers?: ReadonlySet<string>,
  ): Promise<void> {
    const received = homeAssistantInventorySchema.parse(payload);
    const fullInventory = joinedZigbeeIdentifiers
      ? activeZigbeeInventoryOnly(received, joinedZigbeeIdentifiers)
      : received;
    const inventory = sensorInventoryOnly(fullInventory);
    const home = await this.prisma.home.findUnique({
      where: { id: fullInventory.homeId },
      select: { id: true },
    });
    if (!home) return;

    await this.prisma.$transaction(async (tx) => {
      const deviceIds = new Map<string, string>();
      const inferredZigbeeIdentifiers = new Map<string, string>();
      for (const entity of fullInventory.entities) {
        const identifier = entity.entityId.toLowerCase().match(/0x[0-9a-f]{16}/)?.[0];
        if (entity.deviceId && identifier) {
          inferredZigbeeIdentifiers.set(entity.deviceId, identifier);
        }
      }
      for (const source of fullInventory.devices) {
        const inferredZigbeeIdentifier = inferredZigbeeIdentifiers.get(source.deviceId) ?? null;
        const networkIdentifier = source.networkIdentifier ?? inferredZigbeeIdentifier;
        const device = await tx.device.upsert({
          where: {
            homeId_sourceDeviceId: {
              homeId: fullInventory.homeId,
              sourceDeviceId: source.deviceId,
            },
          },
          update: {
            name: source.name,
            networkIdentifier,
            ...(inferredZigbeeIdentifier ? { protocol: 'zigbee', integration: 'zigbee2mqtt' } : {}),
            manufacturer: source.manufacturer ?? null,
            model: source.model ?? null,
            lastSeenAt: new Date(fullInventory.generatedAt),
          },
          create: {
            homeId: fullInventory.homeId,
            sourceDeviceId: source.deviceId,
            networkIdentifier,
            protocol: inferredZigbeeIdentifier ? 'zigbee' : null,
            integration: inferredZigbeeIdentifier ? 'zigbee2mqtt' : null,
            name: source.name,
            manufacturer: source.manufacturer ?? null,
            model: source.model ?? null,
            lastSeenAt: new Date(fullInventory.generatedAt),
          },
        });
        deviceIds.set(source.deviceId, device.id);
      }

      const allEntityIds: string[] = [];
      for (const entity of fullInventory.entities) {
        allEntityIds.push(entity.entityId);
        const linkedDeviceId = entity.deviceId ? (deviceIds.get(entity.deviceId) ?? null) : null;
        await tx.deviceEntity.upsert({
          where: {
            homeId_entityId: { homeId: fullInventory.homeId, entityId: entity.entityId },
          },
          update: {
            deviceId: linkedDeviceId,
            name: entity.name,
            domain: entity.domain,
            deviceClass: entity.deviceClass ?? null,
            integration: entity.integration ?? null,
            protocol: entity.protocol ?? null,
            available: entity.available,
            state: entity.state ?? Prisma.JsonNull,
            actions: entity.actions,
            lastSeenAt: new Date(fullInventory.generatedAt),
            removedAt: null,
          },
          create: {
            homeId: fullInventory.homeId,
            deviceId: linkedDeviceId,
            entityId: entity.entityId,
            name: entity.name,
            domain: entity.domain,
            deviceClass: entity.deviceClass ?? null,
            integration: entity.integration ?? null,
            protocol: entity.protocol ?? null,
            available: entity.available,
            state: entity.state ?? Prisma.JsonNull,
            actions: entity.actions,
            lastSeenAt: new Date(fullInventory.generatedAt),
          },
        });
      }

      const seenEntityIds: string[] = [];
      const previousSensors = await tx.sensor.findMany({
        where: { homeId: inventory.homeId },
        select: { entityId: true, unavailableSince: true, available: true, status: true },
      });
      const previousByEntityId = new Map(
        previousSensors.map((sensor) => [sensor.entityId, sensor]),
      );
      const availabilityObservedAt = new Date();
      for (const entity of inventory.entities) {
        seenEntityIds.push(entity.entityId);
        const previous = previousByEntityId.get(entity.entityId);
        const unavailableSince = entity.available
          ? null
          : previous?.available === false
            ? (previous.unavailableSince ?? availabilityObservedAt)
            : availabilityObservedAt;
        const linkedDeviceId = entity.deviceId ? (deviceIds.get(entity.deviceId) ?? null) : null;
        if (linkedDeviceId) {
          await tx.device.update({
            where: { id: linkedDeviceId },
            data: {
              ...(entity.integration ? { integration: entity.integration } : {}),
              ...(entity.protocol ? { protocol: entity.protocol } : {}),
            },
          });
        }
        await tx.sensor.upsert({
          where: { homeId_entityId: { homeId: inventory.homeId, entityId: entity.entityId } },
          update: {
            deviceId: linkedDeviceId,
            sourceName: entity.name,
            domain: entity.domain,
            deviceClass: entity.deviceClass ?? null,
            unit: entity.unit ?? null,
            capability: entity.capability ?? 'unknown',
            compatibility: entity.compatibility,
            classificationConfidence: entity.capability ? 1 : 0,
            classificationReason: entity.capability
              ? `Reconnu grâce au type ${entity.deviceClass ?? entity.domain}`
              : 'Métadonnées insuffisantes : confirmation nécessaire',
            available: entity.available,
            unavailableSince,
            status: entity.available
              ? previous?.status === 'DEGRADED'
                ? 'DEGRADED'
                : 'ONLINE'
              : 'OFFLINE',
            removedAt: null,
          },
          create: {
            homeId: inventory.homeId,
            deviceId: linkedDeviceId,
            entityId: entity.entityId,
            sourceName: entity.name,
            domain: entity.domain,
            deviceClass: entity.deviceClass ?? null,
            unit: entity.unit ?? null,
            capability: entity.capability ?? 'unknown',
            compatibility: entity.compatibility,
            analysisEnabled: Boolean(entity.capability),
            classificationConfidence: entity.capability ? 1 : 0,
            classificationReason: entity.capability
              ? `Reconnu grâce au type ${entity.deviceClass ?? entity.domain}`
              : 'Métadonnées insuffisantes : confirmation nécessaire',
            available: entity.available,
            unavailableSince,
            status: entity.available ? 'ONLINE' : 'OFFLINE',
          },
        });
      }

      if (inventory.full) {
        await tx.sensor.updateMany({
          where: { homeId: inventory.homeId, entityId: { notIn: seenEntityIds } },
          data: { available: false, status: 'OFFLINE', removedAt: new Date() },
        });
        await tx.deviceEntity.updateMany({
          where: { homeId: fullInventory.homeId, entityId: { notIn: allEntityIds } },
          data: { available: false, removedAt: new Date() },
        });
      }

      await tx.equipmentSyncState.upsert({
        where: { homeId: inventory.homeId },
        update: {
          bridgeConnected: true,
          homeAssistantSeenAt: new Date(),
          inventorySeenAt: new Date(inventory.generatedAt),
          entityCount: fullInventory.entities.length,
          deviceCount: fullInventory.devices.length,
          lastError: null,
        },
        create: {
          homeId: inventory.homeId,
          bridgeConnected: true,
          homeAssistantSeenAt: new Date(),
          inventorySeenAt: new Date(inventory.generatedAt),
          entityCount: fullInventory.entities.length,
          deviceCount: fullInventory.devices.length,
        },
      });
    });
  }

  public async ingestMappedState(payload: unknown): Promise<void> {
    const state = homeAssistantStateSchema.parse(payload);
    await this.prisma.deviceEntity.updateMany({
      where: { homeId: state.homeId, entityId: state.entityId, removedAt: null },
      data: {
        state: state.state ?? Prisma.JsonNull,
        available: state.state !== 'unknown' && state.state !== 'unavailable',
        lastSeenAt: new Date(state.occurredAt),
      },
    });
    const sensor = await this.prisma.sensor.findUnique({
      where: { homeId_entityId: { homeId: state.homeId, entityId: state.entityId } },
      include: { mapping: true, device: true },
    });
    if (!sensor || sensor.removedAt || !sensor.mapping?.enabled) return;
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

  public async ingestDiscoverySnapshot(payload: unknown): Promise<void> {
    const snapshot = equipmentDiscoverySnapshotSchema.parse(payload);
    const home = await this.prisma.home.findUnique({
      where: { id: snapshot.homeId },
      select: { id: true },
    });
    if (!home) return;
    const seen: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const discovery of snapshot.discoveries) {
        seen.push(discovery.discoveryKey);
        const existing = await tx.equipmentDiscovery.findUnique({
          where: {
            homeId_discoveryKey: {
              homeId: snapshot.homeId,
              discoveryKey: discovery.discoveryKey,
            },
          },
          select: { status: true },
        });
        await tx.equipmentDiscovery.upsert({
          where: {
            homeId_discoveryKey: {
              homeId: snapshot.homeId,
              discoveryKey: discovery.discoveryKey,
            },
          },
          update: {
            flowId: discovery.flowId,
            handler: discovery.handler,
            source: discovery.source,
            title: discovery.title,
            step: JSON.parse(JSON.stringify(discovery.step)) as Prisma.InputJsonValue,
            status: existing?.status === 'IGNORED' ? 'IGNORED' : 'DISCOVERED',
            lastError: null,
            lastSeenAt: new Date(snapshot.generatedAt),
          },
          create: {
            homeId: snapshot.homeId,
            discoveryKey: discovery.discoveryKey,
            flowId: discovery.flowId,
            handler: discovery.handler,
            source: discovery.source,
            title: discovery.title,
            step: JSON.parse(JSON.stringify(discovery.step)) as Prisma.InputJsonValue,
            lastSeenAt: new Date(snapshot.generatedAt),
          },
        });
      }
      if (snapshot.full) {
        await tx.equipmentDiscovery.updateMany({
          where: {
            homeId: snapshot.homeId,
            discoveryKey: { notIn: seen },
            status: { in: ['DISCOVERED', 'CONFIGURING'] },
          },
          data: { status: 'EXPIRED', flowId: null },
        });
      }
    });
  }

  public async items(userId: string) {
    const home = await this.homeFor(userId);
    const [devices, standalone, discoveries] = await Promise.all([
      this.prisma.device.findMany({
        where: { homeId: home.id },
        include: {
          room: true,
          entities: { where: { removedAt: null }, orderBy: { name: 'asc' } },
          sensors: { where: { removedAt: null }, select: { id: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.deviceEntity.findMany({
        where: { homeId: home.id, deviceId: null, removedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prisma.equipmentDiscovery.findMany({
        where: { homeId: home.id, status: { in: ['DISCOVERED', 'CONFIGURING', 'FAILED'] } },
        orderBy: { lastSeenAt: 'desc' },
      }),
    ]);
    const configured = devices
      .filter((device) => device.entities.length > 0 || device.sensors.length > 0)
      .map((device) => ({
        source: 'configured' as const,
        id: device.id,
        name: device.displayName ?? device.name,
        manufacturer: device.manufacturer,
        model: device.model,
        protocol: device.protocol ?? device.entities[0]?.protocol ?? null,
        integration: device.integration ?? device.entities[0]?.integration ?? null,
        room: device.room,
        status: this.equipmentStatus(device.entities, device.sensors.length > 0),
        entities: device.entities.map((entity) => this.entityView(entity)),
      }));
    const standaloneItems = standalone.map((entity) => ({
      source: 'configured' as const,
      id: `entity:${entity.id}`,
      name: entity.name,
      manufacturer: null,
      model: null,
      protocol: entity.protocol,
      integration: entity.integration,
      room: null,
      status: this.equipmentStatus([entity], false),
      entities: [this.entityView(entity)],
    }));
    const pending = discoveries.map((discovery) => ({
      source: 'discovered' as const,
      id: discovery.id,
      name: discovery.title,
      integration: discovery.handler,
      protocol: this.discoveryProtocol(discovery.handler, discovery.source),
      status: discovery.status,
      step: discovery.step,
      error: discovery.lastError,
    }));
    return [...pending, ...configured, ...standaloneItems];
  }

  public async discovery(userId: string, id: string) {
    const home = await this.homeFor(userId, true);
    const discovery = await this.prisma.equipmentDiscovery.findFirst({
      where: { id, homeId: home.id },
    });
    if (!discovery) throw new NotFoundException('Appareil découvert introuvable.');
    return discovery;
  }

  public async prepareDiscoveryCommand(userId: string, id: string, action: 'advance' | 'ignore') {
    const discovery = await this.discovery(userId, id);
    if (!discovery.flowId)
      throw new NotFoundException('Cette proposition a expiré. Relancez la recherche.');
    await this.prisma.equipmentDiscovery.update({
      where: { id },
      data: { status: action === 'ignore' ? 'IGNORED' : 'CONFIGURING', lastError: null },
    });
    return { flowId: discovery.flowId, title: discovery.title };
  }

  public async recordDiscoveryResult(id: string, result: Record<string, unknown>) {
    const status =
      result.status === 'completed'
        ? 'COMPLETED'
        : result.status === 'ignored'
          ? 'IGNORED'
          : 'CONFIGURING';
    return this.prisma.equipmentDiscovery.update({
      where: { id },
      data: {
        status,
        ...(result.step ? { step: result.step } : {}),
        lastError: typeof result.error === 'string' ? result.error : null,
      },
    });
  }

  public async prepareAction(userId: string, body: unknown) {
    const input = equipmentActionRequestSchema.parse(body);
    const home = await this.homeFor(userId, true);
    const entity = await this.prisma.deviceEntity.findFirst({
      where: { homeId: home.id, entityId: input.entityId, removedAt: null, available: true },
    });
    if (!entity) throw new NotFoundException('Entité Home Assistant indisponible.');
    const actions = equipmentActionSchema.array().safeParse(entity.actions);
    const action = actions.success
      ? actions.data.find((candidate) => candidate.id === input.actionId)
      : null;
    if (!action) {
      throw new ForbiddenException('Cette action n’est pas autorisée pour cet appareil.');
    }
    const data = Object.fromEntries(
      Object.entries(input.data).filter(([key]) => action.fields.includes(key)),
    );
    return {
      domain: action.domain,
      service: action.service,
      target: { entity_id: entity.entityId },
      data,
    };
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
      where: { homeId: home.id, removedAt: null },
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
      data: {
        capability: parsed.capability,
        compatibility: 'PARTIAL',
        analysisEnabled: parsed.enabled,
        classificationSource: 'USER',
        classificationConfidence: 1,
        classificationReason: 'Type confirmé par un administrateur',
        classificationConfirmedAt: new Date(),
      },
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
      ? new Date(Date.now() + Math.min(Math.max(durationSeconds, 60), 254) * 1_000)
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

  public async markZigbeeDeviceOffline(networkIdentifier: string): Promise<void> {
    const normalizedIdentifier = networkIdentifier.toLowerCase();
    await this.prisma.$transaction(async (tx) => {
      const devices = await tx.device.findMany({
        where: {
          OR: [
            { networkIdentifier: normalizedIdentifier },
            { sensors: { some: { entityId: { contains: normalizedIdentifier } } } },
          ],
        },
        select: { id: true },
      });
      const deviceIds = devices.map((device) => device.id);
      if (deviceIds.length === 0) return;
      await tx.device.updateMany({
        where: { id: { in: deviceIds } },
        data: {
          networkIdentifier: normalizedIdentifier,
          protocol: 'zigbee',
          integration: 'zigbee2mqtt',
          installationStatus: 'ATTENTION',
        },
      });
      await tx.sensor.updateMany({
        where: { deviceId: { in: deviceIds }, removedAt: null },
        data: { available: false, status: 'OFFLINE' },
      });
    });
  }

  public async reconcileZigbeeDevices(joinedIdentifiers: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.device.updateMany({
        where: {
          protocol: 'zigbee',
          networkIdentifier: { not: null, notIn: joinedIdentifiers },
        },
        data: { installationStatus: 'ATTENTION' },
      }),
      this.prisma.sensor.updateMany({
        where: {
          removedAt: null,
          device: {
            protocol: 'zigbee',
            networkIdentifier: { not: null, notIn: joinedIdentifiers },
          },
        },
        data: { available: false, status: 'OFFLINE' },
      }),
    ]);
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
    const positive = ['on', 'open', 'contact_open', 'true', '1', 'active', 'detected'].includes(
      normalized,
    );
    if (transform === 'OPEN_CLOSED' || capability === 'contact') return { open: positive };
    return { active: positive };
  }

  private entityView(entity: {
    id: string;
    entityId: string;
    name: string;
    domain: string;
    deviceClass: string | null;
    available: boolean;
    state: Prisma.JsonValue | null;
    actions: Prisma.JsonValue;
  }) {
    return {
      id: entity.id,
      entityId: entity.entityId,
      name: entity.name,
      domain: entity.domain,
      deviceClass: entity.deviceClass,
      available: entity.available,
      state: entity.state,
      actions: Array.isArray(entity.actions) ? entity.actions : [],
    };
  }

  private equipmentStatus(
    entities: Array<{ available: boolean; actions: Prisma.JsonValue }>,
    hasSensor: boolean,
  ): 'OPERATIONAL' | 'OFFLINE' | 'ATTENTION' | 'UNSUPPORTED' {
    if (entities.length > 0 && entities.every(({ available }) => !available)) return 'OFFLINE';
    if (!hasSensor && !entities.some(({ actions }) => Array.isArray(actions) && actions.length > 0))
      return 'UNSUPPORTED';
    return entities.some(({ available }) => available) || hasSensor ? 'OPERATIONAL' : 'ATTENTION';
  }

  private discoveryProtocol(handler: string, source: string) {
    if (handler === 'matter') return 'matter';
    if (handler === 'zha') return 'zigbee';
    if (['bluetooth', 'bthome'].includes(handler) || source === 'bluetooth') return 'bluetooth';
    return 'wifi';
  }

  private async homeFor(userId: string, admin = false) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              disabledAt: null,
              ...(admin ? { systemRole: { in: ADMIN_ROLES } } : {}),
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
