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

/**
 * Mobile draws the whole call screen itself (one Élise control bar, its own self-view): Jitsi only
 * renders the remote video. Every key below only hides Jitsi UI; they were checked one by one on
 * the deployed Jitsi (stable-10978). What config cannot hide (the "jitsi" watermark, which ignores
 * SHOW_JITSI_WATERMARK on this version) is hidden by CSS injected in the mobile WebView.
 */
export const eliseMobileCallConfig = {
  ...eliseCallConfig,
  toolbarButtons: [],
  toolbarConfig: { alwaysVisible: false, timeout: 0, autoHideWhileChatIsOpen: true },
  hiddenPremeetingButtons: ['microphone', 'camera', 'select-background', 'invite', 'settings'],
  // No filmstrip at all: the app draws the self-view, and no thumbnail duplicates the big video.
  filmstrip: { disabled: true, disableResizable: true, disableStageFilmstrip: true },
  disableTileView: true,
  disableTileEnlargement: true,
  conferenceInfo: { alwaysVisible: [], autoHide: [] },
  hideDisplayName: true,
  hideDominantSpeakerBadge: true,
  disableModeratorIndicator: true,
  connectionIndicators: { disabled: true },
  remoteVideoMenu: { disabled: true },
  participantsPane: { enabled: false },
  disableShortcuts: true,
  disableInviteFunctions: true,
  disableProfile: true,
  disableIncomingMessageSound: true,
  disabledSounds: [
    'ASKED_TO_UNMUTE_SOUND',
    'INCOMING_MSG_SOUND',
    'KNOCKING_PARTICIPANT_SOUND',
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
    'TALK_WHILE_MUTED_SOUND',
  ],
} as const;

export const eliseMobileCallInterfaceConfig = {
  // Ignored by stable-10978 (not whitelisted): kept for servers that honour them.
  SHOW_JITSI_WATERMARK: false,
  SHOW_WATERMARK_FOR_GUESTS: false,
  SHOW_BRAND_WATERMARK: false,
  MOBILE_APP_PROMO: false,
  TOOLBAR_ALWAYS_VISIBLE: false,
  DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
  DISABLE_FOCUS_INDICATOR: true,
  DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
  DISABLE_PRESENCE_STATUS: true,
  DISABLE_VIDEO_BACKGROUND: true,
  CONNECTION_INDICATOR_DISABLED: true,
  VIDEO_QUALITY_LABEL_DISABLED: true,
  // The whole picture of the other person, never cropped (bands rather than a cut forehead).
  VIDEO_LAYOUT_FIT: 'nocrop',
  HIDE_INVITE_MORE_HEADER: true,
  TILE_VIEW_MAX_COLUMNS: 1,
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
