// Radio and TV programs: the TV turns on for the program, then goes back to the home screen.
// They run against the built package (dist/), as the apps use it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeScreenProgram,
  advanceScreenPrograms,
  initialScreenState,
  screenProgramInputSchema,
} from '../dist/index.js';

const tz = 'Europe/Paris';
const radioId = '550e8400-e29b-41d4-a716-446655440001';
// Wednesday 25 November 2026; Paris is UTC+1.
const at = (time, date = '2026-11-25') => new Date(`${date}T${time}:00+01:00`);

const stateWith = (...programs) => {
  const state = initialScreenState();
  state.settings.consent = true;
  state.settings.quietStart = '22:00';
  state.settings.quietEnd = '08:00';
  state.media.push({ id: radioId, title: 'France Inter', kind: 'stream', url: 'https://r.test' });
  state.programs = programs.map((program, index) => ({
    id: `program-${index}`,
    repeat: 'weekly',
    days: [3],
    mediaId: radioId,
    title: 'France Inter',
    createdAt: 0,
    actor: 'Claire',
    ...program,
  }));
  return state;
};

describe('screen programs', () => {
  it('validates weekly and one-time programs', () => {
    const weekly = screenProgramInputSchema.parse({
      repeat: 'weekly',
      days: [5, 1, 1],
      start: '09:00',
      end: '10:00',
      mediaId: radioId,
    });
    assert.deepEqual(weekly.days, [1, 5]);
    assert.equal(
      screenProgramInputSchema.safeParse({
        repeat: 'once',
        date: '2026-12-24',
        start: '21:00',
        end: '21:00',
        mediaId: radioId,
      }).success,
      false,
    );
    assert.equal(
      screenProgramInputSchema.safeParse({
        repeat: 'weekly',
        days: [],
        start: '09:00',
        end: '10:00',
        mediaId: radioId,
      }).success,
      false,
    );
  });

  it('turns the TV on at the start and goes back home at the end', () => {
    const state = stateWith({ start: '09:00', end: '10:00' });
    state.playback.asleep = true;
    assert.deepEqual(advanceScreenPrograms(state, at('08:59'), tz), []);
    const started = advanceScreenPrograms(state, at('09:00'), tz);
    assert.equal(started[0].kind, 'started');
    assert.equal(state.playback.mediaId, radioId);
    assert.equal(state.playback.asleep, false);
    assert.deepEqual(advanceScreenPrograms(state, at('09:30'), tz), []);
    const ended = advanceScreenPrograms(state, at('10:00'), tz);
    assert.equal(ended[0].kind, 'ended');
    assert.equal(state.playback.mediaId, null);
    assert.equal(state.playback.asleep, false);
    assert.equal(state.programRun, null);
  });

  it('does not restart nor stop a program someone changed by hand', () => {
    const state = stateWith({ start: '09:00', end: '10:00' });
    advanceScreenPrograms(state, at('09:00'), tz);
    state.playback.mediaId = null;
    state.playback.revision++;
    assert.deepEqual(advanceScreenPrograms(state, at('09:05'), tz), []);
    assert.equal(state.playback.mediaId, null);
    const otherId = '550e8400-e29b-41d4-a716-446655440002';
    state.playback.mediaId = otherId;
    state.playback.revision++;
    advanceScreenPrograms(state, at('10:00'), tz);
    assert.equal(state.playback.mediaId, otherId);
  });

  it('keeps playing across midnight and sleeps when it ends in the quiet hours', () => {
    const state = stateWith({ start: '23:00', end: '00:30' });
    advanceScreenPrograms(state, at('23:00'), tz);
    assert.equal(state.playback.mediaId, radioId);
    assert.ok(activeScreenProgram(state.programs, at('00:10', '2026-11-26'), tz));
    advanceScreenPrograms(state, at('00:10', '2026-11-26'), tz);
    assert.equal(state.playback.mediaId, radioId);
    advanceScreenPrograms(state, at('00:30', '2026-11-26'), tz);
    assert.equal(state.playback.mediaId, null);
    assert.equal(state.playback.asleep, true);
  });

  it('waits for the end of a call and needs the resident consent', () => {
    const state = stateWith({ start: '09:00', end: '10:00' });
    state.call = { id: 'call' };
    assert.deepEqual(advanceScreenPrograms(state, at('09:00'), tz), []);
    state.call = null;
    assert.equal(advanceScreenPrograms(state, at('09:01'), tz)[0].kind, 'started');
    const noConsent = stateWith({ start: '09:00', end: '10:00' });
    noConsent.settings.consent = false;
    assert.deepEqual(advanceScreenPrograms(noConsent, at('09:00'), tz), []);
  });

  it('plays a one-time program on its date only, then forgets it', () => {
    const state = stateWith({
      repeat: 'once',
      days: undefined,
      date: '2026-11-25',
      start: '15:00',
      end: '16:00',
    });
    assert.equal(advanceScreenPrograms(state, at('15:00', '2026-11-18'), tz).length, 0);
    assert.equal(advanceScreenPrograms(state, at('15:00'), tz)[0].kind, 'started');
    advanceScreenPrograms(state, at('16:00'), tz);
    assert.equal(state.programs.length, 0);
  });

  it('chains two back-to-back programs without going home in between', () => {
    const otherId = '550e8400-e29b-41d4-a716-446655440003';
    const state = stateWith(
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00', mediaId: otherId, title: 'Journal' },
    );
    state.media.push({ id: otherId, title: 'Journal', kind: 'tv', url: 'https://tv.test' });
    advanceScreenPrograms(state, at('09:00'), tz);
    const events = advanceScreenPrograms(state, at('10:00'), tz);
    assert.deepEqual(
      events.map((event) => event.kind),
      ['ended', 'started'],
    );
    assert.equal(state.playback.mediaId, otherId);
  });
});
