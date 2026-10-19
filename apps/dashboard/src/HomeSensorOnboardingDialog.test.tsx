// @vitest-environment jsdom

import type { HomePlan } from '@michel/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeSensorOnboardingDialog } from './HomeSensorOnboardingDialog';
import type { SensorUiDevice } from './sensor-ui';

describe('bed contact assignment from the home plan', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it('uses the bedroom as target and explains the separate pressure mat', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const plan = {
      levels: [
        {
          id: 'floor',
          name: 'Étage',
          floor: 1,
          rooms: [
            {
              id: 'bedroom',
              name: 'Chambre',
              kind: 'BEDROOM',
              geometry: { color: '#eee', points: [] },
            },
          ],
          openings: [{ id: 'window', roomIds: ['bedroom'] }],
          items: [],
          stairs: [],
        },
      ],
      placements: [],
    } as unknown as HomePlan;
    const device = {
      id: 'nodon',
      name: 'NodOn SDC-4-1-00',
      manufacturer: 'NodOn',
      model: 'SDC-4-1-00',
      room: null,
      placementNote: null,
      batteryPercent: null,
      capabilities: [{ sensorId: 'contact', capability: 'dry_contact' }],
    } as unknown as SensorUiDevice;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <HomeSensorOnboardingDialog
          open
          locale="fr"
          plan={plan}
          devices={[device]}
          initialRoomId="bedroom"
          initialCategory="bed"
          initialTarget={{ type: 'OPENING', id: 'window' }}
          onClose={() => undefined}
          onInstalled={() => Promise.resolve()}
        />,
      );
    });
    const button = (label: string) =>
      Array.from(document.body.querySelectorAll('button')).find((item) =>
        item.textContent?.includes(label),
      );
    expect(document.body.textContent).toContain('Déjà connectés');
    act(() => button('Déjà connectés')!.click());
    act(() => button('NodOn SDC-4-1-00')!.click());
    expect(document.body.textContent).toContain('tapis de pression à contact sec');
    await act(async () => {
      button('Associer à Chambre')!.click();
      await Promise.resolve();
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = calls[0]?.[1]?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '')).toMatchObject({
      roomId: 'bedroom',
      contactRole: 'BED',
      bedOccupiedWhen: 'CLOSED',
      target: { type: 'ROOM', id: 'bedroom' },
    });
  });

  it('assigns a Tuya occupancy strip with active meaning occupied', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const plan = {
      levels: [
        {
          id: 'floor',
          name: 'Étage',
          floor: 1,
          rooms: [
            {
              id: 'bedroom',
              name: 'Chambre',
              kind: 'BEDROOM',
              geometry: { color: '#eee', points: [] },
            },
          ],
          openings: [],
          items: [],
          stairs: [],
        },
      ],
      placements: [],
    } as unknown as HomePlan;
    const device = {
      id: 'tuya-bed',
      name: 'Bande Tuya du lit',
      manufacturer: 'Tuya',
      model: 'Pressure Sensing Strap/Bed Occupancy Sensor',
      room: null,
      placementNote: null,
      batteryPercent: 90,
      capabilities: [{ sensorId: 'occupancy', capability: 'occupancy' }],
    } as unknown as SensorUiDevice;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <HomeSensorOnboardingDialog
          open
          locale="fr"
          plan={plan}
          devices={[device]}
          initialRoomId="bedroom"
          initialCategory="bed"
          onClose={() => undefined}
          onInstalled={() => Promise.resolve()}
        />,
      );
    });
    const button = (label: string) =>
      Array.from(document.body.querySelectorAll('button')).find((item) =>
        item.textContent?.includes(label),
      );
    act(() => button('Déjà connectés')!.click());
    act(() => button('Bande Tuya du lit')!.click());
    expect(document.body.textContent).toContain('Son état actif signifie « lit occupé »');
    expect(document.body.textContent).not.toContain('Quand le lit est occupé');
    await act(async () => {
      button('Associer à Chambre')!.click();
      await Promise.resolve();
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = calls[0]?.[1]?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '')).toMatchObject({
      roomId: 'bedroom',
      contactRole: 'BED',
      bedOccupiedWhen: 'OPEN',
      target: { type: 'ROOM', id: 'bedroom' },
    });
  });
});
