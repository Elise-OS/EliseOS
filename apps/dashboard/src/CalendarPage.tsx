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
} from '@michel/contracts';
import type { Locale } from './i18n';
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
      setError(fr ? 'Le calendrier est inaccessible.' : 'The calendar is unavailable.');
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
      setError(fr ? 'Renseignez un rendez-vous et des dates valides.' : 'Enter valid event dates.');
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
      setError(fr ? 'Renseignez le titre et une date valide.' : 'Enter a title and valid date.');
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
      setNotice(
        fr
          ? editing
            ? 'Rendez-vous modifié.'
            : 'Rendez-vous ajouté.'
          : editing
            ? 'Event updated.'
            : 'Event added.',
      );
      await load();
    } catch {
      setError(fr ? 'Enregistrement impossible.' : 'Could not save the event.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (event: CalendarEvent) => {
    if (
      busy ||
      !data?.canWrite ||
      !window.confirm(fr ? 'Supprimer ce rendez-vous ?' : 'Delete this appointment?')
    )
      return;
    const selectedScope =
      event.seriesId &&
      window.confirm(
        fr
          ? 'Supprimer toute la série ? (Annuler pour cet élément seulement)'
          : 'Delete the whole series? (Cancel for this event only)',
      )
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
      setNotice(fr ? 'Rendez-vous supprimé.' : 'Appointment deleted.');
      await load();
    } catch {
      setError(fr ? 'Suppression impossible.' : 'Could not delete the appointment.');
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
  return (
    <main className="calendar-page">
      <header className="calendar-hero">
        <div>
          <span className="calendar-eyebrow">{fr ? 'Carnet de liaison' : 'Family notebook'}</span>
          <h1>
            <CalendarDays /> {fr ? 'Calendrier partagé' : 'Shared calendar'}
          </h1>
          <p>
            {fr
              ? 'Les rendez-vous de la maison, au même endroit. Ceux du jour s’affichent aussi sur la TV.'
              : 'Appointments for the home, all in one place. Today’s appointments also appear on the TV.'}
          </p>
        </div>
        <div className="calendar-hero-actions">
          <button className="calendar-back" onClick={onBack}>
            <ChevronLeft /> {fr ? 'Retour au carnet' : 'Back to notebook'}
          </button>
          {data?.canWrite && (
            <button className="calendar-primary" onClick={() => reset()}>
              <Plus /> {fr ? 'Ajouter' : 'Add event'}
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
            {fr ? 'Mois' : 'Month'}
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            {fr ? 'Liste' : 'List'}
          </button>
        </div>
      </section>
      {view === 'month' ? (
        <section className="calendar-month">
          <div className="calendar-weekdays">
            {(fr
              ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
              : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            ).map((day) => (
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
                    ? fr
                      ? `Ajouter un rendez-vous le ${day.toLocaleDateString(locale)}`
                      : `Add an appointment on ${day.toLocaleDateString(locale)}`
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
                    <button onClick={() => edit(event)} aria-label={fr ? 'Modifier' : 'Edit'}>
                      <Pencil />
                    </button>
                    <button
                      onClick={() => void remove(event)}
                      aria-label={fr ? 'Supprimer' : 'Delete'}
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
              <h3>{fr ? 'Aucun rendez-vous prévu' : 'No upcoming event'}</h3>
              <p>
                {fr ? 'Ajoutez un rendez-vous pour le foyer.' : 'Add an appointment for the home.'}
              </p>
            </div>
          )}
        </section>
      )}
      {open && (
        <div className="calendar-modal-backdrop" role="presentation">
          <form className="calendar-modal" onSubmit={(event) => void submit(event)}>
            <header>
              <h2>
                {editing
                  ? fr
                    ? 'Modifier le rendez-vous'
                    : 'Edit appointment'
                  : fr
                    ? 'Ajouter un rendez-vous'
                    : 'Add an appointment'}
              </h2>
              <button type="button" onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <label>
              {fr ? 'Rendez-vous' : 'Appointment'}
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              {fr ? 'Date et heure' : 'Date and time'}
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
                  <Trash2 /> {fr ? 'Supprimer' : 'Delete'}
                </button>
              )}
              <button type="button" className="calendar-cancel" onClick={() => setOpen(false)}>
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button className="calendar-primary" disabled={busy} type="submit">
                {busy ? '…' : fr ? 'Enregistrer' : 'Save'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}
