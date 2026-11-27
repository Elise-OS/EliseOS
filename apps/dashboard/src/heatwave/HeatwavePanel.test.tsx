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
import { HeatwavePanel } from './HeatwavePanel';
import { HydrationReminderOverlay } from './HeatwaveScreen';
import { heatwaveSummary } from './heatwave-text';

vi.mock('../realtime', () => ({ subscribeRealtime: () => () => undefined }));

const flush = async () => {
  for (let index = 0; index < 4; index += 1) await act(async () => await Promise.resolve());
};

describe('HeatwavePanel', () => {
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
    // 10:40 in Paris: the 9 h reminder has been shown, the next one is at 11 h.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-15T08:40:00Z') });
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
    vi.useRealTimers();
  });

  it('explains how the mode works and shows the figures of the day', async () => {
    serve();
    act(() => root.render(<HeatwavePanel />));
    await flush();
    const text = host.textContent ?? '';
    expect(host.querySelector('#heatwave-panel-title')?.textContent).toBe('Canicule');
    // A strong state banner: amber, the state in words, the reason and what Élise does now.
    const verdict = host.querySelector('.heatwave-verdict');
    expect(verdict?.className).toContain('is-active');
    expect(verdict?.querySelector('h3')?.textContent).toBe('Le mode canicule est activé');
    expect(verdict?.querySelector('.heatwave-pill')?.textContent).toBe('Activé');
    const chips = Array.from(host.querySelectorAll('.heatwave-chips li'));
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Bandeau ambré à la TV',
      'Un verre d’eau toutes les 2 h',
      'Conseils selon l’heure',
      'Famille alertée dès 31 °C',
    ]);
    // The saved thresholds, summed up in short rows.
    const rows = Array.from(host.querySelectorAll('.heatwave-threshold')).map((row) => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent,
    ]);
    expect(rows).toEqual([
      ['Chaleur dans le logement', 'Dès 28 °C pendant 30 min'],
      ['Prévision météo', 'Dès 33 °C annoncés'],
      ['Arrêt automatique', 'Sous 27 °C pendant 2 h, météo sous 33 °C'],
      ['Rappels « boire »', 'Toutes les 2 h, de 9 h à 20 h'],
      ['Conseils', 'Selon le moment de la journée'],
      ['Alerte forte chaleur', 'Dès 31 °C pendant 1 h'],
    ]);
    expect(text).toContain('Forte chaleur annoncée à Lyon : 34 °C');
    // Today's tiles, on the heat scale of the saved thresholds.
    expect(host.querySelector('.heatwave-tile--warm')?.textContent).toContain('29,4°C');
    expect(text).toContain('Max. du jour · Chambre');
    expect(host.querySelector('.heatwave-tile--hot')?.textContent).toContain('34°C');
    expect(text).toContain('Demain 35 °C');
    expect(host.querySelector('.heatwave-gauge')?.getAttribute('aria-label')).toContain(
      'seuil du mode à 28 °C, alerte à 31 °C',
    );
    // Reminders of the day: 9 h shown, 11 h next, the rest later.
    expect(host.querySelector('.heatwave-tile--reminders .heatwave-figure')?.textContent).toBe('1');
    expect(text).toContain('rappel affiché aujourd’hui');
    expect(text).toContain('Prochain à 11:00');
    const dots = Array.from(host.querySelectorAll('.heatwave-timeline__dot')).map(
      (dot) => dot.className.split('is-')[1],
    );
    expect(dots).toEqual(['shown', 'next', 'later', 'later', 'later', 'later']);
    // How it works, in four steps from the saved settings.
    const steps = Array.from(host.querySelectorAll('.heatwave-step strong')).map(
      (step) => step.textContent,
    );
    expect(steps).toEqual([
      'Élise détecte la chaleur',
      'La TV rappelle de boire',
      'La famille est prévenue',
      'Tout s’arrête seul',
    ]);
    expect(text).toContain('quand une pièce reste à 28 °C ou plus pendant 30 min');
    expect(text).toContain('33 °C ou plus pour aujourd’hui ou demain à Lyon');
    expect(text).toContain('Toutes les 2 h, de 9 h à 20 h');
    expect(text).toContain('la personne n’a rien à appuyer');
    expect(text).toContain('31 °C ou plus pendant 1 h');
    expect(text).toContain('toutes les pièces restent sous 27 °C pendant 2 h');
    expect(text).toContain('la personne aidée n’a jamais rien à appuyer');
    expect(host.querySelector('.heatwave-medical')?.textContent).toContain(
      'appelez le 15 ou le 112',
    );
    expect(text).not.toMatch(/confirm|sans réponse|télécommande|pas encore (testé|validé)/i);
  });

  it('lets the family turn the mode off and opens the settings window', async () => {
    serve();
    act(() => root.render(<HeatwavePanel />));
    await flush();
    const button = (label: string) =>
      Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes(label));
    act(() => button('Désactiver')?.click());
    await flush();
    expect(requests.some((r) => r.method === 'POST' && r.path === '/heatwave/manual')).toBe(true);
    expect(host.textContent).toContain('En pause');
    expect(host.querySelector('.heatwave-verdict h3')?.textContent).toBe(
      'Le mode canicule est en pause',
    );
    expect(host.textContent).toContain('Se réarme sous 27 °C');

    act(() => button('Modifier les réglages')?.click());
    // The window opens on the page itself, out of the card.
    const dialog = document.body.querySelector('[role="dialog"]');
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
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain('Rappels désactivés');
    expect(host.querySelector('.heatwave-threshold--reminders')?.textContent).toContain(
      'Aucun rappel',
    );
  });

  it('opens the same settings window from the « Modifier » button of the thresholds', async () => {
    serve();
    act(() => root.render(<HeatwavePanel />));
    await flush();
    const edit = host.querySelector<HTMLButtonElement>('.heatwave-thresholds button');
    expect(edit?.textContent).toBe('Modifier');
    expect(edit?.getAttribute('aria-label')).toBe('Modifier les réglages');
    act(() => edit?.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Réglages du mode canicule',
    );
  });

  it('stays calm while the mode stands by and tells what Élise watches', async () => {
    demo = createHeatwaveDemo({
      heat: false,
      city: 'Lyon',
      rooms: { warm: 'Chambre', mild: 'Salon' },
    });
    serve();
    act(() => root.render(<HeatwavePanel />));
    await flush();
    expect(host.querySelector('.heatwave-verdict')?.className).toContain('is-idle');
    expect(host.querySelector('.heatwave-verdict h3')?.textContent).toBe(
      'Le mode canicule est en veille',
    );
    const chips = Array.from(host.querySelectorAll('.heatwave-chips li'));
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Logement : dès 28 °C',
      'Météo : dès 33 °C',
    ]);
    const labels = Array.from(host.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toContain('Activer maintenant');
  });

  it('lets a viewer read the card without changing anything', async () => {
    serve((path) => {
      if (path !== '/heatwave') return null;
      const status = demo.handle('GET', '/heatwave')?.body as Record<string, unknown>;
      return new Response(JSON.stringify({ ...status, canManage: false, canToggle: false }));
    });
    act(() => root.render(<HeatwavePanel />));
    await flush();
    expect(host.textContent).toContain('Comment ça marche');
    expect(host.textContent).toContain('Seuls le propriétaire et les administrateurs');
    const labels = Array.from(host.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('Désactiver');
    expect(labels.some((label) => label?.includes('Modifier'))).toBe(false);
    expect(host.textContent).toContain('Dès 28 °C pendant 30 min');
  });

  it('explains, on a box that does not know the heatwave mode, how to get it', async () => {
    serve(() => new Response('{}', { status: 404 }));
    act(() => root.render(<HeatwavePanel />));
    await flush();
    expect(host.textContent).toContain('Mode canicule indisponible sur cette box');
    expect(host.textContent).toContain('depuis l’onglet Général');
    expect(host.querySelector('button')).toBeNull();
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

  it('only shows the reminder: no button, no key handled, nothing takes the focus', () => {
    const listen = vi.spyOn(window, 'addEventListener');
    const reminder = {
      id: 'hydration-1',
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    };
    act(() => root.render(<HydrationReminderOverlay reminder={reminder} />));
    expect(host.textContent).toContain('C’est le moment de boire un verre d’eau');
    expect(host.textContent).toContain('Quelques gorgées suffisent');
    expect(host.querySelector('button, a, input, [tabindex]')).toBeNull();
    expect(host.textContent).not.toMatch(/C’est fait|télécommande/);
    expect(listen.mock.calls.filter(([type]) => String(type).startsWith('key'))).toEqual([]);
    expect(document.activeElement).toBe(document.body);
    listen.mockRestore();
  });

  it('leaves the screen by itself when its time is over', () => {
    vi.useFakeTimers();
    const reminder = {
      id: 'hydration-3',
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    act(() => root.render(<HydrationReminderOverlay reminder={reminder} />));
    expect(host.textContent).toContain('C’est le moment de boire un verre d’eau');
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(host.textContent).toBe('');
    vi.useRealTimers();
  });

  it('does not show a reminder whose time is over', () => {
    const reminder = {
      id: 'hydration-2',
      scheduledFor: new Date(Date.now() - 20 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    act(() => root.render(<HydrationReminderOverlay reminder={reminder} />));
    expect(host.textContent).toBe('');
  });
});

describe('heatwaveSummary', () => {
  it('tells the default settings in plain words', () => {
    expect(heatwaveSummary(DEFAULT_HEATWAVE_SETTINGS)).toEqual([
      'Élise active le mode canicule quand une pièce atteint 28 °C pendant 30 min, ou quand la météo annonce 33 °C ou plus pour aujourd’hui ou demain.',
      'Pendant le mode, la TV propose un verre d’eau toutes les 2 h, de 9 h à 20 h.',
      'Elle donne aussi des conseils selon le moment de la journée.',
      'La famille est alertée si une pièce reste à 31 °C ou plus pendant 1 h.',
    ]);
  });
});
