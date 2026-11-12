import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIVITY_CAPABILITIES,
  isLifeActivityCapability,
  isReliableLifeActivity,
  LIFE_ACTIVITY_CAPABILITIES,
} from '../dist/index.js';

test('life activity counts motion, presence and contacts', () => {
  for (const capability of ['motion', 'occupancy', 'person_presence', 'contact', 'dry_contact']) {
    assert.equal(isLifeActivityCapability(capability), true, capability);
  }
});

test('plug measures, battery and link quality are not activity of the person', () => {
  for (const capability of [
    'power',
    'energy',
    'current',
    'voltage',
    'switch',
    'battery',
    'signal_strength',
    'temperature',
    'humidity',
    'illuminance',
  ]) {
    assert.equal(isLifeActivityCapability(capability), false, capability);
  }
});

test('reliable life activity requires a good quality', () => {
  assert.equal(isReliableLifeActivity({ capability: 'motion', quality: 'good' }), true);
  assert.equal(isReliableLifeActivity({ capability: 'motion', quality: 'degraded' }), false);
  assert.equal(isReliableLifeActivity({ capability: 'power', quality: 'good' }), false);
});

test('activity charts add the button to life signals', () => {
  assert.deepEqual(ACTIVITY_CAPABILITIES, [...LIFE_ACTIVITY_CAPABILITIES, 'button']);
});
