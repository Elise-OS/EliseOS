import {
  HEATWAVE_COOL_MARGIN,
  heatwaveSettingsSchema,
  type HeatwaveSettings,
} from '@elise/contracts';
import {
  Bell,
  CloudSun,
  GlassWater,
  House,
  Lightbulb,
  Minus,
  Plus,
  ThermometerSun,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { celsius, duration, heatwaveSummary } from './heatwave-text';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => onChange(clamp(Math.round(next / step) * step, min, max));
  return (
    <div className="heatwave-stepper" role="group" aria-label={label}>
      <span className="heatwave-stepper__label">{label}</span>
      <span className="heatwave-stepper__control">
        <button
          type="button"
          aria-label={t('heatwave.settings.less', { label })}
          disabled={disabled || value <= min}
          onClick={() => set(value - step)}
        >
          <Minus aria-hidden="true" />
        </button>
        <output aria-live="polite">{format(value)}</output>
        <button
          type="button"
          aria-label={t('heatwave.settings.more', { label })}
          disabled={disabled || value >= max}
          onClick={() => set(value + step)}
        >
          <Plus aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  enabled,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`heatwave-setting ${enabled ? 'is-on' : 'is-off'}`} aria-labelledby={id}>
      <span className="heatwave-setting__icon">
        <Icon aria-hidden="true" />
      </span>
      <div className="heatwave-setting__copy">
        <h4 id={id}>{title}</h4>
        <p>{hint}</p>
      </div>
      <button
        type="button"
        className={`config-toggle-btn ${enabled ? 'is-on' : ''}`}
        role="switch"
        aria-checked={enabled}
        aria-label={title}
        onClick={() => onToggle(!enabled)}
      >
        <span className="config-toggle-handle" />
      </button>
      {children && <div className="heatwave-setting__controls">{children}</div>}
    </section>
  );
}

const hours = Array.from({ length: 24 }, (_, hour) => hour);

/** Modern settings window of the heatwave mode, with a human summary of the choices. */
export function HeatwaveSettingsDialog({
  settings: initial,
  onClose,
  onSave,
}: {
  settings: HeatwaveSettings;
  onClose: () => void;
  onSave: (settings: HeatwaveSettings) => Promise<void>;
}) {
  const [settings, setSettings] = useState<HeatwaveSettings>(() => structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const update = (change: (draft: HeatwaveSettings) => void) =>
    setSettings((current) => {
      const draft = structuredClone(current);
      change(draft);
      return draft;
    });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), a[href], input:not([disabled])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose, saving]);

  const valid = heatwaveSettingsSchema.safeParse(settings).success;
  const reminders = settings.reminders;

  return (
    <div
      className="heatwave-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        ref={dialogRef}
        className="heatwave-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setSaving(true);
          setError('');
          void onSave(settings)
            .catch(() => setError(t('heatwave.settings.error')))
            .finally(() => setSaving(false));
        }}
      >
        <header className="heatwave-dialog__header">
          <span className="heatwave-dialog__icon">
            <ThermometerSun aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId}>{t('heatwave.settings.title')}</h2>
            <p>{t('heatwave.settings.intro')}</p>
          </div>
          <button
            type="button"
            className="heatwave-dialog__close"
            aria-label={t('heatwave.settings.close')}
            disabled={saving}
            onClick={onClose}
            data-autofocus
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="heatwave-dialog__body">
          <h3 className="heatwave-dialog__group">{t('heatwave.settings.triggersHeading')}</h3>
          <Section
            icon={House}
            title={t('heatwave.settings.indoorTitle')}
            hint={t('heatwave.settings.indoorHint')}
            enabled={settings.indoorTrigger.enabled}
            onToggle={(enabled) => update((draft) => void (draft.indoorTrigger.enabled = enabled))}
          >
            <Stepper
              label={t('heatwave.settings.threshold')}
              value={settings.indoorTrigger.celsius}
              min={24}
              max={40}
              step={0.5}
              format={(value) => `${celsius(value)} °C`}
              disabled={!settings.indoorTrigger.enabled}
              onChange={(value) => update((draft) => void (draft.indoorTrigger.celsius = value))}
            />
            <Stepper
              label={t('heatwave.settings.during')}
              value={settings.indoorTrigger.minutes}
              min={10}
              max={240}
              step={10}
              format={duration}
              disabled={!settings.indoorTrigger.enabled}
              onChange={(value) => update((draft) => void (draft.indoorTrigger.minutes = value))}
            />
          </Section>
          <Section
            icon={CloudSun}
            title={t('heatwave.settings.forecastTitle')}
            hint={t('heatwave.settings.forecastHint')}
            enabled={settings.forecastTrigger.enabled}
            onToggle={(enabled) =>
              update((draft) => void (draft.forecastTrigger.enabled = enabled))
            }
          >
            <Stepper
              label={t('heatwave.settings.forecastThreshold')}
              value={settings.forecastTrigger.celsius}
              min={25}
              max={45}
              step={1}
              format={(value) => `${celsius(value)} °C`}
              disabled={!settings.forecastTrigger.enabled}
              onChange={(value) => update((draft) => void (draft.forecastTrigger.celsius = value))}
            />
          </Section>
          <p className="heatwave-dialog__note">
            {t('heatwave.settings.offNote', {
              celsius: celsius(settings.indoorTrigger.celsius - HEATWAVE_COOL_MARGIN),
            })}
          </p>

          <h3 className="heatwave-dialog__group">{t('heatwave.settings.tvHeading')}</h3>
          <Section
            icon={GlassWater}
            title={t('heatwave.settings.remindersTitle')}
            hint={t('heatwave.settings.remindersHint')}
            enabled={reminders.enabled}
            onToggle={(enabled) => update((draft) => void (draft.reminders.enabled = enabled))}
          >
            <div
              className="heatwave-segmented"
              role="radiogroup"
              aria-label={t('heatwave.settings.frequency')}
            >
              <span className="heatwave-stepper__label">{t('heatwave.settings.frequency')}</span>
              <span className="heatwave-segmented__options">
                {([1, 2, 3] as const).map((every) => (
                  <button
                    key={every}
                    type="button"
                    role="radio"
                    aria-checked={reminders.everyHours === every}
                    disabled={!reminders.enabled}
                    onClick={() => update((draft) => void (draft.reminders.everyHours = every))}
                  >
                    {t('heatwave.settings.everyHours', { count: every })}
                  </button>
                ))}
              </span>
            </div>
            <div className="heatwave-range">
              <label>
                <span className="heatwave-stepper__label">{t('heatwave.settings.from')}</span>
                <select
                  value={reminders.startHour}
                  disabled={!reminders.enabled}
                  onChange={(event) =>
                    update((draft) => {
                      draft.reminders.startHour = Number(event.target.value);
                      if (draft.reminders.endHour <= draft.reminders.startHour)
                        draft.reminders.endHour = Math.min(23, draft.reminders.startHour + 1);
                    })
                  }
                >
                  {hours.slice(0, 23).map((hour) => (
                    <option key={hour} value={hour}>
                      {t('heatwave.settings.hour', { hour })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="heatwave-stepper__label">{t('heatwave.settings.to')}</span>
                <select
                  value={reminders.endHour}
                  disabled={!reminders.enabled}
                  onChange={(event) =>
                    update((draft) => void (draft.reminders.endHour = Number(event.target.value)))
                  }
                >
                  {hours
                    .filter((hour) => hour > reminders.startHour)
                    .map((hour) => (
                      <option key={hour} value={hour}>
                        {t('heatwave.settings.hour', { hour })}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </Section>
          <Section
            icon={Lightbulb}
            title={t('heatwave.settings.tipsTitle')}
            hint={t('heatwave.settings.tipsHint')}
            enabled={settings.tips.enabled}
            onToggle={(enabled) => update((draft) => void (draft.tips.enabled = enabled))}
          />

          <h3 className="heatwave-dialog__group">{t('heatwave.settings.familyHeading')}</h3>
          <Section
            icon={Bell}
            title={t('heatwave.settings.alertTitle')}
            hint={t('heatwave.settings.alertHint')}
            enabled={settings.alert.enabled}
            onToggle={(enabled) => update((draft) => void (draft.alert.enabled = enabled))}
          >
            <Stepper
              label={t('heatwave.settings.threshold')}
              value={settings.alert.celsius}
              min={26}
              max={40}
              step={0.5}
              format={(value) => `${celsius(value)} °C`}
              disabled={!settings.alert.enabled}
              onChange={(value) => update((draft) => void (draft.alert.celsius = value))}
            />
            <Stepper
              label={t('heatwave.settings.during')}
              value={settings.alert.minutes}
              min={15}
              max={360}
              step={15}
              format={duration}
              disabled={!settings.alert.enabled}
              onChange={(value) => update((draft) => void (draft.alert.minutes = value))}
            />
          </Section>

          <div className="heatwave-summary" aria-live="polite">
            <strong>{t('heatwave.settings.summaryTitle')}</strong>
            {heatwaveSummary(settings).map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
          <p className="heatwave-dialog__note">{t('heatwave.notMedical')}</p>
        </div>

        {error && (
          <p className="heatwave-dialog__error" role="alert">
            {error}
          </p>
        )}
        <footer className="heatwave-dialog__footer">
          <button
            type="button"
            className="heatwave-button heatwave-button--quiet"
            disabled={saving}
            onClick={onClose}
          >
            {t('heatwave.settings.cancel')}
          </button>
          <button
            type="submit"
            className="heatwave-button heatwave-button--primary"
            disabled={saving || !valid}
          >
            {saving ? t('heatwave.settings.saving') : t('heatwave.settings.save')}
          </button>
        </footer>
      </form>
    </div>
  );
}
