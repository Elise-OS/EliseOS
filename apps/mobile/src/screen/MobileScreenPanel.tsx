import { Ionicons } from '@expo/vector-icons';
import { tvChannelByUrl, type ScreenCommand, type ScreenSnapshot } from '@elise/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileApi, type ScreenTvStatus } from '../api';
import type { SavedServer } from '../discovery/types';
import { MobileScreenTabs } from './MobileScreenTabs';
import { TvChannelLogo } from './TvChannelLogo';
import { dateLocale } from '../i18n';
import { t } from '../i18n';

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
    queryKey: ['elise', server.id, 'screen-tv'],
    queryFn: () => mobileApi.screenTvStatus(server, token),
    enabled: Boolean(snapshot?.grant.control),
    refetchInterval: 5_000,
  });
  const playback = snapshot?.state.playback;
  const currentMedia = playback?.mediaId
    ? (snapshot?.state.media.find((item) => item.id === playback.mediaId) ?? null)
    : null;
  const currentContent = snapshot?.state.call
    ? t('mobileScreenPanel.callInProgress')
    : playback?.asleep
      ? t('mobileScreenPanel.tvResting')
      : (currentMedia?.title ?? t('mobileScreenPanel.homeScreen'));
  const currentTvChannel =
    currentMedia?.kind === 'tv' ? tvChannelByUrl(currentMedia.url) : undefined;
  const playbackLabel = !snapshot
    ? t('mobileScreenPanel.loading')
    : !snapshot.online
      ? t('mobileScreenPanel.screenOffline')
      : snapshot.state.call
        ? t('mobileScreenPanel.onACall')
        : playback?.asleep
          ? t('mobileScreenPanel.resting')
          : playback?.paused
            ? t('mobileScreenPanel.paused')
            : currentMedia
              ? t('mobileScreenPanel.nowPlaying')
              : t('mobileScreenPanel.waiting');

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
      ? t('mobileScreenPanel.loading')
      : t('mobileScreenPanel.hdmiStatusUnavailable')
    : !tvStatus.installed
      ? t('mobileScreenPanel.videoAgentMissing')
      : !displayFresh
        ? t('mobileScreenPanel.hdmiStatusUnavailable')
        : videoOutputReady
          ? t('mobileScreenPanel.output', {
              selected: tvStatus.display?.selected,
              mode: tvStatus.display?.mode,
            })
          : connectedOutputs.length > 0
            ? t('mobileScreenPanel.detectedWithNoActiveMode', {
                connectedOutputs: connectedOutputs.join(', '),
              })
            : t('mobileScreenPanel.noVideoOutputDetected');
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
      ? t('mobileScreenPanel.loading')
      : t('mobileScreenPanel.cecStatusUnavailable')
    : cecReady
      ? t('mobileScreenPanel.cecWorking')
      : t('mobileScreenPanel.cecToCheck');
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
      ? t('mobileScreenPanel.loading')
      : t('mobileScreenPanel.networkStatusUnavailable')
    : !selectedNetworkTv
      ? t('mobileScreenPanel.networkTvNotPaired')
      : networkReachable
        ? t('mobileScreenPanel.networkReachable', { value: selectedNetworkTv.name ?? 'TV' })
        : tvStatus.homeAssistantTv?.available
          ? t('mobileScreenPanel.networkAvailableThroughHomeAssistant', {
              value: selectedNetworkTv.name ?? 'TV',
            })
          : t('mobileScreenPanel.networkOnStandby', { value: selectedNetworkTv.name ?? 'TV' });
  const tvReclaimReady = Boolean(cecReady || networkControlReady);
  const statusTone =
    snapshot?.online && videoOutputReady ? 'ready' : snapshot?.online ? 'warning' : 'offline';
  const statusLabel = !snapshot
    ? t('mobileScreenPanel.screenStatusUnavailable')
    : !snapshot.online
      ? t('mobileScreenPanel.screenOffline')
      : videoOutputReady
        ? t('mobileScreenPanel.tvConnected')
        : t('mobileScreenPanel.tvToCheck');

  const run = async (command: ScreenCommand) => {
    if (!snapshot?.grant.control || !snapshot.online || busy) return;
    setBusy(true);
    setError('');
    try {
      await mobileApi.screenCommand(server, token, command);
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('mobileScreenPanel.theCommandWasNotSent'),
      );
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
      setError(cause instanceof Error ? cause.message : t('mobileScreenPanel.couldNotTakeOverThe'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.page}>
      <View style={s.pageHeader}>
        <View>
          <Text style={s.eyebrow}>{t('mobileScreenPanel.householdScreen')}</Text>
          <Text style={s.title}>{t('mobileScreenPanel.tvDisplay')}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${statusLabel}. ${t('mobileScreenPanel.showTheDetailedTvStatus')}`}
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
            <Text style={s.cardTitle}>{t('mobileScreenPanel.onTheTvNow')}</Text>
            <Text style={s.detail}>
              {snapshot?.state.tvControl?.name ?? t('mobileScreenPanel.tvNotPaired')} ·{' '}
              {snapshot?.online ? t('mobileScreenPanel.online') : t('mobileScreenPanel.offline')}
            </Text>
          </View>
          {snapshot?.paired ? (
            <Text style={s.badge}>{t('mobileScreenPanel.paired')}</Text>
          ) : (
            <Text style={s.badgeMuted}>{t('mobileScreenPanel.toPrepare')}</Text>
          )}
        </View>
        <View style={s.playback}>
          {currentTvChannel ? (
            <TvChannelLogo channel={currentTvChannel} style={s.playbackLogo} />
          ) : (
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
          )}
          <View style={s.flex}>
            <Text style={s.eyebrow}>
              {currentMedia
                ? playbackLabel.toLocaleUpperCase(dateLocale())
                : t('mobileScreenPanel.onScreen')}
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
                    {playback?.paused || playback?.asleep ? t('mobileScreenPanel.resume') : 'Pause'}
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
                  <Text style={s.commandLabel}>{t('mobileScreenPanel.stop')}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.volumeRow}>
              <Ionicons name="volume-low-outline" size={18} color={c.accent} />
              <Text style={s.volumeLabel}>Volume</Text>
              <Pressable
                accessibilityLabel={t('mobileScreenPanel.volumeDown')}
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
                accessibilityLabel={t('mobileScreenPanel.volumeUp')}
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
          <Text style={s.detail}>{t('mobileScreenPanel.tvControlsAreNotEnabled')}</Text>
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
                {snapshot.visit
                  ? t('mobileScreenPanel.nextAppointment')
                  : t('mobileScreenPanel.upcomingSchedule')}
              </Text>
              {snapshot.visit ? (
                <Text style={s.detail}>
                  {t('mobileScreenPanel.visitFrom', { visitorName: snapshot.visit.visitorName })}
                </Text>
              ) : null}
            </View>
          </View>
          {snapshot.visit ? (
            <Text style={s.visitTime}>
              {new Date(snapshot.visit.startsAt).toLocaleString(dateLocale(), {
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
                {new Date(item.startsAt).toLocaleDateString(dateLocale(), {
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
            accessibilityLabel={t('mobileScreenPanel.closeTheStatusWindow')}
            style={s.statusBackdrop}
            onPress={() => setStatusOpen(false)}
          />
          <View style={s.statusDialog}>
            <View style={s.modalHeader}>
              <Text style={s.statusModalTitle}>{t('mobileScreenPanel.tvStatus')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobileScreenPanel.closeTheTvStatus')}
                onPress={() => setStatusOpen(false)}
                style={s.close}
              >
                <Ionicons name="close" size={22} color={c.navy} />
              </Pressable>
            </View>
            <View style={s.statusList}>
              <EquipmentLine
                icon="camera-outline"
                text={
                  snapshot?.capabilities.camera
                    ? t('mobileScreenPanel.equipment.cameraReady')
                    : t('mobileScreenPanel.equipment.cameraNotReady')
                }
                ready={Boolean(snapshot?.capabilities.camera)}
              />
              <EquipmentLine
                icon="mic-outline"
                text={
                  snapshot?.capabilities.microphone
                    ? t('mobileScreenPanel.equipment.microphoneReady')
                    : t('mobileScreenPanel.equipment.microphoneNotReady')
                }
                ready={Boolean(snapshot?.capabilities.microphone)}
              />
              <EquipmentLine
                icon="globe-outline"
                text={
                  snapshot?.online
                    ? t('mobileScreenPanel.equipment.kioskBrowserReady')
                    : t('mobileScreenPanel.equipment.kioskBrowserNotReady')
                }
                ready={Boolean(snapshot?.online)}
              />
              <EquipmentLine
                icon="tv-outline"
                text={videoOutputLabel}
                ready={Boolean(videoOutputReady)}
              />
              <EquipmentLine
                icon={tvReclaimReady ? 'checkmark-circle-outline' : 'close-circle-outline'}
                text={
                  tvReclaimReady
                    ? t('mobileScreenPanel.equipment.tvTakeoverReady')
                    : t('mobileScreenPanel.equipment.tvTakeoverNotReady')
                }
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
                  {busy ? t('mobileScreenPanel.takingOver') : t('mobileScreenPanel.takeOverTheTv')}
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
  eyebrow: { color: c.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  title: { marginTop: 3, color: c.navy, fontFamily: 'Georgia', fontSize: 28 },
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
  cardTitle: { color: c.navy, fontSize: 15, fontWeight: '900' },
  detail: { marginTop: 3, color: c.muted, fontSize: 12, lineHeight: 19 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    color: c.green,
    backgroundColor: c.paleGreen,
    fontSize: 11,
    fontWeight: '900',
  },
  badgeMuted: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    color: c.muted,
    backgroundColor: '#EAE6DF',
    fontSize: 11,
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
  playbackLogo: { width: 52, height: 35, borderRadius: 10 },
  contentTitle: { marginTop: 2, color: c.navy, fontSize: 14, fontWeight: '800' },
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
  commandLabel: { color: c.blue, fontSize: 12, fontWeight: '800' },
  volumeRow: {
    minHeight: 41,
    paddingHorizontal: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F3F0EA',
  },
  volumeLabel: { flex: 1, color: c.navy, fontSize: 12, fontWeight: '800' },
  volumeButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  volumeValue: { width: 34, color: c.navy, textAlign: 'center', fontSize: 12, fontWeight: '900' },
  equipmentLine: {
    minHeight: 30,
    paddingHorizontal: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  equipmentLabel: { flex: 1, color: c.navy, fontSize: 13, fontWeight: '700' },
  equipmentReady: { color: c.green },
  visitTime: { color: c.accent, fontSize: 13, fontWeight: '800' },
  agendaRow: { minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 7 },
  message: { color: c.navy, fontFamily: 'Georgia', fontSize: 17, lineHeight: 24 },
  error: {
    padding: 10,
    borderRadius: 10,
    color: c.red,
    backgroundColor: c.paleAmber,
    fontSize: 12,
  },
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
  statusModalTitle: { color: c.navy, fontFamily: 'Georgia', fontSize: 21 },
  statusList: { gap: 2 },
  statusError: { color: c.red, fontSize: 13 },
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
  reclaimButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
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
