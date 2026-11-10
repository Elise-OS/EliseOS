import { Ionicons } from '@expo/vector-icons';
import {
  eliseMobileCallConfig,
  eliseMobileCallInterfaceConfig,
  type ScreenJoin,
} from '@elise/contracts';
import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { type Language, t } from '../i18n';

const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const callPage = (join: ScreenJoin) => {
  const jitsi = new URL(join.url);
  const options = `{
    roomName: ${inlineJson(join.room)},
    jwt: ${inlineJson(join.jwt)},
    parentNode: document.getElementById('meet'),
    width: '100%',
    height: '100%',
    userInfo: { displayName: ${inlineJson(join.name)} },
    configOverwrite: ${inlineJson({
      ...eliseMobileCallConfig,
      startWithAudioMuted: false,
      startWithVideoMuted: false,
    })},
    interfaceConfigOverwrite: ${inlineJson(eliseMobileCallInterfaceConfig)}
  }`;

  return {
    baseUrl: jitsi.origin,
    html: `<!doctype html>
      <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
        <meta name="referrer" content="no-referrer">
        <style>html,body,#meet{height:100%;width:100%;margin:0;background:#0b2948;overflow:hidden}</style>
      </head><body><div id="meet"></div>
        <script>
          (function(){
            function send(value){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(value); }
            var script=document.createElement('script');
            script.src=${inlineJson(`${jitsi.origin}/external_api.js`)};
            // A phone outside the box's private network never loads the Jitsi script.
            var loaded=false;
            script.onerror=function(){send('unreachable');};
            setTimeout(function(){ if(!loaded) send('unreachable'); }, 15000);
            script.onload=function(){
              loaded=true;
              if(!window.JitsiMeetExternalAPI){send('error');return;}
              var api=new window.JitsiMeetExternalAPI(${inlineJson(jitsi.host)}, ${options});
              var switchingCamera=false;
              function reportCameraAvailability(devices){
                var cameras=devices && devices.videoInput || [];
                send(cameras.length > 1 ? 'camera-switch-available' : 'camera-switch-unavailable');
              }
              function refreshCameraAvailability(){
                api.getAvailableDevices().then(reportCameraAvailability).catch(function(){
                  send('camera-switch-unavailable');
                });
              }
              window.__eliseToggleCamera=function(){
                if(switchingCamera)return;
                switchingCamera=true;
                Promise.all([api.getAvailableDevices(),api.getCurrentDevices()]).then(function(results){
                  var cameras=results[0] && results[0].videoInput || [];
                  var current=results[1] && results[1].videoInput || {};
                  if(cameras.length < 2){send('camera-switch-unavailable');return;}
                  var currentIndex=cameras.findIndex(function(camera){
                    return (current.deviceId && camera.deviceId===current.deviceId) ||
                      (current.label && camera.label===current.label);
                  });
                  var next=cameras[currentIndex < 0 ? 1 : (currentIndex + 1) % cameras.length];
                  return api.setVideoInputDevice(next.label,next.deviceId).then(function(){
                    send('camera-switch-done');
                  });
                }).catch(function(){send('camera-switch-error');}).then(function(){
                  switchingCamera=false;
                });
              };
              // The app draws the call controls itself and drives Jitsi through these commands.
              window.__eliseCall={
                toggleAudio:function(){api.executeCommand('toggleAudio');},
                toggleVideo:function(){api.executeCommand('toggleVideo');}
              };
              api.addEventListener('audioMuteStatusChanged',function(event){
                send(event && event.muted ? 'audio-muted' : 'audio-on');
              });
              api.addEventListener('videoMuteStatusChanged',function(event){
                send(event && event.muted ? 'video-muted' : 'video-on');
              });
              api.addEventListener('videoConferenceJoined',function(){
                send('joined');
                refreshCameraAvailability();
              });
              api.addEventListener('deviceListChanged',function(event){
                reportCameraAvailability(event && event.devices);
              });
              api.addEventListener('readyToClose',function(){send('hangup');});
              api.addEventListener('videoConferenceLeft',function(){send('hangup');});
            };
            document.head.appendChild(script);
          })();
        </script>
      </body></html>`,
  };
};

interface MobileCallOverlayProps {
  visible: boolean;
  residentName: string;
  locale: Language;
  accepted: boolean;
  join: ScreenJoin | null;
  error: string;
  onEnd: () => void | Promise<void>;
}

export function MobileCallOverlay({
  visible,
  residentName,
  accepted,
  join,
  error,
  onEnd,
}: MobileCallOverlayProps) {
  const [webError, setWebError] = useState<false | 'error' | 'unreachable'>(false);
  const [cameraSwitchAvailable, setCameraSwitchAvailable] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const ended = useRef(false);
  const webViewRef = useRef<WebView>(null);
  const source = useMemo(() => (join ? callPage(join) : null), [join]);

  useEffect(() => {
    setWebError(false);
    setCameraSwitchAvailable(false);
    setAudioMuted(false);
    setVideoMuted(false);
    setJoinedAt(null);
    ended.current = false;
  }, [join?.jwt, visible]);

  useEffect(() => {
    if (!joinedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [joinedAt]);

  const command = (name: 'toggleAudio' | 'toggleVideo') =>
    webViewRef.current?.injectJavaScript(
      `window.__eliseCall && window.__eliseCall.${name}(); true;`,
    );
  const elapsed = joinedAt ? Math.max(0, Math.floor((now - joinedAt) / 1000)) : 0;
  const duration = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    void onEnd();
  };

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    if (nativeEvent.data === 'hangup') finish();
    if (nativeEvent.data === 'joined') {
      setJoinedAt(Date.now());
      setNow(Date.now());
    }
    if (nativeEvent.data === 'audio-muted') setAudioMuted(true);
    if (nativeEvent.data === 'audio-on') setAudioMuted(false);
    if (nativeEvent.data === 'video-muted') setVideoMuted(true);
    if (nativeEvent.data === 'video-on') setVideoMuted(false);
    if (nativeEvent.data === 'error') setWebError('error');
    if (nativeEvent.data === 'unreachable') setWebError('unreachable');
    if (nativeEvent.data === 'camera-switch-available') setCameraSwitchAvailable(true);
    if (nativeEvent.data === 'camera-switch-unavailable') setCameraSwitchAvailable(false);
    if (nativeEvent.data === 'camera-switch-error') {
      Alert.alert(
        t('mobileCallOverlay.unableToSwitchCamera'),
        t('mobileCallOverlay.theCameraCouldNotBe'),
      );
    }
  };

  const onWebError = () => setWebError('unreachable');

  // The video server is published on the box's private Tailscale address: off Tailscale,
  // the phone cannot reach it, which is the usual reason a call cannot be joined.
  const privateVideoServer = join ? new URL(join.url).hostname.endsWith('.ts.net') : false;
  const callError =
    error ||
    (webError === 'unreachable' && privateVideoServer
      ? t('mobileCallOverlay.turnOnTailscale')
      : webError
        ? t('mobileCallOverlay.theVideoCallIsTemporarily')
        : '');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={finish}
    >
      <SafeAreaView style={styles.shell} edges={['top', 'left', 'right', 'bottom']}>
        {source && !callError ? (
          <>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {residentName}
                </Text>
                <Text style={styles.eyebrow}>
                  {joinedAt ? duration : t('mobileCallOverlay.connectingToTheVideoCall')}
                </Text>
              </View>
              <View style={[styles.liveDot, joinedAt ? styles.liveDotOn : null]} />
            </View>
            <View style={styles.stage}>
              <WebView
                ref={webViewRef}
                originWhitelist={['*']}
                source={source}
                style={styles.webView}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
                scrollEnabled={false}
                bounces={false}
                onMessage={onMessage}
                onError={onWebError}
                onHttpError={onWebError}
              />
            </View>
            <View style={styles.controls}>
              <CallControl
                icon={audioMuted ? 'mic-off' : 'mic'}
                label={t('mobileCallOverlay.microphone')}
                accessibilityLabel={
                  audioMuted
                    ? t('mobileCallOverlay.turnOnMicrophone')
                    : t('mobileCallOverlay.muteMicrophone')
                }
                active={!audioMuted}
                onPress={() => command('toggleAudio')}
              />
              <CallControl
                icon={videoMuted ? 'videocam-off' : 'videocam'}
                label={t('mobileCallOverlay.camera')}
                accessibilityLabel={
                  videoMuted
                    ? t('mobileCallOverlay.turnOnCamera')
                    : t('mobileCallOverlay.turnOffCamera')
                }
                active={!videoMuted}
                onPress={() => command('toggleVideo')}
              />
              <CallControl
                icon="camera-reverse"
                label={t('mobileCallOverlay.flip')}
                accessibilityLabel={t('mobileCallOverlay.switchCamera')}
                active
                disabled={!cameraSwitchAvailable || videoMuted}
                onPress={() =>
                  webViewRef.current?.injectJavaScript(
                    'window.__eliseToggleCamera && window.__eliseToggleCamera(); true;',
                  )
                }
              />
              <CallControl
                icon="call"
                label={t('mobileCallOverlay.hangUp')}
                accessibilityLabel={t('mobileCallOverlay.hangUp')}
                danger
                onPress={finish}
              />
            </View>
          </>
        ) : (
          <View style={styles.waiting}>
            <View style={styles.avatarHalo}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {residentName
                    .trim()
                    .split(/\s+/)
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() || 'É'}
                </Text>
              </View>
            </View>
            <Text style={styles.waitingTitle}>
              {callError
                ? t('mobileCallOverlay.unableToJoinTheCall')
                : t('mobileCallOverlay.callWith', { residentName })}
            </Text>
            <Text style={styles.waitingDetail}>
              {callError
                ? callError
                : accepted
                  ? t('mobileCallOverlay.connectingToTheVideoCall')
                  : t('mobileCallOverlay.theHomeScreenWillAnswer')}
            </Text>
            {!callError ? <ActivityIndicator color="#d7e8e8" size="large" /> : null}
            <Pressable accessibilityRole="button" onPress={finish} style={styles.hangupButton}>
              <Ionicons name="call" size={19} color="#fff" />
              <Text style={styles.hangupText}>
                {accepted ? t('mobileCallOverlay.hangUp') : t('mobileCallOverlay.cancelCall')}
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function CallControl({
  icon,
  label,
  accessibilityLabel,
  active = false,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.control, disabled && styles.controlDisabled]}
    >
      <View
        style={[
          styles.controlCircle,
          danger ? styles.controlDanger : active ? styles.controlOn : styles.controlOff,
        ]}
      >
        <Ionicons
          name={icon}
          size={26}
          color={danger || active ? '#fff' : '#0B2948'}
          style={danger ? styles.hangupIcon : undefined}
        />
      </View>
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#0B2948' },
  header: {
    minHeight: 60,
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0B2948',
  },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: '#AFCDD1', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4E7188' },
  liveDotOn: { backgroundColor: '#5FB98A' },
  stage: {
    flex: 1,
    marginHorizontal: 10,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#06192D',
  },
  webView: { flex: 1, backgroundColor: '#06192D' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 10,
    backgroundColor: '#0B2948',
  },
  control: { width: 76, alignItems: 'center', gap: 7 },
  controlDisabled: { opacity: 0.4 },
  controlCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlOn: { backgroundColor: '#24527A' },
  controlOff: { backgroundColor: '#F5F0E8' },
  controlDanger: { backgroundColor: '#C8443F' },
  hangupIcon: { transform: [{ rotate: '135deg' }] },
  controlLabel: { color: '#D0E0E3', fontSize: 12, fontWeight: '700' },
  waiting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    backgroundColor: '#0B2948',
  },
  avatarHalo: {
    width: 164,
    height: 164,
    marginBottom: 33,
    borderRadius: 82,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#174364',
  },
  avatar: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE9E5',
  },
  avatarText: { color: '#12385F', fontSize: 36, fontWeight: '800' },
  waitingTitle: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  waitingDetail: {
    maxWidth: 330,
    marginTop: 12,
    marginBottom: 30,
    color: '#D0E0E3',
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
  },
  hangupButton: {
    minHeight: 54,
    minWidth: 196,
    marginTop: 34,
    paddingHorizontal: 22,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#B74747',
  },
  hangupText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
