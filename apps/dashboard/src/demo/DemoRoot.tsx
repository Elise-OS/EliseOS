import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { App } from '../App';
import { ResidentScreen } from '../ResidentScreen';
import { DemoCall } from './DemoCall';
import './demo.css';

type View = 'aidant' | 'tv';

const copy = {
  fr: {
    badge: 'Démonstration',
    home: 'Maison Martin · données fictives',
    frozen: 'Figée le mardi 13 octobre, 10 h 40',
    views: { aidant: 'Espace aidant', tv: 'Télévision de Jeanne' },
    viewsLabel: 'Vue de la démonstration',
    restart: 'Recommencer',
    exit: 'Retour au site',
    hide: 'Réduire le bandeau',
    show: 'Afficher le bandeau de démonstration',
    closeSidebar: 'Fermer le menu latéral',
    openSidebar: 'Ouvrir le menu latéral',
    language: 'Langue de la démonstration',
  },
  en: {
    badge: 'Demo',
    home: 'Martin home · fictional data',
    frozen: 'Frozen on Tuesday 13 October, 10:40',
    views: { aidant: 'Caregiver space', tv: 'Jeanne’s TV' },
    viewsLabel: 'Demo view',
    restart: 'Start over',
    exit: 'Back to the site',
    hide: 'Collapse the banner',
    show: 'Show the demo banner',
    closeSidebar: 'Close the side menu',
    openSidebar: 'Open the side menu',
    language: 'Demo language',
  },
} as const;

const initialView = (): View =>
  new URLSearchParams(window.location.search).get('vue') === 'tv' ? 'tv' : 'aidant';

function currentLang(): 'fr' | 'en' {
  const asked = new URLSearchParams(window.location.search).get('lang');
  if (asked === 'en' || asked === 'fr') return asked;
  try {
    return window.localStorage.getItem('michel_locale') === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

/** The demo home is built in one language, so switching reloads it in the other. */
function switchLang(next: 'fr' | 'en') {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', next);
  window.location.replace(url);
}

const SIDEBAR_KEY = 'elise_demo_sidebar_closed';

function initialSidebarClosed() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

/** The caregiver space or the resident's TV, on the in-memory Martin home, with the demo banner. */
export function DemoRoot() {
  const [view, setView] = useState<View>(initialView);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarClosed, setSidebarClosed] = useState(initialSidebarClosed);
  const lang = currentLang();
  const t = copy[lang];

  // Demo only: on wide screens the visitor can fold the side menu away to see more of a page.
  useEffect(() => {
    document.documentElement.classList.toggle(
      'demo-sidebar-closed',
      sidebarClosed && view === 'aidant',
    );
    try {
      window.localStorage.setItem(SIDEBAR_KEY, String(sidebarClosed));
    } catch {
      // Private browsing: the choice simply lasts for this visit.
    }
  }, [sidebarClosed, view]);

  const show = (next: View) => {
    const url = new URL(window.location.href);
    if (next === 'tv') url.searchParams.set('vue', 'tv');
    else url.searchParams.delete('vue');
    window.history.replaceState(null, '', url);
    setView(next);
  };

  return (
    <>
      {view === 'tv' ? <ResidentScreen /> : <App />}
      <DemoCall lang={lang} />
      {view === 'aidant' && (
        <button
          type="button"
          className="demo-sidebar-toggle"
          aria-label={sidebarClosed ? t.openSidebar : t.closeSidebar}
          aria-expanded={!sidebarClosed}
          title={sidebarClosed ? t.openSidebar : t.closeSidebar}
          onClick={() => setSidebarClosed((value) => !value)}
        >
          {sidebarClosed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
        </button>
      )}
      {collapsed ? (
        <button
          type="button"
          className="demo-bar-reopen"
          onClick={() => setCollapsed(false)}
          aria-label={t.show}
        >
          {t.badge}
        </button>
      ) : (
        <aside className="demo-bar" aria-label={t.badge}>
          <div className="demo-bar-copy">
            <span className="demo-bar-badge">{t.badge}</span>
            <span>
              <strong>{t.home}</strong>
              <span className="demo-bar-frozen">{t.frozen}</span>
            </span>
          </div>
          <div className="demo-bar-views" role="group" aria-label={t.viewsLabel}>
            {(['aidant', 'tv'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={view === item}
                onClick={() => show(item)}
              >
                {t.views[item]}
              </button>
            ))}
          </div>
          <div className="demo-bar-lang" role="group" aria-label={t.language}>
            {(['fr', 'en'] as const).map((item) => (
              <button
                key={item}
                type="button"
                lang={item}
                aria-pressed={lang === item}
                onClick={() => item !== lang && switchLang(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="demo-bar-actions">
            <button type="button" onClick={() => window.location.reload()}>
              {t.restart}
            </button>
            <a href={lang === 'en' ? '/en/' : '/'}>{t.exit}</a>
            <button
              type="button"
              className="demo-bar-hide"
              onClick={() => setCollapsed(true)}
              aria-label={t.hide}
            >
              ×
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
