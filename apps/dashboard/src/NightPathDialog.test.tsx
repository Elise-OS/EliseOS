// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NightPathOverview } from '@elise/contracts';
import { NightPathDialog, NightPathEditor, NightPathList } from './NightPathDialog';
import { emptyNightPathDraft, nightPathDraftProblem, nightPathSummary } from './night-path-view';
import { inLanguage } from './i18n/test-language';

const rooms: NightPathOverview['rooms'] = [
  {
    id: 'bedroom',
    name: 'Chambre',
    kind: 'BEDROOM',
    floorName: null,
    presenceSensors: 1,
    bedSensors: 0,
    lights: 1,
  },
  {
    id: 'hallway',
    name: 'Couloir',
    kind: 'HALLWAY',
    floorName: null,
    presenceSensors: 0,
    bedSensors: 0,
    lights: 1,
  },
  {
    id: 'toilet',
    name: 'Toilettes',
    kind: 'TOILET',
    floorName: null,
    presenceSensors: 0,
    bedSensors: 0,
    lights: 1,
  },
  {
    id: 'kitchen',
    name: 'Cuisine',
    kind: 'KITCHEN',
    floorName: null,
    presenceSensors: 1,
    bedSensors: 0,
    lights: 0,
  },
];

const path = {
  id: 'path-1',
  name: 'Chambre → toilettes',
  enabled: true,
  triggerRoomIds: ['bedroom'],
  includeBedExit: true,
  lightRoomIds: ['bedroom', 'hallway', 'toilet'],
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  brightnessPercent: 25,
  colorTemperatureKelvin: 2_200,
  offDelayMinutes: 3 as const,
  createdAt: '2026-11-27T10:00:00.000Z',
  updatedAt: '2026-11-27T10:00:00.000Z',
  activeUntil: null,
};

const overview: NightPathOverview = { timezone: 'Europe/Paris', rooms, paths: [path] };
const noop = () => undefined;

describe('night path summary', () => {
  it('reads like a sentence for the family', () => {
    expect(nightPathSummary(path, rooms, 'Jeanne')).toBe(
      'La nuit, de 22 h à 7 h, quand Jeanne bouge dans chambre : chambre, couloir et toilettes s’allument doucement.',
    );
  });

  it('uses the singular for one lit room and mentions the bed only with a bed sensor', () => {
    expect(nightPathSummary({ ...path, lightRoomIds: ['hallway'] }, rooms, 'Jeanne')).toContain(
      'couloir s’allume doucement',
    );
    const withBed = rooms.map((room) =>
      room.id === 'bedroom' ? { ...room, bedSensors: 1 } : room,
    );
    expect(nightPathSummary(path, withBed, 'Jeanne')).toContain('se lève du lit ou bouge');
  });

  it('is translated', () => {
    const english = inLanguage('en', () => nightPathSummary(path, rooms, 'Jeanne'));
    expect(english).toMatch(/^At night, from .+ to .+, when Jeanne moves in chambre: /);
    expect(english).toMatch(/chambre, couloir,? and toilettes softly turn on\.$/);
  });

  it('starts a new path with the bedroom and every lit room, softly and warmly', () => {
    const draft = emptyNightPathDraft(rooms, 0);
    expect(draft.triggerRoomIds).toEqual(['bedroom']);
    expect(draft.lightRoomIds).toEqual(['bedroom', 'hallway', 'toilet']);
    expect(draft.brightnessPercent).toBe(25);
    expect(draft.offDelayMinutes).toBe(3);
    expect(nightPathDraftProblem(draft)).toBeNull();
    expect(nightPathDraftProblem({ ...draft, lightRoomIds: [] })).toBe(
      'Choisissez au moins une pièce à éclairer.',
    );
    expect(nightPathDraftProblem({ ...draft, endMinute: draft.startMinute })).toBe(
      'Le début et la fin de la nuit doivent être différents.',
    );
  });
});

describe('night path list', () => {
  const render = (props: Partial<Parameters<typeof NightPathList>[0]> = {}) =>
    renderToStaticMarkup(
      <NightPathList
        overview={overview}
        resident="Jeanne"
        canManage
        busyId={null}
        confirmDelete={null}
        onCreate={noop}
        onEdit={noop}
        onToggle={noop}
        onAskDelete={noop}
        onDelete={noop}
        {...props}
      />,
    );

  it('shows each path with its summary, an accessible switch and its actions', () => {
    const html = render();
    expect(html).toContain('Chambre → toilettes');
    expect(html).toContain('En service');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Modifier');
    expect(html).toContain('Ajouter un autre chemin');
    expect(html).toContain('pas un dispositif médical');
    expect(html).not.toMatch(/Home Assistant|MQTT|light\./);
  });

  it('shows a lit path, the empty state and the read-only view', () => {
    expect(
      render({
        overview: { ...overview, paths: [{ ...path, activeUntil: '2026-11-27T23:42:00.000Z' }] },
      }),
    ).toContain('Allumé jusqu’à');
    const empty = render({ overview: { ...overview, paths: [] } });
    expect(empty).toContain('Aucun chemin lumineux pour l’instant');
    expect(empty).toContain('Créer un chemin lumineux');
    const readOnly = render({ canManage: false });
    expect(readOnly).not.toContain('role="switch"');
    expect(readOnly).toContain('Seuls le propriétaire et les administrateurs');
  });

  it('explains what is missing when the home has no light yet', () => {
    const html = render({
      overview: { ...overview, paths: [], rooms: rooms.map((room) => ({ ...room, lights: 0 })) },
    });
    expect(html).toContain('Ajoutez un éclairage');
  });
});

describe('night path editor', () => {
  it('offers rooms with a sensor as triggers and rooms with a light to light up', () => {
    const html = renderToStaticMarkup(
      <NightPathEditor
        draft={emptyNightPathDraft(rooms, 0)}
        rooms={rooms}
        resident="Jeanne"
        busy={false}
        testing={false}
        testNotice=""
        error=""
        onChange={noop}
        onCancel={noop}
        onSave={noop}
        onTest={noop}
      />,
    );
    expect(html).toContain('Quand Jeanne bouge dans…');
    expect(html).toContain('Pas de détecteur');
    expect(html).toContain('Pas d’éclairage');
    expect(html).toContain('type="time"');
    expect(html).toContain('value="22:00"');
    expect(html).toContain('value="07:00"');
    expect(html).toContain('type="range"');
    expect(html).toContain('Très chaude');
    expect(html).toContain('3 min');
    expect(html).toContain('Tester');
    expect(html).toContain('Enregistrer');
  });
});

describe('night path dialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads the paths, creates one and tests it', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let current: NightPathOverview = { ...overview, paths: [] };
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
        requests.push({ url, method, body });
        if (url.endsWith('/test'))
          return Promise.resolve(
            new Response(JSON.stringify({ lights: 3, seconds: 20 }), { status: 200 }),
          );
        if (method === 'POST') current = { ...current, paths: [{ ...path, ...(body as object) }] };
        return Promise.resolve(new Response(JSON.stringify(current), { status: 200 }));
      }),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<NightPathDialog resident="Jeanne" canManage onClose={noop} />);
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Aucun chemin lumineux pour l’instant');

    const button = (label: string): HTMLButtonElement =>
      Array.from(document.body.querySelectorAll('button')).find((item) =>
        item.textContent?.includes(label),
      )!;
    const click = (label: string) =>
      act(async () => {
        button(label).click();
        await Promise.resolve();
      });
    await click('Créer un chemin lumineux');
    expect(document.body.textContent).toContain('Nouveau chemin lumineux');

    await click('Tester');
    expect(requests.at(-1)).toMatchObject({
      url: '/api/v1/night-paths/test',
      method: 'POST',
      body: { lightRoomIds: ['bedroom', 'hallway', 'toilet'], brightnessPercent: 25 },
    });
    expect(document.body.textContent).toContain('3 éclairages s’allument pendant 20 secondes.');

    await click('Enregistrer');
    expect(
      requests.find(({ method, url }) => method === 'POST' && url === '/api/v1/night-paths'),
    ).toMatchObject({
      body: { triggerRoomIds: ['bedroom'], offDelayMinutes: 3, colorTemperatureKelvin: 2_200 },
    });
    expect(document.body.textContent).toContain('Chemin de nuit');
    expect(document.body.textContent).toContain('En service');
    act(() => root.unmount());
    host.remove();
  });

  it('keeps an error state with a retry button', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<NightPathDialog resident="Jeanne" canManage onClose={noop} />);
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Les chemins lumineux n’ont pas pu être chargés.');
    expect(document.body.textContent).toContain('Réessayer');
    act(() => root.unmount());
    host.remove();
  });
});
