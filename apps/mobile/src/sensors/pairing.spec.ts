import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PairingController,
  type PairingApi,
  type PairingError,
  type PairingSession,
} from './pairing';

const detected = {
  id: 'device-1',
  physicalDeviceId: null,
  name: 'Door sensor',
  manufacturer: 'Third Reality',
  model: '3RDS17BZ',
  protocol: 'zigbee',
  integration: 'zigbee2mqtt',
  room: null,
  installationStatus: 'NEEDS_PLACEMENT',
  enabled: true,
  placementConfirmedAt: null,
  lastSeenAt: null,
  batteryPercent: 90,
  capabilities: [],
  action: 'NONE',
  detectedType: 'CONTACT',
} as const;

const session = (overrides: Partial<PairingSession> = {}): PairingSession =>
  ({
    id: 'session-1',
    protocol: 'zigbee',
    status: 'WAITING_FOR_DEVICE',
    step: 'PAIRING',
    deviceId: null,
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date(Date.now() + 240_000).toISOString(),
    connection: { online: true, pairingOpen: true, deviceDetected: false, updatedAt: null },
    detectedDevice: null,
    ...overrides,
  }) as PairingSession;

const found = () => session({ status: 'DEVICE_FOUND', detectedDevice: detected as never });

class ApiError extends Error {
  public constructor(
    message: string,
    public readonly answered: boolean,
    public readonly code?: PairingError,
  ) {
    super(message);
  }
}

function setup(overrides: Partial<PairingApi> = {}) {
  const api = {
    current: vi.fn().mockResolvedValue(null),
    start: vi.fn().mockResolvedValue(session()),
    get: vi.fn().mockResolvedValue(session()),
    cancel: vi.fn().mockResolvedValue({}),
    complete: vi.fn().mockResolvedValue({}),
    ...overrides,
  } satisfies PairingApi;
  const controller = new PairingController({
    api,
    classifyError: (error) =>
      error instanceof ApiError && error.code ? error.code : { kind: 'UNREACHABLE' },
    isApiAnswer: (error) => error instanceof ApiError && error.answered,
  });
  return { api, controller };
}

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pairing controller: starting', () => {
  it('shows the preparation when no search is running', async () => {
    const { controller } = setup();
    await controller.init();
    expect(controller.getState().phase).toBe('PREPARE');
  });

  it('resumes a search started earlier, even a found sensor', async () => {
    const waiting = setup({ current: vi.fn().mockResolvedValue(session()) });
    await waiting.controller.init();
    expect(waiting.controller.getState().phase).toBe('SEARCH');
    waiting.controller.dispose();

    const ready = setup({ current: vi.fn().mockResolvedValue(found()) });
    await ready.controller.init();
    expect(ready.controller.getState().phase).toBe('FOUND');
  });

  it('ignores a finished search left on the hub', async () => {
    const { controller } = setup({
      current: vi.fn().mockResolvedValue(session({ status: 'COMPLETED' })),
    });
    await controller.init();
    expect(controller.getState().phase).toBe('PREPARE');
  });

  it('keeps the preparation and explains when the hub cannot be reached', async () => {
    const { controller } = setup({ current: vi.fn().mockRejectedValue(new Error('offline')) });
    await controller.init();
    expect(controller.getState()).toMatchObject({
      phase: 'PREPARE',
      error: { kind: 'UNREACHABLE' },
    });
  });

  it('searches, notices the sensor and offers it', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(
        session({
          connection: { online: true, pairingOpen: true, deviceDetected: true, updatedAt: null },
        }),
      )
      .mockResolvedValue(found());
    const { controller, api } = setup({ get });
    await controller.init();
    await controller.start('zigbee', '3RDS17BZ');
    expect(api.start).toHaveBeenCalledWith('zigbee', '3RDS17BZ');
    expect(controller.getState().phase).toBe('SEARCH');
    await advance(1300);
    expect(controller.getState().session?.connection?.deviceDetected).toBe(true);
    await advance(1600);
    expect(controller.getState().phase).toBe('FOUND');
    expect(controller.getState().session?.detectedDevice?.model).toBe('3RDS17BZ');
    // No more polling once the sensor is found.
    const calls = get.mock.calls.length;
    await advance(10_000);
    expect(get.mock.calls.length).toBe(calls);
  });

  it('shows the reason when the hub refuses to start and has nothing to stop', async () => {
    const refusal = new ApiError('403', true, { kind: 'CODE', code: 'ADMIN_REQUIRED' });
    const { controller, api } = setup({ start: vi.fn().mockRejectedValue(refusal) });
    await controller.init();
    await controller.start();
    expect(controller.getState().error).toEqual({ kind: 'CODE', code: 'ADMIN_REQUIRED' });
    expect(await controller.close()).toBe(true);
    expect(api.current).toHaveBeenCalledTimes(1); // only the initial check
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('stops a search whose start got no answer when the person leaves', async () => {
    const lost = new ApiError('network', false);
    const { controller, api } = setup({
      start: vi.fn().mockRejectedValue(lost),
      current: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(session({ id: 'late' })),
    });
    await controller.init();
    await controller.start();
    expect(controller.getState().error).toEqual({ kind: 'UNREACHABLE' });
    await controller.close();
    expect(api.cancel).toHaveBeenCalledWith('late');
  });
});

describe('pairing controller: while searching', () => {
  it('keeps searching through a dropped connection and recovers', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(session());
    const { controller } = setup({ get });
    await controller.init();
    await controller.start();
    await advance(1300);
    expect(controller.getState()).toMatchObject({ phase: 'SEARCH', offline: true, failure: null });
    await advance(3100);
    expect(controller.getState().offline).toBe(false);
    expect(controller.getState().phase).toBe('SEARCH');
  });

  it('ends with "no sensor found" when time runs out and nothing was seen', async () => {
    const short = session({ expiresAt: new Date(Date.now() + 2_000).toISOString() });
    const { controller } = setup({
      start: vi.fn().mockResolvedValue(short),
      get: vi.fn().mockResolvedValue(short),
    });
    await controller.init();
    await controller.start();
    await advance(2_000 + 8_000 + 1_000);
    expect(controller.getState().failure).toEqual({ reason: 'TIMEOUT' });
  });

  it('says the sensor was seen but not usable when the hub ends the search', async () => {
    const seen = session({
      connection: { online: true, pairingOpen: true, deviceDetected: true, updatedAt: null },
    });
    const get = vi
      .fn()
      .mockResolvedValueOnce(seen)
      .mockResolvedValue({ ...seen, status: 'EXPIRED' });
    const { controller } = setup({ get });
    await controller.init();
    await controller.start();
    await advance(1300 + 1600);
    expect(controller.getState().failure).toEqual({ reason: 'UNSUPPORTED' });
  });

  it('does not give up on its own while the hub has seen a sensor', async () => {
    const seen = session({
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      connection: { online: true, pairingOpen: true, deviceDetected: true, updatedAt: null },
    });
    const { controller } = setup({
      start: vi.fn().mockResolvedValue(seen),
      get: vi.fn().mockResolvedValue(seen),
    });
    await controller.init();
    await controller.start();
    await advance(60_000);
    expect(controller.getState().failure).toBeNull();
  });

  it('reports a rejected pairing with the reason given by the hub', async () => {
    const get = vi.fn().mockResolvedValue(session({ status: 'FAILED', errorMessage: 'refused' }));
    const { controller } = setup({ get });
    await controller.init();
    await controller.start();
    await advance(1300);
    expect(controller.getState().failure).toEqual({ reason: 'REJECTED', message: 'refused' });
  });

  it('reports a search replaced by another phone as stopped', async () => {
    const get = vi.fn().mockResolvedValue(session({ status: 'CANCELLED' }));
    const { controller } = setup({ get });
    await controller.init();
    await controller.start();
    await advance(1300);
    expect(controller.getState().failure).toEqual({ reason: 'CANCELLED' });
  });

  it('looks again at once when the app comes back to the foreground', async () => {
    const { controller, api } = setup();
    await controller.init();
    await controller.start();
    controller.poke();
    await advance(0);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('cancelling the search closes it on the hub and returns to the preparation', async () => {
    const { controller, api } = setup();
    await controller.init();
    await controller.start();
    await controller.stopSearch();
    expect(api.cancel).toHaveBeenCalledWith('session-1');
    expect(controller.getState()).toMatchObject({ phase: 'PREPARE', session: null });
    const polls = (api.get as ReturnType<typeof vi.fn>).mock.calls.length;
    await advance(10_000);
    expect((api.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(polls);
  });

  it('stops everything when the screen disappears without a clean close', async () => {
    const { controller, api } = setup();
    await controller.init();
    await controller.start();
    controller.abandon();
    await advance(0);
    expect(api.cancel).toHaveBeenCalledWith('session-1');
    const polls = (api.get as ReturnType<typeof vi.fn>).mock.calls.length;
    await advance(10_000);
    expect((api.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(polls);
  });
});

describe('pairing controller: installing', () => {
  async function ready(overrides: Partial<PairingApi> = {}) {
    const setupResult = setup({
      start: vi.fn().mockResolvedValue(found()),
      get: vi.fn().mockResolvedValue(found()),
      ...overrides,
    });
    await setupResult.controller.init();
    await setupResult.controller.start();
    return setupResult;
  }

  it('installs the found sensor and shows the end page', async () => {
    const { controller, api } = await ready();
    expect(controller.getState().phase).toBe('FOUND');
    await controller.finish({ name: 'Hall door', roomId: 'hall' }, 'Hall');
    expect(api.complete).toHaveBeenCalledWith('session-1', { name: 'Hall door', roomId: 'hall' });
    expect(controller.getState()).toMatchObject({
      phase: 'DONE',
      installed: { name: 'Hall door', room: 'Hall' },
    });
    // Leaving after a successful install must not undo it.
    await controller.close();
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('accepts a confirmation lost on the way when the hub did install it', async () => {
    const { controller } = await ready({
      complete: vi.fn().mockRejectedValue(new Error('network')),
      get: vi.fn().mockResolvedValue(session({ status: 'COMPLETED' })),
    });
    await controller.finish({ name: 'Hall door', roomId: 'hall' }, 'Hall');
    expect(controller.getState().phase).toBe('DONE');
    expect(controller.getState().error).toBeNull();
  });

  it('stays on the sensor with a message when the installation really failed', async () => {
    const { controller } = await ready({
      complete: vi
        .fn()
        .mockRejectedValue(new ApiError('409', true, { kind: 'CODE', code: 'ALREADY_COMPLETED' })),
    });
    await controller.finish({ name: 'Hall door', roomId: 'hall' }, 'Hall');
    expect(controller.getState()).toMatchObject({
      phase: 'FOUND',
      error: { kind: 'CODE', code: 'ALREADY_COMPLETED' },
      busy: false,
    });
  });

  it('removes the provisional sensor on the hub when the person leaves before installing', async () => {
    const { controller, api } = await ready();
    expect(await controller.close()).toBe(true);
    expect(api.cancel).toHaveBeenCalledWith('session-1');
  });

  it('refuses to leave while a request is running', async () => {
    let release: () => void = () => undefined;
    const { controller } = await ready({
      complete: vi
        .fn()
        .mockImplementation(() => new Promise<void>((resolve) => (release = resolve))),
    });
    const pending = controller.finish({ name: 'Hall door', roomId: 'hall' }, 'Hall');
    expect(controller.getState().busy).toBe(true);
    expect(await controller.close()).toBe(false);
    release();
    await pending;
    expect(controller.getState().phase).toBe('DONE');
  });
});
