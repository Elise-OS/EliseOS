import { Ionicons } from '@expo/vector-icons';
import { DoorOpen, MoonStar, Refrigerator, ShowerHead, Sunrise, Toilet } from 'lucide-react-native';
import {
  type ActivitySequence,
  type ActivitySummary,
  type HomeSummary,
  type ScheduleItem,
  type ScreenSnapshot,
} from '@michel/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { mobileApi, type ActivityItem, type Overview } from '../api';
import type { SavedServer } from '../discovery/types';
import { caregiverPresenceCopy } from './presence-copy';
import { friendlyValue, relativeTime, roomOf } from './formatters';
import { dateKeyInZone, shiftDate } from './homeDates';

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

function roomLabel(room: Pick<HomeSummary['rooms'][number], 'kind' | 'name'>, locale: 'fr' | 'en') {
  if (locale !== 'fr') return room.name;
  const labels: Record<string, string> = {
    LIVING_ROOM: 'le salon',
    KITCHEN: 'la cuisine',
    BEDROOM: 'la chambre',
    BATHROOM: 'la salle de bain',
    TOILET: 'les toilettes',
    ENTRANCE: 'l’entrée',
    HALLWAY: 'le couloir',
    DINING_ROOM: 'la salle à manger',
    GARAGE: 'le garage',
    GARDEN: 'le jardin',
    TERRACE: 'la terrasse',
  };
  return labels[room.kind] ?? `la pièce « ${room.name} »`;
}

function mobilePresenceText(data: HomeSummary, locale: 'fr' | 'en') {
  const fr = locale === 'fr';
  const resident = data.residentName || (fr ? 'Le résident' : 'The resident');
  if (
    data.entrance?.state === 'EXIT_LIKELY' &&
    data.presence.trackingState !== 'AMBIGUOUS' &&
    !data.presence.trackingDegraded
  )
    return fr
      ? 'Une sortie du logement semble avoir été repérée à la porte d’entrée.'
      : 'A departure from the home seems to have been noticed at the front door.';
  const latest = data.latestPresence
    ? data.rooms.find(({ id }) => id === data.latestPresence?.roomId)
    : null;
  if (latest)
    return fr
      ? `${resident} est dans ${roomLabel(latest, locale)}.`
      : `${resident} is in ${latest.name}.`;
  const currentRoom = data.rooms.find(
    ({ id }) => id === (data.presence.confirmedRoomId ?? data.presence.roomId),
  );
  if (data.presence.trackingState === 'CONFIRMED' && !data.presence.trackingDegraded && currentRoom)
    return fr
      ? `${resident} est dans ${roomLabel(currentRoom, locale)}.`
      : `${resident} is in ${currentRoom.name}.`;
  if (data.presence.trackingState === 'IN_TRANSIT')
    return fr
      ? `${resident} semble se déplacer dans le logement.`
      : `${resident} appears to be moving through the home.`;
  if (data.presence.trackingState === 'AMBIGUOUS' || data.presence.trackingDegraded)
    return fr
      ? 'Les dernières observations ne permettent pas encore de situer le résident précisément.'
      : 'The latest observations do not yet locate the resident precisely.';
  if (currentRoom && data.presence.lastConfirmedAt) {
    const at = new Date(data.presence.lastConfirmedAt).toLocaleTimeString(
      locale === 'fr' ? 'fr-FR' : 'en-GB',
      { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' },
    );
    return fr
      ? `${resident} se trouve probablement dans ${roomLabel(currentRoom, locale)}. Dernière détection à ${at}.`
      : `${resident} is probably in ${currentRoom.name}. Last detected at ${at}.`;
  }
  return fr
    ? `Il n’y a pas encore assez d’informations pour situer ${resident}.`
    : `There is not enough information to locate ${resident} yet.`;
}

function duration(seconds: number, locale: 'fr' | 'en') {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return locale === 'fr'
    ? `${hours} h${rest ? ` ${rest} min` : ''}`
    : `${hours} hr${rest ? ` ${rest} min` : ''}`;
}
function roomIn(sequence: ActivitySequence, room: HomeSummary['rooms'][number]) {
  return sequence.roomIds.includes(room.id) || sequence.roomNames.includes(room.name);
}
function dayNarrative(
  data: HomeSummary,
  current: ActivitySummary | undefined,
  previous: ActivitySummary | undefined,
  locale: 'fr' | 'en',
) {
  const fr = locale === 'fr';
  const resident = data.residentName || (fr ? 'Le résident' : 'The resident');
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
      kind === 'KITCHEN' || name.toLocaleLowerCase(locale).includes(fr ? 'cuisine' : 'kitchen'),
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
    new Date(value).toLocaleTimeString(fr ? 'fr-FR' : 'en-GB', {
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
      fr
        ? `Coucher hier vers ${natural(bedtime)}, réveil ce matin vers ${natural(wakeUp)}.`
        : `${resident} went to bed around ${natural(bedtime)} last night and woke up around ${natural(wakeUp)} this morning.`,
    );
  else if (wakeUp)
    sentences.push(
      fr
        ? `Réveil ce matin vers ${natural(wakeUp)}.`
        : `${resident} woke up around ${natural(wakeUp)} this morning.`,
    );
  const livingSeconds = living
    ? (current?.dwellByRoom.find((item) => item.id === living.id || item.name === living.name)
        ?.totalSeconds ??
      sequences
        .filter((item) => roomIn(item, living))
        .reduce((sum, item) => sum + item.durationSeconds, 0))
    : 0;
  if (livingSeconds >= 120)
    sentences.push(
      fr
        ? `Environ ${duration(livingSeconds, locale)} passées dans le salon.`
        : `They spent about ${duration(livingSeconds, locale)} in the living room.`,
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
      fr
        ? `Vers ${natural(lunchAt)}, déjeuner dans la cuisine${afternoon ? ', puis retour au salon pour l’après-midi' : ''}.`
        : `Around ${natural(lunchAt)}, they went to the kitchen for lunch${afternoon ? ', then returned to the living room for the afternoon' : ''}.`,
    );
  else if (afternoon)
    sentences.push(
      fr ? 'Après-midi passé dans le salon.' : 'They then spent the afternoon in the living room.',
    );
  if (!sentences.length)
    return fr
      ? `La journée de ${resident} commence doucement. Le résumé s’enrichira avec les prochaines observations fiables.`
      : `${resident}’s day is starting quietly. This summary will grow as reliable observations arrive.`;
  return sentences.slice(0, 3).join(' ');
}

function essentialCards(data: HomeSummary, locale: 'fr' | 'en', now: Date): SensorCard[] {
  const fr = locale === 'fr';
  const cards: SensorCard[] = [];
  const entranceRoom = data.roomSummaries.find(
    (candidate) => candidate.name === data.entrance?.roomName || candidate.kind === 'ENTRANCE',
  );
  const entry = entranceRoom?.sensors.find(({ capability }) => capability === 'contact');
  if (data.entrance)
    cards.push({
      id: 'main-entry',
      title: fr ? 'Porte d’entrée' : 'Front door',
      value: !entry?.available
        ? fr
          ? 'Indisponible'
          : 'Unavailable'
        : entry.state === 'ACTIVE'
          ? fr
            ? 'Ouverte'
            : 'Open'
          : entry.state === 'INACTIVE'
            ? fr
              ? 'Fermée'
              : 'Closed'
            : fr
              ? 'État inconnu'
              : 'Unknown state',
      detail: fr ? 'État actuel' : 'Current state',
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
      title: fr ? 'Réfrigérateur' : 'Refrigerator',
      value: !fridge.available
        ? fr
          ? 'Indisponible'
          : 'Unavailable'
        : fridge.state === 'ACTIVE'
          ? fr
            ? 'Ouvert'
            : 'Open'
          : fridge.state === 'INACTIVE'
            ? fr
              ? 'Fermé'
              : 'Closed'
            : fr
              ? 'État inconnu'
              : 'Unknown state',
      detail: fr
        ? `${fridge.countToday} ouverture${fridge.countToday === 1 ? '' : 's'} aujourd’hui`
        : `${fridge.countToday} opening${fridge.countToday === 1 ? '' : 's'} today`,
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
      title: fr ? 'Toilettes' : 'Toilet',
      value: !toilet.available
        ? fr
          ? 'Indisponible'
          : 'Unavailable'
        : toilet.countToday
          ? fr
            ? 'Passage repéré'
            : 'Visit detected'
          : fr
            ? 'Aucun passage'
            : 'No visit',
      detail: fr
        ? `${toilet.countToday} passage${toilet.countToday === 1 ? '' : 's'} aujourd’hui`
        : `${toilet.countToday} visit${toilet.countToday === 1 ? '' : 's'} today`,
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
        ? fr
          ? 'Douche en cours'
          : 'Shower in progress'
        : shower?.state === 'RISING'
          ? fr
            ? 'Humidité en hausse'
            : 'Humidity rising'
          : shower?.state === 'COMPLETED'
            ? fr
              ? 'Douche terminée'
              : 'Shower completed'
            : shower?.state === 'IDLE'
              ? fr
                ? 'Aucune douche repérée'
                : 'No shower detected'
              : fr
                ? 'Indisponible'
                : 'Unavailable';
    const extra =
      shower?.durationMinutes != null
        ? `${shower.durationMinutes} min`
        : shower?.currentHumidity != null
          ? `${Math.round(shower.currentHumidity)} %`
          : fr
            ? 'Aucune observation récente'
            : 'No recent observation';
    cards.push({
      id: `shower:${bathroom.roomId}`,
      title: fr ? 'Douche' : 'Shower',
      value: !configured
        ? fr
          ? 'À configurer'
          : 'Setup required'
        : unavailable
          ? fr
            ? 'Indisponible'
            : 'Unavailable'
          : status,
      detail: !configured
        ? fr
          ? 'Associer un capteur d’humidité'
          : 'Assign a humidity sensor'
        : `${extra}${shower?.updatedAt ? ` · ${new Date(shower.updatedAt).toLocaleTimeString(fr ? 'fr-FR' : 'en-GB', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' })}` : ''}`,
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
          ? fr
            ? 'Coucher de la veille'
            : 'Yesterday’s bedtime'
          : fr
            ? 'Réveil du jour'
            : 'Today’s wake-up',
      value: !configured
        ? fr
          ? 'À configurer'
          : 'Setup required'
        : value
          ? new Date(value).toLocaleTimeString(fr ? 'fr-FR' : 'en-GB', {
              timeZone: data.timezone,
              hour: '2-digit',
              minute: '2-digit',
            })
          : fr
            ? 'En attente'
            : 'Awaiting observation',
      detail: !configured
        ? fr
          ? 'Associer le contact du lit'
          : 'Assign the bed contact'
        : !sleep?.available
          ? fr
            ? 'Capteur indisponible'
            : 'Sensor unavailable'
          : value
            ? kind === 'bedtime'
              ? fr
                ? 'Coucher repéré la nuit précédente'
                : 'Bedtime observed last night'
              : fr
                ? 'Réveil repéré aujourd’hui'
                : 'Wake-up observed today'
            : kind === 'bedtime'
              ? fr
                ? 'Aucun coucher repéré la nuit précédente'
                : 'No bedtime noticed last night'
              : fr
                ? 'Aucun réveil repéré aujourd’hui'
                : 'No wake-up noticed today',
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
  locale: 'fr' | 'en';
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
  const [now, setNow] = useState(() => new Date());
  const [callConfirmOpen, setCallConfirmOpen] = useState(false);
  const [callPending, setCallPending] = useState(false);
  const [callError, setCallError] = useState('');
  const timezone = homeSummary?.timezone ?? screen?.timezone ?? 'Europe/Paris';
  const today = dateKeyInZone(now, timezone);
  const previousDate = shiftDate(today, -1);
  const previousSummary = useQuery({
    queryKey: ['michel', server.id, 'activity-summary-day', previousDate],
    queryFn: () => mobileApi.activitySummary(server, token, previousDate),
    enabled: Boolean(homeSummary),
  });
  const todaySummary = useQuery({
    queryKey: ['michel', server.id, 'activity-summary-day', today],
    queryFn: () => mobileApi.activitySummary(server, token, today),
    enabled: Boolean(homeSummary),
  });
  const time = (value: string | Date | number) =>
    new Date(value).toLocaleTimeString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  const resident =
    homeSummary?.residentName || overview?.home?.resident || screen?.resident || 'Élise';
  const firstName = userName.trim().split(/\s+/)[0] || userName;
  const fr = locale === 'fr';
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
      ? fr
        ? 'Diaporama photo'
        : 'Photo slideshow'
      : fr
        ? 'Contenu en cours'
        : 'Now playing');
  const appointmentDay = nextAppointment
    ? dateKeyInZone(new Date(nextAppointment.startsAt), timezone) === today
      ? fr
        ? 'Aujourd’hui'
        : 'Today'
      : fr
        ? 'Demain'
        : 'Tomorrow'
    : '';
  const essentials = useMemo(
    () => (homeSummary ? essentialCards(homeSummary, locale, now) : []),
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
  const greetingDate = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const connectionLabel = connectionAvailable
    ? fr
      ? 'En ligne'
      : 'Online'
    : fr
      ? 'Hors ligne'
      : 'Offline';
  const canStartCall = Boolean(
    connectionAvailable &&
    screen?.grant.call &&
    screen.online &&
    !screen.state.call &&
    screen.state.settings.consent,
  );
  const presence = homeSummary
    ? mobilePresenceText(homeSummary, locale)
    : caregiverPresenceCopy(null).detail;
  const lastPresence = homeSummary?.latestPresence
    ? (() => {
        const room = homeSummary.rooms.find(({ id }) => id === homeSummary.latestPresence?.roomId);
        return room
          ? `Dernière détection dans ${roomLabel(room, locale)} à ${time(homeSummary.latestPresence.occurredAt)}.`
          : '';
      })()
    : '';
  const narrative = homeSummary
    ? dayNarrative(homeSummary, todaySummary.data, previousSummary.data, locale)
    : 'Le résumé de la journée se prépare.';
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
        cause instanceof Error
          ? cause.message
          : fr
            ? 'Impossible de lancer l’appel pour le moment.'
            : 'The call could not be started right now.',
      );
    } finally {
      setCallPending(false);
    }
  };

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.blue} />
        }
      >
        <View style={s.header}>
          <View style={s.headerCopy}>
            <Text style={s.eyebrow}>{greetingDate}</Text>
            <View style={s.greetingRow}>
              <Text style={s.greeting}>Bonjour {firstName},</Text>
              <View style={s.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    homeSummary?.alert
                      ? fr
                        ? 'Alertes, une situation à consulter'
                        : 'Alerts, an item needs attention'
                      : fr
                        ? 'Alertes'
                        : 'Alerts'
                  }
                  accessibilityHint={fr ? 'Ouvre la page Alertes.' : 'Opens the Alerts page.'}
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
                    accessibilityLabel={fr ? `Appeler ${resident}` : `Call ${resident}`}
                    accessibilityHint={
                      fr
                        ? 'Ouvre une confirmation avant l’appel vidéo depuis ce téléphone.'
                        : 'Opens a confirmation before starting a video call from this phone.'
                    }
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
            <Text style={s.subtitle}>Élise veille sur {resident}.</Text>
          </View>
        </View>

        {playingMedia ? (
          <View style={s.infoLine}>
            <View style={[s.infoIcon, s.tvInfoIcon]}>
              <Ionicons name="tv-outline" size={18} color={c.blue} />
            </View>
            <View style={s.infoCopy}>
              <Text style={s.infoHeading}>
                {fr ? 'LECTURE EN COURS SUR LA TV' : 'NOW PLAYING ON TV'}
              </Text>
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
                {fr
                  ? `RENDEZ-VOUS ${appointmentDay.toUpperCase()}`
                  : `APPOINTMENT · ${appointmentDay.toUpperCase()}`}
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
              <Text style={s.cardTitle}>En ce moment</Text>
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
            <Text style={s.cardTitle}>En ce moment</Text>
            <Text style={s.body}>Les informations du logement sont indisponibles.</Text>
          </View>
        )}

        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.statusDot} />
            <Text style={s.cardTitle}>La journée de {resident.split(/\s+/)[0]}</Text>
          </View>
          <Text style={s.bodyLarge}>{narrative}</Text>
          <Pressable style={s.linkRow} onPress={() => onNavigate('activity')}>
            <Text style={s.link}>Voir toute l’activité</Text>
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
            <Text style={[s.cardTitle, s.essentialsTitle]}>Repères du quotidien</Text>
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
            <Text style={s.body}>
              Les repères apparaîtront ici lorsque les données du logement seront disponibles.
            </Text>
          )}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="time-outline" size={18} color={c.accent} />
            <Text style={s.cardTitle}>Derniers événements</Text>
            <Pressable onPress={() => onNavigate('activity')}>
              <Text style={s.link}>Tout voir</Text>
            </Pressable>
          </View>
          {recentEvents.map((item) => (
            <EventRow key={item.id} item={item} timezone={timezone} />
          ))}
          {!recentEvents.length ? <Text style={s.body}>Aucun événement récent.</Text> : null}
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
            accessibilityLabel={fr ? 'Fermer la confirmation d’appel' : 'Close call confirmation'}
            style={s.callModalScrim}
            onPress={() => setCallConfirmOpen(false)}
          />
          <View style={s.callModalCard}>
            <View style={s.callModalIcon}>
              <Ionicons name="videocam-outline" size={22} color={c.blue} />
            </View>
            <Text style={s.callModalTitle}>{`${fr ? 'Appeler' : 'Call'} ${resident} ?`}</Text>
            <Text style={s.callModalBody}>
              {fr
                ? `L’appel partira de ce téléphone. L’écran du logement fera sonner ${resident}, puis répondra automatiquement. La vidéo s’ouvrira ici.`
                : `The call will start from this phone. The home screen will ring ${resident} and answer automatically. Video will open here.`}
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
                <Text style={s.callModalCancelText}>{fr ? 'Annuler' : 'Cancel'}</Text>
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
                  {callPending ? (fr ? 'Lancement…' : 'Starting…') : fr ? 'Confirmer' : 'Confirm'}
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
        {new Date(item.occurredAt).toLocaleTimeString('fr-FR', {
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
        motion: 'Mouvement',
        occupancy: 'Présence',
        person_presence: 'Présence',
        contact: 'Ouverture',
        temperature: 'Température',
        humidity: 'Humidité',
        power: 'Puissance',
        energy: 'Énergie',
        button: 'Bouton d’appel',
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
  infoHeading: { color: c.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.45 },
  infoTitle: { color: c.navy, fontSize: 10, fontWeight: '900' },
  infoTime: { color: c.blue, fontSize: 10, fontWeight: '900' },
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
  eyebrow: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  greeting: { color: c.navy, flexShrink: 1, fontFamily: 'Georgia', fontSize: 27 },
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
  connectionBadgeText: { fontSize: 10, fontWeight: '800' },
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
  callModalTitle: { color: c.navy, textAlign: 'center', fontFamily: 'Georgia', fontSize: 20 },
  callModalBody: { color: c.muted, textAlign: 'center', fontSize: 11, lineHeight: 17 },
  callModalError: {
    width: '100%',
    padding: 9,
    borderRadius: 10,
    color: c.red,
    backgroundColor: '#F9E8E7',
    fontSize: 10,
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
  callModalCancelText: { color: c.navy, fontSize: 11, fontWeight: '800' },
  callModalConfirmText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  subtitle: { color: c.muted, fontSize: 11 },
  caption: { color: c.muted, fontSize: 8, lineHeight: 13 },
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
  cardTitle: { flex: 1, color: c.navy, fontSize: 13, fontWeight: '900' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
  statusDotWarning: { backgroundColor: c.amber },
  timePill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 11,
    color: c.accent,
    backgroundColor: c.paleBlue,
    fontSize: 8,
    fontWeight: '800',
  },
  presenceText: { color: c.navy, fontFamily: 'Georgia', fontSize: 20, lineHeight: 27 },
  body: { color: c.muted, fontSize: 10, lineHeight: 16 },
  bodyLarge: { color: c.muted, fontSize: 11, lineHeight: 18 },
  alertBanner: {
    minHeight: 41,
    paddingHorizontal: 10,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFF8E8',
  },
  alertBannerText: { flex: 1, color: '#795418', fontSize: 9, fontWeight: '800' },
  linkRow: {
    minHeight: 33,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: { color: c.blue, fontSize: 10, fontWeight: '900' },
  sensorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sensorCard: {
    width: '48%',
    minHeight: 89,
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8EEEA',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sensorCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  sensorTitle: { color: '#253956', fontSize: 9, fontWeight: '700', lineHeight: 13 },
  sensorValue: { marginTop: 3, color: '#5B697C', fontSize: 9, lineHeight: 13 },
  sensorDetail: { marginTop: 2, color: '#87909D', fontSize: 8, lineHeight: 11 },
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
  eventTitle: { color: c.navy, fontSize: 9, fontWeight: '800' },
});
