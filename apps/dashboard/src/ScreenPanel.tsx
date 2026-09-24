import {
  appointmentPictograms,
  ARTE_LIVE_URL,
  RMC_DECOUVERTE_LIVE_URL,
  RMC_LIFE_LIVE_URL,
  RMC_STORY_LIVE_URL,
  youtubeVideoId,
} from '@michel/contracts';
import { subscribeScreenEvents } from './screen-events';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScreenSnapshot, ScreenJoin, ScreenSettings } from '@michel/contracts';
import {
  Activity,
  CalendarClock,
  Camera,
  ChevronRight,
  CircleCheck,
  CircleX,
  ExternalLink,
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
const favoriteMessages = [
  { emoji: '☀️', label: 'Bonne journée', message: 'Bonne journée ! On pense fort à toi ❤️' },
  {
    emoji: '📅',
    label: 'Rendez-vous',
    message: 'N’oublie pas ton rendez-vous. Tout est bien prévu 😊',
  },
  { emoji: '🏡', label: 'On arrive bientôt', message: 'On arrive bientôt ! À tout de suite 👋' },
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
    brand: 'arte',
  },
  {
    url: RMC_LIFE_LIVE_URL,
    mediaTitle: 'RMC Life en direct',
    name: 'RMC Life',
    description: 'Séries, films et divertissement.',
    brand: 'rmc-life',
    brandLabel: 'RMC',
  },
  {
    url: RMC_STORY_LIVE_URL,
    mediaTitle: 'RMC Story en direct',
    name: 'RMC Story',
    description: 'Séries, fiction et divertissement.',
    brand: 'rmc-story',
    brandLabel: 'RMC',
  },
  {
    url: RMC_DECOUVERTE_LIVE_URL,
    mediaTitle: 'RMC Découverte en direct',
    name: 'RMC Découverte',
    description: 'Documentaires et découverte.',
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
    throw new Error(b.message ?? `Erreur ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function startResidentScreenCall(): Promise<void> {
  const snapshot = await screenRequest<ScreenSnapshot>('screen', undefined, 'GET');
  if (!snapshot.grant.call) throw new Error('Vous ne pouvez pas appeler cet écran.');
  if (!snapshot.online) throw new Error('L’écran est hors ligne.');
  if (!snapshot.state.settings.consent)
    throw new Error('Le consentement aux appels est désactivé.');
  if (snapshot.state.call) throw new Error('Un appel est déjà en cours.');
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
        reject(new Error('Jitsi est inaccessible.'));
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
      <button onClick={onEnd}>Raccrocher</button>
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
        aria-label={`Visioconférence avec ${resident}`}
      >
        <header className="screen-call-window__header">
          <div className="screen-call-window__identity">
            <span className="screen-call-window__icon" aria-hidden="true">
              <Video />
            </span>
            <div>
              <p>VISIO EN DIRECT</p>
              <h2>Appel avec {resident}</h2>
              <span>Vous participez en tant que {join.name}</span>
            </div>
          </div>
          <span className="screen-call-window__status">
            <i aria-hidden="true" /> Appel en cours
          </span>
          <button
            type="button"
            className="screen-call-window__hangup"
            onClick={onEnd}
            aria-label={`Raccrocher l’appel avec ${resident}`}
          >
            <Phone aria-hidden="true" />
            Raccrocher
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
}: {
  initialSection?: 'call' | 'messages' | 'display' | 'photos' | 'planning';
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
      planning: '.screen-agenda-summary',
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
  const [mediaTab, setMediaTab] = useState<'youtube' | 'tv' | 'stream'>('tv');
  const [selectedMainTab, setSelectedMainTab] = useState<ScreenMainTab>(
    initialSection === 'messages' ? 'messages' : 'album',
  );
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const volumeTimer = useRef<number | undefined>(undefined);
  const [playlistTitle, setPlaylistTitle] = useState('Mes vidéos');
  const [playlistLinks, setPlaylistLinks] = useState('');
  const [radioQuery, setRadioQuery] = useState('');
  const [radioResults, setRadioResults] = useState<RadioStation[]>([]);
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
    if (call?.acceptedAt && call.userId === snapshot?.userId && !join)
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
  const connectYouTube = () => {
    setError('');
    const popup = window.open(
      '/api/v1/screen/youtube/connect',
      'elise-youtube-connect',
      'popup,width=520,height=720,resizable=yes,scrollbars=yes',
    );
    if (!popup)
      setError('La fenêtre Google a été bloquée. Autorisez les fenêtres popup puis réessayez.');
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
      <section className="screen-panel">
        <h2>Écran et appels</h2>
        <p>{error || 'Chargement…'}</p>
      </section>
    );
  const { state, grant } = snapshot;
  const activeMedia = state.media.find(
    (media) =>
      ['stream', 'tv', 'youtube'].includes(media.kind) && media.id === state.playback.mediaId,
  );
  const MediaIcon =
    activeMedia?.kind === 'youtube' ? Youtube : activeMedia?.kind === 'tv' ? Tv : Radio;
  const mediaType =
    activeMedia?.kind === 'youtube'
      ? 'YouTube'
      : activeMedia?.kind === 'tv'
        ? activeMedia.title
        : 'Radio';
  const mediaPending = state.commands.some(
    (command) =>
      command.status === 'pending' &&
      command.revision === state.playback.revision &&
      ['play', 'resume', 'next'].includes(command.action),
  );
  const mediaStatus = !snapshot.online
    ? 'TV hors ligne'
    : state.call
      ? 'Interrompu pendant l’appel'
      : state.playback.asleep
        ? 'TV au repos'
        : state.playback.paused
          ? 'En pause'
          : mediaPending
            ? 'Lancement sur la TV…'
            : 'En cours de lecture';
  const mediaRunning =
    snapshot.online &&
    !state.call &&
    !state.playback.asleep &&
    !state.playback.paused &&
    !mediaPending;

  const status = snapshot.online
    ? state.call
      ? 'En communication'
      : state.playback.asleep
        ? 'Au repos'
        : 'Écran connecté'
    : snapshot.paired
      ? 'Écran hors ligne'
      : 'Écran en préparation';
  const cecFresh =
    typeof tvHost?.cec?.updatedAt === 'number' && Date.now() / 1000 - tvHost.cec.updatedAt < 45;
  const cecReady =
    cecFresh &&
    tvHost?.cec?.tvAcknowledged === true &&
    (state.playback.asleep
      ? tvHost.cec.asleepRequested === true
      : tvHost.cec.activeSourceSent === true);
  const cecLabel = cecReady
    ? 'CEC opérationnel'
    : tvHost?.cec?.detected
      ? 'CEC à vérifier'
      : tvHost?.installed
        ? 'CEC non détecté'
        : 'Agent TV absent';
  const display = tvHost?.display;
  const displayUpdatedAt = display?.updatedAt;
  const displayStatusFresh =
    typeof displayUpdatedAt === 'number' && Date.now() / 1000 - displayUpdatedAt < 60;
  const videoOutputReady = displayStatusFresh && Boolean(display?.selected && display?.mode);
  const connectedOutputs = display?.connected ?? [];
  const videoOutputLabel = !tvHost?.installed
    ? 'Agent vidéo absent'
    : !displayStatusFresh
      ? 'État HDMI indisponible'
      : videoOutputReady
        ? `Sortie ${display?.selected} · ${display?.mode}`
        : connectedOutputs.length > 0
          ? `${connectedOutputs.join(', ')} détectée sans mode actif`
          : 'Aucune sortie vidéo détectée';
  const selectedNetworkTv = tvHost?.networkTv?.id ? tvHost.networkTv : undefined;
  const networkStatusFresh =
    typeof tvHost?.networkTvStatus?.updatedAt === 'number' &&
    Date.now() / 1000 - tvHost.networkTvStatus.updatedAt < 30;
  const networkReachable = networkStatusFresh && tvHost?.networkTvStatus?.reachable === true;
  const networkControlReady =
    selectedNetworkTv && (networkReachable || tvHost?.homeAssistantTv?.available === true);
  const networkControlLabel = !selectedNetworkTv
    ? 'TV réseau non associée'
    : networkReachable
      ? `Réseau : ${selectedNetworkTv.name} joignable`
      : tvHost?.homeAssistantTv?.available
        ? `Secours Home Assistant : ${selectedNetworkTv.name}`
        : `Réseau : ${selectedNetworkTv.name} en veille`;
  const redundantTvControl =
    cecReady &&
    Boolean(selectedNetworkTv) &&
    Boolean(selectedNetworkTv?.mac || selectedNetworkTv?.homeAssistantEntityId);
  const residentFirstName = snapshot.resident.trim().split(/\s+/)[0] || snapshot.resident;
  const mainTabs = (
    [
      { id: 'album', label: 'Album photo', icon: Image, allowed: grant.control },
      { id: 'messages', label: 'Messages', icon: MessageSquareText, allowed: grant.message },
      { id: 'medias', label: 'Médias', icon: Tv, allowed: grant.control },
      { id: 'activity', label: 'Suivi de l’activité', icon: Activity, allowed: true },
    ] as const
  ).filter((tab) => tab.allowed);
  const activeMainTab = mainTabs.some((tab) => tab.id === selectedMainTab)
    ? selectedMainTab
    : mainTabs[0]?.id;
  const currentContentLabel = state.call
    ? 'Appel en cours'
    : state.playback.asleep
      ? 'TV au repos'
      : (activeMedia?.title ?? 'Écran d’accueil');
  return (
    <section className="screen-panel">
      <header className="screen-panel__hero">
        <div className="screen-panel__identity">
          <div>
            <p className="screen-panel__eyebrow">AFFICHAGE RÉSIDENT</p>
            <h2>Écran et appels</h2>
            <span className={`screen-status ${snapshot.online ? 'is-online' : 'is-offline'}`}>
              {snapshot.online ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
              {status}
            </span>
          </div>
        </div>
        <div className="screen-panel__hero-side">
          <div className="screen-panel__hero-actions">
            <a
              className="screen-button screen-button--secondary"
              href="/resident-screen"
              target="_blank"
              rel="noreferrer"
            >
              Voir l’écran <ExternalLink aria-hidden="true" />
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
                <Power aria-hidden="true" /> Reprendre la TV
              </button>
            )}
            {grant.call && (
              <button
                className="screen-button screen-button--call"
                disabled={busy || !snapshot.online || !!call || !state.settings.consent}
                onClick={() => void run(() => screenRequest('screen/calls'))}
              >
                <Phone aria-hidden="true" /> Appeler {residentFirstName}
              </button>
            )}
          </div>
          {(grant.administer || grant.control) && (
            <div className="screen-capabilities" aria-label="État des équipements de l’écran">
              <span className={snapshot.capabilities.camera ? 'is-ready' : ''}>
                <Camera aria-hidden="true" />
                Caméra {snapshot.capabilities.camera ? 'prête' : 'à tester'}
              </span>
              <span className={snapshot.capabilities.microphone ? 'is-ready' : ''}>
                <Mic aria-hidden="true" />
                Micro {snapshot.capabilities.microphone ? 'prêt' : 'à tester'}
              </span>
              <span className={snapshot.online ? 'is-ready' : ''}>
                <Tv aria-hidden="true" />
                Navigateur kiosque {snapshot.online ? 'connecté' : 'à vérifier'}
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
                {redundantTvControl ? 'Voies de reprise configurées' : 'Reprise TV à vérifier'}
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
      <div className="screen-live-status" aria-label="État de la TV et de la lecture">
        <section className="screen-tv-now" aria-label="Sur la TV maintenant">
          <span className="screen-tv-now__title">
            <Tv aria-hidden="true" />
            <strong>Sur la TV maintenant</strong>
          </span>
          <span className="screen-tv-now__device">
            {selectedNetworkTv?.name ?? 'TV non associée'}
            {selectedNetworkTv && <small>Associée</small>}
          </span>
          <span className={`screen-tv-now__online ${snapshot.online ? 'is-online' : ''}`}>
            {snapshot.online ? 'En ligne' : 'Hors ligne'}
          </span>
          {!activeMedia && <span className="screen-tv-now__content">{currentContentLabel}</span>}
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
              Oublier cette TV
            </button>
          )}
        </section>
        <section
          className="screen-playback-now"
          aria-label="Lecture et son sur la TV"
          aria-live="polite"
        >
          <span
            className={`screen-playback-now__dot ${activeMedia && mediaRunning ? 'is-live' : ''}`}
          />
          <span className="screen-playback-now__icon">
            {activeMedia ? <MediaIcon aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </span>
          <span className="screen-playback-now__copy">
            <small>{activeMedia ? mediaStatus : 'Son de la TV'}</small>
            <strong>{activeMedia?.title ?? 'Aucun média en cours'}</strong>
          </span>
          {activeMedia && (
            <div className="screen-playback-now__controls">
              <span className="screen-playback-now__type">{mediaType}</span>
              <button
                type="button"
                aria-label={
                  state.playback.paused || state.playback.asleep ? 'Reprendre' : 'Mettre en pause'
                }
                title={
                  state.playback.paused || state.playback.asleep ? 'Reprendre' : 'Mettre en pause'
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
              {activeMedia.kind === 'youtube' && (
                <button
                  type="button"
                  aria-label="Suivant"
                  title="Suivant"
                  disabled={busy || !snapshot.online || !!state.call}
                  onClick={() => void command('next')}
                >
                  <SkipForward aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                aria-label="Arrêter la lecture"
                title="Arrêter la lecture"
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
              <span className="screen-visually-hidden">Volume de la TV</span>
              <input
                type="range"
                min="0"
                max="100"
                aria-label="Volume de la TV"
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
              <h3>TV sur le réseau local</h3>
              <p>
                Le Raspberry Pi peut être en Ethernet et la TV en Wi-Fi : ils doivent simplement
                partager le même réseau local.
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
                    ? 'TV joignable sur le réseau local.'
                    : 'TV en veille ou non joignable : le réveil réseau reste surveillé.'}
                  {selectedNetworkTv.homeAssistantEntityId
                    ? ' Secours Home Assistant associé.'
                    : ''}
                </small>
              </div>
            ) : (
              <p>Aucune TV du réseau local n’est encore associée.</p>
            )}
            <div className="screen-network-tv-actions">
              <button
                className="screen-button screen-button--secondary"
                disabled={busy}
                onClick={() => void scanLocalTvs()}
              >
                <Search aria-hidden="true" /> Rechercher les TV
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
                          ? 'Commande Home Assistant disponible en secours.'
                          : device.mac
                            ? 'Réveil réseau disponible si la TV l’autorise.'
                            : 'Adresse MAC non annoncée : le CEC assurera le réveil.'}
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
                        ? 'Associée'
                        : addsHomeAssistant || addsMergedHomeAssistant
                          ? 'Ajouter en secours'
                          : addsNetwork || addsMergedNetwork
                            ? 'Ajouter le réseau'
                            : 'Associer'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {tvScanDone && discoveredTvs.length === 0 && (
            <p className="screen-empty-library">
              Aucune TV n’a répondu. Vérifiez qu’elle est allumée et que le routeur n’isole pas les
              appareils du réseau local, puis relancez la recherche.
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
            <strong>{call.acceptedAt ? 'Appel en cours' : `Appel de ${call.name}…`}</strong>
            {call.userId === snapshot.userId && (
              <button
                onClick={() =>
                  void run(() => screenRequest(`screen/calls/${call.id}`, undefined, 'DELETE'))
                }
              >
                Annuler l’appel
              </button>
            )}
          </div>
        )
      )}
      {mainTabs.length > 0 && (
        <div className="screen-main-tabs" role="tablist" aria-label="Sections de l’écran">
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
              <h3>Message sur la TV</h3>
              <p>
                Vos messages restent au premier plan et se succèdent dans le grand bandeau
                supérieur.
              </p>
            </div>
          </div>
          <div className="screen-message-favorites">
            <span>Messages favoris</span>
            <div>
              {favoriteMessages.map((favorite) => (
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
          <div className="screen-message-tabs" aria-label="Messages à afficher">
            {messages.map((text, index) => (
              <button
                key={index}
                type="button"
                className="screen-button screen-button--secondary"
                aria-pressed={index === messageIndex}
                onClick={() => setMessageIndex(index)}
              >
                Message {index + 1}
                {text.trim() ? '' : ' · vide'}
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
              + Ajouter un message
            </button>
          </div>
          <div className="screen-emoji-picker" aria-label="Ajouter un émoji">
            {messageEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Ajouter ${emoji}`}
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
              placeholder={`Bonne journée ${snapshot.resident} ! On pense fort à toi ❤️`}
            />
          </label>
          <div className="screen-message-timing">
            <label>
              <span>Durée de chaque message (secondes)</span>
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
                ? 'Les messages tournent en boucle, dans cet ordre.'
                : 'Ajoutez plusieurs messages pour activer la rotation.'}
            </small>
          </div>
          <div className={`screen-schedule-control${messageScheduleAt ? ' is-active' : ''}`}>
            <span className="screen-schedule-control__icon">
              <CalendarClock aria-hidden="true" />
            </span>
            <label>
              <span>Programmer pour plus tard</span>
              <input
                type="datetime-local"
                value={messageScheduleAt}
                onChange={(event) => setMessageScheduleAt(event.target.value)}
              />
            </label>
            <p>
              {messageScheduleAt
                ? `Affichage prévu ${new Date(messageScheduleAt).toLocaleString('fr-FR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Laissez vide pour afficher le message maintenant.'}
            </p>
            {messageScheduleAt && (
              <button
                type="button"
                className="screen-schedule-clear"
                onClick={() => setMessageScheduleAt('')}
              >
                Maintenant
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
                <Trash2 /> Retirer ce message
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
                <Trash2 /> Effacer
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
              {messageScheduleAt ? 'Programmer le message' : 'Afficher sur la TV'}
            </button>
          </div>
        </section>
      )}
      {grant.control && (
        <div className="screen-context-grid">
          {grant.control && (
            <section
              className="screen-card screen-context-card screen-agenda-summary"
              aria-labelledby="screen-agenda-summary-title"
            >
              <h3 id="screen-agenda-summary-title" className="screen-visually-hidden">
                Rendez-vous du jour
              </h3>
              {snapshot.agenda.length ? (
                <ul className="screen-appointment-list">
                  {snapshot.agenda.map((item) => (
                    <li key={item.id}>
                      {item.type === 'appointment' ? (
                        <span className="screen-appointment-pictogram" aria-hidden="true">
                          {appointmentPictograms.find((option) => option.value === item.pictogram)
                            ?.emoji ?? '📅'}
                        </span>
                      ) : (
                        <CalendarClock aria-hidden="true" />
                      )}
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {new Date(item.startsAt).toLocaleString('fr-FR', {
                            timeZone: snapshot.timezone,
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}
        </div>
      )}
      {(state.scheduledContent ?? []).length > 0 && (
        <section className="screen-card screen-scheduled-card">
          <div className="screen-card__heading">
            <span>
              <CalendarClock aria-hidden="true" />
            </span>
            <div>
              <h3>Prochaines diffusions</h3>
              <p>Messages et photos seront affichés automatiquement à l’heure prévue.</p>
            </div>
            <strong className="screen-scheduled-count">
              {state.scheduledContent?.length} programmé
              {(state.scheduledContent?.length ?? 0) > 1 ? 's' : ''}
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
                      {new Date(item.scheduledAt).toLocaleString('fr-FR', {
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
                    aria-label={`Annuler la programmation de ${item.title}`}
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
                <h3>Médias</h3>
                <p>Choisissez ce que {snapshot.resident} regarde ou écoute sur sa TV.</p>
              </div>
              <span className="screen-medias-device">
                <Tv aria-hidden="true" /> TV de {snapshot.resident}
              </span>
            </div>
            <section className="screen-tv-guide" aria-labelledby="screen-tv-guide-title">
              <div className="screen-tv-guide__heading">
                <h4 id="screen-tv-guide-title">
                  <CalendarClock aria-hidden="true" /> Programme TV
                </h4>
                <span>En ce moment et à suivre</span>
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
                              {current ? 'En cours' : next ? 'À venir' : 'Programme'}
                              {current && <time>{tvGuideRange(current)}</time>}
                            </span>
                            <strong>
                              {current?.title ?? next?.title ?? 'Programme indisponible'}
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
                                À suivre <time>{tvGuideRange(next)}</time>
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
                    ? 'Programme TV temporairement indisponible. La récupération reprend automatiquement.'
                    : 'Récupération automatique du programme TV…'}
                </p>
              )}
              <p className="screen-tv-guide__source">
                {tvGuide?.stale
                  ? `Dernière grille reçue à ${tvGuideTime.format(new Date(tvGuide.retrievedAt))} · `
                  : 'Grille actualisée automatiquement · '}
                <a href="https://www.xmltvfr.fr/xmltv.php" target="_blank" rel="noreferrer">
                  Source XMLTV France <ExternalLink aria-hidden="true" />
                </a>
              </p>
            </section>
            <div className="screen-medias-layout">
              <div className="screen-medias-browser">
                <div className="screen-medias-tabs" role="tablist" aria-label="Sources médias">
                  {(
                    [
                      ['youtube', 'YouTube', Youtube],
                      ['tv', 'TV', Tv],
                      ['stream', 'Radio', Radio],
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
                        const tabs = ['youtube', 'tv', 'stream'] as const;
                        const index = tabs.indexOf(kind);
                        const next =
                          event.key === 'ArrowRight'
                            ? tabs[(index + 1) % tabs.length]
                            : event.key === 'ArrowLeft'
                              ? tabs[(index + tabs.length - 1) % tabs.length]
                              : event.key === 'Home'
                                ? tabs[0]
                                : event.key === 'End'
                                  ? tabs[2]
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
                  <section className="screen-tv-channels" aria-label="Chaînes TV en direct">
                    {LIVE_TV_CHANNELS.map((channel) => (
                      <article className="screen-tv-channel" key={channel.url}>
                        <div className="screen-tv-channel__identity">
                          <span
                            className={`screen-tv-channel__brand screen-tv-channel__brand--${channel.brand}`}
                            aria-hidden="true"
                          >
                            {channel.brand === 'arte' ? 'arte' : channel.brandLabel}
                          </span>
                          <div>
                            <h4>{channel.mediaTitle}</h4>
                            <p>{channel.description}</p>
                          </div>
                          <span className="screen-media-live">Direct</span>
                        </div>
                        <button
                          className="screen-button"
                          disabled={busy || !grant.control || !snapshot.online}
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
                        >
                          <Play aria-hidden="true" /> Regarder {channel.name}
                        </button>
                      </article>
                    ))}
                  </section>
                  <p className="screen-tv-note">
                    Le direct peut être limité selon le pays et les droits du programme.
                  </p>
                </div>
                <div
                  id="media-panel-youtube"
                  role="tabpanel"
                  aria-labelledby="media-tab-youtube"
                  hidden={mediaTab !== 'youtube'}
                  className="screen-medias-source screen-playlist-card"
                >
                  <h4>Vos playlists YouTube</h4>
                  <p>Connectez votre compte Google pour retrouver vos playlists automatiquement.</p>
                  <div className="screen-youtube-account">
                    <span className="screen-youtube-account__logo">
                      <Youtube aria-hidden="true" />
                    </span>
                    <div className="screen-youtube-account__copy">
                      <strong>
                        {youtubeAccount?.connected
                          ? youtubeAccount.channelTitle || youtubeAccount.email || 'Compte connecté'
                          : 'Compte YouTube'}
                      </strong>
                      <small>
                        {youtubeAccount?.connected
                          ? youtubeAccount.email || 'Playlists personnelles disponibles'
                          : youtubeAccount?.configured
                            ? 'Vos playlists personnelles, en toute sécurité'
                            : 'Connexion à configurer par l’administrateur'}
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
                          Actualiser
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
                          Déconnecter
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="screen-button screen-button--primary"
                        disabled={busy || youtubeAccount?.configured === false}
                        onClick={connectYouTube}
                      >
                        Connecter Google
                      </button>
                    )}
                  </div>
                  {youtubeAccount?.configured === false && (
                    <p className="screen-youtube-hint">
                      L’administrateur doit renseigner les identifiants OAuth YouTube du NAS une
                      seule fois.
                    </p>
                  )}
                  {youtubeAccount?.connected && (
                    <div className="screen-youtube-cloud-playlists">
                      <div className="screen-youtube-cloud-heading">
                        <strong>Playlists de votre compte</strong>
                        <span>{youtubePlaylists.length} disponibles</span>
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
                                  <small>{playlist.itemCount} vidéo(s)</small>
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
                                    ? 'Chargement…'
                                    : imported
                                      ? 'Relancer'
                                      : 'Ajouter et lancer'}
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="screen-empty-library">
                          Aucune playlist disponible sur ce compte.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="screen-youtube-manual">
                    <strong>Ajouter des vidéos par lien</strong>
                    <p>Un lien par ligne, jusqu’à 50 vidéos.</p>
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
                            'Ajoutez entre 1 et 50 liens vidéo YouTube valides, un par ligne.',
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
                        Nom de la playlist
                        <input
                          value={playlistTitle}
                          maxLength={120}
                          required
                          onChange={(event) => setPlaylistTitle(event.target.value)}
                        />
                      </label>
                      <label>
                        Liens YouTube
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
                        Enregistrer la playlist
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
                              {media.playlistUrls?.length ?? 1} vidéo(s)
                              {state.playback.mediaId === media.id ? ' · Sélectionnée' : ''}
                            </small>
                          </div>
                          <button
                            className="screen-button"
                            disabled={busy || !grant.control || !snapshot.online}
                            onClick={() => void command('play', { mediaId: media.id })}
                          >
                            <Play aria-hidden="true" /> Lancer
                          </button>
                          <button
                            className="screen-button screen-button--secondary"
                            disabled={busy || !grant.control}
                            aria-label={`Supprimer ${media.title}`}
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
                    Les vidéos s’enchaînent automatiquement. Utilisez les commandes du lecteur pour
                    mettre en pause, reprendre ou passer à la suivante. Certaines vidéos peuvent
                    refuser la lecture intégrée.
                  </p>
                </div>
                <div
                  id="media-panel-stream"
                  role="tabpanel"
                  aria-labelledby="media-tab-stream"
                  hidden={mediaTab !== 'stream'}
                  className="screen-medias-source"
                >
                  <h4>Vos radios</h4>
                  <p>Retrouvez vos favoris ou recherchez une station.</p>
                  <form
                    className="screen-radio-search"
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
                      <span>Nom de la radio</span>
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
                      Rechercher
                    </button>
                  </form>
                  {radioResults.length > 0 && (
                    <div className="screen-radio-results" aria-label="Résultats de recherche">
                      {radioResults.map((station) => (
                        <article key={`${station.id}-${station.url}`}>
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
                          <button
                            type="button"
                            className="screen-button screen-button--primary"
                            disabled={busy || !snapshot.online}
                            onClick={() => void listenToRadio(station)}
                          >
                            <Play aria-hidden="true" /> Écouter
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                  {state.media.some((media) => media.kind === 'stream') ? (
                    <div className="screen-radio-favorites">
                      <h4>Mes radios</h4>
                      <ul className="screen-library">
                        {state.media
                          .filter((media) => media.kind === 'stream')
                          .map((media) => (
                            <li
                              key={media.id}
                              className={state.playback.mediaId === media.id ? 'is-playing' : ''}
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
                                  {state.playback.mediaId === media.id
                                    ? state.playback.paused
                                      ? 'En pause'
                                      : `Diffusée chez ${snapshot.resident}`
                                    : 'Radio enregistrée'}
                                </small>
                              </span>
                              <button
                                className="screen-button screen-button--secondary"
                                disabled={!snapshot.online || busy}
                                onClick={() => void command('play', { mediaId: media.id })}
                              >
                                <Play aria-hidden="true" /> Écouter
                              </button>
                              <button
                                className="screen-icon-button"
                                aria-label={`Retirer ${media.title}`}
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
                    </div>
                  ) : radioResults.length === 0 ? (
                    <p className="screen-empty-library">Recherchez une radio pour commencer.</p>
                  ) : null}
                </div>
              </div>
            </div>
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
                <h3>Album photo</h3>
                <p>Chaque photo défile avec son commentaire affiché en dessous.</p>
              </div>
            </div>
            <div className="screen-album-editor">
              <h4>Ajouter une photo</h4>
              <div className="screen-photo-form">
                <label className="screen-upload">
                  <Upload aria-hidden="true" />
                  <span>
                    <strong>{photo ? photo.name : 'Choisir une photo'}</strong>
                    <small>JPG, PNG ou WebP · 100 Mo maximum</small>
                  </span>
                  <input
                    aria-label="Choisir une photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setPhoto(event.target.files?.[0])}
                  />
                </label>
                <label className="screen-photo-caption">
                  <span>Commentaire sous la photo (facultatif)</span>
                  <div
                    className="screen-emoji-picker screen-photo-emojis"
                    aria-label="Ajouter un émoji au commentaire"
                  >
                    {messageEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={`Ajouter ${emoji} au commentaire`}
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
                    placeholder="Ajouter un commentaire…"
                  />
                  <small>{photoCaption.length}/120</small>
                </label>
              </div>
              <div className={`screen-photo-scheduling${photoScheduleAt ? ' is-active' : ''}`}>
                <span className="screen-schedule-control__icon">
                  <CalendarClock aria-hidden="true" />
                </span>
                <label>
                  <span>Afficher cette photo plus tard</span>
                  <input
                    type="datetime-local"
                    value={photoScheduleAt}
                    onChange={(event) => setPhotoScheduleAt(event.target.value)}
                  />
                </label>
                <p>
                  {photoScheduleAt
                    ? 'La photo sera ajoutée à l’album et affichée automatiquement.'
                    : 'Laissez vide pour simplement ajouter la photo à l’album.'}
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
                      if (!response.ok) throw new Error('Envoi impossible (100 Mo maximum).');
                      const uploaded = (await response.json()) as ScreenSnapshot;
                      const media = uploaded.state.media.at(-1);
                      if (!media || media.kind !== 'photo')
                        throw new Error('Photo introuvable après l’envoi.');
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
                  {photoScheduleAt ? 'Programmer la photo' : 'Ajouter à l’album'}
                </button>
              </div>
            </div>
            <div className="screen-album-library">
              <h4>Album de {residentFirstName}</h4>
              <div className="screen-slideshow-setting">
                <Timer aria-hidden="true" />
                <label>
                  <span>Temps par photo</span>
                  <select
                    value={settings.slideshowSeconds ?? 15}
                    onChange={(event) =>
                      setSettings({ ...settings, slideshowSeconds: Number(event.target.value) })
                    }
                  >
                    <option value={5}>5 secondes</option>
                    <option value={10}>10 secondes</option>
                    <option value={15}>15 secondes</option>
                    <option value={30}>30 secondes</option>
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
                  Enregistrer
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
                          <small>Photo de l’album</small>
                        </span>
                        <button
                          className="screen-button screen-button--secondary"
                          disabled={!snapshot.online}
                          onClick={() => void command('play', { mediaId: media.id })}
                        >
                          <Play /> Afficher
                        </button>
                        <button
                          className="screen-icon-button"
                          aria-label={`Retirer ${media.title}`}
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
                <p className="screen-empty-library">Aucune photo ajoutée pour le moment.</p>
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
              <strong>Suivi de l’activité</strong>
              <small>Historique des actions envoyées chez {snapshot.resident}.</small>
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
                actions aujourd’hui
              </span>
              <span className="is-success">
                <CircleCheck aria-hidden="true" />{' '}
                {(state.activity ?? []).filter((item) => item.status === 'applied').length}{' '}
                confirmées
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
                  non abouties
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
                        ? 'Confirmée'
                        : item.status === 'pending'
                          ? 'En cours'
                          : item.status === 'expired'
                            ? 'Expirée'
                            : 'Échec';
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
                            {new Date(item.createdAt).toLocaleString('fr-FR', {
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
                Les prochaines actions envoyées à l’écran apparaîtront ici.
              </p>
            )}
          </div>
        </details>
      </section>
    </section>
  );
}
