import type { HomePlan, SensorDevice } from '@michel/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PlanLegend,
  PlanUnderstandingPanel,
  isRoomSensorDevice,
  sensorDevicePresentation,
  shouldRunHomeSetup,
  StairModal,
} from './HomePlanEditor';

const rectangle = (x: number, y: number, width: number, height: number) => ({
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
  color: '#E8F0F3',
});

const plan: HomePlan = {
  schemaVersion: 2,
  revision: 2,
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
      rooms: [
        { id: 'hall', name: 'Couloir', kind: 'HALLWAY', geometry: rectangle(0, 0, 300, 100) },
        { id: 'kitchen', name: 'Cuisine', kind: 'KITCHEN', geometry: rectangle(0, 100, 300, 300) },
      ],
      openings: [
        {
          id: 'door',
          kind: 'DOOR',
          roomIds: ['hall', 'kitchen'],
          x: 150,
          y: 100,
          width: 90,
          rotation: 0,
        },
        {
          id: 'main-door',
          kind: 'DOOR',
          roomIds: ['hall'],
          x: 0,
          y: 50,
          width: 90,
          rotation: 90,
          isMainEntrance: true,
        },
        {
          id: 'passage',
          kind: 'PASSAGE',
          roomIds: ['hall', 'kitchen'],
          x: 150,
          y: 100,
          width: 130,
          rotation: 0,
          logical: true,
        },
      ],
      stairs: [
        {
          id: 'stairs',
          fromFloorId: 'ground',
          toFloorId: 'first',
          fromRoomId: 'hall',
          toRoomId: 'living',
          x: 300,
          y: 50,
          width: 100,
          height: 180,
          rotation: 0,
        },
      ],
      items: [],
    },
    {
      id: 'first',
      name: '1er étage',
      floor: 1,
      order: 1,
      width: 1_200,
      height: 800,
      scaleCmPerUnit: 1,
      rooms: [
        { id: 'living', name: 'Salon', kind: 'LIVING_ROOM', geometry: rectangle(0, 0, 500, 400) },
      ],
      openings: [],
      stairs: [],
      items: [],
    },
  ],
  placements: [],
  connections: [
    { id: 'door:door', kind: 'DOOR', fromRoomId: 'hall', toRoomId: 'kitchen' },
    { id: 'stair:stairs', kind: 'STAIR', fromRoomId: 'hall', toRoomId: 'living' },
    { id: 'passage:passage', kind: 'PASSAGE', fromRoomId: 'hall', toRoomId: 'kitchen' },
  ],
  adjacencies: [
    {
      id: 'adjacency:ground:hall:kitchen',
      floorId: 'ground',
      roomIds: ['hall', 'kitchen'],
      sharedWallCm: 300,
      gapCm: 0,
      quality: 'EXACT',
    },
  ],
  understanding: {
    levels: [
      { floorId: 'ground', roomCount: 2, areaM2: 12, approximate: true },
      { floorId: 'first', roomCount: 1, areaM2: 20, approximate: false },
    ],
    isolatedRoomIds: [],
    adjacentWithoutPassage: [],
    nearAdjacencyIds: [],
    floorsWithoutStairs: [],
    incompleteStairIds: [],
    mainEntranceOpeningId: 'main-door',
  },
};

describe('structural home understanding', () => {
  it('presents one physical Sonoff device with all of its capabilities', () => {
    const device = {
      id: 'device-sonoff',
      physicalDeviceId: 'device-sonoff',
      name: 'Temperature',
      manufacturer: 'SONOFF',
      model: 'SNZB-02P',
      protocol: 'zigbee',
      integration: 'zigbee2mqtt',
      room: null,
      installationStatus: 'NEEDS_PLACEMENT',
      enabled: true,
      placementConfirmedAt: null,
      lastSeenAt: null,
      batteryPercent: 96,
      action: 'ASSIGN_ROOM',
      capabilities: ['temperature', 'humidity', 'battery'].map((capability, index) => ({
        sensorId: `sensor-${index}`,
        entityId: `sensor.sonoff_${capability}`,
        capability,
        label:
          capability === 'temperature'
            ? 'Température'
            : capability === 'humidity'
              ? 'Humidité'
              : 'Batterie',
        primary: capability !== 'battery',
        status: 'ONLINE' as const,
        value: null,
        unit: null,
        classification: {
          source: 'METADATA' as const,
          confidence: 1,
          reason: null,
          confirmedAt: null,
        },
      })),
    } satisfies SensorDevice;

    expect(sensorDevicePresentation(device)).toEqual({
      name: 'Capteur de température et d’humidité Sonoff',
      details: 'Sonoff · SNZB-02P',
      capabilities: ['Température', 'Humidité', 'Batterie'],
    });
    expect(isRoomSensorDevice(device)).toBe(true);
  });

  it('does not offer technical or battery-only entities as room sensors', () => {
    const technicalDevice = {
      capabilities: [{ capability: 'battery' }],
    } as SensorDevice;
    expect(isRoomSensorDevice(technicalDevice)).toBe(false);
  });

  it('only launches setup for a real draft, never for manage or live views of existing homes', () => {
    expect(
      shouldRunHomeSetup({
        configured: false,
        installationStatus: 'DRAFT',
        readOnly: false,
        preview: false,
      }),
    ).toBe(true);
    expect(
      shouldRunHomeSetup({
        configured: false,
        installationStatus: 'LEARNING',
        readOnly: false,
        preview: false,
      }),
    ).toBe(false);
    expect(
      shouldRunHomeSetup({
        configured: false,
        installationStatus: 'DRAFT',
        readOnly: true,
        preview: false,
      }),
    ).toBe(false);
  });

  it('renders floor routes, physical adjacency and navigable passages separately', () => {
    const html = renderToStaticMarkup(
      <PlanUnderstandingPanel
        plan={plan}
        locale="fr"
        updating={false}
        onFocusRoom={() => undefined}
        onFocusFloor={() => undefined}
      />,
    );

    expect(html).toContain('Parcours entre les niveaux');
    expect(html).toContain('Rez-de-chaussée');
    expect(html).toContain('1er étage');
    expect(html).toContain('Couloir partage un mur avec Cuisine');
    expect(html).toContain('Une porte permet de passer de Couloir à Cuisine');
    expect(html).toContain('L’entrée principale donne dans Couloir');
    expect(html).toContain('Un escalier monte de Couloir vers Salon');
    expect(html).toContain('Couloir communique directement avec Cuisine, sans porte');
    expect(html).toContain('environ 12 m² dessinés');
  });

  it('moves persistent element labels into a legend below the map', () => {
    const html = renderToStaticMarkup(<PlanLegend plan={plan} floor={plan.levels[0]!} />);
    expect(html).toContain('Légende');
    expect(html).toContain('Porte');
    expect(html).toContain('Passage ouvert');
    expect(html).toContain('Entrée principale');
    expect(html).toContain('Escalier');
  });

  it('puts the complete stair route choice in a modal', () => {
    const html = renderToStaticMarkup(
      <StairModal
        levels={plan.levels}
        initialFloorId="ground"
        initialRoomId="hall"
        onClose={() => undefined}
        onAdd={() => undefined}
      />,
    );

    expect(html).toContain('Relier deux niveaux');
    expect(html).toContain('Pièce de départ');
    expect(html).toContain('Pièce d’arrivée');
    expect(html).toContain('Rez-de-chaussée');
    expect(html).toContain('1er étage');
    expect(html).toContain('Ajouter l’escalier');
    expect(html).toContain('déplacées librement autour des pièces');
  });
});
