import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  deviceSupportsCategory,
  visibleRoomCategories,
  type HomePlan,
  type SensorDevice,
} from '@michel/contracts';
import {
  RoomEquipmentPage,
  deviceBedOccupiedWhen,
  deviceContactType,
  illuminanceLevel,
  lastReadingLabel,
  mainEntranceDevices,
  otherConnectedDevices,
  roomCategoryDevices,
  roomSensorReading,
} from './RoomEquipmentPage';
import {
  SENSOR_PRODUCTS,
  TEST_HARDWARE_COUNT,
  productMatchesDetectedModel,
  productsForCategory,
  sensorDevicePhoto,
} from './sensor-products';
import { connectedDevicesForCategory } from './sensor-ui';

const plan = {
  levels: [{ rooms: [{ id: 'room', name: 'Salon', kind: 'LIVING_ROOM' }], openings: [] }],
  placements: [],
} as unknown as HomePlan;
const device = (
  capabilities: SensorDevice['capabilities'],
  extra: Partial<SensorDevice> = {},
): SensorDevice => ({
  id: 'device',
  physicalDeviceId: 'device',
  name: 'Capteur',
  manufacturer: 'SONOFF',
  model: 'SNZB-02P',
  protocol: 'zigbee',
  integration: 'zigbee2mqtt',
  room: { id: 'room', name: 'Salon', kind: 'LIVING_ROOM' },
  installationStatus: 'OPERATIONAL',
  enabled: true,
  placementConfirmedAt: new Date().toISOString(),
  placementNote: null,
  lastSeenAt: new Date().toISOString(),
  batteryPercent: 90,
  action: 'NONE',
  capabilities,
  ...extra,
});
const capability = (name: string, value: Record<string, unknown> | null = { value: 21.5 }) => ({
  sensorId: name,
  entityId: `sensor.${name}`,
  capability: name,
  label: name,
  primary: true,
  status: 'ONLINE' as const,
  value,
  unit: name === 'temperature' ? '°C' : name === 'illuminance' ? 'lx' : '%',
  lastSeenAt: new Date().toISOString(),
  classification: { source: 'METADATA' as const, confidence: 1, reason: null, confirmedAt: null },
});

describe('room equipment cards', () => {
  it('uses one multifunction device in both temperature and humidity cards', () => {
    const multi = device([capability('temperature'), capability('humidity')]);
    expect(roomCategoryDevices(plan, 'room', [multi], 'temperature')).toEqual([multi]);
    expect(roomCategoryDevices(plan, 'room', [multi], 'humidity')).toEqual([multi]);
    expect(roomCategoryDevices(plan, 'room', [multi], 'shower')).toEqual([multi]);
    expect(roomCategoryDevices(plan, 'room', [multi], 'water_leak')).toEqual([]);
  });

  it('uses the humidity reading for the shower function', () => {
    const humiditySensor = device([capability('humidity', { value: 68 })]);

    expect(roomSensorReading(humiditySensor, 'shower', true)).toMatchObject({
      reading: '68 %',
    });
    expect(productsForCategory('shower', false).map(({ model }) => model)).toEqual(
      productsForCategory('humidity', false).map(({ model }) => model),
    );
  });

  it('offers shower instead of generic humidity by default in a bathroom', () => {
    const categories = visibleRoomCategories('BATHROOM');

    expect(categories).toContain('shower');
    expect(categories).not.toContain('humidity');
    expect(categories).toContain('water_leak');
    expect(
      visibleRoomCategories('BEDROOM', { added: ['shower'], hidden: [] }, ['shower']),
    ).not.toContain('shower');
  });

  it('does not also show a stair device in its technical anchor room', () => {
    const stairDevice = device([capability('motion', { active: true })], {
      model: 'SNZB-03P',
    });
    const stairPlan = {
      ...plan,
      placements: [
        {
          kind: 'SENSOR',
          equipmentId: stairDevice.id,
          equipmentRefKind: 'DEVICE',
          roomId: 'room',
          targetType: 'STAIR',
          targetId: 'stairs-1',
        },
      ],
    } as unknown as HomePlan;

    expect(roomCategoryDevices(stairPlan, 'room', [stairDevice], 'motion')).toEqual([]);
  });

  it('keeps a logical main-entrance sensor on its dedicated card without a drawn door', () => {
    const contact = device([capability('contact', { open: false })], {
      model: '3RDS17BZ',
    });
    const entrancePlan = {
      ...plan,
      placements: [
        {
          kind: 'SENSOR',
          equipmentId: contact.id,
          equipmentRefKind: 'DEVICE',
          roomId: 'room',
          targetType: 'ROOM',
          targetId: 'room',
          capabilityBindings: [
            { sensorId: 'contact', capability: 'contact', role: 'MAIN_ENTRANCE' },
          ],
        },
      ],
    } as HomePlan;

    expect(mainEntranceDevices(entrancePlan, 'room', [contact])).toEqual([contact]);
    expect(roomCategoryDevices(entrancePlan, 'room', [contact], 'contact')).toEqual([]);
  });

  it('uses one R3 installation for presence, illuminance and air quality', () => {
    const r3 = device(
      [
        capability('person_presence', { active: true }),
        capability('illuminance', { value: 420 }),
        capability('voc', { value: 28 }),
      ],
      { manufacturer: 'Third Reality', model: 'Multi-function smart presence sensor R3' },
    );
    expect(roomCategoryDevices(plan, 'room', [r3], 'presence')).toEqual([r3]);
    expect(roomCategoryDevices(plan, 'room', [r3], 'illuminance')).toEqual([r3]);
    expect(roomCategoryDevices(plan, 'room', [r3], 'air_quality')).toEqual([r3]);
    expect(
      visibleRoomCategories(
        'LIVING_ROOM',
        { added: [], hidden: ['presence', 'illuminance', 'air_quality'] },
        ['presence', 'illuminance', 'air_quality'],
      ),
    ).toEqual(expect.arrayContaining(['presence', 'illuminance', 'air_quality']));
  });

  it('describes illuminance and keeps the exact lux value as secondary text', () => {
    expect(illuminanceLevel(20, true)).toBe('Très faible');
    expect(illuminanceLevel(100, true)).toBe('Faible');
    expect(illuminanceLevel(220, true)).toBe('Confortable');
    expect(illuminanceLevel(420, true)).toBe('Lumineux');
    expect(illuminanceLevel(1_200, true)).toBe('Très lumineux');
    expect(
      roomSensorReading(device([capability('illuminance', { value: 420 })]), 'illuminance', true),
    ).toMatchObject({ reading: 'Lumineux', detail: '420 lx' });
  });

  it('counts a compatible connected sensor even when it is already in the selected room', () => {
    const assigned = device([capability('temperature')]);
    const elsewhere = device([capability('temperature')], {
      id: 'elsewhere',
      room: { id: 'other', name: 'Chambre', kind: 'BEDROOM' },
    });
    const incompatible = device([capability('humidity')], { id: 'humidity' });
    expect(connectedDevicesForCategory([assigned, elsewhere, incompatible], 'temperature')).toEqual(
      [assigned, elsewhere],
    );
    expect(
      otherConnectedDevices([assigned, elsewhere, incompatible], 'temperature', 'room', [assigned]),
    ).toEqual([elsewhere]);
  });

  it('shows the measurement time and includes the date for an older reading', () => {
    const today = new Date(2026, 8, 12, 21, 10).toISOString();
    const yesterday = new Date(2026, 8, 11, 21, 10).toISOString();
    const now = new Date(2026, 8, 12, 21, 15).getTime();
    expect(lastReadingLabel(today, true, now)).toBe('Dernière mesure reçue à 21:10');
    expect(lastReadingLabel(yesterday, true, now)).toBe(
      'Dernière mesure reçue le 11/09/2026 à 21:10',
    );
  });

  it('detects a product model mismatch without confusing punctuation or case', () => {
    const product = SENSOR_PRODUCTS.find(({ model }) => model === 'SDC-4-1-00')!;
    expect(productMatchesDetectedModel(product, 'sdc_4_1_00')).toBe(true);
    expect(productMatchesDetectedModel(product, 'SDO-4-1-00')).toBe(false);
    expect(productMatchesDetectedModel(product, null)).toBeNull();
  });

  it('recognizes the commercial R3 model name returned by Home Assistant', () => {
    const product = SENSOR_PRODUCTS.find(({ model }) => model === '3RPL01084Z')!;
    const detectedModel = 'Multi-function smart presence sensor R3';
    const detected = { model: detectedModel, capabilities: [{ capability: 'occupancy' }] };

    expect(productMatchesDetectedModel(product, detectedModel)).toBe(true);
    expect(deviceSupportsCategory(detected, 'presence')).toBe(true);
  });

  it('does not confuse a documented PIR occupancy sensor with still presence', () => {
    const pir = device([capability('occupancy', { active: true })], { model: 'SNZB-03P' });
    expect(roomCategoryDevices(plan, 'room', [pir], 'motion')).toEqual([pir]);
    expect(roomCategoryDevices(plan, 'room', [pir], 'presence')).toEqual([]);
  });

  it('recognizes the generic Third Reality motion model name returned by Home Assistant', () => {
    const product = SENSOR_PRODUCTS.find(({ model }) => model === '3RMS16BZ')!;
    const detectedModel = 'Wireless motion sensor';
    const detected = { model: detectedModel, capabilities: [{ capability: 'occupancy' }] };

    expect(productMatchesDetectedModel(product, detectedModel)).toBe(true);
    expect(deviceSupportsCategory(detected, 'motion')).toBe(true);
    expect(deviceSupportsCategory(detected, 'presence')).toBe(false);
  });

  it('recognizes the generic Third Reality door model name returned by Home Assistant', () => {
    const product = SENSOR_PRODUCTS.find(({ model }) => model === '3RDS17BZ')!;

    expect(productMatchesDetectedModel(product, 'Door sensor')).toBe(true);
  });

  it('recognizes the generic Third Reality climate model name returned by Home Assistant', () => {
    const product = SENSOR_PRODUCTS.find(({ model }) => model === '3RTHS0224Z')!;

    expect(productMatchesDetectedModel(product, 'Temperature and humidity sensor lite')).toBe(true);
  });

  it('uses each known device photo, including the Sonoff generic model name', () => {
    expect(
      sensorDevicePhoto(
        device([capability('temperature'), capability('humidity')], {
          model: 'Temperature and humidity sensor',
        }),
      ),
    ).toBe('/sensor-products/SNZB-02P.png');
    expect(
      sensorDevicePhoto(
        device([capability('contact')], {
          manufacturer: 'Third Reality',
          model: 'Door sensor',
        }),
      ),
    ).toBe('/sensor-products/3RDS17BZ.png');
    expect(
      sensorDevicePhoto(
        device([capability('motion')], {
          manufacturer: 'Third Reality',
          model: 'Wireless motion sensor',
        }),
      ),
    ).toBe('/sensor-products/3RMS16BZ.png');
    expect(
      sensorDevicePhoto(
        device([capability('occupancy')], {
          manufacturer: 'Third Reality',
          model: 'Multi-function smart presence sensor R3',
        }),
      ),
    ).toBe('/sensor-products/3RPL01084Z.png');
  });

  it('keeps an old value visible but clearly marks it as old', () => {
    const old = device([{ ...capability('temperature'), lastSeenAt: '2026-01-01T00:00:00.000Z' }], {
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    expect(
      roomSensorReading(old, 'temperature', true, Date.parse('2026-01-01T02:01:00.000Z')),
    ).toMatchObject({ reading: '21,5 °C', status: 'Mesure ancienne', outdated: true });
  });

  it('shows an unchanged temperature normally while humidity keeps the Sonoff connected', () => {
    const now = Date.parse('2026-09-13T18:10:00.000Z');
    const temperature = {
      ...capability('temperature', { value: 25.2 }),
      lastSeenAt: '2026-09-13T16:02:29.686Z',
    };
    const humidity = {
      ...capability('humidity', { value: 44 }),
      lastSeenAt: '2026-09-13T17:45:51.090Z',
    };
    const sonoff = device([temperature, humidity], {
      lastSeenAt: '2026-09-13T18:05:41.309Z',
    });

    expect(roomSensorReading(sonoff, 'temperature', true, now)).toMatchObject({
      reading: '25,2 °C',
      status: null,
      outdated: false,
      lastSeenAt: temperature.lastSeenAt,
    });
    expect(
      roomSensorReading(
        device([{ ...temperature, status: 'OFFLINE' }], { lastSeenAt: sonoff.lastSeenAt }),
        'temperature',
        true,
        now,
      ),
    ).toMatchObject({ status: 'Hors ligne', outdated: true });
  });

  it('keeps a steady presence current when the device has reported recently', () => {
    const now = Date.parse('2026-09-12T19:35:00.000Z');
    const r3 = device(
      [{ ...capability('occupancy', { active: true }), lastSeenAt: '2026-09-12T18:15:32.000Z' }],
      {
        model: 'Multi-function smart presence sensor R3',
        installationStatus: 'NEEDS_TEST',
        lastSeenAt: '2026-09-12T19:18:56.000Z',
      },
    );
    expect(roomSensorReading(r3, 'presence', true, now)).toMatchObject({
      reading: 'Détecté',
      status: null,
      outdated: false,
    });
    const expectedTime = new Date('2026-09-12T18:15:32.000Z').toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(lastReadingLabel('2026-09-12T18:15:32.000Z', true, now, 'presence')).toBe(
      `Dernier changement reçu à ${expectedTime}`,
    );
  });

  it('uses exactly the physical test inventory in the documented catalogue', () => {
    expect(SENSOR_PRODUCTS.map(({ model }) => model)).toEqual([
      '3RPL01084Z',
      '3RDS17BZ',
      '3RMS16BZ',
      '3RTHS0224Z',
      '3RWS18BZ',
      'SNZB-02P',
      '3RSPE01044BZ',
      '3RSB22BZ',
      'SDO-4-1-00',
      'STPH-4-1-00',
      'SDC-4-1-00',
      'SEM-4-1-00',
    ]);
    expect(TEST_HARDWARE_COUNT).toBe(19);
    expect(SENSOR_PRODUCTS.every(({ image }) => image.startsWith('/sensor-products/'))).toBe(true);
    expect(
      SENSOR_PRODUCTS.every(
        ({ nameEn, powerEn, featuresEn, preparationEn, placementEn }) =>
          !!nameEn &&
          !!powerEn &&
          !!featuresEn.length &&
          !!preparationEn.length &&
          !!placementEn.length,
      ),
    ).toBe(true);
    expect(SENSOR_PRODUCTS.find(({ model }) => model === '3RTHS0224Z')?.manualUrl).toBe(
      'https://tr-common-us-prod.s3.us-west-1.amazonaws.com/product/manual/TemperatureandHumiditySensorGen2.pdf',
    );
    expect(SENSOR_PRODUCTS.find(({ model }) => model === 'SNZB-02P')).toMatchObject({
      brand: 'SONOFF',
      image: '/sensor-products/SNZB-02P.png',
      categories: ['temperature', 'humidity'],
      compatibility: 'DOCUMENTED',
    });
    expect(productsForCategory('contact', false).map(({ model }) => model)).toEqual([
      '3RDS17BZ',
      'SDO-4-1-00',
      'SDC-4-1-00',
    ]);
  });

  it('recognizes a NodOn dry contact as an opening', () => {
    const dryContact = device([capability('dry_contact', { open: true })], { model: 'SDC-4-1-00' });
    expect(roomCategoryDevices(plan, 'room', [dryContact], 'contact')).toEqual([dryContact]);
    expect(roomSensorReading(dryContact, 'contact', true).reading).toBe('Ouvert');
  });

  it('reserves the bed card for a bedroom and its configured NodOn contact', () => {
    expect(visibleRoomCategories('BEDROOM')).toContain('bed');
    expect(visibleRoomCategories('LIVING_ROOM')).not.toContain('bed');
    expect(productsForCategory('bed', false).map(({ model }) => model)).toEqual(['SDC-4-1-00']);
    const nodon = device([capability('contact', { open: true })], {
      manufacturer: 'NodOn',
      model: 'SDC-4-1-00',
      room: { id: 'room', name: 'Chambre', kind: 'BEDROOM' },
    });
    const bedPlan = {
      ...plan,
      placements: [
        {
          kind: 'SENSOR',
          equipmentId: nodon.id,
          equipmentRefKind: 'DEVICE',
          roomId: 'room',
          capabilityBindings: [
            { sensorId: 'contact', capability: 'contact', role: 'BED', bedOccupiedWhen: 'OPEN' },
          ],
        },
      ],
    } as HomePlan;
    expect(deviceSupportsCategory(nodon, 'bed')).toBe(true);
    expect(roomCategoryDevices(bedPlan, 'room', [nodon], 'bed')).toEqual([nodon]);
    expect(roomCategoryDevices(bedPlan, 'room', [nodon], 'contact')).toEqual([]);
    expect(deviceBedOccupiedWhen(bedPlan, nodon)).toBe('OPEN');
    expect(roomSensorReading(nodon, 'bed', true, Date.now(), 'OPEN').reading).toBe('Occupé');
    expect(roomSensorReading(nodon, 'bed', true).reading).toBe('Libre');
    const markup = renderToStaticMarkup(
      createElement(RoomEquipmentPage, {
        roomId: 'room',
        plan: {
          ...bedPlan,
          levels: [
            {
              name: 'Étage',
              floor: 1,
              rooms: [{ id: 'room', name: 'Chambre', kind: 'BEDROOM' }],
              openings: [],
            },
          ],
        } as unknown as HomePlan,
        devices: [nodon],
        locale: 'fr',
        onBack: () => undefined,
        onRefresh: () => Promise.resolve(),
        onPlanSaved: () => undefined,
      }),
    );
    expect(markup).toContain('category-bed');
    expect(markup).toContain('<h3>Lit</h3>');
    expect(markup).toContain('Occupé');
  });

  it('shows the custom sensor name on its configured card', () => {
    const markup = renderToStaticMarkup(
      createElement(RoomEquipmentPage, {
        roomId: 'room',
        plan: {
          ...plan,
          levels: [
            {
              name: 'Rez-de-chaussée',
              floor: 0,
              rooms: [{ id: 'room', name: 'Cuisine', kind: 'KITCHEN' }],
              openings: [],
            },
          ],
        } as unknown as HomePlan,
        devices: [
          device([capability('contact', { open: false })], {
            name: 'Frigo',
            manufacturer: 'Third Reality',
            model: '3RDS17BZ',
          }),
        ],
        locale: 'fr',
        onBack: () => {},
        onRefresh: async () => {},
        onPlanSaved: () => {},
      }),
    );

    expect(markup).toContain('<p>Frigo</p>');
    expect(markup).not.toContain('<p>Les portes et les fenêtres</p>');
  });

  it('only marks a contact sensor on the main entrance as configured', () => {
    const entrancePlan = {
      levels: [
        {
          rooms: [{ id: 'entry', kind: 'ENTRANCE' }],
          openings: [
            { id: 'front-door', roomIds: ['entry'], isMainEntrance: true },
            { id: 'side-door', roomIds: ['entry'], isMainEntrance: false },
          ],
        },
      ],
      placements: [
        {
          kind: 'SENSOR',
          roomId: 'entry',
          targetType: 'OPENING',
          targetId: 'side-door',
          equipmentRefKind: 'DEVICE',
          equipmentId: 'side',
        },
        {
          kind: 'SENSOR',
          roomId: 'entry',
          targetType: 'OPENING',
          targetId: 'front-door',
          equipmentRefKind: 'DEVICE',
          equipmentId: 'front',
        },
      ],
    } as unknown as HomePlan;
    const front = device([capability('contact', { open: false })], { id: 'front' });
    const side = device([capability('contact', { open: true })], { id: 'side' });

    expect(mainEntranceDevices(entrancePlan, 'entry', [side, front])).toEqual([front]);
    expect(mainEntranceDevices(entrancePlan, 'elsewhere', [side, front])).toEqual([]);
  });

  it('shows the extra main entrance card only for an entrance room', () => {
    const renderRoom = (kind: string) =>
      renderToStaticMarkup(
        createElement(RoomEquipmentPage, {
          roomId: 'room',
          plan: {
            ...plan,
            levels: [
              {
                name: 'Rez-de-chaussée',
                rooms: [{ id: 'room', name: 'Pièce', kind }],
                openings: [],
              },
            ],
          } as unknown as HomePlan,
          devices: [],
          locale: 'fr',
          onBack: () => {},
          onEditPlan: () => {},
          onRefresh: async () => {},
          onPlanSaved: () => {},
        }),
      );

    expect(renderRoom('ENTRANCE')).toContain('Ouverture principale');
    expect(renderRoom('ENTRANCE')).toContain('Ouverture');
    expect(renderRoom('LIVING_ROOM')).not.toContain('Ouverture principale');
  });
});

describe('camera and opening types', () => {
  it('recognizes cameras independently of motion sensors, with no invented products', () => {
    const camera = device([capability('camera', null)]);
    expect(deviceSupportsCategory(camera, 'camera')).toBe(true);
    expect(deviceSupportsCategory(device([capability('motion')]), 'camera')).toBe(false);
    expect(roomCategoryDevices(plan, 'room', [camera], 'camera')).toEqual([camera]);
    expect(visibleRoomCategories('LIVING_ROOM', { added: ['camera'], hidden: [] })).toContain(
      'camera',
    );
    expect(productsForCategory('camera', false)).toEqual([]);
  });

  it('shows distinct opening cards using persisted contact roles', () => {
    const fridge = device([capability('contact', { open: false })], { id: 'fridge' });
    const window = device([capability('contact', { open: true })], { id: 'window' });
    const typedPlan = {
      ...plan,
      placements: [fridge, window].map((item, index) => ({
        kind: 'SENSOR',
        equipmentId: item.id,
        equipmentRefKind: 'DEVICE',
        roomId: 'room',
        capabilityBindings: [
          { sensorId: 'contact', capability: 'contact', role: index ? 'WINDOW' : 'FRIDGE' },
        ],
      })),
    } as HomePlan;
    expect(deviceContactType(typedPlan, fridge)).toBe('FRIDGE');
    const markup = renderToStaticMarkup(
      createElement(RoomEquipmentPage, {
        roomId: 'room',
        plan: typedPlan,
        devices: [fridge, window],
        locale: 'fr',
        onBack: () => undefined,
        onRefresh: () => Promise.resolve(),
        onPlanSaved: () => undefined,
      }),
    );
    expect(markup).toContain('Ouverture · Frigo');
    expect(markup).toContain('Ouverture · Fenêtre');
  });
});
