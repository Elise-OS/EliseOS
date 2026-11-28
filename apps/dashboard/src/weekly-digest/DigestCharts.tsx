import {
  WEEKLY_DIGEST_MEALS,
  digestClock,
  digestDuration,
  digestLocalDay,
  digestVisitDays,
  digestWeekDays,
  digestWeekdayLabel,
  weeklyDigestTexts,
  type WeeklyDigest,
  type WeeklyDigestLanguage,
} from '@elise/contracts';

/** Small 7-day charts of the weekly digest. Plain SVG: they scale with their tile. */

const WIDTH = 300;
const LEFT = 40;
const RIGHT = 6;
const STEP = (WIDTH - LEFT - RIGHT) / 7;
const center = (index: number) => LEFT + STEP * index + STEP / 2;

function DayLabels({
  digest,
  language,
  y,
}: {
  digest: WeeklyDigest;
  language: WeeklyDigestLanguage;
  y: number;
}) {
  return (
    <g className="wd-chart__days">
      {digestWeekDays(digest.weekStart).map((day, index) => (
        <text key={day} x={center(index)} y={y} textAnchor="middle">
          {digestWeekdayLabel(day, language)}
        </text>
      ))}
    </g>
  );
}

/** One bar per night, from bedtime to getting up; the number under it is the risings. */
export function NightChart({
  digest,
  language,
}: {
  digest: WeeklyDigest;
  language: WeeklyDigestLanguage;
}) {
  const top = 8;
  const height = 78;
  const start = 21 * 60;
  const span = 13 * 60;
  const toY = (minute: number) => top + Math.min(1, Math.max(0, (minute - start) / span)) * height;
  const usualWake = digest.nights.usual?.wake;
  const text = weeklyDigestTexts(language);
  return (
    <svg
      className="wd-chart"
      viewBox={`0 0 ${WIDTH} 118`}
      role="img"
      aria-label={text.nights.legendBar}
    >
      <rect
        className="wd-chart__band"
        x={LEFT}
        y={top}
        width={WIDTH - LEFT - RIGHT}
        height={height}
        rx={8}
      />
      <text className="wd-chart__axis" x={LEFT - 6} y={top + 8} textAnchor="end">
        21:00
      </text>
      <text className="wd-chart__axis" x={LEFT - 6} y={top + height} textAnchor="end">
        10:00
      </text>
      {usualWake != null && (
        <line
          className="wd-chart__usual"
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={toY(usualWake + 1440)}
          y2={toY(usualWake + 1440)}
        />
      )}
      {digest.metrics.nights.days.map((day, index) => {
        const x = center(index);
        if (day.bedtimeMinute === null || day.wakeMinute === null)
          return (
            <text
              key={day.date}
              className="wd-chart__missing"
              x={x}
              y={top + height / 2 + 4}
              textAnchor="middle"
            >
              ?
            </text>
          );
        const restless = digest.nights.restlessNights.includes(day.date);
        const y1 = toY(day.bedtimeMinute);
        const y2 = toY(day.wakeMinute + 1440);
        return (
          <g key={day.date}>
            <title>{`${digestClock(day.bedtimeMinute)} – ${digestClock(day.wakeMinute)}`}</title>
            <rect
              className={`wd-chart__night${restless ? ' is-restless' : ''}`}
              x={x - 7}
              y={y1}
              width={14}
              height={Math.max(4, y2 - y1)}
              rx={6}
            />
            {day.risings !== null && day.risings > 0 && (
              <text
                className={`wd-chart__count${restless ? ' is-restless' : ''}`}
                x={x}
                y={Math.min(top + height - 3, y2 + 11)}
                textAnchor="middle"
              >
                {day.risings}
              </text>
            )}
          </g>
        );
      })}
      <DayLabels digest={digest} language={language} y={110} />
    </svg>
  );
}

/** Three dots per day: morning, noon, evening. */
export function MealChart({
  digest,
  language,
}: {
  digest: WeeklyDigest;
  language: WeeklyDigestLanguage;
}) {
  const text = weeklyDigestTexts(language);
  const rows = [22, 50, 78];
  return (
    <svg
      className="wd-chart"
      viewBox={`0 0 ${WIDTH} 118`}
      role="img"
      aria-label={text.meals.method}
    >
      {WEEKLY_DIGEST_MEALS.map((meal, row) => (
        <g key={meal}>
          <text className="wd-chart__axis" x={LEFT - 6} y={rows[row]! + 4} textAnchor="end">
            {text.meals.rows[meal]}
          </text>
          {digest.metrics.meals.days.map((day, index) => {
            const state = day.meals[meal];
            return (
              <circle
                key={day.date}
                className={`wd-chart__meal wd-chart__meal--${state.toLowerCase()}`}
                cx={center(index)}
                cy={rows[row]}
                r={state === 'SEEN' ? 8 : 7}
              >
                <title>{`${text.meals.names[meal]} · ${state === 'SEEN' ? text.meals.seen : state === 'NOT_SEEN' ? text.meals.notSeen : text.meals.unknown}`}</title>
              </circle>
            );
          })}
        </g>
      ))}
      <DayLabels digest={digest} language={language} y={110} />
    </svg>
  );
}

/** Time outside per day, with the number of outings above each bar. */
export function OutingChart({
  digest,
  language,
}: {
  digest: WeeklyDigest;
  language: WeeklyDigestLanguage;
}) {
  const text = weeklyDigestTexts(language);
  const base = 90;
  const max = Math.max(60, ...digest.metrics.outings.days.map((day) => day.minutes ?? 0));
  return (
    <svg
      className="wd-chart"
      viewBox={`0 0 ${WIDTH} 118`}
      role="img"
      aria-label={text.outings.legend}
    >
      <line className="wd-chart__base" x1={LEFT} x2={WIDTH - RIGHT} y1={base} y2={base} />
      {digest.metrics.outings.days.map((day, index) => {
        const x = center(index);
        if (day.count === null)
          return (
            <text
              key={day.date}
              className="wd-chart__missing"
              x={x}
              y={base - 6}
              textAnchor="middle"
            >
              ?
            </text>
          );
        if (day.count === 0)
          return <circle key={day.date} className="wd-chart__none" cx={x} cy={base - 3} r={2.5} />;
        const height = Math.max(4, ((day.minutes ?? 0) / max) * 66);
        return (
          <g key={day.date}>
            <title>{digestDuration(day.minutes ?? 0)}</title>
            <rect
              className="wd-chart__outing"
              x={x - 9}
              y={base - height}
              width={18}
              height={height}
              rx={5}
            />
            <text
              className="wd-chart__count is-outing"
              x={x}
              y={base - height - 5}
              textAnchor="middle"
            >
              {day.count}
            </text>
          </g>
        );
      })}
      <DayLabels digest={digest} language={language} y={110} />
    </svg>
  );
}

/** Calendar visits (squares), video calls (dots) and two rooms at once (rings), per day. */
export function VisitChart({
  digest,
  language,
}: {
  digest: WeeklyDigest;
  language: WeeklyDigestLanguage;
}) {
  const text = weeklyDigestTexts(language);
  const visits = digestVisitDays(digest);
  const base = 90;
  return (
    <svg
      className="wd-chart"
      viewBox={`0 0 ${WIDTH} 118`}
      role="img"
      aria-label={text.visits.method}
    >
      <line className="wd-chart__base" x1={LEFT} x2={WIDTH - RIGHT} y1={base} y2={base} />
      {digestWeekDays(digest.weekStart).map((day, index) => {
        const x = center(index);
        const marks: Array<'visit' | 'call' | 'presence'> = [
          ...Array<'visit'>(Math.min(visits.get(day) ?? 0, 2)).fill('visit'),
          ...Array<'call'>(Math.min(digest.metrics.calls.days[index]?.count ?? 0, 2)).fill('call'),
          ...((digest.metrics.sharedPresence.days[index]?.count ?? 0) > 0
            ? (['presence'] as const)
            : []),
        ];
        return (
          <g key={day}>
            {marks.map((mark, position) => {
              const y = base - 11 - position * 19;
              if (mark === 'visit')
                return (
                  <rect
                    key={position}
                    className="wd-chart__visit"
                    x={x - 7}
                    y={y - 7}
                    width={14}
                    height={14}
                    rx={4}
                  />
                );
              if (mark === 'call')
                return <circle key={position} className="wd-chart__call" cx={x} cy={y} r={7} />;
              return <circle key={position} className="wd-chart__presence" cx={x} cy={y} r={6} />;
            })}
          </g>
        );
      })}
      <DayLabels digest={digest} language={language} y={110} />
    </svg>
  );
}

/** A tiny bar sparkline for the summary card. */
export function Sparkline({ values, tone }: { values: Array<number | null>; tone: string }) {
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  return (
    <svg className={`wd-spark wd-spark--${tone}`} viewBox="0 0 70 22" aria-hidden="true">
      {values.map((value, index) =>
        value === null ? (
          <rect
            key={index}
            className="wd-spark__missing"
            x={index * 10 + 2}
            y={18}
            width={6}
            height={2}
            rx={1}
          />
        ) : (
          <rect
            key={index}
            x={index * 10 + 2}
            y={20 - Math.max(2, (value / max) * 18)}
            width={6}
            height={Math.max(2, (value / max) * 18)}
            rx={2}
          />
        ),
      )}
    </svg>
  );
}

/** Values of the four sparklines of the card. */
export function digestSparks(digest: WeeklyDigest) {
  const visits = digestVisitDays(digest);
  return {
    // Risings per night: the restless nights stand out.
    nights: digest.metrics.nights.days.map((day) => day.risings),
    meals: digest.metrics.meals.days.map((day) =>
      WEEKLY_DIGEST_MEALS.every((meal) => day.meals[meal] === 'UNKNOWN')
        ? null
        : WEEKLY_DIGEST_MEALS.filter((meal) => day.meals[meal] === 'SEEN').length,
    ),
    outings: digest.metrics.outings.days.map((day) => day.minutes),
    visits: digestWeekDays(digest.weekStart).map(
      (day, index) =>
        (visits.get(day) ?? 0) +
        (digest.metrics.calls.days[index]?.count ?? 0) +
        digest.appointments.filter((item) => digestLocalDay(item.startsAt, digest.timezone) === day)
          .length,
    ),
  };
}
