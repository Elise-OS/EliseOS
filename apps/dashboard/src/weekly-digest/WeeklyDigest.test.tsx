// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWeeklyDigestDemo, type WeeklyDigest } from '@elise/contracts';
import { setLanguage } from '../i18n';
import { WeeklyDigestCard, WeeklyDigestDialog, fetchWeeklyDigest } from './WeeklyDigest';

const demo = createWeeklyDigestDemo({
  now: () => new Date('2026-10-13T08:40:00Z'),
  timeZone: 'Europe/Paris',
  residentName: 'Jeanne',
  labels: {
    visitors: { help: 'Sophie Bernard', son: 'Luc Martin', daughter: 'Claire Martin' },
    appointment: 'Dr Bernard',
    alertMorning: 'Aucun mouvement ce matin dans la cuisine',
    alertBattery: 'Batterie faible',
    sensorName: 'Détecteur de mouvement',
    sensorRoom: 'Salle de bain',
  },
});
const latest = demo.digest()!;

const run = (callback: () => unknown) =>
  act(async () => {
    callback();
    await Promise.resolve();
  });

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('Weekly digest of the notebook (web)', () => {
  let root: Root;
  let host: HTMLDivElement;
  let requests: string[];
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    setLanguage('fr');
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requests.push(url);
        if (url.includes('/pdf'))
          return Promise.resolve({
            ok: true,
            blob: () => Promise.resolve(new Blob(['%PDF-1.3'], { type: 'application/pdf' })),
          });
        const week = new URL(url, 'http://box').searchParams.get('week');
        const digest = demo.digest(week);
        return Promise.resolve({
          ok: Boolean(digest),
          status: digest ? 200 : 404,
          json: () => Promise.resolve(digest),
        });
      }),
    );
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:pdf', revokeObjectURL: () => undefined }),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await run(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('shows the week, its sentence and what changed first on the card', async () => {
    const open = vi.fn();
    await run(() => root.render(<WeeklyDigestCard answer={{ digest: latest }} onOpen={open} />));
    const text = host.textContent ?? '';
    expect(text).toContain('Bilan de la semaine · Du 5 au 11 octobre');
    expect(text).toContain('4 changements par rapport aux habitudes cette semaine.');
    expect(text).toContain('Lever en moyenne 40 min plus tard que d’habitude');
    expect(text).toContain('3 repas semblent manqués');
    expect(host.querySelectorAll('.wd-mini')).toHaveLength(4);
    await run(() => host.querySelector<HTMLButtonElement>('.wd-card__open')!.click());
    expect(open).toHaveBeenCalled();
  });

  it('says plainly when the first digest is not ready yet', async () => {
    await run(() => root.render(<WeeklyDigestCard answer={{ missing: true }} onOpen={() => {}} />));
    expect(host.textContent).toContain('Le bilan de cette semaine sera prêt dimanche soir.');
  });

  it('opens the details: changes first, the four themes, alerts, sensors, the reminder', async () => {
    await run(() => root.render(<WeeklyDigestDialog initial={latest} onClose={() => {}} />));
    const dialog = host.querySelector('[role="dialog"]')!;
    const text = dialog.textContent ?? '';
    const changes = dialog.querySelector('.wd-changes')!;
    expect(changes.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    expect(changes.querySelectorAll('li').length).toBeLessThanOrEqual(5);
    for (const title of [
      'Les nuits',
      'Les repas',
      'Les sorties',
      'Les visites',
      'Les alertes',
      'Capteurs et données',
    ])
      expect(text).toContain(title);
    expect(dialog.querySelectorAll('svg.wd-chart')).toHaveLength(4);
    expect(text).toContain('Détecteur de mouvement · Salle de bain');
    expect(text).toContain('Estimations issues de capteurs, pas un dispositif médical.');
    expect(text).toContain('Élise ne reconnaît pas les personnes');
  });

  it('goes to the previous week and back, never past the latest one', async () => {
    await run(() => root.render(<WeeklyDigestDialog initial={latest} onClose={() => {}} />));
    const [previous, next] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.wd-weeknav button'),
    );
    expect(next!.disabled).toBe(true);
    await run(() => previous!.click());
    await flush();
    expect(requests.at(-1)).toContain('week=2026-09-28');
    expect(host.textContent).toContain('Du 28 septembre au 4 octobre 2026');
    expect(host.textContent).toContain('Une semaine calme, proche des habitudes.');
    await run(() => host.querySelectorAll<HTMLButtonElement>('.wd-weeknav button')[1]!.click());
    await flush();
    expect(host.textContent).toContain('Du 5 au 11 octobre 2026');
  });

  it('downloads the PDF made on the box for the week shown', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await run(() => root.render(<WeeklyDigestDialog initial={latest} onClose={() => {}} />));
    await run(() => host.querySelector<HTMLButtonElement>('.wd-export')!.click());
    await flush();
    expect(requests.at(-1)).toBe('/api/v1/weekly-digest/pdf?week=2026-10-05&lang=fr');
    expect(click).toHaveBeenCalled();
    expect(host.textContent).toContain('Le PDF est enregistré dans vos téléchargements.');
  });

  it('speaks the language of the family', async () => {
    setLanguage('it');
    await run(() => root.render(<WeeklyDigestDialog initial={latest} onClose={() => {}} />));
    expect(host.textContent).toContain('Resoconto della settimana');
    expect(host.textContent).toContain('Esporta in PDF');
    expect(host.textContent).toContain('non è un dispositivo medico');
  });

  it('refuses an answer that is not a digest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) }),
      ),
    );
    expect(await fetchWeeklyDigest()).toEqual({ failed: true });
    const digest: WeeklyDigest = latest;
    expect(digest.weekStart).toBe('2026-10-05');
  });
});
