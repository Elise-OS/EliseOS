import { Ionicons } from '@expo/vector-icons';
import type { ScreenJoin } from '@michel/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

const inlineJson = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');

const callPage = (join: ScreenJoin) => {
  const jitsi = new URL(join.url);
  const options = `{
    roomName: ${inlineJson(join.room)},
    jwt: ${inlineJson(join.jwt)},
    parentNode: document.getElementById('meet'),
    width: '100%',
    height: '100%',
    userInfo: { displayName: ${inlineJson(join.name)} },
    configOverwrite: {
      prejoinConfig: { enabled: false },
      disableDeepLinking: true,
      p2p: { enabled: false },
      startWithAudioMuted: false,
      startWithVideoMuted: false,
      toolbarButtons: ['microphone', 'camera', 'hangup']
    }
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
            script.onload=function(){
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
              window.__michelToggleCamera=function(){
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
              api.addEventListener('videoConferenceJoined',refreshCameraAvailability);
              api.addEventListener('deviceListChanged',function(event){
                reportCameraAvailability(event && event.devices);
              });
              api.addEventListener('readyToClose',function(){send('hangup');});
              api.addEventListener('videoConferenceLeft',function(){send('hangup');});
            };
            script.onerror=function(){send('error');};
            document.head.appendChild(script);
          })();
        </script>
      </body></html>`,
  };
};

interface MobileCallOverlayProps {
  visible: boolean;
  residentName: string;
  locale: 'fr' | 'en';
  accepted: boolean;
  join: ScreenJoin | null;
  error: string;
  onEnd: () => void | Promise<void>;
}

export function MobileCallOverlay({
  visible,
  residentName,
  locale,
  accepted,
  join,
  error,
  onEnd,
}: MobileCallOverlayProps) {
  const fr = locale === 'fr';
  const [webError, setWebError] = useState(false);
  const [cameraSwitchAvailable, setCameraSwitchAvailable] = useState(false);
  const ended = useRef(false);
  const webViewRef = useRef<WebView>(null);
  const source = useMemo(() => (join ? callPage(join) : null), [join]);

  useEffect(() => {
    setWebError(false);
    setCameraSwitchAvailable(false);
    ended.current = false;
  }, [join?.jwt, visible]);

  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    void onEnd();
  };

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    if (nativeEvent.data === 'hangup') finish();
    if (nativeEvent.data === 'error') setWebError(true);
    if (nativeEvent.data === 'camera-switch-available') setCameraSwitchAvailable(true);
    if (nativeEvent.data === 'camera-switch-unavailable') setCameraSwitchAvailable(false);
    if (nativeEvent.data === 'camera-switch-error') {
      Alert.alert(
        fr ? 'Changement impossible' : 'Unable to switch camera',
        fr
          ? 'La caméra ne peut pas être changée pendant cet appel.'
          : 'The camera could not be changed during this call.',
      );
    }
  };

  const onWebError = () => setWebError(true);

  const callError =
    error ||
    (webError
      ? fr
        ? 'La visioconférence est momentanément inaccessible.'
        : 'The video call is temporarily unavailable.'
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
                <Text style={styles.eyebrow}>{fr ? 'APPEL VIDÉO' : 'VIDEO CALL'}</Text>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {residentName}
                </Text>
              </View>
            </View>
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
              onMessage={onMessage}
              onError={onWebError}
              onHttpError={onWebError}
            />
            <View style={styles.cameraControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fr ? 'Changer de caméra' : 'Switch camera'}
                accessibilityHint={
                  fr
                    ? 'Passe de la caméra avant à la caméra arrière.'
                    : 'Switches between the front and rear cameras.'
                }
                disabled={!cameraSwitchAvailable}
                onPress={() =>
                  webViewRef.current?.injectJavaScript(
                    'window.__michelToggleCamera && window.__michelToggleCamera(); true;',
                  )
                }
                style={[
                  styles.cameraSwitchButton,
                  !cameraSwitchAvailable && styles.cameraSwitchButtonDisabled,
                ]}
              >
                <Ionicons name="camera-reverse-outline" size={21} color="#fff" />
              </Pressable>
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
                ? fr
                  ? 'Impossible de rejoindre l’appel'
                  : 'Unable to join the call'
                : fr
                  ? `Appel avec ${residentName}`
                  : `Call with ${residentName}`}
            </Text>
            <Text style={styles.waitingDetail}>
              {callError
                ? callError
                : accepted
                  ? fr
                    ? 'Connexion à la visioconférence…'
                    : 'Connecting to the video call…'
                  : fr
                    ? 'L’écran va répondre automatiquement. La vidéo s’ouvrira ici dans un instant.'
                    : 'The home screen will answer automatically. Video will open here in a moment.'}
            </Text>
            {!callError ? <ActivityIndicator color="#d7e8e8" size="large" /> : null}
            <Pressable accessibilityRole="button" onPress={finish} style={styles.hangupButton}>
              <Ionicons name="call" size={19} color="#fff" />
              <Text style={styles.hangupText}>
                {accepted
                  ? fr
                    ? 'Raccrocher'
                    : 'Hang up'
                  : fr
                    ? 'Annuler l’appel'
                    : 'Cancel call'}
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#0B2948' },
  header: {
    minHeight: 66,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B2948',
  },
  headerCopy: { flex: 1, gap: 3 },
  cameraControls: { alignItems: 'flex-end', paddingHorizontal: 18, paddingVertical: 12 },
  eyebrow: { color: '#AFCDD1', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  cameraSwitchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#4E7188',
    backgroundColor: '#174364',
  },
  cameraSwitchButtonDisabled: { opacity: 0.45 },
  webView: { flex: 1, backgroundColor: '#0B2948' },
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
  waitingTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  waitingDetail: {
    maxWidth: 330,
    marginTop: 12,
    marginBottom: 30,
    color: '#D0E0E3',
    fontSize: 14,
    lineHeight: 21,
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
  hangupText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
