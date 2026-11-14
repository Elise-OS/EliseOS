import { Card } from '@elise/ui';
import { ChevronRight, DoorOpen, Maximize2, Play, Tv, Video, X } from 'lucide-react';
import { dateLocale, type Locale, t as i18nT } from './i18n';
import type { CameraItem, CameraSession, CameraRecording } from './app-types';

export function CamerasPanel({
  cameras,
  recordings,
  session,
  notice,
  onOpen,
  onClose,
}: {
  locale: Locale;
  cameras: CameraItem[];
  recordings: CameraRecording[];
  session: CameraSession | null;
  notice: string;
  onOpen: (cameraId: string) => void;
  onClose: () => void;
}) {
  const selectedCamera = cameras.find((camera) => camera.id === session?.cameraId) ?? null;
  const onlineCameras = cameras.filter(
    (camera) => camera.status === 'ONLINE' && !camera.privacyMode,
  ).length;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(dateLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return (
    <section className="section-view camera-page camera-page--designed">
      <header className="page-hero camera-hero">
        <div className="page-hero__copy camera-hero-main">
          <span className="camera-hero-icon">
            <Video aria-hidden="true" />
          </span>
          <div>
            <span className="page-hero__eyebrow">{i18nT('app.homeCameras')}</span>
            <h1 className="page-hero__title">{i18nT('app.cameras')}</h1>
            <p className="page-hero__text">{i18nT('app.liveStreamsAndClipsTriggered')}</p>
          </div>
        </div>
        <div className="page-hero__actions camera-hero-actions">
          <span className="camera-online-count">
            <span className="camera-online-dot" />
            {onlineCameras} {i18nT('app.online')}
          </span>
          <button
            type="button"
            className="camera-primary-action"
            onClick={() => {
              const page = document.querySelector<HTMLElement>('.camera-page');
              if (page?.requestFullscreen) void page.requestFullscreen().catch(() => undefined);
            }}
          >
            <Maximize2 aria-hidden="true" />
            {i18nT('app.fullScreen')}
          </button>
        </div>
      </header>

      {notice && (
        <p className="form-notice camera-notice" role="status">
          {notice}
        </p>
      )}

      <section className="camera-panel-card camera-live-section">
        <div className="camera-section-heading">
          <div className="camera-section-title">
            <span className="camera-section-icon">
              <Tv aria-hidden="true" />
            </span>
            <div>
              <h2>{i18nT('app.liveStreams')}</h2>
              <p>{i18nT('app.selectACameraToOpen')}</p>
            </div>
          </div>
        </div>
        {cameras.length ? (
          <div className="camera-live-grid">
            {cameras.map((camera) => {
              const unavailable =
                camera.privacyMode || camera.status === 'OFFLINE' || !camera.capabilities.live;
              return (
                <article
                  className={`camera-live-card ${camera.privacyMode ? 'is-private' : ''}`}
                  key={camera.id}
                >
                  <div className="camera-live-card-heading">
                    <div className="camera-room-name">
                      <span className="camera-room-icon">
                        <Video aria-hidden="true" />
                      </span>
                      <h3>{camera.room?.name ?? i18nT('app.noRoom')}</h3>
                    </div>
                    <span
                      className={`camera-live-status ${camera.status === 'ONLINE' && !camera.privacyMode ? 'is-online' : ''}`}
                    >
                      <span />
                      {camera.privacyMode
                        ? i18nT('app.privacy')
                        : camera.status === 'ONLINE'
                          ? i18nT('app.online2')
                          : camera.status}
                    </span>
                  </div>
                  <div className="camera-preview">
                    <button
                      type="button"
                      className="camera-preview-main"
                      disabled={unavailable}
                      onClick={() => onOpen(camera.id)}
                      aria-label={`${i18nT('app.openLiveStreamFor')} ${camera.name}`}
                    >
                      <span className="camera-preview-scene">
                        <Video aria-hidden="true" />
                      </span>
                      <span className="camera-preview-label">
                        {camera.privacyMode
                          ? i18nT('app.privacyModeEnabled')
                          : unavailable
                            ? i18nT('app.streamUnavailable')
                            : i18nT('app.openLiveStream')}
                      </span>
                    </button>
                  </div>
                  <div className="camera-live-card-footer">
                    <strong>{camera.name}</strong>
                    <button type="button" disabled={unavailable} onClick={() => onOpen(camera.id)}>
                      {i18nT('app.openLive')} <ChevronRight aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="camera-empty camera-empty--inline">
            <Video aria-hidden="true" />
            <div>
              <h3>{i18nT('app.noCamerasConnected')}</h3>
              <p>{i18nT('app.addItUnderMyHome')}</p>
            </div>
          </div>
        )}
      </section>

      <section className="camera-panel-card camera-recordings-section">
        <div className="camera-section-heading camera-recordings-heading">
          <div className="camera-section-title">
            <span className="camera-section-icon camera-section-icon--blue">
              <Play aria-hidden="true" />
            </span>
            <div>
              <h2>{i18nT('app.recordings')}</h2>
              <p>{i18nT('app.n30SecondSilentVideoClips')}</p>
            </div>
          </div>
        </div>
        <div className="camera-recordings-grid">
          {recordings.map((recording) => (
            <article className="camera-recording-item" key={recording.id}>
              <video
                className="camera-recording-video"
                controls
                preload="metadata"
                src={`/api/v1/cameras/recordings/${encodeURIComponent(recording.id)}/video`}
                aria-label={`${i18nT('app.recording')} ${recording.cameraName}`}
              />
              <div className="camera-recording-copy">
                <strong>
                  {recording.cameraName} · {recording.roomName ?? i18nT('app.noRoom')}
                </strong>
                <span className="camera-recording-tag camera-recording-tag--attention">
                  <DoorOpen aria-hidden="true" />
                  {i18nT('app.mainEntranceOpened')}
                </span>
                <small>
                  {formatDate(recording.capturedAt)} · {formatDuration(recording.durationSeconds)}
                </small>
              </div>
            </article>
          ))}
          {!recordings.length && (
            <div className="camera-recordings-empty">
              <Play aria-hidden="true" />
              <span>{i18nT('app.clipsWillAppearHereAfter')}</span>
            </div>
          )}
        </div>
      </section>

      {session && selectedCamera && (
        <Card className="camera-viewer-card">
          <div className="camera-viewer-heading">
            <div>
              <span className="camera-live-dot" />
              <span className="eyebrow">{i18nT('app.live')}</span>
              <h2>{selectedCamera.name}</h2>
              <p>{selectedCamera.room?.name}</p>
            </div>
            <button
              type="button"
              className="camera-close"
              onClick={onClose}
              aria-label={i18nT('app.closeLiveStream')}
            >
              <X />
            </button>
          </div>
          <div className="camera-frame">
            <iframe
              key={session.mediaUrl}
              src={session.mediaUrl}
              title={selectedCamera.name}
              allow="autoplay; fullscreen"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="camera-viewer-actions">
            <small>{i18nT('app.recordingsContainVideoOnly')}</small>
          </div>
        </Card>
      )}
    </section>
  );
}
