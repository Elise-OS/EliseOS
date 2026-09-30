import { Ionicons } from '@expo/vector-icons';
import type { ScreenCommand, ScreenSnapshot } from '@michel/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileApi, type ScreenTvStatus } from '../api';
import type { SavedServer } from '../discovery/types';
import { MobileScreenTabs } from './MobileScreenTabs';

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
  const [statusOpen, setStatusOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tvStatusQuery = useQuery<ScreenTvStatus>({
    queryKey: ['michel', server.id, 'screen-tv'],
    queryFn: () => mobileApi.screenTvStatus(server, token),
    enabled: Boolean(snapshot?.grant.control),
    refetchInterval: 5_000,
  });
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
              : 'En attente';

  const tvStatus = tvStatusQuery.data;
  const nowSeconds = Date.now() / 1000;
  const displayFresh =
    typeof tvStatus?.display?.updatedAt === 'number' &&
    nowSeconds - tvStatus.display.updatedAt < 60;
  const videoOutputReady =
    displayFresh && Boolean(tvStatus?.display?.selected && tvStatus.display.mode);
  const connectedOutputs = tvStatus?.display?.connected ?? [];
  const videoOutputLabel = !tvStatus
    ? tvStatusQuery.isPending
      ? 'Chargement…'
      : 'État HDMI indisponible'
    : !tvStatus.installed
      ? 'Agent vidéo absent'
      : !displayFresh
        ? 'État HDMI indisponible'
        : videoOutputReady
          ? `Sortie ${tvStatus.display?.selected} · ${tvStatus.display?.mode}`
          : connectedOutputs.length > 0
            ? `${connectedOutputs.join(', ')} détectée sans mode actif`
            : 'Aucune sortie vidéo détectée';
  const cecFresh =
    typeof tvStatus?.cec?.updatedAt === 'number' && nowSeconds - tvStatus.cec.updatedAt < 45;
  const cecReady =
    cecFresh &&
    tvStatus?.cec?.tvAcknowledged === true &&
    (playback?.asleep
      ? tvStatus.cec.asleepRequested === true
      : tvStatus.cec.activeSourceSent === true);
  const cecLabel = !tvStatus
    ? tvStatusQuery.isPending
      ? 'Chargement…'
      : 'État CEC indisponible'
    : cecReady
      ? 'CEC opérationnel'
      : 'CEC à vérifier';
  const selectedNetworkTv = tvStatus?.networkTv?.id ? tvStatus.networkTv : undefined;
  const networkStatusFresh =
    typeof tvStatus?.networkTvStatus?.updatedAt === 'number' &&
    nowSeconds - tvStatus.networkTvStatus.updatedAt < 30;
  const networkReachable = networkStatusFresh && tvStatus?.networkTvStatus?.reachable === true;
  const networkControlReady = Boolean(
    selectedNetworkTv && (networkReachable || tvStatus?.homeAssistantTv?.available === true),
  );
  const networkStatusLabel = !tvStatus
    ? tvStatusQuery.isPending
      ? 'Chargement…'
      : 'Réseau : état indisponible'
    : !selectedNetworkTv
      ? 'Réseau : TV non associée'
      : networkReachable
        ? `Réseau : ${selectedNetworkTv.name ?? 'TV'} joignable`
        : tvStatus.homeAssistantTv?.available
          ? `Réseau : ${selectedNetworkTv.name ?? 'TV'} disponible via Home Assistant`
          : `Réseau : ${selectedNetworkTv.name ?? 'TV'} en veille`;
  const tvReclaimReady = Boolean(cecReady || networkControlReady);
  const statusTone =
    snapshot?.online && videoOutputReady ? 'ready' : snapshot?.online ? 'warning' : 'offline';
  const statusLabel = !snapshot
    ? 'État de l’écran indisponible'
    : !snapshot.online
      ? 'Écran hors ligne'
      : videoOutputReady
        ? 'TV connectée'
        : 'TV à vérifier';

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

  const reclaimTv = async () => {
    if (!snapshot?.grant.control || busy) return;
    setBusy(true);
    setError('');
    try {
      await mobileApi.screenTvReclaim(server, token);
      await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      await tvStatusQuery.refetch();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de reprendre la TV.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.page}>
      <View style={s.pageHeader}>
        <View>
          <Text style={s.eyebrow}>ÉCRAN DU FOYER</Text>
          <Text style={s.title}>Affichage TV</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${statusLabel}. Afficher l’état détaillé de la TV`}
          accessibilityState={{ expanded: statusOpen }}
          style={s.statusButton}
          onPress={() => setStatusOpen(true)}
        >
          <View style={[s.statusDot, s[`statusDot_${statusTone}`]]} />
        </Pressable>
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

      <MobileScreenTabs server={server} token={token} snapshot={snapshot} onChanged={onChanged} />

      {snapshot && (snapshot.visit || snapshot.agenda.length > 0) ? (
        <View style={s.card}>
          <View style={s.cardHead}>
            <View style={[s.miniIcon, s.miniIconAmber]}>
              <Ionicons name="calendar-outline" size={18} color={c.amber} />
            </View>
            <View style={s.flex}>
              <Text style={s.cardTitle}>
                {snapshot.visit ? 'Prochain rendez-vous' : 'Agenda à venir'}
              </Text>
              {snapshot.visit ? (
                <Text style={s.detail}>Visite de {snapshot.visit.visitorName}</Text>
              ) : null}
            </View>
          </View>
          {snapshot.visit ? (
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
          {snapshot.agenda.slice(0, 3).map((item) => (
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
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <Modal
        visible={statusOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusOpen(false)}
      >
        <View style={s.statusOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer la fenêtre d’état"
            style={s.statusBackdrop}
            onPress={() => setStatusOpen(false)}
          />
          <View style={s.statusDialog}>
            <View style={s.modalHeader}>
              <Text style={s.statusModalTitle}>État de la TV</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fermer l’état de la TV"
                onPress={() => setStatusOpen(false)}
                style={s.close}
              >
                <Ionicons name="close" size={22} color={c.navy} />
              </Pressable>
            </View>
            <View style={s.statusList}>
              <EquipmentLine
                icon="camera-outline"
                text={`Caméra ${snapshot?.capabilities.camera ? 'prête' : 'à tester'}`}
                ready={Boolean(snapshot?.capabilities.camera)}
              />
              <EquipmentLine
                icon="mic-outline"
                text={`Micro ${snapshot?.capabilities.microphone ? 'prêt' : 'à tester'}`}
                ready={Boolean(snapshot?.capabilities.microphone)}
              />
              <EquipmentLine
                icon="globe-outline"
                text={`Navigateur kiosque ${snapshot?.online ? 'connecté' : 'à vérifier'}`}
                ready={Boolean(snapshot?.online)}
              />
              <EquipmentLine
                icon="tv-outline"
                text={videoOutputLabel}
                ready={Boolean(videoOutputReady)}
              />
              <EquipmentLine
                icon={tvReclaimReady ? 'checkmark-circle-outline' : 'close-circle-outline'}
                text={`Reprise TV ${tvReclaimReady ? 'disponible' : 'à vérifier'}`}
                ready={tvReclaimReady}
              />
              <EquipmentLine icon="power-outline" text={cecLabel} ready={Boolean(cecReady)} />
              <EquipmentLine
                icon={networkControlReady ? 'wifi-outline' : 'cloud-offline-outline'}
                text={networkStatusLabel}
                ready={networkControlReady}
              />
            </View>
            {error ? (
              <Text accessibilityRole="alert" style={s.statusError}>
                {error}
              </Text>
            ) : null}
            {snapshot?.grant.control ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                style={[s.reclaimButton, busy && s.reclaimButtonDisabled]}
                onPress={() => void reclaimTv()}
              >
                <Ionicons name="power-outline" size={18} color="#fff" />
                <Text style={s.reclaimButtonText}>
                  {busy ? 'Reprise en cours…' : 'Reprendre la TV'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EquipmentLine({
  icon,
  text,
  ready,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  ready: boolean;
}) {
  return (
    <View style={s.equipmentLine}>
      <Ionicons name={icon} size={16} color={ready ? c.green : c.amber} />
      <Text style={[s.equipmentLabel, ready && s.equipmentReady]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { gap: 11, paddingBottom: 12 },
  flex: { flex: 1 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  eyebrow: { color: c.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  title: { marginTop: 3, color: c.navy, fontFamily: 'Georgia', fontSize: 22 },
  statusButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.line,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusDot_ready: { backgroundColor: c.green },
  statusDot_warning: { backgroundColor: c.amber },
  statusDot_offline: { backgroundColor: c.red },
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
  equipmentLabel: { flex: 1, color: c.navy, fontSize: 10, fontWeight: '700' },
  equipmentReady: { color: c.green },
  visitTime: { color: c.accent, fontSize: 10, fontWeight: '800' },
  agendaRow: { minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 7 },
  message: { color: c.navy, fontFamily: 'Georgia', fontSize: 14, lineHeight: 20 },
  error: { padding: 10, borderRadius: 10, color: c.red, backgroundColor: c.paleAmber, fontSize: 9 },
  statusOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  statusBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 27, 46, .42)',
  },
  statusDialog: {
    width: '100%',
    maxWidth: 380,
    padding: 12,
    borderRadius: 18,
    backgroundColor: c.cream,
    gap: 8,
  },
  statusModalTitle: { color: c.navy, fontFamily: 'Georgia', fontSize: 19 },
  statusList: { gap: 2 },
  statusError: { color: c.red, fontSize: 10 },
  reclaimButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.blue,
  },
  reclaimButtonDisabled: { opacity: 0.65 },
  reclaimButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  modalHeader: {
    minHeight: 58,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    width: 39,
    height: 39,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
});
