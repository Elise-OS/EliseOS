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
 * - TV: the real dashboard ResidentScreen + JitsiCall (Vite dev server); only the Elise API is
 *   mocked (heartbeat snapshot with an incoming then accepted call, join answer).
 * - Mobile: the WebView document is the real `callPage()` of apps/mobile/src/screen/callPage.ts
 *   (imported directly, Node strips its types), served from the Jitsi origin like the WebView
 *   baseUrl. The React Native chrome around it (full-screen video, top pill, one control bar) is
 *   an HTML copy of MobileCallOverlay.tsx: update `mobileShell()` below when the RN layout changes.
 *   The browser identifies as an Android WebView (Chromium) so Jitsi takes its mobile code path.
 *   With --only mobile, a plain Jitsi page filming "TV - Jeanne" plays the other person (waiting,
 *   in call, camera off, hang-up states).
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
const { initialScreenState } = contracts;

// Mobile WebView document: the real callPage() of apps/mobile/src/screen/callPage.ts (Node strips
// its types; it imports the built @elise/contracts).
const { callPage } = await import(
  new URL('../apps/mobile/src/screen/callPage.ts', import.meta.url).href
);

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

// A phone's WebView names its sound outputs (loudspeaker, earpiece): the fake ones get those names
// so the call screen offers its loudspeaker button like on a phone (mobile only).
const phoneAudioRoutes = () => {
  const original = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
  if (!original) return;
  const names = ['Speakerphone', 'Earpiece'];
  navigator.mediaDevices.enumerateDevices = async () => {
    let output = 0;
    return (await original())
      .filter((device) => device.kind !== 'audiooutput' || output < names.length)
      .map((device) => ({
        deviceId: device.deviceId,
        groupId: device.groupId,
        kind: device.kind,
        label: device.kind === 'audiooutput' ? names[output++] : device.label,
        toJSON() {
          return this;
        },
      }));
  };
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
// React Native chrome of MobileCallOverlay, copied in HTML (StyleSheet values 1:1, texts from the
// French catalog, safe areas of an iPhone 15): full-screen video, Élise pill on top, one control
// bar at the bottom that fades out after 5 s and comes back on a tap. Update with the RN layout.
const callTexts = JSON.parse(
  readFileSync(path.join(root, 'apps/mobile/src/i18n/locales/fr.json'), 'utf8'),
).mobileCallOverlay;
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
    'volume-high':
      '<path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    ear: '<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0M10 9a2 2 0 0 1 4 0"/>',
  })[name];
const mobileShell = ({ landscape }) => {
  const inset = landscape
    ? { top: 0, right: 59, bottom: 21, left: 59 }
    : { top: 59, right: 0, bottom: 34, left: 0 };
  const selfWidth = landscape ? 148 : 104;
  const control = (id, iconName, cls) =>
    `<button id="${id}" class="control"><span class="circle ${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon(iconName)}</svg></span><span class="label"></span></button>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#06192D;font-family:-apple-system,"SF Pro Text",Roboto,system-ui,sans-serif;overflow:hidden}
  #webview{position:absolute;inset:0;border:0;width:100%;height:100%;display:block;background:#06192D}
  #tap{position:absolute;inset:0}
  .fade{transition:opacity .3s}.fade.hidden{opacity:0;pointer-events:none}
  .avatar{display:flex;align-items:center;justify-content:center;border-radius:50%;background:#DCE9E5;color:#12385F;font-weight:800}
  .halo{display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(36,82,122,.55)}
  #center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:${landscape ? 0 : inset.top + 160}px 32px ${landscape ? 130 : 150}px;box-sizing:border-box;pointer-events:none;text-align:center}
  #center .title{margin-top:${landscape ? 16 : 26}px;color:#fff;font-size:${landscape ? 22 : 25}px;font-weight:800;text-shadow:0 0 8px rgba(0,0,0,.35)}
  #center .detail{max-width:${landscape ? 460 : 340}px;margin-top:${landscape ? 6 : 10}px;color:#D7E6E9;font-size:${landscape ? 15 : 17}px;line-height:${landscape ? 21 : 25}px}
  #center .notice{margin-top:18px;padding:8px 16px;border-radius:18px;color:#fff;font-size:16px;font-weight:700;background:rgba(8,27,48,.84)}
  .spinner{margin-top:24px;width:30px;height:30px;border-radius:50%;border:3px solid rgba(215,232,232,.25);border-top-color:#D7E8E8;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #top{position:absolute;top:${inset.top + 12}px;left:${inset.left + 14}px;right:${inset.right + selfWidth + 28}px;display:flex}
  .identity{display:flex;align-items:center;gap:12px;padding:6px 18px 6px 6px;border-radius:30px;background:rgba(8,27,48,.84);min-width:0}
  .identity .name{color:#fff;font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .identity .status{display:flex;align-items:center;gap:10px;margin-top:1px}
  .duration{color:#D7E6E9;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
  .bars{display:flex;align-items:flex-end;gap:2px;height:14px}.bars i{width:4px;border-radius:2px;background:rgba(255,255,255,.28)}
  #banner{position:absolute;top:${inset.top + (landscape ? 76 : 172)}px;left:${inset.left + 16}px;right:${inset.right + (landscape ? selfWidth + 28 : 16)}px;display:flex;justify-content:center;pointer-events:none}
  #banner>div{max-width:520px;min-height:48px;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:24px;background:#F5F0E8;color:#0B2948;font-size:15px;font-weight:700;line-height:20px}
  #bottom{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;
    padding:0 ${inset.right + 12}px ${Math.max(inset.bottom, 12) + (landscape ? 4 : 12)}px ${inset.left + 12}px}
  .controls{display:flex;align-items:flex-start;gap:6px;padding:14px 12px 10px;border-radius:36px;background:rgba(8,27,48,.84)}
  .control{width:80px;display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:0;padding:0;cursor:pointer}
  .control.disabled{opacity:.45}
  .circle{width:62px;height:62px;border-radius:31px;display:flex;align-items:center;justify-content:center}
  .circle svg{width:28px;height:28px}
  .on{background:rgba(255,255,255,.17);color:#fff}.off{background:#F5F0E8;color:#0B2948}.danger{background:#C8443F;color:#fff}
  .danger svg,.wide svg{transform:rotate(135deg)}
  .label{color:#F1F6F7;font-size:13px;font-weight:700;white-space:nowrap}
  .wide{min-height:62px;min-width:230px;padding:0 28px;border-radius:31px;border:0;display:flex;align-items:center;justify-content:center;gap:12px;background:#C8443F;color:#fff;font-size:18px;font-weight:800}
  .wide svg{width:24px;height:24px}
  #ended{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:0 ${landscape ? 64 : 32}px;background:#0B2948;
    flex-direction:${landscape ? 'row' : 'column'};gap:${landscape ? 36 : 0}px}
  #ended .copy{display:flex;flex-direction:column;align-items:${landscape ? 'flex-start' : 'center'};margin-top:${landscape ? 0 : 28}px;max-width:360px}
  #ended .t{color:#fff;font-size:25px;font-weight:800}
  #ended .d{margin-top:10px;color:#D7E6E9;font-size:17px;line-height:25px}
  #ended button{margin-top:26px;min-height:56px;min-width:150px;padding:0 24px;border-radius:28px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;font-size:17px;font-weight:800}
</style></head><body>
<iframe id="webview" src="/__elise/webview" allow="camera; microphone; autoplay; display-capture"></iframe>
<div id="tap"></div>
<div id="center"></div>
<div id="top" class="fade"><div class="identity"><span class="avatar" style="width:44px;height:44px;font-size:16px">JM</span>
  <div style="min-width:0"><div class="name">Jeanne Martin</div><div class="status"><span class="duration" id="duration">0:00</span><span class="bars" id="bars"><i style="height:6px"></i><i style="height:10px"></i><i style="height:14px"></i></span><span id="remoteMic"></span></div></div></div></div>
<div id="banner"></div>
<div id="bottom" class="fade">
  <div class="controls" id="controls">${control('mic', 'mic', 'on')}${control('cam', 'videocam', 'on')}${control('flip', 'camera-reverse', 'on')}${control('speaker', 'volume-high', 'on')}${control('hangup', 'call', 'danger')}</div>
  <button class="wide" id="wide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon('call')}</svg><span>${callTexts.hangUp}</span></button>
</div>
<div id="ended"><span class="halo" style="width:${landscape ? 84 : 154}px;height:${landscape ? 84 : 154}px"><span class="avatar" style="width:${landscape ? 84 : 120}px;height:${landscape ? 84 : 120}px;font-size:${landscape ? 30 : 43}px">JM</span></span>
  <div class="copy"><div class="t">${callTexts.callEnded}</div><div class="d" id="endedDetail"></div><button>${callTexts.close}</button></div></div>
<script>
  const T = ${JSON.stringify(callTexts)};
  const svg = ${JSON.stringify({ mic: icon('mic'), 'mic-off': icon('mic-off'), videocam: icon('videocam'), 'videocam-off': icon('videocam-off'), 'volume-high': icon('volume-high'), ear: icon('ear') })};
  const inset = ${JSON.stringify(inset)};
  const name = 'Jeanne Martin';
  const fill = (text) => text.replace(/{{residentName}}/g, name);
  const webview = document.getElementById('webview');
  const $ = (id) => document.getElementById(id);
  const s = { joined:false, remote:[], connectedAt:null, leftAt:null, audioMuted:null, videoMuted:null,
    remoteAudioMuted:false, remoteVideoMuted:false, remoteVideoPending:false, camSwitch:false, speakerSwitch:false, speaker:null, interrupted:false, quality:null, messages:[],
    shown:true, touchedAt:Date.now(), endedAt:null };
  window.__eliseShell = s;
  const fmt = (sec) => { sec=Math.max(0,Math.floor(sec)); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); };
  function phase(){
    if (s.leftAt && Date.now()-s.leftAt >= 4000) return 'ended';
    if (s.interrupted || s.leftAt) return 'reconnecting';
    if (!s.joined) return 'connecting';
    return s.remote.length ? 'in-call' : 'waiting';
  }
  function avatarBlock(size, halo){
    const a='<span class="avatar" style="width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*.36)+'px">JM</span>';
    if(!halo) return a; const h=Math.round(size*1.28);
    return '<span class="halo" style="width:'+h+'px;height:'+h+'px">'+a+'</span>';
  }
  function paint(){
    const p = phase();
    const landscape = innerWidth > innerHeight;
    if (p === 'ended') { if(!s.endedAt) s.endedAt=s.leftAt; $('ended').style.display='flex';
      $('endedDetail').textContent = 'Avec '+name+' · '+fmt((s.endedAt-s.connectedAt)/1000); webview.style.visibility='hidden'; return; }
    const trouble = s.interrupted;
    const autoHide = p === 'in-call';
    if (!autoHide) s.shown = true;
    else if (s.shown && Date.now()-s.touchedAt > 5000) s.shown = false;
    $('top').classList.toggle('hidden', !s.shown);
    $('bottom').classList.toggle('hidden', !s.shown);
    $('top').style.display = p === 'in-call' || (p === 'reconnecting' && s.connectedAt) ? 'flex' : 'none';
    $('duration').textContent = p === 'reconnecting' && trouble ? T.reconnecting : s.connectedAt ? fmt((Date.now()-s.connectedAt)/1000) : '0:00';
    const level = s.quality == null ? null : s.quality < 10 ? 'poor' : s.quality < 30 ? 'fair' : 'good';
    const colors = { good:'#6FD39B', fair:'#F2B45C', poor:'#F0827C' };
    $('bars').style.display = level && p === 'in-call' ? 'flex' : 'none';
    [...$('bars').children].forEach((bar,i)=>{ bar.style.background = level && i < ({good:3,fair:2,poor:1})[level] ? colors[level] : 'rgba(255,255,255,.28)'; });
    $('remoteMic').innerHTML = s.remoteAudioMuted ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5C9A3" stroke-width="2.4" stroke-linecap="round">'+svg['mic-off']+'</svg>' : '';
    let center = '';
    if (p === 'in-call') { if (s.remoteVideoMuted) center = avatarBlock(landscape?72:120,false)+'<div class="notice">'+fill(T.remoteCameraOff)+'</div>';
      else if (s.remoteVideoPending) center = avatarBlock(landscape?72:120,false)+'<div class="spinner"></div>'; }
    else {
      const title = p === 'waiting' || (p === 'reconnecting' && !trouble) ? fill(T.waitingFor) : p === 'reconnecting' ? T.reconnecting : fill(T.callWith);
      const detail = p === 'reconnecting' && !trouble ? '' : p === 'waiting' ? T.waitingDetail : p === 'reconnecting' ? T.reconnectingDetail : T.connectingToTheVideoCall;
      center = avatarBlock(landscape?72:132,!landscape)+'<div class="title">'+title+'</div>'+(detail?'<div class="detail">'+detail+'</div>':'')+(landscape?'':'<div class="spinner"></div>');
    }
    if ($('center').dataset.html !== center) { $('center').innerHTML = center; $('center').dataset.html = center; }
    $('banner').innerHTML = p === 'reconnecting' && s.interrupted ? '<div>'+T.connectionLostBanner+'</div>' : '';
    $('controls').style.display = s.joined ? 'flex' : 'none';
    $('wide').style.display = s.joined ? 'none' : 'flex';
    const set=(id,off,iconOn,iconOff,label,offLabel)=>{ const c=document.querySelector('#'+id+' .circle'); c.className='circle '+(off?'off':'on');
      c.querySelector('svg').innerHTML=svg[off?iconOff:iconOn]; document.querySelector('#'+id+' .label').textContent=off?offLabel:label;
      document.getElementById(id).classList.toggle('disabled', (id==='mic'?s.audioMuted:s.videoMuted)===null); };
    set('mic',s.audioMuted===true,'mic','mic-off',T.microphone,T.microphoneOff);
    set('cam',s.videoMuted===true,'videocam','videocam-off',T.camera,T.cameraOff);
    $('flip').style.display = s.camSwitch ? 'flex' : 'none';
    document.querySelector('#flip .label').textContent = T.flip;
    $('speaker').style.display = s.speakerSwitch ? 'flex' : 'none';
    document.querySelector('#speaker .circle svg').innerHTML = svg[s.speaker===false ? 'ear' : 'volume-high'];
    document.querySelector('#speaker .label').textContent = s.speaker===false ? T.earpiece : T.speaker;
    document.querySelector('#hangup .label').textContent = T.hangUp;
    // controlSizes() of callSession.ts: every control on one row, circles never under 56 px.
    const count = 3 + (s.camSwitch ? 1 : 0) + (s.speakerSwitch ? 1 : 0);
    const width = Math.max(56, Math.min(80, Math.floor((innerWidth - inset.left - inset.right - 48 - 6 * (count - 1)) / count)));
    const circle = Math.max(56, Math.min(62, width - 4));
    document.querySelectorAll('.control').forEach((c)=>{ c.style.width = width+'px'; const k=c.querySelector('.circle'); k.style.width=k.style.height=circle+'px'; k.style.borderRadius=circle/2+'px'; });
    pushLayout();
  }
  // callStage() of callSession.ts: the video stage below the self-view and above the bar (upright),
  // beside the self-view (sideways).
  let lastLayout = '';
  function pushLayout(){
    const sideways = innerWidth > innerHeight;
    const barHeight = $('bottom').offsetHeight;
    const stage = sideways
      ? { top: inset.top, right: inset.right + 148 + 28, bottom: 0, left: inset.left }
      : { top: inset.top + 168, right: inset.right, bottom: Math.max(barHeight, inset.bottom) + 8, left: inset.left };
    const value = JSON.stringify({ top: inset.top, right: inset.right, stage });
    if (value === lastLayout || !webview.contentWindow.__eliseCall) return;
    lastLayout = value;
    call('layout', JSON.parse(value));
  }
  setInterval(paint, 250);
  window.addEventListener('message',(e)=>{
    if(!e.data||typeof e.data.elise!=='string')return;
    let m; try { m = JSON.parse(e.data.elise); } catch { return; }
    s.messages.push(m.type);
    if(m.type==='joined') { s.joined=true; s.joinedAt=s.joinedAt||Date.now(); }
    if(m.type==='left') { s.joined=false; if(s.connectedAt) s.leftAt=s.leftAt||Date.now(); }
    if(m.type==='media'){ s.audioMuted=m.audioMuted; s.videoMuted=m.videoMuted; }
    if(m.type==='remote'){ s.remote=m.ids; s.remoteAudioMuted=m.audioMuted; s.remoteVideoMuted=m.videoMuted; s.remoteVideoPending=!!m.videoPending;
      if(m.ids.length){ s.connectedAt=s.connectedAt||Date.now(); s.leftAt=null; } else if(s.connectedAt) s.leftAt=s.leftAt||Date.now(); }
    if(m.type==='participant-joined' && !s.remote.includes(m.id)){ s.remote=[...s.remote,m.id]; s.connectedAt=s.connectedAt||Date.now(); s.leftAt=null; }
    if(m.type==='participant-left'){ s.remote=s.remote.filter((id)=>id!==m.id); if(!s.remote.length&&s.connectedAt) s.leftAt=s.leftAt||Date.now(); }
    if(m.type==='camera-switch') s.camSwitch=m.available;
    if(m.type==='audio-output'){ s.speakerSwitch=m.available; s.speaker=m.available?m.speaker:null; }
    if(m.type==='interrupted') s.interrupted=true; if(m.type==='restored') s.interrupted=false;
    if(m.type==='quality') s.quality=m.quality;
    paint();
  });
  // Same calls as webViewRef.injectJavaScript(...) in MobileCallOverlay.
  const call = (name, arg) => webview.contentWindow.__eliseCall && webview.contentWindow.__eliseCall[name](arg);
  webview.addEventListener('load', () => { lastLayout = ''; pushLayout(); });
  const touch = () => { s.touchedAt = Date.now(); };
  $('mic').onclick=()=>{ touch(); call('toggleAudio'); };
  $('cam').onclick=()=>{ touch(); call('toggleVideo'); };
  $('flip').onclick=()=>{ touch(); call('switchCamera'); };
  $('speaker').onclick=()=>{ touch(); call('switchSpeaker'); };
  $('hangup').onclick=()=>call('hangup');
  $('wide').onclick=()=>call('hangup');
  $('tap').onclick=()=>{ s.shown = phase()==='in-call' ? !s.shown : true; touch(); paint(); };
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
if (!dashboard && only !== 'mobile') {
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
const waitJoinedTop = async (page, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => !!window.APP?.conference?.isJoined?.()).catch(() => false))
      return true;
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
    await tv.waitForFunction(() => document.querySelector('.call__jitsi iframe'), null, {
      timeout: 20000,
    });
    await pause(2500);
    await shot(tv, 'tv-02-connecting', variant);
    if (!(await waitJoined(tv))) process.stderr.write('[tv] never joined\n');
    await pause(4000);
    await shot(tv, 'tv-03-alone', variant);
  }

  // Stand-in for the TV when the dashboard is not run (--only mobile): plain Jitsi page.
  const joinRemote = async () => {
    const context = await newContext({ viewport: { width: 1280, height: 720 } }, null, {
      label: 'TV - Jeanne',
      color: '#8a5a2b',
    });
    const remote = await context.newPage();
    const hash = [
      'config.prejoinConfig.enabled=false',
      'config.startWithAudioMuted=false',
      'config.startWithVideoMuted=false',
      // Like the TV (eliseCallConfig): direct peer-to-peer link between the two participants.
      'config.p2p.enabled=true',
      `config.p2p.stunServers=${encodeURIComponent('[]')}`,
      `userInfo.displayName=${encodeURIComponent('"Écran de Jeanne"')}`,
    ].join('&');
    await remote.goto(`${jitsiOrigin}/${mobileState.join.room}#${hash}`);
    if (!(await waitJoinedTop(remote))) process.stderr.write('[remote] never joined\n');
    // A page opened without any user gesture joins muted: switch both on like the TV does.
    await remote.evaluate(() => {
      window.APP.conference.muteAudio(false);
      window.APP.conference.muteVideo(false);
    });
    return remote;
  };

  // Runs fn inside the Jitsi frame of the mobile WebView document (same origin).
  const inJitsi = (page, fn, arg) =>
    page
      .frames()
      .find((frame) => frame.url().includes('/__elise/webview'))
      ?.evaluate(
        ({ source, value }) => {
          const inner = document.querySelector('#meet iframe')?.contentWindow;
          return inner
            ? new Function('win', 'arg', `return (${source})(win, arg);`)(inner, value)
            : null;
        },
        { source: fn.toString(), value: arg },
      );
  // Media statistics of the active peer connection (P2P or bridge), two samples `ms` apart.
  const callStats = async (page, ms = 5000) => {
    const sample = () =>
      inJitsi(page, async (win) => {
        const room = win.APP?.conference?._room;
        const tpc = room?.getActivePeerConnection?.();
        const pc = tpc?.peerconnection;
        if (!pc) return null;
        const result = {
          at: performance.now(),
          p2p: room.isP2PActive?.() ?? null,
          inbound: {},
          outbound: {},
        };
        (await pc.getStats()).forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind)
            result.inbound[report.kind] = {
              bytes: report.bytesReceived,
              packets: report.packetsReceived,
              lost: report.packetsLost,
              fps: report.framesPerSecond ?? null,
              width: report.frameWidth ?? null,
              height: report.frameHeight ?? null,
              jitter: report.jitter ?? null,
            };
          if (report.type === 'outbound-rtp' && report.kind)
            result.outbound[report.kind] = { bytes: report.bytesSent, packets: report.packetsSent };
          if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded')
            result.rtt = report.currentRoundTripTime ?? null;
        });
        return result;
      });
    const first = await sample();
    await pause(ms);
    const second = await sample();
    if (!first || !second) return null;
    const seconds = (second.at - first.at) / 1000;
    const kbps = (a, b) => (a && b ? Math.round(((b.bytes - a.bytes) * 8) / seconds / 1000) : null);
    const loss = (a, b) => {
      if (!a || !b) return null;
      const lost = (b.lost ?? 0) - (a.lost ?? 0);
      const received = b.packets - a.packets;
      return received + lost > 0 ? Math.round((lost / (received + lost)) * 10000) / 100 : 0;
    };
    return {
      p2p: second.p2p,
      rttMs: second.rtt == null ? null : Math.round(second.rtt * 1000),
      videoInKbps: kbps(first.inbound.video, second.inbound.video),
      audioInKbps: kbps(first.inbound.audio, second.inbound.audio),
      videoOutKbps: kbps(first.outbound.video, second.outbound.video),
      videoLossPercent: loss(first.inbound.video, second.inbound.video),
      audioLossPercent: loss(first.inbound.audio, second.inbound.audio),
      videoFps: second.inbound.video?.fps ?? null,
      videoSize: second.inbound.video?.width
        ? `${second.inbound.video.width}x${second.inbound.video.height}`
        : null,
      jitterMs:
        second.inbound.video?.jitter == null
          ? null
          : Math.round(second.inbound.video.jitter * 1000),
    };
  };
  const firstRemoteFrame = (page) =>
    inJitsi(page, (win) => {
      const video = win.document.getElementById('largeVideo');
      return (
        !win.document.documentElement.classList.contains('elise-alone') &&
        !!video &&
        video.videoWidth > 0 &&
        video.readyState >= 2
      );
    });

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
    await context.addInitScript(phoneAudioRoutes);
    const page = await context.newPage();
    page.on('pageerror', (error) => process.stderr.write(`[${tag}] ${error.message}\n`));
    let step = 0;
    const capture = (name) =>
      shot(page, `${tag}-${String(++step).padStart(2, '0')}-${name}`, variant);
    const metrics = { phase, tag };
    await page.goto(`${jitsiOrigin}/__elise/mobile${landscape ? '?landscape=1' : ''}`);
    await pause(2500);
    await capture('connecting');
    if (!(await waitJoined(page))) process.stderr.write(`[${tag}] never joined\n`);
    // From opening the call screen to this phone being in the Jitsi room.
    metrics.joinMs = await page.evaluate(() =>
      Math.round(window.__eliseShell.joinedAt - performance.timeOrigin),
    );
    let remote = null;
    if (!tv) {
      await pause(4000);
      await capture('waiting');
      remote = await joinRemote();
    }
    const otherJoiningAt = Date.now();
    await waitParticipants(page, 2);
    metrics.otherSeenMs = Date.now() - otherJoiningAt;
    // Time to the other person's first picture on the phone (from the moment they join).
    for (let tries = 0; tries < 100 && !metrics.firstFrameMs; tries += 1) {
      if (await firstRemoteFrame(page).catch(() => false))
        metrics.firstFrameMs = Date.now() - otherJoiningAt;
      else await pause(100);
    }
    await pause(1200);
    if (!tv) await capture('video-arriving');
    await pause(4000);
    // Like a tap: the bar may already have faded out while the other person was joining.
    const reveal = () =>
      page.evaluate(() => {
        window.__eliseShell.shown = true;
        window.__eliseShell.touchedAt = Date.now();
      });
    await reveal();
    await pause(400);
    await capture('in-call');
    metrics.stats = await callStats(page).catch((error) => ({ error: String(error) }));
    report[`${phase}-${tag}-metrics`] = metrics;
    process.stdout.write(`metrics ${tag} ${JSON.stringify(metrics)}\n`);
    await reveal();
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
            canInjectCss: !!inner.document.getElementById('elise-ui'),
            selfView: !!inner.document.querySelector('#elise-self video')?.srcObject,
            tracks: (inner.APP.store.getState()['features/base/tracks'] || []).map((track) => ({
              local: track.local,
              mediaType: track.mediaType,
              muted: track.muted,
              participantId: track.participantId,
            })),
          };
        } catch (error) {
          return { error: String(error) };
        }
      });
    report[`${phase}-${tag}-shell`] = await page.evaluate(() => window.__eliseShell?.messages);
    if (tv && !landscape) await shot(tv, 'tv-04-in-call', variant);
    await reveal();
    await page.click('#mic');
    await pause(2000);
    await capture('mic-muted');
    if (tv && !landscape) await shot(tv, 'tv-05-caller-muted', variant);
    await reveal();
    await page.click('#mic');
    await pause(6500);
    await capture('controls-hidden');
    // A tap on the video brings the Élise bar back (and must not wake any Jitsi toolbox).
    await page.touchscreen.tap(page.viewportSize().width / 2, page.viewportSize().height / 2);
    await pause(700);
    await capture('after-tap');
    // Loudspeaker -> earpiece -> loudspeaker (setAudioOutputDevice through the External API).
    if (await page.isVisible('#speaker')) {
      await reveal();
      await page.click('#speaker');
      await pause(1500);
      report[`${phase}-${tag}-speaker-after-switch`] = await page.evaluate(
        () => window.__eliseShell.speaker,
      );
      await capture('earpiece');
      await page.click('#speaker');
      await pause(1500);
    }
    if (remote) {
      await remote.evaluate(() => window.APP?.conference?.muteVideo?.(true));
      await remote.evaluate(() => window.APP?.conference?.muteAudio?.(true));
      await pause(2500);
      await capture('remote-camera-off');
      await remote.evaluate(() => window.APP?.conference?.hangup?.(false));
      await pause(1500);
      await capture('remote-left');
      await pause(4000);
      await capture('ended');
      await remote.context().close();
    }
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
