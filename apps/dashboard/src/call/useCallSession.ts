import type { ScreenJoin } from '@elise/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface CallSession {
  callId: string;
  join?: ScreenJoin;
  /** The Élise API could not prepare the room. */
  joinFailed?: boolean;
  /** The call is over: "Call ended" stays on screen for a moment. */
  ended?: boolean;
}

/** How long "Call ended" stays before going back to the previous screen. */
export const CALL_ENDED_LINGER_MS = 4_000;

/** Pure transition used by useCallSession (exported for the tests). */
export function nextSession(
  session: CallSession | undefined,
  callId: string | null,
  active: boolean,
): CallSession | undefined {
  if (active && callId) {
    // The same call keeps its session; another one replaces whatever was there.
    return session && session.callId === callId && !session.ended ? session : { callId };
  }
  if (!session || session.ended) return session;
  // The call disappeared: show "Call ended" if the room was open, otherwise just close.
  return session.join ? { ...session, ended: true } : undefined;
}

/**
 * One Élise call as a screen session: opens when the call is accepted, fetches the Jitsi room,
 * and keeps a short "Call ended" moment when the call disappears (hung up on either side).
 * A new call never reuses the previous room. While `known` is false (Élise unreachable) the
 * session is left as it is: Jitsi shows its own reconnection and the call can carry on.
 */
export function useCallSession({
  callId,
  active,
  known = true,
  fetchJoin,
  lingerMs = CALL_ENDED_LINGER_MS,
}: {
  callId: string | null;
  active: boolean;
  known?: boolean;
  fetchJoin: (callId: string) => Promise<ScreenJoin>;
  lingerMs?: number;
}) {
  const [session, setSession] = useState<CallSession>();
  const fetcher = useRef(fetchJoin);
  fetcher.current = fetchJoin;

  useEffect(() => {
    if (!known) return;
    setSession((current) => nextSession(current, callId, active));
  }, [callId, active, known]);

  const pending = session && !session.join && !session.joinFailed && !session.ended;
  useEffect(() => {
    if (!pending || !session) return;
    const id = session.callId;
    let cancelled = false;
    fetcher
      .current(id)
      .then((join) => {
        if (!cancelled) setSession((s) => (s?.callId === id && !s.ended ? { ...s, join } : s));
      })
      .catch(() => {
        if (!cancelled)
          setSession((s) => (s?.callId === id && !s.ended ? { ...s, joinFailed: true } : s));
      });
    return () => {
      cancelled = true;
    };
  }, [pending, session?.callId]);

  useEffect(() => {
    if (!session?.ended) return;
    const id = session.callId;
    const timer = window.setTimeout(
      () => setSession((s) => (s?.ended && s.callId === id ? undefined : s)),
      lingerMs,
    );
    return () => window.clearTimeout(timer);
  }, [session?.ended, session?.callId, lingerMs]);

  const retryJoin = useCallback(
    () => setSession((s) => (s && !s.ended ? { callId: s.callId } : s)),
    [],
  );
  /** Hung up here: keep "Call ended" for a moment, whatever the API answers. */
  const end = useCallback(() => setSession((s) => (s && !s.ended ? { ...s, ended: true } : s)), []);
  return { session, retryJoin, end };
}
