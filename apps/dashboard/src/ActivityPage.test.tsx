// @vitest-environment jsdom

import type { ActivitySummary, HomePlan, RoutinesSummary } from '@michel/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityPage } from './ActivityPage';

const activityEvent = {
  id: 'event-1',
  occurredAt: '2026-08-02T10:15:00.000Z',
  capability: 'motion' as const,
  quality: 'good',
  payload: { active: true },
  roomId: 'salon',
  roomName: 'Salon',
  sensorId: 'sensor-1',
  sensorName: 'Capteur du salon',
  sensorStatus: 'ONLINE',
  unit: null,
  targetType: 'ROOM' as const,
  targetId: 'salon',
  passage: null,
};

const summary = {
  period: '24h',
  from: '2026-08-01T22:00:00.000Z',
  to: '2026-08-02T20:00:00.000Z',
  total: 1,
  buckets: [{ start: '2026-08-02T10:00:00.000Z', label: '12 h', count: 1 }],
  byRoom: [{ id: 'salon', name: 'Salon', count: 1 }],
  byCapability: [{ capability: 'motion', count: 1 }],
  dwellByRoom: [
    {
      id: 'salon',
      name: 'Salon',
      totalSeconds: 1_800,
      averageSeconds: 1_800,
      medianSeconds: 1_800,
      sessions: 1,
      reliableSessions: 1,
      ambiguousSeconds: 0,
      confidenceRate: 1,
    },
  ],
  unknownSeconds: 1_800,
  reliableBuckets: [
    {
      start: '2026-08-02T10:00:00.000Z',
      label: '12 h',
      seconds: 1_800,
      byRoom: { salon: 1_800 },
    },
  ],
  observedSeconds: 1_800,
  unobservedSeconds: 1_800,
  lastReliableActivity: activityEvent,
  rooms: [
    {
      id: 'salon',
      name: 'Salon',
      kind: 'LIVING_ROOM',
      floor: 0,
      state: 'OBSERVED',
      environmentState: 'OBSERVED',
      sensorCount: 2,
      lastActivity: activityEvent,
      environment: [
        {
          capability: 'temperature',
          latestValue: '21',
          numericValue: 21,
          unit: '°C',
          minimum: 18,
          maximum: 22,
          points: [
            { occurredAt: '2026-08-02T08:00:00.000Z', value: 18 },
            { occurredAt: '2026-08-02T10:00:00.000Z', value: 21 },
          ],
        },
      ],
      safety: [],
    },
    {
      id: 'chambre',
      name: 'Chambre',
      kind: 'BEDROOM',
      floor: 1,
      state: 'NOT_EQUIPPED',
      environmentState: 'NOT_EQUIPPED',
      sensorCount: 0,
      lastActivity: null,
      environment: [],
      safety: [],
    },
  ],
  sequences: [
    {
      id: 'sequence-1',
      startedAt: activityEvent.occurredAt,
      endedAt: activityEvent.occurredAt,
      durationSeconds: 0,
      roomIds: ['salon'],
      roomNames: ['Salon'],
      passages: [],
      totalEventCount: 1,
      hiddenEventCount: 0,
      events: [activityEvent],
    },
  ],
  hasMoreSequences: false,
} satisfies ActivitySummary;

const plan = {
  levels: [
    {
      id: 'ground',
      name: 'Rez-de-chaussée',
      floor: 0,
      order: 0,
      rooms: [
        {
          id: 'salon',
          name: 'Salon',
          kind: 'LIVING_ROOM',
          geometry: { color: '#DDEFF0', points: [] },
        },
      ],
      stairs: [
        {
          id: 'stair-1',
          fromFloorId: 'ground',
          toFloorId: 'first',
          fromRoomId: 'salon',
          toRoomId: 'chambre',
        },
      ],
    },
    {
      id: 'first',
      name: 'Étage',
      floor: 1,
      order: 1,
      rooms: [
        {
          id: 'chambre',
          name: 'Chambre',
          kind: 'BEDROOM',
          geometry: { color: '#F5EADB', points: [] },
        },
      ],
      stairs: [],
    },
  ],
} as unknown as HomePlan;

const routines = {
  learningDays: 14,
  requiredLearningDays: 14,
  progress: 1,
  coverageSufficient: true,
  behavioralAlertsEnabled: true,
  window: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-02T20:00:00.000Z' },
  rooms: [],
  changes: [],
} satisfies RoutinesSummary;

class FakeEventSource {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public close = vi.fn();
}

describe('ActivityPage', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  const renderPage = async (locale: 'fr' | 'en' = 'fr') => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const data = url.includes('/analytics/activity')
        ? summary
        : url.includes('/household/plan')
          ? plan
          : routines;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const openRoom = vi.fn();
    const openStair = vi.fn();
    await act(async () => {
      root!.render(
        <ActivityPage
          locale={locale}
          homeName="Maison de Michel"
          timeZone="Europe/Paris"
          residentName="Michel"
          reassurance="NORMAL"
          openAlerts={1}
          canManage
          onOpenAlerts={() => undefined}
          onOpenRoom={openRoom}
          onOpenStair={openStair}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return { fetchMock, openRoom, openStair };
  };

  it('shows every planned room and opens the correct room when equipment is missing', async () => {
    const { openRoom, openStair } = await renderPage();

    expect(host!.textContent).toContain('La journée de Michel suit son rythme habituel');
    expect(host!.textContent).toContain('Salon');
    expect(host!.textContent).toContain('Chambre');
    expect(host!.textContent).toContain('Pas encore équipée');
    expect(host!.textContent).toContain('Rez-de-chaussée ↔ Étage');

    const equip = Array.from(host!.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Équiper cette pièce'),
    );
    act(() => equip!.click());
    expect(openRoom).toHaveBeenCalledWith('chambre');

    const stair = Array.from(
      host!.querySelectorAll<HTMLButtonElement>('.activity-passages button'),
    )[0];
    act(() => stair!.click());
    expect(openStair).toHaveBeenCalledWith('stair-1');
  });

  it('filters a room, exposes environment trends and keeps raw events expandable', async () => {
    await renderPage();
    const salon = Array.from(
      host!.querySelectorAll<HTMLButtonElement>('.activity-room-select'),
    ).find((button) => button.textContent?.includes('Salon'));
    act(() => salon!.click());
    expect(host!.textContent).toContain('Détail de la pièce');
    expect(host!.textContent).toContain('Sessions fiables');

    const environment = Array.from(host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent?.includes('Environnement'),
    );
    act(() => environment!.click());
    expect(host!.textContent).toContain('Température');
    expect(host!.textContent).toContain('Min. 18 °C');

    const sequence = host!.querySelector<HTMLDetailsElement>('.activity-sequence');
    act(() => {
      sequence!.open = true;
      sequence!.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    expect(host!.textContent).toContain('Capteur du salon');
    expect(host!.textContent).toContain('Fiable');
  });

  it('keeps the new experience fully available in English', async () => {
    await renderPage('en');
    expect(host!.textContent).toContain('Michel’s day is following its usual rhythm');
    expect(host!.textContent).toContain('Home life');
    expect(host!.textContent).toContain('Environment & equipment');
    expect(host!.textContent).toContain('Not equipped yet');
  });
});
