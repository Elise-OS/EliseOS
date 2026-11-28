import {
  ArrowRight,
  BellRing,
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Footprints,
  Info,
  Moon,
  RadioTower,
  ShieldCheck,
  TriangleAlert,
  Users,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  digestClock,
  digestDate,
  digestDuration,
  digestLocalDay,
  digestLocalMinute,
  digestNumber,
  digestPeriod,
  digestPlural,
  digestStatementText,
  digestThemeTrend,
  digestWeekdayLabel,
  fillDigestText,
  weeklyDigestLanguage,
  weeklyDigestPdfName,
  weeklyDigestTexts,
  type WeeklyDigest,
  type WeeklyDigestLanguage,
  type WeeklyDigestStatement,
  type WeeklyDigestTheme,
} from '@elise/contracts';
import { currentLanguage, t } from '../i18n';
import {
  MealChart,
  NightChart,
  OutingChart,
  Sparkline,
  VisitChart,
  digestSparks,
} from './DigestCharts';
import './weekly-digest.css';

/**
 * "Bilan de la semaine" of the family notebook: a card with the week and one plain sentence,
 * opening a detailed view (what changed first, one tile per theme with its 7-day chart,
 * alerts and sensors) and the PDF made on the box for the doctor or the nurse.
 * For the family only: nothing of it is shown on the resident's TV.
 */

export type DigestAnswer = { digest: WeeklyDigest } | { missing: true } | { failed: true };

export async function fetchWeeklyDigest(week?: string): Promise<DigestAnswer> {
  try {
    const response = await fetch(
      `/api/v1/weekly-digest${week ? `?week=${encodeURIComponent(week)}` : ''}`,
    );
    if (response.status === 404) return { missing: true };
    if (!response.ok) return { failed: true };
    const body = (await response.json()) as Partial<WeeklyDigest> | null;
    // An answer without the measures of a week is not a digest (older box, proxy page).
    if (!body || typeof body.weekStart !== 'string' || !body.metrics || !body.summary)
      return { failed: true };
    return { digest: body as WeeklyDigest };
  } catch {
    return { failed: true };
  }
}

const THEME_ICON: Record<WeeklyDigestTheme, LucideIcon> = {
  nights: Moon,
  meals: Utensils,
  outings: Footprints,
  visits: Users,
  alerts: BellRing,
  sensors: RadioTower,
  general: Info,
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const language = (): WeeklyDigestLanguage => weeklyDigestLanguage(currentLanguage());

/** The card of the notebook: the week, its sentence, what changed first, four small charts. */
export function WeeklyDigestCard({
  answer,
  onOpen,
}: {
  answer: DigestAnswer | null;
  onOpen: () => void;
}) {
  const lang = language();
  const text = weeklyDigestTexts(lang);
  if (!answer)
    return (
      <section className="wd-card wd-card--loading" aria-busy="true" aria-label={text.title}>
        <span className="wd-card__icon">
          <ChartNoAxesColumn aria-hidden="true" />
        </span>
        <div className="wd-card__copy">
          <span className="wd-eyebrow">{text.title}</span>
          <p className="wd-card__muted">{t('weeklyDigest.loading')}</p>
        </div>
      </section>
    );
  if (!('digest' in answer))
    return (
      <section className="wd-card wd-card--empty" aria-label={text.title}>
        <span className="wd-card__icon">
          <ChartNoAxesColumn aria-hidden="true" />
        </span>
        <div className="wd-card__copy">
          <span className="wd-eyebrow">{text.title}</span>
          <p className="wd-card__muted">
            {'missing' in answer ? text.readySoon : t('weeklyDigest.unavailable')}
          </p>
        </div>
      </section>
    );
  const digest = answer.digest;
  const sparks = digestSparks(digest);
  const highlights = digest.changes.filter((item) => item.tone === 'change').slice(0, 2);
  const tiles: Array<{ theme: 'nights' | 'meals' | 'outings' | 'visits'; value: string }> = [
    {
      theme: 'nights',
      value:
        digest.nights.wake === null
          ? text.noData
          : `${text.nights.wake} ${digestClock(digest.nights.wake)}`,
    },
    {
      theme: 'meals',
      value:
        digest.meals.state === 'NOT_EQUIPPED' || digest.meals.state === 'NO_DATA'
          ? text.noData
          : digest.meals.notSeen
            ? digestPlural(text.meals.missed, digest.meals.notSeen, lang)
            : text.meals.noneMissed,
    },
    {
      theme: 'outings',
      value:
        digest.outings.state === 'NOT_EQUIPPED' || digest.outings.state === 'NO_DATA'
          ? text.noData
          : digestPlural(text.outings.count, digest.outings.total, lang),
    },
    {
      theme: 'visits',
      value: digest.visitSummary.planned
        ? digestPlural(text.visits.planned, digest.visitSummary.planned, lang)
        : text.visits.nonePlanned,
    },
  ];
  return (
    <section className="wd-card" aria-labelledby="wd-card-title">
      <button type="button" className="wd-card__open" onClick={onOpen}>
        <span className="wd-card__icon">
          <ChartNoAxesColumn aria-hidden="true" />
        </span>
        <span className="wd-card__copy">
          <span className="wd-eyebrow" id="wd-card-title">
            {text.title} · {digestPeriod(digest.weekStart, digest.weekEnd, lang)}
          </span>
          <strong className="wd-card__summary">{digestStatementText(digest.summary, lang)}</strong>
          {highlights.length > 0 && (
            <span className="wd-card__highlights">
              {highlights.map((item) => {
                const Icon = THEME_ICON[item.theme];
                return (
                  <span key={item.key} className="wd-chip wd-chip--change">
                    <Icon aria-hidden="true" />
                    {digestStatementText(item, lang)}
                  </span>
                );
              })}
            </span>
          )}
        </span>
        <span className="wd-card__cta">
          {t('weeklyDigest.open')}
          <ArrowRight aria-hidden="true" />
        </span>
      </button>
      <ul className="wd-card__themes">
        {tiles.map(({ theme, value }) => {
          const Icon = THEME_ICON[theme];
          const trend = digestThemeTrend(digest, theme, lang);
          return (
            <li key={theme} className={`wd-mini wd-mini--${theme}`}>
              <span className="wd-mini__head">
                <span className="wd-mini__label">
                  <Icon aria-hidden="true" />
                  {text.themes[theme]}
                </span>
                <Sparkline values={sparks[theme]} tone={theme} />
              </span>
              <span className="wd-mini__value">{value}</span>
              <span className={`wd-trend wd-trend--${trend.tone}`}>{trend.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ label, value, usual }: { label: string; value: string; usual?: string | null }) {
  return (
    <div className="wd-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {usual ? <small>{usual}</small> : null}
    </div>
  );
}

function Tile({
  theme,
  title,
  trend,
  children,
  method,
}: {
  theme: WeeklyDigestTheme;
  title: string;
  trend?: { tone: string; label: string } | null;
  children: ReactNode;
  method?: string | null;
}) {
  const Icon = THEME_ICON[theme];
  return (
    <article className={`wd-tile wd-tile--${theme}`}>
      <header className="wd-tile__head">
        <span className="wd-tile__icon">
          <Icon aria-hidden="true" />
        </span>
        <h3>{title}</h3>
        {trend && <span className={`wd-trend wd-trend--${trend.tone}`}>{trend.label}</span>}
      </header>
      {children}
      {method && <p className="wd-tile__method">{method}</p>}
    </article>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <p className="wd-unavailable">
      <Info aria-hidden="true" />
      {message}
    </p>
  );
}

function statementTone(item: WeeklyDigestStatement) {
  return item.tone;
}

/** The detailed view of a week, with the weeks before and after. */
export function WeeklyDigestDialog({
  initial,
  onClose,
}: {
  initial: WeeklyDigest;
  onClose: () => void;
}) {
  const lang = language();
  const text = weeklyDigestTexts(lang);
  const [digest, setDigest] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const go = useCallback(async (week: string | null) => {
    if (!week) return;
    setLoading(true);
    setNotice('');
    const answer = await fetchWeeklyDigest(week);
    setLoading(false);
    if ('digest' in answer) {
      setDigest(answer.digest);
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    } else setNotice(t('weeklyDigest.unavailable'));
  }, []);

  async function exportPdf() {
    setExporting(true);
    setNotice('');
    try {
      const response = await fetch(
        `/api/v1/weekly-digest/pdf?week=${digest.weekStart}&lang=${lang}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = weeklyDigestPdfName(digest.weekStart, lang);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
      setNotice(t('weeklyDigest.exported'));
    } catch {
      setNotice(t('weeklyDigest.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const { nights, meals, outings, visitSummary } = digest;
  const colon = lang === 'fr' ? '\u00a0: ' : ': ';
  const usual = (value: string | null) =>
    value === null ? null : fillDigestText(text.usual, { value });
  const comparison =
    digest.comparisonWeeks > 0
      ? digestPlural(text.pdf.comparison, digest.comparisonWeeks, lang)
      : text.pdf.noComparison;
  const nightsTrend = digestThemeTrend(digest, 'nights', lang);
  const mealsTrend = digestThemeTrend(digest, 'meals', lang);
  const outingsTrend = digestThemeTrend(digest, 'outings', lang);
  const visitsTrend = digestThemeTrend(digest, 'visits', lang);
  const dayAndTime = (iso: string) =>
    `${digestWeekdayLabel(digestLocalDay(iso, digest.timezone), lang)} ${digestClock(digestLocalMinute(iso, digest.timezone))}`;

  return (
    <div className="wd-backdrop" role="presentation" onClick={onClose}>
      <section
        className="wd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wd-dialog-title"
        aria-busy={loading}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="wd-dialog__head">
          <div className="wd-dialog__title">
            <span className="wd-eyebrow">{text.eyebrow}</span>
            <h2 id="wd-dialog-title">{text.title}</h2>
            <p>
              {[digest.residentName, digestPeriod(digest.weekStart, digest.weekEnd, lang, true)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <nav className="wd-weeknav" aria-label={t('weeklyDigest.weeks')}>
            <button
              type="button"
              disabled={!digest.previousWeek || loading}
              onClick={() => void go(digest.previousWeek)}
              aria-label={t('weeklyDigest.previousWeek')}
            >
              <ChevronLeft aria-hidden="true" />
              <span>{t('weeklyDigest.previous')}</span>
            </button>
            <button
              type="button"
              disabled={!digest.nextWeek || loading}
              onClick={() => void go(digest.nextWeek)}
              aria-label={t('weeklyDigest.nextWeek')}
            >
              <span>{t('weeklyDigest.next')}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          </nav>
          <button
            type="button"
            className="wd-export"
            disabled={exporting}
            onClick={() => void exportPdf()}
          >
            <FileDown aria-hidden="true" />
            {exporting ? t('weeklyDigest.exporting') : t('weeklyDigest.exportPdf')}
          </button>
          <button
            ref={closeRef}
            type="button"
            className="wd-close"
            aria-label={t('weeklyDigest.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="wd-dialog__body" ref={bodyRef}>
          {notice && (
            <p className="wd-notice" role="status">
              {notice}
            </p>
          )}
          <div className="wd-summary">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>{digestStatementText(digest.summary, lang)}</strong>
              <span>{comparison}</span>
            </div>
          </div>

          <section className="wd-changes" aria-labelledby="wd-changes-title">
            <h3 id="wd-changes-title">{text.themes.changes}</h3>
            <ol>
              {digest.changes.map((item) => {
                const Icon = item.tone === 'warning' ? TriangleAlert : THEME_ICON[item.theme];
                return (
                  <li key={item.key} className={`wd-change wd-change--${statementTone(item)}`}>
                    <span className="wd-change__icon">
                      <Icon aria-hidden="true" />
                    </span>
                    {digestStatementText(item, lang)}
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="wd-grid">
            <Tile
              theme="nights"
              title={text.themes.nights}
              trend={nights.state === 'OK' || nights.state === 'PARTIAL' ? nightsTrend : null}
              method={
                nights.source === 'BED'
                  ? text.nights.sourceBed
                  : nights.source === 'MOTION'
                    ? text.nights.sourceMotion
                    : null
              }
            >
              {nights.state === 'NOT_EQUIPPED' ? (
                <Unavailable message={text.nights.notEquipped} />
              ) : nights.state === 'NO_DATA' ? (
                <Unavailable message={text.nights.noData} />
              ) : (
                <>
                  <dl className="wd-stats">
                    <Stat
                      label={text.nights.bedtime}
                      value={nights.bedtime === null ? '–' : digestClock(nights.bedtime)}
                      usual={usual(
                        nights.usual?.bedtime == null ? null : digestClock(nights.usual.bedtime),
                      )}
                    />
                    <Stat
                      label={text.nights.wake}
                      value={nights.wake === null ? '–' : digestClock(nights.wake)}
                      usual={usual(
                        nights.usual?.wake == null ? null : digestClock(nights.usual.wake),
                      )}
                    />
                    <Stat
                      label={text.nights.risings}
                      value={
                        nights.risingsPerNight === null
                          ? '–'
                          : fillDigestText(text.nights.perNight, {
                              count: digestNumber(nights.risingsPerNight, lang),
                            })
                      }
                      usual={usual(
                        nights.usual?.risingsPerNight == null
                          ? null
                          : digestNumber(nights.usual.risingsPerNight, lang),
                      )}
                    />
                  </dl>
                  <NightChart digest={digest} language={lang} />
                  <ul className="wd-legend" aria-hidden="true">
                    <li>
                      <i className="wd-dot wd-dot--night" />
                      {text.nights.legendBar}
                    </li>
                    <li>
                      <i className="wd-dot wd-dot--restless" />
                      {capitalize(text.nights.restless.other.replace(/\{\{count\}\}\s*/, ''))}
                    </li>
                    {nights.usual?.wake != null && (
                      <li>
                        <i className="wd-dot wd-dot--usual" />
                        {text.nights.legendUsual}
                      </li>
                    )}
                  </ul>
                  <ul className="wd-facts">
                    <li className={nights.restlessNights.length ? 'is-change' : 'is-stable'}>
                      {nights.restlessNights.length
                        ? digestPlural(text.nights.restless, nights.restlessNights.length, lang)
                        : text.nights.calm}
                    </li>
                    {nights.shortNights.length > 0 && (
                      <li className="is-change">
                        {digestPlural(text.nights.short, nights.shortNights.length, lang)}
                      </li>
                    )}
                    {nights.state === 'PARTIAL' && (
                      <li className="is-muted">
                        {digestPlural(text.nights.partial, 7 - nights.measured, lang)}
                      </li>
                    )}
                  </ul>
                </>
              )}
            </Tile>

            <Tile
              theme="meals"
              title={text.themes.meals}
              trend={meals.state === 'OK' || meals.state === 'PARTIAL' ? mealsTrend : null}
              method={meals.state === 'NOT_EQUIPPED' ? null : text.meals.method}
            >
              {meals.state === 'NOT_EQUIPPED' ? (
                <Unavailable message={text.meals.notEquipped} />
              ) : meals.state === 'NO_DATA' ? (
                <Unavailable message={text.meals.noData} />
              ) : (
                <>
                  <dl className="wd-stats">
                    <Stat label={text.meals.seenLabel} value={`${meals.seen}`} />
                    <Stat
                      label={text.meals.missedLabel}
                      value={`${meals.notSeen}`}
                      usual={usual(meals.usual ? `${meals.usual.notSeen}` : null)}
                    />
                    {meals.fridgePerDay !== null && (
                      <Stat
                        label={text.meals.fridgeLabel}
                        value={fillDigestText(text.meals.perDay, {
                          count: digestNumber(meals.fridgePerDay, lang),
                        })}
                        usual={usual(
                          meals.usual?.fridgePerDay == null
                            ? null
                            : digestNumber(meals.usual.fridgePerDay, lang),
                        )}
                      />
                    )}
                  </dl>
                  <MealChart digest={digest} language={lang} />
                  <ul className="wd-facts">
                    {meals.missed.length ? (
                      <li className="is-change">
                        {digestPlural(text.meals.missed, meals.missed.length, lang)}
                        {colon}
                        {meals.missed
                          .map(
                            (item) =>
                              `${digestWeekdayLabel(item.date, lang)} ${text.meals.rows[item.meal].toLowerCase()}`,
                          )
                          .join(', ')}
                      </li>
                    ) : (
                      <li className="is-stable">{text.meals.noneMissed}</li>
                    )}
                  </ul>
                  <ul className="wd-legend" aria-hidden="true">
                    <li>
                      <i className="wd-dot wd-dot--seen" />
                      {text.meals.seen}
                    </li>
                    <li>
                      <i className="wd-dot wd-dot--not_seen" />
                      {text.meals.notSeen}
                    </li>
                    <li>
                      <i className="wd-dot wd-dot--unknown" />
                      {text.meals.unknown}
                    </li>
                  </ul>
                </>
              )}
            </Tile>

            <Tile
              theme="outings"
              title={text.themes.outings}
              trend={outings.state === 'OK' || outings.state === 'PARTIAL' ? outingsTrend : null}
              method={outings.state === 'NOT_EQUIPPED' ? null : text.outings.method}
            >
              {outings.state === 'NOT_EQUIPPED' ? (
                <Unavailable message={text.outings.notEquipped} />
              ) : outings.state === 'NO_DATA' ? (
                <Unavailable message={text.outings.noData} />
              ) : (
                <>
                  <dl className="wd-stats">
                    <Stat
                      label={text.outings.label}
                      value={`${outings.total}`}
                      usual={usual(outings.usual ? `${outings.usual.total}` : null)}
                    />
                    <Stat
                      label={text.outings.timeLabel}
                      value={digestDuration(outings.minutes)}
                      usual={usual(outings.usual ? digestDuration(outings.usual.minutes) : null)}
                    />
                    <Stat
                      label={text.outings.daysWithoutLabel}
                      value={`${outings.daysWithout.length}`}
                    />
                  </dl>
                  <OutingChart digest={digest} language={lang} />
                  <ul className="wd-legend" aria-hidden="true">
                    <li>
                      <i className="wd-dot wd-dot--outing" />
                      {text.outings.legend}
                    </li>
                  </ul>
                  <ul className="wd-facts">
                    <li className={outings.daysWithout.length > 1 ? 'is-change' : 'is-stable'}>
                      {outings.daysWithout.length
                        ? `${digestPlural(text.outings.daysWithout, outings.daysWithout.length, lang)}${colon}${outings.daysWithout.map((day) => digestWeekdayLabel(day, lang)).join(', ')}`
                        : text.outings.everyDay}
                    </li>
                  </ul>
                </>
              )}
            </Tile>

            <Tile
              theme="visits"
              title={text.themes.visits}
              trend={visitSummary.calls.state === 'OK' ? visitsTrend : null}
              method={text.visits.method}
            >
              <dl className="wd-stats">
                <Stat
                  label={text.visits.plannedLabel}
                  value={`${visitSummary.planned}`}
                  usual={
                    visitSummary.confirmed
                      ? digestPlural(text.visits.confirmed, visitSummary.confirmed, lang)
                      : null
                  }
                />
                <Stat
                  label={text.visits.callsLabel}
                  value={
                    visitSummary.calls.state === 'NOT_EQUIPPED' ||
                    visitSummary.calls.state === 'NO_DATA'
                      ? '–'
                      : `${visitSummary.calls.total}`
                  }
                  usual={
                    visitSummary.calls.minutes
                      ? fillDigestText(text.visits.callsDuration, {
                          duration: digestDuration(visitSummary.calls.minutes),
                        })
                      : null
                  }
                />
                {visitSummary.sharedPresence.state !== 'NOT_EQUIPPED' && (
                  <Stat
                    label={text.visits.presenceLabel}
                    value={`${visitSummary.sharedPresence.total}`}
                  />
                )}
              </dl>
              <VisitChart digest={digest} language={lang} />
              <ul className="wd-facts">
                {digest.visits.slice(0, 6).map((visit) => (
                  <li key={visit.id} className="is-plain">
                    {dayAndTime(visit.startsAt)} · {visit.name}
                  </li>
                ))}
                {digest.appointments.map((item) => (
                  <li key={item.id} className="is-plain">
                    {text.visits.appointments} · {dayAndTime(item.startsAt)} · {item.title}
                  </li>
                ))}
                {(visitSummary.calls.state === 'NOT_EQUIPPED' ||
                  visitSummary.calls.state === 'NO_DATA') && (
                  <li className="is-muted">{text.visits.callsUnknown}</li>
                )}
                {visitSummary.sharedPresence.total > 0 && (
                  <li className="is-muted">{text.visits.presenceHint}</li>
                )}
              </ul>
              <ul className="wd-legend" aria-hidden="true">
                <li>
                  <i className="wd-dot wd-dot--visit" />
                  {text.visits.legendVisit}
                </li>
                <li>
                  <i className="wd-dot wd-dot--call" />
                  {text.visits.legendCall}
                </li>
                <li>
                  <i className="wd-dot wd-dot--presence" />
                  {text.visits.legendPresence}
                </li>
              </ul>
            </Tile>

            <Tile theme="alerts" title={text.themes.alerts}>
              {digest.alerts.length ? (
                <ul className="wd-list">
                  {digest.alerts.slice(0, 6).map((alert) => (
                    <li key={alert.id}>
                      <span className={`wd-severity wd-severity--${alert.severity.toLowerCase()}`}>
                        {text.alerts.severity[alert.severity]}
                      </span>
                      <span>
                        <strong>{alert.title}</strong>
                        <small>{dayAndTime(alert.openedAt)}</small>
                      </span>
                    </li>
                  ))}
                  {digest.alerts.length > 6 && (
                    <li className="is-muted">
                      {digestPlural(text.alerts.more, digest.alerts.length - 6, lang)}
                    </li>
                  )}
                </ul>
              ) : (
                <p className="wd-good">{text.alerts.none}</p>
              )}
            </Tile>

            <Tile theme="sensors" title={text.themes.sensors}>
              {digest.sensorIssues.length || digest.daysWithoutData.length ? (
                <ul className="wd-list">
                  {digest.daysWithoutData.length > 0 && (
                    <li>
                      <span className="wd-severity wd-severity--urgent">{text.noData}</span>
                      <span>
                        <strong>
                          {digestPlural(
                            text.sensors.daysWithout,
                            digest.daysWithoutData.length,
                            lang,
                          )}
                        </strong>
                        <small>
                          {digest.daysWithoutData
                            .map((day) => digestWeekdayLabel(day, lang))
                            .join(', ')}
                        </small>
                      </span>
                    </li>
                  )}
                  {digest.sensorIssues.map((issue) => (
                    <li key={issue.id}>
                      <span className="wd-severity wd-severity--attention">
                        {issue.kind === 'OFFLINE'
                          ? text.sensors.offline
                          : issue.kind === 'LOW_BATTERY'
                            ? text.sensors.lowBattery
                            : text.sensors.noSignal}
                      </span>
                      <span>
                        <strong>
                          {issue.name}
                          {issue.roomName ? ` · ${issue.roomName}` : ''}
                        </strong>
                        {issue.since && (
                          <small>
                            {fillDigestText(text.sensors.since, {
                              date: digestDate(digestLocalDay(issue.since, digest.timezone), lang),
                            })}
                          </small>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="wd-good">{text.sensors.allGood}</p>
              )}
            </Tile>
          </div>

          <footer className="wd-disclaimer">
            <ShieldCheck aria-hidden="true" />
            <p>
              <strong>{text.disclaimer}</strong> {text.advice}
            </p>
          </footer>
        </div>
      </section>
    </div>
  );
}
