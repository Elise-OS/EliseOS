import { LiaisonPage } from './LiaisonPage';
import { WelcomePage } from './WelcomePage';
import { AlertsPage, type SafetyCategory } from './AlertsPage';
import { AlertRulesPanel } from './AlertRulesPanel';
import { Button, Card, StatusPill } from '@elise/ui';
import {
  Accessibility,
  Activity,
  Bell,
  BookOpen,
  CalendarDays,
  Camera,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock3,
  Ear,
  Eye,
  Footprints,
  HeartHandshake,
  HeartPulse,
  Home,
  Languages,
  LoaderCircle,
  LogOut,
  Menu,
  PawPrint,
  PanelLeftClose,
  Pill,
  Radar,
  Settings,
  ShieldCheck,
  Sofa,
  Sparkles,
  Trash2,
  Tv,
  UsersRound,
  UserRound,
  Video,
  X,
  Usb,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  currentLanguage,
  dashboardLanguages,
  type Locale,
  loadLanguage,
  setLanguage,
  t as i18nT,
  textBlock,
} from './i18n';
import { resizeResidentPhoto, Setup } from './Setup';
import { HomeOverview, homeRealtimeEventAction } from './HomeOverview';
import { GuidedTour, type GuidedTourMode } from './GuidedTour';
import { DataLoadingScreen } from './DataLoadingScreen';
import { FlagIcon } from './FlagIcons';
import { RemoteAccessCard } from './RemoteAccessCard';
import { ActivityPage } from './ActivityPage';
import { UpdateCard } from './UpdateCard';
import type { UpdateStatus } from '@elise/contracts';
import { createId } from './lib/createId';
import { visibleSettingsTabs, type SettingsTab } from './box-health-view';
import { subscribeRealtime } from './realtime';
import type {
  Overview,
  Household,
  CurrentAccess,
  AlertItem,
  CameraItem,
  CameraSession,
  CameraRecording,
  JournalItem,
  SimulationScenario,
  AlertRuleSettings,
  MedicationItem,
  MedicationDoseItem,
  MedicationDraft,
} from './app-types';
import {
  formatMinute,
  residentAge,
  residentMobilityLabel,
  supportNeedLabel,
  habitLabel,
  activityDescription,
} from './app-labels';
import { dateKey, MedicationPanel } from './MedicationPanel';
import { CamerasPanel } from './CamerasPanel';
import { PeoplePanel } from './PeoplePanel';

export { MedicationPanel } from './MedicationPanel';
export { PeoplePanel } from './PeoplePanel';
export { activityDescription } from './app-labels';

// Pages a caregiver opens now and then load on first visit: the first screen stays light.
const HomePlanEditor = lazy(() =>
  import('./HomePlanEditor').then((module) => ({ default: module.HomePlanEditor })),
);
const ScreenPanel = lazy(() =>
  import('./ScreenPanel').then((module) => ({ default: module.ScreenPanel })),
);
const ZigbeeKeyPanel = lazy(() =>
  import('./ZigbeeKeyPanel').then((module) => ({ default: module.ZigbeeKeyPanel })),
);
const BoxHealthPanel = lazy(() =>
  import('./BoxHealthPanel').then((module) => ({ default: module.BoxHealthPanel })),
);
const CalendarPage = lazy(() =>
  import('./CalendarPage').then((module) => ({ default: module.CalendarPage })),
);
const JournalPage = lazy(() =>
  import('./JournalPage').then((module) => ({ default: module.JournalPage })),
);
const startResidentScreenCall = async () =>
  (await import('./ScreenPanel')).startResidentScreenCall();

const navIcons = [
  Home,
  Activity,
  Bell,
  Sofa,
  Radar,
  Pill,
  BookOpen,
  UsersRound,
  Settings,
  Video,
  Tv,
  BookOpen,
];
const settingsTabIcons = { general: Settings, zigbee: Usb, health: HeartPulse, rules: Bell };
const settingsTabLabel = (tab: SettingsTab) =>
  tab === 'general'
    ? i18nT('app.general')
    : tab === 'zigbee'
      ? i18nT('zigbeeKey.tab')
      : tab === 'health'
        ? i18nT('boxHealth.tab')
        : i18nT('app.rules');

export const sidebarHiddenNavIndexes = new Set([4, 5, 6, 9]);
export const sidebarNavOrder = [0, 1, 2, 11, 9, 10, 3, 7, 8] as const;
export function SidebarNavigation({
  labels,
  active,
  openAlerts,
  updateAvailable = false,
  onSelect,
}: {
  labels: readonly string[];
  active: number;
  openAlerts: number;
  updateAvailable?: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label={i18nT('app.mainNavigation')}>
      {sidebarNavOrder.map((index) => {
        const label = labels[index];
        if (!label) return null;
        if (sidebarHiddenNavIndexes.has(index)) return null;
        const Icon = navIcons[index]!;
        return (
          <button
            key={label}
            type="button"
            aria-current={active === index ? 'page' : undefined}
            data-tour-target={`nav-${index}`}
            className={`nav-item nav-item--${index === 10 ? 'tv' : index === 3 ? 'home' : 'default'}${active === index ? ' nav-item--active' : ''}`}
            onClick={() => onSelect(index)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {index === 2 && openAlerts > 0 && <b>{openAlerts}</b>}
            {index === 8 && updateAvailable && <b className="nav-update-badge">!</b>}
          </button>
        );
      })}
    </nav>
  );
}

export function SidebarBehaviorSetting({
  enabled,
  disabled,
  onChange,
}: {
  locale: Locale;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <article className="settings-option-row sidebar-behavior-settings">
      <div className="settings-option-copy">
        <span className="settings-option-icon settings-option-icon--blue">
          <PanelLeftClose />
        </span>
        <div>
          <h2>{i18nT('app.automaticSidebar')}</h2>
          <p>
            {disabled ? i18nT('app.theSidebarStaysOpenWhile') : i18nT('app.hideTheSidebarWhenThe')}
          </p>
        </div>
        <button
          type="button"
          className={`config-toggle-btn ${enabled && !disabled ? 'is-on' : ''}`}
          role="switch"
          aria-checked={enabled && !disabled}
          aria-label={i18nT('app.automaticallyHideTheSidebar')}
          disabled={disabled}
          onClick={() => onChange(!enabled)}
        >
          <span className="config-toggle-handle" />
        </button>
      </div>
    </article>
  );
}

export function Login({
  onSuccess,
  onPasswordChangeRequired,
  onOpenSetup,
}: {
  locale: Locale;
  onSuccess: () => void;
  onPasswordChangeRequired?: () => void;
  onOpenSetup: () => void;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    if (!response.ok) {
      setError(true);
      return;
    }
    const result = (await response.json()) as { user: { mustChangePassword: boolean } };
    if (result.user.mustChangePassword) onPasswordChangeRequired?.();
    else onSuccess();
  };
  return (
    <main className="login-screen">
      <div className="login-brand">
        <div className="brand-mark">
          <img src="/logo.png" alt="" />
        </div>
        <span>Élise</span>
      </div>
      <Card className="login-card">
        <span className="eyebrow">{i18nT('app.familyAccess')}</span>
        <h1>{i18nT('app.welcomeBack')}</h1>
        <p>{i18nT('app.signInToAccessYour')}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            {i18nT('app.username')}
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            {i18nT('app.password')}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="form-error">{i18nT('app.incorrectCredentials')}</p>}
          <Button type="submit">{i18nT('app.signIn')}</Button>
        </form>
        <div className="login-setup">
          <p>{i18nT('app.settingUpEliseForThe')}</p>
          <Button type="button" className="login-setup-button" onClick={onOpenSetup}>
            {i18nT('app.createAnEliseHome')}
          </Button>
          <small>{i18nT('app.thisStepCreatesTheHome')}</small>
        </div>
      </Card>
      <p className="login-privacy">
        <ShieldCheck /> {i18nT('app.yourDataNeverLeavesThe')}
      </p>
    </main>
  );
}

function ChangePassword({ onSuccess }: { locale: Locale; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12 || password !== confirmation) {
      setError(i18nT('app.useAtLeast12Characters'));
      return;
    }
    const response = await fetch('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: password }),
    });
    if (!response.ok) {
      setError(i18nT('app.thePasswordCouldNotBe'));
      return;
    }
    onSuccess();
  };
  return (
    <main className="login-screen">
      <div className="login-brand">
        <div className="brand-mark">
          <img src="/logo.png" alt="" />
        </div>
        <span>Élise</span>
      </div>
      <Card className="login-card">
        <span className="eyebrow">{i18nT('app.firstSignIn')}</span>
        <h1>{i18nT('app.chooseYourPassword')}</h1>
        <p>{i18nT('app.theTemporaryPasswordMustBe')}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            {i18nT('app.newPassword')}
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            {i18nT('app.confirm')}
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit">{i18nT('app.saveAndContinue')}</Button>
        </form>
      </Card>
    </main>
  );
}

export function SimulationPanel({
  scenarios,
  running,
  notice,
  onRun,
}: {
  scenarios: SimulationScenario[];
  running: string | null;
  notice: string;
  onRun: (scenario: string) => void;
  locale?: Locale;
}) {
  return (
    <article className="settings-option-row settings-demo-row simulation-card">
      <div className="settings-option-copy">
        <span className="settings-option-icon settings-option-icon--purple">
          <Radar />
        </span>
        <div>
          <span className="eyebrow">{i18nT('app.demoMode')}</span>
          <h2>{i18nT('app.testASituation')}</h2>
          <p>{i18nT('app.theseScenariosFollowTheSame')}</p>
        </div>
      </div>
      <div className="simulation-grid">
        {scenarios.map((scenario) => (
          <button
            type="button"
            key={scenario.id}
            disabled={running !== null}
            onClick={() => onRun(scenario.id)}
          >
            <span>
              <strong>{scenario.title}</strong>
              <small>{scenario.description}</small>
            </span>
            <b>{running === scenario.id ? i18nT('app.simulating') : i18nT('app.run')}</b>
          </button>
        ))}
      </div>
      {notice && (
        <p className="simulation-notice" role="status">
          <CircleCheck /> {notice}
        </p>
      )}
    </article>
  );
}

export function App() {
  // ?lang= in the address, then the choice saved in this browser (read by ./i18n), French otherwise.
  const [locale, setLocale] = useState<Locale>(currentLanguage);
  // Texts outside React read the language from i18n: set it before the children render.
  setLanguage(locale);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [currentAccess, setCurrentAccess] = useState<CurrentAccess>({
    role: 'VIEWER',
    capabilities: [],
  });
  const [dataError, setDataError] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [journal, setJournal] = useState<JournalItem[]>([]);
  const [medications, setMedications] = useState<MedicationItem[]>([]);
  const [medicationDoses, setMedicationDoses] = useState<MedicationDoseItem[]>([]);
  const [savingMedication, setSavingMedication] = useState(false);
  const [medicationNotice, setMedicationNotice] = useState('');
  const [simulationScenarios, setSimulationScenarios] = useState<SimulationScenario[]>([]);
  const [runningSimulation, setRunningSimulation] = useState<string | null>(null);
  const [simulationNotice, setSimulationNotice] = useState('');
  const [alertRules, setAlertRules] = useState<AlertRuleSettings | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [ruleNotice, setRuleNotice] = useState('');
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [cameraSession, setCameraSession] = useState<CameraSession | null>(null);
  const cameraSessionRequest = useRef(0);
  const [cameraNotice, setCameraNotice] = useState('');
  const [cameraRecordings, setCameraRecordings] = useState<CameraRecording[]>([]);
  const [active, setActive] = useState(0);
  const [screenSection, setScreenSection] = useState<
    'call' | 'messages' | 'display' | 'photos' | 'planning'
  >('display');
  const [homeSection, setHomeSection] = useState<'OVERVIEW' | 'EDITOR'>('OVERVIEW');
  const [homeSensorCategory, setHomeSensorCategory] = useState<SafetyCategory | null>(null);
  const clearHomeSensorCategory = useCallback(() => setHomeSensorCategory(null), []);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  // The remote access card sits in the general tab: open it and bring it into view.
  const openRemoteAccess = useCallback(() => {
    setSettingsTab('general');
    window.requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>('.settings-page > .remote-access-card');
      if (!card) return;
      if (card instanceof HTMLDetailsElement) card.open = true;
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    });
  }, []);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [homeEditorRoomId, setHomeEditorRoomId] = useState<string | null>(null);
  const [homeEditorStairId, setHomeEditorStairId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarAutoHide, setSidebarAutoHide] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('elise_sidebar_auto_hide') !== 'false';
  });
  const [authRequired, setAuthRequired] = useState(false);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [tourMode, setTourMode] = useState<GuidedTourMode | null>(null);
  const [initialTourHandled, setInitialTourHandled] = useState(false);
  const [homeSetupPreview, setHomeSetupPreview] = useState(false);
  const tourReturnActive = useRef(8);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshPending = useRef(false);
  const realtimeRefreshTimer = useRef<number | null>(null);
  const previewSetup =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('setup') === '1';
  const [entryState, setEntryState] = useState<'loading' | 'setup' | 'app'>(
    previewSetup ? 'setup' : 'loading',
  );
  const t = textBlock('app.copy');
  const sidebarAutoHideLocked =
    household?.home.installationStatus === 'DRAFT' || tourMode !== null || homeSetupPreview;
  const sidebarAutoHideActive = sidebarAutoHide && !sidebarAutoHideLocked;
  const changeLocale = (nextLocale: Locale) => {
    // The catalog of the new language is downloaded first: the screen never shows a mix.
    void loadLanguage(nextLocale).then(() => {
      setLanguage(nextLocale);
      setLocale(nextLocale);
      window.localStorage.setItem('elise_locale', nextLocale);
    });
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const changeSidebarAutoHide = (enabled: boolean) => {
    setSidebarAutoHide(enabled);
    window.localStorage.setItem('elise_sidebar_auto_hide', String(enabled));
  };

  const refreshOnce = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/overview');
      if (response.status === 401) {
        setAuthRequired(true);
        return;
      }
      if (response.status === 403) {
        const me = await fetch('/api/v1/auth/me');
        if (me.ok) {
          const user = (await me.json()) as { mustChangePassword: boolean };
          if (user.mustChangePassword) {
            setPasswordChangeRequired(true);
            setDataError(false);
            return;
          }
        }
      }
      if (!response.ok) throw new Error('Overview unavailable');
      setOverview((await response.json()) as Overview);
      const meResponse = await fetch('/api/v1/auth/me');
      if (meResponse.ok) setCurrentAccess((await meResponse.json()) as CurrentAccess);
      const now = new Date();
      const historyStart = new Date(now.getTime() - 7 * 86_400_000);
      const historyEnd = new Date(now.getTime() + 86_400_000);
      const [
        alertsResponse,
        journalResponse,
        householdResponse,
        simulationResponse,
        rulesResponse,
        medicationsResponse,
        dosesResponse,
        camerasResponse,
        cameraRecordingsResponse,
      ] = await Promise.all([
        fetch('/api/v1/alerts'),
        fetch('/api/v1/journal'),
        fetch('/api/v1/household'),
        fetch('/api/v1/simulation/scenarios'),
        fetch('/api/v1/alerts/rules'),
        fetch('/api/v1/medications'),
        fetch(`/api/v1/medications/doses?from=${dateKey(historyStart)}&to=${dateKey(historyEnd)}`),
        fetch('/api/v1/cameras'),
        fetch('/api/v1/cameras/recordings'),
      ]);
      if (alertsResponse.ok) setAlerts((await alertsResponse.json()) as AlertItem[]);
      if (journalResponse.ok) setJournal((await journalResponse.json()) as JournalItem[]);
      if (householdResponse.ok) setHousehold((await householdResponse.json()) as Household);
      setSimulationScenarios(
        simulationResponse.ok ? ((await simulationResponse.json()) as SimulationScenario[]) : [],
      );
      if (rulesResponse.ok) setAlertRules((await rulesResponse.json()) as AlertRuleSettings);
      if (medicationsResponse.ok)
        setMedications((await medicationsResponse.json()) as MedicationItem[]);
      if (dosesResponse.ok)
        setMedicationDoses((await dosesResponse.json()) as MedicationDoseItem[]);
      if (camerasResponse.ok) setCameras((await camerasResponse.json()) as CameraItem[]);
      if (cameraRecordingsResponse.ok)
        setCameraRecordings((await cameraRecordingsResponse.json()) as CameraRecording[]);
      setAuthRequired(false);
      setDataError(false);
    } catch {
      setDataError(true);
    }
  }, []);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) {
      refreshPending.current = true;
      return refreshInFlight.current;
    }

    const run = async () => {
      do {
        refreshPending.current = false;
        await refreshOnce();
      } while (refreshPending.current);
    };
    const promise = run();
    refreshInFlight.current = promise;
    void promise.then(
      () => {
        if (refreshInFlight.current === promise) refreshInFlight.current = null;
      },
      () => {
        if (refreshInFlight.current === promise) refreshInFlight.current = null;
      },
    );
    return promise;
  }, [refreshOnce]);

  const refreshUpdate = useCallback(async (check = false): Promise<void> => {
    try {
      const response = await fetch(`/api/v1/system/update${check ? '/check' : ''}`, {
        method: check ? 'POST' : 'GET',
      });
      if (response.ok) setUpdateStatus((await response.json()) as UpdateStatus);
    } catch {
      // Update availability is advisory and must never prevent the main dashboard from loading.
    }
  }, []);

  useEffect(() => {
    if (!['OWNER', 'ADMINISTRATOR'].includes(currentAccess.role)) return;
    void refreshUpdate(true);
    const timer = window.setInterval(() => void refreshUpdate(true), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [currentAccess.role, refreshUpdate]);

  useEffect(() => {
    if (active === 8 && ['OWNER', 'ADMINISTRATOR'].includes(currentAccess.role)) {
      void refreshUpdate(true);
    }
  }, [active, currentAccess.role, refreshUpdate]);

  const saveUpdateCredentials = useCallback(async (username: string, token: string) => {
    setUpdateBusy(true);
    try {
      const response = await fetch('/api/v1/system/update/credentials', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, token }),
      });
      if (response.ok) setUpdateStatus((await response.json()) as UpdateStatus);
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  const deleteUpdateCredentials = useCallback(async () => {
    setUpdateBusy(true);
    try {
      const response = await fetch('/api/v1/system/update/credentials', { method: 'DELETE' });
      if (response.ok) setUpdateStatus((await response.json()) as UpdateStatus);
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  const checkForUpdate = useCallback(async () => {
    setUpdateBusy(true);
    try {
      await refreshUpdate(true);
    } finally {
      setUpdateBusy(false);
    }
  }, [refreshUpdate]);

  const installUpdate = useCallback(
    async (version: string) => {
      setUpdateBusy(true);
      try {
        const response = await fetch('/api/v1/system/update/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version }),
        });
        if (response.ok) {
          setUpdateStatus((await response.json()) as UpdateStatus);
          return;
        }
        // The agent explains a refusal (older version, update already running…).
        const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
        const error =
          typeof body?.message === 'string' ? body.message : i18nT('app.theUpdateCouldNotStart');
        setUpdateStatus((current) => current && { ...current, error });
      } finally {
        setUpdateBusy(false);
      }
    },
    [locale],
  );

  const unreachable = dataError && !overview;
  useEffect(() => {
    // During an update the API restarts for a minute or two: a page opened or
    // reloaded meanwhile comes back on its own once Élise answers again.
    if (!unreachable) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [unreachable, refresh]);

  const updateRunning =
    updateStatus !== null &&
    ['DOWNLOADING', 'INSTALLING', 'VERIFYING', 'RESTARTING'].includes(updateStatus.state);
  useEffect(() => {
    // Follows an update started here or elsewhere, through the API restarting with the new release.
    if (!updateRunning) return;
    const timer = window.setInterval(() => void refreshUpdate(), 3000);
    return () => window.clearInterval(timer);
  }, [updateRunning, refreshUpdate]);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutFailed(false);
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!response.ok && response.status !== 401) throw new Error('Logout failed');
      setOverview(null);
      setHousehold(null);
      setAuthRequired(true);
      setPasswordChangeRequired(false);
      setMenuOpen(false);
      setDataError(false);
      setTourMode(null);
      setInitialTourHandled(false);
    } catch {
      setLogoutFailed(true);
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    if (previewSetup) return;
    let activeRequest = true;
    const start = async () => {
      try {
        const response = await fetch('/api/v1/auth/setup-state');
        if (!response.ok) throw new Error('Setup state unavailable');
        const state = (await response.json()) as { setupRequired: boolean };
        if (!activeRequest) return;
        setEntryState(state.setupRequired ? 'setup' : 'app');
        if (!state.setupRequired) await refresh();
      } catch {
        if (activeRequest) {
          setEntryState('app');
          setDataError(true);
        }
      }
    };
    void start();
    return () => {
      activeRequest = false;
    };
  }, [previewSetup, refresh]);

  useEffect(() => {
    if (authRequired || passwordChangeRequired || entryState !== 'app') return;
    const unsubscribe = subscribeRealtime((data) => {
      const action = homeRealtimeEventAction(data);
      if (action === 'IGNORE' || (action === 'PRESENCE' && active === 3)) return;
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = window.setTimeout(() => void refresh(), 500);
    });
    return () => {
      unsubscribe();
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = null;
    };
  }, [active, authRequired, passwordChangeRequired, entryState, refresh]);

  useEffect(() => {
    if (
      entryState === 'app' &&
      household?.home.installationStatus === 'DRAFT' &&
      !initialTourHandled &&
      !tourMode &&
      homeSection !== 'EDITOR'
    ) {
      setTourMode('initial');
    }
  }, [entryState, homeSection, household?.home.installationStatus, initialTourHandled, tourMode]);

  const showTourTarget = useCallback((index: number) => {
    setActive(index);
    if (index === 3) {
      setHomeEditorRoomId(null);
      setHomeSection('OVERVIEW');
    }
    if (window.matchMedia('(max-width: 960px)').matches) setMenuOpen(true);
  }, []);

  const closeTour = useCallback(() => {
    const initial = tourMode === 'initial';
    setTourMode(null);
    setMenuOpen(false);
    if (initial) {
      setInitialTourHandled(true);
      setHomeEditorRoomId(null);
      setHomeSection('EDITOR');
      setActive(3);
    } else {
      setHomeSetupPreview(true);
      setHomeEditorRoomId(null);
      setHomeSection('EDITOR');
      setActive(3);
    }
  }, [tourMode]);

  const replaceResidentPhoto = async (file: File) => {
    if (!resident) return;
    const form = new FormData();
    form.append('photo', await resizeResidentPhoto(file), 'resident.webp');
    const response = await fetch(`/api/v1/residents/${resident.id}/photo`, {
      method: 'POST',
      body: form,
    });
    if (response.ok) await refresh();
  };
  const removeResidentPhoto = async () => {
    if (!resident) return;
    const response = await fetch(`/api/v1/residents/${resident.id}/photo`, { method: 'DELETE' });
    if (response.ok) await refresh();
  };
  const openCamera = async (cameraId: string) => {
    const requestId = ++cameraSessionRequest.current;
    setCameraNotice('');
    try {
      const response = await fetch(`/api/v1/cameras/${cameraId}/live-session`, { method: 'POST' });
      if (requestId !== cameraSessionRequest.current) return;
      if (response.ok) {
        setCameraSession((await response.json()) as CameraSession);
        return;
      }
      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      setCameraNotice(result?.message ?? i18nT('app.liveViewIsUnavailable'));
    } catch {
      if (requestId === cameraSessionRequest.current) {
        setCameraNotice(i18nT('app.liveViewIsUnavailable'));
      }
    }
  };
  const runSimulation = async (scenario: string) => {
    setRunningSimulation(scenario);
    setSimulationNotice('');
    const response = await fetch(`/api/v1/simulation/scenarios/${scenario}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: createId(),
      }),
    });
    if (response.ok) {
      const result = (await response.json()) as { accepted: number; duplicates: number };
      setSimulationNotice(
        result.accepted > 0
          ? i18nT('app.eventSAddedToThe', { accepted: result.accepted })
          : i18nT('app.thisScenarioHadAlreadyBeen'),
      );
      await refresh();
    } else {
      setSimulationNotice(i18nT('app.theSituationCouldNotBe'));
    }
    setRunningSimulation(null);
  };
  const saveAlertRules = async () => {
    if (!alertRules) return false;
    setSavingRules(true);
    setRuleNotice('');
    const response = await fetch('/api/v1/alerts/rules', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alertRules),
    });
    if (response.ok) setAlertRules((await response.json()) as AlertRuleSettings);
    setRuleNotice(
      response.ok ? i18nT('app.yourLandmarksHaveBeenSaved') : i18nT('app.yourLandmarksCouldNotBe'),
    );
    setSavingRules(false);
    return response.ok;
  };
  const createMedication = async (draft: MedicationDraft): Promise<boolean> => {
    setSavingMedication(true);
    setMedicationNotice('');
    const response = await fetch('/api/v1/medications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: draft.name,
        dosage: draft.dosage,
        instructions: draft.instructions || undefined,
        schedules: [
          {
            time: draft.time,
            daysOfWeek: draft.daysOfWeek,
            graceMinutes: draft.graceMinutes,
          },
        ],
      }),
    });
    setSavingMedication(false);
    if (!response.ok) {
      setMedicationNotice(i18nT('app.theTreatmentCouldNotBe'));
      return false;
    }
    setMedicationNotice(i18nT('app.theTreatmentAndItsSchedule'));
    await refresh();
    return true;
  };
  const confirmMedicationDose = async (
    doseId: string,
    status: 'TAKEN' | 'SKIPPED',
  ): Promise<void> => {
    setMedicationNotice('');
    const response = await fetch(`/api/v1/medications/doses/${doseId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setMedicationNotice(
      response.ok
        ? status === 'TAKEN'
          ? i18nT('app.doseConfirmedTheTimelineIs')
          : i18nT('app.theDoseWasMarkedAs')
        : i18nT('app.theDoseCouldNotBe'),
    );
    if (response.ok) await refresh();
  };
  const resident = household?.residents.find((item) => item.primary) ?? household?.residents[0];
  const canEditResident = currentAccess.capabilities.includes('configuration:manage');
  const managerName = overview?.currentUser?.displayName ?? '';
  const managerInitials = managerName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const residentName = overview?.resident?.preferredName ?? overview?.home?.resident ?? '';
  const nextPendingDose = medicationDoses
    .filter((dose) => dose.status === 'PENDING' && new Date(dose.scheduledFor) >= new Date())
    .sort(
      (left, right) =>
        new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime(),
    )[0];
  const liaisonAttention = alerts.find(
    (alert) =>
      ['OPEN', 'ACKNOWLEDGED'].includes(alert.status) &&
      ['ATTENTION', 'URGENT'].includes(alert.severity),
  );
  if (entryState === 'loading') {
    return (
      <main className="data-loading-page">
        <DataLoadingScreen locale={locale} message={i18nT('app.preparingYourSpace')} fullPage />
      </main>
    );
  }
  if (entryState === 'setup') {
    return (
      <Setup
        locale={locale}
        onLocaleChange={changeLocale}
        onCompleted={() => {
          setEntryState('app');
          setAuthRequired(false);
          setHomeSection('OVERVIEW');
          setInitialTourHandled(false);
          setActive(0);
          void refresh();
        }}
      />
    );
  }
  if (authRequired)
    return (
      <Login
        locale={locale}
        onSuccess={() => void refresh()}
        onPasswordChangeRequired={() => {
          setAuthRequired(false);
          setPasswordChangeRequired(true);
        }}
        onOpenSetup={() => {
          setAuthRequired(false);
          setEntryState('setup');
        }}
      />
    );

  if (passwordChangeRequired) {
    return (
      <ChangePassword
        locale={locale}
        onSuccess={() => {
          setPasswordChangeRequired(false);
          void refresh();
        }}
      />
    );
  }

  if (dataError && !overview) {
    return (
      <main className="boot-screen unavailable-screen">
        <span className="boot-mark">
          <img src="/logo.png" alt="" />
        </span>
        <h1>{i18nT('app.eliseIsTemporarilyUnreachable')}</h1>
        <p>{i18nT('app.checkThatTheLocalService')}</p>
        <p className="unavailable-retry" role="status">
          <LoaderCircle className="spin" aria-hidden="true" />
          {i18nT('app.retryingAutomatically')}
        </p>
        <Button onClick={() => void refresh()}>{i18nT('app.tryAgain')}</Button>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="data-loading-page">
        <DataLoadingScreen locale={locale} message={i18nT('app.loadingYourData')} fullPage />
      </main>
    );
  }

  return (
    <div className={`app-shell ${sidebarAutoHideActive ? 'app-shell--sidebar-auto-hide' : ''}`}>
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <img src="/logo-transparent.png" width="46" height="46" alt="" />
          <span>
            élise<span className="brand-os">OS</span>
          </span>
        </div>
        <button
          className="mobile-close"
          onClick={() => setMenuOpen(false)}
          aria-label={i18nT('app.closeTheMenu')}
        >
          <X />
        </button>
        <div className="sidebar-navigation">
          <SidebarNavigation
            labels={t.nav}
            active={active}
            openAlerts={overview.openAlerts ?? 0}
            updateAvailable={updateStatus?.updateAvailable ?? false}
            onSelect={(index) => {
              if (index === 3) {
                setHomeEditorRoomId(null);
                setHomeSection('OVERVIEW');
              }
              setActive(index);
              if (!tourMode) setMenuOpen(false);
            }}
          />
        </div>
        <div className="caregiver">
          <div className="avatar">{managerInitials || '—'}</div>
          <div className="caregiver-identity">
            <strong>{managerName}</strong>
            <span>{i18nT('app.primaryCaregiver')}</span>
          </div>
          <button
            type="button"
            className={`caregiver-logout${logoutFailed ? ' caregiver-logout--failed' : ''}`}
            onClick={() => void logout()}
            disabled={loggingOut}
            aria-label={logoutFailed ? i18nT('app.retrySigningOut') : i18nT('app.signOut')}
            title={i18nT('app.signOut')}
          >
            <LogOut size={16} />
            <span className="sr-only">
              {logoutFailed
                ? i18nT('app.tryAgain')
                : loggingOut
                  ? i18nT('app.signingOut')
                  : i18nT('app.signOut')}
            </span>
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar topbar--compact">
          <button
            className="mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label={i18nT('app.openTheMenu')}
          >
            <Menu />
          </button>
          {active === 0 && (
            <div className="top-actions">
              <StatusPill>{t.local}</StatusPill>
            </div>
          )}
        </header>

        {dataError && (
          <div className="connection-banner" role="status">
            <Radar />
            <span>
              <strong>{i18nT('app.localConnectionInterrupted')}</strong>
              {i18nT('app.theLatestReceivedInformationRemains')}
            </span>
            <button type="button" onClick={() => void refresh()}>
              {i18nT('app.retry')}
            </button>
          </div>
        )}

        <Suspense fallback={<DataLoadingScreen locale={locale} />}>
          {active === 1 ? (
            <ActivityPage
              locale={locale}
              homeName={household?.home.name ?? overview.home?.name ?? 'Élise'}
              timeZone={household?.home.timezone ?? 'Europe/Paris'}
              residentName={residentName}
              reassurance={overview.reassurance ?? 'INSUFFICIENT_DATA'}
              openAlerts={overview.openAlerts ?? 0}
              canManage={currentAccess.role === 'OWNER' || currentAccess.role === 'ADMINISTRATOR'}
              onOpenAlerts={() => setActive(2)}
              onOpenRoom={(roomId) => {
                setHomeEditorRoomId(roomId);
                setHomeEditorStairId(null);
                setHomeSection('EDITOR');
                setActive(3);
              }}
              onOpenStair={(stairId) => {
                setHomeEditorRoomId(null);
                setHomeEditorStairId(stairId);
                setHomeSection('EDITOR');
                setActive(3);
              }}
            />
          ) : active === 2 ? (
            <AlertsPage
              locale={locale}
              canManage={currentAccess.capabilities.includes('alerts:manage')}
              residentName={residentName}
              timezone={household?.home.timezone ?? 'Europe/Paris'}
              onSettings={() => {
                setSettingsTab('rules');
                setActive(8);
              }}
              onOpenHomeCategory={(category) => {
                setHomeSection('OVERVIEW');
                setHomeSensorCategory(category);
                setActive(3);
              }}
              onCall={async () => {
                await startResidentScreenCall();
                setScreenSection('call');
                setActive(10);
              }}
              onChanged={refresh}
            />
          ) : active === 3 ? (
            homeSection === 'OVERVIEW' ? (
              <HomeOverview
                locale={locale}
                home={household?.home}
                cameras={cameras}
                initialSensorCategory={homeSensorCategory}
                onSensorCategoryOpened={clearHomeSensorCategory}
                canManage={currentAccess.role === 'OWNER' || currentAccess.role === 'ADMINISTRATOR'}
                onManage={(roomId) => {
                  setHomeEditorRoomId(roomId ?? null);
                  setHomeEditorStairId(null);
                  setHomeSection('EDITOR');
                }}
                onManageStair={(stairId) => {
                  setHomeEditorRoomId(null);
                  setHomeEditorStairId(stairId);
                  setHomeSection('EDITOR');
                }}
              />
            ) : (
              <HomePlanEditor
                key={homeSetupPreview ? 'setup-preview' : 'home-plan'}
                locale={locale}
                home={household?.home}
                sensors={[
                  ...(household?.unassignedSensors ?? []),
                  ...(household?.rooms.flatMap((room) => room.sensors) ?? []),
                ]}
                cameras={cameras}
                initialRoomId={homeSection === 'EDITOR' ? homeEditorRoomId : null}
                initialStairId={homeSection === 'EDITOR' ? homeEditorStairId : null}
                setupPreview={homeSetupPreview}
                onSetupPreviewClose={() => {
                  setHomeSetupPreview(false);
                  setHomeEditorRoomId(null);
                  setHomeEditorStairId(null);
                  setHomeSection('OVERVIEW');
                  setActive(tourReturnActive.current);
                }}
                onBack={() => {
                  setHomeEditorRoomId(null);
                  setHomeEditorStairId(null);
                  setHomeSection('OVERVIEW');
                }}
                onSaved={() => void refresh()}
              />
            )
          ) : active === 5 ? (
            <MedicationPanel
              locale={locale}
              medications={medications}
              doses={medicationDoses}
              submitting={savingMedication}
              notice={medicationNotice}
              onCreate={createMedication}
              onConfirm={(doseId) => void confirmMedicationDose(doseId, 'TAKEN')}
              onSkip={(doseId) => void confirmMedicationDose(doseId, 'SKIPPED')}
            />
          ) : active === 12 ? (
            <CalendarPage locale={locale} onBack={() => setActive(11)} />
          ) : active === 11 ? (
            <LiaisonPage
              locale={locale}
              pendingMedication={
                nextPendingDose
                  ? {
                      name: nextPendingDose.schedule.medication.name,
                      dosage: nextPendingDose.schedule.medication.dosage,
                      scheduledFor: nextPendingDose.scheduledFor,
                    }
                  : null
              }
              attention={liaisonAttention ?? null}
              onMedication={() => setActive(5)}
              onAttention={() => setActive(2)}
              onJournal={() => setActive(6)}
              onCalendar={() => setActive(12)}
            />
          ) : active === 6 ? (
            <JournalPage
              locale={locale}
              items={journal}
              timezone={household?.home.timezone ?? 'Europe/Paris'}
              residentName={residentName}
              onBack={() => setActive(11)}
            />
          ) : active === 7 ? (
            <PeoplePanel locale={locale} currentRole={currentAccess.role} />
          ) : active === 9 ? (
            <CamerasPanel
              locale={locale}
              cameras={cameras}
              recordings={cameraRecordings}
              session={cameraSession}
              notice={cameraNotice}
              onOpen={(cameraId) => void openCamera(cameraId)}
              onClose={() => {
                cameraSessionRequest.current += 1;
                setCameraSession(null);
              }}
            />
          ) : active === 10 ? (
            <ScreenPanel initialSection={screenSection} locale={locale} />
          ) : active === 11 ? (
            <section className="section-view resident-page">
              <header className="page-hero resident-hero">
                <div className="page-hero__copy">
                  <span className="page-hero__eyebrow">{i18nT('app.supportProfile')}</span>
                  <h2 className="page-hero__title">
                    {i18nT('app.residentProfileTitle', {
                      name: resident?.preferredName ?? resident?.displayName ?? residentName,
                    })}
                  </h2>
                  <p className="page-hero__text">
                    {i18nT('app.essentialContextForAttentivePersonal')}
                  </p>
                </div>
                <Button className="button-secondary resident-back" onClick={() => setActive(0)}>
                  <ChevronRight aria-hidden="true" />
                  {i18nT('app.backToHome')}
                </Button>
              </header>

              {resident ? (
                <div className="resident-profile-layout">
                  <Card className="resident-profile-card">
                    <div className="resident-profile-photo">
                      {resident.photoUrl ? (
                        <img
                          src={resident.photoUrl}
                          alt={i18nT('app.residentPortrait', { name: resident.displayName })}
                        />
                      ) : (
                        <div className="resident-photo-fallback">
                          {(resident.preferredName ?? resident.firstName ?? '?')[0]}
                        </div>
                      )}
                      {canEditResident && (
                        <label className="resident-photo-upload" title={i18nT('app.changePhoto')}>
                          <Camera aria-hidden="true" />
                          <span className="sr-only">{i18nT('app.changePhoto')}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void replaceResidentPhoto(file);
                            }}
                          />
                        </label>
                      )}
                    </div>

                    <div className="resident-profile-intro">
                      <span className="resident-primary-pill">
                        <i />
                        {i18nT('app.resident')}
                      </span>
                      <h3>
                        {resident.firstName} {resident.lastName}
                      </h3>
                      <p>
                        {resident.formOfAddress
                          ? `${resident.formOfAddress} · ${resident.preferredName || resident.firstName}`
                          : i18nT('app.preferredName', {
                              value: resident.preferredName || resident.firstName || '—',
                            })}
                      </p>
                    </div>

                    <div className="resident-facts">
                      <div>
                        <span className="resident-fact-icon resident-fact-icon--date">
                          <CalendarDays aria-hidden="true" />
                        </span>
                        <p>
                          <small>{i18nT('app.born')}</small>
                          <strong>
                            {resident.birthDate
                              ? new Date(resident.birthDate).toLocaleDateString(locale, {
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric',
                                })
                              : '—'}
                          </strong>
                          {residentAge(resident.birthDate) && (
                            <span>{residentAge(resident.birthDate)}</span>
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="resident-fact-icon resident-fact-icon--language">
                          <BookOpen aria-hidden="true" />
                        </span>
                        <p>
                          <small>{i18nT('app.spokenLanguage')}</small>
                          <strong>{resident.spokenLanguage || '—'}</strong>
                        </p>
                      </div>
                    </div>

                    {canEditResident && resident.photoUrl && (
                      <button
                        className="resident-remove-photo"
                        type="button"
                        onClick={() => void removeResidentPhoto()}
                      >
                        <Trash2 aria-hidden="true" />
                        {i18nT('app.removePhoto')}
                      </button>
                    )}
                  </Card>

                  <div className="resident-content-grid">
                    <Card className="resident-info-card resident-context-card">
                      <header>
                        <span className="resident-section-icon resident-section-icon--home">
                          <Home aria-hidden="true" />
                        </span>
                        <div>
                          <span className="eyebrow">{i18nT('app.livingContext')}</span>
                          <h3>{i18nT('app.dailyLife')}</h3>
                        </div>
                      </header>
                      {resident.context ? (
                        <div className="resident-context-list">
                          <div className="resident-context-item resident-context-item--wide">
                            {resident.context.livesAlone === null ? (
                              <CircleHelp aria-hidden="true" />
                            ) : resident.context.livesAlone ? (
                              <Home aria-hidden="true" />
                            ) : (
                              <UsersRound aria-hidden="true" />
                            )}
                            <span>
                              {resident.context.livesAlone === null
                                ? i18nT('app.livingSituationNotProvided')
                                : resident.context.livesAlone
                                  ? i18nT('app.livesAloneAtHome')
                                  : i18nT('app.livesWithSomeoneAtHome')}
                            </span>
                          </div>
                          {resident.context.livesWithPartner && (
                            <div className="resident-context-item">
                              <HeartHandshake aria-hidden="true" />
                              <span>{i18nT('app.withAPartner')}</span>
                            </div>
                          )}
                          {resident.context.livesWithRelative && (
                            <div className="resident-context-item">
                              <UsersRound aria-hidden="true" />
                              <span>{i18nT('app.withARelative')}</span>
                            </div>
                          )}
                          {resident.context.receivesHomeHelp && (
                            <div className="resident-context-item">
                              <Accessibility aria-hidden="true" />
                              <span>{i18nT('app.homeHelp')}</span>
                            </div>
                          )}
                          {resident.context.receivesVisits && (
                            <div className="resident-context-item">
                              <CalendarDays aria-hidden="true" />
                              <span>{i18nT('app.regularVisits')}</span>
                            </div>
                          )}
                          {resident.context.hasPet && (
                            <div className="resident-context-item">
                              <PawPrint aria-hidden="true" />
                              <span>{i18nT('app.livesWithAPet')}</span>
                            </div>
                          )}
                          <div className="resident-context-item resident-context-item--wide">
                            <Footprints aria-hidden="true" />
                            <span>{residentMobilityLabel(resident.context.mobility)}</span>
                          </div>
                          {resident.context.visualDifficulty && (
                            <div className="resident-context-item resident-context-item--attention">
                              <Eye aria-hidden="true" />
                              <span>{i18nT('app.visualDifficulty')}</span>
                            </div>
                          )}
                          {resident.context.hearingDifficulty && (
                            <div className="resident-context-item resident-context-item--attention">
                              <Ear aria-hidden="true" />
                              <span>{i18nT('app.hearingDifficulty')}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="resident-empty-state">
                          <Home aria-hidden="true" />
                          <p>{i18nT('app.noContextRecorded')}</p>
                        </div>
                      )}
                    </Card>

                    <Card className="resident-info-card resident-support-card">
                      <header>
                        <span className="resident-section-icon resident-section-icon--support">
                          <HeartHandshake aria-hidden="true" />
                        </span>
                        <div>
                          <span className="eyebrow">{i18nT('app.support')}</span>
                          <h3>{i18nT('app.keyConsiderations')}</h3>
                        </div>
                        <span className="resident-card-count">{resident.supportNeeds.length}</span>
                      </header>
                      {resident.supportNeeds.length ? (
                        <div className="resident-support-list">
                          {resident.supportNeeds.map((need) => (
                            <article key={need.id}>
                              <span>
                                {need.kind === 'VISION' ? (
                                  <Eye aria-hidden="true" />
                                ) : need.kind === 'HEARING' ? (
                                  <Ear aria-hidden="true" />
                                ) : need.kind === 'FALL_RISK' || need.kind === 'PARKINSON' ? (
                                  <Footprints aria-hidden="true" />
                                ) : (
                                  <HeartHandshake aria-hidden="true" />
                                )}
                              </span>
                              <div>
                                <strong>{supportNeedLabel(need.kind)}</strong>
                                {need.note && <p>{need.note}</p>}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="resident-empty-state resident-empty-state--positive">
                          <CircleCheck aria-hidden="true" />
                          <p>{i18nT('app.noParticularSupportNeedRecorded')}</p>
                        </div>
                      )}
                    </Card>

                    <Card className="resident-info-card resident-habits-card">
                      <header>
                        <span className="resident-section-icon resident-section-icon--habits">
                          <Clock3 aria-hidden="true" />
                        </span>
                        <div>
                          <span className="eyebrow">{i18nT('app.habits')}</span>
                          <h3>{i18nT('app.dailyRoutines')}</h3>
                        </div>
                        <span className="resident-card-count">{resident.habits.length}</span>
                      </header>
                      {resident.habits.length ? (
                        <div className="resident-routine-list">
                          {resident.habits.map((habit) => (
                            <article key={habit.id}>
                              <span className="resident-routine-dot" />
                              <div>
                                <strong>{habitLabel(habit.kind)}</strong>
                                <small>
                                  {habit.status === 'UNKNOWN'
                                    ? i18nT('app.eliseIsLearningThisRoutine')
                                    : `${formatMinute(habit.startMinute)} – ${formatMinute(habit.endMinute)}`}
                                </small>
                              </div>
                              <span
                                className={`resident-routine-status status-${habit.status.toLowerCase()}`}
                              >
                                {habit.status === 'UNKNOWN'
                                  ? i18nT('app.toLearn')
                                  : i18nT('app.recorded')}
                              </span>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="resident-empty-state">
                          <Clock3 aria-hidden="true" />
                          <p>{i18nT('app.eliseWillLearnRoutinesProgressively')}</p>
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              ) : (
                <Card className="resident-empty-profile">
                  <UserRound aria-hidden="true" />
                  <h3>{i18nT('app.noResidentConfigured')}</h3>
                  <p>{i18nT('app.theProfileWillAppearHere')}</p>
                </Card>
              )}
            </section>
          ) : active === 8 ? (
            <section className="section-view settings-page">
              <header className="page-hero settings-hero">
                <div className="page-hero__copy settings-hero-copy">
                  <span className="page-hero__eyebrow">Élise OS</span>
                  <h2 className="page-hero__title">{t.nav[8]}</h2>
                  <p className="page-hero__text">{i18nT('app.adaptEliseToYourDaily')}</p>
                </div>
                <span className="settings-hero-icon" aria-hidden="true">
                  <Settings />
                </span>
              </header>

              <nav className="settings-tabs" aria-label={i18nT('app.settingsSections')}>
                {visibleSettingsTabs(currentAccess.capabilities).map((tab) => {
                  const Icon = settingsTabIcons[tab];
                  return (
                    <button
                      key={tab}
                      type="button"
                      className={settingsTab === tab ? 'is-selected' : ''}
                      aria-selected={settingsTab === tab}
                      onClick={() => setSettingsTab(tab)}
                    >
                      <Icon aria-hidden="true" /> {settingsTabLabel(tab)}
                    </button>
                  );
                })}
              </nav>

              {settingsTab === 'general' && (
                <details className="elise-card settings-section-card settings-disclosure settings-general-card">
                  <summary className="settings-section-heading">
                    <span className="settings-section-icon">
                      <Settings />
                    </span>
                    <div>
                      <span className="eyebrow">{i18nT('app.applicationPreferences')}</span>
                      <h2>{i18nT('app.general')}</h2>
                      <p>{i18nT('app.essentialSettingsForThisDevice')}</p>
                    </div>
                    <span className="settings-disclosure-chevron" aria-hidden="true">
                      <ChevronRight />
                    </span>
                  </summary>

                  <div className="settings-option-list">
                    <article className="settings-option-row settings-language-row">
                      <div className="settings-option-copy">
                        <span className="settings-option-icon settings-option-icon--sage">
                          <Languages />
                        </span>
                        <div>
                          <h3>{i18nT('app.interfaceLanguage')}</h3>
                          <p>{i18nT('app.chooseTheLanguageEliseUses')}</p>
                        </div>
                      </div>
                      <div className="settings-language-options" role="group" aria-label="Language">
                        {dashboardLanguages.map((language) => (
                          <button
                            key={language.code}
                            className={locale === language.code ? 'is-selected' : ''}
                            onClick={() => changeLocale(language.code)}
                            aria-pressed={locale === language.code}
                          >
                            <FlagIcon language={language.code} />
                            <strong>{language.name}</strong>
                            {locale === language.code && <CircleCheck />}
                          </button>
                        ))}
                      </div>
                    </article>

                    <SidebarBehaviorSetting
                      locale={locale}
                      enabled={sidebarAutoHide}
                      disabled={sidebarAutoHideLocked}
                      onChange={changeSidebarAutoHide}
                    />

                    <article className="settings-option-row guided-tour-settings">
                      <div className="settings-option-copy">
                        <span className="settings-option-icon settings-option-icon--amber">
                          <Sparkles />
                        </span>
                        <div>
                          <h3>{i18nT('app.guidedTour')}</h3>
                          <p>{i18nT('app.rediscoverTheEssentialAreasOf')}</p>
                        </div>
                      </div>
                      <Button
                        className="button-secondary"
                        onClick={() => {
                          tourReturnActive.current = active;
                          setHomeSetupPreview(false);
                          setTourMode('replay');
                        }}
                      >
                        {i18nT('app.replayTheTour')}
                      </Button>
                    </article>

                    {simulationScenarios.length > 0 && (
                      <SimulationPanel
                        scenarios={simulationScenarios}
                        running={runningSimulation}
                        notice={simulationNotice}
                        onRun={(scenario) => void runSimulation(scenario)}
                        locale={locale}
                      />
                    )}
                  </div>
                </details>
              )}
              {settingsTab === 'general' &&
                currentAccess.capabilities.includes('configuration:manage') && (
                  <RemoteAccessCard locale={locale} />
                )}
              {settingsTab === 'general' &&
                currentAccess.capabilities.includes('configuration:manage') && (
                  <UpdateCard
                    locale={locale}
                    status={updateStatus}
                    busy={updateBusy}
                    onCheck={() => void checkForUpdate()}
                    onSaveCredentials={(username, token) =>
                      void saveUpdateCredentials(username, token)
                    }
                    onDeleteCredentials={() => void deleteUpdateCredentials()}
                    onInstall={(version) => void installUpdate(version)}
                  />
                )}
              {settingsTab === 'zigbee' &&
                currentAccess.capabilities.includes('configuration:manage') && <ZigbeeKeyPanel />}
              {settingsTab === 'health' &&
                currentAccess.capabilities.includes('configuration:manage') && (
                  <BoxHealthPanel
                    onOpenZigbee={() => setSettingsTab('zigbee')}
                    onOpenSensors={() => {
                      setHomeSensorCategory(null);
                      setHomeSection('OVERVIEW');
                      setActive(3);
                    }}
                    onOpenRemoteAccess={openRemoteAccess}
                  />
                )}
              {settingsTab === 'rules' && alertRules && (
                <AlertRulesPanel
                  rules={alertRules}
                  locale={locale}
                  saving={savingRules}
                  notice={ruleNotice}
                  onChange={setAlertRules}
                  onSave={saveAlertRules}
                />
              )}
            </section>
          ) : active !== 0 ? (
            <section className="placeholder-view">
              <Card>
                <div className="placeholder-icon">
                  {(() => {
                    const Icon = navIcons[active]!;
                    return <Icon />;
                  })()}
                </div>
                <h2>{t.nav[active]}</h2>
                <p>{i18nT('app.thisSectionAlreadyUsesThe')}</p>
                <Button onClick={() => setActive(0)}>{t.nav[0]}</Button>
              </Card>
            </section>
          ) : (
            <WelcomePage
              locale={locale}
              caregiverFirstName={overview.currentUser?.firstName ?? ''}
              residentName={residentName}
              nextSchedule={overview.nextSchedule}
              reassurance={overview.reassurance ?? 'INSUFFICIENT_DATA'}
              events={(overview.activity ?? []).map((event) => ({
                id: event.id,
                occurredAt: event.occurredAt,
                capability: event.capability,
                label: `${activityDescription(event)}${event.room ? ` · ${event.room}` : ''}`,
              }))}
              reminders={[
                ...medicationDoses
                  .filter((dose) => dose.status === 'PENDING')
                  .map((dose) => ({
                    title: i18nT('app.medication'),
                    at: dose.scheduledFor,
                    medication: true,
                  })),
                ...(overview.nextSchedule
                  ? [
                      {
                        title: overview.nextSchedule.title,
                        at: overview.nextSchedule.startsAt,
                        medication: false,
                      },
                    ]
                  : []),
              ]}
              onActivity={() => setActive(1)}
              onSensors={() => {
                setHomeSection('OVERVIEW');
                setActive(3);
              }}
              onPlanning={(medication) => {
                if (medication) setActive(5);
                else setActive(12);
              }}
              onAlerts={() => setActive(2)}
              onOpenRoom={(roomId) => {
                setHomeEditorRoomId(roomId);
                setHomeEditorStairId(null);
                setHomeSection('EDITOR');
                setActive(3);
              }}
            />
          )}
        </Suspense>
      </main>
      {tourMode && (
        <GuidedTour
          key={tourMode}
          locale={locale}
          mode={tourMode}
          onTargetChange={showTourTarget}
          onComplete={closeTour}
          onSkip={closeTour}
        />
      )}
    </div>
  );
}
