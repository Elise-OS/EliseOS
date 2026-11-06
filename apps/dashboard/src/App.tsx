import { LiaisonPage } from './LiaisonPage';
import { JournalPage } from './JournalPage';
import { CalendarPage } from './CalendarPage';
import { WelcomePage } from './WelcomePage';
import { ScreenPanel, startResidentScreenCall } from './ScreenPanel';
import { AlertsPage, type SafetyCategory } from './AlertsPage';
import { AlertRulesPanel } from './AlertRulesPanel';
import { Button, Card, StatusPill } from '@elise/ui';
import {
  Accessibility,
  Activity,
  Archive,
  Bell,
  BookOpen,
  CalendarDays,
  Camera,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock3,
  DoorOpen,
  Ear,
  Eye,
  Footprints,
  HeartHandshake,
  Home,
  Languages,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  PawPrint,
  PanelLeftClose,
  Pill,
  Phone,
  Play,
  Plus,
  Power,
  Radar,
  Search,
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
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  currentLanguage,
  dashboardLanguages,
  dateLocale,
  type Locale,
  setLanguage,
  t as i18nT,
  textBlock,
} from './i18n';
import { resizeResidentPhoto, Setup } from './Setup';
import { HomePlanEditor } from './HomePlanEditor';
import { HomeOverview, homeRealtimeEventAction } from './HomeOverview';
import { GuidedTour, type GuidedTourMode } from './GuidedTour';
import { DataLoadingScreen } from './DataLoadingScreen';
import { FlagIcon } from './FlagIcons';
import { RemoteAccessCard } from './RemoteAccessCard';
import { ActivityPage } from './ActivityPage';
import { UpdateCard } from './UpdateCard';
import type { UpdateStatus } from '@elise/contracts';

interface Overview {
  onboardingRequired: boolean;
  currentUser?: { id: string; displayName: string; firstName: string };
  home?: { id: string; name: string; type: string; resident: string | null };
  resident?: {
    id: string;
    displayName: string;
    preferredName: string;
    photoUrl: string | null;
    supportNeeds: string[];
    knownHabits: number;
  } | null;
  reassurance?: 'NORMAL' | 'LEARNING' | 'ATTENTION' | 'INSUFFICIENT_DATA';
  learningDays?: number;
  openAlerts?: number;
  sensors?: { total: number; online: number; degraded: number; offline: number };
  nextSchedule?: {
    id: string;
    type: 'VISIT' | 'APPOINTMENT';
    title: string;
    startsAt: string;
  } | null;
  lastActivity?: { occurredAt: string; capability: string; room: string | null } | null;
  rooms?: Array<{ id: string; name: string; kind: string; sensors: number }>;
  activity?: Array<{
    id: string;
    occurredAt: string;
    capability: string;
    room: string;
    payload: unknown;
  }>;
}

interface HouseholdSensor {
  id: string;
  entityId: string;
  capability: string;
  status: string;
  lastSeenAt?: string | null;
  lastValue?: Record<string, unknown> | null;
  device?: { name: string; manufacturer: string | null; model: string | null } | null;
}

interface Household {
  home: {
    id: string;
    name: string;
    timezone: string;
    type: string;
    address: string | null;
    floorCount: number;
    installationStatus: string;
    learningStartedAt: string | null;
  };
  residents: Array<{
    id: string;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    preferredName: string | null;
    birthDate: string | null;
    spokenLanguage: string;
    formOfAddress: string | null;
    photoUrl: string | null;
    primary: boolean;
    context: null | {
      livesAlone: boolean | null;
      livesWithPartner: boolean | null;
      livesWithRelative: boolean | null;
      receivesHomeHelp: boolean | null;
      receivesVisits: boolean | null;
      hasPet: boolean | null;
      mobility: string;
      hearingDifficulty: boolean | null;
      visualDifficulty: boolean | null;
    };
    supportNeeds: Array<{ id: string; kind: string; note: string | null }>;
    habits: Array<{
      id: string;
      kind: string;
      status: string;
      startMinute: number | null;
      endMinute: number | null;
    }>;
  }>;
  trustedContacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    relation: string | null;
    role: 'OWNER' | 'ADMINISTRATOR' | 'CAREGIVER' | 'VIEWER' | null;
    isEmergency: boolean;
    priority: number;
    hasAccount: boolean;
    accessDisabled: boolean;
    archived: boolean;
    isCurrentUser: boolean;
    username: string | null;
  }>;
  rooms: Array<{
    id: string;
    name: string;
    kind: string;
    floor: number;
    sortOrder: number;
    sensors: HouseholdSensor[];
  }>;
  unassignedSensors: HouseholdSensor[];
}

type Person = Household['trustedContacts'][number];
type AccessRole = Exclude<Person['role'], 'OWNER' | null>;

interface CurrentAccess {
  role: 'OWNER' | 'ADMINISTRATOR' | 'CAREGIVER' | 'VIEWER';
  capabilities: string[];
}

interface ActivityItem {
  id: string;
  occurredAt: string;
  capability: string;
  sensor?: { room?: { name: string } | null } | null;
  room?: string;
  payload: unknown;
}

interface AlertItem {
  id: string;
  type: string;
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
  title: string;
  explanation: string;
  openedAt: string;
  transitions?: Array<{
    id: string;
    from: string;
    to: string;
    note: string | null;
    createdAt: string;
  }>;
  cameraSnapshots?: Array<{
    id: string;
    cameraId: string;
    capturedAt: string;
    expiresAt: string;
  }>;
}

interface CameraItem {
  id: string;
  name: string;
  provider: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  compatibility: 'VALIDATED' | 'RECOGNIZED' | 'PARTIAL' | 'UNSUPPORTED';
  room: { id: string; name: string; kind: string } | null;
  capabilities: { live: boolean; talk: boolean; ptz: boolean; privacy: boolean; snapshot: boolean };
  privacyMode: boolean;
  consentedAt: string | null;
  lastSeenAt: string | null;
  lastPersonSeenAt: string | null;
}

interface CameraSession {
  cameraId: string;
  mediaUrl: string;
  expiresAt: string;
  talkEnabled: boolean;
}

interface CameraRecording {
  id: string;
  cameraId: string;
  cameraName: string;
  roomId: string | null;
  roomName: string | null;
  doorName: string;
  capturedAt: string;
  durationSeconds: number;
  expiresAt: string;
}

interface JournalItem {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  occurredAt: string;
}

interface SimulationScenario {
  id: string;
  title: string;
  description: string;
}

interface AlertRuleSettings {
  inactivity: { enabled: boolean; minutes: number };
  doorOpen: { enabled: boolean; minutes: number };
  lowTemperature: { enabled: boolean; celsius: number; minutes: number };
  highTemperature: { enabled: boolean; celsius: number; minutes: number };
  nightActivity: {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    minimumEvents: number;
  };
  sensorOffline: { enabled: boolean; minutes: number };
  lowBattery: { enabled: boolean; percent: number };
  behavioral: { enabled: boolean };
}

interface MedicationItem {
  id: string;
  name: string;
  dosage: string;
  instructions: string | null;
  active: boolean;
  schedules: Array<{
    id: string;
    minuteOfDay: number;
    daysOfWeek: number[];
    graceMinutes: number;
    active: boolean;
  }>;
}

interface MedicationDoseItem {
  id: string;
  scheduledFor: string;
  status: 'PENDING' | 'TAKEN' | 'MISSED' | 'SKIPPED';
  confirmedAt: string | null;
  note: string | null;
  schedule: {
    graceMinutes: number;
    medication: MedicationItem;
  };
  confirmedBy?: { id: string; displayName: string } | null;
}

interface MedicationDraft {
  name: string;
  dosage: string;
  instructions: string;
  time: string;
  daysOfWeek: number[];
  graceMinutes: number;
}

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

function time(value?: string): string {
  if (!value) return '—';
  const date = new Date(Number.isNaN(Number(value)) ? value : Number(value));
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatMinute(value: number | null): string {
  if (value === null) return '—';
  return `${String(Math.floor(value / 60)).padStart(2, '0')} h ${String(value % 60).padStart(2, '0')}`;
}

function residentAge(value: string | null): string | null {
  if (!value) return null;
  const birthDate = new Date(value);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return i18nT('app.yearsOld', { age });
}

function residentMobilityLabel(value: string): string {
  const labels: Record<string, () => string> = {
    INDEPENDENT: () => i18nT('app.residentMobilityLabel.labels.INDEPENDENT'),
    CANE: () => i18nT('app.residentMobilityLabel.labels.CANE'),
    WALKER: () => i18nT('app.residentMobilityLabel.labels.WALKER'),
    WHEELCHAIR: () => i18nT('app.residentMobilityLabel.labels.WHEELCHAIR'),
    UNKNOWN: () => i18nT('app.residentMobilityLabel.labels.UNKNOWN'),
  };
  return labels[value]?.() ?? value;
}

function supportNeedLabel(value: string): string {
  const labels: Record<string, () => string> = {
    MEMORY: () => i18nT('app.supportNeedLabel.labels.MEMORY'),
    PARKINSON: () => i18nT('app.supportNeedLabel.labels.PARKINSON'),
    FALL_RISK: () => i18nT('app.supportNeedLabel.labels.FALL_RISK'),
    VISION: () => i18nT('app.supportNeedLabel.labels.VISION'),
    HEARING: () => i18nT('app.supportNeedLabel.labels.HEARING'),
    OTHER: () => i18nT('app.supportNeedLabel.labels.OTHER'),
  };
  return labels[value]?.() ?? value;
}

function habitLabel(value: string): string {
  const labels: Record<string, () => string> = {
    WAKE_UP: () => i18nT('app.habitLabel.labels.WAKE_UP'),
    BREAKFAST: () => i18nT('app.habitLabel.labels.BREAKFAST'),
    LUNCH: () => i18nT('app.habitLabel.labels.LUNCH'),
    DINNER: () => i18nT('app.habitLabel.labels.DINNER'),
    BEDTIME: () => i18nT('app.habitLabel.labels.BEDTIME'),
    NIGHT: () => i18nT('app.habitLabel.labels.NIGHT'),
    // Habits named during the first setup keep their French names.
    Lever: () => i18nT('app.habitLabel.labels.Lever'),
    Déjeuner: () => i18nT('app.habitLabel.labels.Déjeuner'),
    Dîner: () => i18nT('app.habitLabel.labels.Dîner'),
    Coucher: () => i18nT('app.habitLabel.labels.Coucher'),
  };
  return (
    labels[value]?.() ??
    value
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

function capabilityLabel(capability: string): string {
  const labels: Record<string, () => string> = {
    motion: () => i18nT('app.capabilityLabel.labels.motion'),
    occupancy: () => i18nT('app.capabilityLabel.labels.occupancy'),
    person_presence: () => i18nT('app.capabilityLabel.labels.person_presence'),
    contact: () => i18nT('app.capabilityLabel.labels.contact'),
    dry_contact: () => i18nT('app.capabilityLabel.labels.dry_contact'),
    button: () => i18nT('app.capabilityLabel.labels.button'),
    temperature: () => i18nT('app.capabilityLabel.labels.temperature'),
    humidity: () => i18nT('app.capabilityLabel.labels.humidity'),
    power: () => i18nT('app.capabilityLabel.labels.power'),
    energy: () => i18nT('app.capabilityLabel.labels.energy'),
    battery: () => i18nT('app.capabilityLabel.labels.battery'),
  };
  return labels[capability]?.() ?? capability;
}

export function activityDescription(item: ActivityItem): string {
  const payload =
    item.payload && typeof item.payload === 'object'
      ? (item.payload as Record<string, unknown>)
      : {};
  const context =
    payload.context && typeof payload.context === 'object'
      ? (payload.context as Record<string, unknown>)
      : {};
  const contactRole = typeof context.role === 'string' ? context.role : null;
  const bedOccupiedWhen =
    context.bedOccupiedWhen === 'OPEN' || item.capability === 'occupancy' ? 'OPEN' : 'CLOSED';
  const rawValue = ['contact', 'dry_contact', 'occupancy'].includes(item.capability)
    ? (payload.open ?? payload.active ?? payload.value ?? payload.state)
    : (payload.value ?? payload.state);
  const unit = typeof payload.unit === 'string' ? payload.unit : '';
  const value =
    typeof rawValue === 'number' || typeof rawValue === 'string'
      ? `${rawValue}${unit ? ` ${unit}` : ''}`
      : null;
  const contactOpen =
    rawValue === true || rawValue === 'open' || rawValue === 'on' || rawValue === 1;
  const bed = () =>
    contactOpen === (bedOccupiedWhen === 'OPEN')
      ? i18nT('app.activityText.bedOccupied')
      : i18nT('app.activityText.bedUnoccupied');
  const labels: Record<string, () => string> = {
    motion: () => i18nT('app.activityText.movementDetected'),
    occupancy: () =>
      contactRole === 'BED'
        ? contactOpen
          ? i18nT('app.activityText.bedOccupied')
          : i18nT('app.activityText.bedUnoccupied')
        : i18nT('app.activityText.presenceDetected'),
    person_presence: () => i18nT('app.activityText.personDetected'),
    contact: () =>
      contactRole === 'BED'
        ? bed()
        : contactRole === 'FRIDGE'
          ? contactOpen
            ? i18nT('app.activityText.fridgeOpen')
            : i18nT('app.activityText.fridgeClosed')
          : contactOpen
            ? i18nT('app.activityText.openingDetected')
            : i18nT('app.activityText.closingDetected'),
    dry_contact: () =>
      contactRole === 'BED'
        ? bed()
        : contactOpen
          ? i18nT('app.activityText.contactOpen')
          : i18nT('app.activityText.contactClosed'),
    temperature: () =>
      value
        ? i18nT('app.activityText.temperatureWithValue', { value })
        : i18nT('app.activityText.temperature'),
    humidity: () =>
      value
        ? i18nT('app.activityText.humidityWithValue', { value })
        : i18nT('app.activityText.humidity'),
    illuminance: () =>
      value
        ? i18nT('app.activityText.illuminanceWithValue', { value })
        : i18nT('app.activityText.illuminance'),
    battery: () =>
      value
        ? i18nT('app.activityText.batteryWithValue', { value })
        : i18nT('app.activityText.battery'),
    power: () =>
      value ? i18nT('app.activityText.powerWithValue', { value }) : i18nT('app.activityText.power'),
    energy: () =>
      value
        ? i18nT('app.activityText.energyWithValue', { value })
        : i18nT('app.activityText.energy'),
    button: () => i18nT('app.activityText.callButtonPressed'),
  };
  return labels[item.capability]?.() ?? capabilityLabel(item.capability);
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

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function medicationStatusLabel(status: MedicationDoseItem['status']): string {
  const labels = {
    PENDING: () => i18nT('app.medicationStatusLabel.labels.PENDING'),
    TAKEN: () => i18nT('app.medicationStatusLabel.labels.TAKEN'),
    MISSED: () => i18nT('app.medicationStatusLabel.labels.MISSED'),
    SKIPPED: () => i18nT('app.medicationStatusLabel.labels.SKIPPED'),
  } as const;
  return labels[status]();
}

export function MedicationPanel({
  locale,
  medications,
  doses,
  submitting,
  notice,
  onCreate,
  onConfirm,
  onSkip,
}: {
  locale: Locale;
  medications: MedicationItem[];
  doses: MedicationDoseItem[];
  submitting: boolean;
  notice: string;
  onCreate: (draft: MedicationDraft) => Promise<boolean>;
  onConfirm: (doseId: string) => void;
  onSkip: (doseId: string) => void;
}) {
  const [draft, setDraft] = useState<MedicationDraft>({
    name: '',
    dosage: '',
    instructions: '',
    time: '08:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: 60,
  });
  const ordered = [...doses].sort(
    (left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime(),
  );
  const todayKey = dateKey(new Date());
  const todayDoses = ordered.filter((dose) => dateKey(new Date(dose.scheduledFor)) === todayKey);
  const focusDose =
    todayDoses.find((dose) => dose.status === 'MISSED') ??
    todayDoses.find(
      (dose) => dose.status === 'PENDING' && new Date(dose.scheduledFor).getTime() >= Date.now(),
    ) ??
    todayDoses.find((dose) => dose.status === 'PENDING');
  // Sunday first, as daysOfWeek counts them; names come from the language itself.
  const weekday = (style: 'narrow' | 'long') =>
    Array.from({ length: 7 }, (_, day) => {
      const name = new Intl.DateTimeFormat(dateLocale(), {
        weekday: style,
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2023, 0, 1 + day)));
      return name.charAt(0).toLocaleUpperCase(dateLocale()) + name.slice(1);
    });
  const dayLabels = weekday('narrow');
  const fullDayLabels = weekday('long');
  const toggleDay = (day: number) => {
    const selected = draft.daysOfWeek.includes(day);
    const daysOfWeek = selected
      ? draft.daysOfWeek.filter((value) => value !== day)
      : [...draft.daysOfWeek, day].sort();
    if (daysOfWeek.length > 0) setDraft({ ...draft, daysOfWeek });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!(await onCreate(draft))) return;
    setDraft({
      name: '',
      dosage: '',
      instructions: '',
      time: '08:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: 60,
    });
  };

  return (
    <section className="section-view medication-page">
      <header className="page-hero medication-heading">
        <div className="page-hero__copy">
          <span className="page-hero__eyebrow">{i18nT('app.localPillbox')}</span>
          <h2 className="page-hero__title">{i18nT('app.medications')}</h2>
          <p className="page-hero__text">{i18nT('app.simpleRemindersToSupportMedication')}</p>
        </div>
      </header>

      <div className="medication-layout">
        <Card className={`next-dose-card ${focusDose?.status === 'MISSED' ? 'is-late' : ''}`}>
          <div className="next-dose-topline">
            <span className="eyebrow">
              {focusDose?.status === 'MISSED'
                ? i18nT('app.aGentleCheckMayHelp')
                : i18nT('app.nextDose')}
            </span>
            {focusDose && (
              <StatusPill tone={focusDose.status === 'MISSED' ? 'attention' : 'neutral'}>
                {medicationStatusLabel(focusDose.status)}
              </StatusPill>
            )}
          </div>
          {focusDose ? (
            <>
              <time className="dose-time">{time(focusDose.scheduledFor)}</time>
              <h2>{focusDose.schedule.medication.name}</h2>
              <strong className="dose-dosage">{focusDose.schedule.medication.dosage}</strong>
              {focusDose.schedule.medication.instructions && (
                <p>{focusDose.schedule.medication.instructions}</p>
              )}
              {focusDose.status === 'MISSED' && (
                <p className="dose-caution">{i18nT('app.thisDoseHasNotBeen')}</p>
              )}
              <div className="dose-actions">
                <Button type="button" onClick={() => onConfirm(focusDose.id)}>
                  <CircleCheck />
                  {i18nT('app.confirmDose')}
                </Button>
                <Button
                  type="button"
                  className="button-secondary"
                  onClick={() => onSkip(focusDose.id)}
                >
                  {i18nT('app.markAsSkipped')}
                </Button>
              </div>
            </>
          ) : (
            <div className="medication-empty">
              <Pill />
              <h2>{i18nT('app.noUpcomingDoseToday')}</h2>
              <p>
                {medications.length === 0
                  ? i18nT('app.addAFirstTreatmentTo')
                  : i18nT('app.allScheduledDosesForToday')}
              </p>
            </div>
          )}
          {notice && (
            <p className="medication-notice" role="status" aria-live="polite">
              {notice}
            </p>
          )}
        </Card>

        <Card className="medication-today-card">
          <span className="eyebrow">{i18nT('app.today')}</span>
          <h2>{i18nT('app.doseTimeline')}</h2>
          <div className="dose-summary" aria-label={i18nT('app.doseSummary')}>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'TAKEN').length}</strong>
              {i18nT('app.confirmed')}
            </span>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'PENDING').length}</strong>
              {i18nT('app.scheduled')}
            </span>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'MISSED').length}</strong>
              {i18nT('app.toCheck')}
            </span>
          </div>
          <div className="dose-list">
            {todayDoses.length === 0 ? (
              <p className="empty-state">{i18nT('app.noDosePlannedToday')}</p>
            ) : (
              todayDoses.map((dose) => (
                <article className={`dose-row status-${dose.status.toLowerCase()}`} key={dose.id}>
                  <time>{time(dose.scheduledFor)}</time>
                  <span>
                    <strong>{dose.schedule.medication.name}</strong>
                    <small>{dose.schedule.medication.dosage}</small>
                  </span>
                  <StatusPill tone={dose.status === 'MISSED' ? 'attention' : 'neutral'}>
                    {medicationStatusLabel(dose.status)}
                  </StatusPill>
                </article>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="medication-secondary-grid">
        <Card className="medication-history-card">
          <span className="eyebrow">{i18nT('app.lastSevenDays')}</span>
          <h2>{i18nT('app.history')}</h2>
          <div className="dose-history">
            {[...ordered]
              .reverse()
              .slice(0, 12)
              .map((dose) => (
                <article key={dose.id}>
                  <time>
                    {new Date(dose.scheduledFor).toLocaleDateString(locale, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {time(dose.scheduledFor)}
                  </time>
                  <span>
                    <strong>{dose.schedule.medication.name}</strong>
                    <small>
                      {medicationStatusLabel(dose.status)}
                      {dose.confirmedBy ? ` · ${dose.confirmedBy.displayName}` : ''}
                    </small>
                  </span>
                </article>
              ))}
            {ordered.length === 0 && (
              <p className="empty-state">{i18nT('app.historyWillAppearAsDoses')}</p>
            )}
          </div>
        </Card>

        <Card className="medication-form-card">
          <span className="eyebrow">{i18nT('app.newReminder')}</span>
          <h2>{i18nT('app.addATreatment')}</h2>
          <p>{i18nT('app.onlyCopyInformationAlreadyProvided')}</p>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              {i18nT('app.treatmentName')}
              <input
                required
                maxLength={150}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              {i18nT('app.prescribedDosage')}
              <input
                required
                maxLength={150}
                placeholder={i18nT('app.eG1Tablet')}
                value={draft.dosage}
                onChange={(event) => setDraft({ ...draft, dosage: event.target.value })}
              />
            </label>
            <label>
              {i18nT('app.instructionsOptional')}
              <textarea
                maxLength={1000}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
            </label>
            <div className="medication-form-row">
              <label>
                {i18nT('app.scheduledTime')}
                <input
                  type="time"
                  required
                  value={draft.time}
                  onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                />
              </label>
              <label>
                {i18nT('app.confirmationWindow')}
                <select
                  value={draft.graceMinutes}
                  onChange={(event) =>
                    setDraft({ ...draft, graceMinutes: Number(event.target.value) })
                  }
                >
                  <option value={30}>30 min</option>
                  <option value={60}>1 h</option>
                  <option value={120}>2 h</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>{i18nT('app.scheduledDays')}</legend>
              <div className="medication-days">
                {dayLabels.map((label, day) => (
                  <button
                    key={`${label}-${day}`}
                    type="button"
                    aria-label={fullDayLabels[day]}
                    aria-pressed={draft.daysOfWeek.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={submitting}>
              {submitting ? i18nT('app.adding') : i18nT('app.addTreatment')}
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}

function CamerasPanel({
  cameras,
  recordings,
  session,
  notice,
  onOpen,
  onClose,
}: {
  locale: Locale;
  cameras: CameraItem[];
  recordings: CameraRecording[];
  session: CameraSession | null;
  notice: string;
  onOpen: (cameraId: string) => void;
  onClose: () => void;
}) {
  const selectedCamera = cameras.find((camera) => camera.id === session?.cameraId) ?? null;
  const onlineCameras = cameras.filter(
    (camera) => camera.status === 'ONLINE' && !camera.privacyMode,
  ).length;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(dateLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return (
    <section className="section-view camera-page camera-page--designed">
      <header className="page-hero camera-hero">
        <div className="page-hero__copy camera-hero-main">
          <span className="camera-hero-icon">
            <Video aria-hidden="true" />
          </span>
          <div>
            <span className="page-hero__eyebrow">{i18nT('app.homeCameras')}</span>
            <h1 className="page-hero__title">{i18nT('app.cameras')}</h1>
            <p className="page-hero__text">{i18nT('app.liveStreamsAndClipsTriggered')}</p>
          </div>
        </div>
        <div className="page-hero__actions camera-hero-actions">
          <span className="camera-online-count">
            <span className="camera-online-dot" />
            {onlineCameras} {i18nT('app.online')}
          </span>
          <button
            type="button"
            className="camera-primary-action"
            onClick={() => {
              const page = document.querySelector<HTMLElement>('.camera-page');
              if (page?.requestFullscreen) void page.requestFullscreen().catch(() => undefined);
            }}
          >
            <Maximize2 aria-hidden="true" />
            {i18nT('app.fullScreen')}
          </button>
        </div>
      </header>

      {notice && (
        <p className="form-notice camera-notice" role="status">
          {notice}
        </p>
      )}

      <section className="camera-panel-card camera-live-section">
        <div className="camera-section-heading">
          <div className="camera-section-title">
            <span className="camera-section-icon">
              <Tv aria-hidden="true" />
            </span>
            <div>
              <h2>{i18nT('app.liveStreams')}</h2>
              <p>{i18nT('app.selectACameraToOpen')}</p>
            </div>
          </div>
        </div>
        {cameras.length ? (
          <div className="camera-live-grid">
            {cameras.map((camera) => {
              const unavailable =
                camera.privacyMode || camera.status === 'OFFLINE' || !camera.capabilities.live;
              return (
                <article
                  className={`camera-live-card ${camera.privacyMode ? 'is-private' : ''}`}
                  key={camera.id}
                >
                  <div className="camera-live-card-heading">
                    <div className="camera-room-name">
                      <span className="camera-room-icon">
                        <Video aria-hidden="true" />
                      </span>
                      <h3>{camera.room?.name ?? i18nT('app.noRoom')}</h3>
                    </div>
                    <span
                      className={`camera-live-status ${camera.status === 'ONLINE' && !camera.privacyMode ? 'is-online' : ''}`}
                    >
                      <span />
                      {camera.privacyMode
                        ? i18nT('app.privacy')
                        : camera.status === 'ONLINE'
                          ? i18nT('app.online2')
                          : camera.status}
                    </span>
                  </div>
                  <div className="camera-preview">
                    <button
                      type="button"
                      className="camera-preview-main"
                      disabled={unavailable}
                      onClick={() => onOpen(camera.id)}
                      aria-label={`${i18nT('app.openLiveStreamFor')} ${camera.name}`}
                    >
                      <span className="camera-preview-scene">
                        <Video aria-hidden="true" />
                      </span>
                      <span className="camera-preview-label">
                        {camera.privacyMode
                          ? i18nT('app.privacyModeEnabled')
                          : unavailable
                            ? i18nT('app.streamUnavailable')
                            : i18nT('app.openLiveStream')}
                      </span>
                    </button>
                  </div>
                  <div className="camera-live-card-footer">
                    <strong>{camera.name}</strong>
                    <button type="button" disabled={unavailable} onClick={() => onOpen(camera.id)}>
                      {i18nT('app.openLive')} <ChevronRight aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="camera-empty camera-empty--inline">
            <Video aria-hidden="true" />
            <div>
              <h3>{i18nT('app.noCamerasConnected')}</h3>
              <p>{i18nT('app.addItUnderMyHome')}</p>
            </div>
          </div>
        )}
      </section>

      <section className="camera-panel-card camera-recordings-section">
        <div className="camera-section-heading camera-recordings-heading">
          <div className="camera-section-title">
            <span className="camera-section-icon camera-section-icon--blue">
              <Play aria-hidden="true" />
            </span>
            <div>
              <h2>{i18nT('app.recordings')}</h2>
              <p>{i18nT('app.n30SecondSilentVideoClips')}</p>
            </div>
          </div>
        </div>
        <div className="camera-recordings-grid">
          {recordings.map((recording) => (
            <article className="camera-recording-item" key={recording.id}>
              <video
                className="camera-recording-video"
                controls
                preload="metadata"
                src={`/api/v1/cameras/recordings/${encodeURIComponent(recording.id)}/video`}
                aria-label={`${i18nT('app.recording')} ${recording.cameraName}`}
              />
              <div className="camera-recording-copy">
                <strong>
                  {recording.cameraName} · {recording.roomName ?? i18nT('app.noRoom')}
                </strong>
                <span className="camera-recording-tag camera-recording-tag--attention">
                  <DoorOpen aria-hidden="true" />
                  {i18nT('app.mainEntranceOpened')}
                </span>
                <small>
                  {formatDate(recording.capturedAt)} · {formatDuration(recording.durationSeconds)}
                </small>
              </div>
            </article>
          ))}
          {!recordings.length && (
            <div className="camera-recordings-empty">
              <Play aria-hidden="true" />
              <span>{i18nT('app.clipsWillAppearHereAfter')}</span>
            </div>
          )}
        </div>
      </section>

      {session && selectedCamera && (
        <Card className="camera-viewer-card">
          <div className="camera-viewer-heading">
            <div>
              <span className="camera-live-dot" />
              <span className="eyebrow">{i18nT('app.live')}</span>
              <h2>{selectedCamera.name}</h2>
              <p>{selectedCamera.room?.name}</p>
            </div>
            <button
              type="button"
              className="camera-close"
              onClick={onClose}
              aria-label={i18nT('app.closeLiveStream')}
            >
              <X />
            </button>
          </div>
          <div className="camera-frame">
            <iframe
              key={session.mediaUrl}
              src={session.mediaUrl}
              title={selectedCamera.name}
              allow="autoplay; fullscreen"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="camera-viewer-actions">
            <small>{i18nT('app.recordingsContainVideoOnly')}</small>
          </div>
        </Card>
      )}
    </section>
  );
}

const blankPerson = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  relation: '',
  isEmergency: false,
  hasAccess: false,
  role: 'CAREGIVER' as AccessRole,
  username: '',
  temporaryPassword: '',
};

const personRoleLabel = (role: Person['role']) => {
  const labels = {
    OWNER: () => i18nT('app.personRoleLabel.labels.OWNER'),
    ADMINISTRATOR: () => i18nT('app.personRoleLabel.labels.ADMINISTRATOR'),
    CAREGIVER: () => i18nT('app.personRoleLabel.labels.CAREGIVER'),
    VIEWER: () => i18nT('app.personRoleLabel.labels.VIEWER'),
  } as const;
  return role ? labels[role]() : i18nT('app.noAccess');
};

const personRoleIcon = (role: Person['role']) => {
  const Icon =
    role === 'CAREGIVER'
      ? HeartHandshake
      : role === 'OWNER' || role === 'ADMINISTRATOR'
        ? ShieldCheck
        : role === 'VIEWER'
          ? Eye
          : UserRound;
  return <Icon aria-hidden="true" />;
};

export function PeoplePanel({
  locale,
  currentRole,
}: {
  locale: Locale;
  currentRole: CurrentAccess['role'];
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACCESS' | 'EMERGENCY' | 'DISABLED'>('ALL');
  const [editor, setEditor] = useState<Person | 'new' | null>(null);
  const [draft, setDraft] = useState(blankPerson);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canManage = currentRole === 'OWNER' || currentRole === 'ADMINISTRATOR';
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/household/people?archived=true');
      if (response.ok) setPeople((await response.json()) as Person[]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const edit = (person?: Person) => {
    setEditor(person ?? 'new');
    setError('');
    setDraft(
      person
        ? {
            firstName: person.firstName,
            lastName: person.lastName,
            phone: person.phone ?? '',
            email: person.email ?? '',
            relation: person.relation ?? '',
            isEmergency: person.isEmergency,
            hasAccess: person.hasAccount,
            role: person.role && person.role !== 'OWNER' ? person.role : 'CAREGIVER',
            username: person.username ?? '',
            temporaryPassword: '',
          }
        : blankPerson,
    );
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const existing = editor === 'new' ? null : editor;
    if (!draft.firstName || !draft.lastName || (!draft.phone && !draft.email)) {
      setError(i18nT('app.enterANameAndContact'));
      return;
    }
    if (
      (!existing || !existing.hasAccount) &&
      draft.hasAccess &&
      (!draft.username || draft.temporaryPassword.length < 12)
    ) {
      setError(i18nT('app.aUsernameAnd12Character'));
      return;
    }
    setSaving(true);
    setError('');
    const response = await fetch(
      existing ? `/api/v1/household/people/${existing.id}` : '/api/v1/household/people',
      {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: draft.firstName,
          lastName: draft.lastName,
          phone: draft.phone,
          email: draft.email,
          relation: draft.relation,
          isEmergency: draft.isEmergency,
          ...(!existing && draft.hasAccess
            ? {
                access: {
                  role: draft.role,
                  username: draft.username,
                  temporaryPassword: draft.temporaryPassword,
                },
              }
            : {}),
        }),
      },
    );
    let roleOk = true;
    if (
      response.ok &&
      existing &&
      ((!existing.hasAccount && draft.hasAccess) ||
        (existing.hasAccount && existing.role !== draft.role))
    ) {
      roleOk = (
        await fetch(`/api/v1/household/people/${existing.id}/access`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            existing.hasAccount
              ? { action: 'role', role: draft.role }
              : {
                  action: 'create',
                  role: draft.role,
                  username: draft.username,
                  temporaryPassword: draft.temporaryPassword,
                },
          ),
        })
      ).ok;
    }
    setSaving(false);
    if (!response.ok || !roleOk) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? i18nT('app.unableToSaveThisProfile'));
      return;
    }
    setEditor(null);
    await load();
  };
  const access = async (
    person: Person,
    action: 'disable' | 'enable' | 'reset-password' | 'restore',
  ) => {
    let body: Record<string, string> = { action };
    if (action === 'reset-password') {
      const password = window.prompt(i18nT('app.temporaryPassword12CharactersMinimum'));
      if (!password || password.length < 12) return;
      body = { action, temporaryPassword: password };
    } else if (
      !window.confirm(
        action === 'restore'
          ? i18nT('app.restoreThisProfileAccessWill')
          : i18nT('app.confirmThisAccessChange'),
      )
    )
      return;
    const response = await fetch(`/api/v1/household/people/${person.id}/access`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) await load();
  };
  const archive = async (person: Person) => {
    if (!window.confirm(i18nT('app.archiveThisProfileItsHistory'))) return;
    if ((await fetch(`/api/v1/household/people/${person.id}`, { method: 'DELETE' })).ok)
      await load();
  };
  const visible = people.filter((person) => {
    if (
      !`${person.firstName} ${person.lastName} ${person.relation ?? ''} ${person.email ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      return false;
    if (filter === 'ACCESS') return person.hasAccount && !person.accessDisabled && !person.archived;
    if (filter === 'EMERGENCY') return person.isEmergency && !person.archived;
    if (filter === 'DISABLED') return person.accessDisabled || person.archived;
    return !person.archived;
  });
  const filters = {
    ALL: i18nT('app.all'),
    ACCESS: i18nT('app.withAccess'),
    EMERGENCY: i18nT('app.emergency'),
    DISABLED: i18nT('app.disabled'),
  };
  const activePeople = people.filter((person) => !person.archived).length;
  const activeAccess = people.filter(
    (person) => person.hasAccount && !person.accessDisabled && !person.archived,
  ).length;
  const emergencyContacts = people.filter(
    (person) => person.isEmergency && !person.archived,
  ).length;

  if (loading)
    return <DataLoadingScreen locale={locale} message={i18nT('app.preparingYourCareCircle')} />;

  return (
    <section className="section-view people-page">
      <header className="page-hero people-hero">
        <div className="page-hero__copy people-title-row">
          <div>
            <span className="page-hero__eyebrow">{i18nT('app.careCircle')}</span>
            <h2 className="page-hero__title">{i18nT('app.people')}</h2>
            <p className="page-hero__text">{i18nT('app.theRightPeopleWithThe')}</p>
          </div>
        </div>
        {canManage && (
          <Button className="people-add-button" onClick={() => edit()}>
            <Plus />
            {i18nT('app.addPerson')}
          </Button>
        )}
      </header>
      <div className="people-overview" aria-label={i18nT('app.summary')}>
        <div>
          <span className="people-overview-icon people-overview-icon--family">
            <UserRound />
          </span>
          <p>
            <strong>{activePeople}</strong>
            <span>{i18nT('app.savedPeople')}</span>
          </p>
        </div>
        <i />
        <div>
          <span className="people-overview-icon people-overview-icon--access">
            <ShieldCheck />
          </span>
          <p>
            <strong>{activeAccess}</strong>
            <span>{i18nT('app.eliseAccess')}</span>
          </p>
        </div>
        <i />
        <div>
          <span className="people-overview-icon people-overview-icon--urgent">
            <Bell />
          </span>
          <p>
            <strong>{emergencyContacts}</strong>
            <span>{i18nT('app.priorityContacts')}</span>
          </p>
        </div>
      </div>
      <div className="people-toolbar">
        <label className="people-search">
          <Search />
          <input
            aria-label={i18nT('app.search')}
            type="search"
            placeholder={i18nT('app.searchByNameRelationshipOr')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div role="group" aria-label={i18nT('app.filterList')}>
          {(Object.keys(filters) as Array<keyof typeof filters>).map((value) => (
            <button
              type="button"
              className={filter === value ? 'is-active' : ''}
              key={value}
              onClick={() => setFilter(value)}
            >
              {filters[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="people-card-grid">
        {!loading &&
          visible.map((person) => (
            <Card
              className={`people-card role-card-${person.role ?? 'NONE'}${person.accessDisabled || person.archived ? ' is-disabled' : ''}`}
              key={person.id}
            >
              <div className="people-card-top">
                <span className="people-avatar">{personRoleIcon(person.role)}</span>
                <div>
                  <h3>
                    {person.firstName} {person.lastName}
                  </h3>
                  <p>{person.relation || i18nT('app.relationshipNotSpecified')}</p>
                </div>
                {person.isEmergency && (
                  <span className="people-priority" title={i18nT('app.callPriority')}>
                    <Bell />
                    {person.priority + 1}
                  </span>
                )}
              </div>
              <div className="people-badges">
                <span className={`people-role role-${person.role ?? 'NONE'}`}>
                  {personRoleIcon(person.role)}
                  {personRoleLabel(person.role)}
                </span>
                {person.isEmergency && (
                  <span className="people-emergency">
                    <Bell />
                    {i18nT('app.priorityContact')}
                  </span>
                )}
                {person.accessDisabled && <span>{i18nT('app.accessDisabled')}</span>}
                {person.archived && <span>{i18nT('app.archived')}</span>}
              </div>
              <div className="people-contact-lines">
                {person.phone && (
                  <a href={`tel:${person.phone}`}>
                    <Phone /> <span>{person.phone}</span>
                  </a>
                )}
                {person.email && (
                  <a href={`mailto:${person.email}`}>
                    <Mail /> <span>{person.email}</span>
                  </a>
                )}
                {person.username && (
                  <small>
                    <UserRound /> <span>@{person.username}</span>
                  </small>
                )}
              </div>
              <div className="people-card-footer">
                <span className={`people-access-state${person.accessDisabled ? ' is-off' : ''}`}>
                  <i />
                  {person.hasAccount
                    ? person.accessDisabled
                      ? i18nT('app.accessSuspended')
                      : i18nT('app.activeAccess')
                    : i18nT('app.contactOnly')}
                </span>
                {canManage && !person.isCurrentUser && (
                  <div className="people-actions">
                    <button className="people-edit" onClick={() => edit(person)}>
                      {i18nT('app.viewProfile')}
                      <ChevronRight aria-hidden="true" />
                    </button>
                    <details className="people-action-menu">
                      <summary aria-label={i18nT('app.moreActions')}>•••</summary>
                      <div>
                        {person.archived ? (
                          <button onClick={() => void access(person, 'restore')}>
                            <Archive />
                            {i18nT('app.restoreProfile')}
                          </button>
                        ) : person.hasAccount ? (
                          <button
                            onClick={() =>
                              void access(person, person.accessDisabled ? 'enable' : 'disable')
                            }
                          >
                            <Power />
                            {person.accessDisabled
                              ? i18nT('app.enableAccess')
                              : i18nT('app.suspendAccess')}
                          </button>
                        ) : null}
                        {!person.archived && person.hasAccount && !person.accessDisabled && (
                          <button onClick={() => void access(person, 'reset-password')}>
                            <KeyRound />
                            {i18nT('app.resetPassword')}
                          </button>
                        )}
                        {!person.archived && (
                          <button className="is-danger" onClick={() => void archive(person)}>
                            <Archive />
                            {i18nT('app.archiveProfile')}
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                )}
                {person.isCurrentUser && <small>{i18nT('app.yourAccount')}</small>}
              </div>
            </Card>
          ))}
        {!loading && visible.length === 0 && (
          <Card className="people-empty">
            <span>
              <UsersRound />
            </span>
            <h3>{i18nT('app.noOneMatchesThisView')}</h3>
            <p>{i18nT('app.changeYourSearchOrChoose')}</p>
          </Card>
        )}
      </div>
      {editor && (
        <div
          className="people-editor-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}
        >
          <div className="people-editor" role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow">
                  {editor === 'new' ? i18nT('app.newPerson') : i18nT('app.editProfile')}
                </span>
                <h2>
                  {editor === 'new'
                    ? i18nT('app.addToCircle')
                    : `${editor.firstName} ${editor.lastName}`}
                </h2>
              </div>
              <button aria-label={i18nT('app.close')} onClick={() => setEditor(null)}>
                <X />
              </button>
            </header>
            <form onSubmit={(event) => void save(event)}>
              <div className="people-form-grid">
                <label>
                  {i18nT('app.firstName')}
                  <input
                    autoFocus
                    value={draft.firstName}
                    onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                  />
                </label>
                <label>
                  {i18nT('app.lastName')}
                  <input
                    value={draft.lastName}
                    onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                  />
                </label>
                <label>
                  {i18nT('app.phone')}
                  <input
                    type="tel"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </label>
                <label className="wide">
                  {i18nT('app.relationship')}
                  <input
                    value={draft.relation}
                    onChange={(e) => setDraft({ ...draft, relation: e.target.value })}
                  />
                </label>
              </div>
              <label className="people-check">
                <input
                  type="checkbox"
                  checked={draft.isEmergency}
                  onChange={(e) => setDraft({ ...draft, isEmergency: e.target.checked })}
                />
                <span>
                  <strong>{i18nT('app.emergencyContact')}</strong>
                  <small>{i18nT('app.shownInThePriorityCall')}</small>
                </span>
              </label>
              {(editor === 'new' || !editor.hasAccount) && (
                <label className="people-check">
                  <input
                    type="checkbox"
                    checked={draft.hasAccess}
                    onChange={(e) => setDraft({ ...draft, hasAccess: e.target.checked })}
                  />
                  <span>
                    <strong>{i18nT('app.grantEliseAccess')}</strong>
                    <small>{i18nT('app.passwordMustBeChangedAt')}</small>
                  </span>
                </label>
              )}
              {(draft.hasAccess || (editor !== 'new' && editor.hasAccount)) &&
                (editor === 'new' || editor.role !== 'OWNER') && (
                  <div className="people-access-fields">
                    <label>
                      {i18nT('app.role')}
                      <select
                        value={draft.role}
                        onChange={(e) => setDraft({ ...draft, role: e.target.value as AccessRole })}
                      >
                        {currentRole === 'OWNER' && (
                          <option value="ADMINISTRATOR">{i18nT('app.administrator')}</option>
                        )}
                        <option value="CAREGIVER">{i18nT('app.caregiver')}</option>
                        <option value="VIEWER">{i18nT('app.readOnly')}</option>
                      </select>
                    </label>
                    {(editor === 'new' || !editor.hasAccount) && (
                      <>
                        <label>
                          {i18nT('app.username')}
                          <input
                            value={draft.username}
                            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                          />
                        </label>
                        <label className="wide">
                          {i18nT('app.temporaryPassword')}
                          <input
                            type="password"
                            minLength={12}
                            value={draft.temporaryPassword}
                            onChange={(e) =>
                              setDraft({ ...draft, temporaryPassword: e.target.value })
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
              {error && <p className="form-error">{error}</p>}
              <footer>
                <Button type="button" className="button-secondary" onClick={() => setEditor(null)}>
                  {i18nT('app.cancel')}
                </Button>
                <Button disabled={saving}>
                  {saving ? i18nT('app.saving') : i18nT('app.save')}
                </Button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
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
  const [settingsTab, setSettingsTab] = useState<'general' | 'rules'>('general');
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
    setLanguage(nextLocale);
    setLocale(nextLocale);
    window.localStorage.setItem('elise_locale', nextLocale);
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
    const events = new EventSource('/api/v1/events');
    events.onmessage = (event) => {
      const action = homeRealtimeEventAction(String(event.data));
      if (action === 'IGNORE' || (action === 'PRESENCE' && active === 3)) return;
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = window.setTimeout(() => void refresh(), 500);
    };
    return () => {
      events.close();
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
        runId:
          typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `manual-${Date.now()}`,
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
              <button
                type="button"
                className={settingsTab === 'general' ? 'is-selected' : ''}
                aria-selected={settingsTab === 'general'}
                onClick={() => setSettingsTab('general')}
              >
                <Settings aria-hidden="true" /> {i18nT('app.general')}
              </button>
              <button
                type="button"
                className={settingsTab === 'rules' ? 'is-selected' : ''}
                aria-selected={settingsTab === 'rules'}
                onClick={() => setSettingsTab('rules')}
              >
                <Bell aria-hidden="true" /> {i18nT('app.rules')}
              </button>
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
