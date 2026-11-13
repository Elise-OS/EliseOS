/**
 * Jitsi user interface settings for Élise calls: Élise draws its own single call bar (resident
 * TV, caregiver web window), so every piece of Jitsi's interface is switched off and the iframe
 * only shows the other person's video.
 *
 * Only interface keys live here; network and video quality settings stay in `call-quality.ts`.
 * Checked against the pinned Jitsi web image (stable-10978): each key below is accepted in the
 * External API overrides and hides what its comment says. The Jitsi watermark and app promo
 * cannot be overridden by the External API on that version: the server switches them off
 * (`docker/jitsi/custom-interface_config.js`).
 */
export const eliseCallUiConfig = {
  // No Jitsi toolbar, prejoin page, filmstrip, tile view or self-view settings.
  toolbarButtons: [],
  toolbarConfig: { alwaysVisible: false, timeout: 0 },
  prejoinConfig: { enabled: false },
  hiddenPremeetingButtons: ['microphone', 'camera', 'select-background', 'invite', 'settings'],
  filmstrip: { disabled: true, disableResizable: true, disableStageFilmstrip: true },
  disableTileView: true,
  disableTileEnlargement: true,
  disableSelfViewSettings: true,
  // No subject, timer, quality gauge, names, badges, indicators or menus over the video.
  conferenceInfo: { alwaysVisible: [], autoHide: [] },
  hideConferenceSubject: true,
  hideConferenceTimer: true,
  hideParticipantsStats: true,
  hideDisplayName: true,
  hideDominantSpeakerBadge: true,
  disableModeratorIndicator: true,
  connectionIndicators: { disabled: true },
  remoteVideoMenu: { disabled: true },
  participantsPane: { enabled: false },
  // Nothing pops up and no keyboard shortcut reaches Jitsi (the TV remote drives Élise).
  notifications: [],
  disableJoinLeaveSounds: true,
  disableIncomingMessageSound: true,
  disableShortcuts: true,
  disableInviteFunctions: true,
  disableProfile: true,
  disableReactions: true,
  disablePolls: true,
  disableDeepLinking: true,
} as const;

export const eliseCallUiInterfaceConfig = {
  // The whole picture of the other person, never cropped to fill the screen.
  VIDEO_LAYOUT_FIT: 'nocrop',
  TOOLBAR_ALWAYS_VISIBLE: false,
  DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
  DISABLE_FOCUS_INDICATOR: true,
  DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
  DISABLE_PRESENCE_STATUS: true,
  DISABLE_VIDEO_BACKGROUND: true,
  CONNECTION_INDICATOR_DISABLED: true,
  VIDEO_QUALITY_LABEL_DISABLED: true,
  // Ignored by this Jitsi version in overrides (the server sets them), kept for newer ones.
  SHOW_JITSI_WATERMARK: false,
  SHOW_WATERMARK_FOR_GUESTS: false,
  SHOW_BRAND_WATERMARK: false,
  SHOW_POWERED_BY: false,
  MOBILE_APP_PROMO: false,
} as const;

/** Commands Élise sends to the Jitsi iframe (`api.executeCommand`). */
export const ELISE_CALL_COMMANDS = {
  toggleAudio: 'toggleAudio',
  toggleVideo: 'toggleVideo',
  hangup: 'hangup',
} as const;

/** External API events the Élise call bar listens to. */
export const ELISE_CALL_EVENTS = [
  'videoConferenceJoined',
  'videoConferenceLeft',
  'readyToClose',
  'participantJoined',
  'participantLeft',
  'audioMuteStatusChanged',
  'videoMuteStatusChanged',
  'audioAvailabilityChanged',
  'videoAvailabilityChanged',
  'cameraError',
  'micError',
  'errorOccurred',
  'peerConnectionFailure',
  'suspendDetected',
  'p2pStatusChanged',
] as const;
export type EliseCallEvent = (typeof ELISE_CALL_EVENTS)[number];
