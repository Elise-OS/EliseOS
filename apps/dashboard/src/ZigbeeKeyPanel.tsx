import {
  ZIGBEE_GUIDE_URL,
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
  zigbeeProbeResultSchema,
  zigbeeRecentResult,
  zigbeeServiceState,
  zigbeeStatusSchema,
  zigbeeUsbId,
  zigbeeVisibleIssues,
  type ZigbeeCandidate,
  type ZigbeeCurrent,
  type ZigbeeInstall,
  type ZigbeeInstallRequest,
  type ZigbeeOption,
  type ZigbeeStatus,
  type ZigbeeTechnology,
} from '@elise/contracts';
import { Button } from '@elise/ui';
import {
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Network,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  Settings2,
  ShieldCheck,
  Usb,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from './i18n';

type LoadError = 'unavailable' | 'forbidden' | 'network';

const installStepIcons: Record<string, LucideIcon> = {
  check: ScanSearch,
  backup: Save,
  configure: Settings2,
  restart: PlugZap,
  verify: ShieldCheck,
};

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

export function ZigbeeKeyPanel() {
  const [status, setStatus] = useState<ZigbeeStatus | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [scanning, setScanning] = useState(false);
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

  const scan = async (network: boolean) => {
    setScanning(true);
    setMessage('');
    try {
      setStatus(zigbeeStatusSchema.parse(await zigbeeRequest('/scan', 'POST', { network })));
      setLoadError(null);
    } catch (error) {
      if (error instanceof RequestFailure && error.kind !== 'refused') setLoadError(error.kind);
    } finally {
      setScanning(false);
    }
  };

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
      <section className="elise-card settings-section-card zigbee-key" data-testid="zigbee-key">
        {loadError ? (
          <ErrorBlock kind={loadError} onRetry={() => void refresh()} />
        ) : (
          <p className="zigbee-key-loading" role="status">
            <LoaderCircle className="spin" /> {t('zigbeeKey.loading')}
          </p>
        )}
      </section>
    );
  }

  const headline = zigbeeHeadline(status);
  const result = zigbeeRecentResult(status.install);
  const shownResult = result && result.finishedAt !== dismissedAt ? result : null;
  const others = zigbeeOtherKeys(status);
  const tone = installing ? 'busy' : headline.tone;
  const issues = zigbeeVisibleIssues(status.issues);
  const newKeys = status.state === 'NEW_KEY' ? others : [];
  const HeroIcon: LucideIcon = installing
    ? LoaderCircle
    : status.state === 'READY'
      ? Check
      : status.state === 'NEW_KEY'
        ? Usb
        : status.state === 'NO_KEY'
          ? PlugZap
          : CircleAlert;
  const title =
    headline.title === 'newKey'
      ? t('zigbeeKey.newKeyTitle', { count: Math.max(1, newKeys.length) })
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

  return (
    <section
      className={`elise-card settings-section-card update-card update-card--${tone} zigbee-key`}
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

      <div className="update-card-body">
        <section className={`update-hero update-hero--${tone}`}>
          <div className="update-hero-orb" aria-hidden="true">
            <svg className="update-hero-ring" viewBox="0 0 100 100">
              <circle className="update-hero-ring-track" cx="50" cy="50" r="42" />
              <circle
                className={`update-hero-ring-value${installing || tone === 'idle' ? ' is-indeterminate' : ''}`}
                cx="50"
                cy="50"
                r="42"
                strokeDasharray={2 * Math.PI * 42}
                strokeDashoffset={
                  tone === 'ok'
                    ? 0
                    : installing && status.install.progress != null
                      ? 2 * Math.PI * 42 * (1 - status.install.progress / 100)
                      : 2 * Math.PI * 42 * 0.72
                }
              />
            </svg>
            <span className="update-hero-icon">
              <HeroIcon className={installing ? 'spin' : undefined} />
            </span>
          </div>
          <div className="update-hero-copy">
            <h3>{title}</h3>
            <p>{t(`zigbeeKey.${headline.hint}`)}</p>
            {status.current && (
              <ul className="update-hero-meta">
                {status.current.model && (
                  <li>
                    <Cpu />
                    <span>{t('zigbeeKey.model')}</span>
                    <strong>{status.current.model.name}</strong>
                  </li>
                )}
                {status.current.deviceCount != null && (
                  <li>
                    <Network />
                    <span>{t('zigbeeKey.devices')}</span>
                    <strong>
                      {t('zigbeeKey.deviceCount', { count: status.current.deviceCount })}
                    </strong>
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="update-hero-actions">
            <Button
              className={
                status.state === 'NEW_KEY' || status.state === 'NO_KEY' ? '' : 'button-secondary'
              }
              onClick={() => void scan(false)}
              disabled={scanning || installing}
            >
              {scanning ? <LoaderCircle className="spin" /> : <ScanSearch />}{' '}
              {scanning ? t('zigbeeKey.detecting') : t('zigbeeKey.detect')}
            </Button>
            <Button
              className="button-secondary"
              onClick={() => void scan(true)}
              disabled={scanning || installing}
            >
              <Wifi /> {t('zigbeeKey.searchNetwork')}
            </Button>
          </div>
        </section>

        {!installing && !shownResult && (
          <p className="zigbee-key-watching">
            <RefreshCw /> {t('zigbeeKey.watching')}
          </p>
        )}

        {installing && (
          <InstallProgress install={status.install} onStop={() => void stopInstall()} />
        )}

        {shownResult && !installing && (
          <InstallResult
            install={shownResult}
            onDismiss={() => setDismissedAt(shownResult.finishedAt)}
            onRetry={startInstall}
            onAdvanced={() => setAdvancedOpen(true)}
            current={status.current}
          />
        )}

        {message && !installing && (
          <p className="update-card-notice update-card-notice--error" role="alert">
            <CircleAlert /> {message}
          </p>
        )}

        {issues.map((issue) => (
          <p key={issue} className="update-card-notice update-card-notice--warn">
            <CircleAlert /> {t(`zigbeeKey.issue.${issue}`)}
            {issue === 'firmware-old' && (
              <a href={ZIGBEE_GUIDE_URL} target="_blank" rel="noreferrer">
                {t('zigbeeKey.firmwareGuide')} <ExternalLink />
              </a>
            )}
          </p>
        ))}
        {status.issues.includes('multiple-keys') && (
          <p className="update-card-notice update-card-notice--warn">
            <CircleAlert /> {t('zigbeeKey.multipleHint')}
          </p>
        )}

        {status.current && <CurrentKey current={status.current} />}

        {!installing && others.length > 0 && (
          <section className="zigbee-key-found">
            {status.current?.present && (
              <header>
                <h3>{t('zigbeeKey.otherKeyTitle')}</h3>
                <p>{t('zigbeeKey.otherKeyHint')}</p>
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

function ErrorBlock({ kind, onRetry }: { kind: LoadError; onRetry: () => void }) {
  return (
    <div className="zigbee-key-error">
      <span className="settings-section-icon settings-section-icon--blue">
        <CircleAlert />
      </span>
      <div>
        <h3>{kind === 'forbidden' ? t('zigbeeKey.title') : t('zigbeeKey.unavailableTitle')}</h3>
        <p>{kind === 'forbidden' ? t('zigbeeKey.managersOnly') : t('zigbeeKey.unavailableText')}</p>
      </div>
      {kind !== 'forbidden' && (
        <Button className="button-secondary" onClick={onRetry}>
          <RefreshCw /> {t('zigbeeKey.retry')}
        </Button>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="zigbee-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function technologyLabel(technology: string) {
  return technologies.includes(technology as ZigbeeTechnology)
    ? t(`zigbeeKey.tech.${technology as ZigbeeTechnology}`)
    : technology;
}

function CurrentKey({ current }: { current: ZigbeeCurrent }) {
  const service = zigbeeServiceState(current);
  const serviceLabel = {
    running: t('zigbeeKey.serviceRunning'),
    starting: t('zigbeeKey.serviceStarting'),
    stopped: t('zigbeeKey.serviceStopped'),
    unknown: t('zigbeeKey.serviceUnknown'),
  }[service];
  const notes = zigbeeKnownNotes(current.model?.notes ?? []);
  const coordinator = current.coordinator;
  return (
    <section className="zigbee-key-current" aria-label={t('zigbeeKey.currentKey')}>
      <header>
        <span className="zigbee-key-badge zigbee-key-badge--ok">{t('zigbeeKey.currentKey')}</span>
        {current.model && (
          <span className={`zigbee-key-badge zigbee-key-badge--${current.model.status}`}>
            {t(statusLabelKey(current.model.status))}
          </span>
        )}
      </header>
      <dl className="zigbee-facts">
        <Fact
          label={t('zigbeeKey.model')}
          value={current.model?.name ?? current.usb?.product ?? t('zigbeeKey.unknownModel')}
        />
        <Fact label={t('zigbeeKey.technology')} value={technologyLabel(current.adapter)} />
        <Fact label={t('zigbeeKey.chip')} value={current.model?.chip} />
        <div className="zigbee-fact">
          <dt>{t('zigbeeKey.service')}</dt>
          <dd className={`zigbee-service zigbee-service--${service}`}>
            <span aria-hidden="true" /> {serviceLabel}
          </dd>
        </div>
        <Fact
          label={t('zigbeeKey.devices')}
          value={
            current.deviceCount != null
              ? t('zigbeeKey.deviceCount', { count: current.deviceCount })
              : null
          }
        />
        <Fact
          label={t('zigbeeKey.channel')}
          value={coordinator?.channel != null ? String(coordinator.channel) : null}
        />
      </dl>
      {notes.length > 0 && (
        <ul className="zigbee-notes">
          {notes.map((note) => (
            <li key={note}>{t(`zigbeeKey.note.${note}`)}</li>
          ))}
        </ul>
      )}
      <details className="zigbee-technical">
        <summary>
          <ChevronRight aria-hidden="true" /> {t('zigbeeKey.technicalDetails')}
        </summary>
        <dl className="zigbee-facts zigbee-facts--technical">
          <Fact label={t('zigbeeKey.port')} value={current.port} />
          <Fact label={t('zigbeeKey.coordinatorType')} value={coordinator?.type} />
          <Fact label={t('zigbeeKey.firmware')} value={coordinator?.firmware} />
          <Fact label={t('zigbeeKey.panId')} value={coordinator?.panId} />
          <Fact label={t('zigbeeKey.extendedPanId')} value={coordinator?.extendedPanId} />
          <Fact label={t('zigbeeKey.ieee')} value={coordinator?.ieee} />
          <Fact
            label={t('zigbeeKey.advancedBaudrate')}
            value={current.baudrate != null ? String(current.baudrate) : null}
          />
          <Fact
            label={t('zigbeeKey.advancedRtscts')}
            value={current.rtscts != null ? (current.rtscts ? 'RTS/CTS' : '—') : null}
          />
        </dl>
      </details>
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
  const progress = install.progress;
  return (
    <section className="update-steps zigbee-steps" aria-label={t('zigbeeKey.stepsTitle')}>
      <ol>
        {install.steps.map((step) => {
          const Icon = installStepIcons[step.id] ?? Cpu;
          const phase =
            step.state === 'done' ? 'done' : step.state === 'running' ? 'current' : 'upcoming';
          return (
            <li key={step.id} className={`update-step update-step--${phase}`}>
              <span className="update-step-dot">{phase === 'done' ? <Check /> : <Icon />}</span>
              <span className="update-step-label">{t(`zigbeeKey.step.${step.id}`)}</span>
            </li>
          );
        })}
      </ol>
      {progress != null && (
        <div className="update-progress">
          <div
            className="update-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <strong>{progress}%</strong>
        </div>
      )}
      {install.target && (
        <p className="zigbee-steps-target">
          {install.target.modelName ?? install.target.port} ·{' '}
          {technologyLabel(install.target.adapter)}
        </p>
      )}
      <div className="zigbee-actions">
        <Button className="button-secondary" onClick={onStop}>
          {t('zigbeeKey.stop')}
        </Button>
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
      className={`zigbee-result zigbee-result--${succeeded ? 'ok' : cancelled ? 'idle' : 'warn'}`}
      role="status"
    >
      <span className="zigbee-result-icon" aria-hidden="true">
        {succeeded ? <Check /> : cancelled ? <RotateCcw /> : <CircleAlert />}
      </span>
      <div className="zigbee-result-copy">
        <h3>{title}</h3>
        <p>{text}</p>
        {!succeeded && install.errorCode && (
          <p className="zigbee-result-reason">
            {t(`zigbeeKey.error.${errorKey}`, { detail: install.detail ?? '' })}
          </p>
        )}
        {!succeeded && install.rolledBack && (
          <ol className="zigbee-rollback-steps">
            <li>
              <RotateCcw /> {t('zigbeeKey.step.rollback')}
            </li>
          </ol>
        )}
        {install.detail && !succeeded && (
          <details className="zigbee-technical">
            <summary>
              <ChevronRight aria-hidden="true" /> {t('zigbeeKey.technicalDetails')}
            </summary>
            <code>{install.detail}</code>
          </details>
        )}
        <div className="zigbee-actions">
          {install.errorCode === 'NETWORK_MISMATCH' && retry && (
            <Button className="button-secondary" onClick={() => setConfirmingNew(true)}>
              {t('zigbeeKey.retryNewNetwork')}
            </Button>
          )}
          {(install.errorCode === 'NO_ANSWER' || install.errorCode === 'WRONG_ADAPTER') && (
            <Button className="button-secondary" onClick={onAdvanced}>
              {t('zigbeeKey.openAdvanced')}
            </Button>
          )}
          <Button onClick={onDismiss}>
            {succeeded ? t('zigbeeKey.done') : t('zigbeeKey.dismiss')}
          </Button>
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
      </div>
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
    <div className="zigbee-confirm" role="group" aria-label={t('zigbeeKey.confirmTitle', { name })}>
      <h4>{t('zigbeeKey.confirmTitle', { name })}</h4>
      <p>{t('zigbeeKey.confirmText')}</p>
      {askMode && (
        <fieldset className="zigbee-network-choice">
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
            <label className="zigbee-understood">
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
      <div className="zigbee-actions">
        <Button className="button-secondary" onClick={onCancel}>
          {t('zigbeeKey.cancel')}
        </Button>
        <Button onClick={() => onConfirm(mode)} disabled={!ready}>
          <ShieldCheck /> {t('zigbeeKey.install')}
        </Button>
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
  const Icon = candidate.kind === 'network' ? Wifi : Usb;
  const chosen = identity.options.find((option) => zigbeeOptionKey(option) === choice) ?? null;
  const single = identity.options.length === 1 ? identity.options[0] : null;
  const proposal = single ?? chosen;

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
  return (
    <article className="zigbee-candidate" data-testid="zigbee-candidate">
      <header>
        <span className="zigbee-candidate-icon" aria-hidden="true">
          <Icon />
        </span>
        <div>
          <h4>{title}</h4>
          <p>
            {candidate.network
              ? t('zigbeeKey.networkKey', {
                  address: `${candidate.network.host}:${candidate.network.port}`,
                })
              : t('zigbeeKey.pluggedOn')}
          </p>
        </div>
        <span className="zigbee-badges">
          <span
            className={`zigbee-key-badge zigbee-key-badge--${
              identity.confidence === 'high'
                ? 'ok'
                : identity.confidence === 'unknown'
                  ? 'warn'
                  : 'new'
            }`}
          >
            {identity.confidence === 'high' || identity.confidence === 'medium'
              ? t('zigbeeKey.recognized')
              : identity.confidence === 'ambiguous'
                ? t('zigbeeKey.toConfirm')
                : t('zigbeeKey.unknownKey')}
          </span>
          {identity.status && (
            <span className={`zigbee-key-badge zigbee-key-badge--${identity.status}`}>
              {t(statusLabelKey(identity.status))}
            </span>
          )}
        </span>
      </header>

      {identity.confidence !== 'unknown' && identity.chip && (
        <p className="zigbee-candidate-meta">
          {identity.chip}
          {proposal && ` · ${technologyLabel(proposal.technology)}`}
        </p>
      )}

      {needsChoice && (
        <div className="zigbee-ambiguous">
          <p>{t('zigbeeKey.ambiguousExplain')}</p>
          {probeNotice !== 'silent' && (
            <Button className="button-secondary" onClick={() => void identify()} disabled={probing}>
              {probing ? <LoaderCircle className="spin" /> : <ScanSearch />}{' '}
              {probing ? t('zigbeeKey.identifying') : t('zigbeeKey.identify')}
            </Button>
          )}
          {probeNotice === 'silent' && (
            <fieldset className="zigbee-options">
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
        </div>
      )}

      {probeNotice === 'answered' && installable && (
        <p className="update-card-notice update-card-notice--info">
          <Check />{' '}
          {single?.modelName
            ? t('zigbeeKey.identified', { name: single.modelName })
            : t('zigbeeKey.identifiedGeneric', {
                technology: technologyLabel(single?.technology ?? ''),
              })}
        </p>
      )}

      {identity.confidence === 'unknown' && (
        <div className="zigbee-ambiguous">
          <p>{t('zigbeeKey.unknownExplain', { id: usbId ?? '—' })}</p>
          <Button className="button-secondary" onClick={onAdvanced}>
            <Settings2 /> {t('zigbeeKey.openAdvanced')}
          </Button>
        </div>
      )}

      {candidate.busy && (
        <p className="update-card-notice update-card-notice--warn">
          <CircleAlert /> {t('zigbeeKey.busyBy', { by: candidate.busy.by })}
        </p>
      )}
      {candidate.portStability === 'by-path' && (
        <p className="update-card-notice update-card-notice--warn">
          <CircleAlert /> {t('zigbeeKey.stabilityByPath')}
        </p>
      )}
      {candidate.portStability === 'raw' && (
        <p className="update-card-notice update-card-notice--warn">
          <CircleAlert /> {t('zigbeeKey.stabilityRaw')}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="zigbee-notes">
          {notes.map((note) => (
            <li key={note}>{t(`zigbeeKey.note.${note}`)}</li>
          ))}
        </ul>
      )}

      {proposal && !candidate.busy && !confirming && (
        <div className="zigbee-actions">
          <Button disabled={busy} onClick={() => setConfirming(proposal)}>
            <PlugZap /> {replacing ? t('zigbeeKey.useKeyInstead') : t('zigbeeKey.useKey')}
          </Button>
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

  const test = async () => {
    setTesting(true);
    setAddressResult(null);
    try {
      zigbeeProbeResultSchema.parse(
        await zigbeeRequest('/network/test', 'POST', { host: address.trim(), port: 6638 }),
      );
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
        <ChevronRight className="update-credentials-chevron" />
      </summary>
      <div className="zigbee-advanced-body">
        <div className="zigbee-fields">
          <label>
            {t('zigbeeKey.advancedPort')}
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
            <label>
              {t('zigbeeKey.advancedCustomPort')}
              <input
                value={customPort}
                onChange={(event) => setCustomPort(event.target.value)}
                placeholder={t('zigbeeKey.advancedPortPlaceholder')}
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
          )}
          <label>
            {t('zigbeeKey.advancedAdapter')}
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
          <label>
            {t('zigbeeKey.advancedBaudrate')}
            <select value={baudrate} onChange={(event) => setBaudrate(Number(event.target.value))}>
              {baudrates.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>
          </label>
          <label className="zigbee-checkbox">
            <input
              type="checkbox"
              checked={rtscts}
              onChange={(event) => setRtscts(event.target.checked)}
            />
            <span>{t('zigbeeKey.advancedRtscts')}</span>
          </label>
        </div>

        <div className="zigbee-actions">
          {!confirming ? (
            <Button disabled={!canInstall} onClick={() => setConfirming(true)}>
              <ShieldCheck /> {t('zigbeeKey.advancedInstall')}
            </Button>
          ) : (
            <InstallConfirm
              name={selected ? (zigbeeCandidateTitle(selected) ?? selected.port) : customPort}
              hasCurrent={Boolean(status.current)}
              onCancel={() => setConfirming(false)}
              onConfirm={() => void install()}
            />
          )}
        </div>

        <div className="zigbee-fields zigbee-network-address">
          <label>
            {t('zigbeeKey.networkAddress')}
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t('zigbeeKey.networkPlaceholder')}
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <Button
            className="button-secondary"
            disabled={!address.trim() || testing}
            onClick={() => void test()}
          >
            {testing ? <LoaderCircle className="spin" /> : <Wifi />}{' '}
            {testing ? t('zigbeeKey.testing') : t('zigbeeKey.testAddress')}
          </Button>
        </div>
        {addressResult && (
          <p
            className={`update-card-notice update-card-notice--${addressResult === 'ok' ? 'info' : 'error'}`}
            role="status"
          >
            {addressResult === 'ok' ? <Check /> : <CircleAlert />}{' '}
            {addressResult === 'ok' ? t('zigbeeKey.addressOk') : t('zigbeeKey.addressFail')}
          </p>
        )}
        {networkKeys.map((candidate) => (
          <p key={candidate.id} className="zigbee-forget">
            <Wifi /> {candidate.port}
            <button type="button" onClick={() => void forget(candidate.id)}>
              {t('zigbeeKey.forget')}
            </button>
          </p>
        ))}
      </div>
    </details>
  );
}
