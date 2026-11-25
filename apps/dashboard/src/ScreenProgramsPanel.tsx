import {
  screenLocalTime,
  type ScreenProgram,
  type ScreenSnapshot,
  type TvChannel,
} from '@elise/contracts';
import {
  CalendarClock,
  CalendarDays,
  Plus,
  Radio,
  Repeat,
  Trash2,
  Tv,
  Youtube,
} from 'lucide-react';
import { useState } from 'react';
import { t } from './i18n';
import { createId } from './lib/createId';
import { dateLocale } from './screen-locale';

type Request = <T>(path: string, body?: unknown, method?: string) => Promise<T>;

/** Monday first, as on French calendars; 0 is Sunday as in Date.getDay(). */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const weekdayName = (day: number, width: 'short' | 'long') =>
  // 4 January 2026 is a Sunday.
  new Intl.DateTimeFormat(dateLocale(), { weekday: width, timeZone: 'UTC' }).format(
    Date.UTC(2026, 0, 4 + day),
  );

/** "Mon, Wed, Fri", "Every day", "Weekdays" or "Saturday, Sunday". */
export function programDaysLabel(days: readonly number[]) {
  const set = new Set(days);
  if (set.size === 7) return t('screenPrograms.everyDay');
  if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day)))
    return t('screenPrograms.weekdays');
  const ordered = WEEK.filter((day) => set.has(day));
  return ordered.map((day) => weekdayName(day, ordered.length > 2 ? 'short' : 'long')).join(', ');
}

export function programWhenLabel(program: ScreenProgram) {
  const hours = `${program.start} – ${program.end}`;
  if (program.repeat === 'weekly') return `${programDaysLabel(program.days ?? [])} · ${hours}`;
  const date = new Intl.DateTimeFormat(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${program.date}T12:00:00Z`));
  return `${date} · ${hours}`;
}

export function ScreenProgramsPanel({
  snapshot,
  hidden,
  busy,
  tvLineup,
  tvChannelTitle,
  run,
  request,
}: {
  snapshot: ScreenSnapshot;
  hidden: boolean;
  busy: boolean;
  tvLineup: TvChannel[];
  tvChannelTitle: (channel: TvChannel) => string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  request: Request;
}) {
  const { state } = snapshot;
  const today = screenLocalTime(new Date(), snapshot.timezone);
  const radios = state.media.filter((media) => media.kind === 'stream');
  const videos = state.media.filter((media) => media.kind === 'youtube');
  const [choice, setChoice] = useState('');
  const [repeat, setRepeat] = useState<'weekly' | 'once'>('weekly');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [date, setDate] = useState(today.date);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  // Weekly programs first, then one-time ones by date; each by start time.
  const sortKey = (program: ScreenProgram) =>
    `${program.repeat === 'once' ? program.date : '0000'} ${program.start}`;
  const programs = [...(state.programs ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const playingId = state.programRun?.programId;
  const firstChoice = radios[0]
    ? `media:${radios[0].id}`
    : tvLineup[0]
      ? `channel:${tvLineup[0].id}`
      : videos[0]
        ? `media:${videos[0].id}`
        : '';
  const selected = choice || firstChoice;
  const valid = !!selected && start !== end && (repeat === 'once' ? !!date : days.length > 0);
  const mediaFor = (program: ScreenProgram) =>
    state.media.find((media) => media.id === program.mediaId);

  const submit = () =>
    void run(async () => {
      let mediaId = selected.slice('media:'.length);
      if (selected.startsWith('channel:')) {
        const channel = tvLineup.find(({ id }) => `channel:${id}` === selected);
        if (!channel) return;
        const existing = state.media.find(
          (media) => media.kind === 'tv' && media.url === channel.url,
        );
        mediaId = existing?.id ?? createId();
        if (!existing)
          await request('screen/media', {
            id: mediaId,
            title: tvChannelTitle(channel),
            kind: 'tv',
            url: channel.url,
          });
      }
      await request('screen/programs', {
        repeat,
        ...(repeat === 'weekly' ? { days } : { date }),
        start,
        end,
        mediaId,
      });
      setChoice('');
    });

  return (
    <section
      id="screen-main-panel-programs"
      role="tabpanel"
      aria-labelledby="screen-main-tab-programs"
      hidden={hidden}
      className="screen-card screen-programs"
    >
      <div className="screen-card__heading">
        <span>
          <CalendarClock aria-hidden="true" />
        </span>
        <div>
          <h3>{t('screenPrograms.title')}</h3>
          <p>{t('screenPrograms.intro', { resident: snapshot.resident })}</p>
        </div>
        {programs.length > 0 && (
          <strong className="screen-scheduled-count">
            {t('screenPrograms.count', { count: programs.length })}
          </strong>
        )}
      </div>

      <form
        className="screen-program-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) submit();
        }}
      >
        <label className="screen-program-field screen-program-field--what">
          {t('screenPrograms.what')}
          <select value={selected} onChange={(event) => setChoice(event.target.value)}>
            {radios.length === 0 && tvLineup.length === 0 && videos.length === 0 && (
              <option value="">{t('screenPrograms.nothingToProgram')}</option>
            )}
            {radios.length > 0 && (
              <optgroup label={t('screenPrograms.radios')}>
                {radios.map((media) => (
                  <option key={media.id} value={`media:${media.id}`}>
                    {media.title}
                  </option>
                ))}
              </optgroup>
            )}
            {tvLineup.length > 0 && (
              <optgroup label={t('screenPrograms.tvChannels')}>
                {tvLineup.map((channel) => (
                  <option key={channel.id} value={`channel:${channel.id}`}>
                    {channel.name}
                  </option>
                ))}
              </optgroup>
            )}
            {videos.length > 0 && (
              <optgroup label="YouTube">
                {videos.map((media) => (
                  <option key={media.id} value={`media:${media.id}`}>
                    {media.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <small>{t('screenPrograms.whatHelp')}</small>
        </label>

        <fieldset className="screen-program-field screen-program-repeat">
          <legend>{t('screenPrograms.when')}</legend>
          <div className="screen-program-toggle" role="radiogroup">
            {(
              [
                ['weekly', t('screenPrograms.everyWeek'), Repeat],
                ['once', t('screenPrograms.once'), CalendarDays],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={repeat === value}
                className={repeat === value ? 'is-selected' : ''}
                onClick={() => setRepeat(value)}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {repeat === 'weekly' ? (
            <div className="screen-program-days" aria-label={t('screenPrograms.days')}>
              {WEEK.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={days.includes(day)}
                  title={weekdayName(day, 'long')}
                  className={days.includes(day) ? 'is-selected' : ''}
                  onClick={() =>
                    setDays((current) =>
                      current.includes(day)
                        ? current.filter((item) => item !== day)
                        : [...current, day],
                    )
                  }
                >
                  {weekdayName(day, 'short').replace('.', '')}
                </button>
              ))}
            </div>
          ) : (
            <input
              type="date"
              aria-label={t('screenPrograms.date')}
              value={date}
              min={today.date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </fieldset>

        <div className="screen-program-hours">
          <label className="screen-program-field">
            {t('screenPrograms.start')}
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="screen-program-field">
            {t('screenPrograms.end')}
            <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>

        <div className="screen-program-submit">
          <p>{t('screenPrograms.howItWorks')}</p>
          <button
            type="submit"
            className="screen-button screen-button--primary"
            disabled={busy || !valid}
          >
            <Plus aria-hidden="true" />
            {t('screenPrograms.add')}
          </button>
        </div>
      </form>

      {programs.length === 0 ? (
        <p className="screen-empty-library screen-program-empty">{t('screenPrograms.empty')}</p>
      ) : (
        <ul className="screen-scheduled-list screen-program-list">
          {programs.map((program) => {
            const media = mediaFor(program);
            const Icon = media?.kind === 'tv' ? Tv : media?.kind === 'youtube' ? Youtube : Radio;
            const playing = program.id === playingId;
            return (
              <li key={program.id} className={playing ? 'is-playing' : ''}>
                <span className="screen-scheduled-kind">
                  {media?.artworkUrl ? (
                    <img src={media.artworkUrl} alt="" loading="lazy" />
                  ) : (
                    <Icon aria-hidden="true" />
                  )}
                </span>
                <span>
                  <strong>
                    {media?.title ?? program.title}
                    {playing && (
                      <em className="screen-program-live">{t('screenPrograms.playingNow')}</em>
                    )}
                  </strong>
                  <small>
                    {programWhenLabel(program)} ·{' '}
                    {t('screenPrograms.addedBy', { name: program.actor })}
                  </small>
                </span>
                <button
                  className="screen-icon-button"
                  aria-label={t('screenPrograms.remove', { title: media?.title ?? program.title })}
                  disabled={busy}
                  onClick={() =>
                    void run(() => request(`screen/programs/${program.id}`, undefined, 'DELETE'))
                  }
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
