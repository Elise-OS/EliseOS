import { EventEmitter } from 'node:events';
import { connectMichelMqtt } from '@michel/mqtt';
import { MQTT_TOPICS } from '@michel/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MqttIngestionService } from './mqtt-ingestion.service';

vi.mock('@michel/mqtt', () => ({ connectMichelMqtt: vi.fn() }));

function connectedService(ingest = vi.fn().mockResolvedValue({ accepted: true })) {
  const client = new EventEmitter();
  Object.assign(client, { subscribe: vi.fn(), publish: vi.fn(), end: vi.fn() });
  vi.mocked(connectMichelMqtt).mockReturnValue(client as never);
  const service = new MqttIngestionService({ ingest } as never, {} as never);
  service.onModuleInit();
  return { client, service, ingest };
}

describe('MqttIngestionService Zigbee pairing', () => {
  it('uses the supported permit-join payload and caps it at 254 seconds', () => {
    const publish = vi.fn();
    const service = new MqttIngestionService({} as never, {} as never);
    (service as unknown as { client: { publish: typeof publish } }).client = { publish };

    service.setZigbeePairing(true, 300);
    service.setZigbeePairing(false, 0);

    expect(publish).toHaveBeenNthCalledWith(
      1,
      'zigbee2mqtt/bridge/request/permit_join',
      JSON.stringify({ time: 254 }),
      { qos: 1 },
    );
    expect(publish).toHaveBeenNthCalledWith(
      2,
      'zigbee2mqtt/bridge/request/permit_join',
      JSON.stringify({ time: 0 }),
      { qos: 1 },
    );
  });

  it('removes a device from the Zigbee network without blocking future pairing', () => {
    const publish = vi.fn();
    const service = new MqttIngestionService({} as never, {} as never);
    (service as unknown as { client: { publish: typeof publish } }).client = { publish };

    service.removeZigbeeDevice('0x00124b0023456789');

    expect(publish).toHaveBeenCalledWith(
      'zigbee2mqtt/bridge/request/device/remove',
      JSON.stringify({ id: '0x00124b0023456789', force: true, block: false }),
      { qos: 1 },
    );
  });

  it('does not claim membership before Zigbee2MQTT inventory is received', () => {
    const service = new MqttIngestionService({} as never, {} as never);

    expect(service.isZigbeeDeviceJoined('0x00124b0023456789')).toBeNull();
  });

  it('records explicit Zigbee joins only after the session starts', () => {
    const { client, service } = connectedService();
    const startedAt = new Date(Date.now() - 1_000);
    client.emit(
      'message',
      'zigbee2mqtt/bridge/event',
      Buffer.from(
        JSON.stringify({
          type: 'device_joined',
          data: { ieee_address: '0x00124B0023456789' },
        }),
      ),
    );

    expect(service.zigbeeDevicesJoinedSince(startedAt)).toEqual(['0x00124b0023456789']);
    expect(service.zigbeeDevicesJoinedSince(new Date(Date.now() + 1_000))).toEqual([]);
    service.onModuleDestroy();
  });

  it('serializes MQTT event ingestion so reports cannot exhaust the database pool', async () => {
    let finishFirst!: (value: { accepted: boolean }) => void;
    const first = new Promise<{ accepted: boolean }>((resolve) => {
      finishFirst = resolve;
    });
    const ingest = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ accepted: true });
    const { client, service } = connectedService(ingest);
    client.emit('message', MQTT_TOPICS.events, Buffer.from('{"eventId":"one"}'));
    client.emit('message', MQTT_TOPICS.events, Buffer.from('{"eventId":"two"}'));
    await Promise.resolve();

    expect(ingest).toHaveBeenCalledTimes(1);
    finishFirst({ accepted: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ingest).toHaveBeenCalledTimes(2);
    expect(ingest).toHaveBeenNthCalledWith(2, { eventId: 'two' });
    service.onModuleDestroy();
  });
});
