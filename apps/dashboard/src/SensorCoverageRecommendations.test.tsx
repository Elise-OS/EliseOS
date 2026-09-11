import type { EquipmentCoverage } from '@michel/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SensorCoverageRecommendations } from './SensorCoverageRecommendations';

const coverage: EquipmentCoverage = {
  recommendations: [],
  profiles: [],
  summary: {
    totals: { required: 2, covered: 1, toAdd: 1, optional: 1 },
    warnings: ['MISSING_MAIN_ENTRANCE'],
    main: [
      {
        id: 'kit:presence',
        profileId: 'presence',
        label: 'Smart Presence Sensor',
        manufacturer: 'Example',
        model: 'P1',
        capabilities: ['person_presence'],
        total: 2,
        covered: 1,
        toAdd: 1,
        targets: [
          {
            target: {
              type: 'ROOM',
              id: 'living',
              roomId: 'living',
              label: 'Salon',
              kind: 'LIVING_ROOM',
            },
            capabilities: ['person_presence'],
            priority: 'RECOMMENDED',
            fulfilled: true,
            deviceName: 'Présence salon',
          },
          {
            target: {
              type: 'ROOM',
              id: 'bedroom',
              roomId: 'bedroom',
              label: 'Chambre',
              kind: 'BEDROOM',
            },
            capabilities: ['person_presence'],
            priority: 'RECOMMENDED',
            fulfilled: false,
            deviceName: null,
          },
        ],
      },
    ],
    optional: [
      {
        id: 'kit:climate',
        profileId: 'climate',
        label: 'Climate Sensor',
        manufacturer: 'Example',
        model: 'T1',
        capabilities: ['temperature'],
        total: 1,
        covered: 0,
        toAdd: 1,
        targets: [
          {
            target: {
              type: 'ROOM',
              id: 'living',
              roomId: 'living',
              label: 'Salon',
              kind: 'LIVING_ROOM',
            },
            capabilities: ['temperature'],
            priority: 'OPTIONAL',
            fulfilled: false,
            deviceName: null,
          },
        ],
      },
    ],
  },
};

describe('sensor coverage recommendations', () => {
  it('renders quantities, models, locations and plan warnings in French', () => {
    const html = renderToStaticMarkup(
      <SensorCoverageRecommendations
        locale="fr"
        coverage={coverage}
        loading={false}
        error=""
        onRetry={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect(html).toContain('Votre couverture recommandée');
    expect(html).toContain('2 capteurs pour couvrir le logement');
    expect(html).toContain('Example · P1');
    expect(html).toContain('Salon');
    expect(html).toContain('Pour aller plus loin');
    expect(html).toContain('L’entrée principale n’est pas dessinée');
    expect(html).toContain('Terminer la création');
  });

  it('renders the complete English flow and accessible error state', () => {
    const english = renderToStaticMarkup(
      <SensorCoverageRecommendations
        locale="en"
        coverage={coverage}
        loading={false}
        error=""
        onRetry={() => undefined}
      />,
    );
    const failed = renderToStaticMarkup(
      <SensorCoverageRecommendations
        locale="en"
        coverage={null}
        loading={false}
        error="Network unavailable"
        onRetry={() => undefined}
      />,
    );
    expect(english).toContain('Your recommended coverage');
    expect(english).toContain('Where to place them');
    expect(english).toContain('Going further');
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Network unavailable');
    expect(failed).toContain('Try again');
  });
});
