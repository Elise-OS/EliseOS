/**
 * Call UI captures of the dashboard side: the resident TV (/resident-screen) and the caregiver
 * web call window, both driven by the real Élise call screen (apps/dashboard/src/call/) against a
 * local Jitsi. Companion of scripts/calls-ui-capture.mjs (mobile + original TV run), same setup:
 *
 *   corepack pnpm --filter @elise/contracts --filter @elise/i18n --filter @elise/ui run build
 *   bash scripts/calls-ui-jitsi.sh up
 *   node scripts/calls-ui-capture-tv.mjs --phase after          # tv-*.png and web-*.png
 *   bash scripts/calls-ui-jitsi.sh down
 *
 * Options: --phase (file prefix, default after), --out <dir> (default ~/.hermes/data/elise_calls),
 * --only tv|web, --jitsi-backend http://127.0.0.1:18383, --tls-port 18384, --dashboard-port 5199,
 * --dashboard <url> (reuse a running Vite), --lang fr|en|es|it|pt.
 * Another Jitsi project: ELISE_CALLS_PROJECT=elise-calls-tv ELISE_CALLS_HTTP_PORT=18483
 * ELISE_CALLS_TLS_PORT=18484 … bash scripts/calls-ui-jitsi.sh up, then the matching
 * --jitsi-backend/--tls-port here (the TLS port must match Jitsi's PUBLIC_URL).
 *
 * The other person is a plain External API page with the Élise settings, filming a labelled card
 * ("Téléphone - Paul" blue, "TV - Jeanne" brown). Only the Élise API is mocked.
 */
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const phase = option('phase', 'after');
const out = path.resolve(option('out', path.join(os.homedir(), '.hermes/data/elise_calls')));
const only = option('only', '');
const lang = option('lang', 'fr');
const jitsiBackend = new URL(option('jitsi-backend', 'http://127.0.0.1:18383'));
const tlsPort = Number(option('tls-port', '18384'));
const dashboardPort = Number(option('dashboard-port', '5199'));
const jitsiOrigin = `https://127.0.0.1:${tlsPort}`;

const contracts = await import(
  new URL('../packages/contracts/dist/index.js', import.meta.url).href
).catch(() => {
  throw new Error('Build @elise/contracts first (see the header of this file).');
});
const { eliseCallConfig, eliseCallUiConfig, eliseCallUiInterfaceConfig, initialScreenState } =
  contracts;

// The other person: a bare Jitsi page with the same Élise settings as the dashboard.
const otherPage = (room, name) => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#000}#m{position:absolute;inset:0}</style></head>
<body><div id="m"></div><script src="/external_api.js"></script><script>
window.__api = new JitsiMeetExternalAPI(location.host, {
  roomName: ${JSON.stringify(room)}, parentNode: document.getElementById('m'), width: '100%', height: '100%',
  userInfo: { displayName: ${JSON.stringify(name)} },
  configOverwrite: ${JSON.stringify({ ...eliseCallConfig, ...eliseCallUiConfig })},
  interfaceConfigOverwrite: ${JSON.stringify(eliseCallUiInterfaceConfig)},
});
window.__joined = false;
window.__api.addEventListener('videoConferenceJoined', () => { window.__joined = true; });
</script></body></html>`;

// Each participant films a labelled card instead of Chromium's identical test pattern.
const labelledCamera = ({ label, color }) => {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return;
  const real = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints) => {
    const stream = await real(constraints);
    const [track] = stream.getVideoTracks();
    if (!track) return stream;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      const { width: w, height: h } = canvas;
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, '#1c1c1c');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.44, h * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 1.02, h * 0.36, h * 0.33, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(h / 12)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, w / 2, h * 0.14);
    };
    draw();
    setInterval(draw, 200);
    const canvasTrack = canvas.captureStream(10).getVideoTracks()[0];
    const settings = track.getSettings();
    const canvasSettings = canvasTrack.getSettings.bind(canvasTrack);
    canvasTrack.getSettings = () => ({
      ...canvasSettings(),
      deviceId: settings.deviceId,
      groupId: settings.groupId,
    });
    const stop = canvasTrack.stop.bind(canvasTrack);
    canvasTrack.stop = () => {
      stop();
      track.stop();
    };
    Object.defineProperty(canvasTrack, 'label', { get: () => track.label });
    stream.removeTrack(track);
    stream.addTrack(canvasTrack);
    return stream;
  };
};
// The appliance has a USB webcam: matching labels so ResidentScreen detects its microphone.
const usbWebcamLabels = () => {
  if (location.protocol !== 'http:') return;
  const original = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
  if (!original) return;
  navigator.mediaDevices.enumerateDevices = async () =>
    (await original()).map((device) => ({
      deviceId: device.deviceId || `${device.kind}-fake`,
      groupId: device.groupId,
      kind: device.kind,
      label:
        device.kind === 'audioinput'
          ? 'USB Webcam Microphone'
          : device.kind === 'videoinput'
            ? 'USB Webcam'
            : device.label,
      toJSON() {
        return this;
      },
    }));
};

// TLS front for Jitsi (the External API always opens https://<domain>/<room>).
const certDir = mkdtempSync(path.join(os.tmpdir(), 'elise-calls-tv-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    path.join(certDir, 'key.pem'),
    '-out',
    path.join(certDir, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ],
  { stdio: 'ignore' },
);
const proxy = createHttpsServer(
  {
    key: readFileSync(path.join(certDir, 'key.pem')),
    cert: readFileSync(path.join(certDir, 'cert.pem')),
  },
  (request, response) => {
    const url = new URL(request.url || '/', jitsiOrigin);
    if (url.pathname === '/__elise/other') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(otherPage(url.searchParams.get('room'), url.searchParams.get('name')));
      return;
    }
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
proxy.on('upgrade', (request, socket, head) => {
  const backend = connect(Number(jitsiBackend.port), jitsiBackend.hostname, () => {
    const headers = Object.entries({ ...request.headers, host: jitsiBackend.host })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    backend.write(`${request.method} ${request.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    backend.write(head);
    backend.pipe(socket);
    socket.pipe(backend);
  });
  backend.on('error', () => socket.destroy());
  socket.on('error', () => backend.destroy());
});
await new Promise((resolve) => proxy.listen(tlsPort, '127.0.0.1', resolve));

let vite;
let dashboard = option('dashboard', '');
if (!dashboard) {
  dashboard = `http://127.0.0.1:${dashboardPort}`;
  vite = spawn(
    'corepack',
    [
      'pnpm',
      '--filter',
      '@elise/dashboard',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(dashboardPort),
      '--strictPort',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  vite.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  for (let i = 0; i < 120; i++) {
    if (
      await fetch(`${dashboard}/resident-screen`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const chromiumPath =
  process.env.CHROMIUM_PATH ||
  [
    chromium.executablePath(),
    path.join(
      os.homedir(),
      '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    ),
  ].find((candidate) => existsSync(candidate));
const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
});
const cleanup = async () => {
  await browser.close().catch(() => undefined);
  proxy.close();
  if (vite) {
    try {
      process.kill(-vite.pid, 'SIGTERM');
    } catch {
      /* already stopped */
    }
  }
};
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await mkdir(out, { recursive: true });
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(out, `${phase}-${name}.png`) });
  process.stdout.write(`captured ${phase}-${name}.png\n`);
};
const until = async (check, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return true;
    await pause(400);
  }
  return false;
};

const newContext = async (options, camera) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'fr-FR',
    ...options,
  });
  await context.grantPermissions(['camera', 'microphone']);
  await context.addInitScript(labelledCamera, camera);
  return context;
};
const joinOther = async (room, name, camera) => {
  const context = await newContext({ viewport: { width: 960, height: 720 } }, camera);
  const page = await context.newPage();
  await page.goto(
    `${jitsiOrigin}/__elise/other?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`,
  );
  if (!(await until(() => page.evaluate(() => window.__joined))))
    process.stderr.write(`[${name}] never joined\n`);
  return page;
};

// Mocked Élise API for the resident screen.
const routeResidentApi = async (context, call, joinUrl = jitsiOrigin) => {
  await context.route(/\/api\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace('/api/v1/', '');
    if (p.endsWith('/events')) return route.fulfill({ status: 204, body: '' });
    if (p === 'screen-device/heartbeat' || p === 'screen') {
      const state = initialScreenState();
      state.settings.consent = true;
      state.call = call.current;
      return route.fulfill({
        json: {
          state,
          paired: true,
          online: true,
          lastSeen: new Date().toISOString(),
          capabilities: { camera: true, microphone: true },
          grant: { call: true, autoAnswer: true, message: true, control: true, administer: true },
          userId: 'resident-screen',
          jitsiUrl: jitsiOrigin,
          resident: 'Jeanne Martin',
          timezone: 'Europe/Paris',
          visit: null,
          agenda: [],
          weather: null,
          members: [],
          language: lang,
        },
      });
    }
    if (/^screen-device\/calls\/[^/]+\/join$/.test(p))
      return route.fulfill({
        json: { url: joinUrl, room: call.room, jwt: '', name: 'Écran de Jeanne' },
      });
    if (route.request().method() === 'DELETE') {
      call.current = null;
      return route.fulfill({ status: 204, body: '' });
    }
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
};
const incomingCall = (room) => ({
  room,
  current: {
    id: `call-${room}`,
    room,
    userId: 'paul',
    name: 'Paul',
    client: 'mobile',
    automatic: false,
    createdAt: Date.now(),
    acceptedAt: null,
    deadline: Date.now() + 120000,
  },
});
const openTv = async (call, joinUrl) => {
  const context = await newContext(
    { viewport: { width: 1920, height: 1080 } },
    {
      label: 'TV - Jeanne',
      color: '#8a5a2b',
    },
  );
  await context.addInitScript(usbWebcamLabels);
  await context.addInitScript(() => localStorage.setItem('elise-screen-token', 'a'.repeat(64)));
  await routeResidentApi(context, call, joinUrl);
  const tv = await context.newPage();
  tv.on('pageerror', (error) => process.stderr.write(`[tv] ${error.message}\n`));
  await tv.goto(`${dashboard}/resident-screen?lang=${lang}`);
  await tv.waitForSelector('.incoming-call-screen', { timeout: 30000 });
  return tv;
};
const tvJoined = (tv) =>
  until(() =>
    Promise.resolve(
      tv
        .frames()
        .find((frame) => frame.url().includes('jitsi_meet_external_api_id'))
        ?.evaluate(() => !!window.APP?.conference?.isJoined?.()),
    ),
  );

const runTv = async () => {
  const room = `elisetv${Date.now()}`;
  const call = incomingCall(room);
  const tv = await openTv(call);
  await pause(1200);
  await shot(tv, 'tv-01-incoming');
  call.current = { ...call.current, acceptedAt: Date.now() };
  await tv.waitForSelector('.call--tv', { timeout: 20000 });
  await pause(700);
  await shot(tv, 'tv-02-connecting');
  if (!(await tvJoined(tv))) process.stderr.write('[tv] never joined\n');
  await tv.waitForSelector('.call--waiting', { timeout: 20000 }).catch(() => undefined);
  await pause(2500);
  await shot(tv, 'tv-03-waiting');
  const paul = await joinOther(room, 'Paul', { label: 'Téléphone - Paul', color: '#2b6a8a' });
  await tv.waitForSelector('.call--live', { timeout: 30000 }).catch(() => undefined);
  await pause(6000);
  await shot(tv, 'tv-04-in-call');
  // Remote control: from "Hang up" (focused first) back to the microphone, then OK.
  await tv.keyboard.press('ArrowLeft');
  await tv.keyboard.press('ArrowLeft');
  await pause(200);
  await tv.keyboard.press('Enter');
  await pause(2000);
  await shot(tv, 'tv-05-mic-muted');
  await tv.keyboard.press('Enter');
  await pause(1500);
  // Network drop on the TV, then back.
  await tv.context().setOffline(true);
  await tv.evaluate(() => window.dispatchEvent(new Event('offline')));
  await pause(1500);
  await shot(tv, 'tv-06-reconnecting');
  await tv.context().setOffline(false);
  await tv.evaluate(() => window.dispatchEvent(new Event('online')));
  await tv.waitForSelector('.call--live', { timeout: 45000 }).catch(() => undefined);
  await pause(3000);
  await shot(tv, 'tv-07-back-in-call');
  // Paul hangs up: Jitsi first, then the Élise call disappears.
  await paul.evaluate(() => window.__api.executeCommand('hangup'));
  await pause(1500);
  await shot(tv, 'tv-08-peer-left');
  call.current = null;
  await tv.waitForSelector('.call--ended', { timeout: 10000 }).catch(() => undefined);
  await pause(800);
  await shot(tv, 'tv-09-ended');
  await tv.waitForSelector('.call', { state: 'detached', timeout: 15000 }).catch(() => undefined);
  await pause(800);
  await shot(tv, 'tv-10-back-home');
  await paul.context().close();
  await tv.context().close();

  // Jitsi unreachable: clear message and "Try again" instead of a white screen.
  const failing = incomingCall(`elisetvfail${Date.now()}`);
  const broken = await openTv(failing, 'https://127.0.0.1:9');
  failing.current = { ...failing.current, acceptedAt: Date.now() };
  await broken.waitForSelector('.call--failed', { timeout: 30000 }).catch(() => undefined);
  await pause(800);
  await shot(broken, 'tv-11-error');
  await broken.context().close();
};

const runWeb = async () => {
  // The caregiver's browser shows the shared call screen over the dashboard (Vite modules).
  const room = `eliseweb${Date.now()}`;
  const context = await newContext(
    { viewport: { width: 1440, height: 900 } },
    {
      label: 'Ordinateur - Paul',
      color: '#2b6a8a',
    },
  );
  await context.route(/\/api\/v1\//, (route) =>
    route.fulfill({ status: 401, json: { message: 'demo' } }),
  );
  const web = await context.newPage();
  web.on('pageerror', (error) => process.stderr.write(`[web] ${error.message}\n`));
  await web.goto(`${dashboard}/?lang=${lang}`);
  await pause(1500);
  await web.evaluate(
    async ({ join }) => {
      const source = await (await fetch('/src/main.tsx')).text();
      const dep = (name) =>
        source.match(new RegExp(`"(/node_modules/\\.vite/deps/${name}\\.js[^"]*)"`))?.[1];
      const React = (await import(dep('react'))).default;
      const reactDom = await import(dep('react-dom_client'));
      const createRoot = reactDom.createRoot ?? reactDom.default.createRoot;
      const { JitsiCall } = await import('/src/call/JitsiCall.tsx');
      await import('/src/screen.css');
      const host = document.createElement('div');
      document.body.append(host);
      const rootNode = createRoot(host);
      const render = (ended) =>
        rootNode.render(
          React.createElement(
            'div',
            { className: 'screen-call-window' },
            React.createElement(
              'div',
              { className: 'screen-call-window__panel' },
              React.createElement(JitsiCall, {
                variant: 'web',
                join,
                peerName: 'Jeanne Martin',
                ended,
                onHangup: () => render(true),
              }),
            ),
          ),
        );
      render(false);
    },
    { join: { url: jitsiOrigin, room, jwt: '', name: 'Paul' } },
  );
  await web.waitForSelector('.call--waiting', { timeout: 45000 }).catch(() => undefined);
  await pause(2000);
  await shot(web, 'web-01-waiting');
  const jeanne = await joinOther(room, 'Écran de Jeanne', {
    label: 'TV - Jeanne',
    color: '#8a5a2b',
  });
  await web.waitForSelector('.call--live', { timeout: 30000 }).catch(() => undefined);
  await pause(6000);
  await shot(web, 'web-02-in-call');
  await web.click('.call__controls .call-button:first-child');
  await pause(1500);
  await shot(web, 'web-03-mic-muted');
  await web.click('.call__controls .call-button:nth-child(2)');
  await pause(1500);
  await shot(web, 'web-04-camera-off');
  await web.click('.call__controls .call-button:nth-child(2)');
  await web.click('.call__controls .call-button:first-child');
  await pause(1000);
  await web.setViewportSize({ width: 390, height: 844 });
  await pause(1500);
  await shot(web, 'web-05-phone-size');
  await web.setViewportSize({ width: 1440, height: 900 });
  await web.click('.call-button--hangup');
  await pause(1500);
  await shot(web, 'web-06-ended');
  await jeanne.context().close();
  await context.close();
};

try {
  if (only !== 'web') await runTv();
  if (only !== 'tv') await runWeb();
} finally {
  await cleanup();
}
