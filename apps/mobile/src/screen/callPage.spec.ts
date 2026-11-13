import { Script } from 'node:vm';
import { eliseMobileCallConfig } from '@elise/contracts';
import { describe, expect, it } from 'vitest';
import { callPage, JITSI_FRAME_CSS, mobileCallOptions } from './callPage';

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
      'hangup',
      'layout',
      'sync',
    ])
      expect(page.html).toContain(`${command}:`);
    expect(page.html).toContain("api.executeCommand('hangup')");
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
