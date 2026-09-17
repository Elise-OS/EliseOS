type DataLoadingScreenProps = {
  locale: 'fr' | 'en';
  message?: string;
  fullPage?: boolean;
};

export function DataLoadingScreen({ locale, message, fullPage = false }: DataLoadingScreenProps) {
  const fr = locale === 'fr';
  const loadingMessage = message ?? (fr ? 'Chargement de vos données…' : 'Loading your data…');

  return (
    <section
      className={`data-loading-screen${fullPage ? ' data-loading-screen--full' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={loadingMessage}
    >
      <div className="data-loading-ambient" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="data-loading-home" aria-hidden="true">
        <span className="data-loading-roof" />
        <span className="data-loading-room data-loading-room--one" />
        <span className="data-loading-room data-loading-room--two" />
        <span className="data-loading-room data-loading-room--three" />
        <span className="data-loading-route" />
        <i className="data-loading-signal data-loading-signal--one" />
        <i className="data-loading-signal data-loading-signal--two" />
        <i className="data-loading-signal data-loading-signal--three" />
      </div>
      <div className="data-loading-content">
        <div className="data-loading-brand">
          <img className="data-loading-logo" src="/logo-transparent.png" alt="" />
          <span className="data-loading-wordmark">
            élise<span className="brand-os">OS</span>
          </span>
        </div>
        <p className="data-loading-eyebrow">{fr ? 'Un instant' : 'Just a moment'}</p>
        <h1>{fr ? 'Votre espace prend vie' : 'Your space is coming to life'}</h1>
        <p className="data-loading-message">{loadingMessage}</p>
        <span className="data-loading-progress" aria-hidden="true">
          <i />
        </span>
        <span className="data-loading-reassurance">
          {fr ? 'Vos données restent chez vous.' : 'Your data stays in your home.'}
        </span>
      </div>
    </section>
  );
}
