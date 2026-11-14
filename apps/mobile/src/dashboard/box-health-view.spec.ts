import {
  boxHealthReportSchema,
  type BoxHealthCheck,
  type BoxHealthCheckLevel,
  type BoxHealthReport,
} from '@elise/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../i18n';
import { BOX_HEALTH_DEMO_STATES, demoBoxHealthReport } from '../demo/box-health';
import {
  BACKUP_WATCH_MS,
  BOX_HEALTH_CHECK_IDS,
  actionDestination,
  backupProgress,
  bannerOf,
  canManageBox,
  durationParts,
  groupTone,
  isUsableSentence,
  orderedGroups,
  readCheck,
  readReport,
  sentenceKeys,
  sizeParts,
  technicalLines,
  toneOf,
  watchBackup,
} from './box-health-view';

const LEVELS: BoxHealthCheckLevel[] = ['ok', 'warning', 'critical', 'unknown'];
const NOW = Date.parse('2026-11-14T10:00:00.000Z');
const tr = t as unknown as (key: string, options?: Record<string, unknown>) => string;

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

/** Same resolution as the panel, without React Native. */
function sentence(item: BoxHealthCheck) {
  const reading = readCheck(item, NOW);
  const values: Record<string, unknown> = { ...reading.values };
  if (reading.duration)
    values.duration = tr(`boxHealth.duration.${reading.duration.unit}`, {
      count: reading.duration.count,
    });
  if (reading.size)
    values.size = tr(`boxHealth.size.${reading.size.unit}`, { value: reading.size.value });
  for (const path of sentenceKeys(item, reading)) {
    const text = tr(`boxHealth.${path}`, values);
    if (isUsableSentence(text, `boxHealth.${path}`)) return text;
  }
  return '';
}

/** Params as the real API sends them, one readable set per check. */
const REAL_PARAMS: Record<string, Record<string, unknown>> = {
  worker: {
    state: { healthy: false, lastSeenAt: '2026-11-14T09:40:00.000Z', failingTasks: [] },
  },
  zigbee: { available: true },
  sensors: { count: 9 },
  notifications: { failed24h: 2 },
  outbox: { failed: 1 },
  disk: { usedPercent: 81.6 },
  swap: { usedPercent: 12 },
  temperature: { celsius: [48.2, 52.9] },
  throttling: { flags: 0 },
  containers: { containers: [{ name: 'api', health: 'healthy', restartCount: 2 }] },
  'disk-errors': { count: 3 },
  backup: { last: { at: '2026-11-10T10:00:00.000Z', ok: true, sizeBytes: 1000 } },
  database: { sizeBytes: 152_436_736 },
  'remote-access': { available: true },
};

afterEach(() => setLanguage('fr'));

describe('box health access', () => {
  it('is kept for owners and administrators (configuration:manage)', () => {
    expect(canManageBox('OWNER')).toBe(true);
    expect(canManageBox('ADMINISTRATOR')).toBe(true);
    for (const role of ['CAREGIVER', 'VIEWER', 'RESIDENT', 'FAMILY'] as never[])
      expect(canManageBox(role)).toBe(false);
  });
});

describe('reading the values of the box', () => {
  it('never shows an unreadable value as fine', () => {
    const unreadable: BoxHealthCheck[] = [
      check('disk', 'ok', { usedPercent: null }),
      check('disk', 'ok', { usedPercent: 'beaucoup' }),
      check('disk', 'ok', { usedPercent: 140 }),
      check('swap', 'ok', {}),
      check('temperature', 'ok', { celsius: ['chaud', null] }),
      check('throttling', 'ok', { flags: null }),
      check('containers', 'ok', { containers: null }),
      check('disk-errors', 'ok', { count: -1 }),
      check('backup', 'ok', { last: { at: 'hier', ok: true } }),
      check('backup', 'ok', {}),
      check('worker', 'ok', { state: null }),
      check('zigbee', 'ok', { available: false }),
      check('remote-access', 'ok', {}),
      check('sensors', 'ok', { count: '?' }),
      check('notifications', 'ok', { failed24h: null }),
      check('outbox', 'ok', {}),
      check('database', 'ok', { sizeBytes: null }),
    ];
    for (const item of unreadable)
      expect(readCheck(item, NOW).level, `${item.id} ${JSON.stringify(item.params)}`).toBe(
        'unknown',
      );
  });

  it('keeps an ok that rests on a readable value, and never softens the box', () => {
    for (const [id, params] of Object.entries(REAL_PARAMS))
      expect(readCheck(check(id, 'ok', params), NOW).level, id).toBe('ok');
    expect(readCheck(check('disk', 'critical', { usedPercent: null }), NOW).level).toBe('critical');
    expect(readCheck(check('mystery', 'ok', { anything: 1 }), NOW).level).toBe('ok');
  });

  it('reads the figures of the real API', () => {
    expect(readCheck(check('disk', 'warning', { usedPercent: 81.6 }), NOW).values).toEqual({
      percent: 82,
    });
    expect(
      readCheck(check('temperature', 'ok', { celsius: [48.2, 52.9, 'x'] }), NOW).values,
    ).toEqual({ celsius: 53 });
    expect(
      readCheck(
        check('containers', 'critical', {
          containers: [
            { name: 'api', oomKilled: true },
            { name: 'worker', health: 'unhealthy' },
            { name: 'postgres', restartCount: 0 },
          ],
        }),
        NOW,
      ).values,
    ).toEqual({ count: 2, total: 3 });
    expect(readCheck(check('database', 'ok', { sizeBytes: 152_436_736 }), NOW).size).toEqual({
      unit: 'mb',
      value: 145.4,
    });
    expect(readCheck(check('sensors', 'ok', { count: 0 }), NOW).variant).toBe('none');
  });

  it('tells a backup never made, failed, or getting old', () => {
    expect(readCheck(check('backup', 'warning', { last: null }), NOW).variant).toBe('never');
    const failed = readCheck(
      check('backup', 'critical', { last: { at: '2026-11-13T10:00:00.000Z', ok: false } }),
      NOW,
    );
    expect(failed.variant).toBe('failed');
    expect(failed.duration).toEqual({ unit: 'hours', count: 24 });
    expect(
      readCheck(
        check('backup', 'warning', { last: { at: '2026-11-10T10:00:00.000Z', ok: true } }),
        NOW,
      ).duration,
    ).toEqual({ unit: 'days', count: 4 });
  });

  it('tells failing worker tasks', () => {
    const reading = readCheck(
      check('worker', 'warning', { state: { healthy: false, failingTasks: ['a', 'b'] } }),
      NOW,
    );
    expect(reading).toMatchObject({ variant: 'failing', values: { count: 2 } });
  });

  it('tells durations and sizes in units a person would use', () => {
    expect(durationParts(5)).toEqual({ unit: 'minutes', count: 5 });
    expect(durationParts(180)).toEqual({ unit: 'hours', count: 3 });
    expect(durationParts(9 * 1440)).toEqual({ unit: 'days', count: 9 });
    expect(sizeParts(2048)).toEqual({ unit: 'kb', value: 2 });
    expect(sizeParts(3 * 1024 ** 3)).toEqual({ unit: 'gb', value: 3 });
  });
});

describe('box health tones', () => {
  it('never shows an unreadable point as fine', () => {
    expect(toneOf('unknown')).toBe('warning');
    expect(groupTone([check('disk', 'ok'), check('swap', 'unknown')])).toBe('warning');
  });

  it('turns an ok verdict with an unreadable point into "worth a look"', () => {
    const fine = check('disk', 'ok', { usedPercent: 40 });
    expect(bannerOf(readReport(report('ok', [fine]), NOW), false)).toBe('ok');
    expect(bannerOf(readReport(report('ok', [check('disk', 'ok')]), NOW), false)).toBe('unchecked');
    expect(bannerOf(report('ok', [fine, check('swap', 'unknown')]), false)).toBe('unchecked');
    expect(bannerOf(report('ok', [check('disk', 'critical')]), false)).toBe('critical');
    expect(bannerOf(report('warning', [fine]), false)).toBe('warning');
    expect(bannerOf(report('ok', []), false)).toBe('unchecked');
  });

  it('says "unable to check" when the box does not answer, never an empty "all good"', () => {
    expect(bannerOf(null, true)).toBe('unavailable');
    expect(bannerOf(null, false)).toBe('unavailable');
    expect(bannerOf(report('ok', [check('disk', 'ok')]), true)).toBe('unavailable');
  });
});

describe('box health copy', () => {
  it('has a sentence for every check, level and case, in every language', () => {
    for (const language of ['fr', 'en', 'es', 'it', 'pt'] as const) {
      setLanguage(language);
      for (const id of BOX_HEALTH_CHECK_IDS) {
        for (const level of LEVELS)
          for (const params of [{}, REAL_PARAMS[id] ?? {}]) {
            const text = sentence(check(id, level, params));
            expect(text, `${language} ${id} ${level}`).not.toBe('');
          }
        expect(tr(`boxHealth.checks.${id}.label`), `${language} ${id}`).not.toContain('boxHealth.');
      }
      for (const special of [
        check('backup', 'warning', { last: null }),
        check('backup', 'critical', { last: { at: '2026-11-13T10:00:00.000Z', ok: false } }),
        check('worker', 'critical', { state: { failingTasks: ['x'] } }),
        check('sensors', 'ok', { count: 0 }),
        check('mystery', 'critical'),
      ])
        expect(sentence(special), `${language} ${special.id}`).not.toBe('');
    }
  });

  it('uses the figures the box gave, and plainer words without them', () => {
    setLanguage('fr');
    expect(sentence(check('disk', 'warning', { usedPercent: 91.4 }))).toBe(
      'La box commence à manquer de place (91\u202f% utilisés).',
    );
    expect(sentence(check('disk', 'warning', { usedPercent: null }))).toBe(
      'La box commence à manquer de place.',
    );
    expect(sentence(check('disk', 'ok', { usedPercent: null }))).toBe(
      'Impossible de lire l’espace restant sur la box.',
    );
    expect(sentence(check('backup', 'warning', { last: null }))).toBe(
      'Aucune sauvegarde n’a encore été faite. Lancez la première quand vous voulez.',
    );
    expect(sentence(check('notifications', 'warning', { failed24h: 1 }))).toBe(
      '1 alerte n’a pas pu être envoyée ces dernières 24\u202fh.',
    );
    expect(sentence(check('mystery', 'critical'))).toBe('Ce point demande votre attention.');
  });
});

describe('box health screen rules', () => {
  it('orders the groups like the dashboard, understands the provisional name, drops empty ones', () => {
    const ordered = orderedGroups({
      verdict: 'ok',
      checkedAt: '',
      groups: [
        { id: 'access', checks: [check('remote-access', 'ok')] },
        { id: 'custom', checks: [check('x', 'ok')] },
        { id: 'data', checks: [] },
        { id: 'monitoring', checks: [check('worker', 'ok')] },
        { id: 'box', checks: [check('disk', 'ok')] },
      ],
    });
    expect(ordered.map((group) => group.id)).toEqual(['monitoring', 'box', 'access', 'custom']);
  });

  it('offers places only when a row asks for attention, and only places the app has', () => {
    const places = new Set(['zigbee', 'backup'] as const);
    expect(actionDestination({ action: 'open-zigbee', level: 'warning' }, places)).toBe('zigbee');
    expect(actionDestination({ action: 'open-zigbee', level: 'ok' }, places)).toBeNull();
    expect(actionDestination({ action: 'run-backup', level: 'ok' }, places)).toBe('backup');
    expect(actionDestination({ action: 'open-sensors', level: 'critical' }, places)).toBeNull();
    expect(actionDestination({ level: 'critical' }, places)).toBeNull();
  });

  it('follows a backup started from the screen until a newer one shows up', () => {
    const before = demoBoxHealthReport('warning', NOW);
    const watch = watchBackup(before, NOW);
    expect(backupProgress(watch, before, NOW + 5000)).toBe('running');
    const after = demoBoxHealthReport('warning', NOW + 10_000, NOW + 8000);
    expect(backupProgress(watch, after, NOW + 10_000)).toBe('done');
    expect(backupProgress(watch, before, NOW + BACKUP_WATCH_MS + 1)).toBe('timeout');
    const failed = report('critical', [
      check('backup', 'critical', { last: { at: new Date(NOW + 1000).toISOString(), ok: false } }),
    ]);
    expect(backupProgress(watchBackup(null, NOW), failed, NOW + 2000)).toBe('failed');
  });

  it('flattens the raw values of a check', () => {
    expect(
      technicalLines({ usedPercent: 81.6, celsius: [48, 52], containers: [], last: null }),
    ).toEqual(['usedPercent: 81.6', 'celsius: 48, 52', 'containers: —', 'last: —']);
  });
});

describe('box health demo', () => {
  it('answers like the real API in every state', () => {
    for (const state of BOX_HEALTH_DEMO_STATES) {
      if (state === 'loading' || state === 'error') continue;
      const demo = boxHealthReportSchema.parse(demoBoxHealthReport(state, NOW));
      const banner = bannerOf(readReport(demo, NOW), false);
      expect(banner, state).toBe(
        state === 'ok' ? 'ok' : state === 'critical' ? 'critical' : 'warning',
      );
    }
    const warning = readReport(demoBoxHealthReport('warning', NOW), NOW);
    const levels = warning.groups.flatMap((group) => group.checks.map((item) => item.level));
    expect(levels).toContain('unknown');
    expect(levels).toContain('warning');
  });
});
