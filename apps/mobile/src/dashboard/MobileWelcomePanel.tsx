import { Ionicons } from '@expo/vector-icons';
import {
  ARTE_LIVE_URL,
  type ActivitySequence,
  type ActivitySummary,
  type HomeSummary,
  type ScreenSnapshot,
} from '@michel/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mobileApi, type ActivityItem, type Overview, type WeatherCity } from '../api';
import type { SavedServer } from '../discovery/types';
import { caregiverPresenceCopy } from './presence-copy';
import { friendlyValue, relativeTime, roomOf } from './formatters';

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
type Page = 'activity' | 'house' | 'alerts' | 'screen' | 'journal';
type SensorCard = {
  id: string;
  title: string;
  value: string;
  detail: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  available: boolean | null;
  roomId: string | null;
};

const dateKeyInZone = (date: Date, zone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find(({ type: itemType }) => itemType === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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
        ? `${resident} s’est couché hier vers ${natural(bedtime)} et s’est réveillé ce matin vers ${natural(wakeUp)}.`
        : `${resident} went to bed around ${natural(bedtime)} last night and woke up around ${natural(wakeUp)} this morning.`,
    );
  else if (wakeUp)
    sentences.push(
      fr
        ? `${resident} s’est réveillé ce matin vers ${natural(wakeUp)}.`
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
        ? `Il a passé environ ${duration(livingSeconds, locale)} dans le salon.`
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
        ? `Vers ${natural(lunchAt)}, il est allé déjeuner dans la cuisine${afternoon ? ', puis il est retourné au salon pour l’après-midi' : ''}.`
        : `Around ${natural(lunchAt)}, they went to the kitchen for lunch${afternoon ? ', then returned to the living room for the afternoon' : ''}.`,
    );
  else if (afternoon)
    sentences.push(
      fr
        ? 'Il a ensuite passé l’après-midi dans le salon.'
        : 'They then spent the afternoon in the living room.',
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
      icon: 'enter-outline',
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
      icon: 'snow-outline',
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
      icon: 'walk-outline',
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
      icon: 'water-outline',
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
      icon: kind === 'bedtime' ? 'moon-outline' : 'sunny-outline',
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
  activity,
  refreshing,
  onRefresh,
  onNavigate,
  onScreenUpdated,
}: {
  server: SavedServer;
  token: string;
  userName: string;
  locale: 'fr' | 'en';
  overview?: Overview;
  homeSummary?: HomeSummary;
  screen?: ScreenSnapshot;
  activity: ActivityItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
  onScreenUpdated: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [messageDraft, setMessageDraft] = useState('');
  const [screenBusy, setScreenBusy] = useState(false);
  const [screenNotice, setScreenNotice] = useState('');
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [weatherQuery, setWeatherQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [weatherSearch, setWeatherSearch] = useState<WeatherCity[]>([]);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherNotice, setWeatherNotice] = useState('');
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
  const messages = screen?.state.messages?.length
    ? screen.state.messages
    : screen?.state.message
      ? [screen.state.message]
      : [];
  const lastMessage = messages.at(-1);
  const resident =
    homeSummary?.residentName || overview?.home?.resident || screen?.resident || 'Élise';
  const firstName = userName.trim().split(/\s+/)[0] || userName;
  const fr = locale === 'fr';
  const essentials = useMemo(
    () => (homeSummary ? essentialCards(homeSummary, locale, now) : []),
    [homeSummary, locale, now],
  );
  const recentEvents = [...activity]
    .filter(({ capability }) => capability !== 'illuminance')
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 5);
  const nextSchedule = [
    ...([] as Array<{ title: string; startsAt: string }>),
    ...(overview?.nextSchedule ? [overview.nextSchedule] : []),
    ...(screen?.agenda ?? [])
      .filter((item) => Date.parse(item.startsAt) >= now.getTime())
      .map((item) => ({ title: item.title, startsAt: item.startsAt })),
  ]
    .filter((item) => Date.parse(item.startsAt) >= now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      !weatherOpen ||
      !screen?.grant.administer ||
      weatherQuery.trim().length < 2 ||
      weatherQuery.trim() === selectedCity
    ) {
      setWeatherSearch([]);
      setWeatherBusy(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setWeatherBusy(true);
      void mobileApi
        .weatherCities(server, token, weatherQuery.trim())
        .then((cities) => {
          if (active) setWeatherSearch(cities);
        })
        .catch(() => {
          if (active) setWeatherNotice('La recherche de villes est momentanément indisponible.');
        })
        .finally(() => {
          if (active) setWeatherBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedCity, server.id, token, weatherOpen, weatherQuery, screen?.grant.administer]);

  const postMessage = async () => {
    const next = messageDraft.trim();
    if (!next || screenBusy || !screen?.grant.message) return;
    if (messages.length >= 20) {
      setScreenNotice('La file TV contient déjà 20 messages.');
      return;
    }
    setScreenBusy(true);
    setScreenNotice('');
    try {
      await mobileApi.updateScreenMessage(server, token, {
        messages: [...messages, next],
        messageIntervalSeconds: screen.state.messageIntervalSeconds ?? 20,
      });
      setMessageDraft('');
      setScreenNotice('Message ajouté à la file de la TV.');
      onScreenUpdated();
    } catch (error) {
      setScreenNotice(error instanceof Error ? error.message : 'Ajout impossible.');
    } finally {
      setScreenBusy(false);
    }
  };
  const saveWeather = async () => {
    if (!screen?.grant.administer || !selectedCity || screenBusy) return;
    setScreenBusy(true);
    setWeatherNotice('');
    try {
      await mobileApi.updateScreenSettings(server, token, {
        ...screen.state.settings,
        weatherCity: selectedCity,
      });
      setWeatherOpen(false);
      onScreenUpdated();
    } catch {
      setWeatherNotice('La météo n’a pas pu être enregistrée.');
    } finally {
      setScreenBusy(false);
    }
  };
  const startArte = async () => {
    if (!screen?.grant.control || !screen.online || screenBusy) return;
    setScreenBusy(true);
    setScreenNotice('');
    try {
      const existing = screen.state.media.find(
        (media) => media.kind === 'tv' && media.url === ARTE_LIVE_URL,
      );
      const mediaId = existing?.id ?? mobileUuid();
      if (!existing)
        await mobileApi.createScreenMedia(server, token, {
          id: mediaId,
          title: 'ARTE en direct',
          kind: 'tv',
          url: ARTE_LIVE_URL,
        });
      await mobileApi.screenCommand(server, token, { action: 'play', mediaId });
      setScreenNotice('ARTE est lancé sur la TV.');
      onScreenUpdated();
    } catch (error) {
      setScreenNotice(error instanceof Error ? error.message : 'Le lancement d’ARTE a échoué.');
    } finally {
      setScreenBusy(false);
    }
  };
  const playArte = () => {
    void startArte();
  };

  const weatherLabel = screen?.weather
    ? weatherText(screen.weather.weatherCode)
    : fr
      ? 'Météo indisponible'
      : 'Weather unavailable';
  const weatherCity = screen?.weather?.city ?? screen?.state.settings.weatherCity ?? '';
  const greetingDate = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
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

  return (
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
          <Text style={s.greeting}>Bonjour {firstName},</Text>
          <Text style={s.subtitle}>Élise veille sur {resident}.</Text>
        </View>
        {weatherCity ? (
          <Pressable
            style={s.weather}
            disabled={!screen?.grant.administer}
            onPress={() => {
              setWeatherNotice('');
              setWeatherQuery(weatherCity);
              setSelectedCity(weatherCity);
              setWeatherOpen(true);
            }}
          >
            <Ionicons
              name={weatherIcon(screen?.weather?.weatherCode ?? 0)}
              size={21}
              color={c.accent}
            />
            <View style={s.flex}>
              <Text style={s.weatherTemp}>
                {screen?.weather ? `${Math.round(screen.weather.temperature)}°C` : '—'}
              </Text>
              <Text style={s.weatherCity}>{weatherCity}</Text>
              <Text style={s.caption}>{weatherLabel}</Text>
            </View>
            {screen?.grant.administer ? (
              <Ionicons name="pencil-outline" size={14} color={c.accent} />
            ) : null}
          </Pressable>
        ) : screen?.grant.administer ? (
          <Pressable
            style={s.weatherSetup}
            onPress={() => {
              setWeatherNotice('');
              setWeatherQuery('');
              setSelectedCity('');
              setWeatherOpen(true);
            }}
          >
            <Ionicons name="partly-sunny-outline" size={19} color={c.accent} />
            <Text style={s.weatherSetupText}>Configurer la météo</Text>
          </Pressable>
        ) : (
          <View style={s.weatherSetup}>
            <Ionicons name="partly-sunny-outline" size={19} color={c.accent} />
            <Text style={s.weatherSetupText}>Météo à configurer</Text>
          </View>
        )}
      </View>

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

      <View style={s.card}>
        <View style={s.cardHeader}>
          <View style={s.statusDot} />
          <Text style={s.cardTitle}>Repères du quotidien</Text>
        </View>
        {essentials.length ? (
          <View style={s.sensorGrid}>
            {essentials.map((item) => (
              <Pressable
                key={item.id}
                style={s.sensorCard}
                onPress={() => (item.roomId ? onNavigate('house') : onNavigate('house'))}
              >
                <View style={s.sensorHead}>
                  <View style={s.sensorIcon}>
                    <Ionicons name={item.icon} size={18} color={c.blue} />
                  </View>
                  {item.available !== null ? (
                    <View
                      style={[s.healthDot, { backgroundColor: item.available ? c.green : c.amber }]}
                    />
                  ) : null}
                </View>
                <Text style={s.sensorTitle}>{item.title}</Text>
                <Text style={s.sensorValue}>{item.value}</Text>
                <Text style={s.caption}>{item.detail}</Text>
              </Pressable>
            ))}
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

      <View style={s.card}>
        <View style={s.cardHeader}>
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={c.accent} />
          <Text style={s.cardTitle}>Messages pour la famille</Text>
        </View>
        <Text style={s.bodyLarge}>{lastMessage || 'Un petit mot pour égayer sa journée ?'}</Text>
        {lastMessage && screen?.state.messageAuthor ? (
          <Text style={s.caption}>
            — {screen.state.messageAuthor}{' '}
            {screen.state.messageUpdatedAt ? `· ${time(screen.state.messageUpdatedAt)}` : ''}
          </Text>
        ) : null}
        <View style={s.composeRow}>
          <TextInput
            style={s.messageInput}
            value={messageDraft}
            onChangeText={setMessageDraft}
            maxLength={1000}
            placeholder="Écrire un mot pour la TV…"
            placeholderTextColor="#8b9299"
          />
          <Pressable
            disabled={
              !screen?.grant.message || screenBusy || !messageDraft.trim() || messages.length >= 20
            }
            style={[
              s.addMessage,
              (!screen?.grant.message ||
                screenBusy ||
                !messageDraft.trim() ||
                messages.length >= 20) &&
                s.disabled,
            ]}
            onPress={() => void postMessage()}
          >
            <Text style={s.addMessageText}>{screenBusy ? '…' : 'Ajouter'}</Text>
          </Pressable>
        </View>
        {screenNotice ? <Text style={s.notice}>{screenNotice}</Text> : null}
        <Pressable style={s.linkRow} onPress={() => onNavigate('screen')}>
          <Text style={s.link}>Voir tous les messages</Text>
          <Ionicons name="chevron-forward" size={17} color={c.blue} />
        </Pressable>
      </View>

      <View style={s.card}>
        <View style={s.cardHeader}>
          <Ionicons name="calendar-outline" size={19} color={c.accent} />
          <Text style={s.cardTitle}>Prochain rendez-vous</Text>
        </View>
        <Text style={s.bodyLarge}>{nextSchedule?.title ?? 'Aucun rendez-vous prévu'}</Text>
        {nextSchedule ? (
          <Text style={s.caption}>
            {new Date(nextSchedule.startsAt).toLocaleDateString('fr-FR', {
              timeZone: timezone,
              day: 'numeric',
              month: 'short',
            })}{' '}
            · {time(nextSchedule.startsAt)}
          </Text>
        ) : null}
        <Pressable style={s.linkRow} onPress={() => onNavigate('journal')}>
          <Text style={s.link}>Voir le calendrier</Text>
          <Ionicons name="chevron-forward" size={17} color={c.blue} />
        </Pressable>
      </View>

      <View style={s.card}>
        <View style={s.cardHeader}>
          <Ionicons name="flash-outline" size={18} color={c.accent} />
          <Text style={s.cardTitle}>Actions rapides</Text>
        </View>
        <View style={s.quickGrid}>
          <Quick icon="call-outline" label="Appeler" onPress={() => onNavigate('screen')} />
          <Quick
            icon="tv-outline"
            label="ARTE"
            disabled={!screen?.online || !screen.grant.control || screenBusy}
            onPress={playArte}
          />
          <Quick
            icon="desktop-outline"
            label="Afficher sur la TV"
            onPress={() => onNavigate('screen')}
          />
          <Quick
            icon="images-outline"
            label="Voir les photos"
            onPress={() => onNavigate('screen')}
          />
        </View>
      </View>

      <Modal
        visible={weatherOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setWeatherOpen(false)}
      >
        <View style={s.modalShell}>
          <View style={s.modalHeader}>
            <View>
              <Text style={s.eyebrow}>MÉTÉO DU LOGEMENT ET DE LA TV</Text>
              <Text style={s.cardTitle}>Choisir une ville</Text>
            </View>
            <Pressable style={s.close} onPress={() => setWeatherOpen(false)}>
              <Ionicons name="close" size={22} color={c.navy} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={s.body}>
              La ville choisie met également à jour la météo affichée sur la télévision.
            </Text>
            <TextInput
              style={s.messageInput}
              autoFocus
              value={weatherQuery}
              onChangeText={(value) => {
                setWeatherQuery(value);
                setSelectedCity('');
                setWeatherNotice('');
              }}
              placeholder="Ex. Orléans, Tours…"
              placeholderTextColor="#8b9299"
            />
            {weatherBusy ? <Text style={s.body}>Recherche…</Text> : null}
            {weatherSearch.map((city) => (
              <Pressable
                key={`${city.name}-${city.latitude}`}
                style={s.cityRow}
                onPress={() => {
                  setWeatherQuery(city.name);
                  setSelectedCity(city.name);
                  setWeatherSearch([]);
                }}
              >
                <Ionicons name="location-outline" size={18} color={c.accent} />
                <View style={s.flex}>
                  <Text style={s.cardTitle}>{city.name}</Text>
                  <Text style={s.caption}>{city.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.muted} />
              </Pressable>
            ))}
            {weatherNotice ? <Text style={s.notice}>{weatherNotice}</Text> : null}
            <Pressable
              disabled={!selectedCity || screenBusy}
              style={[s.saveButton, (!selectedCity || screenBusy) && s.disabled]}
              onPress={() => void saveWeather()}
            >
              <Text style={s.saveText}>
                {screenBusy ? 'Enregistrement…' : weatherCity ? 'Mettre à jour' : 'Configurer'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
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
function Quick({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[s.quick, disabled && s.disabled]}
      onPress={onPress}
    >
      <View style={s.quickIcon}>
        <Ionicons name={icon} size={18} color={c.blue} />
      </View>
      <Text style={s.quickText}>{label}</Text>
    </Pressable>
  );
}
function mobileUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (part) => {
    const random = Math.floor(Math.random() * 16);
    return (part === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
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
function weatherIcon(code: number): React.ComponentProps<typeof Ionicons>['name'] {
  if (code === 0) return 'sunny-outline';
  if (code <= 2) return 'partly-sunny-outline';
  if ([45, 48].includes(code)) return 'cloud-outline';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow-outline';
  if (code >= 95) return 'thunderstorm-outline';
  return 'rainy-outline';
}
function weatherText(code: number) {
  if (code === 0) return 'Ciel dégagé';
  if (code <= 2) return 'Éclaircies';
  if (code === 3) return 'Nuageux';
  if ([45, 48].includes(code)) return 'Brouillard';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Neige';
  if (code >= 95) return 'Orage';
  return 'Pluie';
}
const s = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 34, gap: 12, backgroundColor: c.cream },
  header: { gap: 10 },
  headerCopy: { gap: 3 },
  flex: { flex: 1 },
  eyebrow: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  greeting: { color: c.navy, fontFamily: 'Georgia', fontSize: 27 },
  subtitle: { color: c.muted, fontSize: 11 },
  weather: {
    minHeight: 66,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.paper,
  },
  weatherSetup: {
    minHeight: 43,
    paddingHorizontal: 12,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.paleBlue,
  },
  weatherSetupText: { color: c.blue, fontSize: 10, fontWeight: '800' },
  weatherTemp: { color: c.navy, fontFamily: 'Georgia', fontSize: 18 },
  weatherCity: { color: c.navy, fontSize: 10, fontWeight: '800' },
  caption: { color: c.muted, fontSize: 8, lineHeight: 13 },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    gap: 11,
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
    minHeight: 137,
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: '#fffefa',
  },
  sensorHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sensorIcon: {
    width: 33,
    height: 33,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  healthDot: { width: 7, height: 7, borderRadius: 4 },
  sensorTitle: { marginTop: 8, color: c.navy, fontSize: 10, fontWeight: '900' },
  sensorValue: { marginTop: 4, color: c.accent, fontSize: 10, fontWeight: '800' },
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
  composeRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  messageInput: {
    minHeight: 43,
    flex: 1,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    color: c.navy,
    backgroundColor: '#fff',
    fontSize: 10,
  },
  addMessage: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  addMessageText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  notice: { color: c.red, fontSize: 9 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  quick: {
    width: '48%',
    minHeight: 67,
    padding: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fffefa',
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  quickText: { flex: 1, color: c.navy, fontSize: 9, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  modalShell: { flex: 1, backgroundColor: c.cream },
  modalHeader: {
    minHeight: 74,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  modalContent: { padding: 18, paddingBottom: 34, gap: 12 },
  cityRow: {
    minHeight: 57,
    paddingHorizontal: 10,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: c.paper,
  },
  saveButton: {
    minHeight: 45,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  saveText: { color: '#fff', fontSize: 10, fontWeight: '900' },
});
