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
import { type Locale, t } from './i18n';
import { dateLocale } from './screen-locale';
import { DEMO_SHOW_TV_EVENT, residentScreenHref } from './resident-screen-link';
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
      label: t('screenPanel.haveAGoodDay'),
      message: t('screenPanel.haveALovelyDayThinking'),
    },
    {
      emoji: '📅',
      label: t('screenPanel.appointment'),
      message: t('screenPanel.donTForgetYourAppointment'),
    },
    {
      emoji: '🏡',
      label: t('screenPanel.weReOnOurWay'),
      message: t('screenPanel.weLlBeThereSoon'),
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
  idleLabel = t('screenPanel.listen'),
  playingLabel = t('screenPanel.playing'),
  pendingLabel = t('screenPanel.starting'),
  pausedLabel = t('screenPanel.resume'),
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
    mediaTitle: () => t('screenPanel.channelLive', { name: 'ARTE' }),
    name: 'ARTE',
    description: () => t('screenPanel.channelDescription.arte'),
    brand: 'arte',
  },
  {
    url: RMC_LIFE_LIVE_URL,
    mediaTitle: () => t('screenPanel.channelLive', { name: 'RMC Life' }),
    name: 'RMC Life',
    description: () => t('screenPanel.channelDescription.rmcLife'),
    brand: 'rmc-life',
    brandLabel: 'RMC',
  },
  {
    url: RMC_STORY_LIVE_URL,
    mediaTitle: () => t('screenPanel.channelLive', { name: 'RMC Story' }),
    name: 'RMC Story',
    description: () => t('screenPanel.channelDescription.rmcStory'),
    brand: 'rmc-story',
    brandLabel: 'RMC',
  },
  {
    url: RMC_DECOUVERTE_LIVE_URL,
    mediaTitle: () => t('screenPanel.channelLive', { name: 'RMC Découverte' }),
    name: 'RMC Découverte',
    description: () => t('screenPanel.channelDescription.rmcDecouverte'),
    brand: 'rmc-decouverte',
    brandLabel: 'RMC',
  },
] as const;
const tvGuideTime = (value: string) =>
  new Intl.DateTimeFormat(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(value));
function tvGuideRange(program: TvGuideProgram | null): string {
  return program ? `${tvGuideTime(program.startAt)} – ${tvGuideTime(program.endAt)}` : '';
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
    throw new Error(b.message ?? `${t('screenPanel.error')} ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function startResidentScreenCall(): Promise<void> {
  const snapshot = await screenRequest<ScreenSnapshot>('screen', undefined, 'GET');
  if (!snapshot.grant.call) throw new Error(t('screenPanel.youAreNotAllowedTo'));
  if (!snapshot.online) throw new Error(t('screenPanel.theScreenIsOffline'));
  if (!snapshot.state.settings.consent) throw new Error(t('screenPanel.consentToCallsIsTurned'));
  if (snapshot.state.call) throw new Error(t('screenPanel.aCallIsAlreadyIn'));
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
        reject(new Error(t('screenPanel.jitsiIsUnreachable')));
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
      <button onClick={onEnd}>{t('screenPanel.hangUp')}</button>
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
        aria-label={t('screenPanel.videoCallWith', { resident })}
      >
        <header className="screen-call-window__header">
          <div className="screen-call-window__identity">
            <span className="screen-call-window__icon" aria-hidden="true">
              <Video />
            </span>
            <div>
              <p>{t('screenPanel.liveVideoCall')}</p>
              <h2>{t('screenPanel.callWith', { resident })}</h2>
              <span>{t('screenPanel.youAreJoiningAs', { name: join.name })}</span>
            </div>
          </div>
          <span className="screen-call-window__status">
            <i aria-hidden="true" /> {t('screenPanel.callInProgress')}
          </span>
          <button
            type="button"
            className="screen-call-window__hangup"
            onClick={onEnd}
            aria-label={t('screenPanel.hangUpTheCallWith', { resident })}
          >
            <Phone aria-hidden="true" />
            {t('screenPanel.hangUp')}
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
  const [playlistTitle, setPlaylistTitle] = useState(() => t('screenPanel.myVideos'));
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
    if (!popup) setError(t('screenPanel.theGoogleWindowWasBlocked'));
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
        message={error || t('screenPanel.preparingYourScreenAndCalls')}
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
    ? t('screenPanel.cecWorking')
    : tvHost?.cec?.detected
      ? t('screenPanel.cecToCheck')
      : tvHost?.installed
        ? t('screenPanel.cecNotDetected')
        : t('screenPanel.tvAgentMissing');
  const display = tvHost?.display;
  const displayUpdatedAt = display?.updatedAt;
  const displayStatusFresh =
    typeof displayUpdatedAt === 'number' && Date.now() / 1000 - displayUpdatedAt < 60;
  const videoOutputReady = displayStatusFresh && Boolean(display?.selected && display?.mode);
  const connectedOutputs = display?.connected ?? [];
  const videoOutputLabel = !tvHost?.installed
    ? t('screenPanel.videoAgentMissing')
    : !displayStatusFresh
      ? t('screenPanel.hdmiStatusUnavailable')
      : videoOutputReady
        ? t('screenPanel.output', { selected: display?.selected, mode: display?.mode })
        : connectedOutputs.length > 0
          ? t('screenPanel.detectedWithNoActiveMode', {
              connectedOutputs: connectedOutputs.join(', '),
            })
          : t('screenPanel.noVideoOutputDetected');
  const selectedNetworkTv = tvHost?.networkTv?.id ? tvHost.networkTv : undefined;
  const networkStatusFresh =
    typeof tvHost?.networkTvStatus?.updatedAt === 'number' &&
    Date.now() / 1000 - tvHost.networkTvStatus.updatedAt < 30;
  const networkReachable = networkStatusFresh && tvHost?.networkTvStatus?.reachable === true;
  const networkControlReady =
    selectedNetworkTv && (networkReachable || tvHost?.homeAssistantTv?.available === true);
  const networkControlLabel = !selectedNetworkTv
    ? t('screenPanel.networkTvNotPaired')
    : networkReachable
      ? t('screenPanel.networkReachable', { name: selectedNetworkTv.name })
      : tvHost?.homeAssistantTv?.available
        ? t('screenPanel.homeAssistantFallback', { name: selectedNetworkTv.name })
        : t('screenPanel.networkOnStandby', { name: selectedNetworkTv.name });
  const networkTvOnline = networkReachable || tvHost?.homeAssistantTv?.available === true;
  const networkTvStatusLabel = !selectedNetworkTv
    ? t('screenPanel.tvNotPaired')
    : networkTvOnline
      ? t('screenPanel.online')
      : networkStatusFresh
        ? t('screenPanel.offline')
        : t('screenPanel.statusUnavailable');
  const screenOutputConnected = snapshot.online && videoOutputReady;
  const status = !snapshot.online
    ? snapshot.paired
      ? t('screenPanel.screenOffline')
      : t('screenPanel.screenBeingPrepared')
    : !displayStatusFresh
      ? t('screenPanel.videoStatusUnavailable')
      : !videoOutputReady
        ? t('screenPanel.tvNotDetected')
        : state.call
          ? t('screenPanel.onACall')
          : state.playback.asleep
            ? t('screenPanel.resting')
            : t('screenPanel.screenConnected');
  const mediaStatus = !snapshot.online
    ? t('screenPanel.tvOffline')
    : !displayStatusFresh
      ? t('screenPanel.videoStatusUnavailable')
      : !videoOutputReady
        ? t('screenPanel.tvNotDetected')
        : state.call
          ? t('screenPanel.pausedDuringTheCall')
          : state.playback.asleep
            ? t('screenPanel.tvResting')
            : state.playback.paused
              ? t('screenPanel.paused')
              : mediaPending
                ? t('screenPanel.startingOnTheTv')
                : t('screenPanel.nowPlaying');
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
      { id: 'album', label: t('screenPanel.photoAlbum'), icon: Image, allowed: grant.control },
      {
        id: 'messages',
        label: t('screenPanel.messages'),
        icon: MessageSquareText,
        allowed: grant.message,
      },
      { id: 'medias', label: t('screenPanel.media'), icon: Tv, allowed: grant.control },
      {
        id: 'activity',
        label: t('screenPanel.activityTracking'),
        icon: Activity,
        allowed: true,
      },
    ] as const
  ).filter((tab) => tab.allowed);
  const activeMainTab = mainTabs.some((tab) => tab.id === selectedMainTab)
    ? selectedMainTab
    : mainTabs[0]?.id;
  const currentContentLabel = state.call
    ? t('screenPanel.callInProgress')
    : state.playback.asleep
      ? t('screenPanel.tvResting')
      : undefined;
  return (
    <section className="screen-panel">
      <header className="page-hero screen-panel__hero">
        <div className="page-hero__copy screen-panel__identity">
          <div>
            <p className="page-hero__eyebrow screen-panel__eyebrow">
              {t('screenPanel.residentDisplay')}
            </p>
            <h2 className="page-hero__title">{t('screenPanel.screenAndCalls')}</h2>
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
              href={residentScreenHref()}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                // The demo has no separate TV page: a plain click shows its TV view in place.
                if (
                  import.meta.env.MODE !== 'demo' ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey
                )
                  return;
                event.preventDefault();
                window.dispatchEvent(new Event(DEMO_SHOW_TV_EVENT));
              }}
            >
              {t('screenPanel.viewTheScreen')} <ExternalLink aria-hidden="true" />
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
                <Power aria-hidden="true" /> {t('screenPanel.takeOverTheTv')}
              </button>
            )}
            {grant.call && (
              <button
                className="screen-button screen-button--call"
                disabled={busy || !snapshot.online || !!call || !state.settings.consent}
                onClick={() => void run(() => screenRequest('screen/calls'))}
              >
                <Phone aria-hidden="true" /> {t('screenPanel.call', { residentFirstName })}
              </button>
            )}
          </div>
          {(grant.administer || grant.control) && (
            <div
              className="screen-capabilities"
              aria-label={t('screenPanel.screenEquipmentStatus')}
            >
              <span className={snapshot.capabilities.camera ? 'is-ready' : ''}>
                <Camera aria-hidden="true" />
                {t('screenPanel.camera')}{' '}
                {snapshot.capabilities.camera ? t('screenPanel.ready') : t('screenPanel.toTest')}
              </span>
              <span className={snapshot.capabilities.microphone ? 'is-ready' : ''}>
                <Mic aria-hidden="true" />
                {t('screenPanel.microphone')}{' '}
                {snapshot.capabilities.microphone
                  ? t('screenPanel.ready2')
                  : t('screenPanel.toTest')}
              </span>
              <span className={snapshot.online ? 'is-ready' : ''}>
                <Tv aria-hidden="true" />
                {t('screenPanel.kioskBrowser')}{' '}
                {snapshot.online ? t('screenPanel.connected') : t('screenPanel.toCheck')}
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
                  ? t('screenPanel.takeoverPathsConfigured')
                  : t('screenPanel.tvTakeoverToCheck')}
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
      <div className="screen-live-status" aria-label={t('screenPanel.tvAndPlaybackStatus')}>
        <section className="screen-tv-now" aria-label={t('screenPanel.onTheTvNow')}>
          <span className="screen-tv-now__title">
            <Tv aria-hidden="true" />
            <strong>{t('screenPanel.onTheTvNow')}</strong>
          </span>
          <span className="screen-tv-now__device">
            {selectedNetworkTv?.name ?? t('screenPanel.tvNotPaired')}
            {selectedNetworkTv && <small>{t('screenPanel.paired')}</small>}
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
              {t('screenPanel.forgetThisTv')}
            </button>
          )}
        </section>
        <section
          className="screen-playback-now"
          aria-label={t('screenPanel.playbackAndSoundOnThe')}
          aria-live="polite"
        >
          <span
            className={`screen-playback-now__dot ${activeMedia && mediaRunning ? 'is-live' : ''}`}
          />
          <span className="screen-playback-now__icon">
            {activeMedia ? <MediaIcon aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </span>
          <span className="screen-playback-now__copy">
            <small>{activeMedia ? mediaStatus : t('screenPanel.tvSound')}</small>
            <strong>{activeMedia?.title ?? t('screenPanel.noMediaPlaying')}</strong>
          </span>
          {activeMedia && (
            <div className="screen-playback-now__controls">
              <span className="screen-playback-now__type">{mediaType}</span>
              <button
                type="button"
                aria-label={
                  state.playback.paused || state.playback.asleep
                    ? t('screenPanel.resume')
                    : t('screenPanel.pause')
                }
                title={
                  state.playback.paused || state.playback.asleep
                    ? t('screenPanel.resume')
                    : t('screenPanel.pause')
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
                      ? t('screenPanel.nextEpisode')
                      : t('screenPanel.next')
                  }
                  title={
                    activeMedia.kind === 'podcast'
                      ? t('screenPanel.nextEpisode')
                      : t('screenPanel.next')
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
                aria-label={t('screenPanel.stopPlayback')}
                title={t('screenPanel.stopPlayback')}
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
              <span className="screen-visually-hidden">{t('screenPanel.tvVolume')}</span>
              <input
                type="range"
                min="0"
                max="100"
                aria-label={t('screenPanel.tvVolume')}
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
              <h3>{t('screenPanel.tvOnTheLocalNetwork')}</h3>
              <p>{t('screenPanel.theRaspberryPiCanUse')}</p>
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
                    ? t('screenPanel.tvReachableOnTheLocal')
                    : t('screenPanel.tvOnStandbyOrUnreachable')}
                  {selectedNetworkTv.homeAssistantEntityId
                    ? t('screenPanel.homeAssistantFallbackPaired')
                    : ''}
                </small>
              </div>
            ) : (
              <p>{t('screenPanel.noTvOnTheLocal')}</p>
            )}
            <div className="screen-network-tv-actions">
              <button
                className="screen-button screen-button--secondary"
                disabled={busy}
                onClick={() => void scanLocalTvs()}
              >
                <Search aria-hidden="true" /> {t('screenPanel.searchForTvs')}
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
                          ? t('screenPanel.homeAssistantControlAvailableAs')
                          : device.mac
                            ? t('screenPanel.networkWakeUpAvailableIf')
                            : t('screenPanel.macAddressNotAnnouncedCec')}
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
                        ? t('screenPanel.paired')
                        : addsHomeAssistant || addsMergedHomeAssistant
                          ? t('screenPanel.addAsFallback')
                          : addsNetwork || addsMergedNetwork
                            ? t('screenPanel.addTheNetwork')
                            : t('screenPanel.pair')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {tvScanDone && discoveredTvs.length === 0 && (
            <p className="screen-empty-library">{t('screenPanel.noTvAnsweredCheckThat')}</p>
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
                ? t('screenPanel.callInProgress')
                : t('screenPanel.calling', { name: call.name })}
            </strong>
            {call.userId === snapshot.userId && (
              <button
                onClick={() =>
                  void run(() => screenRequest(`screen/calls/${call.id}`, undefined, 'DELETE'))
                }
              >
                {t('screenPanel.cancelTheCall')}
              </button>
            )}
          </div>
        )
      )}
      {mainTabs.length > 0 && (
        <div
          className="screen-main-tabs"
          role="tablist"
          aria-label={t('screenPanel.screenSections')}
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
              <h3>{t('screenPanel.messageOnTheTv')}</h3>
              <p>{t('screenPanel.yourMessagesStayInFront')}</p>
            </div>
          </div>
          <div className="screen-message-favorites">
            <span>{t('screenPanel.favouriteMessages')}</span>
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
          <div className="screen-message-tabs" aria-label={t('screenPanel.messagesToDisplay')}>
            {messages.map((text, index) => (
              <button
                key={index}
                type="button"
                className="screen-button screen-button--secondary"
                aria-pressed={index === messageIndex}
                onClick={() => setMessageIndex(index)}
              >
                Message {index + 1}
                {text.trim() ? '' : t('screenPanel.empty')}
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
              {t('screenPanel.addAMessage')}
            </button>
          </div>
          <div className="screen-emoji-picker" aria-label={t('screenPanel.addAnEmoji')}>
            {messageEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={t('screenPanel.add', { emoji })}
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
            <span>{t('screenPanel.messageNumber', { index: messageIndex + 1 })}</span>
            <textarea
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('screenPanel.haveALovelyDayThinking2', {
                resident: snapshot.resident,
              })}
            />
          </label>
          <div className="screen-message-timing">
            <label>
              <span>{t('screenPanel.durationOfEachMessageSeconds')}</span>
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
                ? t('screenPanel.messagesLoopInThisOrder')
                : t('screenPanel.addSeveralMessagesToTurn')}
            </small>
          </div>
          <div className={`screen-schedule-control${messageScheduleAt ? ' is-active' : ''}`}>
            <span className="screen-schedule-control__icon">
              <CalendarClock aria-hidden="true" />
            </span>
            <label>
              <span>{t('screenPanel.scheduleForLater')}</span>
              <input
                type="datetime-local"
                value={messageScheduleAt}
                onChange={(event) => setMessageScheduleAt(event.target.value)}
              />
            </label>
            <p>
              {messageScheduleAt
                ? `${t('screenPanel.scheduledFor')} ${new Date(messageScheduleAt).toLocaleString(
                    dateLocale(),
                    {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    },
                  )}`
                : t('screenPanel.leaveEmptyToShowThe')}
            </p>
            {messageScheduleAt && (
              <button
                type="button"
                className="screen-schedule-clear"
                onClick={() => setMessageScheduleAt('')}
              >
                {t('screenPanel.now')}
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
                <Trash2 /> {t('screenPanel.removeThisMessage')}
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
                <Trash2 /> {t('screenPanel.clear')}
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
                ? t('screenPanel.scheduleTheMessage')
                : t('screenPanel.showOnTheTv')}
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
              <h3>{t('screenPanel.upcomingBroadcasts')}</h3>
              <p>{t('screenPanel.messagesAndPhotosWillBe')}</p>
            </div>
            <strong className="screen-scheduled-count">
              {t('screenPanel.scheduledCount', { count: state.scheduledContent?.length ?? 0 })}
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
                      ·{' '}
                      {item.kind === 'message'
                        ? t('screenPanel.kindMessage')
                        : t('screenPanel.kindPhoto')}
                    </small>
                  </span>
                  <button
                    className="screen-icon-button"
                    aria-label={t('screenPanel.cancelTheScheduleFor', { title: item.title })}
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
                <h3>{t('screenPanel.media')}</h3>
                <p>
                  {t('screenPanel.chooseWhatWatchesOrListens', { resident: snapshot.resident })}
                </p>
              </div>
              <span className="screen-medias-device">
                <Tv aria-hidden="true" /> {t('screenPanel.sTv', { resident: snapshot.resident })}
              </span>
            </div>
            <div className="screen-medias-layout">
              <div className="screen-medias-browser">
                <div
                  className="screen-medias-tabs"
                  role="tablist"
                  aria-label={t('screenPanel.mediaSources')}
                >
                  {(
                    [
                      ['youtube', 'YouTube', Youtube],
                      ['tv', t('screenPanel.liveTv'), Tv],
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
                    aria-label={t('screenPanel.liveTvChannels')}
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
                              <h4>{channel.mediaTitle()}</h4>
                              <p>{channel.description()}</p>
                            </div>
                          </div>
                          <MediaPlaybackButton
                            state={playbackState}
                            idleLabel={t('screenPanel.watch', { name: channel.name })}
                            playingLabel={t('screenPanel.onScreen')}
                            pendingLabel={t('screenPanel.switching')}
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
                                    title: channel.mediaTitle(),
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
                  <p className="screen-tv-note">{t('screenPanel.liveViewingMayBeLimited')}</p>
                </div>
                <div
                  id="media-panel-youtube"
                  role="tabpanel"
                  aria-labelledby="media-tab-youtube"
                  hidden={mediaTab !== 'youtube'}
                  className="screen-medias-source screen-playlist-card"
                >
                  <h4>{t('screenPanel.yourYoutubePlaylists')}</h4>
                  <p>{t('screenPanel.connectYourGoogleAccountTo')}</p>
                  <div className="screen-youtube-account">
                    <span className="screen-youtube-account__logo">
                      <Youtube aria-hidden="true" />
                    </span>
                    <div className="screen-youtube-account__copy">
                      <strong>
                        {youtubeAccount?.connected
                          ? youtubeAccount.channelTitle ||
                            youtubeAccount.email ||
                            t('screenPanel.connectedAccount')
                          : t('screenPanel.youtubeAccount')}
                      </strong>
                      <small>
                        {youtubeAccount?.connected
                          ? youtubeAccount.email || t('screenPanel.personalPlaylistsAvailable')
                          : youtubeAccount?.configured
                            ? t('screenPanel.yourPersonalPlaylistsSecurely')
                            : t('screenPanel.connectionToBeSetUp')}
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
                          {t('screenPanel.refresh')}
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
                          {t('screenPanel.disconnect')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="screen-button screen-button--primary"
                        disabled={busy || youtubeAccount?.configured === false}
                        onClick={connectYouTube}
                      >
                        {t('screenPanel.connectGoogle')}
                      </button>
                    )}
                  </div>
                  {youtubeAccount?.configured === false && (
                    <p className="screen-youtube-hint">
                      {t('screenPanel.theAdministratorOnlyNeedsTo')}
                    </p>
                  )}
                  {youtubeAccount?.connected && (
                    <div className="screen-youtube-cloud-playlists">
                      <div className="screen-youtube-cloud-heading">
                        <strong>{t('screenPanel.playlistsOnYourAccount')}</strong>
                        <span>
                          {youtubePlaylists.length} {t('screenPanel.available')}
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
                                    {playlist.itemCount} {t('screenPanel.videoS')}
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
                                    ? t('screenPanel.loading')
                                    : imported
                                      ? t('screenPanel.playAgain')
                                      : t('screenPanel.addAndPlay')}
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="screen-empty-library">
                          {t('screenPanel.noPlaylistsAvailableOnThis')}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="screen-youtube-manual">
                    <strong>{t('screenPanel.addVideosByLink')}</strong>
                    <p>{t('screenPanel.oneLinkPerLineUp')}</p>
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
                          setError(t('screenPanel.addBetween1And50'));
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
                        {t('screenPanel.playlistName')}
                        <input
                          value={playlistTitle}
                          maxLength={120}
                          required
                          onChange={(event) => setPlaylistTitle(event.target.value)}
                        />
                      </label>
                      <label>
                        {t('screenPanel.youtubeLinks')}
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
                        {t('screenPanel.saveThePlaylist')}
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
                              {media.playlistUrls?.length ?? 1} {t('screenPanel.videoS')}
                              {state.playback.mediaId === media.id ? t('screenPanel.selected') : ''}
                            </small>
                          </div>
                          <button
                            className="screen-button"
                            disabled={busy || !grant.control || !snapshot.online}
                            onClick={() => void command('play', { mediaId: media.id })}
                          >
                            <Play aria-hidden="true" /> {t('screenPanel.play')}
                          </button>
                          <button
                            className="screen-button screen-button--secondary"
                            disabled={busy || !grant.control}
                            aria-label={t('screenPanel.delete', { title: media.title })}
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
                  <p>{t('screenPanel.videosPlayOneAfterAnother')}</p>
                </div>
                <div
                  id="media-panel-stream"
                  role="tabpanel"
                  aria-labelledby="media-tab-stream"
                  hidden={mediaTab !== 'stream'}
                  className="screen-medias-source"
                >
                  <h4>{t('screenPanel.yourRadios')}</h4>
                  <p>{t('screenPanel.findYourFavouritesOrSearch')}</p>
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
                      <span>{t('screenPanel.radioName')}</span>
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
                      {t('screenPanel.search')}
                    </button>
                  </form>
                  {radioResults.length > 0 && (
                    <div
                      className="screen-radio-results"
                      aria-label={t('screenPanel.searchResults')}
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
                      <h4>{t('screenPanel.myRadios')}</h4>
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
                                      ? t('screenPanel.playingAtS', { resident: snapshot.resident })
                                      : listenState === 'pending'
                                        ? t('screenPanel.startingOnTheTv')
                                        : listenState === 'paused'
                                          ? t('screenPanel.paused')
                                          : t('screenPanel.savedRadio')}
                                  </small>
                                </span>
                                <MediaPlaybackButton
                                  state={listenState}
                                  disabled={!snapshot.online || busy || !!state.call}
                                  onClick={() => void command('play', { mediaId: media.id })}
                                />
                                <button
                                  className="screen-icon-button"
                                  aria-label={t('screenPanel.remove', { title: media.title })}
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
                    <p className="screen-empty-library">{t('screenPanel.searchForARadioTo')}</p>
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
                  <p>{t('screenPanel.searchForAShowBrowse')}</p>
                  <form
                    className="screen-radio-search screen-podcast-search screen-media-search-panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      searchPodcasts();
                    }}
                  >
                    <label>
                      <span>{t('screenPanel.nameOfAShowOr')}</span>
                      <div>
                        <Search aria-hidden="true" />
                        <input
                          value={podcastQuery}
                          maxLength={80}
                          placeholder={t('screenPanel.bbcHistoryMusic')}
                          onChange={(event) => setPodcastQuery(event.target.value)}
                        />
                      </div>
                    </label>
                    <button
                      type="submit"
                      className="screen-button screen-button--primary"
                      disabled={busy || podcastQuery.trim().length < 2}
                    >
                      {t('screenPanel.search')}
                    </button>
                  </form>
                  {podcastResults.length > 0 && (
                    <div
                      className="screen-radio-results screen-podcast-results"
                      aria-label={t('screenPanel.podcastResults')}
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
                                {podcast.author || t('screenPanel.unknownAuthor')}
                                {podcast.episodeCount
                                  ? ` · ${podcast.episodeCount} ${t('screenPanel.episodes')}`
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
                                {t('screenPanel.episodes2')}
                              </button>
                              <button
                                type="button"
                                className="screen-button screen-button--primary"
                                disabled={busy || followed}
                                onClick={() => void followPodcast(podcast)}
                              >
                                {followed ? t('screenPanel.following') : t('screenPanel.follow')}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {podcastSearchDone && podcastResults.length === 0 && (
                    <p className="screen-empty-library">
                      {t('screenPanel.noPodcastsFoundForThis')}
                    </p>
                  )}
                  {podcastSearchLoading && (
                    <p className="screen-empty-library">{t('screenPanel.searchingPodcasts')}</p>
                  )}
                  {podcastSubscriptions.length > 0 && (
                    <div className="screen-radio-favorites screen-podcast-library screen-media-library-panel">
                      <h4>{t('screenPanel.myPodcasts')}</h4>
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
                                    ? t('screenPanel.episodePaused')
                                    : t('screenPanel.nowPlaying')
                                  : podcast.author || t('screenPanel.followedPodcast')}
                              </small>
                            </span>
                            <button
                              type="button"
                              className="screen-button screen-button--secondary"
                              disabled={busy}
                              onClick={() => openPodcastEpisodes(podcast)}
                            >
                              {t('screenPanel.episodes2')}
                            </button>
                            <button
                              type="button"
                              className="screen-icon-button"
                              aria-label={t('screenPanel.removeFromMyPodcasts', {
                                title: podcast.title,
                              })}
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
                      aria-label={t('screenPanel.podcastEpisodes')}
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
                        <p className="screen-empty-library">{t('screenPanel.loadingEpisodes')}</p>
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
                                      .join(' · ') || t('screenPanel.episode')}
                                    {listenState !== 'idle' &&
                                      ` · ${listenState === 'playing' ? t('screenPanel.playing') : listenState === 'pending' ? t('screenPanel.starting2') : t('screenPanel.paused')}`}
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
                          {t('screenPanel.noAudioEpisodesAvailableFor')}
                        </p>
                      )}
                    </section>
                  )}
                  {!podcastResults.length &&
                    !podcastSubscriptions.length &&
                    !podcastSearchDone &&
                    !podcastSearchLoading &&
                    !podcastQuery.trim() && (
                      <p className="screen-empty-library">{t('screenPanel.searchForAShowOr')}</p>
                    )}
                </div>
              </div>
            </div>
            {mediaTab === 'tv' && (
              <section className="screen-tv-guide" aria-labelledby="screen-tv-guide-title">
                <div className="screen-tv-guide__heading">
                  <h4 id="screen-tv-guide-title">
                    <CalendarClock aria-hidden="true" /> {t('screenPanel.tvGuide')}
                  </h4>
                  <span>{t('screenPanel.onNowAndNext')}</span>
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
                                  ? t('screenPanel.onNow')
                                  : next
                                    ? t('screenPanel.comingUp')
                                    : t('screenPanel.programme')}
                                {current && <time>{tvGuideRange(current)}</time>}
                              </span>
                              <strong>
                                {current?.title ??
                                  next?.title ??
                                  t('screenPanel.programmeUnavailable')}
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
                                  {t('screenPanel.next2')} <time>{tvGuideRange(next)}</time>
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
                      ? t('screenPanel.tvGuideTemporarilyUnavailableRetrieval')
                      : t('screenPanel.fetchingTheTvGuideAutomatically')}
                  </p>
                )}
                <p className="screen-tv-guide__source">
                  {tvGuide?.stale
                    ? `${t('screenPanel.lastGuideReceivedAt')} ${tvGuideTime(tvGuide.retrievedAt)} · `
                    : t('screenPanel.guideRefreshedAutomatically')}
                  <a href="https://www.xmltvfr.fr/xmltv.php" target="_blank" rel="noreferrer">
                    {t('screenPanel.sourceXmltvFrance')} <ExternalLink aria-hidden="true" />
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
                <h3>{t('screenPanel.photoAlbum')}</h3>
                <p>{t('screenPanel.eachPhotoIsShownIn')}</p>
              </div>
            </div>
            <div className="screen-album-editor">
              <h4>{t('screenPanel.addAPhoto')}</h4>
              <div className="screen-photo-form">
                <label className="screen-upload">
                  <Upload aria-hidden="true" />
                  <span>
                    <strong>{photo ? photo.name : t('screenPanel.chooseAPhoto')}</strong>
                    <small>{t('screenPanel.jpgPngOrWebp100')}</small>
                  </span>
                  <input
                    aria-label={t('screenPanel.chooseAPhoto')}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setPhoto(event.target.files?.[0])}
                  />
                </label>
                <label className="screen-photo-caption">
                  <span>{t('screenPanel.captionUnderThePhotoOptional')}</span>
                  <div
                    className="screen-emoji-picker screen-photo-emojis"
                    aria-label={t('screenPanel.addAnEmojiToThe')}
                  >
                    {messageEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={t('screenPanel.addToTheCaption', { emoji })}
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
                    placeholder={t('screenPanel.addACaption')}
                  />
                  <small>{photoCaption.length}/120</small>
                </label>
              </div>
              <div className={`screen-photo-scheduling${photoScheduleAt ? ' is-active' : ''}`}>
                <span className="screen-schedule-control__icon">
                  <CalendarClock aria-hidden="true" />
                </span>
                <label>
                  <span>{t('screenPanel.showThisPhotoLater')}</span>
                  <input
                    type="datetime-local"
                    value={photoScheduleAt}
                    onChange={(event) => setPhotoScheduleAt(event.target.value)}
                  />
                </label>
                <p>
                  {photoScheduleAt
                    ? t('screenPanel.thePhotoWillBeAdded')
                    : t('screenPanel.leaveEmptyToSimplyAdd')}
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
                      if (!response.ok) throw new Error(t('screenPanel.uploadFailed100MbMaximum'));
                      const uploaded = (await response.json()) as ScreenSnapshot;
                      const media = uploaded.state.media.at(-1);
                      if (!media || media.kind !== 'photo')
                        throw new Error(t('screenPanel.photoNotFoundAfterThe'));
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
                    ? t('screenPanel.scheduleThePhoto')
                    : t('screenPanel.addToTheAlbum')}
                </button>
              </div>
            </div>
            <div className="screen-album-library">
              <h4>{t('screenPanel.sAlbum', { residentFirstName })}</h4>
              <div className="screen-slideshow-setting">
                <Timer aria-hidden="true" />
                <label>
                  <span>{t('screenPanel.timePerPhoto')}</span>
                  <select
                    value={settings.slideshowSeconds ?? 15}
                    onChange={(event) =>
                      setSettings({ ...settings, slideshowSeconds: Number(event.target.value) })
                    }
                  >
                    <option value={5}>{t('screenPanel.n5Seconds')}</option>
                    <option value={10}>{t('screenPanel.n10Seconds')}</option>
                    <option value={15}>{t('screenPanel.n15Seconds')}</option>
                    <option value={30}>{t('screenPanel.n30Seconds')}</option>
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
                  {t('screenPanel.save')}
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
                          <small>{t('screenPanel.albumPhoto')}</small>
                        </span>
                        <button
                          className="screen-button screen-button--secondary"
                          disabled={!snapshot.online}
                          onClick={() => void command('play', { mediaId: media.id })}
                        >
                          <Play /> {t('screenPanel.show')}
                        </button>
                        <button
                          className="screen-icon-button"
                          aria-label={t('screenPanel.remove', { title: media.title })}
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
                <p className="screen-empty-library">{t('screenPanel.noPhotosAddedYet')}</p>
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
              <strong>{t('screenPanel.activityTracking')}</strong>
              <small>
                {t('screenPanel.historyOfActionsSentTo', { resident: snapshot.resident })}
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
                {t('screenPanel.actionsToday')}
              </span>
              <span className="is-success">
                <CircleCheck aria-hidden="true" />{' '}
                {(state.activity ?? []).filter((item) => item.status === 'applied').length}{' '}
                {t('screenPanel.confirmed')}
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
                  {t('screenPanel.unsuccessful')}
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
                        ? t('screenPanel.confirmed2')
                        : item.status === 'pending'
                          ? t('screenPanel.inProgress')
                          : item.status === 'expired'
                            ? t('screenPanel.expired')
                            : t('screenPanel.failed');
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
              <p className="screen-empty-library">{t('screenPanel.theNextActionsSentTo')}</p>
            )}
          </div>
        </details>
      </section>
    </section>
  );
}
