// @vitest-environment jsdom

import type { HomePlan } from '@elise/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePlanEditor, PlanUnderstandingPanel } from './HomePlanEditor';

const plan: HomePlan = {
  schemaVersion: 2,
  revision: 1,
  configured: true,
  levels: [
    {
      id: 'ground',
      name: 'Rez-de-chaussée',
      floor: 0,
      order: 0,
      width: 1_200,
      height: 800,
      scaleCmPerUnit: null,
      rooms: [],
      openings: [],
      stairs: [],
      items: [],
    },
  ],
  placements: [],
  connections: [],
  adjacencies: [],
  understanding: {
    levels: [],
    isolatedRoomIds: [],
    adjacentWithoutPassage: [],
    nearAdjacencyIds: [],
    floorsWithoutStairs: [],
    incompleteStairIds: [],
    mainEntranceOpeningId: null,
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const flush = () =>
  act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });

const buttons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('.home-plan-floorbar > button'));

const click = (element: HTMLElement) =>
  act(async () => {
    element.click();
    await Promise.resolve();
  });

const rename = async (input: HTMLInputElement, name: string) => {
  await act(async () => {
    Reflect.set(HTMLInputElement.prototype, 'value', name, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.blur();
    await Promise.resolve();
  });
};

describe('home plan levels', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/v1/household/plan' && init?.method === 'PUT')
          return Promise.resolve(json(JSON.parse(init.body as string)));
        if (url === '/api/v1/household/plan') return Promise.resolve(json(plan));
        if (url === '/api/v1/sensor-devices') return Promise.resolve(json([]));
        return Promise.resolve(json({}, 500));
      }),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        onmessage: (() => void) | null = null;
        close() {}
      },
    );
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('names a new level right away and renames the selected level on click', async () => {
    act(() => {
      root.render(
        <HomePlanEditor
          locale="fr"
          home={undefined}
          sensors={[]}
          cameras={[]}
          onSaved={() => undefined}
        />,
      );
    });
    await flush();

    const add = container.querySelector<HTMLButtonElement>('.home-plan-floorbar .add-floor')!;
    await click(add);
    const newName = container.querySelector<HTMLInputElement>('.floor-name-input')!;
    expect(newName.value).toBe('1er étage');
    await rename(newName, 'Combles');
    expect(container.querySelector('.floor-name-input')).toBeNull();
    expect(buttons(container).map((button) => button.textContent)).toContain('Combles');

    // A click on the level already shown opens its name; a click on another level only selects it.
    const ground = buttons(container).find((button) => button.textContent === 'Rez-de-chaussée')!;
    await click(ground);
    expect(container.querySelector('.floor-name-input')).toBeNull();
    await click(ground);
    const groundName = container.querySelector<HTMLInputElement>('.floor-name-input')!;
    expect(groundName.value).toBe('Rez-de-chaussée');
    await rename(groundName, 'Rez-de-jardin');
    expect(buttons(container).map((button) => button.textContent)).toContain('Rez-de-jardin');
  });

  it('opens the sentences of a level when its card is clicked', async () => {
    const shape = { points: [], color: '#fff' };
    const twoRooms: HomePlan = {
      ...plan,
      levels: [
        {
          ...plan.levels[0]!,
          rooms: [
            { id: 'hall', name: 'Couloir bas', kind: 'HALLWAY', geometry: shape },
            { id: 'living', name: 'Salon', kind: 'LIVING_ROOM', geometry: shape },
          ],
        },
      ],
      connections: [{ id: 'door', kind: 'DOOR', fromRoomId: 'living', toRoomId: 'hall' }],
      adjacencies: [
        {
          id: 'adjacency',
          floorId: 'ground',
          roomIds: ['hall', 'living'],
          sharedWallCm: 300,
          gapCm: 0,
          quality: 'EXACT',
        },
      ],
      understanding: {
        ...plan.understanding,
        levels: [{ floorId: 'ground', roomCount: 2, areaM2: 30, approximate: false }],
      },
    };
    const focused: string[] = [];
    act(() => {
      root.render(
        <PlanUnderstandingPanel
          plan={twoRooms}
          locale="fr"
          updating={false}
          onFocusRoom={() => undefined}
          onFocusFloor={(floorId) => focused.push(floorId)}
        />,
      );
    });
    expect(container.textContent).not.toContain('Salon est relié à Couloir bas');

    const card = container.querySelector<HTMLButtonElement>('.understanding-floors > button')!;
    await click(card);
    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain(
      'Rez-de-chaussée contient 2 pièces, pour 30 m² dessinés.',
    );
    expect(container.textContent).toContain('Salon est relié à Couloir bas.');
    expect(container.textContent).toContain('Couloir bas partage un mur avec Salon.');
    expect(focused).toEqual(['ground']);

    await click(card);
    expect(container.textContent).not.toContain('Salon est relié à Couloir bas');
  });
});
