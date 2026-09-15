import type { ScreenState } from '@michel/contracts';

export function residentMessageAt(
  state: Pick<ScreenState, 'message' | 'messages' | 'messageIntervalSeconds' | 'messageUpdatedAt'>,
  now: number,
) {
  const texts = state.messages?.length ? state.messages : state.message ? [state.message] : [];
  const seconds = Math.max(5, state.messageIntervalSeconds ?? 20);
  const elapsed = Math.max(0, now - (state.messageUpdatedAt ?? now));
  const index = texts.length ? Math.floor(elapsed / (seconds * 1000)) % texts.length : 0;
  return { text: texts[index] ?? '', index, count: texts.length };
}
