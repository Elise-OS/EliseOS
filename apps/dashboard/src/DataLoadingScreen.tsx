import { type Locale, t } from './i18n';
type DataLoadingScreenProps = {
  locale: Locale;
  message?: string;
  fullPage?: boolean;
};

export function DataLoadingScreen({ message, fullPage = false }: DataLoadingScreenProps) {
  const loadingMessage = message ?? t('dataLoadingScreen.loadingYourData');

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
        <p className="data-loading-eyebrow">{t('dataLoadingScreen.justAMoment')}</p>
        <h1>{t('dataLoadingScreen.yourSpaceIsComingTo')}</h1>
        <p className="data-loading-message">{loadingMessage}</p>
        <span className="data-loading-progress" aria-hidden="true">
          <i />
        </span>
        <span className="data-loading-reassurance">
          {t('dataLoadingScreen.yourDataStaysInYour')}
        </span>
      </div>
    </section>
  );
}
