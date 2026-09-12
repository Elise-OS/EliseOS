import type { RemoteAccessStatus } from '@michel/contracts';
import { Button } from '@michel/ui';
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale } from './i18n';

interface RemoteAccessCardProps {
  locale: Locale;
  compact?: boolean;
}

export function RemoteAccessCard({ locale, compact = false }: RemoteAccessCardProps) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [qrCode, setQrCode] = useState('');
  const localGateway = typeof window !== 'undefined' && window.location.protocol === 'http:';
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/remote-access/status');
      if (!response.ok) throw new Error('status unavailable');
      setStatus((await response.json()) as RemoteAccessStatus);
    } catch {
      setStatus({
        state: 'UNAVAILABLE',
        installed: false,
        remoteUrl: null,
        hostname: null,
        servePort: 8443,
        keyExpiresAt: null,
        httpsAvailable: false,
        webrtcAvailable: false,
        authUrl: null,
        actionRequired: 'RETRY',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status || !['AUTHORIZING', 'CONFIGURING'].includes(status.state)) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  const deepLink = useMemo(
    () => (status?.remoteUrl ? `michel://connect?url=${encodeURIComponent(status.remoteUrl)}` : ''),
    [status?.remoteUrl],
  );

  useEffect(() => {
    if (!deepLink) return setQrCode('');
    void QRCode.toDataURL(deepLink, {
      width: 220,
      margin: 1,
      color: { dark: '#20352e', light: '#ffffff' },
    }).then(setQrCode);
  }, [deepLink]);

  const action = async (path: 'connect' | 'enable' | 'disable') => {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(`/api/v1/remote-access/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: path === 'connect' ? JSON.stringify({ hostname: 'elise' }) : '{}',
      });
      const body = (await response.json().catch(() => null)) as
        (RemoteAccessStatus & { message?: string }) | null;
      if (!response.ok)
        throw new Error(body?.message || tr('Action impossible.', 'Action failed.'));
      setStatus(body);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : tr('Action impossible.', 'Action failed.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const copyValue = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setNotice(label);
  };

  const stateLabel = !status
    ? tr('Vérification…', 'Checking…')
    : {
        UNAVAILABLE: tr('Indisponible', 'Unavailable'),
        SIGNED_OUT: tr('À activer', 'Not connected'),
        AUTHORIZING: tr('Connexion en cours', 'Connecting'),
        CONFIGURING: tr('Prêt à sécuriser', 'Ready to secure'),
        READY: tr('Actif et privé', 'Active and private'),
        DEGRADED: tr('À vérifier', 'Needs attention'),
      }[status.state];

  const Container = compact ? 'section' : 'details';
  const Heading = compact ? 'header' : 'summary';

  return (
    <Container className={`remote-access-card${compact ? ' is-compact' : ''}`}>
      <Heading className="remote-access-heading">
        <span className="remote-access-icon">
          <ShieldCheck />
        </span>
        <div>
          <span className="eyebrow">{tr('Connexion privée', 'Private connection')}</span>
          <h2>{tr('Accès à distance', 'Remote access')}</h2>
          <p>
            {tr(
              'Consultez Élise depuis l’extérieur avec Tailscale. Seules les personnes invitées peuvent entrer.',
              'Use Élise away from home with Tailscale. Only invited people can connect.',
            )}
          </p>
        </div>
        <span className={`remote-access-state state-${status?.state.toLowerCase() ?? 'loading'}`}>
          {status?.state === 'READY' ? (
            <Check />
          ) : status?.state === 'UNAVAILABLE' ? (
            <CircleAlert />
          ) : (
            <LoaderCircle />
          )}
          {stateLabel}
        </span>
        {!compact && (
          <span className="remote-access-chevron" aria-hidden="true">
            <ChevronRight />
          </span>
        )}
      </Heading>

      <div className="remote-access-body">
        {status?.state === 'UNAVAILABLE' && (
          <p className="remote-access-message warning">
            {tr(
              'Le service d’accès privé n’est pas encore disponible sur cet appareil.',
              'The private access service is not available on this device yet.',
            )}
          </p>
        )}

        {status?.state === 'SIGNED_OUT' && (
          <div className="remote-access-action">
            <div>
              <Link2 />
              <span>
                <strong>
                  {tr('1. Relier Élise à votre famille', '1. Link Élise to your family')}
                </strong>
                <small>
                  {tr(
                    'Votre clé Tailscale n’est jamais stockée dans l’image Élise.',
                    'Your Tailscale key is never stored in the Élise image.',
                  )}
                </small>
              </span>
            </div>
            {localGateway && (
              <Button onClick={() => void action('connect')} disabled={busy}>
                {tr('Activer l’accès privé', 'Enable private access')}
              </Button>
            )}
          </div>
        )}

        {status?.state === 'AUTHORIZING' && (
          <div className="remote-access-action">
            <div>
              <LoaderCircle className="spin" />
              <span>
                <strong>
                  {tr('Validez la connexion Tailscale', 'Approve the Tailscale connection')}
                </strong>
                <small>
                  {tr(
                    'La validation sera détectée automatiquement.',
                    'Approval will be detected automatically.',
                  )}
                </small>
              </span>
            </div>
            {status.authUrl && (
              <Button onClick={() => window.open(status.authUrl!, '_blank', 'noopener,noreferrer')}>
                {tr('Ouvrir Tailscale', 'Open Tailscale')} <ExternalLink />
              </Button>
            )}
          </div>
        )}

        {status?.state === 'CONFIGURING' && (
          <div className="remote-access-action">
            <div>
              <ShieldCheck />
              <span>
                <strong>{tr('2. Ouvrir le lien privé', '2. Open the private link')}</strong>
                <small>
                  {tr(
                    'Élise utilisera le port dédié 8443 sans modifier les autres services.',
                    'Élise will use dedicated port 8443 without changing other services.',
                  )}
                </small>
              </span>
            </div>
            {localGateway && (
              <Button onClick={() => void action('enable')} disabled={busy}>
                {tr('Terminer l’activation', 'Finish activation')}
              </Button>
            )}
          </div>
        )}

        {status?.remoteUrl && (
          <div className="remote-access-ready">
            <div className="remote-access-link">
              <Link2 />
              <span>
                <small>{tr('Adresse privée', 'Private address')}</small>
                <strong>{status.remoteUrl}</strong>
              </span>
              <button
                type="button"
                onClick={() => void copyValue(status.remoteUrl!, tr('Lien copié.', 'Link copied.'))}
                aria-label={tr('Copier le lien', 'Copy link')}
              >
                <Copy />
              </button>
            </div>
            <div className="remote-access-capabilities">
              <span className={status.httpsAvailable ? 'ok' : ''}>
                <Check /> Dashboard HTTPS · 8443
              </span>
              <span className={status.webrtcAvailable ? 'ok' : ''}>
                <Check /> {tr('Caméra et interphone', 'Camera and intercom')} · 8555
              </span>
              {status.keyExpiresAt && (
                <span>
                  {tr('Clé valide jusqu’au', 'Key valid until')}{' '}
                  {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                    new Date(status.keyExpiresAt),
                  )}
                </span>
              )}
            </div>
            <div className="remote-access-controls">
              <Button
                className="button-secondary"
                onClick={() => window.open(status.remoteUrl!, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink /> {tr('Tester la connexion', 'Test connection')}
              </Button>
              {localGateway && (
                <Button
                  className="button-secondary"
                  onClick={() => void action('disable')}
                  disabled={busy}
                >
                  {tr('Désactiver l’accès Élise', 'Disable Élise access')}
                </Button>
              )}
            </div>
            <div className="remote-access-share">
              {qrCode && (
                <img
                  src={qrCode}
                  alt={tr('QR code de connexion à Élise', 'Élise connection QR code')}
                />
              )}
              <div>
                <QrCode />
                <strong>{tr('Ajouter Élise dans l’app', 'Add Élise to the app')}</strong>
                <p>
                  {tr(
                    'Scannez ce code depuis le téléphone de l’aidant après lui avoir installé Tailscale.',
                    'Scan this code from the caregiver’s phone after installing Tailscale.',
                  )}
                </p>
                <Button
                  className="button-secondary"
                  onClick={() =>
                    void copyValue(deepLink, tr('Lien pour l’app copié.', 'App link copied.'))
                  }
                >
                  <Smartphone /> {tr('Copier le lien pour l’app', 'Copy app link')}
                </Button>
              </div>
            </div>
          </div>
        )}

        <details className="remote-access-guide">
          <summary>{tr('Comment inviter un proche ?', 'How do I invite someone?')}</summary>
          <ol>
            <li>
              {tr(
                'Créez son compte et choisissez son rôle dans Élise.',
                'Create their account and choose their role in Élise.',
              )}
            </li>
            <li>
              {tr(
                'Dans Tailscale, partagez uniquement la machine Élise.',
                'In Tailscale, share only the Élise device.',
              )}
            </li>
            <li>
              {tr(
                'Envoyez l’invitation et faites installer Tailscale à l’aidant.',
                'Send the invitation and have the caregiver install Tailscale.',
              )}
            </li>
            <li>
              {tr(
                'Ouvrez Élise avec le lien web ou le QR code de l’app.',
                'Open Élise with the web link or the app QR code.',
              )}
            </li>
          </ol>
          <p>
            {tr(
              'Pour un serveur permanent, désactivez l’expiration de clé uniquement pour la machine Élise.',
              'For a permanent server, disable key expiry only for the Élise device.',
            )}
          </p>
        </details>
        {!localGateway && status?.state !== 'READY' && (
          <p className="remote-access-message">
            {tr(
              'Pour modifier cet accès, ouvrez Élise depuis le réseau du domicile.',
              'To change this access, open Élise from your home network.',
            )}
          </p>
        )}
        {notice && <p className="remote-access-message">{notice}</p>}
      </div>
    </Container>
  );
}
