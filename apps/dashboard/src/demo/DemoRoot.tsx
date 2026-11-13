import { ArrowUpRight, ChevronLeft, ChevronRight, Minus, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { App } from '../App';
import { ResidentScreen } from '../ResidentScreen';
import { DemoCall } from './DemoCall';
import './demo.css';
import { FlagIcon } from '../FlagIcons';
import { currentLanguage, dashboardLanguages, t as i18nT, textBlock, type Language } from '../i18n';
import { DEMO_SHOW_TV_EVENT } from '../resident-screen-link';

type View = 'aidant' | 'tv';

const initialView = (): View =>
  new URLSearchParams(window.location.search).get('vue') === 'tv' ? 'tv' : 'aidant';

/** The demo home is built in one language, so switching reloads it in the other. */
function switchLang(next: Language) {
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
  // ?lang= in the address, then the choice saved in this browser (read by ../i18n).
  const lang = currentLanguage();
  const t = textBlock('demoRoot.copy');

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

  const show = useCallback((next: View) => {
    const url = new URL(window.location.href);
    if (next === 'tv') url.searchParams.set('vue', 'tv');
    else url.searchParams.delete('vue');
    window.history.replaceState(null, '', url);
    setView(next);
  }, []);

  // "View the screen" in the caregiver space switches to the TV view without reloading the home.
  useEffect(() => {
    const showTv = () => {
      show('tv');
      window.scrollTo(0, 0);
    };
    window.addEventListener(DEMO_SHOW_TV_EVENT, showTv);
    return () => window.removeEventListener(DEMO_SHOW_TV_EVENT, showTv);
  }, [show]);

  return (
    <>
      {view === 'tv' ? <ResidentScreen /> : <App />}
      <DemoCall />
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
            <span className="demo-bar-info">
              <strong title={t.home}>{t.home}</strong>
              <span className="demo-bar-frozen" title={t.frozen}>
                {t.frozen}
              </span>
            </span>
          </div>
          <span className="demo-bar-sep" aria-hidden="true" />
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
          <span className="demo-bar-sep" aria-hidden="true" />
          <div className="demo-bar-lang" role="group" aria-label={t.language}>
            {dashboardLanguages.map(({ code: item, name }) => (
              <button
                key={item}
                type="button"
                lang={item}
                title={name}
                aria-label={name}
                aria-pressed={lang === item}
                onClick={() => item !== lang && switchLang(item)}
              >
                <FlagIcon language={item} />
              </button>
            ))}
          </div>
          <span className="demo-bar-sep" aria-hidden="true" />
          <div className="demo-bar-actions">
            <button
              type="button"
              className="demo-bar-action"
              title={t.restart}
              onClick={() => window.location.reload()}
            >
              <RotateCcw aria-hidden="true" />
              <span>{t.restart}</span>
            </button>
            <a className="demo-bar-action demo-bar-exit" href={i18nT('demoRoot.exitUrl')}>
              <span>{t.exit}</span>
              <ArrowUpRight aria-hidden="true" />
            </a>
            <button
              type="button"
              className="demo-bar-hide"
              onClick={() => setCollapsed(true)}
              aria-label={t.hide}
              title={t.hide}
            >
              <Minus aria-hidden="true" />
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
