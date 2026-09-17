import { useEffect, useState } from 'react';
import {
  ARTE_LIVE_URL,
  activitySummarySchema,
  homeSummarySchema,
  type ActivitySummary,
  type HomeSummary,
  type EntranceSummary,
  type ScreenSnapshot,
} from '@michel/contracts';
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
  Image,
  MessageCircle,
  MessageSquare,
  Monitor,
  Phone,
  Pill,
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
  Toilet,
  Tv,
  Zap,
} from 'lucide-react';
import { roomIconKey } from './home-visuals';
import { DataLoadingScreen } from './DataLoadingScreen';
import type { Locale } from './i18n';
import { subscribeScreenEvents } from './screen-events';
import './welcome-page.css';

export function homeCardText(card: HomeSummary['cards'][number], locale: Locale, timezone: string) {
  const fr = locale === 'fr';
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
        ? fr
          ? `Ouvert aujourd’hui, la dernière fois à ${at}.`
          : `Opening detected today at ${at}.`
        : fr
          ? `Activité détectée aujourd’hui à ${at}.`
          : `Activity detected today at ${at}.`;
    if (card.kind === 'TOILET')
      text = fr
        ? `Un passage a été détecté aujourd’hui à ${at}.`
        : `A visit was detected today at ${at}.`;
  }
  if (!card.available)
    return [
      text,
      fr ? 'Les informations actuelles sont indisponibles.' : 'Current information is unavailable.',
    ]
      .filter(Boolean)
      .join(' ');
  if (['FRIDGE', 'OPENING'].includes(card.kind) && card.state !== 'UNKNOWN')
    text += fr
      ? card.state === 'ACTIVE'
        ? ' Actuellement ouvert.'
        : ' Actuellement fermé.'
      : card.state === 'ACTIVE'
        ? ' Currently open.'
        : ' Currently closed.';
  if (card.kind === 'APPLIANCE' && card.state !== 'UNKNOWN')
    text += fr
      ? card.state === 'ACTIVE'
        ? ' Actuellement allumé.'
        : ' Actuellement éteint.'
      : card.state === 'ACTIVE'
        ? ' Currently on.'
        : ' Currently off.';
  if (card.kind === 'SAFETY' && card.state === 'ACTIVE')
    text += fr ? ' Un signal demande votre attention.' : ' A signal needs your attention.';
  if (text.trim()) return text.trim();
  if (card.kind === 'APPLIANCE')
    return fr
      ? 'Le fonctionnement ne peut pas être déterminé avec les informations disponibles.'
      : 'Operation cannot be determined from the available information.';
  if (card.kind === 'COMFORT' && card.state === 'ACTIVE')
    return fr
      ? 'La température dépasse un seuil configuré.'
      : 'The temperature is outside a configured threshold.';
  if (card.kind === 'COMFORT' && card.state === 'INACTIVE')
    return fr
      ? 'La température respecte les seuils configurés.'
      : 'The temperature is within the configured thresholds.';
  if (card.kind === 'COMFORT')
    return fr
      ? 'Les informations de confort sont reçues. Aucun état de confort interprété n’est disponible.'
      : 'Comfort information is being received. No interpreted comfort status is available.';
  return fr ? 'Aucune activité détectée aujourd’hui.' : 'No activity detected today.';
}

export function entranceText(entrance: EntranceSummary, locale: Locale, timezone: string) {
  const fr = locale === 'fr';
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
      return fr
        ? `Entrée probable le ${at} : l’ouverture de la porte a été suivie d’un mouvement sur le trajet intérieur.`
        : `Likely entry on ${at}: the door opening was followed by movement on the indoor path.`;
    case 'EXIT_LIKELY':
      return fr
        ? `Sortie probable le ${at} : un mouvement vers l’entrée a précédé l’ouverture, puis aucune activité intérieure n’a été détectée après la fermeture.`
        : `Likely exit on ${at}: movement towards the entrance preceded the opening, with no indoor activity detected after the door closed.`;
    case 'PENDING':
      return fr
        ? 'La porte principale a été ouverte. Les prochains mouvements permettront de préciser le sens du passage.'
        : 'The main door was opened. Subsequent movement will help determine the direction of passage.';
    case 'INSIDE_ACTIVITY':
      return fr
        ? 'De l’activité a été détectée à l’intérieur après l’ouverture de la porte principale. Le sens du passage reste incertain.'
        : 'Indoor activity was detected after the main door opened. The direction of passage remains uncertain.';
    case 'UNCERTAIN':
      return fr
        ? 'La porte principale a été ouverte, mais les observations ne permettent pas de distinguer une entrée d’une sortie.'
        : 'The main door was opened, but observations cannot distinguish an entry from an exit.';
    case 'UNAVAILABLE':
      return fr
        ? 'Les informations de la porte principale et de son trajet intérieur sont insuffisantes pour comprendre les passages.'
        : 'Information from the main door and indoor path is insufficient to interpret passages.';
    default:
      return fr
        ? 'Aucun passage détecté à la porte principale aujourd’hui.'
        : 'No passage detected at the main door today.';
  }
}

function roomWithArticle(
  room: Pick<HomeSummary['rooms'][number], 'kind' | 'name'>,
  locale: Locale,
) {
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
  return labels[roomIconKey(room)] ?? `la pièce « ${room.name} »`;
}

export function presenceText(data: HomeSummary, locale: Locale) {
  const fr = locale === 'fr';
  const p = data.presence;
  const resident = data.residentName || (fr ? 'Le résident' : 'The resident');
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
    return fr
      ? `${resident} est dans ${roomWithArticle(latestRoom, locale)}.`
      : `${resident} is in ${latestRoom.name}.`;
  const room = data.rooms.find((r) => r.id === (p.confirmedRoomId ?? p.roomId));
  if (p.trackingState === 'CONFIRMED' && !p.trackingDegraded && room)
    return fr
      ? `${resident} est dans ${roomWithArticle(room, locale)}.`
      : `${resident} is in ${room.name}.`;
  if (p.trackingState === 'IN_TRANSIT')
    return fr
      ? `${resident} semble se déplacer dans le logement.`
      : `${resident} appears to be moving through the home.`;
  if (p.trackingState === 'AMBIGUOUS' || p.trackingDegraded)
    return fr
      ? `Les dernières observations ne permettent pas encore de situer ${resident} précisément.`
      : `The latest observations do not yet locate ${resident} precisely.`;
  const confirmedRoomEvidence = p.evidenceSummary
    .filter((item) => item.roomId === p.confirmedRoomId && item.observed !== false)
    .map((item) => item.occurredAt)
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0];
  const timestamp = confirmedRoomEvidence ?? p.lastConfirmedAt ?? p.detectedAt;
  if (room && timestamp)
    return fr
      ? `${resident} se trouve probablement dans ${roomWithArticle(room, locale)}. La dernière détection date de ${new Date(timestamp).toLocaleTimeString(locale, { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' })}.`
      : `${resident} is probably in ${room.name}. The last detection was at ${new Date(timestamp).toLocaleTimeString(locale, { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' })}.`;
  return fr
    ? `Il n’y a pas encore assez d’informations pour situer ${resident}.`
    : `There is not enough information to locate ${resident} yet.`;
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
  return locale === 'fr'
    ? `Dernière détection dans ${roomWithArticle(room, locale)} à ${at}.`
    : `Last detection in ${room.name} at ${at}.`;
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
    return room ? roomWithArticle(room, locale) : name;
  });
  const journey =
    locale === 'fr'
      ? `Depuis le début de la journée, son activité a été observée dans ${naturalList(trail, locale)}.`
      : `Since the start of the day, activity has been observed in ${naturalList(trail, locale)}.`;
  return `${location} ${journey}`;
}

export function dayText(data: HomeSummary, locale: Locale) {
  const fr = locale === 'fr';
  const sentences: string[] = [];
  const activityRooms = [...new Set(data.activityRooms)].slice(0, 4);
  if (activityRooms.length)
    sentences.push(
      fr
        ? `La journée s’est déroulée entre ${naturalList(activityRooms, locale)}.`
        : `The day has unfolded between ${naturalList(activityRooms, locale)}.`,
    );
  if (data.cards.some((c) => c.kind === 'FRIDGE' && c.observedToday))
    sentences.push(fr ? 'Le réfrigérateur a été ouvert.' : 'The refrigerator was opened.');
  if (data.cards.some((c) => c.kind === 'TOILET' && c.observedToday))
    sentences.push(
      fr ? 'Un passage a été détecté aux toilettes.' : 'A visit to the toilet was detected.',
    );
  if (!sentences.length)
    sentences.push(
      fr
        ? 'La journée se dessine doucement. Élise partagera les premiers repères ici.'
        : 'The day is taking shape. Élise will share the first landmarks here.',
    );
  if (data.entrance?.openedAt) {
    const at = new Date(data.entrance.openedAt).toLocaleTimeString(locale, {
      timeZone: data.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    sentences.push(
      data.entrance.state === 'ENTRY_LIKELY'
        ? fr
          ? `Une entrée a été repérée à ${at}.`
          : `An arrival was noticed at ${at}.`
        : data.entrance.state === 'EXIT_LIKELY'
          ? fr
            ? `Une sortie a été repérée à ${at}.`
            : `A departure was noticed at ${at}.`
          : fr
            ? `La porte d’entrée a été ouverte à ${at}.`
            : `The front door was opened at ${at}.`,
    );
  }
  return sentences.slice(0, 3).join(' ');
}

function narrativeDuration(seconds: number, locale: Locale) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return locale === 'fr'
    ? `${hours} h${remaining ? ` ${remaining} min` : ''}`
    : `${hours} hr${remaining ? ` ${remaining} min` : ''}`;
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

function naturalTime(value: string, timeZone: string, locale: Locale) {
  if (locale !== 'fr')
    return new Date(value).toLocaleTimeString(locale, {
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
  const fr = locale === 'fr';
  const resident = data.residentName || (fr ? 'Le résident' : 'The resident');
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
      fr
        ? `${resident} s’est couché hier vers ${naturalTime(bedtime, data.timezone, locale)} et s’est réveillé ce matin vers ${naturalTime(wakeUp, data.timezone, locale)}.`
        : `${resident} went to bed around ${naturalTime(bedtime, data.timezone, locale)} last night and woke up around ${naturalTime(wakeUp, data.timezone, locale)} this morning.`,
    );
  else if (wakeUp)
    sentences.push(
      fr
        ? `${resident} s’est réveillé ce matin vers ${naturalTime(wakeUp, data.timezone, locale)}.`
        : `${resident} woke up around ${naturalTime(wakeUp, data.timezone, locale)} this morning.`,
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
      fr
        ? `Il a passé environ ${narrativeDuration(livingRoomSeconds, locale)} dans le salon.`
        : `He spent about ${narrativeDuration(livingRoomSeconds, locale)} in the living room.`,
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
      fr
        ? `Vers ${naturalTime(lunchTime, data.timezone, locale)}, il est allé déjeuner dans la cuisine${spentAfternoonInLivingRoom ? ', puis il est retourné au salon pour l’après-midi' : ''}.`
        : `Around ${naturalTime(lunchTime, data.timezone, locale)}, he went to the kitchen for lunch${spentAfternoonInLivingRoom ? ', then returned to the living room for the afternoon' : ''}.`,
    );
  else if (spentAfternoonInLivingRoom)
    sentences.push(
      fr
        ? 'Il a ensuite passé l’après-midi dans le salon.'
        : 'He then spent the afternoon in the living room.',
    );

  if (!sentences.length)
    return fr
      ? `La journée de ${resident} commence doucement. Le résumé s’enrichira avec les prochaines observations fiables.`
      : `${resident}’s day is starting quietly. This summary will grow as reliable observations arrive.`;
  return sentences.join(' ');
}

const sensorLabels: Record<string, [string, string]> = {
  motion: ['Mouvement', 'Motion'],
  occupancy: ['Présence', 'Presence'],
  person_presence: ['Présence', 'Presence'],
  contact: ['Ouverture', 'Opening'],
  temperature: ['Température', 'Temperature'],
  humidity: ['Humidité', 'Humidity'],
  illuminance: ['Luminosité', 'Illuminance'],
  co2: ['CO₂', 'CO₂'],
  voc: ['Qualité de l’air', 'Air quality'],
  pm25: ['Particules fines', 'Fine particles'],
  air_quality: ['Qualité de l’air', 'Air quality'],
  power: ['Puissance', 'Power'],
  energy: ['Énergie', 'Energy'],
  switch: ['Appareil', 'Device'],
  current: ['Courant', 'Current'],
  voltage: ['Tension', 'Voltage'],
  battery: ['Batterie', 'Battery'],
  water_leak: ['Fuite d’eau', 'Water leak'],
  smoke: ['Fumée', 'Smoke'],
  carbon_monoxide: ['Monoxyde de carbone', 'Carbon monoxide'],
  fall_detection: ['Chute', 'Fall detection'],
  signal_strength: ['Signal', 'Signal'],
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

export function roomSensorLabel(capability: string, locale: Locale) {
  return sensorLabels[capability]?.[locale === 'fr' ? 0 : 1] ?? capability;
}

export function roomSensorValue(
  sensor: HomeSummary['roomSummaries'][number]['sensors'][number],
  locale: Locale,
) {
  const fr = locale === 'fr';
  if (!sensor.available) return fr ? 'Indisponible' : 'Unavailable';
  if (['occupancy', 'person_presence'].includes(sensor.capability))
    return sensor.state === 'ACTIVE' ? (fr ? 'Détectée' : 'Detected') : fr ? 'Aucune' : 'None';
  if (sensor.capability === 'motion')
    return sensor.state === 'ACTIVE' ? (fr ? 'Détecté' : 'Detected') : fr ? 'Aucun' : 'None';
  if (sensor.capability === 'contact')
    return sensor.state === 'ACTIVE' ? (fr ? 'Ouvert' : 'Open') : fr ? 'Fermé' : 'Closed';
  if (sensor.capability === 'switch' || sensor.capability === 'power')
    return sensor.state === 'ACTIVE' ? (fr ? 'Allumé' : 'On') : fr ? 'Éteint' : 'Off';
  if (sensor.value === null) return fr ? 'Aucune donnée' : 'No data';
  if (typeof sensor.value === 'boolean')
    return sensor.value ? (fr ? 'Oui' : 'Yes') : fr ? 'Non' : 'No';
  if (typeof sensor.value === 'number') {
    const value = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-GB', {
      maximumFractionDigits: 1,
    }).format(sensor.value);
    return `${value}${sensor.unit ? ` ${sensor.unit}` : ''}`;
  }
  return sensor.unit ? `${sensor.value} ${sensor.unit}` : sensor.value;
}

export function welcomeAlertTitle(title: string, locale: Locale, roomName?: string | null) {
  if (/occupancy|presence/i.test(title))
    return locale === 'fr'
      ? `Le capteur de présence${roomName ? ` des ${roomName.toLocaleLowerCase('fr')}` : ''} est indisponible.`
      : `The presence sensor${roomName ? ` in ${roomName}` : ''} is unavailable.`;
  return title;
}

export type WelcomeEvent = { id: string; occurredAt: string; capability: string; label: string };
export type WelcomeReminder = { title: string; at: string; medication: boolean };

function WelcomeLink({
  icon: Icon,
  children,
  onClick,
}: {
  icon: typeof Activity;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="welcome-link" onClick={onClick}>
      <Icon aria-hidden="true" />
      <span>{children}</span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

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
  onOpenRoom,
  onActivity,
  onSensors,
  onPlanning,
  onScreen,
}: {
  locale: Locale;
  caregiverFirstName: string;
  residentName: string;
  reassurance?: 'NORMAL' | 'LEARNING' | 'ATTENTION' | 'INSUFFICIENT_DATA';
  events?: WelcomeEvent[];
  reminders?: WelcomeReminder[];
  onAlerts: () => void;
  onOpenRoom: (roomId: string) => void;
  onActivity: () => void;
  onSensors: () => void;
  onPlanning: (medication: boolean) => void;
  onScreen: (section: 'call' | 'messages' | 'display' | 'photos') => void;
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
  const [messageDraft, setMessageDraft] = useState('');
  const [screenBusy, setScreenBusy] = useState(false);
  const [screenNotice, setScreenNotice] = useState('');
  const fr = locale === 'fr';
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
  const recent = [...events]
    .filter((event) => event.capability !== 'illuminance')
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 5);
  const reminder = [
    ...reminders,
    ...(screen?.agenda ?? []).map((item) => ({
      title: item.title,
      at: item.startsAt,
      medication: false,
    })),
  ]
    .filter((item) => Date.parse(item.at) >= now.getTime())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
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
    ? fr
      ? 'Météo indisponible'
      : 'Weather unavailable'
    : {
        clear: fr ? 'Ciel dégagé' : 'Clear skies',
        partial: fr ? 'Éclaircies' : 'Partly cloudy',
        cloud: fr ? 'Nuageux' : 'Cloudy',
        fog: fr ? 'Brouillard' : 'Fog',
        snow: fr ? 'Neige' : 'Snow',
        storm: fr ? 'Orage' : 'Storm',
        rain: fr ? 'Pluie' : 'Rain',
      }[weatherKind];
  const screenMessages = (
    screen?.state.messages?.length
      ? screen.state.messages
      : screen?.state.message
        ? [screen.state.message]
        : []
  ).filter(Boolean);
  const message = screenMessages.at(-1);
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
      title: fr ? 'Porte d’entrée' : 'Front door',
      value: !available
        ? fr
          ? 'Indisponible'
          : 'Unavailable'
        : entranceContact?.state === 'ACTIVE'
          ? fr
            ? 'Ouverte'
            : 'Open'
          : entranceContact?.state === 'INACTIVE'
            ? fr
              ? 'Fermée'
              : 'Closed'
            : fr
              ? 'État inconnu'
              : 'Unknown state',
      detail: fr ? 'État actuel' : 'Current state',
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
      title: fr ? 'Toilettes' : 'Toilet',
      value: !toilet.available
        ? fr
          ? 'Indisponible'
          : 'Unavailable'
        : toilet.countToday > 0
          ? fr
            ? 'Passage détecté'
            : 'Visit detected'
          : fr
            ? 'Aucun passage'
            : 'No visit',
      detail: fr
        ? `${toilet.countToday} passage${toilet.countToday === 1 ? '' : 's'} aujourd’hui`
        : `${toilet.countToday} visit${toilet.countToday === 1 ? '' : 's'} today`,
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
    usageSensors.push({
      key: `shower:${bathroom.roomId}`,
      title: fr ? 'Douche' : 'Shower',
      value: !configured
        ? fr
          ? 'À configurer'
          : 'Setup required'
        : humidity?.available
          ? fr
            ? 'Suivi actif'
            : 'Monitoring active'
          : fr
            ? 'Indisponible'
            : 'Unavailable',
      detail: !configured
        ? fr
          ? 'Associer un capteur d’humidité'
          : 'Assign a humidity sensor'
        : humidity?.available
          ? fr
            ? `Humidité ${roomSensorValue(humidity, locale)}`
            : `Humidity ${roomSensorValue(humidity, locale)}`
          : fr
            ? 'Humidité non disponible'
            : 'Humidity unavailable',
      available: configured ? Boolean(humidity?.available) : null,
      roomId: bathroom.roomId,
      icon: ShowerHead,
      tone: 'shower',
    });
  }

  async function addFamilyMessage(event: React.FormEvent) {
    event.preventDefault();
    const next = messageDraft.trim();
    if (!next || screenBusy) return;
    if (screenMessages.length >= 20) {
      setScreenNotice(
        fr ? 'La file TV contient déjà 20 messages.' : 'The TV queue already has 20 messages.',
      );
      return;
    }
    setScreenBusy(true);
    setScreenNotice('');
    try {
      const snapshot = await welcomeScreenRequest<ScreenSnapshot>(
        'screen/message',
        {
          messages: [...screenMessages, next],
          messageIntervalSeconds: screen?.state.messageIntervalSeconds ?? 20,
        },
        'PATCH',
      );
      setScreen(snapshot);
      setMessageDraft('');
      setScreenNotice(fr ? 'Message ajouté à la file de la TV.' : 'Message added to the TV queue.');
    } catch (cause) {
      setScreenNotice(
        cause instanceof Error ? cause.message : fr ? 'Ajout impossible.' : 'Unable to add.',
      );
    } finally {
      setScreenBusy(false);
    }
  }

  async function playArte() {
    if (screenBusy) return;
    setScreenBusy(true);
    setScreenNotice('');
    try {
      const snapshot =
        screen ?? (await welcomeScreenRequest<ScreenSnapshot>('screen', undefined, 'GET'));
      const existing = snapshot.state.media.find(
        (media) => media.kind === 'tv' && media.url === ARTE_LIVE_URL,
      );
      const mediaId = existing?.id ?? crypto.randomUUID();
      if (!existing)
        await welcomeScreenRequest('screen/media', {
          id: mediaId,
          title: 'ARTE en direct',
          kind: 'tv',
          url: ARTE_LIVE_URL,
        });
      await welcomeScreenRequest('screen/commands', { action: 'play', mediaId });
      setScreenNotice(fr ? 'ARTE est lancé sur la TV.' : 'ARTE is playing on the TV.');
    } catch (cause) {
      setScreenNotice(
        cause instanceof Error ? cause.message : fr ? 'Lancement impossible.' : 'Unable to start.',
      );
    } finally {
      setScreenBusy(false);
    }
  }
  if (!data && !error)
    return (
      <DataLoadingScreen
        locale={locale}
        message={fr ? 'Préparation de votre journée…' : 'Preparing your day…'}
      />
    );
  return (
    <section className="welcome-page">
      <header className="welcome-hero">
        <div className="welcome-greeting">
          <h2>{fr ? `Bonjour ${caregiverFirstName},` : `Hello ${caregiverFirstName},`}</h2>
          <p>
            {fr ? `Élise veille sur ${residentName}.` : `Élise is watching over ${residentName}.`}
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
          <div className="welcome-weather">
            <WeatherIcon aria-hidden="true" />
            <strong>{weather ? `${Math.round(weather.temperature)}°C` : '—'}</strong>
            <span>
              {weather?.city}
              <small>{weatherLabel}</small>
            </span>
          </div>
        </div>
      </header>
      {error && (
        <div className="welcome-error" role="status">
          <AlertTriangle />
          <p>
            {fr
              ? 'La mise à jour est indisponible. Les informations affichées peuvent être anciennes.'
              : 'Updates are unavailable. Displayed information may be out of date.'}
          </p>
          <button onClick={() => setRetry((n) => n + 1)}>{fr ? 'Réessayer' : 'Try again'}</button>
        </div>
      )}
      <div className="welcome-main-grid">
        <article className="welcome-card welcome-now">
          <header className="welcome-card-heading">
            <h3>
              <i className={`welcome-dot ${data?.alert || error ? 'is-warning' : ''}`} />
              {fr ? 'En ce moment' : 'Right now'}
            </h3>
            <small className="welcome-time-pill">{time(data?.to ?? now)}</small>
          </header>
          <div className="welcome-presence">
            <div>
              <p className="welcome-moment-lead">
                {data
                  ? presenceText(data, locale)
                  : fr
                    ? 'Les informations du logement sont indisponibles.'
                    : 'Home information is unavailable.'}
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
              {fr ? `La journée de ${residentFirstName}` : `${residentFirstName}'s day`}
            </h3>
          </header>
          <p className="welcome-day-story">
            {data
              ? dayNarrativeText(data, activitySummary, locale, previousActivitySummary)
              : fr
                ? 'Le résumé de la journée se prépare.'
                : 'The day summary is being prepared.'}
          </p>
        </article>
        <article className="welcome-card welcome-sensors">
          <header className="welcome-card-heading">
            <h3>
              <i className="welcome-dot" />
              {fr ? 'Repères du quotidien' : 'Daily essentials'}
            </h3>
            <button className="welcome-see-all" onClick={onSensors}>
              {fr ? 'Tout voir' : 'View all'}
            </button>
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
                        usage.available
                          ? fr
                            ? 'En ligne'
                            : 'Online'
                          : fr
                            ? 'Indisponible'
                            : 'Unavailable'
                      }
                    />
                  )}
                </button>
              );
            })}
          </div>
          {!usageSensors.length && (
            <p className="welcome-empty">
              {fr
                ? 'La porte d’entrée, le réfrigérateur et les toilettes apparaîtront ici une fois configurés.'
                : 'The front door, refrigerator and toilet will appear here once configured.'}
            </p>
          )}
        </article>
        <article className="welcome-card welcome-events">
          <header className="welcome-card-heading">
            <h3>
              <Clock3 />
              {fr ? 'Derniers événements' : 'Latest events'}
            </h3>
            <button className="welcome-see-all" onClick={onActivity}>
              {fr ? 'Tout voir' : 'View all'}
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
          {!recent.length && (
            <p className="welcome-empty">{fr ? 'Aucun événement récent.' : 'No recent events.'}</p>
          )}
        </article>
      </div>
      <div className="welcome-bottom-grid">
        <article className="welcome-card welcome-family">
          <header className="welcome-card-heading">
            <h3>
              <MessageSquare />
              {fr ? 'Messages pour la famille' : 'Messages for the family'}
            </h3>
          </header>
          <div className="welcome-message">
            <p>
              {message ||
                (fr
                  ? 'Un petit mot pour égayer sa journée ?'
                  : 'A little note to brighten their day?')}
            </p>
            {message && (
              <div>
                {screen?.state.messageUpdatedAt && (
                  <time>
                    {new Date(screen.state.messageUpdatedAt).toLocaleDateString(locale, {
                      timeZone: timezone,
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {time(screen.state.messageUpdatedAt)}
                  </time>
                )}
                {screen?.state.messageAuthor && <span>— {screen.state.messageAuthor}</span>}
              </div>
            )}
          </div>
          <form
            className="welcome-message-compose"
            onSubmit={(event) => void addFamilyMessage(event)}
          >
            <input
              value={messageDraft}
              maxLength={1000}
              onChange={(event) => setMessageDraft(event.target.value)}
              placeholder={fr ? 'Écrire un mot pour la TV…' : 'Write a note for the TV…'}
              aria-label={fr ? 'Nouveau message pour la TV' : 'New message for the TV'}
            />
            <button
              type="submit"
              disabled={
                screenBusy ||
                !messageDraft.trim() ||
                screenMessages.length >= 20 ||
                !screen?.grant.message
              }
            >
              {fr ? 'Ajouter' : 'Add'}
            </button>
          </form>
          {screenNotice && (
            <p className="welcome-screen-notice" role="status">
              {screenNotice}
            </p>
          )}
          <WelcomeLink icon={MessageCircle} onClick={() => onScreen('messages')}>
            {fr ? 'Voir tous les messages' : 'View all messages'}
          </WelcomeLink>
        </article>
        <article className="welcome-card welcome-reminder">
          <header className="welcome-card-heading">
            <h3>
              <Pill />
              {fr ? 'Prochain rappel' : 'Next reminder'}
            </h3>
          </header>
          <div className="welcome-reminder-detail">
            <Pill aria-hidden="true" />
            <div>
              <strong>
                {reminder?.title ?? (fr ? 'Aucun rappel prévu' : 'No upcoming reminder')}
              </strong>
              {reminder && (
                <p>
                  {day(reminder.at) === day(now)
                    ? fr
                      ? 'Aujourd’hui à'
                      : 'Today at'
                    : new Date(reminder.at).toLocaleDateString(locale, {
                        timeZone: timezone,
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                  {time(reminder.at)}
                </p>
              )}
            </div>
          </div>
          <WelcomeLink icon={CalendarDays} onClick={() => onPlanning(reminder?.medication ?? true)}>
            {fr ? 'Voir le planning' : 'View schedule'}
          </WelcomeLink>
        </article>
        <article className="welcome-card welcome-actions">
          <header className="welcome-card-heading">
            <h3>
              <Zap />
              {fr ? 'Actions rapides' : 'Quick actions'}
            </h3>
          </header>
          <div className="welcome-actions-grid">
            <button onClick={() => onScreen('call')}>
              <Phone />
              <span>{fr ? 'Appeler' : 'Call'}</span>
            </button>
            <button
              onClick={() => void playArte()}
              disabled={screenBusy || !screen?.online || !screen?.grant.control}
            >
              <Tv />
              <span>ARTE</span>
            </button>
            <button onClick={() => onScreen('display')}>
              <Monitor />
              <span>{fr ? 'Afficher sur la TV' : 'Display on TV'}</span>
            </button>
            <button onClick={() => onScreen('photos')}>
              <Image />
              <span>{fr ? 'Voir les photos' : 'View photos'}</span>
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
