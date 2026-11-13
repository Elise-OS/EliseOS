import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  callNetworkLevel,
  eliseCallConfig,
  eliseMobileCallConfig,
  eliseMobileCallInterfaceConfig,
} from '../dist/index.js';

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

test('mobile call hides every piece of Jitsi UI the app redraws itself', () => {
  assert.equal(eliseMobileCallConfig.filmstrip.disabled, true, 'no Jitsi self-view/thumbnails');
  assert.equal(eliseMobileCallConfig.prejoinConfig.enabled, false);
  assert.deepEqual(eliseMobileCallConfig.conferenceInfo, { alwaysVisible: [], autoHide: [] });
  assert.equal(eliseMobileCallConfig.hideDisplayName, true);
  assert.deepEqual(eliseMobileCallConfig.notifications, []);
  assert.equal(eliseMobileCallConfig.connectionIndicators.disabled, true);
  assert.equal(eliseMobileCallConfig.disableTileView, true);
  assert.equal(eliseMobileCallInterfaceConfig.VIDEO_LAYOUT_FIT, 'nocrop');
});

test('mobile UI keys leave the shared network and video settings untouched', () => {
  for (const key of [
    'p2p',
    'disableSimulcast',
    'resolution',
    'constraints',
    'videoQuality',
    'channelLastN',
  ]) {
    assert.deepEqual(eliseMobileCallConfig[key], eliseCallConfig[key], key);
  }
});

test('network level follows Jitsi connection statistics', () => {
  assert.equal(callNetworkLevel({}), 'unknown');
  assert.equal(callNetworkLevel({ quality: null, packetLoss: null }), 'unknown');
  assert.equal(callNetworkLevel({ quality: 100 }), 'good');
  assert.equal(callNetworkLevel({ quality: 30, packetLoss: 1 }), 'good');
  assert.equal(callNetworkLevel({ quality: 29 }), 'fair');
  assert.equal(callNetworkLevel({ quality: 90, packetLoss: 5 }), 'fair');
  assert.equal(callNetworkLevel({ quality: 9 }), 'poor');
  assert.equal(callNetworkLevel({ packetLoss: 12 }), 'poor');
  assert.equal(callNetworkLevel({ quality: Number.NaN }), 'unknown');
});
