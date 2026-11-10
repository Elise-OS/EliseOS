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
  liaisonMoodId,
  liaisonUpdateSchema,
  type LiaisonEntry,
  type LiaisonFilter,
  type LiaisonPage as Page,
} from '@elise/contracts';
import { type Locale, t } from './i18n';
import { DataLoadingScreen } from './DataLoadingScreen';
import './liaison.css';
import { moodLabel } from './i18n/data';

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

function tagMeta(tag: LiaisonEntry['tags'][number]): TagMeta {
  const values = {
    MEAL: { label: t('liaisonPage.meal'), icon: Utensils, tone: 'meal' },
    TREATMENT: { label: t('liaisonPage.treatment'), icon: Pill, tone: 'treatment' },
    MOOD: { label: t('liaisonPage.mood'), icon: Smile, tone: 'mood' },
    REST: { label: t('liaisonPage.rest'), icon: BedDouble, tone: 'rest' },
  };
  return values[tag];
}

const MOODS = [
  { id: 'HAPPY', icon: Laugh },
  { id: 'GOOD', icon: Smile },
  { id: 'NEUTRAL', icon: Meh },
  { id: 'LOW', icon: Annoyed },
  { id: 'SAD', icon: Frown },
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
        if (request === sequence.current) setError(t('liaisonPage.theNotebookIsUnavailableCheck'));
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
      setError(t('liaisonPage.changeNotSavedCheckYour'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = liaisonCreateSchema.safeParse({ kind: 'NOTE', body });
    if (!input.success) {
      setError(t('liaisonPage.addAMessage'));
      return;
    }
    if (await mutate('', 'POST', input.data, t('liaisonPage.yourNoteHasBeenShared'))) {
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
    const saved = await mutate('', 'POST', input.data, t('liaisonPage.moodAddedToTheNotebook'));
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
      t('liaisonPage.moodUpdated'),
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
      editingEntry.tags.includes('MOOD') && !liaisonMoodId(entryDraft)
        ? editingEntry.tags.filter((tag) => tag !== 'MOOD')
        : undefined;
    const input = liaisonUpdateSchema.safeParse({
      body: entryDraft,
      ...(moodTags ? { tags: moodTags } : {}),
    });
    if (!input.success) {
      setError(t('liaisonPage.theMessageCannotBeEmpty'));
      return;
    }
    const saved = await mutate(
      `/${encodeURIComponent(editingEntry.id)}`,
      'PATCH',
      input.data,
      t('liaisonPage.messageUpdated'),
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
      t('liaisonPage.messageDeleted'),
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
    ? t('liaisonPage.visits')
    : filter === 'OPEN'
      ? t('liaisonPage.toDo')
      : filter === 'DONE'
        ? t('liaisonPage.completed')
        : t('liaisonPage.today');
  const countLabel = visits
    ? t('liaisonPage.visits2', { value: data?.visits.length ?? 0 })
    : t('liaisonPage.noteCount', { count: visibleItems.length });
  const currentInitials = initials(data?.currentUser?.displayName ?? t('liaisonPage.you'));

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
    return <DataLoadingScreen locale={locale} message={t('liaisonPage.loadingTheNotebook')} />;

  return (
    <section className="section-view liaison-page">
      <header className="page-hero liaison-hero">
        <div className="page-hero__copy liaison-hero-copy">
          <h1 className="page-hero__title">{t('liaisonPage.familyNotebook')}</h1>
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
        <div className="page-hero__actions liaison-hero-actions">
          {onCalendar && (
            <button className="liaison-calendar-button" type="button" onClick={onCalendar}>
              <CalendarDays aria-hidden="true" />
              {t('liaisonPage.calendar')}
            </button>
          )}
          {data?.canWrite && (
            <button
              className="liaison-add-note"
              type="button"
              onClick={() => composerRef.current?.focus()}
            >
              <PenLine aria-hidden="true" />
              {t('liaisonPage.addANote')}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="liaison-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            {t('liaisonPage.retry')}
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
                      [t('liaisonPage.updates'), t('liaisonPage.toDo'), t('liaisonPage.done')][
                        index
                      ]
                    }
                  </button>
                ))}
                <button type="button" aria-pressed={visits} onClick={() => setVisits(true)}>
                  {t('liaisonPage.visits')}
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
                        ? t('liaisonPage.thankYouTaskCompleted')
                        : t('liaisonPage.taskReopened'),
                    )
                  }
                />
              ))}
              {!visibleItems.length && (
                <div className="liaison-empty">
                  <PenLine aria-hidden="true" />
                  <h3>{t('liaisonPage.nothingInThisViewYet')}</h3>
                  <p>{t('liaisonPage.shareAVisitSomethingNoticed')}</p>
                </div>
              )}
              {data.nextCursor && (
                <button
                  className="liaison-load-more"
                  disabled={loading}
                  onClick={() => void load(data.nextCursor!)}
                >
                  {t('liaisonPage.loadEarlierEntries')}
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
                              ? t('liaisonPage.completed2')
                              : t('liaisonPage.planned')}
                          </span>
                        </div>
                        {visit.notes && <p className="liaison-note-body">{visit.notes}</p>}
                        {visit.completedAt && (
                          <p className="liaison-note-detail">
                            {t('liaisonPage.confirmedBy')} {visit.completedBy?.displayName ?? '—'}
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
                            t('liaisonPage.visitUpdated'),
                          )
                        }
                      >
                        {visit.completedAt ? t('liaisonPage.undo') : t('liaisonPage.confirmVisit')}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!data.visits.length && (
                <div className="liaison-empty">
                  <CalendarDays aria-hidden="true" />
                  <h3>{t('liaisonPage.noVisitsInThisPeriod')}</h3>
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
                  {t('liaisonPage.writeANote')}
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
                  placeholder={t('liaisonPage.writeANote2')}
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
                    {t('liaisonPage.addAMood')}
                  </button>
                  <div className="liaison-compose-actions">
                    <button className="liaison-send" type="submit" disabled={busy || !body.trim()}>
                      <Send aria-hidden="true" />
                      {busy ? t('liaisonPage.sending') : t('liaisonPage.send')}
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
                    <span>{t('liaisonPage.familyNotebook')}</span>
                    <h2 id="liaison-mood-title">{t('liaisonPage.addAMood')}</h2>
                  </div>
                  <button
                    type="button"
                    className="liaison-mood-close"
                    aria-label={t('liaisonPage.close')}
                    onClick={() => {
                      setMoodOpen(false);
                      moodTriggerRef.current?.focus();
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </header>
                <p>
                  {data?.residentName
                    ? t('liaisonPage.howIsResidentFeeling', { name: data.residentName })
                    : t('liaisonPage.howIsTheResidentFeeling')}
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
                        onClick={() => void addMood(mood)}
                      >
                        <span
                          className={`liaison-mood-picto liaison-mood-picto--${mood.id.toLowerCase()}`}
                        >
                          <Icon aria-hidden="true" />
                        </span>
                        {moodLabel(mood.id)}
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
                    <span>{t('liaisonPage.familyNotebook')}</span>
                    <h2 id="liaison-edit-title">
                      {editingEntry.tags.includes('MOOD')
                        ? t('liaisonPage.changeTheMood')
                        : t('liaisonPage.editMessage')}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="liaison-mood-close"
                    aria-label={t('liaisonPage.close')}
                    disabled={busy}
                    onClick={() => setEditingEntry(null)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </header>
                {editingEntry.tags.includes('MOOD') ? (
                  <>
                    <p>
                      {data?.residentName
                        ? t('liaisonPage.chooseMoodFor', { name: data.residentName })
                        : t('liaisonPage.chooseMoodForTheResident')}
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
                            {moodLabel(mood.id)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <form onSubmit={(event) => void saveEntry(event)}>
                    <label htmlFor="liaison-edit-body">{t('liaisonPage.message')}</label>
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
                        {t('liaisonPage.cancel')}
                      </button>
                      <button
                        className="liaison-send"
                        type="submit"
                        disabled={busy || !entryDraft.trim()}
                      >
                        <Check aria-hidden="true" />
                        {busy ? t('liaisonPage.saving') : t('liaisonPage.save')}
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
                    <span>{t('liaisonPage.familyNotebook')}</span>
                    <h2 id="liaison-delete-title">{t('liaisonPage.deleteThisMessage')}</h2>
                  </div>
                  <button
                    type="button"
                    className="liaison-mood-close"
                    aria-label={t('liaisonPage.close')}
                    disabled={busy}
                    onClick={() => setDeletingEntry(null)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </header>
                <p>{t('liaisonPage.thisActionCannotBeUndone')}</p>
                <div className="liaison-entry-dialog__actions">
                  <button
                    type="button"
                    className="liaison-entry-dialog__cancel"
                    disabled={busy}
                    onClick={() => setDeletingEntry(null)}
                  >
                    {t('liaisonPage.cancel')}
                  </button>
                  <button
                    type="button"
                    className="liaison-entry-dialog__delete"
                    disabled={busy}
                    onClick={() => void confirmDelete()}
                  >
                    <Trash2 aria-hidden="true" />
                    {busy ? t('liaisonPage.deleting') : t('liaisonPage.delete')}
                  </button>
                </div>
              </section>
            </div>
          )}
          {data && !data.canWrite && (
            <p className="liaison-readonly">{t('liaisonPage.youCanReadThisNotebook')}</p>
          )}
        </section>

        <aside className="liaison-highlights" aria-labelledby="liaison-highlights-title">
          <div className="liaison-panel-heading">
            <div>
              <span className="liaison-heading-dot liaison-heading-dot--amber" aria-hidden="true" />
              <h2 id="liaison-highlights-title">{t('liaisonPage.keepInMind')}</h2>
            </div>
            <span>{t('liaisonPage.itemCount', { count: highlightCount })}</span>
          </div>
          <div className="liaison-highlight-list">
            {highlightedAppointments.map((appointment) => (
              <HighlightCard
                key={appointment.id}
                tone="blue"
                icon={CalendarDays}
                title={t('liaisonPage.appointment')}
                primary={`${appointment.title} · ${formatDate(appointment.startsAt)}`}
                detail={
                  [appointment.location, appointment.notes].filter(Boolean).join(' · ') ||
                  t('liaisonPage.appointmentScheduledAtHome')
                }
                onClick={onCalendar}
              />
            ))}
            {highlightedVisit && (
              <HighlightCard
                tone="blue"
                icon={CalendarDays}
                title={t('liaisonPage.nextVisit')}
                primary={`${highlightedVisit.visitorName} · ${formatDate(highlightedVisit.startsAt)}`}
                detail={highlightedVisit.notes ?? t('liaisonPage.scheduledHomeVisit')}
              />
            )}
            {highlightedMedication && (
              <HighlightCard
                tone="green"
                icon={Pill}
                title={t('liaisonPage.nextMedication')}
                primary={`${highlightedMedication.name} · ${formatTime(highlightedMedication.scheduledFor)}`}
                detail={highlightedMedication.dosage}
                onClick={onMedication}
              />
            )}
            {highlightedAttention && (
              <HighlightCard
                tone="amber"
                icon={TriangleAlert}
                title={t('liaisonPage.needsAttention')}
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
                title={task.assignee?.displayName ?? t('liaisonPage.unassigned')}
                primary={task.body}
                detail={
                  task.dueOn
                    ? `${t('liaisonPage.due')} ${new Date(`${task.dueOn}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', dateStyle: 'medium' })}`
                    : t('liaisonPage.noDueDate')
                }
                actionLabel={data?.canWrite ? t('liaisonPage.done2') : undefined}
                onClick={
                  data?.canWrite
                    ? () =>
                        void mutate(
                          `/${encodeURIComponent(task.id)}/completion`,
                          'PATCH',
                          { completed: true },
                          t('liaisonPage.thankYouTaskCompleted'),
                        )
                    : undefined
                }
              />
            ))}
            {!highlightCount && (
              <div className="liaison-highlight-empty">
                <Check aria-hidden="true" />
                <strong>{t('liaisonPage.nothingToFlag')}</strong>
                <span>{t('liaisonPage.noUpcomingTasksOrVisits')}</span>
              </div>
            )}
          </div>
          <div className="liaison-help-card">
            <Lightbulb aria-hidden="true" />
            <div>
              <strong>{t('liaisonPage.notSure')}</strong>
              <span>{t('liaisonPage.leaveANoteToKeep')}</span>
            </div>
          </div>
          {onJournal && (
            <button className="liaison-journal-link" type="button" onClick={onJournal}>
              {t('liaisonPage.openHouseholdJournal')}
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
  const author = item.author?.displayName ?? t('liaisonPage.formerMember');
  const moodId = item.tags.includes('MOOD') ? liaisonMoodId(item.body) : null;
  const mood = moodId ? moodLabel(moodId) : null;
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
                const meta = tagMeta(tag);
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
                  {item.completedAt ? t('liaisonPage.completed3') : t('liaisonPage.toDo')}
                </span>
              )}
            </div>
            <p className="liaison-note-body">
              {mood
                ? residentName
                  ? `${t('liaisonPage.moodOf')} ${residentName} : ${mood}`
                  : `${t('liaisonPage.residentMood')} : ${mood}`
                : item.body}
            </p>
            {item.kind === 'TASK' && (
              <p className="liaison-note-detail">
                <UserRound aria-hidden="true" />
                {item.assignee?.displayName ?? t('liaisonPage.unassigned')}
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
            <summary aria-label={t('liaisonPage.messageActions')}>
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
                {t('liaisonPage.edit')}
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
                {t('liaisonPage.delete')}
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
                  {item.completedAt ? t('liaisonPage.reopen') : t('liaisonPage.markAsDone')}
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
