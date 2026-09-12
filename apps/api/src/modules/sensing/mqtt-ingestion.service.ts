import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MQTT_TOPICS } from '@michel/contracts';
import { connectMichelMqtt } from '@michel/mqtt';
import type { MqttClient } from 'mqtt';
import { randomUUID } from 'node:crypto';
import { IngestionService } from './ingestion.service';
import { EquipmentService } from '../equipment/equipment.service';

@Injectable()
export class MqttIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestionService.name);
  private client?: MqttClient;
  private zigbee = {
    online: false,
    pairingOpen: false,
    updatedAt: null as Date | null,
    pairingResponseAt: null as Date | null,
    pairingError: null as string | null,
  };
  private zigbeeInventoryReceived = false;
  private readonly joinedZigbeeDevices = new Set<string>();
  private rejoinedDeviceInventoryTimer: NodeJS.Timeout | undefined;
  private readonly pendingDiscoveryCommands = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  public constructor(
    private readonly ingestion: IngestionService,
    private readonly equipment: EquipmentService,
  ) {}

  public onModuleInit(): void {
    if (process.env.MQTT_DISABLED === 'true') return;
    const username = process.env.MQTT_USERNAME;
    const password = process.env.MQTT_PASSWORD;
    this.client = connectMichelMqtt({
      url: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
      clientId: 'michel-core',
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    });
    this.client.on('connect', () =>
      this.client?.subscribe(
        [
          MQTT_TOPICS.events,
          MQTT_TOPICS.entityStates,
          MQTT_TOPICS.inventory,
          MQTT_TOPICS.bridgeStatus,
          'zigbee2mqtt/bridge/state',
          'zigbee2mqtt/bridge/devices',
          'zigbee2mqtt/bridge/event',
          'zigbee2mqtt/bridge/response/permit_join',
          'michel/v1/discovery',
          'michel/v1/discovery/results/#',
        ],
        { qos: 1 },
      ),
    );
    this.client.on('message', (topic: string, payload: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.toString());
      } catch (error) {
        this.logger.warn(`Invalid MQTT JSON on ${topic}: ${String(error)}`);
        return;
      }
      if (topic === 'zigbee2mqtt/bridge/state') {
        const state = parsed as { state?: string };
        this.zigbee.online = state.state === 'online';
        this.zigbee.updatedAt = new Date();
        return;
      }
      if (topic === 'michel/v1/discovery') {
        void this.equipment
          .ingestDiscoverySnapshot(parsed)
          .catch((error: unknown) =>
            this.logger.error('Unable to ingest Home Assistant discoveries', error),
          );
        return;
      }
      if (topic.startsWith('michel/v1/discovery/results/')) {
        const response = parsed as Record<string, unknown>;
        const commandId = typeof response.commandId === 'string' ? response.commandId : '';
        const pending = this.pendingDiscoveryCommands.get(commandId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingDiscoveryCommands.delete(commandId);
          if (response.status === 'rejected') {
            pending.reject(
              new Error(
                typeof response.error === 'string' ? response.error : 'Configuration refusée.',
              ),
            );
          } else pending.resolve(response);
        }
        return;
      }
      if (topic === 'zigbee2mqtt/bridge/devices') {
        const devices = Array.isArray(parsed)
          ? (parsed as Array<{ ieee_address?: unknown; type?: unknown }>)
          : [];
        this.joinedZigbeeDevices.clear();
        for (const device of devices) {
          if (device.type === 'Coordinator' || typeof device.ieee_address !== 'string') continue;
          this.joinedZigbeeDevices.add(device.ieee_address.toLowerCase());
        }
        this.zigbeeInventoryReceived = true;
        void this.equipment
          .reconcileZigbeeDevices([...this.joinedZigbeeDevices])
          .catch((error: unknown) =>
            this.logger.error('Unable to reconcile Zigbee inventory', error),
          );
        return;
      }
      if (topic === 'zigbee2mqtt/bridge/event') {
        const event = parsed as {
          type?: unknown;
          data?: { ieee_address?: unknown };
        };
        if (event.type === 'device_leave' && typeof event.data?.ieee_address === 'string') {
          this.joinedZigbeeDevices.delete(event.data.ieee_address.toLowerCase());
          void this.equipment
            .markZigbeeDeviceOffline(event.data.ieee_address)
            .catch((error: unknown) =>
              this.logger.error('Unable to mark departed Zigbee device offline', error),
            );
        } else if (
          event.type === 'device_announce' &&
          typeof event.data?.ieee_address === 'string'
        ) {
          // A steady occupancy value may not emit a new HA state_changed event after rejoin.
          // Refresh the current HA inventory so its availability is restored.
          if (this.rejoinedDeviceInventoryTimer) clearTimeout(this.rejoinedDeviceInventoryTimer);
          this.rejoinedDeviceInventoryTimer = setTimeout(() => {
            this.rejoinedDeviceInventoryTimer = undefined;
            this.requestInventory('');
          }, 3_000);
        }
        return;
      }
      if (topic === 'zigbee2mqtt/bridge/response/permit_join') {
        const response = parsed as {
          status?: string;
          error?: string;
          data?: { time?: number | null };
        };
        this.zigbee.pairingResponseAt = new Date();
        this.zigbee.pairingError =
          response.status === 'error'
            ? (response.error ?? 'Le réseau Zigbee a refusé la demande.')
            : null;
        this.zigbee.pairingOpen =
          response.status === 'ok' &&
          typeof response.data?.time === 'number' &&
          response.data.time > 0;
        return;
      }
      if (
        this.zigbeeInventoryReceived &&
        (topic === MQTT_TOPICS.events || topic === MQTT_TOPICS.entityStates)
      ) {
        const message = parsed as {
          entityId?: unknown;
          source?: { entityId?: unknown };
        };
        const entityId =
          typeof message.source?.entityId === 'string'
            ? message.source.entityId
            : typeof message.entityId === 'string'
              ? message.entityId
              : '';
        const zigbeeIdentifier = entityId.toLowerCase().match(/0x[0-9a-f]{16}/)?.[0];
        if (zigbeeIdentifier && !this.joinedZigbeeDevices.has(zigbeeIdentifier)) {
          void this.equipment
            .markZigbeeDeviceOffline(zigbeeIdentifier)
            .catch((error: unknown) =>
              this.logger.error('Unable to reject stale Zigbee state', error),
            );
          return;
        }
      }
      const action =
        topic === MQTT_TOPICS.events
          ? this.ingestion.ingest(parsed)
          : topic === MQTT_TOPICS.entityStates
            ? this.equipment.ingestMappedState(parsed)
            : topic === MQTT_TOPICS.inventory
              ? this.equipment.ingestInventory(parsed)
              : this.equipment.bridgeStatus(parsed);
      void action
        .then(async () => {
          if (topic === MQTT_TOPICS.inventory && this.zigbeeInventoryReceived) {
            await this.equipment.reconcileZigbeeDevices([...this.joinedZigbeeDevices]);
          }
        })
        .catch((error: unknown) => this.logger.error(`Rejected MQTT message on ${topic}`, error));
    });
  }

  public requestInventory(homeId: string): void {
    this.client?.publish(MQTT_TOPICS.inventoryRequest, JSON.stringify({ homeId }), { qos: 1 });
  }

  public setZigbeePairing(active: boolean, durationSeconds: number): void {
    const supportedDuration = Math.min(Math.max(durationSeconds, 1), 254);
    this.zigbee.pairingError = null;
    this.zigbee.pairingResponseAt = null;
    this.client?.publish(
      'zigbee2mqtt/bridge/request/permit_join',
      JSON.stringify({ time: active ? supportedDuration : 0 }),
      { qos: 1 },
    );
  }

  public removeZigbeeDevice(identifier: string): void {
    this.client?.publish(
      'zigbee2mqtt/bridge/request/device/remove',
      JSON.stringify({ id: identifier, force: true, block: false }),
      { qos: 1 },
    );
  }

  public zigbeeStatus() {
    return {
      online: this.zigbee.online,
      pairingOpen: this.zigbee.pairingOpen,
      updatedAt: this.zigbee.updatedAt,
      pairingResponseAt: this.zigbee.pairingResponseAt,
      pairingError: this.zigbee.pairingError,
    };
  }

  public isZigbeeDeviceJoined(identifier: string): boolean | null {
    if (!this.zigbeeInventoryReceived) return null;
    return this.joinedZigbeeDevices.has(identifier.toLowerCase());
  }

  public executeHomeAssistantCommand(command: {
    domain: string;
    service: string;
    target: { entity_id: string };
    data?: Record<string, unknown>;
  }): void {
    const commandId = randomUUID();
    this.client?.publish(
      `${MQTT_TOPICS.commands}/${commandId}`,
      JSON.stringify({ commandId, ...command }),
      { qos: 1 },
    );
  }

  public executeDiscoveryCommand(command: {
    flowId: string;
    action: 'advance' | 'ignore';
    title?: string;
    userInput?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const commandId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDiscoveryCommands.delete(commandId);
        reject(new Error('Home Assistant n’a pas répondu à temps.'));
      }, 20_000);
      this.pendingDiscoveryCommands.set(commandId, { resolve, reject, timer });
      this.client?.publish(
        `michel/v1/discovery/commands/${commandId}`,
        JSON.stringify({ commandId, ...command }),
        { qos: 1 },
      );
    });
  }

  public onModuleDestroy(): void {
    if (this.rejoinedDeviceInventoryTimer) clearTimeout(this.rejoinedDeviceInventoryTimer);
    for (const pending of this.pendingDiscoveryCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Service arrêté.'));
    }
    this.pendingDiscoveryCommands.clear();
    this.client?.end();
  }
}
