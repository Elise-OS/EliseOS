import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createZigbeeDemo, zigbeeProbeResultSchema, zigbeeStatusSchema } from '../dist/index.js';

function demo(scenario) {
  const clock = { time: Date.parse('2026-06-12T10:00:00Z') };
  const simulator = createZigbeeDemo({ scenario, now: () => clock.time });
  const call = (method, path, body) => {
    const answer = simulator.handle(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
    );
    assert.ok(answer, `${method} ${path} unanswered`);
    return answer;
  };
  const status = () => zigbeeStatusSchema.parse(call('GET', '/zigbee/adapter').body);
  return { call, status, advance: (seconds) => (clock.time += seconds * 1000) };
}

test('ignores paths that are not about the Zigbee key', () => {
  assert.equal(createZigbeeDemo().handle('GET', '/household'), null);
});

test('starts with a healthy ZBDongle-E and finds a second key at the first detection', () => {
  const { call, status } = demo('ready');
  const first = status();
  assert.equal(first.state, 'READY');
  assert.equal(first.current?.model?.name, 'Sonoff ZBDongle-E');
  assert.equal(first.current?.coordinator?.type, 'EZSP v13');
  assert.deepEqual(first.issues, []);
  const scanned = zigbeeStatusSchema.parse(call('POST', '/zigbee/adapter/scan', {}).body);
  assert.deepEqual(scanned.issues.sort(), ['multiple-keys', 'other-key-plugged']);
  const other = scanned.candidates.find((item) => !item.isCurrent);
  assert.equal(other?.identity.confidence, 'ambiguous');
  assert.deepEqual(
    other?.identity.options.map((option) => option.technology),
    ['zstack', 'ember'],
  );
});

test('the probe settles the ambiguous key and the installation walks through its steps', () => {
  const { call, status, advance } = demo('ready');
  call('POST', '/zigbee/adapter/scan', {});
  const other = status().candidates.find((item) => !item.isCurrent);
  const probe = zigbeeProbeResultSchema.parse(
    call('POST', '/zigbee/adapter/probe', { candidateId: other.id }).body,
  );
  assert.equal(probe.candidate.identity.modelId, 'sonoff-zbdongle-p');
  assert.equal(probe.candidate.identity.confidence, 'high');

  const started = call('POST', '/zigbee/adapter/install', {
    candidateId: other.id,
    adapter: 'zstack',
    baudrate: 115200,
    rtscts: false,
    networkMode: 'keep',
  });
  assert.equal(started.status, 202);
  assert.equal(status().state, 'INSTALLING');
  advance(4);
  const during = status();
  assert.equal(during.install.state, 'RUNNING');
  assert.ok(during.install.steps.some((step) => step.state === 'done'));
  assert.ok(during.install.steps.some((step) => step.state === 'running'));
  advance(10);
  const after = status();
  assert.equal(after.install.state, 'SUCCEEDED');
  assert.equal(after.state, 'READY');
  assert.equal(after.current?.model?.name, 'Sonoff ZBDongle-P');
  assert.equal(after.current?.coordinator?.type, 'zStack3x0');
  assert.ok(
    after.candidates.some(
      (item) => !item.isCurrent && item.identity.modelId === 'sonoff-zbdongle-e',
    ),
  );
});

test('a technology that does not match the key fails and the old key is put back', () => {
  const { call, status, advance } = demo('ready');
  call('POST', '/zigbee/adapter/scan', {});
  const other = status().candidates.find((item) => !item.isCurrent);
  call('POST', '/zigbee/adapter/install', {
    candidateId: other.id,
    adapter: 'deconz',
    baudrate: 38400,
    rtscts: false,
    networkMode: 'keep',
  });
  advance(12);
  const after = status();
  assert.equal(after.install.state, 'ROLLED_BACK');
  assert.equal(after.install.errorCode, 'NO_ANSWER');
  assert.equal(after.install.rolledBack, true);
  assert.equal(after.current?.model?.name, 'Sonoff ZBDongle-E');
  assert.equal(after.state, 'READY');
});

test('the other scenarios start without a key, with a new key, or with a missing key', () => {
  assert.equal(demo('none').status().state, 'NO_KEY');
  const none = demo('none');
  none.call('POST', '/zigbee/adapter/scan', {});
  const found = none.status();
  assert.equal(found.state, 'NEW_KEY');
  assert.equal(found.candidates[0].identity.confidence, 'high');
  const fresh = demo('new').status();
  assert.equal(fresh.state, 'NEW_KEY');
  assert.equal(fresh.candidates[0].identity.confidence, 'ambiguous');
  const missing = demo('missing').status();
  assert.equal(missing.state, 'KEY_MISSING');
  assert.equal(missing.current?.present, false);
});

test('refuses to install a key that is not plugged', () => {
  const { call } = demo('ready');
  assert.equal(
    call('POST', '/zigbee/adapter/install', {
      candidateId: 'ffffffffffff',
      adapter: 'ember',
      baudrate: 115200,
      rtscts: false,
    }).status,
    400,
  );
});
