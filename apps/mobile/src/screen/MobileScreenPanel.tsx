import { Ionicons } from '@expo/vector-icons';
import type { ScreenCommand, ScreenSnapshot } from '@michel/contracts';
import { useState } from 'react';
import {
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { activeServerUrl } from '../discovery/helpers';

const c = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  cream: '#F5F0E8',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  paleGreen: '#E5EFE8',
  amber: '#D99A55',
  paleAmber: '#F7E9D7',
  red: '#B74747',
  paleBlue: '#E8F0F3',
};

export function MobileScreenPanel({
  server,
  token,
  snapshot,
  onChanged,
}: {
  server: SavedServer;
  token: string;
  snapshot?: ScreenSnapshot;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = server.remoteUrl ?? activeServerUrl(server);
  const playback = snapshot?.state.playback;
  const currentMedia = playback?.mediaId
    ? (snapshot?.state.media.find((item) => item.id === playback.mediaId) ?? null)
    : null;
  const currentContent = snapshot?.state.call
    ? 'Appel en cours'
    : playback?.asleep
      ? 'TV au repos'
      : (currentMedia?.title ?? 'Écran d’accueil');
  const playbackLabel = !snapshot
    ? 'Chargement…'
    : !snapshot.online
      ? 'Écran hors ligne'
      : snapshot.state.call
        ? 'En communication'
        : playback?.asleep
          ? 'Au repos'
          : playback?.paused
            ? 'En pause'
            : currentMedia
              ? 'En cours de lecture'
              : 'Écran connecté';

  const run = async (command: ScreenCommand) => {
    if (!snapshot?.grant.control || !snapshot.online || busy) return;
    setBusy(true);
    setError('');
    try {
      await mobileApi.screenCommand(server, token, command);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La commande n’a pas été envoyée.');
    } finally {
      setBusy(false);
    }
  };

  const openFullPanel = async () => {
    setError('');
    if (!base.startsWith('https://')) {
      setError('Activez l’accès privé HTTPS pour ouvrir les appels et les commandes avancées.');
      return;
    }
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      if (!Object.values(result).every((value) => value === PermissionsAndroid.RESULTS.GRANTED)) {
        setError('Autorisez la caméra et le microphone pour utiliser les appels vidéo.');
        return;
      }
    }
    setOpen(true);
  };

  return (
    <View style={s.page}>
      <View style={s.hero}>
        <View style={s.heroIcon}>
          <Ionicons name="tv-outline" size={23} color={c.blue} />
        </View>
        <View style={s.flex}>
          <Text style={s.eyebrow}>AFFICHAGE RÉSIDENT</Text>
          <Text style={s.title}>Écran et appels</Text>
          <View style={s.statusLine}>
            <View style={[s.dot, { backgroundColor: snapshot?.online ? c.green : c.amber }]} />
            <Text style={s.statusText}>{playbackLabel}</Text>
          </View>
        </View>
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <View style={s.miniIcon}>
            <Ionicons name="desktop-outline" size={18} color={c.blue} />
          </View>
          <View style={s.flex}>
            <Text style={s.cardTitle}>Sur la TV maintenant</Text>
            <Text style={s.detail}>
              {snapshot?.state.tvControl?.name ?? 'TV non associée'} ·{' '}
              {snapshot?.online ? 'En ligne' : 'Hors ligne'}
            </Text>
          </View>
          {snapshot?.paired ? (
            <Text style={s.badge}>Associée</Text>
          ) : (
            <Text style={s.badgeMuted}>À préparer</Text>
          )}
        </View>
        <View style={s.playback}>
          <View style={[s.playbackIcon, currentMedia && s.playbackIconLive]}>
            <Ionicons
              name={
                currentMedia?.kind === 'photo'
                  ? 'image-outline'
                  : currentMedia?.kind === 'youtube'
                    ? 'logo-youtube'
                    : 'play-outline'
              }
              size={19}
              color={currentMedia ? c.green : c.accent}
            />
          </View>
          <View style={s.flex}>
            <Text style={s.eyebrow}>
              {currentMedia ? playbackLabel.toLocaleUpperCase('fr-FR') : 'CONTENU AFFICHÉ'}
            </Text>
            <Text style={s.contentTitle}>{currentContent}</Text>
          </View>
        </View>
        {snapshot?.grant.control ? (
          <>
            <View style={s.commandRow}>
              {currentMedia ? (
                <Pressable
                  disabled={busy || !snapshot.online || Boolean(snapshot.state.call)}
                  style={s.commandButton}
                  onPress={() =>
                    void run({ action: playback?.paused || playback?.asleep ? 'resume' : 'pause' })
                  }
                >
                  <Ionicons
                    name={playback?.paused || playback?.asleep ? 'play' : 'pause'}
                    size={18}
                    color={c.blue}
                  />
                  <Text style={s.commandLabel}>
                    {playback?.paused || playback?.asleep ? 'Reprendre' : 'Pause'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={busy || !snapshot.online}
                style={s.commandButton}
                onPress={() => void run({ action: playback?.asleep ? 'wake' : 'sleep' })}
              >
                <Ionicons
                  name={playback?.asleep ? 'sunny-outline' : 'moon-outline'}
                  size={18}
                  color={c.blue}
                />
                <Text style={s.commandLabel}>
                  {playback?.asleep ? 'Réveiller' : 'Mettre au repos'}
                </Text>
              </Pressable>
              {currentMedia ? (
                <Pressable
                  disabled={busy || !snapshot.online}
                  style={s.commandButton}
                  onPress={() => void run({ action: 'stop' })}
                >
                  <Ionicons name="stop" size={17} color={c.blue} />
                  <Text style={s.commandLabel}>Arrêter</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.volumeRow}>
              <Ionicons name="volume-low-outline" size={18} color={c.accent} />
              <Text style={s.volumeLabel}>Volume</Text>
              <Pressable
                accessibilityLabel="Baisser le volume"
                disabled={busy}
                style={s.volumeButton}
                onPress={() =>
                  void run({ action: 'volume', volume: Math.max(0, (playback?.volume ?? 0) - 5) })
                }
              >
                <Ionicons name="remove" size={16} color={c.blue} />
              </Pressable>
              <Text style={s.volumeValue}>{playback?.volume ?? 0}%</Text>
              <Pressable
                accessibilityLabel="Augmenter le volume"
                disabled={busy}
                style={s.volumeButton}
                onPress={() =>
                  void run({ action: 'volume', volume: Math.min(100, (playback?.volume ?? 0) + 5) })
                }
              >
                <Ionicons name="add" size={16} color={c.blue} />
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={s.detail}>Les commandes TV ne sont pas activées pour votre compte.</Text>
        )}
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <View style={[s.miniIcon, s.miniIconGreen]}>
            <Ionicons name="information-circle-outline" size={18} color={c.green} />
          </View>
          <View style={s.flex}>
            <Text style={s.cardTitle}>État des équipements</Text>
            <Text style={s.detail}>Écran de {snapshot?.resident ?? 'la personne accompagnée'}</Text>
          </View>
        </View>
        <EquipmentLine
          icon="camera-outline"
          label="Caméra"
          status={snapshot?.capabilities.camera ? 'Prête' : 'À tester'}
          ready={Boolean(snapshot?.capabilities.camera)}
        />
        <EquipmentLine
          icon="mic-outline"
          label="Microphone"
          status={snapshot?.capabilities.microphone ? 'Prêt' : 'À tester'}
          ready={Boolean(snapshot?.capabilities.microphone)}
        />
        <EquipmentLine
          icon="globe-outline"
          label="Navigateur TV"
          status={
            snapshot?.online ? 'Connecté' : snapshot?.paired ? 'À vérifier' : 'En préparation'
          }
          ready={Boolean(snapshot?.online)}
        />
        {snapshot?.lastSeen ? (
          <Text style={s.lastSeen}>
            Dernière réponse :{' '}
            {new Date(snapshot.lastSeen).toLocaleString('fr-FR', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </Text>
        ) : null}
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <View style={[s.miniIcon, s.miniIconAmber]}>
            <Ionicons name="calendar-outline" size={18} color={c.amber} />
          </View>
          <View style={s.flex}>
            <Text style={s.cardTitle}>Prochain rendez-vous</Text>
            <Text style={s.detail}>
              {snapshot?.visit
                ? `Visite de ${snapshot.visit.visitorName}`
                : 'Aucune visite annoncée'}
            </Text>
          </View>
        </View>
        {snapshot?.visit ? (
          <Text style={s.visitTime}>
            {new Date(snapshot.visit.startsAt).toLocaleString('fr-FR', {
              timeZone: snapshot.timezone,
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        ) : null}
        {snapshot?.agenda.slice(0, 3).map((item) => (
          <View key={item.id} style={s.agendaRow}>
            <Ionicons
              name={item.type === 'visit' ? 'people-outline' : 'calendar-outline'}
              size={15}
              color={c.accent}
            />
            <Text style={s.detail}>
              {item.title} ·{' '}
              {new Date(item.startsAt).toLocaleDateString('fr-FR', {
                timeZone: snapshot.timezone,
                day: 'numeric',
                month: 'short',
              })}
            </Text>
          </View>
        ))}
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <View style={[s.miniIcon, s.miniIconAmber]}>
            <Ionicons name="images-outline" size={18} color={c.amber} />
          </View>
          <View style={s.flex}>
            <Text style={s.cardTitle}>Contenus et messages</Text>
            <Text style={s.detail}>
              {snapshot?.state.media.length ?? 0} média
              {snapshot?.state.media.length === 1 ? '' : 's'} ·{' '}
              {snapshot?.state.messages?.length ?? (snapshot?.state.message ? 1 : 0)} message
              {(snapshot?.state.messages?.length ?? (snapshot?.state.message ? 1 : 0)) === 1
                ? ''
                : 's'}
            </Text>
          </View>
        </View>
        {snapshot?.state.message ? (
          <Text style={s.message} numberOfLines={3}>
            « {snapshot.state.message} »
          </Text>
        ) : null}
        {snapshot?.grant.message ? (
          <Text style={s.detail}>
            Les messages se gèrent depuis Accueil ou les commandes complètes.
          </Text>
        ) : null}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        style={s.primaryButton}
        onPress={() => void openFullPanel()}
      >
        <Ionicons name="options-outline" size={18} color="#fff" />
        <Text style={s.primaryText}>Ouvrir toutes les commandes TV</Text>
        <Ionicons name="chevron-forward" size={16} color="#fff" />
      </Pressable>
      <Text style={s.footnote}>
        Appels, photos, playlists, programmes et réglages détaillés de l’écran.
      </Text>

      <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="slide">
        <SafeAreaView style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Affichage TV</Text>
            <Pressable
              accessibilityLabel="Fermer les commandes TV"
              onPress={() => setOpen(false)}
              style={s.close}
            >
              <Ionicons name="close" size={22} color={c.navy} />
            </Pressable>
          </View>
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
            onError={(event) => setError(event.nativeEvent.description)}
            onShouldStartLoadWithRequest={(request) =>
              request.url.startsWith(base + '/') ||
              request.url.startsWith(base.replace(/:\d+$/, ':8444') + '/') ||
              request.url === 'about:blank'
            }
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function EquipmentLine({
  icon,
  label,
  status,
  ready,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  status: string;
  ready: boolean;
}) {
  return (
    <View style={s.equipmentLine}>
      <Ionicons name={icon} size={16} color={ready ? c.green : c.amber} />
      <Text style={s.equipmentLabel}>{label}</Text>
      <Text style={[s.equipmentStatus, ready && s.equipmentReady]}>{status}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { gap: 11, paddingBottom: 12 },
  flex: { flex: 1 },
  hero: {
    minHeight: 90,
    padding: 16,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#EDF2F1',
  },
  heroIcon: {
    width: 47,
    height: 47,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DDE9ED',
  },
  eyebrow: { color: c.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  title: { marginTop: 3, color: c.navy, fontFamily: 'Georgia', fontSize: 22 },
  statusLine: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: c.muted, fontSize: 9, fontWeight: '700' },
  card: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    gap: 9,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  miniIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  miniIconGreen: { backgroundColor: c.paleGreen },
  miniIconAmber: { backgroundColor: c.paleAmber },
  cardTitle: { color: c.navy, fontSize: 12, fontWeight: '900' },
  detail: { marginTop: 3, color: c.muted, fontSize: 9, lineHeight: 14 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    color: c.green,
    backgroundColor: c.paleGreen,
    fontSize: 8,
    fontWeight: '900',
  },
  badgeMuted: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    color: c.muted,
    backgroundColor: '#EAE6DF',
    fontSize: 8,
    fontWeight: '900',
  },
  playback: {
    minHeight: 54,
    padding: 9,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#F2F0EA',
  },
  playbackIcon: {
    width: 35,
    height: 35,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  playbackIconLive: { backgroundColor: c.paleGreen },
  contentTitle: { marginTop: 2, color: c.navy, fontSize: 11, fontWeight: '800' },
  commandRow: { flexDirection: 'row', gap: 7 },
  commandButton: {
    minHeight: 39,
    flex: 1,
    paddingHorizontal: 7,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: c.paleBlue,
  },
  commandLabel: { color: c.blue, fontSize: 8, fontWeight: '800' },
  volumeRow: {
    minHeight: 41,
    paddingHorizontal: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F3F0EA',
  },
  volumeLabel: { flex: 1, color: c.navy, fontSize: 9, fontWeight: '800' },
  volumeButton: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  volumeValue: { width: 34, color: c.navy, textAlign: 'center', fontSize: 9, fontWeight: '900' },
  equipmentLine: {
    minHeight: 30,
    paddingHorizontal: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  equipmentLabel: { flex: 1, color: c.navy, fontSize: 9, fontWeight: '700' },
  equipmentStatus: { color: '#8D641C', fontSize: 8, fontWeight: '800' },
  equipmentReady: { color: c.green },
  lastSeen: { color: c.muted, fontSize: 8 },
  visitTime: { color: c.accent, fontSize: 10, fontWeight: '800' },
  agendaRow: { minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 7 },
  message: { color: c.navy, fontFamily: 'Georgia', fontSize: 14, lineHeight: 20 },
  error: { padding: 10, borderRadius: 10, color: c.red, backgroundColor: c.paleAmber, fontSize: 9 },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.blue,
  },
  primaryText: { flex: 1, color: '#fff', fontSize: 10, fontWeight: '900' },
  footnote: { color: c.muted, textAlign: 'center', fontSize: 8 },
  modal: { flex: 1, backgroundColor: c.cream },
  modalHeader: {
    minHeight: 58,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { color: c.navy, fontFamily: 'Georgia', fontSize: 20 },
  close: {
    width: 39,
    height: 39,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
});
