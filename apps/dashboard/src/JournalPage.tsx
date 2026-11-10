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
import { dateLocale, type Locale, t } from './i18n';
import './journal-page.css';

export interface JournalPageItem {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  occurredAt: string;
}

const isLiaisonSummary = (id: string) => id.startsWith('liaison-summary:');

interface JournalKindMeta {
  label: string;
  icon: LucideIcon;
  tone: 'blue' | 'green' | 'amber';
}

function kindMeta(kind: string): JournalKindMeta {
  if (kind === 'DAILY_SUMMARY') {
    return {
      label: t('journalPage.dailySummary'),
      icon: Sparkles,
      tone: 'blue',
    };
  }
  if (kind === 'NOTE') {
    return { label: t('journalPage.familyNote'), icon: PenLine, tone: 'green' };
  }
  return { label: t('journalPage.event'), icon: Clock3, tone: 'amber' };
}

function dayKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDayKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function dateHeading(value: Date, locale: Locale, now: Date, timezone: string): string {
  const key = dayKey(value, timezone);
  const today = dayKey(now, timezone);
  if (key === today) return t('journalPage.today');
  if (key === shiftDayKey(today, -1)) return t('journalPage.yesterday');
  return new Intl.DateTimeFormat(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  }).format(value);
}

function eventCount(count: number): string {
  return t('journalPage.eventCount', { count });
}

function formatTime(value: string, locale: Locale, timezone: string): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value));
}

function formatLongDate(value: Date, locale: Locale, timezone: string): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(value);
}

export function JournalPage({
  locale = 'fr',
  items,
  timezone = 'Europe/Paris',
  residentName,
  onBack,
}: {
  locale?: Locale;
  items: JournalPageItem[];
  timezone?: string;
  residentName?: string | null;
  onBack?: () => void;
}) {
  const resident = residentName?.trim() || null;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const recentItems = useMemo(() => {
    const today = dayKey(now, timezone);
    const firstDay = shiftDayKey(today, -6);
    return items.filter((item) => {
      if (item.kind !== 'DAILY_SUMMARY') return true;
      const summaryDay = isLiaisonSummary(item.id)
        ? item.id.slice(-10)
        : dayKey(new Date(item.occurredAt), timezone);
      return summaryDay >= firstDay && summaryDay <= today;
    });
  }, [items, now, timezone]);

  const sortedItems = useMemo(
    () =>
      [...recentItems].sort(
        (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
      ),
    [recentItems],
  );

  const groups = useMemo(() => {
    const result: Array<{ key: string; date: Date; items: JournalPageItem[] }> = [];
    for (const item of sortedItems) {
      const date = new Date(item.occurredAt);
      const key = dayKey(date, timezone);
      const existing = result.find((group) => group.key === key);
      if (existing) existing.items.push(item);
      else result.push({ key, date, items: [item] });
    }
    return result;
  }, [sortedItems, timezone]);

  const monthCount = recentItems.filter((item) => {
    return (
      dayKey(new Date(item.occurredAt), timezone).slice(0, 7) === dayKey(now, timezone).slice(0, 7)
    );
  }).length;
  const latest = sortedItems[0] ? new Date(sortedItems[0].occurredAt) : null;

  return (
    <section className="house-journal-page">
      <header className="page-hero house-journal-hero">
        <div className="page-hero__copy house-journal-hero-copy">
          <h1 className="page-hero__title">{t('journalPage.householdJournal')}</h1>
        </div>
        <div className="page-hero__actions house-journal-hero-actions">
          {onBack ? (
            <button className="house-journal-back" type="button" onClick={onBack}>
              <ChevronLeft size={20} aria-hidden="true" />
              {t('journalPage.backToNotebook')}
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
                <h2 id="house-journal-feed-title">{t('journalPage.householdMemory')}</h2>
                <p>{t('journalPage.eventsAndNotesWorthFinding')}</p>
              </div>
            </div>
            <span className="house-journal-count">{eventCount(sortedItems.length)}</span>
          </div>

          {groups.length ? (
            <div className="house-journal-timeline">
              {groups.map((group) => (
                <section className="house-journal-day" key={group.key}>
                  <div className="house-journal-day-heading">
                    <span>{dateHeading(group.date, locale, now, timezone)}</span>
                    <small>{eventCount(group.items.length)}</small>
                  </div>
                  <div className="house-journal-day-items">
                    {group.items.map((item) => {
                      const meta = kindMeta(item.kind);
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
                                {formatTime(item.occurredAt, locale, timezone)}
                              </time>
                              <span>{meta.label}</span>
                            </div>
                            <h3>
                              {isLiaisonSummary(item.id)
                                ? t('journalPage.familyNotebookSummary')
                                : item.title}
                            </h3>
                            {item.body ? (
                              <p
                                className={
                                  isLiaisonSummary(item.id)
                                    ? 'house-journal-summary-body'
                                    : undefined
                                }
                              >
                                {item.body}
                              </p>
                            ) : null}
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
              <h3>{t('journalPage.theJournalStartsHere')}</h3>
              <p>{t('journalPage.dailySummariesAndNotesShared')}</p>
              {onBack ? (
                <button className="house-journal-empty-action" type="button" onClick={onBack}>
                  <PenLine size={18} aria-hidden="true" />
                  {t('journalPage.writeTheFirstNote')}
                </button>
              ) : null}
            </div>
          )}
        </section>

        <aside className="house-journal-aside" aria-label={t('journalPage.journalSummary')}>
          <div className="house-journal-aside-heading">
            <span className="house-journal-dot house-journal-dot--amber" aria-hidden="true" />
            <h2>{t('journalPage.atAGlance')}</h2>
          </div>

          <div className="house-journal-stat-grid">
            <div className="house-journal-stat house-journal-stat--blue">
              <BookOpen size={22} aria-hidden="true" />
              <strong>{recentItems.length}</strong>
              <span>{t('journalPage.totalEntries')}</span>
            </div>
            <div className="house-journal-stat house-journal-stat--green">
              <CalendarDays size={22} aria-hidden="true" />
              <strong>{monthCount}</strong>
              <span>{t('journalPage.thisMonth')}</span>
            </div>
          </div>

          <div className="house-journal-info-card">
            <Clock3 size={22} aria-hidden="true" />
            <div>
              <strong>{t('journalPage.lastUpdate')}</strong>
              <p>
                {latest ? formatLongDate(latest, locale, timezone) : t('journalPage.noEntryYet')}
              </p>
            </div>
          </div>

          <div className="house-journal-info-card house-journal-info-card--soft">
            <UserRound size={22} aria-hidden="true" />
            <div>
              <strong>{t('journalPage.aSharedSpace')}</strong>
              <p>
                {resident
                  ? t('journalPage.lovedOnesCanShareUseful', { resident })
                  : t('journalPage.lovedOnesCanShareUseful2')}
              </p>
            </div>
          </div>

          <div className="house-journal-tip">
            <Sparkles size={22} aria-hidden="true" />
            <p>{t('journalPage.theNotebookIsForNotes')}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
