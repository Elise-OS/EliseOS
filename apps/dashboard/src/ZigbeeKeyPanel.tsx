import {
  ZIGBEE_GUIDE_URL,
  ZIGBEE_NETWORK_SEARCH_SECONDS,
  ZIGBEE_TECHNOLOGY_DEFAULTS,
  zigbeeCandidateTitle,
  zigbeeErrorKey,
  zigbeeHeadline,
  zigbeeInstallRequest,
  zigbeeInstallSchema,
  zigbeeIsInstallable,
  zigbeeKnownNotes,
  zigbeeNeedsChoice,
  zigbeeOptionKey,
  zigbeeOtherKeys,
  parseZigbeeNetworkAddress,
  zigbeeProbeResultSchema,
  zigbeeRecentResult,
  zigbeeSearch,
  zigbeeSearchNotice,
  zigbeeServiceState,
  zigbeeStatusSchema,
  zigbeeUsbId,
  zigbeeVisibleIssues,
  type ZigbeeCandidate,
  type ZigbeeCurrent,
  type ZigbeeInstall,
  type ZigbeeInstallRequest,
  type ZigbeeNoteCode,
  type ZigbeeOption,
  type ZigbeeScanOutcome,
  type ZigbeeStatus,
  type ZigbeeTechnology,
} from '@elise/contracts';
import {
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Info,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Usb,
  Wifi,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from './i18n';
import { ZigbeeKeyArt } from './ZigbeeKeyArt';
import './sensor-setup.css';

type LoadError = 'unavailable' | 'forbidden' | 'network';

const technologies = Object.keys(ZIGBEE_TECHNOLOGY_DEFAULTS) as ZigbeeTechnology[];
const baudrates = [38400, 57600, 115200, 230400, 460800, 921600];
const CUSTOM_PORT = 'custom';

class RequestFailure extends Error {
  public constructor(
    public readonly kind: LoadError | 'refused',
    message = '',
  ) {
    super(message);
  }
}

async function zigbeeRequest(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/zigbee/adapter${path}`,
      body === undefined
        ? { method }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    );
  } catch {
    throw new RequestFailure('network');
  }
  const payload = (await response.json().catch(() => null)) as {
    message?: unknown;
    error?: unknown;
  } | null;
  if (response.ok) return payload;
  const raw = payload?.message ?? payload?.error;
  const message = typeof raw === 'string' ? raw : '';
  if (response.status === 403) throw new RequestFailure('forbidden', message);
  if (response.status === 503 && (message === 'ZIGBEE_AGENT_UNAVAILABLE' || !message))
    throw new RequestFailure('unavailable', message);
  throw new RequestFailure(response.status === 400 ? 'refused' : 'network', message);
}

/** A key on the home network is configured as `tcp://host:port`; everything else is on the box. */
function portKind(port: string | null | undefined): 'usb' | 'network' {
  return port?.startsWith('tcp://') ? 'network' : 'usb';
}

export function ZigbeeKeyPanel() {
  const [status, setStatus] = useState<ZigbeeStatus | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [scanning, setScanning] = useState(false);
  // What the last search found on each channel, and whether the family asked for it themselves.
  const [lastScan, setLastScan] = useState<ZigbeeScanOutcome | undefined>(undefined);
  const [searched, setSearched] = useState(false);
  const [message, setMessage] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const installing = status?.state === 'INSTALLING';
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = zigbeeStatusSchema.parse(await zigbeeRequest(''));
      if (!alive.current) return;
      setStatus(next);
      setLoadError(null);
    } catch (error) {
      if (!alive.current) return;
      setLoadError(
        error instanceof RequestFailure && error.kind !== 'refused' ? error.kind : 'network',
      );
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  // The screen watches the box while it is open: a key plugged in appears by itself.
  useEffect(() => {
    if (loadError === 'forbidden') return;
    const timer = window.setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      installing ? 1200 : 3000,
    );
    return () => window.clearInterval(timer);
  }, [refresh, installing, loadError]);

  const runSearch = useCallback(async () => {
    const next = await zigbeeSearch(async (network) =>
      zigbeeStatusSchema.parse(await zigbeeRequest('/scan', 'POST', { network })),
    );
    if (!alive.current) return;
    setStatus(next);
    setLastScan(next.scan);
    setLoadError(null);
  }, []);

  // One button looks for everything: keys plugged on the box and keys on the home network.
  const search = async () => {
    setScanning(true);
    setSearched(true);
    setMessage('');
    try {
      await runSearch();
    } catch (error) {
      if (error instanceof RequestFailure && error.kind !== 'refused') setLoadError(error.kind);
    } finally {
      setScanning(false);
    }
  };

  // The box is watched every few seconds; the home network is slower to answer, so it is only
  // searched every half minute, quietly.
  const idle = scanning || installing;
  useEffect(() => {
    if (loadError === 'forbidden' || idle) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void runSearch().catch(() => undefined);
    }, ZIGBEE_NETWORK_SEARCH_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [runSearch, idle, loadError]);

  const startInstall = async (request: ZigbeeInstallRequest): Promise<boolean> => {
    setMessage('');
    try {
      zigbeeInstallSchema.parse(await zigbeeRequest('/install', 'POST', request));
      setDismissedAt(null);
      await refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof RequestFailure ? error.message : '');
      await refresh();
      return false;
    }
  };

  const stopInstall = async () => {
    try {
      await zigbeeRequest('/install/cancel', 'POST', {});
    } finally {
      await refresh();
    }
  };

  if (!status) {
    return (
      <section
        className="elise-card settings-section-card zigbee-key ss-scope"
        data-testid="zigbee-key"
      >
        {loadError ? (
          <ErrorBlock kind={loadError} onRetry={() => void refresh()} />
        ) : (
          <p className="zigbee-key-loading" role="status">
            <LoaderCircle className="ss-spinner" /> {t('zigbeeKey.loading')}
          </p>
        )}
      </section>
    );
  }

  const result = zigbeeRecentResult(status.install);
  const shownResult = result && result.finishedAt !== dismissedAt ? result : null;
  const others = zigbeeOtherKeys(status);
  const issues = zigbeeVisibleIssues(status.issues);
  const searchNotice = lastScan ? zigbeeSearchNotice(lastScan, others) : null;
  const working = Boolean(status.current?.present);
  const showEmpty =
    !installing &&
    !scanning &&
    others.length === 0 &&
    ((searched && searchNotice === 'none') || status.state === 'NO_KEY');

  return (
    <section
      className="elise-card settings-section-card zigbee-key ss-scope"
      data-testid="zigbee-key"
    >
      <header className="settings-section-heading">
        <span className="settings-section-icon settings-section-icon--blue">
          <KeyRound />
        </span>
        <div>
          <span className="eyebrow">{t('zigbeeKey.eyebrow')}</span>
          <h2>{t('zigbeeKey.title')}</h2>
          <p>{t('zigbeeKey.intro')}</p>
        </div>
      </header>

      <div className="zk-body">
        {installing ? (
          <InstallProgress install={status.install} onStop={() => void stopInstall()} />
        ) : shownResult ? (
          <InstallResult
            install={shownResult}
            onDismiss={() => setDismissedAt(shownResult.finishedAt)}
            onRetry={startInstall}
            onAdvanced={() => setAdvancedOpen(true)}
            current={status.current}
          />
        ) : (
          <KeyHero
            status={status}
            newKeys={status.state === 'NEW_KEY' ? others.length : 0}
            scanning={scanning}
            onSearch={() => void search()}
          />
        )}

        {!installing && !scanning && (
          <p className="zk-watching">
            <span aria-hidden="true" /> {t('zigbeeKey.watching')}
          </p>
        )}

        {scanning && <SearchProgress />}

        {!installing && !scanning && searchNotice && searchNotice !== 'none' && (
          <Notice tone="warning" role="status">
            {t(`zigbeeKey.searchNotice.${searchNotice}`)}
          </Notice>
        )}

        {showEmpty && (
          <EmptyState
            title={
              status.state === 'NO_KEY' && !searched
                ? t('zigbeeKey.emptyNoKeyTitle')
                : t('zigbeeKey.searchNotice.none')
            }
            onSearch={status.state === 'NO_KEY' ? null : () => void search()}
          />
        )}

        {message && !installing && (
          <Notice tone="danger" role="alert">
            {message}
          </Notice>
        )}

        {!installing &&
          issues.map((issue) => (
            <Notice key={issue} tone="warning">
              {t(`zigbeeKey.issue.${issue}`)}{' '}
              {issue === 'firmware-old' && (
                <a href={ZIGBEE_GUIDE_URL} target="_blank" rel="noreferrer">
                  {t('zigbeeKey.firmwareGuide')} <ExternalLink />
                </a>
              )}
            </Notice>
          ))}

        {!installing && others.length > 0 && (
          <section className="zk-found" aria-label={t('zigbeeKey.foundKeys')}>
            {(working || others.length > 1) && (
              <header>
                {working && <h3>{t('zigbeeKey.otherKeyTitle', { count: others.length })}</h3>}
                <p>{working ? t('zigbeeKey.otherKeyHint') : t('zigbeeKey.multipleHint')}</p>
              </header>
            )}
            {others.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                replacing={Boolean(status.current)}
                current={status.current}
                busy={scanning}
                onInstall={startInstall}
                onChanged={refresh}
                onAdvanced={() => setAdvancedOpen(true)}
              />
            ))}
          </section>
        )}

        {!installing && (
          <AdvancedMode
            open={advancedOpen}
            onToggle={setAdvancedOpen}
            status={status}
            onInstall={startInstall}
            onChanged={refresh}
            prefill={shownResult?.target ?? null}
          />
        )}
      </div>
    </section>
  );
}

function Notice({
  tone = 'info',
  role,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  role?: 'status' | 'alert';
  children: ReactNode;
}) {
  const Icon = tone === 'info' ? Info : tone === 'success' ? Check : TriangleAlert;
  return (
    <div className={`ss-notice zk-notice${tone === 'info' ? '' : ` is-${tone}`}`} role={role}>
      <Icon aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

function ErrorBlock({ kind, onRetry }: { kind: LoadError; onRetry: () => void }) {
  return (
    <div className="zigbee-key-error">
      <span className="ss-hero-icon is-warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <div>
        <h3>{kind === 'forbidden' ? t('zigbeeKey.title') : t('zigbeeKey.unavailableTitle')}</h3>
        <p>{kind === 'forbidden' ? t('zigbeeKey.managersOnly') : t('zigbeeKey.unavailableText')}</p>
      </div>
      {kind !== 'forbidden' && (
        <button type="button" className="ss-secondary zk-button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> {t('zigbeeKey.retry')}
        </button>
      )}
    </div>
  );
}

function technologyLabel(technology: string) {
  return technologies.includes(technology as ZigbeeTechnology)
    ? t(`zigbeeKey.tech.${technology as ZigbeeTechnology}`)
    : technology;
}

/** Where the key sits, with the matching icon: on the box (USB) or on the home network. */
function OriginTag({ kind, address }: { kind: 'usb' | 'network'; address?: string | null }) {
  const Icon = kind === 'network' ? Wifi : Usb;
  return (
    <span className={`zk-origin zk-origin--${kind}`}>
      <Icon aria-hidden="true" />
      {kind === 'network' ? t('zigbeeKey.onNetwork') : t('zigbeeKey.pluggedOn')}
      {address && <span className="zk-origin-address">{address}</span>}
    </span>
  );
}

/** Photo-like picture of the key with a small round badge, as on the sensor "found" page. */
function KeyPicture({
  kind,
  badge,
  size = 'large',
  muted = false,
}: {
  kind: 'usb' | 'network';
  badge?: 'ok' | 'warn' | 'new' | null;
  size?: 'large' | 'small';
  muted?: boolean;
}) {
  return (
    <span
      className={`zk-picture zk-picture--${size}${muted ? ' zk-picture--muted' : ''}`}
      aria-hidden="true"
    >
      <span className="ss-found-photo">
        <ZigbeeKeyArt kind={kind} />
      </span>
      {badge && (
        <span className={`ss-found-badge zk-picture-badge zk-picture-badge--${badge}`}>
          {badge === 'ok' ? <Check /> : badge === 'new' ? <PlugZap /> : <CircleAlert />}
        </span>
      )}
    </span>
  );
}

function KeyHero({
  status,
  newKeys,
  scanning,
  onSearch,
}: {
  status: ZigbeeStatus;
  newKeys: number;
  scanning: boolean;
  onSearch: () => void;
}) {
  const headline = zigbeeHeadline(status);
  const current = status.current;
  const kind = portKind(current?.port);
  const title =
    headline.title === 'newKey'
      ? t('zigbeeKey.newKeyTitle', { count: Math.max(1, newKeys) })
      : t(
          (
            {
              ready: 'zigbeeKey.readyTitle',
              attention: 'zigbeeKey.attentionTitle',
              keyMissing: 'zigbeeKey.keyMissingTitle',
              noKey: 'zigbeeKey.noKeyTitle',
              installing: 'zigbeeKey.installingTitle',
            } as const
          )[headline.title],
        );
  const badge =
    headline.tone === 'ok' ? 'ok' : headline.tone === 'new' ? 'new' : current ? 'warn' : null;
  const service = current ? zigbeeServiceState(current) : null;
  const notes = zigbeeKnownNotes(current?.model?.notes ?? []);
  const primary = status.state === 'NEW_KEY' || status.state === 'NO_KEY';
  return (
    <section className={`zk-hero zk-hero--${headline.tone}`} aria-label={title}>
      <div className="zk-hero-main">
        <KeyPicture kind={current ? kind : 'usb'} badge={badge} muted={status.state === 'NO_KEY'} />
        <div className="zk-hero-copy">
          <div className="zk-hero-eyebrow">
            {current && <span className="ss-eyebrow">{t('zigbeeKey.currentKey')}</span>}
            {service && (
              <span className={`zk-pill zk-pill--${service}`}>
                <span aria-hidden="true" />
                {t(
                  (
                    {
                      running: 'zigbeeKey.serviceRunning',
                      starting: 'zigbeeKey.serviceStarting',
                      stopped: 'zigbeeKey.serviceStopped',
                      unknown: 'zigbeeKey.serviceUnknown',
                    } as const
                  )[service],
                )}
              </span>
            )}
          </div>
          <h3>{title}</h3>
          <p>{t(`zigbeeKey.${headline.hint}`)}</p>
        </div>
        <button
          type="button"
          className={`${primary ? 'ss-primary' : 'ss-secondary'} zk-button zk-hero-search`}
          onClick={onSearch}
          disabled={scanning}
        >
          {scanning ? (
            <LoaderCircle className="ss-spinner" aria-hidden="true" />
          ) : (
            <ScanSearch aria-hidden="true" />
          )}
          {scanning ? t('zigbeeKey.searching') : t('zigbeeKey.search')}
        </button>
      </div>

      {current && (
        <>
          <dl className="zk-facts">
            <div>
              <dt>{t('zigbeeKey.model')}</dt>
              <dd>{current.model?.name ?? current.usb?.product ?? t('zigbeeKey.unknownModel')}</dd>
            </div>
            <div>
              <dt>{t('zigbeeKey.devices')}</dt>
              <dd>
                {current.deviceCount != null
                  ? t('zigbeeKey.deviceCount', { count: current.deviceCount })
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('zigbeeKey.connection')}</dt>
              <dd>
                <OriginTag kind={kind} />
              </dd>
            </div>
          </dl>
          {notes.length > 0 && <Tips notes={notes} />}
          <TechnicalDetails current={current} />
        </>
      )}
    </section>
  );
}

function Tips({ notes }: { notes: ZigbeeNoteCode[] }) {
  return (
    <ul className="zk-tips" aria-label={t('zigbeeKey.tips')}>
      {notes.map((note) => (
        <li key={note}>
          <Lightbulb aria-hidden="true" />
          {t(`zigbeeKey.note.${note}`)}
        </li>
      ))}
    </ul>
  );
}

function TechnicalDetails({ current }: { current: ZigbeeCurrent }) {
  const coordinator = current.coordinator;
  const rows: [string, string | null | undefined][] = [
    [t('zigbeeKey.technology'), technologyLabel(current.adapter)],
    [t('zigbeeKey.chip'), current.model?.chip],
    [t('zigbeeKey.port'), current.port],
    [t('zigbeeKey.firmware'), coordinator?.firmware],
    [t('zigbeeKey.coordinatorType'), coordinator?.type],
    [t('zigbeeKey.channel'), coordinator?.channel != null ? String(coordinator.channel) : null],
    [t('zigbeeKey.panId'), coordinator?.panId],
    [t('zigbeeKey.extendedPanId'), coordinator?.extendedPanId],
    [t('zigbeeKey.ieee'), coordinator?.ieee],
    [t('zigbeeKey.advancedBaudrate'), current.baudrate != null ? String(current.baudrate) : null],
    [
      t('zigbeeKey.advancedRtscts'),
      current.rtscts != null ? (current.rtscts ? 'RTS/CTS' : '—') : null,
    ],
  ];
  return (
    <details className="zk-technical">
      <summary>
        <ChevronRight aria-hidden="true" /> {t('zigbeeKey.technicalDetails')}
      </summary>
      <dl>
        {rows
          .filter((row): row is [string, string] => Boolean(row[1]))
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </details>
  );
}

/** Same calm radar as the sensor search, with what is being looked at. */
function SearchProgress() {
  return (
    <section className="zk-search" role="status" aria-label={t('zigbeeKey.searchingTitle')}>
      <div className="ss-radar zk-radar" aria-hidden="true">
        <span className="ss-radar-wave" />
        <span className="ss-radar-wave" />
        <span className="ss-radar-wave" />
        <span className="ss-radar-core">
          <ScanSearch />
        </span>
      </div>
      <div className="zk-search-copy">
        <h3>{t('zigbeeKey.searchingTitle')}</h3>
        <p>{t('zigbeeKey.searchingText')}</p>
        <ol className="ss-checklist zk-checklist">
          <li className="is-active">
            <span aria-hidden="true">
              <LoaderCircle />
            </span>
            <Usb className="zk-checklist-icon" aria-hidden="true" />
            {t('zigbeeKey.searchUsb')}
          </li>
          <li className="is-active">
            <span aria-hidden="true">
              <LoaderCircle />
            </span>
            <Wifi className="zk-checklist-icon" aria-hidden="true" />
            {t('zigbeeKey.searchNetwork')}
          </li>
        </ol>
      </div>
    </section>
  );
}

/** Nothing to choose from: the two ways a key can be reached, shown side by side. */
function EmptyState({ title, onSearch }: { title: string; onSearch: (() => void) | null }) {
  return (
    <section className="zk-empty" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <p>{t('zigbeeKey.emptyText')}</p>
      </header>
      <div className="zk-empty-ways">
        <article>
          <KeyPicture kind="usb" size="small" />
          <div>
            <OriginTag kind="usb" />
            <p>{t('zigbeeKey.emptyUsb')}</p>
          </div>
        </article>
        <article>
          <KeyPicture kind="network" size="small" />
          <div>
            <OriginTag kind="network" />
            <p>{t('zigbeeKey.emptyNetwork')}</p>
          </div>
        </article>
      </div>
      {onSearch && (
        <div className="zk-actions">
          <button type="button" className="ss-secondary zk-button" onClick={onSearch}>
            <RefreshCw aria-hidden="true" /> {t('zigbeeKey.searchAgain')}
          </button>
        </div>
      )}
    </section>
  );
}

function statusLabelKey(status: 'recommended' | 'supported' | 'experimental' | 'discouraged') {
  return {
    recommended: 'zigbeeKey.statusRecommended',
    supported: 'zigbeeKey.statusSupported',
    experimental: 'zigbeeKey.statusExperimental',
    discouraged: 'zigbeeKey.statusDiscouraged',
  }[status] as
    | 'zigbeeKey.statusRecommended'
    | 'zigbeeKey.statusSupported'
    | 'zigbeeKey.statusExperimental'
    | 'zigbeeKey.statusDiscouraged';
}

function InstallProgress({ install, onStop }: { install: ZigbeeInstall; onStop: () => void }) {
  const progress = install.progress ?? 0;
  const kind = portKind(install.target?.port);
  const name = install.target?.modelName ?? install.target?.port ?? '';
  return (
    <section className="zk-install" aria-label={t('zigbeeKey.stepsTitle')}>
      <div className="ss-radar zk-radar" aria-hidden="true">
        <span className="ss-radar-wave" />
        <span className="ss-radar-wave" />
        <svg className="ss-radar-ring" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="56" />
          <circle
            cx="60"
            cy="60"
            r="56"
            className="is-value"
            style={{ strokeDashoffset: 352 * (1 - progress / 100) }}
          />
        </svg>
        <span className="ss-radar-core">
          <ZigbeeKeyArt kind={kind} />
        </span>
      </div>
      <div className="zk-install-copy">
        <span className="ss-eyebrow">
          {t('zigbeeKey.installingTitle')} · {progress} %
        </span>
        <h3>{name}</h3>
        <p>{t('zigbeeKey.installingHint')}</p>
        <ol className="ss-checklist zk-checklist" aria-label={t('zigbeeKey.stepsTitle')}>
          {install.steps.map((step) => {
            const state =
              step.state === 'done' ? 'done' : step.state === 'running' ? 'active' : 'waiting';
            return (
              <li key={step.id} className={`is-${state}`}>
                <span aria-hidden="true">
                  {state === 'done' ? <Check /> : state === 'active' ? <LoaderCircle /> : null}
                </span>
                {t(`zigbeeKey.step.${step.id}`)}
              </li>
            );
          })}
        </ol>
        <div
          className="zk-progress"
          role="progressbar"
          aria-label={t('zigbeeKey.stepsTitle')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="zk-actions zk-actions--start">
          <button type="button" className="ss-secondary zk-button" onClick={onStop}>
            <X aria-hidden="true" /> {t('zigbeeKey.stop')}
          </button>
        </div>
      </div>
    </section>
  );
}

function InstallResult({
  install,
  current,
  onDismiss,
  onRetry,
  onAdvanced,
}: {
  install: ZigbeeInstall;
  current: ZigbeeCurrent | null;
  onDismiss: () => void;
  onRetry: (request: ZigbeeInstallRequest) => Promise<boolean>;
  onAdvanced: () => void;
}) {
  const [confirmingNew, setConfirmingNew] = useState(false);
  const succeeded = install.state === 'SUCCEEDED';
  const cancelled = install.state === 'CANCELLED';
  const failed = install.state === 'FAILED';
  const errorKey = zigbeeErrorKey(install.errorCode);
  const name = install.target?.modelName ?? current?.model?.name ?? '';
  const kind = portKind(install.target?.port ?? current?.port);
  const title = succeeded
    ? t('zigbeeKey.successTitle')
    : cancelled
      ? t('zigbeeKey.cancelledTitle')
      : failed
        ? t('zigbeeKey.failedTitle')
        : t('zigbeeKey.rolledBackTitle');
  const text = succeeded
    ? t('zigbeeKey.successText', { name })
    : cancelled
      ? t('zigbeeKey.cancelledText')
      : failed
        ? t('zigbeeKey.failedText')
        : t('zigbeeKey.rolledBackText');
  const retry = install.target
    ? {
        port: install.target.port,
        adapter: install.target.adapter as ZigbeeTechnology,
        baudrate: install.target.baudrate,
        rtscts: install.target.rtscts,
      }
    : null;
  return (
    <section
      className={`zk-result zk-result--${succeeded ? 'ok' : cancelled ? 'idle' : 'warn'}`}
      role="status"
    >
      {succeeded ? (
        <div className="ss-done-hero zk-result-hero" aria-hidden="true">
          <span className="ss-done-photo">
            <ZigbeeKeyArt kind={kind} />
          </span>
          <span className="ss-done-check">
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27l7 7 15-16" />
            </svg>
          </span>
        </div>
      ) : (
        <span className="zk-result-hero">
          <span className={`ss-hero-icon${cancelled ? '' : ' is-warning'}`} aria-hidden="true">
            {cancelled ? <RotateCcw /> : <TriangleAlert />}
          </span>
        </span>
      )}
      {succeeded && <span className="ss-eyebrow">{t('zigbeeKey.successEyebrow')}</span>}
      <h3>{title}</h3>
      <p className="zk-result-text">{text}</p>
      {!succeeded && install.errorCode && (
        <Notice tone="warning">
          {t(`zigbeeKey.error.${errorKey}`, { detail: install.detail ?? '' })}
        </Notice>
      )}
      {!succeeded && install.rolledBack && (
        <p className="zk-rollback">
          <RotateCcw aria-hidden="true" /> {t('zigbeeKey.step.rollback')}
          <Check aria-hidden="true" />
        </p>
      )}
      {install.detail && !succeeded && (
        <details className="zk-technical zk-technical--inline">
          <summary>
            <ChevronRight aria-hidden="true" /> {t('zigbeeKey.technicalDetails')}
          </summary>
          <code>{install.detail}</code>
        </details>
      )}
      <div className="zk-actions zk-actions--center">
        {install.errorCode === 'NETWORK_MISMATCH' && retry && (
          <button
            type="button"
            className="ss-secondary zk-button"
            onClick={() => setConfirmingNew(true)}
          >
            {t('zigbeeKey.retryNewNetwork')}
          </button>
        )}
        {(install.errorCode === 'NO_ANSWER' || install.errorCode === 'WRONG_ADAPTER') && (
          <button type="button" className="ss-secondary zk-button" onClick={onAdvanced}>
            <Settings2 aria-hidden="true" /> {t('zigbeeKey.openAdvanced')}
          </button>
        )}
        <button type="button" className="ss-primary zk-button" onClick={onDismiss}>
          {succeeded && <Check aria-hidden="true" />}
          {succeeded ? t('zigbeeKey.done') : t('zigbeeKey.dismiss')}
        </button>
      </div>
      {confirmingNew && retry && (
        <InstallConfirm
          name={name}
          hasCurrent={false}
          forceNew
          onCancel={() => setConfirmingNew(false)}
          onConfirm={(mode) => {
            void onRetry({ ...retry, networkMode: mode, confirmNewNetwork: true });
            setConfirmingNew(false);
          }}
        />
      )}
    </section>
  );
}

function InstallConfirm({
  name,
  hasCurrent,
  forceNew = false,
  onConfirm,
  onCancel,
}: {
  name: string;
  hasCurrent: boolean;
  forceNew?: boolean;
  onConfirm: (mode: 'keep' | 'new') => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'keep' | 'new'>(forceNew ? 'new' : 'keep');
  const [understood, setUnderstood] = useState(false);
  const askMode = hasCurrent || forceNew;
  const ready = mode === 'keep' || understood;
  return (
    <div className="zk-confirm" role="group" aria-label={t('zigbeeKey.confirmTitle', { name })}>
      <h4>
        <ShieldCheck aria-hidden="true" /> {t('zigbeeKey.confirmTitle', { name })}
      </h4>
      <p>{t('zigbeeKey.confirmText')}</p>
      {askMode && (
        <fieldset className="zk-choices">
          <legend>{t('zigbeeKey.sensorsTitle')}</legend>
          {!forceNew && (
            <label className={mode === 'keep' ? 'is-selected' : ''}>
              <input
                type="radio"
                name="zigbee-network"
                checked={mode === 'keep'}
                onChange={() => setMode('keep')}
              />
              <span>
                <strong>{t('zigbeeKey.keepNetwork')}</strong>
                <small>{t('zigbeeKey.keepNetworkHint')}</small>
              </span>
            </label>
          )}
          <label className={mode === 'new' ? 'is-selected' : ''}>
            <input
              type="radio"
              name="zigbee-network"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            <span>
              <strong>{t('zigbeeKey.newNetwork')}</strong>
              <small>{t('zigbeeKey.newNetworkHint')}</small>
            </span>
          </label>
          {mode === 'new' && (
            <label className="zk-understood">
              <input
                type="checkbox"
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
              />
              <span>{t('zigbeeKey.confirmNewNetwork')}</span>
            </label>
          )}
        </fieldset>
      )}
      <div className="zk-actions">
        <button type="button" className="ss-secondary zk-button" onClick={onCancel}>
          {t('zigbeeKey.cancel')}
        </button>
        <button
          type="button"
          className="ss-primary zk-button"
          onClick={() => onConfirm(mode)}
          disabled={!ready}
        >
          <ShieldCheck aria-hidden="true" /> {t('zigbeeKey.install')}
        </button>
      </div>
    </div>
  );
}

interface CandidateCardProps {
  candidate: ZigbeeCandidate;
  current: ZigbeeCurrent | null;
  replacing: boolean;
  busy: boolean;
  onInstall: (request: ZigbeeInstallRequest) => Promise<boolean>;
  onChanged: () => Promise<void>;
  onAdvanced: () => void;
}

function CandidateCard({
  candidate,
  current,
  replacing,
  busy,
  onInstall,
  onChanged,
  onAdvanced,
}: CandidateCardProps) {
  const [probing, setProbing] = useState(false);
  const [probeNotice, setProbeNotice] = useState<'answered' | 'silent' | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ZigbeeOption | null>(null);
  const identity = candidate.identity;
  const title = zigbeeCandidateTitle(candidate) ?? t('zigbeeKey.unknownModel');
  const needsChoice = zigbeeNeedsChoice(candidate);
  const installable = zigbeeIsInstallable(candidate);
  const notes = zigbeeKnownNotes(identity.notes);
  const usbId = zigbeeUsbId(candidate);
  const kind = candidate.kind === 'network' ? 'network' : 'usb';
  const chosen = identity.options.find((option) => zigbeeOptionKey(option) === choice) ?? null;
  const single = identity.options.length === 1 ? identity.options[0] : null;
  const proposal = single ?? chosen;
  const confidence =
    identity.confidence === 'high' || identity.confidence === 'medium'
      ? 'ok'
      : identity.confidence === 'ambiguous'
        ? 'confirm'
        : 'unknown';

  const identify = async () => {
    setProbing(true);
    setProbeNotice(null);
    try {
      const result = zigbeeProbeResultSchema.parse(
        await zigbeeRequest('/probe', 'POST', { candidateId: candidate.id }),
      );
      setProbeNotice(result.answered ? 'answered' : 'silent');
      const identified = result.candidate.identity.options[0];
      if (result.candidate.identity.options.length === 1 && identified) {
        setChoice(zigbeeOptionKey(identified));
      }
      await onChanged();
    } catch {
      setProbeNotice('silent');
    } finally {
      setProbing(false);
    }
  };

  const confirmedName = proposal?.modelName ?? title;
  const meta = [
    identity.confidence !== 'unknown' ? identity.chip : null,
    proposal ? technologyLabel(proposal.technology) : null,
  ].filter(Boolean);
  return (
    <article className="zk-candidate" data-testid="zigbee-candidate">
      <KeyPicture kind={kind} size="small" />
      <div className="zk-candidate-copy">
        <div className="zk-candidate-title">
          <h4>{title}</h4>
          <span className={`zk-pill zk-pill--${confidence}`}>
            <span aria-hidden="true" />
            {confidence === 'ok'
              ? t('zigbeeKey.recognized')
              : confidence === 'confirm'
                ? t('zigbeeKey.toConfirm')
                : t('zigbeeKey.unknownKey')}
          </span>
          {identity.status && identity.status !== 'supported' && (
            <span className={`zk-pill zk-pill--${identity.status}`}>
              {t(statusLabelKey(identity.status))}
            </span>
          )}
        </div>
        <OriginTag
          kind={kind}
          address={candidate.network ? `${candidate.network.host}:${candidate.network.port}` : null}
        />
        {meta.length > 0 && <p className="zk-candidate-meta">{meta.join(' · ')}</p>}

        {needsChoice && probeNotice !== 'silent' && (
          <p className="zk-candidate-text">{t('zigbeeKey.ambiguousExplain')}</p>
        )}
        {needsChoice && probeNotice === 'silent' && (
          <fieldset className="zk-choices">
            <legend>{t('zigbeeKey.silent')}</legend>
            {identity.options.map((option) => (
              <label
                key={zigbeeOptionKey(option)}
                className={choice === zigbeeOptionKey(option) ? 'is-selected' : ''}
              >
                <input
                  type="radio"
                  name={`zigbee-option-${candidate.id}`}
                  checked={choice === zigbeeOptionKey(option)}
                  onChange={() => setChoice(zigbeeOptionKey(option))}
                />
                <span>
                  <strong>{option.modelName ?? technologyLabel(option.technology)}</strong>
                  <small>{technologyLabel(option.technology)}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {probeNotice === 'answered' && installable && (
          <Notice tone="success">
            {single?.modelName
              ? t('zigbeeKey.identified', { name: single.modelName })
              : t('zigbeeKey.identifiedGeneric', {
                  technology: technologyLabel(single?.technology ?? ''),
                })}
          </Notice>
        )}

        {identity.confidence === 'unknown' && (
          <p className="zk-candidate-text">{t('zigbeeKey.unknownExplain', { id: usbId ?? '—' })}</p>
        )}

        {candidate.busy && (
          <Notice tone="warning">{t('zigbeeKey.busyBy', { by: candidate.busy.by })}</Notice>
        )}
        {candidate.portStability === 'by-path' && (
          <Notice tone="warning">{t('zigbeeKey.stabilityByPath')}</Notice>
        )}
        {candidate.portStability === 'raw' && (
          <Notice tone="warning">{t('zigbeeKey.stabilityRaw')}</Notice>
        )}
        {notes.length > 0 && !confirming && (
          <details className="zk-technical zk-technical--tips">
            <summary>
              <Lightbulb aria-hidden="true" /> {t('zigbeeKey.tipsCount', { count: notes.length })}
            </summary>
            <Tips notes={notes} />
          </details>
        )}
      </div>

      {!confirming && (
        <div className="zk-candidate-action">
          {needsChoice && probeNotice !== 'silent' && (
            <button
              type="button"
              className="ss-primary zk-button"
              onClick={() => void identify()}
              disabled={probing}
            >
              {probing ? (
                <LoaderCircle className="ss-spinner" aria-hidden="true" />
              ) : (
                <ScanSearch aria-hidden="true" />
              )}
              {probing ? t('zigbeeKey.identifying') : t('zigbeeKey.identify')}
            </button>
          )}
          {identity.confidence === 'unknown' && (
            <button type="button" className="ss-secondary zk-button" onClick={onAdvanced}>
              <Settings2 aria-hidden="true" /> {t('zigbeeKey.openAdvanced')}
            </button>
          )}
          {proposal && !candidate.busy && (
            <button
              type="button"
              className="ss-primary zk-button"
              disabled={busy}
              onClick={() => setConfirming(proposal)}
            >
              <PlugZap aria-hidden="true" />
              {replacing ? t('zigbeeKey.useKeyInstead') : t('zigbeeKey.useKey')}
            </button>
          )}
        </div>
      )}
      {confirming && (
        <InstallConfirm
          name={confirmedName}
          hasCurrent={Boolean(current)}
          onCancel={() => setConfirming(null)}
          onConfirm={(mode) => {
            void onInstall(zigbeeInstallRequest(candidate, confirming, mode)).then((started) => {
              if (!started) setConfirming(null);
            });
          }}
        />
      )}
    </article>
  );
}

interface AdvancedModeProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  status: ZigbeeStatus;
  onInstall: (request: ZigbeeInstallRequest) => Promise<boolean>;
  onChanged: () => Promise<void>;
  prefill: ZigbeeInstall['target'];
}

function AdvancedMode({
  open,
  onToggle,
  status,
  onInstall,
  onChanged,
  prefill,
}: AdvancedModeProps) {
  const [portChoice, setPortChoice] = useState<string>(status.candidates[0]?.id ?? CUSTOM_PORT);
  const [customPort, setCustomPort] = useState('');
  const [adapter, setAdapter] = useState<ZigbeeTechnology>('zstack');
  const [baudrate, setBaudrate] = useState(115200);
  const [rtscts, setRtscts] = useState(false);
  const [address, setAddress] = useState('');
  const [testing, setTesting] = useState(false);
  const [addressResult, setAddressResult] = useState<'ok' | 'fail' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const candidates = status.candidates;
  const selected = candidates.find((candidate) => candidate.id === portChoice) ?? null;

  // Start from what the box believes about the chosen key, or from the failed attempt.
  useEffect(() => {
    const option = selected?.identity.options[0];
    if (option) {
      setAdapter(option.technology);
      setBaudrate(option.baudrate);
      setRtscts(option.rtscts);
    }
  }, [selected?.id, selected?.identity.options]);

  useEffect(() => {
    if (!prefill) return;
    const match = candidates.find((candidate) => candidate.port === prefill.port);
    setPortChoice(match?.id ?? CUSTOM_PORT);
    if (!match) setCustomPort(prefill.port);
    if (technologies.includes(prefill.adapter as ZigbeeTechnology))
      setAdapter(prefill.adapter as ZigbeeTechnology);
    setBaudrate(prefill.baudrate);
    setRtscts(prefill.rtscts);
    // Only the failed attempt itself should reset the form.
  }, [prefill?.port, prefill?.adapter]);

  const customValid = /^(\/dev\/[A-Za-z0-9._:+@=/-]+|tcp:\/\/[A-Za-z0-9.:[\]-]+:\d{1,5})$/.test(
    customPort.trim(),
  );
  const canInstall = portChoice === CUSTOM_PORT ? customValid : Boolean(selected);

  const parsedAddress = parseZigbeeNetworkAddress(address);

  const test = async () => {
    if (!parsedAddress) return;
    setTesting(true);
    setAddressResult(null);
    try {
      zigbeeProbeResultSchema.parse(await zigbeeRequest('/network/test', 'POST', parsedAddress));
      setAddressResult('ok');
      await onChanged();
    } catch {
      setAddressResult('fail');
    } finally {
      setTesting(false);
    }
  };

  const forget = async (candidateId: string) => {
    await zigbeeRequest('/network/forget', 'POST', { candidateId }).catch(() => null);
    await onChanged();
  };

  const install = async () => {
    const base = { adapter, baudrate, rtscts, networkMode: 'keep' as const };
    const request: ZigbeeInstallRequest =
      portChoice === CUSTOM_PORT
        ? { ...base, port: customPort.trim() }
        : { ...base, candidateId: portChoice };
    setConfirming(false);
    await onInstall(request);
  };

  const networkKeys = useMemo(
    () => candidates.filter((candidate) => candidate.kind === 'network'),
    [candidates],
  );

  return (
    <details
      className="settings-disclosure zigbee-advanced"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span className="settings-option-icon settings-option-icon--blue">
          <Settings2 />
        </span>
        <span>
          <strong>{t('zigbeeKey.advanced')}</strong>
          <small>{t('zigbeeKey.advancedHint')}</small>
        </span>
        <span className="settings-disclosure-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      </summary>
      <div className="zk-advanced-body">
        <section className="zk-advanced-group">
          <h4>{t('zigbeeKey.advancedSettings')}</h4>
          <div className="zk-fields">
            <label className="ss-field">
              <span className="ss-field-label">{t('zigbeeKey.advancedPort')}</span>
              <select value={portChoice} onChange={(event) => setPortChoice(event.target.value)}>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {zigbeeCandidateTitle(candidate) ?? candidate.port} — {candidate.port}
                  </option>
                ))}
                <option value={CUSTOM_PORT}>{t('zigbeeKey.advancedCustomPort')}</option>
              </select>
            </label>
            {portChoice === CUSTOM_PORT && (
              <label className="ss-field">
                <span className="ss-field-label">{t('zigbeeKey.advancedCustomPort')}</span>
                <input
                  value={customPort}
                  onChange={(event) => setCustomPort(event.target.value)}
                  placeholder={t('zigbeeKey.advancedPortPlaceholder')}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
            )}
            <label className="ss-field">
              <span className="ss-field-label">{t('zigbeeKey.advancedAdapter')}</span>
              <select
                value={adapter}
                onChange={(event) => {
                  const next = event.target.value as ZigbeeTechnology;
                  setAdapter(next);
                  setBaudrate(ZIGBEE_TECHNOLOGY_DEFAULTS[next].baudrates[0] ?? 115200);
                  setRtscts(ZIGBEE_TECHNOLOGY_DEFAULTS[next].rtscts);
                }}
              >
                {technologies.map((technology) => (
                  <option key={technology} value={technology}>
                    {t(`zigbeeKey.tech.${technology}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ss-field">
              <span className="ss-field-label">{t('zigbeeKey.advancedBaudrate')}</span>
              <select
                value={baudrate}
                onChange={(event) => setBaudrate(Number(event.target.value))}
              >
                {baudrates.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}
                  </option>
                ))}
              </select>
            </label>
            <label className="zk-checkbox">
              <input
                type="checkbox"
                checked={rtscts}
                onChange={(event) => setRtscts(event.target.checked)}
              />
              <span>
                <strong>{t('zigbeeKey.advancedRtscts')}</strong>
                <small>{t('zigbeeKey.advancedRtsctsHint')}</small>
              </span>
            </label>
          </div>
          {!confirming ? (
            <div className="zk-actions">
              <button
                type="button"
                className="ss-primary zk-button"
                disabled={!canInstall}
                onClick={() => setConfirming(true)}
              >
                <ShieldCheck aria-hidden="true" /> {t('zigbeeKey.advancedInstall')}
              </button>
            </div>
          ) : (
            <InstallConfirm
              name={selected ? (zigbeeCandidateTitle(selected) ?? selected.port) : customPort}
              hasCurrent={Boolean(status.current)}
              onCancel={() => setConfirming(false)}
              onConfirm={() => void install()}
            />
          )}
        </section>

        <section className="zk-advanced-group">
          <h4>
            <Wifi aria-hidden="true" /> {t('zigbeeKey.networkSection')}
          </h4>
          <p className="zk-advanced-hint">{t('zigbeeKey.networkSectionHint')}</p>
          <div className="zk-address">
            <label className="ss-field">
              <span className="ss-field-label">{t('zigbeeKey.networkAddress')}</span>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={t('zigbeeKey.networkPlaceholder')}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="ss-secondary zk-button"
              disabled={!parsedAddress || testing}
              onClick={() => void test()}
            >
              {testing ? (
                <LoaderCircle className="ss-spinner" aria-hidden="true" />
              ) : (
                <Wifi aria-hidden="true" />
              )}
              {testing ? t('zigbeeKey.testing') : t('zigbeeKey.testAddress')}
            </button>
          </div>
          {addressResult && (
            <Notice tone={addressResult === 'ok' ? 'success' : 'danger'} role="status">
              {addressResult === 'ok' ? t('zigbeeKey.addressOk') : t('zigbeeKey.addressFail')}
            </Notice>
          )}
          {networkKeys.length > 0 && (
            <ul className="zk-remembered">
              {networkKeys.map((candidate) => (
                <li key={candidate.id}>
                  <Wifi aria-hidden="true" />
                  <code>{candidate.port}</code>
                  <button type="button" onClick={() => void forget(candidate.id)}>
                    {t('zigbeeKey.forget')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}
