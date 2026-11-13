/**
 * Jitsi settings shared by every Élise call client (resident TV, caregiver dashboard, mobile).
 *
 * The box is a Raspberry Pi 4: it has no AES instructions, so the video bridge spends most of
 * its CPU decrypting and re-encrypting media, and the TV's Chromium encodes video in software.
 * Calls always have two participants, so:
 * - peer-to-peer is on: TV and phone talk directly over the private Tailscale network and the
 *   bridge only carries the call while that link is being set up (or if it cannot be set up);
 * - no STUN server: only private addresses are offered, nothing leaves for a third party;
 * - simulcast is off and the picture is capped at 640x480 / 20 fps, the webcam's native mode:
 *   Chromium neither decodes 720p MJPEG nor rescales it, and encodes one small stream;
 * - VP8 first: AV1 and VP9 (Jitsi's defaults) cost several times more CPU to encode in
 *   software, and the Pi has no hardware encoder Chromium can use;
 * - adaptive mode lets Jitsi lower the outgoing quality by itself when the CPU is overused.
 */
export const ELISE_CALL_MAX_HEIGHT = 480;
export const ELISE_CALL_MAX_WIDTH = 640;
export const ELISE_CALL_MAX_FPS = 20;
const CODECS = ['VP8', 'H264', 'VP9'];

export const eliseCallConfig = {
  prejoinConfig: { enabled: false },
  disableDeepLinking: true,
  p2p: {
    enabled: true,
    stunServers: [],
    iceTransportPolicy: 'all',
    codecPreferenceOrder: CODECS,
    mobileCodecPreferenceOrder: CODECS,
  },
  disableSimulcast: true,
  enableLayerSuspension: true,
  resolution: ELISE_CALL_MAX_HEIGHT,
  constraints: {
    video: {
      width: { ideal: ELISE_CALL_MAX_WIDTH, max: 854 },
      height: { ideal: ELISE_CALL_MAX_HEIGHT, max: ELISE_CALL_MAX_HEIGHT, min: 180 },
      frameRate: { ideal: ELISE_CALL_MAX_FPS, max: ELISE_CALL_MAX_FPS },
    },
  },
  videoQuality: {
    codecPreferenceOrder: CODECS,
    mobileCodecPreferenceOrder: CODECS,
    enableAdaptiveMode: true,
    maxBitratesVideo: {
      VP8: { low: 200000, standard: 500000, high: 900000 },
      VP9: { low: 100000, standard: 300000, high: 700000 },
      H264: { low: 200000, standard: 500000, high: 900000 },
    },
  },
  // Audio level meters and noise detection run continuously and cost CPU on the Pi.
  disableAudioLevels: true,
  enableNoisyMicDetection: false,
  enableNoAudioDetection: false,
  enableTalkWhileMuted: false,
  channelLastN: 1,
  audioQuality: { stereo: false },
  disableReactions: true,
  disablePolls: true,
  hideConferenceSubject: true,
  hideConferenceTimer: true,
  hideParticipantsStats: true,
  disableSelfViewSettings: true,
  notifications: [],
  disableJoinLeaveSounds: true,
} as const;

export type CallNetworkLevel = 'good' | 'fair' | 'poor' | 'unknown';

/**
 * Network level shown to the family from Jitsi's connection statistics: `quality` is Jitsi's
 * connection quality in percent (the lowest of both sides), `packetLoss` the total loss in percent.
 * Thresholds follow Jitsi's own indicator (30 % and above is good, under 10 % is lost).
 */
export function callNetworkLevel({
  quality,
  packetLoss,
}: {
  quality?: number | null;
  packetLoss?: number | null;
}): CallNetworkLevel {
  const hasQuality = typeof quality === 'number' && Number.isFinite(quality);
  const hasLoss = typeof packetLoss === 'number' && Number.isFinite(packetLoss);
  if (!hasQuality && !hasLoss) return 'unknown';
  const percent = hasQuality ? quality : 100;
  const loss = hasLoss ? packetLoss : 0;
  if (percent < 10 || loss >= 10) return 'poor';
  if (percent < 30 || loss >= 4) return 'fair';
  return 'good';
}
