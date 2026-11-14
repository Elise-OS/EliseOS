import { boxHealthReportSchema, type BoxHealthAction, type BoxHealthCheck } from '@elise/contracts';
import {
  Activity,
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
  Workflow,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTION_KEYS,
  allChecks,
  backupProgress,
  bannerMessage,
  bannerTone,
  countLevels,
  groupKey,
  isKnownCheck,
  isUsableSentence,
  orderedGroups,
  readCheck,
  readReport,
  refreshDelay,
  sentenceKeys,
  showsAction,
  watchBackup,
  worstLevel,
  type BackupWatch,
  type BoxHealthLevel,
  type BoxHealthReport,
  type BoxHealthTone,
} from './box-health-view';
import { dateLocale, t } from './i18n';
import './box-health.css';

type LoadError = 'unavailable' | 'forbidden' | 'network';
type Notice =
  'backupStarted' | 'backupDone' | 'backupEndedFailed' | 'backupFailed' | 'backupTimeout';

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
  if (response.status === 401 || response.status === 403)
    throw new RequestFailure('forbidden', message);
  if (response.status === 404 || response.status === 501 || response.status === 503)
    throw new RequestFailure('unavailable', message);
  // A backup already on its way is not a failure for the family.
  if (response.status === 409) return payload;
  throw new RequestFailure(response.status === 400 ? 'refused' : 'network', message);
}

/** Catalog keys built at run time (check ids come from the box). */
const tr = t as unknown as (key: string, options?: Record<string, unknown>) => string;

const groupIcons: Record<string, LucideIcon> = {
  surveillance: Eye,
  home: House,
  notifications: BellRing,
  box: Cpu,
  data: Database,
  access: KeyRound,
};

const checkIcons: Record<string, LucideIcon> = {
  worker: Workflow,
  zigbee: Usb,
  sensors: Radar,
  notifications: Send,
  outbox: Inbox,
  disk: HardDrive,
  swap: MemoryStick,
  temperature: Thermometer,
  throttling: Gauge,
  containers: Boxes,
  'disk-errors': TriangleAlert,
  backup: DatabaseBackup,
  database: Database,
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

/** A familiar sentence for a point; when a value it needs is missing, a plainer one. */
export function checkSentence(check: BoxHealthCheck, now = Date.now()): string {
  const reading = readCheck(check, now);
  const values: Record<string, unknown> = { ...reading.values };
  if (reading.duration)
    values.duration = tr(`boxHealth.duration.${reading.duration.unit}`, {
      count: reading.duration.count,
    });
  if (reading.size)
    values.size = tr(`boxHealth.size.${reading.size.unit}`, {
      value: new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(
        reading.size.value,
      ),
    });
  for (const key of sentenceKeys(check, reading)) {
    const text = tr(key, values);
    if (isUsableSentence(text, key)) return text;
  }
  return tr(`boxHealth.generic.${reading.level}`, { label: checkLabel(check.id) });
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
  const [rawReport, setRawReport] = useState<BoxHealthReport | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [checking, setChecking] = useState(false);
  const [backupSending, setBackupSending] = useState(false);
  const [backupWatch, setBackupWatch] = useState<BackupWatch | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const alive = useRef(true);
  const lastFetch = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const report = useMemo(() => (rawReport ? readReport(rawReport) : null), [rawReport]);
  const backupRunning = backupSending || backupWatch !== null;

  const refresh = useCallback((): Promise<void> => {
    // One question at a time: a click during an automatic check waits for the same answer.
    if (inFlight.current) return inFlight.current;
    const pending = (async () => {
      try {
        const parsed = boxHealthReportSchema.safeParse(await boxHealthRequest(''));
        // An answer the screen cannot read is not a good answer.
        if (!parsed.success) throw new RequestFailure('network');
        if (!alive.current) return;
        setRawReport(parsed.data);
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

  // The family hears when the backup they started is over (or taking longer than expected).
  useEffect(() => {
    if (!backupWatch || backupSending) return;
    const progress = backupProgress(backupWatch, rawReport);
    if (progress === 'running') return;
    setBackupWatch(null);
    setNotice(
      progress === 'done'
        ? 'backupDone'
        : progress === 'failed'
          ? 'backupEndedFailed'
          : 'backupTimeout',
    );
  }, [rawReport, backupWatch, backupSending]);

  const checkNow = async () => {
    setChecking(true);
    if (!backupRunning) setNotice(null);
    await refresh();
    if (alive.current) setChecking(false);
  };

  const runBackup = async () => {
    if (backupRunning) return;
    setBackupSending(true);
    setNotice(null);
    const watch = watchBackup(rawReport);
    try {
      await boxHealthRequest('/backup', 'POST');
      if (!alive.current) return;
      setBackupWatch(watch);
      setNotice('backupStarted');
    } catch {
      if (alive.current) setNotice('backupFailed');
    }
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
  const attention = (counts?.warning ?? 0) + (counts?.critical ?? 0) + (counts?.unknown ?? 0);

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
                : tr(`boxHealth.verdict.${message}.text`, { count: attention })}
            </p>
            <p className="box-health-verdict-meta">
              <Clock3 aria-hidden="true" />
              <span>
                {failed
                  ? report
                    ? t('boxHealth.lastKnown', { when })
                    : t('boxHealth.neverChecked')
                  : t('boxHealth.checkedAt', { when })}
              </span>
              <span aria-hidden="true">·</span>
              <span>{t('boxHealth.autoRefresh')}</span>
            </p>
            {counts && !failed && (
              <ul className="box-health-counts" aria-label={t('boxHealth.summary')}>
                {(['critical', 'warning', 'unknown', 'ok'] as const)
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
          className={`box-health-notice${
            notice === 'backupFailed' || notice === 'backupEndedFailed' ? ' is-error' : ''
          }${notice === 'backupDone' ? ' is-done' : ''}`}
          role={notice === 'backupFailed' || notice === 'backupEndedFailed' ? 'alert' : 'status'}
        >
          {notice === 'backupFailed' || notice === 'backupEndedFailed' ? (
            <TriangleAlert aria-hidden="true" />
          ) : notice === 'backupDone' ? (
            <CircleCheck aria-hidden="true" />
          ) : notice === 'backupTimeout' ? (
            <Clock3 aria-hidden="true" />
          ) : (
            <LoaderCircle className="box-health-spin" aria-hidden="true" />
          )}
          <span>{t(`boxHealth.${notice}`)}</span>
        </p>
      )}

      {report && (
        <div
          className={`box-health-groups${failed ? ' is-stale' : ''}`}
          aria-label={failed ? t('boxHealth.staleLabel') : undefined}
        >
          {balancedColumns(orderedGroups(report)).map((column, columnIndex) => (
            <div key={columnIndex} className="box-health-column">
              {column.map(({ group, order }) => {
                const key = groupKey(group.id);
                const GroupIcon = (key && groupIcons[key]) || Activity;
                const level = worstLevel(group.checks);
                return (
                  <section
                    key={group.id}
                    style={{ order }}
                    className={`box-health-group is-${level}`}
                    aria-labelledby={`box-health-group-${group.id}`}
                  >
                    <header>
                      <span className="box-health-group-icon" aria-hidden="true">
                        <GroupIcon />
                      </span>
                      <div>
                        <h3 id={`box-health-group-${group.id}`}>
                          {key ? tr(`boxHealth.group.${key}.title`) : t('boxHealth.group.other')}
                        </h3>
                        {key && <p>{tr(`boxHealth.group.${key}.hint`)}</p>}
                      </div>
                      <LevelPill level={level} />
                    </header>
                    <ul>
                      {group.checks.map((check, index) => (
                        <CheckRow
                          key={`${check.id}-${index}`}
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
          ))}
        </div>
      )}

      {report && <TechnicalDetails report={report} raw={rawReport ?? report} />}
    </section>
  );
}

type Group = BoxHealthReport['groups'][number];

/**
 * Two columns filled by height (each group goes under the shorter one), so short cards never
 * leave holes. On narrow screens the columns melt away and `order` keeps the reading order.
 */
function balancedColumns(groups: Group[]): { group: Group; order: number }[][] {
  const left: { group: Group; order: number }[] = [];
  const right: { group: Group; order: number }[] = [];
  let leftHeight = 0;
  let rightHeight = 0;
  groups.forEach((group, order) => {
    const height =
      1.6 + group.checks.reduce((sum, check) => sum + (showsAction(check) ? 1.5 : 1), 0);
    if (rightHeight < leftHeight) {
      right.push({ group, order });
      rightHeight += height;
    } else {
      left.push({ group, order });
      leftHeight += height;
    }
  });
  return [left, right].filter((column) => column.length > 0);
}

function LevelPill({ level }: { level: BoxHealthLevel }) {
  const Icon = levelIcons[level];
  return (
    <span className={`box-health-pill is-${level}`}>
      <Icon aria-hidden="true" />
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
  const action = showsAction(check) ? check.action : undefined;
  return (
    <li className={`box-health-row is-${check.level}`}>
      <span className="box-health-row-icon" aria-hidden="true">
        <Icon />
        <span className="box-health-row-badge">
          <LevelIcon />
        </span>
      </span>
      <div className="box-health-row-copy">
        <div className="box-health-row-head">
          <strong>{checkLabel(check.id)}</strong>
          <span className="box-health-row-level">{t(`boxHealth.level.${check.level}`)}</span>
        </div>
        <p>{checkSentence(check)}</p>
      </div>
      {action && (
        <button
          type="button"
          className="box-health-row-action"
          onClick={() => onAction(action)}
          disabled={busy}
        >
          {busy && <LoaderCircle className="box-health-spin" aria-hidden="true" />}
          {busy ? t('boxHealth.backupRunning') : tr(`boxHealth.action.${ACTION_KEYS[action]}`)}
          {!busy && action !== 'run-backup' && <ChevronRight aria-hidden="true" />}
        </button>
      )}
    </li>
  );
}

function BoxHealthSkeleton() {
  return (
    <div className="box-health-skeleton" role="status">
      <div className="box-health-skeleton-banner">
        <span className="box-health-skeleton-icon" aria-hidden="true">
          <LoaderCircle className="box-health-spin" />
        </span>
        <div>
          <p className="box-health-skeleton-label">{t('boxHealth.loading')}</p>
          <i aria-hidden="true" />
          <i aria-hidden="true" />
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

const scalar = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
};

/** Raw values, shown as the box gives them: for the helper on the phone, not for the family. */
function TechnicalValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="is-muted">—</span>;
  if (typeof value !== 'object') return <span>{scalar(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="is-muted">—</span>;
    if (value.every((item) => typeof item !== 'object' || item === null))
      return <pre className="box-health-log">{value.map(scalar).join('\n')}</pre>;
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
                  <td key={column}>{scalar(row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <span className="is-muted">—</span>;
  return (
    <dl className="box-health-dl">
      {entries.map(([key, item]) => (
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

/** Raw params of every check, as the box sent them (levels before the screen's reading). */
function TechnicalDetails({ report, raw }: { report: BoxHealthReport; raw: BoxHealthReport }) {
  const shown = allChecks(report);
  const sent = allChecks(raw);
  return (
    <details className="box-health-technical">
      <summary>
        <ServerCog aria-hidden="true" />
        <span>
          <strong>{t('boxHealth.technical.title')}</strong>
          <small>{t('boxHealth.technical.hint')}</small>
        </span>
        <ChevronRight className="box-health-technical-chevron" aria-hidden="true" />
      </summary>
      <div className="box-health-technical-body">
        {sent.map((check, index) => (
          <section key={`${check.id}-${index}`} className="box-health-technical-block">
            <header>
              <code>{check.id}</code>
              <span className={`box-health-pill is-${check.level}`}>{check.level}</span>
              {shown[index] && shown[index].level !== check.level && (
                <span className={`box-health-pill is-${shown[index].level}`}>
                  {t('boxHealth.technical.shownAs', { level: shown[index].level })}
                </span>
              )}
              {check.action && <code className="is-muted">{check.action}</code>}
            </header>
            {check.detail && <p>{check.detail}</p>}
            <TechnicalValue value={check.params} />
          </section>
        ))}
        <p className="box-health-technical-stamp">
          <code>checkedAt {report.checkedAt}</code>
        </p>
      </div>
    </details>
  );
}
