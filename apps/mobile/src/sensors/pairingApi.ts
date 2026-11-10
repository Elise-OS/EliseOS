import { sensorErrorCode } from '@elise/contracts';
import { MobileApiError, mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import type { SensorFlowApi } from './AddSensorFlow';
import type { PairingApi, PairingError } from './pairing';

/** The pairing controller talking to the Élise box of the signed-in household. */
export function pairingApiFor(server: SavedServer, token: string): PairingApi {
  return {
    current: (signal) => mobileApi.currentSensorOnboarding(server, token, { signal }),
    start: (protocol, model) =>
      mobileApi.startSensorOnboarding(server, token, protocol, undefined, model),
    get: (id, signal) => mobileApi.sensorOnboarding(server, token, id, { signal }),
    cancel: (id) => mobileApi.cancelSensorOnboarding(server, token, id),
    complete: (id, body) => mobileApi.completeSensorOnboarding(server, token, id, body),
  };
}

export const isApiAnswer = (error: unknown) =>
  error instanceof MobileApiError && error.code === 'HTTP';

/** What a failed request means for the person, whatever the version of the box. */
export function classifyPairingError(error: unknown): PairingError {
  if (!(error instanceof MobileApiError)) return { kind: 'UNREACHABLE' };
  if (error.code === 'TIMEOUT') return { kind: 'TIMEOUT' };
  if (error.code === 'NETWORK') return { kind: 'UNREACHABLE' };
  const code = sensorErrorCode(error.apiCode);
  if (code) return { kind: 'CODE', code };
  // Older boxes answer without a code: fall back on the HTTP status.
  if (error.status === 401 || error.status === 403) return { kind: 'CODE', code: 'ACCESS_DENIED' };
  if (error.status === 409) return { kind: 'CODE', code: 'ALREADY_COMPLETED' };
  return { kind: 'GENERIC' };
}

/** Pairing plus moving a sensor that is already connected: what the Home tab flow needs. */
export function sensorFlowApiFor(server: SavedServer, token: string): SensorFlowApi {
  return {
    ...pairingApiFor(server, token),
    assign: (id, body) => mobileApi.updateSensorDevice(server, token, id, body),
  };
}
