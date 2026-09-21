import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  calendarCreateSchema,
  type CalendarEvent,
  type CalendarRecurrence,
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
  const [scope, setScope] = useState<'ONE' | 'SERIES'>('ONE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    type: 'APPOINTMENT' as 'APPOINTMENT' | 'VISIT',
    title: '',
    startsAt: '',
    endsAt: '',
    location: '',
    notes: '',
    recurrence: 'NONE' as CalendarRecurrence,
    recurrenceUntil: '',
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
  const reset = () => {
    setForm({
      type: 'APPOINTMENT',
      title: '',
      startsAt: isoLocal(new Date(Date.now() + 3600000)),
      endsAt: '',
      location: '',
      notes: '',
      recurrence: 'NONE',
      recurrenceUntil: '',
    });
    setEditing(null);
    setScope('ONE');
    setOpen(true);
  };
  const edit = (event: CalendarEvent) => {
    setEditing(event);
    setScope('ONE');
    setForm({
      type: event.type,
      title: event.title,
      startsAt: formDate(event.startsAt),
      endsAt: event.endsAt ? formDate(event.endsAt) : '',
      location: event.detail ?? '',
      notes: event.notes ?? '',
      recurrence: event.recurrence,
      recurrenceUntil: event.recurrenceUntil ? formDate(event.recurrenceUntil) : '',
    });
    setOpen(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !data?.canWrite) return;
    setBusy(true);
    setError('');
    const base = {
      type: form.type,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      notes: form.notes || null,
      recurrence: form.recurrence,
      recurrenceUntil: form.recurrenceUntil ? new Date(form.recurrenceUntil).toISOString() : null,
    };
    const input =
      form.type === 'VISIT'
        ? { ...base, type: 'VISIT' as const, visitorName: form.title }
        : {
            ...base,
            type: 'APPOINTMENT' as const,
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
          body: JSON.stringify(editing ? { ...parsed.data, scope } : parsed.data),
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
    if (!data?.canWrite || !window.confirm(fr ? 'Supprimer cet élément ?' : 'Delete this event?'))
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
    await fetch(`/api/v1/calendar/${event.id}?scope=${selectedScope}`, { method: 'DELETE' });
    await load();
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
              ? 'Les rendez-vous et visites de la maison, au même endroit.'
              : 'Appointments and visits for the home, in one place.'}
          </p>
        </div>
        <div className="calendar-hero-actions">
          <button className="calendar-back" onClick={onBack}>
            <ChevronLeft /> {fr ? 'Retour au carnet' : 'Back to notebook'}
          </button>
          {data?.canWrite && (
            <button className="calendar-primary" onClick={reset}>
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
                className={`calendar-day ${day && dayKey(day) === dayKey(new Date()) ? 'today' : ''}`}
                key={day ? day.toISOString() : `blank-${index}`}
              >
                {day && (
                  <>
                    <strong>{day.getDate()}</strong>
                    {monthEvents
                      .filter((event) => dayKey(new Date(event.startsAt)) === dayKey(day))
                      .map((event) => (
                        <button
                          key={event.id}
                          className={`calendar-event calendar-event--${event.type.toLowerCase()}`}
                          onClick={() => edit(event)}
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
                  {event.type === 'VISIT' ? <UsersRound /> : <CalendarDays />}
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
                {fr
                  ? 'Ajoutez un rendez-vous ou une visite pour le foyer.'
                  : 'Add an appointment or family visit.'}
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
                    ? 'Modifier l’événement'
                    : 'Edit event'
                  : fr
                    ? 'Ajouter au calendrier'
                    : 'Add to calendar'}
              </h2>
              <button type="button" onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <div className="calendar-type">
              <button
                type="button"
                className={form.type === 'APPOINTMENT' ? 'active' : ''}
                onClick={() => setForm({ ...form, type: 'APPOINTMENT' })}
              >
                {fr ? 'Rendez-vous' : 'Appointment'}
              </button>
              <button
                type="button"
                className={form.type === 'VISIT' ? 'active' : ''}
                onClick={() => setForm({ ...form, type: 'VISIT' })}
              >
                {fr ? 'Visite familiale' : 'Family visit'}
              </button>
            </div>
            <label>
              {form.type === 'VISIT' ? (fr ? 'Visiteur' : 'Visitor') : fr ? 'Titre' : 'Title'}
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <div className="calendar-form-grid">
              <label>
                {fr ? 'Début' : 'Start'}
                <input
                  required
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                />
              </label>
              <label>
                {fr ? 'Fin' : 'End'}
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
                />
              </label>
            </div>
            {form.type === 'APPOINTMENT' && (
              <label>
                {fr ? 'Lieu' : 'Location'}
                <input
                  value={form.location}
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                />
              </label>
            )}
            <label>
              {fr ? 'Notes' : 'Notes'}
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </label>
            <div className="calendar-form-grid">
              <label>
                {fr ? 'Répétition' : 'Repeat'}
                <select
                  value={form.recurrence}
                  onChange={(event) =>
                    setForm({ ...form, recurrence: event.target.value as CalendarRecurrence })
                  }
                >
                  <option value="NONE">{fr ? 'Aucune' : 'None'}</option>
                  <option value="DAILY">{fr ? 'Chaque jour' : 'Daily'}</option>
                  <option value="WEEKLY">{fr ? 'Chaque semaine' : 'Weekly'}</option>
                  <option value="MONTHLY">{fr ? 'Chaque mois' : 'Monthly'}</option>
                </select>
              </label>
              {form.recurrence !== 'NONE' && (
                <label>
                  {fr ? 'Jusqu’au' : 'Until'}
                  <input
                    required
                    type="date"
                    value={form.recurrenceUntil.slice(0, 10)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        recurrenceUntil: event.target.value ? `${event.target.value}T23:59:00` : '',
                      })
                    }
                  />
                </label>
              )}
            </div>
            {editing && editing.seriesId && (
              <label className="calendar-scope">
                {fr ? 'Appliquer à' : 'Apply to'}
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as 'ONE' | 'SERIES')}
                >
                  <option value="ONE">{fr ? 'Cet élément' : 'This event'}</option>
                  <option value="SERIES">{fr ? 'Toute la série' : 'Whole series'}</option>
                </select>
              </label>
            )}
            <footer>
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
