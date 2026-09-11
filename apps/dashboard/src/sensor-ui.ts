export type SensorRoom = {
  id: string;
  name: string;
  kind: string;
  floor?: number;
  sortOrder?: number;
};
export type SensorUiDevice = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  protocol: string | null;
  integration: string | null;
  room: SensorRoom | null;
  installationStatus: string;
  enabled: boolean;
  placementConfirmedAt: string | null;
  placementNote?: string | null | undefined;
  lastSeenAt: string | null;
  batteryPercent: number | null;
  capabilities: Array<{
    sensorId: string;
    entityId: string;
    capability: string;
    label: string;
    primary: boolean;
    status: string;
    value: Record<string, unknown> | null;
    unit: string | null;
    lastSeenAt?: string | null | undefined;
    classification: { confidence: number; reason: string | null; confirmedAt: string | null };
  }>;
  action: 'CONFIRM' | 'ASSIGN_ROOM' | 'PLACE' | 'TEST' | 'CHECK' | 'NONE';
};

export async function sensorRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result &&
        typeof result === 'object' &&
        'message' in result &&
        typeof result.message === 'string'
        ? result.message
        : `Connexion impossible (${response.status}).`,
    );
  return result as T;
}
export const sensorJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
