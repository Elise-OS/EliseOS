import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { handleDemoRequest, resetDemo } from './router';

const sourceDir = fileURLToPath(new URL('..', import.meta.url));

function callText(source: string, open: number) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')' && --depth === 0) return source.slice(open, index + 1);
  }
  return source.slice(open);
}

/** Every literal API call of the caregiver space and the resident screen, with sample ids. */
function calledRequests() {
  const requests = new Map<string, string>();
  for (const file of readdirSync(sourceDir)) {
    if (!/\.tsx?$/.test(file) || /\.(test|spec)\./.test(file)) continue;
    const source = readFileSync(`${sourceDir}/${file}`, 'utf8');
    const calls = source.matchAll(
      /(?:fetch|sensorRequest|screenRequest|welcomeScreenRequest)(?:<[^>]*>)?\(\s*[`'](?:\/api\/v1)?\/?([a-z][^`']*)/g,
    );
    for (const match of calls) {
      const path = `/${match[1] ?? ''}`
        .replace(/\/\$\{[^}]*\}/g, '/alert-door-open')
        .replace(/\$\{.*$/, '')
        .split('?')[0];
      // Generic helpers such as fetch(`/api/v1/${path}`) are covered through their callers;
      // screen-device routes belong to the TV kiosk identity, which the demo does not use.
      if (!path || /^\/(alert-door-open|api\/|resident-screen|screen-device\/)/.test(path))
        continue;
      // The call ends at its matching parenthesis; its method is the last quoted verb inside it.
      const call = callText(source, source.indexOf('(', match.index));
      const helper = /^(screenRequest|welcomeScreenRequest)/.test(match[0]);
      const verbs = [...call.matchAll(/'(GET|POST|PATCH|PUT|DELETE)'/g)].map((verb) => verb[1]);
      const method = verbs.at(-1) ?? (helper ? 'POST' : 'GET');
      requests.set(`${method} ${path}`, method);
    }
  }
  return [...requests.keys()].sort();
}

describe('demo router', () => {
  beforeEach(() => resetDemo());

  it('answers every API call the web app makes', () => {
    const requests = calledRequests();
    expect(requests.length).toBeGreaterThan(30);
    const missing = requests.filter((request) => {
      const [method = 'GET', path = ''] = request.split(' ');
      return handleDemoRequest(method, path, method === 'GET' ? undefined : '{}').status === 404;
    });
    expect(missing).toEqual([]);
  });

  it('shows the frozen Martin home with two open alerts', () => {
    const overview = handleDemoRequest('GET', '/overview').body as {
      home: { name: string };
      openAlerts: number;
    };
    expect(overview.home.name).toBe('Maison Martin');
    expect(overview.openAlerts).toBe(2);
  });

  it('keeps the visitor’s actions in memory until the demo restarts', () => {
    handleDemoRequest(
      'PATCH',
      '/alerts/alert-door-open',
      JSON.stringify({ status: 'ACKNOWLEDGED' }),
    );
    const alerts = handleDemoRequest('GET', '/alerts').body as Array<{
      id: string;
      status: string;
    }>;
    expect(alerts.find((alert) => alert.id === 'alert-door-open')?.status).toBe('ACKNOWLEDGED');

    handleDemoRequest(
      'PATCH',
      '/screen/message',
      JSON.stringify({ message: 'Je passe à 15 h, Claire' }),
    );
    const screen = handleDemoRequest('GET', '/screen').body as { state: { message: string } };
    expect(screen.state.message).toBe('Je passe à 15 h, Claire');

    resetDemo();
    const reset = handleDemoRequest('GET', '/alerts').body as Array<{ id: string; status: string }>;
    expect(reset.find((alert) => alert.id === 'alert-door-open')?.status).toBe('OPEN');
  });

  it('saves the alert rules and gives every alert its own evidence', () => {
    const rules = handleDemoRequest('GET', '/alerts/rules').body as {
      doorOpen: { enabled: boolean; minutes: number };
    };
    const saved = handleDemoRequest(
      'PATCH',
      '/alerts/rules',
      JSON.stringify({ ...rules, doorOpen: { enabled: true, minutes: 12 } }),
    ).body as typeof rules;
    expect(saved.doorOpen.minutes).toBe(12);
    expect((handleDemoRequest('GET', '/alerts/rules').body as typeof rules).doorOpen.minutes).toBe(
      12,
    );

    const cold = handleDemoRequest('GET', '/alerts/alert-bedroom-cold/detail').body as {
      type: string;
      sensor: { capability: string } | null;
      observations: unknown[];
    };
    expect(cold.type).toBe('TEMPERATURE');
    expect(cold.sensor?.capability).toBe('temperature');
    expect(cold.observations.length).toBeGreaterThan(3);
    resetDemo();
  });

  it('refuses actions that would leave the page', () => {
    expect(handleDemoRequest('POST', '/system/update/install', '{}').status).toBe(403);
    expect(handleDemoRequest('POST', '/cameras/camera-entry/live-session').status).toBe(403);
  });
});

describe('demo TV channels', () => {
  const guideChannels = () =>
    (
      handleDemoRequest('GET', '/screen/tv-guide').body as {
        channels: Array<{ id: string; current: { title: string } | null }>;
      }
    ).channels;
  afterEach(() => {
    setLanguage('fr');
    resetDemo();
  });

  it('shows the channels and invented programmes of the demo language', () => {
    resetDemo();
    expect(guideChannels().map(({ id }) => id)).toEqual([
      'arte',
      'rmcLife',
      'rmcStory',
      'rmcDecouverte',
    ]);
    setLanguage('es');
    resetDemo();
    // DW Español has no guide; RTVE channels blocked abroad are not offered from Paris.
    expect(guideChannels().map(({ id }) => id)).toEqual(['canal24h', 'france24Es']);
    expect(guideChannels()[0]?.current?.title).toBe('La mañana en 24h');
    setLanguage('en');
    resetDemo();
    expect(guideChannels().map(({ id }) => id)).toEqual(['dwEnglish', 'france24En', 'alJazeeraEn']);
  });

  it('follows the channels the caregiver adds', () => {
    setLanguage('es');
    resetDemo();
    handleDemoRequest(
      'PUT',
      '/screen/tv-channels',
      JSON.stringify({ added: ['arte'], removed: [] }),
    );
    expect(guideChannels().map(({ id }) => id)).toContain('arte');
  });
});
