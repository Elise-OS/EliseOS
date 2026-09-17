import type { PlanRoom } from '@michel/contracts';
import { ArrowRight, Check, Link2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { roomIcon } from './home-visuals';

export function ConnectionConfirmation({
  source,
  target,
  onCancel,
  onConfirm,
}: {
  source: PlanRoom;
  target: PlanRoom;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const SourceIcon = roomIcon(source);
  const TargetIcon = roomIcon(target);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="connection-confirmation"
      aria-labelledby="connection-title"
      aria-describedby="connection-description"
      onCancel={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="connection-confirmation-content">
        <button type="button" className="connection-close" aria-label="Fermer" onClick={onCancel}>
          <X size={20} />
        </button>
        <span className="connection-confirmation-icon">
          <Link2 size={26} />
        </span>
        <span className="connection-eyebrow">VOTRE LOGEMENT</span>
        <h2 id="connection-title">Ces pièces communiquent ?</h2>
        <p id="connection-description">
          Confirmez qu’on peut passer directement de l’une à l’autre.
        </p>
        <div className="connection-room-pair">
          <div>
            <span className="connection-room-icon" style={{ background: source.geometry.color }}>
              <SourceIcon aria-hidden="true" />
            </span>
            <strong>{source.name}</strong>
          </div>
          <span className="connection-room-bridge">
            <Link2 size={22} />
          </span>
          <div>
            <span className="connection-room-icon" style={{ background: target.geometry.color }}>
              <TargetIcon aria-hidden="true" />
            </span>
            <strong>{target.name}</strong>
          </div>
        </div>
        <p className="connection-explanation">
          <Check size={16} /> Élise comprendra mieux les déplacements dans votre logement.
        </p>
        <footer>
          <button type="button" className="connection-cancel" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="connection-confirm" onClick={onConfirm}>
            Oui, relier ces pièces <ArrowRight size={17} />
          </button>
        </footer>
      </div>
    </dialog>
  );
}
