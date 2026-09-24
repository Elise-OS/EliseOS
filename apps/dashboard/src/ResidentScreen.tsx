import { appointmentPictograms } from '@michel/contracts';
import { residentMessageAt } from './resident-messages';
import { ResidentVideo, type VideoStatus } from './ResidentVideo';
import { subscribeScreenEvents } from './screen-events';
import { advanceScreenSchedule } from '@michel/contracts';
import {
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Image as ImageIcon,
  Radio,
  Sun,
  Stethoscope,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenSnapshot, ScreenJoin, ScreenMedia } from '@michel/contracts';
import { JitsiFrame, screenRequest } from './ScreenPanel';
import './screen.css';
const key = 'elise-screen-token';
export function hasPhysicalMicrophone(devices: MediaDeviceInfo[]): boolean {
  return devices.some((device) => {
    if (device.kind !== 'audioinput' || /^(default|communications)$/i.test(device.deviceId))
      return false;
    const label = device.label.trim();
    if (!label || /monitor|loopback|stereo mix/i.test(label)) return false;
    return /usb|webcam|camera|microphone|\bmic\b/i.test(label);
  });
}
if ('serviceWorker' in navigator && window.isSecureContext)
  void navigator.serviceWorker.register('/screen-sw.js').catch(() => undefined);
const bootstrapToken = new URLSearchParams(location.hash.slice(1)).get('token');
if (bootstrapToken && /^[a-f0-9]{64}$/.test(bootstrapToken)) {
  localStorage.setItem(key, bootstrapToken);
  history.replaceState(null, '', location.pathname);
}
async function cachedMedia(media: ScreenMedia, token?: string) {
  const cache = await caches.open('elise-screen-media-v1');
  const url = token ? media.url.replace('/screen-media/', '/screen-device/media/') : media.url;
  const cacheKey = `${location.origin}/screen-cache/${token?.slice(0, 12) ?? 'session'}/${media.id}`;
  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(url, token ? { headers: { 'x-screen-token': token } } : undefined);
    if (!response.ok) throw new Error('Contenu indisponible');
    await cache.put(cacheKey, response.clone());
  }
  return URL.createObjectURL(await response.blob());
}
export interface TVNotification {
  type:
    | 'incoming_call'
    | 'medication_reminder'
    | 'family_message'
    | 'water_leak'
    | 'door_alert'
    | 'custom_notification';
  title: string;
  message?: string;
  icon?: ReactNode;
  image?: string;
  priority: 'normal' | 'high' | 'urgent';
  duration?: number;
}

export function TVNotificationOverlay({
  notification,
  onClose,
}: {
  notification: TVNotification | null;
  onClose?: () => void;
}) {
  useEffect(() => {
    if (!notification?.duration || !onClose) return;
    const timer = window.setTimeout(onClose, notification.duration);
    return () => window.clearTimeout(timer);
  }, [notification, onClose]);
  if (!notification) return null;
  return (
    <section
      className={`tv-notification tv-notification--${notification.priority}`}
      role="alert"
      aria-live="assertive"
    >
      {notification.image && <img src={notification.image} alt="" />}
      <div className="tv-notification-icon">{notification.icon ?? <BellRing />}</div>
      <h1>{notification.title}</h1>
      {notification.message && <p>{notification.message}</p>}
    </section>
  );
}

export function callerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase('fr-FR') ?? '')
      .join('') || 'É'
  );
}

export function startIncomingCallRingtone(): () => void {
  if (typeof window === 'undefined' || !window.AudioContext) return () => undefined;
  let context: AudioContext;
  try {
    context = new window.AudioContext();
  } catch {
    return () => undefined;
  }
  const master = context.createGain();
  const startAt = context.currentTime;
  // Keep the TV's general volume tuned for radio, but make the call alert itself
  // clearly audible from its first ring and let it strengthen gently.
  master.gain.setValueAtTime(0.58, startAt);
  master.gain.exponentialRampToValueAtTime(0.9, startAt + 5);
  master.connect(context.destination);
  let stopped = false;
  let timer: number | undefined;
  const ring = () => {
    if (stopped) return;
    const now = context.currentTime + 0.02;
    for (const delay of [0, 0.5]) {
      for (const frequency of [440, 480]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, now + delay);
        envelope.gain.setValueAtTime(0.0001, now + delay);
        envelope.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.055);
        envelope.gain.setValueAtTime(0.25, now + delay + 0.3);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.42);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(now + delay);
        oscillator.stop(now + delay + 0.44);
      }
    }
    timer = window.setTimeout(ring, 2400);
  };
  const begin = () => {
    if (!stopped) ring();
  };
  if (context.state === 'suspended')
    void context
      .resume()
      .then(begin)
      .catch(() => undefined);
  else begin();
  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    master.disconnect();
    void context.close().catch(() => undefined);
  };
}

export function IncomingCallOverlay({
  callId,
  callerName,
  automatic,
}: {
  callId: string;
  callerName: string;
  automatic: boolean;
}) {
  useEffect(() => startIncomingCallRingtone(), [callId]);
  return (
    <section
      className="incoming-call-screen"
      role="alert"
      aria-live="assertive"
      aria-label={`${callerName} vous appelle`}
    >
      <div className="incoming-call-screen__glow" aria-hidden="true" />
      <div className="incoming-call-screen__content">
        <p className="incoming-call-screen__eyebrow">Appel entrant</p>
        <div className="incoming-call-screen__identity" aria-hidden="true">
          <span>{callerInitials(callerName)}</span>
        </div>
        <h1>
          <strong>{callerName}</strong>
          <span>vous appelle</span>
        </h1>
        <p className="incoming-call-screen__instruction">
          {automatic
            ? 'L’appel va commencer dans un instant'
            : 'Appuyez sur le bouton pour répondre'}
        </p>
        <div className="incoming-call-screen__sound" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </section>
  );
}

function FamilyMessageBanner({ state, now }: { state: ScreenSnapshot['state']; now: number }) {
  const { text: message, index, count } = residentMessageAt(state, now);
  const bannerRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const banner = bannerRef.current;
    const text = textRef.current;
    if (!banner || !text || !message) return;
    const fit = () => {
      const bannerStyle = getComputedStyle(banner);
      const verticalPadding =
        Number.parseFloat(bannerStyle.paddingTop) + Number.parseFloat(bannerStyle.paddingBottom);
      const gap = Number.parseFloat(bannerStyle.rowGap || bannerStyle.gap) || 0;
      const meta = banner.querySelector<HTMLElement>('.tv-family-message-meta');
      const availableHeight = Math.max(
        24,
        banner.clientHeight - verticalPadding - (meta?.offsetHeight ?? 0) - gap - 4,
      );
      const maximum = Math.min(
        message.length <= 55 ? 62 : message.length <= 160 ? 50 : 40,
        banner.clientWidth * (message.length <= 55 ? 0.04 : 0.03),
      );
      // Start from the largest comfortable size and keep reducing it until the
      // complete message fits. Messages may contain up to 1,000 characters, so
      // the previous 14px floor could still leave the last lines outside the
      // fixed-height TV banner.
      let lower = 4;
      let upper = Math.max(lower, maximum);
      while (upper - lower > 0.5) {
        const candidate = (lower + upper) / 2;
        text.style.fontSize = `${candidate}px`;
        if (text.scrollHeight <= availableHeight + 1) lower = candidate;
        else upper = candidate;
      }
      text.style.fontSize = `${lower}px`;
    };
    fit();
    const fontReady = document.fonts?.ready.then(fit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(banner);
    window.addEventListener('resize', fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      void fontReady;
    };
  }, [message]);
  if (!message) return null;
  return (
    <header ref={bannerRef} className="tv-family-message">
      <p ref={textRef}>{message}</p>
      <div className="tv-family-message-meta">
        {state.messageAuthor && <span>— {state.messageAuthor}</span>}
        {count > 1 && (
          <small>
            Message {index + 1} / {count}
          </small>
        )}
      </div>
    </header>
  );
}

function ClockDate({ now, timezone }: { now: Date; timezone?: string }) {
  return (
    <section className="tv-card tv-clock" aria-label="Heure et date">
      <strong>
        {now.toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timezone,
        })}
      </strong>
      <span>
        {now.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: timezone,
        })}
      </span>
    </section>
  );
}

function weatherPresentation(code: number): { label: string; Icon: LucideIcon } {
  if (code === 0) return { label: 'Ensoleillé', Icon: Sun };
  if (code <= 2) return { label: 'Éclaircies', Icon: CloudSun };
  if (code === 3) return { label: 'Nuageux', Icon: Cloud };
  if (code === 45 || code === 48) return { label: 'Brouillard', Icon: CloudFog };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Neige', Icon: CloudSnow };
  if (code >= 95) return { label: 'Orage', Icon: CloudLightning };
  return { label: 'Pluie', Icon: CloudRain };
}

function WeatherPanel({ weather }: { weather: ScreenSnapshot['weather'] }) {
  if (!weather) {
    return (
      <section className="tv-card tv-weather tv-weather--empty" aria-label="Météo à configurer">
        <CloudSun aria-hidden="true" />
        <div className="tv-weather-current">
          <strong>Météo</strong>
          <span>Ville à renseigner</span>
        </div>
      </section>
    );
  }
  const { label, Icon } = weatherPresentation(weather.weatherCode);
  const format = (value: number) =>
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value);
  return (
    <section className="tv-card tv-weather" aria-label={`Météo à ${weather.city}`}>
      <Icon aria-hidden="true" />
      <div className="tv-weather-current">
        <strong>{format(weather.temperature)}°C</strong>
        <b>{weather.city}</b>
        <span>{label}</span>
      </div>
      {(weather.minimum !== null || weather.maximum !== null) && (
        <div className="tv-weather-range">
          {weather.minimum !== null && <span>Min. {format(weather.minimum)}°</span>}
          {weather.maximum !== null && <span>Max. {format(weather.maximum)}°</span>}
        </div>
      )}
    </section>
  );
}

const eventIcons: Record<'visit' | 'appointment', LucideIcon> = {
  visit: UsersRound,
  appointment: Stethoscope,
};

function UpcomingEvents({
  agenda,
  timezone,
}: {
  agenda: ScreenSnapshot['agenda'];
  timezone?: string;
}) {
  return (
    <section className="tv-card tv-agenda" aria-label="Rendez-vous du jour">
      <h2>
        <CalendarDays aria-hidden="true" /> Rendez-vous du jour
      </h2>
      {agenda.length ? (
        <ul>
          {agenda.map((item) => {
            const Icon = eventIcons[item.type];
            const date = new Date(item.startsAt);
            return (
              <li key={item.id}>
                {item.type === 'appointment' ? (
                  <span
                    className="tv-agenda-pictogram"
                    role="img"
                    aria-label={
                      appointmentPictograms.find((option) => option.value === item.pictogram)
                        ?.label ?? 'Rendez-vous'
                    }
                  >
                    {appointmentPictograms.find((option) => option.value === item.pictogram)
                      ?.emoji ?? '📅'}
                  </span>
                ) : (
                  <Icon aria-hidden="true" />
                )}
                <span>
                  <strong>{item.title}</strong>
                  <small>Aujourd’hui</small>
                </span>
                <time dateTime={item.startsAt}>
                  {date.toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: timezone,
                  })}
                </time>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tv-agenda-empty">Aucun rendez-vous aujourd’hui</p>
      )}
    </section>
  );
}
export function ResidentScreen() {
  const [token] = useState(() => localStorage.getItem(key) ?? '');
  const [snapshot, setSnapshot] = useState<ScreenSnapshot>(() => {
    try {
      return JSON.parse(localStorage.getItem('elise-screen-state') ?? 'null') as ScreenSnapshot;
    } catch {
      return null as unknown as ScreenSnapshot;
    }
  });
  const [error, setError] = useState('');
  const [online, setOnline] = useState(false);
  const [now, setNow] = useState(new Date());
  const [join, setJoin] = useState<ScreenJoin>();
  const [source, setSource] = useState('');
  const [mediaStatus, setMediaStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({
    camera: false,
    microphone: false,
  });
  const [photoIndex, setPhotoIndex] = useState(0);
  const [videoStatus, setVideoStatus] = useState<{ id: string; status: VideoStatus }>({
    id: '',
    status: 'loading',
  });
  const [radioStatus, setRadioStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const radioRef = useRef<HTMLAudioElement>(null);
  const fetching = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const s = token
        ? await screenRequest<ScreenSnapshot>(
            'screen-device/heartbeat',
            capabilities,
            'POST',
            token,
          )
        : await screenRequest<ScreenSnapshot>('screen', undefined, 'GET');
      setSnapshot(s);
      setOnline(token ? true : s.online);
      localStorage.setItem(
        'elise-screen-state',
        JSON.stringify({ ...s, state: { ...s.state, call: null } }),
      );
    } catch {
      setOnline(false);
    } finally {
      fetching.current = false;
    }
  }, [token, capabilities]);
  useEffect(
    () =>
      subscribeScreenEvents(
        token ? 'screen-device/events' : 'screen/events',
        () => void refresh(),
        token || undefined,
      ),
    [token, refresh],
  );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      setNow(new Date());
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  const button = useCallback(async () => {
    if (!token) return;
    if (!online) {
      setSnapshot((s) =>
        s
          ? {
              ...s,
              state: {
                ...s.state,
                call: null,
                playback: { ...s.state.playback, asleep: !s.state.playback.asleep },
              },
            }
          : s,
      );
      setJoin(undefined);
      return;
    }
    await screenRequest('screen-device/button', undefined, 'POST', token);
    await refresh();
  }, [token, online, refresh]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space' || e.code === 'F13') {
        e.preventDefault();
        void button().catch((e) => setError(String(e)));
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [button]);
  const call = online ? snapshot?.state.call : null;
  useEffect(() => {
    if (token && call?.acceptedAt && !join)
      void screenRequest<ScreenJoin>(
        `screen-device/calls/${call.id}/join`,
        undefined,
        'POST',
        token,
      )
        .then(setJoin)
        .catch((e) => setError(String(e)));
    if (!call) setJoin(undefined);
  }, [call?.id, call?.acceptedAt, join, token]);
  // A kiosk stays open across deployments: fetch the new shell before reloading its assets.
  useEffect(() => {
    if (!token || !online || snapshot?.state.call) return;
    const current = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!current || !new URL(current).pathname.startsWith('/assets/')) return;
    let disposed = false;
    const check = async () => {
      try {
        const response = await fetch('/resident-screen', { cache: 'no-store' });
        if (!response.ok) return;
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        const source = page.querySelector('script[type="module"][src]')?.getAttribute('src');
        if (!disposed && source && new URL(source, location.origin).href !== current)
          location.reload();
      } catch {
        /* Retain the current screen during an Internet outage. */
      }
    };
    const timer = window.setInterval(() => void check(), 30000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [token, online, snapshot?.state.call?.id]);
  const state = snapshot?.state;
  const photos = state?.media.filter((m) => m.kind === 'photo') ?? [];
  const media = photos[photoIndex % Math.max(photos.length, 1)];
  const activeMedia = state?.media.find((item) => item.id === state.playback.mediaId);
  const activeVideo =
    activeMedia && ['tv', 'youtube'].includes(activeMedia.kind) ? activeMedia : undefined;
  const activeVideoKey = `${activeVideo?.id ?? ''}:${state?.commands.filter((command) => command.action === 'play').at(-1)?.id ?? ''}`;
  const reportVideoStatus = useCallback(
    (status: VideoStatus) => setVideoStatus({ id: activeVideoKey, status }),
    [activeVideoKey],
  );
  const currentVideoStatus = videoStatus.id === activeVideoKey ? videoStatus.status : 'loading';
  const activeRadio = activeMedia?.kind === 'stream' ? activeMedia : undefined;
  const videoPlaying =
    !!activeVideo &&
    currentVideoStatus === 'ready' &&
    !state?.playback.paused &&
    !state?.playback.asleep &&
    !call;
  useEffect(() => {
    setCapabilities((current) =>
      current.videoPlaying === videoPlaying ? current : { ...current, videoPlaying },
    );
  }, [videoPlaying]);

  useEffect(() => {
    const requestedIndex = photos.findIndex((photo) => photo.id === state?.playback.mediaId);
    if (requestedIndex >= 0) setPhotoIndex(requestedIndex);
  }, [state?.playback.mediaId, photos.map((photo) => photo.id).join(',')]);
  useEffect(() => {
    if (
      photos.length < 2 ||
      state?.playback.paused ||
      state?.playback.asleep ||
      call ||
      activeVideo
    )
      return;
    const timer = window.setInterval(
      () => setPhotoIndex((index) => (index + 1) % photos.length),
      (state?.settings.slideshowSeconds ?? 15) * 1000,
    );
    return () => window.clearInterval(timer);
  }, [
    photos.length,
    state?.playback.paused,
    state?.playback.asleep,
    state?.settings.slideshowSeconds,
    call?.id,
    activeVideo?.id,
  ]);
  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setSource('');
    setMediaStatus('loading');
    if (media) {
      if (media.url.startsWith('/api/'))
        void cachedMedia(media, token)
          .then((url) => {
            objectUrl = url;
            if (!disposed) setSource(url);
            else URL.revokeObjectURL(url);
          })
          .catch(() => {
            setMediaStatus('error');
            setError('Contenu local indisponible.');
          });
      else setSource(media.url);
    }
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media?.id, token]);
  useEffect(() => {
    const player = radioRef.current;
    if (!player || !activeRadio) return;
    // The appliance controls the real HDMI sink so Jitsi, speech and media share one volume.
    player.volume = snapshot?.capabilities.host ? 1 : (state?.playback.volume ?? 30) / 100;
    if (state?.playback.paused || state?.playback.asleep || call) player.pause();
    else void player.play().catch(() => setRadioStatus('error'));
  }, [
    activeRadio?.id,
    state?.playback.asleep,
    state?.playback.paused,
    state?.playback.volume,
    call?.id,
    snapshot?.capabilities.host,
  ]);
  // Keep a local copy of all uploaded media for an Internet outage.
  useEffect(() => {
    if (!online || !state) return;
    let stopped = false;
    void (async () => {
      for (const m of state.media.filter((m) => m.url.startsWith('/api/'))) {
        if (stopped) break;
        try {
          const url = await cachedMedia(m, token);
          URL.revokeObjectURL(url);
        } catch {
          /* Retry when connectivity returns. */
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [state?.media.map((m) => m.id).join(','), online, token]);
  useEffect(() => {
    if (!online && snapshot) {
      setSnapshot((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        advanceScreenSchedule(next.state, new Date(), next.timezone);
        return next;
      });
    }
  }, [online, now]);
  useEffect(() => {
    if (!snapshot?.state.settings.consent || !navigator.mediaDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) =>
        setCapabilities((c) => ({
          ...c,
          camera: devices.some((d) => d.kind === 'videoinput'),
          microphone: hasPhysicalMicrophone(devices),
        })),
      )
      .catch(() => undefined);
  }, [snapshot?.state.settings.consent]);
  useEffect(() => {
    if (!token || !state || !online) return;
    for (const c of state.commands.filter(
      (c) => c.status === 'pending' && c.expiresAt > Date.now(),
    )) {
      const contentStatus = activeVideo
        ? currentVideoStatus
        : activeRadio
          ? radioStatus
          : mediaStatus;
      if (
        ['play', 'resume', 'next'].includes(c.action) &&
        (activeVideo || activeRadio || media) &&
        contentStatus === 'loading'
      )
        continue;
      const error =
        c.revision !== state.playback.revision
          ? 'Remplacée par une commande plus récente.'
          : ['play', 'resume', 'next'].includes(c.action) && contentStatus === 'error'
            ? 'Lecture indisponible.'
            : undefined;
      void screenRequest(
        `screen-device/commands/${c.id}/ack`,
        error ? { error } : {},
        'POST',
        token,
      ).catch(() => undefined);
    }
  }, [
    state?.commands,
    online,
    token,
    mediaStatus,
    radioStatus,
    currentVideoStatus,
    activeVideo?.id,
    activeRadio?.id,
  ]);
  if (!snapshot)
    return (
      <main className="resident-pair">
        <h1>Préparation de l’affichage TV…</h1>
        <p>La page résident est configurée automatiquement par Élise sur cet ordinateur.</p>
        <p role="alert">{error}</p>
      </main>
    );
  return (
    <main className={`resident-display ${state?.playback.asleep && !call ? 'resident-sleep' : ''}`}>
      {!state?.playback.asleep && state && !call && (
        <FamilyMessageBanner state={state} now={now.getTime()} />
      )}
      {join && (
        <JitsiFrame
          join={join}
          devices={{
            camera: !!capabilities.camera,
            microphone: !!capabilities.microphone,
          }}
          onEnd={() => {
            void screenRequest(`screen-device/calls/${call?.id}`, undefined, 'DELETE', token).then(
              refresh,
            );
            setJoin(undefined);
          }}
        />
      )}
      {call && !join && (
        <IncomingCallOverlay callId={call.id} callerName={call.name} automatic={call.automatic} />
      )}
      <div
        className={`resident-program ${activeRadio ? 'has-radio' : ''}`}
        style={{ display: call || state?.playback.asleep ? 'none' : 'grid' }}
      >
        {activeVideo && (
          <>
            <ResidentVideo
              key={activeVideoKey}
              media={activeVideo}
              paused={state.playback.paused || state.playback.asleep || !!call}
              volume={snapshot.capabilities.host ? 100 : state.playback.volume}
              nextCommandId={
                [...state.commands]
                  .reverse()
                  .find(
                    (command) =>
                      command.action === 'next' &&
                      command.status === 'pending' &&
                      command.revision === state.playback.revision,
                  )?.id
              }
              onStatus={reportVideoStatus}
            />
            {currentVideoStatus === 'error' && (
              <p className="resident-video-error" role="alert">
                Lecture indisponible. Vérifiez la connexion Internet ou choisissez une autre vidéo.
              </p>
            )}
          </>
        )}
        <div className="tv-information-grid" style={{ display: activeVideo ? 'none' : undefined }}>
          <ClockDate now={now} timezone={snapshot?.timezone} />
          <WeatherPanel weather={snapshot?.weather ?? null} />
          <UpcomingEvents agenda={snapshot?.agenda ?? []} timezone={snapshot?.timezone} />
        </div>
        {activeRadio && (
          <section className="resident-radio-banner" aria-live="polite">
            <audio
              ref={radioRef}
              src={activeRadio.url}
              autoPlay
              preload="none"
              onLoadStart={() => setRadioStatus('loading')}
              onCanPlay={() => setRadioStatus('ready')}
              onPlaying={() => setRadioStatus('ready')}
              onError={() => setRadioStatus('error')}
            />
            <div className="resident-radio-banner__logo">
              <Radio aria-hidden="true" />
              {activeRadio.artworkUrl && (
                <img
                  src={activeRadio.artworkUrl}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              )}
            </div>
            <div
              className={`resident-radio-banner__wave ${state.playback.paused ? 'is-paused' : ''}`}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="resident-radio-banner__text">
              <span>{state.playback.paused ? 'Radio en pause' : 'En cours de lecture'}</span>
              <strong>{activeRadio.title}</strong>
            </div>
            <b className={radioStatus === 'error' ? 'is-error' : ''}>
              {radioStatus === 'error'
                ? 'Indisponible'
                : state.playback.paused
                  ? 'Pause'
                  : 'En direct'}
            </b>
          </section>
        )}
        <section
          className="resident-content"
          aria-label="Album photo"
          style={{ display: activeVideo ? 'none' : undefined }}
        >
          {source && media ? (
            <div className="tv-photo-frame">
              <div className="tv-photo-stage">
                <img className="tv-photo-backdrop" src={source} alt="" aria-hidden="true" />
                <img
                  key={media.id}
                  className="tv-photo"
                  src={source}
                  alt={media.title}
                  onLoad={() => setMediaStatus('ready')}
                  onError={() => setMediaStatus('error')}
                />
              </div>
              {media.title && <p className="tv-photo-caption">{media.title}</p>}
              {photos.length > 1 && (
                <>
                  <button
                    className="tv-photo-nav tv-photo-nav--previous"
                    aria-label="Photo précédente"
                    onClick={() =>
                      setPhotoIndex((index) => (index - 1 + photos.length) % photos.length)
                    }
                  >
                    <ChevronLeft />
                  </button>
                  <button
                    className="tv-photo-nav tv-photo-nav--next"
                    aria-label="Photo suivante"
                    onClick={() => setPhotoIndex((index) => (index + 1) % photos.length)}
                  >
                    <ChevronRight />
                  </button>
                  <div className="tv-photo-pagination" aria-label={`${photos.length} photos`}>
                    {photos.map((photo, index) => (
                      <i
                        key={photo.id}
                        className={index === photoIndex % photos.length ? 'is-current' : ''}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="tv-photo-empty">
              <ImageIcon aria-hidden="true" />
              <h1>{snapshot?.resident}</h1>
              <p>Aucune photo familiale n’a encore été ajoutée.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
