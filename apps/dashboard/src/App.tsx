import { LiaisonPage } from './LiaisonPage';
import { JournalPage } from './JournalPage';
import { CalendarPage } from './CalendarPage';
import { WelcomePage } from './WelcomePage';
import { ScreenPanel, startResidentScreenCall } from './ScreenPanel';
import { AlertsPage, type SafetyCategory } from './AlertsPage';
import { Button, Card, StatusPill } from '@michel/ui';
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
import { copy, type Locale } from './i18n';
import { resizeResidentPhoto, Setup } from './Setup';
import { HomePlanEditor } from './HomePlanEditor';
import { HomeOverview, homeRealtimeEventAction } from './HomeOverview';
import { GuidedTour, type GuidedTourMode } from './GuidedTour';
import { DataLoadingScreen } from './DataLoadingScreen';
import { FRFlag, GBFlag } from './FlagIcons';
import { RemoteAccessCard } from './RemoteAccessCard';
import { ActivityPage } from './ActivityPage';
import { GoogleAccountSettings } from './GoogleAccountSettings';
import { UpdateCard } from './UpdateCard';
import type { UpdateStatus } from '@michel/contracts';

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
export const sidebarHiddenNavIndexes = new Set([4, 5, 6]);
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
    <nav aria-label="Navigation principale">
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
  locale,
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
          <h2>{locale === 'fr' ? 'Barre latérale automatique' : 'Automatic sidebar'}</h2>
          <p>
            {disabled
              ? locale === 'fr'
                ? 'La barre reste ouverte pendant la création de votre environnement.'
                : 'The sidebar stays open while your environment is being created.'
              : locale === 'fr'
                ? 'Masquez la barre lorsque la souris la quitte. Approchez le bord gauche pour la rouvrir.'
                : 'Hide the sidebar when the pointer leaves it. Move to the left edge to reopen it.'}
          </p>
        </div>
        <button
          type="button"
          className={`config-toggle-btn ${enabled && !disabled ? 'is-on' : ''}`}
          role="switch"
          aria-checked={enabled && !disabled}
          aria-label={
            locale === 'fr'
              ? 'Masquer automatiquement la barre latérale'
              : 'Automatically hide the sidebar'
          }
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
  locale,
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
        <span className="eyebrow">{locale === 'fr' ? 'Accès familial' : 'Family access'}</span>
        <h1>{locale === 'fr' ? 'Heureux de vous revoir.' : 'Welcome back.'}</h1>
        <p>
          {locale === 'fr'
            ? 'Connectez-vous pour retrouver votre environnement Élise.'
            : 'Sign in to access your Élise home.'}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            {locale === 'fr' ? 'Identifiant' : 'Username'}
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            {locale === 'fr' ? 'Mot de passe' : 'Password'}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="form-error">
              {locale === 'fr' ? 'Identifiants incorrects.' : 'Incorrect credentials.'}
            </p>
          )}
          <Button type="submit">{locale === 'fr' ? 'Se connecter' : 'Sign in'}</Button>
        </form>
        <div className="login-setup">
          <p>
            {locale === 'fr'
              ? 'Vous installez Élise pour la première fois ?'
              : 'Setting up Élise for the first time?'}
          </p>
          <Button type="button" className="login-setup-button" onClick={onOpenSetup}>
            {locale === 'fr' ? 'Créer un environnement Élise' : 'Create an Élise home'}
          </Button>
          <small>
            {locale === 'fr'
              ? 'Cette étape crée le compte propriétaire protégé de la maison.'
              : 'This step creates the home’s protected owner account.'}
          </small>
        </div>
      </Card>
      <p className="login-privacy">
        <ShieldCheck />{' '}
        {locale === 'fr'
          ? 'Vos données ne quittent pas le domicile.'
          : 'Your data never leaves the home.'}
      </p>
    </main>
  );
}

function ChangePassword({ locale, onSuccess }: { locale: Locale; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12 || password !== confirmation) {
      setError(
        locale === 'fr'
          ? 'Utilisez au moins 12 caractères et confirmez le même mot de passe.'
          : 'Use at least 12 characters and enter the same password twice.',
      );
      return;
    }
    const response = await fetch('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: password }),
    });
    if (!response.ok) {
      setError(
        locale === 'fr'
          ? 'Le mot de passe n’a pas pu être modifié.'
          : 'The password could not be changed.',
      );
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
        <span className="eyebrow">{locale === 'fr' ? 'Première connexion' : 'First sign-in'}</span>
        <h1>{locale === 'fr' ? 'Choisissez votre mot de passe.' : 'Choose your password.'}</h1>
        <p>
          {locale === 'fr'
            ? 'Le mot de passe temporaire doit être remplacé avant d’accéder aux informations du résident.'
            : 'The temporary password must be replaced before accessing resident information.'}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            {locale === 'fr' ? 'Nouveau mot de passe' : 'New password'}
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            {locale === 'fr' ? 'Confirmer' : 'Confirm'}
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit">
            {locale === 'fr' ? 'Enregistrer et continuer' : 'Save and continue'}
          </Button>
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

function residentAge(value: string | null, locale: Locale): string | null {
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
  return locale === 'fr' ? `${age} ans` : `${age} years old`;
}

function residentMobilityLabel(value: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    INDEPENDENT: ['Se déplace sans aide', 'Moves independently'],
    CANE: ['Utilise une canne', 'Uses a cane'],
    WALKER: ['Utilise un déambulateur', 'Uses a walker'],
    WHEELCHAIR: ['Utilise un fauteuil roulant', 'Uses a wheelchair'],
    UNKNOWN: ['Non renseignée', 'Not provided'],
  };
  return labels[value]?.[locale === 'fr' ? 0 : 1] ?? value;
}

function supportNeedLabel(value: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    MEMORY: ['Mémoire et repères', 'Memory and orientation'],
    PARKINSON: ['Parkinson et mobilité', 'Parkinson’s and mobility'],
    FALL_RISK: ['Risque de chute', 'Fall risk'],
    VISION: ['Déficience visuelle', 'Visual impairment'],
    HEARING: ['Déficience auditive', 'Hearing impairment'],
    OTHER: ['Autre information importante', 'Other important information'],
  };
  return labels[value]?.[locale === 'fr' ? 0 : 1] ?? value;
}

function habitLabel(value: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    WAKE_UP: ['Réveil', 'Wake-up'],
    BREAKFAST: ['Petit-déjeuner', 'Breakfast'],
    LUNCH: ['Déjeuner', 'Lunch'],
    DINNER: ['Dîner', 'Dinner'],
    BEDTIME: ['Coucher', 'Bedtime'],
    NIGHT: ['Nuit', 'Night'],
  };
  return (
    labels[value]?.[locale === 'fr' ? 0 : 1] ??
    value
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

function inputTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function timeMinute(value: string): number {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function capabilityLabel(capability: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    motion: ['Mouvement', 'Motion'],
    occupancy: ['Présence', 'Occupancy'],
    person_presence: ['Personne détectée', 'Person detected'],
    contact: ['Ouverture', 'Opening'],
    dry_contact: ['Contact sec', 'Dry contact'],
    button: ['Bouton d’appel', 'Call button'],
    temperature: ['Température', 'Temperature'],
    humidity: ['Humidité', 'Humidity'],
    power: ['Puissance', 'Power'],
    energy: ['Énergie', 'Energy'],
    battery: ['Batterie', 'Battery'],
  };
  return labels[capability]?.[locale === 'fr' ? 0 : 1] ?? capability;
}

export function activityDescription(item: ActivityItem, locale: Locale): string {
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
  const labels: Record<string, [string, string]> = {
    motion: ['Mouvement détecté', 'Movement detected'],
    occupancy:
      contactRole === 'BED'
        ? contactOpen
          ? ['Lit occupé', 'Bed occupied']
          : ['Lit libre', 'Bed unoccupied']
        : ['Présence détectée', 'Presence detected'],
    person_presence: ['Personne détectée', 'Person detected'],
    contact:
      contactRole === 'BED'
        ? contactOpen === (bedOccupiedWhen === 'OPEN')
          ? ['Lit occupé', 'Bed occupied']
          : ['Lit libre', 'Bed unoccupied']
        : contactRole === 'FRIDGE'
          ? contactOpen
            ? ['Frigo ouvert', 'Fridge open']
            : ['Frigo fermé', 'Fridge closed']
          : contactOpen
            ? ['Ouverture détectée', 'Opening detected']
            : ['Fermeture détectée', 'Closing detected'],
    dry_contact:
      contactRole === 'BED'
        ? contactOpen === (bedOccupiedWhen === 'OPEN')
          ? ['Lit occupé', 'Bed occupied']
          : ['Lit libre', 'Bed unoccupied']
        : contactOpen
          ? ['Contact ouvert', 'Contact open']
          : ['Contact fermé', 'Contact closed'],
    temperature: [
      value ? `Température · ${value}` : 'Température relevée',
      value ? `Temperature · ${value}` : 'Temperature reading',
    ],
    humidity: [
      value ? `Humidité · ${value}` : 'Humidité relevée',
      value ? `Humidity · ${value}` : 'Humidity reading',
    ],
    illuminance: [
      value ? `Luminosité · ${value}` : 'Luminosité mesurée',
      value ? `Light level · ${value}` : 'Light level reading',
    ],
    battery: [
      value ? `Batterie · ${value}` : 'Niveau de batterie reçu',
      value ? `Battery · ${value}` : 'Battery level received',
    ],
    power: [
      value ? `Puissance · ${value}` : 'Consommation instantanée',
      value ? `Power · ${value}` : 'Current power use',
    ],
    energy: [
      value ? `Énergie · ${value}` : 'Consommation cumulée',
      value ? `Energy · ${value}` : 'Cumulative energy use',
    ],
    button: ['Bouton d’appel activé', 'Call button pressed'],
  };
  return (
    labels[item.capability]?.[locale === 'fr' ? 0 : 1] ?? capabilityLabel(item.capability, locale)
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
}) {
  return (
    <article className="settings-option-row settings-demo-row simulation-card">
      <div className="settings-option-copy">
        <span className="settings-option-icon settings-option-icon--purple">
          <Radar />
        </span>
        <div>
          <span className="eyebrow">Mode démonstration</span>
          <h2>Tester une situation</h2>
          <p>
            Ces scénarios utilisent le même parcours que les capteurs du domicile. Ils restent
            réservés à cette installation de test.
          </p>
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
            <b>{running === scenario.id ? 'Simulation…' : 'Lancer'}</b>
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

export function AlertRulesPanel({
  rules,
  saving,
  notice,
  onChange,
  onSave,
}: {
  rules: AlertRuleSettings;
  saving: boolean;
  notice: string;
  onChange: (rules: AlertRuleSettings) => void;
  onSave: () => void;
}) {
  const toggle = (key: keyof AlertRuleSettings, enabled: boolean) =>
    onChange({ ...rules, [key]: { ...rules[key], enabled } });
  return (
    <details className="michel-card settings-section-card settings-disclosure settings-landmarks-card alert-rules-card">
      <summary className="settings-section-heading">
        <span className="settings-section-icon settings-section-icon--amber">
          <Bell />
        </span>
        <div>
          <span className="eyebrow">Repères du domicile</span>
          <h2>Situations à signaler</h2>
          <p>
            Choisissez des seuils simples. Élise explique toujours ce qu’elle observe avant de
            proposer une vérification.
          </p>
        </div>
        <span className="settings-disclosure-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      </summary>
      <div className="alert-rule-list">
        <label className="alert-rule-row">
          <span>
            <strong>Écarts aux habitudes apprises</strong>
            <small>Disponible après 14 jours fiables et deux contrôles espacés.</small>
          </span>
          <input
            aria-label="Activer les alertes comportementales"
            type="checkbox"
            checked={rules.behavioral.enabled}
            onChange={(event) => toggle('behavioral', event.target.checked)}
          />
          <span className="rule-value">Validation manuelle</span>
        </label>
        <label className="alert-rule-row">
          <span>
            <strong>Absence de mouvement</strong>
            <small>Seulement lorsque les capteurs répondent correctement.</small>
          </span>
          <input
            aria-label="Activer l’absence de mouvement"
            type="checkbox"
            checked={rules.inactivity.enabled}
            onChange={(event) => toggle('inactivity', event.target.checked)}
          />
          <span className="rule-value">
            <input
              aria-label="Durée sans mouvement"
              type="number"
              min="15"
              max="1440"
              value={rules.inactivity.minutes}
              onChange={(event) =>
                onChange({
                  ...rules,
                  inactivity: { ...rules.inactivity, minutes: Number(event.target.value) },
                })
              }
            />
            minutes
          </span>
        </label>
        <label className="alert-rule-row">
          <span>
            <strong>Porte laissée ouverte</strong>
            <small>Une ouverture brève reste un événement normal.</small>
          </span>
          <input
            aria-label="Activer la porte ouverte"
            type="checkbox"
            checked={rules.doorOpen.enabled}
            onChange={(event) => toggle('doorOpen', event.target.checked)}
          />
          <span className="rule-value">
            <input
              aria-label="Durée porte ouverte"
              type="number"
              min="1"
              max="120"
              value={rules.doorOpen.minutes}
              onChange={(event) =>
                onChange({
                  ...rules,
                  doorOpen: { ...rules.doorOpen, minutes: Number(event.target.value) },
                })
              }
            />
            minutes
          </span>
        </label>
        <div className="alert-rule-row temperature-rule">
          <span>
            <strong>Température inhabituelle</strong>
            <small>Le seuil doit persister avant qu’Élise le signale.</small>
          </span>
          <label className="rule-inline-toggle">
            <input
              aria-label="Activer les températures inhabituelles"
              type="checkbox"
              checked={rules.lowTemperature.enabled || rules.highTemperature.enabled}
              onChange={(event) =>
                onChange({
                  ...rules,
                  lowTemperature: { ...rules.lowTemperature, enabled: event.target.checked },
                  highTemperature: { ...rules.highTemperature, enabled: event.target.checked },
                })
              }
            />
            Active
          </label>
          <span className="temperature-values">
            <label>
              Sous
              <input
                aria-label="Température minimale"
                type="number"
                value={rules.lowTemperature.celsius}
                onChange={(event) =>
                  onChange({
                    ...rules,
                    lowTemperature: {
                      ...rules.lowTemperature,
                      celsius: Number(event.target.value),
                    },
                  })
                }
              />
              °C
            </label>
            <label>
              Au-dessus de
              <input
                aria-label="Température maximale"
                type="number"
                value={rules.highTemperature.celsius}
                onChange={(event) =>
                  onChange({
                    ...rules,
                    highTemperature: {
                      ...rules.highTemperature,
                      celsius: Number(event.target.value),
                    },
                  })
                }
              />
              °C
            </label>
          </span>
        </div>
        <label className="alert-rule-row">
          <span>
            <strong>Activité nocturne répétée</strong>
            <small>Plusieurs mouvements, jamais un passage isolé.</small>
          </span>
          <input
            aria-label="Activer l’activité nocturne"
            type="checkbox"
            checked={rules.nightActivity.enabled}
            onChange={(event) => toggle('nightActivity', event.target.checked)}
          />
          <span className="night-values">
            <input
              aria-label="Début de la nuit"
              type="time"
              value={inputTime(rules.nightActivity.startMinute)}
              onChange={(event) =>
                onChange({
                  ...rules,
                  nightActivity: {
                    ...rules.nightActivity,
                    startMinute: timeMinute(event.target.value),
                  },
                })
              }
            />
            à
            <input
              aria-label="Fin de la nuit"
              type="time"
              value={inputTime(rules.nightActivity.endMinute)}
              onChange={(event) =>
                onChange({
                  ...rules,
                  nightActivity: {
                    ...rules.nightActivity,
                    endMinute: timeMinute(event.target.value),
                  },
                })
              }
            />
          </span>
        </label>
        <label className="alert-rule-row">
          <span>
            <strong>Capteur silencieux</strong>
            <small>Évite de confondre une panne avec une absence d’activité.</small>
          </span>
          <input
            aria-label="Activer le capteur silencieux"
            type="checkbox"
            checked={rules.sensorOffline.enabled}
            onChange={(event) => toggle('sensorOffline', event.target.checked)}
          />
          <span className="rule-value">
            <input
              aria-label="Délai capteur silencieux"
              type="number"
              min="15"
              max="10080"
              value={rules.sensorOffline.minutes}
              onChange={(event) =>
                onChange({
                  ...rules,
                  sensorOffline: { ...rules.sensorOffline, minutes: Number(event.target.value) },
                })
              }
            />
            minutes
          </span>
        </label>
        <label className="alert-rule-row">
          <span>
            <strong>Batterie faible</strong>
            <small>Une information calme pour anticiper le remplacement.</small>
          </span>
          <input
            aria-label="Activer la batterie faible"
            type="checkbox"
            checked={rules.lowBattery.enabled}
            onChange={(event) => toggle('lowBattery', event.target.checked)}
          />
          <span className="rule-value">
            <input
              aria-label="Seuil de batterie"
              type="number"
              min="1"
              max="50"
              value={rules.lowBattery.percent}
              onChange={(event) =>
                onChange({
                  ...rules,
                  lowBattery: { ...rules.lowBattery, percent: Number(event.target.value) },
                })
              }
            />
            %
          </span>
        </label>
      </div>
      <div className="rule-actions">
        <Button type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Enregistrement…' : 'Enregistrer les repères'}
        </Button>
        {notice && (
          <p role="status">
            <CircleCheck /> {notice}
          </p>
        )}
      </div>
    </details>
  );
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function medicationStatusLabel(status: MedicationDoseItem['status'], locale: Locale): string {
  const labels = {
    PENDING: ['Prévue', 'Scheduled'],
    TAKEN: ['Confirmée', 'Confirmed'],
    MISSED: ['Non confirmée', 'Unconfirmed'],
    SKIPPED: ['Ignorée', 'Skipped'],
  } as const;
  return labels[status][locale === 'fr' ? 0 : 1];
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
  const dayLabels =
    locale === 'fr' ? ['D', 'L', 'M', 'M', 'J', 'V', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const fullDayLabels =
    locale === 'fr'
      ? ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
      : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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
      <div className="page-heading medication-heading">
        <span className="eyebrow">{locale === 'fr' ? 'Pilulier local' : 'Local pillbox'}</span>
        <h2>{locale === 'fr' ? 'Médicaments' : 'Medications'}</h2>
        <p>
          {locale === 'fr'
            ? 'Des repères simples pour accompagner les prises, sans remplacer un avis médical.'
            : 'Simple reminders to support medication routines, without replacing medical advice.'}
        </p>
      </div>

      <div className="medication-layout">
        <Card className={`next-dose-card ${focusDose?.status === 'MISSED' ? 'is-late' : ''}`}>
          <div className="next-dose-topline">
            <span className="eyebrow">
              {focusDose?.status === 'MISSED'
                ? locale === 'fr'
                  ? 'À vérifier avec douceur'
                  : 'A gentle check may help'
                : locale === 'fr'
                  ? 'Prochaine prise'
                  : 'Next dose'}
            </span>
            {focusDose && (
              <StatusPill tone={focusDose.status === 'MISSED' ? 'attention' : 'neutral'}>
                {medicationStatusLabel(focusDose.status, locale)}
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
                <p className="dose-caution">
                  {locale === 'fr'
                    ? 'Cette prise n’a pas encore été confirmée. Un oubli est possible ; vérifiez simplement avant d’agir.'
                    : 'This dose has not been confirmed yet. It may have been forgotten; please check before acting.'}
                </p>
              )}
              <div className="dose-actions">
                <Button type="button" onClick={() => onConfirm(focusDose.id)}>
                  <CircleCheck />
                  {locale === 'fr' ? 'Confirmer la prise' : 'Confirm dose'}
                </Button>
                <Button
                  type="button"
                  className="button-secondary"
                  onClick={() => onSkip(focusDose.id)}
                >
                  {locale === 'fr' ? 'Indiquer comme ignorée' : 'Mark as skipped'}
                </Button>
              </div>
            </>
          ) : (
            <div className="medication-empty">
              <Pill />
              <h2>
                {locale === 'fr' ? 'Aucune prise à venir aujourd’hui' : 'No upcoming dose today'}
              </h2>
              <p>
                {medications.length === 0
                  ? locale === 'fr'
                    ? 'Ajoutez un premier traitement pour préparer un repère quotidien.'
                    : 'Add a first treatment to prepare a daily reminder.'
                  : locale === 'fr'
                    ? 'Toutes les prises prévues aujourd’hui ont été traitées.'
                    : 'All scheduled doses for today have been handled.'}
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
          <span className="eyebrow">{locale === 'fr' ? 'Aujourd’hui' : 'Today'}</span>
          <h2>{locale === 'fr' ? 'Le fil des prises' : 'Dose timeline'}</h2>
          <div
            className="dose-summary"
            aria-label={locale === 'fr' ? 'Résumé des prises' : 'Dose summary'}
          >
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'TAKEN').length}</strong>
              {locale === 'fr' ? ' confirmée(s)' : ' confirmed'}
            </span>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'PENDING').length}</strong>
              {locale === 'fr' ? ' prévue(s)' : ' scheduled'}
            </span>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'MISSED').length}</strong>
              {locale === 'fr' ? ' à vérifier' : ' to check'}
            </span>
          </div>
          <div className="dose-list">
            {todayDoses.length === 0 ? (
              <p className="empty-state">
                {locale === 'fr'
                  ? 'Aucune prise planifiée pour cette journée.'
                  : 'No dose planned today.'}
              </p>
            ) : (
              todayDoses.map((dose) => (
                <article className={`dose-row status-${dose.status.toLowerCase()}`} key={dose.id}>
                  <time>{time(dose.scheduledFor)}</time>
                  <span>
                    <strong>{dose.schedule.medication.name}</strong>
                    <small>{dose.schedule.medication.dosage}</small>
                  </span>
                  <StatusPill tone={dose.status === 'MISSED' ? 'attention' : 'neutral'}>
                    {medicationStatusLabel(dose.status, locale)}
                  </StatusPill>
                </article>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="medication-secondary-grid">
        <Card className="medication-history-card">
          <span className="eyebrow">
            {locale === 'fr' ? 'Sept derniers jours' : 'Last seven days'}
          </span>
          <h2>{locale === 'fr' ? 'Historique' : 'History'}</h2>
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
                      {medicationStatusLabel(dose.status, locale)}
                      {dose.confirmedBy ? ` · ${dose.confirmedBy.displayName}` : ''}
                    </small>
                  </span>
                </article>
              ))}
            {ordered.length === 0 && (
              <p className="empty-state">
                {locale === 'fr'
                  ? 'L’historique se remplira au fil des prises.'
                  : 'History will appear as doses are recorded.'}
              </p>
            )}
          </div>
        </Card>

        <Card className="medication-form-card">
          <span className="eyebrow">{locale === 'fr' ? 'Nouveau repère' : 'New reminder'}</span>
          <h2>{locale === 'fr' ? 'Ajouter un traitement' : 'Add a treatment'}</h2>
          <p>
            {locale === 'fr'
              ? 'Recopiez uniquement les informations déjà données par le professionnel de santé.'
              : 'Only copy information already provided by the healthcare professional.'}
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              {locale === 'fr' ? 'Nom du traitement' : 'Treatment name'}
              <input
                required
                maxLength={150}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              {locale === 'fr' ? 'Dosage indiqué' : 'Prescribed dosage'}
              <input
                required
                maxLength={150}
                placeholder={locale === 'fr' ? 'Ex. 1 comprimé' : 'E.g. 1 tablet'}
                value={draft.dosage}
                onChange={(event) => setDraft({ ...draft, dosage: event.target.value })}
              />
            </label>
            <label>
              {locale === 'fr' ? 'Consigne (facultatif)' : 'Instructions (optional)'}
              <textarea
                maxLength={1000}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
            </label>
            <div className="medication-form-row">
              <label>
                {locale === 'fr' ? 'Heure prévue' : 'Scheduled time'}
                <input
                  type="time"
                  required
                  value={draft.time}
                  onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                />
              </label>
              <label>
                {locale === 'fr' ? 'Marge de confirmation' : 'Confirmation window'}
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
              <legend>{locale === 'fr' ? 'Jours concernés' : 'Scheduled days'}</legend>
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
              {submitting
                ? locale === 'fr'
                  ? 'Ajout…'
                  : 'Adding…'
                : locale === 'fr'
                  ? 'Ajouter ce traitement'
                  : 'Add treatment'}
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}

function CamerasPanel({
  locale,
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
    new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return (
    <section className="section-view camera-page camera-page--designed">
      <header className="camera-hero">
        <div className="camera-hero-main">
          <span className="camera-hero-icon">
            <Video aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">
              {locale === 'fr' ? 'Surveillance du domicile' : 'Home cameras'}
            </span>
            <h1>{locale === 'fr' ? 'Caméras' : 'Cameras'}</h1>
            <p>
              {locale === 'fr'
                ? 'Flux en direct et clips déclenchés par l’ouverture de l’entrée principale.'
                : 'Live streams and clips triggered when the main entrance opens.'}
            </p>
          </div>
        </div>
        <div className="camera-hero-actions">
          <span className="camera-online-count">
            <span className="camera-online-dot" />
            {onlineCameras} {locale === 'fr' ? 'en ligne' : 'online'}
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
            {locale === 'fr' ? 'Plein écran' : 'Full screen'}
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
              <h2>{locale === 'fr' ? 'Flux en direct' : 'Live streams'}</h2>
              <p>
                {locale === 'fr'
                  ? 'Sélectionnez une caméra pour ouvrir son flux.'
                  : 'Select a camera to open its live stream.'}
              </p>
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
                      <h3>{camera.room?.name ?? (locale === 'fr' ? 'Sans pièce' : 'No room')}</h3>
                    </div>
                    <span
                      className={`camera-live-status ${camera.status === 'ONLINE' && !camera.privacyMode ? 'is-online' : ''}`}
                    >
                      <span />
                      {camera.privacyMode
                        ? locale === 'fr'
                          ? 'Intimité'
                          : 'Privacy'
                        : camera.status === 'ONLINE'
                          ? locale === 'fr'
                            ? 'En ligne'
                            : 'Online'
                          : camera.status}
                    </span>
                  </div>
                  <div className="camera-preview">
                    <button
                      type="button"
                      className="camera-preview-main"
                      disabled={unavailable}
                      onClick={() => onOpen(camera.id)}
                      aria-label={`${locale === 'fr' ? 'Ouvrir le direct de' : 'Open live stream for'} ${camera.name}`}
                    >
                      <span className="camera-preview-scene">
                        <Video aria-hidden="true" />
                      </span>
                      <span className="camera-preview-label">
                        {camera.privacyMode
                          ? locale === 'fr'
                            ? 'Mode intimité activé'
                            : 'Privacy mode enabled'
                          : unavailable
                            ? locale === 'fr'
                              ? 'Flux indisponible'
                              : 'Stream unavailable'
                            : locale === 'fr'
                              ? 'Ouvrir le flux en direct'
                              : 'Open live stream'}
                      </span>
                    </button>
                  </div>
                  <div className="camera-live-card-footer">
                    <strong>{camera.name}</strong>
                    <button type="button" disabled={unavailable} onClick={() => onOpen(camera.id)}>
                      {locale === 'fr' ? 'Voir le direct' : 'Open live'}{' '}
                      <ChevronRight aria-hidden="true" />
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
              <h3>{locale === 'fr' ? 'Aucune caméra associée' : 'No cameras connected'}</h3>
              <p>
                {locale === 'fr'
                  ? 'Ajoutez-la dans Mon logement → pièce → Types de capteurs → Caméra.'
                  : 'Add it under My home → room → Sensor types → Camera.'}
              </p>
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
              <h2>{locale === 'fr' ? 'Enregistrements' : 'Recordings'}</h2>
              <p>
                {locale === 'fr'
                  ? 'Clips vidéo sans son de 30 s, démarrés à l’ouverture de l’entrée principale et conservés 24 h.'
                  : '30-second, silent video clips starting when the main entrance opens, kept for 24 hours.'}
              </p>
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
                aria-label={`${locale === 'fr' ? 'Enregistrement' : 'Recording'} ${recording.cameraName}`}
              />
              <div className="camera-recording-copy">
                <strong>
                  {recording.cameraName} ·{' '}
                  {recording.roomName ?? (locale === 'fr' ? 'Sans pièce' : 'No room')}
                </strong>
                <span className="camera-recording-tag camera-recording-tag--attention">
                  <DoorOpen aria-hidden="true" />
                  {locale === 'fr' ? 'Ouverture de l’entrée principale' : 'Main entrance opened'}
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
              <span>
                {locale === 'fr'
                  ? 'Les clips apparaîtront ici après une ouverture de l’entrée principale.'
                  : 'Clips will appear here after the main entrance opens.'}
              </span>
            </div>
          )}
        </div>
      </section>

      {session && selectedCamera && (
        <Card className="camera-viewer-card">
          <div className="camera-viewer-heading">
            <div>
              <span className="camera-live-dot" />
              <span className="eyebrow">{locale === 'fr' ? 'En direct' : 'Live'}</span>
              <h2>{selectedCamera.name}</h2>
              <p>{selectedCamera.room?.name}</p>
            </div>
            <button
              type="button"
              className="camera-close"
              onClick={onClose}
              aria-label={locale === 'fr' ? 'Fermer le direct' : 'Close live stream'}
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
            <small>
              {locale === 'fr'
                ? 'Les enregistrements sont vidéo uniquement.'
                : 'Recordings contain video only.'}
            </small>
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

const personRoleLabel = (role: Person['role'], locale: Locale) => {
  const labels = {
    OWNER: ['Propriétaire', 'Owner'],
    ADMINISTRATOR: ['Administrateur', 'Administrator'],
    CAREGIVER: ['Aidant', 'Caregiver'],
    VIEWER: ['Lecture seule', 'Read only'],
  } as const;
  return role
    ? labels[role][locale === 'fr' ? 0 : 1]
    : locale === 'fr'
      ? 'Sans accès'
      : 'No access';
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
      setError(
        locale === 'fr'
          ? 'Indiquez le nom et un moyen de contact.'
          : 'Enter a name and contact method.',
      );
      return;
    }
    if (
      (!existing || !existing.hasAccount) &&
      draft.hasAccess &&
      (!draft.username || draft.temporaryPassword.length < 12)
    ) {
      setError(
        locale === 'fr'
          ? 'Un identifiant et un mot de passe temporaire de 12 caractères sont requis.'
          : 'A username and 12-character temporary password are required.',
      );
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
      setError(
        body?.message ??
          (locale === 'fr'
            ? 'Impossible d’enregistrer cette fiche.'
            : 'Unable to save this profile.'),
      );
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
      const password = window.prompt(
        locale === 'fr'
          ? 'Mot de passe temporaire (12 caractères minimum)'
          : 'Temporary password (12 characters minimum)',
      );
      if (!password || password.length < 12) return;
      body = { action, temporaryPassword: password };
    } else if (
      !window.confirm(
        action === 'restore'
          ? locale === 'fr'
            ? 'Restaurer cette fiche ? L’accès restera suspendu jusqu’à sa réactivation.'
            : 'Restore this profile? Access will remain suspended until it is enabled.'
          : locale === 'fr'
            ? 'Confirmer cette modification d’accès ?'
            : 'Confirm this access change?',
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
    if (
      !window.confirm(
        locale === 'fr'
          ? 'Archiver cette fiche ? Son historique sera conservé.'
          : 'Archive this profile? Its history will be kept.',
      )
    )
      return;
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
    ALL: locale === 'fr' ? 'Tous' : 'All',
    ACCESS: locale === 'fr' ? 'Avec accès' : 'With access',
    EMERGENCY: locale === 'fr' ? 'Urgence' : 'Emergency',
    DISABLED: locale === 'fr' ? 'Désactivés' : 'Disabled',
  };
  const activePeople = people.filter((person) => !person.archived).length;
  const activeAccess = people.filter(
    (person) => person.hasAccount && !person.accessDisabled && !person.archived,
  ).length;
  const emergencyContacts = people.filter(
    (person) => person.isEmergency && !person.archived,
  ).length;

  if (loading)
    return (
      <DataLoadingScreen
        locale={locale}
        message={locale === 'fr' ? 'Préparation de vos proches…' : 'Preparing your care circle…'}
      />
    );

  return (
    <section className="section-view people-page">
      <div className="people-hero">
        <div className="people-title-row">
          <div>
            <span className="eyebrow">
              {locale === 'fr' ? 'Cercle de confiance' : 'Care circle'}
            </span>
            <h2>{locale === 'fr' ? 'Les proches' : 'People'}</h2>
            <p>
              {locale === 'fr'
                ? 'Les bonnes personnes, avec le bon niveau d’accès.'
                : 'The right people, with the right level of access.'}
            </p>
          </div>
        </div>
        {canManage && (
          <Button className="people-add-button" onClick={() => edit()}>
            <Plus />
            {locale === 'fr' ? 'Ajouter un proche' : 'Add person'}
          </Button>
        )}
      </div>
      <div className="people-overview" aria-label={locale === 'fr' ? 'Résumé' : 'Summary'}>
        <div>
          <span className="people-overview-icon people-overview-icon--family">
            <UserRound />
          </span>
          <p>
            <strong>{activePeople}</strong>
            <span>{locale === 'fr' ? 'proches enregistrés' : 'saved people'}</span>
          </p>
        </div>
        <i />
        <div>
          <span className="people-overview-icon people-overview-icon--access">
            <ShieldCheck />
          </span>
          <p>
            <strong>{activeAccess}</strong>
            <span>{locale === 'fr' ? 'accès à Élise' : 'Élise access'}</span>
          </p>
        </div>
        <i />
        <div>
          <span className="people-overview-icon people-overview-icon--urgent">
            <Bell />
          </span>
          <p>
            <strong>{emergencyContacts}</strong>
            <span>{locale === 'fr' ? 'contacts prioritaires' : 'priority contacts'}</span>
          </p>
        </div>
      </div>
      <div className="people-toolbar">
        <label className="people-search">
          <Search />
          <input
            aria-label={locale === 'fr' ? 'Rechercher' : 'Search'}
            type="search"
            placeholder={
              locale === 'fr'
                ? 'Rechercher par nom, lien ou email'
                : 'Search by name, relationship or email'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div role="group" aria-label={locale === 'fr' ? 'Filtrer la liste' : 'Filter list'}>
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
                  <p>
                    {person.relation ||
                      (locale === 'fr' ? 'Lien non précisé' : 'Relationship not specified')}
                  </p>
                </div>
                {person.isEmergency && (
                  <span
                    className="people-priority"
                    title={locale === 'fr' ? 'Priorité d’appel' : 'Call priority'}
                  >
                    <Bell />
                    {person.priority + 1}
                  </span>
                )}
              </div>
              <div className="people-badges">
                <span className={`people-role role-${person.role ?? 'NONE'}`}>
                  {personRoleIcon(person.role)}
                  {personRoleLabel(person.role, locale)}
                </span>
                {person.isEmergency && (
                  <span className="people-emergency">
                    <Bell />
                    {locale === 'fr' ? 'Contact prioritaire' : 'Priority contact'}
                  </span>
                )}
                {person.accessDisabled && (
                  <span>{locale === 'fr' ? 'Accès désactivé' : 'Access disabled'}</span>
                )}
                {person.archived && <span>{locale === 'fr' ? 'Archivé' : 'Archived'}</span>}
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
                      ? locale === 'fr'
                        ? 'Accès suspendu'
                        : 'Access suspended'
                      : locale === 'fr'
                        ? 'Accès actif'
                        : 'Active access'
                    : locale === 'fr'
                      ? 'Contact uniquement'
                      : 'Contact only'}
                </span>
                {canManage && !person.isCurrentUser && (
                  <div className="people-actions">
                    <button className="people-edit" onClick={() => edit(person)}>
                      {locale === 'fr' ? 'Voir la fiche' : 'View profile'}
                      <ChevronRight aria-hidden="true" />
                    </button>
                    <details className="people-action-menu">
                      <summary aria-label={locale === 'fr' ? 'Plus d’actions' : 'More actions'}>
                        •••
                      </summary>
                      <div>
                        {person.archived ? (
                          <button onClick={() => void access(person, 'restore')}>
                            <Archive />
                            {locale === 'fr' ? 'Restaurer la fiche' : 'Restore profile'}
                          </button>
                        ) : person.hasAccount ? (
                          <button
                            onClick={() =>
                              void access(person, person.accessDisabled ? 'enable' : 'disable')
                            }
                          >
                            <Power />
                            {person.accessDisabled
                              ? locale === 'fr'
                                ? 'Réactiver l’accès'
                                : 'Enable access'
                              : locale === 'fr'
                                ? 'Suspendre l’accès'
                                : 'Suspend access'}
                          </button>
                        ) : null}
                        {!person.archived && person.hasAccount && !person.accessDisabled && (
                          <button onClick={() => void access(person, 'reset-password')}>
                            <KeyRound />
                            {locale === 'fr' ? 'Réinitialiser le mot de passe' : 'Reset password'}
                          </button>
                        )}
                        {!person.archived && (
                          <button className="is-danger" onClick={() => void archive(person)}>
                            <Archive />
                            {locale === 'fr' ? 'Archiver la fiche' : 'Archive profile'}
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                )}
                {person.isCurrentUser && (
                  <small>{locale === 'fr' ? 'Votre compte' : 'Your account'}</small>
                )}
              </div>
            </Card>
          ))}
        {!loading && visible.length === 0 && (
          <Card className="people-empty">
            <span>
              <UsersRound />
            </span>
            <h3>
              {locale === 'fr' ? 'Personne ne correspond à cette vue' : 'No one matches this view'}
            </h3>
            <p>
              {locale === 'fr'
                ? 'Modifiez la recherche ou choisissez un autre filtre.'
                : 'Change your search or choose another filter.'}
            </p>
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
                  {editor === 'new'
                    ? locale === 'fr'
                      ? 'Nouveau proche'
                      : 'New person'
                    : locale === 'fr'
                      ? 'Modifier la fiche'
                      : 'Edit profile'}
                </span>
                <h2>
                  {editor === 'new'
                    ? locale === 'fr'
                      ? 'Ajouter au cercle'
                      : 'Add to circle'
                    : `${editor.firstName} ${editor.lastName}`}
                </h2>
              </div>
              <button
                aria-label={locale === 'fr' ? 'Fermer' : 'Close'}
                onClick={() => setEditor(null)}
              >
                <X />
              </button>
            </header>
            <form onSubmit={(event) => void save(event)}>
              <div className="people-form-grid">
                <label>
                  {locale === 'fr' ? 'Prénom' : 'First name'}
                  <input
                    autoFocus
                    value={draft.firstName}
                    onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                  />
                </label>
                <label>
                  {locale === 'fr' ? 'Nom' : 'Last name'}
                  <input
                    value={draft.lastName}
                    onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                  />
                </label>
                <label>
                  {locale === 'fr' ? 'Téléphone' : 'Phone'}
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
                  {locale === 'fr' ? 'Lien avec le résident' : 'Relationship'}
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
                  <strong>{locale === 'fr' ? 'Contact d’urgence' : 'Emergency contact'}</strong>
                  <small>
                    {locale === 'fr'
                      ? 'Visible dans l’ordre d’appel prioritaire.'
                      : 'Shown in the priority call order.'}
                  </small>
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
                    <strong>
                      {locale === 'fr' ? 'Donner accès à Élise' : 'Grant Élise access'}
                    </strong>
                    <small>
                      {locale === 'fr'
                        ? 'Mot de passe à changer à la première connexion.'
                        : 'Password must be changed at first sign-in.'}
                    </small>
                  </span>
                </label>
              )}
              {(draft.hasAccess || (editor !== 'new' && editor.hasAccount)) &&
                (editor === 'new' || editor.role !== 'OWNER') && (
                  <div className="people-access-fields">
                    <label>
                      {locale === 'fr' ? 'Rôle' : 'Role'}
                      <select
                        value={draft.role}
                        onChange={(e) => setDraft({ ...draft, role: e.target.value as AccessRole })}
                      >
                        {currentRole === 'OWNER' && (
                          <option value="ADMINISTRATOR">
                            {locale === 'fr' ? 'Administrateur' : 'Administrator'}
                          </option>
                        )}
                        <option value="CAREGIVER">
                          {locale === 'fr' ? 'Aidant' : 'Caregiver'}
                        </option>
                        <option value="VIEWER">
                          {locale === 'fr' ? 'Lecture seule' : 'Read only'}
                        </option>
                      </select>
                    </label>
                    {(editor === 'new' || !editor.hasAccount) && (
                      <>
                        <label>
                          {locale === 'fr' ? 'Identifiant' : 'Username'}
                          <input
                            value={draft.username}
                            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                          />
                        </label>
                        <label className="wide">
                          {locale === 'fr' ? 'Mot de passe temporaire' : 'Temporary password'}
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
                  {locale === 'fr' ? 'Annuler' : 'Cancel'}
                </Button>
                <Button disabled={saving}>
                  {saving
                    ? locale === 'fr'
                      ? 'Enregistrement…'
                      : 'Saving…'
                    : locale === 'fr'
                      ? 'Enregistrer'
                      : 'Save'}
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
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'fr';
    return window.localStorage.getItem('michel_locale') === 'en' ? 'en' : 'fr';
  });
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
  const [settingsTab, setSettingsTab] = useState<'general' | 'google' | 'rules'>('general');
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
  const t = copy[locale];
  const sidebarAutoHideLocked =
    household?.home.installationStatus === 'DRAFT' || tourMode !== null || homeSetupPreview;
  const sidebarAutoHideActive = sidebarAutoHide && !sidebarAutoHideLocked;
  const changeLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    window.localStorage.setItem('michel_locale', nextLocale);
  };
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

  const installUpdate = useCallback(async (version: string) => {
    setUpdateBusy(true);
    try {
      const response = await fetch('/api/v1/system/update/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (response.ok) setUpdateStatus((await response.json()) as UpdateStatus);
      if (!response.ok) return;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        try {
          const statusResponse = await fetch('/api/v1/system/update');
          if (!statusResponse.ok) continue;
          const next = (await statusResponse.json()) as UpdateStatus;
          setUpdateStatus(next);
          if (['SUCCEEDED', 'ROLLED_BACK', 'FAILED'].includes(next.state)) break;
        } catch {
          // The API is expected to disappear briefly while the new release starts.
        }
      }
    } finally {
      setUpdateBusy(false);
    }
  }, []);

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
      setCameraNotice(
        result?.message ??
          (locale === 'fr' ? 'Le direct est indisponible.' : 'Live view is unavailable.'),
      );
    } catch {
      if (requestId === cameraSessionRequest.current) {
        setCameraNotice(
          locale === 'fr' ? 'Le direct est indisponible.' : 'Live view is unavailable.',
        );
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
          ? `${result.accepted} événement(s) ajouté(s) au journal d’activité.`
          : 'Ce scénario avait déjà été appliqué.',
      );
      await refresh();
    } else {
      setSimulationNotice('La situation n’a pas pu être simulée. Réessayez dans un instant.');
    }
    setRunningSimulation(null);
  };
  const saveAlertRules = async () => {
    if (!alertRules) return;
    setSavingRules(true);
    setRuleNotice('');
    const response = await fetch('/api/v1/alerts/rules', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alertRules),
    });
    setRuleNotice(
      response.ok
        ? 'Les repères ont été enregistrés localement.'
        : 'Les repères n’ont pas pu être enregistrés.',
    );
    setSavingRules(false);
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
      setMedicationNotice(
        locale === 'fr'
          ? 'Le traitement n’a pas pu être ajouté. Vérifiez vos droits ou réessayez.'
          : 'The treatment could not be added. Check your access or try again.',
      );
      return false;
    }
    setMedicationNotice(
      locale === 'fr'
        ? 'Le traitement et son horaire ont été ajoutés localement.'
        : 'The treatment and its schedule were added locally.',
    );
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
          ? locale === 'fr'
            ? 'Prise confirmée. Le suivi a été mis à jour.'
            : 'Dose confirmed. The timeline is up to date.'
          : locale === 'fr'
            ? 'La prise a été indiquée comme ignorée.'
            : 'The dose was marked as skipped.'
        : locale === 'fr'
          ? 'La prise n’a pas pu être mise à jour.'
          : 'The dose could not be updated.',
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
        <DataLoadingScreen
          locale={locale}
          message={locale === 'fr' ? 'Préparation de votre espace…' : 'Preparing your space…'}
          fullPage
        />
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
        <h1>Élise est momentanément inaccessible</h1>
        <p>Vérifiez que le service local est démarré, puis réessayez.</p>
        <Button onClick={() => void refresh()}>Réessayer</Button>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="data-loading-page">
        <DataLoadingScreen
          locale={locale}
          message={locale === 'fr' ? 'Chargement de vos données…' : 'Loading your data…'}
          fullPage
        />
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
          aria-label="Fermer le menu"
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
            <span>{locale === 'fr' ? 'Aidant principal' : 'Primary caregiver'}</span>
          </div>
          <button
            type="button"
            className={`caregiver-logout${logoutFailed ? ' caregiver-logout--failed' : ''}`}
            onClick={() => void logout()}
            disabled={loggingOut}
            aria-label={
              logoutFailed
                ? locale === 'fr'
                  ? 'Réessayer la déconnexion'
                  : 'Retry signing out'
                : locale === 'fr'
                  ? 'Se déconnecter'
                  : 'Sign out'
            }
            title={locale === 'fr' ? 'Se déconnecter' : 'Sign out'}
          >
            <LogOut size={16} />
            <span className="sr-only">
              {logoutFailed
                ? locale === 'fr'
                  ? 'Réessayer'
                  : 'Try again'
                : loggingOut
                  ? locale === 'fr'
                    ? 'Déconnexion…'
                    : 'Signing out…'
                  : locale === 'fr'
                    ? 'Se déconnecter'
                    : 'Sign out'}
            </span>
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar topbar--compact">
          <button
            className="mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Ouvrir le menu"
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
              <strong>
                {locale === 'fr' ? 'Connexion locale interrompue' : 'Local connection interrupted'}
              </strong>
              {locale === 'fr'
                ? ' Les dernières informations reçues restent affichées.'
                : ' The latest received information remains visible.'}
            </span>
            <button type="button" onClick={() => void refresh()}>
              {locale === 'fr' ? 'Réessayer' : 'Retry'}
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
            <header className="resident-hero">
              <div>
                <span className="eyebrow">
                  {locale === 'fr' ? 'Profil d’accompagnement' : 'Support profile'}
                </span>
                <h2>
                  {locale === 'fr' ? 'La fiche de ' : ''}
                  {resident?.preferredName ?? resident?.displayName ?? residentName}
                  {locale === 'fr' ? '' : '’s profile'}
                </h2>
                <p>
                  {locale === 'fr'
                    ? 'Les repères essentiels pour un accompagnement attentif et personnalisé.'
                    : 'Essential context for attentive, personal support.'}
                </p>
              </div>
              <Button className="button-secondary resident-back" onClick={() => setActive(0)}>
                <ChevronRight aria-hidden="true" />
                {locale === 'fr' ? 'Retour à l’accueil' : 'Back to home'}
              </Button>
            </header>

            {resident ? (
              <div className="resident-profile-layout">
                <Card className="resident-profile-card">
                  <div className="resident-profile-photo">
                    {resident.photoUrl ? (
                      <img
                        src={resident.photoUrl}
                        alt={
                          locale === 'fr'
                            ? `Portrait de ${resident.displayName}`
                            : resident.displayName
                        }
                      />
                    ) : (
                      <div className="resident-photo-fallback">
                        {(resident.preferredName ?? resident.firstName ?? '?')[0]}
                      </div>
                    )}
                    {canEditResident && (
                      <label
                        className="resident-photo-upload"
                        title={locale === 'fr' ? 'Changer la photo' : 'Change photo'}
                      >
                        <Camera aria-hidden="true" />
                        <span className="sr-only">
                          {locale === 'fr' ? 'Changer la photo' : 'Change photo'}
                        </span>
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
                      {locale === 'fr' ? 'Personne accompagnée' : 'Resident'}
                    </span>
                    <h3>
                      {resident.firstName} {resident.lastName}
                    </h3>
                    <p>
                      {resident.formOfAddress
                        ? `${resident.formOfAddress} · ${resident.preferredName || resident.firstName}`
                        : locale === 'fr'
                          ? `Prénom utilisé : ${resident.preferredName || resident.firstName || '—'}`
                          : `Preferred name: ${resident.preferredName || resident.firstName || '—'}`}
                    </p>
                  </div>

                  <div className="resident-facts">
                    <div>
                      <span className="resident-fact-icon resident-fact-icon--date">
                        <CalendarDays aria-hidden="true" />
                      </span>
                      <p>
                        <small>{locale === 'fr' ? 'Naissance' : 'Born'}</small>
                        <strong>
                          {resident.birthDate
                            ? new Date(resident.birthDate).toLocaleDateString(locale, {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                              })
                            : '—'}
                        </strong>
                        {residentAge(resident.birthDate, locale) && (
                          <span>{residentAge(resident.birthDate, locale)}</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="resident-fact-icon resident-fact-icon--language">
                        <BookOpen aria-hidden="true" />
                      </span>
                      <p>
                        <small>{locale === 'fr' ? 'Langue parlée' : 'Spoken language'}</small>
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
                      {locale === 'fr' ? 'Supprimer la photo' : 'Remove photo'}
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
                        <span className="eyebrow">
                          {locale === 'fr' ? 'Situation de vie' : 'Living context'}
                        </span>
                        <h3>{locale === 'fr' ? 'Son quotidien' : 'Daily life'}</h3>
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
                              ? locale === 'fr'
                                ? 'Situation de vie non renseignée'
                                : 'Living situation not provided'
                              : resident.context.livesAlone
                                ? locale === 'fr'
                                  ? 'Vit seul(e) à son domicile'
                                  : 'Lives alone at home'
                                : locale === 'fr'
                                  ? 'Vit accompagné(e) à son domicile'
                                  : 'Lives with someone at home'}
                          </span>
                        </div>
                        {resident.context.livesWithPartner && (
                          <div className="resident-context-item">
                            <HeartHandshake aria-hidden="true" />
                            <span>{locale === 'fr' ? 'Avec son conjoint' : 'With a partner'}</span>
                          </div>
                        )}
                        {resident.context.livesWithRelative && (
                          <div className="resident-context-item">
                            <UsersRound aria-hidden="true" />
                            <span>{locale === 'fr' ? 'Avec un proche' : 'With a relative'}</span>
                          </div>
                        )}
                        {resident.context.receivesHomeHelp && (
                          <div className="resident-context-item">
                            <Accessibility aria-hidden="true" />
                            <span>{locale === 'fr' ? 'Aide à domicile' : 'Home help'}</span>
                          </div>
                        )}
                        {resident.context.receivesVisits && (
                          <div className="resident-context-item">
                            <CalendarDays aria-hidden="true" />
                            <span>{locale === 'fr' ? 'Visites régulières' : 'Regular visits'}</span>
                          </div>
                        )}
                        {resident.context.hasPet && (
                          <div className="resident-context-item">
                            <PawPrint aria-hidden="true" />
                            <span>
                              {locale === 'fr' ? 'Vit avec un animal' : 'Lives with a pet'}
                            </span>
                          </div>
                        )}
                        <div className="resident-context-item resident-context-item--wide">
                          <Footprints aria-hidden="true" />
                          <span>{residentMobilityLabel(resident.context.mobility, locale)}</span>
                        </div>
                        {resident.context.visualDifficulty && (
                          <div className="resident-context-item resident-context-item--attention">
                            <Eye aria-hidden="true" />
                            <span>
                              {locale === 'fr' ? 'Difficulté visuelle' : 'Visual difficulty'}
                            </span>
                          </div>
                        )}
                        {resident.context.hearingDifficulty && (
                          <div className="resident-context-item resident-context-item--attention">
                            <Ear aria-hidden="true" />
                            <span>
                              {locale === 'fr' ? 'Difficulté auditive' : 'Hearing difficulty'}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="resident-empty-state">
                        <Home aria-hidden="true" />
                        <p>
                          {locale === 'fr' ? 'Aucun contexte renseigné.' : 'No context recorded.'}
                        </p>
                      </div>
                    )}
                  </Card>

                  <Card className="resident-info-card resident-support-card">
                    <header>
                      <span className="resident-section-icon resident-section-icon--support">
                        <HeartHandshake aria-hidden="true" />
                      </span>
                      <div>
                        <span className="eyebrow">
                          {locale === 'fr' ? 'Accompagnement' : 'Support'}
                        </span>
                        <h3>{locale === 'fr' ? 'Points d’attention' : 'Key considerations'}</h3>
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
                              <strong>{supportNeedLabel(need.kind, locale)}</strong>
                              {need.note && <p>{need.note}</p>}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="resident-empty-state resident-empty-state--positive">
                        <CircleCheck aria-hidden="true" />
                        <p>
                          {locale === 'fr'
                            ? 'Aucun besoin particulier indiqué.'
                            : 'No particular support need recorded.'}
                        </p>
                      </div>
                    )}
                  </Card>

                  <Card className="resident-info-card resident-habits-card">
                    <header>
                      <span className="resident-section-icon resident-section-icon--habits">
                        <Clock3 aria-hidden="true" />
                      </span>
                      <div>
                        <span className="eyebrow">{locale === 'fr' ? 'Habitudes' : 'Habits'}</span>
                        <h3>{locale === 'fr' ? 'Les repères de sa journée' : 'Daily routines'}</h3>
                      </div>
                      <span className="resident-card-count">{resident.habits.length}</span>
                    </header>
                    {resident.habits.length ? (
                      <div className="resident-routine-list">
                        {resident.habits.map((habit) => (
                          <article key={habit.id}>
                            <span className="resident-routine-dot" />
                            <div>
                              <strong>{habitLabel(habit.kind, locale)}</strong>
                              <small>
                                {habit.status === 'UNKNOWN'
                                  ? locale === 'fr'
                                    ? 'Élise est en train d’apprendre ce repère'
                                    : 'Élise is learning this routine'
                                  : `${formatMinute(habit.startMinute)} – ${formatMinute(habit.endMinute)}`}
                              </small>
                            </div>
                            <span
                              className={`resident-routine-status status-${habit.status.toLowerCase()}`}
                            >
                              {habit.status === 'UNKNOWN'
                                ? locale === 'fr'
                                  ? 'À apprendre'
                                  : 'To learn'
                                : locale === 'fr'
                                  ? 'Enregistré'
                                  : 'Recorded'}
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="resident-empty-state">
                        <Clock3 aria-hidden="true" />
                        <p>
                          {locale === 'fr'
                            ? 'Élise apprendra progressivement les habitudes.'
                            : 'Élise will learn routines progressively.'}
                        </p>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            ) : (
              <Card className="resident-empty-profile">
                <UserRound aria-hidden="true" />
                <h3>{locale === 'fr' ? 'Aucun résident configuré' : 'No resident configured'}</h3>
                <p>
                  {locale === 'fr'
                    ? 'La fiche apparaîtra ici après la configuration initiale.'
                    : 'The profile will appear here after initial setup.'}
                </p>
              </Card>
            )}
          </section>
        ) : active === 8 ? (
          <section className="section-view settings-page">
            <header className="settings-hero">
              <div className="settings-hero-copy">
                <span className="eyebrow">Élise OS</span>
                <h2>{t.nav[8]}</h2>
                <p>
                  {locale === 'fr'
                    ? 'Adaptez Élise à votre quotidien et choisissez les situations qui méritent votre attention.'
                    : 'Adapt Élise to your daily life and choose which situations deserve your attention.'}
                </p>
              </div>
              <span className="settings-hero-icon" aria-hidden="true">
                <Settings />
              </span>
            </header>

            <nav
              className="settings-tabs"
              aria-label={locale === 'fr' ? 'Rubriques des réglages' : 'Settings sections'}
            >
              <button
                type="button"
                className={settingsTab === 'general' ? 'is-selected' : ''}
                aria-selected={settingsTab === 'general'}
                onClick={() => setSettingsTab('general')}
              >
                <Settings aria-hidden="true" /> {locale === 'fr' ? 'Général' : 'General'}
              </button>
              <button
                type="button"
                className={settingsTab === 'google' ? 'is-selected' : ''}
                aria-selected={settingsTab === 'google'}
                onClick={() => setSettingsTab('google')}
              >
                <KeyRound aria-hidden="true" />{' '}
                {locale === 'fr' ? 'Compte Google' : 'Google account'}
              </button>
              <button
                type="button"
                className={settingsTab === 'rules' ? 'is-selected' : ''}
                aria-selected={settingsTab === 'rules'}
                onClick={() => setSettingsTab('rules')}
              >
                <Bell aria-hidden="true" /> {locale === 'fr' ? 'Règles' : 'Rules'}
              </button>
            </nav>

            {settingsTab === 'general' && (
              <details className="michel-card settings-section-card settings-disclosure settings-general-card">
                <summary className="settings-section-heading">
                  <span className="settings-section-icon">
                    <Settings />
                  </span>
                  <div>
                    <span className="eyebrow">
                      {locale === 'fr' ? 'Préférences de l’application' : 'Application preferences'}
                    </span>
                    <h2>{locale === 'fr' ? 'Général' : 'General'}</h2>
                    <p>
                      {locale === 'fr'
                        ? 'Les réglages essentiels de cet appareil, réunis au même endroit.'
                        : 'Essential settings for this device, all in one place.'}
                    </p>
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
                        <h3>{locale === 'fr' ? 'Langue de l’interface' : 'Interface language'}</h3>
                        <p>
                          {locale === 'fr'
                            ? 'Choisissez la langue utilisée par Élise sur cet appareil.'
                            : 'Choose the language Élise uses on this device.'}
                        </p>
                      </div>
                    </div>
                    <div className="settings-language-options" role="group" aria-label="Language">
                      <button
                        className={locale === 'fr' ? 'is-selected' : ''}
                        onClick={() => changeLocale('fr')}
                        aria-pressed={locale === 'fr'}
                      >
                        <FRFlag />
                        <strong>Français</strong>
                        {locale === 'fr' && <CircleCheck />}
                      </button>
                      <button
                        className={locale === 'en' ? 'is-selected' : ''}
                        onClick={() => changeLocale('en')}
                        aria-pressed={locale === 'en'}
                      >
                        <GBFlag />
                        <strong>English</strong>
                        {locale === 'en' && <CircleCheck />}
                      </button>
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
                        <h3>{locale === 'fr' ? 'Visite guidée' : 'Guided tour'}</h3>
                        <p>
                          {locale === 'fr'
                            ? 'Redécouvrez les espaces essentiels de l’application, sans modifier votre logement.'
                            : 'Rediscover the essential areas of the application without changing your home.'}
                        </p>
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
                      {locale === 'fr' ? 'Revoir la visite' : 'Replay the tour'}
                    </Button>
                  </article>

                  {simulationScenarios.length > 0 && (
                    <SimulationPanel
                      scenarios={simulationScenarios}
                      running={runningSimulation}
                      notice={simulationNotice}
                      onRun={(scenario) => void runSimulation(scenario)}
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
            {settingsTab === 'google' && <GoogleAccountSettings locale={locale} />}
            {settingsTab === 'rules' && alertRules && (
              <AlertRulesPanel
                rules={alertRules}
                saving={savingRules}
                notice={ruleNotice}
                onChange={setAlertRules}
                onSave={() => void saveAlertRules()}
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
              <p>
                {locale === 'fr'
                  ? 'Cette section utilise déjà les fondations d’Élise et sera enrichie au prochain incrément vertical.'
                  : 'This section already uses the Élise foundations and will be expanded in the next vertical increment.'}
              </p>
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
              label: `${activityDescription(event, locale)}${event.room ? ` · ${event.room}` : ''}`,
            }))}
            reminders={[
              ...medicationDoses
                .filter((dose) => dose.status === 'PENDING')
                .map((dose) => ({
                  title: locale === 'fr' ? 'Médicaments' : 'Medication',
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
