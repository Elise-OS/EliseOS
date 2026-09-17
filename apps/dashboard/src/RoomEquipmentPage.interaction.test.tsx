// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomePlan, SensorDevice } from '@michel/contracts';
import { RoomEquipmentPage } from './RoomEquipmentPage';

describe('managing a room sensor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens a simple sensor profile with its photo and purpose, without deletion', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const fetchMock = vi.fn();
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
    expect(document.body.textContent).toContain('Capteur de température et d’humidité');
    expect(document.body.textContent).toContain('À quoi sert ce capteur ?');
    expect(document.body.textContent).toContain('Le confort de la pièce');
    expect(document.querySelector('.equipment-dialog.is-side-panel')).not.toBeNull();
    expect(document.querySelector('.equipment-delete-trigger')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Supprimer du réseau');

    act(() => root.unmount());
    host.remove();
  });
});
