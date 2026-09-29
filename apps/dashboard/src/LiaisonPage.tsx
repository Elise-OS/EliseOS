import {
  Annoyed,
  BedDouble,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Frown,
  Laugh,
  Lightbulb,
  Meh,
  MoreHorizontal,
  PenLine,
  Pill,
  Send,
  Smile,
  Trash2,
  TriangleAlert,
  UserRound,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  liaisonCreateSchema,
  liaisonMoodLabel,
  liaisonUpdateSchema,
  type LiaisonEntry,
  type LiaisonFilter,
  type LiaisonPage as Page,
} from '@michel/contracts';
import type { Locale } from './i18n';
import { DataLoadingScreen } from './DataLoadingScreen';
import './liaison.css';

interface PendingMedication {
  name: string;
  dosage: string;
  scheduledFor: string;
}

interface AttentionItem {
  title: string;
  explanation: string;
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
}

interface TagMeta {
  label: string;
  icon: LucideIcon;
  tone: string;
}

function tagMeta(tag: LiaisonEntry['tags'][number], locale: Locale): TagMeta {
  const french = locale === 'fr';
  const values = {
    MEAL: { label: french ? 'Repas' : 'Meal', icon: Utensils, tone: 'meal' },
    TREATMENT: { label: french ? 'Traitement' : 'Treatment', icon: Pill, tone: 'treatment' },
    MOOD: { label: french ? 'Humeur' : 'Mood', icon: Smile, tone: 'mood' },
    REST: { label: french ? 'Repos' : 'Rest', icon: BedDouble, tone: 'rest' },
  };
  return values[tag];
}

const MOODS = [
  { id: 'HAPPY', fr: 'Heureux', en: 'Happy', icon: Laugh },
  { id: 'GOOD', fr: 'Bien', en: 'Good', icon: Smile },
  { id: 'NEUTRAL', fr: 'Neutre', en: 'Neutral', icon: Meh },
  { id: 'LOW', fr: 'Pas très bien', en: 'Not so good', icon: Annoyed },
  { id: 'SAD', fr: 'Triste', en: 'Sad', icon: Frown },
] as const;

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '—'
  );
}

const USER_TONES = ['blue', 'amber', 'green'] as const;
type UserTone = (typeof USER_TONES)[number];

function userTone(user: { id: string } | null | undefined): UserTone {
  const key = user?.id ?? 'former-member';
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return USER_TONES[hash % USER_TONES.length]!;
}

function dateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function LiaisonPage({
  locale = 'fr',
  pendingMedication = null,
  attention = null,
  onMedication,
  onAttention,
  onJournal,
  onCalendar,
}: {
  locale?: Locale;
  pendingMedication?: PendingMedication | null;
  attention?: AttentionItem | null;
  onMedication?: () => void;
  onAttention?: () => void;
  onJournal?: () => void;
  onCalendar?: () => void;
}) {
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);
  const [data, setData] = useState<Page | null>(null);
  const [filter, setFilter] = useState<LiaisonFilter>('ALL');
  const [visits, setVisits] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const [moodOpen, setMoodOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LiaisonEntry | null>(null);
  const [entryDraft, setEntryDraft] = useState('');
  const [deletingEntry, setDeletingEntry] = useState<LiaisonEntry | null>(null);
  const [now, setNow] = useState(() => new Date());
  const sequence = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const moodTriggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const request = ++sequence.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({ filter, ...(cursor ? { cursor } : {}) });
        const response = await fetch(`/api/v1/liaison?${params}`);
        if (!response.ok) throw new Error();
        const next = (await response.json()) as Page;
        if (request !== sequence.current) return;
        setData((previous) => ({
          ...next,
          items:
            cursor && previous
              ? [
                  ...previous.items,
                  ...next.items.filter((item) => !previous.items.some((old) => old.id === item.id)),
                ]
              : next.items,
        }));
        setError('');
      } catch {
        if (request === sequence.current)
          setError(
            tr(
              'Le carnet est inaccessible. Vérifiez la connexion et réessayez.',
              'The notebook is unavailable. Check your connection and retry.',
            ),
          );
      } finally {
        if (request === sequence.current) setLoading(false);
      }
    },
    [filter, locale],
  );

  useEffect(() => {
    setData(null);
    void load();
    const stream = new EventSource('/api/v1/events');
    stream.onmessage = (message) => {
      try {
        const event = JSON.parse(typeof message.data === 'string' ? message.data : '{}') as {
          type: string;
        };
        if (['liaison', 'schedule', 'household', 'connected'].includes(event.type)) void load();
      } catch {
        /* Periodic refresh recovers missed events. */
      }
    };
    const refreshTimer = window.setInterval(() => void load(), 30_000);
    const clockTimer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      ++sequence.current;
      stream.close();
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [load]);

  async function mutate(path: string, method: string, input: unknown, success: string) {
    if (busy) return false;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(`/api/v1/liaison${path}`, {
        method,
        ...(input === undefined ? {} : { headers: { 'content-type': 'application/json' } }),
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      if (!response.ok) throw new Error();
      setNotice(success);
      await load();
      return true;
    } catch {
      setError(
        tr(
          'Modification non enregistrée. Vérifiez la connexion et vos droits, puis réessayez. Votre texte est conservé.',
          'Change not saved. Check your connection and permissions, then retry. Your text is preserved.',
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = liaisonCreateSchema.safeParse({ kind: 'NOTE', body });
    if (!input.success) {
      setError(tr('Ajoutez un texte.', 'Add a message.'));
      return;
    }
    if (
      await mutate(
        '',
        'POST',
        input.data,
        tr('Votre note a été partagée.', 'Your note has been shared.'),
      )
    ) {
      setBody('');
      composerRef.current?.focus();
    }
  }

  async function addMood(mood: (typeof MOODS)[number]) {
    const input = liaisonCreateSchema.safeParse({
      kind: 'NOTE',
      body: `mood:${mood.id}`,
      tags: ['MOOD'],
    });
    if (!input.success) return;
    setVisits(false);
    setFilter('ALL');
    const saved = await mutate(
      '',
      'POST',
      input.data,
      tr('Humeur ajoutée au carnet.', 'Mood added to the notebook.'),
    );
    setMoodOpen(false);
    if (saved) moodTriggerRef.current?.focus();
  }

  function startEditing(item: LiaisonEntry) {
    setEntryDraft(item.body);
    setEditingEntry(item);
  }

  async function updateMood(mood: (typeof MOODS)[number]) {
    if (!editingEntry) return;
    const input = liaisonUpdateSchema.safeParse({ body: `mood:${mood.id}`, tags: ['MOOD'] });
    if (!input.success) return;
    const saved = await mutate(
      `/${encodeURIComponent(editingEntry.id)}`,
      'PATCH',
      input.data,
      tr('Humeur modifiée.', 'Mood updated.'),
    );
    if (saved) {
      setEditingEntry(null);
      moodTriggerRef.current?.focus();
    }
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!editingEntry) return;
    const moodTags =
      editingEntry.tags.includes('MOOD') &&
      !liaisonMoodLabel(entryDraft, locale === 'fr' ? 'fr' : 'en')
        ? editingEntry.tags.filter((tag) => tag !== 'MOOD')
        : undefined;
    const input = liaisonUpdateSchema.safeParse({
      body: entryDraft,
      ...(moodTags ? { tags: moodTags } : {}),
    });
    if (!input.success) {
      setError(tr('Le message ne peut pas être vide.', 'The message cannot be empty.'));
      return;
    }
    const saved = await mutate(
      `/${encodeURIComponent(editingEntry.id)}`,
      'PATCH',
      input.data,
      tr('Message modifié.', 'Message updated.'),
    );
    if (saved) {
      setEditingEntry(null);
      setEntryDraft('');
    }
  }

  async function confirmDelete() {
    if (!deletingEntry) return;
    const deleted = await mutate(
      `/${encodeURIComponent(deletingEntry.id)}`,
      'DELETE',
      undefined,
      tr('Message supprimé.', 'Message deleted.'),
    );
    if (deleted) setDeletingEntry(null);
  }

  useEffect(() => {
    if (!moodOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoodOpen(false);
        moodTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [moodOpen]);

  useEffect(() => {
    if (!editingEntry && !deletingEntry) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setEditingEntry(null);
        setDeletingEntry(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, deletingEntry, editingEntry]);

  const timeZone = data?.timezone ?? 'Europe/Paris';
  const todayWeekday = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
  }).format(now);
  const todayDate = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(
      new Date(value),
    );
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  const todayKey = dateKey(now, timeZone);
  const todayItems = data?.items.filter(
    (item) => dateKey(new Date(item.createdAt), timeZone) === todayKey,
  );
  const visibleItems = filter === 'ALL' && !visits ? (todayItems ?? []) : (data?.items ?? []);
  const upcomingVisit = data?.visits.find(
    (visit) => !visit.completedAt && new Date(visit.startsAt) >= now,
  );
  const openTasks =
    data?.openTasks ??
    data?.items.filter((item) => item.kind === 'TASK' && !item.completedAt) ??
    [];
  const highlightedAppointments = (data?.appointments ?? []).slice(0, 3);
  const remainingAfterAppointments = 3 - highlightedAppointments.length;
  const highlightedVisit = remainingAfterAppointments > 0 ? upcomingVisit : null;
  const remainingAfterVisit = remainingAfterAppointments - Number(Boolean(highlightedVisit));
  const highlightedMedication = remainingAfterVisit > 0 ? pendingMedication : null;
  const remainingAfterMedication = remainingAfterVisit - Number(Boolean(highlightedMedication));
  const highlightedAttention = remainingAfterMedication > 0 ? attention : null;
  const nonTaskHighlightCount =
    highlightedAppointments.length +
    Number(Boolean(highlightedVisit)) +
    Number(Boolean(highlightedMedication)) +
    Number(Boolean(highlightedAttention));
  const highlightCount = Math.min(3, nonTaskHighlightCount + openTasks.length);
  const title = visits
    ? tr('Visites', 'Visits')
    : filter === 'OPEN'
      ? tr('À faire', 'To do')
      : filter === 'DONE'
        ? tr('Terminées', 'Completed')
        : tr('Aujourd’hui', 'Today');
  const countLabel = visits
    ? tr(`${data?.visits.length ?? 0} visites`, `${data?.visits.length ?? 0} visits`)
    : tr(
        `${visibleItems.length} ${visibleItems.length > 1 ? 'notes' : 'note'}`,
        `${visibleItems.length} ${visibleItems.length === 1 ? 'entry' : 'entries'}`,
      );
  const currentInitials = initials(data?.currentUser?.displayName ?? tr('Vous', 'You'));

  const timeline = useMemo(
    () =>
      visibleItems.map((item) => ({
        item,
        tone: userTone(item.author),
      })),
    [visibleItems],
  );
  const currentUserTone = userTone(data?.currentUser);

  if (loading && !data)
    return (
      <DataLoadingScreen
        locale={locale}
        message={tr('Chargement du carnet…', 'Loading the notebook…')}
      />
    );

  return (
    <section className="section-view liaison-page">
      <header className="liaison-hero">
        <div className="liaison-hero-copy">
          <h1>{tr('Carnet de liaison', 'Family notebook')}</h1>
        </div>
        <time className="liaison-hero-date" dateTime={todayKey}>
          <span className="liaison-hero-date__icon" aria-hidden="true">
            <CalendarDays />
          </span>
          <span className="liaison-hero-date__copy">
            <span>{todayWeekday}</span>
            <strong>{todayDate}</strong>
          </span>
        </time>
        <div className="liaison-hero-actions">
          {onCalendar && (
            <button className="liaison-calendar-button" type="button" onClick={onCalendar}>
              <CalendarDays aria-hidden="true" />
              {tr('Calendrier', 'Calendar')}
            </button>
          )}
          {data?.canWrite && (
            <button
              className="liaison-add-note"
              type="button"
              onClick={() => composerRef.current?.focus()}
            >
              <PenLine aria-hidden="true" />
              {tr('Ajouter une note', 'Add a note')}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="liaison-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            {tr('Réessayer', 'Retry')}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="liaison-notice">
          <Check aria-hidden="true" /> {notice}
        </p>
      )}

      <div className="liaison-layout">
        <section className="liaison-journal-panel" aria-labelledby="liaison-feed-title">
          <div className="liaison-panel-heading">
            <div>
              <span className="liaison-heading-dot liaison-heading-dot--green" aria-hidden="true" />
              <h2 id="liaison-feed-title">{title}</h2>
            </div>
            <details className="liaison-view-menu">
              <summary>{countLabel}</summary>
              <div className="liaison-view-options">
                {(['ALL', 'OPEN', 'DONE'] as const).map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={!visits && filter === value}
                    onClick={() => {
                      setVisits(false);
                      setFilter(value);
                    }}
                  >
                    {
                      [tr('Le fil', 'Updates'), tr('À faire', 'To do'), tr('Terminées', 'Done')][
                        index
                      ]
                    }
                  </button>
                ))}
                <button type="button" aria-pressed={visits} onClick={() => setVisits(true)}>
                  {tr('Visites', 'Visits')}
                </button>
              </div>
            </details>
          </div>

          {data && !visits && (
            <div className="liaison-timeline">
              {timeline.map(({ item, tone }) => (
                <TimelineEntry
                  key={item.id}
                  item={item}
                  tone={tone}
                  locale={locale}
                  timeZone={timeZone}
                  residentName={data.residentName ?? null}
                  canWrite={data.canWrite}
                  busy={busy}
                  onEdit={startEditing}
                  onDelete={setDeletingEntry}
                  onComplete={(completed) =>
                    void mutate(
                      `/${encodeURIComponent(item.id)}/completion`,
                      'PATCH',
                      { completed },
                      completed
                        ? tr('Merci, la tâche est terminée.', 'Thank you, task completed.')
                        : tr('Tâche remise à faire.', 'Task reopened.'),
                    )
                  }
                />
              ))}
              {!visibleItems.length && (
                <div className="liaison-empty">
                  <PenLine aria-hidden="true" />
                  <h3>{tr('Aucune information dans cette vue', 'Nothing in this view yet')}</h3>
                  <p>
                    {tr(
                      'Un passage, une attention ou une chose à prévoir peut être partagé ici.',
                      'Share a visit, something noticed, or anything that needs planning.',
                    )}
                  </p>
                </div>
              )}
              {data.nextCursor && (
                <button
                  className="liaison-load-more"
                  disabled={loading}
                  onClick={() => void load(data.nextCursor!)}
                >
                  {tr('Voir les notes précédentes', 'Load earlier entries')}
                </button>
              )}
            </div>
          )}

          {data && visits && (
            <div className="liaison-timeline">
              {data.visits.map((visit, index) => (
                <article className="liaison-timeline-row" key={visit.id}>
                  <span
                    className={`liaison-timeline-dot liaison-timeline-dot--${['blue', 'amber', 'green'][index % 3]}`}
                    aria-hidden="true"
                  />
                  <div className="liaison-note-card">
                    <div className="liaison-note-main">
                      <span className="liaison-avatar liaison-avatar--blue">
                        {initials(visit.visitorName)}
                      </span>
                      <div>
                        <div className="liaison-note-line">
                          <time dateTime={visit.startsAt}>{formatDate(visit.startsAt)}</time>
                          <strong>{visit.visitorName}</strong>
                          <span className="liaison-tag liaison-tag--rest">
                            <CalendarDays aria-hidden="true" />
                            {visit.completedAt
                              ? tr('Réalisée', 'Completed')
                              : tr('Prévue', 'Planned')}
                          </span>
                        </div>
                        {visit.notes && <p className="liaison-note-body">{visit.notes}</p>}
                        {visit.completedAt && (
                          <p className="liaison-note-detail">
                            {tr('Confirmée par', 'Confirmed by')}{' '}
                            {visit.completedBy?.displayName ?? '—'}
                          </p>
                        )}
                      </div>
                    </div>
                    {data.canWrite && (visit.completedAt || new Date(visit.startsAt) <= now) && (
                      <button
                        className="liaison-entry-action"
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            `/visits/${encodeURIComponent(visit.id)}/completion`,
                            'PATCH',
                            { completed: !visit.completedAt },
                            tr('Visite mise à jour.', 'Visit updated.'),
                          )
                        }
                      >
                        {visit.completedAt
                          ? tr('Annuler', 'Undo')
                          : tr('La visite a eu lieu', 'Confirm visit')}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!data.visits.length && (
                <div className="liaison-empty">
                  <CalendarDays aria-hidden="true" />
                  <h3>{tr('Aucune visite sur cette période', 'No visits in this period')}</h3>
                </div>
              )}
            </div>
          )}

          {data?.canWrite && (
            <form className="liaison-quick-composer" onSubmit={(event) => void submit(event)}>
              <span
                className={`liaison-avatar liaison-avatar--${currentUserTone}`}
                aria-hidden="true"
              >
                {currentInitials}
              </span>
              <div className="liaison-compose-content">
                <label className="sr-only" htmlFor="liaison-note-body">
                  {tr('Écrire une note', 'Write a note')}
                </label>
                <textarea
                  id="liaison-note-body"
                  ref={composerRef}
                  required
                  rows={2}
                  maxLength={3000}
                  value={body}
                  disabled={busy}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={tr('Écrire une note…', 'Write a note…')}
                />
                <div className="liaison-compose-footer">
                  <button
                    ref={moodTriggerRef}
                    type="button"
                    className="liaison-mood-trigger"
                    disabled={busy}
                    onClick={() => setMoodOpen(true)}
                  >
                    <Smile aria-hidden="true" />
                    {tr('Ajouter une humeur', 'Add a mood')}
                  </button>
                  <div className="liaison-compose-actions">
                    <button className="liaison-send" type="submit" disabled={busy || !body.trim()}>
                      <Send aria-hidden="true" />
                      {busy ? tr('Envoi…', 'Sending…') : tr('Envoyer', 'Send')}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}
          {moodOpen && (
            <div
              className="liaison-modal-backdrop"
              role="presentation"
              onClick={() => {
                setMoodOpen(false);
                moodTriggerRef.current?.focus();
              }}
            >
              <section
                className="liaison-mood-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="liaison-mood-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <span>{tr('Carnet de liaison', 'Family notebook')}</span>
                    <h2 id="liaison-mood-title">{tr('Ajouter une humeur', 'Add a mood')}</h2>
                  </div>
                  <button
                    type="button"
                    className="liaison-mood-close"
                    aria-label={tr('Fermer', 'Close')}
                    onClick={() => {
                      setMoodOpen(false);
                      moodTriggerRef.current?.focus();
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </header>
                <p>{tr('Comment se sent Michel ?', 'How is Michel feeling?')}</p>
                <div className="liaison-mood-options">
                  {MOODS.map((mood, index) => {
                    const Icon = mood.icon;
                    return (
                      <button
                        key={mood.id}
                        type="button"
                        disabled={busy}
                        autoFocus={index === 0}
                        onClick={() => void addMood(mood)}
                      >
                        <span
                          className={`liaison-mood-picto liaison-mood-picto--${mood.id.toLowerCase()}`}
                        >
                          <Icon aria-hidden="true" />
                        </span>
                        {locale === 'fr' ? mood.fr : mood.en}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          )}
          {editingEntry && (
            <div
              className="liaison-modal-backdrop"
              role="presentation"
              onClick={() => {
                if (!busy) setEditingEntry(null);
              }}
            >
              <section
                className="liaison-mood-dialog liaison-entry-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="liaison-edit-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <span>{tr('Carnet de liaison', 'Family notebook')}</span>
                    <h2 id="liaison-edit-title">
                      {editingEntry.tags.includes('MOOD')
                        ? tr('Modifier l’humeur', 'Change the mood')
                        : tr('Modifier le message', 'Edit message')}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="liaison-mood-close"
                    aria-label={tr('Fermer', 'Close')}
                    disabled={busy}
                    onClick={() => setEditingEntry(null)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </header>
                {editingEntry.tags.includes('MOOD') ? (
                  <>
                    <p>
                      {tr(
                        `Choisissez une humeur pour ${data?.residentName ?? 'le résident'}.`,
                        `Choose a mood for ${data?.residentName ?? 'the resident'}.`,
                      )}
                    </p>
                    <div className="liaison-mood-options">
                      {MOODS.map((mood, index) => {
                        const Icon = mood.icon;
                        return (
                          <button
                            key={mood.id}
                            type="button"
                            disabled={busy}
                            autoFocus={index === 0}
                            onClick={() => void updateMood(mood)}
                          >
                            <span
                              className={`liaison-mood-picto liaison-mood-picto--${mood.id.toLowerCase()}`}
                            >
                              <Icon aria-hidden="true" />
                            </span>
                            {locale === 'fr' ? mood.fr : mood.en}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <form onSubmit={(event) => void saveEntry(event)}>
                    <label htmlFor="liaison-edit-body">{tr('Message', 'Message')}</label>
                    <textarea
                      id="liaison-edit-body"
                      autoFocus
                      maxLength={3000}
                      rows={5}
                      value={entryDraft}
                      onChange={(event) => setEntryDraft(event.target.value)}
                    />
                    <div className="liaison-entry-dialog__actions">
                      <button
                        type="button"
                        className="liaison-entry-dialog__cancel"
                        disabled={busy}
                        onClick={() => setEditingEntry(null)}
                      >
                        {tr('Annuler', 'Cancel')}
                      </button>
                      <button
                        className="liaison-send"
                        type="submit"
                        disabled={busy || !entryDraft.trim()}
                      >
                        <Check aria-hidden="true" />
                        {busy ? tr('Enregistrement…', 'Saving…') : tr('Enregistrer', 'Save')}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            </div>
          )}
          {deletingEntry && (
            <div
              className="liaison-modal-backdrop"
              role="presentation"
              onClick={() => {
                if (!busy) setDeletingEntry(null);
              }}
            >
              <section
                className="liaison-mood-dialog liaison-entry-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="liaison-delete-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <span>{tr('Carnet de liaison', 'Family notebook')}</span>
                    <h2 id="liaison-delete-title">
                      {tr('Supprimer ce message ?', 'Delete this message?')}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="liaison-mood-close"
                    aria-label={tr('Fermer', 'Close')}
                    disabled={busy}
                    onClick={() => setDeletingEntry(null)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </header>
                <p>{tr('Cette action est définitive.', 'This action cannot be undone.')}</p>
                <div className="liaison-entry-dialog__actions">
                  <button
                    type="button"
                    className="liaison-entry-dialog__cancel"
                    disabled={busy}
                    onClick={() => setDeletingEntry(null)}
                  >
                    {tr('Annuler', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    className="liaison-entry-dialog__delete"
                    disabled={busy}
                    onClick={() => void confirmDelete()}
                  >
                    <Trash2 aria-hidden="true" />
                    {busy ? tr('Suppression…', 'Deleting…') : tr('Supprimer', 'Delete')}
                  </button>
                </div>
              </section>
            </div>
          )}
          {data && !data.canWrite && (
            <p className="liaison-readonly">
              {tr(
                'Vous pouvez consulter ce carnet. Les aidants peuvent y ajouter des notes.',
                'You can read this notebook. Caregivers can add notes.',
              )}
            </p>
          )}
        </section>

        <aside className="liaison-highlights" aria-labelledby="liaison-highlights-title">
          <div className="liaison-panel-heading">
            <div>
              <span className="liaison-heading-dot liaison-heading-dot--amber" aria-hidden="true" />
              <h2 id="liaison-highlights-title">{tr('À retenir', 'Keep in mind')}</h2>
            </div>
            <span>
              {tr(
                `${highlightCount} éléments`,
                `${highlightCount} ${highlightCount === 1 ? 'item' : 'items'}`,
              )}
            </span>
          </div>
          <div className="liaison-highlight-list">
            {highlightedAppointments.map((appointment) => (
              <HighlightCard
                key={appointment.id}
                tone="blue"
                icon={CalendarDays}
                title={tr('Rendez-vous', 'Appointment')}
                primary={`${appointment.title} · ${formatDate(appointment.startsAt)}`}
                detail={
                  [appointment.location, appointment.notes].filter(Boolean).join(' · ') ||
                  tr('Rendez-vous prévu au domicile', 'Appointment scheduled at home')
                }
                onClick={onCalendar}
              />
            ))}
            {highlightedVisit && (
              <HighlightCard
                tone="blue"
                icon={CalendarDays}
                title={tr('Prochaine visite', 'Next visit')}
                primary={`${highlightedVisit.visitorName} · ${formatDate(highlightedVisit.startsAt)}`}
                detail={
                  highlightedVisit.notes ?? tr('Visite prévue au domicile', 'Scheduled home visit')
                }
              />
            )}
            {highlightedMedication && (
              <HighlightCard
                tone="green"
                icon={Pill}
                title={tr('Prochain médicament', 'Next medication')}
                primary={`${highlightedMedication.name} · ${formatTime(highlightedMedication.scheduledFor)}`}
                detail={highlightedMedication.dosage}
                onClick={onMedication}
              />
            )}
            {highlightedAttention && (
              <HighlightCard
                tone="amber"
                icon={TriangleAlert}
                title={tr('Point d’attention', 'Needs attention')}
                primary={highlightedAttention.title}
                detail={highlightedAttention.explanation}
                onClick={onAttention}
              />
            )}
            {openTasks.slice(0, Math.max(0, 3 - nonTaskHighlightCount)).map((task) => (
              <HighlightCard
                key={task.id}
                tone={task.dueOn && task.dueOn < (data?.today ?? todayKey) ? 'amber' : 'blue'}
                icon={ClipboardCheck}
                title={task.assignee?.displayName ?? tr('À répartir', 'Unassigned')}
                primary={task.body}
                detail={
                  task.dueOn
                    ? `${tr('Pour le', 'Due')} ${new Date(`${task.dueOn}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', dateStyle: 'medium' })}`
                    : tr('Sans échéance', 'No due date')
                }
                actionLabel={data?.canWrite ? tr('C’est fait', 'Done') : undefined}
                onClick={
                  data?.canWrite
                    ? () =>
                        void mutate(
                          `/${encodeURIComponent(task.id)}/completion`,
                          'PATCH',
                          { completed: true },
                          tr('Merci, la tâche est terminée.', 'Thank you, task completed.'),
                        )
                    : undefined
                }
              />
            ))}
            {!highlightCount && (
              <div className="liaison-highlight-empty">
                <Check aria-hidden="true" />
                <strong>{tr('Rien à signaler', 'Nothing to flag')}</strong>
                <span>
                  {tr('Aucune tâche ou visite prochaine.', 'No upcoming tasks or visits.')}
                </span>
              </div>
            )}
          </div>
          <div className="liaison-help-card">
            <Lightbulb aria-hidden="true" />
            <div>
              <strong>{tr('Un doute ?', 'Not sure?')}</strong>
              <span>
                {tr(
                  'N’hésitez pas à laisser une note pour informer les autres aidants.',
                  'Leave a note to keep the other caregivers informed.',
                )}
              </span>
            </div>
          </div>
          {onJournal && (
            <button className="liaison-journal-link" type="button" onClick={onJournal}>
              {tr('Ouvrir le journal du foyer', 'Open household journal')}
              <ChevronRight aria-hidden="true" />
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}

function TimelineEntry({
  item,
  tone,
  locale,
  timeZone,
  residentName,
  canWrite,
  busy,
  onEdit,
  onDelete,
  onComplete,
}: {
  item: LiaisonEntry;
  tone: UserTone;
  locale: Locale;
  timeZone: string;
  residentName: string | null;
  canWrite: boolean;
  busy: boolean;
  onEdit: (item: LiaisonEntry) => void;
  onDelete: (item: LiaisonEntry) => void;
  onComplete: (completed: boolean) => void;
}) {
  const author = item.author?.displayName ?? (locale === 'fr' ? 'Ancien proche' : 'Former member');
  const mood = item.tags.includes('MOOD')
    ? liaisonMoodLabel(item.body, locale === 'fr' ? 'fr' : 'en')
    : null;
  const createdAt = new Date(item.createdAt);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(createdAt);
  return (
    <article className={`liaison-timeline-row ${item.completedAt ? 'is-complete' : ''}`}>
      <span className={`liaison-timeline-dot liaison-timeline-dot--${tone}`} aria-hidden="true" />
      <div className="liaison-note-card">
        <div className="liaison-note-main">
          <span className={`liaison-avatar liaison-avatar--${tone}`}>{initials(author)}</span>
          <div className="liaison-note-copy">
            <div className="liaison-note-line">
              <time dateTime={item.createdAt}>{time}</time>
              <span aria-hidden="true">·</span>
              <strong>{author}</strong>
              {item.tags.map((tag) => {
                const meta = tagMeta(tag, locale);
                const Icon = meta.icon;
                return (
                  <span className={`liaison-tag liaison-tag--${meta.tone}`} key={tag}>
                    <Icon aria-hidden="true" />
                    {meta.label}
                  </span>
                );
              })}
              {item.kind === 'TASK' && (
                <span className="liaison-tag liaison-tag--task">
                  <ClipboardCheck aria-hidden="true" />
                  {item.completedAt
                    ? locale === 'fr'
                      ? 'Terminée'
                      : 'Completed'
                    : locale === 'fr'
                      ? 'À faire'
                      : 'To do'}
                </span>
              )}
            </div>
            <p className="liaison-note-body">
              {mood
                ? residentName
                  ? `${locale === 'fr' ? 'Humeur de' : 'Mood of'} ${residentName} : ${mood}`
                  : `${locale === 'fr' ? 'Humeur du résident' : 'Resident mood'} : ${mood}`
                : item.body}
            </p>
            {item.kind === 'TASK' && (
              <p className="liaison-note-detail">
                <UserRound aria-hidden="true" />
                {item.assignee?.displayName ?? (locale === 'fr' ? 'À répartir' : 'Unassigned')}
                {item.dueOn && (
                  <>
                    <span aria-hidden="true">·</span>
                    <CalendarDays aria-hidden="true" />
                    {new Date(`${item.dueOn}T12:00:00Z`).toLocaleDateString(locale, {
                      timeZone: 'UTC',
                      dateStyle: 'medium',
                    })}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        {canWrite && (
          <details className="liaison-entry-menu">
            <summary aria-label={locale === 'fr' ? 'Actions du message' : 'Message actions'}>
              <MoreHorizontal aria-hidden="true" />
            </summary>
            <div className="liaison-entry-menu__items">
              <button
                type="button"
                disabled={busy}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  onEdit(item);
                }}
              >
                <PenLine aria-hidden="true" />
                {locale === 'fr' ? 'Modifier' : 'Edit'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  onDelete(item);
                }}
              >
                <Trash2 aria-hidden="true" />
                {locale === 'fr' ? 'Supprimer' : 'Delete'}
              </button>
              {item.kind === 'TASK' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    onComplete(!item.completedAt);
                  }}
                >
                  <Check aria-hidden="true" />
                  {item.completedAt
                    ? locale === 'fr'
                      ? 'Remettre à faire'
                      : 'Reopen'
                    : locale === 'fr'
                      ? 'C’est fait'
                      : 'Mark as done'}
                </button>
              )}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

function HighlightCard({
  tone,
  icon: Icon,
  title,
  primary,
  detail,
  actionLabel,
  onClick,
}: {
  tone: 'blue' | 'green' | 'amber';
  icon: LucideIcon;
  title: string;
  primary: string;
  detail: string;
  actionLabel?: string | undefined;
  onClick?: (() => void) | undefined;
}) {
  const content = (
    <>
      <span className="liaison-highlight-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="liaison-highlight-copy">
        <strong>{title}</strong>
        <span>{primary}</span>
        <small>{detail}</small>
      </span>
      {onClick && (
        <span className="liaison-highlight-action">
          {actionLabel && <small>{actionLabel}</small>}
          <ChevronRight aria-hidden="true" />
        </span>
      )}
    </>
  );
  return onClick ? (
    <button className={`liaison-highlight-card liaison-highlight-card--${tone}`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <article className={`liaison-highlight-card liaison-highlight-card--${tone}`}>
      {content}
    </article>
  );
}
