import { Script } from 'node:vm';
import { eliseMobileCallConfig } from '@elise/contracts';
import { describe, expect, it } from 'vitest';
import { callPage, FIT_VIDEO_JS, JITSI_FRAME_CSS, mobileCallOptions } from './callPage';

const join = {
  url: 'https://box.tail1234.ts.net:8444',
  room: 'elise-room',
  jwt: 'a.b.c',
  name: 'Paul </script><script>alert(1)</script>',
};

describe('mobileCallOptions', () => {
  it('joins with the camera and microphone on and without any Jitsi UI', () => {
    const options = mobileCallOptions(join);
    expect(options.roomName).toBe('elise-room');
    expect(options.jwt).toBe('a.b.c');
    expect(options.configOverwrite.startWithAudioMuted).toBe(false);
    expect(options.configOverwrite.startWithVideoMuted).toBe(false);
    expect(options.configOverwrite.toolbarButtons).toEqual([]);
    expect(options.configOverwrite.filmstrip.disabled).toBe(true);
    expect(options.configOverwrite.prejoinConfig.enabled).toBe(false);
    expect(options.configOverwrite.hideDisplayName).toBe(true);
    // Network and video quality settings come untouched from the shared config.
    expect(options.configOverwrite.p2p).toEqual(eliseMobileCallConfig.p2p);
    expect(options.configOverwrite.constraints).toEqual(eliseMobileCallConfig.constraints);
    expect(options.interfaceConfigOverwrite.VIDEO_LAYOUT_FIT).toBe('nocrop');
  });
});

describe('callPage', () => {
  const page = callPage(join);

  it('is served from the Jitsi origin so the app can reach into the Jitsi frame', () => {
    expect(page.baseUrl).toBe('https://box.tail1234.ts.net:8444');
    expect(page.html).toContain('"https://box.tail1234.ts.net:8444/external_api.js"');
    expect(page.html).toContain('JitsiMeetExternalAPI("box.tail1234.ts.net:8444"');
  });

  it('cannot be broken out of by a display name', () => {
    expect(page.html).not.toContain('</script><script>alert(1)');
    expect(page.html).toContain('\\u003c/script>');
  });

  it('hides the Jitsi watermark and draws its own self-view', () => {
    expect(JITSI_FRAME_CSS).toContain('.watermark');
    expect(JITSI_FRAME_CSS).toContain('#elise-self');
    expect(page.html).toContain('elise-self');
  });

  it('exposes the commands the app sends and reports every Jitsi event it needs', () => {
    for (const command of [
      'toggleAudio',
      'toggleVideo',
      'switchCamera',
      'switchSpeaker',
      'hangup',
      'layout',
      'sync',
    ])
      expect(page.html).toContain(`${command}:`);
    expect(page.html).toContain("api.executeCommand('hangup')");
    expect(page.html).toContain('api.setAudioOutputDevice(');
    expect(page.html).toContain("'audio-output'");
    for (const event of [
      'videoConferenceJoined',
      'videoConferenceLeft',
      'readyToClose',
      'participantJoined',
      'participantLeft',
      'audioMuteStatusChanged',
      'videoMuteStatusChanged',
      'cameraError',
      'micError',
      'conference.connectionInterrupted',
      'conference.connectionRestored',
      'conference.failed',
    ])
      expect(page.html).toContain(event);
  });

  it('keeps the page script valid JavaScript', () => {
    const script = page.html.split('<script>')[1]?.split('</script>')[0] ?? '';
    expect(() => new Script(script)).not.toThrow();
  });
});

type Fit = { left: number; top: number; width: number; height: number };
// The very code the page runs, evaluated on its own.
const fitVideo = new Script(`${FIT_VIDEO_JS}; fitVideo;`).runInNewContext() as (
  stageWidth: number,
  stageHeight: number,
  videoWidth: number,
  videoHeight: number,
) => Fit;

describe('fitVideo', () => {
  it('fills the stage when the picture has about the same shape', () => {
    const fit = fitVideo(390, 450, 480, 640);
    expect(fit.width).toBeGreaterThanOrEqual(390);
    expect(fit.height).toBeGreaterThanOrEqual(450);
    expect(fit.left).toBeLessThanOrEqual(0);
    expect(fit.top).toBeLessThanOrEqual(0);
  });

  it('never cuts more than a third of a landscape TV picture on an upright phone', () => {
    for (const [videoWidth, videoHeight] of [
      [640, 480],
      [1280, 720],
    ] as const) {
      const fit = fitVideo(390, 460, videoWidth, videoHeight);
      expect(fit.width / fit.height).toBeCloseTo(videoWidth / videoHeight, 5);
      expect(390 / fit.width).toBeGreaterThanOrEqual(2 / 3 - 1e-9);
      expect(fit.height).toBeLessThanOrEqual(460);
      // Wider than a letterbox: the picture is zoomed in, centred.
      expect(fit.width).toBeGreaterThan(390);
      expect(fit.left).toBeCloseTo((390 - fit.width) / 2, 5);
      expect(fit.top).toBeCloseTo((460 - fit.height) / 2, 5);
    }
  });

  it('fills the stage until the size of the picture is known', () => {
    expect(fitVideo(400, 300, 0, 0)).toEqual({ left: 0, top: 0, width: 400, height: 300 });
  });

  it('keeps the video inside the stage drawn by the app', () => {
    expect(JITSI_FRAME_CSS).toContain('#largeVideoWrapper{position:fixed!important');
    expect(JITSI_FRAME_CSS).toContain('overflow:hidden!important');
    expect(JITSI_FRAME_CSS).toContain('#elise-ambient');
  });
});
