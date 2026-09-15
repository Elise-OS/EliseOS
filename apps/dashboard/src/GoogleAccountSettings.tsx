import { CalendarDays, Check, Copy, ExternalLink, KeyRound, Save, Youtube } from 'lucide-react';
import { useEffect, useState } from 'react';

type GoogleSettings = {
  configured: boolean;
  clientId: string;
  redirectUri: string | null;
  youtubeEnabled: boolean;
  calendarEnabled: boolean;
  youtubeConnected: boolean;
};

export function GoogleAccountSettings({ locale }: { locale: 'fr' | 'en' }) {
  const french = locale === 'fr';
  const [settings, setSettings] = useState<GoogleSettings>();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [youtubeEnabled, setYoutubeEnabled] = useState(true);
  const [calendarEnabled, setCalendarEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/screen/google');
      if (!response.ok) throw new Error(response.status === 403 ? 'forbidden' : 'load');
      const value = (await response.json()) as GoogleSettings;
      setSettings(value);
      setClientId(value.clientId);
      setRedirectUri(value.redirectUri ?? '');
      setYoutubeEnabled(value.youtubeEnabled);
      setCalendarEnabled(value.calendarEnabled);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'forbidden' ? 'forbidden' : 'load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/v1/screen/google', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
          ...(redirectUri ? { redirectUri } : {}),
          youtubeEnabled,
          calendarEnabled,
        }),
      });
      const value = (await response.json().catch(() => ({}))) as {
        message?: string;
      } & Partial<GoogleSettings>;
      if (!response.ok) throw new Error(value.message ?? 'save');
      setClientSecret('');
      setSettings(value as GoogleSettings);
      setNotice(french ? 'Configuration Google enregistrée.' : 'Google configuration saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        french
          ? 'Supprimer la configuration Google et la connexion YouTube ?'
          : 'Remove Google configuration and the YouTube connection?',
      )
    )
      return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/v1/screen/google', { method: 'DELETE' });
      if (!response.ok) throw new Error('remove');
      setSettings(undefined);
      setClientId('');
      setClientSecret('');
      setRedirectUri('');
      setYoutubeEnabled(true);
      setCalendarEnabled(true);
      setNotice(french ? 'Configuration Google supprimée.' : 'Google configuration removed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'remove');
    } finally {
      setSaving(false);
    }
  };

  const copyRedirect = () => {
    if (!redirectUri) return;
    void navigator.clipboard?.writeText(redirectUri).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <section className="michel-card settings-section-card google-account-settings">
      <header className="settings-section-heading google-account-heading">
        <span className="settings-section-icon settings-section-icon--google">
          <KeyRound />
        </span>
        <div>
          <span className="eyebrow">{french ? 'Services connectés' : 'Connected services'}</span>
          <h2>{french ? 'Compte Google' : 'Google account'}</h2>
          <p>
            {french
              ? 'Un seul réglage pour vos playlists YouTube et votre futur calendrier Google.'
              : 'One setting for your YouTube playlists and your future Google Calendar.'}
          </p>
        </div>
        <span className={`google-account-status ${settings?.configured ? 'is-ready' : ''}`}>
          {settings?.configured
            ? french
              ? 'Prêt'
              : 'Ready'
            : french
              ? 'À configurer'
              : 'To set up'}
        </span>
      </header>

      {loading ? (
        <p className="google-account-loading">{french ? 'Chargement…' : 'Loading…'}</p>
      ) : error === 'forbidden' ? (
        <p className="google-account-message">
          {french
            ? 'Seul un administrateur peut configurer le compte Google.'
            : 'Only an administrator can configure the Google account.'}
        </p>
      ) : (
        <div className="google-account-body">
          <ol className="google-account-steps">
            <li>
              <strong>
                {french ? 'Créer un projet Google Cloud' : 'Create a Google Cloud project'}
              </strong>
              <span>
                {french ? 'Utilisez un projet dédié à Élise.' : 'Use a project dedicated to Élise.'}
              </span>
              <a
                href="https://console.cloud.google.com/projectcreate"
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir Google Cloud <ExternalLink aria-hidden="true" />
              </a>
            </li>
            <li>
              <strong>{french ? 'Activer les deux services' : 'Enable both services'}</strong>
              <span>
                {french
                  ? 'Activez YouTube Data API v3 et Google Calendar API.'
                  : 'Enable YouTube Data API v3 and Google Calendar API.'}
              </span>
              <div className="google-account-links">
                <a
                  href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Youtube aria-hidden="true" /> YouTube
                </a>
                <a
                  href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  <CalendarDays aria-hidden="true" /> Calendar
                </a>
              </div>
            </li>
            <li>
              <strong>
                {french ? 'Préparer l’écran de consentement' : 'Prepare the consent screen'}
              </strong>
              <span>
                {french
                  ? 'Choisissez Externe, indiquez le nom Élise, puis ajoutez votre compte comme utilisateur test.'
                  : 'Choose External, name it Élise, then add your account as a test user.'}
              </span>
              <a
                href="https://console.cloud.google.com/apis/credentials/consent"
                target="_blank"
                rel="noreferrer"
              >
                Écran de consentement <ExternalLink aria-hidden="true" />
              </a>
            </li>
            <li>
              <strong>
                {french ? 'Créer les identifiants OAuth' : 'Create OAuth credentials'}
              </strong>
              <span>
                {french
                  ? 'Créez un ID client de type Application Web.'
                  : 'Create a Web application OAuth client ID.'}
              </span>
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
              >
                Identifiants Google <ExternalLink aria-hidden="true" />
              </a>
            </li>
          </ol>

          <div className="google-account-callback">
            <label>
              <span>
                {french
                  ? 'URI de redirection à déclarer dans Google Cloud'
                  : 'Redirect URI to add in Google Cloud'}
              </span>
              <div>
                <input
                  value={redirectUri}
                  onChange={(event) => setRedirectUri(event.target.value)}
                  placeholder="https://…/api/v1/screen/youtube/callback"
                />
                <button
                  type="button"
                  aria-label={french ? 'Copier l’URI' : 'Copy URI'}
                  onClick={copyRedirect}
                  disabled={!redirectUri}
                >
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </button>
              </div>
            </label>
            <small>
              {french
                ? 'Elle doit correspondre exactement à celle enregistrée dans Google Cloud.'
                : 'It must exactly match the URI registered in Google Cloud.'}
            </small>
          </div>

          <div className="google-account-fields">
            <label>
              <span>Client ID</span>
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="123456789.apps.googleusercontent.com"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Secret client</span>
              <input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={
                  settings?.configured ? 'Laisser vide pour conserver le secret' : 'GOCSPX-…'
                }
                autoComplete="new-password"
              />
            </label>
          </div>

          <div className="google-account-services">
            <label>
              <input
                type="checkbox"
                checked={youtubeEnabled}
                onChange={(event) => setYoutubeEnabled(event.target.checked)}
              />
              <Youtube aria-hidden="true" />
              <span>
                <strong>YouTube</strong>
                <small>{french ? 'Playlists dans Affichage TV' : 'Playlists in TV display'}</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={calendarEnabled}
                onChange={(event) => setCalendarEnabled(event.target.checked)}
              />
              <CalendarDays aria-hidden="true" />
              <span>
                <strong>Google Calendar</strong>
                <small>
                  {french ? 'Calendrier partagé dans Élise' : 'Shared calendar in Élise'}
                </small>
              </span>
            </label>
          </div>

          {notice && (
            <p className="google-account-notice" role="status">
              {notice}
            </p>
          )}
          {error && error !== 'forbidden' && (
            <p className="google-account-error" role="alert">
              {error}
            </p>
          )}
          <div className="google-account-actions">
            <button
              type="button"
              className="button"
              disabled={
                saving || !clientId.trim() || (!settings?.configured && !clientSecret.trim())
              }
              onClick={() => void save()}
            >
              <Save aria-hidden="true" />{' '}
              {french ? 'Enregistrer la configuration' : 'Save configuration'}
            </button>
            {settings?.configured && (
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() => void remove()}
              >
                {french ? 'Réinitialiser' : 'Reset'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
