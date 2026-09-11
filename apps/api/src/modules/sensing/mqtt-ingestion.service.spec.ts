import { describe, expect, it, vi } from 'vitest';
import { MqttIngestionService } from './mqtt-ingestion.service';

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
});
