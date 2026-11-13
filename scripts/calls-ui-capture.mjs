/**
 * Call UI captures: the resident TV (dashboard /resident-screen) and the mobile call screen join
 * the same local Jitsi room and every visible state is captured as PNG + a JSON DOM report.
 *
 * Run (from the repository root):
 *   corepack pnpm install
 *   corepack pnpm --filter @elise/contracts --filter @elise/i18n --filter @elise/ui run build
 *   bash scripts/calls-ui-jitsi.sh up          # private Jitsi on 127.0.0.1 (project elise-calls)
 *   node scripts/calls-ui-capture.mjs --phase after            # current code
 *   node scripts/calls-ui-capture.mjs --phase after --variant probe   # + "hide everything" probe
 *   bash scripts/calls-ui-jitsi.sh down        # always stop Jitsi afterwards
 *
 * Options: --phase before|after (file prefix, default before), --out <dir> (default
 * ~/.hermes/data/elise_calls), --variant current|probe|all (default current), --only tv|mobile,
 * --jitsi-backend http://127.0.0.1:18383, --tls-port 18384, --dashboard-port 5199,
 * --mobile-ua android|ios (default android), --probe-json <file> (custom probe overrides), --dashboard <url> (reuse an already running dashboard dev server instead of starting Vite).
 * CHROMIUM_PATH overrides the browser (defaults to Playwright's, else its cached headless shell).
 *
 * What is real and what is reproduced:
 * - TV: the real dashboard ResidentScreen + JitsiFrame (Vite dev server); only the Elise API is
 *   mocked (heartbeat snapshot with an incoming then accepted call, join answer).
 * - Mobile: the WebView document is the real `callPage()` of
 *   apps/mobile/src/screen/MobileCallOverlay.tsx (extracted from the source and evaluated with
 *   the built @elise/contracts configs), served from the Jitsi origin like the WebView baseUrl.
 *   The React Native chrome around it (safe areas, header, rounded stage, 4 controls) is an HTML
 *   copy of the StyleSheet in that file: update `mobileShell()` below when the RN layout changes.
 *   The browser identifies as an Android WebView (Chromium) so Jitsi takes its mobile code path.
 * - Fake camera/microphone (Chromium fake devices); the TV's fake devices are relabelled as a USB
 *   webcam so ResidentScreen detects a physical microphone like on the appliance.
 * - Jitsi runs as guests (no JWT, no Elise guard) with the production web settings.
 */
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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
const phase = option('phase', 'before');
const out = path.resolve(option('out', path.join(os.homedir(), '.hermes/data/elise_calls')));
const variantOption = option('variant', 'current');
const only = option('only', '');
const mobileUa = option('mobile-ua', 'android');
const userAgents = {
  // react-native-webview on Android is a Chromium WebView ("; wv").
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36',
  // WKWebView on iOS: no "Safari/" token (rendering stays Chromium here, only Jitsi's checks change).
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};
const jitsiBackend = new URL(option('jitsi-backend', 'http://127.0.0.1:18383'));
const tlsPort = Number(option('tls-port', '18384'));
const dashboardPort = Number(option('dashboard-port', '5199'));
const jitsiOrigin = `https://127.0.0.1:${tlsPort}`;

const contracts = await import(
  new URL('../packages/contracts/dist/index.js', import.meta.url).href
).catch(() => {
  throw new Error('Build @elise/contracts first (see the header of this file).');
});
const { eliseMobileCallConfig, eliseMobileCallInterfaceConfig, initialScreenState } = contracts;

// ---------------------------------------------------------------------------------------------
// Mobile WebView document: the real callPage() from MobileCallOverlay.tsx.
const overlaySource = readFileSync(
  path.join(root, 'apps/mobile/src/screen/MobileCallOverlay.tsx'),
  'utf8',
);
const callPageSource = overlaySource.match(
  /const callPage = \(join(?:: ScreenJoin)?\) => \{[\s\S]*?\n\};\n/,
)?.[0];
if (!callPageSource) throw new Error('callPage() not found in MobileCallOverlay.tsx');
const callPage = new Function(
  'eliseMobileCallConfig',
  'eliseMobileCallInterfaceConfig',
  `const inlineJson = (value) => JSON.stringify(value).replace(/</g, '\\\\u003c');
   ${callPageSource.replace('(join: ScreenJoin)', '(join)')}
   return callPage;`,
)(eliseMobileCallConfig, eliseMobileCallInterfaceConfig);

// Settings probed to hide every piece of Jitsi UI (variant "probe").
const probe = {
  config: {
    toolbarButtons: [],
    toolbarConfig: { alwaysVisible: false, initialTimeout: 0, timeout: 0 },
    hiddenPremeetingButtons: ['microphone', 'camera', 'select-background', 'invite', 'settings'],
    prejoinConfig: { enabled: false },
    filmstrip: { disabled: true, disableResizable: true, disableStageFilmstrip: true },
    disableFilmstripAutohiding: false,
    notifications: [],
    hideConferenceSubject: true,
    hideConferenceTimer: true,
    hideParticipantsStats: true,
    hideDisplayName: true,
    hideDominantSpeakerBadge: true,
    disableTileView: true,
    disableTileEnlargement: true,
    disableSelfViewSettings: true,
    disableShortcuts: true,
    disableInviteFunctions: true,
    disableProfile: true,
    disableModeratorIndicator: true,
    disableReactions: true,
    disablePolls: true,
    connectionIndicators: { disabled: true, autoHide: true },
    remoteVideoMenu: { disabled: true },
    conferenceInfo: { alwaysVisible: [], autoHide: [] },
    participantsPane: { enabled: false },
    breakoutRooms: { hideAddRoomButton: true },
    disableDeepLinking: true,
    disableJoinLeaveSounds: true,
    disableIncomingMessageSound: true,
    disabledSounds: [
      'ASKED_TO_UNMUTE_SOUND',
      'E2EE_OFF_SOUND',
      'E2EE_ON_SOUND',
      'INCOMING_MSG_SOUND',
      'KNOCKING_PARTICIPANT_SOUND',
      'LIVE_STREAMING_OFF_SOUND',
      'LIVE_STREAMING_ON_SOUND',
      'NO_AUDIO_SIGNAL_SOUND',
      'NOISY_AUDIO_INPUT_SOUND',
      'OUTGOING_CALL_EXPIRED_SOUND',
      'OUTGOING_CALL_REJECTED_SOUND',
      'OUTGOING_CALL_RINGING_SOUND',
      'OUTGOING_CALL_START_SOUND',
      'PARTICIPANT_JOINED_SOUND',
      'PARTICIPANT_LEFT_SOUND',
      'RAISE_HAND_SOUND',
      'REACTION_SOUND',
      'RECORDING_OFF_SOUND',
      'RECORDING_ON_SOUND',
      'TALK_WHILE_MUTED_SOUND',
    ],
  },
  interfaceConfig: {
    SHOW_JITSI_WATERMARK: false,
    SHOW_WATERMARK_FOR_GUESTS: false,
    SHOW_BRAND_WATERMARK: false,
    SHOW_POWERED_BY: false,
    SHOW_CHROME_EXTENSION_BANNER: false,
    MOBILE_APP_PROMO: false,
    HIDE_DEEP_LINKING_LOGO: true,
    TOOLBAR_ALWAYS_VISIBLE: false,
    TOOLBAR_TIMEOUT: 1,
    DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
    DISABLE_FOCUS_INDICATOR: true,
    DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
    DISABLE_PRESENCE_STATUS: true,
    DISABLE_VIDEO_BACKGROUND: true,
    CONNECTION_INDICATOR_DISABLED: true,
    VIDEO_QUALITY_LABEL_DISABLED: true,
    VIDEO_LAYOUT_FIT: 'both',
    FILM_STRIP_MAX_HEIGHT: 0,
    TILE_VIEW_MAX_COLUMNS: 1,
    VERTICAL_FILMSTRIP: true,
  },
};

// Runs in every page: captures the External API instance and, for the probe, merges overrides.
const externalApiHook = ({ overrides }) => {
  let wrapped;
  Object.defineProperty(window, 'JitsiMeetExternalAPI', {
    configurable: true,
    get: () => wrapped,
    set(Real) {
      wrapped = class extends Real {
        constructor(domain, options) {
          const merged = overrides
            ? {
                ...options,
                configOverwrite: { ...options.configOverwrite, ...overrides.config },
                interfaceConfigOverwrite: {
                  ...options.interfaceConfigOverwrite,
                  ...overrides.interfaceConfig,
                },
              }
            : options;
          super(domain, merged);
          window.__eliseCallsApi = this;
          window.__eliseCallsOptions = merged;
        }
      };
    },
  });
};

// The appliance has a USB webcam: give the fake devices a matching label (dashboard only).
const usbWebcamLabels = () => {
  if (!location.port || location.protocol !== 'http:') return;
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

// Each participant films a labelled card (colour + name + clock) instead of the identical Chromium
// test pattern, so the captures show whose video ends up where.
const labelledCamera = ({ label, color }) => {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return;
  const real = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints) => {
    const stream = await real(constraints);
    const [track] = stream.getVideoTracks();
    if (!track) return stream;
    const settings = track.getSettings();
    const canvas = document.createElement('canvas');
    canvas.width = settings.width || 640;
    canvas.height = settings.height || 480;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      const { width: w, height: h } = canvas;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.42, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(w / 2 - h * 0.3, h * 0.66, h * 0.6, h * 0.34);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(h / 9)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, w / 2, h * 0.14);
      ctx.font = `${Math.round(h / 14)}px monospace`;
      ctx.fillText(new Date().toISOString().slice(11, 19), w / 2, h * 0.95);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    };
    draw();
    setInterval(draw, 100);
    const canvasTrack = canvas.captureStream(15).getVideoTracks()[0];
    const canvasSettings = canvasTrack.getSettings.bind(canvasTrack);
    canvasTrack.getSettings = () => ({
      ...canvasSettings(),
      deviceId: settings.deviceId,
      groupId: settings.groupId,
      facingMode: settings.facingMode,
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

// ---------------------------------------------------------------------------------------------
// React Native chrome of MobileCallOverlay (StyleSheet copied 1:1, safe areas of an iPhone 15).
const icon = (name) =>
  ({
    mic: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
    'mic-off':
      '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/>',
    videocam: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>',
    'videocam-off':
      '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3zM2 3l20 18"/>',
    'camera-reverse':
      '<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M8 13a4 4 0 0 1 7-2m1 2a4 4 0 0 1-7 2"/>',
    call: '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  })[name];
const mobileShell = ({ landscape }) => {
  const inset = landscape
    ? { top: 0, right: 59, bottom: 21, left: 59 }
    : { top: 59, right: 0, bottom: 34, left: 0 };
  const control = (id, iconName, label, cls, extra = '') =>
    `<button id="${id}" class="control ${extra}"><span class="circle ${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon(iconName)}</svg></span><span class="label">${label}</span></button>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#0B2948;font-family:-apple-system,"SF Pro Text",Roboto,system-ui,sans-serif;overflow:hidden}
  .shell{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;background:#0B2948;
    padding:${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px}
  .header{min-height:60px;box-sizing:border-box;padding:8px 20px;display:flex;align-items:center;gap:12px;background:#0B2948}
  .headerCopy{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
  .title{color:#fff;font-size:20px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .eyebrow{color:#AFCDD1;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
  .dot{width:10px;height:10px;border-radius:5px;background:#4E7188}.dot.on{background:#5FB98A}
  .stage{flex:1;margin:0 10px;border-radius:22px;overflow:hidden;background:#06192D;min-height:0}
  .stage iframe{border:0;width:100%;height:100%;display:block;background:#06192D}
  .controls{display:flex;flex-direction:row;justify-content:space-around;align-items:flex-start;padding:16px 12px 10px;background:#0B2948}
  .control{width:76px;display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:0;padding:0;cursor:pointer}
  .control.disabled{opacity:.4}
  .circle{width:60px;height:60px;border-radius:30px;display:flex;align-items:center;justify-content:center}
  .circle svg{width:26px;height:26px}
  .on{background:#24527A;color:#fff}.off{background:#F5F0E8;color:#0B2948}.danger{background:#C8443F;color:#fff}
  .danger svg{transform:rotate(135deg)}
  .label{color:#D0E0E3;font-size:12px;font-weight:700}
  .marker{position:fixed;left:0;right:0;pointer-events:none;outline:1px dashed rgba(255,80,80,.0)}
</style></head><body>
<div class="shell">
  <div class="header"><div class="headerCopy"><div class="title">Jeanne Martin</div>
    <div class="eyebrow" id="eyebrow">Connexion à la visioconférence…</div></div><div class="dot" id="dot"></div></div>
  <div class="stage"><iframe id="webview" src="/__elise/webview" allow="camera; microphone; autoplay; display-capture"></iframe></div>
  <div class="controls">
    ${control('mic', 'mic', 'Micro', 'on')}
    ${control('cam', 'videocam', 'Caméra', 'on')}
    ${control('flip', 'camera-reverse', 'Retourner', 'on', 'disabled')}
    ${control('hangup', 'call', 'Raccrocher', 'danger')}
  </div>
</div>
<script>
  const webview = document.getElementById('webview');
  const state = { audioMuted:false, videoMuted:false, joinedAt:null, messages:[] };
  window.__eliseShell = state;
  const svg = ${JSON.stringify({ mic: icon('mic'), 'mic-off': icon('mic-off'), videocam: icon('videocam'), 'videocam-off': icon('videocam-off') })};
  function paint(){
    const set=(id,on,iconOn,iconOff)=>{const c=document.querySelector('#'+id+' .circle');c.className='circle '+(on?'on':'off');c.querySelector('svg').innerHTML=svg[on?iconOn:iconOff];};
    set('mic',!state.audioMuted,'mic','mic-off');
    set('cam',!state.videoMuted,'videocam','videocam-off');
    document.getElementById('dot').className='dot'+(state.joinedAt?' on':'');
    if(state.joinedAt){const s=Math.floor((Date.now()-state.joinedAt)/1000);document.getElementById('eyebrow').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
  }
  setInterval(paint,1000);
  window.addEventListener('message',(e)=>{
    if(!e.data||typeof e.data.elise!=='string')return;
    const v=e.data.elise; state.messages.push(v);
    if(v==='joined')state.joinedAt=Date.now();
    if(v==='audio-muted')state.audioMuted=true; if(v==='audio-on')state.audioMuted=false;
    if(v==='video-muted')state.videoMuted=true; if(v==='video-on')state.videoMuted=false;
    if(v==='camera-switch-available')document.getElementById('flip').classList.remove('disabled');
    paint();
  });
  // Same calls as webViewRef.injectJavaScript(...) in MobileCallOverlay.
  document.getElementById('mic').onclick=()=>webview.contentWindow.__eliseCall&&webview.contentWindow.__eliseCall.toggleAudio();
  document.getElementById('cam').onclick=()=>webview.contentWindow.__eliseCall&&webview.contentWindow.__eliseCall.toggleVideo();
  document.getElementById('flip').onclick=()=>webview.contentWindow.__eliseToggleCamera&&webview.contentWindow.__eliseToggleCamera();
</script></body></html>`;
};

// ---------------------------------------------------------------------------------------------
// TLS front for Jitsi (the External API always opens https://<domain>/<room>) + mobile pages.
const certDir = mkdtempSync(path.join(os.tmpdir(), 'elise-calls-ui-'));
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

const mobileState = { join: null, landscape: false };
const proxy = createHttpsServer(
  {
    key: readFileSync(path.join(certDir, 'key.pem')),
    cert: readFileSync(path.join(certDir, 'cert.pem')),
  },
  (request, response) => {
    const url = new URL(request.url || '/', jitsiOrigin);
    if (url.pathname === '/__elise/mobile') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(mobileShell({ landscape: url.searchParams.get('landscape') === '1' }));
      return;
    }
    if (url.pathname === '/__elise/webview') {
      const { html } = callPage(mobileState.join);
      // react-native-webview injects window.ReactNativeWebView before the page scripts.
      const bridge =
        '<script>window.ReactNativeWebView={postMessage:function(v){parent.postMessage({elise:v},"*");}};</script>';
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html.replace('<body>', `<body>${bridge}`));
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
// XMPP and bridge websockets.
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

// ---------------------------------------------------------------------------------------------
// Dashboard (Vite dev server) unless --dashboard is given.
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

// What Jitsi actually shows: version, effective config and every visible UI element.
const inspectJitsi = async (frame) =>
  frame
    ?.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== 'hidden' &&
          s.display !== 'none' &&
          Number(s.opacity) > 0.05
        );
      };
      const selectors = {
        toolbox: '.new-toolbox, #new-toolbox, .toolbox-content',
        toolboxButtons: '.toolbox-button, .toolbox-content-items > div',
        hangupButton: '.hangup-button, [aria-label*="eave" i], [aria-label*="Raccrocher" i]',
        filmstrip: '.filmstrip, #remoteVideos, .vertical-filmstrip, .filmstrip__videos',
        localThumbnail: '#localVideoContainer, #localVideoTileViewContainer',
        largeVideo: '#largeVideoContainer, #largeVideoWrapper',
        watermark: '.watermark, .leftwatermark, .rightwatermark',
        subject: '.subject, .details-container, #autoHide',
        conferenceTimer: '.subject-timer',
        notifications: '.notification, [class*="notificationsContainer"] > *, [id^="notification"]',
        connectionIndicator: '.connection-indicator, .indicator-container',
        displayName: '.displayname, .display-name, .stage-participant-label',
        avatar: '.avatar, .avatar-container',
        dialog: '[role="dialog"], .modal, .atlaskit-portal',
        prejoin: '.premeeting-screen, #lobby-screen, .prejoin-input-area',
        deepLinking: '.deep-linking-mobile, .deep-linking-desktop',
        unsupported: '.unsupported-desktop-browser, .unsupported-mobile-browser',
        audioMutedIndicator: '.audioMuted, [id*="audioMuted"], .indicator-icon-container',
        overflowMenu: '.overflow-menu, #overflow-context-menu',
        reactions: '.reactions-menu, .reactions-animations-container',
        pipBubble: '.pip-container',
      };
      const elements = {};
      for (const [name, selector] of Object.entries(selectors)) {
        elements[name] = [...document.querySelectorAll(selector)].filter(visible).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            cls: String(el.className).slice(0, 80),
            label: el.getAttribute('aria-label') || undefined,
            box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            z: getComputedStyle(el).zIndex,
          };
        });
      }
      const state = window.APP?.store?.getState?.();
      const config = state?.['features/base/config'] ?? {};
      const keys = [
        'toolbarButtons',
        'toolbarConfig',
        'hiddenPremeetingButtons',
        'prejoinConfig',
        'filmstrip',
        'disableFilmstripAutohiding',
        'notifications',
        'hideConferenceSubject',
        'hideConferenceTimer',
        'hideParticipantsStats',
        'hideDisplayName',
        'hideDominantSpeakerBadge',
        'disableTileView',
        'disableTileEnlargement',
        'disableSelfViewSettings',
        'disableShortcuts',
        'disableInviteFunctions',
        'disableProfile',
        'disableModeratorIndicator',
        'connectionIndicators',
        'remoteVideoMenu',
        'conferenceInfo',
        'participantsPane',
        'disableDeepLinking',
        'disableJoinLeaveSounds',
        'disabledSounds',
        'p2p',
        'startWithAudioMuted',
        'startWithVideoMuted',
      ];
      const iface = window.interfaceConfig ?? {};
      const ifaceKeys = [
        'SHOW_JITSI_WATERMARK',
        'SHOW_WATERMARK_FOR_GUESTS',
        'SHOW_BRAND_WATERMARK',
        'SHOW_POWERED_BY',
        'MOBILE_APP_PROMO',
        'HIDE_DEEP_LINKING_LOGO',
        'TOOLBAR_ALWAYS_VISIBLE',
        'TOOLBAR_TIMEOUT',
        'DISABLE_JOIN_LEAVE_NOTIFICATIONS',
        'DISABLE_FOCUS_INDICATOR',
        'DISABLE_DOMINANT_SPEAKER_INDICATOR',
        'DISABLE_PRESENCE_STATUS',
        'CONNECTION_INDICATOR_DISABLED',
        'VIDEO_QUALITY_LABEL_DISABLED',
        'VIDEO_LAYOUT_FIT',
        'FILM_STRIP_MAX_HEIGHT',
        'TILE_VIEW_MAX_COLUMNS',
        'VERTICAL_FILMSTRIP',
      ];
      return {
        url: location.href.split('#')[0],
        viewport: [innerWidth, innerHeight],
        version: window.JitsiMeetJS?.version,
        joined: !!window.APP?.conference?.isJoined?.(),
        participants: window.APP?.conference?.membersCount,
        p2p: !!window.APP?.conference?._room?.isP2PActive?.(),
        isMobileBrowser: state?.['features/base/environment']?.isMobile ?? undefined,
        toolboxVisible: state?.['features/toolbox']?.visible,
        filmstripVisible: state?.['features/filmstrip']?.visible,
        tileView: state?.['features/video-layout']?.tileViewEnabled,
        notificationsQueue: (state?.['features/notifications']?.notifications ?? []).map(
          (n) => n.props?.titleKey || n.props?.descriptionKey || n.uid,
        ),
        config: Object.fromEntries(keys.map((k) => [k, config[k]])),
        interfaceConfig: Object.fromEntries(ifaceKeys.map((k) => [k, iface[k]])),
        elements,
      };
    })
    .catch((error) => ({ error: String(error) }));

const jitsiFrame = (page) =>
  page
    .frames()
    .find(
      (frame) =>
        frame.url().startsWith(jitsiOrigin) &&
        !frame.url().includes('/__elise/') &&
        frame.url().includes('jitsi_meet_external_api_id'),
    );
const waitJoined = async (page, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const joined = await jitsiFrame(page)
      ?.evaluate(() => !!window.APP?.conference?.isJoined?.())
      .catch(() => false);
    if (joined) return true;
    await pause(500);
  }
  return false;
};
const waitParticipants = async (page, count, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const n = await jitsiFrame(page)
      ?.evaluate(() => window.APP?.conference?.membersCount ?? 0)
      .catch(() => 0);
    if (n >= count) return true;
    await pause(500);
  }
  return false;
};

const report = {};
const shot = async (page, name, variant) => {
  const file = `${phase}-${variant === 'current' ? '' : 'probe-hidden-'}${name}`;
  await page.screenshot({ path: path.join(out, `${file}.png`) });
  report[file] = await inspectJitsi(jitsiFrame(page));
  process.stdout.write(`captured ${file}.png\n`);
};

// ---------------------------------------------------------------------------------------------
// Mocked Elise API for the resident screen.
const routeResidentApi = async (context, call) => {
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
          language: 'fr',
        },
      });
    }
    if (/^screen-device\/calls\/[^/]+\/join$/.test(p))
      return route.fulfill({
        json: { url: jitsiOrigin, room: call.room, jwt: '', name: 'Écran de Jeanne' },
      });
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
};

const newContext = async (options, overrides, camera) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'fr-FR',
    ...options,
  });
  await context.grantPermissions(['camera', 'microphone']);
  await context.addInitScript(externalApiHook, { overrides });
  await context.addInitScript(labelledCamera, camera);
  return context;
};

const runVariant = async (variant) => {
  const probeFile = option('probe-json', '');
  // --probe-json <file> replaces the probe with {"config":{…},"interfaceConfig":{…}} to test one key.
  const overrides =
    variant === 'probe' ? (probeFile ? JSON.parse(readFileSync(probeFile, 'utf8')) : probe) : null;
  const room = `elisecalls${variant}${Date.now()}`;
  const call = {
    room,
    current: {
      id: `call-${variant}`,
      room,
      userId: 'paul',
      name: 'Paul',
      client: 'mobile',
      automatic: false,
      createdAt: Date.now(),
      acceptedAt: null,
      deadline: Date.now() + 120000,
    },
  };
  mobileState.join = { url: jitsiOrigin, room, jwt: '', name: 'Paul' };

  let tv;
  if (only !== 'mobile') {
    const context = await newContext({ viewport: { width: 1920, height: 1080 } }, overrides, {
      label: 'TV - Jeanne',
      color: '#8a5a2b',
    });
    await context.addInitScript(usbWebcamLabels);
    await context.addInitScript(() => localStorage.setItem('elise-screen-token', 'a'.repeat(64)));
    await routeResidentApi(context, call);
    tv = await context.newPage();
    tv.on('pageerror', (error) => process.stderr.write(`[tv] ${error.message}\n`));
    await tv.goto(`${dashboard}/resident-screen`);
    await tv.waitForSelector('.incoming-call-screen', { timeout: 30000 });
    await pause(1200);
    if (variant === 'current') await shot(tv, 'tv-01-incoming', variant);
    call.current = { ...call.current, acceptedAt: Date.now() };
    await tv.waitForFunction(() => document.querySelector('.elise-call iframe'), null, {
      timeout: 20000,
    });
    await pause(2500);
    await shot(tv, 'tv-02-connecting', variant);
    if (!(await waitJoined(tv))) process.stderr.write('[tv] never joined\n');
    await pause(4000);
    await shot(tv, 'tv-03-alone', variant);
  }

  const mobileRun = async (landscape) => {
    const tag = landscape ? 'mobile-landscape' : 'mobile-portrait';
    const context = await newContext(
      {
        viewport: landscape ? { width: 844, height: 390 } : { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: userAgents[mobileUa],
      },
      overrides,
      { label: 'Téléphone - Paul', color: '#2b6a8a' },
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => process.stderr.write(`[${tag}] ${error.message}\n`));
    await page.goto(`${jitsiOrigin}/__elise/mobile${landscape ? '?landscape=1' : ''}`);
    await pause(2500);
    await shot(page, `${tag}-01-connecting`, variant);
    if (!(await waitJoined(page))) process.stderr.write(`[${tag}] never joined\n`);
    if (tv) await waitParticipants(page, 2);
    await pause(5000);
    await shot(page, `${tag}-02-in-call`, variant);
    // The WebView document is served from the Jitsi origin (baseUrl), like the External API
    // iframe: check whether it can reach the conference directly (APP, DOM, CSS).
    report[`${phase}-${tag}-webview-same-origin`] = await page
      .frames()
      .find((frame) => frame.url().includes('/__elise/webview'))
      ?.evaluate(() => {
        try {
          const inner = document.querySelector('#meet iframe').contentWindow;
          return {
            app: !!inner.APP,
            joined: inner.APP.conference.isJoined(),
            canInjectCss: !!inner.document.head.appendChild(inner.document.createElement('style')),
          };
        } catch (error) {
          return { error: String(error) };
        }
      });
    if (tv && !landscape) await shot(tv, 'tv-04-in-call', variant);
    await page.click('#mic');
    await pause(2500);
    await shot(page, `${tag}-03-mic-muted`, variant);
    if (tv && !landscape) await shot(tv, 'tv-05-caller-muted', variant);
    await page.click('#mic');
    // A tap on the video wakes Jitsi's own mobile toolbox if it exists.
    const stage = await page.$('.stage');
    const box = await stage.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await pause(700);
    await shot(page, `${tag}-04-after-tap`, variant);
    await pause(8000);
    await shot(page, `${tag}-05-idle`, variant);
    await context.close();
    await pause(3000);
  };

  if (only !== 'tv') {
    await mobileRun(false);
    if (tv && variant === 'current') {
      // TV-side states while nobody is on the other side yet are already captured; now the TV
      // mutes itself the way its Jitsi toolbar does (toggle-audio).
      await tv.mouse.move(960, 540);
      await tv.mouse.move(980, 560);
      await pause(800);
      await shot(tv, 'tv-06-hover-toolbar', variant);
      await tv.evaluate(() => window.__eliseCallsApi?.executeCommand('toggleAudio'));
      await pause(2000);
      await shot(tv, 'tv-07-mic-muted', variant);
      await tv.evaluate(() => window.__eliseCallsApi?.executeCommand('toggleAudio'));
      await tv.mouse.move(10, 10);
      await pause(9000);
      await shot(tv, 'tv-08-idle', variant);
    }
    await mobileRun(true);
    if (tv) await shot(tv, 'tv-09-landscape-caller', variant);
  }
  if (tv) await tv.context().close();
};

try {
  const variants = variantOption === 'all' ? ['current', 'probe'] : [variantOption];
  for (const variant of variants) await runVariant(variant);
  await writeFile(
    path.join(out, `${phase}-${variantOption}-report.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`report: ${path.join(out, `${phase}-${variantOption}-report.json`)}\n`);
} finally {
  await cleanup();
}
