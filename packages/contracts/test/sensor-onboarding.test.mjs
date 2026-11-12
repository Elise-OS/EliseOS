import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SENSOR_CATEGORY_GROUPS,
  SENSOR_PRODUCTS,
  deviceLooksUnsupported,
  formatSearchCountdown,
  isActiveOnboardingStatus,
  pairingIntentApplies,
  pairingNameSuggestions,
  pendingDeviceCount,
  pairingProblems,
  productMatchesDetectedModel,
  productsForCategory,
  searchTimedOut,
  secondsUntil,
  sensorErrorCode,
} from '../dist/index.js';

const device = (...capabilities) => ({
  model: null,
  capabilities: capabilities.map((capability) => ({ capability })),
});

test('only a search the hub still works on is active', () => {
  for (const status of ['PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND'])
    assert.equal(isActiveOnboardingStatus(status), true);
  for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'])
    assert.equal(isActiveOnboardingStatus(status), false);
});

test('the countdown reads m:ss and never goes below zero', () => {
  assert.equal(formatSearchCountdown(240), '4:00');
  assert.equal(formatSearchCountdown(65), '1:05');
  assert.equal(formatSearchCountdown(-3), '0:00');
  assert.equal(
    secondsUntil('2026-01-01T00:04:00.000Z', Date.parse('2026-01-01T00:00:00.000Z')),
    240,
  );
});

test('a late search ends only after the grace and when nothing was seen', () => {
  assert.equal(searchTimedOut(0, false), false);
  assert.equal(searchTimedOut(-8, false), true);
  assert.equal(searchTimedOut(-60, true), false);
});

test('a device that does not fit the chosen use is reported', () => {
  const temperature = device('temperature', 'humidity', 'battery');
  assert.deepEqual(pairingProblems(temperature, { category: 'contact' }), {
    mismatch: true,
    wrongTarget: false,
  });
  assert.equal(pairingProblems(temperature, { category: 'temperature' }).mismatch, false);
  assert.equal(pairingProblems(temperature, { targetType: 'OPENING' }).wrongTarget, true);
  assert.equal(pairingProblems(temperature, { targetType: 'STAIR' }).wrongTarget, true);
  assert.equal(pairingProblems(device('contact'), { targetType: 'OPENING' }).wrongTarget, false);
});

test('a device that only reports battery or signal is unsupported', () => {
  assert.equal(deviceLooksUnsupported(device('battery', 'signal_strength', 'unknown')), true);
  assert.equal(deviceLooksUnsupported(device()), true);
  assert.equal(deviceLooksUnsupported(device('battery', 'temperature')), false);
});

test('name suggestions are unique and ordered', () => {
  assert.deepEqual(
    pairingNameSuggestions({
      productName: 'Door sensor',
      categoryLabel: 'Door',
      roomName: 'Hall',
      deviceName: 'Door sensor',
    }),
    ['Door sensor', 'Door Hall'],
  );
});

test('API error codes are recognised', () => {
  assert.equal(sensorErrorCode('ADMIN_REQUIRED'), 'ADMIN_REQUIRED');
  assert.equal(sensorErrorCode('whatever'), null);
  assert.equal(sensorErrorCode(undefined), null);
});

test('the catalogue and the usage groups cover every category once', () => {
  const grouped = SENSOR_CATEGORY_GROUPS.flatMap(({ categories }) => categories);
  assert.equal(new Set(grouped).size, grouped.length);
  assert.ok(SENSOR_PRODUCTS.length > 5);
  assert.ok(productsForCategory('contact', false).length > 0);
  const door = SENSOR_PRODUCTS.find(({ model }) => model === '3RDS17BZ');
  assert.equal(productMatchesDetectedModel(door, 'Door sensor'), true);
  assert.equal(productMatchesDetectedModel(door, null), null);
});

test('counts the other devices of the search, zero for boxes without the queue', () => {
  assert.equal(pendingDeviceCount(null), 0);
  assert.equal(pendingDeviceCount({}), 0);
  assert.equal(pendingDeviceCount({ pendingDevices: [device('contact'), device('motion')] }), 2);
});

test('the chosen kind goes to the device of the search that provides it', () => {
  const contact = device('contact');
  const motion = device('motion');
  const alone = { category: 'motion', severalDevices: false, intentUsed: false };
  // A single device keeps the choice, so its mismatch is still reported.
  assert.equal(pairingIntentApplies(contact, alone), true);
  const several = { ...alone, severalDevices: true };
  assert.equal(pairingIntentApplies(contact, several), false);
  assert.equal(pairingIntentApplies(motion, several), true);
  // Once given to one device, the choice is not reused for the next ones.
  assert.equal(pairingIntentApplies(motion, { ...several, intentUsed: true }), false);
  // A stair target needs movement or presence.
  assert.equal(
    pairingIntentApplies(contact, { targetType: 'STAIR', severalDevices: true, intentUsed: false }),
    false,
  );
  // Another model than the chosen product, joined at the same time.
  const product = SENSOR_PRODUCTS.find(({ model }) => model === '3RMS16BZ');
  assert.ok(product);
  assert.equal(
    pairingIntentApplies(
      { model: 'SNZB-02P', capabilities: [{ capability: 'motion' }] },
      { product, severalDevices: true, intentUsed: false },
    ),
    false,
  );
  assert.equal(
    pairingIntentApplies(
      { model: '3RMS16BZ', capabilities: [{ capability: 'motion' }] },
      { product, severalDevices: true, intentUsed: false },
    ),
    true,
  );
});
