import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ELISE_CALL_MAX_HEIGHT,
  ELISE_CALL_STANDARD_HEIGHT,
  callNetworkLevel,
  eliseCallConfig,
  eliseCallUiConfig,
  eliseCallUiInterfaceConfig,
  eliseMobileCallConfig,
  eliseMobileCallInterfaceConfig,
} from '../dist/index.js';

for (const [name, config] of [
  ['shared', eliseCallConfig],
  ['mobile', eliseMobileCallConfig],
]) {
  test(`${name} call config uses private P2P with an adaptive JVB fallback`, () => {
    assert.equal(config.p2p.enabled, true);
    assert.deepEqual(config.p2p.stunServers, [], 'no third-party STUN server');
    assert.equal(config.disableSimulcast, false);
    assert.equal(config.videoQuality.codecPreferenceOrder[0], 'VP8');
    assert.equal(config.p2p.codecPreferenceOrder[0], 'VP8');
    assert.ok(!config.videoQuality.codecPreferenceOrder.includes('AV1'));
    assert.equal(config.constraints.video.height.max, ELISE_CALL_MAX_HEIGHT);
    assert.equal(config.constraints.video.height.max, 720);
    assert.ok(config.constraints.video.frameRate.max <= 24);
    assert.equal(
      config.videoQuality.minHeightForQualityLvl[ELISE_CALL_STANDARD_HEIGHT],
      'standard',
    );
    assert.equal(config.videoQuality.enableAdaptiveMode, true);
    assert.equal(config.enableForcedReload, true);
    assert.equal(config.videoQuality.vp8.maxBitratesVideo.low, 180000);
    assert.equal(config.videoQuality.vp8.maxBitratesVideo.high, 1200000);
    assert.ok(!config.videoQuality.codecPreferenceOrder.includes('VP9'));
  });
}

test('unneeded Jitsi features and continuous audio analysers stay disabled', () => {
  assert.equal(eliseCallConfig.prejoinConfig.enabled, false);
  assert.equal(eliseCallConfig.welcomePage.disabled, true);
  assert.equal(eliseCallConfig.disableDeepLinking, true);
  assert.equal(eliseCallConfig.disableChat, true);
  assert.equal(eliseCallConfig.disableReactions, true);
  assert.equal(eliseCallConfig.disablePolls, true);
  assert.equal(eliseCallConfig.feedbackPercentage, 0);
  assert.equal(eliseCallConfig.recordingService.enabled, false);
  assert.equal(eliseCallConfig.localRecording.disable, true);
  assert.equal(eliseCallConfig.disableAudioLevels, true);
  assert.equal(eliseCallConfig.enableNoisyMicDetection, false);
  assert.equal(eliseCallConfig.disableAP, false);
  assert.equal(eliseCallConfig.disableAEC, false);
  assert.equal(eliseCallConfig.disableAGC, false);
  assert.equal(eliseCallConfig.disableNS, false);
  assert.equal(eliseCallConfig.enableOpusRed, true);
});

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

test('mobile and TV/web hide Jitsi with the same single set of UI keys', () => {
  for (const [key, value] of Object.entries(eliseCallUiConfig)) {
    if (key === 'toolbarConfig') continue;
    assert.deepEqual(eliseMobileCallConfig[key], value, key);
  }
  assert.deepEqual(eliseMobileCallConfig.toolbarConfig, {
    ...eliseCallUiConfig.toolbarConfig,
    autoHideWhileChatIsOpen: true,
  });
  for (const [key, value] of Object.entries(eliseCallUiInterfaceConfig)) {
    assert.deepEqual(eliseMobileCallInterfaceConfig[key], value, key);
  }
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
