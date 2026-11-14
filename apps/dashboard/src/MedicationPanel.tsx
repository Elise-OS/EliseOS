import { Button, Card, StatusPill } from '@elise/ui';
import { CircleCheck, Pill } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { dateLocale, type Locale, t as i18nT } from './i18n';
import type { MedicationItem, MedicationDoseItem, MedicationDraft } from './app-types';
import { time } from './app-labels';

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function medicationStatusLabel(status: MedicationDoseItem['status']): string {
  const labels = {
    PENDING: () => i18nT('app.medicationStatusLabel.labels.PENDING'),
    TAKEN: () => i18nT('app.medicationStatusLabel.labels.TAKEN'),
    MISSED: () => i18nT('app.medicationStatusLabel.labels.MISSED'),
    SKIPPED: () => i18nT('app.medicationStatusLabel.labels.SKIPPED'),
  } as const;
  return labels[status]();
}

export function MedicationPanel({
  locale,
  medications,
  doses,
  submitting,
  notice,
  onCreate,
  onConfirm,
  onSkip,
}: {
  locale: Locale;
  medications: MedicationItem[];
  doses: MedicationDoseItem[];
  submitting: boolean;
  notice: string;
  onCreate: (draft: MedicationDraft) => Promise<boolean>;
  onConfirm: (doseId: string) => void;
  onSkip: (doseId: string) => void;
}) {
  const [draft, setDraft] = useState<MedicationDraft>({
    name: '',
    dosage: '',
    instructions: '',
    time: '08:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: 60,
  });
  const ordered = [...doses].sort(
    (left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime(),
  );
  const todayKey = dateKey(new Date());
  const todayDoses = ordered.filter((dose) => dateKey(new Date(dose.scheduledFor)) === todayKey);
  const focusDose =
    todayDoses.find((dose) => dose.status === 'MISSED') ??
    todayDoses.find(
      (dose) => dose.status === 'PENDING' && new Date(dose.scheduledFor).getTime() >= Date.now(),
    ) ??
    todayDoses.find((dose) => dose.status === 'PENDING');
  // Sunday first, as daysOfWeek counts them; names come from the language itself.
  const weekday = (style: 'narrow' | 'long') =>
    Array.from({ length: 7 }, (_, day) => {
      const name = new Intl.DateTimeFormat(dateLocale(), {
        weekday: style,
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2023, 0, 1 + day)));
      return name.charAt(0).toLocaleUpperCase(dateLocale()) + name.slice(1);
    });
  const dayLabels = weekday('narrow');
  const fullDayLabels = weekday('long');
  const toggleDay = (day: number) => {
    const selected = draft.daysOfWeek.includes(day);
    const daysOfWeek = selected
      ? draft.daysOfWeek.filter((value) => value !== day)
      : [...draft.daysOfWeek, day].sort();
    if (daysOfWeek.length > 0) setDraft({ ...draft, daysOfWeek });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!(await onCreate(draft))) return;
    setDraft({
      name: '',
      dosage: '',
      instructions: '',
      time: '08:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: 60,
    });
  };

  return (
    <section className="section-view medication-page">
      <header className="page-hero medication-heading">
        <div className="page-hero__copy">
          <span className="page-hero__eyebrow">{i18nT('app.localPillbox')}</span>
          <h2 className="page-hero__title">{i18nT('app.medications')}</h2>
          <p className="page-hero__text">{i18nT('app.simpleRemindersToSupportMedication')}</p>
        </div>
      </header>

      <div className="medication-layout">
        <Card className={`next-dose-card ${focusDose?.status === 'MISSED' ? 'is-late' : ''}`}>
          <div className="next-dose-topline">
            <span className="eyebrow">
              {focusDose?.status === 'MISSED'
                ? i18nT('app.aGentleCheckMayHelp')
                : i18nT('app.nextDose')}
            </span>
            {focusDose && (
              <StatusPill tone={focusDose.status === 'MISSED' ? 'attention' : 'neutral'}>
                {medicationStatusLabel(focusDose.status)}
              </StatusPill>
            )}
          </div>
          {focusDose ? (
            <>
              <time className="dose-time">{time(focusDose.scheduledFor)}</time>
              <h2>{focusDose.schedule.medication.name}</h2>
              <strong className="dose-dosage">{focusDose.schedule.medication.dosage}</strong>
              {focusDose.schedule.medication.instructions && (
                <p>{focusDose.schedule.medication.instructions}</p>
              )}
              {focusDose.status === 'MISSED' && (
                <p className="dose-caution">{i18nT('app.thisDoseHasNotBeen')}</p>
              )}
              <div className="dose-actions">
                <Button type="button" onClick={() => onConfirm(focusDose.id)}>
                  <CircleCheck />
                  {i18nT('app.confirmDose')}
                </Button>
                <Button
                  type="button"
                  className="button-secondary"
                  onClick={() => onSkip(focusDose.id)}
                >
                  {i18nT('app.markAsSkipped')}
                </Button>
              </div>
            </>
          ) : (
            <div className="medication-empty">
              <Pill />
              <h2>{i18nT('app.noUpcomingDoseToday')}</h2>
              <p>
                {medications.length === 0
                  ? i18nT('app.addAFirstTreatmentTo')
                  : i18nT('app.allScheduledDosesForToday')}
              </p>
            </div>
          )}
          {notice && (
            <p className="medication-notice" role="status" aria-live="polite">
              {notice}
            </p>
          )}
        </Card>

        <Card className="medication-today-card">
          <span className="eyebrow">{i18nT('app.today')}</span>
          <h2>{i18nT('app.doseTimeline')}</h2>
          <div className="dose-summary" aria-label={i18nT('app.doseSummary')}>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'TAKEN').length}</strong>
              {i18nT('app.confirmed')}
            </span>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'PENDING').length}</strong>
              {i18nT('app.scheduled')}
            </span>
            <span>
              <strong>{todayDoses.filter((dose) => dose.status === 'MISSED').length}</strong>
              {i18nT('app.toCheck')}
            </span>
          </div>
          <div className="dose-list">
            {todayDoses.length === 0 ? (
              <p className="empty-state">{i18nT('app.noDosePlannedToday')}</p>
            ) : (
              todayDoses.map((dose) => (
                <article className={`dose-row status-${dose.status.toLowerCase()}`} key={dose.id}>
                  <time>{time(dose.scheduledFor)}</time>
                  <span>
                    <strong>{dose.schedule.medication.name}</strong>
                    <small>{dose.schedule.medication.dosage}</small>
                  </span>
                  <StatusPill tone={dose.status === 'MISSED' ? 'attention' : 'neutral'}>
                    {medicationStatusLabel(dose.status)}
                  </StatusPill>
                </article>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="medication-secondary-grid">
        <Card className="medication-history-card">
          <span className="eyebrow">{i18nT('app.lastSevenDays')}</span>
          <h2>{i18nT('app.history')}</h2>
          <div className="dose-history">
            {[...ordered]
              .reverse()
              .slice(0, 12)
              .map((dose) => (
                <article key={dose.id}>
                  <time>
                    {new Date(dose.scheduledFor).toLocaleDateString(locale, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {time(dose.scheduledFor)}
                  </time>
                  <span>
                    <strong>{dose.schedule.medication.name}</strong>
                    <small>
                      {medicationStatusLabel(dose.status)}
                      {dose.confirmedBy ? ` · ${dose.confirmedBy.displayName}` : ''}
                    </small>
                  </span>
                </article>
              ))}
            {ordered.length === 0 && (
              <p className="empty-state">{i18nT('app.historyWillAppearAsDoses')}</p>
            )}
          </div>
        </Card>

        <Card className="medication-form-card">
          <span className="eyebrow">{i18nT('app.newReminder')}</span>
          <h2>{i18nT('app.addATreatment')}</h2>
          <p>{i18nT('app.onlyCopyInformationAlreadyProvided')}</p>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              {i18nT('app.treatmentName')}
              <input
                required
                maxLength={150}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              {i18nT('app.prescribedDosage')}
              <input
                required
                maxLength={150}
                placeholder={i18nT('app.eG1Tablet')}
                value={draft.dosage}
                onChange={(event) => setDraft({ ...draft, dosage: event.target.value })}
              />
            </label>
            <label>
              {i18nT('app.instructionsOptional')}
              <textarea
                maxLength={1000}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
            </label>
            <div className="medication-form-row">
              <label>
                {i18nT('app.scheduledTime')}
                <input
                  type="time"
                  required
                  value={draft.time}
                  onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                />
              </label>
              <label>
                {i18nT('app.confirmationWindow')}
                <select
                  value={draft.graceMinutes}
                  onChange={(event) =>
                    setDraft({ ...draft, graceMinutes: Number(event.target.value) })
                  }
                >
                  <option value={30}>30 min</option>
                  <option value={60}>1 h</option>
                  <option value={120}>2 h</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>{i18nT('app.scheduledDays')}</legend>
              <div className="medication-days">
                {dayLabels.map((label, day) => (
                  <button
                    key={`${label}-${day}`}
                    type="button"
                    aria-label={fullDayLabels[day]}
                    aria-pressed={draft.daysOfWeek.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={submitting}>
              {submitting ? i18nT('app.adding') : i18nT('app.addTreatment')}
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
}
