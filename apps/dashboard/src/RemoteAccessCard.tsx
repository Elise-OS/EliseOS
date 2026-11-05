import type { RemoteAccessStatus } from '@elise/contracts';
import { Button } from '@elise/ui';
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
import { type Locale, t } from './i18n';

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
    () => (status?.remoteUrl ? `elise://connect?url=${encodeURIComponent(status.remoteUrl)}` : ''),
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
      if (!response.ok) throw new Error(body?.message || t('remoteAccessCard.actionFailed'));
      setStatus(body);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('remoteAccessCard.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copyValue = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setNotice(label);
  };

  const stateLabel = !status
    ? t('remoteAccessCard.checking')
    : {
        UNAVAILABLE: t('remoteAccessCard.unavailable'),
        SIGNED_OUT: t('remoteAccessCard.notConnected'),
        AUTHORIZING: t('remoteAccessCard.connecting'),
        CONFIGURING: t('remoteAccessCard.readyToSecure'),
        READY: t('remoteAccessCard.activeAndPrivate'),
        DEGRADED: t('remoteAccessCard.needsAttention'),
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
          <span className="eyebrow">{t('remoteAccessCard.privateConnection')}</span>
          <h2>{t('remoteAccessCard.remoteAccess')}</h2>
          <p>{t('remoteAccessCard.useEliseAwayFromHome')}</p>
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
            {t('remoteAccessCard.thePrivateAccessServiceIs')}
          </p>
        )}

        {status?.state === 'SIGNED_OUT' && (
          <div className="remote-access-action">
            <div>
              <Link2 />
              <span>
                <strong>{t('remoteAccessCard.n1LinkEliseToYour')}</strong>
                <small>{t('remoteAccessCard.yourTailscaleKeyIsNever')}</small>
              </span>
            </div>
            {localGateway && (
              <Button onClick={() => void action('connect')} disabled={busy}>
                {t('remoteAccessCard.enablePrivateAccess')}
              </Button>
            )}
          </div>
        )}

        {status?.state === 'AUTHORIZING' && (
          <div className="remote-access-action">
            <div>
              <LoaderCircle className="spin" />
              <span>
                <strong>{t('remoteAccessCard.approveTheTailscaleConnection')}</strong>
                <small>{t('remoteAccessCard.approvalWillBeDetectedAutomatically')}</small>
              </span>
            </div>
            {status.authUrl && (
              <Button onClick={() => window.open(status.authUrl!, '_blank', 'noopener,noreferrer')}>
                {t('remoteAccessCard.openTailscale')} <ExternalLink />
              </Button>
            )}
          </div>
        )}

        {status?.state === 'CONFIGURING' && (
          <div className="remote-access-action">
            <div>
              <ShieldCheck />
              <span>
                <strong>{t('remoteAccessCard.n2OpenThePrivateLink')}</strong>
                <small>{t('remoteAccessCard.eliseWillUseDedicatedPort')}</small>
              </span>
            </div>
            {localGateway && (
              <Button onClick={() => void action('enable')} disabled={busy}>
                {t('remoteAccessCard.finishActivation')}
              </Button>
            )}
          </div>
        )}

        {status?.remoteUrl && (
          <div className="remote-access-ready">
            <div className="remote-access-link">
              <Link2 />
              <span>
                <small>{t('remoteAccessCard.privateAddress')}</small>
                <strong>{status.remoteUrl}</strong>
              </span>
              <button
                type="button"
                onClick={() => void copyValue(status.remoteUrl!, t('remoteAccessCard.linkCopied'))}
                aria-label={t('remoteAccessCard.copyLink')}
              >
                <Copy />
              </button>
            </div>
            <div className="remote-access-capabilities">
              <span className={status.httpsAvailable ? 'ok' : ''}>
                <Check /> Dashboard HTTPS · 8443
              </span>
              <span className={status.webrtcAvailable ? 'ok' : ''}>
                <Check /> {t('remoteAccessCard.cameraAndIntercom')} · 8555
              </span>
              {status.keyExpiresAt && (
                <span>
                  {t('remoteAccessCard.keyValidUntil')}{' '}
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
                <ExternalLink /> {t('remoteAccessCard.testConnection')}
              </Button>
              {localGateway && (
                <Button
                  className="button-secondary"
                  onClick={() => void action('disable')}
                  disabled={busy}
                >
                  {t('remoteAccessCard.disableEliseAccess')}
                </Button>
              )}
            </div>
            <div className="remote-access-share">
              {qrCode && <img src={qrCode} alt={t('remoteAccessCard.eliseConnectionQrCode')} />}
              <div>
                <QrCode />
                <strong>{t('remoteAccessCard.addEliseToTheApp')}</strong>
                <p>{t('remoteAccessCard.scanThisCodeFromThe')}</p>
                <Button
                  className="button-secondary"
                  onClick={() => void copyValue(deepLink, t('remoteAccessCard.appLinkCopied'))}
                >
                  <Smartphone /> {t('remoteAccessCard.copyAppLink')}
                </Button>
              </div>
            </div>
          </div>
        )}

        <details className="remote-access-guide">
          <summary>{t('remoteAccessCard.howDoIInviteSomeone')}</summary>
          <ol>
            <li>{t('remoteAccessCard.createTheirAccountAndChoose')}</li>
            <li>{t('remoteAccessCard.inTailscaleShareOnlyThe')}</li>
            <li>{t('remoteAccessCard.sendTheInvitationAndHave')}</li>
            <li>{t('remoteAccessCard.openEliseWithTheWeb')}</li>
          </ol>
          <p>{t('remoteAccessCard.forAPermanentServerDisable')}</p>
        </details>
        {!localGateway && status?.state !== 'READY' && (
          <p className="remote-access-message">{t('remoteAccessCard.toChangeThisAccessOpen')}</p>
        )}
        {notice && <p className="remote-access-message">{notice}</p>}
      </div>
    </Container>
  );
}
