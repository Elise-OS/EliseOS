// Weekly digest of the notebook: calendar, comparison with the usual, missing data, texts, PDF.
// They run against the built package (dist/), as the apps use it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WEEKLY_DIGEST_LANGUAGES,
  WEEKLY_DIGEST_TEXTS,
  buildWeeklyDigest,
  buildWeeklyDigestPdf,
  createWeeklyDigestDemo,
  digestClock,
  digestDuration,
  digestPeriod,
  digestReadyAt,
  digestStatementText,
  digestWeekClosed,
  digestWeekStart,
  digestWeekdayLabel,
  emptyWeeklyDigestMetrics,
  latestDigestWeek,
  parseWeeklyDigestMetrics,
  weeklyDigestLanguage,
  weeklyDigestPdfName,
} from '../dist/index.js';

const tz = 'Europe/Paris';
const WEEK = '2026-11-16';

const context = (overrides = {}) => ({
  weekStart: WEEK,
  timezone: tz,
  residentName: 'Jeanne',
  generatedAt: '2026-11-22T20:00:00.000Z',
  previousWeek: '2026-11-09',
  nextWeek: null,
  visits: [],
  appointments: [],
  alerts: [],
  sensorIssues: [],
  ...overrides,
});

/** A full week of measures; `change` tweaks each day. */
function metrics(weekStart, change = () => ({})) {
  const base = emptyWeeklyDigestMetrics(weekStart);
  base.days = base.days.map((day) => ({ ...day, hasData: true }));
  base.nights = {
    source: 'BED',
    days: base.nights.days.map((day, index) => ({
      date: day.date,
      bedtimeMinute: 22 * 60 + 10,
      wakeMinute: 7 * 60 + 15,
      inBedMinutes: 540,
      risings: 1,
      ...change(index).night,
    })),
  };
  base.meals = {
    equipped: true,
    days: base.meals.days.map((day, index) => ({
      date: day.date,
      meals: { BREAKFAST: 'SEEN', LUNCH: 'SEEN', DINNER: 'SEEN', ...change(index).meals },
      fridgeOpenings: change(index).fridge ?? 8,
    })),
  };
  base.outings = {
    equipped: true,
    days: base.outings.days.map((day, index) => ({
      date: day.date,
      count: change(index).outings ?? 1,
      minutes: (change(index).outings ?? 1) * 60,
    })),
  };
  base.calls = {
    available: true,
    days: base.calls.days.map((day, index) => ({
      date: day.date,
      count: index % 2,
      minutes: 15 * (index % 2),
    })),
  };
  base.sharedPresence = {
    equipped: true,
    days: base.sharedPresence.days.map((day) => ({ date: day.date, count: 0 })),
  };
  return base;
}
const shift = (week, days) => {
  const value = new Date(`${week}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const usualWeeks = [1, 2, 3, 4].map((n) => metrics(shift(WEEK, -7 * n)));

const demo = createWeeklyDigestDemo({
  now: () => new Date('2026-10-13T08:40:00Z'),
  labels: {
    visitors: { help: 'Sophie Bernard', son: 'Luc Martin', daughter: 'Claire Martin' },
    appointment: 'Dr Bernard',
    alertMorning: 'Pas de mouvement ce matin',
    alertBattery: 'Pile faible',
    sensorName: 'Détecteur',
    sensorRoom: 'Salle de bain',
  },
});

describe('weekly digest calendar', () => {
  it('names a week by its Monday', () => {
    assert.equal(digestWeekStart('2026-11-22'), '2026-11-16');
    assert.equal(digestWeekStart('2026-11-16'), '2026-11-16');
    assert.equal(digestWeekStart('2026-11-18'), '2026-11-16');
  });

  it('makes the digest of the week ready on Sunday at 20:00, local time', () => {
    // Sunday 22 November 2026, 19:59 and 20:00 in Paris (UTC+1).
    assert.equal(latestDigestWeek(new Date('2026-11-22T18:59:00Z'), tz), '2026-11-09');
    assert.equal(latestDigestWeek(new Date('2026-11-22T19:00:00Z'), tz), '2026-11-16');
    assert.equal(latestDigestWeek(new Date('2026-11-25T10:00:00Z'), tz), '2026-11-16');
    assert.equal(digestReadyAt('2026-11-16', tz).toISOString(), '2026-11-22T19:00:00.000Z');
    // Summer time: Sunday 28 June 2026 at 20:00 is 18:00 UTC.
    assert.equal(digestReadyAt('2026-06-22', tz).toISOString(), '2026-06-28T18:00:00.000Z');
  });

  it('closes a week only once its Sunday night is over', () => {
    assert.equal(digestWeekClosed(WEEK, new Date('2026-11-22T21:00:00Z'), tz), false);
    assert.equal(digestWeekClosed(WEEK, new Date('2026-11-23T03:00:00Z'), tz), true);
  });
});

describe('buildWeeklyDigest', () => {
  it('describes a full ordinary week as calm, with three stable sentences', () => {
    const digest = buildWeeklyDigest(context(), metrics(WEEK), usualWeeks);
    assert.equal(digest.weekEnd, '2026-11-22');
    assert.equal(digest.comparisonWeeks, 4);
    assert.equal(digest.summary.key, 'summaryCalm');
    assert.equal(digest.nights.state, 'OK');
    assert.equal(digest.nights.wake, 7 * 60 + 15);
    assert.equal(digest.meals.notSeen, 0);
    assert.equal(digest.outings.total, 7);
    assert.deepEqual(
      digest.changes.map((item) => item.key),
      ['nightsStable', 'mealsStable', 'outingsStable'],
    );
  });

  it('puts what changed first: later getting up, more risings, fewer outings', () => {
    const week = metrics(WEEK, (index) => ({
      night: { wakeMinute: 7 * 60 + 55, risings: 3, inBedMinutes: 575 },
      meals:
        index === 3
          ? { LUNCH: 'NOT_SEEN' }
          : index === 5
            ? { LUNCH: 'NOT_SEEN', BREAKFAST: 'NOT_SEEN' }
            : {},
      outings: [1, 0, 0, 1, 0, 0, 0][index],
    }));
    const digest = buildWeeklyDigest(context(), week, usualWeeks);
    const keys = digest.changes.map((item) => item.key);
    assert.ok(keys.length >= 3 && keys.length <= 5, keys.join());
    assert.ok(keys.includes('wakeLater'));
    assert.ok(keys.includes('moreRisings'));
    assert.ok(keys.includes('fewerOutings'));
    const wake = digest.changes.find((item) => item.key === 'wakeLater');
    assert.equal(wake.values.minutes, 40);
    assert.equal(
      digestStatementText(wake, 'fr'),
      'Lever en moyenne 40 min plus tard que d’habitude (vers 07:55).',
    );
    assert.equal(digest.summary.key, 'summaryChanges');
    assert.deepEqual(digest.nights.restlessNights.length, 7);
    assert.deepEqual(digest.outings.daysWithout.length, 5);
  });

  it('says it is a first digest when there is no earlier week to compare with', () => {
    const digest = buildWeeklyDigest(context({ previousWeek: null }), metrics(WEEK), []);
    assert.equal(digest.comparisonWeeks, 0);
    assert.equal(digest.nights.usual, null);
    assert.deepEqual(
      digest.changes.map((item) => item.key),
      ['noHistory'],
    );
    assert.equal(digest.summary.key, 'summaryFirst');
  });

  it('needs two earlier weeks before comparing', () => {
    const digest = buildWeeklyDigest(context(), metrics(WEEK), usualWeeks.slice(0, 1));
    assert.equal(digest.changes[0].key, 'noHistory');
  });

  it('shows missing data honestly instead of guessing', () => {
    const week = metrics(WEEK);
    week.days[2].hasData = false;
    week.days[3].hasData = false;
    week.nights.days[2] = {
      date: week.nights.days[2].date,
      bedtimeMinute: null,
      wakeMinute: null,
      inBedMinutes: null,
      risings: null,
    };
    week.meals.days[2].meals = { BREAKFAST: 'UNKNOWN', LUNCH: 'UNKNOWN', DINNER: 'UNKNOWN' };
    week.outings = { ...week.outings, equipped: false };
    week.calls = { ...week.calls, available: false };
    const digest = buildWeeklyDigest(
      context({
        sensorIssues: [
          {
            id: 's1',
            name: 'Porte d’entrée',
            roomName: 'Entrée',
            kind: 'OFFLINE',
            since: '2026-11-18T10:00:00.000Z',
          },
        ],
      }),
      week,
      usualWeeks,
    );
    assert.deepEqual(digest.daysWithoutData, ['2026-11-18', '2026-11-19']);
    assert.equal(digest.nights.state, 'PARTIAL');
    assert.equal(digest.meals.unknown, 3);
    assert.equal(digest.outings.state, 'NOT_EQUIPPED');
    assert.equal(digest.visitSummary.calls.state, 'NOT_EQUIPPED');
    const keys = digest.changes.map((item) => item.key);
    assert.ok(keys.includes('daysWithoutData'));
    assert.ok(keys.includes('sensorIssues'));
    assert.ok(keys.length <= 5);
  });

  it('says when nothing could be measured', () => {
    const digest = buildWeeklyDigest(context(), emptyWeeklyDigestMetrics(WEEK), usualWeeks);
    assert.equal(digest.summary.key, 'summaryNoData');
    assert.equal(digest.nights.state, 'NOT_EQUIPPED');
    assert.equal(digest.daysWithoutData.length, 7);
  });

  it('puts urgent alerts in the summary', () => {
    const digest = buildWeeklyDigest(
      context({
        alerts: [
          {
            id: 'a',
            openedAt: '2026-11-18T08:00:00.000Z',
            title: 'SOS',
            severity: 'URGENT',
            type: 'SOS',
            status: 'RESOLVED',
          },
          {
            id: 'b',
            openedAt: '2026-11-19T08:00:00.000Z',
            title: 'Pile',
            severity: 'INFO',
            type: 'LOW_BATTERY',
            status: 'OPEN',
          },
        ],
      }),
      metrics(WEEK),
      usualWeeks,
    );
    assert.equal(digest.summary.key, 'summaryAlerts');
    assert.deepEqual(digest.alertSummary, { total: 2, urgent: 1, attention: 0, info: 1 });
    assert.equal(
      digestStatementText(digest.summary, 'fr'),
      '1 alerte urgente cette semaine : à regarder en premier.',
    );
  });

  it('counts calendar visits and the ones confirmed in the notebook', () => {
    const digest = buildWeeklyDigest(
      context({
        visits: [
          { id: 'v1', name: 'Sophie', startsAt: '2026-11-16T09:00:00.000Z', confirmed: true },
          { id: 'v2', name: 'Luc', startsAt: '2026-11-21T14:00:00.000Z', confirmed: false },
        ],
      }),
      metrics(WEEK),
      usualWeeks,
    );
    assert.equal(digest.visitSummary.planned, 2);
    assert.equal(digest.visitSummary.confirmed, 1);
    assert.equal(digest.visitSummary.calls.total, 3);
  });

  it('reads back stored metrics and refuses anything else', () => {
    assert.ok(parseWeeklyDigestMetrics(metrics(WEEK)));
    assert.equal(parseWeeklyDigestMetrics({ version: 2 }), null);
    assert.equal(parseWeeklyDigestMetrics(null), null);
  });
});

describe('weekly digest texts', () => {
  const shape = (value, prefix = '') =>
    typeof value === 'string'
      ? [
          `${prefix}=${[...value.matchAll(/\{\{(\w+)\}\}/g)]
            .map((m) => m[1])
            .sort()
            .join(',')}`,
        ]
      : Object.entries(value).flatMap(([key, item]) => shape(item, `${prefix}.${key}`));

  it('has the same texts and placeholders in the five languages', () => {
    const french = shape(WEEKLY_DIGEST_TEXTS.fr).sort();
    for (const language of WEEKLY_DIGEST_LANGUAGES) {
      assert.deepEqual(shape(WEEKLY_DIGEST_TEXTS[language]).sort(), french, language);
    }
  });

  it('writes every sentence fully, without a forgotten placeholder', () => {
    const digest = createWeeklyDigestDemo({
      now: () => new Date('2026-10-13T08:40:00Z'),
      labels: {
        visitors: { help: 'A', son: 'B', daughter: 'C' },
        appointment: 'D',
        alertMorning: 'E',
        alertBattery: 'F',
        sensorName: 'G',
        sensorRoom: 'H',
      },
    }).digest();
    for (const language of WEEKLY_DIGEST_LANGUAGES) {
      for (const key of Object.keys(WEEKLY_DIGEST_TEXTS.fr.statements)) {
        const sentence = digestStatementText(
          {
            key,
            theme: 'general',
            tone: 'info',
            values: { minutes: 40, clock: 475, count: 2, usual: 1, percent: 30 },
          },
          language,
        );
        assert.doesNotMatch(sentence, /\{\{/, `${language}.${key}`);
      }
      assert.ok(digestStatementText(digest.summary, language).length > 10);
    }
  });

  it('never says that something is not yet tested or validated', () => {
    const all = JSON.stringify(WEEKLY_DIGEST_TEXTS).toLowerCase();
    for (const forbidden of [
      'pas encore test',
      'pas encore valid',
      'not yet tested',
      'not yet validated',
      'untested',
      'aún no probado',
      'non ancora testat',
      'ainda não testad',
    ])
      assert.ok(!all.includes(forbidden), forbidden);
  });

  it('formats durations, times, days and periods plainly', () => {
    assert.equal(digestDuration(40), '40 min');
    assert.equal(digestDuration(125), '2 h 05');
    assert.equal(digestClock(1470), '00:30');
    assert.equal(digestWeekdayLabel('2026-11-16', 'fr'), 'Lun');
    assert.equal(digestWeekdayLabel('2026-11-16', 'pt'), 'Seg');
    assert.equal(digestPeriod('2026-11-16', '2026-11-22', 'fr'), 'Du 16 au 22 novembre');
    assert.equal(
      digestPeriod('2026-11-30', '2026-12-06', 'en', true),
      'From 30 November to 6 December 2026',
    );
    assert.equal(weeklyDigestLanguage('pt-BR'), 'pt');
    assert.equal(weeklyDigestLanguage('de'), 'fr');
    assert.equal(weeklyDigestPdfName('2026-11-16', 'fr'), 'bilan-semaine-2026-11-16.pdf');
  });
});

describe('weekly digest demo', () => {
  it('shows Jeanne’s last week with a notable change', () => {
    const answer = demo.handle('GET', '/weekly-digest', '');
    assert.equal(answer.status, 200);
    assert.equal(answer.body.weekStart, '2026-10-05');
    assert.equal(answer.body.nextWeek, null);
    assert.ok(answer.body.changes.some((item) => item.key === 'wakeLater'));
    assert.ok(answer.body.sensorIssues.length > 0);
  });

  it('lets the family look at earlier weeks, not at future ones', () => {
    const earlier = demo.handle('GET', '/weekly-digest', 'week=2026-09-30');
    assert.equal(earlier.body.weekStart, '2026-09-28');
    assert.equal(earlier.body.nextWeek, '2026-10-05');
    assert.equal(earlier.body.summary.key, 'summaryCalm');
    assert.equal(demo.handle('GET', '/weekly-digest', 'week=2026-10-12').status, 404);
    assert.equal(demo.handle('POST', '/weekly-digest', ''), null);
  });
});

describe('weekly digest PDF', () => {
  /** A stand-in for jsPDF that remembers the texts written and the pages added. */
  function recorder() {
    const texts = [];
    let pages = 1;
    const doc = new Proxy(
      {},
      {
        get: (_, name) => {
          if (name === 'text') return (value) => texts.push(...[value].flat());
          if (name === 'splitTextToSize') return (value) => [value];
          if (name === 'getTextWidth') return (value) => value.length * 4;
          if (name === 'addPage') return () => (pages += 1);
          if (name === 'getNumberOfPages') return () => pages;
          if (name === 'output') return () => new TextEncoder().encode(texts.join('\n')).buffer;
          return () => undefined;
        },
      },
    );
    return { doc, texts };
  }

  it('writes the person, the period, the sections, the date and the medical reminder', () => {
    const { doc, texts } = recorder();
    const digest = demo.digest();
    const bytes = buildWeeklyDigestPdf(() => doc, digest, {
      language: 'fr',
      personName: 'Jeanne Martin',
      generatedAt: new Date('2026-10-13T08:40:00Z'),
    });
    assert.ok(bytes.length > 0);
    const all = texts.join('\n');
    for (const expected of [
      'Bilan de la semaine',
      'Jeanne Martin · Du 5 au 11 octobre 2026',
      'Généré le 13 octobre 2026 à 10:40',
      'Ce qui a changé',
      'Les nuits',
      'Les repas',
      'Les sorties',
      'Les visites',
      'Les alertes',
      'Capteurs et données',
      'Estimations issues de capteurs, pas un dispositif médical.',
    ])
      assert.ok(all.includes(expected), expected);
  });
});
