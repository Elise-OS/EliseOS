import type { AlertRuleSettings } from '@elise/contracts';
import { Button } from '@elise/ui';
import {
  BatteryLow,
  Bell,
  CircleCheck,
  DoorOpen,
  Footprints,
  Minus,
  MoonStar,
  Plus,
  Snowflake,
  Sparkles,
  Sun,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { type Locale, t as i18nT } from './i18n';

// A text of this panel, read in the current language when shown.
type Text = () => string;

interface NumberField {
  value: number;
  min: number;
  max: number;
  step: number;
  unit: Text;
  label: Text;
  onChange: (value: number) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const timeText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const timeMinute = (value: string) => {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return hour * 60 + minute;
};

/** Says a duration the way a caregiver would: « 3 h », « 1 h 30 », « 2 jours ». */
export function durationText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return i18nT('alertRulesPanel.dayCount', { count: days });
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

function Stepper({ field, disabled }: { field: NumberField; disabled: boolean; locale: Locale }) {
  const t = (text: Text) => text();
  const set = (value: number) => field.onChange(clamp(value, field.min, field.max));
  return (
    <span className="rule-stepper">
      <button
        type="button"
        aria-label={`${t(field.label)} −`}
        disabled={disabled || field.value <= field.min}
        onClick={() => set(field.value - field.step)}
      >
        <Minus aria-hidden="true" />
      </button>
      <label>
        <input
          aria-label={t(field.label)}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
          value={field.value}
          onChange={(event) => field.onChange(Number(event.target.value))}
          onBlur={() => set(field.value)}
        />
        <span>{t(field.unit)}</span>
      </label>
      <button
        type="button"
        aria-label={`${t(field.label)} +`}
        disabled={disabled || field.value >= field.max}
        onClick={() => set(field.value + field.step)}
      >
        <Plus aria-hidden="true" />
      </button>
    </span>
  );
}

function RuleCard({
  icon: Icon,
  tone,
  title,
  summary,
  hint,
  enabled,
  toggleLabel,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  tone: 'blue' | 'amber' | 'sage' | 'violet' | 'red';
  title: string;
  summary: string;
  hint: string;
  enabled: boolean;
  toggleLabel: string;
  onToggle: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <article className={`rule-card ${enabled ? 'is-on' : 'is-off'}`}>
      <span className={`rule-card-icon rule-card-icon--${tone}`}>
        <Icon aria-hidden="true" />
      </span>
      <div className="rule-card-copy">
        <h4>{title}</h4>
        <p>{summary}</p>
        <small>{hint}</small>
      </div>
      <button
        type="button"
        className={`config-toggle-btn ${enabled ? 'is-on' : ''}`}
        role="switch"
        aria-checked={enabled}
        aria-label={toggleLabel}
        onClick={() => onToggle(!enabled)}
      >
        <span className="config-toggle-handle" />
      </button>
      {children && <div className="rule-card-controls">{children}</div>}
    </article>
  );
}

export function AlertRulesPanel({
  rules,
  locale = 'fr',
  saving,
  notice,
  onChange,
  onSave,
}: {
  rules: AlertRuleSettings;
  locale?: Locale;
  saving: boolean;
  notice: string;
  onChange: (rules: AlertRuleSettings) => void;
  onSave: () => void | Promise<boolean>;
}) {
  const t = (text: Text) => text();
  const [saved, setSaved] = useState(() => JSON.stringify(rules));
  const dirty = JSON.stringify(rules) !== saved;
  const update = <K extends keyof AlertRuleSettings>(
    key: K,
    patch: Partial<AlertRuleSettings[K]>,
  ) => onChange({ ...rules, [key]: { ...rules[key], ...patch } });
  const save = async () => {
    const snapshot = JSON.stringify(rules);
    if ((await onSave()) !== false) setSaved(snapshot);
  };
  const minutes = (
    key: 'inactivity' | 'doorOpen' | 'sensorOffline',
    label: Text,
    min: number,
    max: number,
    step: number,
  ): NumberField => ({
    value: rules[key].minutes,
    min,
    max,
    step,
    unit: () => i18nT('alertRulesPanel.min'),
    label,
    onChange: (value) => update(key, { minutes: value }),
  });
  const enabledCount = (Object.keys(rules) as Array<keyof AlertRuleSettings>).filter(
    (key) => rules[key].enabled,
  ).length;
  const total = Object.keys(rules).length;
  const night = rules.nightActivity;

  const groups: Array<{ title: Text; text: Text; cards: ReactNode }> = [
    {
      title: () => i18nT('alertRulesPanel.everydaySafety'),
      text: () => i18nT('alertRulesPanel.situationsWorthCheckingInOn'),
      cards: (
        <>
          <RuleCard
            icon={DoorOpen}
            tone="amber"
            title={t(() => i18nT('alertRulesPanel.doorLeftOpen'))}
            summary={i18nT('alertRulesPanel.tellMeWhenTheFront', {
              durationText: durationText(rules.doorOpen.minutes),
            })}
            hint={t(() => i18nT('alertRulesPanel.aShortOpeningStaysA'))}
            enabled={rules.doorOpen.enabled}
            toggleLabel={t(() => i18nT('alertRulesPanel.enableDoorLeftOpen'))}
            onToggle={(enabled) => update('doorOpen', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.doorOpen.enabled}
              field={minutes(
                'doorOpen',
                () => i18nT('alertRulesPanel.doorOpenDuration'),
                1,
                120,
                1,
              )}
            />
          </RuleCard>
          <RuleCard
            icon={Footprints}
            tone="blue"
            title={t(() => i18nT('alertRulesPanel.noMovement'))}
            summary={i18nT('alertRulesPanel.tellMeWhenNoMovement', {
              durationText: durationText(rules.inactivity.minutes),
            })}
            hint={t(() => i18nT('alertRulesPanel.onlyWhileTheSensorsAnswer'))}
            enabled={rules.inactivity.enabled}
            toggleLabel={t(() => i18nT('alertRulesPanel.enableNoMovement'))}
            onToggle={(enabled) => update('inactivity', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.inactivity.enabled}
              field={minutes(
                'inactivity',
                () => i18nT('alertRulesPanel.timeWithoutMovement'),
                15,
                1440,
                15,
              )}
            />
          </RuleCard>
        </>
      ),
    },
    {
      title: () => i18nT('alertRulesPanel.homeComfort'),
      text: () => i18nT('alertRulesPanel.aThresholdMustLastA'),
      cards: (
        <>
          <RuleCard
            icon={Snowflake}
            tone="blue"
            title={t(() => i18nT('alertRulesPanel.roomTooCold'))}
            summary={i18nT('alertRulesPanel.tellMeBelowCFor', {
              celsius: rules.lowTemperature.celsius,
              durationText: durationText(rules.lowTemperature.minutes),
            })}
            hint={t(() => i18nT('alertRulesPanel.usefulInWinterHeatingOff'))}
            enabled={rules.lowTemperature.enabled}
            toggleLabel={t(() => i18nT('alertRulesPanel.enableLowTemperature'))}
            onToggle={(enabled) => update('lowTemperature', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.lowTemperature.enabled}
              field={{
                value: rules.lowTemperature.celsius,
                min: 5,
                max: 25,
                step: 0.5,
                unit: () => i18nT('alertRulesPanel.c'),
                label: () => i18nT('alertRulesPanel.minimumTemperature'),
                onChange: (celsius) => update('lowTemperature', { celsius }),
              }}
            />
            <Stepper
              locale={locale}
              disabled={!rules.lowTemperature.enabled}
              field={{
                value: rules.lowTemperature.minutes,
                min: 1,
                max: 240,
                step: 5,
                unit: () => i18nT('alertRulesPanel.min'),
                label: () => i18nT('alertRulesPanel.timeBelowThreshold'),
                onChange: (value) => update('lowTemperature', { minutes: value }),
              }}
            />
          </RuleCard>
          <RuleCard
            icon={Sun}
            tone="red"
            title={t(() => i18nT('alertRulesPanel.roomTooHot'))}
            summary={i18nT('alertRulesPanel.tellMeAboveCFor', {
              celsius: rules.highTemperature.celsius,
              durationText: durationText(rules.highTemperature.minutes),
            })}
            hint={t(() => i18nT('alertRulesPanel.aReminderToDrinkAnd'))}
            enabled={rules.highTemperature.enabled}
            toggleLabel={t(() => i18nT('alertRulesPanel.enableHighTemperature'))}
            onToggle={(enabled) => update('highTemperature', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.highTemperature.enabled}
              field={{
                value: rules.highTemperature.celsius,
                min: 20,
                max: 45,
                step: 0.5,
                unit: () => i18nT('alertRulesPanel.c'),
                label: () => i18nT('alertRulesPanel.maximumTemperature'),
                onChange: (celsius) => update('highTemperature', { celsius }),
              }}
            />
            <Stepper
              locale={locale}
              disabled={!rules.highTemperature.enabled}
              field={{
                value: rules.highTemperature.minutes,
                min: 1,
                max: 240,
                step: 5,
                unit: () => i18nT('alertRulesPanel.min'),
                label: () => i18nT('alertRulesPanel.timeAboveThreshold'),
                onChange: (value) => update('highTemperature', { minutes: value }),
              }}
            />
          </RuleCard>
        </>
      ),
    },
    {
      title: () => i18nT('alertRulesPanel.atNight'),
      text: () => i18nT('alertRulesPanel.severalCloseMovementsNeverA'),
      cards: (
        <RuleCard
          icon={MoonStar}
          tone="violet"
          title={t(() => i18nT('alertRulesPanel.repeatedNightActivity'))}
          summary={i18nT('alertRulesPanel.tellMeAfterMovementsBetween', {
            minimumEvents: night.minimumEvents,
            timeText: timeText(night.startMinute),
            timeText2: timeText(night.endMinute),
          })}
          hint={t(() => i18nT('alertRulesPanel.aSingleTripToThe'))}
          enabled={night.enabled}
          toggleLabel={t(() => i18nT('alertRulesPanel.enableNightActivity'))}
          onToggle={(enabled) => update('nightActivity', { enabled })}
        >
          <span className="rule-time-range">
            <label>
              <span>{t(() => i18nT('alertRulesPanel.from'))}</span>
              <input
                aria-label={t(() => i18nT('alertRulesPanel.nightStarts'))}
                type="time"
                disabled={!night.enabled}
                value={timeText(night.startMinute)}
                onChange={(event) =>
                  update('nightActivity', { startMinute: timeMinute(event.target.value) })
                }
              />
            </label>
            <label>
              <span>{t(() => i18nT('alertRulesPanel.to'))}</span>
              <input
                aria-label={t(() => i18nT('alertRulesPanel.nightEnds'))}
                type="time"
                disabled={!night.enabled}
                value={timeText(night.endMinute)}
                onChange={(event) =>
                  update('nightActivity', { endMinute: timeMinute(event.target.value) })
                }
              />
            </label>
          </span>
          <Stepper
            locale={locale}
            disabled={!night.enabled}
            field={{
              value: night.minimumEvents,
              min: 2,
              max: 20,
              step: 1,
              unit: () => i18nT('alertRulesPanel.moves'),
              label: () => i18nT('alertRulesPanel.numberOfMovements'),
              onChange: (minimumEvents) => update('nightActivity', { minimumEvents }),
            }}
          />
        </RuleCard>
      ),
    },
    {
      title: () => i18nT('alertRulesPanel.equipment'),
      text: () => i18nT('alertRulesPanel.soAFaultIsNever'),
      cards: (
        <>
          <RuleCard
            icon={WifiOff}
            tone="sage"
            title={t(() => i18nT('alertRulesPanel.silentSensor'))}
            summary={i18nT('alertRulesPanel.tellMeWhenASensor', {
              durationText: durationText(rules.sensorOffline.minutes),
            })}
            hint={t(() => i18nT('alertRulesPanel.avoidsMistakingAFaultFor'))}
            enabled={rules.sensorOffline.enabled}
            toggleLabel={t(() => i18nT('alertRulesPanel.enableSilentSensor'))}
            onToggle={(enabled) => update('sensorOffline', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.sensorOffline.enabled}
              field={minutes(
                'sensorOffline',
                () => i18nT('alertRulesPanel.silentSensorDelay'),
                15,
                10_080,
                15,
              )}
            />
          </RuleCard>
          <RuleCard
            icon={BatteryLow}
            tone="sage"
            title={t(() => i18nT('alertRulesPanel.lowBattery'))}
            summary={i18nT('alertRulesPanel.tellMeWhenABattery', {
              percent: rules.lowBattery.percent,
            })}
            hint={t(() => i18nT('alertRulesPanel.aCalmHeadsUpTo'))}
            enabled={rules.lowBattery.enabled}
            toggleLabel={t(() => i18nT('alertRulesPanel.enableLowBattery'))}
            onToggle={(enabled) => update('lowBattery', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.lowBattery.enabled}
              field={{
                value: rules.lowBattery.percent,
                min: 1,
                max: 50,
                step: 5,
                unit: () => i18nT('alertRulesPanel.text'),
                label: () => i18nT('alertRulesPanel.batteryThreshold'),
                onChange: (percent) => update('lowBattery', { percent }),
              }}
            />
          </RuleCard>
        </>
      ),
    },
    {
      title: () => i18nT('alertRulesPanel.habits'),
      text: () => i18nT('alertRulesPanel.eliseComparesEachDayWith'),
      cards: (
        <RuleCard
          icon={Sparkles}
          tone="violet"
          title={t(() => i18nT('alertRulesPanel.changesFromLearntHabits'))}
          summary={t(() => i18nT('alertRulesPanel.reportADayUnlikeThe'))}
          hint={t(() => i18nT('alertRulesPanel.availableAfter14ReliableDays'))}
          enabled={rules.behavioral.enabled}
          toggleLabel={t(() => i18nT('alertRulesPanel.enableBehaviouralAlerts'))}
          onToggle={(enabled) => update('behavioral', { enabled })}
        />
      ),
    },
  ];

  return (
    <section
      className="elise-card settings-section-card alert-rules-card"
      aria-labelledby="alert-rules-title"
    >
      <header className="alert-rules-head">
        <span className="settings-section-icon settings-section-icon--amber">
          <Bell aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">{t(() => i18nT('alertRulesPanel.homeLandmarks'))}</span>
          <h2 id="alert-rules-title">{t(() => i18nT('alertRulesPanel.situationsToReport'))}</h2>
          <p>{t(() => i18nT('alertRulesPanel.chooseWhatDeservesYourAttention'))}</p>
        </div>
        <span className="alert-rules-count">
          <strong>
            {enabledCount}/{total}
          </strong>
          {t(() => i18nT('alertRulesPanel.situationsFollowed'))}
        </span>
      </header>

      {groups.map((group) => (
        <section className="rule-group" key={group.title()}>
          <header>
            <h3>{t(group.title)}</h3>
            <p>{t(group.text)}</p>
          </header>
          <div className="rule-group-cards">{group.cards}</div>
        </section>
      ))}

      <div className={`rule-save-bar ${dirty ? 'is-dirty' : ''}`}>
        <p role="status">
          {dirty ? (
            t(() => i18nT('alertRulesPanel.unsavedChanges'))
          ) : notice ? (
            <>
              <CircleCheck aria-hidden="true" /> {notice}
            </>
          ) : (
            t(() => i18nT('alertRulesPanel.everyLandmarkIsUpTo'))
          )}
        </p>
        {dirty && (
          <button
            type="button"
            className="rule-reset"
            onClick={() => onChange(JSON.parse(saved) as AlertRuleSettings)}
          >
            {t(() => i18nT('alertRulesPanel.undo'))}
          </button>
        )}
        <Button type="button" disabled={saving || !dirty} onClick={() => void save()}>
          {saving
            ? t(() => i18nT('alertRulesPanel.saving'))
            : t(() => i18nT('alertRulesPanel.saveLandmarks'))}
        </Button>
      </div>
    </section>
  );
}
