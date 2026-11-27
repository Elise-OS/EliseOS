// Heatwave mode rules: triggers, hysteresis, family overrides, reminders and advice.
// They run against the built package (dist/), as the apps use it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_HEATWAVE_SETTINGS,
  createHeatwaveDemo,
  dueHydrationReminder,
  evaluateHeatwave,
  heatwaveRegistryDue,
  heatwaveSettingsSchema,
  heatwaveTip,
  hydrationSlots,
  nextHydrationReminder,
  parseHeatwaveSettings,
  relevantForecastMaxima,
  sustainedAtOrAbove,
} from '../dist/index.js';

const tz = 'Europe/Paris';
// Paris is UTC+2 in July.
const at = (time, date = '2026-07-15') => new Date(`${date}T${time}:00+02:00`);
const settings = structuredClone(DEFAULT_HEATWAVE_SETTINGS);
const idle = { active: false, source: null, manual: null };
/** One reading every 10 minutes from `from` to `to` (included) at `value`. */
const readings = (from, to, value, date) => {
  const out = [];
  for (let t = at(from, date).getTime(); t <= at(to, date).getTime(); t += 10 * 60_000)
    out.push({ occurredAt: new Date(t), value });
  return out;
};
const evaluate = (overrides) =>
  evaluateHeatwave({
    settings,
    previous: idle,
    sensors: [],
    forecast: null,
    now: at('14:00'),
    timeZone: tz,
    ...overrides,
  });
const forecast = (todayMax, tomorrowMax, date = '2026-07-15') => ({
  date,
  todayMax,
  tomorrowMax,
  outdoorNow: 25,
  city: 'Lyon',
  fetchedAt: at('08:00', date).toISOString(),
});

describe('heatwave settings', () => {
  it('uses the defaults agreed with the family', () => {
    assert.equal(settings.indoorTrigger.celsius, 28);
    assert.equal(settings.indoorTrigger.minutes, 30);
    assert.equal(settings.forecastTrigger.celsius, 33);
    assert.deepEqual(settings.reminders, {
      enabled: true,
      everyHours: 2,
      startHour: 9,
      endHour: 20,
    });
    assert.equal(settings.alert.celsius, 31);
    assert.equal(settings.alert.minutes, 60);
  });

  it('refuses a reminder range that ends before it starts, or an unknown frequency', () => {
    const backwards = structuredClone(settings);
    backwards.reminders.startHour = 20;
    backwards.reminders.endHour = 9;
    assert.equal(heatwaveSettingsSchema.safeParse(backwards).success, false);
    const often = structuredClone(settings);
    often.reminders.everyHours = 4;
    assert.equal(heatwaveSettingsSchema.safeParse(often).success, false);
    assert.deepEqual(parseHeatwaveSettings({ broken: true }), settings);
  });
});

describe('indoor trigger', () => {
  it('needs the threshold to be reached, not almost reached', () => {
    const below = evaluate({ sensors: [{ readings: readings('13:00', '14:00', 27.9) }] });
    assert.equal(below.active, false);
    const reached = evaluate({ sensors: [{ readings: readings('13:00', '14:00', 28) }] });
    assert.equal(reached.active, true);
    assert.equal(reached.source, 'INDOOR');
    assert.equal(reached.change, 'activated');
  });

  it('needs the heat to last 30 minutes in one room', () => {
    const short = evaluate({ sensors: [{ readings: readings('13:40', '14:00', 29) }] });
    assert.equal(short.active, false);
    const long = evaluate({ sensors: [{ readings: readings('13:30', '14:00', 29) }] });
    assert.equal(long.active, true);
    // A dip below the threshold restarts the count.
    const interrupted = evaluate({
      sensors: [
        {
          readings: [
            ...readings('13:00', '13:40', 29),
            { occurredAt: at('13:45'), value: 27.5 },
            ...readings('13:50', '14:00', 29),
          ],
        },
      ],
    });
    assert.equal(interrupted.active, false);
  });

  it('holds the last value of a sensor that reports only on change', () => {
    const sparse = sustainedAtOrAbove(
      [{ occurredAt: at('13:20'), value: 28.4 }],
      28,
      30,
      at('14:00'),
    );
    assert.equal(sparse.active, true);
    // A sensor silent for too long says nothing about the room any more.
    const silent = sustainedAtOrAbove(
      [{ occurredAt: at('11:00'), value: 30 }],
      28,
      30,
      at('14:00'),
    );
    assert.equal(silent.active, false);
  });

  it('keeps working without Internet: no forecast is needed', () => {
    const offline = evaluate({
      sensors: [{ readings: readings('13:00', '14:00', 29) }],
      forecast: null,
    });
    assert.equal(offline.active, true);
  });

  it('can be turned off by the family', () => {
    const disabled = structuredClone(settings);
    disabled.indoorTrigger.enabled = false;
    const result = evaluate({
      settings: disabled,
      sensors: [{ readings: readings('12:00', '14:00', 30) }],
    });
    assert.equal(result.active, false);
  });
});

describe('forecast trigger', () => {
  it('turns the mode on when today or tomorrow reaches 33 °C', () => {
    assert.equal(evaluate({ forecast: forecast(32.9, 32) }).active, false);
    assert.equal(evaluate({ forecast: forecast(33, 30) }).source, 'FORECAST');
    assert.equal(evaluate({ forecast: forecast(28, 34) }).active, true);
  });

  it('uses yesterday’s forecast for today when Internet is down, never older ones', () => {
    assert.deepEqual(relevantForecastMaxima(forecast(30, 35, '2026-07-14'), '2026-07-15'), [35]);
    assert.deepEqual(relevantForecastMaxima(forecast(36, 36, '2026-07-12'), '2026-07-15'), []);
    assert.equal(evaluate({ forecast: forecast(36, 36, '2026-07-12') }).active, false);
  });

  it('can be turned off by the family', () => {
    const disabled = structuredClone(settings);
    disabled.forecastTrigger.enabled = false;
    assert.equal(evaluate({ settings: disabled, forecast: forecast(38, 38) }).active, false);
  });
});

describe('automatic deactivation (hysteresis)', () => {
  const on = { active: true, source: 'INDOOR', manual: null };

  it('stays on between 27 and 28 °C', () => {
    const result = evaluate({
      previous: on,
      sensors: [{ readings: readings('10:00', '14:00', 27.5) }],
    });
    assert.equal(result.active, true);
    assert.equal(result.change, null);
  });

  it('stays on until every room has been below 27 °C for 2 hours', () => {
    const cooling = [...readings('10:00', '12:30', 28.5), ...readings('12:40', '14:00', 26)];
    assert.equal(evaluate({ previous: on, sensors: [{ readings: cooling }] }).active, true);
    const cool = [...readings('10:00', '11:50', 28.5), ...readings('12:00', '14:00', 26)];
    const result = evaluate({ previous: on, sensors: [{ readings: cool }] });
    assert.equal(result.active, false);
    assert.equal(result.change, 'deactivated');
  });

  it('stays on while the forecast is still hot, even when the rooms are cool', () => {
    const cool = readings('08:00', '14:00', 24);
    assert.equal(
      evaluate({ previous: on, sensors: [{ readings: cool }], forecast: forecast(30, 34) }).active,
      true,
    );
    assert.equal(
      evaluate({ previous: on, sensors: [{ readings: cool }], forecast: forecast(30, 31) }).active,
      false,
    );
  });

  it('does not switch off when every sensor went silent', () => {
    const silent = readings('06:00', '10:00', 24);
    assert.equal(evaluate({ previous: on, sensors: [{ readings: silent }] }).active, true);
  });
});

describe('family overrides', () => {
  it('a family "on" holds without any heat', () => {
    const result = evaluate({ previous: { active: true, source: 'MANUAL', manual: 'ON' } });
    assert.equal(result.active, true);
    assert.equal(result.source, 'MANUAL');
  });

  it('a family "off" holds during the heat, then re-arms once the heat is over', () => {
    const off = { active: false, source: null, manual: 'OFF' };
    const hot = evaluate({
      previous: off,
      sensors: [{ readings: readings('10:00', '14:00', 30) }],
    });
    assert.equal(hot.active, false);
    assert.equal(hot.manual, 'OFF');
    const over = evaluate({
      previous: off,
      sensors: [{ readings: readings('10:00', '14:00', 24) }],
    });
    assert.equal(over.active, false);
    assert.equal(over.manual, null);
    // Next heat episode: automatic again.
    const next = evaluate({
      previous: over,
      sensors: [{ readings: readings('10:00', '14:00', 30) }],
    });
    assert.equal(next.active, true);
  });
});

describe('drink reminders', () => {
  it('are due every 2 hours from 9:00 to 20:00 by default', () => {
    assert.deepEqual(
      hydrationSlots(settings).map((minute) => minute / 60),
      [9, 11, 13, 15, 17, 19],
    );
    const hourly = structuredClone(settings);
    hourly.reminders.everyHours = 1;
    assert.deepEqual(hydrationSlots(hourly).at(-1), 20 * 60);
  });

  it('show for 10 minutes at each slot, and never outside the range', () => {
    const due = dueHydrationReminder(settings, at('11:04'), tz);
    assert.equal(due.scheduledFor.toISOString(), at('11:00').toISOString());
    assert.equal(due.expiresAt.toISOString(), at('11:10').toISOString());
    assert.equal(dueHydrationReminder(settings, at('11:10'), tz), null);
    assert.equal(dueHydrationReminder(settings, at('08:59'), tz), null);
    assert.equal(dueHydrationReminder(settings, at('21:00'), tz), null);
    const off = structuredClone(settings);
    off.reminders.enabled = false;
    assert.equal(dueHydrationReminder(off, at('11:04'), tz), null);
  });

  it('start again the next morning after the last one of the day', () => {
    assert.equal(nextHydrationReminder(settings, at('19:30'), tz), null);
    assert.equal(dueHydrationReminder(settings, at('00:05', '2026-07-16'), tz), null);
    assert.equal(
      nextHydrationReminder(settings, at('00:05', '2026-07-16'), tz).toISOString(),
      at('09:00', '2026-07-16').toISOString(),
    );
    assert.equal(
      dueHydrationReminder(settings, at('09:02', '2026-07-16'), tz).scheduledFor.toISOString(),
      at('09:00', '2026-07-16').toISOString(),
    );
  });

  it('follow the wall clock across a daylight saving change', () => {
    // 25 October 2026: Paris goes back to UTC+1.
    const due = dueHydrationReminder(settings, new Date('2026-10-25T10:03:00Z'), tz);
    assert.equal(due.scheduledFor.toISOString(), '2026-10-25T10:00:00.000Z');
  });
});

describe('advice on the TV', () => {
  const tip = (minute, outdoor = 22, indoor = 27) =>
    heatwaveTip({ settings, minute, outdoor, indoor });

  it('closes the shutters in the morning and refreshes the face during the day', () => {
    assert.equal(tip(10 * 60), 'closeShutters');
    assert.equal(tip(15 * 60), 'refreshFace');
  });

  it('opens the windows in the evening only when it is cooler outside', () => {
    assert.equal(tip(21 * 60, 22, 27), 'openWindows');
    assert.equal(tip(21 * 60, 29, 27), null);
    assert.equal(tip(21 * 60, 27, 27), null);
    // Without Internet the outdoor temperature is unknown: no evening advice.
    assert.equal(tip(21 * 60, null, 27), null);
  });

  it('can be turned off', () => {
    const off = structuredClone(settings);
    off.tips.enabled = false;
    assert.equal(heatwaveTip({ settings: off, minute: 600, outdoor: 20, indoor: 27 }), null);
  });
});

describe('town-hall registry reminder', () => {
  it('is due in June or at the first activation of the year, until acknowledged', () => {
    assert.equal(
      heatwaveRegistryDue({
        now: at('10:00', '2026-06-02'),
        timeZone: tz,
        acknowledgedYear: null,
        active: false,
      }).due,
      true,
    );
    assert.equal(
      heatwaveRegistryDue({
        now: at('10:00', '2026-05-02'),
        timeZone: tz,
        acknowledgedYear: null,
        active: false,
      }).due,
      false,
    );
    assert.equal(
      heatwaveRegistryDue({
        now: at('10:00', '2026-05-02'),
        timeZone: tz,
        acknowledgedYear: null,
        active: true,
      }).due,
      true,
    );
    assert.equal(
      heatwaveRegistryDue({
        now: at('10:00', '2026-07-02'),
        timeZone: tz,
        acknowledgedYear: 2026,
        active: true,
      }).due,
      false,
    );
  });
});

describe('heatwave demo', () => {
  it('turns on by hand, shows a reminder and counts its confirmation', () => {
    const demo = createHeatwaveDemo();
    assert.equal(demo.handle('GET', '/heatwave').body.active, false);
    demo.handle('POST', '/heatwave/manual', JSON.stringify({ active: true }));
    const screen = demo.handle('GET', '/heatwave/screen').body;
    assert.equal(screen.active, true);
    assert.ok(screen.reminder);
    demo.handle('POST', `/heatwave/reminders/${screen.reminder.id}/confirm`);
    assert.equal(demo.handle('GET', '/heatwave').body.reminders.confirmed, 1);
    assert.equal(demo.handle('GET', '/heatwave/screen').body.reminder, null);
    assert.equal(demo.handle('GET', '/alerts'), null);
  });
});
