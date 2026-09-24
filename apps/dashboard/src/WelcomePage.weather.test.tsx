// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  homeSummarySchema,
  initialScreenState,
  type ScreenSettings,
  type ScreenSnapshot,
} from '@michel/contracts';
import { WelcomePage } from './WelcomePage';

vi.mock('./screen-events', () => ({ subscribeScreenEvents: () => () => undefined }));

describe('Accueil weather settings', () => {
  let root: Root;
  let host: HTMLDivElement;
  let screen: ScreenSnapshot;
  let requests: Array<{ url: string; method: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    requests = [];
    screen = {
      state: initialScreenState(),
      paired: true,
      online: true,
      lastSeen: null,
      capabilities: {},
      grant: {
        call: false,
        autoAnswer: false,
        message: true,
        control: true,
        administer: true,
      },
      jitsiUrl: null,
      resident: 'Michel',
      timezone: 'Europe/Paris',
      visit: null,
      agenda: [],
      weather: null,
    };
    const summary = homeSummarySchema.parse({
      from: '2026-09-24T00:00:00.000Z',
      to: '2026-09-24T12:00:00.000Z',
      timezone: 'Europe/Paris',
      residentName: 'Michel',
      presence: {
        roomId: null,
        detectedAt: null,
        confidence: 'UNKNOWN',
        identifiedResidentId: null,
        source: 'NONE',
        plausibleTransition: null,
      },
      rooms: [],
      roomSummaries: [],
      activityRooms: [],
      cards: [],
      alert: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? 'GET';
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        requests.push({ url, method, body });
        let response: unknown = {};
        if (url.endsWith('/home-summary')) response = summary;
        else if (url.endsWith('/screen')) response = screen;
        else if (url.includes('/screen/weather/cities'))
          response = [
            {
              name: 'Orléans',
              label: 'Orléans, Centre-Val de Loire, France',
              latitude: 47.9029,
              longitude: 1.9039,
            },
            {
              name: 'Tours',
              label: 'Tours, Centre-Val de Loire, France',
              latitude: 47.3941,
              longitude: 0.6848,
            },
          ];
        else if (url.endsWith('/screen/settings') && method === 'PATCH') {
          const settings = body as unknown as ScreenSettings;
          screen = {
            ...screen,
            state: { ...screen.state, settings },
            weather: {
              city: settings.weatherCity,
              temperature: 22,
              minimum: 13,
              maximum: 25,
              weatherCode: 1,
              observedAt: '2026-09-24T12:00:00.000Z',
            },
          };
          response = screen;
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onopen: ((event: Event) => void) | null = null;
        close() {}
      },
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => {
      root.render(
        <WelcomePage
          locale="fr"
          caregiverFirstName="Paul"
          residentName="Michel"
          onAlerts={() => undefined}
          onOpenRoom={() => undefined}
          onActivity={() => undefined}
          onSensors={() => undefined}
          onPlanning={() => undefined}
          onScreen={() => undefined}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function enterCity(value: string) {
    const input = host.querySelector<HTMLInputElement>('#welcome-weather-city')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  it('configures weather from the home hero and lets the city be changed there', async () => {
    await mount();
    const setupButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Configurer la météo'),
    );
    expect(setupButton).toBeTruthy();

    act(() => {
      setupButton!.click();
    });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await enterCity('Orl');
    const orleans = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[role="option"]'),
    ).find((option) => option.textContent?.includes('Orléans'))!;
    act(() => {
      orleans.click();
    });
    const save = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Configurer',
    )!;
    await act(async () => {
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      requests.find((request) => request.url.endsWith('/screen/settings'))?.body,
    ).toMatchObject({ weatherCity: 'Orléans' });
    expect(host.querySelector('.welcome-weather--configured')?.textContent).toContain('Orléans');

    const configuredButton = host.querySelector<HTMLButtonElement>('.welcome-weather--configured')!;
    act(() => {
      configuredButton.click();
    });
    expect(host.querySelector<HTMLInputElement>('#welcome-weather-city')?.value).toBe('Orléans');
    await enterCity('Tou');
    const tours = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[role="option"]'),
    ).find((option) => option.textContent?.includes('Tours'))!;
    act(() => {
      tours.click();
    });
    const update = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Mettre à jour',
    )!;
    await act(async () => {
      update.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      requests.filter((request) => request.url.endsWith('/screen/settings')).at(-1)?.body,
    ).toMatchObject({ weatherCity: 'Tours' });
    expect(host.querySelector('.welcome-weather--configured')?.textContent).toContain('Tours');
  });
});
