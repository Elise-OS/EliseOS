import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { eliseCallConfig } from '../packages/contracts/dist/index.js';

const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const profile = option('profile', 'optimized');
const jitsi = new URL(option('jitsi', 'https://127.0.0.1:18184'));
const jitsiBackend = new URL(option('jitsi-backend', 'http://127.0.0.1:18183'));
const tlsKey = option('tls-key');
const tlsCert = option('tls-cert');
const output = path.resolve(option('output', `test-results/jitsi-quality-${profile}.json`));
const bundledChromium = chromium.executablePath();
const cachedHeadlessShell =
  '/home/drsam/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const chromiumPath =
  process.env.CHROMIUM_PATH ||
  (existsSync(bundledChromium)
    ? bundledChromium
    : existsSync(cachedHeadlessShell)
      ? cachedHeadlessShell
      : '/usr/bin/chromium');

// Snapshot of the client configuration on main before this optimization lane.
const baselineCallConfig = {
  prejoinConfig: { enabled: false },
  disableDeepLinking: true,
  p2p: {
    enabled: true,
    stunServers: [],
    iceTransportPolicy: 'all',
    codecPreferenceOrder: ['VP8', 'H264', 'VP9'],
    mobileCodecPreferenceOrder: ['VP8', 'H264', 'VP9'],
  },
  disableSimulcast: true,
  enableLayerSuspension: true,
  resolution: 480,
  constraints: {
    video: {
      width: { ideal: 640, max: 854 },
      height: { ideal: 480, max: 480, min: 180 },
      frameRate: { ideal: 20, max: 20 },
    },
  },
  videoQuality: {
    codecPreferenceOrder: ['VP8', 'H264', 'VP9'],
    mobileCodecPreferenceOrder: ['VP8', 'H264', 'VP9'],
    enableAdaptiveMode: true,
    maxBitratesVideo: {
      VP8: { low: 200000, standard: 500000, high: 900000 },
      VP9: { low: 100000, standard: 300000, high: 700000 },
      H264: { low: 200000, standard: 500000, high: 900000 },
    },
  },
  disableAudioLevels: true,
  enableNoisyMicDetection: false,
  enableNoAudioDetection: false,
  enableTalkWhileMuted: false,
  channelLastN: 1,
  audioQuality: { stereo: false },
  notifications: [],
  disableJoinLeaveSounds: true,
};

const config = profile === 'baseline' ? baselineCallConfig : eliseCallConfig;
const room = `elisequality${Date.now()}`;
const state = { participants: new Map() };

const harness = (name) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body><main id="meet"></main><script src="${jitsi.origin}/external_api.js"></script><script>
const startedAt = Date.now();
const events = [];
const api = new JitsiMeetExternalAPI(${JSON.stringify(jitsi.host)}, {
  roomName: ${JSON.stringify(room)},
  parentNode: document.getElementById('meet'),
  width: 960,
  height: 540,
  userInfo: { displayName: ${JSON.stringify(name)} },
  configOverwrite: ${JSON.stringify({
    ...config,
    startWithAudioMuted: false,
    startWithVideoMuted: false,
  })}
});
for (const event of ['videoConferenceJoined', 'participantJoined', 'participantLeft',
  'cameraError', 'micError', 'peerConnectionFailure', 'errorOccurred', 'readyToClose',
  'videoConferenceLeft']) {
  api.addEventListener(event, payload => {
    events.push({ event, at: Date.now(), payload });
    document.body.dataset[event] = 'true';
  });
}
window.benchmark = { api, events, startedAt };
</script></body></html>`;

if (!tlsKey || !tlsCert) throw new Error('--tls-key and --tls-cert are required');
const proxy = createHttpsServer(
  { key: await readFile(tlsKey), cert: await readFile(tlsCert) },
  (request, response) => {
    const upstream = httpRequest(
      new URL(request.url || '/', jitsiBackend),
      { method: request.method, headers: { ...request.headers, host: jitsiBackend.host } },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on('error', (error) => {
      response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(String(error));
    });
    request.pipe(upstream);
  },
);
await new Promise((resolve) => proxy.listen(Number(jitsi.port), jitsi.hostname, resolve));

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const name = url.searchParams.get('name') || 'participant';
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'permissions-policy': `camera=(self "${jitsi.origin}"), microphone=(self "${jitsi.origin}")`,
    'cache-control': 'no-store',
  });
  response.end(harness(name));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const serverAddress = server.address();
const harnessOrigin = `http://127.0.0.1:${serverAddress.port}`;

const peerInit = () => {
  const NativePeerConnection = window.RTCPeerConnection;
  window.__elisePeerConnections = [];
  window.RTCPeerConnection = function (...args) {
    const peer = new NativePeerConnection(...args);
    window.__elisePeerConnections.push(peer);
    return peer;
  };
  window.RTCPeerConnection.prototype = NativePeerConnection.prototype;
};

const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
  ignoreDefaultArgs: ['--mute-audio'],
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
});

const makeParticipant = async (name) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  await context.grantPermissions(['camera', 'microphone'], { origin: harnessOrigin });
  await context.grantPermissions(['camera', 'microphone'], { origin: jitsi.origin });
  await context.addInitScript(peerInit);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      process.stderr.write(`[${name} console ${message.type()}] ${message.text()}\n`);
  });
  page.on('pageerror', (error) => process.stderr.write(`[${name} page] ${error.stack}\n`));
  page.on('requestfailed', (request) =>
    process.stderr.write(
      `[${name} request] ${request.url()} ${request.failure()?.errorText || 'failed'}\n`,
    ),
  );
  state.participants.set(name, { context, page });
  return { context, page };
};

const jitsiFrame = (page) => page.frames().find((frame) => frame.url().startsWith(jitsi.origin));

const statsSnapshot = async (page) => {
  const frame = jitsiFrame(page);
  if (!frame) throw new Error('Jitsi frame was not created');
  return frame.evaluate(async () => {
    const peers = window.__elisePeerConnections || [];
    const records = [];
    for (const peer of peers) {
      for (const report of (await peer.getStats()).values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'video' && !report.isRemote) {
          records.push({
            direction: 'inbound',
            bytes: report.bytesReceived || 0,
            packets: report.packetsReceived || 0,
            packetsLost: report.packetsLost || 0,
            frames: report.framesDecoded || 0,
            fps: report.framesPerSecond || 0,
            width: report.frameWidth || 0,
            height: report.frameHeight || 0,
            codecId: report.codecId,
          });
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video' && !report.isRemote) {
          records.push({
            direction: 'outbound',
            bytes: report.bytesSent || 0,
            packets: report.packetsSent || 0,
            frames: report.framesEncoded || 0,
            fps: report.framesPerSecond || 0,
            width: report.frameWidth || 0,
            height: report.frameHeight || 0,
            qualityLimitationReason: report.qualityLimitationReason || 'none',
            codecId: report.codecId,
          });
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          records.push({
            direction: 'transport',
            currentRoundTripTime: report.currentRoundTripTime || 0,
            availableOutgoingBitrate: report.availableOutgoingBitrate || 0,
          });
        }
      }
    }
    return records;
  });
};

const active = (records, direction) =>
  records
    .filter((record) => record.direction === direction)
    .sort((left, right) => right.bytes - left.bytes)[0];

const first = await makeParticipant('resident');
await first.page.goto(`${harnessOrigin}/?name=resident`);
await first.page.waitForFunction(
  () => document.body.dataset.videoConferenceJoined === 'true',
  null,
  {
    timeout: 45000,
  },
);

const secondStart = Date.now();
const second = await makeParticipant('caregiver');
await second.page.goto(`${harnessOrigin}/?name=caregiver`);
await Promise.all([
  first.page.waitForFunction(() => document.body.dataset.participantJoined === 'true', null, {
    timeout: 45000,
  }),
  second.page.waitForFunction(() => document.body.dataset.videoConferenceJoined === 'true', null, {
    timeout: 45000,
  }),
]);

const waitForRemoteVideo = async (page) => {
  await page.waitForFunction(
    (origin) => {
      const frame = [...document.querySelectorAll('iframe')].find((item) =>
        item.src.startsWith(origin),
      );
      return frame?.contentWindow ? true : false;
    },
    jitsi.origin,
    { timeout: 45000 },
  );
  const frame = jitsiFrame(page);
  await frame.waitForFunction(
    () =>
      [...document.querySelectorAll('video')].some(
        (video) => video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2,
      ),
    null,
    { timeout: 45000 },
  );
  return Date.now() - secondStart;
};

const firstVideoMs = await Promise.all([
  waitForRemoteVideo(first.page),
  waitForRemoteVideo(second.page),
]);
await new Promise((resolve) => setTimeout(resolve, 5000));
const before = {
  resident: await statsSnapshot(first.page),
  caregiver: await statsSnapshot(second.page),
};
const sampleStart = Date.now();
await new Promise((resolve) => setTimeout(resolve, 10000));
const after = {
  resident: await statsSnapshot(first.page),
  caregiver: await statsSnapshot(second.page),
};
const sampleSeconds = (Date.now() - sampleStart) / 1000;

const summarize = (name) => {
  const incomingBefore = active(before[name], 'inbound');
  const incomingAfter = active(after[name], 'inbound');
  const outgoingBefore = active(before[name], 'outbound');
  const outgoingAfter = active(after[name], 'outbound');
  const transport = active(after[name], 'transport');
  const received = Math.max(0, (incomingAfter?.bytes || 0) - (incomingBefore?.bytes || 0));
  const sent = Math.max(0, (outgoingAfter?.bytes || 0) - (outgoingBefore?.bytes || 0));
  const packets = Math.max(0, (incomingAfter?.packets || 0) - (incomingBefore?.packets || 0));
  const lost = Math.max(0, (incomingAfter?.packetsLost || 0) - (incomingBefore?.packetsLost || 0));
  return {
    inboundKbps: Math.round((received * 8) / sampleSeconds / 1000),
    outboundKbps: Math.round((sent * 8) / sampleSeconds / 1000),
    packetLossPercent: packets + lost ? Number(((lost * 100) / (packets + lost)).toFixed(2)) : 0,
    fps: incomingAfter?.fps || 0,
    resolution: `${incomingAfter?.width || 0}x${incomingAfter?.height || 0}`,
    outboundResolution: `${outgoingAfter?.width || 0}x${outgoingAfter?.height || 0}`,
    qualityLimitationReason: outgoingAfter?.qualityLimitationReason || 'unknown',
    roundTripMs: Math.round((transport?.currentRoundTripTime || 0) * 1000),
  };
};

const result = {
  generatedAt: new Date().toISOString(),
  profile,
  room,
  environment: {
    chromium: await browser.version(),
    jitsi: jitsi.origin,
    fakeCameraAndMicrophone: true,
    sampleSeconds: Number(sampleSeconds.toFixed(2)),
  },
  firstRemoteVideoMs: {
    resident: firstVideoMs[0],
    caregiver: firstVideoMs[1],
    slowest: Math.max(...firstVideoMs),
  },
  media: {
    resident: summarize('resident'),
    caregiver: summarize('caregiver'),
  },
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

for (const participant of state.participants.values()) await participant.context.close();
await browser.close();
await new Promise((resolve) => server.close(resolve));
await new Promise((resolve) => proxy.close(resolve));
