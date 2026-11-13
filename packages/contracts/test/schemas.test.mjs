// Request schemas shared by the API, the dashboard and the mobile app: first setup, alert
// rules and outgoing webhooks. They run against the built package (dist/), as the apps use it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ALERT_RULE_SETTINGS,
  alertRuleSettingsSchema,
  installationSchema,
  webhookEnvelopeSchema,
} from '../dist/index.js';

const installation = {
  username: '  paul  ',
  timezone: 'Europe/Paris',
  caregiver: { firstName: 'Paul', lastName: 'Martin', relation: 'Petit-fils' },
  resident: {
    firstName: 'Madeleine',
    lastName: 'Martin',
    dailyName: 'Madeleine',
    birthDate: '1942-04-03',
    language: 'Français',
    addressAs: 'daily',
    customAddress: '',
  },
  life: ['alone'],
  mobility: 'independent',
  senses: [],
  important: ['memory'],
  importantNote: '',
  habits: { Lever: { from: '07:30', to: '09:00', unknown: false } },
};

describe('installationSchema', () => {
  it('accepts a complete first setup and trims the typed names', () => {
    const parsed = installationSchema.parse(installation);
    assert.equal(parsed.username, 'paul');
  });

  it('accepts an unknown birth date', () => {
    const parsed = installationSchema.parse({
      ...installation,
      resident: { ...installation.resident, birthDate: '' },
    });
    assert.equal(parsed.resident.birthDate, '');
  });

  it('refuses malformed habits and unknown answers', () => {
    assert.equal(
      installationSchema.safeParse({
        ...installation,
        habits: { Lever: { from: '7h30', to: '09:00', unknown: false } },
      }).success,
      false,
    );
    assert.equal(
      installationSchema.safeParse({ ...installation, mobility: 'flying' }).success,
      false,
    );
    assert.equal(installationSchema.safeParse({ ...installation, username: 'pa' }).success, false);
  });
});

describe('alert rules', () => {
  it('ships defaults that the schema accepts', () => {
    assert.deepEqual(alertRuleSettingsSchema.parse(DEFAULT_ALERT_RULE_SETTINGS), {
      ...DEFAULT_ALERT_RULE_SETTINGS,
    });
  });

  it('turns behavioural alerts off when an older client omits them', () => {
    const { behavioral: _omitted, ...older } = DEFAULT_ALERT_RULE_SETTINGS;
    assert.deepEqual(alertRuleSettingsSchema.parse(older).behavioral, { enabled: false });
  });

  it('refuses thresholds outside the safe ranges', () => {
    const tooShort = {
      ...DEFAULT_ALERT_RULE_SETTINGS,
      inactivity: { enabled: true, minutes: 5 },
    };
    assert.equal(alertRuleSettingsSchema.safeParse(tooShort).success, false);
  });
});

describe('webhookEnvelopeSchema', () => {
  const envelope = {
    schemaVersion: '1.0',
    deliveryId: 'delivery-1',
    event: 'alert.opened',
    occurredAt: '2026-11-13T10:00:00.000Z',
    alert: {
      id: 'alert-1',
      type: 'SOS',
      severity: 'URGENT',
      status: 'OPEN',
      title: 'Appel à l’aide',
      explanation: 'Le bouton a été pressé.',
      openedAt: '2026-11-13T10:00:00.000Z',
    },
  };

  it('accepts the version 1.0 envelope', () => {
    assert.equal(webhookEnvelopeSchema.safeParse(envelope).success, true);
  });

  it('refuses another schema version or an unknown event', () => {
    assert.equal(
      webhookEnvelopeSchema.safeParse({ ...envelope, schemaVersion: '2.0' }).success,
      false,
    );
    assert.equal(
      webhookEnvelopeSchema.safeParse({ ...envelope, event: 'alert.deleted' }).success,
      false,
    );
  });
});
