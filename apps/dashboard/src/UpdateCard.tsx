import type { UpdateStatus } from '@michel/contracts';
import { Button } from '@michel/ui';
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
import type { Locale } from './i18n';

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
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);
  const state = status?.state ?? 'CHECKING';
  const running = busy || !terminalStates.has(state);
  const available = status?.updateAvailable && status.latestVersion;

  useEffect(() => {
    if (status?.authConfigured) setCredentialsOpen(false);
  }, [status?.authConfigured]);

  const stateLabel: Record<UpdateStatus['state'], string> = {
    UNCONFIGURED: tr('Compte à configurer', 'Account needed'),
    CHECKING: tr('Vérification…', 'Checking…'),
    UP_TO_DATE: tr('À jour', 'Up to date'),
    AVAILABLE: tr('Mise à jour disponible', 'Update available'),
    DOWNLOADING: tr('Téléchargement…', 'Downloading…'),
    INSTALLING: tr('Installation…', 'Installing…'),
    VERIFYING: tr('Vérification…', 'Verifying…'),
    RESTARTING: tr('Redémarrage…', 'Restarting…'),
    SUCCEEDED: tr('Mise à jour terminée', 'Update complete'),
    ROLLED_BACK: tr('Retour à la version précédente', 'Rolled back'),
    FAILED: tr('Vérification impossible', 'Update check failed'),
  };

  return (
    <details
      className="michel-card settings-section-card settings-disclosure update-card"
      data-testid="update-card"
    >
      <summary className="settings-section-heading update-card-heading">
        <span className="settings-section-icon settings-section-icon--blue">
          <Download />
        </span>
        <div>
          <span className="eyebrow">{tr('Maintenance de l’appareil', 'Device maintenance')}</span>
          <h2>{tr('Mise à jour d’Élise OS', 'Élise OS updates')}</h2>
          <p>
            {tr(
              'Recevez les nouvelles versions et choisissez quand les installer sur cet appareil.',
              'See new versions and choose when to install them on this device.',
            )}
          </p>
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
              {tr('Version installée', 'Installed version')}: {status.currentVersion}
            </small>
          )}
          {status?.checkedAt && (
            <small>
              {tr('Dernière vérification', 'Last checked')}: {status.checkedAt}
            </small>
          )}
          {status?.progress != null && running && (
            <div
              className="update-progress"
              aria-label={tr('Progression de la mise à jour', 'Update progress')}
            >
              <progress max={100} value={status.progress} />
              <span>{status.progress}%</span>
            </div>
          )}
        </div>

        <div className="update-card-actions">
          <Button className="button-secondary" onClick={onCheck} disabled={running}>
            <RefreshCw /> {tr('Rechercher', 'Check now')}
          </Button>
          {available && (
            <Button
              onClick={() => {
                if (
                  window.confirm(
                    tr(
                      `Installer ${status.latestVersion} maintenant ? Élise redémarrera brièvement.`,
                      `Install ${status.latestVersion} now? Élise will briefly restart.`,
                    ),
                  )
                ) {
                  onInstall(status.latestVersion!);
                }
              }}
              disabled={running}
            >
              <Download />{' '}
              {tr(`Installer ${status.latestVersion}`, `Install ${status.latestVersion}`)}
            </Button>
          )}
        </div>

        {status?.latestVersion && status.updateAvailable && (
          <div className="update-release-notes">
            <strong>
              {tr(`Version ${status.latestVersion}`, `Version ${status.latestVersion}`)}
            </strong>
            {status.releaseNotes && <p>{status.releaseNotes}</p>}
          </div>
        )}

        {status?.message && <p className="update-card-message">{status.message}</p>}
        {status?.error && <p className="update-card-error">{status.error}</p>}

        <details
          className="update-credentials"
          open={credentialsOpen || !status?.authConfigured}
          onToggle={(event) => setCredentialsOpen(event.currentTarget.open)}
        >
          <summary>
            <KeyRound />
            {status?.authConfigured
              ? tr('Changer le compte de téléchargement', 'Change download account')
              : tr('Configurer le compte de téléchargement', 'Configure download account')}
          </summary>
          <p>
            {tr(
              'Le jeton reste sur cet appareil, protégé par le système, et n’est jamais enregistré dans Élise.',
              'The token stays on this device, protected by the system, and is never stored in Élise.',
            )}
          </p>
          <label>
            {tr('Nom du compte bot', 'Bot account name')}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="elise-os-bot"
            />
          </label>
          <label>
            {tr('Jeton GitHub', 'GitHub token')}
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
              <ShieldCheck /> {tr('Enregistrer', 'Save')}
            </Button>
            {status?.authConfigured && (
              <Button className="button-secondary" onClick={onDeleteCredentials} disabled={busy}>
                {tr('Supprimer le compte', 'Remove account')}
              </Button>
            )}
          </div>
        </details>
      </div>
    </details>
  );
}
