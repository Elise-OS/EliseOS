import type { UpdateStatus } from '@elise/contracts';
import { Button } from '@elise/ui';
import {
  Check,
  CircleAlert,
  ChevronRight,
  Download,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
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

const terminalStates = new Set<UpdateStatus['state']>([
  'UP_TO_DATE',
  'AVAILABLE',
  'SUCCEEDED',
  'ROLLED_BACK',
  'FAILED',
  'UNCONFIGURED',
]);

export function UpdateCard({
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
  const available = status?.updateAvailable && status.latestVersion;

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

  return (
    <details
      className="elise-card settings-section-card settings-disclosure update-card"
      data-testid="update-card"
    >
      <summary className="settings-section-heading update-card-heading">
        <span className="settings-section-icon settings-section-icon--blue">
          <Download />
        </span>
        <div>
          <span className="eyebrow">{t('updateCard.deviceMaintenance')}</span>
          <h2>{t('updateCard.eliseOsUpdates')}</h2>
          <p>{t('updateCard.eachVersionIsVerifiedBefore')}</p>
        </div>
        <span className={`update-state update-state--${state.toLowerCase()}`} role="status">
          {state === 'UP_TO_DATE' || state === 'SUCCEEDED' ? <Check /> : null}
          {state === 'FAILED' || state === 'ROLLED_BACK' ? <CircleAlert /> : null}
          {running ? <LoaderCircle className="spin" /> : null}
          {stateLabel[state]}
        </span>
        <span className="settings-disclosure-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      </summary>

      <div className="update-card-body">
        <div className="update-card-status">
          {status?.currentVersion && (
            <small>
              {t('updateCard.installedVersion')}: {status.currentVersion}
            </small>
          )}
          {status?.checkedAt && (
            <small>
              {t('updateCard.lastChecked')}: {status.checkedAt}
            </small>
          )}
          {status?.progress != null && running && (
            <div className="update-progress" aria-label={t('updateCard.updateProgress')}>
              <progress max={100} value={status.progress} />
              <span>{status.progress}%</span>
            </div>
          )}
        </div>

        <div className="update-card-actions">
          <Button className="button-secondary" onClick={onCheck} disabled={running}>
            <RefreshCw /> {t('updateCard.checkNow')}
          </Button>
          {available && (
            <Button
              onClick={() => {
                if (
                  window.confirm(
                    t('updateCard.installNowEliseWillBriefly', {
                      latestVersion: status.latestVersion,
                    }),
                  )
                ) {
                  onInstall(status.latestVersion!);
                }
              }}
              disabled={running}
            >
              <Download /> {t('updateCard.install', { latestVersion: status.latestVersion })}
            </Button>
          )}
          {state === 'SUCCEEDED' && (
            // This page still runs the previous dashboard until it reloads.
            <Button onClick={() => window.location.reload()}>
              <RefreshCw /> {t('updateCard.openTheNewVersion')}
            </Button>
          )}
        </div>

        {status?.latestVersion && status.updateAvailable && (
          <div className="update-release-notes">
            <strong>{t('updateCard.version', { latestVersion: status.latestVersion })}</strong>
            {status.releaseNotes && <p>{status.releaseNotes}</p>}
          </div>
        )}

        {status?.message && <p className="update-card-message">{status.message}</p>}
        {status?.error && <p className="update-card-error">{status.error}</p>}

        {/* The public repository needs no account; the bot only unlocks a private one. */}
        {(state === 'UNCONFIGURED' || status?.authConfigured) && (
          <details
            className="update-credentials"
            open={credentialsOpen || state === 'UNCONFIGURED'}
            onToggle={(event) => setCredentialsOpen(event.currentTarget.open)}
          >
            <summary>
              <KeyRound />
              {status?.authConfigured
                ? t('updateCard.changeDownloadAccount')
                : t('updateCard.configureDownloadAccount')}
            </summary>
            <p>{t('updateCard.theTokenStaysOnThis')}</p>
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
                <Button className="button-secondary" onClick={onDeleteCredentials} disabled={busy}>
                  {t('updateCard.removeAccount')}
                </Button>
              )}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
