import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { youtubeVideoId, type ScreenMedia } from '@michel/contracts';
export type VideoStatus = 'loading' | 'ready' | 'error';
type YoutubePlayer = {
  loadPlaylist(ids: string[]): void;
  cuePlaylist(ids: string[]): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(value: number): void;
  nextVideo(): void;
  destroy(): void;
};
type YoutubeAPI = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YoutubePlayer;
};
const youtubeWindow = window as typeof window & {
  YT?: YoutubeAPI;
  onYouTubeIframeAPIReady?: () => void;
};
let youtubePromise: Promise<YoutubeAPI> | undefined;
function loadYoutube() {
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  if (!youtubePromise)
    youtubePromise = new Promise<YoutubeAPI>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('YouTube indisponible')), 12000);
      const previous = youtubeWindow.onYouTubeIframeAPIReady;
      youtubeWindow.onYouTubeIframeAPIReady = () => {
        previous?.();
        window.clearTimeout(timeout);
        if (youtubeWindow.YT) resolve(youtubeWindow.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('YouTube indisponible'));
      };
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      youtubePromise = undefined;
      throw error;
    });
  return youtubePromise;
}
export function ResidentVideo({
  media,
  paused,
  volume,
  nextCommandId,
  onStatus,
}: {
  media: ScreenMedia;
  paused: boolean;
  volume: number;
  nextCommandId?: string | undefined;
  onStatus: (status: VideoStatus) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const youtube = useRef<YoutubePlayer | null>(null);
  const controls = useRef({ paused, volume });
  controls.current = { paused, volume };
  const [ready, setReady] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const hasLoaded = useRef(false);
  const handledNext = useRef<string | undefined>(undefined);
  const urls = JSON.stringify(media.playlistUrls ?? [media.url]);
  useEffect(() => {
    let disposed = false;
    let hls: Hls | undefined;
    let player: YoutubePlayer | undefined;
    setReady(false);
    setSoundBlocked(false);
    hasLoaded.current = false;
    onStatus('loading');
    const timeout = window.setTimeout(() => {
      if (!disposed && !hasLoaded.current) onStatus('error');
    }, 12000);
    if (media.kind === 'tv') {
      const element = video.current!;
      element.volume = controls.current.volume / 100;
      if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = media.url;
      else if (Hls.isSupported()) {
        hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 15, maxMaxBufferLength: 30 });
        hls.loadSource(media.url);
        hls.attachMedia(element);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !disposed) onStatus('error');
        });
      } else onStatus('error');
    } else {
      void loadYoutube()
        .then((api) => {
          if (disposed || !container.current) return;
          const target = document.createElement('iframe');
          const firstId = youtubeVideoId((JSON.parse(urls) as string[])[0] ?? '')!;
          target.referrerPolicy = 'strict-origin-when-cross-origin';
          target.allow = 'autoplay; encrypted-media; fullscreen';
          target.title = media.title;
          target.src = `https://www.youtube.com/embed/${firstId}?enablejsapi=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
          container.current.replaceChildren(target);
          player = new api.Player(target, {
            width: '100%',
            height: '100%',
            playerVars: { playsinline: 1, origin: location.origin, controls: 1 },
            events: {
              onReady: (event: { target: YoutubePlayer }) => {
                if (disposed) return;
                youtube.current = event.target;
                event.target.setVolume(controls.current.volume);
                const ids = (JSON.parse(urls) as string[])
                  .map(youtubeVideoId)
                  .filter((id): id is string => !!id);
                if (controls.current.paused) event.target.cuePlaylist(ids);
                else event.target.loadPlaylist(ids);
                setReady(true);
                if (controls.current.paused) {
                  hasLoaded.current = true;
                  window.clearTimeout(timeout);
                  onStatus('ready');
                }
              },
              onStateChange: (event: { data: number }) => {
                if (disposed) return;
                if (event.data === 1 || event.data === 2 || event.data === 5) {
                  hasLoaded.current = true;
                  window.clearTimeout(timeout);
                  onStatus('ready');
                  if (controls.current.paused) youtube.current?.pauseVideo();
                }
              },
              onError: () => {
                if (!disposed) onStatus('error');
              },
              onAutoplayBlocked: () => {
                if (!disposed) onStatus('error');
              },
            },
          });
        })
        .catch(() => {
          if (!disposed) onStatus('error');
        });
    }
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      hls?.destroy();
      player?.destroy();
      youtube.current = null;
    };
  }, [media.id, media.kind, media.url, urls, onStatus]);
  useEffect(() => {
    const element = video.current;
    let cancelled = false;
    if (element && ready) {
      element.volume = volume / 100;
      if (paused) {
        element.pause();
        hasLoaded.current = true;
        onStatus('ready');
      } else
        void element.play().catch(async (error: unknown) => {
          if (cancelled || controls.current.paused) return;
          if (error instanceof DOMException && error.name === 'AbortError') return;
          if (error instanceof DOMException && error.name === 'NotAllowedError') {
            // Ordinary browsers may require a gesture for sound; start the picture anyway.
            element.muted = true;
            setSoundBlocked(true);
            try {
              await element.play();
            } catch {
              if (!cancelled && !controls.current.paused) onStatus('error');
            }
          } else onStatus('error');
        });
    }
    if (ready && youtube.current) {
      youtube.current.setVolume(volume);
      if (paused) youtube.current.pauseVideo();
      else youtube.current.playVideo();
    }
    return () => {
      cancelled = true;
    };
  }, [paused, volume, ready, onStatus]);
  useEffect(() => {
    if (!ready || !nextCommandId || handledNext.current === nextCommandId || !youtube.current)
      return;
    handledNext.current = nextCommandId;
    youtube.current.nextVideo();
    if (paused) youtube.current.pauseVideo();
  }, [ready, nextCommandId, paused]);
  return (
    <section className="resident-video" aria-label={media.title}>
      {media.kind === 'tv' ? (
        <video
          ref={video}
          controls
          autoPlay={!paused}
          playsInline
          onCanPlay={() => {
            setReady(true);
            if (controls.current.paused) onStatus('ready');
          }}
          onPlaying={() => {
            hasLoaded.current = true;
            onStatus('ready');
          }}
          onError={() => onStatus('error')}
        />
      ) : (
        <div ref={container} className="resident-youtube" />
      )}
      {soundBlocked && (
        <button
          className="resident-video-sound"
          onClick={() => {
            const element = video.current;
            if (!element) return;
            element.muted = false;
            if (controls.current.paused) {
              setSoundBlocked(false);
              return;
            }
            void element
              .play()
              .then(() => setSoundBlocked(false))
              .catch(() => {
                element.muted = true;
              });
          }}
        >
          Activer le son
        </button>
      )}
    </section>
  );
}
