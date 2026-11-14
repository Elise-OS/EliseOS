export interface Overview {
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

export interface HouseholdSensor {
  id: string;
  entityId: string;
  capability: string;
  status: string;
  lastSeenAt?: string | null;
  lastValue?: Record<string, unknown> | null;
  device?: { name: string; manufacturer: string | null; model: string | null } | null;
}

export interface Household {
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

export type Person = Household['trustedContacts'][number];
export type AccessRole = Exclude<Person['role'], 'OWNER' | null>;

export interface CurrentAccess {
  role: 'OWNER' | 'ADMINISTRATOR' | 'CAREGIVER' | 'VIEWER';
  capabilities: string[];
}

export interface ActivityItem {
  id: string;
  occurredAt: string;
  capability: string;
  sensor?: { room?: { name: string } | null } | null;
  room?: string;
  payload: unknown;
}

export interface AlertItem {
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

export interface CameraItem {
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

export interface CameraSession {
  cameraId: string;
  mediaUrl: string;
  expiresAt: string;
  talkEnabled: boolean;
}

export interface CameraRecording {
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

export interface JournalItem {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  occurredAt: string;
}

export interface SimulationScenario {
  id: string;
  title: string;
  description: string;
}

export interface AlertRuleSettings {
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

export interface MedicationItem {
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

export interface MedicationDoseItem {
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

export interface MedicationDraft {
  name: string;
  dosage: string;
  instructions: string;
  time: string;
  daysOfWeek: number[];
  graceMinutes: number;
}
