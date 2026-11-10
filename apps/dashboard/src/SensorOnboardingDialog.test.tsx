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
    const fridge = Array.from(document.body.querySelectorAll('[role="radio"]')).find((item) =>
      item.textContent?.includes('Frigo'),
    ) as HTMLButtonElement;
    act(() => fridge.click());
    expect(fridge.getAttribute('aria-checked')).toBe('true');
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

  it('installs the NodOn contact as a bed occupancy sensor', async () => {
    const bedSession = {
      ...session,
      detectedDevice: {
        ...session.detectedDevice,
        name: 'NodOn SDC-4-1-00',
        manufacturer: 'NodOn',
        model: 'SDC-4-1-00',
        capabilities: [
          { sensorId: 'bed-contact', capability: 'contact', label: 'Contact', primary: true },
        ],
      },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url.endsWith('/complete') ? {} : bedSession),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(
        <SensorOnboardingDialog
          open
          locale="fr"
          rooms={[{ id: 'bedroom', name: 'Chambre', kind: 'BEDROOM' }]}
          initialRoomId="bedroom"
          category="bed"
          contactRole="BED"
          bedOccupiedWhen="OPEN"
          product={SENSOR_PRODUCTS.find(({ model }) => model === 'SDC-4-1-00')}
          onClose={() => undefined}
          onInstalled={() => Promise.resolve()}
        />,
      );
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('tapis de pression à contact sec');
    const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Installer dans Chambre'),
    );
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const request = calls.find(([url]) => url.endsWith('/complete'));
    const body = request?.[1]?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '')).toMatchObject({
      category: 'bed',
      contactRole: 'BED',
      bedOccupiedWhen: 'OPEN',
      roomId: 'bedroom',
      target: null,
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

    const photo = document.querySelector('.ss-prepare-photo img');
    expect(photo?.getAttribute('src')).toBe(product.image);
    expect(document.querySelector('.ss-hero-icon')).toBeNull();
  });

  it('shows the live pairing phase as soon as the Zigbee sensor is detected', async () => {
    const pairingSession = {
      ...session,
      status: 'WAITING_FOR_DEVICE',
      detectedDevice: null,
      connection: { pairingOpen: true, deviceDetected: true },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(pairingSession) }),
    );

    await act(async () => {
      root.render(
        <SensorOnboardingDialog
          open
          locale="fr"
          rooms={[{ id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' }]}
          onClose={() => undefined}
          onInstalled={() => Promise.resolve()}
        />,
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Capteur détecté');
    expect(document.body.textContent).toContain('Appairage en cours');
    expect(document.body.textContent).toContain('Élise a trouvé votre capteur');
    expect(document.body.textContent).not.toContain('En attente de votre capteur');
    expect(document.body.textContent).not.toContain('La box est prête à détecter.');
  });

  it('shows the end screen after confirmation even if refreshing never finishes', async () => {
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

    expect(onInstalled).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Capteur installé');
    expect(onClose).not.toHaveBeenCalled();
    const done = Array.from(document.body.querySelectorAll('button')).find(
      (item) => item.textContent === 'Terminé',
    );
    act(() => done!.click());
    expect(onClose).toHaveBeenCalledOnce();
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

    expect(document.body.textContent).toContain('Capteur installé');
    expect(onInstalled).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps searching through a dropped connection, then explains an expired search', async () => {
    vi.useFakeTimers();
    try {
      const waiting = {
        ...session,
        status: 'WAITING_FOR_DEVICE',
        detectedDevice: null,
        connection: { pairingOpen: true, deviceDetected: false },
      };
      let polls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.endsWith('/current'))
            return Promise.resolve({ ok: true, json: () => Promise.resolve(waiting) });
          polls += 1;
          if (polls === 1) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...waiting, status: 'EXPIRED' }),
          });
        }),
      );
      await act(async () => {
        root.render(
          <SensorOnboardingDialog
            open
            locale="fr"
            rooms={[{ id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' }]}
            initialRoomId="salon"
            onClose={() => undefined}
            onInstalled={() => Promise.resolve()}
          />,
        );
        await Promise.resolve();
      });
      expect(document.body.textContent).toContain('En attente de votre capteur');

      const tick = async (ms: number) => {
        await act(async () => {
          vi.advanceTimersByTime(ms);
          for (let i = 0; i < 5; i += 1) await Promise.resolve();
        });
      };
      await tick(1300);
      expect(document.body.textContent).toContain('Connexion à Élise interrompue');
      expect(document.body.textContent).toContain('En attente de votre capteur');

      await tick(3100);
      expect(document.body.textContent).toContain('Aucun capteur trouvé');
      expect(document.body.textContent).toContain('Relancer la recherche');
    } finally {
      vi.useRealTimers();
    }
  });

  async function renderFlow(extra: Record<string, unknown> = {}) {
    await act(async () => {
      root.render(
        <SensorOnboardingDialog
          open
          locale="fr"
          rooms={[
            { id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' },
            { id: 'cuisine', name: 'Cuisine', kind: 'KITCHEN' },
          ]}
          initialRoomId="salon"
          onClose={() => undefined}
          onInstalled={() => Promise.resolve()}
          {...extra}
        />,
      );
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
  }

  it('warns that the hub lost its Zigbee key while searching', async () => {
    const waiting = {
      ...session,
      status: 'WAITING_FOR_DEVICE',
      detectedDevice: null,
      connection: { online: false, pairingOpen: false, deviceDetected: false },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(waiting) }),
    );
    await renderFlow();
    expect(document.body.textContent).toContain('La clé Zigbee ne répond plus');
  });

  it('says a device was seen but cannot be used when the search ends', async () => {
    vi.useFakeTimers();
    try {
      const waiting = {
        ...session,
        status: 'WAITING_FOR_DEVICE',
        detectedDevice: null,
        connection: { online: true, pairingOpen: true, deviceDetected: true },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve(
                url.endsWith('/current') ? waiting : { ...waiting, status: 'EXPIRED' },
              ),
          }),
        ),
      );
      await renderFlow();
      await act(async () => {
        vi.advanceTimersByTime(1300);
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      });
      expect(document.body.textContent).toContain('Capteur vu, mais pas encore utilisable');
      expect(document.body.textContent).not.toContain('Aucun capteur trouvé');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to install a device that only reports its battery', async () => {
    const batteryOnly = {
      ...session,
      detectedDevice: {
        ...session.detectedDevice,
        capabilities: [
          { sensorId: 'b', capability: 'battery', label: 'Pile', primary: false },
          { sensorId: 's', capability: 'signal_strength', label: 'Signal', primary: false },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(batteryOnly) }),
    );
    await openDialog(vi.fn(), vi.fn().mockResolvedValue(undefined));
    expect(document.body.textContent).toContain('Capteur vu, mais pas encore utilisable');
    const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Installer dans Salon'),
    )!;
    expect(button.disabled).toBe(true);
  });

  it('tells the person when a re-paired sensor already lives in another room', async () => {
    const known = {
      ...session,
      detectedDevice: {
        ...session.detectedDevice,
        room: { id: 'cuisine', name: 'Cuisine', kind: 'KITCHEN' },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(known) }),
    );
    await openDialog(vi.fn(), vi.fn().mockResolvedValue(undefined));
    expect(document.body.textContent).toContain('déjà installé dans « Cuisine »');
  });

  it('shows a translated message for an API refusal instead of the raw French text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'POST')
          return Promise.resolve({
            ok: false,
            status: 403,
            json: () =>
              Promise.resolve({ message: 'Accès administrateur requis.', code: 'ADMIN_REQUIRED' }),
          });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      }),
    );
    await renderFlow();
    const start = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Rechercher mon capteur'),
    )!;
    await act(async () => {
      start.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Seul un administrateur du foyer');
  });

  it('stops a search it could not confirm when the person closes the screen', async () => {
    const onClose = vi.fn();
    let posted = false;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted = true;
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      if (init?.method === 'DELETE')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      if (url.endsWith('/current') && posted)
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...session, status: 'WAITING_FOR_DEVICE', id: 'late' }),
        });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(
        <SensorOnboardingDialog
          open
          locale="fr"
          rooms={[{ id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' }]}
          initialRoomId="salon"
          onClose={onClose}
          onInstalled={() => Promise.resolve()}
        />,
      );
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    const start = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Rechercher mon capteur'),
    )!;
    await act(async () => {
      start.click();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Impossible de joindre Élise');
    const close = document.body.querySelector<HTMLButtonElement>('[aria-label="Fermer"]');
    expect(close).toBeTruthy();
    await act(async () => {
      close!.click();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    expect(calls.some(([url, init]) => init?.method === 'DELETE' && url.endsWith('/late'))).toBe(
      true,
    );
    expect(onClose).toHaveBeenCalled();
  });
});
