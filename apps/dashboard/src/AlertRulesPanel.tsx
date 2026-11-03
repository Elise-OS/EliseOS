import type { AlertRuleSettings } from '@michel/contracts';
import { Button } from '@michel/ui';
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
import type { Locale } from './i18n';

type Text = [fr: string, en: string];

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
export function durationText(minutes: number, locale: Locale) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return locale === 'fr'
      ? `${days} jour${days > 1 ? 's' : ''}`
      : `${days} day${days > 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

function Stepper({
  field,
  disabled,
  locale,
}: {
  field: NumberField;
  disabled: boolean;
  locale: Locale;
}) {
  const t = (text: Text) => text[locale === 'fr' ? 0 : 1];
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
  const fr = locale === 'fr';
  const t = (text: Text) => text[fr ? 0 : 1];
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
    unit: ['min', 'min'],
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
      title: ['Sécurité au quotidien', 'Everyday safety'],
      text: [
        'Les situations qui demandent de prendre des nouvelles rapidement.',
        'Situations worth checking in on quickly.',
      ],
      cards: (
        <>
          <RuleCard
            icon={DoorOpen}
            tone="amber"
            title={t(['Porte laissée ouverte', 'Door left open'])}
            summary={
              fr
                ? `Prévenir si la porte d’entrée reste ouverte plus de ${durationText(rules.doorOpen.minutes, locale)}.`
                : `Tell me when the front door stays open longer than ${durationText(rules.doorOpen.minutes, locale)}.`
            }
            hint={t([
              'Une ouverture brève reste un événement normal.',
              'A short opening stays a normal event.',
            ])}
            enabled={rules.doorOpen.enabled}
            toggleLabel={t(['Activer la porte ouverte', 'Enable door left open'])}
            onToggle={(enabled) => update('doorOpen', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.doorOpen.enabled}
              field={minutes('doorOpen', ['Durée porte ouverte', 'Door open duration'], 1, 120, 1)}
            />
          </RuleCard>
          <RuleCard
            icon={Footprints}
            tone="blue"
            title={t(['Absence de mouvement', 'No movement'])}
            summary={
              fr
                ? `Prévenir si aucun mouvement n’est vu pendant ${durationText(rules.inactivity.minutes, locale)} en journée.`
                : `Tell me when no movement is seen for ${durationText(rules.inactivity.minutes, locale)} during the day.`
            }
            hint={t([
              'Seulement lorsque les capteurs répondent correctement.',
              'Only while the sensors answer correctly.',
            ])}
            enabled={rules.inactivity.enabled}
            toggleLabel={t(['Activer l’absence de mouvement', 'Enable no movement'])}
            onToggle={(enabled) => update('inactivity', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.inactivity.enabled}
              field={minutes(
                'inactivity',
                ['Durée sans mouvement', 'Time without movement'],
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
      title: ['Confort du logement', 'Home comfort'],
      text: [
        'Le seuil doit durer un moment avant qu’Élise le signale.',
        'A threshold must last a while before Élise reports it.',
      ],
      cards: (
        <>
          <RuleCard
            icon={Snowflake}
            tone="blue"
            title={t(['Pièce trop froide', 'Room too cold'])}
            summary={
              fr
                ? `Prévenir sous ${rules.lowTemperature.celsius} °C pendant ${durationText(rules.lowTemperature.minutes, locale)}.`
                : `Tell me below ${rules.lowTemperature.celsius} °C for ${durationText(rules.lowTemperature.minutes, locale)}.`
            }
            hint={t([
              'Utile en hiver : chauffage éteint, fenêtre restée ouverte.',
              'Useful in winter: heating off, window left open.',
            ])}
            enabled={rules.lowTemperature.enabled}
            toggleLabel={t(['Activer la température basse', 'Enable low temperature'])}
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
                unit: ['°C', '°C'],
                label: ['Température minimale', 'Minimum temperature'],
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
                unit: ['min', 'min'],
                label: ['Durée sous le seuil', 'Time below threshold'],
                onChange: (value) => update('lowTemperature', { minutes: value }),
              }}
            />
          </RuleCard>
          <RuleCard
            icon={Sun}
            tone="red"
            title={t(['Pièce trop chaude', 'Room too hot'])}
            summary={
              fr
                ? `Prévenir au-dessus de ${rules.highTemperature.celsius} °C pendant ${durationText(rules.highTemperature.minutes, locale)}.`
                : `Tell me above ${rules.highTemperature.celsius} °C for ${durationText(rules.highTemperature.minutes, locale)}.`
            }
            hint={t([
              'Pour penser à faire boire et à fermer les volets en été.',
              'A reminder to drink and close the shutters in summer.',
            ])}
            enabled={rules.highTemperature.enabled}
            toggleLabel={t(['Activer la température haute', 'Enable high temperature'])}
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
                unit: ['°C', '°C'],
                label: ['Température maximale', 'Maximum temperature'],
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
                unit: ['min', 'min'],
                label: ['Durée au-dessus du seuil', 'Time above threshold'],
                onChange: (value) => update('highTemperature', { minutes: value }),
              }}
            />
          </RuleCard>
        </>
      ),
    },
    {
      title: ['La nuit', 'At night'],
      text: [
        'Plusieurs passages rapprochés, jamais un lever isolé.',
        'Several close movements, never a single trip.',
      ],
      cards: (
        <RuleCard
          icon={MoonStar}
          tone="violet"
          title={t(['Activité nocturne répétée', 'Repeated night activity'])}
          summary={
            fr
              ? `Prévenir à partir de ${night.minimumEvents} mouvements entre ${timeText(night.startMinute)} et ${timeText(night.endMinute)}.`
              : `Tell me after ${night.minimumEvents} movements between ${timeText(night.startMinute)} and ${timeText(night.endMinute)}.`
          }
          hint={t([
            'Un lever pour aller aux toilettes n’est jamais signalé seul.',
            'A single trip to the bathroom is never reported on its own.',
          ])}
          enabled={night.enabled}
          toggleLabel={t(['Activer l’activité nocturne', 'Enable night activity'])}
          onToggle={(enabled) => update('nightActivity', { enabled })}
        >
          <span className="rule-time-range">
            <label>
              <span>{t(['De', 'From'])}</span>
              <input
                aria-label={t(['Début de la nuit', 'Night starts'])}
                type="time"
                disabled={!night.enabled}
                value={timeText(night.startMinute)}
                onChange={(event) =>
                  update('nightActivity', { startMinute: timeMinute(event.target.value) })
                }
              />
            </label>
            <label>
              <span>{t(['à', 'to'])}</span>
              <input
                aria-label={t(['Fin de la nuit', 'Night ends'])}
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
              unit: ['passages', 'moves'],
              label: ['Nombre de mouvements', 'Number of movements'],
              onChange: (minimumEvents) => update('nightActivity', { minimumEvents }),
            }}
          />
        </RuleCard>
      ),
    },
    {
      title: ['Matériel', 'Equipment'],
      text: [
        'Pour qu’une panne ne soit jamais confondue avec une absence d’activité.',
        'So a fault is never mistaken for a lack of activity.',
      ],
      cards: (
        <>
          <RuleCard
            icon={WifiOff}
            tone="sage"
            title={t(['Capteur silencieux', 'Silent sensor'])}
            summary={
              fr
                ? `Prévenir si un capteur n’envoie rien pendant ${durationText(rules.sensorOffline.minutes, locale)}.`
                : `Tell me when a sensor sends nothing for ${durationText(rules.sensorOffline.minutes, locale)}.`
            }
            hint={t([
              'Évite de confondre une panne avec une absence d’activité.',
              'Avoids mistaking a fault for a lack of activity.',
            ])}
            enabled={rules.sensorOffline.enabled}
            toggleLabel={t(['Activer le capteur silencieux', 'Enable silent sensor'])}
            onToggle={(enabled) => update('sensorOffline', { enabled })}
          >
            <Stepper
              locale={locale}
              disabled={!rules.sensorOffline.enabled}
              field={minutes(
                'sensorOffline',
                ['Délai capteur silencieux', 'Silent sensor delay'],
                15,
                10_080,
                15,
              )}
            />
          </RuleCard>
          <RuleCard
            icon={BatteryLow}
            tone="sage"
            title={t(['Pile faible', 'Low battery'])}
            summary={
              fr
                ? `Prévenir quand une pile passe sous ${rules.lowBattery.percent} %.`
                : `Tell me when a battery drops below ${rules.lowBattery.percent} %.`
            }
            hint={t([
              'Une information calme pour anticiper le remplacement.',
              'A calm heads-up to plan the replacement.',
            ])}
            enabled={rules.lowBattery.enabled}
            toggleLabel={t(['Activer la batterie faible', 'Enable low battery'])}
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
                unit: ['%', '%'],
                label: ['Seuil de batterie', 'Battery threshold'],
                onChange: (percent) => update('lowBattery', { percent }),
              }}
            />
          </RuleCard>
        </>
      ),
    },
    {
      title: ['Habitudes', 'Habits'],
      text: [
        'Élise compare chaque journée à ce qu’elle a appris du logement.',
        'Élise compares each day with what it has learnt about the home.',
      ],
      cards: (
        <RuleCard
          icon={Sparkles}
          tone="violet"
          title={t(['Écarts aux habitudes apprises', 'Changes from learnt habits'])}
          summary={t([
            'Signaler une journée qui ne ressemble pas aux autres : lever tardif, cuisine peu utilisée…',
            'Report a day unlike the others: late wake-up, kitchen barely used…',
          ])}
          hint={t([
            'Disponible après 14 jours fiables et deux contrôles espacés. Chaque signal se valide à la main.',
            'Available after 14 reliable days and two spaced checks. Every signal is confirmed by hand.',
          ])}
          enabled={rules.behavioral.enabled}
          toggleLabel={t(['Activer les alertes comportementales', 'Enable behavioural alerts'])}
          onToggle={(enabled) => update('behavioral', { enabled })}
        />
      ),
    },
  ];

  return (
    <section
      className="michel-card settings-section-card alert-rules-card"
      aria-labelledby="alert-rules-title"
    >
      <header className="alert-rules-head">
        <span className="settings-section-icon settings-section-icon--amber">
          <Bell aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">{t(['Repères du domicile', 'Home landmarks'])}</span>
          <h2 id="alert-rules-title">{t(['Situations à signaler', 'Situations to report'])}</h2>
          <p>
            {t([
              'Choisissez ce qui mérite votre attention. Élise explique toujours ce qu’elle observe avant de proposer une vérification.',
              'Choose what deserves your attention. Élise always explains what it observes before suggesting a check.',
            ])}
          </p>
        </div>
        <span className="alert-rules-count">
          <strong>
            {enabledCount}/{total}
          </strong>
          {t(['situations suivies', 'situations followed'])}
        </span>
      </header>

      {groups.map((group) => (
        <section className="rule-group" key={group.title[0]}>
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
            t(['Modifications non enregistrées', 'Unsaved changes'])
          ) : notice ? (
            <>
              <CircleCheck aria-hidden="true" /> {notice}
            </>
          ) : (
            t(['Tous les repères sont à jour.', 'Every landmark is up to date.'])
          )}
        </p>
        {dirty && (
          <button
            type="button"
            className="rule-reset"
            onClick={() => onChange(JSON.parse(saved) as AlertRuleSettings)}
          >
            {t(['Annuler', 'Undo'])}
          </button>
        )}
        <Button type="button" disabled={saving || !dirty} onClick={() => void save()}>
          {saving
            ? t(['Enregistrement…', 'Saving…'])
            : t(['Enregistrer les repères', 'Save landmarks'])}
        </Button>
      </div>
    </section>
  );
}
