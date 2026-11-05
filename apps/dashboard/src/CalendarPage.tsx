import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  calendarCreateSchema,
  type CalendarEvent,
  type CalendarPage as CalendarData,
} from '@elise/contracts';
import { dateLocale, type Locale, t } from './i18n';
import { DataLoadingScreen } from './DataLoadingScreen';
import './calendar-page.css';

const isoLocal = (value: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};
const formDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : isoLocal(date);
};
const dayKey = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;

// Monday first, three letters: « Lun », « Mon »… in the current language.
function weekdayShortNames() {
  return Array.from({ length: 7 }, (_, day) => {
    const name = new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2023, 0, 2 + day)))
      .replace(/\.$/, '');
    return name.charAt(0).toLocaleUpperCase(dateLocale()) + name.slice(1);
  });
}

export function CalendarPage({ locale = 'fr', onBack }: { locale?: Locale; onBack: () => void }) {
  const fr = locale === 'fr';
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [data, setData] = useState<CalendarData | null>(null);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    title: '',
    startsAt: '',
    location: '',
    notes: '',
  });
  const range = useMemo(() => {
    const from = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 2, 0, 23, 59, 59);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [month]);
  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/v1/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      );
      if (!response.ok) throw new Error();
      setData((await response.json()) as CalendarData);
      setError('');
    } catch {
      setError(t('calendarPage.theCalendarIsUnavailable'));
    } finally {
      setLoading(false);
    }
  }, [fr, range]);
  useEffect(() => {
    void load();
    const stream = new EventSource('/api/v1/events');
    stream.onmessage = () => void load();
    return () => stream.close();
  }, [load]);
  const events = data?.items ?? [];
  const monthEvents = events.filter((event) => {
    const date = new Date(event.startsAt);
    return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
  });
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const start = (first.getDay() + 6) % 7;
    return Array.from({ length: Math.ceil((start + count) / 7) * 7 }, (_, index) =>
      index < start || index >= start + count
        ? null
        : new Date(month.getFullYear(), month.getMonth(), index - start + 1),
    );
  }, [month]);
  const reset = (selectedDay?: Date) => {
    const startsAt = selectedDay
      ? new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate(), 9, 0)
      : new Date(Date.now() + 3600000);
    setForm({
      title: '',
      startsAt: isoLocal(startsAt),
      location: '',
      notes: '',
    });
    setEditing(null);
    setOpen(true);
  };
  const edit = (event: CalendarEvent) => {
    setEditing(event);
    setForm({
      title: event.title,
      startsAt: formDate(event.startsAt),
      location: event.detail ?? '',
      notes: event.notes ?? '',
    });
    setOpen(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !data?.canWrite) return;
    setBusy(true);
    setError('');
    const startsAt = new Date(form.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      setError(t('calendarPage.enterValidEventDates'));
      setBusy(false);
      return;
    }
    const input = {
      type: 'APPOINTMENT' as const,
      startsAt: startsAt.toISOString(),
      endsAt: null,
      notes: form.notes || null,
      recurrence: 'NONE' as const,
      recurrenceUntil: null,
      title: form.title,
      location: form.location || null,
    };
    const parsed = calendarCreateSchema.safeParse(input);
    if (!parsed.success) {
      setError(t('calendarPage.enterATitleAndValid'));
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(
        editing ? `/api/v1/calendar/${editing.id}` : '/api/v1/calendar',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!response.ok) throw new Error();
      setOpen(false);
      setNotice(editing ? t('calendarPage.eventUpdated') : t('calendarPage.eventAdded'));
      await load();
    } catch {
      setError(t('calendarPage.couldNotSaveTheEvent'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (event: CalendarEvent) => {
    if (busy || !data?.canWrite || !window.confirm(t('calendarPage.deleteThisAppointment'))) return;
    const selectedScope =
      event.seriesId && window.confirm(t('calendarPage.deleteTheWholeSeriesCancel'))
        ? 'SERIES'
        : 'ONE';
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/calendar/${event.id}?scope=${selectedScope}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error();
      setOpen(false);
      setEditing(null);
      setNotice(t('calendarPage.appointmentDeleted'));
      await load();
    } catch {
      setError(t('calendarPage.couldNotDeleteTheAppointment'));
    } finally {
      setBusy(false);
    }
  };
  const format = (value: string) =>
    new Date(value).toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: data?.timezone,
    });

  if (loading && !data)
    return (
      <DataLoadingScreen locale={locale} message={t('calendarPage.preparingTheSharedCalendar')} />
    );

  return (
    <main className="calendar-page">
      <header className="page-hero calendar-hero">
        <div className="page-hero__copy">
          <span className="page-hero__eyebrow calendar-eyebrow">
            {t('calendarPage.familyNotebook')}
          </span>
          <h1 className="page-hero__title">
            <CalendarDays /> {t('calendarPage.sharedCalendar')}
          </h1>
          <p className="page-hero__text">{t('calendarPage.appointmentsForTheHomeAll')}</p>
        </div>
        <div className="page-hero__actions calendar-hero-actions">
          <button className="calendar-back" onClick={onBack}>
            <ChevronLeft /> {t('calendarPage.backToNotebook')}
          </button>
          {data?.canWrite && (
            <button className="calendar-primary" onClick={() => reset()}>
              <Plus /> {t('calendarPage.addEvent')}
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="calendar-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="calendar-notice" role="status">
          {notice}
        </p>
      )}
      <section className="calendar-toolbar">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft />
        </button>
        <h2>{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h2>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight />
        </button>
        <div className="calendar-view-switch">
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>
            {t('calendarPage.month')}
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            {t('calendarPage.list')}
          </button>
        </div>
      </section>
      {view === 'month' ? (
        <section className="calendar-month">
          <div className="calendar-weekdays">
            {weekdayShortNames().map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((day, index) => (
              <div
                className={`calendar-day ${day && dayKey(day) === dayKey(new Date()) ? 'today' : ''} ${day && data?.canWrite ? 'is-clickable' : ''}`}
                key={day ? day.toISOString() : `blank-${index}`}
                role={day && data?.canWrite ? 'button' : undefined}
                tabIndex={day && data?.canWrite ? 0 : undefined}
                data-calendar-day={
                  day
                    ? `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
                    : undefined
                }
                aria-label={
                  day && data?.canWrite
                    ? t('calendarPage.addAnAppointmentOn', {
                        toLocaleDateString: day.toLocaleDateString(locale),
                      })
                    : undefined
                }
                onClick={day && data?.canWrite ? () => reset(day) : undefined}
                onKeyDown={
                  day && data?.canWrite
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          reset(day);
                        }
                      }
                    : undefined
                }
              >
                {day && (
                  <>
                    <strong>{day.getDate()}</strong>
                    {monthEvents
                      .filter((event) => dayKey(new Date(event.startsAt)) === dayKey(day))
                      .map((event) => (
                        <button
                          key={event.id}
                          className="calendar-event calendar-event--appointment"
                          onClick={(click) => {
                            click.stopPropagation();
                            edit(event);
                          }}
                        >
                          <span>
                            {new Date(event.startsAt).toLocaleTimeString(locale, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>{' '}
                          {event.title}
                        </button>
                      ))}
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="calendar-list">
          {monthEvents.length ? (
            monthEvents.map((event) => (
              <article className="calendar-list-item" key={event.id}>
                <div className="calendar-list-icon">
                  <CalendarDays />
                </div>
                <div>
                  <strong>{event.title}</strong>
                  <p>
                    <Clock3 /> {format(event.startsAt)}{' '}
                    {event.detail && (
                      <>
                        <MapPin /> {event.detail}
                      </>
                    )}
                  </p>
                  {event.notes && <small>{event.notes}</small>}
                </div>
                {data?.canWrite && (
                  <div className="calendar-list-actions">
                    <button onClick={() => edit(event)} aria-label={t('calendarPage.edit')}>
                      <Pencil />
                    </button>
                    <button
                      onClick={() => void remove(event)}
                      aria-label={t('calendarPage.delete')}
                    >
                      <Trash2 />
                    </button>
                  </div>
                )}
              </article>
            ))
          ) : (
            <div className="calendar-empty">
              <CalendarDays />
              <h3>{t('calendarPage.noUpcomingEvent')}</h3>
              <p>{t('calendarPage.addAnAppointmentForThe')}</p>
            </div>
          )}
        </section>
      )}
      {open && (
        <div className="calendar-modal-backdrop" role="presentation">
          <form className="calendar-modal" onSubmit={(event) => void submit(event)}>
            <header>
              <h2>
                {editing ? t('calendarPage.editAppointment') : t('calendarPage.addAnAppointment')}
              </h2>
              <button type="button" onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <label>
              {t('calendarPage.appointment')}
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              {t('calendarPage.dateAndTime')}
              <input
                required
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
              />
            </label>
            <footer>
              {editing && (
                <button
                  type="button"
                  className="calendar-delete"
                  disabled={busy}
                  onClick={() => void remove(editing)}
                >
                  <Trash2 /> {t('calendarPage.delete')}
                </button>
              )}
              <button type="button" className="calendar-cancel" onClick={() => setOpen(false)}>
                {t('calendarPage.cancel')}
              </button>
              <button className="calendar-primary" disabled={busy} type="submit">
                {busy ? '…' : t('calendarPage.save')}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}
