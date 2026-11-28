import {
  WEEKLY_DIGEST_MEALS,
  digestWeekDays,
  type WeeklyDigest,
  type WeeklyDigestLanguage,
  type WeeklyDigestStatement,
} from './weekly-digest.js';
import {
  digestClock,
  digestDate,
  digestDateLocale,
  digestDuration,
  digestNumber,
  digestPeriod,
  digestPlural,
  digestStatementText,
  digestWeekdayLabel,
  fillDigestText,
  weeklyDigestTexts,
} from './weekly-digest-text.js';

/**
 * The one-page A4 PDF of a weekly digest, for the doctor or the nurse. It is drawn with jsPDF
 * (pure JavaScript, no browser), given by the caller: the box makes it with Node, the public
 * demo in the visitor's browser. Same sections as the app, with small charts, the generation
 * date and the reminder that these are sensor estimates, not a medical device.
 */

/** The part of the jsPDF API the digest uses. */
export interface DigestPdfDocument {
  setFont(fontName: string, fontStyle?: string): unknown;
  setFontSize(size: number): unknown;
  setTextColor(color: string): unknown;
  setDrawColor(color: string): unknown;
  setFillColor(color: string): unknown;
  setLineWidth(width: number): unknown;
  setLineDashPattern(pattern: number[], phase: number): unknown;
  text(
    text: string | string[],
    x: number,
    y: number,
    options?: {
      align?: 'left' | 'center' | 'right';
      baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
    },
  ): unknown;
  rect(x: number, y: number, width: number, height: number, style?: string): unknown;
  roundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    rx: number,
    ry: number,
    style?: string,
  ): unknown;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  circle(x: number, y: number, radius: number, style?: string): unknown;
  getTextWidth(text: string): number;
  splitTextToSize(text: string, maxWidth: number): string[];
  setProperties(properties: Record<string, string>): unknown;
  output(type: 'arraybuffer'): ArrayBuffer;
  addPage(): unknown;
  setPage(page: number): unknown;
  getNumberOfPages(): number;
}

export type DigestPdfFactory = (options: {
  unit: 'pt';
  format: 'a4';
  orientation: 'portrait';
  compress?: boolean;
}) => DigestPdfDocument;

const PAGE = { width: 595.28, height: 841.89, margin: 36 } as const;
const COLOR = {
  ink: '#17324d',
  text: '#33475b',
  muted: '#6b7b8c',
  line: '#dfe6ee',
  soft: '#f4f7fa',
  blue: '#2f5f8f',
  blueSoft: '#e8f0f8',
  amber: '#b27831',
  amberSoft: '#fbf1e4',
  green: '#24694c',
  greenSoft: '#e8f4ee',
  red: '#a8432f',
  redSoft: '#f8e9e5',
  grey: '#c9d2dc',
} as const;

const TONE_COLOR: Record<WeeklyDigestStatement['tone'], string> = {
  change: COLOR.amber,
  stable: COLOR.green,
  info: COLOR.blue,
  warning: COLOR.red,
};

/** Standard PDF fonts cover Latin-1: narrow spaces become plain spaces. */
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const clean = (value: string) => value.replace(/[\u202f\u2009]/g, ' ');

export interface DigestPdfOptions {
  language: WeeklyDigestLanguage;
  /** Full name of the person for the header ("Jeanne Martin"). */
  personName?: string | null;
  generatedAt?: Date;
}

export function buildWeeklyDigestPdf(
  createDocument: DigestPdfFactory,
  digest: WeeklyDigest,
  options: DigestPdfOptions,
): Uint8Array {
  const language = options.language;
  const text = weeklyDigestTexts(language);
  const generatedAt = options.generatedAt ?? new Date();
  const doc = createDocument({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;
  const days = digestWeekDays(digest.weekStart);
  const colon = language === 'fr' ? ' : ' : ': ';
  const name = (options.personName ?? digest.residentName ?? '').trim();
  doc.setProperties({
    title: `${text.title} · ${name}`.trim(),
    subject: digestPeriod(digest.weekStart, digest.weekEnd, language, true),
    creator: 'Élise OS',
  });

  const write = (
    value: string,
    x: number,
    y: number,
    size: number,
    color: string = COLOR.text,
    style: 'normal' | 'bold' = 'normal',
    align: 'left' | 'center' | 'right' = 'left',
  ) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.text(clean(value), x, y, { align, baseline: 'top' });
  };
  const wrap = (
    value: string,
    maxWidth: number,
    size: number,
    style: 'normal' | 'bold' = 'normal',
  ) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    return doc.splitTextToSize(clean(value), maxWidth);
  };
  const paragraph = (
    value: string,
    x: number,
    y: number,
    maxWidth: number,
    size: number,
    color: string = COLOR.text,
    style: 'normal' | 'bold' = 'normal',
    lineHeight = 1.32,
  ) => {
    const lines = wrap(value, maxWidth, size, style);
    lines.forEach((line, index) =>
      write(line, x, y + index * size * lineHeight, size, color, style),
    );
    return y + lines.length * size * lineHeight;
  };

  // Header.
  write(`ÉLISE OS · ${text.eyebrow.toUpperCase()}`, left, left, 7.5, COLOR.blue, 'bold');
  write(text.title, left, left + 12, 20, COLOR.ink, 'bold');
  write(
    [name, digestPeriod(digest.weekStart, digest.weekEnd, language, true)]
      .filter(Boolean)
      .join(' · '),
    left,
    left + 37,
    10.5,
    COLOR.text,
  );
  const timeLabel = new Intl.DateTimeFormat(digestDateLocale(language), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: digest.timezone,
  }).format(generatedAt);
  const dateLabel = new Intl.DateTimeFormat(digestDateLocale(language), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: digest.timezone,
  }).format(generatedAt);
  write(
    fillDigestText(text.generatedOn, { date: dateLabel, time: timeLabel }),
    right,
    left + 2,
    8,
    COLOR.muted,
    'normal',
    'right',
  );
  write(text.pdf.audience, right, left + 14, 8, COLOR.muted, 'normal', 'right');
  let y = left + 56;
  doc.setDrawColor(COLOR.line);
  doc.setLineWidth(0.8);
  doc.line(left, y, right, y);
  y += 12;

  // Summary sentence.
  const summaryLines = wrap(
    digestStatementText(digest.summary, language),
    width - 28,
    11.5,
    'bold',
  );
  const summaryHeight = summaryLines.length * 15 + 16;
  doc.setFillColor(COLOR.blueSoft);
  doc.roundedRect(left, y, width, summaryHeight, 8, 8, 'F');
  summaryLines.forEach((line, index) =>
    write(line, left + 14, y + 9 + index * 15, 11.5, COLOR.ink, 'bold'),
  );
  y += summaryHeight + 12;

  // What changed.
  write(text.themes.changes, left, y, 12, COLOR.ink, 'bold');
  const comparison =
    digest.comparisonWeeks > 0
      ? digestPlural(text.pdf.comparison, digest.comparisonWeeks, language)
      : text.pdf.noComparison;
  write(comparison, right, y + 2, 8, COLOR.muted, 'normal', 'right');
  y += 19;
  for (const item of digest.changes) {
    doc.setFillColor(TONE_COLOR[item.tone]);
    doc.circle(left + 4, y + 5, 2.6, 'F');
    y =
      paragraph(digestStatementText(item, language), left + 14, y, width - 14, 9.5, COLOR.text) + 3;
  }
  y += 8;

  // Theme cards: each one is measured first, so long words in any language never overflow.
  const gap = 12;
  const cardWidth = (width - gap) / 2;
  const pageBottom = PAGE.height - PAGE.margin - 40;
  const CHART = 42;
  type Row = [string, string?];
  type Area = { x: number; y: number; width: number; height: number; step: number };
  interface LegendItem {
    label: string;
    draw: (cx: number, cy: number) => void;
  }
  interface CardSpec {
    title: string;
    accent: string;
    rows: Row[];
    chart?: (area: Area) => void;
    legend?: LegendItem[];
  }
  const rowHeight = (label: string) => wrap(label, cardWidth - 24, 8.4).length * 8.4 * 1.28 + 2;
  const legendRows = (items: LegendItem[]) => {
    // Legend items flow on lines that fit the card.
    const rows: LegendItem[][] = [[]];
    let used = 0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    for (const item of items) {
      const size = 16 + doc.getTextWidth(clean(item.label));
      if (used + size > cardWidth - 28 && rows.at(-1)!.length) {
        rows.push([]);
        used = 0;
      }
      rows.at(-1)!.push(item);
      used += size;
    }
    return rows;
  };
  const chartBlock = (spec: CardSpec) =>
    spec.chart ? 8 + CHART + 16 + (spec.legend ? legendRows(spec.legend).length * 11 + 2 : 0) : 0;
  const cardHeight = (spec: CardSpec) =>
    30 + spec.rows.reduce((sum, [label]) => sum + rowHeight(label), 0) + chartBlock(spec) + 8;
  const drawCard = (spec: CardSpec, x: number, top: number, height: number) => {
    doc.setDrawColor(COLOR.line);
    doc.setLineWidth(0.8);
    doc.setFillColor('#ffffff');
    doc.roundedRect(x, top, cardWidth, height, 8, 8, 'FD');
    doc.setFillColor(spec.accent);
    doc.roundedRect(x + 12, top + 13, 4, 12, 2, 2, 'F');
    write(spec.title, x + 22, top + 12, 11, COLOR.ink, 'bold');
    let cursor = top + 30;
    for (const [label, color] of spec.rows)
      cursor =
        paragraph(label, x + 12, cursor, cardWidth - 24, 8.4, color ?? COLOR.text, 'normal', 1.28) +
        2;
    if (!spec.chart) return;
    const legend = spec.legend ? legendRows(spec.legend) : [];
    const legendHeight = legend.length ? legend.length * 11 + 2 : 0;
    const areaWidth = cardWidth - 52;
    const area: Area = {
      x: x + 38,
      y: top + height - 8 - legendHeight - 16 - CHART,
      width: areaWidth,
      height: CHART,
      step: areaWidth / 7,
    };
    spec.chart(area);
    days.forEach((day, index) =>
      write(
        digestWeekdayLabel(day, language),
        area.x + area.step * index + area.step / 2,
        area.y + area.height + 5,
        6.8,
        COLOR.muted,
        'normal',
        'center',
      ),
    );
    legend.forEach((items, row) => {
      let lx = x + 14;
      const ly = area.y + area.height + 18 + row * 11;
      for (const item of items) {
        item.draw(lx + 3, ly + 3.4);
        write(item.label, lx + 9, ly, 6.6, COLOR.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.6);
        lx += 16 + doc.getTextWidth(clean(item.label));
      }
    });
  };
  const placeRow = (specs: CardSpec[]) => {
    const height = Math.max(...specs.map(cardHeight));
    if (y + height > pageBottom) {
      doc.addPage();
      y = PAGE.margin;
    }
    specs.forEach((spec, index) => drawCard(spec, left + index * (cardWidth + gap), y, height));
    y += height + gap;
  };
  const usualLabel = (value: string) => fillDigestText(text.usual, { value });
  const withUsual = (value: string, usual: string | null) =>
    usual === null ? value : `${value}  (${usualLabel(usual)})`;
  const dot =
    (color: string, radius = 3) =>
    (cx: number, cy: number) => {
      doc.setFillColor(color);
      doc.circle(cx, cy, radius, 'F');
    };
  const ring =
    (color: string, dashed = false) =>
    (cx: number, cy: number) => {
      doc.setDrawColor(color);
      doc.setLineWidth(dashed ? 0.8 : 1.2);
      if (dashed) doc.setLineDashPattern([1, 1.2], 0);
      doc.circle(cx, cy, 2.7, 'S');
      if (dashed) doc.setLineDashPattern([], 0);
    };
  const square = (color: string) => (cx: number, cy: number) => {
    doc.setFillColor(color);
    doc.roundedRect(cx - 3, cy - 3, 6, 6, 1.5, 1.5, 'F');
  };

  // Nights: one bar per night, from bedtime to getting up; the number is the risings.
  const nights = digest.nights;
  const nightCard: CardSpec = { title: text.themes.nights, accent: COLOR.blue, rows: [] };
  if (nights.state === 'NOT_EQUIPPED') nightCard.rows.push([text.nights.notEquipped, COLOR.muted]);
  else if (nights.state === 'NO_DATA') nightCard.rows.push([text.nights.noData, COLOR.muted]);
  else {
    const usual = nights.usual;
    nightCard.rows.push(
      [
        withUsual(
          `${text.nights.bedtime}${colon}${nights.bedtime === null ? '-' : digestClock(nights.bedtime)}`,
          usual?.bedtime == null ? null : digestClock(usual.bedtime),
        ),
      ],
      [
        withUsual(
          `${text.nights.wake}${colon}${nights.wake === null ? '-' : digestClock(nights.wake)}`,
          usual?.wake == null ? null : digestClock(usual.wake),
        ),
      ],
      [
        withUsual(
          `${text.nights.risings}${colon}${
            nights.risingsPerNight === null
              ? '-'
              : fillDigestText(text.nights.perNight, {
                  count: digestNumber(nights.risingsPerNight, language),
                })
          }`,
          usual?.risingsPerNight == null ? null : digestNumber(usual.risingsPerNight, language),
        ),
      ],
      [
        nights.restlessNights.length
          ? digestPlural(text.nights.restless, nights.restlessNights.length, language)
          : text.nights.calm,
        nights.restlessNights.length ? COLOR.amber : COLOR.green,
      ],
    );
    if (nights.shortNights.length)
      nightCard.rows.push([
        digestPlural(text.nights.short, nights.shortNights.length, language),
        COLOR.amber,
      ]);
    nightCard.rows.push([
      nights.source === 'BED' ? text.nights.sourceBed : text.nights.sourceMotion,
      COLOR.muted,
    ]);
    nightCard.legend = [
      { label: text.nights.legendBar, draw: square(COLOR.blue) },
      {
        label: capitalize(text.nights.restless.other.replace(/\{\{count\}\}\s*/, '')),
        draw: square(COLOR.amber),
      },
      {
        label: text.nights.legendUsual,
        draw: (cx, cy) => {
          doc.setDrawColor(COLOR.blue);
          doc.setLineWidth(0.7);
          doc.setLineDashPattern([1.6, 1.4], 0);
          doc.line(cx - 4, cy, cx + 4, cy);
          doc.setLineDashPattern([], 0);
        },
      },
    ];
    nightCard.chart = (area) => {
      const start = 21 * 60;
      const span = 13 * 60;
      const toY = (minute: number) =>
        area.y + Math.min(1, Math.max(0, (minute - start) / span)) * area.height;
      doc.setFillColor(COLOR.soft);
      doc.rect(area.x, area.y, area.width, area.height, 'F');
      write('21:00', area.x - 4, area.y - 1, 6, COLOR.muted, 'normal', 'right');
      write('10:00', area.x - 4, area.y + area.height - 6, 6, COLOR.muted, 'normal', 'right');
      if (usual?.wake != null) {
        doc.setDrawColor(COLOR.blue);
        doc.setLineWidth(0.6);
        doc.setLineDashPattern([2, 2], 0);
        const usualY = toY(usual.wake + 1440);
        doc.line(area.x, usualY, area.x + area.width, usualY);
        doc.setLineDashPattern([], 0);
      }
      digest.metrics.nights.days.forEach((day, index) => {
        const cx = area.x + area.step * index + area.step / 2;
        if (day.bedtimeMinute === null || day.wakeMinute === null) {
          write('?', cx, area.y + area.height / 2 - 4, 8, COLOR.muted, 'normal', 'center');
          return;
        }
        const restless = nights.restlessNights.includes(day.date);
        doc.setFillColor(restless ? COLOR.amber : COLOR.blue);
        const y1 = toY(day.bedtimeMinute);
        const y2 = toY(day.wakeMinute + 1440);
        doc.roundedRect(cx - 5, y1, 10, Math.max(3, y2 - y1), 3, 3, 'F');
        if (day.risings !== null)
          write(
            String(day.risings),
            cx,
            Math.min(area.y + area.height - 7, y2 + 1.5),
            6.5,
            restless ? COLOR.amber : COLOR.muted,
            'bold',
            'center',
          );
      });
    };
  }

  // Meals: three dots per day, morning, noon and evening.
  const meals = digest.meals;
  const mealCard: CardSpec = { title: text.themes.meals, accent: COLOR.green, rows: [] };
  if (meals.state === 'NOT_EQUIPPED') mealCard.rows.push([text.meals.notEquipped, COLOR.muted]);
  else if (meals.state === 'NO_DATA') mealCard.rows.push([text.meals.noData, COLOR.muted]);
  else {
    mealCard.rows.push(
      [digestPlural(text.meals.seenCount, meals.seen, language)],
      [
        meals.notSeen
          ? digestPlural(text.meals.missed, meals.notSeen, language)
          : text.meals.noneMissed,
        meals.notSeen ? COLOR.amber : COLOR.green,
      ],
    );
    if (meals.fridgePerDay !== null)
      mealCard.rows.push([
        withUsual(
          fillDigestText(text.meals.fridge, { count: digestNumber(meals.fridgePerDay, language) }),
          meals.usual?.fridgePerDay == null
            ? null
            : digestNumber(meals.usual.fridgePerDay, language),
        ),
      ]);
    mealCard.rows.push([text.meals.method, COLOR.muted]);
    mealCard.legend = [
      { label: text.meals.seen, draw: dot(COLOR.green) },
      { label: text.meals.notSeen, draw: ring(COLOR.amber) },
      { label: text.meals.unknown, draw: ring(COLOR.grey, true) },
    ];
    mealCard.chart = (area) => {
      const band = area.height / 3;
      WEEKLY_DIGEST_MEALS.forEach((meal, row) => {
        const cy = area.y + band * row + band / 2;
        write(text.meals.rows[meal], area.x - 4, cy - 3, 6, COLOR.muted, 'normal', 'right');
        digest.metrics.meals.days.forEach((day, index) => {
          const cx = area.x + area.step * index + area.step / 2;
          const state = day.meals[meal];
          if (state === 'SEEN') dot(COLOR.green, 4.4)(cx, cy);
          else if (state === 'NOT_SEEN') {
            doc.setDrawColor(COLOR.amber);
            doc.setLineWidth(1.4);
            doc.circle(cx, cy, 3.8, 'S');
          } else {
            doc.setDrawColor(COLOR.grey);
            doc.setLineWidth(0.8);
            doc.setLineDashPattern([1, 1.2], 0);
            doc.circle(cx, cy, 3.8, 'S');
            doc.setLineDashPattern([], 0);
          }
        });
      });
    };
  }
  placeRow([nightCard, mealCard]);

  // Outings: time outside per day, with the number of outings above.
  const outings = digest.outings;
  const outingCard: CardSpec = { title: text.themes.outings, accent: COLOR.amber, rows: [] };
  if (outings.state === 'NOT_EQUIPPED')
    outingCard.rows.push([text.outings.notEquipped, COLOR.muted]);
  else if (outings.state === 'NO_DATA') outingCard.rows.push([text.outings.noData, COLOR.muted]);
  else {
    outingCard.rows.push(
      [
        withUsual(
          digestPlural(text.outings.count, outings.total, language),
          outings.usual ? digestNumber(outings.usual.total, language) : null,
        ),
      ],
      [fillDigestText(text.outings.duration, { duration: digestDuration(outings.minutes) })],
      [
        outings.daysWithout.length
          ? digestPlural(text.outings.daysWithout, outings.daysWithout.length, language)
          : text.outings.everyDay,
        outings.daysWithout.length > 1 ? COLOR.amber : COLOR.text,
      ],
      [text.outings.method, COLOR.muted],
    );
    outingCard.legend = [{ label: text.outings.legend, draw: square(COLOR.amber) }];
    outingCard.chart = (area) => {
      const maxMinutes = Math.max(
        60,
        ...digest.metrics.outings.days.map((day) => day.minutes ?? 0),
      );
      doc.setDrawColor(COLOR.line);
      doc.setLineWidth(0.6);
      doc.line(area.x, area.y + area.height, area.x + area.width, area.y + area.height);
      digest.metrics.outings.days.forEach((day, index) => {
        const cx = area.x + area.step * index + area.step / 2;
        if (day.count === null) {
          write('?', cx, area.y + area.height - 10, 8, COLOR.muted, 'normal', 'center');
          return;
        }
        const barHeight = ((day.minutes ?? 0) / maxMinutes) * (area.height - 10);
        if (day.count > 0) {
          doc.setFillColor(COLOR.amber);
          doc.roundedRect(
            cx - 6,
            area.y + area.height - barHeight,
            12,
            Math.max(2, barHeight),
            2,
            2,
            'F',
          );
          write(
            String(day.count),
            cx,
            area.y + area.height - barHeight - 9,
            6.5,
            COLOR.amber,
            'bold',
            'center',
          );
        } else dot(COLOR.grey, 1.6)(cx, area.y + area.height - 2);
      });
    };
  }

  // Visits: calendar visits, video calls and moments with two rooms at once, per day.
  const visits = digest.visitSummary;
  const visitCard: CardSpec = {
    title: text.themes.visits,
    accent: COLOR.blue,
    rows: [
      [
        visits.planned
          ? `${digestPlural(text.visits.planned, visits.planned, language)}${visits.confirmed ? `, ${digestPlural(text.visits.confirmed, visits.confirmed, language)}` : ''}`
          : text.visits.nonePlanned,
      ],
    ],
  };
  if (visits.calls.state === 'NOT_EQUIPPED' || visits.calls.state === 'NO_DATA')
    visitCard.rows.push([text.visits.callsUnknown, COLOR.muted]);
  else
    visitCard.rows.push([
      `${digestPlural(text.visits.calls, visits.calls.total, language)}${visits.calls.minutes ? ` · ${fillDigestText(text.visits.callsDuration, { duration: digestDuration(visits.calls.minutes) })}` : ''}`,
    ]);
  if (visits.sharedPresence.state !== 'NOT_EQUIPPED' && visits.sharedPresence.total > 0)
    visitCard.rows.push([
      `${digestPlural(text.visits.presence, visits.sharedPresence.total, language)}. ${text.visits.presenceHint}`,
    ]);
  if (digest.appointments.length)
    visitCard.rows.push([
      `${text.visits.appointments}${colon}${digest.appointments
        .map(
          (item) =>
            `${item.title} (${digestWeekdayLabel(localDay(item.startsAt, digest.timezone), language)})`,
        )
        .join(', ')}`,
    ]);
  visitCard.rows.push([text.visits.method, COLOR.muted]);
  visitCard.legend = [
    { label: text.visits.legendVisit, draw: square(COLOR.blue) },
    { label: text.visits.legendCall, draw: dot(COLOR.green) },
    { label: text.visits.legendPresence, draw: ring(COLOR.amber) },
  ];
  visitCard.chart = (area) => {
    const visitDays = digestVisitDays(digest);
    doc.setDrawColor(COLOR.line);
    doc.setLineWidth(0.6);
    doc.line(area.x, area.y + area.height, area.x + area.width, area.y + area.height);
    days.forEach((day, index) => {
      const cx = area.x + area.step * index + area.step / 2;
      let cy = area.y + area.height - 6;
      for (let i = 0; i < Math.min(visitDays.get(day) ?? 0, 2); i += 1) {
        doc.setFillColor(COLOR.blue);
        doc.roundedRect(cx - 4.5, cy - 4.5, 9, 9, 2, 2, 'F');
        cy -= 12;
      }
      for (let i = 0; i < Math.min(digest.metrics.calls.days[index]?.count ?? 0, 2); i += 1) {
        dot(COLOR.green, 4.2)(cx, cy);
        cy -= 11;
      }
      if ((digest.metrics.sharedPresence.days[index]?.count ?? 0) > 0) {
        doc.setDrawColor(COLOR.amber);
        doc.setLineWidth(1.2);
        doc.circle(cx, cy, 3.6, 'S');
      }
    });
  };
  placeRow([outingCard, visitCard]);

  // Alerts and sensor health, shown honestly.
  const alertCard: CardSpec = { title: text.themes.alerts, accent: COLOR.red, rows: [] };
  if (!digest.alerts.length) alertCard.rows.push([text.alerts.none, COLOR.green]);
  else {
    const shown = digest.alerts.slice(0, 5);
    for (const alert of shown) {
      const when = `${digestWeekdayLabel(localDay(alert.openedAt, digest.timezone), language)} ${digestClock(localMinute(alert.openedAt, digest.timezone))}`;
      alertCard.rows.push([
        `${when} · ${alert.title} (${text.alerts.severity[alert.severity]})`,
        alert.severity === 'URGENT' ? COLOR.red : COLOR.text,
      ]);
    }
    if (digest.alerts.length > shown.length)
      alertCard.rows.push([
        digestPlural(text.alerts.more, digest.alerts.length - shown.length, language),
        COLOR.muted,
      ]);
  }
  const sensorCard: CardSpec = { title: text.themes.sensors, accent: COLOR.muted, rows: [] };
  if (!digest.sensorIssues.length && !digest.daysWithoutData.length)
    sensorCard.rows.push([text.sensors.allGood, COLOR.green]);
  if (digest.daysWithoutData.length)
    sensorCard.rows.push([
      `${digestPlural(text.sensors.daysWithout, digest.daysWithoutData.length, language)}${colon}${digest.daysWithoutData.map((day) => digestWeekdayLabel(day, language)).join(', ')}`,
      COLOR.red,
    ]);
  for (const issue of digest.sensorIssues.slice(0, 4)) {
    const status =
      issue.kind === 'OFFLINE'
        ? text.sensors.offline
        : issue.kind === 'LOW_BATTERY'
          ? text.sensors.lowBattery
          : text.sensors.noSignal;
    const since = issue.since
      ? ` ${fillDigestText(text.sensors.since, { date: digestDate(localDay(issue.since, digest.timezone), language) })}`
      : '';
    sensorCard.rows.push([
      `${issue.name}${issue.roomName ? ` (${issue.roomName})` : ''} · ${status}${since}`,
      COLOR.amber,
    ]);
  }
  placeRow([alertCard, sensorCard]);

  // Footer of every page: the reminder that these are estimates.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const footerY = PAGE.height - PAGE.margin - 22;
    doc.setDrawColor(COLOR.line);
    doc.setLineWidth(0.8);
    doc.line(left, footerY - 6, right, footerY - 6);
    write(text.disclaimer, left, footerY, 8.5, COLOR.ink, 'bold');
    paragraph(text.advice, left, footerY + 11, width - 80, 7.5, COLOR.muted);
    write(
      fillDigestText(text.pdf.page, { page, pages }),
      right,
      footerY + 11,
      7.5,
      COLOR.muted,
      'normal',
      'right',
    );
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

const localDay = (iso: string, timeZone: string) => localParts(iso, timeZone).day;
const localMinute = (iso: string, timeZone: string) => localParts(iso, timeZone).minute;

/** Calendar visits of the week, counted per local day. */
export function digestVisitDays(digest: Pick<WeeklyDigest, 'visits' | 'timezone'>) {
  const counts = new Map<string, number>();
  for (const visit of digest.visits) {
    const day = localDay(visit.startsAt, digest.timezone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

export function digestLocalDay(iso: string, timeZone: string) {
  return localDay(iso, timeZone);
}

export function digestLocalMinute(iso: string, timeZone: string) {
  return localMinute(iso, timeZone);
}

/** File name of the PDF: "bilan-semaine-2026-10-05.pdf". */
export function weeklyDigestPdfName(weekStart: string, language: WeeklyDigestLanguage) {
  const prefix: Record<WeeklyDigestLanguage, string> = {
    fr: 'bilan-semaine',
    en: 'weekly-summary',
    es: 'resumen-semana',
    it: 'resoconto-settimana',
    pt: 'resumo-semana',
  };
  return `${prefix[language]}-${weekStart}.pdf`;
}
