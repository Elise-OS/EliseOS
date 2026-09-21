// @vitest-environment jsdom

import {
  presenceEstimateSchema,
  type ActivitySummary,
  type HomePlan,
  type HomeSummary,
  type RoutinesSummary,
} from '@michel/contracts';
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

const homeSummary: HomeSummary = {
  from: '2026-09-21T00:00:00.000Z',
  to: '2026-09-21T16:15:00.000Z',
  timezone: 'Europe/Paris',
  residentName: 'Michel',
  presence: presenceEstimateSchema.parse({
    roomId: 'salon',
    detectedAt: '2026-09-21T16:15:00.000Z',
    confidence: 'HIGH',
    identifiedResidentId: null,
    source: 'SENSOR',
    plausibleTransition: null,
    trackingState: 'CONFIRMED',
    confirmedRoomId: 'salon',
  }),
  rooms: [{ id: 'salon', name: 'Salon', kind: 'LIVING_ROOM' }],
  roomSummaries: [],
  latestPresence: {
    roomId: 'salon',
    occurredAt: '2026-09-21T16:15:00.000Z',
    capability: 'occupancy',
  },
  activityRooms: ['Salon'],
  entrance: null,
  cards: [],
  alert: null,
};

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
      const data = url.includes('/home-summary')
        ? homeSummary
        : url.includes('/analytics/activity')
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

  it('keeps the hero minimal and removes the room-by-room block', async () => {
    await renderPage();

    expect(host!.querySelector('.activity-overview-hero h2')?.textContent).toBe('Activité');
    expect(host!.textContent).not.toContain('Rythme observé');
    expect(host!.textContent).not.toContain('Présence fiable dans le logement');
    expect(host!.textContent).not.toContain('Pièce par pièce');
    expect(host!.textContent).not.toContain('Tout le logement reste visible');
    expect(host!.textContent).not.toContain('Couverture');
    expect(host!.textContent).not.toContain('Lecture des pièces');
    expect(host!.textContent).not.toContain('5 derniers mouvements');
    expect(host!.textContent).not.toContain('Aucun mouvement récent à afficher.');
    expect(host!.querySelector('.activity-summary-card')).toBeNull();
    expect(host!.querySelector('.activity-recent-movements-card')).toBeNull();
    expect(host!.querySelector('.activity-hero-last-activity')?.textContent).toContain(
      'La dernière activité fiable a été observée dans Salon',
    );
    expect(host!.textContent).toContain('Salon');
    expect(host!.querySelector('.activity-spaces-card')).toBeNull();
    expect(host!.querySelector('.activity-room-select')).toBeNull();
  });

  it('reuses the live current-situation sentence from the home page', async () => {
    await renderPage();

    expect(host!.querySelector('.activity-moments-header p')?.textContent).toBe(
      'Une vue d’ensemble des activités et déplacements au fil de la journée.',
    );
    expect(host!.querySelector('.activity-current-sequence')?.textContent).toContain(
      'Michel est dans le salon.',
    );
    expect(
      host!.querySelector('.activity-current-sequence .activity-sequence-time')?.textContent,
    ).toContain('18:15');
  });

  it('removes the complete toolbar and keeps raw events expandable', async () => {
    await renderPage();
    expect(host!.querySelector('.activity-view-toolbar')).toBeNull();
    expect(host!.textContent).not.toContain('Vie du domicile');
    expect(host!.textContent).not.toContain('Environnement & équipements');
    expect(host!.textContent).not.toContain('28 jours');
    expect(host!.textContent).not.toContain('Autre jour');

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
    expect(host!.querySelector('.activity-overview-hero h2')?.textContent).toBe('Activity');
    expect(host!.textContent).not.toContain('Home life');
    expect(host!.textContent).not.toContain('Environment & equipment');
    expect(host!.textContent).not.toContain('Last 5 movements');
    expect(host!.textContent).toContain('Movement detected');
  });

  it('opens the seven-day date picker and compares another day', async () => {
    const { fetchMock } = await renderPage();
    const dateButton = host!.querySelector<HTMLButtonElement>('.activity-moments-date');

    act(() => dateButton!.click());
    expect(host!.querySelectorAll('.activity-date-option')).toHaveLength(7);

    const previousDay = host!.querySelectorAll<HTMLButtonElement>('.activity-date-option')[1];
    act(() => previousDay!.click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      fetchMock.mock.calls.some((call: unknown[]) => {
        const input = call[0] as string | URL | Request;
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return url.includes('/analytics/activity') && url.includes('date=');
      }),
    ).toBe(true);

    act(() => host!.querySelector<HTMLButtonElement>('.activity-compare-toggle')!.click());
    const comparisonSelect = host!.querySelector<HTMLSelectElement>('#activity-comparison-date');
    expect(comparisonSelect).not.toBeNull();
    act(() => {
      comparisonSelect!.value = comparisonSelect!.querySelectorAll('option')[1]!.value;
      comparisonSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.textContent).toContain('Écart avec');
  });
});
