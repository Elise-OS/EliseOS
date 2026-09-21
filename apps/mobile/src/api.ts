import type {
  CalendarCreate,
  CalendarPage,
  CalendarUpdate,
  LiaisonCreate,
  LiaisonFilter,
  LiaisonPage,
} from '@michel/contracts';
import type {
  ActivitySummary,
  DashboardPeriod,
  Household,
  HomePlan,
  PresenceEstimate,
  PresenceHistory,
  ScheduleItem,
  SensorDevice,
  SensorOnboardingSession,
  SensorPlacementGuide,
  SensorVerificationSession,
} from '@michel/contracts';
import type { Installation } from '@michel/contracts';
import type { SavedServer } from './discovery/types';
import { preferredServerUrls, rememberActiveServerUrl } from './discovery/helpers';

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

export interface ActivityItem {
  id: string;
  capability: string;
  quality?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  room?: string;
  sensor?: { entityId: string; room: { id: string; name: string } | null } | null;
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
  type: 'INACTIVITY' | 'DOOR_OPEN' | 'SOS' | 'UNUSUAL_ACTIVITY' | 'SYSTEM';
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
  title: string;
  explanation: string;
  confidence?: number | null;
  openedAt: string;
  resolvedAt?: string | null;
  transitions?: AlertTransition[];
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

export interface JournalItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  occurredAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const request = async <T>(
  server: SavedServer,
  path: string,
  token?: string,
  init?: RequestInit,
) => {
  let response: Response | undefined;
  let lastError: unknown;
  for (const baseUrl of preferredServerUrls(server)) {
    try {
      response = await fetch(`${baseUrl}/api/v1${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
      rememberActiveServerUrl(server, baseUrl);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error('Élise is unreachable');
  if (!response.ok) throw new Error(String(response.status));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

const query = (values: Record<string, string | undefined>) => {
  const params = Object.entries(values).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );
  return params.length
    ? `?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
    : '';
};

export const mobileApi = {
  liaison: (server: SavedServer, token: string, filter: LiaisonFilter, cursor?: string) =>
    request<LiaisonPage>(server, `/liaison${query({ filter, cursor })}`, token),
  createLiaison: (server: SavedServer, token: string, input: LiaisonCreate) =>
    request(server, '/liaison', token, { method: 'POST', body: JSON.stringify(input) }),
  completeLiaison: (
    server: SavedServer,
    token: string,
    id: string,
    completed: boolean,
    visit = false,
  ) =>
    request(
      server,
      `/liaison/${visit ? 'visits/' : ''}${encodeURIComponent(id)}/completion`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({ completed }),
      },
    ),
  loginOptions: (server: SavedServer) =>
    request<Array<{ id: string; displayName: string; identifier: string }>>(
      server,
      '/auth/login-options',
    ),
  bootstrap: (
    server: SavedServer,
    input: { displayName: string; password: string; installation: Installation },
  ) =>
    request<{
      accessToken: string;
      user: { displayName: string };
      homeId: string;
      residentId: string;
    }>(server, '/auth/bootstrap', undefined, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  login: (server: SavedServer, identifier: string, password: string) =>
    request<{ accessToken: string; user: { displayName: string } }>(
      server,
      '/auth/mobile-login',
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      },
    ),
  me: (server: SavedServer, token: string) =>
    request<{
      id: string;
      displayName: string;
      username: string | null;
      email: string | null;
      mustChangePassword: boolean;
    }>(server, '/auth/me', token),
  logout: (server: SavedServer, token: string) =>
    request<void>(server, '/auth/logout', token, { method: 'POST' }),
  overview: (server: SavedServer, token: string) => request<Overview>(server, '/overview', token),
  summary: (server: SavedServer, token: string, period: DashboardPeriod) =>
    request<ActivitySummary>(server, `/analytics/activity?period=${period}`, token),
  household: (server: SavedServer, token: string) =>
    request<Household | null>(server, '/household', token),
  homePlan: (server: SavedServer, token: string) =>
    request<HomePlan>(server, '/household/plan', token),
  saveHomePlan: (server: SavedServer, token: string, plan: HomePlan) =>
    request<HomePlan>(server, '/household/plan', token, {
      method: 'PUT',
      body: JSON.stringify(plan),
    }),
  presence: (server: SavedServer, token: string) =>
    request<PresenceEstimate>(server, '/household/presence', token),
  presenceHistory: (server: SavedServer, token: string, cursor?: string) =>
    request<PresenceHistory>(
      server,
      `/household/presence/history${query({ limit: '20', cursor })}`,
      token,
    ),
  schedule: (server: SavedServer, token: string) =>
    request<ScheduleItem[]>(server, '/schedule', token),
  calendar: (server: SavedServer, token: string, from?: string, to?: string) =>
    request<CalendarPage>(server, `/calendar${query({ from, to })}`, token),
  createCalendar: (server: SavedServer, token: string, input: CalendarCreate) =>
    request(server, '/calendar', token, { method: 'POST', body: JSON.stringify(input) }),
  updateCalendar: (server: SavedServer, token: string, id: string, input: CalendarUpdate) =>
    request(server, `/calendar/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteCalendar: (
    server: SavedServer,
    token: string,
    id: string,
    scope: 'ONE' | 'SERIES' = 'ONE',
  ) =>
    request<void>(server, `/calendar/${encodeURIComponent(id)}?scope=${scope}`, token, {
      method: 'DELETE',
    }),
  activity: (server: SavedServer, token: string, cursor?: string) =>
    request<Page<ActivityItem>>(server, `/activity/feed${query({ limit: '30', cursor })}`, token),
  alerts: (server: SavedServer, token: string, cursor?: string) =>
    request<Page<AlertItem>>(server, `/alerts/feed${query({ limit: '30', cursor })}`, token),
  journal: (server: SavedServer, token: string, cursor?: string) =>
    request<Page<JournalItem>>(server, `/journal/feed${query({ limit: '30', cursor })}`, token),
  cameras: (server: SavedServer, token: string) => request<CameraItem[]>(server, '/cameras', token),
  sensorDevices: (server: SavedServer, token: string) =>
    request<SensorDevice[]>(server, '/sensor-devices', token),
  sensorProtocols: (server: SavedServer, token: string) =>
    request<Array<{ id: string; available: boolean; native: boolean }>>(
      server,
      '/sensor-devices/protocols',
      token,
    ),
  startSensorOnboarding: (server: SavedServer, token: string, protocol?: string) =>
    request<SensorOnboardingSession>(server, '/sensor-devices/onboarding-sessions', token, {
      method: 'POST',
      body: JSON.stringify(protocol ? { protocol } : {}),
    }),
  currentSensorOnboarding: (server: SavedServer, token: string) =>
    request<SensorOnboardingSession | null>(
      server,
      '/sensor-devices/onboarding-sessions/current',
      token,
    ),
  sensorOnboarding: (server: SavedServer, token: string, id: string) =>
    request<SensorOnboardingSession>(server, `/sensor-devices/onboarding-sessions/${id}`, token),
  cancelSensorOnboarding: (server: SavedServer, token: string, id: string) =>
    request<SensorOnboardingSession>(server, `/sensor-devices/onboarding-sessions/${id}`, token, {
      method: 'DELETE',
    }),
  completeSensorOnboarding: (
    server: SavedServer,
    token: string,
    id: string,
    body: { name?: string; roomId: string | null; target?: null },
  ) =>
    request<{ sessionId: string; device: SensorDevice }>(
      server,
      `/sensor-devices/onboarding-sessions/${id}/complete`,
      token,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  updateSensorDevice: (
    server: SavedServer,
    token: string,
    id: string,
    body: {
      name?: string;
      roomId?: string | null;
      enabled?: boolean;
      placementConfirmed?: boolean;
    },
  ) =>
    request<{ id: string }>(server, `/sensor-devices/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  confirmSensorClassification: (
    server: SavedServer,
    token: string,
    id: string,
    sensorId: string,
    capability: string,
  ) =>
    request(server, `/sensor-devices/${encodeURIComponent(id)}/classifications`, token, {
      method: 'POST',
      body: JSON.stringify({ sensorId, capability }),
    }),
  sensorPlacementGuide: (server: SavedServer, token: string, id: string) =>
    request<SensorPlacementGuide>(
      server,
      `/sensor-devices/${encodeURIComponent(id)}/placement-guide`,
      token,
    ),
  startSensorVerification: (server: SavedServer, token: string, id: string) =>
    request<SensorVerificationSession>(
      server,
      `/sensor-devices/${encodeURIComponent(id)}/verification-sessions`,
      token,
      { method: 'POST' },
    ),
  sensorVerification: (server: SavedServer, token: string, id: string) =>
    request<SensorVerificationSession>(
      server,
      `/sensor-devices/verification-sessions/${id}`,
      token,
    ),
  cameraSession: (server: SavedServer, token: string, id: string, talk = false) =>
    request<CameraSession>(
      server,
      `/cameras/${id}/${talk ? 'talk-session' : 'live-session'}`,
      token,
      {
        method: 'POST',
      },
    ),
  cameraPrivacy: (server: SavedServer, token: string, id: string, enabled: boolean) =>
    request<CameraItem>(server, `/cameras/${id}/privacy`, token, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  transitionAlert: (
    server: SavedServer,
    token: string,
    id: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED',
  ) =>
    request<AlertItem>(server, `/alerts/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  registerPush: (
    server: SavedServer,
    token: string,
    subscription: { expoPushToken: string; platform: 'IOS' | 'ANDROID'; deviceName?: string },
  ) =>
    request<{ id: string }>(server, '/notifications/subscriptions', token, {
      method: 'PUT',
      body: JSON.stringify(subscription),
    }),
};
