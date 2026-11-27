// @vitest-environment jsdom
import {
  createHeatwaveDemo,
  DEFAULT_HEATWAVE_SETTINGS,
  type HeatwaveDemo,
  type HeatwaveSettings,
} from '@elise/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeatwaveCard } from './HeatwaveCard';
import { HydrationReminderOverlay } from './HeatwaveScreen';
import { heatwaveSummary } from './heatwave-text';

vi.mock('../realtime', () => ({ subscribeRealtime: () => () => undefined }));

const flush = async () => {
  for (let index = 0; index < 4; index += 1) await act(async () => await Promise.resolve());
};

describe('HeatwaveCard', () => {
  let root: Root;
  let host: HTMLDivElement;
  let demo: HeatwaveDemo;
  let requests: Array<{ method: string; path: string; body: string | undefined }>;

  const serve = (answer?: (path: string) => Response | null) =>
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        const path = input.replace('/api/v1', '');
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? init.body : undefined;
        requests.push({ method, path, body });
        const custom = answer?.(path);
        if (custom) return Promise.resolve(custom);
        const result = demo.handle(method, path, body) ?? { status: 404, body: {} };
        return Promise.resolve(
          new Response(JSON.stringify(result.body ?? null), { status: result.status }),
        );
      }),
    );

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    requests = [];
    demo = createHeatwaveDemo({
      heat: true,
      city: 'Lyon',
      rooms: { warm: 'Chambre', mild: 'Salon' },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('shows the heat of the day, the reminders and the not-medical notice', async () => {
    serve();
    act(() => root.render(<HeatwaveCard />));
    await flush();
    const text = host.textContent ?? '';
    expect(text).toContain('Mode canicule');
    expect(text).toContain('Activé');
    expect(text).toContain('29,4 °C · Chambre');
    expect(text).toContain('Prévision à Lyon');
    expect(text).toContain('Aujourd’hui 34 °C · demain 35 °C');
    expect(text).toContain('1 confirmé · 0 sans réponse');
    expect(text).toContain('pas un dispositif médical');
  });

  it('lets the family turn the mode off and opens the settings window', async () => {
    serve();
    act(() => root.render(<HeatwaveCard />));
    await flush();
    const button = (label: string) =>
      Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes(label));
    act(() => button('Désactiver')?.click());
    await flush();
    expect(requests.some((r) => r.method === 'POST' && r.path === '/heatwave/manual')).toBe(true);
    expect(host.textContent).toContain('En pause');

    act(() => button('Réglages')?.click());
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Réglages du mode canicule');
    expect(dialog?.querySelectorAll('[role="switch"]').length).toBe(5);
    const reminders = dialog?.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Rappels « boire »"]',
    );
    act(() => reminders?.click());
    expect(dialog?.textContent).toContain('Aucun rappel « boire » à la TV.');
    act(() => dialog?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    await flush();
    const put = requests.find((r) => r.method === 'PUT');
    expect(put?.path).toBe('/heatwave/settings');
    const saved = JSON.parse(put?.body ?? '{}') as HeatwaveSettings;
    expect(saved.reminders.enabled).toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain('Rappels désactivés');
  });

  it('stays hidden on a box that does not know the heatwave mode', async () => {
    serve(() => new Response('{}', { status: 404 }));
    act(() => root.render(<HeatwaveCard />));
    await flush();
    expect(host.textContent).toBe('');
  });
});

describe('HydrationReminderOverlay', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('answers « C’est fait » with the remote button', () => {
    const onConfirm = vi.fn();
    const reminder = {
      id: 'hydration-1',
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    };
    act(() =>
      root.render(
        <HydrationReminderOverlay reminder={reminder} thanked={false} onConfirm={onConfirm} />,
      ),
    );
    expect(host.textContent).toContain('C’est le moment de boire un verre d’eau');
    expect(host.textContent).toContain('C’est fait');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F13' }));
    });
    expect(onConfirm).toHaveBeenCalledWith('hydration-1');
  });

  it('does not show a reminder whose time is over', () => {
    const reminder = {
      id: 'hydration-2',
      scheduledFor: new Date(Date.now() - 20 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    act(() =>
      root.render(
        <HydrationReminderOverlay reminder={reminder} thanked={false} onConfirm={vi.fn()} />,
      ),
    );
    expect(host.textContent).toBe('');
  });
});

describe('heatwaveSummary', () => {
  it('tells the default settings in plain words', () => {
    expect(heatwaveSummary(DEFAULT_HEATWAVE_SETTINGS)).toEqual([
      'Élise active le mode canicule quand une pièce atteint 28 °C pendant 30 min, ou quand la météo annonce 33 °C ou plus pour aujourd’hui ou demain.',
      'Pendant le mode, la TV propose un verre d’eau toutes les 2 h, de 9 h à 20 h.',
      'Elle donne aussi des conseils selon le moment de la journée.',
      'La famille est alertée si une pièce reste à 31 °C ou plus pendant 1 h.',
    ]);
  });
});
