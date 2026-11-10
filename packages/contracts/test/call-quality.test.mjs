import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eliseCallConfig, eliseMobileCallConfig } from '../dist/index.js';

// These settings keep two-person calls within what a Raspberry Pi 4 can encode and relay.
for (const [name, config] of [
  ['shared', eliseCallConfig],
  ['mobile', eliseMobileCallConfig],
]) {
  test(`${name} call config stays light enough for a Raspberry Pi 4`, () => {
    assert.equal(config.p2p.enabled, true);
    assert.deepEqual(config.p2p.stunServers, [], 'no third-party STUN server');
    assert.equal(config.disableSimulcast, true);
    assert.equal(config.videoQuality.codecPreferenceOrder[0], 'VP8');
    assert.equal(config.p2p.codecPreferenceOrder[0], 'VP8');
    assert.ok(!config.videoQuality.codecPreferenceOrder.includes('AV1'));
    assert.ok(config.constraints.video.height.max <= 480);
    assert.ok(config.constraints.video.frameRate.max <= 24);
    assert.equal(config.videoQuality.enableAdaptiveMode, true);
  });
}

test('mobile call hides the Jitsi toolbar so the app controls do not overlap it', () => {
  assert.deepEqual(eliseMobileCallConfig.toolbarButtons, []);
});
