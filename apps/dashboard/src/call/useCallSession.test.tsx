// @vitest-environment jsdom
import type { ScreenJoin } from '@elise/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextSession, useCallSession, type CallSession } from './useCallSession';

/** Runs a change inside act() and lets pending promises settle. */
const step = (change: () => unknown) =>
  act(async () => {
    change();
    await Promise.resolve();
  });

const join: ScreenJoin = { url: 'https://jitsi.test', room: 'r1', jwt: 'x', name: 'Paul' };

describe('nextSession', () => {
  it('opens a session when the call is accepted and keeps it', () => {
    const opened = nextSession(undefined, 'c1', true);
    expect(opened).toEqual({ callId: 'c1' });
    expect(nextSession(opened, 'c1', true)).toBe(opened);
  });

  it('ends an open room with "Call ended", closes one that never opened', () => {
    expect(nextSession({ callId: 'c1', join }, null, false)).toEqual({
      callId: 'c1',
      join,
      ended: true,
    });
    expect(nextSession({ callId: 'c1' }, null, false)).toBeUndefined();
    expect(nextSession(undefined, 'c1', false)).toBeUndefined();
  });

  it('never reuses the previous room for a new call', () => {
    const ended: CallSession = { callId: 'c1', join, ended: true };
    expect(nextSession(ended, 'c2', true)).toEqual({ callId: 'c2' });
    expect(nextSession({ callId: 'c1', join }, 'c2', true)).toEqual({ callId: 'c2' });
    // A ringing (not yet accepted) new call leaves "Call ended" in place.
    expect(nextSession(ended, 'c2', false)).toBe(ended);
  });
});

describe('useCallSession', () => {
  let root: Root;
  let host: HTMLDivElement;
  let latest: ReturnType<typeof useCallSession> | undefined;
  function Probe(props: Parameters<typeof useCallSession>[0]) {
    latest = useCallSession(props);
    return null;
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement('div');
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('fetches the room, then lingers on "Call ended" before closing', async () => {
    const fetchJoin = vi.fn().mockResolvedValue(join);
    await step(() => root.render(<Probe callId="c1" active fetchJoin={fetchJoin} />));
    expect(fetchJoin).toHaveBeenCalledWith('c1');
    expect(latest?.session).toEqual({ callId: 'c1', join });
    await step(() =>
      root.render(<Probe callId={null} active={false} fetchJoin={fetchJoin} lingerMs={4000} />),
    );
    expect(latest?.session?.ended).toBe(true);
    await step(() => vi.advanceTimersByTime(4000));
    expect(latest?.session).toBeUndefined();
  });

  it('keeps the call while Élise is unreachable', async () => {
    const fetchJoin = vi.fn().mockResolvedValue(join);
    await step(() => root.render(<Probe callId="c1" active fetchJoin={fetchJoin} />));
    await step(() =>
      root.render(<Probe callId={null} active={false} known={false} fetchJoin={fetchJoin} />),
    );
    expect(latest?.session).toEqual({ callId: 'c1', join });
  });

  it('reports a room that could not be prepared and retries it', async () => {
    const fetchJoin = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(join);
    await step(() => root.render(<Probe callId="c1" active fetchJoin={fetchJoin} />));
    expect(latest?.session?.joinFailed).toBe(true);
    await step(() => latest?.retryJoin());
    expect(fetchJoin).toHaveBeenCalledTimes(2);
    expect(latest?.session).toEqual({ callId: 'c1', join });
  });
});
