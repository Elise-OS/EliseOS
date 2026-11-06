import type { UpdateStatus } from '@elise/contracts';
import { Button } from '@elise/ui';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  Cpu,
  Download,
  KeyRound,
  LoaderCircle,
  PackageCheck,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Locale, t } from './i18n';

interface UpdateCardProps {
  locale: Locale;
  status: UpdateStatus | null;
  busy: boolean;
  onCheck: () => void;
  onSaveCredentials: (username: string, token: string) => void;
  onDeleteCredentials: () => void;
  onInstall: (version: string) => void;
}

type UpdateTone = 'ok' | 'new' | 'busy' | 'warn' | 'idle';

const terminalStates = new Set<UpdateStatus['state']>([
  'UP_TO_DATE',
  'AVAILABLE',
  'SUCCEEDED',
  'ROLLED_BACK',
  'FAILED',
  'UNCONFIGURED',
]);

/** The four stages an installation walks through, in order. */
const installSteps = [
  { state: 'DOWNLOADING', icon: Download, label: 'updateCard.stepDownload' },
  { state: 'INSTALLING', icon: Cpu, label: 'updateCard.stepInstall' },
  { state: 'VERIFYING', icon: ShieldCheck, label: 'updateCard.stepVerify' },
  { state: 'RESTARTING', icon: Power, label: 'updateCard.stepRestart' },
] as const satisfies ReadonlyArray<{
  state: UpdateStatus['state'];
  icon: LucideIcon;
  label: string;
}>;

function toneOf(state: UpdateStatus['state'], running: boolean): UpdateTone {
  if (state === 'FAILED' || state === 'ROLLED_BACK') return 'warn';
  if (state === 'UP_TO_DATE' || state === 'SUCCEEDED') return 'ok';
  if (state === 'AVAILABLE') return 'new';
  if (state === 'UNCONFIGURED') return 'idle';
  return running ? 'busy' : 'idle';
}

function formatCheckedAt(value: string | null | undefined, locale: Locale) {
  if (!value) return t('updateCard.neverChecked');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function UpdateCard({
  locale,
  status,
  busy,
  onCheck,
  onSaveCredentials,
  onDeleteCredentials,
  onInstall,
}: UpdateCardProps) {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const state = status?.state ?? 'CHECKING';
  const running = busy || !terminalStates.has(state);
  const available = Boolean(status?.updateAvailable && status.latestVersion);
  const tone = toneOf(state, running);
  const stepIndex = installSteps.findIndex((step) => step.state === state);
  const installing = stepIndex >= 0;
  const progress = status?.progress ?? null;

  useEffect(() => {
    if (status?.authConfigured) setCredentialsOpen(false);
  }, [status?.authConfigured]);

  const stateLabel: Record<UpdateStatus['state'], string> = {
    UNCONFIGURED: t('updateCard.accountNeeded'),
    CHECKING: t('updateCard.checking'),
    UP_TO_DATE: t('updateCard.upToDate'),
    AVAILABLE: t('updateCard.updateAvailable'),
    DOWNLOADING: t('updateCard.downloading'),
    INSTALLING: t('updateCard.installing'),
    VERIFYING: t('updateCard.verifying'),
    RESTARTING: t('updateCard.restarting'),
    SUCCEEDED: t('updateCard.updateComplete'),
    ROLLED_BACK: t('updateCard.rolledBack'),
    FAILED: t('updateCard.failed'),
  };

  const hint = (() => {
    if (installing) return t('updateCard.inProgressHint');
    switch (state) {
      case 'UNCONFIGURED':
        return t('updateCard.accountNeededHint');
      case 'CHECKING':
        return t('updateCard.checkingHint');
      case 'UP_TO_DATE':
        return t('updateCard.upToDateHint');
      case 'AVAILABLE':
        return t('updateCard.availableHint');
      case 'SUCCEEDED':
        return t('updateCard.succeededHint');
      case 'ROLLED_BACK':
        return t('updateCard.rolledBackHint');
      default:
        return t('updateCard.failedHint');
    }
  })();

  const HeroIcon: LucideIcon =
    tone === 'ok'
      ? Check
      : tone === 'new'
        ? Sparkles
        : tone === 'warn'
          ? state === 'ROLLED_BACK'
            ? RotateCcw
            : CircleAlert
          : tone === 'busy'
            ? (installSteps[stepIndex]?.icon ?? RefreshCw)
            : KeyRound;

  // Ring around the hero icon: real progress while installing, a gentle spinner otherwise.
  const ringRadius = 42;
  const ringLength = 2 * Math.PI * ringRadius;
  const ringValue = tone === 'ok' ? 100 : installing && progress != null ? progress : null;

  const confirmInstall = () => {
    if (!status?.latestVersion) return;
    if (
      window.confirm(
        t('updateCard.installNowEliseWillBriefly', { latestVersion: status.latestVersion }),
      )
    ) {
      onInstall(status.latestVersion);
    }
  };

  return (
    <details
      className={`elise-card settings-section-card settings-disclosure update-card update-card--${tone}`}
      data-testid="update-card"
    >
      <summary className="settings-section-heading update-card-heading">
        <span className="settings-section-icon settings-section-icon--blue update-card-badge">
          <Download />
          {available && <span className="update-card-badge-dot" aria-hidden="true" />}
        </span>
        <div>
          <span className="eyebrow">{t('updateCard.deviceMaintenance')}</span>
          <h2>{t('updateCard.eliseOsUpdates')}</h2>
          <p>
            {status?.currentVersion
              ? `${t('updateCard.installedVersion')} · ${status.currentVersion}`
              : t('updateCard.eachVersionIsVerifiedBefore')}
          </p>
        </div>
        <span className={`update-state update-state--${state.toLowerCase()}`} role="status">
          {running ? (
            <LoaderCircle className="spin" />
          ) : tone === 'ok' ? (
            <Check />
          ) : tone === 'warn' ? (
            <CircleAlert />
          ) : tone === 'new' ? (
            <Sparkles />
          ) : null}
          {stateLabel[state]}
        </span>
        <span className="settings-disclosure-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      </summary>

      <div className="update-card-body">
        <section className={`update-hero update-hero--${tone}`}>
          <div className="update-hero-orb" aria-hidden="true">
            <svg className="update-hero-ring" viewBox="0 0 100 100">
              <circle className="update-hero-ring-track" cx="50" cy="50" r={ringRadius} />
              <circle
                className={`update-hero-ring-value${ringValue == null && running ? ' is-indeterminate' : ''}`}
                cx="50"
                cy="50"
                r={ringRadius}
                strokeDasharray={ringLength}
                strokeDashoffset={
                  ringValue == null
                    ? running
                      ? ringLength * 0.72
                      : ringLength
                    : ringLength * (1 - ringValue / 100)
                }
              />
            </svg>
            <span className="update-hero-icon">
              <HeroIcon />
            </span>
          </div>

          <div className="update-hero-copy">
            <h3>{stateLabel[state]}</h3>
            <p>{hint}</p>
            <ul className="update-hero-meta">
              {status?.currentVersion && (
                <li>
                  <PackageCheck />
                  <span>{t('updateCard.installedVersion')}</span>
                  <strong>{status.currentVersion}</strong>
                </li>
              )}
              <li>
                <Clock />
                <span>{t('updateCard.lastChecked')}</span>
                <strong>{formatCheckedAt(status?.checkedAt, locale)}</strong>
              </li>
            </ul>
          </div>

          <div className="update-hero-actions">
            {available && !installing && (
              <Button className="update-install-button" onClick={confirmInstall} disabled={running}>
                <Download /> {t('updateCard.install', { latestVersion: status?.latestVersion })}
              </Button>
            )}
            {state === 'SUCCEEDED' && (
              // This page still runs the previous dashboard until it reloads.
              <Button className="update-install-button" onClick={() => window.location.reload()}>
                <RefreshCw /> {t('updateCard.openTheNewVersion')}
              </Button>
            )}
            <Button className="button-secondary" onClick={onCheck} disabled={running}>
              <RefreshCw className={state === 'CHECKING' ? 'spin' : undefined} />{' '}
              {t('updateCard.checkNow')}
            </Button>
          </div>
        </section>

        {installing && (
          <section className="update-steps" aria-label={t('updateCard.updateProgress')}>
            <ol>
              {installSteps.map((step, index) => {
                const Icon = step.icon;
                const phase =
                  index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'upcoming';
                return (
                  <li key={step.state} className={`update-step update-step--${phase}`}>
                    <span className="update-step-dot">
                      {phase === 'done' ? <Check /> : <Icon />}
                    </span>
                    <span className="update-step-label">{t(step.label)}</span>
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
          </section>
        )}

        {available && status?.latestVersion && (
          <section className="update-release">
            <div className="update-release-versions">
              <div className="update-version-chip">
                <small>{t('updateCard.currentLabel')}</small>
                <strong>{status.currentVersion}</strong>
              </div>
              <ArrowRight className="update-release-arrow" aria-hidden="true" />
              <div className="update-version-chip update-version-chip--next">
                <small>{t('updateCard.nextLabel')}</small>
                <strong>{status.latestVersion}</strong>
              </div>
            </div>
            {status.releaseNotes && (
              <div className="update-release-notes">
                <span className="update-release-title">
                  <Sparkles /> {t('updateCard.whatsNew')}
                </span>
                <p>{status.releaseNotes}</p>
              </div>
            )}
          </section>
        )}

        {status?.message && (
          <p className="update-card-notice update-card-notice--info">
            <Check /> {status.message}
          </p>
        )}
        {status?.error && (
          <p className="update-card-notice update-card-notice--error" role="alert">
            <CircleAlert /> {status.error}
          </p>
        )}

        <div className="update-safety">
          <span className="update-safety-icon">
            <ShieldCheck />
          </span>
          <div>
            <strong>{t('updateCard.safeUpdates')}</strong>
            <p>{t('updateCard.eachVersionIsVerifiedBefore')}</p>
          </div>
        </div>

        {/* The public repository needs no account; the bot only unlocks a private one. */}
        {(state === 'UNCONFIGURED' || status?.authConfigured) && (
          <details
            className="update-credentials"
            open={credentialsOpen || state === 'UNCONFIGURED'}
            onToggle={(event) => setCredentialsOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="update-credentials-icon">
                <KeyRound />
              </span>
              <span>
                {status?.authConfigured
                  ? t('updateCard.changeDownloadAccount')
                  : t('updateCard.configureDownloadAccount')}
                {status?.authUsername && <small>{status.authUsername}</small>}
              </span>
              <ChevronRight className="update-credentials-chevron" />
            </summary>
            <div className="update-credentials-body">
              <p>{t('updateCard.theTokenStaysOnThis')}</p>
              <div className="update-credentials-fields">
                <label>
                  {t('updateCard.botAccountName')}
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="elise-os-bot"
                  />
                </label>
                <label>
                  {t('updateCard.githubToken')}
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="new-password"
                    placeholder="ghp_…"
                  />
                </label>
              </div>
              <div className="update-credentials-actions">
                <Button
                  onClick={() => {
                    onSaveCredentials(username, token);
                    setToken('');
                  }}
                  disabled={!username.trim() || !token.trim() || busy}
                >
                  <ShieldCheck /> {t('updateCard.save')}
                </Button>
                {status?.authConfigured && (
                  <Button
                    className="button-secondary"
                    onClick={onDeleteCredentials}
                    disabled={busy}
                  >
                    {t('updateCard.removeAccount')}
                  </Button>
                )}
              </div>
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
