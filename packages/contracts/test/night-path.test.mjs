// Night path lighting contracts: request validation, the night window (across midnight) and
// the Home Assistant data sent to a light. They run against the built package (dist/).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_NIGHT_PATH,
  SENSOR_PRODUCTS,
  deviceSupportsCategory,
  formatNightPathTime,
  homeAssistantInventorySchema,
  localMinuteOfDay,
  minuteInNightWindow,
  nightPathInputSchema,
  nightPathRoomPhrase,
  nightPathTestSchema,
  nightPathTurnOffData,
  nightPathTurnOnData,
  nightPathUpdateSchema,
  parseNightPathTime,
  productsForCategory,
  visibleRoomCategories,
} from '../dist/index.js';

const path = {
  name: 'Chambre → toilettes',
  triggerRoomIds: ['room-bedroom'],
  lightRoomIds: ['room-bedroom', 'room-hallway', 'room-toilet'],
};

describe('nightPathInputSchema', () => {
  it('fills soft, warm and short defaults', () => {
    const parsed = nightPathInputSchema.parse(path);
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.startMinute, 22 * 60);
    assert.equal(parsed.endMinute, 7 * 60);
    assert.equal(parsed.brightnessPercent, DEFAULT_NIGHT_PATH.brightnessPercent);
    assert.ok(parsed.brightnessPercent >= 20 && parsed.brightnessPercent <= 30);
    assert.ok(parsed.colorTemperatureKelvin >= 2_200 && parsed.colorTemperatureKelvin <= 2_700);
    assert.equal(parsed.offDelayMinutes, 3);
    assert.equal(parsed.includeBedExit, true);
  });

  it('accepts several trigger rooms and lit rooms without a sensor of their own', () => {
    const parsed = nightPathInputSchema.parse({
      ...path,
      triggerRoomIds: ['room-bedroom', 'room-living'],
    });
    assert.deepEqual(parsed.triggerRoomIds, ['room-bedroom', 'room-living']);
    assert.equal(parsed.lightRoomIds.length, 3);
  });

  it('refuses an empty path, an unknown delay and identical start and end times', () => {
    assert.equal(nightPathInputSchema.safeParse({ ...path, triggerRoomIds: [] }).success, false);
    assert.equal(nightPathInputSchema.safeParse({ ...path, lightRoomIds: [] }).success, false);
    assert.equal(nightPathInputSchema.safeParse({ ...path, offDelayMinutes: 4 }).success, false);
    assert.equal(nightPathInputSchema.safeParse({ ...path, brightnessPercent: 0 }).success, false);
    assert.equal(
      nightPathInputSchema.safeParse({ ...path, colorTemperatureKelvin: 6_500 }).success,
      false,
    );
    assert.equal(
      nightPathInputSchema.safeParse({ ...path, startMinute: 600, endMinute: 600 }).success,
      false,
    );
  });

  it('accepts a partial update but not an empty one', () => {
    assert.equal(nightPathUpdateSchema.safeParse({ enabled: false }).success, true);
    assert.equal(nightPathUpdateSchema.safeParse({}).success, false);
  });

  it('validates the test request', () => {
    assert.equal(
      nightPathTestSchema.parse({ lightRoomIds: ['room-hallway'] }).brightnessPercent,
      25,
    );
    assert.equal(nightPathTestSchema.safeParse({ lightRoomIds: [] }).success, false);
  });
});

describe('night window', () => {
  it('handles a window across midnight', () => {
    const start = 22 * 60;
    const end = 7 * 60;
    assert.equal(minuteInNightWindow(23 * 60 + 30, start, end), true);
    assert.equal(minuteInNightWindow(0, start, end), true);
    assert.equal(minuteInNightWindow(3 * 60, start, end), true);
    assert.equal(minuteInNightWindow(7 * 60, start, end), false);
    assert.equal(minuteInNightWindow(12 * 60, start, end), false);
    assert.equal(minuteInNightWindow(21 * 60 + 59, start, end), false);
  });

  it('handles a window within the same day', () => {
    assert.equal(minuteInNightWindow(13 * 60, 12 * 60, 14 * 60), true);
    assert.equal(minuteInNightWindow(15 * 60, 12 * 60, 14 * 60), false);
    assert.equal(minuteInNightWindow(600, 600, 600), false);
  });

  it('reads the local time of the home', () => {
    // 23:30 UTC in winter is 00:30 in Paris.
    assert.equal(localMinuteOfDay(new Date('2026-12-01T23:30:00Z'), 'Europe/Paris'), 30);
    assert.equal(localMinuteOfDay(new Date('2026-12-01T23:30:00Z'), 'Not/AZone'), 23 * 60 + 30);
  });

  it('parses and formats times', () => {
    assert.equal(parseNightPathTime('22:00'), 1_320);
    assert.equal(parseNightPathTime('7:05'), 425);
    assert.equal(parseNightPathTime('24:00'), null);
    assert.equal(formatNightPathTime(425), '07:05');
  });
});

describe('light commands', () => {
  const settings = { brightnessPercent: 25, colorTemperatureKelvin: 2_200 };

  it('sends brightness, warm white and a fade to a colour strip', () => {
    assert.deepEqual(
      nightPathTurnOnData(settings, {
        brightness: true,
        colorTemperature: true,
        transition: true,
        minKelvin: 1_000,
        maxKelvin: 20_000,
      }),
      { brightness_pct: 25, color_temp_kelvin: 2_200, transition: 2 },
    );
  });

  it('clamps the colour temperature to what the light supports', () => {
    assert.equal(
      nightPathTurnOnData(settings, {
        brightness: true,
        colorTemperature: true,
        transition: false,
        minKelvin: 2_700,
        maxKelvin: 6_500,
      }).color_temp_kelvin,
      2_700,
    );
  });

  it('sends nothing but "on" to an on/off only light', () => {
    const onOff = { brightness: false, colorTemperature: false, transition: false };
    assert.deepEqual(nightPathTurnOnData(settings, onOff), {});
    assert.deepEqual(nightPathTurnOffData(onOff), {});
  });

  it('uses the usual values when the features are unknown', () => {
    assert.deepEqual(nightPathTurnOnData(settings, null), {
      brightness_pct: 25,
      color_temp_kelvin: 2_200,
      transition: 2,
    });
  });
});

describe('lighting as a room equipment', () => {
  it('recognises any light entity, whatever its model', () => {
    for (const model of ['FL 230 C', 'L2112', 'Some other bulb', null])
      assert.equal(
        deviceSupportsCategory({ model, capabilities: [{ capability: 'light' }] }, 'light'),
        true,
      );
    assert.equal(
      deviceSupportsCategory(
        { model: 'FL 230 C', capabilities: [{ capability: 'switch' }] },
        'light',
      ),
      false,
    );
  });

  it('documents the Innr strip as a light product', () => {
    const [strip] = productsForCategory('light', false);
    assert.equal(strip.model, 'FL 230 C');
    assert.equal(strip.kind, 'LIGHT');
    assert.equal(strip.compatibility, 'DOCUMENTED');
    assert.equal(strip.eliseValidated, false);
    assert.ok(SENSOR_PRODUCTS.some(({ id }) => id === strip.id));
  });

  it('offers lighting in the bedroom, the hallway and the toilet', () => {
    for (const kind of ['BEDROOM', 'HALLWAY', 'TOILET'])
      assert.ok(visibleRoomCategories(kind).includes('light'), kind);
  });

  it('accepts the light features in the inventory', () => {
    const inventory = homeAssistantInventorySchema.parse({
      schemaVersion: '1.0',
      homeId: 'home',
      generatedAt: '2026-11-27T12:00:00.000Z',
      devices: [],
      entities: [
        {
          entityId: 'light.ruban',
          name: 'Ruban',
          domain: 'light',
          available: true,
          capability: 'light',
          compatibility: 'RECOGNIZED',
          lightFeatures: { brightness: false, colorTemperature: false, transition: false },
        },
      ],
    });
    assert.equal(inventory.entities[0].lightFeatures.brightness, false);
  });
});

describe('nightPathUpdateSchema', () => {
  it('never fills defaults into a partial update', () => {
    assert.deepEqual(nightPathUpdateSchema.parse({ enabled: false }), { enabled: false });
  });
});

describe('nightPathRoomPhrase', () => {
  it('reads naturally in every language', () => {
    assert.equal(nightPathRoomPhrase('fr', 'BEDROOM', 'Chambre'), 'la chambre');
    assert.equal(nightPathRoomPhrase('fr', 'ENTRANCE', 'Entrée'), 'l’entrée');
    assert.equal(nightPathRoomPhrase('fr', 'TOILET', 'Toilettes'), 'les toilettes');
    assert.equal(nightPathRoomPhrase('fr', 'OTHER', 'Bureau'), 'bureau');
    assert.equal(nightPathRoomPhrase('en', 'BEDROOM', 'Bedroom'), 'the bedroom');
    assert.equal(nightPathRoomPhrase('es', 'KITCHEN', 'Cocina'), 'la cocina');
    assert.equal(nightPathRoomPhrase('it', 'BEDROOM', 'Camera'), 'camera');
    assert.equal(nightPathRoomPhrase('pt-PT', 'BEDROOM', 'Quarto'), 'no quarto');
    assert.equal(nightPathRoomPhrase('pt', 'OTHER', 'Escritório'), 'em escritório');
  });
});
