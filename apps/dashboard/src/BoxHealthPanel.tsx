import { boxHealthReportSchema, type BoxHealthAction, type BoxHealthCheck } from '@elise/contracts';
import {
  Activity,
  BatteryLow,
  BellRing,
  Boxes,
  CircleCheck,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  DatabaseBackup,
  Eye,
  Gauge,
  Globe,
  HardDrive,
  HeartPulse,
  House,
  Inbox,
  KeyRound,
  LoaderCircle,
  MemoryStick,
  OctagonAlert,
  Radar,
  RefreshCw,
  Send,
  ServerCog,
  ShieldCheck,
  Thermometer,
  TriangleAlert,
  Usb,
  WifiOff,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTION_KEYS,
  allChecks,
  bannerMessage,
  bannerTone,
  countLevels,
  isKnownCheck,
  isKnownGroup,
  isUsableSentence,
  orderedGroups,
  refreshDelay,
  sentenceParams,
  worstLevel,
  withExtras,
  type BoxHealthLevel,
  type BoxHealthReport,
  type BoxHealthTone,
} from './box-health-view';
import { dateLocale, t } from './i18n';

type LoadError = 'unavailable' | 'forbidden' | 'network';

class RequestFailure extends Error {
  public constructor(
    public readonly kind: LoadError | 'refused',
    message = '',
  ) {
    super(message);
  }
}

async function boxHealthRequest(path: string, method = 'GET'): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/system/box-health${path}`,
      method === 'GET'
        ? { method, cache: 'no-store' }
        : { method, headers: { 'content-type': 'application/json' }, body: '{}' },
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
  if (response.status === 404 || response.status === 501 || response.status === 503)
    throw new RequestFailure('unavailable', message);
  // A backup already on its way is not a failure for the family.
  if (response.status === 409) return payload;
  throw new RequestFailure(response.status === 400 ? 'refused' : 'network', message);
}

/** Catalog keys built at run time (check ids come from the box). */
const tr = t as unknown as (key: string, options?: Record<string, unknown>) => string;

const groupIcons: Record<string, LucideIcon> = {
  monitoring: Eye,
  home: House,
  notifications: BellRing,
  box: Cpu,
  data: Database,
  access: KeyRound,
};

const checkIcons: Record<string, LucideIcon> = {
  worker: Workflow,
  'last-event': Clock3,
  coverage: Radar,
  'home-assistant': House,
  zigbee: Usb,
  'sensors-offline': WifiOff,
  'sensors-battery': BatteryLow,
  deliveries: Send,
  outbox: Inbox,
  disk: HardDrive,
  memory: MemoryStick,
  temperature: Thermometer,
  throttling: Gauge,
  containers: Boxes,
  'storage-errors': TriangleAlert,
  backup: DatabaseBackup,
  'db-size': Database,
  'remote-access': Globe,
};

const bannerIcons: Record<BoxHealthTone, LucideIcon> = {
  ok: ShieldCheck,
  warning: TriangleAlert,
  critical: OctagonAlert,
  unverifiable: CircleHelp,
};

const levelIcons: Record<BoxHealthLevel, LucideIcon> = {
  ok: CircleCheck,
  warning: TriangleAlert,
  critical: OctagonAlert,
  unknown: CircleHelp,
};

/** The label of a point, used by the generic sentence and the technical list. */
function checkLabel(id: string): string {
  return isKnownCheck(id) ? tr(`boxHealth.check.${id}.label`) : id;
}

/** A familiar sentence for a point; when a value it needs is missing, the generic one. */
export function checkSentence(check: BoxHealthCheck): string {
  const params = sentenceParams(check);
  if (isKnownCheck(check.id)) {
    // The full sentence inserts the box's values; the short one says the same without them.
    for (const key of [
      `boxHealth.check.${check.id}.${check.level}`,
      `boxHealth.check.${check.id}.${check.level}Short`,
    ]) {
      const text = tr(key, params);
      if (isUsableSentence(text, key)) return text;
    }
  }
  return tr(`boxHealth.generic.${check.level}`, { label: checkLabel(check.id) });
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    dateLocale(),
    today
      ? { hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' },
  ).format(date);
}

export interface BoxHealthPanelProps {
  onOpenZigbee: () => void;
  onOpenSensors: () => void;
  onOpenRemoteAccess: () => void;
}

export function BoxHealthPanel({
  onOpenZigbee,
  onOpenSensors,
  onOpenRemoteAccess,
}: BoxHealthPanelProps) {
  const [report, setReport] = useState<BoxHealthReport | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [checking, setChecking] = useState(false);
  const [backupSending, setBackupSending] = useState(false);
  const [notice, setNotice] = useState<'backupStarted' | 'backupDone' | 'backupFailed' | null>(
    null,
  );
  const alive = useRef(true);
  const lastFetch = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const backupWatched = useRef(false);
  const backupRunning = backupSending || report?.backup?.running === true;

  const refresh = useCallback((): Promise<void> => {
    // One question at a time: a click during an automatic check waits for the same answer.
    if (inFlight.current) return inFlight.current;
    const pending = (async () => {
      try {
        const raw = await boxHealthRequest('');
        const next = withExtras(boxHealthReportSchema.parse(raw), raw);
        if (!alive.current) return;
        setReport(next);
        setLoadError(null);
      } catch (error) {
        if (!alive.current) return;
        setLoadError(
          error instanceof RequestFailure && error.kind !== 'refused' ? error.kind : 'network',
        );
      } finally {
        lastFetch.current = Date.now();
        inFlight.current = null;
      }
    })();
    inFlight.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  // Asked again every minute while the page is in front of someone, every 5 s during a backup.
  useEffect(() => {
    const delay = refreshDelay(backupRunning);
    const visible = () => document.visibilityState === 'visible';
    const timer = window.setInterval(() => {
      if (visible()) void refresh();
    }, delay);
    const onVisibility = () => {
      if (visible() && Date.now() - lastFetch.current >= delay) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [backupRunning, refresh]);

  // The family hears when the backup they started is over.
  useEffect(() => {
    if (report?.backup?.running) backupWatched.current = true;
    else if (backupWatched.current && !backupSending && report) {
      backupWatched.current = false;
      setNotice('backupDone');
    }
  }, [report, backupSending]);

  const checkNow = async () => {
    setChecking(true);
    setNotice(null);
    await refresh();
    if (alive.current) setChecking(false);
  };

  const runBackup = async () => {
    if (backupRunning) return;
    setBackupSending(true);
    setNotice(null);
    try {
      await boxHealthRequest('/backup', 'POST');
      if (!alive.current) return;
      backupWatched.current = true;
      setNotice('backupStarted');
    } catch {
      if (alive.current) setNotice('backupFailed');
    }
    await refresh();
    if (alive.current) setBackupSending(false);
  };

  const runAction = (action: BoxHealthAction) => {
    if (action === 'open-zigbee') onOpenZigbee();
    else if (action === 'open-sensors') onOpenSensors();
    else if (action === 'open-remote-access') onOpenRemoteAccess();
    else void runBackup();
  };

  const loading = !report && !loadError;
  const failed = loadError !== null;
  const tone = bannerTone(report, failed);
  const message = bannerMessage(report, failed);
  const BannerIcon = bannerIcons[tone];
  const counts = report ? countLevels(report) : null;
  const when = report ? formatWhen(report.checkedAt) : '';

  return (
    <section className="box-health" aria-labelledby="box-health-title" aria-busy={loading}>
      <header className="box-health-intro">
        <span className="box-health-intro-icon" aria-hidden="true">
          <HeartPulse />
        </span>
        <div>
          <span className="eyebrow">{t('boxHealth.eyebrow')}</span>
          <h2 id="box-health-title">{t('boxHealth.title')}</h2>
          <p>{t('boxHealth.intro')}</p>
        </div>
      </header>

      {loading ? (
        <BoxHealthSkeleton />
      ) : (
        <div className={`box-health-verdict is-${tone}`} role="status" aria-live="polite">
          <span className="box-health-verdict-icon" aria-hidden="true">
            <BannerIcon />
          </span>
          <div className="box-health-verdict-copy">
            <h3>{tr(`boxHealth.verdict.${message}.title`)}</h3>
            <p>
              {failed
                ? t(`boxHealth.error.${loadError ?? 'network'}`)
                : tr(`boxHealth.verdict.${message}.text`, {
                    count:
                      (counts?.warning ?? 0) + (counts?.critical ?? 0) + (counts?.unknown ?? 0),
                  })}
            </p>
            <p className="box-health-verdict-meta">
              <Clock3 aria-hidden="true" />
              {failed
                ? report
                  ? t('boxHealth.lastKnown', { when })
                  : t('boxHealth.neverChecked')
                : t('boxHealth.checkedAt', { when })}
              <span aria-hidden="true">·</span>
              {t('boxHealth.autoRefresh')}
            </p>
            {counts && !failed && (
              <ul className="box-health-counts" aria-label={t('boxHealth.summary')}>
                {(['ok', 'warning', 'critical', 'unknown'] as const)
                  .filter((level) => counts[level] > 0)
                  .map((level) => (
                    <li key={level} className={`is-${level}`}>
                      <span aria-hidden="true" />
                      {t(`boxHealth.count.${level}`, { count: counts[level] })}
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <div className="box-health-verdict-actions">
            <button
              type="button"
              className="box-health-button is-primary"
              onClick={() => void checkNow()}
              disabled={checking}
            >
              {checking ? (
                <LoaderCircle className="box-health-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {checking ? t('boxHealth.checking') : t('boxHealth.checkNow')}
            </button>
            <button
              type="button"
              className="box-health-button"
              onClick={() => void runBackup()}
              disabled={backupRunning || loadError === 'forbidden'}
            >
              {backupRunning ? (
                <LoaderCircle className="box-health-spin" aria-hidden="true" />
              ) : (
                <DatabaseBackup aria-hidden="true" />
              )}
              {backupRunning ? t('boxHealth.backupRunning') : t('boxHealth.backupNow')}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p
          className={`box-health-notice${notice === 'backupFailed' ? ' is-error' : ''}`}
          role={notice === 'backupFailed' ? 'alert' : 'status'}
        >
          {notice === 'backupFailed' ? (
            <TriangleAlert aria-hidden="true" />
          ) : notice === 'backupDone' ? (
            <CircleCheck aria-hidden="true" />
          ) : (
            <LoaderCircle className="box-health-spin" aria-hidden="true" />
          )}
          {t(`boxHealth.${notice}`)}
        </p>
      )}

      {report && (
        <div className={`box-health-groups${failed ? ' is-stale' : ''}`}>
          {orderedGroups(report).map((group) => {
            const known = isKnownGroup(group.id);
            const GroupIcon = groupIcons[group.id] ?? Activity;
            const level = worstLevel(group.checks);
            return (
              <section
                key={group.id}
                className={`box-health-group is-${level}`}
                aria-labelledby={`box-health-group-${group.id}`}
              >
                <header>
                  <span className="box-health-group-icon" aria-hidden="true">
                    <GroupIcon />
                  </span>
                  <div>
                    <h3 id={`box-health-group-${group.id}`}>
                      {known ? tr(`boxHealth.group.${group.id}.title`) : t('boxHealth.group.other')}
                    </h3>
                    {known && <p>{tr(`boxHealth.group.${group.id}.hint`)}</p>}
                  </div>
                  <LevelPill level={level} />
                </header>
                <ul>
                  {group.checks.map((check) => (
                    <CheckRow
                      key={check.id}
                      check={check}
                      busy={check.action === 'run-backup' && backupRunning}
                      onAction={runAction}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {report && <TechnicalDetails report={report} />}
    </section>
  );
}

function LevelPill({ level }: { level: BoxHealthLevel }) {
  return (
    <span className={`box-health-pill is-${level}`}>
      <span aria-hidden="true" />
      {t(`boxHealth.level.${level}`)}
    </span>
  );
}

function CheckRow({
  check,
  busy,
  onAction,
}: {
  check: BoxHealthCheck;
  busy: boolean;
  onAction: (action: BoxHealthAction) => void;
}) {
  const Icon = checkIcons[check.id] ?? ServerCog;
  const LevelIcon = levelIcons[check.level];
  return (
    <li className={`box-health-row is-${check.level}`}>
      <span className="box-health-row-icon" aria-hidden="true">
        <Icon />
        <span className="box-health-row-badge">
          <LevelIcon />
        </span>
      </span>
      <div className="box-health-row-copy">
        <strong>{checkLabel(check.id)}</strong>
        <p>{checkSentence(check)}</p>
      </div>
      <span className="box-health-row-level">{t(`boxHealth.level.${check.level}`)}</span>
      {check.action && (
        <button
          type="button"
          className="box-health-row-action"
          onClick={() => onAction(check.action!)}
          disabled={busy}
        >
          {busy && <LoaderCircle className="box-health-spin" aria-hidden="true" />}
          {busy
            ? t('boxHealth.backupRunning')
            : tr(`boxHealth.action.${ACTION_KEYS[check.action]}`)}
        </button>
      )}
    </li>
  );
}

function BoxHealthSkeleton() {
  return (
    <div className="box-health-skeleton" role="status">
      <span className="box-health-sr">{t('boxHealth.loading')}</span>
      <div className="box-health-skeleton-banner" aria-hidden="true">
        <span />
        <div>
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="box-health-skeleton-groups" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index}>
            <i />
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Raw values, shown as the box gives them: for the helper on the phone, not for the family. */
function TechnicalValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="is-muted">—</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="is-muted">—</span>;
    if (value.every((item) => typeof item !== 'object' || item === null))
      return <pre className="box-health-log">{value.map(String).join('\n')}</pre>;
    const rows = value.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return (
      <div className="box-health-table-wrap">
        <table className="box-health-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column}>
                    {typeof row[column] === 'object' && row[column] !== null
                      ? JSON.stringify(row[column])
                      : String(row[column] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <dl className="box-health-dl">
      {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            <TechnicalValue value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TechnicalDetails({ report }: { report: BoxHealthReport }) {
  const technical = Object.entries(report.technical ?? {});
  const checks = allChecks(report);
  return (
    <details className="box-health-technical">
      <summary>
        <ServerCog aria-hidden="true" />
        <span>
          <strong>{t('boxHealth.technical.title')}</strong>
          <small>{t('boxHealth.technical.hint')}</small>
        </span>
      </summary>
      <div className="box-health-technical-body">
        {technical.length > 0 ? (
          technical.map(([key, value]) => (
            <section key={key} className="box-health-technical-block">
              <h4>{key}</h4>
              <TechnicalValue value={value} />
            </section>
          ))
        ) : (
          <p className="is-muted">{t('boxHealth.technical.empty')}</p>
        )}
        <section className="box-health-technical-block">
          <h4>{t('boxHealth.technical.checks')}</h4>
          <div className="box-health-table-wrap">
            <table className="box-health-table">
              <tbody>
                {checks.map((check) => (
                  <tr key={check.id}>
                    <th scope="row">
                      <code>{check.id}</code>
                    </th>
                    <td>
                      <span className={`box-health-pill is-${check.level}`}>
                        <span aria-hidden="true" />
                        {check.level}
                      </span>
                    </td>
                    <td>
                      {check.detail ??
                        (Object.keys((check.params ?? {}) as object).length
                          ? JSON.stringify(check.params)
                          : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="box-health-technical-stamp">
          <code>checkedAt {report.checkedAt}</code>
        </p>
      </div>
    </details>
  );
}
