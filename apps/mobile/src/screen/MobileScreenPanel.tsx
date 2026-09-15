import { useState } from 'react';
import { Modal, Pressable, Text, View, Platform, PermissionsAndroid } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { SavedServer } from '../discovery/types';
import { activeServerUrl } from '../discovery/helpers';
export function MobileScreenPanel({ server, token }: { server: SavedServer; token: string }) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState('');
  const base = server.remoteUrl ?? activeServerUrl(server);
  return (
    <View style={{ padding: 16, backgroundColor: '#fffdf8', borderRadius: 16, marginBottom: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600' }}>Écran et appels</Text>
      <Text>Appeler le résident, envoyer un message et choisir ses programmes.</Text>
      <Pressable
        onPress={() => {
          if (!base.startsWith('https://')) {
            setError('Activez l’accès privé HTTPS pour les appels.');
            return;
          }
          if (Platform.OS === 'android') {
            void PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.CAMERA,
              PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            ]).then((result) => {
              if (Object.values(result).every((v) => v === PermissionsAndroid.RESULTS.GRANTED))
                setOpen(true);
              else setError('Autorisez la caméra et le microphone pour appeler le résident.');
            });
          } else setOpen(true);
        }}
        style={{ padding: 16 }}
      >
        <Text>Ouvrir les commandes de l’écran</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Modal visible={open} onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1 }}>
          <Pressable onPress={() => setOpen(false)} style={{ padding: 16 }}>
            <Text>Fermer</Text>
          </Pressable>
          <WebView
            source={{
              uri: `${base}/api/v1/screen/mobile-session`,
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mediaCapturePermissionGrantType="prompt"
            onError={(e) => setError(e.nativeEvent.description)}
            onShouldStartLoadWithRequest={(r) =>
              r.url.startsWith(base + '/') ||
              r.url.startsWith(base.replace(/:\d+$/, ':8444') + '/') ||
              r.url === 'about:blank'
            }
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
