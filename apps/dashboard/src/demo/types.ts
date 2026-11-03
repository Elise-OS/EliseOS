import type { MembershipRole } from '@michel/contracts';

// API shapes used by the demo scenario. They mirror the real endpoints, as typed by the mobile client.

export interface SavedServer {
  id: string;
  instanceId: string;
  instanceName: string;
  version: string;
  apiVersion: 1;
  serverTime: string;
  supportsMobile: true;
  setupRequired: boolean;
  localUrl?: string | null;
  remoteUrl?: string | null;
  url: string;
  urls: string[];
  source: 'mdns' | 'subnet' | 'manual' | 'tailscale';
  lastConnectedAt: string;
}

export interface ActivityItem {
  id: string;
  capability: string;
  quality?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  room?: string;
  sensor?: { entityId: string; room: { id: string; name: string } | null } | null;
}

export interface Overview {
  onboardingRequired: boolean;
  home?: { id: string; name: string; resident: string | null };
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
  activity?: ActivityItem[];
}

export interface CurrentUser {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  phone?: string | null;
  mustChangePassword: boolean;
  role: MembershipRole;
  capabilities: string[];
}

export interface TrustedPerson {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  role: MembershipRole | null;
  isEmergency: boolean;
  priority: number;
  hasAccount: boolean;
  accessDisabled: boolean;
  archived: boolean;
  isCurrentUser: boolean;
  username: string | null;
}

export interface AlertTransition {
  id: string;
  from: AlertItem['status'];
  to: AlertItem['status'];
  note: string | null;
  createdAt: string;
}

export interface AlertItem {
  id: string;
  type: string;
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
  title: string;
  explanation: string;
  confidence?: number | null;
  openedAt: string;
  resolvedAt?: string | null;
  room?: { id: string; name: string } | null;
  lastMovement?: { occurredAt: string; roomName: string | null } | null;
  transitions?: AlertTransition[];
  cameraSnapshots?: Array<{ id: string; cameraId: string; capturedAt: string; expiresAt: string }>;
}

export interface AlertDetail extends AlertItem {
  sensor: { id: string; sourceName: string | null; capability: string; unit: string | null } | null;
  observations: Array<{
    id: string;
    occurredAt: string;
    capability: string;
    quality: string;
    payload: unknown;
  }>;
}

export interface SimulationScenario {
  id: string;
  title: string;
  description: string;
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

export interface JournalItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  occurredAt: string;
}
