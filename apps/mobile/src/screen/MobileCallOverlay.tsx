import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import type { ScreenJoin } from '@elise/contracts';
import { StatusBar } from 'expo-status-bar';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { type Language, t } from '../i18n';
import { callPage } from './callPage';
import {
  type CallAction,
  type CallFailure,
  type CallPhase,
  type CallState,
  callPhase,
  failureMessageKey,
  formatCallDuration,
  initialCallState,
  initials,
  nextDeadline,
  parseCallMessage,
  reduceCall,
} from './callSession';

/** How the call ended, for the caller (no "could not end the call" alert when the TV hung up). */
export type MobileCallEnd = 'hangup' | 'remote-ended' | 'failed';

interface MobileCallOverlayProps {
  visible: boolean;
  residentName: string;
  locale: Language;
  accepted: boolean;
  join: ScreenJoin | null;
  error: string;
  onEnd: (reason: MobileCallEnd) => void | Promise<void>;
  /** Asks the server for a new seat in the call (after a failed join). */
  onRetry?: () => void;
}

const CONTROLS_HIDE_MS = 5000;
const ENDED_CLOSE_MS = 2600;
const HANGUP_TIMEOUT_MS = 2000;

type SessionAction =
  { kind: 'call'; action: CallAction; now: number } | { kind: 'reset'; keepConnectedAt: boolean };

const sessionReducer = (state: CallState, event: SessionAction): CallState =>
  event.kind === 'reset'
    ? {
        ...initialCallState,
        offline: state.offline,
        connectedAt: event.keepConnectedAt ? state.connectedAt : null,
      }
    : reduceCall(state, event.action, event.now);

const inject = (webView: WebView | null, code: string) =>
  webView?.injectJavaScript(`try{${code}}catch(e){}true;`);

export function MobileCallOverlay({
  visible,
  residentName,
  accepted,
  join,
  error,
  onEnd,
  onRetry,
}: MobileCallOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [call, dispatchSession] = useReducer(sessionReducer, initialCallState);
  const dispatch = useCallback(
    (action: CallAction) => dispatchSession({ kind: 'call', action, now: Date.now() }),
    [],
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [hangingUp, setHangingUp] = useState(false);
  const [lingering, setLingering] = useState(false);
  const [endedSeconds, setEndedSeconds] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [controlsShown, setControlsShown] = useState(true);
  const [controlsTouch, setControlsTouch] = useState(0);
  const [screenReader, setScreenReader] = useState(false);
  const ended = useRef(false);
  const hangingUpRef = useRef(false);
  const crashes = useRef(0);
  const webViewRef = useRef<WebView>(null);
  const source = useMemo(() => (join ? callPage(join) : null), [join]);
  const privateVideoServer = join ? new URL(join.url).hostname.endsWith('.ts.net') : false;

  const phase: CallPhase = lingering
    ? 'ended'
    : callPhase(call, { accepted, hasJoin: Boolean(source), error: Boolean(error) }, now);
  const phaseStartedAt = useRef(Date.now());
  const lastPhase = useRef(phase);
  if (lastPhase.current !== phase) {
    lastPhase.current = phase;
    phaseStartedAt.current = Date.now();
  }

  const finish = useCallback(
    (reason: MobileCallEnd) => {
      if (ended.current) return;
      ended.current = true;
      void onEnd(reason);
    },
    [onEnd],
  );

  const resetSession = useCallback((keepConnectedAt: boolean) => {
    dispatchSession({ kind: 'reset', keepConnectedAt });
    setReloadKey((key) => key + 1);
  }, []);

  // A new call (or the overlay opening again) starts from a clean state.
  useEffect(() => {
    if (!visible) return;
    dispatchSession({ kind: 'reset', keepConnectedAt: false });
    setHangingUp(false);
    hangingUpRef.current = false;
    setLingering(false);
    setEndedSeconds(null);
    setControlsShown(true);
    crashes.current = 0;
    ended.current = false;
  }, [join?.jwt, visible]);

  // The server ended the call (the TV hung up) while we were talking: say so before closing.
  const wasVisible = useRef(visible);
  const connectedAt = call.connectedAt;
  useEffect(() => {
    const closing = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closing || ended.current || connectedAt === null) return;
    ended.current = true;
    setEndedSeconds((Date.now() - connectedAt) / 1000);
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), ENDED_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [visible, connectedAt]);

  // The phone's own network: a clear banner rather than a frozen picture.
  useEffect(() => {
    if (!visible) return;
    return NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      dispatch({ type: 'network', online });
    });
  }, [dispatch, visible]);

  // Back from the background: the page reports Jitsi's real state again.
  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      inject(webViewRef.current, 'window.__eliseCall&&window.__eliseCall.sync();');
      setControlsShown(true);
    });
    return () => subscription.remove();
  }, [visible]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (mounted) setScreenReader(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Clock of the call: only once the other person is there.
  useEffect(() => {
    if (!visible || call.connectedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call.connectedAt, visible]);

  // Grace periods and timeouts: never wait forever on a spinner.
  useEffect(() => {
    if (!visible || lingering || hangingUp) return;
    const deadline = nextDeadline(call, phase, { phaseStartedAt: phaseStartedAt.current });
    if (!deadline) return;
    const timer = setTimeout(
      () => {
        if (deadline.failure) dispatch({ type: 'fail', failure: deadline.failure });
        setNow(Date.now());
      },
      Math.max(0, deadline.at - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [call, dispatch, hangingUp, lingering, phase, visible]);

  // The other person hung up: "Call ended" for a moment, then the screen closes.
  useEffect(() => {
    if (phase !== 'ended' || lingering || ended.current) return;
    inject(webViewRef.current, 'window.__eliseCall&&window.__eliseCall.hangup();');
    const start = call.connectedAt;
    const stop = call.remoteLeftAt ?? Date.now();
    setEndedSeconds(start === null ? null : (stop - start) / 1000);
    const timer = setTimeout(() => finish('remote-ended'), ENDED_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [call.connectedAt, call.remoteLeftAt, finish, lingering, phase]);

  useEffect(() => {
    if (!hangingUp) return;
    const timer = setTimeout(() => finish('hangup'), HANGUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [finish, hangingUp]);

  // Safe areas for the self-view drawn inside the WebView.
  const pushLayout = useCallback(() => {
    inject(
      webViewRef.current,
      `window.__eliseCall&&window.__eliseCall.layout(${JSON.stringify({
        top: insets.top,
        right: insets.right,
      })});`,
    );
  }, [insets.right, insets.top]);
  useEffect(pushLayout, [pushLayout, width, height]);

  // The control bar fades out during the conversation and comes back on a tap.
  const autoHide = phase === 'in-call' && !screenReader && !call.cameraProblem && !hangingUp;
  useEffect(() => {
    if (!autoHide) {
      setControlsShown(true);
      return;
    }
    if (!controlsShown) return;
    const timer = setTimeout(() => setControlsShown(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [autoHide, controlsShown, controlsTouch]);
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(chromeOpacity, {
      toValue: controlsShown ? 1 : 0,
      duration: controlsShown ? 180 : 420,
      useNativeDriver: true,
    }).start();
  }, [chromeOpacity, controlsShown]);
  const touchControls = () => setControlsTouch((value) => value + 1);

  useEffect(() => {
    const announcement =
      phase === 'in-call'
        ? t('mobileCallOverlay.connectedWith', { residentName })
        : phase === 'reconnecting'
          ? t('mobileCallOverlay.reconnecting')
          : phase === 'ended'
            ? t('mobileCallOverlay.callEnded')
            : null;
    if (visible && announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [phase, residentName, visible]);

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    const message = parseCallMessage(nativeEvent.data);
    if (!message) return;
    if (message.type === 'left' && hangingUpRef.current) {
      finish('hangup');
      return;
    }
    if (message.type === 'camera-switch-error')
      Alert.alert(
        t('mobileCallOverlay.unableToSwitchCamera'),
        t('mobileCallOverlay.theCameraCouldNotBe'),
      );
    dispatch(message);
  };

  // The WebView process died (memory pressure, system kill): reload it twice, then give up.
  const onCrash = () => {
    crashes.current += 1;
    if (crashes.current > 2) dispatch({ type: 'fail', failure: 'crashed' });
    else resetSession(true);
  };

  const command = (name: 'toggleAudio' | 'toggleVideo' | 'switchCamera') => {
    touchControls();
    inject(webViewRef.current, `window.__eliseCall&&window.__eliseCall.${name}();`);
  };

  const hangUp = () => {
    if (hangingUpRef.current || ended.current) return;
    if (!source || !call.joined) {
      finish(phase === 'failed' ? 'failed' : 'hangup');
      return;
    }
    hangingUpRef.current = true;
    setHangingUp(true);
    // Leave the Jitsi room for real, then close (on "left", or after a short timeout).
    inject(webViewRef.current, 'window.__eliseCall&&window.__eliseCall.hangup();');
  };

  const retry = () => {
    crashes.current = 0;
    if (error && onRetry) onRetry();
    resetSession(false);
  };

  const failure: CallFailure | null = call.failure ?? (error ? 'failed' : null);
  const failureText = error
    ? error
    : failureMessage(failureMessageKey(failure, privateVideoServer), residentName);
  // Our own connection, not the other person briefly gone (grace period after they leave).
  const connectionTrouble = call.offline || call.interrupted;
  const showWebView = Boolean(source) && phase !== 'failed' && phase !== 'ended';
  const joinedControls = call.joined && !hangingUp;
  const duration = call.connectedAt ? formatCallDuration((now - call.connectedAt) / 1000) : '0:00';
  const chromeStyle = { opacity: chromeOpacity };
  // Under the self-view in portrait, beside it in landscape (the self-view is 148 px wide there).
  const bannerFrame = {
    top: insets.top + (landscape ? 76 : 172),
    left: insets.left + 16,
    right: insets.right + (landscape ? 148 + 28 : 16),
  };
  const chromePointer = controlsShown ? 'box-none' : 'none';

  return (
    <Modal
      visible={visible || lingering}
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={hangUp}
    >
      <StatusBar style="light" hidden={!controlsShown} animated />
      <View style={styles.shell}>
        {showWebView && source ? (
          <WebView
            key={reloadKey}
            ref={webViewRef}
            originWhitelist={['*']}
            source={source}
            style={styles.webView}
            containerStyle={StyleSheet.absoluteFill}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            allowsFullscreenVideo={false}
            mediaPlaybackRequiresUserAction={false}
            mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            setSupportMultipleWindows={false}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            onMessage={onMessage}
            onLoadEnd={pushLayout}
            onError={() => dispatch({ type: 'unreachable' })}
            onHttpError={() => dispatch({ type: 'unreachable' })}
            onContentProcessDidTerminate={onCrash}
            onRenderProcessGone={onCrash}
          />
        ) : null}

        {/* Taps on the video bring the controls back (the video itself needs no touch). */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessible={false}
          importantForAccessibility="no"
          onPress={() => {
            setControlsShown((shown) => !shown || !autoHide);
            touchControls();
          }}
        />

        {phase === 'failed' ? (
          <FailurePanel
            landscape={landscape}
            title={
              call.connectedAt === null
                ? t('mobileCallOverlay.unableToJoinTheCall')
                : t('mobileCallOverlay.callInterrupted')
            }
            message={failureText}
            permission={failure === 'microphone-permission'}
            onRetry={retry}
            onClose={() => finish('failed')}
          />
        ) : phase === 'ended' ? (
          <EndedPanel
            landscape={landscape}
            residentName={residentName}
            duration={endedSeconds === null ? null : formatCallDuration(endedSeconds)}
            onClose={() => (lingering ? setLingering(false) : finish('remote-ended'))}
          />
        ) : (
          <>
            {phase === 'in-call' && !hangingUp ? (
              call.remoteVideoMuted ? (
                <CenterNotice landscape={landscape}>
                  <CallAvatar name={residentName} size={landscape ? 72 : 120} />
                  <Text style={styles.noticeText}>
                    {t('mobileCallOverlay.remoteCameraOff', { residentName })}
                  </Text>
                </CenterNotice>
              ) : call.remoteVideoPending ? (
                <CenterNotice landscape={landscape}>
                  <CallAvatar name={residentName} size={landscape ? 72 : 120} />
                  <ActivityIndicator color="#D7E8E8" size="large" style={styles.spinner} />
                </CenterNotice>
              ) : null
            ) : (
              <CenterNotice landscape={landscape}>
                <CallAvatar name={residentName} size={landscape ? 72 : 132} halo={!landscape} />
                <Text
                  style={[styles.centerTitle, landscape && styles.centerTitleLandscape]}
                  numberOfLines={2}
                >
                  {hangingUp
                    ? t('mobileCallOverlay.endingCall')
                    : phase === 'waiting' || (phase === 'reconnecting' && !connectionTrouble)
                      ? t('mobileCallOverlay.waitingFor', { residentName })
                      : phase === 'reconnecting'
                        ? t('mobileCallOverlay.reconnecting')
                        : t('mobileCallOverlay.callWith', { residentName })}
                </Text>
                {hangingUp || (phase === 'reconnecting' && !connectionTrouble) ? null : (
                  <Text
                    style={[styles.centerDetail, landscape && styles.centerDetailLandscape]}
                    accessibilityLiveRegion="polite"
                  >
                    {phase === 'ringing'
                      ? t('mobileCallOverlay.theHomeScreenWillAnswer')
                      : phase === 'waiting'
                        ? t('mobileCallOverlay.waitingDetail')
                        : phase === 'reconnecting'
                          ? t('mobileCallOverlay.reconnectingDetail')
                          : t('mobileCallOverlay.connectingToTheVideoCall')}
                  </Text>
                )}
                {/* Landscape has no room for it under the text: the "…" already says "wait". */}
                {landscape ? null : (
                  <ActivityIndicator color="#D7E8E8" size="large" style={styles.spinner} />
                )}
              </CenterNotice>
            )}

            {/* Who, how long, how good: only once the conversation has started. */}
            {(phase === 'in-call' || (phase === 'reconnecting' && call.connectedAt)) &&
            !hangingUp ? (
              <Animated.View
                pointerEvents={chromePointer}
                style={[
                  styles.topBar,
                  {
                    top: insets.top + 12,
                    left: insets.left + 14,
                    // The self-view sits in the top-right corner (drawn by the WebView).
                    right: insets.right + (landscape ? 148 : 104) + 28,
                  },
                  chromeStyle,
                ]}
              >
                <View style={styles.identity} accessible accessibilityRole="header">
                  <CallAvatar name={residentName} size={44} />
                  <View style={styles.identityCopy}>
                    <Text style={styles.identityName} numberOfLines={1}>
                      {residentName}
                    </Text>
                    <View style={styles.identityStatus}>
                      <Text
                        style={styles.duration}
                        accessibilityLabel={t('mobileCallOverlay.callDuration', { duration })}
                      >
                        {phase === 'reconnecting' && connectionTrouble
                          ? t('mobileCallOverlay.reconnecting')
                          : duration}
                      </Text>
                      {phase === 'in-call' && call.network !== 'unknown' ? (
                        <NetworkBars level={call.network} />
                      ) : null}
                      {call.remoteAudioMuted ? (
                        <Ionicons
                          name="mic-off"
                          size={16}
                          color="#F5C9A3"
                          accessibilityLabel={t('mobileCallOverlay.remoteMicrophoneOff', {
                            residentName,
                          })}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              </Animated.View>
            ) : null}

            {/* One single, plain banner for what needs attention. */}
            {phase === 'reconnecting' && connectionTrouble && call.connectedAt && !hangingUp ? (
              <Banner frame={bannerFrame}>
                <ActivityIndicator color="#0B2948" size="small" />
                <Text style={styles.bannerText}>
                  {call.offline
                    ? t('mobileCallOverlay.offlineBanner')
                    : t('mobileCallOverlay.connectionLostBanner')}
                </Text>
              </Banner>
            ) : call.cameraProblem && call.joined && !hangingUp ? (
              <Banner frame={bannerFrame}>
                <Ionicons name="videocam-off" size={20} color="#0B2948" />
                <Text style={styles.bannerText}>
                  {call.cameraProblem === 'permission'
                    ? t('mobileCallOverlay.cameraBlocked', { residentName })
                    : t('mobileCallOverlay.cameraUnavailable')}
                </Text>
                {call.cameraProblem === 'permission' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('mobileCallOverlay.openSettings')}
                    onPress={() => void Linking.openSettings()}
                    style={styles.bannerAction}
                  >
                    <Text style={styles.bannerActionText}>{t('mobileCallOverlay.settings')}</Text>
                  </Pressable>
                ) : null}
              </Banner>
            ) : null}

            <Animated.View
              pointerEvents={chromePointer}
              style={[
                styles.bottomArea,
                {
                  paddingBottom: Math.max(insets.bottom, 12) + (landscape ? 4 : 12),
                  paddingLeft: insets.left + 12,
                  paddingRight: insets.right + 12,
                },
                chromeStyle,
              ]}
            >
              {joinedControls ? (
                <View style={styles.controls}>
                  <CallControl
                    icon={call.audioMuted ? 'mic-off' : 'mic'}
                    label={
                      call.audioMuted
                        ? t('mobileCallOverlay.microphoneOff')
                        : t('mobileCallOverlay.microphone')
                    }
                    accessibilityLabel={
                      call.audioMuted
                        ? t('mobileCallOverlay.turnOnMicrophone')
                        : t('mobileCallOverlay.muteMicrophone')
                    }
                    off={call.audioMuted === true}
                    disabled={call.audioMuted === null || !call.audioAvailable}
                    onPress={() => command('toggleAudio')}
                  />
                  <CallControl
                    icon={call.videoMuted || call.cameraProblem ? 'videocam-off' : 'videocam'}
                    label={
                      call.videoMuted || call.cameraProblem
                        ? t('mobileCallOverlay.cameraOff')
                        : t('mobileCallOverlay.camera')
                    }
                    accessibilityLabel={
                      call.videoMuted
                        ? t('mobileCallOverlay.turnOnCamera')
                        : t('mobileCallOverlay.turnOffCamera')
                    }
                    off={call.videoMuted === true || Boolean(call.cameraProblem)}
                    disabled={
                      call.videoMuted === null ||
                      !call.videoAvailable ||
                      Boolean(call.cameraProblem)
                    }
                    onPress={() => command('toggleVideo')}
                  />
                  {call.cameraSwitch && !call.cameraProblem ? (
                    <CallControl
                      icon="camera-reverse"
                      label={t('mobileCallOverlay.flip')}
                      accessibilityLabel={t('mobileCallOverlay.switchCamera')}
                      accessibilityHint={t('mobileCallOverlay.switchesBetweenTheFrontAnd')}
                      disabled={call.videoMuted !== false}
                      onPress={() => command('switchCamera')}
                    />
                  ) : null}
                  <CallControl
                    icon="call"
                    label={t('mobileCallOverlay.hangUp')}
                    accessibilityLabel={t('mobileCallOverlay.hangUp')}
                    danger
                    onPress={hangUp}
                  />
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    accepted ? t('mobileCallOverlay.hangUp') : t('mobileCallOverlay.cancelCall')
                  }
                  disabled={hangingUp}
                  onPress={hangUp}
                  style={({ pressed }) => [
                    styles.wideHangup,
                    pressed && styles.pressed,
                    hangingUp && styles.disabled,
                  ]}
                >
                  <Ionicons name="call" size={24} color="#fff" style={styles.hangupIcon} />
                  <Text style={styles.wideHangupText}>
                    {accepted ? t('mobileCallOverlay.hangUp') : t('mobileCallOverlay.cancelCall')}
                  </Text>
                </Pressable>
              )}
            </Animated.View>
          </>
        )}
      </View>
    </Modal>
  );
}

function failureMessage(key: ReturnType<typeof failureMessageKey>, residentName: string) {
  switch (key) {
    case 'turnOnTailscale':
      return t('mobileCallOverlay.turnOnTailscale');
    case 'microphonePermission':
      return t('mobileCallOverlay.microphonePermission');
    case 'microphoneUnavailable':
      return t('mobileCallOverlay.microphoneUnavailable');
    case 'connectionTimeout':
      return t('mobileCallOverlay.connectionTimeout');
    case 'noAnswer':
      return t('mobileCallOverlay.noAnswer', { residentName });
    case 'connectionLost':
      return t('mobileCallOverlay.connectionLost');
    case 'videoStopped':
      return t('mobileCallOverlay.videoStopped');
    default:
      return t('mobileCallOverlay.theVideoCallIsTemporarily');
  }
}

function CallAvatar({ name, size, halo = false }: { name: string; size: number; halo?: boolean }) {
  const avatar = (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.36) }]}>
        {initials(name)}
      </Text>
    </View>
  );
  if (!halo) return avatar;
  const haloSize = Math.round(size * 1.28);
  return (
    <View
      style={[styles.avatarHalo, { width: haloSize, height: haloSize, borderRadius: haloSize / 2 }]}
    >
      {avatar}
    </View>
  );
}

function CenterNotice({ landscape, children }: { landscape: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={[
        styles.center,
        // Portrait: below the self-view (top-right corner, 144 px high) and above the bar.
        landscape
          ? styles.centerLandscape
          : [styles.centerPortrait, { paddingTop: insets.top + 160 }],
      ]}
    >
      {children}
    </View>
  );
}

function Banner({
  frame,
  children,
}: {
  frame: { top: number; left: number; right: number };
  children: ReactNode;
}) {
  return (
    <View pointerEvents="box-none" style={[styles.bannerWrap, frame]}>
      <View style={styles.banner} accessibilityLiveRegion="polite">
        {children}
      </View>
    </View>
  );
}

const NETWORK_COLORS = { good: '#6FD39B', fair: '#F2B45C', poor: '#F0827C' } as const;

function NetworkBars({ level }: { level: 'good' | 'fair' | 'poor' }) {
  const lit = level === 'good' ? 3 : level === 'fair' ? 2 : 1;
  const label =
    level === 'good'
      ? t('mobileCallOverlay.networkGood')
      : level === 'fair'
        ? t('mobileCallOverlay.networkFair')
        : t('mobileCallOverlay.networkPoor');
  return (
    <View style={styles.network} accessible accessibilityLabel={label}>
      <View style={styles.bars}>
        {[0, 1, 2].map((bar) => (
          <View
            key={bar}
            style={[
              styles.bar,
              { height: 6 + bar * 4 },
              bar < lit ? { backgroundColor: NETWORK_COLORS[level] } : styles.barOff,
            ]}
          />
        ))}
      </View>
      {level === 'good' ? null : (
        <Text style={[styles.networkText, { color: NETWORK_COLORS[level] }]}>{label}</Text>
      )}
    </View>
  );
}

function EndedPanel({
  landscape,
  residentName,
  duration,
  onClose,
}: {
  landscape: boolean;
  residentName: string;
  duration: string | null;
  onClose: () => void;
}) {
  return (
    <View style={[styles.panel, landscape && styles.panelLandscape]}>
      <CallAvatar name={residentName} size={landscape ? 84 : 120} halo={!landscape} />
      <View style={[styles.panelCopy, landscape && styles.panelCopyLandscape]}>
        <Text style={[styles.panelTitle, landscape && styles.textStart]} accessibilityRole="header">
          {t('mobileCallOverlay.callEnded')}
        </Text>
        <Text style={[styles.panelText, landscape && styles.textStart]}>
          {duration
            ? t('mobileCallOverlay.callEndedWith', { residentName, duration })
            : residentName}
        </Text>
        <PanelButton label={t('mobileCallOverlay.close')} onPress={onClose} />
      </View>
    </View>
  );
}

function FailurePanel({
  landscape,
  title,
  message,
  permission,
  onRetry,
  onClose,
}: {
  landscape: boolean;
  title: string;
  message: string;
  permission: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <View style={[styles.panel, landscape && styles.panelLandscape]}>
      <View style={[styles.failureIcon, landscape && styles.failureIconLandscape]}>
        <Ionicons
          name={permission ? 'mic-off' : 'cloud-offline'}
          size={landscape ? 34 : 44}
          color="#0B2948"
        />
      </View>
      <View style={[styles.panelCopy, landscape && styles.panelCopyLandscape]}>
        <Text style={[styles.panelTitle, landscape && styles.textStart]} accessibilityRole="header">
          {title}
        </Text>
        <Text style={[styles.panelText, landscape && styles.textStart]}>{message}</Text>
        <View style={[styles.panelButtons, landscape && styles.panelButtonsLandscape]}>
          {permission ? (
            <PanelButton
              label={t('mobileCallOverlay.openSettings')}
              icon="settings-outline"
              primary
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
          <PanelButton
            label={t('mobileCallOverlay.retry')}
            icon="refresh"
            primary={!permission}
            onPress={onRetry}
          />
          <PanelButton label={t('mobileCallOverlay.close')} onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

function PanelButton({
  label,
  icon,
  primary = false,
  onPress,
}: {
  label: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.panelButton,
        primary ? styles.panelButtonPrimary : styles.panelButtonSecondary,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Ionicons name={icon} size={20} color={primary ? '#0B2948' : '#fff'} /> : null}
      <Text style={[styles.panelButtonText, primary && styles.panelButtonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CallControl({
  icon,
  label,
  accessibilityLabel,
  accessibilityHint,
  off = false,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  off?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.control,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.controlCircle,
          danger ? styles.controlDanger : off ? styles.controlOff : styles.controlOn,
        ]}
      >
        <Ionicons
          name={icon}
          size={28}
          color={off && !danger ? '#0B2948' : '#fff'}
          style={danger ? styles.hangupIcon : undefined}
        />
      </View>
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const PANEL = 'rgba(8, 27, 48, 0.84)';

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#06192D' },
  webView: { flex: 1, backgroundColor: '#06192D' },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centerPortrait: { paddingBottom: 150 },
  centerLandscape: { paddingBottom: 130 },
  centerTitleLandscape: { marginTop: 16, fontSize: 22 },
  centerDetailLandscape: { marginTop: 6, fontSize: 15, lineHeight: 21, maxWidth: 460 },
  centerTitle: {
    marginTop: 26,
    color: '#fff',
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 8,
  },
  centerDetail: {
    maxWidth: 340,
    marginTop: 10,
    color: '#D7E6E9',
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
  },
  spinner: { marginTop: 24 },
  noticeText: {
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    overflow: 'hidden',
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: PANEL,
  },
  avatarHalo: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(36, 82, 122, 0.55)',
  },
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DCE9E5' },
  avatarText: { color: '#12385F', fontWeight: '800' },
  topBar: { position: 'absolute', flexDirection: 'row' },
  identity: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 6,
    paddingRight: 18,
    paddingVertical: 6,
    borderRadius: 30,
    backgroundColor: PANEL,
  },
  identityCopy: { flexShrink: 1, gap: 1 },
  identityName: { color: '#fff', fontSize: 18, fontWeight: '800' },
  identityStatus: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  duration: { color: '#D7E6E9', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  network: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 },
  bar: { width: 4, borderRadius: 2 },
  barOff: { backgroundColor: 'rgba(255,255,255,0.28)' },
  networkText: { fontSize: 13, fontWeight: '700' },
  bannerWrap: { position: 'absolute', alignItems: 'center' },
  banner: {
    maxWidth: 520,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: '#F5F0E8',
  },
  bannerText: { flexShrink: 1, color: '#0B2948', fontSize: 15, fontWeight: '700', lineHeight: 20 },
  bannerAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: '#0B2948',
  },
  bannerActionText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  bottomArea: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 10,
    borderRadius: 36,
    backgroundColor: PANEL,
  },
  control: { width: 80, alignItems: 'center', gap: 7 },
  controlCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlOn: { backgroundColor: 'rgba(255,255,255,0.17)' },
  controlOff: { backgroundColor: '#F5F0E8' },
  controlDanger: { backgroundColor: '#C8443F' },
  hangupIcon: { transform: [{ rotate: '135deg' }] },
  controlLabel: { color: '#F1F6F7', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  wideHangup: {
    minHeight: 62,
    minWidth: 230,
    paddingHorizontal: 28,
    borderRadius: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#C8443F',
  },
  wideHangupText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  panel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#0B2948',
  },
  panelLandscape: { flexDirection: 'row', gap: 36, paddingHorizontal: 64 },
  panelCopy: { alignItems: 'center', marginTop: 28, maxWidth: 360 },
  panelCopyLandscape: { alignItems: 'flex-start', marginTop: 0, flexShrink: 1, maxWidth: 440 },
  panelTitle: { color: '#fff', fontSize: 25, fontWeight: '800', textAlign: 'center' },
  panelText: {
    marginTop: 10,
    color: '#D7E6E9',
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
  },
  textStart: { textAlign: 'left' },
  panelButtons: { marginTop: 26, gap: 12, alignSelf: 'stretch' },
  panelButtonsLandscape: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'auto' },
  panelButton: {
    minHeight: 56,
    minWidth: 150,
    paddingHorizontal: 24,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  panelButtonPrimary: { backgroundColor: '#F5F0E8' },
  panelButtonSecondary: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  panelButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  panelButtonTextPrimary: { color: '#0B2948' },
  failureIcon: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE9E5',
  },
  failureIconLandscape: { width: 84, height: 84, borderRadius: 42 },
});
