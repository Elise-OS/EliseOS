import { z } from 'zod';
export const ARTE_LIVE_URL =
  'https://artesimulcast.akamaized.net/hls/live/2031003/artelive_fr/master.m3u8';
export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const id =
      url.hostname === 'youtu.be'
        ? url.pathname.slice(1)
        : ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
          ? url.pathname === '/watch'
            ? url.searchParams.get('v')
            : /^\/(shorts|live|embed)\/([^/]+)$/.exec(url.pathname)?.[2]
          : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const screenGrantSchema = z.object({
  call: z.boolean(),
  autoAnswer: z.boolean(),
  message: z.boolean(),
  control: z.boolean(),
  administer: z.boolean(),
});
export const screenMediaSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    kind: z.enum(['photo', 'audio', 'video', 'youtube', 'stream', 'tv']),
    url: z.string().max(2048),
    playlistUrls: z
      .array(
        z
          .string()
          .max(2048)
          .refine((url) => youtubeVideoId(url) !== null, 'Lien vidéo YouTube invalide.'),
      )
      .min(1)
      .max(50)
      .optional(),
    youtubePlaylistId: z.string().trim().max(150).optional(),
    artworkUrl: z.string().url().max(2048).optional(),
    mimeType: z
      .enum([
        'image/jpeg',
        'image/png',
        'image/webp',
        'audio/mpeg',
        'audio/ogg',
        'video/mp4',
        'video/webm',
      ])
      .optional(),
  })
  .superRefine((media, ctx) => {
    if (media.kind === 'youtube' && !youtubeVideoId(media.url))
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Lien vidéo YouTube invalide.' });
    if (media.playlistUrls && media.kind !== 'youtube')
      ctx.addIssue({
        code: 'custom',
        path: ['playlistUrls'],
        message: 'Playlist réservée à YouTube.',
      });
    if (media.kind === 'tv' && media.url !== ARTE_LIVE_URL)
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Chaîne TV non prise en charge.' });
  });
export const screenSlotSchema = z.object({
  id: z.string().uuid(),
  days: z.array(z.number().int().min(0).max(6)).min(1),
  time: clock,
  action: z.enum(['play', 'wake', 'sleep']),
  mediaId: z.string().uuid().nullable(),
});
export const screenSettingsSchema = z.object({
  consent: z.boolean(),
  volume: z.number().int().min(0).max(100),
  weatherCity: z.string().trim().max(120).default(''),
  slideshowSeconds: z.number().int().min(5).max(300).default(15),
  quietStart: clock,
  quietEnd: clock,
  grants: z.record(z.string(), screenGrantSchema),
  schedule: z.array(screenSlotSchema).max(100),
});
export const screenCommandSchema = z.object({
  action: z.enum([
    'play',
    'pause',
    'resume',
    'next',
    'stop',
    'wake',
    'sleep',
    'planning',
    'volume',
  ]),
  mediaId: z.string().uuid().optional(),
  volume: z.number().int().min(0).max(100).optional(),
});
export type ScreenGrant = z.infer<typeof screenGrantSchema>;
export type ScreenSettings = z.infer<typeof screenSettingsSchema>;
export type ScreenMedia = z.infer<typeof screenMediaSchema>;
export type ScreenCommand = z.infer<typeof screenCommandSchema>;
export interface ScreenCall {
  id: string;
  room: string;
  userId: string;
  name: string;
  automatic: boolean;
  createdAt: number;
  acceptedAt: number | null;
  callerSeenAt?: number;
  deadline: number;
}
export interface ScreenPlayback {
  mediaId: string | null;
  paused: boolean;
  asleep: boolean;
  volume: number;
  revision: number;
}
export interface ScreenActivity {
  id: string;
  kind: 'message' | 'content' | 'control' | 'call' | 'appointment' | 'settings';
  title: string;
  detail?: string;
  actor?: string;
  createdAt: number;
  status: 'pending' | 'applied' | 'failed' | 'expired';
}
export const appointmentPictograms = [
  { value: 'calendar', label: 'Rendez-vous', emoji: '📅' },
  { value: 'medical', label: 'Médecin / soins', emoji: '🩺' },
  { value: 'hairdresser', label: 'Coiffeur', emoji: '✂️' },
  { value: 'family', label: 'Famille / visite', emoji: '👋' },
  { value: 'meal', label: 'Repas', emoji: '🍽️' },
  { value: 'activity', label: 'Activité / sortie', emoji: '🎨' },
  { value: 'walk', label: 'Promenade', emoji: '🌳' },
  { value: 'transport', label: 'Transport', emoji: '🚗' },
] as const;
export const appointmentPictogramSchema = z.enum([
  'calendar',
  'medical',
  'hairdresser',
  'family',
  'meal',
  'activity',
  'walk',
  'transport',
]);
export type AppointmentPictogram = z.infer<typeof appointmentPictogramSchema>;
export const screenMessageSchema = z
  .object({
    message: z.string().max(1000).optional(),
    messages: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
    messageIntervalSeconds: z.number().int().min(5).max(600).optional(),
  })
  .refine((input) => input.message !== undefined || input.messages !== undefined, {
    message: 'Saisissez un message ou une liste de messages.',
  });
export type ScreenMessageInput = z.infer<typeof screenMessageSchema>;

export const screenScheduledContentInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    scheduledAt: z.coerce.date(),
    messages: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
    messageIntervalSeconds: z.number().int().min(5).max(600),
  }),
  z.object({
    kind: z.literal('photo'),
    scheduledAt: z.coerce.date(),
    mediaId: z.string().uuid(),
  }),
]);
export type ScreenScheduledContentInput = z.infer<typeof screenScheduledContentInputSchema>;

export interface ScreenScheduledContent {
  id: string;
  kind: 'message' | 'photo';
  scheduledAt: number;
  createdAt: number;
  actor: string;
  title: string;
  messages?: string[];
  messageIntervalSeconds?: number;
  mediaId?: string;
}

export interface ScreenState {
  settings: ScreenSettings;
  message: string;
  messages?: string[];
  messageIntervalSeconds?: number;
  messageAuthor?: string | null;
  messageUpdatedAt?: number | null;
  media: ScreenMedia[];
  playback: ScreenPlayback;
  call: ScreenCall | null;
  lastSlot: string;
  history: Array<{ id: string; name: string; startedAt: number; endedAt: number; result: string }>;
  activity: ScreenActivity[];
  scheduledContent?: ScreenScheduledContent[];
  commands: Array<{
    id: string;
    action: string;
    createdAt: number;
    expiresAt: number;
    status: 'pending' | 'applied' | 'failed' | 'expired';
    error?: string;
    previousPlayback?: ScreenPlayback;
    revision?: number;
  }>;
}
export interface ScreenSnapshot {
  state: ScreenState;
  paired: boolean;
  online: boolean;
  lastSeen: string | null;
  capabilities: Record<string, boolean>;
  grant: ScreenGrant;
  userId?: string | undefined;
  jitsiUrl: string | null;
  resident: string;
  timezone: string;
  visit: { visitorName: string; startsAt: string } | null;
  agenda: Array<{
    id: string;
    type: 'visit' | 'appointment';
    pictogram?: AppointmentPictogram;
    title: string;
    startsAt: string;
  }>;
  weather: {
    city: string;
    temperature: number;
    minimum: number | null;
    maximum: number | null;
    weatherCode: number;
    observedAt: string;
  } | null;
  members?: Array<{ id: string; name: string }> | undefined;
}
export interface ScreenJoin {
  url: string;
  room: string;
  jwt: string;
  name: string;
}
export const initialScreenState = (): ScreenState => ({
  settings: {
    consent: false,
    volume: 30,
    weatherCity: '',
    slideshowSeconds: 15,
    quietStart: '22:00',
    quietEnd: '08:00',
    grants: {},
    schedule: [],
  },
  message: '',
  messages: [],
  messageIntervalSeconds: 20,
  messageAuthor: null,
  messageUpdatedAt: null,
  media: [],
  playback: { mediaId: null, paused: false, asleep: false, volume: 30, revision: 0 },
  call: null,
  lastSlot: '',
  history: [],
  activity: [],
  scheduledContent: [],
  commands: [],
});
export function screenLocalTime(now: Date, timezone: string) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (k: string) => p.find((v) => v.type === k)?.value ?? '';
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    time: `${get('hour')}:${get('minute')}`,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}
export function screenIsQuiet(settings: ScreenSettings, time: string) {
  const { quietStart: a, quietEnd: b } = settings;
  return a === b ? false : a < b ? time >= a && time < b : time >= a || time < b;
}

/** Select the latest elapsed wall-clock slot, including yesterday across midnight. */
export function advanceScreenSchedule(state: ScreenState, now: Date, timezone: string): boolean {
  const local = screenLocalTime(now, timezone);
  const candidates: Array<{ key: string; action: string; mediaId: string | null }> = [];
  for (let daysAgo = 0; daysAgo < 8; daysAgo++) {
    const date = new Date(`${local.date}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    const dateKey = date.toISOString().slice(0, 10);
    const weekday = (local.day - daysAgo + 14) % 7;
    const slots = state.settings.schedule.filter((slot) => slot.days.includes(weekday));
    const quiet =
      state.settings.quietStart !== state.settings.quietEnd
        ? [
            { id: 'quiet-start', time: state.settings.quietStart, action: 'sleep', mediaId: null },
            { id: 'quiet-end', time: state.settings.quietEnd, action: 'wake', mediaId: null },
          ]
        : [];
    for (const slot of [...slots, ...quiet]) {
      if (daysAgo === 0 && slot.time > local.time) continue;
      candidates.push({
        key: `${dateKey}:${slot.time}:${slot.id}`,
        action: slot.action,
        mediaId: slot.mediaId,
      });
    }
  }
  const slot = candidates.sort((a, b) => a.key.localeCompare(b.key)).at(-1);
  if (!slot || slot.key === state.lastSlot) return false;
  state.lastSlot = slot.key;
  state.playback.asleep = slot.action === 'sleep';
  if (slot.action === 'play') {
    state.playback.mediaId = slot.mediaId;
    state.playback.paused = false;
    state.playback.revision++;
  }
  return slot.action === 'sleep';
}
