import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ZIGBEE_BAUDRATES,
  ZIGBEE_TECHNOLOGY_DEFAULTS,
  zigbeeInstallRequestSchema,
  zigbeeNetworkTestSchema,
  zigbeeStatusSchema,
} from '../dist/index.js';

const models = JSON.parse(
  readFileSync(new URL('../../../appliance/elise-zigbee-adapters.json', import.meta.url), 'utf8'),
);
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/zigbee-status.json', import.meta.url), 'utf8'),
);

test('the model database is valid for the apps and for JavaScript regular expressions', () => {
  const ids = new Set();
  for (const model of models.models) {
    assert.ok(!ids.has(model.id), `duplicate id ${model.id}`);
    ids.add(model.id);
    assert.ok(model.technology in ZIGBEE_TECHNOLOGY_DEFAULTS, model.id);
    assert.ok(ZIGBEE_BAUDRATES.includes(model.baudrate), model.id);
    assert.equal(typeof model.rtscts, 'boolean');
    const patterns = [...(model.match.byId ?? []), ...(model.match.hostname ?? [])];
    for (const rule of model.match.usb ?? []) {
      assert.match(rule.vid, /^[0-9a-f]{4}$/);
      assert.match(rule.pid, /^[0-9a-f]{4}$/);
      if (rule.product) patterns.push(rule.product);
      for (const other of rule.ambiguousWith ?? [])
        assert.ok(
          models.models.some((item) => item.id === other),
          `${model.id} -> ${other}`,
        );
    }
    for (const pattern of patterns) new RegExp(pattern, 'i');
  }
  for (const technology of Object.keys(models.technologies))
    assert.ok(technology in ZIGBEE_TECHNOLOGY_DEFAULTS);
});

test('the data the agent produces fits the status contract', () => {
  const status = zigbeeStatusSchema.parse(fixture);
  assert.equal(status.state, 'READY');
  assert.equal(status.current?.model?.name, 'Sonoff ZBDongle-E');
  assert.equal(status.candidates.length, 2);
});

test('an installation request needs a target and an explicit confirmation for a new network', () => {
  const base = { adapter: 'ember', baudrate: 115200, rtscts: false };
  assert.ok(zigbeeInstallRequestSchema.safeParse({ ...base, candidateId: 'a1b2c3d4e5f6' }).success);
  assert.ok(
    zigbeeInstallRequestSchema.safeParse({ ...base, port: 'tcp://slzb-06m.local:6638' }).success,
  );
  assert.equal(
    zigbeeInstallRequestSchema.parse({ ...base, candidateId: 'a1b2c3d4e5f6' }).networkMode,
    'keep',
  );
  for (const bad of [
    base,
    { ...base, port: '/etc/passwd' },
    { ...base, port: '/dev/ttyUSB0; reboot' },
    { ...base, port: '/dev/ttyUSB0', adapter: 'ezsp' },
    { ...base, port: '/dev/ttyUSB0', baudrate: 12345 },
    { ...base, port: '/dev/ttyUSB0', networkMode: 'new' },
    { ...base, candidateId: 'not-an-id' },
  ])
    assert.equal(zigbeeInstallRequestSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.ok(
    zigbeeInstallRequestSchema.safeParse({
      ...base,
      port: '/dev/serial/by-id/usb-A-if00',
      networkMode: 'new',
      confirmNewNetwork: true,
    }).success,
  );
});

test('a network address is checked before it reaches the agent', () => {
  assert.equal(zigbeeNetworkTestSchema.parse({ host: '192.168.1.50' }).port, 6638);
  assert.equal(zigbeeNetworkTestSchema.safeParse({ host: 'a b' }).success, false);
  assert.equal(zigbeeNetworkTestSchema.safeParse({ host: 'x', port: 70000 }).success, false);
});

test('the view helpers decide what the screens show', async () => {
  const {
    zigbeeErrorKey,
    zigbeeHeadline,
    zigbeeInstallRequest,
    zigbeeIsInstallable,
    zigbeeKnownNotes,
    zigbeeNeedsChoice,
    zigbeeRecentResult,
    zigbeeServiceState,
    zigbeeVisibleIssues,
  } = await import('../dist/index.js');
  const status = zigbeeStatusSchema.parse(fixture);
  const current = status.candidates.find((item) => item.isCurrent);
  const other = status.candidates.find((item) => !item.isCurrent);
  assert.equal(zigbeeErrorKey('NO_ANSWER'), 'NO_ANSWER');
  assert.equal(zigbeeErrorKey('FIRMWARE_OLD'), 'FIRMWARE_OLD');
  assert.equal(zigbeeErrorKey('SOMETHING_NEW'), 'unknown');
  assert.equal(zigbeeErrorKey(null), 'unknown');
  assert.deepEqual(zigbeeKnownNotes(['usb3-extension', 'made-up']), ['usb3-extension']);
  assert.deepEqual(zigbeeVisibleIssues(['multiple-keys', 'firmware-old']), ['firmware-old']);
  assert.equal(zigbeeNeedsChoice(other), true);
  assert.equal(zigbeeIsInstallable(other), false);
  assert.equal(zigbeeIsInstallable(current), true);
  assert.deepEqual(zigbeeInstallRequest(current, current.identity.options[0], 'keep'), {
    candidateId: current.id,
    adapter: 'ember',
    baudrate: 115200,
    rtscts: false,
    networkMode: 'keep',
    modelId: 'sonoff-zbdongle-e',
  });
  assert.equal(
    zigbeeInstallRequest(current, current.identity.options[0], 'new').confirmNewNetwork,
    true,
  );
  assert.equal(zigbeeHeadline(status).title, 'ready');
  assert.equal(zigbeeHeadline({ ...status, state: 'NEW_KEY' }).tone, 'new');
  assert.equal(zigbeeHeadline({ ...status, state: 'NO_KEY' }).hint, 'noKeyHint');
  assert.equal(
    zigbeeHeadline({ ...status, state: 'ATTENTION', issues: ['z2m-offline'] }).hint,
    'attentionOffline',
  );
  assert.equal(zigbeeServiceState(status.current), 'running');
  assert.equal(
    zigbeeServiceState({ ...status.current, z2m: { container: 'stopped', bridge: 'offline' } }),
    'stopped',
  );
  const finished = {
    ...status.install,
    state: 'SUCCEEDED',
    finishedAt: '2026-06-12T10:00:00.000Z',
  };
  assert.ok(zigbeeRecentResult(finished, Date.parse('2026-06-12T10:10:00Z')));
  assert.equal(zigbeeRecentResult(finished, Date.parse('2026-06-12T11:00:00Z')), null);
  assert.equal(zigbeeRecentResult(status.install), null);
});

test('the search notice tells what failed without hiding the other channel', async () => {
  const { zigbeeSearchNotice, zigbeeCandidateOrigin } = await import('../dist/index.js');
  const status = zigbeeStatusSchema.parse(fixture);
  const [key] = status.candidates;
  const ok = { usb: 'ok', network: 'ok' };
  assert.equal(zigbeeSearchNotice(ok, [key]), null);
  assert.equal(zigbeeSearchNotice(ok, []), 'none');
  assert.equal(zigbeeSearchNotice({ usb: 'ok', network: 'unavailable' }, []), 'none');
  assert.equal(zigbeeSearchNotice({ usb: 'ok', network: 'failed' }, [key]), 'networkFailed');
  assert.equal(zigbeeSearchNotice({ usb: 'ok', network: 'failed' }, []), 'networkFailed');
  assert.equal(zigbeeSearchNotice({ usb: 'failed', network: 'ok' }, [key]), 'usbFailed');
  assert.equal(zigbeeSearchNotice({ usb: 'failed', network: 'failed' }, []), 'bothFailed');
  assert.equal(zigbeeSearchNotice(undefined, []), 'none');
  assert.equal(zigbeeCandidateOrigin(key), 'box');
  assert.equal(zigbeeCandidateOrigin({ ...key, kind: 'network' }), 'network');
});

test('the combined search falls back to the box alone when the network search breaks', async () => {
  const { zigbeeSearch } = await import('../dist/index.js');
  const status = zigbeeStatusSchema.parse(fixture);
  const calls = [];
  const together = await zigbeeSearch(async (network) => {
    calls.push(network);
    return { ...status, scan: { usb: 'ok', network: 'ok' } };
  });
  assert.deepEqual(calls, [true]);
  assert.deepEqual(together.scan, { usb: 'ok', network: 'ok' });

  const fallback = [];
  const partial = await zigbeeSearch(async (network) => {
    fallback.push(network);
    if (network) throw new Error('timeout');
    return status;
  });
  assert.deepEqual(fallback, [true, false]);
  assert.deepEqual(partial.scan, { usb: 'ok', network: 'failed' });
  assert.equal(partial.candidates.length, status.candidates.length);

  await assert.rejects(
    zigbeeSearch(async () => {
      throw new Error('agent down');
    }),
    /agent down/,
  );
});

test('a network address can be typed with or without port', async () => {
  const { parseZigbeeNetworkAddress } = await import('../dist/index.js');
  assert.deepEqual(parseZigbeeNetworkAddress('192.168.1.50'), { host: '192.168.1.50', port: 6638 });
  assert.deepEqual(parseZigbeeNetworkAddress(' 192.168.1.50:6639 '), {
    host: '192.168.1.50',
    port: 6639,
  });
  assert.deepEqual(parseZigbeeNetworkAddress('tcp://slzb-06.local:6638/'), {
    host: 'slzb-06.local',
    port: 6638,
  });
  assert.equal(parseZigbeeNetworkAddress(''), null);
  assert.equal(parseZigbeeNetworkAddress('192.168.1.50:99999'), null);
  assert.equal(parseZigbeeNetworkAddress('192.168.1.50:0'), null);
  assert.equal(parseZigbeeNetworkAddress('http://x y'), null);
  assert.equal(parseZigbeeNetworkAddress('/dev/ttyUSB0'), null);
});
