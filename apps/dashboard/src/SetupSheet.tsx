import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Info, X } from 'lucide-react';
import { useDialogFocusTrap } from './EquipmentDialog';
import { t } from './i18n';
import './sensor-setup.css';

type SheetContext = {
  titleId: string;
  close: () => void;
  busy: boolean;
  closeLabel: string;
  setStepBusy: (busy: boolean) => void;
  closeOverride: MutableRefObject<(() => void) | null>;
};
const SheetContext = createContext<SheetContext | null>(null);

/**
 * Full-height guided sheet: one page at a time, a back button, a progress bar and
 * a footer that stays in reach. On a phone it opens as a bottom sheet.
 */
export function SetupSheet({
  onClose,
  busy = false,
  closeLabel = t('sensorSetup.close'),
  children,
}: {
  onClose: () => void;
  busy?: boolean;
  closeLabel?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const closeOverride = useRef<(() => void) | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const close = useCallback(() => (closeOverride.current ?? latestClose.current)(), []);
  const anyBusy = busy || stepBusy;
  useDialogFocusTrap(root, close, anyBusy);
  return createPortal(
    <div
      className="ss-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !anyBusy) close();
      }}
    >
      <div
        className="ss-sheet"
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={anyBusy || undefined}
      >
        <SheetContext.Provider
          value={{ titleId, close, busy: anyBusy, closeLabel, setStepBusy, closeOverride }}
        >
          {children}
        </SheetContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Lets the page shown in the sheet hold it while it works and decide what closing
 * means (for example cancelling a sensor search before leaving).
 */
export function useSheetControls({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  const sheet = useContext(SheetContext);
  const latest = useRef(onClose);
  latest.current = onClose;
  const setStepBusy = sheet?.setStepBusy;
  const closeOverride = sheet?.closeOverride;
  useEffect(() => {
    setStepBusy?.(busy);
  }, [busy, setStepBusy]);
  useEffect(() => {
    if (!closeOverride) return;
    closeOverride.current = () => latest.current();
    return () => {
      closeOverride.current = null;
      setStepBusy?.(false);
    };
  }, [closeOverride, setStepBusy]);
}

export type SetupDirection = 'forward' | 'back';

/** Remembers which way the visitor last moved, so pages slide in from the right side. */
export function useSetupStep<T>(initial: T) {
  const [state, setState] = useState<{ step: T; direction: SetupDirection }>({
    step: initial,
    direction: 'forward',
  });
  return {
    step: state.step,
    direction: state.direction,
    go: (step: T) => setState({ step, direction: 'forward' }),
    back: (step: T) => setState({ step, direction: 'back' }),
    reset: (step: T) => setState({ step, direction: 'forward' }),
  };
}

export function SetupPage({
  pageKey,
  direction = 'forward',
  progress,
  eyebrow,
  title,
  subtitle,
  hero,
  onBack,
  backLabel,
  footer,
  centered = false,
  children,
}: {
  pageKey: string;
  direction?: SetupDirection;
  progress?: { value: number; total: number; label?: string | undefined } | undefined;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  hero?: ReactNode;
  onBack?: (() => void) | undefined;
  backLabel?: string | undefined;
  footer?: ReactNode;
  centered?: boolean;
  children?: ReactNode;
}) {
  const sheet = useContext(SheetContext);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Screen readers announce each new page as the visitor moves through the flow.
    heading.current?.focus({ preventScroll: true });
  }, [pageKey]);
  if (!sheet) throw new Error('SetupPage must be rendered inside SetupSheet');
  const ratio = progress ? Math.min(1, Math.max(0, progress.value / progress.total)) : 0;
  return (
    <>
      <header className="ss-header">
        <div className="ss-header-side">
          {onBack && (
            <button type="button" className="ss-nav-button" onClick={onBack} disabled={sheet.busy}>
              <ChevronLeft aria-hidden />
              <span>{backLabel ?? t('sensorSetup.back')}</span>
            </button>
          )}
        </div>
        {progress && (
          <span className="ss-header-step" aria-live="polite">
            {progress.label ??
              t('sensorSetup.stepOf', { value: progress.value, total: progress.total })}
          </span>
        )}
        <div className="ss-header-side is-end">
          <button
            type="button"
            className="ss-close"
            onClick={sheet.close}
            disabled={sheet.busy}
            aria-label={sheet.closeLabel}
          >
            <X aria-hidden />
          </button>
        </div>
      </header>
      <div
        className="ss-progress"
        role="progressbar"
        aria-label={t('sensorSetup.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        hidden={!progress}
      >
        <span style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <div
        className={`ss-body ${centered ? 'is-centered' : ''}`}
        data-direction={direction}
        key={pageKey}
      >
        {hero}
        <div className="ss-titles">
          {eyebrow && <span className="ss-eyebrow">{eyebrow}</span>}
          <h2 id={sheet.titleId} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </div>
      {footer && <footer className="ss-footer">{footer}</footer>}
    </>
  );
}

export function SetupSection({
  title,
  aside,
  children,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ss-section">
      {(title || aside) && (
        <header>
          {title && <h3>{title}</h3>}
          {aside && <span>{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A large tappable card: rooms, sensor kinds. */
export function SetupTile({
  icon,
  tint,
  title,
  detail,
  badge,
  onSelect,
  disabled,
}: {
  icon: ReactNode;
  tint?: string | undefined;
  title: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="ss-tile" onClick={onSelect} disabled={disabled}>
      <span className="ss-tile-icon" style={tint ? { background: tint } : undefined}>
        {icon}
      </span>
      <span className="ss-tile-text">
        <strong>
          {title}
          {badge && <span className="ss-tile-badge">{badge}</span>}
        </strong>
        {detail && <small>{detail}</small>}
      </span>
      <ChevronRight className="ss-tile-chevron" aria-hidden />
    </button>
  );
}

/** Rows of an inset grouped list, iOS style. */
export function SetupList({ children }: { children: ReactNode }) {
  return <div className="ss-list">{children}</div>;
}

export function SetupRow({
  icon,
  title,
  detail,
  trailing,
  onSelect,
  tone,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onSelect?: () => void;
  tone?: 'accent';
}) {
  const content = (
    <>
      {icon && <span className="ss-row-icon">{icon}</span>}
      <span className="ss-row-text">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      {trailing ?? (onSelect ? <ChevronRight className="ss-row-chevron" aria-hidden /> : null)}
    </>
  );
  return onSelect ? (
    <button
      type="button"
      className={`ss-row ${tone === 'accent' ? 'is-accent' : ''}`}
      onClick={onSelect}
    >
      {content}
    </button>
  ) : (
    <div className="ss-row">{content}</div>
  );
}

/** Mutually exclusive options shown side by side. */
export function SetupSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      className="ss-segmented"
      role="radiogroup"
      aria-label={label}
      style={{ '--ss-count': options.length, '--ss-index': index } as CSSProperties}
    >
      <span className="ss-segmented-thumb" aria-hidden />
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={option.value === value}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A grid of choices with an icon each, one of them selected. */
export function SetupChoices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: Array<{ value: T; label: string; icon: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="ss-choices" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={option.value === value}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          <span className="ss-choice-icon">{option.icon}</span>
          <span>{option.label}</span>
          {option.value === value && <Check className="ss-choice-check" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

export function SetupField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="ss-field">
      <span className="ss-field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function SetupNotice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  children: ReactNode;
}) {
  const Icon = tone === 'info' ? Info : tone === 'success' ? Check : AlertTriangle;
  return (
    <div className={`ss-notice is-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div>
        {title && <strong>{title}</strong>}
        <p>{children}</p>
      </div>
    </div>
  );
}
