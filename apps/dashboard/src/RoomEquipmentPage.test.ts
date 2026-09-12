import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deviceSupportsCategory, type HomePlan, type SensorDevice } from '@michel/contracts';
import {
  RoomEquipmentPage,
  mainEntranceDevices,
  roomCategoryDevices,
  roomSensorReading,
} from './RoomEquipmentPage';
import {
  SENSOR_PRODUCTS,
  TEST_HARDWARE_COUNT,
  productMatchesDetectedModel,
  productsForCategory,
} from './sensor-products';

const plan = {
  levels: [{ rooms: [{ id: 'room', name: 'Salon', kind: 'LIVING_ROOM' }] }],
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
  unit: name === 'temperature' ? '°C' : '%',
  lastSeenAt: new Date().toISOString(),
  classification: { source: 'METADATA' as const, confidence: 1, reason: null, confirmedAt: null },
});

describe('room equipment cards', () => {
  it('uses one multifunction device in both temperature and humidity cards', () => {
    const multi = device([capability('temperature'), capability('humidity')]);
    expect(roomCategoryDevices(plan, 'room', [multi], 'temperature')).toEqual([multi]);
    expect(roomCategoryDevices(plan, 'room', [multi], 'humidity')).toEqual([multi]);
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

  it('keeps an old value visible but clearly marks it as old', () => {
    const old = device([{ ...capability('temperature'), lastSeenAt: '2026-01-01T00:00:00.000Z' }]);
    expect(
      roomSensorReading(old, 'temperature', true, Date.parse('2026-01-01T02:00:00.000Z')),
    ).toMatchObject({ reading: '21,5 °C', status: 'Mesure ancienne', outdated: true });
  });

  it('uses exactly the physical test inventory in the documented catalogue', () => {
    expect(SENSOR_PRODUCTS.map(({ model }) => model)).toEqual([
      '3RPL01084Z',
      '3RDS17BZ',
      '3RMS16BZ',
      '3RTHS0224Z',
      '3RWS18BZ',
      '3RSPE01044BZ',
      '3RSB22BZ',
      'SDO-4-1-00',
      'STPH-4-1-00',
      'SDC-4-1-00',
      'SEM-4-1-00',
    ]);
    expect(TEST_HARDWARE_COUNT).toBe(18);
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
