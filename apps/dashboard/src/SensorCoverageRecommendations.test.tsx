// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ROOM_SENSOR_CATEGORIES, type EquipmentCoverage, type HomePlan } from '@michel/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SensorCoverageRecommendations } from './SensorCoverageRecommendations';
import {
  COVERAGE_FAMILIES,
  COVERAGE_TYPES,
  coverageNeeds,
  coverageProducts,
  coverageState,
} from './coverage-model';
import type { SensorUiDevice } from './sensor-ui';

const plan = {
  levels: [
    {
      id: 'ground',
      name: 'Rez-de-chaussée',
      floor: 0,
      rooms: [
        {
          id: 'living',
          kind: 'LIVING_ROOM',
          name: 'Salon',
          areaM2: 24,
          geometry: { color: '#eee', points: [] },
        },
        {
          id: 'bedroom',
          kind: 'BEDROOM',
          name: 'Chambre',
          geometry: { color: '#eee', points: [] },
        },
        { id: 'entry', kind: 'ENTRANCE', name: 'Entrée', geometry: { color: '#eee', points: [] } },
      ],
    },
  ],
  placements: [],
} as unknown as HomePlan;
const need = (roomId: string, capability: string, targetType = 'ROOM', id = roomId) => ({
  id: targetType + ':' + id + ':' + capability,
  target: {
    id,
    roomId,
    type: targetType,
    label: roomId,
    kind: roomId === 'entry' ? 'MAIN_ENTRANCE' : 'LIVING_ROOM',
  },
  capability,
  priority: 'OPTIONAL',
  reason: '',
  fulfilledByPlacementId: null,
  compatibleDeviceIds: [],
});
const coverage = {
  recommendations: [
    need('living', 'temperature'),
    need('living', 'humidity'),
    need('bedroom', 'temperature'),
    need('entry', 'contact'),
    need('entry', 'contact', 'OPENING', 'door'),
    need('entry', 'motion', 'STAIR', 'stairs'),
  ],
  profiles: [],
  summary: {
    main: [],
    optional: [],
    totals: { required: 0, covered: 0, toAdd: 0, optional: 0 },
    warnings: [],
  },
} as unknown as EquipmentCoverage;
const devices = [
  {
    id: 'climate',
    model: 'STPH-4-1-00',
    room: { id: 'living' },
    enabled: true,
    capabilities: [
      { capability: 'temperature', status: 'ONLINE' },
      { capability: 'humidity', status: 'ONLINE' },
    ],
  },
] as unknown as SensorUiDevice[];

describe('documented sensor coverage', () => {
  it('opens a complete product sheet without room selection or installation actions', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <SensorCoverageRecommendations
            locale="fr"
            coverage={coverage}
            loading={false}
            error=""
            onRetry={() => undefined}
          />,
        ),
      );
      expect(host.querySelectorAll('.coverage-family-list button')).toHaveLength(
        COVERAGE_FAMILIES.length,
      );
      expect(
        host.querySelector('.coverage-type-list button[aria-pressed="true"]')?.textContent,
      ).toContain('Présence');
      expect(host.textContent).not.toContain('À équiper');
      expect(host.textContent).not.toContain('Couvert');
      expect(host.querySelector('.coverage-room-needs')).toBeNull();
      expect(host.textContent).not.toContain('Dans quelle pièce');
      expect(host.textContent).not.toContain('Ajouter dans');
      act(() =>
        host.querySelector<HTMLButtonElement>('.coverage-product .equipment-product-card')!.click(),
      );
      expect(document.body.textContent).toContain('Fonctions documentées');
      expect(document.body.textContent).toContain('Conseils de placement');
      expect(document.body.textContent).toContain('Notice fabricant');
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
  it('exposes all 13 functions including types with no documented product', () => {
    expect(COVERAGE_TYPES).toHaveLength(13);
    expect(coverageState('smoke', coverage, plan, [])).toBe('NO_PRODUCT');
    expect(coverageState('carbon_monoxide', coverage, plan, [])).toBe('NO_PRODUCT');
    expect(coverageState('fall_detection', coverage, plan, [])).toBe('NO_PRODUCT');
    expect(coverageState('energy', coverage, plan, [])).toBe('AVAILABLE');
    expect(coverageState('temperature', coverage, plan, devices)).toBe('MISSING');
    expect(coverageState('humidity', coverage, plan, devices)).toBe('COVERED');
  });
  it('keeps one need per room regardless of floor area and recognizes multifunction equipment', () => {
    const temperature = coverageNeeds('temperature', coverage, plan, devices);
    expect(temperature).toHaveLength(2);
    expect(temperature[0]).toMatchObject({ covered: true, room: { areaM2: 24 } });
    expect(temperature[1]?.room?.areaM2).toBeUndefined();
    expect(coverageNeeds('humidity', coverage, plan, devices)[0]?.covered).toBe(true);
    expect(coverageProducts('temperature').map((p) => p.id)).toEqual(
      coverageProducts('humidity').map((p) => p.id),
    );
  });
  it('uses specific openings instead of duplicating room needs and preserves stair targets', () => {
    expect(coverageNeeds('contact', coverage, plan, [])).toHaveLength(1);
    expect(coverageNeeds('contact', coverage, plan, [])[0]?.target.id).toBe('door');
    expect(coverageNeeds('motion', coverage, plan, [])[0]?.target.type).toBe('STAIR');
  });
  it('keeps all matching products, local photos and documented advice without fabricated ranges', () => {
    expect(coverageProducts('temperature')).toHaveLength(3);
    expect(coverageProducts('energy')).toHaveLength(2);
    expect(coverageProducts('temperature', true)).toEqual([]);
    for (const p of coverageProducts('presence')) {
      expect(p.image).toMatch(/^\/sensor-products\//);
      expect(p.recommendation?.sourceUrl).toBe(p.manualUrl);
      expect(p.recommendation?.detectionDistanceM).toBeUndefined();
    }
  });
  it('renders a documented product and setup completion without room choices or statuses', () => {
    const html = renderToStaticMarkup(
      <SensorCoverageRecommendations
        locale="fr"
        coverage={coverage}
        loading={false}
        error=""
        onRetry={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect(COVERAGE_TYPES).toHaveLength(ROOM_SENSOR_CATEGORIES.length + 1);
    expect(html).toContain('Confort et qualité de l’air');
    expect(html).not.toContain('24 m²');
    expect(html).not.toContain('Dans quelle pièce');
    expect(html).not.toContain('À équiper');
    expect(html).toContain('3RPL01084Z.png');
    expect(html).toContain('Terminer la création');
    expect(html).not.toContain('capteurs pour couvrir le logement');
    expect(html).not.toContain('Voir les capteurs recommandés');
  });
  it('retains loading, error and English states', () => {
    const render = (loading: boolean, error: string) =>
      renderToStaticMarkup(
        <SensorCoverageRecommendations
          locale="en"
          coverage={coverage}
          loading={loading}
          error={error}
          onRetry={() => undefined}
        />,
      );
    expect(render(false, '')).toContain('Documented models');
    expect(render(true, '')).toContain('role="status"');
    expect(render(false, 'Network unavailable')).toContain('role="alert"');
    expect(render(false, 'Network unavailable')).toContain('Try again');
  });
});
