import { useEffect, useState } from 'react';
import {
  activitySummarySchema,
  homeSummarySchema,
  type ActivitySummary,
  type HomeSummary,
  type EntranceSummary,
  type ScreenSnapshot,
  type ShowerDetection,
} from '@elise/contracts';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  CalendarDays,
  Clock3,
  Cloud,
  CloudSun,
  CloudRain,
  CloudFog,
  CloudSnow,
  CloudLightning,
  PersonStanding,
  BatteryMedium,
  DoorOpen,
  Droplets,
  Droplet,
  Footprints,
  Gauge,
  Leaf,
  Radio,
  ShieldAlert,
  ShowerHead,
  Sun,
  Thermometer,
  Refrigerator,
  MoonStar,
  Sunrise,
  Toilet,
  Headphones,
  Youtube,
  Tv,
  Zap,
  MapPin,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { roomIconKey } from './home-visuals';
import { DataLoadingScreen } from './DataLoadingScreen';

type WeatherCity = {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
};
import { currentLanguage, dateLocale, type Locale, t } from './i18n';
import { subscribeScreenEvents } from './screen-events';
import './welcome-page.css';

export function homeCardText(card: HomeSummary['cards'][number], locale: Locale, timezone: string) {
  const at = card.lastObservedAt
    ? new Date(card.lastObservedAt).toLocaleTimeString(locale, {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  let text = '';
  if (card.observedToday) {
    text =
      card.kind === 'FRIDGE' || card.kind === 'OPENING'
        ? t('welcomePage.openingDetectedTodayAt', { at })
        : t('welcomePage.activityDetectedTodayAt', { at });
    if (card.kind === 'TOILET') text = t('welcomePage.aVisitWasDetectedToday', { at });
  }
  if (!card.available)
    return [text, t('welcomePage.currentInformationIsUnavailable')].filter(Boolean).join(' ');
  if (['FRIDGE', 'OPENING'].includes(card.kind) && card.state !== 'UNKNOWN')
    text +=
      card.state === 'ACTIVE' ? t('welcomePage.currentlyOpen') : t('welcomePage.currentlyClosed');
  if (card.kind === 'APPLIANCE' && card.state !== 'UNKNOWN')
    text += card.state === 'ACTIVE' ? t('welcomePage.currentlyOn') : t('welcomePage.currentlyOff');
  if (card.kind === 'SAFETY' && card.state === 'ACTIVE')
    text += t('welcomePage.aSignalNeedsYourAttention');
  if (text.trim()) return text.trim();
  if (card.kind === 'APPLIANCE') return t('welcomePage.operationCannotBeDeterminedFrom');
  if (card.kind === 'COMFORT' && card.state === 'ACTIVE')
    return t('welcomePage.theTemperatureIsOutsideA');
  if (card.kind === 'COMFORT' && card.state === 'INACTIVE')
    return t('welcomePage.theTemperatureIsWithinThe');
  if (card.kind === 'COMFORT') return t('welcomePage.comfortInformationIsBeingReceived');
  return t('welcomePage.noActivityDetectedToday');
}

export function entranceText(entrance: EntranceSummary, locale: Locale, timezone: string) {
  const at = entrance.openedAt
    ? new Date(entrance.openedAt).toLocaleString(locale, {
        timeZone: timezone,
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  switch (entrance.state) {
    case 'ENTRY_LIKELY':
      return t('welcomePage.likelyEntryOnTheDoor', { at });
    case 'EXIT_LIKELY':
      return t('welcomePage.likelyExitOnMovementTowards', { at });
    case 'PENDING':
      return t('welcomePage.theMainDoorWasOpened');
    case 'INSIDE_ACTIVITY':
      return t('welcomePage.indoorActivityWasDetectedAfter');
    case 'UNCERTAIN':
      return t('welcomePage.theMainDoorWasOpened2');
    case 'UNAVAILABLE':
      return t('welcomePage.informationFromTheMainDoor');
    default:
      return t('welcomePage.noPassageDetectedAtThe');
  }
}

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

function roomWithArticle(room: Pick<HomeSummary['rooms'][number], 'kind' | 'name'>) {
  const key = roomIconKey(room);
  const kind = ROOM_KINDS_WITH_ARTICLE.find((candidate) => candidate === key);
  return kind
    ? t(`welcomePage.roomWithArticle.${kind}`)
    : t('welcomePage.roomWithArticle.named', { name: room.name });
}

export function presenceText(data: HomeSummary, locale: Locale) {
  const p = data.presence;
  const resident = data.residentName || t('welcomePage.theResident');
  if (
    data.entrance?.state === 'EXIT_LIKELY' &&
    p.trackingState !== 'AMBIGUOUS' &&
    !p.trackingDegraded
  )
    return entranceText(data.entrance, locale, data.timezone);
  const latestRoom = data.latestPresence
    ? data.rooms.find((candidate) => candidate.id === data.latestPresence?.roomId)
    : undefined;
  if (latestRoom && data.latestPresence)
    return t('welcomePage.isIn', { resident, room: roomWithArticle(latestRoom) });
  const room = data.rooms.find((r) => r.id === (p.confirmedRoomId ?? p.roomId));
  if (p.trackingState === 'CONFIRMED' && !p.trackingDegraded && room)
    return t('welcomePage.isIn', { resident, room: roomWithArticle(room) });
  if (p.trackingState === 'IN_TRANSIT')
    return t('welcomePage.appearsToBeMovingThrough', { resident });
  if (p.trackingState === 'AMBIGUOUS' || p.trackingDegraded)
    return t('welcomePage.theLatestObservationsDoNot', { resident });
  const confirmedRoomEvidence = p.evidenceSummary
    .filter((item) => item.roomId === p.confirmedRoomId && item.observed !== false)
    .map((item) => item.occurredAt)
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0];
  const timestamp = confirmedRoomEvidence ?? p.lastConfirmedAt ?? p.detectedAt;
  if (room && timestamp)
    return t('welcomePage.probablyIn', {
      resident,
      room: roomWithArticle(room),
      at: new Date(timestamp).toLocaleTimeString(locale, {
        timeZone: data.timezone,
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  return t('welcomePage.thereIsNotEnoughInformation', { resident });
}

export function latestPresenceText(data: HomeSummary, locale: Locale) {
  const latest = data.latestPresence;
  if (!latest) return null;
  const room = data.rooms.find((candidate) => candidate.id === latest.roomId);
  if (!room) return null;
  const at = new Date(latest.occurredAt).toLocaleTimeString(locale, {
    timeZone: data.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  return t('welcomePage.lastDetectionIn', { room: roomWithArticle(room), at });
}

function naturalList(items: string[], locale: Locale) {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
}

export function currentMomentText(data: HomeSummary, locale: Locale) {
  const location = presenceText(data, locale);
  const roomNames = data.activityRooms.filter(
    (room, index, all) => all.findIndex((candidate) => candidate === room) === index,
  );
  if (roomNames.length < 2) return location;
  const trail = roomNames.slice(-4).map((name) => {
    const room = data.rooms.find((candidate) => candidate.name === name);
    return room ? roomWithArticle(room) : name;
  });
  const journey = t('welcomePage.sinceTheStartOfThe', { naturalList: naturalList(trail, locale) });
  return `${location} ${journey}`;
}

export function dayText(data: HomeSummary, locale: Locale) {
  const sentences: string[] = [];
  const activityRooms = [...new Set(data.activityRooms)].slice(0, 4);
  if (activityRooms.length)
    sentences.push(
      t('welcomePage.theDayHasUnfoldedBetween', {
        naturalList: naturalList(activityRooms, locale),
      }),
    );
  if (data.cards.some((c) => c.kind === 'FRIDGE' && c.observedToday))
    sentences.push(t('welcomePage.theRefrigeratorWasOpened'));
  if (data.cards.some((c) => c.kind === 'TOILET' && c.observedToday))
    sentences.push(t('welcomePage.aVisitToTheToilet'));
  if (!sentences.length) sentences.push(t('welcomePage.theDayIsTakingShape'));
  if (data.entrance?.openedAt) {
    const at = new Date(data.entrance.openedAt).toLocaleTimeString(locale, {
      timeZone: data.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    sentences.push(
      data.entrance.state === 'ENTRY_LIKELY'
        ? t('welcomePage.anArrivalWasNoticedAt', { at })
        : data.entrance.state === 'EXIT_LIKELY'
          ? t('welcomePage.aDepartureWasNoticedAt', { at })
          : t('welcomePage.theFrontDoorWasOpened', { at }),
    );
  }
  return sentences.slice(0, 3).join(' ');
}

function narrativeDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining
    ? t('common.durationHoursMinutes', { hours, minutes: remaining })
    : t('common.durationHours', { hours });
}

function hourInTimeZone(value: string, timeZone: string) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(value)),
  );
}

// French reads times as "8 h 30"; other languages use their usual clock format.
function naturalTime(value: string, timeZone: string) {
  if (currentLanguage() !== 'fr')
    return new Date(value).toLocaleTimeString(dateLocale(), {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    });
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return minute === '00' ? `${hour} h` : `${hour} h ${minute}`;
}

function sequenceIncludesRoom(
  sequence: ActivitySummary['sequences'][number],
  room: HomeSummary['rooms'][number],
) {
  return sequence.roomIds.includes(room.id) || sequence.roomNames.includes(room.name);
}

function sequenceRoomTime(
  sequence: ActivitySummary['sequences'][number],
  room: HomeSummary['rooms'][number],
) {
  return (
    [...sequence.events]
      .reverse()
      .find((event) => event.roomId === room.id || event.roomName === room.name)?.occurredAt ??
    (sequence.roomIds.at(-1) === room.id || sequence.roomNames.at(-1) === room.name
      ? sequence.endedAt
      : sequence.startedAt)
  );
}

export function dayNarrativeText(
  data: HomeSummary,
  summary: ActivitySummary | null,
  locale: Locale,
  previousSummary: ActivitySummary | null = null,
) {
  const resident = data.residentName || t('welcomePage.theResident');
  const sequences = [...(summary?.sequences ?? [])].sort(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  const sentences: string[] = [];
  const bedroom = data.rooms.find((room) => room.kind === 'BEDROOM');
  const livingRoom = data.rooms.find((room) => room.kind === 'LIVING_ROOM');
  const kitchen = data.rooms.find(
    (room) => room.kind === 'KITCHEN' || room.name.toLocaleLowerCase(locale).includes('cuisine'),
  );

  const previousSequences = [...(previousSummary?.sequences ?? [])].sort(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  const lastPreviousSequence = previousSequences.at(-1);
  const bedtime =
    bedroom &&
    lastPreviousSequence &&
    sequenceIncludesRoom(lastPreviousSequence, bedroom) &&
    lastPreviousSequence.roomNames.at(-1) === bedroom.name
      ? sequenceRoomTime(lastPreviousSequence, bedroom)
      : null;
  const wakeUp = sequences.find((sequence) => {
    const hour = hourInTimeZone(sequence.startedAt, data.timezone);
    return hour >= 4 && hour < 12;
  })?.startedAt;

  if (bedtime && hourInTimeZone(bedtime, data.timezone) >= 18 && wakeUp)
    sentences.push(
      t('welcomePage.bedtimeAndWakeUp', {
        resident,
        bedtime: naturalTime(bedtime, data.timezone),
        wakeUp: naturalTime(wakeUp, data.timezone),
      }),
    );
  else if (wakeUp)
    sentences.push(
      t('welcomePage.wakeUp', { resident, wakeUp: naturalTime(wakeUp, data.timezone) }),
    );

  const livingRoomSeconds = livingRoom
    ? (summary?.dwellByRoom.find(
        (dwell) => dwell.id === livingRoom.id || dwell.name === livingRoom.name,
      )?.totalSeconds ??
      sequences
        .filter((sequence) => sequenceIncludesRoom(sequence, livingRoom))
        .reduce((total, sequence) => total + sequence.durationSeconds, 0))
    : 0;
  if (livingRoomSeconds >= 120)
    sentences.push(
      t('welcomePage.theySpentAboutInThe', {
        narrativeDuration: narrativeDuration(livingRoomSeconds),
      }),
    );

  const lunchSequence = kitchen
    ? sequences.find((sequence) => {
        const hour = hourInTimeZone(sequence.startedAt, data.timezone);
        return hour >= 11 && hour < 14 && sequenceIncludesRoom(sequence, kitchen);
      })
    : undefined;
  const lunchFridge = data.cards.find(
    (card) =>
      card.kind === 'FRIDGE' &&
      card.observedToday &&
      card.lastObservedAt &&
      hourInTimeZone(card.lastObservedAt, data.timezone) >= 11 &&
      hourInTimeZone(card.lastObservedAt, data.timezone) < 14,
  );
  const lunchTime =
    kitchen && lunchSequence
      ? sequenceRoomTime(lunchSequence, kitchen)
      : kitchen
        ? lunchFridge?.lastObservedAt
        : null;
  const spentAfternoonInLivingRoom = Boolean(
    livingRoom &&
    sequences.some((sequence) => {
      const hour = hourInTimeZone(sequence.startedAt, data.timezone);
      return hour >= 12 && hour < 20 && sequenceIncludesRoom(sequence, livingRoom);
    }),
  );
  if (lunchTime)
    sentences.push(
      spentAfternoonInLivingRoom
        ? t('welcomePage.lunchThenAfternoon', { at: naturalTime(lunchTime, data.timezone) })
        : t('welcomePage.lunch', { at: naturalTime(lunchTime, data.timezone) }),
    );
  else if (spentAfternoonInLivingRoom) sentences.push(t('welcomePage.theyThenSpentTheAfternoon'));

  if (!sentences.length) return t('welcomePage.sDayIsStartingQuietly', { resident });
  return sentences.join(' ');
}

const sensorLabels: Record<string, () => string> = {
  motion: () => t('welcomePage.sensorLabels.motion'),
  occupancy: () => t('welcomePage.sensorLabels.occupancy'),
  person_presence: () => t('welcomePage.sensorLabels.person_presence'),
  contact: () => t('welcomePage.sensorLabels.contact'),
  temperature: () => t('welcomePage.sensorLabels.temperature'),
  humidity: () => t('welcomePage.sensorLabels.humidity'),
  illuminance: () => t('welcomePage.sensorLabels.illuminance'),
  co2: () => t('welcomePage.sensorLabels.co2'),
  voc: () => t('welcomePage.sensorLabels.voc'),
  pm25: () => t('welcomePage.sensorLabels.pm25'),
  air_quality: () => t('welcomePage.sensorLabels.air_quality'),
  power: () => t('welcomePage.sensorLabels.power'),
  energy: () => t('welcomePage.sensorLabels.energy'),
  switch: () => t('welcomePage.sensorLabels.switch'),
  current: () => t('welcomePage.sensorLabels.current'),
  voltage: () => t('welcomePage.sensorLabels.voltage'),
  battery: () => t('welcomePage.sensorLabels.battery'),
  water_leak: () => t('welcomePage.sensorLabels.water_leak'),
  smoke: () => t('welcomePage.sensorLabels.smoke'),
  carbon_monoxide: () => t('welcomePage.sensorLabels.carbon_monoxide'),
  fall_detection: () => t('welcomePage.sensorLabels.fall_detection'),
  signal_strength: () => t('welcomePage.sensorLabels.signal_strength'),
};

const sensorIcons: Record<string, typeof Activity> = {
  motion: Activity,
  occupancy: Footprints,
  person_presence: Footprints,
  contact: DoorOpen,
  temperature: Thermometer,
  humidity: Droplets,
  illuminance: Sun,
  co2: Leaf,
  voc: Leaf,
  pm25: Leaf,
  air_quality: Leaf,
  power: Zap,
  energy: Gauge,
  switch: Zap,
  current: Zap,
  voltage: Zap,
  battery: BatteryMedium,
  water_leak: Droplet,
  smoke: ShieldAlert,
  carbon_monoxide: ShieldAlert,
  fall_detection: ShieldAlert,
  signal_strength: Radio,
};

export function roomSensorLabel(capability: string) {
  return sensorLabels[capability]?.() ?? capability;
}

export function roomSensorValue(sensor: HomeSummary['roomSummaries'][number]['sensors'][number]) {
  if (!sensor.available) return t('welcomePage.unavailable');
  if (['occupancy', 'person_presence'].includes(sensor.capability))
    return sensor.state === 'ACTIVE' ? t('welcomePage.detected') : t('welcomePage.none');
  if (sensor.capability === 'motion')
    return sensor.state === 'ACTIVE' ? t('welcomePage.detected2') : t('welcomePage.none2');
  if (sensor.capability === 'contact')
    return sensor.state === 'ACTIVE' ? t('welcomePage.open') : t('welcomePage.closed');
  if (sensor.capability === 'switch' || sensor.capability === 'power')
    return sensor.state === 'ACTIVE' ? t('welcomePage.on') : t('welcomePage.off');
  if (sensor.value === null) return t('welcomePage.noData');
  if (typeof sensor.value === 'boolean')
    return sensor.value ? t('welcomePage.yes') : t('welcomePage.no');
  if (typeof sensor.value === 'number') {
    const value = new Intl.NumberFormat(dateLocale(), {
      maximumFractionDigits: 1,
    }).format(sensor.value);
    return `${value}${sensor.unit ? ` ${sensor.unit}` : ''}`;
  }
  return sensor.unit ? `${sensor.value} ${sensor.unit}` : sensor.value;
}

function showerTime(value: string | null, locale: Locale, timezone: string) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(locale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function showerStatusText(shower: ShowerDetection | null | undefined) {
  if (!shower || shower.state === 'IDLE') return t('welcomePage.noShowerDetected');
  if (shower.state === 'RISING') return t('welcomePage.humidityRising');
  if (shower.state === 'IN_PROGRESS') return t('welcomePage.showerInProgress');
  if (shower.state === 'COMPLETED') return t('welcomePage.showerDetected');
  return t('welcomePage.unavailable');
}

export function showerDetailText(
  shower: ShowerDetection | null | undefined,
  humidity: HomeSummary['roomSummaries'][number]['sensors'][number] | undefined,
  locale: Locale,
  timezone: string,
  now = new Date(),
) {
  if (!shower || shower.state === 'UNAVAILABLE' || !humidity?.available)
    return t('welcomePage.humidityUnavailable');
  const current = roomSensorValue(humidity);
  if (shower.state === 'RISING')
    return t('welcomePage.humidityPoints', { current, round: Math.round(shower.risePercent ?? 0) });
  if (shower.state === 'IN_PROGRESS') {
    const elapsed = shower.startedAt
      ? Math.max(1, Math.round((now.getTime() - Date.parse(shower.startedAt)) / 60_000))
      : shower.durationMinutes;
    return t('welcomePage.sinceMin', {
      showerTime: showerTime(shower.startedAt, locale, timezone),
      value: elapsed ?? 0,
      current,
    });
  }
  if (shower.state === 'COMPLETED')
    return t('welcomePage.endedAtMin', {
      showerTime: showerTime(shower.endedAt, locale, timezone),
      value: shower.durationMinutes ?? 0,
    });
  return t('welcomePage.humidity', { current });
}

export function welcomeAlertTitle(title: string, locale: Locale, roomName?: string | null) {
  if (/occupancy|presence/i.test(title))
    return roomName
      ? t('welcomePage.presenceSensorUnavailableIn', {
          // French reads "des toilettes", hence the lower case there.
          room: currentLanguage() === 'fr' ? roomName.toLocaleLowerCase('fr') : roomName,
        })
      : t('welcomePage.presenceSensorUnavailable');
  return title;
}

export type WelcomeEvent = { id: string; occurredAt: string; capability: string; label: string };
export type WelcomeReminder = { title: string; at: string; medication: boolean };

async function welcomeScreenRequest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Erreur ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function WelcomePage({
  locale,
  caregiverFirstName,
  residentName,
  events = [],
  reminders = [],
  nextSchedule = null,
  onOpenRoom,
  onActivity,
  onSensors,
  onPlanning,
}: {
  locale: Locale;
  caregiverFirstName: string;
  residentName: string;
  reassurance?: 'NORMAL' | 'LEARNING' | 'ATTENTION' | 'INSUFFICIENT_DATA';
  events?: WelcomeEvent[];
  reminders?: WelcomeReminder[];
  nextSchedule?: { title: string; startsAt: string } | null | undefined;
  onAlerts: () => void;
  onOpenRoom: (roomId: string) => void;
  onActivity: () => void;
  onSensors: () => void;
  onPlanning: (medication: boolean) => void;
}) {
  const [data, setData] = useState<HomeSummary | null>(null);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [previousActivitySummary, setPreviousActivitySummary] = useState<ActivitySummary | null>(
    null,
  );
  const [screen, setScreen] = useState<ScreenSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [weatherModalOpen, setWeatherModalOpen] = useState(false);
  const [weatherCityQuery, setWeatherCityQuery] = useState('');
  const [selectedWeatherCity, setSelectedWeatherCity] = useState('');
  const [weatherCities, setWeatherCities] = useState<WeatherCity[]>([]);
  const [weatherSearchBusy, setWeatherSearchBusy] = useState(false);
  const [weatherSearchError, setWeatherSearchError] = useState('');
  const [weatherSaving, setWeatherSaving] = useState(false);
  const [weatherModalError, setWeatherModalError] = useState('');
  const fr = locale === 'fr';
  void reminders;
  const residentFirstName = residentName.trim().split(/\s+/)[0] || residentName;
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch('/api/v1/screen', { signal: controller.signal });
        if (!response.ok) throw new Error('screen');
        const snapshot = (await response.json()) as ScreenSnapshot;
        if (!controller.signal.aborted) setScreen(snapshot);
      } catch {
        if (!controller.signal.aborted) setScreen(null);
      } finally {
        pending = false;
      }
    }
    void refresh();
    const stop = subscribeScreenEvents('screen/events', () => void refresh());
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      controller.abort();
      stop();
      clearInterval(timer);
    };
  }, [retry]);
  useEffect(() => {
    const query = weatherCityQuery.trim();
    if (
      !weatherModalOpen ||
      !screen?.grant.administer ||
      query.length < 2 ||
      selectedWeatherCity === query
    ) {
      setWeatherCities([]);
      setWeatherSearchBusy(false);
      setWeatherSearchError('');
      return;
    }
    const controller = new AbortController();
    setWeatherSearchBusy(true);
    setWeatherSearchError('');
    const timer = window.setTimeout(() => {
      void fetch(`/api/v1/screen/weather/cities?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          return response.json() as Promise<WeatherCity[]>;
        })
        .then((cities) => {
          setWeatherCities(cities);
          setWeatherSearchBusy(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setWeatherCities([]);
          setWeatherSearchBusy(false);
          setWeatherSearchError(t('welcomePage.citySearchIsTemporarilyUnavailable'));
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fr, screen?.grant.administer, selectedWeatherCity, weatherCityQuery, weatherModalOpen]);
  useEffect(() => {
    if (!weatherModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !weatherSaving) setWeatherModalOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [weatherModalOpen, weatherSaving]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    let again = false;
    const controller = new AbortController();
    async function refresh() {
      if (!alive) return;
      if (pending) {
        again = true;
        return;
      }
      pending = true;
      try {
        const [response, activityResponse] = await Promise.all([
          fetch('/api/v1/home-summary', { signal: controller.signal }),
          fetch('/api/v1/analytics/activity?period=24h', {
            signal: controller.signal,
            cache: 'no-store',
          }),
        ]);
        if (!response.ok) throw new Error('summary');
        const result = homeSummarySchema.parse(await response.json());
        if (alive) {
          setData(result);
          if (activityResponse.ok) {
            const activityResult = activitySummarySchema.safeParse(await activityResponse.json());
            if (activityResult.success) setActivitySummary(activityResult.data);
          }
          const dateParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: result.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).formatToParts(new Date(result.to));
          const datePart = (type: string) =>
            Number(dateParts.find((part) => part.type === type)?.value ?? 0);
          const previousDate = new Date(
            Date.UTC(datePart('year'), datePart('month') - 1, datePart('day') - 1),
          )
            .toISOString()
            .slice(0, 10);
          try {
            const previousResponse = await fetch(
              `/api/v1/analytics/activity?period=24h&date=${encodeURIComponent(previousDate)}`,
              { signal: controller.signal, cache: 'no-store' },
            );
            if (previousResponse.ok) {
              const previousResult = activitySummarySchema.safeParse(await previousResponse.json());
              if (previousResult.success && alive) setPreviousActivitySummary(previousResult.data);
            }
          } catch {
            // Yesterday's context improves the story, but is not required to show today's summary.
          }
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      } finally {
        pending = false;
        if (again && alive) {
          again = false;
          void refresh();
        }
      }
    }
    void refresh();
    const events = new EventSource('/api/v1/events');
    let debounce: ReturnType<typeof setTimeout>;
    events.onmessage = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 500);
    };
    events.onopen = () => void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = setInterval(visible, 60_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      alive = false;
      controller.abort();
      events.close();
      clearTimeout(debounce);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
  }, [retry]);
  const timezone = data?.timezone ?? screen?.timezone ?? 'Europe/Paris';
  const time = (date: string | Date | number) =>
    new Date(date).toLocaleTimeString(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  const day = (date: string | Date | number) =>
    new Date(date).toLocaleDateString(locale, { timeZone: timezone });
  const homeDateKey = (date: string | Date | number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(date));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const todayDateKey = homeDateKey(now);
  const [todayYear = 0, todayMonth = 1, todayDay = 1] = todayDateKey.split('-').map(Number);
  const tomorrowDate = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + 1));
  const tomorrowDateKey = [
    tomorrowDate.getUTCFullYear(),
    String(tomorrowDate.getUTCMonth() + 1).padStart(2, '0'),
    String(tomorrowDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
  const recent = [...events]
    .filter((event) => event.capability !== 'illuminance')
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 5);
  const reminder = [
    ...(nextSchedule
      ? [{ title: nextSchedule.title, at: nextSchedule.startsAt, medication: false }]
      : []),
    ...(screen?.agenda ?? []).map((item) => ({
      title: item.title,
      at: item.startsAt,
      medication: false,
    })),
  ]
    .filter((item) => {
      const at = Date.parse(item.at);
      if (!Number.isFinite(at) || at < now.getTime()) return false;
      const dateKey = homeDateKey(item.at);
      return dateKey === todayDateKey || dateKey === tomorrowDateKey;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const reminderDateLabel = reminder
    ? homeDateKey(reminder.at) === todayDateKey
      ? t('welcomePage.today', { time: time(reminder.at) })
      : t('welcomePage.tomorrow', { time: time(reminder.at) })
    : '';
  const weather = screen?.weather;
  const weatherCode = weather?.weatherCode ?? 0;
  const weatherKind =
    weatherCode === 0
      ? 'clear'
      : weatherCode <= 2
        ? 'partial'
        : weatherCode === 3
          ? 'cloud'
          : [45, 48].includes(weatherCode)
            ? 'fog'
            : [71, 73, 75, 77, 85, 86].includes(weatherCode)
              ? 'snow'
              : weatherCode >= 95
                ? 'storm'
                : 'rain';
  const WeatherIcon = {
    clear: Sun,
    partial: CloudSun,
    cloud: Cloud,
    fog: CloudFog,
    snow: CloudSnow,
    storm: CloudLightning,
    rain: CloudRain,
  }[weatherKind];
  const weatherLabel = !weather
    ? t('welcomePage.weatherUnavailable')
    : {
        clear: t('welcomePage.clearSkies'),
        partial: t('welcomePage.partlyCloudy'),
        cloud: t('welcomePage.cloudy'),
        fog: t('welcomePage.fog'),
        snow: t('welcomePage.snow'),
        storm: t('welcomePage.storm'),
        rain: t('welcomePage.rain'),
      }[weatherKind];
  const configuredWeatherCity = screen?.state.settings.weatherCity.trim() ?? '';
  const activeScreenMedia = screen?.state.media.find(
    (media) =>
      ['stream', 'tv', 'youtube', 'podcast'].includes(media.kind) &&
      media.id === screen.state.playback.mediaId,
  );
  const screenMediaPending = screen?.state.commands.some(
    (command) =>
      command.status === 'pending' &&
      command.revision === screen.state.playback.revision &&
      ['play', 'resume', 'next'].includes(command.action),
  );
  const screenPlaybackStatus = !screen
    ? t('welcomePage.tvStatusUnavailable')
    : !screen.online
      ? t('welcomePage.tvOffline')
      : screen.state.call
        ? t('welcomePage.interruptedDuringTheCall')
        : screen.state.playback.asleep
          ? t('welcomePage.tvIsResting')
          : activeScreenMedia && screen.state.playback.paused
            ? t('welcomePage.paused')
            : activeScreenMedia && screenMediaPending
              ? t('welcomePage.startingOnTv')
              : activeScreenMedia
                ? t('welcomePage.playingNow')
                : t('welcomePage.tvPlayback');
  const screenPlaybackTitle =
    activeScreenMedia?.title ??
    (!screen
      ? t('welcomePage.playbackCannotBeChecked')
      : !screen.online
        ? t('welcomePage.tvConnectionUnavailable')
        : screen.state.call
          ? t('welcomePage.callInProgress')
          : t('welcomePage.noMediaPlaying'));
  const screenMediaType = !activeScreenMedia
    ? ''
    : activeScreenMedia.kind === 'stream'
      ? 'Radio'
      : activeScreenMedia.kind === 'tv'
        ? t('welcomePage.tv')
        : activeScreenMedia.kind === 'youtube'
          ? 'YouTube'
          : 'Podcast';
  const ScreenMediaIcon = !activeScreenMedia
    ? Tv
    : activeScreenMedia.kind === 'stream'
      ? Radio
      : activeScreenMedia.kind === 'youtube'
        ? Youtube
        : activeScreenMedia.kind === 'podcast'
          ? Headphones
          : Tv;
  const screenIsPlaying = Boolean(
    screen?.online &&
    activeScreenMedia &&
    !screen.state.call &&
    !screen.state.playback.asleep &&
    !screen.state.playback.paused &&
    !screenMediaPending,
  );
  const usageSensors: Array<{
    key: string;
    title: string;
    value: string;
    detail: string;
    available: boolean | null;
    roomId: string | null;
    icon: typeof Activity;
    tone: string;
  }> = [];
  const entranceRoom = data?.roomSummaries.find(
    (candidate) =>
      candidate.name === data?.entrance?.roomName || roomIconKey(candidate) === 'ENTRANCE',
  );
  const entranceContact = entranceRoom?.sensors.find((sensor) => sensor.capability === 'contact');
  if (data?.entrance) {
    const available = Boolean(entranceContact?.available);
    usageSensors.push({
      key: 'main-entrance',
      title: t('welcomePage.frontDoor'),
      value: !available
        ? t('welcomePage.unavailable')
        : entranceContact?.state === 'ACTIVE'
          ? t('welcomePage.open2')
          : entranceContact?.state === 'INACTIVE'
            ? t('welcomePage.closed2')
            : t('welcomePage.unknownState'),
      detail: t('welcomePage.currentState'),
      available,
      roomId: entranceRoom?.roomId ?? null,
      icon: DoorOpen,
      tone: 'entrance',
    });
  }
  const fridge = data?.cards.find((card) => card.kind === 'FRIDGE');
  if (fridge) {
    const fridgeRoom = data?.roomSummaries.find((candidate) => candidate.name === fridge.label);
    usageSensors.push({
      key: fridge.id,
      title: t('welcomePage.refrigerator'),
      value: !fridge.available
        ? t('welcomePage.unavailable')
        : fridge.state === 'ACTIVE'
          ? t('welcomePage.open')
          : fridge.state === 'INACTIVE'
            ? t('welcomePage.closed')
            : t('welcomePage.unknownState'),
      detail: t('welcomePage.openingsToday', { count: fridge.countToday }),
      available: fridge.available,
      roomId: fridgeRoom?.roomId ?? null,
      icon: Refrigerator,
      tone: 'fridge',
    });
  }
  const toilet = data?.cards.find((card) => card.kind === 'TOILET');
  if (toilet) {
    const toiletRoom = data?.roomSummaries.find((candidate) => candidate.name === toilet.label);
    usageSensors.push({
      key: toilet.id,
      title: t('welcomePage.toilet'),
      value: !toilet.available
        ? t('welcomePage.unavailable')
        : toilet.countToday > 0
          ? t('welcomePage.visitDetected')
          : t('welcomePage.noVisit'),
      detail: t('welcomePage.visitsToday', { count: toilet.countToday }),
      available: toilet.available,
      roomId: toiletRoom?.roomId ?? null,
      icon: Toilet,
      tone: 'toilet',
    });
  }
  const bathroom = data?.roomSummaries.find((candidate) => roomIconKey(candidate) === 'BATHROOM');
  if (bathroom) {
    const humidity = bathroom.sensors.find((sensor) => sensor.capability === 'humidity');
    const configured = Boolean(humidity);
    const shower = bathroom.shower;
    const unavailable = !humidity?.available || shower?.state === 'UNAVAILABLE';
    usageSensors.push({
      key: `shower:${bathroom.roomId}`,
      title: t('welcomePage.shower'),
      value: !configured
        ? t('welcomePage.setupRequired')
        : unavailable
          ? t('welcomePage.unavailable')
          : showerStatusText(shower),
      detail: !configured
        ? t('welcomePage.assignAHumiditySensor')
        : showerDetailText(shower, humidity, locale, timezone, now),
      available: configured ? !unavailable : null,
      roomId: bathroom.roomId,
      icon: ShowerHead,
      tone: 'shower',
    });
  }
  if (data) {
    const bedroom = data.rooms.find(({ kind }) => kind === 'BEDROOM');
    const sleep = data.sleep;
    const roomId = sleep?.roomId ?? bedroom?.id ?? null;
    const configured = Boolean(sleep?.configured);
    const available = configured ? Boolean(sleep?.available) : null;
    usageSensors.push({
      key: 'bedtime',
      title: t('welcomePage.yesterdaySBedtime'),
      value: !configured
        ? t('welcomePage.setupRequired')
        : sleep?.bedtimeAt
          ? time(sleep.bedtimeAt)
          : t('welcomePage.awaitingObservation'),
      detail: !configured
        ? t('welcomePage.assignTheBedContact')
        : !available
          ? t('welcomePage.sensorUnavailable')
          : sleep?.bedtimeAt
            ? t('welcomePage.bedtimeObservedDuringThePrevious')
            : t('welcomePage.noBedtimeObservedDuringThe'),
      available,
      roomId,
      icon: MoonStar,
      tone: 'bedtime',
    });
    usageSensors.push({
      key: 'wake-up',
      title: t('welcomePage.todaySWakeUp'),
      value: !configured
        ? t('welcomePage.setupRequired')
        : sleep?.wakeAt
          ? time(sleep.wakeAt)
          : t('welcomePage.awaitingObservation'),
      detail: !configured
        ? t('welcomePage.assignTheBedContact')
        : !available
          ? t('welcomePage.sensorUnavailable')
          : sleep?.wakeAt
            ? t('welcomePage.wakeUpObservedToday')
            : t('welcomePage.noWakeUpObservedToday'),
      available,
      roomId,
      icon: Sunrise,
      tone: 'wakeup',
    });
  }

  function openWeatherEditor() {
    const city = screen?.state.settings.weatherCity.trim() ?? '';
    setWeatherCityQuery(city);
    setSelectedWeatherCity(city);
    setWeatherModalError('');
    setWeatherModalOpen(true);
  }

  async function saveWeatherCity(event: React.FormEvent) {
    event.preventDefault();
    if (!screen?.grant.administer || !selectedWeatherCity.trim() || weatherSaving) return;
    setWeatherSaving(true);
    setWeatherModalError('');
    try {
      const updated = await welcomeScreenRequest<ScreenSnapshot>(
        'screen/settings',
        { ...screen.state.settings, weatherCity: selectedWeatherCity.trim() },
        'PATCH',
      );
      setScreen(updated);
      setWeatherModalOpen(false);
    } catch (cause) {
      setWeatherModalError(
        cause instanceof Error ? cause.message : t('welcomePage.theWeatherSettingsCouldNot'),
      );
    } finally {
      setWeatherSaving(false);
    }
  }

  if (!data && !error)
    return <DataLoadingScreen locale={locale} message={t('welcomePage.preparingYourDay')} />;
  return (
    <section className="welcome-page">
      <header className="page-hero welcome-hero">
        <div className="page-hero__copy welcome-greeting">
          <h2 className="page-hero__title">{t('welcomePage.hello', { caregiverFirstName })}</h2>
          <p className="page-hero__text">
            {t('welcomePage.eliseIsWatchingOver', { residentName })}
          </p>
        </div>
        <div className="welcome-context">
          <span className="welcome-date">
            {now.toLocaleDateString(locale, {
              timeZone: timezone,
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
          <time className="welcome-clock">{time(now)}</time>
          {configuredWeatherCity ? (
            screen?.grant.administer ? (
              <button
                type="button"
                className="welcome-weather welcome-weather--button welcome-weather--configured"
                aria-label={t('welcomePage.changeTvWeather', { configuredWeatherCity })}
                onClick={openWeatherEditor}
              >
                <WeatherIcon aria-hidden="true" />
                <strong>{weather ? `${Math.round(weather.temperature)}°C` : '—'}</strong>
                <span>
                  {weather?.city ?? configuredWeatherCity}
                  <small>{weatherLabel}</small>
                </span>
                <Pencil className="welcome-weather-action-icon" aria-hidden="true" />
              </button>
            ) : (
              <div className="welcome-weather" aria-label={weatherLabel}>
                <WeatherIcon aria-hidden="true" />
                <strong>{weather ? `${Math.round(weather.temperature)}°C` : '—'}</strong>
                <span>
                  {weather?.city ?? configuredWeatherCity}
                  <small>{weatherLabel}</small>
                </span>
              </div>
            )
          ) : screen?.grant.administer ? (
            <button
              type="button"
              className="welcome-weather welcome-weather--button welcome-weather--setup"
              onClick={openWeatherEditor}
            >
              <CloudSun aria-hidden="true" />
              <span>
                <strong>{t('welcomePage.setUpWeather')}</strong>
                <small>{t('welcomePage.chooseTheHomeAndTv')}</small>
              </span>
              <ChevronRight className="welcome-weather-action-icon" aria-hidden="true" />
            </button>
          ) : (
            <div className="welcome-weather welcome-weather--readonly">
              <CloudSun aria-hidden="true" />
              <span>
                <strong>{t('welcomePage.weatherNeedsSetup')}</strong>
                <small>{t('welcomePage.askAnAdministratorToSet')}</small>
              </span>
            </div>
          )}
        </div>
      </header>
      <section
        className={`welcome-playback${screenIsPlaying ? ' is-playing' : ''}`}
        aria-label={t('welcomePage.tvPlayback')}
        aria-live="polite"
      >
        <span className={`welcome-playback__dot${screenIsPlaying ? ' is-live' : ''}`} />
        <span className="welcome-playback__icon">
          <ScreenMediaIcon aria-hidden="true" />
        </span>
        <span className="welcome-playback__copy">
          <small>{screenPlaybackStatus}</small>
          <strong>{screenPlaybackTitle}</strong>
        </span>
        {screenMediaType && <span className="welcome-playback__type">{screenMediaType}</span>}
      </section>
      {reminder && (
        <button type="button" className="welcome-appointment-bar" onClick={() => onPlanning(false)}>
          <span className="welcome-appointment-bar__icon">
            <CalendarDays aria-hidden="true" />
          </span>
          <span className="welcome-appointment-bar__copy">
            <small>{t('welcomePage.nextAppointment')}</small>
            <strong>{reminder.title}</strong>
          </span>
          <span className="welcome-appointment-bar__when">{reminderDateLabel}</span>
          <ChevronRight className="welcome-appointment-bar__chevron" aria-hidden="true" />
        </button>
      )}
      {error && (
        <div className="welcome-error" role="status">
          <AlertTriangle />
          <p>{t('welcomePage.updatesAreUnavailableDisplayedInformatio')}</p>
          <button onClick={() => setRetry((n) => n + 1)}>{t('welcomePage.tryAgain')}</button>
        </div>
      )}
      <div className="welcome-main-grid">
        <article className="welcome-card welcome-now">
          <header className="welcome-card-heading">
            <h3>
              <i className={`welcome-dot ${data?.alert || error ? 'is-warning' : ''}`} />
              {t('welcomePage.rightNow')}
            </h3>
            <small className="welcome-time-pill">{time(data?.to ?? now)}</small>
          </header>
          <div className="welcome-presence">
            <div>
              <p className="welcome-moment-lead">
                {data ? presenceText(data, locale) : t('welcomePage.homeInformationIsUnavailable')}
              </p>
            </div>
            <img className="welcome-chair" src="/welcome-chair.svg" alt="" />
          </div>
          {data && latestPresenceText(data, locale) && (
            <p className="welcome-last-presence">{latestPresenceText(data, locale)}</p>
          )}
        </article>
        <article className="welcome-card welcome-day">
          <header className="welcome-card-heading">
            <h3>
              <i className="welcome-dot" />
              {t('welcomePage.sDay', { residentFirstName })}
            </h3>
          </header>
          <p className="welcome-day-story">
            {data
              ? dayNarrativeText(data, activitySummary, locale, previousActivitySummary)
              : t('welcomePage.theDaySummaryIsBeing')}
          </p>
          <button type="button" className="welcome-day-activity" onClick={onActivity}>
            {t('welcomePage.viewAllActivity')}
            <ChevronRight aria-hidden="true" />
          </button>
        </article>
        <article className="welcome-card welcome-sensors">
          <header className="welcome-card-heading">
            <h3>
              <i className="welcome-dot" />
              {t('welcomePage.dailyEssentials')}
            </h3>
          </header>
          <div className="welcome-sensor-grid">
            {usageSensors.map((usage) => {
              const Icon = usage.icon;
              return (
                <button
                  key={usage.key}
                  className={`welcome-sensor welcome-sensor--${usage.tone}`}
                  onClick={() => (usage.roomId ? onOpenRoom(usage.roomId) : onSensors())}
                >
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{usage.title}</strong>
                    <small>{usage.value}</small>
                    <small className="welcome-sensor-detail">{usage.detail}</small>
                  </span>
                  {usage.available !== null && (
                    <i
                      className={usage.available ? 'is-online' : ''}
                      aria-label={
                        usage.available ? t('welcomePage.online') : t('welcomePage.unavailable')
                      }
                    />
                  )}
                </button>
              );
            })}
          </div>
          {!usageSensors.length && (
            <p className="welcome-empty">{t('welcomePage.dailyEssentialsWillAppearHere')}</p>
          )}
        </article>
        <article className="welcome-card welcome-events">
          <header className="welcome-card-heading">
            <h3>
              <Clock3 />
              {t('welcomePage.latestEvents')}
            </h3>
            <button className="welcome-see-all" onClick={onActivity}>
              {t('welcomePage.viewAll')}
            </button>
          </header>
          <ul className="welcome-event-list">
            {recent.map((event) => {
              const Icon = ['motion', 'occupancy', 'person_presence'].includes(event.capability)
                ? PersonStanding
                : (sensorIcons[event.capability] ?? Activity);
              return (
                <li key={event.id}>
                  <span className={`welcome-event-icon capability-${event.capability}`}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span>{event.label}</span>
                  <time
                    title={new Date(event.occurredAt).toLocaleString(locale, {
                      timeZone: timezone,
                    })}
                  >
                    {day(event.occurredAt) === day(now)
                      ? time(event.occurredAt)
                      : `${new Date(event.occurredAt).toLocaleDateString(locale, { timeZone: timezone, day: 'numeric', month: 'short' })} · ${time(event.occurredAt)}`}
                  </time>
                </li>
              );
            })}
          </ul>
          {!recent.length && <p className="welcome-empty">{t('welcomePage.noRecentEvents')}</p>}
        </article>
      </div>
      {weatherModalOpen && (
        <div
          className="welcome-weather-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !weatherSaving) setWeatherModalOpen(false);
          }}
        >
          <form
            className="welcome-weather-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-weather-modal-title"
            onSubmit={(event) => void saveWeatherCity(event)}
          >
            <header>
              <span className="welcome-weather-modal-icon">
                <CloudSun aria-hidden="true" />
              </span>
              <div>
                <h2 id="welcome-weather-modal-title">{t('welcomePage.homeAndTvWeather')}</h2>
                <p>{t('welcomePage.chooseACityToShow')}</p>
              </div>
              <button
                type="button"
                className="welcome-weather-modal-close"
                aria-label={t('welcomePage.close')}
                disabled={weatherSaving}
                onClick={() => setWeatherModalOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <label className="welcome-weather-search-label" htmlFor="welcome-weather-city">
              {t('welcomePage.city')}
            </label>
            <div className="welcome-weather-search">
              <Search aria-hidden="true" />
              <input
                id="welcome-weather-city"
                autoFocus
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={weatherCities.length > 0}
                aria-controls="welcome-weather-city-options"
                value={weatherCityQuery}
                placeholder={t('welcomePage.eGOrleansTours')}
                onChange={(event) => {
                  setWeatherCityQuery(event.target.value);
                  setSelectedWeatherCity('');
                  setWeatherCities([]);
                  setWeatherModalError('');
                }}
              />
              {weatherSearchBusy && <span className="welcome-weather-search-spinner" />}
            </div>
            {weatherCities.length > 0 && (
              <div
                id="welcome-weather-city-options"
                className="welcome-weather-city-options"
                role="listbox"
                aria-label={t('welcomePage.suggestedCities')}
              >
                {weatherCities.map((city) => (
                  <button
                    key={`${city.label}-${city.latitude}-${city.longitude}`}
                    type="button"
                    role="option"
                    aria-selected={selectedWeatherCity === city.name}
                    onClick={() => {
                      setWeatherCityQuery(city.name);
                      setSelectedWeatherCity(city.name);
                      setWeatherCities([]);
                      setWeatherSearchError('');
                    }}
                  >
                    <MapPin aria-hidden="true" />
                    <span>
                      <strong>{city.name}</strong>
                      <small>{city.label}</small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            {weatherSearchError && (
              <p className="welcome-weather-modal-error" role="status">
                {weatherSearchError}
              </p>
            )}
            {!weatherSearchBusy &&
              !weatherSearchError &&
              weatherCityQuery.trim().length >= 2 &&
              weatherCities.length === 0 &&
              !selectedWeatherCity && (
                <p className="welcome-weather-modal-hint">{t('welcomePage.noSuggestionsYet')}</p>
              )}
            {weatherModalError && (
              <p className="welcome-weather-modal-error" role="alert">
                {weatherModalError}
              </p>
            )}
            <p className="welcome-weather-modal-hint">{t('welcomePage.theSelectedCityWillAlso')}</p>
            <footer>
              <button
                type="button"
                className="welcome-weather-cancel"
                disabled={weatherSaving}
                onClick={() => setWeatherModalOpen(false)}
              >
                {t('welcomePage.cancel')}
              </button>
              <button
                type="submit"
                className="welcome-weather-save"
                disabled={!selectedWeatherCity || weatherSaving || !screen?.grant.administer}
              >
                {weatherSaving
                  ? t('welcomePage.saving')
                  : configuredWeatherCity
                    ? t('welcomePage.updateCity')
                    : t('welcomePage.setUp')}
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
