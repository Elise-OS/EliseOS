import type {
  AlertRuleSettings,
  ContactRole,
  RoomSensorCategory,
  CreatePerson,
  CalendarCreate,
  CalendarPage,
  CalendarUpdate,
  LiaisonCreate,
  LiaisonFilter,
  LiaisonPage,
  MembershipRole,
  NotificationPreferences,
  ScreenCommand,
  ScreenJoin,
  ScreenMedia,
  ScreenMessageInput,
  ScreenPodcastEpisode,
  ScreenPodcastSearchResult,
  ScreenScheduledContentInput,
  ScreenSettings,
  ScreenSnapshot,
  UpdatePerson,
  UpdatePersonAccess,
} from '@elise/contracts';
import type {
  ActivitySummary,
  DashboardPeriod,
  Household,
  HomeSummary,
  HomePlan,
  PresenceEstimate,
  PresenceHistory,
  ScheduleItem,
  SensorDevice,
  SensorOnboardingSession,
  SensorPlacementGuide,
  SensorVerificationSession,
  RemoteAccessStatus,
  UpdateStatus,
  ZigbeeInstall,
  ZigbeeInstallRequest,
  ZigbeeProbeResult,
  ZigbeeStatus,
} from '@elise/contracts';
import type { Installation } from '@elise/contracts';
import { ZIGBEE_DEMO_SEARCH_MS } from '@elise/contracts';
import type { SavedServer } from './discovery/types';
import { preferredServerUrls, rememberActiveServerUrl } from './discovery/helpers';
import { isDemoServer, mockDemoRequest } from './demo/mock-api';
import { appLocale } from './locale';
import { t } from './i18n';

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

export interface GoogleAccountSettings {
  configured: boolean;
  clientId: string;
  redirectUri: string | null;
  youtubeEnabled: boolean;
  calendarEnabled: boolean;
  youtubeConnected: boolean;
}

export interface SimulationScenario {
  id: string;
  title: string;
  description: string;
}

export interface WeatherCity {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
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

export interface ScreenTvStatus {
  installed: boolean;
  display?: { connected?: string[]; selected?: string; mode?: string; updatedAt?: number };
  cec?: {
    detected?: boolean;
    tvAcknowledged?: boolean;
    activeSourceSent?: boolean;
    asleepRequested?: boolean;
    updatedAt?: number;
  };
  networkTv?: {
    id?: string;
    name?: string;
    mac?: string | null;
    homeAssistantEntityId?: string;
  };
  networkTvStatus?: { reachable?: boolean; updatedAt?: number };
  homeAssistantTv?: { available?: boolean } | null;
}

export interface ScreenRadioStation {
  id: string;
  name: string;
  url: string;
  country: string;
  codec: string;
  bitrate: number;
  artworkUrl?: string;
}

/** Body accepted when a found sensor is installed (see the web dashboard's pairing flow). */
export type SensorOnboardingCompletionRequest = {
  name?: string;
  roomId: string | null;
  category?: RoomSensorCategory;
  target?: { type: 'ROOM' | 'ITEM' | 'OPENING' | 'STAIR'; id: string } | null;
  buttonRole?: 'ASSISTANCE' | 'CONFIRMATION' | 'LIGHT' | 'CUSTOM_ROUTINE';
  contactRole?: ContactRole;
  bedOccupiedWhen?: 'CLOSED' | 'OPEN';
  placementNote?: string | null;
};

export type MobileApiErrorCode = 'NETWORK' | 'TIMEOUT' | 'HTTP';

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly code: MobileApiErrorCode,
    readonly status?: number,
    readonly url?: string,
    /** Machine-readable reason sent by the API, when it gives one (`ADMIN_REQUIRED`…). */
    readonly apiCode?: string,
  ) {
    super(message);
    this.name = 'MobileApiError';
  }
}

export const isMobileApiNetworkError = (error: unknown): error is MobileApiError =>
  error instanceof MobileApiError && (error.code === 'NETWORK' || error.code === 'TIMEOUT');

export const isMobileApiAuthError = (error: unknown): error is MobileApiError =>
  error instanceof MobileApiError && (error.status === 401 || error.status === 403);

const REQUEST_TIMEOUT_MS = 8_000;

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (controller.signal.aborted) {
      throw new MobileApiError(t('api.eliseDidNotAnswerIn'), 'TIMEOUT', undefined, url);
    }
    throw new MobileApiError(t('api.eliseIsTemporarilyUnreachable'), 'NETWORK', undefined, url);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
};

const request = async <T>(
  server: SavedServer,
  path: string,
  token?: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
) => {
  if (isDemoServer(server)) {
    // A Zigbee key search listens to the home network for a moment, as on a real box.
    // EXPO_PUBLIC_ZIGBEE_DEMO_SEARCH_MS lengthens it for the screenshots of the searching state.
    if (path.startsWith('/zigbee/adapter/scan'))
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Number(process.env.EXPO_PUBLIC_ZIGBEE_DEMO_SEARCH_MS) || ZIGBEE_DEMO_SEARCH_MS,
        ),
      );
    return mockDemoRequest<T>(path, init);
  }

  let response: Response | undefined;
  let lastError: unknown;
  for (const baseUrl of preferredServerUrls(server)) {
    try {
      response = await fetchWithTimeout(
        `${baseUrl}/api/v1${path}`,
        {
          ...init,
          headers: {
            accept: 'application/json',
            'x-elise-locale': appLocale(),
            ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...init?.headers,
          },
        },
        timeoutMs,
      );
      rememberActiveServerUrl(server, baseUrl);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new MobileApiError(t('api.eliseIsTemporarilyUnreachable'), 'NETWORK');
  }
  if (!response.ok) {
    const body: unknown = await Promise.resolve()
      .then(() => response.json() as unknown)
      .catch(() => null);
    const apiCode =
      body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        ? body.code
        : undefined;
    throw new MobileApiError(
      `HTTP ${response.status}`,
      'HTTP',
      response.status,
      undefined,
      apiCode,
    );
  }
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
  zigbeeStatus: (server: SavedServer, token: string) =>
    request<ZigbeeStatus>(server, '/zigbee/adapter', token),
  scanZigbee: (server: SavedServer, token: string, network = false) =>
    request<ZigbeeStatus>(server, '/zigbee/adapter/scan', token, {
      method: 'POST',
      body: JSON.stringify({ network }),
    }),
  probeZigbee: (server: SavedServer, token: string, candidateId: string) =>
    request<ZigbeeProbeResult>(server, '/zigbee/adapter/probe', token, {
      method: 'POST',
      body: JSON.stringify({ candidateId }),
    }),
  testZigbeeNetwork: (server: SavedServer, token: string, host: string, port: number) =>
    request<ZigbeeProbeResult>(server, '/zigbee/adapter/network/test', token, {
      method: 'POST',
      body: JSON.stringify({ host, port }),
    }),
  installZigbee: (server: SavedServer, token: string, input: ZigbeeInstallRequest) =>
    request<ZigbeeInstall>(server, '/zigbee/adapter/install', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancelZigbeeInstall: (server: SavedServer, token: string) =>
    request<ZigbeeInstall>(server, '/zigbee/adapter/install/cancel', token, {
      method: 'POST',
      body: '{}',
    }),
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
  me: (server: SavedServer, token: string) => request<CurrentUser>(server, '/auth/me', token),
  logout: (server: SavedServer, token: string) =>
    request<void>(server, '/auth/logout', token, { method: 'POST' }),
  health: (server: SavedServer) => request<{ status: string }>(server, '/system/health'),
  overview: (server: SavedServer, token: string) => request<Overview>(server, '/overview', token),
  summary: (server: SavedServer, token: string, period: DashboardPeriod) =>
    request<ActivitySummary>(server, `/analytics/activity?period=${period}`, token),
  activitySummary: (server: SavedServer, token: string, date: string) =>
    request<ActivitySummary>(
      server,
      `/analytics/activity?period=24h&date=${encodeURIComponent(date)}`,
      token,
    ),
  homeSummary: (server: SavedServer, token: string) =>
    request<HomeSummary>(server, '/home-summary', token),
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
  startSensorOnboarding: (
    server: SavedServer,
    token: string,
    protocol?: string,
    init?: RequestInit,
    /** Model the person chose: only the demo uses it, to "find" that very sensor. */
    demoModel?: string,
  ) =>
    request<SensorOnboardingSession>(
      server,
      '/sensor-devices/onboarding-sessions',
      token,
      {
        ...init,
        method: 'POST',
        body: JSON.stringify({
          ...(protocol ? { protocol } : {}),
          ...(demoModel && isDemoServer(server) ? { demoModel } : {}),
        }),
      },
      15_000,
    ),
  currentSensorOnboarding: (server: SavedServer, token: string, init?: RequestInit) =>
    request<SensorOnboardingSession | null>(
      server,
      '/sensor-devices/onboarding-sessions/current',
      token,
      init,
    ),
  sensorOnboarding: (server: SavedServer, token: string, id: string, init?: RequestInit) =>
    request<SensorOnboardingSession>(
      server,
      `/sensor-devices/onboarding-sessions/${id}`,
      token,
      init,
    ),
  cancelSensorOnboarding: (server: SavedServer, token: string, id: string) =>
    request<SensorOnboardingSession>(
      server,
      `/sensor-devices/onboarding-sessions/${id}`,
      token,
      { method: 'DELETE' },
      6_000,
    ),
  completeSensorOnboarding: (
    server: SavedServer,
    token: string,
    id: string,
    body: SensorOnboardingCompletionRequest,
  ) =>
    request<{ sessionId: string; device: SensorDevice }>(
      server,
      `/sensor-devices/onboarding-sessions/${id}/complete`,
      token,
      { method: 'POST', body: JSON.stringify(body) },
      15_000,
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
      placementNote?: string | null;
      target?: { type: 'ROOM' | 'ITEM' | 'OPENING' | 'STAIR'; id: string } | null;
      buttonRole?: SensorOnboardingCompletionRequest['buttonRole'];
      contactRole?: SensorOnboardingCompletionRequest['contactRole'];
      bedOccupiedWhen?: 'CLOSED' | 'OPEN';
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
    note?: string,
  ) =>
    request<AlertItem>(server, `/alerts/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...(note ? { note } : {}) }),
    }),
  alertDetail: (server: SavedServer, token: string, id: string) =>
    request<AlertDetail>(server, `/alerts/${encodeURIComponent(id)}/detail`, token),
  alertSummary: (server: SavedServer, token: string) =>
    request<{ urgentCount: number }>(server, '/alerts/summary', token),
  alertRules: (server: SavedServer, token: string) =>
    request<AlertRuleSettings>(server, '/alerts/rules', token),
  saveAlertRules: (server: SavedServer, token: string, rules: AlertRuleSettings) =>
    request<AlertRuleSettings>(server, '/alerts/rules', token, {
      method: 'PATCH',
      body: JSON.stringify(rules),
    }),
  people: (server: SavedServer, token: string) =>
    request<TrustedPerson[]>(server, '/household/people?archived=true', token),
  createPerson: (server: SavedServer, token: string, input: CreatePerson) =>
    request<TrustedPerson>(server, '/household/people', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updatePerson: (server: SavedServer, token: string, id: string, input: UpdatePerson) =>
    request<TrustedPerson>(server, `/household/people/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  updatePersonAccess: (server: SavedServer, token: string, id: string, input: UpdatePersonAccess) =>
    request<TrustedPerson>(server, `/household/people/${encodeURIComponent(id)}/access`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  archivePerson: (server: SavedServer, token: string, id: string) =>
    request<void>(server, `/household/people/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),
  screen: (server: SavedServer, token: string) => request<ScreenSnapshot>(server, '/screen', token),
  screenTvStatus: (server: SavedServer, token: string) =>
    request<ScreenTvStatus>(server, '/screen/tv', token),
  screenTvReclaim: (server: SavedServer, token: string) =>
    request<unknown>(server, '/screen/tv/reclaim', token, { method: 'POST' }),
  uploadScreenPhoto: (server: SavedServer, token: string, body: FormData) =>
    request<ScreenSnapshot>(server, '/screen/upload', token, { method: 'POST', body }, 120_000),
  updateScreenMessage: (server: SavedServer, token: string, input: ScreenMessageInput) =>
    request<ScreenSnapshot>(server, '/screen/message', token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  scheduleScreenContent: (server: SavedServer, token: string, input: ScreenScheduledContentInput) =>
    request<ScreenSnapshot>(server, '/screen/scheduled-content', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancelScheduledScreenContent: (server: SavedServer, token: string, id: string) =>
    request<ScreenSnapshot>(server, `/screen/scheduled-content/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),
  updateScreenSettings: (server: SavedServer, token: string, settings: ScreenSettings) =>
    request<ScreenSnapshot>(server, '/screen/settings', token, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
  screenCommand: (server: SavedServer, token: string, command: ScreenCommand) =>
    request<unknown>(server, '/screen/commands', token, {
      method: 'POST',
      body: JSON.stringify(command),
    }),
  createScreenMedia: (server: SavedServer, token: string, media: ScreenMedia) =>
    request<unknown>(server, '/screen/media', token, {
      method: 'POST',
      body: JSON.stringify(media),
    }),
  removeScreenMedia: (server: SavedServer, token: string, id: string) =>
    request<unknown>(server, `/screen/media/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),
  searchScreenRadio: (server: SavedServer, token: string, queryText: string) =>
    request<ScreenRadioStation[]>(
      server,
      `/screen/radio/search?q=${encodeURIComponent(queryText)}`,
      token,
    ),
  searchScreenPodcasts: (server: SavedServer, token: string, queryText: string) =>
    request<ScreenPodcastSearchResult[]>(
      server,
      `/screen/podcasts/search?q=${encodeURIComponent(queryText)}`,
      token,
    ),
  screenPodcastEpisodes: (server: SavedServer, token: string, podcastId: string) =>
    request<ScreenPodcastEpisode[]>(
      server,
      `/screen/podcasts/${encodeURIComponent(podcastId)}/episodes`,
      token,
    ),
  followScreenPodcast: (server: SavedServer, token: string, podcastId: string) =>
    request<unknown>(server, `/screen/podcasts/${encodeURIComponent(podcastId)}/follow`, token, {
      method: 'POST',
    }),
  playScreenPodcastEpisode: (
    server: SavedServer,
    token: string,
    podcastId: string,
    episodeId: string,
  ) =>
    request<ScreenSnapshot>(
      server,
      `/screen/podcasts/${encodeURIComponent(podcastId)}/play`,
      token,
      { method: 'POST', body: JSON.stringify({ episodeId }) },
    ),
  screenCall: (server: SavedServer, token: string) =>
    request<ScreenSnapshot>(server, '/screen/calls', token, {
      method: 'POST',
      body: JSON.stringify({ client: 'mobile' }),
    }),
  screenCallJoin: (server: SavedServer, token: string, id: string) =>
    request<ScreenJoin>(server, `/screen/calls/${encodeURIComponent(id)}/join`, token, {
      method: 'POST',
    }),
  screenEndCall: (server: SavedServer, token: string, id: string) =>
    request<{ ok: boolean }>(server, `/screen/calls/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),
  weatherCities: (server: SavedServer, token: string, queryText: string) =>
    request<WeatherCity[]>(
      server,
      `/screen/weather/cities?q=${encodeURIComponent(queryText)}`,
      token,
    ),
  googleSettings: (server: SavedServer, token: string) =>
    request<GoogleAccountSettings>(server, '/screen/google', token),
  saveGoogleSettings: (
    server: SavedServer,
    token: string,
    input: {
      clientId: string;
      clientSecret?: string;
      youtubeEnabled: boolean;
      calendarEnabled: boolean;
    },
  ) =>
    request<GoogleAccountSettings>(server, '/screen/google', token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeGoogleSettings: (server: SavedServer, token: string) =>
    request<void>(server, '/screen/google', token, { method: 'DELETE' }),
  remoteAccessStatus: (server: SavedServer, token: string) =>
    request<RemoteAccessStatus>(server, '/remote-access/status', token),
  remoteAccessAction: (
    server: SavedServer,
    token: string,
    action: 'connect' | 'enable' | 'disable',
  ) =>
    request<RemoteAccessStatus>(server, `/remote-access/${action}`, token, {
      method: 'POST',
      body: JSON.stringify(action === 'connect' ? { hostname: 'elise' } : {}),
    }),
  updateStatus: (server: SavedServer, token: string) =>
    request<UpdateStatus>(server, '/system/update', token),
  checkUpdate: (server: SavedServer, token: string) =>
    request<UpdateStatus>(server, '/system/update/check', token, { method: 'POST' }),
  saveUpdateCredentials: (
    server: SavedServer,
    token: string,
    username: string,
    githubToken: string,
  ) =>
    request<UpdateStatus>(server, '/system/update/credentials', token, {
      method: 'PUT',
      body: JSON.stringify({ username, token: githubToken }),
    }),
  deleteUpdateCredentials: (server: SavedServer, token: string) =>
    request<UpdateStatus>(server, '/system/update/credentials', token, { method: 'DELETE' }),
  installUpdate: (server: SavedServer, token: string, version: string) =>
    request<UpdateStatus>(server, '/system/update/install', token, {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),
  simulationScenarios: (server: SavedServer, token: string) =>
    request<SimulationScenario[]>(server, '/simulation/scenarios', token),
  runSimulation: (server: SavedServer, token: string, scenario: string, runId: string) =>
    request<{ accepted: number; duplicates: number }>(
      server,
      `/simulation/scenarios/${encodeURIComponent(scenario)}`,
      token,
      { method: 'POST', body: JSON.stringify({ runId }) },
    ),
  registerPush: (
    server: SavedServer,
    token: string,
    subscription: { expoPushToken: string; platform: 'IOS' | 'ANDROID'; deviceName?: string },
  ) =>
    request<{ id: string }>(server, '/notifications/subscriptions', token, {
      method: 'PUT',
      body: JSON.stringify(subscription),
    }),
  notificationPreferences: (server: SavedServer, token: string) =>
    request<NotificationPreferences>(server, '/notifications/preferences', token),
  saveNotificationPreferences: (
    server: SavedServer,
    token: string,
    preferences: NotificationPreferences,
  ) =>
    request<NotificationPreferences>(server, '/notifications/preferences', token, {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),
};
