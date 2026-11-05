import {
  ARTE_LIVE_URL,
  RMC_DECOUVERTE_LIVE_URL,
  RMC_LIFE_LIVE_URL,
  RMC_STORY_LIVE_URL,
  youtubeVideoId,
} from '@elise/contracts';
import { subscribeScreenEvents } from './screen-events';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataLoadingScreen } from './DataLoadingScreen';
import type { Locale } from './i18n';
import { dateLocale, tr } from './screen-locale';
import type {
  ScreenPodcastEpisode,
  ScreenPodcastSearchResult,
  ScreenPodcastSubscription,
  ScreenSnapshot,
  ScreenJoin,
  ScreenSettings,
} from '@elise/contracts';
import {
  Activity,
  CalendarClock,
  Camera,
  ChevronRight,
  CircleCheck,
  CircleX,
  ExternalLink,
  Headphones,
  Heart,
  ImagePlus,
  MessageCircleHeart,
  MessageSquareText,
  Mic,
  Pause,
  Phone,
  Power,
  Image,
  Play,
  Radio,
  Youtube,
  Square,
  Search,
  Settings,
  SkipForward,
  Trash2,
  Tv,
  Timer,
  Clock3,
  Upload,
  Video,
  Volume2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import './screen.css';

const messageEmojis = ['❤️', '😊', '🥰', '😘', '🌸', '☀️', '🎂', '👏', '💐', '👋', '✨', '☕'];
const favoriteMessages = () =>
  [
    {
      emoji: '☀️',
      label: tr('Bonne journée', 'Have a good day'),
      message: tr(
        'Bonne journée ! On pense fort à toi ❤️',
        'Have a lovely day! Thinking of you ❤️',
      ),
    },
    {
      emoji: '📅',
      label: tr('Rendez-vous', 'Appointment'),
      message: tr(
        'N’oublie pas ton rendez-vous. Tout est bien prévu 😊',
        'Don’t forget your appointment. Everything is arranged 😊',
      ),
    },
    {
      emoji: '🏡',
      label: tr('On arrive bientôt', 'We’re on our way'),
      message: tr(
        'On arrive bientôt ! À tout de suite 👋',
        'We’ll be there soon! See you in a bit 👋',
      ),
    },
  ] as const;
type RadioStation = {
  id: string;
  name: string;
  url: string;
  country: string;
  codec: string;
  bitrate: number;
  artworkUrl?: string;
};
function podcastDurationLabel(seconds: number | null | undefined): string | undefined {
  if (!seconds || seconds < 1) return undefined;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes.toString().padStart(2, '0')}` : `${minutes} min`;
}
function podcastDateLabel(timestamp: number | null | undefined): string | undefined {
  if (!timestamp) return undefined;
  return new Intl.DateTimeFormat(dateLocale(), { dateStyle: 'medium' }).format(timestamp);
}
type MediaPlaybackButtonState = 'idle' | 'pending' | 'playing' | 'paused';
function MediaPlaybackButton({
  state,
  disabled,
  onClick,
  idleLabel = tr('Écouter', 'Listen'),
  playingLabel = tr('En écoute', 'Playing'),
  pendingLabel = tr('Lancement…', 'Starting…'),
  pausedLabel = tr('Reprendre', 'Resume'),
}: {
  state: MediaPlaybackButtonState;
  disabled?: boolean;
  onClick: () => void;
  idleLabel?: string;
  playingLabel?: string;
  pendingLabel?: string;
  pausedLabel?: string;
}) {
  const label =
    state === 'playing'
      ? playingLabel
      : state === 'pending'
        ? pendingLabel
        : state === 'paused'
          ? pausedLabel
          : idleLabel;
  return (
    <button
      type="button"
      className={`screen-button screen-button--primary screen-media-playback-button${state === 'idle' ? '' : ` is-${state}`}`}
      aria-label={label}
      aria-pressed={state === 'playing'}
      disabled={disabled || state === 'playing' || state === 'pending'}
      onClick={onClick}
    >
      {state === 'playing' ? (
        <span className="screen-media-playback-meter" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : state === 'pending' ? (
        <span className="screen-media-playback-spinner" aria-hidden="true" />
      ) : (
        <Play aria-hidden="true" />
      )}
      {label}
    </button>
  );
}
type YouTubeAccount = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  channelTitle: string | null;
};
type YouTubePlaylist = {
  id: string;
  title: string;
  description: string;
  itemCount: number;
  thumbnailUrl: string | null;
};
type NetworkTv = {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  address?: string;
  mac?: string | null;
  location?: string;
  protocols: string[];
  homeAssistantEntityId?: string;
  homeAssistantName?: string;
  available?: boolean;
};
type TvGuideProgram = {
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
};
type TvGuideData = {
  channels: Array<{
    id: string;
    name: string;
    current: TvGuideProgram | null;
    next: TvGuideProgram | null;
  }>;
  retrievedAt: string;
  stale: boolean;
};
type TvHostStatus = {
  installed: boolean;
  display?: { connected?: string[]; selected?: string; mode?: string; updatedAt?: number };
  cec?: {
    backend?: string;
    detected?: boolean;
    tvAcknowledged?: boolean;
    activeSourceSent?: boolean;
    power?: string | null;
    asleepRequested?: boolean;
    updatedAt?: number;
  };
  networkTv?: Partial<NetworkTv> & { updatedAt?: number };
  networkTvStatus?: {
    configured?: boolean;
    reachable?: boolean;
    detectedPort?: number | string | null;
    cecConfirmed?: boolean;
    lastWakeAt?: number | null;
    updatedAt?: number;
  };
  homeAssistantTv?: Partial<NetworkTv> | null;
};
type ScreenMainTab = 'album' | 'messages' | 'medias' | 'activity';
const LIVE_TV_CHANNELS = [
  {
    url: ARTE_LIVE_URL,
    mediaTitle: 'ARTE en direct',
    name: 'ARTE',
    description: 'Culture, documentaires et cinéma.',
    descriptionEn: 'Culture, documentaries and cinema.',
    brand: 'arte',
  },
  {
    url: RMC_LIFE_LIVE_URL,
    mediaTitle: 'RMC Life en direct',
    name: 'RMC Life',
    description: 'Séries, films et divertissement.',
    descriptionEn: 'Series, films and entertainment.',
    brand: 'rmc-life',
    brandLabel: 'RMC',
  },
  {
    url: RMC_STORY_LIVE_URL,
    mediaTitle: 'RMC Story en direct',
    name: 'RMC Story',
    description: 'Séries, fiction et divertissement.',
    descriptionEn: 'Series, fiction and entertainment.',
    brand: 'rmc-story',
    brandLabel: 'RMC',
  },
  {
    url: RMC_DECOUVERTE_LIVE_URL,
    mediaTitle: 'RMC Découverte en direct',
    name: 'RMC Découverte',
    description: 'Documentaires et découverte.',
    descriptionEn: 'Documentaries and discovery.',
    brand: 'rmc-decouverte',
    brandLabel: 'RMC',
  },
] as const;
const tvGuideTime = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});
function tvGuideRange(program: TvGuideProgram | null): string {
  return program
    ? `${tvGuideTime.format(new Date(program.startAt))} – ${tvGuideTime.format(new Date(program.endAt))}`
    : '';
}
function tvSelection(selected: TvHostStatus['networkTv'], discovered: NetworkTv): NetworkTv {
  if (!selected?.id) return discovered;
  const current = selected as NetworkTv;
  if (
    current.address &&
    !current.homeAssistantEntityId &&
    discovered.homeAssistantEntityId &&
    !discovered.address
  )
    return {
      ...current,
      homeAssistantEntityId: discovered.homeAssistantEntityId,
      ...(discovered.homeAssistantName !== undefined
        ? { homeAssistantName: discovered.homeAssistantName }
        : {}),
      protocols: [...new Set([...current.protocols, ...discovered.protocols])],
    };
  if (
    !current.address &&
    current.homeAssistantEntityId &&
    discovered.address &&
    !discovered.homeAssistantEntityId
  )
    return {
      ...discovered,
      homeAssistantEntityId: current.homeAssistantEntityId,
      ...(current.homeAssistantName !== undefined
        ? { homeAssistantName: current.homeAssistantName }
        : {}),
      protocols: [...new Set([...discovered.protocols, ...current.protocols])],
    };
  return discovered;
}
export async function screenRequest<T>(
  path: string,
  body?: unknown,
  method = 'POST',
  token?: string,
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-screen-token': token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const b = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(b.message ?? `${tr('Erreur', 'Error')} ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function startResidentScreenCall(): Promise<void> {
  const snapshot = await screenRequest<ScreenSnapshot>('screen', undefined, 'GET');
  if (!snapshot.grant.call)
    throw new Error(
      tr('Vous ne pouvez pas appeler cet écran.', 'You are not allowed to call this screen.'),
    );
  if (!snapshot.online) throw new Error(tr('L’écran est hors ligne.', 'The screen is offline.'));
  if (!snapshot.state.settings.consent)
    throw new Error(
      tr('Le consentement aux appels est désactivé.', 'Consent to calls is turned off.'),
    );
  if (snapshot.state.call)
    throw new Error(tr('Un appel est déjà en cours.', 'A call is already in progress.'));
  await screenRequest('screen/calls');
}
type JitsiInstance = {
  dispose: () => void;
  addEventListener: (event: string, cb: () => void) => void;
};
declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => JitsiInstance;
  }
}
let jitsiScript: Promise<void> | undefined;
export function JitsiFrame({
  join,
  onEnd,
  devices = { camera: true, microphone: true },
  dashboard = false,
}: {
  join: ScreenJoin;
  onEnd: () => void;
  devices?: { camera: boolean; microphone: boolean };
  dashboard?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const end = useRef(onEnd);
  end.current = onEnd;
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let api: JitsiInstance | undefined;
    const url = new URL(join.url);
    jitsiScript ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${url.origin}/external_api.js`;
      script.onload = () => resolve();
      script.onerror = () => {
        jitsiScript = undefined;
        reject(new Error(tr('Jitsi est inaccessible.', 'Jitsi is unreachable.')));
      };
      document.head.append(script);
    });
    void jitsiScript
      .then(() => {
        if (disposed || !host.current || !window.JitsiMeetExternalAPI) return;
        api = new window.JitsiMeetExternalAPI(url.host, {
          roomName: join.room,
          jwt: join.jwt,
          parentNode: host.current,
          width: '100%',
          height: '100%',
          userInfo: { displayName: join.name },
          configOverwrite: {
            prejoinConfig: { enabled: false },
            disableDeepLinking: true,
            p2p: { enabled: false },
            startWithAudioMuted: !devices.microphone,
            startWithVideoMuted: !devices.camera,
            toolbarButtons: [
              ...(devices.microphone ? ['microphone'] : []),
              ...(devices.camera ? ['camera'] : []),
              'hangup',
            ],
          },
        });
        api.addEventListener('readyToClose', () => end.current());
        api.addEventListener('videoConferenceLeft', () => end.current());
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      api?.dispose();
    };
  }, [join.room, join.jwt, join.url, join.name, devices.camera, devices.microphone]);
  return (
    <div className={`elise-call${dashboard ? ' elise-call--dashboard' : ''}`}>
      <div ref={host} />
      {error && <p role="alert">{error}</p>}
      <button onClick={onEnd}>{tr('Raccrocher', 'Hang up')}</button>
    </div>
  );
}

function DashboardCallWindow({
  join,
  resident,
  onEnd,
}: {
  join: ScreenJoin;
  resident: string;
  onEnd: () => void;
}) {
  return createPortal(
    <div className="screen-call-window">
      <section
        className="screen-call-window__panel"
        role="dialog"
        aria-modal="true"
        aria-label={tr(`Visioconférence avec ${resident}`, `Video call with ${resident}`)}
      >
        <header className="screen-call-window__header">
          <div className="screen-call-window__identity">
            <span className="screen-call-window__icon" aria-hidden="true">
              <Video />
            </span>
            <div>
              <p>{tr('VISIO EN DIRECT', 'LIVE VIDEO CALL')}</p>
              <h2>{tr(`Appel avec ${resident}`, `Call with ${resident}`)}</h2>
              <span>
                {tr(`Vous participez en tant que ${join.name}`, `You are joining as ${join.name}`)}
              </span>
            </div>
          </div>
          <span className="screen-call-window__status">
            <i aria-hidden="true" /> {tr('Appel en cours', 'Call in progress')}
          </span>
          <button
            type="button"
            className="screen-call-window__hangup"
            onClick={onEnd}
            aria-label={tr(
              `Raccrocher l’appel avec ${resident}`,
              `Hang up the call with ${resident}`,
            )}
          >
            <Phone aria-hidden="true" />
            {tr('Raccrocher', 'Hang up')}
          </button>
        </header>
        <JitsiFrame join={join} onEnd={onEnd} dashboard />
      </section>
    </div>,
    document.body,
  );
}

export function ScreenPanel({
  initialSection = 'display',
  locale = 'fr',
}: {
  initialSection?: 'call' | 'messages' | 'display' | 'photos' | 'planning';
  locale?: Locale;
} = {}) {
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);
  const [snapshot, setSnapshot] = useState<ScreenSnapshot>();
  const initialSectionOpened = useRef(false);
  useEffect(() => {
    if (!snapshot || initialSectionOpened.current) return;
    initialSectionOpened.current = true;
    const selectors = {
      messages: '.screen-message-card',
      photos: '.screen-media-card',
      call: '.screen-button--call',
      planning: '.screen-panel__hero',
      display: '.screen-panel__hero',
    };
    const target = document.querySelector<HTMLElement>(selectors[initialSection]);
    target?.scrollIntoView({ block: 'start' });
    if (initialSection === 'call') target?.focus({ preventScroll: true });
    if (initialSection === 'messages') {
      target?.querySelector('textarea')?.focus({ preventScroll: true });
    }
  }, [snapshot, initialSection]);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<string[]>(['']);
  const [messageIndex, setMessageIndex] = useState(0);
  const [messageIntervalSeconds, setMessageIntervalSeconds] = useState(20);
  const [messageScheduleAt, setMessageScheduleAt] = useState('');
  const message = messages[messageIndex] ?? '';
  const setMessage = (value: string | ((current: string) => string)) =>
    setMessages((current) =>
      current.map((text, index) =>
        index === messageIndex ? (typeof value === 'function' ? value(text) : value) : text,
      ),
    );
  const [settings, setSettings] = useState<ScreenSettings>();
  const [join, setJoin] = useState<ScreenJoin>();
  const [photo, setPhoto] = useState<File>();
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoScheduleAt, setPhotoScheduleAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<Record<string, unknown>>();
  const [tvHost, setTvHost] = useState<TvHostStatus>();
  const [tvGuide, setTvGuide] = useState<TvGuideData>();
  const [tvGuideUnavailable, setTvGuideUnavailable] = useState(false);
  const [discoveredTvs, setDiscoveredTvs] = useState<NetworkTv[]>([]);
  const [tvScanDone, setTvScanDone] = useState(false);
  const [mediaTab, setMediaTab] = useState<'youtube' | 'tv' | 'stream' | 'podcast'>('tv');
  const [selectedMainTab, setSelectedMainTab] = useState<ScreenMainTab>(
    initialSection === 'messages' ? 'messages' : 'album',
  );
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const volumeTimer = useRef<number | undefined>(undefined);
  const [playlistTitle, setPlaylistTitle] = useState(() => tr('Mes vidéos', 'My videos'));
  const [playlistLinks, setPlaylistLinks] = useState('');
  const [radioQuery, setRadioQuery] = useState('');
  const [radioResults, setRadioResults] = useState<RadioStation[]>([]);
  const [podcastQuery, setPodcastQuery] = useState('');
  const [podcastResults, setPodcastResults] = useState<ScreenPodcastSearchResult[]>([]);
  const [podcastSearchLoading, setPodcastSearchLoading] = useState(false);
  const [podcastSearchDone, setPodcastSearchDone] = useState(false);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string>();
  const [podcastEpisodes, setPodcastEpisodes] = useState<ScreenPodcastEpisode[]>([]);
  const [podcastEpisodesLoaded, setPodcastEpisodesLoaded] = useState(false);
  const [youtubeAccount, setYoutubeAccount] = useState<YouTubeAccount>();
  const [youtubePlaylists, setYoutubePlaylists] = useState<YouTubePlaylist[]>([]);
  const [youtubePlaylistBusy, setYoutubePlaylistBusy] = useState<string>();
  const automaticDisplaySetup = useRef(false);
  useEffect(() => {
    if (snapshot?.grant.administer)
      void screenRequest<Record<string, unknown>>('screen/host', undefined, 'GET').then(setHost);
  }, [snapshot?.grant.administer]);
  const refreshTvHost = useCallback(async () => {
    setTvHost(await screenRequest<TvHostStatus>('screen/tv', undefined, 'GET'));
  }, []);
  useEffect(() => {
    if (!snapshot?.grant.control) return;
    void refreshTvHost().catch(() => undefined);
    const timer = window.setInterval(() => void refreshTvHost().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [snapshot?.grant.control, refreshTvHost]);
  useEffect(() => {
    if (!snapshot?.grant.control) return;
    let disposed = false;
    const refreshTvGuide = async () => {
      try {
        const guide = await screenRequest<TvGuideData>('screen/tv-guide', undefined, 'GET');
        if (!disposed) {
          setTvGuide(guide);
          setTvGuideUnavailable(false);
        }
      } catch {
        if (!disposed) setTvGuideUnavailable(true);
      }
    };
    void refreshTvGuide();
    const timer = window.setInterval(() => void refreshTvGuide(), 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [snapshot?.grant.control]);
  const refresh = useCallback(async () => {
    const s = await screenRequest<ScreenSnapshot>('screen', undefined, 'GET');
    setSnapshot(s);
  }, []);
  useEffect(() => () => window.clearTimeout(volumeTimer.current), []);
  useEffect(() => {
    if (initialSection === 'messages') setSelectedMainTab('messages');
    if (initialSection === 'photos') setSelectedMainTab('album');
  }, [initialSection]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    const stopEvents = subscribeScreenEvents(
      'screen/events',
      () => void refresh().catch(() => undefined),
    );
    const timer = setInterval(() => void refresh().catch(() => undefined), 2000);
    return () => {
      stopEvents();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (snapshot && !settings) {
      setSettings(snapshot.state.settings);
      setMessages(
        snapshot.state.messages?.length ? snapshot.state.messages : [snapshot.state.message],
      );
      setMessageIntervalSeconds(snapshot.state.messageIntervalSeconds ?? 20);
    }
  }, [snapshot, settings]);
  const refreshYoutube = useCallback(async () => {
    const account = await screenRequest<YouTubeAccount>('screen/youtube/account', undefined, 'GET');
    setYoutubeAccount(account);
    if (account.connected)
      setYoutubePlaylists(
        await screenRequest<YouTubePlaylist[]>('screen/youtube/playlists', undefined, 'GET'),
      );
    else setYoutubePlaylists([]);
  }, []);
  useEffect(() => {
    if (snapshot?.grant.control && mediaTab === 'youtube')
      void refreshYoutube().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [mediaTab, refreshYoutube, snapshot?.grant.control]);
  useEffect(() => {
    const onYouTubeMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      const type =
        typeof data === 'object' && data !== null && 'type' in data && typeof data.type === 'string'
          ? data.type
          : '';
      if (
        event.origin === window.location.origin &&
        (type === 'youtube-connected' || type === 'youtube-error')
      )
        void refreshYoutube().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };
    window.addEventListener('message', onYouTubeMessage);
    return () => window.removeEventListener('message', onYouTubeMessage);
  }, [refreshYoutube]);
  useEffect(() => {
    if (
      automaticDisplaySetup.current ||
      !snapshot?.grant.administer ||
      host?.installed !== true ||
      host.paired === true
    )
      return;
    automaticDisplaySetup.current = true;
    void screenRequest('screen/host/pair')
      .then(async () => {
        await refresh();
        setHost(await screenRequest<Record<string, unknown>>('screen/host', undefined, 'GET'));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [host, snapshot?.grant.administer, refresh]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const scanLocalTvs = async () => {
    setBusy(true);
    setError('');
    setTvScanDone(false);
    try {
      const result = await screenRequest<{ devices: NetworkTv[] }>('screen/tv/scan');
      setDiscoveredTvs(result.devices);
      setTvScanDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const call = snapshot?.state.call;
  useEffect(() => {
    if (call?.client === 'mobile') setJoin(undefined);
    else if (call?.acceptedAt && call.userId === snapshot?.userId && !join)
      void screenRequest<ScreenJoin>(`screen/calls/${call.id}/join`)
        .then(setJoin)
        .catch((e) => setError(String(e)));
    if (!call) setJoin(undefined);
  }, [call?.id, call?.acceptedAt, snapshot?.userId, join]);
  const command = (action: string, extra: Record<string, unknown> = {}) =>
    run(() => screenRequest('screen/commands', { action, ...extra }));
  const changeVolume = (value: number) => {
    setVolumeDraft(value);
    window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => {
      void screenRequest('screen/commands', { action: 'volume', volume: value })
        .then(refresh)
        .then(() => setVolumeDraft((current) => (current === value ? null : current)))
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setVolumeDraft(null);
        });
    }, 350);
  };
  const listenToRadio = (station: RadioStation) =>
    run(async () => {
      const existing = snapshot?.state.media.find(
        (media) => media.kind === 'stream' && media.url === station.url,
      );
      const mediaId = existing?.id ?? crypto.randomUUID();
      if (!existing || (station.artworkUrl && existing.artworkUrl !== station.artworkUrl))
        await screenRequest('screen/media', {
          id: mediaId,
          title: station.name,
          kind: 'stream',
          url: station.url,
          ...(station.artworkUrl ? { artworkUrl: station.artworkUrl } : {}),
        });
      await screenRequest('screen/commands', { action: 'play', mediaId });
    });
  const searchPodcasts = () => {
    if (podcastQuery.trim().length < 2) return;
    setSelectedPodcastId(undefined);
    setPodcastEpisodes([]);
    setPodcastEpisodesLoaded(false);
    setPodcastSearchDone(false);
    setPodcastResults([]);
    setPodcastSearchLoading(true);
    void run(async () => {
      try {
        setPodcastResults(
          await screenRequest<ScreenPodcastSearchResult[]>(
            `screen/podcasts/search?q=${encodeURIComponent(podcastQuery.trim())}`,
            undefined,
            'GET',
          ),
        );
        setPodcastSearchDone(true);
      } finally {
        setPodcastSearchLoading(false);
      }
    });
  };
  const openPodcastEpisodes = (podcast: ScreenPodcastSearchResult | ScreenPodcastSubscription) => {
    setSelectedPodcastId(podcast.id);
    setPodcastEpisodes([]);
    setPodcastEpisodesLoaded(false);
    void (async () => {
      await run(async () => {
        setPodcastEpisodes(
          await screenRequest<ScreenPodcastEpisode[]>(
            `screen/podcasts/${encodeURIComponent(podcast.id)}/episodes`,
            undefined,
            'GET',
          ),
        );
      });
      setPodcastEpisodesLoaded(true);
    })();
  };
  const followPodcast = (podcast: ScreenPodcastSearchResult | ScreenPodcastSubscription) =>
    run(() => screenRequest(`screen/podcasts/${encodeURIComponent(podcast.id)}/follow`));
  const playPodcastEpisode = (
    podcast: ScreenPodcastSearchResult | ScreenPodcastSubscription,
    episode: ScreenPodcastEpisode,
  ) =>
    run(async () => {
      if (!(snapshot?.state.podcasts ?? []).some((item) => item.id === podcast.id))
        await screenRequest(`screen/podcasts/${encodeURIComponent(podcast.id)}/follow`);
      await screenRequest(`screen/podcasts/${encodeURIComponent(podcast.id)}/play`, {
        episodeId: episode.id,
      });
    });
  const connectYouTube = () => {
    setError('');
    const popup = window.open(
      '/api/v1/screen/youtube/connect',
      'elise-youtube-connect',
      'popup,width=520,height=720,resizable=yes,scrollbars=yes',
    );
    if (!popup)
      setError(
        tr(
          'La fenêtre Google a été bloquée. Autorisez les fenêtres popup puis réessayez.',
          'The Google window was blocked. Allow pop-up windows, then try again.',
        ),
      );
  };
  const importYouTubePlaylist = (playlistId: string) =>
    void (async () => {
      setYoutubePlaylistBusy(playlistId);
      try {
        await run(async () => {
          const result = await screenRequest<{
            media?: { id: string };
            importedCount: number;
            truncated: boolean;
          }>(
            `screen/youtube/playlists/${encodeURIComponent(playlistId)}/import`,
            undefined,
            'POST',
          );
          if (result.media?.id)
            await screenRequest('screen/commands', { action: 'play', mediaId: result.media.id });
        });
        await refreshYoutube();
      } finally {
        setYoutubePlaylistBusy(undefined);
      }
    })();
  if (!snapshot || !settings)
    return (
      <DataLoadingScreen
        locale={locale}
        message={
          error ||
          (locale === 'fr'
            ? 'Préparation de votre écran et de vos appels…'
            : 'Preparing your screen and calls…')
        }
      />
    );
  const { state, grant } = snapshot;
  const podcastSubscriptions = state.podcasts ?? [];
  const selectedPodcast =
    podcastSubscriptions.find((podcast) => podcast.id === selectedPodcastId) ??
    podcastResults.find((podcast) => podcast.id === selectedPodcastId);
  const activeMedia = state.media.find(
    (media) =>
      ['stream', 'tv', 'youtube', 'podcast'].includes(media.kind) &&
      media.id === state.playback.mediaId,
  );
  const MediaIcon =
    activeMedia?.kind === 'youtube'
      ? Youtube
      : activeMedia?.kind === 'tv'
        ? Tv
        : activeMedia?.kind === 'podcast'
          ? Headphones
          : Radio;
  const mediaType =
    activeMedia?.kind === 'youtube'
      ? 'YouTube'
      : activeMedia?.kind === 'tv'
        ? activeMedia.title
        : activeMedia?.kind === 'podcast'
          ? 'Podcast'
          : 'Radio';
  const activePodcastQueue =
    activeMedia?.kind === 'podcast'
      ? state.media
          .filter(
            (media) =>
              media.kind === 'podcast' && media.podcastFeedId === activeMedia.podcastFeedId,
          )
          .sort(
            (a, b) =>
              (b.podcastPublishedAt ?? 0) - (a.podcastPublishedAt ?? 0) ||
              state.media.indexOf(a) - state.media.indexOf(b),
          )
      : [];
  const activePodcastQueueIndex = activeMedia
    ? activePodcastQueue.findIndex((media) => media.id === activeMedia.id)
    : -1;
  const hasNextPodcastEpisode =
    activePodcastQueueIndex >= 0 && activePodcastQueueIndex + 1 < activePodcastQueue.length;
  const mediaPending = state.commands.some(
    (command) =>
      command.status === 'pending' &&
      command.revision === state.playback.revision &&
      ['play', 'resume', 'next'].includes(command.action),
  );
  const cecFresh =
    typeof tvHost?.cec?.updatedAt === 'number' && Date.now() / 1000 - tvHost.cec.updatedAt < 45;
  const cecReady =
    cecFresh &&
    tvHost?.cec?.tvAcknowledged === true &&
    (state.playback.asleep
      ? tvHost.cec.asleepRequested === true
      : tvHost.cec.activeSourceSent === true);
  const cecLabel = cecReady
    ? tr('CEC opérationnel', 'CEC working')
    : tvHost?.cec?.detected
      ? tr('CEC à vérifier', 'CEC to check')
      : tvHost?.installed
        ? tr('CEC non détecté', 'CEC not detected')
        : tr('Agent TV absent', 'TV agent missing');
  const display = tvHost?.display;
  const displayUpdatedAt = display?.updatedAt;
  const displayStatusFresh =
    typeof displayUpdatedAt === 'number' && Date.now() / 1000 - displayUpdatedAt < 60;
  const videoOutputReady = displayStatusFresh && Boolean(display?.selected && display?.mode);
  const connectedOutputs = display?.connected ?? [];
  const videoOutputLabel = !tvHost?.installed
    ? tr('Agent vidéo absent', 'Video agent missing')
    : !displayStatusFresh
      ? tr('État HDMI indisponible', 'HDMI status unavailable')
      : videoOutputReady
        ? tr(
            `Sortie ${display?.selected} · ${display?.mode}`,
            `Output ${display?.selected} · ${display?.mode}`,
          )
        : connectedOutputs.length > 0
          ? tr(
              `${connectedOutputs.join(', ')} détectée sans mode actif`,
              `${connectedOutputs.join(', ')} detected with no active mode`,
            )
          : tr('Aucune sortie vidéo détectée', 'No video output detected');
  const selectedNetworkTv = tvHost?.networkTv?.id ? tvHost.networkTv : undefined;
  const networkStatusFresh =
    typeof tvHost?.networkTvStatus?.updatedAt === 'number' &&
    Date.now() / 1000 - tvHost.networkTvStatus.updatedAt < 30;
  const networkReachable = networkStatusFresh && tvHost?.networkTvStatus?.reachable === true;
  const networkControlReady =
    selectedNetworkTv && (networkReachable || tvHost?.homeAssistantTv?.available === true);
  const networkControlLabel = !selectedNetworkTv
    ? tr('TV réseau non associée', 'Network TV not paired')
    : networkReachable
      ? tr(
          `Réseau : ${selectedNetworkTv.name} joignable`,
          `Network: ${selectedNetworkTv.name} reachable`,
        )
      : tvHost?.homeAssistantTv?.available
        ? tr(
            `Secours Home Assistant : ${selectedNetworkTv.name}`,
            `Home Assistant fallback: ${selectedNetworkTv.name}`,
          )
        : tr(
            `Réseau : ${selectedNetworkTv.name} en veille`,
            `Network: ${selectedNetworkTv.name} on standby`,
          );
  const networkTvOnline = networkReachable || tvHost?.homeAssistantTv?.available === true;
  const networkTvStatusLabel = !selectedNetworkTv
    ? tr('TV non associée', 'TV not paired')
    : networkTvOnline
      ? tr('En ligne', 'Online')
      : networkStatusFresh
        ? tr('Hors ligne', 'Offline')
        : tr('État indisponible', 'Status unavailable');
  const screenOutputConnected = snapshot.online && videoOutputReady;
  const status = !snapshot.online
    ? snapshot.paired
      ? tr('Écran hors ligne', 'Screen offline')
      : tr('Écran en préparation', 'Screen being prepared')
    : !displayStatusFresh
      ? tr('État vidéo indisponible', 'Video status unavailable')
      : !videoOutputReady
        ? tr('TV non détectée', 'TV not detected')
        : state.call
          ? tr('En communication', 'On a call')
          : state.playback.asleep
            ? tr('Au repos', 'Resting')
            : tr('Écran connecté', 'Screen connected');
  const mediaStatus = !snapshot.online
    ? tr('TV hors ligne', 'TV offline')
    : !displayStatusFresh
      ? tr('État vidéo indisponible', 'Video status unavailable')
      : !videoOutputReady
        ? tr('TV non détectée', 'TV not detected')
        : state.call
          ? tr('Interrompu pendant l’appel', 'Paused during the call')
          : state.playback.asleep
            ? tr('TV au repos', 'TV resting')
            : state.playback.paused
              ? tr('En pause', 'Paused')
              : mediaPending
                ? tr('Lancement sur la TV…', 'Starting on the TV…')
                : tr('En cours de lecture', 'Now playing');
  const mediaRunning =
    screenOutputConnected &&
    !state.call &&
    !state.playback.asleep &&
    !state.playback.paused &&
    !mediaPending;
  const playbackStateForMedia = (mediaId: string | undefined): MediaPlaybackButtonState => {
    if (!mediaId || activeMedia?.id !== mediaId) return 'idle';
    if (mediaPending) return 'pending';
    return !snapshot.online || state.call || state.playback.asleep || state.playback.paused
      ? 'paused'
      : 'playing';
  };
  const redundantTvControl =
    cecReady &&
    Boolean(selectedNetworkTv) &&
    Boolean(selectedNetworkTv?.mac || selectedNetworkTv?.homeAssistantEntityId);
  const residentFirstName = snapshot.resident.trim().split(/\s+/)[0] || snapshot.resident;
  const mainTabs = (
    [
      { id: 'album', label: tr('Album photo', 'Photo album'), icon: Image, allowed: grant.control },
      {
        id: 'messages',
        label: tr('Messages', 'Messages'),
        icon: MessageSquareText,
        allowed: grant.message,
      },
      { id: 'medias', label: tr('Médias', 'Media'), icon: Tv, allowed: grant.control },
      {
        id: 'activity',
        label: tr('Suivi de l’activité', 'Activity tracking'),
        icon: Activity,
        allowed: true,
      },
    ] as const
  ).filter((tab) => tab.allowed);
  const activeMainTab = mainTabs.some((tab) => tab.id === selectedMainTab)
    ? selectedMainTab
    : mainTabs[0]?.id;
  const currentContentLabel = state.call
    ? tr('Appel en cours', 'Call in progress')
    : state.playback.asleep
      ? tr('TV au repos', 'TV resting')
      : undefined;
  return (
    <section className="screen-panel">
      <header className="page-hero screen-panel__hero">
        <div className="page-hero__copy screen-panel__identity">
          <div>
            <p className="page-hero__eyebrow screen-panel__eyebrow">
              {tr('AFFICHAGE RÉSIDENT', 'RESIDENT DISPLAY')}
            </p>
            <h2 className="page-hero__title">{tr('Écran et appels', 'Screen and calls')}</h2>
            <span className={`screen-status ${screenOutputConnected ? 'is-online' : 'is-offline'}`}>
              {screenOutputConnected ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
              {status}
            </span>
          </div>
        </div>
        <div className="screen-panel__hero-side">
          <div className="page-hero__actions screen-panel__hero-actions">
            <a
              className="screen-button screen-button--secondary"
              href="/resident-screen"
              target="_blank"
              rel="noreferrer"
            >
              {tr('Voir l’écran', 'View the screen')} <ExternalLink aria-hidden="true" />
            </a>
            {grant.control && (
              <button
                className="screen-button screen-button--primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await screenRequest('screen/tv/reclaim');
                    window.setTimeout(() => void refreshTvHost().catch(() => undefined), 2500);
                  })
                }
              >
                <Power aria-hidden="true" /> {tr('Reprendre la TV', 'Take over the TV')}
              </button>
            )}
            {grant.call && (
              <button
                className="screen-button screen-button--call"
                disabled={busy || !snapshot.online || !!call || !state.settings.consent}
                onClick={() => void run(() => screenRequest('screen/calls'))}
              >
                <Phone aria-hidden="true" />{' '}
                {tr(`Appeler ${residentFirstName}`, `Call ${residentFirstName}`)}
              </button>
            )}
          </div>
          {(grant.administer || grant.control) && (
            <div
              className="screen-capabilities"
              aria-label={tr('État des équipements de l’écran', 'Screen equipment status')}
            >
              <span className={snapshot.capabilities.camera ? 'is-ready' : ''}>
                <Camera aria-hidden="true" />
                {tr('Caméra', 'Camera')}{' '}
                {snapshot.capabilities.camera ? tr('prête', 'ready') : tr('à tester', 'to test')}
              </span>
              <span className={snapshot.capabilities.microphone ? 'is-ready' : ''}>
                <Mic aria-hidden="true" />
                {tr('Micro', 'Microphone')}{' '}
                {snapshot.capabilities.microphone ? tr('prêt', 'ready') : tr('à tester', 'to test')}
              </span>
              <span className={snapshot.online ? 'is-ready' : ''}>
                <Tv aria-hidden="true" />
                {tr('Navigateur kiosque', 'Kiosk browser')}{' '}
                {snapshot.online ? tr('connecté', 'connected') : tr('à vérifier', 'to check')}
              </span>
              <span className={videoOutputReady ? 'is-ready' : ''}>
                <Tv aria-hidden="true" /> {videoOutputLabel}
              </span>
              <span className={redundantTvControl ? 'is-ready' : ''}>
                {redundantTvControl ? (
                  <CircleCheck aria-hidden="true" />
                ) : (
                  <CircleX aria-hidden="true" />
                )}
                {redundantTvControl
                  ? tr('Voies de reprise configurées', 'Takeover paths configured')
                  : tr('Reprise TV à vérifier', 'TV takeover to check')}
              </span>
              <span className={cecReady ? 'is-ready' : ''}>
                <Power aria-hidden="true" /> {cecLabel}
              </span>
              <span className={networkControlReady ? 'is-ready' : ''}>
                <Wifi aria-hidden="true" />
                {networkControlLabel}
              </span>
            </div>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="screen-error">
          {error}
        </p>
      )}
      <div
        className="screen-live-status"
        aria-label={tr('État de la TV et de la lecture', 'TV and playback status')}
      >
        <section className="screen-tv-now" aria-label={tr('Sur la TV maintenant', 'On the TV now')}>
          <span className="screen-tv-now__title">
            <Tv aria-hidden="true" />
            <strong>{tr('Sur la TV maintenant', 'On the TV now')}</strong>
          </span>
          <span className="screen-tv-now__device">
            {selectedNetworkTv?.name ?? tr('TV non associée', 'TV not paired')}
            {selectedNetworkTv && <small>{tr('Associée', 'Paired')}</small>}
          </span>
          <span
            className={`screen-tv-now__online ${
              networkTvOnline ? 'is-online' : networkStatusFresh ? 'is-offline' : 'is-unknown'
            }`}
          >
            {networkTvStatusLabel}
          </span>
          {!activeMedia && currentContentLabel && (
            <span className="screen-tv-now__content">{currentContentLabel}</span>
          )}
          {grant.administer && selectedNetworkTv && (
            <button
              type="button"
              className="screen-tv-now__forget"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await screenRequest('screen/tv/select', undefined, 'DELETE');
                  await refreshTvHost();
                })
              }
            >
              {tr('Oublier cette TV', 'Forget this TV')}
            </button>
          )}
        </section>
        <section
          className="screen-playback-now"
          aria-label={tr('Lecture et son sur la TV', 'Playback and sound on the TV')}
          aria-live="polite"
        >
          <span
            className={`screen-playback-now__dot ${activeMedia && mediaRunning ? 'is-live' : ''}`}
          />
          <span className="screen-playback-now__icon">
            {activeMedia ? <MediaIcon aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </span>
          <span className="screen-playback-now__copy">
            <small>{activeMedia ? mediaStatus : tr('Son de la TV', 'TV sound')}</small>
            <strong>{activeMedia?.title ?? tr('Aucun média en cours', 'No media playing')}</strong>
          </span>
          {activeMedia && (
            <div className="screen-playback-now__controls">
              <span className="screen-playback-now__type">{mediaType}</span>
              <button
                type="button"
                aria-label={
                  state.playback.paused || state.playback.asleep
                    ? tr('Reprendre', 'Resume')
                    : tr('Mettre en pause', 'Pause')
                }
                title={
                  state.playback.paused || state.playback.asleep
                    ? tr('Reprendre', 'Resume')
                    : tr('Mettre en pause', 'Pause')
                }
                disabled={busy || !snapshot.online || !!state.call}
                onClick={() =>
                  void command(state.playback.paused || state.playback.asleep ? 'resume' : 'pause')
                }
              >
                {state.playback.paused || state.playback.asleep ? (
                  <Play aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
              </button>
              {(activeMedia.kind === 'youtube' || activeMedia.kind === 'podcast') && (
                <button
                  type="button"
                  aria-label={
                    activeMedia.kind === 'podcast'
                      ? tr('Épisode suivant', 'Next episode')
                      : tr('Suivant', 'Next')
                  }
                  title={
                    activeMedia.kind === 'podcast'
                      ? tr('Épisode suivant', 'Next episode')
                      : tr('Suivant', 'Next')
                  }
                  disabled={
                    busy ||
                    !snapshot.online ||
                    !!state.call ||
                    (activeMedia.kind === 'podcast' && !hasNextPodcastEpisode)
                  }
                  onClick={() => void command('next')}
                >
                  <SkipForward aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                aria-label={tr('Arrêter la lecture', 'Stop playback')}
                title={tr('Arrêter la lecture', 'Stop playback')}
                disabled={busy || !snapshot.online}
                onClick={() => void command('stop')}
              >
                <Square aria-hidden="true" />
              </button>
            </div>
          )}
          {grant.control && (
            <label className="screen-playback-now__volume">
              <Volume2 aria-hidden="true" />
              <span className="screen-visually-hidden">{tr('Volume de la TV', 'TV volume')}</span>
              <input
                type="range"
                min="0"
                max="100"
                aria-label={tr('Volume de la TV', 'TV volume')}
                value={volumeDraft ?? state.playback.volume}
                onChange={(event) => changeVolume(Number(event.target.value))}
              />
              <output>{volumeDraft ?? state.playback.volume} %</output>
            </label>
          )}
        </section>
      </div>
      {grant.administer && (
        <section className="screen-card screen-network-tv-card" hidden={Boolean(selectedNetworkTv)}>
          <div className="screen-card__heading">
            <span>
              <Wifi aria-hidden="true" />
            </span>
            <div>
              <h3>{tr('TV sur le réseau local', 'TV on the local network')}</h3>
              <p>
                {tr(
                  'Le Raspberry Pi peut être en Ethernet et la TV en Wi-Fi : ils doivent simplement partager le même réseau local.',
                  'The Raspberry Pi can use Ethernet and the TV Wi-Fi: they just need to share the same local network.',
                )}
              </p>
            </div>
          </div>
          <div className="screen-network-tv-current">
            {selectedNetworkTv ? (
              <div>
                <strong>{selectedNetworkTv.name}</strong>
                <span>
                  {[selectedNetworkTv.manufacturer, selectedNetworkTv.model]
                    .filter(Boolean)
                    .join(' · ')}
                  {selectedNetworkTv.address ? ` · ${selectedNetworkTv.address}` : ''}
                </span>
                <small>
                  {networkReachable
                    ? tr('TV joignable sur le réseau local.', 'TV reachable on the local network.')
                    : tr(
                        'TV en veille ou non joignable : le réveil réseau reste surveillé.',
                        'TV on standby or unreachable: network wake-up is still monitored.',
                      )}
                  {selectedNetworkTv.homeAssistantEntityId
                    ? tr(' Secours Home Assistant associé.', ' Home Assistant fallback paired.')
                    : ''}
                </small>
              </div>
            ) : (
              <p>
                {tr(
                  'Aucune TV du réseau local n’est encore associée.',
                  'No TV on the local network is paired yet.',
                )}
              </p>
            )}
            <div className="screen-network-tv-actions">
              <button
                className="screen-button screen-button--secondary"
                disabled={busy}
                onClick={() => void scanLocalTvs()}
              >
                <Search aria-hidden="true" /> {tr('Rechercher les TV', 'Search for TVs')}
              </button>
            </div>
          </div>
          {discoveredTvs.length > 0 && (
            <ul className="screen-network-tv-results">
              {discoveredTvs.map((device) => {
                const addsHomeAssistant =
                  Boolean(selectedNetworkTv?.address) &&
                  !selectedNetworkTv?.homeAssistantEntityId &&
                  Boolean(device.homeAssistantEntityId) &&
                  !device.address;
                const addsMergedHomeAssistant =
                  Boolean(selectedNetworkTv?.address) &&
                  !selectedNetworkTv?.homeAssistantEntityId &&
                  Boolean(device.address) &&
                  Boolean(device.homeAssistantEntityId) &&
                  selectedNetworkTv?.id === device.id;
                const addsNetwork =
                  !selectedNetworkTv?.address &&
                  Boolean(selectedNetworkTv?.homeAssistantEntityId) &&
                  Boolean(device.address) &&
                  !device.homeAssistantEntityId;
                const addsMergedNetwork =
                  !selectedNetworkTv?.address &&
                  Boolean(selectedNetworkTv?.homeAssistantEntityId) &&
                  Boolean(device.address) &&
                  selectedNetworkTv?.homeAssistantEntityId === device.homeAssistantEntityId;
                const associated =
                  !addsHomeAssistant &&
                  !addsMergedHomeAssistant &&
                  !addsNetwork &&
                  !addsMergedNetwork &&
                  (selectedNetworkTv?.id === device.id ||
                    (Boolean(device.homeAssistantEntityId) &&
                      selectedNetworkTv?.homeAssistantEntityId === device.homeAssistantEntityId));
                return (
                  <li key={device.id}>
                    <Tv aria-hidden="true" />
                    <div>
                      <strong>{device.name}</strong>
                      <span>
                        {[device.manufacturer, device.model, device.address]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <small>
                        {device.homeAssistantEntityId
                          ? tr(
                              'Commande Home Assistant disponible en secours.',
                              'Home Assistant control available as a fallback.',
                            )
                          : device.mac
                            ? tr(
                                'Réveil réseau disponible si la TV l’autorise.',
                                'Network wake-up available if the TV allows it.',
                              )
                            : tr(
                                'Adresse MAC non annoncée : le CEC assurera le réveil.',
                                'MAC address not announced: CEC will handle wake-up.',
                              )}
                      </small>
                    </div>
                    <button
                      className="screen-button screen-button--primary"
                      disabled={busy || associated}
                      onClick={() =>
                        void run(async () => {
                          await screenRequest(
                            'screen/tv/select',
                            tvSelection(selectedNetworkTv, device),
                          );
                          await refreshTvHost();
                        })
                      }
                    >
                      {associated
                        ? tr('Associée', 'Paired')
                        : addsHomeAssistant || addsMergedHomeAssistant
                          ? tr('Ajouter en secours', 'Add as fallback')
                          : addsNetwork || addsMergedNetwork
                            ? tr('Ajouter le réseau', 'Add the network')
                            : tr('Associer', 'Pair')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {tvScanDone && discoveredTvs.length === 0 && (
            <p className="screen-empty-library">
              {tr(
                'Aucune TV n’a répondu. Vérifiez qu’elle est allumée et que le routeur n’isole pas les appareils du réseau local, puis relancez la recherche.',
                'No TV answered. Check that it is switched on and that the router does not isolate devices on the local network, then search again.',
              )}
            </p>
          )}
        </section>
      )}
      {join ? (
        <DashboardCallWindow
          join={join}
          resident={snapshot.resident}
          onEnd={() => {
            void run(() => screenRequest(`screen/calls/${call?.id}`, undefined, 'DELETE'));
            setJoin(undefined);
          }}
        />
      ) : (
        call && (
          <div className="screen-call-state">
            <Phone aria-hidden="true" />
            <strong>
              {call.acceptedAt
                ? tr('Appel en cours', 'Call in progress')
                : tr(`Appel de ${call.name}…`, `Calling ${call.name}…`)}
            </strong>
            {call.userId === snapshot.userId && (
              <button
                onClick={() =>
                  void run(() => screenRequest(`screen/calls/${call.id}`, undefined, 'DELETE'))
                }
              >
                {tr('Annuler l’appel', 'Cancel the call')}
              </button>
            )}
          </div>
        )
      )}
      {mainTabs.length > 0 && (
        <div
          className="screen-main-tabs"
          role="tablist"
          aria-label={tr('Sections de l’écran', 'Screen sections')}
        >
          {mainTabs.map((tab, index) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                id={`screen-main-tab-${tab.id}`}
                role="tab"
                aria-selected={activeMainTab === tab.id}
                aria-controls={`screen-main-panel-${tab.id}`}
                tabIndex={activeMainTab === tab.id ? 0 : -1}
                onClick={() => setSelectedMainTab(tab.id)}
                onKeyDown={(event) => {
                  const nextIndex =
                    event.key === 'ArrowRight'
                      ? (index + 1) % mainTabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + mainTabs.length - 1) % mainTabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? mainTabs.length - 1
                            : -1;
                  if (nextIndex < 0) return;
                  event.preventDefault();
                  const next = mainTabs[nextIndex];
                  if (!next) return;
                  setSelectedMainTab(next.id);
                  document.getElementById(`screen-main-tab-${next.id}`)?.focus();
                }}
              >
                <Icon aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      {grant.message && (
        <section
          id="screen-main-panel-messages"
          role="tabpanel"
          aria-labelledby="screen-main-tab-messages"
          hidden={activeMainTab !== 'messages'}
          className="screen-card screen-message-card"
        >
          <div className="screen-card__heading">
            <span>
              <MessageCircleHeart aria-hidden="true" />
            </span>
            <div>
              <h3>{tr('Message sur la TV', 'Message on the TV')}</h3>
              <p>
                {tr(
                  'Vos messages restent au premier plan et se succèdent dans le grand bandeau supérieur.',
                  'Your messages stay in front and take turns in the large banner at the top.',
                )}
              </p>
            </div>
          </div>
          <div className="screen-message-favorites">
            <span>{tr('Messages favoris', 'Favourite messages')}</span>
            <div>
              {favoriteMessages().map((favorite) => (
                <button
                  key={favorite.label}
                  type="button"
                  onClick={() => setMessage(favorite.message)}
                >
                  <span aria-hidden="true">{favorite.emoji}</span>
                  {favorite.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="screen-message-tabs"
            aria-label={tr('Messages à afficher', 'Messages to display')}
          >
            {messages.map((text, index) => (
              <button
                key={index}
                type="button"
                className="screen-button screen-button--secondary"
                aria-pressed={index === messageIndex}
                onClick={() => setMessageIndex(index)}
              >
                Message {index + 1}
                {text.trim() ? '' : tr(' · vide', ' · empty')}
              </button>
            ))}
            <button
              type="button"
              className="screen-button screen-button--secondary"
              disabled={messages.length >= 20 || busy}
              onClick={() => {
                setMessages((current) => [...current, '']);
                setMessageIndex(messages.length);
              }}
            >
              {tr('+ Ajouter un message', '+ Add a message')}
            </button>
          </div>
          <div className="screen-emoji-picker" aria-label={tr('Ajouter un émoji', 'Add an emoji')}>
            {messageEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={tr(`Ajouter ${emoji}`, `Add ${emoji}`)}
                onClick={() =>
                  setMessage(
                    (current) =>
                      `${current}${current && !current.endsWith(' ') ? ' ' : ''}${emoji}`,
                  )
                }
              >
                {emoji}
              </button>
            ))}
          </div>
          <label className="screen-message-input">
            <span>Message {messageIndex + 1}</span>
            <textarea
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={tr(
                `Bonne journée ${snapshot.resident} ! On pense fort à toi ❤️`,
                `Have a lovely day ${snapshot.resident}! Thinking of you ❤️`,
              )}
            />
          </label>
          <div className="screen-message-timing">
            <label>
              <span>
                {tr('Durée de chaque message (secondes)', 'Duration of each message (seconds)')}
              </span>
              <input
                type="number"
                min={5}
                max={600}
                step={1}
                value={messageIntervalSeconds}
                onChange={(event) => setMessageIntervalSeconds(Number(event.target.value))}
              />
            </label>
            <small>
              {messages.length > 1
                ? tr(
                    'Les messages tournent en boucle, dans cet ordre.',
                    'Messages loop in this order.',
                  )
                : tr(
                    'Ajoutez plusieurs messages pour activer la rotation.',
                    'Add several messages to turn on rotation.',
                  )}
            </small>
          </div>
          <div className={`screen-schedule-control${messageScheduleAt ? ' is-active' : ''}`}>
            <span className="screen-schedule-control__icon">
              <CalendarClock aria-hidden="true" />
            </span>
            <label>
              <span>{tr('Programmer pour plus tard', 'Schedule for later')}</span>
              <input
                type="datetime-local"
                value={messageScheduleAt}
                onChange={(event) => setMessageScheduleAt(event.target.value)}
              />
            </label>
            <p>
              {messageScheduleAt
                ? `${tr('Affichage prévu', 'Scheduled for')} ${new Date(
                    messageScheduleAt,
                  ).toLocaleString(dateLocale(), {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : tr(
                    'Laissez vide pour afficher le message maintenant.',
                    'Leave empty to show the message now.',
                  )}
            </p>
            {messageScheduleAt && (
              <button
                type="button"
                className="screen-schedule-clear"
                onClick={() => setMessageScheduleAt('')}
              >
                {tr('Maintenant', 'Now')}
              </button>
            )}
          </div>
          <div className="screen-message-actions">
            <small>
              {message.length}/1000 · {messages.length}/20 messages
            </small>
            {messages.length > 1 && (
              <button
                type="button"
                className="screen-button screen-button--ghost"
                disabled={busy}
                onClick={() => {
                  setMessages((current) => current.filter((_, index) => index !== messageIndex));
                  setMessageIndex(Math.max(0, messageIndex - 1));
                }}
              >
                <Trash2 /> {tr('Retirer ce message', 'Remove this message')}
              </button>
            )}
            {state.message && (
              <button
                className="screen-button screen-button--ghost"
                onClick={() =>
                  void run(async () => {
                    await screenRequest('screen/message', { messages: [] }, 'PATCH');
                    setMessages(['']);
                    setMessageIndex(0);
                  })
                }
              >
                <Trash2 /> {tr('Effacer', 'Clear')}
              </button>
            )}
            <button
              className="screen-button screen-button--primary"
              disabled={
                busy ||
                messages.some((text) => !text.trim()) ||
                !Number.isInteger(messageIntervalSeconds) ||
                messageIntervalSeconds < 5 ||
                messageIntervalSeconds > 600 ||
                (!!messageScheduleAt && new Date(messageScheduleAt).getTime() <= Date.now())
              }
              onClick={() =>
                void run(async () => {
                  if (messageScheduleAt) {
                    await screenRequest('screen/scheduled-content', {
                      kind: 'message',
                      scheduledAt: new Date(messageScheduleAt).toISOString(),
                      messages,
                      messageIntervalSeconds,
                    });
                    setMessageScheduleAt('');
                    return;
                  }
                  await screenRequest(
                    'screen/message',
                    { messages, messageIntervalSeconds },
                    'PATCH',
                  );
                })
              }
            >
              {messageScheduleAt ? <CalendarClock /> : <Heart />}
              {messageScheduleAt
                ? tr('Programmer le message', 'Schedule the message')
                : tr('Afficher sur la TV', 'Show on the TV')}
            </button>
          </div>
        </section>
      )}
      {(state.scheduledContent ?? []).length > 0 && (
        <section className="screen-card screen-scheduled-card">
          <div className="screen-card__heading">
            <span>
              <CalendarClock aria-hidden="true" />
            </span>
            <div>
              <h3>{tr('Prochaines diffusions', 'Upcoming broadcasts')}</h3>
              <p>
                {tr(
                  'Messages et photos seront affichés automatiquement à l’heure prévue.',
                  'Messages and photos will be shown automatically at the scheduled time.',
                )}
              </p>
            </div>
            <strong className="screen-scheduled-count">
              {state.scheduledContent?.length} {tr('programmé', 'scheduled')}
              {(state.scheduledContent?.length ?? 0) > 1 && locale === 'fr' ? 's' : ''}
            </strong>
          </div>
          <ul className="screen-scheduled-list">
            {[...(state.scheduledContent ?? [])]
              .sort((left, right) => left.scheduledAt - right.scheduledAt)
              .map((item) => (
                <li key={item.id}>
                  <span className="screen-scheduled-kind">
                    {item.kind === 'message' ? (
                      <MessageCircleHeart aria-hidden="true" />
                    ) : (
                      <ImagePlus aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {new Date(item.scheduledAt).toLocaleString(dateLocale(), {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {item.kind === 'message' ? 'Message' : 'Photo'}
                    </small>
                  </span>
                  <button
                    className="screen-icon-button"
                    aria-label={tr(
                      `Annuler la programmation de ${item.title}`,
                      `Cancel the schedule for ${item.title}`,
                    )}
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        screenRequest(`screen/scheduled-content/${item.id}`, undefined, 'DELETE'),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
      {grant.control && (
        <>
          <section
            id="screen-main-panel-medias"
            role="tabpanel"
            aria-labelledby="screen-main-tab-medias"
            hidden={activeMainTab !== 'medias'}
            className="screen-card screen-medias"
          >
            <div className="screen-card__heading screen-medias-heading">
              <span>
                <Tv aria-hidden="true" />
              </span>
              <div>
                <h3>{tr('Médias', 'Media')}</h3>
                <p>
                  {tr(
                    `Choisissez ce que ${snapshot.resident} regarde ou écoute sur sa TV.`,
                    `Choose what ${snapshot.resident} watches or listens to on their TV.`,
                  )}
                </p>
              </div>
              <span className="screen-medias-device">
                <Tv aria-hidden="true" />{' '}
                {tr(`TV de ${snapshot.resident}`, `${snapshot.resident}’s TV`)}
              </span>
            </div>
            <div className="screen-medias-layout">
              <div className="screen-medias-browser">
                <div
                  className="screen-medias-tabs"
                  role="tablist"
                  aria-label={tr('Sources médias', 'Media sources')}
                >
                  {(
                    [
                      ['youtube', 'YouTube', Youtube],
                      ['tv', tr('TV en direct', 'Live TV'), Tv],
                      ['stream', 'Radio', Radio],
                      ['podcast', 'Podcasts', Headphones],
                    ] as const
                  ).map(([kind, label, Icon]) => (
                    <button
                      key={kind}
                      id={`media-tab-${kind}`}
                      role="tab"
                      type="button"
                      aria-selected={mediaTab === kind}
                      aria-controls={`media-panel-${kind}`}
                      className={mediaTab === kind ? 'is-selected' : ''}
                      tabIndex={mediaTab === kind ? 0 : -1}
                      onClick={() => setMediaTab(kind)}
                      onKeyDown={(event) => {
                        const tabs = ['youtube', 'tv', 'stream', 'podcast'] as const;
                        const index = tabs.indexOf(kind);
                        const next =
                          event.key === 'ArrowRight'
                            ? tabs[(index + 1) % tabs.length]
                            : event.key === 'ArrowLeft'
                              ? tabs[(index + tabs.length - 1) % tabs.length]
                              : event.key === 'Home'
                                ? tabs[0]
                                : event.key === 'End'
                                  ? tabs[3]
                                  : null;
                        if (!next) return;
                        event.preventDefault();
                        setMediaTab(next);
                        event.currentTarget.parentElement
                          ?.querySelector<HTMLButtonElement>(`#media-tab-${next}`)
                          ?.focus();
                      }}
                    >
                      <Icon aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  id="media-panel-tv"
                  role="tabpanel"
                  aria-labelledby="media-tab-tv"
                  hidden={mediaTab !== 'tv'}
                  className="screen-medias-source screen-tv-card"
                >
                  <section
                    className="screen-tv-channels"
                    aria-label={tr('Chaînes TV en direct', 'Live TV channels')}
                  >
                    {LIVE_TV_CHANNELS.map((channel) => {
                      const channelMedia = state.media.find(
                        (media) => media.kind === 'tv' && media.url === channel.url,
                      );
                      const playbackState = playbackStateForMedia(channelMedia?.id);
                      return (
                        <article
                          className={`screen-tv-channel${playbackState === 'idle' ? '' : ` is-${playbackState}`}`}
                          key={channel.url}
                        >
                          <div className="screen-tv-channel__identity">
                            <span
                              className={`screen-tv-channel__brand screen-tv-channel__brand--${channel.brand}`}
                              aria-hidden="true"
                            >
                              {channel.brand === 'arte' ? 'arte' : channel.brandLabel}
                            </span>
                            <div>
                              <h4>{channel.mediaTitle}</h4>
                              <p>{tr(channel.description, channel.descriptionEn)}</p>
                            </div>
                          </div>
                          <MediaPlaybackButton
                            state={playbackState}
                            idleLabel={tr(`Regarder ${channel.name}`, `Watch ${channel.name}`)}
                            playingLabel={tr('À l’écran', 'On screen')}
                            pendingLabel={tr('Changement…', 'Switching…')}
                            disabled={busy || !grant.control || !snapshot.online || !!state.call}
                            onClick={() =>
                              void run(async () => {
                                const existing = state.media.find(
                                  (media) => media.kind === 'tv' && media.url === channel.url,
                                );
                                const mediaId = existing?.id ?? crypto.randomUUID();
                                if (!existing)
                                  await screenRequest('screen/media', {
                                    id: mediaId,
                                    title: channel.mediaTitle,
                                    kind: 'tv',
                                    url: channel.url,
                                  });
                                await screenRequest('screen/commands', { action: 'play', mediaId });
                              })
                            }
                          />
                        </article>
                      );
                    })}
                  </section>
                  <p className="screen-tv-note">
                    {tr(
                      'Le direct peut être limité selon le pays et les droits du programme.',
                      'Live viewing may be limited depending on the country and programme rights.',
                    )}
                  </p>
                </div>
                <div
                  id="media-panel-youtube"
                  role="tabpanel"
                  aria-labelledby="media-tab-youtube"
                  hidden={mediaTab !== 'youtube'}
                  className="screen-medias-source screen-playlist-card"
                >
                  <h4>{tr('Vos playlists YouTube', 'Your YouTube playlists')}</h4>
                  <p>
                    {tr(
                      'Connectez votre compte Google pour retrouver vos playlists automatiquement.',
                      'Connect your Google account to find your playlists automatically.',
                    )}
                  </p>
                  <div className="screen-youtube-account">
                    <span className="screen-youtube-account__logo">
                      <Youtube aria-hidden="true" />
                    </span>
                    <div className="screen-youtube-account__copy">
                      <strong>
                        {youtubeAccount?.connected
                          ? youtubeAccount.channelTitle ||
                            youtubeAccount.email ||
                            tr('Compte connecté', 'Connected account')
                          : tr('Compte YouTube', 'YouTube account')}
                      </strong>
                      <small>
                        {youtubeAccount?.connected
                          ? youtubeAccount.email ||
                            tr('Playlists personnelles disponibles', 'Personal playlists available')
                          : youtubeAccount?.configured
                            ? tr(
                                'Vos playlists personnelles, en toute sécurité',
                                'Your personal playlists, securely',
                              )
                            : tr(
                                'Connexion à configurer par l’administrateur',
                                'Connection to be set up by the administrator',
                              )}
                      </small>
                    </div>
                    {youtubeAccount?.connected ? (
                      <div className="screen-youtube-account__actions">
                        <button
                          type="button"
                          className="screen-button screen-button--secondary"
                          disabled={busy}
                          onClick={() =>
                            void refreshYoutube().catch((e) =>
                              setError(e instanceof Error ? e.message : String(e)),
                            )
                          }
                        >
                          {tr('Actualiser', 'Refresh')}
                        </button>
                        <button
                          type="button"
                          className="screen-button screen-button--ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await screenRequest('screen/youtube/account', undefined, 'DELETE');
                              setYoutubeAccount({
                                configured: youtubeAccount.configured,
                                connected: false,
                                email: null,
                                channelTitle: null,
                              });
                              setYoutubePlaylists([]);
                            })
                          }
                        >
                          {tr('Déconnecter', 'Disconnect')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="screen-button screen-button--primary"
                        disabled={busy || youtubeAccount?.configured === false}
                        onClick={connectYouTube}
                      >
                        {tr('Connecter Google', 'Connect Google')}
                      </button>
                    )}
                  </div>
                  {youtubeAccount?.configured === false && (
                    <p className="screen-youtube-hint">
                      {tr(
                        'L’administrateur doit renseigner les identifiants OAuth YouTube du NAS une seule fois.',
                        'The administrator only needs to enter the NAS’s YouTube OAuth credentials once.',
                      )}
                    </p>
                  )}
                  {youtubeAccount?.connected && (
                    <div className="screen-youtube-cloud-playlists">
                      <div className="screen-youtube-cloud-heading">
                        <strong>
                          {tr('Playlists de votre compte', 'Playlists on your account')}
                        </strong>
                        <span>
                          {youtubePlaylists.length} {tr('disponibles', 'available')}
                        </span>
                      </div>
                      {youtubePlaylists.length ? (
                        <div className="screen-youtube-cloud-list">
                          {youtubePlaylists.map((playlist) => {
                            const imported = state.media.find(
                              (media) => media.youtubePlaylistId === playlist.id,
                            );
                            return (
                              <article key={playlist.id}>
                                {playlist.thumbnailUrl ? (
                                  <img src={playlist.thumbnailUrl} alt="" loading="lazy" />
                                ) : (
                                  <span className="screen-youtube-cloud-placeholder">
                                    <Youtube aria-hidden="true" />
                                  </span>
                                )}
                                <div>
                                  <strong>{playlist.title}</strong>
                                  <small>
                                    {playlist.itemCount} {tr('vidéo(s)', 'video(s)')}
                                  </small>
                                </div>
                                <button
                                  type="button"
                                  className="screen-button"
                                  disabled={
                                    busy || !snapshot.online || youtubePlaylistBusy === playlist.id
                                  }
                                  onClick={() => importYouTubePlaylist(playlist.id)}
                                >
                                  {youtubePlaylistBusy === playlist.id
                                    ? tr('Chargement…', 'Loading…')
                                    : imported
                                      ? tr('Relancer', 'Play again')
                                      : tr('Ajouter et lancer', 'Add and play')}
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="screen-empty-library">
                          {tr(
                            'Aucune playlist disponible sur ce compte.',
                            'No playlists available on this account.',
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="screen-youtube-manual">
                    <strong>{tr('Ajouter des vidéos par lien', 'Add videos by link')}</strong>
                    <p>
                      {tr(
                        'Un lien par ligne, jusqu’à 50 vidéos.',
                        'One link per line, up to 50 videos.',
                      )}
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const links = playlistLinks
                          .split(/\r?\n/)
                          .map((link) => link.trim())
                          .filter(Boolean);
                        if (
                          !links.length ||
                          links.length > 50 ||
                          links.some((link) => !youtubeVideoId(link))
                        ) {
                          setError(
                            tr(
                              'Ajoutez entre 1 et 50 liens vidéo YouTube valides, un par ligne.',
                              'Add between 1 and 50 valid YouTube video links, one per line.',
                            ),
                          );
                          return;
                        }
                        void run(async () => {
                          await screenRequest('screen/media', {
                            id: crypto.randomUUID(),
                            title: playlistTitle.trim(),
                            kind: 'youtube',
                            url: links[0],
                            playlistUrls: links,
                          });
                          setPlaylistLinks('');
                        });
                      }}
                    >
                      <label>
                        {tr('Nom de la playlist', 'Playlist name')}
                        <input
                          value={playlistTitle}
                          maxLength={120}
                          required
                          onChange={(event) => setPlaylistTitle(event.target.value)}
                        />
                      </label>
                      <label>
                        {tr('Liens YouTube', 'YouTube links')}
                        <textarea
                          value={playlistLinks}
                          rows={5}
                          required
                          placeholder={'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…'}
                          onChange={(event) => setPlaylistLinks(event.target.value)}
                        />
                      </label>
                      <button
                        className="screen-button"
                        disabled={
                          busy || !grant.control || !playlistTitle.trim() || !playlistLinks.trim()
                        }
                      >
                        {tr('Enregistrer la playlist', 'Save the playlist')}
                      </button>
                    </form>
                  </div>
                  <div className="screen-playlists">
                    {state.media
                      .filter((media) => media.kind === 'youtube')
                      .map((media) => (
                        <article key={media.id}>
                          <div>
                            <strong>{media.title}</strong>
                            <small>
                              {media.playlistUrls?.length ?? 1} {tr('vidéo(s)', 'video(s)')}
                              {state.playback.mediaId === media.id
                                ? tr(' · Sélectionnée', ' · Selected')
                                : ''}
                            </small>
                          </div>
                          <button
                            className="screen-button"
                            disabled={busy || !grant.control || !snapshot.online}
                            onClick={() => void command('play', { mediaId: media.id })}
                          >
                            <Play aria-hidden="true" /> {tr('Lancer', 'Play')}
                          </button>
                          <button
                            className="screen-button screen-button--secondary"
                            disabled={busy || !grant.control}
                            aria-label={tr(`Supprimer ${media.title}`, `Delete ${media.title}`)}
                            onClick={() =>
                              void run(() =>
                                screenRequest(`screen/media/${media.id}`, undefined, 'DELETE'),
                              )
                            }
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </article>
                      ))}
                  </div>
                  <p>
                    {tr(
                      'Les vidéos s’enchaînent automatiquement. Utilisez les commandes du lecteur pour mettre en pause, reprendre ou passer à la suivante. Certaines vidéos peuvent refuser la lecture intégrée.',
                      'Videos play one after another. Use the player controls to pause, resume or skip to the next one. Some videos may refuse embedded playback.',
                    )}
                  </p>
                </div>
                <div
                  id="media-panel-stream"
                  role="tabpanel"
                  aria-labelledby="media-tab-stream"
                  hidden={mediaTab !== 'stream'}
                  className="screen-medias-source"
                >
                  <h4>{tr('Vos radios', 'Your radios')}</h4>
                  <p>
                    {tr(
                      'Retrouvez vos favoris ou recherchez une station.',
                      'Find your favourites or search for a station.',
                    )}
                  </p>
                  <form
                    className="screen-radio-search screen-media-search-panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (radioQuery.trim().length < 2) return;
                      void run(async () =>
                        setRadioResults(
                          await screenRequest<RadioStation[]>(
                            `screen/radio/search?q=${encodeURIComponent(radioQuery.trim())}`,
                            undefined,
                            'GET',
                          ),
                        ),
                      );
                    }}
                  >
                    <label>
                      <span>{tr('Nom de la radio', 'Radio name')}</span>
                      <div>
                        <Search aria-hidden="true" />
                        <input
                          value={radioQuery}
                          maxLength={60}
                          placeholder="France Inter, RTL, Radio Classique…"
                          onChange={(event) => setRadioQuery(event.target.value)}
                        />
                      </div>
                    </label>
                    <button
                      className="screen-button screen-button--primary"
                      disabled={busy || radioQuery.trim().length < 2}
                    >
                      {tr('Rechercher', 'Search')}
                    </button>
                  </form>
                  {radioResults.length > 0 && (
                    <div
                      className="screen-radio-results"
                      aria-label={tr('Résultats de recherche', 'Search results')}
                    >
                      {radioResults.map((station) => {
                        const stationMedia = state.media.find(
                          (media) => media.kind === 'stream' && media.url === station.url,
                        );
                        const listenState = playbackStateForMedia(stationMedia?.id);
                        return (
                          <article
                            key={`${station.id}-${station.url}`}
                            className={listenState === 'idle' ? '' : `is-${listenState}`}
                          >
                            <span className="screen-radio-logo">
                              <Radio aria-hidden="true" />
                              {station.artworkUrl && (
                                <img
                                  src={station.artworkUrl}
                                  alt=""
                                  onError={(event) => {
                                    event.currentTarget.style.display = 'none';
                                  }}
                                />
                              )}
                            </span>
                            <span>
                              <strong>{station.name}</strong>
                              <small>
                                {station.country || 'France'}
                                {station.bitrate ? ` · ${station.bitrate} kb/s` : ''}
                              </small>
                            </span>
                            <MediaPlaybackButton
                              state={listenState}
                              disabled={busy || !snapshot.online || !!state.call}
                              onClick={() => void listenToRadio(station)}
                            />
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {state.media.some((media) => media.kind === 'stream') ? (
                    <div className="screen-radio-favorites screen-media-library-panel">
                      <h4>{tr('Mes radios', 'My radios')}</h4>
                      <ul className="screen-library">
                        {state.media
                          .filter((media) => media.kind === 'stream')
                          .map((media) => {
                            const listenState = playbackStateForMedia(media.id);
                            return (
                              <li
                                key={media.id}
                                className={listenState === 'idle' ? '' : `is-${listenState}`}
                              >
                                <span className="screen-radio-logo">
                                  <Radio aria-hidden="true" />
                                  {media.artworkUrl && (
                                    <img
                                      src={media.artworkUrl}
                                      alt=""
                                      onError={(event) => {
                                        event.currentTarget.style.display = 'none';
                                      }}
                                    />
                                  )}
                                </span>
                                <span className="screen-library__name">
                                  <strong>{media.title}</strong>
                                  <small>
                                    {listenState === 'playing'
                                      ? tr(
                                          `Diffusée chez ${snapshot.resident}`,
                                          `Playing at ${snapshot.resident}’s`,
                                        )
                                      : listenState === 'pending'
                                        ? tr('Lancement sur la TV…', 'Starting on the TV…')
                                        : listenState === 'paused'
                                          ? tr('En pause', 'Paused')
                                          : tr('Radio enregistrée', 'Saved radio')}
                                  </small>
                                </span>
                                <MediaPlaybackButton
                                  state={listenState}
                                  disabled={!snapshot.online || busy || !!state.call}
                                  onClick={() => void command('play', { mediaId: media.id })}
                                />
                                <button
                                  className="screen-icon-button"
                                  aria-label={tr(`Retirer ${media.title}`, `Remove ${media.title}`)}
                                  onClick={() =>
                                    void run(() =>
                                      screenRequest(
                                        `screen/media/${media.id}`,
                                        undefined,
                                        'DELETE',
                                      ),
                                    )
                                  }
                                >
                                  <Trash2 />
                                </button>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  ) : radioResults.length === 0 ? (
                    <p className="screen-empty-library">
                      {tr(
                        'Recherchez une radio pour commencer.',
                        'Search for a radio to get started.',
                      )}
                    </p>
                  ) : null}
                </div>
                <div
                  id="media-panel-podcast"
                  role="tabpanel"
                  aria-labelledby="media-tab-podcast"
                  hidden={mediaTab !== 'podcast'}
                  className="screen-medias-source screen-podcast-panel"
                >
                  <h4>Podcasts</h4>
                  <p>
                    {tr(
                      'Recherchez une émission, parcourez ses épisodes et lancez la lecture sur la TV.',
                      'Search for a show, browse its episodes and start playback on the TV.',
                    )}
                  </p>
                  <form
                    className="screen-radio-search screen-podcast-search screen-media-search-panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      searchPodcasts();
                    }}
                  >
                    <label>
                      <span>
                        {tr('Nom d’une émission ou d’un sujet', 'Name of a show or a topic')}
                      </span>
                      <div>
                        <Search aria-hidden="true" />
                        <input
                          value={podcastQuery}
                          maxLength={80}
                          placeholder={tr(
                            'France Inter, histoire, musique…',
                            'BBC, history, music…',
                          )}
                          onChange={(event) => setPodcastQuery(event.target.value)}
                        />
                      </div>
                    </label>
                    <button
                      type="submit"
                      className="screen-button screen-button--primary"
                      disabled={busy || podcastQuery.trim().length < 2}
                    >
                      {tr('Rechercher', 'Search')}
                    </button>
                  </form>
                  {podcastResults.length > 0 && (
                    <div
                      className="screen-radio-results screen-podcast-results"
                      aria-label={tr('Résultats de podcasts', 'Podcast results')}
                    >
                      {podcastResults.map((podcast) => {
                        const followed = podcastSubscriptions.some(
                          (item) => item.id === podcast.id,
                        );
                        return (
                          <article key={podcast.id}>
                            <span className="screen-radio-logo">
                              <Headphones aria-hidden="true" />
                              {podcast.artworkUrl && (
                                <img
                                  src={podcast.artworkUrl}
                                  alt=""
                                  loading="lazy"
                                  onError={(event) => {
                                    event.currentTarget.style.display = 'none';
                                  }}
                                />
                              )}
                            </span>
                            <span>
                              <strong>{podcast.title}</strong>
                              <small>
                                {podcast.author || tr('Auteur inconnu', 'Unknown author')}
                                {podcast.episodeCount
                                  ? ` · ${podcast.episodeCount} ${tr('épisodes', 'episodes')}`
                                  : ''}
                                {podcast.genre ? ` · ${podcast.genre}` : ''}
                              </small>
                            </span>
                            <div className="screen-podcast-result-actions">
                              <button
                                type="button"
                                className="screen-button screen-button--secondary"
                                disabled={busy}
                                onClick={() => openPodcastEpisodes(podcast)}
                              >
                                {tr('Épisodes', 'Episodes')}
                              </button>
                              <button
                                type="button"
                                className="screen-button screen-button--primary"
                                disabled={busy || followed}
                                onClick={() => void followPodcast(podcast)}
                              >
                                {followed ? tr('Suivi', 'Following') : tr('Suivre', 'Follow')}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {podcastSearchDone && podcastResults.length === 0 && (
                    <p className="screen-empty-library">
                      {tr(
                        'Aucun podcast trouvé pour cette recherche.',
                        'No podcasts found for this search.',
                      )}
                    </p>
                  )}
                  {podcastSearchLoading && (
                    <p className="screen-empty-library">
                      {tr('Recherche des podcasts…', 'Searching podcasts…')}
                    </p>
                  )}
                  {podcastSubscriptions.length > 0 && (
                    <div className="screen-radio-favorites screen-podcast-library screen-media-library-panel">
                      <h4>{tr('Mes podcasts', 'My podcasts')}</h4>
                      <ul className="screen-library">
                        {podcastSubscriptions.map((podcast) => (
                          <li key={podcast.id}>
                            <span className="screen-radio-logo">
                              <Headphones aria-hidden="true" />
                              {podcast.artworkUrl && (
                                <img
                                  src={podcast.artworkUrl}
                                  alt=""
                                  loading="lazy"
                                  onError={(event) => {
                                    event.currentTarget.style.display = 'none';
                                  }}
                                />
                              )}
                            </span>
                            <span className="screen-library__name">
                              <strong>{podcast.title}</strong>
                              <small>
                                {activeMedia?.kind === 'podcast' &&
                                activeMedia.podcastFeedId === podcast.id
                                  ? state.playback.paused
                                    ? tr('Épisode en pause', 'Episode paused')
                                    : tr('En cours de lecture', 'Now playing')
                                  : podcast.author || tr('Podcast suivi', 'Followed podcast')}
                              </small>
                            </span>
                            <button
                              type="button"
                              className="screen-button screen-button--secondary"
                              disabled={busy}
                              onClick={() => openPodcastEpisodes(podcast)}
                            >
                              {tr('Épisodes', 'Episodes')}
                            </button>
                            <button
                              type="button"
                              className="screen-icon-button"
                              aria-label={tr(
                                `Retirer ${podcast.title} de mes podcasts`,
                                `Remove ${podcast.title} from my podcasts`,
                              )}
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  screenRequest(
                                    `screen/podcasts/${encodeURIComponent(podcast.id)}/follow`,
                                    undefined,
                                    'DELETE',
                                  ),
                                )
                              }
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedPodcast && (
                    <section
                      className="screen-podcast-episodes"
                      aria-label={tr('Épisodes du podcast', 'Podcast episodes')}
                    >
                      <div className="screen-podcast-show">
                        <span className="screen-radio-logo">
                          <Headphones aria-hidden="true" />
                          {selectedPodcast.artworkUrl && (
                            <img
                              src={selectedPodcast.artworkUrl}
                              alt=""
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                        </span>
                        <div>
                          <strong>{selectedPodcast.title}</strong>
                          <small>{selectedPodcast.author || 'Podcast'}</small>
                        </div>
                      </div>
                      {!podcastEpisodesLoaded ? (
                        <p className="screen-empty-library">
                          {tr('Chargement des épisodes…', 'Loading episodes…')}
                        </p>
                      ) : podcastEpisodes.length ? (
                        <div className="screen-podcast-episode-list">
                          {podcastEpisodes.map((episode) => {
                            const playingEpisode =
                              activeMedia?.kind === 'podcast' &&
                              activeMedia.podcastFeedId === selectedPodcast.id &&
                              activeMedia.podcastEpisodeId === episode.id
                                ? activeMedia
                                : undefined;
                            const listenState = playbackStateForMedia(playingEpisode?.id);
                            return (
                              <article
                                key={episode.id}
                                className={listenState === 'idle' ? '' : `is-${listenState}`}
                              >
                                <div>
                                  <strong>{episode.title}</strong>
                                  <small>
                                    {[
                                      podcastDateLabel(episode.publishedAt),
                                      podcastDurationLabel(episode.durationSeconds),
                                    ]
                                      .filter(Boolean)
                                      .join(' · ') || tr('Épisode', 'Episode')}
                                    {listenState !== 'idle' &&
                                      ` · ${listenState === 'playing' ? tr('En écoute', 'Playing') : listenState === 'pending' ? tr('Lancement', 'Starting') : tr('En pause', 'Paused')}`}
                                  </small>
                                  {episode.description && <p>{episode.description}</p>}
                                </div>
                                <MediaPlaybackButton
                                  state={listenState}
                                  disabled={busy || !snapshot.online || !!state.call}
                                  onClick={() => void playPodcastEpisode(selectedPodcast, episode)}
                                />
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="screen-empty-library">
                          {tr(
                            'Aucun épisode audio disponible pour cette émission.',
                            'No audio episodes available for this show.',
                          )}
                        </p>
                      )}
                    </section>
                  )}
                  {!podcastResults.length &&
                    !podcastSubscriptions.length &&
                    !podcastSearchDone &&
                    !podcastSearchLoading &&
                    !podcastQuery.trim() && (
                      <p className="screen-empty-library">
                        {tr(
                          'Recherchez une émission ou un sujet pour commencer.',
                          'Search for a show or a topic to get started.',
                        )}
                      </p>
                    )}
                </div>
              </div>
            </div>
            {mediaTab === 'tv' && (
              <section className="screen-tv-guide" aria-labelledby="screen-tv-guide-title">
                <div className="screen-tv-guide__heading">
                  <h4 id="screen-tv-guide-title">
                    <CalendarClock aria-hidden="true" /> {tr('Programme TV', 'TV guide')}
                  </h4>
                  <span>{tr('En ce moment et à suivre', 'On now and next')}</span>
                </div>
                {tvGuide ? (
                  <div className="screen-tv-guide__list">
                    {tvGuide.channels.map((channel) => {
                      const current = channel.current;
                      const next = channel.next;
                      const progress = current
                        ? Math.max(
                            0,
                            Math.min(
                              100,
                              ((Date.now() - new Date(current.startAt).getTime()) /
                                (new Date(current.endAt).getTime() -
                                  new Date(current.startAt).getTime())) *
                                100,
                            ),
                          )
                        : 0;
                      return (
                        <article className="screen-tv-guide__channel" key={channel.id}>
                          <div className="screen-tv-guide__identity">
                            <span
                              className={`screen-tv-guide__brand screen-tv-guide__brand--${channel.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`}
                            >
                              {channel.name === 'ARTE' ? 'arte' : 'RMC'}
                            </span>
                            <strong>{channel.name}</strong>
                          </div>
                          <div className="screen-tv-guide__programs">
                            <div className="screen-tv-guide__program">
                              <span className="screen-tv-guide__label">
                                {current
                                  ? tr('En cours', 'On now')
                                  : next
                                    ? tr('À venir', 'Coming up')
                                    : tr('Programme', 'Programme')}
                                {current && <time>{tvGuideRange(current)}</time>}
                              </span>
                              <strong>
                                {current?.title ??
                                  next?.title ??
                                  tr('Programme indisponible', 'Programme unavailable')}
                              </strong>
                              {current?.description && <p>{current.description}</p>}
                              {current && (
                                <span className="screen-tv-guide__progress" aria-hidden="true">
                                  <span style={{ width: `${progress}%` }} />
                                </span>
                              )}
                            </div>
                            {current && next && (
                              <div className="screen-tv-guide__program screen-tv-guide__program--next">
                                <span className="screen-tv-guide__label">
                                  {tr('À suivre', 'Next')} <time>{tvGuideRange(next)}</time>
                                </span>
                                <strong>{next.title}</strong>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="screen-tv-guide__empty">
                    {tvGuideUnavailable
                      ? tr(
                          'Programme TV temporairement indisponible. La récupération reprend automatiquement.',
                          'TV guide temporarily unavailable. Retrieval will resume automatically.',
                        )
                      : tr(
                          'Récupération automatique du programme TV…',
                          'Fetching the TV guide automatically…',
                        )}
                  </p>
                )}
                <p className="screen-tv-guide__source">
                  {tvGuide?.stale
                    ? `${tr('Dernière grille reçue à', 'Last guide received at')} ${tvGuideTime.format(new Date(tvGuide.retrievedAt))} · `
                    : tr(
                        'Grille actualisée automatiquement · ',
                        'Guide refreshed automatically · ',
                      )}
                  <a href="https://www.xmltvfr.fr/xmltv.php" target="_blank" rel="noreferrer">
                    {tr('Source XMLTV France', 'Source: XMLTV France')}{' '}
                    <ExternalLink aria-hidden="true" />
                  </a>
                </p>
              </section>
            )}
          </section>

          <section
            id="screen-main-panel-album"
            role="tabpanel"
            aria-labelledby="screen-main-tab-album"
            hidden={activeMainTab !== 'album'}
            className="screen-card screen-media-card"
          >
            <div className="screen-card__heading">
              <span>
                <ImagePlus aria-hidden="true" />
              </span>
              <div>
                <h3>{tr('Album photo', 'Photo album')}</h3>
                <p>
                  {tr(
                    'Chaque photo défile avec son commentaire affiché en dessous.',
                    'Each photo is shown in turn with its caption underneath.',
                  )}
                </p>
              </div>
            </div>
            <div className="screen-album-editor">
              <h4>{tr('Ajouter une photo', 'Add a photo')}</h4>
              <div className="screen-photo-form">
                <label className="screen-upload">
                  <Upload aria-hidden="true" />
                  <span>
                    <strong>
                      {photo ? photo.name : tr('Choisir une photo', 'Choose a photo')}
                    </strong>
                    <small>
                      {tr('JPG, PNG ou WebP · 100 Mo maximum', 'JPG, PNG or WebP · 100 MB maximum')}
                    </small>
                  </span>
                  <input
                    aria-label={tr('Choisir une photo', 'Choose a photo')}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setPhoto(event.target.files?.[0])}
                  />
                </label>
                <label className="screen-photo-caption">
                  <span>
                    {tr(
                      'Commentaire sous la photo (facultatif)',
                      'Caption under the photo (optional)',
                    )}
                  </span>
                  <div
                    className="screen-emoji-picker screen-photo-emojis"
                    aria-label={tr(
                      'Ajouter un émoji au commentaire',
                      'Add an emoji to the caption',
                    )}
                  >
                    {messageEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={tr(
                          `Ajouter ${emoji} au commentaire`,
                          `Add ${emoji} to the caption`,
                        )}
                        onClick={() =>
                          setPhotoCaption(
                            (current) =>
                              `${current}${current && !current.endsWith(' ') ? ' ' : ''}${emoji}`,
                          )
                        }
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <textarea
                    maxLength={120}
                    value={photoCaption}
                    onChange={(event) => setPhotoCaption(event.target.value)}
                    placeholder={tr('Ajouter un commentaire…', 'Add a caption…')}
                  />
                  <small>{photoCaption.length}/120</small>
                </label>
              </div>
              <div className={`screen-photo-scheduling${photoScheduleAt ? ' is-active' : ''}`}>
                <span className="screen-schedule-control__icon">
                  <CalendarClock aria-hidden="true" />
                </span>
                <label>
                  <span>{tr('Afficher cette photo plus tard', 'Show this photo later')}</span>
                  <input
                    type="datetime-local"
                    value={photoScheduleAt}
                    onChange={(event) => setPhotoScheduleAt(event.target.value)}
                  />
                </label>
                <p>
                  {photoScheduleAt
                    ? tr(
                        'La photo sera ajoutée à l’album et affichée automatiquement.',
                        'The photo will be added to the album and shown automatically.',
                      )
                    : tr(
                        'Laissez vide pour simplement ajouter la photo à l’album.',
                        'Leave empty to simply add the photo to the album.',
                      )}
                </p>
                <button
                  className="screen-button screen-button--primary"
                  disabled={
                    !photo ||
                    busy ||
                    (!!photoScheduleAt && new Date(photoScheduleAt).getTime() <= Date.now())
                  }
                  onClick={() =>
                    void run(async () => {
                      if (!photo) return;
                      const caption = photoCaption.trim();
                      const body = new FormData();
                      body.append('file', photo);
                      const response = await fetch('/api/v1/screen/upload', {
                        method: 'POST',
                        body,
                      });
                      if (!response.ok)
                        throw new Error(
                          tr(
                            'Envoi impossible (100 Mo maximum).',
                            'Upload failed (100 MB maximum).',
                          ),
                        );
                      const uploaded = (await response.json()) as ScreenSnapshot;
                      const media = uploaded.state.media.at(-1);
                      if (!media || media.kind !== 'photo')
                        throw new Error(
                          tr(
                            'Photo introuvable après l’envoi.',
                            'Photo not found after the upload.',
                          ),
                        );
                      await screenRequest('screen/media', { ...media, title: caption });
                      if (photoScheduleAt)
                        await screenRequest('screen/scheduled-content', {
                          kind: 'photo',
                          mediaId: media.id,
                          scheduledAt: new Date(photoScheduleAt).toISOString(),
                        });
                      setPhoto(undefined);
                      setPhotoCaption('');
                      setPhotoScheduleAt('');
                    })
                  }
                >
                  {photoScheduleAt ? (
                    <CalendarClock aria-hidden="true" />
                  ) : (
                    <ImagePlus aria-hidden="true" />
                  )}
                  {photoScheduleAt
                    ? tr('Programmer la photo', 'Schedule the photo')
                    : tr('Ajouter à l’album', 'Add to the album')}
                </button>
              </div>
            </div>
            <div className="screen-album-library">
              <h4>{tr(`Album de ${residentFirstName}`, `${residentFirstName}’s album`)}</h4>
              <div className="screen-slideshow-setting">
                <Timer aria-hidden="true" />
                <label>
                  <span>{tr('Temps par photo', 'Time per photo')}</span>
                  <select
                    value={settings.slideshowSeconds ?? 15}
                    onChange={(event) =>
                      setSettings({ ...settings, slideshowSeconds: Number(event.target.value) })
                    }
                  >
                    <option value={5}>{tr('5 secondes', '5 seconds')}</option>
                    <option value={10}>{tr('10 secondes', '10 seconds')}</option>
                    <option value={15}>{tr('15 secondes', '15 seconds')}</option>
                    <option value={30}>{tr('30 secondes', '30 seconds')}</option>
                    <option value={60}>1 minute</option>
                    <option value={120}>2 minutes</option>
                  </select>
                </label>
                <button
                  className="screen-button screen-button--secondary"
                  disabled={
                    busy ||
                    (settings.slideshowSeconds ?? 15) === (state.settings.slideshowSeconds ?? 15)
                  }
                  onClick={() =>
                    void run(() => screenRequest('screen/settings', settings, 'PATCH'))
                  }
                >
                  {tr('Enregistrer', 'Save')}
                </button>
              </div>
              {state.media.some((media) => media.kind === 'photo') ? (
                <ul className="screen-library">
                  {state.media
                    .filter((media) => media.kind === 'photo')
                    .map((media) => (
                      <li
                        key={media.id}
                        className={state.playback.mediaId === media.id ? 'is-playing' : ''}
                      >
                        <img className="screen-library__thumbnail" src={media.url} alt="" />
                        <span className="screen-library__name">
                          <strong>{media.title}</strong>
                          <small>{tr('Photo de l’album', 'Album photo')}</small>
                        </span>
                        <button
                          className="screen-button screen-button--secondary"
                          disabled={!snapshot.online}
                          onClick={() => void command('play', { mediaId: media.id })}
                        >
                          <Play /> {tr('Afficher', 'Show')}
                        </button>
                        <button
                          className="screen-icon-button"
                          aria-label={tr(`Retirer ${media.title}`, `Remove ${media.title}`)}
                          onClick={() =>
                            void run(() =>
                              screenRequest(`screen/media/${media.id}`, undefined, 'DELETE'),
                            )
                          }
                        >
                          <Trash2 />
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="screen-empty-library">
                  {tr('Aucune photo ajoutée pour le moment.', 'No photos added yet.')}
                </p>
              )}
            </div>
          </section>
        </>
      )}
      <section
        id="screen-main-panel-activity"
        className="screen-activity-tab-panel"
        role="tabpanel"
        aria-labelledby="screen-main-tab-activity"
        tabIndex={0}
        hidden={activeMainTab !== 'activity'}
      >
        <details className="screen-card screen-activity-card screen-activity-details" open>
          <summary>
            <span className="screen-activity-details__icon">
              <Activity aria-hidden="true" />
            </span>
            <span className="screen-activity-details__copy">
              <strong>{tr('Suivi de l’activité', 'Activity tracking')}</strong>
              <small>
                {tr(
                  `Historique des actions envoyées chez ${snapshot.resident}.`,
                  `History of actions sent to ${snapshot.resident}’s screen.`,
                )}
              </small>
            </span>
            <ChevronRight className="screen-activity-details__chevron" aria-hidden="true" />
          </summary>
          <div className="screen-activity-details__body">
            <div className="screen-activity-summary">
              <span>
                <strong>
                  {
                    (state.activity ?? []).filter(
                      (item) => item.createdAt >= new Date().setHours(0, 0, 0, 0),
                    ).length
                  }
                </strong>{' '}
                {tr('actions aujourd’hui', 'actions today')}
              </span>
              <span className="is-success">
                <CircleCheck aria-hidden="true" />{' '}
                {(state.activity ?? []).filter((item) => item.status === 'applied').length}{' '}
                {tr('confirmées', 'confirmed')}
              </span>
              {(state.activity ?? []).some(
                (item) => item.status === 'failed' || item.status === 'expired',
              ) && (
                <span className="is-error">
                  <CircleX aria-hidden="true" />{' '}
                  {
                    (state.activity ?? []).filter(
                      (item) => item.status === 'failed' || item.status === 'expired',
                    ).length
                  }{' '}
                  {tr('non abouties', 'unsuccessful')}
                </span>
              )}
            </div>
            {(state.activity ?? []).length ? (
              <ol className="screen-activity-list">
                {[...(state.activity ?? [])]
                  .slice(-30)
                  .reverse()
                  .map((item) => {
                    const statusLabel =
                      item.status === 'applied'
                        ? tr('Confirmée', 'Confirmed')
                        : item.status === 'pending'
                          ? tr('En cours', 'In progress')
                          : item.status === 'expired'
                            ? tr('Expirée', 'Expired')
                            : tr('Échec', 'Failed');
                    const StatusIcon =
                      item.status === 'applied'
                        ? CircleCheck
                        : item.status === 'pending'
                          ? Clock3
                          : CircleX;
                    return (
                      <li key={item.id}>
                        <span className={`screen-activity-kind screen-activity-kind--${item.kind}`}>
                          {item.kind === 'message' ? (
                            <MessageCircleHeart aria-hidden="true" />
                          ) : item.kind === 'call' ? (
                            <Phone aria-hidden="true" />
                          ) : item.kind === 'appointment' ? (
                            <CalendarClock aria-hidden="true" />
                          ) : item.kind === 'content' ? (
                            <Play aria-hidden="true" />
                          ) : (
                            <Settings aria-hidden="true" />
                          )}
                        </span>
                        <div>
                          <strong>{item.title}</strong>
                          {item.detail && <p>{item.detail}</p>}
                          <small>
                            {item.actor ? `${item.actor} · ` : ''}
                            {new Date(item.createdAt).toLocaleString(dateLocale(), {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </small>
                        </div>
                        <span className={`screen-activity-status is-${item.status}`}>
                          <StatusIcon aria-hidden="true" /> {statusLabel}
                        </span>
                      </li>
                    );
                  })}
              </ol>
            ) : (
              <p className="screen-empty-library">
                {tr(
                  'Les prochaines actions envoyées à l’écran apparaîtront ici.',
                  'The next actions sent to the screen will appear here.',
                )}
              </p>
            )}
          </div>
        </details>
      </section>
    </section>
  );
}
