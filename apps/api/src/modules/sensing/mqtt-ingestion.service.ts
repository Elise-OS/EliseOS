import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MQTT_TOPICS } from '@michel/contracts';
import { connectMichelMqtt } from '@michel/mqtt';
import type { MqttClient } from 'mqtt';
import { IngestionService } from './ingestion.service';
import { EquipmentService } from '../equipment/equipment.service';

@Injectable()
export class MqttIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestionService.name);
  private client?: MqttClient;

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
      const action =
        topic === MQTT_TOPICS.events
          ? this.ingestion.ingest(parsed)
          : topic === MQTT_TOPICS.entityStates
            ? this.equipment.ingestMappedState(parsed)
            : topic === MQTT_TOPICS.inventory
              ? this.equipment.ingestInventory(parsed)
              : this.equipment.bridgeStatus(parsed);
      void action.catch((error: unknown) =>
        this.logger.error(`Rejected MQTT message on ${topic}`, error),
      );
    });
  }

  public requestInventory(homeId: string): void {
    this.client?.publish(MQTT_TOPICS.inventoryRequest, JSON.stringify({ homeId }), { qos: 1 });
  }

  public setZigbeePairing(active: boolean, durationSeconds: number): void {
    this.client?.publish(
      'zigbee2mqtt/bridge/request/permit_join',
      JSON.stringify(active ? { value: true, time: durationSeconds } : { value: false }),
      { qos: 1 },
    );
  }

  public onModuleDestroy(): void {
    this.client?.end();
  }
}
