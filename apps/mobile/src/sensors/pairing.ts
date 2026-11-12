import {
  SENSOR_POLL_MS,
  SENSOR_POLL_RETRY_MS,
  isActiveOnboardingStatus,
  searchTimedOut,
  secondsUntil,
  type SensorErrorCode,
  type SensorOnboardingCompletionResult,
  type SensorOnboardingSession,
} from '@elise/contracts';
import type { SensorOnboardingCompletionRequest } from '../api';

/**
 * The search for a sensor, without any screen in it: the same steps as the web dashboard
 * (prepare, search, found, installed) so the phone and the browser behave alike.
 * Screens subscribe to it; it can be tested with fake timers.
 */

export type PairingSession = SensorOnboardingSession;

export type PairingApi = {
  current(signal?: AbortSignal): Promise<PairingSession | null>;
  start(protocol: string, model?: string): Promise<PairingSession>;
  get(id: string, signal?: AbortSignal): Promise<PairingSession>;
  cancel(id: string): Promise<unknown>;
  complete(id: string, body: SensorOnboardingCompletionRequest): Promise<unknown>;
};

export type PairingPhase = 'LOADING' | 'PREPARE' | 'SEARCH' | 'FOUND' | 'DONE';
export type PairingFailure = {
  reason: 'TIMEOUT' | 'REJECTED' | 'CANCELLED' | 'UNSUPPORTED';
  message?: string | null | undefined;
};
/** What went wrong, without wording: the screen picks the translated text. */
export type PairingError =
  | { kind: 'CODE'; code: SensorErrorCode }
  | { kind: 'TIMEOUT' }
  | { kind: 'UNREACHABLE' }
  | { kind: 'GENERIC' };

export type PairingState = {
  phase: PairingPhase;
  session: PairingSession | null;
  failure: PairingFailure | null;
  error: PairingError | null;
  /** The phone lost the connection to Élise while searching (the hub keeps listening). */
  offline: boolean;
  busy: boolean;
  secondsLeft: number;
  installed: { name: string; room: string } | null;
  /**
   * Several devices can join during one search: they are offered one after the other.
   * `previous` is the device of the same search installed just before the one shown.
   */
  queue: {
    installed: number;
    /** The category/target/product the person chose was already given to a device. */
    intentUsed: boolean;
    previous: { name: string; room: string } | null;
  };
};

export type PairingOptions = {
  api: PairingApi;
  /** Turns a failed request into a `PairingError`. */
  classifyError: (error: unknown) => PairingError;
  /** True when the API answered (even with a refusal): nothing was started on the hub. */
  isApiAnswer: (error: unknown) => boolean;
};

const initialState: PairingState = {
  phase: 'LOADING',
  session: null,
  failure: null,
  error: null,
  offline: false,
  busy: false,
  secondsLeft: 0,
  installed: null,
  queue: { installed: 0, intentUsed: false, previous: null },
};

export class PairingController {
  private state: PairingState = initialState;
  private readonly listeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private countdownTimer: ReturnType<typeof setInterval> | undefined;
  private pollAbort: AbortController | undefined;
  private disposed = false;
  private deviceSeen = false;
  // A start request that got no answer may still have opened the search on the hub.
  private startUnanswered = false;

  public constructor(private readonly options: PairingOptions) {}

  public readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getState = () => this.state;

  private set(patch: Partial<PairingState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Picks up a search started earlier (another phone, a restart), else shows the preparation. */
  public async init() {
    try {
      const current = await this.options.api.current();
      if (this.disposed) return;
      if (current && isActiveOnboardingStatus(current.status)) this.adopt(current);
      else this.set({ phase: 'PREPARE' });
    } catch (error) {
      if (this.disposed) return;
      this.set({ phase: 'PREPARE', error: this.options.classifyError(error) });
    }
  }

  private adopt(next: PairingSession) {
    if (next.connection?.deviceDetected) this.deviceSeen = true;
    if (next.status === 'DEVICE_FOUND' && next.detectedDevice) {
      this.stopTimers();
      this.set({ session: next, failure: null, error: null, phase: 'FOUND' });
    } else if (isActiveOnboardingStatus(next.status)) {
      this.set({
        session: next,
        phase: 'SEARCH',
        secondsLeft: secondsUntil(next.expiresAt),
      });
      this.beginSearching();
    } else this.set({ session: next });
  }

  private beginSearching() {
    this.stopTimers();
    this.pollTimer = setTimeout(() => void this.poll(), 1200);
    this.countdownTimer = setInterval(() => this.tick(), 1000);
  }

  private stopTimers() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.pollAbort?.abort();
    this.pollTimer = undefined;
    this.countdownTimer = undefined;
    this.pollAbort = undefined;
  }

  private fail(failure: PairingFailure) {
    this.stopTimers();
    this.set({ failure });
  }

  private tick() {
    const session = this.state.session;
    if (!session || this.state.failure) return;
    const left = secondsUntil(session.expiresAt);
    this.set({ secondsLeft: left });
    if (searchTimedOut(left, session.connection?.deviceDetected || this.deviceSeen))
      this.fail({ reason: 'TIMEOUT' });
  }

  /** Look again now: the app came back to the foreground, timers may have slept. */
  public poke() {
    if (this.state.phase === 'SEARCH' && !this.state.failure) void this.poll();
  }

  private async poll() {
    const session = this.state.session;
    if (!session || this.state.phase !== 'SEARCH' || this.state.failure || this.disposed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollAbort?.abort();
    const abort = new AbortController();
    this.pollAbort = abort;
    try {
      const next = await this.options.api.get(session.id, abort.signal);
      if (abort.signal.aborted || this.disposed) return;
      if (next.connection?.deviceDetected) this.deviceSeen = true;
      this.set({ offline: false });
      if (next.status === 'DEVICE_FOUND' && next.detectedDevice) return this.adopt(next);
      this.set({ session: next });
      if (next.status === 'FAILED')
        return this.fail({ reason: 'REJECTED', message: next.errorMessage });
      if (next.status === 'EXPIRED')
        return this.fail({ reason: this.deviceSeen ? 'UNSUPPORTED' : 'TIMEOUT' });
      if (next.status === 'CANCELLED' || next.status === 'COMPLETED')
        return this.fail({ reason: 'CANCELLED' });
      this.pollTimer = setTimeout(() => void this.poll(), SENSOR_POLL_MS);
    } catch {
      if (abort.signal.aborted || this.disposed) return;
      // A dropped request does not end the search: the hub keeps listening.
      this.set({ offline: true });
      this.pollTimer = setTimeout(() => void this.poll(), SENSOR_POLL_RETRY_MS);
    }
  }

  private async cancelSession(target: PairingSession | null): Promise<void> {
    if (!target) {
      if (!this.startUnanswered) return;
      this.startUnanswered = false;
      const current = await this.options.api.current().catch(() => null);
      return this.cancelSession(current);
    }
    if (!isActiveOnboardingStatus(target.status)) return;
    await this.options.api.cancel(target.id).catch(() => undefined);
  }

  public async start(protocol = 'zigbee', model?: string) {
    if (this.state.busy) return;
    this.deviceSeen = false;
    this.set({
      busy: true,
      error: null,
      failure: null,
      offline: false,
      queue: initialState.queue,
    });
    try {
      // Starting a search replaces any earlier one on the hub as well.
      await this.cancelSession(this.state.session);
      this.startUnanswered = true;
      const next = await this.options.api.start(protocol, model);
      this.startUnanswered = false;
      if (this.disposed) return;
      this.adopt(next);
    } catch (error) {
      if (this.options.isApiAnswer(error)) this.startUnanswered = false;
      this.set({ error: this.options.classifyError(error) });
    } finally {
      this.set({ busy: false });
    }
  }

  public async stopSearch() {
    if (this.state.busy) return;
    this.set({ busy: true });
    this.stopTimers();
    await this.cancelSession(this.state.session);
    this.set({ session: null, failure: null, offline: false, busy: false, phase: 'PREPARE' });
  }

  /** Leaves the flow: a search still running on the hub is stopped first. */
  public async close() {
    if (this.state.busy) return false;
    if (this.state.phase !== 'DONE') {
      this.set({ busy: true });
      this.stopTimers();
      await this.cancelSession(this.state.session);
      this.set({ busy: false });
    }
    return true;
  }

  /**
   * Installs the device shown. `intentApplied` tells whether the category/target the person
   * chose was given to it. When the same search found other devices, the next one is shown.
   */
  public async finish(
    body: SensorOnboardingCompletionRequest,
    roomName: string,
    intentApplied = true,
  ) {
    const { session } = this.state;
    if (!session || this.state.busy) return;
    this.set({ busy: true, error: null });
    try {
      let answer: unknown = null;
      try {
        answer = await this.options.api.complete(session.id, body);
      } catch (requestError) {
        // A lost response can follow a committed installation. Check the session
        // before offering another attempt, which would report a false failure.
        const confirmed = await this.options.api.get(session.id).catch(() => null);
        if (confirmed?.status !== 'COMPLETED') throw requestError;
      }
      const next = await this.nextOfSearch(session, answer);
      if (this.disposed) return;
      if (next) {
        const { queue } = this.state;
        this.deviceSeen = true;
        this.set({
          queue: {
            installed: queue.installed + 1,
            intentUsed: queue.intentUsed || intentApplied,
            previous: { name: body.name ?? '', room: roomName },
          },
        });
        this.adopt(next);
        return;
      }
      this.set({
        session: { ...session, status: 'COMPLETED' },
        installed: { name: body.name ?? '', room: roomName },
        phase: 'DONE',
      });
    } catch (error) {
      this.set({ error: this.options.classifyError(error) });
    } finally {
      this.set({ busy: false });
    }
  }

  /** The session of the next device found by the same search, if any. */
  private async nextOfSearch(
    installed: PairingSession,
    answer: unknown,
  ): Promise<PairingSession | null> {
    const next =
      answer && typeof answer === 'object'
        ? // Boxes older than the queue answer without `nextSession`: nothing follows.
          ((answer as SensorOnboardingCompletionResult).nextSession ?? null)
        : // The answer was lost: ask the box which installation is current now.
          await this.options.api.current().catch(() => null);
    return next && next.id !== installed.id && isActiveOnboardingStatus(next.status) ? next : null;
  }

  /** The screen disappeared without a clean close (app killed, swipe back): best effort stop. */
  public abandon() {
    const { session, phase } = this.state;
    if (phase !== 'DONE' && session) void this.cancelSession(session);
    else if (phase !== 'DONE' && this.startUnanswered) void this.cancelSession(null);
    this.dispose();
  }

  public dispose() {
    this.disposed = true;
    this.stopTimers();
    this.listeners.clear();
  }
}
