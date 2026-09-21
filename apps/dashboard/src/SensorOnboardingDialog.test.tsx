// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SensorOnboardingDialog } from './SensorOnboardingDialog';
import { SENSOR_PRODUCTS } from './sensor-products';

const session = {
  id: 'session-1',
  protocol: 'zigbee',
  status: 'DEVICE_FOUND',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  detectedDevice: {
    id: 'device-1',
    name: 'Détecteur de mouvement',
    manufacturer: 'Third Reality',
    model: '3RMS16BZ',
    capabilities: [
      { sensorId: 'sensor-1', capability: 'motion', label: 'Mouvement', primary: true },
    ],
  },
};

describe('sensor installation confirmation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function openDialog(onClose: () => void, onInstalled: () => Promise<void>) {
    await act(async () => {
      root.render(
        <SensorOnboardingDialog
          open
          locale="fr"
          rooms={[{ id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' }]}
          initialRoomId="salon"
          onClose={onClose}
          onInstalled={onInstalled}
        />,
      );
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Installer dans Salon');
  }

  async function install() {
    const button = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Installer dans Salon'),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
  }

  it('requires an opening type and sends it with the installation', async () => {
    const openingSession = {
      ...session,
      detectedDevice: {
        ...session.detectedDevice,
        capabilities: [
          { sensorId: 'contact-1', capability: 'contact', label: 'Ouverture', primary: true },
        ],
      },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url.endsWith('/complete') ? {} : openingSession),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await openDialog(vi.fn(), vi.fn().mockResolvedValue(undefined));
    const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Installer dans Salon'),
    )!;
    expect(button.disabled).toBe(true);
    const select = document.body.querySelector('select')!;
    act(() => {
      select.value = 'FRIDGE';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(button.disabled).toBe(false);
    await install();
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const request = calls.find(([url]) => url.endsWith('/complete'));
    const body = request?.[1]?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '')).toMatchObject({
      contactRole: 'FRIDGE',
      roomId: 'salon',
    });
  });

  it('shows the selected sensor photo during the preparation step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) }),
    );
    const product = SENSOR_PRODUCTS[0]!;

    await act(async () => {
      root.render(
        <SensorOnboardingDialog
          open
          locale="fr"
          rooms={[{ id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' }]}
          product={product}
          onClose={() => undefined}
          onInstalled={() => Promise.resolve()}
        />,
      );
      await Promise.resolve();
    });

    const photo = document.querySelector('.equipment-onboarding-product-photo img');
    expect(photo?.getAttribute('src')).toBe(product.image);
    expect(document.querySelector('.equipment-onboarding-intro > svg')).toBeNull();
  });

  it('closes after confirmation even if refreshing the page never finishes', async () => {
    const onClose = vi.fn();
    const onInstalled = vi.fn(() => new Promise<void>(() => undefined));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(url.endsWith('/complete') ? {} : session),
        }),
      ),
    );

    await openDialog(onClose, onInstalled);
    await install();

    expect(onClose).toHaveBeenCalledOnce();
    expect(onInstalled).toHaveBeenCalledOnce();
  });

  it('recognizes a completed installation when its confirmation response is lost', async () => {
    const onClose = vi.fn();
    const onInstalled = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/complete')) return Promise.reject(new Error('Connexion interrompue'));
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              url.endsWith('/current') ? session : { ...session, status: 'COMPLETED' },
            ),
        });
      }),
    );

    await openDialog(onClose, onInstalled);
    await install();

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
});
