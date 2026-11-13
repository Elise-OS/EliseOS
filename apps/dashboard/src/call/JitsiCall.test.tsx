// @vitest-environment jsdom
import type { ScreenJoin } from '@elise/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JitsiCall } from './JitsiCall';

/** Runs a change inside act() and lets pending promises settle. */
const step = (change: () => unknown) =>
  act(async () => {
    change();
    await Promise.resolve();
  });

const join: ScreenJoin = { url: 'https://jitsi.test:8444', room: 'room1', jwt: 'jwt', name: 'TV' };

/** Stand-in for Jitsi's External API: records commands, lets the test fire events. */
class FakeJitsi {
  static last: FakeJitsi | undefined;
  listeners = new Map<string, Array<(payload: unknown) => void>>();
  commands: string[] = [];
  frame = document.createElement('iframe');
  disposed = false;
  constructor(
    public domain: string,
    public options: Record<string, unknown>,
  ) {
    FakeJitsi.last = this;
    (options.parentNode as HTMLElement).append(this.frame);
  }
  addEventListener(event: string, listener: (payload: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  executeCommand(command: string) {
    this.commands.push(command);
  }
  isAudioMuted() {
    return Promise.resolve(false);
  }
  isVideoMuted() {
    return Promise.resolve(false);
  }
  getIFrame() {
    return this.frame;
  }
  dispose() {
    this.disposed = true;
  }
  emit(event: string, payload: unknown = {}) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

describe('Élise call screen driven by Jitsi', () => {
  let root: Root;
  let host: HTMLDivElement;
  const jitsi = () => FakeJitsi.last!;
  const emit = async (event: string, payload?: unknown) => {
    await step(() => jitsi().emit(event, payload));
  };
  const button = (label: string) =>
    Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.assign(window, { JitsiMeetExternalAPI: FakeJitsi });
    FakeJitsi.last = undefined;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI;
  });

  const open = async (props: Partial<Parameters<typeof JitsiCall>[0]> = {}) => {
    const onHangup = vi.fn();
    await step(() =>
      root.render(
        <JitsiCall
          variant="tv"
          join={join}
          peerName="Paul"
          onHangup={onHangup}
          selfView={false}
          {...props}
        />,
      ),
    );
    return onHangup;
  };

  it('hides every piece of Jitsi interface and keeps the iframe out of the remote focus', async () => {
    await open();
    const options = jitsi().options as {
      configOverwrite: Record<string, unknown>;
      interfaceConfigOverwrite: Record<string, unknown>;
    };
    expect(jitsi().domain).toBe('jitsi.test:8444');
    expect(options.configOverwrite).toMatchObject({
      toolbarButtons: [],
      prejoinConfig: { enabled: false },
      filmstrip: { disabled: true },
      hideDisplayName: true,
      notifications: [],
      conferenceInfo: { alwaysVisible: [], autoHide: [] },
      // Quality settings still come from call-quality.ts.
      p2p: expect.objectContaining({ enabled: true }) as unknown,
      disableSimulcast: true,
    });
    expect(options.interfaceConfigOverwrite).toMatchObject({ VIDEO_LAYOUT_FIT: 'nocrop' });
    expect(jitsi().frame.tabIndex).toBe(-1);
  });

  it('never shows the mirror image while waiting, then shows the other person', async () => {
    await open();
    expect(host.textContent).toContain('Connexion');
    await emit('videoConferenceJoined');
    expect(host.textContent).toContain('En attente de Paul');
    expect(host.querySelector('.call__video.is-visible')).toBeNull();
    await emit('participantJoined', { id: 'p1', displayName: 'Paul' });
    expect(host.querySelector('.call__video.is-visible')).not.toBeNull();
    expect(host.textContent).toContain('En appel');
    await emit('participantLeft', { id: 'p1' });
    expect(host.querySelector('.call__video.is-visible')).toBeNull();
    expect(host.textContent).toContain('La connexion avec Paul est coupée');
  });

  it('drives Jitsi from the single Élise bar and shows the real mute state', async () => {
    await open();
    await emit('videoConferenceJoined');
    await emit('participantJoined', { id: 'p1' });
    await step(() => button('Micro').click());
    await step(() => button('Caméra').click());
    expect(jitsi().commands).toEqual(['toggleAudio', 'toggleVideo']);
    // Nothing changes until Jitsi confirms.
    expect(button('Micro').getAttribute('aria-pressed')).toBe('false');
    await emit('audioMuteStatusChanged', { muted: true });
    expect(button('Micro coupé').getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('Votre micro est coupé : Paul ne vous entend pas.');
  });

  it('really hangs up in Jitsi, then ends the Élise call once', async () => {
    const onHangup = await open();
    await emit('videoConferenceJoined');
    await emit('participantJoined', { id: 'p1' });
    await step(() => button('Raccrocher').click());
    expect(jitsi().commands).toContain('hangup');
    expect(host.textContent).toContain('Appel terminé');
    await emit('videoConferenceLeft');
    await emit('readyToClose');
    expect(onHangup).toHaveBeenCalledTimes(1);
  });

  it('never lets a room still opening join once the call was hung up', async () => {
    vi.useFakeTimers();
    try {
      const onHangup = await open();
      await step(() => button('Raccrocher').click());
      expect(onHangup).toHaveBeenCalledTimes(1);
      await step(() => vi.runOnlyPendingTimers());
      expect(jitsi().disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a joined room before closing Jitsi', async () => {
    vi.useFakeTimers();
    try {
      await open();
      await emit('videoConferenceJoined');
      await step(() => button('Raccrocher').click());
      await emit('readyToClose');
      expect(jitsi().disposed).toBe(false);
      await step(() => vi.advanceTimersByTime(2_000));
      expect(jitsi().disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the room quietly when the other side ended the call', async () => {
    const onHangup = await open();
    await emit('videoConferenceJoined');
    await emit('participantJoined', { id: 'p1' });
    await step(() =>
      root.render(<JitsiCall variant="tv" join={join} peerName="Paul" onHangup={onHangup} ended />),
    );
    expect(jitsi().commands).toContain('hangup');
    expect(host.textContent).toContain('Appel terminé');
    expect(onHangup).not.toHaveBeenCalled();
  });

  it('shows a refused camera and keeps its button unavailable', async () => {
    await open();
    await emit('videoConferenceJoined');
    await emit('participantJoined', { id: 'p1' });
    await emit('cameraError', { type: 'gum.permission_denied' });
    expect(button('Pas de caméra').disabled).toBe(true);
    expect(host.textContent).toContain('La caméra ne répond pas');
  });

  it('offers "Try again" when the room cannot be prepared', async () => {
    const onRetryJoin = vi.fn();
    await open({ join: undefined, joinFailed: true, onRetryJoin });
    expect(host.textContent).toContain('L’appel n’a pas pu s’ouvrir');
    await step(() => button('Réessayer').click());
    expect(onRetryJoin).toHaveBeenCalled();
  });

  it('moves between the buttons with the remote arrows, starting on "Hang up"', async () => {
    await open();
    await emit('videoConferenceJoined');
    await emit('participantJoined', { id: 'p1' });
    expect(document.activeElement?.textContent).toContain('Raccrocher');
    const toolbar = host.querySelector('[role="toolbar"]')!;
    await step(() => {
      toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain('Caméra');
    await step(() => {
      toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain('Micro');
  });

  it('marks the devices the TV does not have', async () => {
    await open({ devices: { camera: false, microphone: true } });
    expect((jitsi().options.configOverwrite as Record<string, unknown>).startWithVideoMuted).toBe(
      true,
    );
    await emit('videoConferenceJoined');
    expect(button('Pas de caméra').disabled).toBe(true);
  });
});
