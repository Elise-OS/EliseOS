import {
  boxHealthReportSchema,
  type BoxHealthCheck,
  type BoxHealthCheckLevel,
  type BoxHealthReport,
} from '@elise/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSentence } from './BoxHealthPanel';
import {
  KNOWN_BOX_HEALTH_CHECKS,
  backupProgress,
  backupRunningOnBox,
  bannerMessage,
  bannerTone,
  checkKey,
  orderedGroups,
  readCheck,
  readReport,
  showsAction,
  visibleSettingsTabs,
  watchBackup,
} from './box-health-view';
import {
  BOX_HEALTH_DEMO_STATES,
  boxHealthDemoAnswer,
  boxHealthDemoState,
  demoBoxHealthReport,
} from './demo/box-health';
import { setLanguage, t } from './i18n';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');
const LEVELS: BoxHealthCheckLevel[] = ['ok', 'warning', 'critical', 'unknown'];

const check = (
  id: string,
  level: BoxHealthCheckLevel,
  params: Record<string, unknown> = {},
): BoxHealthCheck => ({ id, level, params });

const report = (
  verdict: BoxHealthReport['verdict'],
  checks: BoxHealthCheck[],
): BoxHealthReport => ({
  verdict,
  checkedAt: '2026-11-14T10:00:00.000Z',
  groups: [{ id: 'box', checks }],
});

const tr = t as unknown as (key: string, options?: Record<string, unknown>) => string;

/** Every check the API sends (apps/api/src/modules/box-health/box-health.service.ts), as sent. */
const API_CHECKS: Record<string, Record<string, unknown>> = {
  disk: { percent: 38.4, dockerPercent: 31.2 },
  memory: { percent: 3.1, total: 2_097_148, kind: 'swap' },
  temperature: { celsius: [51.6, 49.8] },
  throttling: { flags: 0, applicable: true },
  containers: { containers: [{ name: 'api', health: 'healthy', restartCount: 0 }] },
  'storage-errors': { count: 0 },
  backup: { last: { at: '2026-11-14T01:00:00.000Z', ok: true }, days: 0.4 },
  worker: { state: { healthy: true, lastSeenAt: '2026-11-14T09:59:40.000Z', failingTasks: [] } },
  'home-assistant': { connected: true, lastSeenAt: '2026-11-14T09:59:00.000Z' },
  zigbee: { state: 'READY', issues: [] },
  'remote-access': { state: 'READY' },
  'sensors-offline': { count: 0, total: 9, lastSeenAt: '2026-11-14T09:58:00.000Z' },
  'sensors-battery': { percent: 86 },
  coverage: { total: 9, count: 9 },
  deliveries: { failed: 0 },
  outbox: { failed: 0, urgent: 0 },
  'last-event': { hours: 0.05, minutes: 3 },
  'db-size': { total: 152_436_736, percent: 1.2 },
};

afterEach(() => setLanguage('fr'));

describe('box health access', () => {
  it('shows the tab only to people who manage the configuration', () => {
    expect(visibleSettingsTabs(['configuration:manage'])).toContain('health');
    expect(visibleSettingsTabs(['configuration:read', 'alerts:manage'])).not.toContain('health');
    expect(visibleSettingsTabs([])).toEqual(['general', 'rules']);
  });
});

describe('box health reading', () => {
  it('never turns an unreadable value into « OK »', () => {
    for (const item of [
      check('disk', 'ok', { usedPercent: null }),
      check('temperature', 'ok', { celsius: [] }),
      check('zigbee', 'ok', { available: false }),
      check('database', 'ok', { sizeBytes: null }),
      check('backup', 'ok', { last: { ok: true } }),
      check('containers', 'ok', { containers: 'up' }),
    ])
      expect(readCheck(item, NOW).level, item.id).toBe('unknown');
    const raised = readReport(report('ok', [check('disk', 'ok', { usedPercent: null })]), NOW);
    expect(bannerTone(raised, false)).toBe('warning');
    expect(bannerMessage(raised, false)).toBe('warningUnknown');
  });

  it('never claims all is well without an answer', () => {
    expect(bannerTone(null, false)).toBe('unverifiable');
    expect(bannerTone(report('ok', [check('disk', 'ok', { usedPercent: 3 })]), true)).toBe(
      'unverifiable',
    );
    expect(bannerTone(report('ok', []), false)).toBe('warning');
  });

  it('orders the groups of the API and keeps unknown ones at the end', () => {
    const ordered = orderedGroups({
      verdict: 'ok',
      checkedAt: '',
      groups: [
        { id: 'access', checks: [check('remote-access', 'ok')] },
        { id: 'later', checks: [check('x', 'ok')] },
        { id: 'surveillance', checks: [check('worker', 'ok')] },
      ],
    });
    expect(ordered.map((group) => group.id)).toEqual(['surveillance', 'access', 'later']);
  });

  it('keeps a calm report calm: places are offered only when a row asks for attention', () => {
    expect(showsAction({ ...check('zigbee', 'ok'), action: 'open-zigbee' })).toBe(false);
    expect(showsAction({ ...check('zigbee', 'unknown'), action: 'open-zigbee' })).toBe(true);
    expect(showsAction({ ...check('backup', 'ok'), action: 'run-backup' })).toBe(true);
  });
});

describe('box health sentences', () => {
  it('has a sentence for every check and level, in every language', () => {
    for (const language of ['fr', 'en', 'es', 'it', 'pt'] as const) {
      setLanguage(language);
      for (const id of [...KNOWN_BOX_HEALTH_CHECKS, 'mystery'])
        for (const level of LEVELS) {
          const text = checkSentence(check(id, level), NOW);
          expect(text, `${language} ${id} ${level}`).not.toMatch(/boxHealth\.|\{\{/);
          expect(text, `${language} ${id} ${level}`).not.toBe('');
        }
    }
  });

  it('speaks plainly, with the figures of the box', () => {
    setLanguage('fr');
    expect(checkSentence(check('temperature', 'warning', { celsius: [71.6, 64] }), NOW)).toBe(
      'La box chauffe un peu (72\u202f°C). Laissez-lui de l’air autour.',
    );
    expect(
      checkSentence(
        check('backup', 'ok', { last: { at: '2026-11-14T01:00:00.000Z', ok: true } }),
        NOW,
      ),
    ).toBe('Dernière sauvegarde réussie il y a 9 heures.');
    expect(checkSentence(check('throttling', 'ok', { flags: null }), NOW)).toBe(
      'Impossible de savoir si la box ralentit. C’est normal sur certains modèles.',
    );
    expect(checkSentence(check('mystery', 'warning'), NOW)).toBe(
      'mystery : à surveiller, sans urgence.',
    );
  });
});

describe('the checks of the real API', () => {
  it('gives every check of the API a name in every language, never its raw id', () => {
    for (const language of ['fr', 'en', 'es', 'it', 'pt'] as const) {
      setLanguage(language);
      for (const id of Object.keys(API_CHECKS)) {
        const key = checkKey(id);
        expect(key, id).not.toBeNull();
        const label = tr(`boxHealth.check.${key}.label`);
        expect(label, `${language} ${id}`).not.toContain('boxHealth.');
        expect(label, `${language} ${id}`).not.toBe(id);
        for (const level of LEVELS) {
          const text = checkSentence(check(id, level, API_CHECKS[id]), NOW);
          expect(text, `${language} ${id} ${level}`).not.toMatch(/boxHealth\.|\{\{/);
          expect(text, `${language} ${id} ${level}`).not.toContain(`${id} :`);
        }
      }
    }
  });

  it('reads an ok report of the API as ok', () => {
    for (const [id, params] of Object.entries(API_CHECKS))
      expect(readCheck(check(id, 'ok', params), NOW).level, id).toBe('ok');
    expect(
      readCheck(check('throttling', 'ok', { flags: null, applicable: false }), NOW).level,
    ).toBe('ok');
  });

  it('tells the new checks with their figures', () => {
    setLanguage('fr');
    expect(checkSentence(check('sensors-offline', 'warning', { count: 2, total: 9 }), NOW)).toBe(
      '2 capteurs ne donnent plus de nouvelles.',
    );
    expect(checkSentence(check('coverage', 'ok', { total: 9, count: 9 }), NOW)).toBe(
      '9 capteurs sur 9 répondent.',
    );
    expect(checkSentence(check('coverage', 'warning', { total: 9, count: 0 }), NOW)).toBe(
      'Aucun capteur ne répond : la maison n’est plus surveillée.',
    );
    expect(checkSentence(check('last-event', 'critical', { hours: 13, minutes: 780 }), NOW)).toBe(
      'Aucun signal des capteurs depuis 13 heures : vérifiez que tout va bien à la maison.',
    );
    expect(checkSentence(check('memory', 'warning', { percent: 63.5, kind: 'swap' }), NOW)).toBe(
      'La box puise dans sa mémoire de secours (64\u202f%) : elle peut ralentir un peu.',
    );
  });

  it('never shows an unreadable value of the new checks as fine', () => {
    for (const item of [
      check('home-assistant', 'ok', { connected: null }),
      check('sensors-offline', 'ok', { count: null }),
      check('sensors-battery', 'ok', { percent: null }),
      check('coverage', 'ok', { total: 3, count: 5 }),
      check('last-event', 'ok', { minutes: null }),
      check('zigbee', 'ok', { state: null }),
      check('db-size', 'ok', { total: null }),
    ])
      expect(readCheck(item, NOW).level, item.id).toBe('unknown');
  });
});

describe('box health backup', () => {
  it('waits for a newer backup, then says how it went', () => {
    const before = demoBoxHealthReport('warning', NOW);
    const watch = watchBackup(before, NOW);
    expect(backupProgress(watch, before, NOW + 5_000)).toBe('running');
    expect(backupProgress(watch, demoBoxHealthReport('warning', NOW, NOW + 8_000), NOW)).toBe(
      'done',
    );
    expect(backupProgress(watch, before, NOW + 11 * 60_000)).toBe('timeout');
  });

  it('shows a backup the box says is running, even one started elsewhere', () => {
    const idle = demoBoxHealthReport('warning', NOW);
    const busy = demoBoxHealthReport('warning', NOW, null, true);
    expect(backupRunningOnBox(null)).toBe(false);
    expect(backupRunningOnBox(idle)).toBe(false);
    expect(backupRunningOnBox({ ...idle, backup: undefined })).toBe(false);
    expect(backupRunningOnBox(busy)).toBe(true);
    // While the box is still working, a long backup is not called late.
    expect(backupProgress(watchBackup(idle, NOW), busy, NOW + 11 * 60_000)).toBe('running');
    expect(boxHealthDemoAnswer('GET', '/system/box-health', 'backup', NOW)).toMatchObject({
      body: { backup: { running: true } },
    });
  });
});

describe('box health demo', () => {
  it('answers like the real API, in every state asked in the address', () => {
    expect(boxHealthDemoState('?boxHealth=critical')).toBe('critical');
    expect(boxHealthDemoState('?boxHealth=nope')).toBe('warning');
    for (const state of BOX_HEALTH_DEMO_STATES) {
      const answer = boxHealthDemoAnswer('GET', '/system/box-health', state, NOW);
      if (state === 'loading') expect(answer).toBe('pending');
      else if (state === 'error') expect(answer).toMatchObject({ status: 503 });
      else {
        expect(answer).toMatchObject({ status: 200 });
        const parsed = boxHealthReportSchema.parse((answer as { body: unknown }).body);
        expect(parsed.verdict).toBe(
          state === 'ok' ? 'ok' : state === 'critical' ? 'critical' : 'warning',
        );
      }
    }
    const levels = readReport(demoBoxHealthReport('warning', NOW), NOW).groups.flatMap((group) =>
      group.checks.map((item) => item.level),
    );
    expect(levels).toEqual(expect.arrayContaining(['unknown', 'warning', 'ok']));
    expect(boxHealthDemoAnswer('GET', '/system/health', 'warning', NOW)).toBeNull();
  });

  it('accepts a backup with 202 and shows it once done', () => {
    expect(boxHealthDemoAnswer('POST', '/system/box-health/backup', 'warning', NOW)).toEqual({
      status: 202,
      body: { accepted: true },
    });
    const later = boxHealthDemoAnswer('GET', '/system/box-health', 'warning', NOW + 9_000);
    const backup = (later as { body: BoxHealthReport }).body.groups
      .flatMap((group) => group.checks)
      .find((item) => item.id === 'backup');
    expect(backup?.level).toBe('ok');
  });
});
