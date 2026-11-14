import type { BoxHealthCheck, BoxHealthLevel, BoxHealthReport } from '@elise/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../i18n';
import {
  BOX_HEALTH_CHECK_IDS,
  actionDestination,
  backupRunning,
  bannerOf,
  canManageBox,
  checkCopy,
  durationParts,
  groupTone,
  orderedGroups,
  technicalLines,
  toneOf,
} from './box-health-view';

const LEVELS: BoxHealthLevel[] = ['ok', 'warning', 'critical', 'unknown'];

const check = (
  id: string,
  level: BoxHealthLevel,
  params: BoxHealthCheck['params'] = {},
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
  it('is kept for owners and administrators', () => {
    expect(canManageBox('OWNER')).toBe(true);
    expect(canManageBox('ADMINISTRATOR')).toBe(true);
    for (const role of ['CAREGIVER', 'VIEWER', 'RESIDENT', 'FAMILY'] as never[])
      expect(canManageBox(role)).toBe(false);
  });
});

describe('box health tones', () => {
  it('never shows an unreadable point as fine', () => {
    expect(toneOf('unknown')).not.toBe('ok');
    expect(toneOf('unknown')).toBe('warning');
    expect(groupTone([check('disk', 'ok'), check('memory', 'unknown')])).toBe('warning');
  });

  it('turns an ok verdict with an unreadable point into "worth a look"', () => {
    expect(bannerOf(report('ok', [check('disk', 'ok')]), false)).toBe('ok');
    expect(bannerOf(report('ok', [check('disk', 'ok'), check('memory', 'unknown')]), false)).toBe(
      'unchecked',
    );
    expect(bannerOf(report('ok', [check('disk', 'critical')]), false)).toBe('critical');
    expect(bannerOf(report('warning', [check('disk', 'ok')]), false)).toBe('warning');
  });

  it('says "unable to check" when the box does not answer, never an empty "all good"', () => {
    expect(bannerOf(null, true)).toBe('unavailable');
    expect(bannerOf(null, false)).toBe('unavailable');
    expect(bannerOf(report('ok', [check('disk', 'ok')]), true)).toBe('unavailable');
  });
});

describe('box health copy', () => {
  it('has a sentence for every known point and level, in French and English', () => {
    for (const language of ['fr', 'en'] as const) {
      setLanguage(language);
      for (const id of BOX_HEALTH_CHECK_IDS)
        for (const level of LEVELS)
          for (const params of [
            {},
            { percent: 81, celsius: 70, count: 2, failed: 1, total: 9, minutes: 200 },
          ]) {
            const copy = checkCopy(check(id, level, params));
            const values: Record<string, string | number> = { ...copy.values };
            if (copy.duration)
              values.duration = t(`boxHealth.duration.${copy.duration.unit}`, {
                count: copy.duration.count,
              });
            const text = String(t(`boxHealth.${copy.path}` as never, values as never));
            expect(text, `${language} ${copy.path}`).not.toContain('boxHealth.');
            expect(text, `${language} ${copy.path}`).not.toContain('{{');
          }
    }
  });

  it('uses the figures the box gave, and a generic sentence for unknown points', () => {
    setLanguage('fr');
    const disk = checkCopy(check('disk', 'warning', { percent: 91.4 }));
    expect(t(`boxHealth.${disk.path}` as never, disk.values as never)).toBe(
      'La box est remplie à 91 % : la place commence à manquer.',
    );
    expect(checkCopy(check('disk', 'warning')).path).toBe('checks.disk.warning');
    expect(checkCopy(check('disk', 'unknown', { percent: 3 })).path).toBe('checks.disk.unknown');
    expect(checkCopy(check('mystery', 'critical')).path).toBe('generic.critical');
    const offline = checkCopy(check('sensors-offline', 'warning', { count: 1 }));
    expect(t(`boxHealth.${offline.path}` as never, offline.values as never)).toBe(
      '1 capteur ne répond plus.',
    );
  });

  it('tells durations in the unit a person would use', () => {
    expect(durationParts(5)).toEqual({ unit: 'minutes', count: 5 });
    expect(durationParts(180)).toEqual({ unit: 'hours', count: 3 });
    expect(durationParts(9 * 1440)).toEqual({ unit: 'days', count: 9 });
    expect(checkCopy(check('backup', 'warning', { days: 9 })).duration).toEqual({
      unit: 'days',
      count: 9,
    });
  });
});

describe('box health screen rules', () => {
  it('orders the groups like the dashboard and drops empty ones', () => {
    const ordered = orderedGroups({
      verdict: 'ok',
      checkedAt: '',
      groups: [
        { id: 'access', checks: [check('remote-access', 'ok')] },
        { id: 'custom', checks: [check('x', 'ok')] },
        { id: 'data', checks: [] },
        { id: 'monitoring', checks: [check('worker', 'ok')] },
      ],
    });
    expect(ordered.map((group) => group.id)).toEqual(['monitoring', 'access', 'custom']);
  });

  it('hides action buttons that lead nowhere in the app', () => {
    const places = new Set(['zigbee', 'backup'] as const);
    expect(actionDestination('open-zigbee', places)).toBe('zigbee');
    expect(actionDestination('run-backup', places)).toBe('backup');
    expect(actionDestination('open-sensors', places)).toBeNull();
    expect(actionDestination(undefined, places)).toBeNull();
  });

  it('knows when a backup is running', () => {
    expect(backupRunning(null)).toBe(false);
    expect(backupRunning({ ...report('ok', []), backup: { running: true } })).toBe(true);
    expect(backupRunning(report('ok', []))).toBe(false);
  });

  it('flattens the raw technical values', () => {
    expect(
      technicalLines({ disk: { used: 11 }, containers: ['api', 'worker'], lastErrors: [] }),
    ).toEqual(['disk.used: 11', 'containers: api, worker', 'lastErrors: —']);
  });
});
