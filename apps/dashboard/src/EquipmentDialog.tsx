import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './room-equipment.css';

export function EquipmentDialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
  sidePanel = false,
  closeLabel = 'Fermer',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  sidePanel?: boolean;
  closeLabel?: string;
}) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const busyRef = useRef(busy);
  close.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) close.current();
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? [],
      ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      const first = focusable[0],
        last = focusable.at(-1);
      if (!first) {
        event.preventDefault();
        root.current?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === root.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === root.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div
      className="equipment-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`equipment-dialog ${wide ? 'is-wide' : ''} ${sidePanel ? 'is-side-panel' : ''}`}
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="equipment-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="equipment-icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label={closeLabel}
          >
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
