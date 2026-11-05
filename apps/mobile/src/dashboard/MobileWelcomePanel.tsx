import { Ionicons } from '@expo/vector-icons';
import { DoorOpen, MoonStar, Refrigerator, ShowerHead, Sunrise, Toilet } from 'lucide-react-native';
import {
  type ActivitySequence,
  type ActivitySummary,
  type HomeSummary,
  type ScheduleItem,
  type ScreenSnapshot,
} from '@elise/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { mobileApi, type ActivityItem, type Overview } from '../api';
import type { SavedServer } from '../discovery/types';
import { caregiverPresenceCopy } from './presence-copy';
import { friendlyValue, relativeTime, roomOf } from './formatters';
import { dateKeyInZone, shiftDate } from './homeDates';
import { dateLocale, type Language, t } from '../i18n';
import { useTabBarPadding } from './tabBarSpace';

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
  red: '#B74747',
  paleBlue: '#E8F0F3',
};
type Page = 'activity' | 'house' | 'alerts' | 'screen' | 'journal';
type SensorTone = 'entrance' | 'fridge' | 'toilet' | 'shower' | 'bedtime' | 'wakeup';
type SensorCard = {
  id: string;
  title: string;
  value: string;
  detail: string;
  icon: typeof DoorOpen;
  tone: SensorTone;
  available: boolean | null;
  roomId: string | null;
};

const sensorToneColors: Record<SensorTone, string> = {
  entrance: '#C36A2F',
  fridge: '#477BA5',
  toilet: '#4D7B73',
  shower: '#327F9B',
  bedtime: '#786AA1',
  wakeup: '#D88A45',
};

// Room names with their article, as they read inside a sentence ("is in the kitchen").
const ROOM_KINDS_WITH_ARTICLE = [
  'LIVING_ROOM',
  'KITCHEN',
  'BEDROOM',
  'BATHROOM',
  'TOILET',
  'ENTRANCE',
  'HALLWAY',
  'DINING_ROOM',
  'GARAGE',
  'GARDEN',
  'TERRACE',
] as const;

function roomLabel(room: Pick<HomeSummary['rooms'][number], 'kind' | 'name'>) {
  const kind = ROOM_KINDS_WITH_ARTICLE.find((candidate) => candidate === room.kind);
  return kind
    ? t(`mobileWelcomePanel.roomWithArticle.${kind}`)
    : t('mobileWelcomePanel.roomWithArticle.named', { name: room.name });
}

function mobilePresenceText(data: HomeSummary) {
  const resident = data.residentName || t('mobileWelcomePanel.theResident');
  if (
    data.entrance?.state === 'EXIT_LIKELY' &&
    data.presence.trackingState !== 'AMBIGUOUS' &&
    !data.presence.trackingDegraded
  )
    return t('mobileWelcomePanel.aDepartureFromTheHome');
  const latest = data.latestPresence
    ? data.rooms.find(({ id }) => id === data.latestPresence?.roomId)
    : null;
  if (latest) return t('mobileWelcomePanel.isIn', { resident, roomLabel: roomLabel(latest) });
  const currentRoom = data.rooms.find(
    ({ id }) => id === (data.presence.confirmedRoomId ?? data.presence.roomId),
  );
  if (data.presence.trackingState === 'CONFIRMED' && !data.presence.trackingDegraded && currentRoom)
    return t('mobileWelcomePanel.isIn', { resident, roomLabel: roomLabel(currentRoom) });
  if (data.presence.trackingState === 'IN_TRANSIT')
    return t('mobileWelcomePanel.appearsToBeMovingThrough', { resident });
  if (data.presence.trackingState === 'AMBIGUOUS' || data.presence.trackingDegraded)
    return t('mobileWelcomePanel.theLatestObservationsDoNot');
  if (currentRoom && data.presence.lastConfirmedAt) {
    const at = new Date(data.presence.lastConfirmedAt).toLocaleTimeString(dateLocale(), {
      timeZone: data.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    return t('mobileWelcomePanel.probablyInLastDetectedAt', {
      resident,
      room: roomLabel(currentRoom),
      at,
    });
  }
  return t('mobileWelcomePanel.thereIsNotEnoughInformation', { resident });
}

function duration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t('common.durationHoursMinutes', { hours, minutes: rest })
    : t('common.durationHours', { hours });
}
function roomIn(sequence: ActivitySequence, room: HomeSummary['rooms'][number]) {
  return sequence.roomIds.includes(room.id) || sequence.roomNames.includes(room.name);
}
function dayNarrative(
  data: HomeSummary,
  current: ActivitySummary | undefined,
  previous: ActivitySummary | undefined,
) {
  const resident = data.residentName || t('mobileWelcomePanel.theResident');
  const sequences = [...(current?.sequences ?? [])].sort(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  const previousSequences = [...(previous?.sequences ?? [])].sort(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  const bedroom = data.rooms.find(({ kind }) => kind === 'BEDROOM');
  const living = data.rooms.find(({ kind }) => kind === 'LIVING_ROOM');
  const kitchen = data.rooms.find(
    ({ kind, name }) =>
      kind === 'KITCHEN' ||
      name.toLocaleLowerCase(dateLocale()).includes(t('mobileWelcomePanel.kitchen')),
  );
  const hour = (value: string) =>
    Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone: data.timezone,
      }).format(new Date(value)),
    );
  const natural = (value: string) =>
    new Date(value).toLocaleTimeString(dateLocale(), {
      timeZone: data.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  const sentences: string[] = [];
  const lastPrevious = previousSequences.at(-1);
  const bedtime =
    bedroom &&
    lastPrevious &&
    roomIn(lastPrevious, bedroom) &&
    lastPrevious.roomNames.at(-1) === bedroom.name
      ? lastPrevious.endedAt
      : null;
  const wakeUp = sequences.find(
    ({ startedAt }) => hour(startedAt) >= 4 && hour(startedAt) < 12,
  )?.startedAt;
  if (bedtime && hour(bedtime) >= 18 && wakeUp)
    sentences.push(
      t('mobileWelcomePanel.bedtimeAndWakeUp', {
        resident,
        bedtime: natural(bedtime),
        wakeUp: natural(wakeUp),
      }),
    );
  else if (wakeUp)
    sentences.push(t('mobileWelcomePanel.wakeUp', { resident, wakeUp: natural(wakeUp) }));
  const livingSeconds = living
    ? (current?.dwellByRoom.find((item) => item.id === living.id || item.name === living.name)
        ?.totalSeconds ??
      sequences
        .filter((item) => roomIn(item, living))
        .reduce((sum, item) => sum + item.durationSeconds, 0))
    : 0;
  if (livingSeconds >= 120)
    sentences.push(
      t('mobileWelcomePanel.theySpentAboutInThe', { duration: duration(livingSeconds) }),
    );
  const lunch = kitchen
    ? sequences.find(
        (sequence) =>
          hour(sequence.startedAt) >= 11 &&
          hour(sequence.startedAt) < 14 &&
          roomIn(sequence, kitchen),
      )
    : null;
  const afternoon = Boolean(
    living &&
    sequences.some(
      (sequence) =>
        hour(sequence.startedAt) >= 12 && hour(sequence.startedAt) < 20 && roomIn(sequence, living),
    ),
  );
  const fridge = data.cards.find(
    (card) =>
      card.kind === 'FRIDGE' &&
      card.observedToday &&
      card.lastObservedAt &&
      hour(card.lastObservedAt) >= 11 &&
      hour(card.lastObservedAt) < 14,
  );
  const lunchAt = lunch?.endedAt ?? fridge?.lastObservedAt;
  if (lunchAt)
    sentences.push(
      afternoon
        ? t('mobileWelcomePanel.lunchThenAfternoon', { at: natural(lunchAt) })
        : t('mobileWelcomePanel.lunch', { at: natural(lunchAt) }),
    );
  else if (afternoon) sentences.push(t('mobileWelcomePanel.theyThenSpentTheAfternoon'));
  if (!sentences.length) return t('mobileWelcomePanel.sDayIsStartingQuietly', { resident });
  return sentences.slice(0, 3).join(' ');
}

function essentialCards(data: HomeSummary, now: Date): SensorCard[] {
  const cards: SensorCard[] = [];
  const entranceRoom = data.roomSummaries.find(
    (candidate) => candidate.name === data.entrance?.roomName || candidate.kind === 'ENTRANCE',
  );
  const entry = entranceRoom?.sensors.find(({ capability }) => capability === 'contact');
  if (data.entrance)
    cards.push({
      id: 'main-entry',
      title: t('mobileWelcomePanel.frontDoor'),
      value: !entry?.available
        ? t('mobileWelcomePanel.unavailable')
        : entry.state === 'ACTIVE'
          ? t('mobileWelcomePanel.open')
          : entry.state === 'INACTIVE'
            ? t('mobileWelcomePanel.closed')
            : t('mobileWelcomePanel.unknownState'),
      detail: t('mobileWelcomePanel.currentState'),
      icon: DoorOpen,
      tone: 'entrance',
      available: Boolean(entry?.available),
      roomId: entranceRoom?.roomId ?? null,
    });
  const fridge = data.cards.find(({ kind }) => kind === 'FRIDGE');
  if (fridge) {
    const room = data.roomSummaries.find(({ name }) => name === fridge.label);
    cards.push({
      id: fridge.id,
      title: t('mobileWelcomePanel.refrigerator'),
      value: !fridge.available
        ? t('mobileWelcomePanel.unavailable')
        : fridge.state === 'ACTIVE'
          ? t('mobileWelcomePanel.open2')
          : fridge.state === 'INACTIVE'
            ? t('mobileWelcomePanel.closed2')
            : t('mobileWelcomePanel.unknownState'),
      detail: t('mobileWelcomePanel.openingsToday', { count: fridge.countToday }),
      icon: Refrigerator,
      tone: 'fridge',
      available: fridge.available,
      roomId: room?.roomId ?? null,
    });
  }
  const toilet = data.cards.find(({ kind }) => kind === 'TOILET');
  if (toilet) {
    const room = data.roomSummaries.find(({ name }) => name === toilet.label);
    cards.push({
      id: toilet.id,
      title: t('mobileWelcomePanel.toilet'),
      value: !toilet.available
        ? t('mobileWelcomePanel.unavailable')
        : toilet.countToday
          ? t('mobileWelcomePanel.visitDetected')
          : t('mobileWelcomePanel.noVisit'),
      detail: t('mobileWelcomePanel.visitsToday', { count: toilet.countToday }),
      icon: Toilet,
      tone: 'toilet',
      available: toilet.available,
      roomId: room?.roomId ?? null,
    });
  }
  const bathroom = data.roomSummaries.find(({ kind }) => kind === 'BATHROOM');
  if (bathroom) {
    const humidity = bathroom.sensors.find(({ capability }) => capability === 'humidity');
    const shower = bathroom.shower;
    const configured = Boolean(humidity);
    const unavailable = !humidity?.available || shower?.state === 'UNAVAILABLE';
    const status =
      shower?.state === 'IN_PROGRESS'
        ? t('mobileWelcomePanel.showerInProgress')
        : shower?.state === 'RISING'
          ? t('mobileWelcomePanel.humidityRising')
          : shower?.state === 'COMPLETED'
            ? t('mobileWelcomePanel.showerCompleted')
            : shower?.state === 'IDLE'
              ? t('mobileWelcomePanel.noShowerDetected')
              : t('mobileWelcomePanel.unavailable');
    const extra =
      shower?.durationMinutes != null
        ? `${shower.durationMinutes} min`
        : shower?.currentHumidity != null
          ? `${Math.round(shower.currentHumidity)} %`
          : t('mobileWelcomePanel.noRecentObservation');
    cards.push({
      id: `shower:${bathroom.roomId}`,
      title: t('mobileWelcomePanel.shower'),
      value: !configured
        ? t('mobileWelcomePanel.setupRequired')
        : unavailable
          ? t('mobileWelcomePanel.unavailable')
          : status,
      detail: !configured
        ? t('mobileWelcomePanel.assignAHumiditySensor')
        : `${extra}${shower?.updatedAt ? ` · ${new Date(shower.updatedAt).toLocaleTimeString(dateLocale(), { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' })}` : ''}`,
      icon: ShowerHead,
      tone: 'shower',
      available: configured ? !unavailable : null,
      roomId: bathroom.roomId,
    });
  }
  const bedroom = data.rooms.find(({ kind }) => kind === 'BEDROOM');
  const sleep = data.sleep;
  const roomId = sleep?.roomId ?? bedroom?.id ?? null;
  for (const kind of ['bedtime', 'wake-up'] as const) {
    const configured = Boolean(sleep?.configured);
    const value = kind === 'bedtime' ? sleep?.bedtimeAt : sleep?.wakeAt;
    cards.push({
      id: kind,
      title:
        kind === 'bedtime'
          ? t('mobileWelcomePanel.yesterdaySBedtime')
          : t('mobileWelcomePanel.todaySWakeUp'),
      value: !configured
        ? t('mobileWelcomePanel.setupRequired')
        : value
          ? new Date(value).toLocaleTimeString(dateLocale(), {
              timeZone: data.timezone,
              hour: '2-digit',
              minute: '2-digit',
            })
          : t('mobileWelcomePanel.awaitingObservation'),
      detail: !configured
        ? t('mobileWelcomePanel.assignTheBedContact')
        : !sleep?.available
          ? t('mobileWelcomePanel.sensorUnavailable')
          : value
            ? kind === 'bedtime'
              ? t('mobileWelcomePanel.bedtimeObservedLastNight')
              : t('mobileWelcomePanel.wakeUpObservedToday')
            : kind === 'bedtime'
              ? t('mobileWelcomePanel.noBedtimeNoticedLastNight')
              : t('mobileWelcomePanel.noWakeUpNoticedToday'),
      icon: kind === 'bedtime' ? MoonStar : Sunrise,
      tone: kind === 'bedtime' ? 'bedtime' : 'wakeup',
      available: configured ? Boolean(sleep?.available) : null,
      roomId,
    });
  }
  void now;
  return cards;
}

export function MobileWelcomePanel({
  server,
  token,
  userName,
  locale,
  overview,
  homeSummary,
  screen,
  schedule,
  activity,
  refreshing,
  connectionAvailable,
  onStartCall,
  onRefresh,
  onNavigate,
}: {
  server: SavedServer;
  token: string;
  userName: string;
  locale: Language;
  overview?: Overview;
  homeSummary?: HomeSummary;
  screen?: ScreenSnapshot;
  schedule: ScheduleItem[];
  activity: ActivityItem[];
  refreshing: boolean;
  connectionAvailable: boolean;
  onStartCall: () => Promise<void>;
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
}) {
  const tabBarPadding = useTabBarPadding(34);
  const [now, setNow] = useState(() => new Date());
  const [callConfirmOpen, setCallConfirmOpen] = useState(false);
  const [callPending, setCallPending] = useState(false);
  const [callError, setCallError] = useState('');
  const timezone = homeSummary?.timezone ?? screen?.timezone ?? 'Europe/Paris';
  const today = dateKeyInZone(now, timezone);
  const previousDate = shiftDate(today, -1);
  const previousSummary = useQuery({
    queryKey: ['elise', server.id, 'activity-summary-day', previousDate],
    queryFn: () => mobileApi.activitySummary(server, token, previousDate),
    enabled: Boolean(homeSummary),
  });
  const todaySummary = useQuery({
    queryKey: ['elise', server.id, 'activity-summary-day', today],
    queryFn: () => mobileApi.activitySummary(server, token, today),
    enabled: Boolean(homeSummary),
  });
  const time = (value: string | Date | number) =>
    new Date(value).toLocaleTimeString(dateLocale(), {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  const resident =
    homeSummary?.residentName || overview?.home?.resident || screen?.resident || 'Élise';
  const firstName = userName.trim().split(/\s+/)[0] || userName;
  const playback = screen?.state.playback;
  const playingMedia =
    screen?.online &&
    !screen?.state.call &&
    playback?.mediaId &&
    !playback.paused &&
    !playback.asleep
      ? (screen?.state.media.find((media) => media.id === playback.mediaId) ?? null)
      : null;
  const tomorrow = shiftDate(today, 1);
  const nextAppointment = schedule
    .filter((item) => {
      if (item.type !== 'APPOINTMENT') return false;
      const startsAt = Date.parse(item.startsAt);
      if (!Number.isFinite(startsAt)) return false;
      const endsAt = item.endsAt ? Date.parse(item.endsAt) : startsAt;
      const day = dateKeyInZone(new Date(startsAt), timezone);
      return endsAt >= now.getTime() && (day === today || day === tomorrow);
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const playingTitle =
    playingMedia?.title.trim() ||
    (playingMedia?.kind === 'photo'
      ? t('mobileWelcomePanel.photoSlideshow')
      : t('mobileWelcomePanel.nowPlaying'));
  const appointmentDay = nextAppointment
    ? dateKeyInZone(new Date(nextAppointment.startsAt), timezone) === today
      ? t('mobileWelcomePanel.today')
      : t('mobileWelcomePanel.tomorrow')
    : '';
  const essentials = useMemo(
    () => (homeSummary ? essentialCards(homeSummary, now) : []),
    // locale: the cards are texts in the chosen language.
    [homeSummary, locale, now],
  );
  const recentEvents = [...activity]
    .filter(({ capability }) => capability !== 'illuminance')
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 5);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const greetingDate = new Intl.DateTimeFormat(dateLocale(), {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const connectionLabel = connectionAvailable
    ? t('mobileWelcomePanel.online')
    : t('mobileWelcomePanel.offline');
  const canStartCall = Boolean(
    connectionAvailable &&
    screen?.grant.call &&
    screen.online &&
    !screen.state.call &&
    screen.state.settings.consent,
  );
  const presence = homeSummary
    ? mobilePresenceText(homeSummary)
    : caregiverPresenceCopy(null).detail;
  const lastPresence = homeSummary?.latestPresence
    ? (() => {
        const room = homeSummary.rooms.find(({ id }) => id === homeSummary.latestPresence?.roomId);
        return room
          ? t('mobileWelcomePanel.lastDetectedInAt', {
              roomLabel: roomLabel(room),
              time: time(homeSummary.latestPresence.occurredAt),
            })
          : '';
      })()
    : '';
  const narrative = homeSummary
    ? dayNarrative(homeSummary, todaySummary.data, previousSummary.data)
    : t('mobileWelcomePanel.theDaySSummaryIs');
  const appointmentTime = nextAppointment ? time(nextAppointment.startsAt) : '';
  const launchCall = async () => {
    if (!canStartCall || callPending) return;
    setCallPending(true);
    setCallError('');
    try {
      await onStartCall();
      setCallConfirmOpen(false);
    } catch (cause) {
      setCallError(
        cause instanceof Error ? cause.message : t('mobileWelcomePanel.theCallCouldNotBe'),
      );
    } finally {
      setCallPending(false);
    }
  };

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, tabBarPadding]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} />
        }
      >
        <View style={s.header}>
          <View style={s.headerCopy}>
            <Text style={s.eyebrow}>{greetingDate}</Text>
            <View style={s.greetingRow}>
              <Text style={s.greeting}>
                {t('mobileWelcomePanel.hello')} {firstName},
              </Text>
              <View style={s.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    homeSummary?.alert
                      ? t('mobileWelcomePanel.alertsAnItemNeedsAttention')
                      : t('mobileWelcomePanel.alerts')
                  }
                  accessibilityHint={t('mobileWelcomePanel.opensTheAlertsPage')}
                  style={s.headerIconButton}
                  onPress={() => onNavigate('alerts')}
                >
                  <Ionicons
                    name="notifications-outline"
                    size={21}
                    color={homeSummary?.alert ? c.amber : c.blue}
                  />
                  {homeSummary?.alert ? <View style={s.notificationDot} /> : null}
                </Pressable>
                {screen?.grant.call ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('mobileWelcomePanel.call', { resident })}
                    accessibilityHint={t('mobileWelcomePanel.opensAConfirmationBeforeStarting')}
                    disabled={!canStartCall || callPending}
                    style={[
                      s.headerIconButton,
                      (!canStartCall || callPending) && s.callIconButtonDisabled,
                    ]}
                    onPress={() => {
                      setCallError('');
                      setCallConfirmOpen(true);
                    }}
                  >
                    <Ionicons
                      name="call-outline"
                      size={21}
                      color={canStartCall ? c.green : c.muted}
                    />
                  </Pressable>
                ) : null}
                <View
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={connectionLabel}
                  style={[
                    s.connectionBadge,
                    connectionAvailable ? s.connectedBadge : s.disconnectedBadge,
                  ]}
                >
                  <View
                    style={[
                      s.connectionDot,
                      connectionAvailable ? s.connectedDot : s.disconnectedDot,
                    ]}
                  />
                  <Text
                    style={[
                      s.connectionBadgeText,
                      connectionAvailable ? s.connectedBadgeText : s.disconnectedBadgeText,
                    ]}
                  >
                    {connectionLabel}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={s.subtitle}>
              {t('mobileWelcomePanel.eliseIsWatchingOver', { resident })}
            </Text>
          </View>
        </View>

        {playingMedia ? (
          <View style={s.infoLine}>
            <View style={[s.infoIcon, s.tvInfoIcon]}>
              <Ionicons name="tv-outline" size={18} color={c.blue} />
            </View>
            <View style={s.infoCopy}>
              <Text style={s.infoHeading}>{t('mobileWelcomePanel.nowPlayingOnTv')}</Text>
              <Text style={s.infoTitle} numberOfLines={1}>
                {playingTitle}
              </Text>
            </View>
            <Ionicons name="play-circle" size={19} color={c.accent} />
          </View>
        ) : null}
        {nextAppointment ? (
          <View style={s.infoLine}>
            <View style={[s.infoIcon, s.appointmentInfoIcon]}>
              <Ionicons name="medical-outline" size={18} color={c.green} />
            </View>
            <View style={s.infoCopy}>
              <Text style={s.infoHeading}>
                {t('mobileWelcomePanel.appointment', {
                  appointmentDay: appointmentDay.toUpperCase(),
                })}
              </Text>
              <Text style={s.infoTitle} numberOfLines={1}>
                {nextAppointment.title}
              </Text>
            </View>
            <Text style={s.infoTime}>{appointmentTime}</Text>
          </View>
        ) : null}

        {homeSummary ? (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={[s.statusDot, homeSummary.alert && s.statusDotWarning]} />
              <Text style={s.cardTitle}>{t('mobileWelcomePanel.rightNow')}</Text>
              <Text style={s.timePill}>{time(homeSummary.to)}</Text>
            </View>
            <Text style={s.presenceText}>{presence}</Text>
            {lastPresence ? <Text style={s.body}>{lastPresence}</Text> : null}
            {homeSummary.alert ? (
              <Pressable style={s.alertBanner} onPress={() => onNavigate('alerts')}>
                <Ionicons name="alert-circle-outline" size={17} color={c.amber} />
                <Text style={s.alertBannerText}>
                  {homeSummary.alert.title}
                  {homeSummary.alert.roomName ? ` · ${homeSummary.alert.roomName}` : ''}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={c.accent} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.cardTitle}>{t('mobileWelcomePanel.rightNow')}</Text>
            <Text style={s.body}>{t('mobileWelcomePanel.homeInformationIsUnavailable')}</Text>
          </View>
        )}

        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.statusDot} />
            <Text style={s.cardTitle}>
              {t('mobileWelcomePanel.sDay', { split: resident.split(/\s+/)[0] })}
            </Text>
          </View>
          <Text style={s.bodyLarge}>{narrative}</Text>
          <Pressable style={s.linkRow} onPress={() => onNavigate('activity')}>
            <Text style={s.link}>{t('mobileWelcomePanel.viewAllActivity')}</Text>
            <Ionicons name="chevron-forward" size={17} color={c.blue} />
          </Pressable>
        </View>

        <View style={[s.card, s.essentialsCard]}>
          <Svg
            pointerEvents="none"
            width="100%"
            height="100%"
            style={StyleSheet.absoluteFill}
            preserveAspectRatio="none"
          >
            <Defs>
              <LinearGradient id="dailyEssentialsBackground" x1="0%" y1="100%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor="#FFFFFF" />
                <Stop offset="100%" stopColor="#F8FAF9" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#dailyEssentialsBackground)" />
          </Svg>
          <View style={s.cardHeader}>
            <View style={[s.statusDot, s.essentialsDot]} />
            <Text style={[s.cardTitle, s.essentialsTitle]}>
              {t('mobileWelcomePanel.dailyEssentials')}
            </Text>
          </View>
          {essentials.length ? (
            <View style={s.sensorGrid}>
              {essentials.map((item) => {
                const Icon = item.icon;
                return (
                  <Pressable
                    key={item.id}
                    style={s.sensorCard}
                    onPress={() => (item.roomId ? onNavigate('house') : onNavigate('house'))}
                  >
                    <Icon size={30} strokeWidth={1.9} color={sensorToneColors[item.tone]} />
                    <View style={s.sensorCopy}>
                      <Text style={s.sensorTitle}>{item.title}</Text>
                      <Text style={s.sensorValue}>{item.value}</Text>
                      <Text style={s.sensorDetail}>{item.detail}</Text>
                    </View>
                    {item.available !== null ? (
                      <View
                        style={[
                          s.healthDot,
                          s.sensorHealthDot,
                          { backgroundColor: item.available ? '#359457' : '#AAABB0' },
                        ]}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={s.body}>{t('mobileWelcomePanel.dailyEssentialsWillAppearHere')}</Text>
          )}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="time-outline" size={18} color={c.accent} />
            <Text style={s.cardTitle}>{t('mobileWelcomePanel.latestEvents')}</Text>
            <Pressable onPress={() => onNavigate('activity')}>
              <Text style={s.link}>{t('mobileWelcomePanel.viewAll')}</Text>
            </Pressable>
          </View>
          {recentEvents.map((item) => (
            <EventRow key={item.id} item={item} timezone={timezone} />
          ))}
          {!recentEvents.length ? (
            <Text style={s.body}>{t('mobileWelcomePanel.noRecentEvents')}</Text>
          ) : null}
        </View>
      </ScrollView>
      <Modal
        visible={callConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCallConfirmOpen(false)}
      >
        <View style={s.callModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileWelcomePanel.closeCallConfirmation')}
            style={s.callModalScrim}
            onPress={() => setCallConfirmOpen(false)}
          />
          <View style={s.callModalCard}>
            <View style={s.callModalIcon}>
              <Ionicons name="videocam-outline" size={22} color={c.blue} />
            </View>
            <Text style={s.callModalTitle}>{`${t('mobileWelcomePanel.call2')} ${resident} ?`}</Text>
            <Text style={s.callModalBody}>
              {t('mobileWelcomePanel.theCallWillStartFrom', { resident })}
            </Text>
            {callError ? (
              <Text accessibilityRole="alert" style={s.callModalError}>
                {callError}
              </Text>
            ) : null}
            <View style={s.callModalActions}>
              <Pressable
                disabled={callPending}
                style={[
                  s.callModalButton,
                  s.callModalCancel,
                  callPending && s.callModalButtonDisabled,
                ]}
                onPress={() => setCallConfirmOpen(false)}
              >
                <Text style={s.callModalCancelText}>{t('mobileWelcomePanel.cancel')}</Text>
              </Pressable>
              <Pressable
                disabled={!canStartCall || callPending}
                style={[
                  s.callModalButton,
                  s.callModalConfirm,
                  (!canStartCall || callPending) && s.callModalButtonDisabled,
                ]}
                onPress={() => void launchCall()}
              >
                <Text style={s.callModalConfirmText}>
                  {callPending ? t('mobileWelcomePanel.starting') : t('mobileWelcomePanel.confirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function EventRow({ item, timezone }: { item: ActivityItem; timezone: string }) {
  const icon =
    item.capability === 'contact'
      ? 'enter-outline'
      : item.capability === 'temperature'
        ? 'thermometer-outline'
        : item.capability === 'humidity'
          ? 'water-outline'
          : item.capability === 'button'
            ? 'radio-button-on-outline'
            : ['motion', 'occupancy', 'person_presence'].includes(item.capability)
              ? 'walk-outline'
              : 'pulse-outline';
  return (
    <View style={s.eventRow}>
      <View style={s.eventIcon}>
        <Ionicons name={icon} size={17} color={c.blue} />
      </View>
      <View style={s.flex}>
        <Text style={s.eventTitle}>
          {capabilityLabel(item.capability)} · {roomOf(item)}
        </Text>
        <Text style={s.caption}>
          {friendlyValue(item.payload) ?? relativeTime(item.occurredAt)}
        </Text>
      </View>
      <Text style={s.caption}>
        {new Date(item.occurredAt).toLocaleTimeString(dateLocale(), {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
    </View>
  );
}
function capabilityLabel(capability: string) {
  return (
    (
      {
        motion: t('mobileWelcomePanel.motion'),
        occupancy: t('mobileWelcomePanel.presence'),
        person_presence: t('mobileWelcomePanel.presence'),
        contact: t('mobileWelcomePanel.opening'),
        temperature: t('mobileWelcomePanel.temperature'),
        humidity: t('mobileWelcomePanel.humidity'),
        power: t('mobileWelcomePanel.power'),
        energy: t('mobileWelcomePanel.energy'),
        button: t('mobileWelcomePanel.callButton'),
      } as Record<string, string>
    )[capability] ?? capability
  );
}
const s = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 34, gap: 12, backgroundColor: c.cream },
  infoLine: {
    minHeight: 58,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: c.paper,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tvInfoIcon: { backgroundColor: c.paleBlue },
  appointmentInfoIcon: { backgroundColor: c.paleGreen },
  infoCopy: { flex: 1, gap: 2 },
  infoHeading: { color: c.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.45 },
  infoTitle: { color: c.navy, fontSize: 13, fontWeight: '900' },
  infoTime: { color: c.blue, fontSize: 13, fontWeight: '900' },
  header: { gap: 10 },
  headerCopy: { gap: 3 },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  flex: { flex: 1 },
  eyebrow: { color: c.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  greeting: { color: c.navy, flexShrink: 1, fontFamily: 'Georgia', fontSize: 29 },
  connectionBadge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 0,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  connectedBadge: { backgroundColor: c.paleGreen, borderColor: '#C8DDCF' },
  disconnectedBadge: { backgroundColor: '#F9E8E7', borderColor: '#E9C7C5' },
  connectionBadgeText: { fontSize: 13, fontWeight: '800' },
  connectedBadgeText: { color: c.green },
  disconnectedBadgeText: { color: c.red },
  connectionDot: { width: 8, height: 8, borderRadius: 4 },
  connectedDot: { backgroundColor: c.green },
  disconnectedDot: { backgroundColor: c.red },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#C8DDCF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  notificationDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: c.paper,
    backgroundColor: c.red,
  },
  callIconButtonDisabled: { opacity: 0.5 },
  callModalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  callModalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 27, 46, 0.48)',
  },
  callModalCard: {
    width: '100%',
    maxWidth: 370,
    padding: 18,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 20,
    alignItems: 'center',
    gap: 11,
    backgroundColor: c.paper,
  },
  callModalIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  callModalTitle: { color: c.navy, textAlign: 'center', fontFamily: 'Georgia', fontSize: 22 },
  callModalBody: { color: c.muted, textAlign: 'center', fontSize: 14, lineHeight: 22 },
  callModalError: {
    width: '100%',
    padding: 9,
    borderRadius: 10,
    color: c.red,
    backgroundColor: '#F9E8E7',
    fontSize: 13,
  },
  callModalActions: { width: '100%', flexDirection: 'row', gap: 8, marginTop: 2 },
  callModalButton: {
    minHeight: 44,
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callModalButtonDisabled: { opacity: 0.5 },
  callModalCancel: { borderWidth: 1, borderColor: c.line, backgroundColor: c.cream },
  callModalConfirm: { backgroundColor: c.blue },
  callModalCancelText: { color: c.navy, fontSize: 14, fontWeight: '800' },
  callModalConfirmText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  subtitle: { color: c.muted, fontSize: 14 },
  caption: { color: c.muted, fontSize: 12, lineHeight: 18 },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    gap: 11,
  },
  essentialsCard: {
    overflow: 'hidden',
    borderColor: '#E5EBE8',
    backgroundColor: '#F8FAF9',
  },
  essentialsTitle: { color: '#102F59' },
  essentialsDot: {
    backgroundColor: '#329258',
    shadowColor: '#33995F',
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, color: c.navy, fontSize: 16, fontWeight: '900' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
  statusDotWarning: { backgroundColor: c.amber },
  timePill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 11,
    color: c.accent,
    backgroundColor: c.paleBlue,
    fontSize: 11,
    fontWeight: '800',
  },
  presenceText: { color: c.navy, fontFamily: 'Georgia', fontSize: 22, lineHeight: 30 },
  body: { color: c.muted, fontSize: 13, lineHeight: 21 },
  bodyLarge: { color: c.muted, fontSize: 14, lineHeight: 23 },
  alertBanner: {
    minHeight: 41,
    paddingHorizontal: 10,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFF8E8',
  },
  alertBannerText: { flex: 1, color: '#795418', fontSize: 12, fontWeight: '800' },
  linkRow: {
    minHeight: 33,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: { color: c.blue, fontSize: 13, fontWeight: '900' },
  sensorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sensorCard: {
    width: '48%',
    minHeight: 89,
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8EEEA',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    alignItems: 'flex-start',
    gap: 8,
  },
  sensorCopy: { alignSelf: 'stretch', minWidth: 0 },
  sensorTitle: { color: '#253956', fontSize: 14, fontWeight: '700', lineHeight: 19 },
  sensorValue: { marginTop: 3, color: '#4F5D70', fontSize: 13, lineHeight: 18 },
  sensorDetail: { marginTop: 2, color: '#55677B', fontSize: 12, lineHeight: 16 },
  healthDot: { width: 7, height: 7, borderRadius: 4 },
  sensorHealthDot: { position: 'absolute', right: 11, top: 12 },
  eventRow: {
    minHeight: 53,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventIcon: {
    width: 33,
    height: 33,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  eventTitle: { color: c.navy, fontSize: 12, fontWeight: '800' },
});
