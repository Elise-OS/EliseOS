import type { ActivitySummary, DashboardPeriod, Household, ScheduleItem } from '@michel/contracts';
import type { SavedServer } from './discovery/types';

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
  const response = await fetch(`${server.url}/api/v1${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
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
  schedule: (server: SavedServer, token: string) =>
    request<ScheduleItem[]>(server, '/schedule', token),
  activity: (server: SavedServer, token: string, cursor?: string) =>
    request<Page<ActivityItem>>(server, `/activity/feed${query({ limit: '30', cursor })}`, token),
  alerts: (server: SavedServer, token: string, cursor?: string) =>
    request<Page<AlertItem>>(server, `/alerts/feed${query({ limit: '30', cursor })}`, token),
  journal: (server: SavedServer, token: string, cursor?: string) =>
    request<Page<JournalItem>>(server, `/journal/feed${query({ limit: '30', cursor })}`, token),
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
