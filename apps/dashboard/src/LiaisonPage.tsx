import {
  BedDouble,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Lightbulb,
  MoreHorizontal,
  PenLine,
  Pill,
  Send,
  Smile,
  TriangleAlert,
  UserRound,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  liaisonCreateSchema,
  type LiaisonEntry,
  type LiaisonFilter,
  type LiaisonPage as Page,
  type LiaisonTag,
} from '@michel/contracts';
import type { Locale } from './i18n';
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

const TAGS: LiaisonTag[] = ['MEAL', 'TREATMENT', 'MOOD', 'REST'];

function tagMeta(tag: LiaisonTag, locale: Locale): TagMeta {
  const french = locale === 'fr';
  const values: Record<LiaisonTag, TagMeta> = {
    MEAL: { label: french ? 'Repas' : 'Meal', icon: Utensils, tone: 'meal' },
    TREATMENT: { label: french ? 'Traitement' : 'Treatment', icon: Pill, tone: 'treatment' },
    MOOD: { label: french ? 'Humeur' : 'Mood', icon: Smile, tone: 'mood' },
    REST: { label: french ? 'Repos' : 'Rest', icon: BedDouble, tone: 'rest' },
  };
  return values[tag];
}

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

function dateKey(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(value);
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
  const [kind, setKind] = useState<'NOTE' | 'TASK'>('NOTE');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<LiaisonTag[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [now, setNow] = useState(() => new Date());
  const sequence = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
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
    const input = liaisonCreateSchema.safeParse(
      kind === 'NOTE'
        ? { kind, body, tags }
        : { kind, body, tags, assigneeId: assigneeId || null, dueOn: dueOn || null },
    );
    if (!input.success) {
      setError(
        tr(
          'Ajoutez un texte et une date valide si nécessaire.',
          'Add a message and a valid date if needed.',
        ),
      );
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
      setTags([]);
      setDueOn('');
      setAssigneeId('');
      setKind('NOTE');
      composerRef.current?.focus();
    }
  }

  const timeZone = data?.timezone ?? 'Europe/Paris';
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
  const visibleItems =
    filter === 'ALL' && !visits && todayItems?.length ? todayItems : (data?.items ?? []);
  const upcomingVisit = data?.visits.find(
    (visit) => !visit.completedAt && new Date(visit.startsAt) >= now,
  );
  const openTasks =
    data?.openTasks ??
    data?.items.filter((item) => item.kind === 'TASK' && !item.completedAt) ??
    [];
  const highlightCount = Math.min(
    3,
    Number(Boolean(upcomingVisit)) +
      Number(Boolean(pendingMedication)) +
      Number(Boolean(attention)) +
      openTasks.length,
  );
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
      visibleItems.map((item, index) => ({
        item,
        tone: ['blue', 'amber', 'green'][index % 3]!,
      })),
    [visibleItems],
  );

  return (
    <section className="section-view liaison-page">
      <header className="liaison-hero">
        <div className="liaison-hero-copy">
          <h1>{tr('Carnet de liaison', 'Family notebook')}</h1>
        </div>
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

          {loading && !data && (
            <p className="liaison-loading" role="status">
              {tr('Chargement du carnet…', 'Loading notebook…')}
            </p>
          )}

          {data && !visits && (
            <div className="liaison-timeline">
              {timeline.map(({ item, tone }) => (
                <TimelineEntry
                  key={item.id}
                  item={item}
                  tone={tone}
                  locale={locale}
                  timeZone={timeZone}
                  canWrite={data.canWrite}
                  busy={busy}
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
              <span className="liaison-avatar liaison-avatar--you" aria-hidden="true">
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
                  <div className="liaison-tag-picker" aria-label={tr('Catégories', 'Categories')}>
                    {TAGS.map((tag) => {
                      const meta = tagMeta(tag, locale);
                      const Icon = meta.icon;
                      const selected = tags.includes(tag);
                      return (
                        <button
                          type="button"
                          key={tag}
                          aria-pressed={selected}
                          className={`liaison-category liaison-category--${meta.tone}`}
                          onClick={() =>
                            setTags((current) =>
                              current.includes(tag)
                                ? current.filter((value) => value !== tag)
                                : [...current, tag],
                            )
                          }
                        >
                          <Icon aria-hidden="true" />
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="liaison-compose-actions">
                    <button
                      type="button"
                      className="liaison-kind-toggle"
                      aria-pressed={kind === 'TASK'}
                      onClick={() => setKind((current) => (current === 'NOTE' ? 'TASK' : 'NOTE'))}
                    >
                      <ClipboardCheck aria-hidden="true" />
                      {kind === 'TASK' ? tr('Tâche', 'Task') : tr('Note', 'Note')}
                    </button>
                    <button className="liaison-send" type="submit" disabled={busy || !body.trim()}>
                      <Send aria-hidden="true" />
                      {busy ? tr('Envoi…', 'Sending…') : tr('Envoyer', 'Send')}
                    </button>
                  </div>
                </div>
                {kind === 'TASK' && (
                  <div className="liaison-task-fields">
                    <label>
                      <UserRound aria-hidden="true" />
                      <span>{tr('Responsable', 'Assignee')}</span>
                      <select
                        disabled={busy}
                        value={assigneeId}
                        onChange={(event) => setAssigneeId(event.target.value)}
                      >
                        <option value="">{tr('À répartir', 'Unassigned')}</option>
                        {data.members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <CalendarDays aria-hidden="true" />
                      <span>{tr('Échéance', 'Due date')}</span>
                      <input
                        type="date"
                        disabled={busy}
                        value={dueOn}
                        onChange={(event) => setDueOn(event.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>
            </form>
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
            {upcomingVisit && (
              <HighlightCard
                tone="blue"
                icon={CalendarDays}
                title={tr('Prochaine visite', 'Next visit')}
                primary={`${upcomingVisit.visitorName} · ${formatDate(upcomingVisit.startsAt)}`}
                detail={
                  upcomingVisit.notes ?? tr('Visite prévue au domicile', 'Scheduled home visit')
                }
              />
            )}
            {pendingMedication && (
              <HighlightCard
                tone="green"
                icon={Pill}
                title={tr('Prochain médicament', 'Next medication')}
                primary={`${pendingMedication.name} · ${formatTime(pendingMedication.scheduledFor)}`}
                detail={pendingMedication.dosage}
                onClick={onMedication}
              />
            )}
            {attention && (
              <HighlightCard
                tone="amber"
                icon={TriangleAlert}
                title={tr('Point d’attention', 'Needs attention')}
                primary={attention.title}
                detail={attention.explanation}
                onClick={onAttention}
              />
            )}
            {openTasks
              .slice(
                0,
                Math.max(
                  0,
                  3 -
                    Number(Boolean(upcomingVisit)) -
                    Number(Boolean(pendingMedication)) -
                    Number(Boolean(attention)),
                ),
              )
              .map((task) => (
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
  canWrite,
  busy,
  onComplete,
}: {
  item: LiaisonEntry;
  tone: string;
  locale: Locale;
  timeZone: string;
  canWrite: boolean;
  busy: boolean;
  onComplete: (completed: boolean) => void;
}) {
  const author = item.author?.displayName ?? (locale === 'fr' ? 'Ancien proche' : 'Former member');
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
            <p className="liaison-note-body">{item.body}</p>
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
        {item.kind === 'TASK' && canWrite && (
          <details className="liaison-entry-menu">
            <summary aria-label={locale === 'fr' ? 'Actions de la tâche' : 'Task actions'}>
              <MoreHorizontal aria-hidden="true" />
            </summary>
            <button type="button" disabled={busy} onClick={() => onComplete(!item.completedAt)}>
              {item.completedAt
                ? locale === 'fr'
                  ? 'Remettre à faire'
                  : 'Reopen'
                : locale === 'fr'
                  ? 'C’est fait'
                  : 'Mark as done'}
            </button>
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
