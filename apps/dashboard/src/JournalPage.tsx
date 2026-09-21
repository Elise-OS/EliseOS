import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PenLine,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Locale } from './i18n';
import './journal-page.css';

export interface JournalPageItem {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  occurredAt: string;
}

type JournalFilter = 'ALL' | 'DAILY_SUMMARY' | 'NOTE';

interface JournalKindMeta {
  label: string;
  icon: LucideIcon;
  tone: 'blue' | 'green' | 'amber';
}

function kindMeta(kind: string, locale: Locale): JournalKindMeta {
  const french = locale === 'fr';
  if (kind === 'DAILY_SUMMARY') {
    return {
      label: french ? 'Bilan du jour' : 'Daily summary',
      icon: Sparkles,
      tone: 'blue',
    };
  }
  if (kind === 'NOTE') {
    return { label: french ? 'Note familiale' : 'Family note', icon: PenLine, tone: 'green' };
  }
  return { label: french ? 'Événement' : 'Event', icon: Clock3, tone: 'amber' };
}

function dayKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(value);
}

function sameDay(left: Date, right: Date): boolean {
  return dayKey(left) === dayKey(right);
}

function dateHeading(value: Date, locale: Locale): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(value, today)) return locale === 'fr' ? 'Aujourd’hui' : 'Today';
  if (sameDay(value, yesterday)) return locale === 'fr' ? 'Hier' : 'Yesterday';
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(value);
}

function eventCount(count: number, locale: Locale): string {
  if (locale === 'fr') return `${count} ${count === 1 ? 'événement' : 'événements'}`;
  return `${count} ${count === 1 ? 'event' : 'events'}`;
}

function formatTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatLongDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(value);
}

export function JournalPage({
  locale = 'fr',
  items,
  onBack,
}: {
  locale?: Locale;
  items: JournalPageItem[];
  onBack?: () => void;
}) {
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);
  const [filter, setFilter] = useState<JournalFilter>('ALL');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredItems = useMemo(
    () =>
      items
        .filter((item) => filter === 'ALL' || item.kind === filter)
        .sort(
          (left, right) =>
            new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
        ),
    [filter, items],
  );

  const groups = useMemo(() => {
    const result: Array<{ key: string; date: Date; items: JournalPageItem[] }> = [];
    for (const item of filteredItems) {
      const date = new Date(item.occurredAt);
      const key = dayKey(date);
      const existing = result.find((group) => group.key === key);
      if (existing) existing.items.push(item);
      else result.push({ key, date, items: [item] });
    }
    return result;
  }, [filteredItems]);

  const monthCount = items.filter((item) => {
    const date = new Date(item.occurredAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }).length;
  const latest = filteredItems[0] ? new Date(filteredItems[0].occurredAt) : null;

  return (
    <section className="house-journal-page">
      <header className="house-journal-hero">
        <div className="house-journal-hero-copy">
          <h1>{tr('Journal du foyer', 'Household journal')}</h1>
        </div>
        <div className="house-journal-hero-actions">
          {onBack ? (
            <button className="house-journal-back" type="button" onClick={onBack}>
              <ChevronLeft size={20} aria-hidden="true" />
              {tr('Retour au carnet', 'Back to notebook')}
            </button>
          ) : null}
        </div>
      </header>

      <div className="house-journal-layout">
        <section className="house-journal-feed" aria-labelledby="house-journal-feed-title">
          <div className="house-journal-section-heading">
            <div>
              <span className="house-journal-dot house-journal-dot--blue" aria-hidden="true" />
              <div>
                <h2 id="house-journal-feed-title">{tr('Mémoire du foyer', 'Household memory')}</h2>
                <p>
                  {tr(
                    'Les événements et notes qui méritent d’être retrouvés.',
                    'Events and notes worth finding again.',
                  )}
                </p>
              </div>
            </div>
            <span className="house-journal-count">{eventCount(filteredItems.length, locale)}</span>
          </div>

          <div
            className="house-journal-filters"
            aria-label={tr('Filtrer le journal', 'Filter the journal')}
          >
            {(
              [
                ['ALL', tr('Tout', 'All')],
                ['DAILY_SUMMARY', tr('Bilans', 'Summaries')],
                ['NOTE', tr('Notes familiales', 'Family notes')],
              ] as const
            ).map(([value, label]) => (
              <button
                className={filter === value ? 'is-active' : ''}
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {groups.length ? (
            <div className="house-journal-timeline">
              {groups.map((group) => (
                <section className="house-journal-day" key={group.key}>
                  <div className="house-journal-day-heading">
                    <span>{dateHeading(group.date, locale)}</span>
                    <small>{eventCount(group.items.length, locale)}</small>
                  </div>
                  <div className="house-journal-day-items">
                    {group.items.map((item) => {
                      const meta = kindMeta(item.kind, locale);
                      const Icon = meta.icon;
                      return (
                        <article className="house-journal-entry" key={item.id}>
                          <div
                            className={`house-journal-entry-icon house-journal-entry-icon--${meta.tone}`}
                          >
                            <Icon size={20} aria-hidden="true" />
                          </div>
                          <div className="house-journal-entry-copy">
                            <div className="house-journal-entry-meta">
                              <time dateTime={item.occurredAt}>
                                {formatTime(item.occurredAt, locale)}
                              </time>
                              <span>{meta.label}</span>
                            </div>
                            <h3>{item.title}</h3>
                            {item.body ? <p>{item.body}</p> : null}
                          </div>
                          <ChevronRight
                            className="house-journal-entry-chevron"
                            size={18}
                            aria-hidden="true"
                          />
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="house-journal-empty">
              <div className="house-journal-empty-icon">
                <BookOpen size={34} aria-hidden="true" />
              </div>
              <h3>{tr('Le journal commence ici', 'The journal starts here')}</h3>
              <p>
                {filter === 'ALL'
                  ? tr(
                      'Les bilans du quotidien et les notes partagées par les aidants apparaîtront ici.',
                      'Daily summaries and notes shared by caregivers will appear here.',
                    )
                  : tr(
                      'Aucun élément ne correspond à ce filtre pour le moment.',
                      'Nothing matches this filter yet.',
                    )}
              </p>
              {onBack ? (
                <button className="house-journal-empty-action" type="button" onClick={onBack}>
                  <PenLine size={18} aria-hidden="true" />
                  {tr('Écrire une première note', 'Write the first note')}
                </button>
              ) : null}
            </div>
          )}
        </section>

        <aside
          className="house-journal-aside"
          aria-label={tr('Résumé du journal', 'Journal summary')}
        >
          <div className="house-journal-aside-heading">
            <span className="house-journal-dot house-journal-dot--amber" aria-hidden="true" />
            <h2>{tr('À retenir', 'At a glance')}</h2>
          </div>

          <div className="house-journal-stat-grid">
            <div className="house-journal-stat house-journal-stat--blue">
              <BookOpen size={22} aria-hidden="true" />
              <strong>{items.length}</strong>
              <span>{tr('éléments au total', 'total entries')}</span>
            </div>
            <div className="house-journal-stat house-journal-stat--green">
              <CalendarDays size={22} aria-hidden="true" />
              <strong>{monthCount}</strong>
              <span>{tr('ce mois-ci', 'this month')}</span>
            </div>
          </div>

          <div className="house-journal-info-card">
            <Clock3 size={22} aria-hidden="true" />
            <div>
              <strong>{tr('Dernière mise à jour', 'Last update')}</strong>
              <p>
                {latest
                  ? formatLongDate(latest, locale)
                  : tr('Aucune entrée pour le moment', 'No entry yet')}
              </p>
            </div>
          </div>

          <div className="house-journal-info-card house-journal-info-card--soft">
            <UserRound size={22} aria-hidden="true" />
            <div>
              <strong>{tr('Un espace partagé', 'A shared space')}</strong>
              <p>
                {tr(
                  'Les proches peuvent transmettre ici les informations utiles au quotidien de Michel.',
                  'Loved ones can share useful information about Michel’s daily life here.',
                )}
              </p>
            </div>
          </div>

          <div className="house-journal-tip">
            <Sparkles size={22} aria-hidden="true" />
            <p>
              {tr(
                'Le carnet de liaison sert aux notes et aux tâches à faire. Le journal garde la mémoire des événements.',
                'The notebook is for notes and tasks. The journal keeps the memory of events.',
              )}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
