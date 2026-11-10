/** Times of day as the installation contract stores them: "HH:MM", 24-hour clock. */
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MINUTES = 24 * 60;

const pad = (value: number) => String(value).padStart(2, '0');

export const isClock = (value: string) => CLOCK.test(value);

const toMinutes = (value: string, fallback: string) => {
  const [hours, minutes] = (isClock(value) ? value : fallback).split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

const fromMinutes = (total: number) => {
  const wrapped = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
};

/** Moves a time by whole minutes, wrapping around midnight. */
export const shiftClock = (value: string, minutes: number, fallback = '08:00') =>
  fromMinutes(toMinutes(value, fallback) + minutes);

export const clockToDate = (value: string, fallback = '08:00') => {
  const total = toMinutes(value, fallback);
  const date = new Date();
  date.setHours(Math.floor(total / 60), total % 60, 0, 0);
  return date;
};

export const dateToClock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
