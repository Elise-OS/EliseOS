// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { ResidentVideo } from './ResidentVideo';
import { hasPhysicalMicrophone } from './ResidentScreen';
import { ARTE_LIVE_URL, youtubeVideoId, type ScreenMedia } from '@michel/contracts';

const hlsMocks = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('hls.js', () => ({
  default: class {
    static isSupported() {
      return true;
    }
    static Events = { ERROR: 'error' };
    loadSource = hlsMocks.loadSource;
    attachMedia = hlsMocks.attachMedia;
    destroy = hlsMocks.destroy;
    on() {}
  },
}));

describe('resident microphone detection', () => {
  const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
    ({ kind, deviceId, label, groupId: '', toJSON: () => ({}) }) as MediaDeviceInfo;

  it('ignores virtual and built-in audio inputs when no physical microphone is attached', () => {
    expect(
      hasPhysicalMicrophone([
        device('audioinput', 'default', 'Default'),
        device('audioinput', 'analog-input', 'Built-in Audio Analog Stereo'),
        device('audioinput', 'monitor', 'Monitor of HDMI Audio'),
      ]),
    ).toBe(false);
  });

  it('recognizes a USB microphone or a webcam microphone', () => {
    expect(hasPhysicalMicrophone([device('audioinput', 'usb-1', 'USB Microphone')])).toBe(true);
    expect(hasPhysicalMicrophone([device('audioinput', 'cam-1', 'HD Pro Webcam C920')])).toBe(true);
  });
});

describe('resident video playback', () => {
  let host: HTMLDivElement;
  let root: Root;
  let events: Record<string, (event: { target?: unknown; data?: number }) => void>;
  const player = {
    loadPlaylist: vi.fn(),
    cuePlaylist: vi.fn(),
    setVolume: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    nextVideo: vi.fn(),
    destroy: vi.fn(),
  };
  const status = vi.fn();
  const playMock = vi.fn<() => Promise<void>>();
  const pauseMock = vi.fn();
  const media: ScreenMedia = {
    id: 'd108520f-6129-4b1b-b69d-a838471667f9',
    title: 'Concerts',
    kind: 'youtube',
    url: 'https://youtu.be/M7lc1UVf-VE',
    playlistUrls: ['https://youtu.be/M7lc1UVf-VE', 'https://www.youtube.com/watch?v=bHQqvYy5KYo'],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    events = {};
    Object.assign(window, {
      YT: {
        Player: class {
          constructor(_element: HTMLElement, options: { events: typeof events }) {
            events = options.events;
            return player;
          }
        },
      },
    });
    playMock.mockReset().mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    delete (window as typeof window & { YT?: unknown }).YT;
  });
  const render = async (paused = false, nextCommandId?: string) => {
    await act(async () => {
      await Promise.resolve();
      root.render(
        <ResidentVideo
          media={media}
          paused={paused}
          volume={35}
          nextCommandId={nextCommandId}
          onStatus={status}
        />,
      );
    });
  };
  it('queues links in order and controls pause, resume, volume and next without restarting', async () => {
    await render();
    expect(host.querySelector('iframe')?.referrerPolicy).toBe('strict-origin-when-cross-origin');
    await act(async () => {
      await Promise.resolve();
      events.onReady!({ target: player });
      events.onStateChange!({ data: 1 });
    });
    expect(player.loadPlaylist).toHaveBeenCalledWith(['M7lc1UVf-VE', 'bHQqvYy5KYo']);
    expect(player.setVolume).toHaveBeenCalledWith(35);
    await render(true);
    expect(player.pauseVideo).toHaveBeenCalled();
    await render(false, 'next-1');
    await render(false, 'next-1');
    expect(player.nextVideo).toHaveBeenCalledTimes(1);
    expect(player.loadPlaylist).toHaveBeenCalledTimes(1);
    expect(player.playVideo).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
      events.onAutoplayBlocked!({});
    });
    expect(status).toHaveBeenLastCalledWith('error');
  });
  it('cues instead of playing when mounted during an interruption', async () => {
    await render(true);
    await act(async () => {
      await Promise.resolve();
      events.onReady!({ target: player });
    });
    expect(player.cuePlaylist).toHaveBeenCalledWith(['M7lc1UVf-VE', 'bHQqvYy5KYo']);
    expect(player.loadPlaylist).not.toHaveBeenCalled();
  });
  it('loads ARTE using HLS and releases the decoder on stop', async () => {
    await act(async () => {
      await Promise.resolve();
      root.render(
        <ResidentVideo
          media={{ ...media, kind: 'tv', url: ARTE_LIVE_URL, playlistUrls: undefined }}
          paused={false}
          volume={30}
          onStatus={status}
        />,
      );
    });
    expect(hlsMocks.loadSource).toHaveBeenCalledWith(ARTE_LIVE_URL);
    expect(hlsMocks.attachMedia).toHaveBeenCalledWith(host.querySelector('video'));
    await act(async () => {
      await Promise.resolve();
      root.render(null);
    });
    expect(hlsMocks.destroy).toHaveBeenCalled();
  });
  it('starts muted when the browser blocks audible autoplay, and confirms only real playback', async () => {
    const play = playMock;
    play
      .mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'))
      .mockResolvedValue();
    await act(async () => {
      await Promise.resolve();
      root.render(
        <ResidentVideo
          media={{ ...media, kind: 'tv', url: ARTE_LIVE_URL, playlistUrls: undefined }}
          paused={false}
          volume={30}
          onStatus={status}
        />,
      );
    });
    expect(play).not.toHaveBeenCalled();
    const video = host.querySelector('video')!;
    await act(async () => {
      video.dispatchEvent(new Event('canplay'));
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(true);
    expect(status).toHaveBeenLastCalledWith('loading');
    expect(host.textContent).toContain('Activer le son');
    await act(async () => {
      video.dispatchEvent(new Event('playing'));
      await Promise.resolve();
    });
    expect(status).toHaveBeenLastCalledWith('ready');
    await act(async () => {
      host.querySelector('button')!.click();
      await Promise.resolve();
    });
    expect(video.muted).toBe(false);
    expect(host.querySelector('button')).toBeNull();
  });
  it('waits for a decodable stream before playing and pauses during an interruption', async () => {
    const arte = { ...media, kind: 'tv' as const, url: ARTE_LIVE_URL, playlistUrls: undefined };
    await act(async () => {
      await Promise.resolve();
      root.render(<ResidentVideo media={arte} paused={false} volume={30} onStatus={status} />);
    });
    expect(playMock).not.toHaveBeenCalled();
    await act(async () => {
      host.querySelector('video')!.dispatchEvent(new Event('canplay'));
      await Promise.resolve();
    });
    expect(playMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(<ResidentVideo media={arte} paused={true} volume={30} onStatus={status} />);
      await Promise.resolve();
    });
    expect(pauseMock).toHaveBeenCalled();
  });
  it('accepts regular, short and live video links, rejects playlists without a video', () => {
    expect(youtubeVideoId('https://www.youtube.com/live/M7lc1UVf-VE')).toBe('M7lc1UVf-VE');
    expect(youtubeVideoId('https://www.youtube.com/shorts/M7lc1UVf-VE')).toBe('M7lc1UVf-VE');
    expect(youtubeVideoId('https://www.youtube.com/playlist?list=123')).toBeNull();
    expect(youtubeVideoId('https://youtube.com.evil.test/watch?v=M7lc1UVf-VE')).toBeNull();
  });
});
