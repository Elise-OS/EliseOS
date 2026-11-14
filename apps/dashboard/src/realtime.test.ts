import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeRealtime } from './realtime';

class FakeEventSource {
  public static instances: FakeEventSource[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public closed = false;
  public constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  public close(): void {
    this.closed = true;
  }
  public emit(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe('subscribeRealtime', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shares one connection between every screen and closes it with the last one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeRealtime(first);
    const stopSecond = subscribeRealtime(second);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe('/api/v1/events');

    FakeEventSource.instances[0]!.emit('{"type":"alerts"}');
    expect(first).toHaveBeenCalledWith('{"type":"alerts"}');
    expect(second).toHaveBeenCalledWith('{"type":"alerts"}');

    stopFirst();
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    stopSecond();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it('tells a screen joining an open connection that it is connected', async () => {
    const stopFirst = subscribeRealtime(vi.fn());
    FakeEventSource.instances[0]!.emit('{"type":"connected"}');
    const late = vi.fn();
    const stopLate = subscribeRealtime(late);
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith('{"type":"connected"}');
    stopFirst();
    stopLate();
  });

  it('opens a new connection after everything was closed', () => {
    subscribeRealtime(vi.fn())();
    const stop = subscribeRealtime(vi.fn());
    expect(FakeEventSource.instances).toHaveLength(2);
    stop();
  });
});
