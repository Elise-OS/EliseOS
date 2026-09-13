// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomePlan, SensorDevice } from '@michel/contracts';
import { RoomEquipmentPage } from './RoomEquipmentPage';

describe('managing a room sensor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows its photo and asks before removing it from Zigbee', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ removed: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const plan = {
      levels: [
        {
          id: 'floor',
          name: 'Rez-de-chaussée',
          floor: 0,
          rooms: [{ id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' }],
          openings: [],
        },
      ],
      placements: [],
    } as unknown as HomePlan;
    const device = {
      id: 'sonoff',
      physicalDeviceId: 'sonoff',
      name: 'Capteur de température et d’humidité',
      manufacturer: 'SONOFF',
      model: 'Temperature and humidity sensor',
      protocol: 'zigbee',
      integration: 'zigbee2mqtt',
      room: { id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' },
      installationStatus: 'OPERATIONAL',
      enabled: true,
      placementConfirmedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      batteryPercent: 100,
      action: 'NONE',
      capabilities: [
        {
          sensorId: 'temperature',
          entityId: 'sensor.sonoff_temperature',
          capability: 'temperature',
          label: 'Température',
          primary: true,
          status: 'ONLINE',
          value: { value: 25.2 },
          unit: '°C',
          lastSeenAt: new Date().toISOString(),
          classification: { source: 'METADATA', confidence: 1, reason: null, confirmedAt: null },
        },
        {
          sensorId: 'humidity',
          entityId: 'sensor.sonoff_humidity',
          capability: 'humidity',
          label: 'Humidité',
          primary: true,
          status: 'ONLINE',
          value: { value: 45.9 },
          unit: '%',
          lastSeenAt: new Date().toISOString(),
          classification: { source: 'METADATA', confidence: 1, reason: null, confirmedAt: null },
        },
      ],
    } as SensorDevice;

    await act(async () => {
      root.render(
        <RoomEquipmentPage
          roomId="salon"
          plan={plan}
          devices={[device]}
          locale="fr"
          onBack={() => undefined}
          onEditPlan={() => undefined}
          onRefresh={onRefresh}
          onPlanSaved={() => undefined}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('.category-temperature .room-sensor-card-main')!
        .click();
      await Promise.resolve();
    });
    expect(document.querySelector('.equipment-device-photo img')?.getAttribute('src')).toBe(
      '/sensor-products/SNZB-02P.png',
    );
    await act(async () => {
      const manage = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.equipment-device-row button'),
      ).find((button) => button.textContent?.includes('Gérer'));
      manage!.click();
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.equipment-delete-trigger')!.click();
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Retirer ce capteur du réseau ?');

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.equipment-delete-confirm')!.click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sensor-devices/sonoff',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(onRefresh).toHaveBeenCalledOnce();

    act(() => root.unmount());
    host.remove();
  });
});
