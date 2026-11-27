import { DEFAULT_HEATWAVE_SETTINGS, evaluateHeatwave } from '@elise/contracts';
import { describe, expect, it } from 'vitest';
import {
  groupTemperatureReadings,
  heatwaveAlertCandidate,
  heatwaveAlertCopy,
  type HeatwaveSensor,
} from './heatwave.js';

const at = (time: string) => new Date(`2026-07-15T${time}:00+02:00`);
const every10 = (from: string, to: string, value: number) => {
  const readings = [];
  for (let t = at(from).getTime(); t <= at(to).getTime(); t += 10 * 60_000)
    readings.push({ occurredAt: new Date(t), value });
  return readings;
};
const room = (id: string, roomName: string, readings: HeatwaveSensor['readings']) => ({
  id,
  roomId: `room-${id}`,
  roomName,
  readings,
});

describe('heatwave family alert', () => {
  const settings = structuredClone(DEFAULT_HEATWAVE_SETTINGS);

  it('opens at 31 °C lasting one hour, in the warmest room', () => {
    const sensors = [
      room('a', 'Salon', every10('12:30', '14:00', 31.2)),
      room('b', 'Chambre', every10('13:10', '14:00', 31.8)),
      room('c', 'Cuisine', every10('12:00', '14:00', 31.5)),
    ];
    const alert = heatwaveAlertCandidate(settings, sensors, at('14:00'));
    expect(alert).toEqual({ active: true, roomId: 'room-c', roomName: 'Cuisine', latest: 31.5 });
  });

  it('stays closed under the threshold or before the hour', () => {
    expect(
      heatwaveAlertCandidate(
        settings,
        [room('a', 'Salon', every10('12:00', '14:00', 30.9))],
        at('14:00'),
      ).active,
    ).toBe(false);
    expect(
      heatwaveAlertCandidate(
        settings,
        [room('a', 'Salon', every10('13:10', '14:00', 33))],
        at('14:00'),
      ).active,
    ).toBe(false);
  });

  it('follows the family settings', () => {
    const off = structuredClone(settings);
    off.alert.enabled = false;
    const hot = [room('a', 'Salon', every10('10:00', '14:00', 34))];
    expect(heatwaveAlertCandidate(off, hot, at('14:00')).active).toBe(false);
    const lower = structuredClone(settings);
    lower.alert.celsius = 29;
    lower.alert.minutes = 30;
    expect(
      heatwaveAlertCandidate(
        lower,
        [room('a', 'Salon', every10('13:30', '14:00', 29))],
        at('14:00'),
      ).active,
    ).toBe(true);
  });

  it('explains the alert calmly, with the facts', () => {
    const copy = heatwaveAlertCopy(settings, 'Chambre', 31.5);
    expect(copy.title).toBe('Forte chaleur dans Chambre');
    expect(copy.explanation).toContain('31,5 °C');
    expect(copy.explanation).toContain('60 minutes');
  });
});

describe('temperature readings for the heatwave mode', () => {
  it('keeps sensors without readings and drops impossible values', () => {
    const sensors = groupTemperatureReadings(
      [
        { id: 's1', roomId: 'r1', roomName: 'Salon' },
        { id: 's2', roomId: 'r2', roomName: 'Chambre' },
      ],
      [
        { sensorId: 's1', occurredAt: at('13:00'), payload: { value: 29.1 } },
        { sensorId: 's1', occurredAt: at('13:10'), payload: { value: '29.3' } },
        { sensorId: 's1', occurredAt: at('13:20'), payload: { value: 85 } },
        { sensorId: 'unknown', occurredAt: at('13:20'), payload: { value: 30 } },
      ],
    );
    expect(sensors.map((sensor) => sensor.readings.map((reading) => reading.value))).toEqual([
      [29.1, 29.3],
      [],
    ]);
  });

  it('an equipped room that went silent does not switch the mode off by itself', () => {
    const sensors = groupTemperatureReadings([{ id: 's1', roomId: 'r1', roomName: 'Salon' }], []);
    const result = evaluateHeatwave({
      settings: DEFAULT_HEATWAVE_SETTINGS,
      previous: { active: true, source: 'INDOOR', manual: null },
      sensors,
      forecast: null,
      now: at('14:00'),
      timeZone: 'Europe/Paris',
    });
    expect(result.active).toBe(true);
  });
});
