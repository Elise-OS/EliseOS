import * as Progress from '@radix-ui/react-progress';
import { Button, Card, Metric, StatusPill } from '@michel/ui';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bell,
  BookOpen,
  ChevronRight,
  CircleCheck,
  CookingPot,
  DoorOpen,
  HeartHandshake,
  Home,
  Menu,
  Pill,
  Radar,
  Settings,
  ShieldCheck,
  Sofa,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { copy, type Locale } from './i18n';
import { resizeResidentPhoto, Setup } from './Setup';

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
      livesAlone: boolean;
      livesWithPartner: boolean;
      livesWithRelative: boolean;
      receivesHomeHelp: boolean;
      receivesVisits: boolean;
      hasPet: boolean;
      mobility: string;
      hearingDifficulty: boolean;
      visualDifficulty: boolean;
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
    role: 'ADMINISTRATOR' | 'RELATIVE' | 'EMERGENCY';
    priority: number;
    hasAccount: boolean;
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

interface EquipmentStatus {
  homeAssistant: { connected: boolean; lastSeenAt: string | null };
  inventory: {
    lastSyncAt: string | null;
    lastRequestedAt: string | null;
    entities: number;
    devices: number;
  };
  pairing: { active: boolean; expiresAt: string | null };
  lastError: string | null;
}

interface EquipmentCandidate {
  id: string;
  entityId: string;
  sourceName: string | null;
  capability: string;
  compatibility: 'VALIDATED' | 'RECOGNIZED' | 'PARTIAL' | 'UNSUPPORTED';
  status: string;
  available: boolean;
  domain: string | null;
  deviceClass: string | null;
  unit: string | null;
  device: { name: string; manufacturer: string | null; model: string | null } | null;
  room: { id: string; name: string } | null;
  mapping: { capability: string; transform: string; enabled: boolean } | null;
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

interface ActivitySummary {
  period: '24h' | '7d';
  from: string;
  to: string;
  total: number;
  buckets: Array<{ start: string; label: string; count: number }>;
  byRoom: Array<{ id: string | null; name: string; count: number }>;
  byCapability: Array<{ capability: string; count: number }>;
}

interface ScheduleItem {
  id: string;
  type: 'VISIT' | 'APPOINTMENT';
  title: string;
  startsAt: string;
  endsAt: string | null;
  detail: string | null;
  notes: string | null;
}

const navIcons = [Home, Activity, Bell, Sofa, Pill, BookOpen, UsersRound, Settings];
const roomIcons: Record<string, typeof Sofa> = {
  LIVING_ROOM: Sofa,
  KITCHEN: CookingPot,
  ENTRANCE: DoorOpen,
};

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
          <Home />
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
              ? 'Cette étape crée le premier compte administrateur de la maison.'
              : 'This step creates the home’s first administrator account.'}
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
          <Home />
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

function relativeTime(value: string, locale: Locale): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return locale === 'fr' ? `il y a ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return locale === 'fr' ? `il y a ${hours} h` : `${hours}h ago`;
}

function formatMinute(value: number | null): string {
  if (value === null) return '—';
  return `${String(Math.floor(value / 60)).padStart(2, '0')} h ${String(value % 60).padStart(2, '0')}`;
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
    contact: ['Ouverture', 'Opening'],
    button: ['Bouton d’appel', 'Call button'],
    temperature: ['Température', 'Temperature'],
    humidity: ['Humidité', 'Humidity'],
    power: ['Puissance', 'Power'],
    energy: ['Énergie', 'Energy'],
    battery: ['Batterie', 'Battery'],
  };
  return labels[capability]?.[locale === 'fr' ? 0 : 1] ?? capability;
}

function sensorStatusLabel(status: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    ONLINE: ['Disponible', 'Available'],
    DEGRADED: ['Données fragiles', 'Limited data'],
    OFFLINE: ['Ne répond plus', 'Not responding'],
    UNKNOWN: ['À vérifier', 'To check'],
  };
  return labels[status]?.[locale === 'fr' ? 0 : 1] ?? status;
}

export function activityDescription(item: ActivityItem, locale: Locale): string {
  const payload =
    item.payload && typeof item.payload === 'object'
      ? (item.payload as Record<string, unknown>)
      : {};
  const rawValue = payload.value ?? payload.state;
  const unit = typeof payload.unit === 'string' ? payload.unit : '';
  const value =
    typeof rawValue === 'number' || typeof rawValue === 'string'
      ? `${rawValue}${unit ? ` ${unit}` : ''}`
      : null;
  const contactOpen =
    rawValue === true || rawValue === 'open' || rawValue === 'on' || rawValue === 1;
  const labels: Record<string, [string, string]> = {
    motion: ['Mouvement détecté', 'Movement detected'],
    occupancy: ['Présence détectée', 'Presence detected'],
    contact: contactOpen
      ? ['Ouverture détectée', 'Opening detected']
      : ['Fermeture détectée', 'Closing detected'],
    temperature: [
      value ? `Température · ${value}` : 'Température relevée',
      value ? `Temperature · ${value}` : 'Temperature reading',
    ],
    humidity: [
      value ? `Humidité · ${value}` : 'Humidité relevée',
      value ? `Humidity · ${value}` : 'Humidity reading',
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

function alertStatusLabel(status: AlertItem['status'], locale: Locale): string {
  const labels = {
    OPEN: ['Ouverte', 'Open'],
    ACKNOWLEDGED: ['Prise en charge', 'Acknowledged'],
    RESOLVED: ['Résolue', 'Resolved'],
    DISMISSED: ['Ignorée', 'Dismissed'],
  } as const;
  return labels[status][locale === 'fr' ? 0 : 1];
}

function alertSeverityLabel(severity: AlertItem['severity'], locale: Locale): string {
  const labels = {
    INFO: ['Information', 'Information'],
    ATTENTION: ['À vérifier', 'Needs attention'],
    URGENT: ['Urgent', 'Urgent'],
  } as const;
  return labels[severity][locale === 'fr' ? 0 : 1];
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
    <Card className="settings-card simulation-card">
      <div className="settings-card-heading">
        <span className="settings-icon">
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
    </Card>
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
    <Card className="settings-card alert-rules-card">
      <div className="settings-card-heading">
        <span className="settings-icon">
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
      </div>
      <div className="alert-rule-list">
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
    </Card>
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

export function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'fr';
    return window.localStorage.getItem('michel_locale') === 'en' ? 'en' : 'fr';
  });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [dataError, setDataError] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityDay, setActivityDay] = useState('');
  const [activityRoom, setActivityRoom] = useState('');
  const [activityType, setActivityType] = useState('');
  const [loadingMoreActivity, setLoadingMoreActivity] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertFilter, setAlertFilter] = useState<'ALL' | AlertItem['status']>('ALL');
  const [journal, setJournal] = useState<JournalItem[]>([]);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'24h' | '7d'>('24h');
  const [analytics, setAnalytics] = useState<ActivitySummary | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
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
  const [equipmentStatus, setEquipmentStatus] = useState<EquipmentStatus | null>(null);
  const [equipmentCandidates, setEquipmentCandidates] = useState<EquipmentCandidate[]>([]);
  const [equipmentNotice, setEquipmentNotice] = useState('');
  const [active, setActive] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [contactDraft, setContactDraft] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    relation: '',
    role: 'proche' as 'proche' | 'administrateur' | 'urgence',
    username: '',
    temporaryPassword: '',
    confirmation: '',
  });
  const [contactError, setContactError] = useState('');
  const previewSetup =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('setup') === '1';
  const [entryState, setEntryState] = useState<'loading' | 'setup' | 'app'>(
    previewSetup ? 'setup' : 'loading',
  );
  const t = copy[locale];
  const changeLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    window.localStorage.setItem('michel_locale', nextLocale);
  };

  const refresh = useCallback(async () => {
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
      const now = new Date();
      const historyStart = new Date(now.getTime() - 7 * 86_400_000);
      const historyEnd = new Date(now.getTime() + 86_400_000);
      const [
        activityResponse,
        alertsResponse,
        journalResponse,
        householdResponse,
        simulationResponse,
        rulesResponse,
        medicationsResponse,
        dosesResponse,
        analyticsResponse,
        scheduleResponse,
        equipmentStatusResponse,
        equipmentCandidatesResponse,
      ] = await Promise.all([
        fetch('/api/v1/activity/feed?limit=30'),
        fetch('/api/v1/alerts'),
        fetch('/api/v1/journal'),
        fetch('/api/v1/household'),
        fetch('/api/v1/simulation/scenarios'),
        fetch('/api/v1/alerts/rules'),
        fetch('/api/v1/medications'),
        fetch(`/api/v1/medications/doses?from=${dateKey(historyStart)}&to=${dateKey(historyEnd)}`),
        fetch(`/api/v1/analytics/activity?period=${analyticsPeriod}`),
        fetch(
          `/api/v1/schedule?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(new Date(now.getTime() + 90 * 86_400_000).toISOString())}`,
        ),
        fetch('/api/v1/equipment/status'),
        fetch('/api/v1/equipment/candidates'),
      ]);
      if (activityResponse.ok) {
        const feed = (await activityResponse.json()) as {
          items: ActivityItem[];
          nextCursor: string | null;
        };
        setActivity(feed.items);
        setActivityCursor(feed.nextCursor);
      }
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
      if (analyticsResponse.ok) setAnalytics((await analyticsResponse.json()) as ActivitySummary);
      if (scheduleResponse.ok) setSchedule((await scheduleResponse.json()) as ScheduleItem[]);
      if (equipmentStatusResponse.ok)
        setEquipmentStatus((await equipmentStatusResponse.json()) as EquipmentStatus);
      if (equipmentCandidatesResponse.ok)
        setEquipmentCandidates((await equipmentCandidatesResponse.json()) as EquipmentCandidate[]);
      setAuthRequired(false);
      setDataError(false);
    } catch {
      setDataError(true);
    }
  }, [analyticsPeriod]);

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
    events.onmessage = refresh;
    return () => events.close();
  }, [authRequired, passwordChangeRequired, entryState, refresh]);

  const isLearning = overview?.reassurance === 'LEARNING';
  const statusTitle =
    overview?.reassurance === 'ATTENTION'
      ? t.attention
      : overview?.reassurance === 'INSUFFICIENT_DATA'
        ? t.insufficient
        : isLearning
          ? t.learning
          : t.normal;
  const statusDetail =
    overview?.reassurance === 'ATTENTION'
      ? t.attentionDetail
      : overview?.reassurance === 'INSUFFICIENT_DATA'
        ? t.insufficientDetail
        : isLearning
          ? t.learningDetail
          : t.normalDetail;
  const currentAlert = [...alerts]
    .filter((alert) => ['OPEN', 'ACKNOWLEDGED'].includes(alert.status))
    .sort((left, right) => {
      const priority = { URGENT: 0, ATTENTION: 1, INFO: 2 } as const;
      return priority[left.severity] - priority[right.severity];
    })[0];
  const filteredActivity = activity.filter((item) => {
    const room = item.sensor?.room?.name ?? item.room ?? 'Maison';
    return (
      (!activityDay || dateKey(new Date(item.occurredAt)) === activityDay) &&
      (!activityRoom || room === activityRoom) &&
      (!activityType || item.capability === activityType)
    );
  });
  const filteredAlerts = alerts.filter(
    (alert) => alertFilter === 'ALL' || alert.status === alertFilter,
  );

  const transitionAlert = async (
    alertId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED',
  ) => {
    const response = await fetch(`/api/v1/alerts/${alertId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (response.ok) await refresh();
  };
  const loadMoreActivity = async () => {
    if (!activityCursor) return;
    setLoadingMoreActivity(true);
    const response = await fetch(
      `/api/v1/activity/feed?limit=30&cursor=${encodeURIComponent(activityCursor)}`,
    );
    if (response.ok) {
      const feed = (await response.json()) as {
        items: ActivityItem[];
        nextCursor: string | null;
      };
      setActivity((current) => [
        ...current,
        ...feed.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setActivityCursor(feed.nextCursor);
    }
    setLoadingMoreActivity(false);
  };
  const moveContact = async (contactId: string, direction: -1 | 1) => {
    if (!household) return;
    const contacts = [...household.trustedContacts];
    const current = contacts.findIndex((contact) => contact.id === contactId);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= contacts.length) return;
    [contacts[current], contacts[target]] = [contacts[target]!, contacts[current]!];
    const response = await fetch('/api/v1/household/contacts/priorities', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: contacts.map((contact) => contact.id) }),
    });
    if (response.ok) await refresh();
  };
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
  const addContactAfterSetup = async (event: FormEvent) => {
    event.preventDefault();
    setContactError('');
    if (
      !contactDraft.firstName ||
      !contactDraft.lastName ||
      (!contactDraft.phone && !contactDraft.email)
    ) {
      setContactError(
        locale === 'fr'
          ? 'Indiquez le nom et au moins un moyen de contact.'
          : 'Enter a name and at least one contact method.',
      );
      return;
    }
    if (
      contactDraft.role === 'administrateur' &&
      (contactDraft.temporaryPassword.length < 12 ||
        contactDraft.temporaryPassword !== contactDraft.confirmation ||
        !contactDraft.username)
    ) {
      setContactError(
        locale === 'fr'
          ? 'L’administrateur a besoin d’un identifiant et d’un mot de passe temporaire confirmé de 12 caractères.'
          : 'The administrator needs a username and a confirmed 12-character temporary password.',
      );
      return;
    }
    const response = await fetch('/api/v1/household/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `contact-${Date.now()}`,
        firstName: contactDraft.firstName,
        lastName: contactDraft.lastName,
        phone: contactDraft.phone,
        email: contactDraft.email,
        relation: contactDraft.relation,
        role: contactDraft.role,
        username: contactDraft.role === 'administrateur' ? contactDraft.username : undefined,
        temporaryPassword:
          contactDraft.role === 'administrateur' ? contactDraft.temporaryPassword : undefined,
      }),
    });
    if (!response.ok) {
      setContactError(
        locale === 'fr'
          ? 'Ce proche n’a pas pu être ajouté. Vérifiez notamment que l’identifiant est unique.'
          : 'This contact could not be added. Check that the username is unique.',
      );
      return;
    }
    setContactDraft({
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      relation: '',
      role: 'proche',
      username: '',
      temporaryPassword: '',
      confirmation: '',
    });
    await refresh();
  };
  const assignSensor = async (sensorId: string, roomId: string | null) => {
    const response = await fetch(`/api/v1/household/sensors/${sensorId}/room`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId }),
    });
    if (response.ok) await refresh();
  };
  const syncEquipment = async () => {
    setEquipmentNotice(locale === 'fr' ? 'Synchronisation demandée…' : 'Sync requested…');
    const response = await fetch('/api/v1/equipment/sync', { method: 'POST' });
    setEquipmentNotice(
      response.ok
        ? locale === 'fr'
          ? 'Home Assistant actualise maintenant l’inventaire.'
          : 'Home Assistant is refreshing the inventory.'
        : locale === 'fr'
          ? 'La synchronisation n’a pas pu démarrer.'
          : 'Sync could not be started.',
    );
    if (response.ok) window.setTimeout(() => void refresh(), 1_500);
  };
  const togglePairing = async () => {
    const activePairing = equipmentStatus?.pairing.active;
    const response = await fetch(
      '/api/v1/equipment/pairing-sessions' + (activePairing ? '/current' : ''),
      {
        method: activePairing ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(activePairing ? {} : { body: JSON.stringify({ durationSeconds: 180 }) }),
      },
    );
    if (response.ok) await refresh();
  };
  const mapEquipment = async (entityId: string, capability: string, transform: string) => {
    const response = await fetch(
      `/api/v1/equipment/entities/${encodeURIComponent(entityId)}/mapping`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capability, transform, enabled: true }),
      },
    );
    if (response.ok) {
      setEquipmentNotice(locale === 'fr' ? 'Correspondance enregistrée.' : 'Mapping saved.');
      await refresh();
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
  const learningProgress = useMemo(
    () => Math.min(100, ((overview?.learningDays ?? 0) / 14) * 100),
    [overview?.learningDays],
  );

  const resident = household?.residents.find((item) => item.primary) ?? household?.residents[0];
  const configuredSensors = [
    ...(household?.unassignedSensors.map((sensor) => ({
      ...sensor,
      roomId: null,
    })) ?? []),
    ...(household?.rooms.flatMap((room) =>
      room.sensors.map((sensor) => ({ ...sensor, roomId: room.id, roomName: room.name })),
    ) ?? []),
  ];
  const lowBatterySensors = configuredSensors.filter((sensor) => {
    if (sensor.capability !== 'battery') return false;
    const value = Number(sensor.lastValue?.value);
    return Number.isFinite(value) && value <= (alertRules?.lowBattery.percent ?? 15);
  }).length;
  const managerName = overview?.currentUser?.displayName ?? '';
  const managerInitials = managerName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const residentName = overview?.resident?.preferredName ?? overview?.home?.resident ?? '';
  const homeDose = [...medicationDoses]
    .filter((dose) =>
      dose.status === 'MISSED'
        ? true
        : dose.status === 'PENDING' && new Date(dose.scheduledFor).getTime() >= Date.now(),
    )
    .sort((left, right) => {
      if (left.status === 'MISSED' && right.status !== 'MISSED') return -1;
      if (right.status === 'MISSED' && left.status !== 'MISSED') return 1;
      return new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime();
    })[0];
  const nextScheduleItem = schedule[0] ?? overview?.nextSchedule;

  if (entryState === 'loading') {
    return (
      <main className="boot-screen">
        <span className="boot-mark">
          <Home />
        </span>
        <b>Élise</b>
        <i />
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
          <Home />
        </span>
        <h1>Élise est momentanément inaccessible</h1>
        <p>Vérifiez que le service local est démarré, puis réessayez.</p>
        <Button onClick={() => void refresh()}>Réessayer</Button>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="boot-screen">
        <span className="boot-mark">
          <Home />
        </span>
        <b>Élise</b>
        <i />
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Home size={23} strokeWidth={1.8} />
          </div>
          <span>Élise</span>
        </div>
        <button
          className="mobile-close"
          onClick={() => setMenuOpen(false)}
          aria-label="Fermer le menu"
        >
          <X />
        </button>
        <nav aria-label="Navigation principale">
          {t.nav.map((label, index) => {
            const Icon = navIcons[index]!;
            return (
              <button
                key={label}
                className={active === index ? 'nav-item nav-item--active' : 'nav-item'}
                onClick={() => {
                  setActive(index);
                  setMenuOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
                {index === 2 && <b>{overview.openAlerts ?? 0}</b>}
              </button>
            );
          })}
        </nav>
        <div className="caregiver">
          <div className="avatar">{managerInitials || '—'}</div>
          <div>
            <strong>{managerName}</strong>
            <span>{locale === 'fr' ? 'Aidant principal' : 'Primary caregiver'}</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu />
          </button>
          <div>
            <span className="eyebrow">{overview.home?.name ?? 'Élise OS'}</span>
            <h1>
              {locale === 'fr'
                ? `Bonjour ${overview.currentUser?.firstName ?? ''},`
                : `Hello ${overview.currentUser?.firstName ?? ''},`}
              <br />
              <em>
                {locale === 'fr'
                  ? `Élise veille sur ${residentName}.`
                  : `Élise is watching over ${residentName}.`}
              </em>
            </h1>
          </div>
          <div className="top-actions">
            <StatusPill>{t.local}</StatusPill>
          </div>
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
          <section className="section-view activity-insights-page">
            <div className="page-heading activity-page-heading">
              <div>
                <span className="eyebrow">
                  {locale === 'fr' ? 'Lecture du quotidien' : 'Daily overview'}
                </span>
                <h2>{t.nav[1]}</h2>
                <p>
                  {locale === 'fr'
                    ? 'Une synthèse factuelle des événements reçus par les capteurs.'
                    : 'A factual summary of events received from the sensors.'}
                </p>
              </div>
              <div className="period-switch" role="group" aria-label="Période d’analyse">
                {(['24h', '7d'] as const).map((period) => (
                  <button
                    type="button"
                    key={period}
                    aria-pressed={analyticsPeriod === period}
                    onClick={() => setAnalyticsPeriod(period)}
                  >
                    {period === '24h' ? '24 h' : '7 jours'}
                  </button>
                ))}
              </div>
            </div>

            <div className="analytics-grid">
              <Card className="activity-chart-card">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      {locale === 'fr' ? 'Rythme observé' : 'Observed rhythm'}
                    </span>
                    <h2>
                      {analytics?.total ?? 0}{' '}
                      {locale === 'fr' ? 'événements utiles' : 'useful events'}
                    </h2>
                  </div>
                  <StatusPill>{analyticsPeriod === '24h' ? '24 h' : '7 j'}</StatusPill>
                </div>
                <div className="activity-bars" aria-label="Répartition des événements">
                  {analytics?.buckets.map((bucket) => {
                    const maximum = Math.max(1, ...analytics.buckets.map((item) => item.count));
                    return (
                      <div key={bucket.start}>
                        <span
                          style={{ height: `${Math.max(4, (bucket.count / maximum) * 100)}%` }}
                          title={`${bucket.label} · ${bucket.count}`}
                        />
                        <small>{bucket.label}</small>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <Card className="deterministic-summary-card">
                <span className="eyebrow">{locale === 'fr' ? 'En bref' : 'At a glance'}</span>
                <h2>{locale === 'fr' ? 'Ce qu’il faut retenir' : 'What matters'}</h2>
                <p>
                  {analytics?.total
                    ? locale === 'fr'
                      ? `${analytics.total} événements utiles ont été reçus. ${analytics.byRoom[0]?.name ?? 'Le domicile'} concentre le plus d’activité. ${overview.sensors?.offline ? `${overview.sensors.offline} capteur(s) ne répond(ent) plus.` : 'La couverture capteurs ne signale pas de coupure.'}`
                      : `${analytics.total} useful events were received. ${analytics.byRoom[0]?.name ?? 'The home'} has the most activity. ${overview.sensors?.offline ? `${overview.sensors.offline} sensor(s) are not responding.` : 'Sensor coverage shows no outage.'}`
                    : locale === 'fr'
                      ? 'Aucun événement utile sur cette période. Vérifiez la couverture avant toute conclusion.'
                      : 'No useful event in this period. Check sensor coverage before drawing a conclusion.'}
                </p>
                <div className="analytics-breakdown">
                  {analytics?.byRoom.slice(0, 3).map((room) => (
                    <span key={room.id ?? room.name}>
                      <strong>{room.count}</strong> {room.name}
                    </span>
                  ))}
                  {analytics?.byCapability.slice(0, 3).map((item) => (
                    <span key={item.capability}>
                      <strong>{item.count}</strong> {capabilityLabel(item.capability, locale)}
                    </span>
                  ))}
                </div>
                <small>
                  {locale === 'fr'
                    ? 'Résumé produit par des règles locales déterministes.'
                    : 'Summary produced by deterministic local rules.'}
                </small>
              </Card>
            </div>

            <Card className="timeline-card activity-page">
              <div className="section-heading timeline-heading">
                <div>
                  <span className="eyebrow">Timeline</span>
                  <h2>{locale === 'fr' ? 'Événements du domicile' : 'Home events'}</h2>
                </div>
                <div className="activity-filters">
                  <label>
                    <span>{locale === 'fr' ? 'Jour' : 'Day'}</span>
                    <input
                      type="date"
                      value={activityDay}
                      onChange={(event) => setActivityDay(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>{locale === 'fr' ? 'Pièce' : 'Room'}</span>
                    <select
                      value={activityRoom}
                      onChange={(event) => setActivityRoom(event.target.value)}
                    >
                      <option value="">{locale === 'fr' ? 'Toutes' : 'All'}</option>
                      {household?.rooms.map((room) => (
                        <option key={room.id} value={room.name}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{locale === 'fr' ? 'Type' : 'Type'}</span>
                    <select
                      value={activityType}
                      onChange={(event) => setActivityType(event.target.value)}
                    >
                      <option value="">{locale === 'fr' ? 'Tous' : 'All'}</option>
                      {[
                        'motion',
                        'occupancy',
                        'contact',
                        'temperature',
                        'humidity',
                        'battery',
                        'power',
                        'energy',
                        'button',
                      ].map((capability) => (
                        <option key={capability} value={capability}>
                          {capabilityLabel(capability, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="timeline">
                {filteredActivity.map((item) => (
                  <div className="timeline-item" key={item.id}>
                    <time>{time(item.occurredAt)}</time>
                    <i></i>
                    <div>
                      <strong>{item.sensor?.room?.name ?? item.room ?? 'Maison'}</strong>
                      <span>{activityDescription(item, locale)}</span>
                      <small>{relativeTime(item.occurredAt, locale)}</small>
                    </div>
                  </div>
                ))}
                {filteredActivity.length === 0 && (
                  <p className="empty-state">
                    {locale === 'fr'
                      ? 'Aucun événement ne correspond à ces filtres.'
                      : 'No event matches these filters.'}
                  </p>
                )}
              </div>
              {activityCursor && (
                <Button
                  className="button-secondary load-more-button"
                  disabled={loadingMoreActivity}
                  onClick={() => void loadMoreActivity()}
                >
                  {loadingMoreActivity
                    ? locale === 'fr'
                      ? 'Chargement…'
                      : 'Loading…'
                    : locale === 'fr'
                      ? 'Afficher les événements précédents'
                      : 'Show earlier events'}
                </Button>
              )}
            </Card>
          </section>
        ) : active === 2 ? (
          <section className="section-view">
            <div className="page-heading alert-page-heading">
              <div>
                <span className="eyebrow">{overview.home?.name}</span>
                <h2>{t.nav[2]}</h2>
                <p>
                  {locale === 'fr'
                    ? 'Chaque situation conserve sa chronologie et l’action décidée.'
                    : 'Each situation keeps its timeline and the action taken.'}
                </p>
              </div>
              <div className="alert-filter" role="group" aria-label="Filtrer les alertes">
                {(['ALL', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const).map((status) => (
                  <button
                    type="button"
                    key={status}
                    aria-pressed={alertFilter === status}
                    onClick={() => setAlertFilter(status)}
                  >
                    {status === 'ALL'
                      ? locale === 'fr'
                        ? 'Toutes'
                        : 'All'
                      : alertStatusLabel(status, locale)}
                  </button>
                ))}
              </div>
            </div>
            <div className="alert-list">
              {filteredAlerts.length === 0 ? (
                <Card className="calm-card">
                  <CircleCheck />
                  <div>
                    <h2>
                      {alertFilter === 'ALL'
                        ? t.normal
                        : locale === 'fr'
                          ? 'Aucun résultat'
                          : 'No result'}
                    </h2>
                    <p>
                      {alertFilter === 'ALL'
                        ? t.noAlert
                        : locale === 'fr'
                          ? 'Aucune alerte ne correspond à ce statut.'
                          : 'No alert matches this status.'}
                    </p>
                  </div>
                </Card>
              ) : (
                filteredAlerts.map((alert) => (
                  <Card className="alert-list-card" key={alert.id}>
                    <div className="alert-card-content">
                      <div className="alert-pill-row">
                        <StatusPill tone={alert.severity === 'URGENT' ? 'urgent' : 'attention'}>
                          {alertSeverityLabel(alert.severity, locale)}
                        </StatusPill>
                        <StatusPill>{alertStatusLabel(alert.status, locale)}</StatusPill>
                      </div>
                      <h2>{alert.title}</h2>
                      <p>{alert.explanation}</p>
                      <small>{relativeTime(alert.openedAt, locale)}</small>
                      {alert.transitions && alert.transitions.length > 0 && (
                        <details className="alert-history">
                          <summary>
                            {locale === 'fr' ? 'Voir la chronologie' : 'View timeline'}
                          </summary>
                          <ol>
                            <li>
                              <time>{time(alert.openedAt)}</time>
                              <span>{locale === 'fr' ? 'Alerte ouverte' : 'Alert opened'}</span>
                            </li>
                            {alert.transitions.map((transition) => (
                              <li key={transition.id}>
                                <time>{time(transition.createdAt)}</time>
                                <span>
                                  {alertStatusLabel(transition.to as AlertItem['status'], locale)}
                                  {transition.note ? ` · ${transition.note}` : ''}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                    {(alert.status === 'OPEN' || alert.status === 'ACKNOWLEDGED') && (
                      <div className="alert-actions">
                        {alert.status === 'OPEN' && (
                          <Button onClick={() => void transitionAlert(alert.id, 'ACKNOWLEDGED')}>
                            {locale === 'fr' ? 'Prendre en charge' : 'Acknowledge'}
                          </Button>
                        )}
                        <Button
                          className="button-secondary"
                          onClick={() => void transitionAlert(alert.id, 'RESOLVED')}
                        >
                          {locale === 'fr' ? 'Résoudre' : 'Resolve'}
                        </Button>
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          </section>
        ) : active === 3 ? (
          <section className="section-view">
            <div className="page-heading">
              <span className="eyebrow">{overview.home?.name}</span>
              <h2>{t.nav[3]}</h2>
            </div>
            <Card className="rooms-card rooms-page">
              <div className="room-grid">
                {overview.rooms?.map((room) => {
                  const Icon = roomIcons[room.kind] ?? Home;
                  return (
                    <div key={room.id} className="room">
                      <Icon />
                      <span>
                        <strong>{room.name}</strong>
                        <small>
                          {room.sensors} {locale === 'fr' ? 'capteurs' : 'sensors'}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        ) : active === 4 ? (
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
        ) : active === 5 ? (
          <section className="section-view">
            <div className="page-heading">
              <span className="eyebrow">{overview.home?.name}</span>
              <h2>{t.nav[5]}</h2>
            </div>
            <Card className="journal-card journal-page">
              {journal.length === 0 ? (
                <p>{locale === 'fr' ? 'Le journal est encore vide.' : 'The journal is empty.'}</p>
              ) : (
                journal.map((entry) => (
                  <article className="journal-entry" key={entry.id}>
                    <time>{new Date(entry.occurredAt).toLocaleDateString(locale)}</time>
                    <h2>{entry.title}</h2>
                    {entry.body && <p>{entry.body}</p>}
                  </article>
                ))
              )}
            </Card>
          </section>
        ) : active === 6 ? (
          <section className="section-view">
            <div className="page-heading">
              <span className="eyebrow">{residentName}</span>
              <h2>{t.nav[6]}</h2>
              <p>
                {locale === 'fr'
                  ? 'Les personnes enregistrées localement, classées selon leur priorité de contact.'
                  : 'People stored locally, ordered by contact priority.'}
              </p>
            </div>
            <div className="contact-grid">
              {household?.trustedContacts.map((contact, index) => (
                <Card className="contact-card" key={contact.id}>
                  <div className="contact-priority">{contact.priority + 1}</div>
                  <div>
                    <StatusPill>
                      {contact.role === 'ADMINISTRATOR'
                        ? locale === 'fr'
                          ? 'Administrateur'
                          : 'Administrator'
                        : contact.role === 'EMERGENCY'
                          ? locale === 'fr'
                            ? 'Urgence'
                            : 'Emergency'
                          : locale === 'fr'
                            ? 'Proche'
                            : 'Relative'}
                    </StatusPill>
                    <h2>
                      {contact.firstName} {contact.lastName}
                    </h2>
                    <p>
                      {contact.relation ||
                        (locale === 'fr' ? 'Lien non précisé' : 'Relationship not specified')}
                    </p>
                    {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
                    {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                    {contact.hasAccount && (
                      <small>
                        {locale === 'fr' ? 'Compte associé' : 'Linked account'} :{' '}
                        {contact.username ?? '—'}
                      </small>
                    )}
                    <div className="contact-order-actions">
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label="Monter dans la priorité"
                        onClick={() => void moveContact(contact.id, -1)}
                      >
                        <ArrowUp />
                      </button>
                      <button
                        type="button"
                        disabled={index === household.trustedContacts.length - 1}
                        aria-label="Descendre dans la priorité"
                        onClick={() => void moveContact(contact.id, 1)}
                      >
                        <ArrowDown />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
              {household?.trustedContacts.length === 0 && (
                <Card>
                  <p>
                    {locale === 'fr'
                      ? 'Aucun proche supplémentaire n’a été ajouté.'
                      : 'No additional contact has been added.'}
                  </p>
                </Card>
              )}
            </div>
          </section>
        ) : active === 8 ? (
          <section className="section-view resident-page">
            <div className="page-heading">
              <span className="eyebrow">
                {locale === 'fr' ? 'Profil d’accompagnement' : 'Support profile'}
              </span>
              <h2>{resident?.displayName ?? residentName}</h2>
              <p>
                {locale === 'fr'
                  ? 'Toutes les informations utiles enregistrées pendant l’installation.'
                  : 'All useful information recorded during setup.'}
              </p>
            </div>
            {resident && (
              <div className="resident-detail-grid">
                <Card className="resident-identity-card">
                  {resident.photoUrl ? (
                    <img src={resident.photoUrl} alt="" />
                  ) : (
                    <div className="resident-photo-fallback">
                      {(resident.preferredName ?? resident.firstName ?? '?')[0]}
                    </div>
                  )}
                  <div>
                    <span className="eyebrow">{locale === 'fr' ? 'Identité' : 'Identity'}</span>
                    <h2>
                      {resident.firstName} {resident.lastName}
                    </h2>
                    <p>
                      {locale === 'fr' ? 'Prénom utilisé' : 'Preferred name'} :{' '}
                      {resident.preferredName || '—'}
                    </p>
                    <p>
                      {locale === 'fr' ? 'Appellation' : 'Form of address'} :{' '}
                      {resident.formOfAddress || '—'}
                    </p>
                    <p>
                      {locale === 'fr' ? 'Date de naissance' : 'Birth date'} :{' '}
                      {resident.birthDate
                        ? new Date(resident.birthDate).toLocaleDateString(locale)
                        : '—'}
                    </p>
                    <p>
                      {locale === 'fr' ? 'Langue parlée' : 'Spoken language'} :{' '}
                      {resident.spokenLanguage}
                    </p>
                    <div className="resident-photo-actions">
                      <label className="button button-secondary">
                        {locale === 'fr' ? 'Remplacer la photo' : 'Replace photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void replaceResidentPhoto(file);
                          }}
                        />
                      </label>
                      {resident.photoUrl && (
                        <Button
                          className="button-secondary"
                          onClick={() => void removeResidentPhoto()}
                        >
                          {locale === 'fr' ? 'Supprimer la photo' : 'Remove photo'}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
                <Card>
                  <span className="eyebrow">
                    {locale === 'fr' ? 'Situation de vie' : 'Living context'}
                  </span>
                  <h2>{locale === 'fr' ? 'Repères du quotidien' : 'Daily context'}</h2>
                  {resident.context ? (
                    <ul className="detail-list">
                      <li>
                        {resident.context.livesAlone
                          ? locale === 'fr'
                            ? 'Vit seul(e)'
                            : 'Lives alone'
                          : locale === 'fr'
                            ? 'Ne vit pas seul(e)'
                            : 'Does not live alone'}
                      </li>
                      {resident.context.livesWithPartner && (
                        <li>
                          {locale === 'fr' ? 'Vit avec son conjoint' : 'Lives with a partner'}
                        </li>
                      )}
                      {resident.context.livesWithRelative && (
                        <li>{locale === 'fr' ? 'Vit avec un proche' : 'Lives with a relative'}</li>
                      )}
                      {resident.context.receivesHomeHelp && (
                        <li>
                          {locale === 'fr' ? 'Reçoit une aide à domicile' : 'Receives home help'}
                        </li>
                      )}
                      {resident.context.receivesVisits && (
                        <li>
                          {locale === 'fr'
                            ? 'Reçoit des visites régulières'
                            : 'Receives regular visits'}
                        </li>
                      )}
                      {resident.context.hasPet && (
                        <li>{locale === 'fr' ? 'Possède un animal' : 'Has a pet'}</li>
                      )}
                      <li>
                        {locale === 'fr' ? 'Mobilité' : 'Mobility'} : {resident.context.mobility}
                      </li>
                      {resident.context.visualDifficulty && (
                        <li>{locale === 'fr' ? 'Difficulté visuelle' : 'Visual difficulty'}</li>
                      )}
                      {resident.context.hearingDifficulty && (
                        <li>{locale === 'fr' ? 'Difficulté auditive' : 'Hearing difficulty'}</li>
                      )}
                    </ul>
                  ) : (
                    <p>—</p>
                  )}
                </Card>
                <Card>
                  <span className="eyebrow">{locale === 'fr' ? 'Accompagnement' : 'Support'}</span>
                  <h2>{locale === 'fr' ? 'Informations importantes' : 'Important information'}</h2>
                  {resident.supportNeeds.length ? (
                    <ul className="detail-list">
                      {resident.supportNeeds.map((need) => (
                        <li key={need.id}>
                          {need.kind}
                          {need.note ? ` — ${need.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      {locale === 'fr'
                        ? 'Aucun besoin particulier indiqué.'
                        : 'No particular support need recorded.'}
                    </p>
                  )}
                </Card>
                <Card>
                  <span className="eyebrow">{locale === 'fr' ? 'Habitudes' : 'Habits'}</span>
                  <h2>{locale === 'fr' ? 'Repères enregistrés' : 'Recorded routines'}</h2>
                  {resident.habits.length ? (
                    <ul className="detail-list">
                      {resident.habits.map((habit) => (
                        <li key={habit.id}>
                          {habit.kind} —{' '}
                          {habit.status === 'UNKNOWN'
                            ? locale === 'fr'
                              ? 'À apprendre'
                              : 'To learn'
                            : `${formatMinute(habit.startMinute)} – ${formatMinute(habit.endMinute)}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      {locale === 'fr'
                        ? 'Élise apprendra progressivement les habitudes.'
                        : 'Élise will learn routines progressively.'}
                    </p>
                  )}
                </Card>
              </div>
            )}
            <Button className="button-secondary" onClick={() => setActive(0)}>
              {t.nav[0]}
            </Button>
          </section>
        ) : active === 7 ? (
          <section className="section-view settings-page">
            <div className="page-heading">
              <span className="eyebrow">Élise OS</span>
              <h2>{t.nav[7]}</h2>
            </div>
            <Card className="settings-card">
              <div className="settings-card-heading">
                <span className="settings-icon">
                  <Settings />
                </span>
                <div>
                  <h2>{locale === 'fr' ? 'Langue de l’interface' : 'Interface language'}</h2>
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
                  <span>FR</span>
                  <strong>Français</strong>
                  {locale === 'fr' && <CircleCheck />}
                </button>
                <button
                  className={locale === 'en' ? 'is-selected' : ''}
                  onClick={() => changeLocale('en')}
                  aria-pressed={locale === 'en'}
                >
                  <span>EN</span>
                  <strong>English</strong>
                  {locale === 'en' && <CircleCheck />}
                </button>
              </div>
            </Card>
            {household && (
              <Card className="settings-card">
                <div className="settings-card-heading">
                  <span className="settings-icon">
                    <Home />
                  </span>
                  <div>
                    <h2>{household.home.name}</h2>
                    <p>
                      {household.home.type} · {household.home.floorCount}{' '}
                      {locale === 'fr' ? 'niveau(x)' : 'floor(s)'} · {household.home.timezone}
                    </p>
                    {household.home.address && <p>{household.home.address}</p>}
                  </div>
                </div>
              </Card>
            )}
            {household && (
              <Card className="settings-card">
                <div className="settings-card-heading">
                  <span className="settings-icon">
                    <Radar />
                  </span>
                  <div>
                    <h2>{locale === 'fr' ? 'Équipements réels' : 'Real equipment'}</h2>
                    <p>
                      {locale === 'fr'
                        ? 'Tous les équipements exposés par Home Assistant sont reconnus, quel que soit leur protocole ou leur marque.'
                        : 'Every device exposed by Home Assistant is discovered, regardless of protocol or brand.'}
                    </p>
                  </div>
                </div>
                <div className="equipment-health">
                  <span
                    className={
                      equipmentStatus?.homeAssistant.connected ? 'is-online' : 'is-offline'
                    }
                  >
                    <i />
                    Home Assistant ·{' '}
                    {equipmentStatus?.homeAssistant.connected
                      ? locale === 'fr'
                        ? 'connecté'
                        : 'connected'
                      : locale === 'fr'
                        ? 'hors ligne'
                        : 'offline'}
                  </span>
                  <small>
                    {equipmentStatus
                      ? `${equipmentStatus.inventory.devices} appareil(s) · ${equipmentStatus.inventory.entities} entité(s)`
                      : locale === 'fr'
                        ? 'Inventaire en attente'
                        : 'Waiting for inventory'}
                  </small>
                  <div className="equipment-actions">
                    <Button className="button-secondary" onClick={() => void syncEquipment()}>
                      {locale === 'fr' ? 'Actualiser' : 'Refresh'}
                    </Button>
                    <Button className="button-secondary" onClick={() => void togglePairing()}>
                      {equipmentStatus?.pairing.active
                        ? locale === 'fr'
                          ? 'Arrêter l’association Zigbee'
                          : 'Stop Zigbee pairing'
                        : locale === 'fr'
                          ? 'Associer un appareil Zigbee'
                          : 'Pair a Zigbee device'}
                    </Button>
                  </div>
                  {equipmentNotice && <p className="equipment-notice">{equipmentNotice}</p>}
                </div>
                {equipmentCandidates.length ? (
                  <div className="settings-sensor-list">
                    {equipmentCandidates.map((sensor) => (
                      <div className="equipment-row" key={sensor.id}>
                        <span>
                          <strong>
                            {sensor.sourceName ?? sensor.device?.name ?? sensor.entityId}
                          </strong>
                          <small>
                            {sensor.compatibility === 'UNSUPPORTED'
                              ? locale === 'fr'
                                ? 'À configurer'
                                : 'Needs mapping'
                              : capabilityLabel(sensor.capability, locale)}{' '}
                            ·{' '}
                            {sensor.available
                              ? sensorStatusLabel(sensor.status, locale)
                              : locale === 'fr'
                                ? 'Indisponible'
                                : 'Unavailable'}
                          </small>
                          <small>{sensor.entityId}</small>
                        </span>
                        {sensor.compatibility === 'UNSUPPORTED' ? (
                          <div className="equipment-mapping">
                            <select
                              defaultValue="motion"
                              aria-label="Capacité Élise"
                              id={`cap-${sensor.id}`}
                            >
                              <option value="motion">Mouvement</option>
                              <option value="occupancy">Présence</option>
                              <option value="contact">Ouverture</option>
                              <option value="button">Bouton</option>
                              <option value="temperature">Température</option>
                              <option value="humidity">Humidité</option>
                              <option value="power">Puissance</option>
                              <option value="energy">Énergie</option>
                              <option value="battery">Batterie</option>
                            </select>
                            <Button
                              className="button-secondary"
                              onClick={() => {
                                const select = document.getElementById(
                                  `cap-${sensor.id}`,
                                ) as HTMLSelectElement;
                                const numeric = [
                                  'temperature',
                                  'humidity',
                                  'power',
                                  'energy',
                                  'battery',
                                ].includes(select.value);
                                void mapEquipment(
                                  sensor.entityId,
                                  select.value,
                                  numeric
                                    ? 'NUMERIC'
                                    : select.value === 'contact'
                                      ? 'OPEN_CLOSED'
                                      : select.value === 'button'
                                        ? 'EVENT_ACTION'
                                        : 'ON_OFF',
                                );
                              }}
                            >
                              {locale === 'fr' ? 'Utiliser' : 'Use'}
                            </Button>
                          </div>
                        ) : (
                          <select
                            value={sensor.room?.id ?? ''}
                            onChange={(event) =>
                              void assignSensor(sensor.id, event.target.value || null)
                            }
                          >
                            <option value="">
                              {locale === 'fr' ? 'Sans pièce' : 'Unassigned'}
                            </option>
                            {household.rooms.map((room) => (
                              <option key={room.id} value={room.id}>
                                {room.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">
                    {locale === 'fr'
                      ? 'Aucun équipement réel détecté. L’installation reste pleinement valide.'
                      : 'No real equipment detected. The installation remains valid.'}
                  </p>
                )}
              </Card>
            )}
            {simulationScenarios.length > 0 && (
              <SimulationPanel
                scenarios={simulationScenarios}
                running={runningSimulation}
                notice={simulationNotice}
                onRun={(scenario) => void runSimulation(scenario)}
              />
            )}
            {alertRules && (
              <AlertRulesPanel
                rules={alertRules}
                saving={savingRules}
                notice={ruleNotice}
                onChange={setAlertRules}
                onSave={() => void saveAlertRules()}
              />
            )}
            <Card className="settings-card">
              <div className="settings-card-heading">
                <span className="settings-icon">
                  <UsersRound />
                </span>
                <div>
                  <h2>{locale === 'fr' ? 'Ajouter un proche' : 'Add a contact'}</h2>
                  <p>
                    {locale === 'fr'
                      ? 'Un administrateur reçoit un mot de passe temporaire qu’il devra remplacer à sa première connexion.'
                      : 'An administrator receives a temporary password that must be changed at first sign-in.'}
                  </p>
                </div>
              </div>
              <form
                className="settings-contact-form"
                onSubmit={(event) => void addContactAfterSetup(event)}
              >
                <label>
                  {locale === 'fr' ? 'Prénom' : 'First name'}
                  <input
                    value={contactDraft.firstName}
                    onChange={(event) =>
                      setContactDraft((current) => ({ ...current, firstName: event.target.value }))
                    }
                  />
                </label>
                <label>
                  {locale === 'fr' ? 'Nom' : 'Last name'}
                  <input
                    value={contactDraft.lastName}
                    onChange={(event) =>
                      setContactDraft((current) => ({ ...current, lastName: event.target.value }))
                    }
                  />
                </label>
                <label>
                  {locale === 'fr' ? 'Téléphone' : 'Phone'}
                  <input
                    type="tel"
                    value={contactDraft.phone}
                    onChange={(event) =>
                      setContactDraft((current) => ({ ...current, phone: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={contactDraft.email}
                    onChange={(event) =>
                      setContactDraft((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </label>
                <label>
                  {locale === 'fr' ? 'Lien avec le résident' : 'Relationship'}
                  <input
                    value={contactDraft.relation}
                    onChange={(event) =>
                      setContactDraft((current) => ({ ...current, relation: event.target.value }))
                    }
                  />
                </label>
                <label>
                  {locale === 'fr' ? 'Rôle' : 'Role'}
                  <select
                    value={contactDraft.role}
                    onChange={(event) =>
                      setContactDraft((current) => ({
                        ...current,
                        role: event.target.value as typeof current.role,
                      }))
                    }
                  >
                    <option value="proche">{locale === 'fr' ? 'Proche' : 'Relative'}</option>
                    <option value="urgence">
                      {locale === 'fr' ? 'Contact d’urgence' : 'Emergency contact'}
                    </option>
                    <option value="administrateur">
                      {locale === 'fr' ? 'Administrateur' : 'Administrator'}
                    </option>
                  </select>
                </label>
                {contactDraft.role === 'administrateur' && (
                  <>
                    <label>
                      {locale === 'fr' ? 'Identifiant' : 'Username'}
                      <input
                        autoComplete="off"
                        value={contactDraft.username}
                        onChange={(event) =>
                          setContactDraft((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      {locale === 'fr' ? 'Mot de passe temporaire' : 'Temporary password'}
                      <input
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        value={contactDraft.temporaryPassword}
                        onChange={(event) =>
                          setContactDraft((current) => ({
                            ...current,
                            temporaryPassword: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      {locale === 'fr' ? 'Confirmer' : 'Confirm'}
                      <input
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        value={contactDraft.confirmation}
                        onChange={(event) =>
                          setContactDraft((current) => ({
                            ...current,
                            confirmation: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                )}
                {contactError && <p className="form-error">{contactError}</p>}
                <Button type="submit">
                  {locale === 'fr' ? 'Ajouter ce proche' : 'Add contact'}
                </Button>
              </form>
            </Card>
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
          <>
            <section className="hero-grid">
              <Card className="reassurance-card">
                <div className="reassurance-icon">
                  <CircleCheck size={27} />
                </div>
                <div>
                  <StatusPill
                    tone={
                      overview.reassurance === 'ATTENTION' ||
                      overview.reassurance === 'INSUFFICIENT_DATA'
                        ? 'attention'
                        : 'neutral'
                    }
                  >
                    {isLearning
                      ? `${overview.learningDays ?? 0}/14`
                      : locale === 'fr'
                        ? 'Situation actuelle'
                        : 'Current status'}
                  </StatusPill>
                  <h2>{statusTitle}</h2>
                  <p>{statusDetail}</p>
                  {isLearning && (
                    <>
                      <Progress.Root className="progress-root" value={learningProgress}>
                        <Progress.Indicator
                          className="progress-indicator"
                          style={{ transform: `translateX(-${100 - learningProgress}%)` }}
                        />
                      </Progress.Root>
                      <small>
                        {t.learningProgress.replace('{day}', String(overview.learningDays ?? 0))}
                      </small>
                    </>
                  )}
                  <Button className="button-secondary" onClick={() => setActive(1)}>
                    {t.allActivity}
                  </Button>
                </div>
              </Card>
              <div className="metrics-stack">
                <Metric
                  label={t.lastActivity}
                  value={
                    <>
                      {overview.lastActivity?.room ?? '—'}
                      <small>
                        {overview.lastActivity
                          ? `${capabilityLabel(overview.lastActivity.capability, locale)} · ${relativeTime(overview.lastActivity.occurredAt, locale)}`
                          : ''}
                      </small>
                    </>
                  }
                  icon={<CookingPot />}
                />
                <Metric
                  label={locale === 'fr' ? 'Couverture capteurs' : 'Sensor coverage'}
                  value={
                    <>
                      {overview.sensors?.online ?? 0}/{overview.sensors?.total ?? 0}
                      <small>
                        {[
                          overview.sensors?.offline
                            ? locale === 'fr'
                              ? `${overview.sensors.offline} hors ligne`
                              : `${overview.sensors.offline} offline`
                            : '',
                          lowBatterySensors
                            ? locale === 'fr'
                              ? `${lowBatterySensors} batterie(s) faible(s)`
                              : `${lowBatterySensors} low battery level(s)`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') ||
                          (locale === 'fr' ? 'Couverture disponible' : 'Coverage available')}
                      </small>
                    </>
                  }
                  icon={<Radar />}
                />
              </div>
            </section>

            <section className="essentials-section">
              <Card className="essentials-card">
                <article className={homeDose?.status === 'MISSED' ? 'needs-attention' : ''}>
                  <span className="essential-icon">
                    <Pill />
                  </span>
                  <div>
                    <span className="eyebrow">
                      {homeDose?.status === 'MISSED'
                        ? locale === 'fr'
                          ? 'Prise à vérifier'
                          : 'Dose to check'
                        : locale === 'fr'
                          ? 'Prochaine prise'
                          : 'Next dose'}
                    </span>
                    <h2>
                      {homeDose
                        ? `${time(homeDose.scheduledFor)} · ${homeDose.schedule.medication.name}`
                        : locale === 'fr'
                          ? 'Aucune prise à venir'
                          : 'No upcoming dose'}
                    </h2>
                    <p>
                      {homeDose
                        ? homeDose.status === 'MISSED'
                          ? locale === 'fr'
                            ? 'Confirmation non reçue ; un oubli est possible.'
                            : 'No confirmation received; it may have been forgotten.'
                          : homeDose.schedule.medication.dosage
                        : locale === 'fr'
                          ? 'Le pilulier est à jour pour aujourd’hui.'
                          : 'The pillbox is up to date today.'}
                    </p>
                  </div>
                  <button type="button" onClick={() => setActive(4)}>
                    {locale === 'fr' ? 'Voir' : 'View'} <ChevronRight />
                  </button>
                </article>
                <article className={currentAlert ? 'needs-attention' : ''}>
                  <span className="essential-icon">
                    <Bell />
                  </span>
                  <div>
                    <span className="eyebrow">
                      {locale === 'fr' ? 'Action immédiate' : 'Immediate action'}
                    </span>
                    <h2>{currentAlert?.title ?? t.noAlert}</h2>
                    <p>
                      {currentAlert
                        ? alertSeverityLabel(currentAlert.severity, locale)
                        : locale === 'fr'
                          ? 'Aucune situation ouverte.'
                          : 'No open situation.'}
                    </p>
                  </div>
                  <button type="button" onClick={() => setActive(2)}>
                    {locale === 'fr' ? 'Ouvrir' : 'Open'} <ChevronRight />
                  </button>
                </article>
                <article>
                  <span className="essential-icon">
                    <UsersRound />
                  </span>
                  <div>
                    <span className="eyebrow">
                      {locale === 'fr' ? 'Prochaine visite' : 'Next visit'}
                    </span>
                    <h2>
                      {nextScheduleItem?.title ??
                        (locale === 'fr' ? 'Rien de planifié' : 'Nothing scheduled')}
                    </h2>
                    <p>
                      {nextScheduleItem
                        ? new Date(nextScheduleItem.startsAt).toLocaleString(locale, {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : locale === 'fr'
                          ? 'Aucun rendez-vous ou visite à venir.'
                          : 'No upcoming visit or appointment.'}
                    </p>
                  </div>
                </article>
              </Card>
            </section>

            {overview.resident && (
              <section className="resident-summary-section">
                <Card className="resident-summary-card">
                  {overview.resident.photoUrl ? (
                    <img src={overview.resident.photoUrl} alt="" />
                  ) : (
                    <div className="resident-photo-fallback">
                      {overview.resident.preferredName[0]}
                    </div>
                  )}
                  <div>
                    <span className="eyebrow">
                      {locale === 'fr' ? 'Personne accompagnée' : 'Resident'}
                    </span>
                    <h2>{overview.resident.displayName}</h2>
                    <p>
                      {overview.resident.knownHabits}{' '}
                      {locale === 'fr' ? 'habitude(s) connue(s)' : 'known habit(s)'} ·{' '}
                      {overview.resident.supportNeeds.length}{' '}
                      {locale === 'fr' ? 'information(s) importante(s)' : 'important item(s)'}
                    </p>
                  </div>
                  <Button className="button-secondary" onClick={() => setActive(8)}>
                    {locale === 'fr' ? 'Voir la fiche résident' : 'View resident profile'}
                  </Button>
                </Card>
              </section>
            )}

            <section className="content-grid">
              <Card className="timeline-card">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">{locale === 'fr' ? 'Activité' : 'Activity'}</span>
                    <h2>{t.summary}</h2>
                  </div>
                  <StatusPill>{t.today}</StatusPill>
                </div>
                <div className="timeline">
                  {overview.activity?.slice(0, 5).map((item) => (
                    <div className="timeline-item" key={item.id}>
                      <time>{time(item.occurredAt)}</time>
                      <i></i>
                      <div>
                        <strong>{item.room}</strong>
                        <span>{activityDescription(item, locale)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button className="button-secondary" onClick={() => setActive(1)}>
                  {t.allActivity}
                </Button>
              </Card>
              <Card className="rooms-card">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">{locale === 'fr' ? 'Maison' : 'Home'}</span>
                    <h2>{t.rooms}</h2>
                  </div>
                </div>
                <div className="room-grid">
                  {overview.rooms?.map((room) => {
                    const Icon = roomIcons[room.kind] ?? Home;
                    return (
                      <button key={room.id} className="room" onClick={() => setActive(3)}>
                        <Icon />
                        <span>
                          <strong>{room.name}</strong>
                          <small>
                            {room.sensors} {locale === 'fr' ? 'capteurs' : 'sensors'}
                          </small>
                        </span>
                        <ChevronRight />
                      </button>
                    );
                  })}
                </div>
                <Button className="button-secondary" onClick={() => setActive(3)}>
                  {t.allRooms}
                </Button>
              </Card>
            </section>

            <section className="lower-grid">
              {currentAlert ? (
                <Card className="alert-card">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">{t.nav[2]}</span>
                      <h2>{currentAlert.title}</h2>
                    </div>
                    <StatusPill tone={currentAlert.severity === 'URGENT' ? 'urgent' : 'attention'}>
                      {relativeTime(currentAlert.openedAt, locale)}
                    </StatusPill>
                  </div>
                  <p>{currentAlert.explanation}</p>
                  <div className="alert-actions">
                    {currentAlert.status === 'OPEN' && (
                      <Button onClick={() => void transitionAlert(currentAlert.id, 'ACKNOWLEDGED')}>
                        {locale === 'fr' ? 'Prendre en charge' : 'Acknowledge'}
                      </Button>
                    )}
                    <Button
                      className="button-secondary"
                      onClick={() => void transitionAlert(currentAlert.id, 'RESOLVED')}
                    >
                      {locale === 'fr' ? 'Résoudre' : 'Resolve'}
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card className="calm-card">
                  <CircleCheck />
                  <div>
                    <span className="eyebrow">{t.nav[2]}</span>
                    <h2>{t.noAlert}</h2>
                    <p>{t.normalDetail}</p>
                  </div>
                </Card>
              )}
              <Card className="journal-card">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">{locale === 'fr' ? 'Suivi' : 'Follow-up'}</span>
                    <h2>{t.dailyJournal}</h2>
                  </div>
                </div>
                {journal.slice(0, 3).map((entry) => (
                  <button className="journal-row" key={entry.id} onClick={() => setActive(5)}>
                    <span>
                      <strong>{new Date(entry.occurredAt).toLocaleDateString(locale)}</strong>
                      <small>{entry.title}</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </Card>
            </section>
          </>
        )}
        <footer>
          <ShieldCheck />
          <span>
            {locale === 'fr'
              ? 'Aucune caméra. Aucune écoute. Juste l’essentiel.'
              : 'No cameras. No listening. Only what matters.'}
          </span>
          <HeartHandshake />
        </footer>
      </main>
    </div>
  );
}
