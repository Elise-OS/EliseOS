import { describe, expect, it } from 'vitest';
import { MobileApiError } from '../api';
import { classifyPairingError, isApiAnswer } from './pairingApi';

const http = (status: number, apiCode?: string) =>
  new MobileApiError(`HTTP ${status}`, 'HTTP', status, undefined, apiCode);

describe('sensor flow errors', () => {
  it('uses the code sent by the box', () => {
    expect(classifyPairingError(http(403, 'ADMIN_REQUIRED'))).toEqual({
      kind: 'CODE',
      code: 'ADMIN_REQUIRED',
    });
    expect(classifyPairingError(http(403, 'NO_PAIRING_MODULE'))).toEqual({
      kind: 'CODE',
      code: 'NO_PAIRING_MODULE',
    });
  });

  it('understands older boxes that only send a status', () => {
    expect(classifyPairingError(http(403))).toEqual({ kind: 'CODE', code: 'ACCESS_DENIED' });
    expect(classifyPairingError(http(409))).toEqual({ kind: 'CODE', code: 'ALREADY_COMPLETED' });
    expect(classifyPairingError(http(500))).toEqual({ kind: 'GENERIC' });
  });

  it('tells a slow box from an unreachable one', () => {
    expect(classifyPairingError(new MobileApiError('t', 'TIMEOUT'))).toEqual({ kind: 'TIMEOUT' });
    expect(classifyPairingError(new MobileApiError('n', 'NETWORK'))).toEqual({
      kind: 'UNREACHABLE',
    });
    expect(classifyPairingError(new Error('boom'))).toEqual({ kind: 'UNREACHABLE' });
  });

  it('knows when the box answered, so nothing was started', () => {
    expect(isApiAnswer(http(403, 'ADMIN_REQUIRED'))).toBe(true);
    expect(isApiAnswer(new MobileApiError('n', 'NETWORK'))).toBe(false);
    expect(isApiAnswer(new MobileApiError('t', 'TIMEOUT'))).toBe(false);
  });
});
