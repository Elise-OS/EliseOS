/**
 * Jitsi settings shared by every Élise call client (resident TV, dashboard and mobile).
 *
 * Calls have two participants and normally travel peer-to-peer over Tailscale/LAN host
 * candidates. No public STUN/TURN service is needed: when a direct route is unavailable Jitsi
 * falls back to the box's bridge, advertised on its Tailscale address and UDP 10000.
 *
 * P2P sends one 720p stream. Simulcast is left available for the bridge fallback so bandwidth
 * estimation can select 720p, 480p or 360p without renegotiating the camera. VP8 stays first for
 * Raspberry Pi software encoding; H264 is retained for devices with hardware support.
 */
export const ELISE_CALL_MAX_HEIGHT = 720;
export const ELISE_CALL_MAX_WIDTH = 1280;
export const ELISE_CALL_MAX_FPS = 24;
export const ELISE_CALL_LOW_HEIGHT = 360;
export const ELISE_CALL_STANDARD_HEIGHT = 480;
const CODECS = ['VP8', 'H264'];

export const eliseCallConfig = {
  prejoinConfig: { enabled: false },
  welcomePage: { disabled: true },
  disableDeepLinking: true,
  disableChat: true,
  disableReactions: true,
  disablePolls: true,
  feedbackPercentage: 0,
  recordingService: { enabled: false, sharingEnabled: false },
  localRecording: { disable: true, disableSelfRecording: true, notifyAllParticipants: false },
  liveStreaming: { enabled: false },
  transcription: { enabled: false },
  lobby: { autoKnock: false, enableChat: false },
  securityUi: { hideLobbyButton: true, disableLobbyPassword: true },
  hideAddRoomButton: true,
  p2p: {
    enabled: true,
    // Private Tailscale/LAN host candidates only; the JVB is the controlled fallback.
    stunServers: [],
    iceTransportPolicy: 'all',
    codecPreferenceOrder: CODECS,
    mobileCodecPreferenceOrder: CODECS,
  },
  // Jitsi does not simulcast in P2P. These layers are only produced on JVB fallback.
  disableSimulcast: false,
  enableLayerSuspension: true,
  // The pinned Jitsi build reconnects its XMPP/media sessions after network changes. This also
  // permits its guarded full-page fallback when a bridge session itself has to be restarted.
  enableForcedReload: true,
  resolution: ELISE_CALL_MAX_HEIGHT,
  constraints: {
    video: {
      width: { ideal: ELISE_CALL_MAX_WIDTH, max: ELISE_CALL_MAX_WIDTH, min: 320 },
      height: { ideal: ELISE_CALL_MAX_HEIGHT, max: ELISE_CALL_MAX_HEIGHT, min: 180 },
      frameRate: { ideal: ELISE_CALL_MAX_FPS, max: ELISE_CALL_MAX_FPS, min: 12 },
    },
  },
  videoQuality: {
    codecPreferenceOrder: CODECS,
    mobileCodecPreferenceOrder: CODECS,
    enableAdaptiveMode: true,
    minHeightForQualityLvl: {
      [ELISE_CALL_LOW_HEIGHT]: 'low',
      [ELISE_CALL_STANDARD_HEIGHT]: 'standard',
      [ELISE_CALL_MAX_HEIGHT]: 'high',
    },
    vp8: { maxBitratesVideo: { low: 180000, standard: 500000, high: 1200000 } },
    h264: { maxBitratesVideo: { low: 180000, standard: 500000, high: 1200000 } },
  },
  // Keep browser echo cancellation/noise processing/AGC, but not the continuous UI analysers.
  disableAP: false,
  disableAEC: false,
  disableAGC: false,
  disableNS: false,
  disableAudioLevels: true,
  enableNoisyMicDetection: false,
  enableNoAudioDetection: false,
  enableTalkWhileMuted: false,
  enableOpusRed: true,
  channelLastN: 1,
  startLastN: 1,
  audioQuality: { stereo: false },
  disableThirdPartyRequests: true,
  hideConferenceSubject: true,
  hideConferenceTimer: true,
  hideParticipantsStats: true,
  disableSelfViewSettings: true,
  notifications: [],
  disableJoinLeaveSounds: true,
} as const;

/** Mobile draws its own call controls: Jitsi only shows the two videos. */
export const eliseMobileCallConfig = {
  ...eliseCallConfig,
  toolbarButtons: [],
  toolbarConfig: { alwaysVisible: false, autoHideWhileChatIsOpen: true },
  connectionIndicators: { disabled: true },
  remoteVideoMenu: { disabled: true },
  disableTileView: true,
  filmstrip: { disableResizable: true, disableStageFilmstrip: true },
} as const;

export const eliseMobileCallInterfaceConfig = {
  SHOW_JITSI_WATERMARK: false,
  SHOW_WATERMARK_FOR_GUESTS: false,
  SHOW_BRAND_WATERMARK: false,
  MOBILE_APP_PROMO: false,
  DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
  DISABLE_FOCUS_INDICATOR: true,
  DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
  HIDE_INVITE_MORE_HEADER: true,
  VERTICAL_FILMSTRIP: true,
  FILM_STRIP_MAX_HEIGHT: 120,
  TILE_VIEW_MAX_COLUMNS: 1,
} as const;
