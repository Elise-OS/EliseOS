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
  bannerMessage,
  bannerTone,
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
import { setLanguage } from './i18n';

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
