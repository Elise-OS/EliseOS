import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Locale } from './i18n';

export type GuidedTourMode = 'initial' | 'replay';

export interface GuidedTourStep {
  navIndex: number;
  title: { fr: string; en: string };
  description: { fr: string; en: string };
}

export const guidedTourSteps: readonly GuidedTourStep[] = [
  {
    navIndex: 0,
    title: { fr: 'Votre point de repère', en: 'Your starting point' },
    description: {
      fr: 'Accueil résume la situation du jour, les informations essentielles et ce qui mérite votre attention.',
      en: 'Home summarises the day, the essential information and anything that needs your attention.',
    },
  },
  {
    navIndex: 1,
    title: { fr: 'Comprendre le quotidien', en: 'Understand daily life' },
    description: {
      fr: 'Activité rassemble les événements détectés et permet de suivre le rythme du domicile, pièce par pièce.',
      en: 'Activity brings detected events together so you can follow the home rhythm, room by room.',
    },
  },
  {
    navIndex: 2,
    title: { fr: 'Agir quand c’est utile', en: 'Act when it matters' },
    description: {
      fr: 'Alertes explique chaque situation inhabituelle et vous guide vers l’action la plus adaptée.',
      en: 'Alerts explains unusual situations and guides you towards the most appropriate action.',
    },
  },
  {
    navIndex: 3,
    title: { fr: 'Représenter le lieu de vie', en: 'Map the living space' },
    description: {
      fr: 'Mon logement permet de créer les pièces, organiser les niveaux et placer les équipements. C’est votre prochaine étape.',
      en: 'My home lets you create rooms, organise floors and place devices. This is your next step.',
    },
  },
  {
    navIndex: 7,
    title: { fr: 'Entourer la personne', en: 'Build the support circle' },
    description: {
      fr: 'Proches réunit les personnes de confiance, leurs coordonnées et leurs droits d’accès.',
      en: 'People brings trusted contacts, their details and access rights together.',
    },
  },
  {
    navIndex: 8,
    title: { fr: 'Adapter Élise à vos besoins', en: 'Adapt Élise to your needs' },
    description: {
      fr: 'Réglages permet d’ajuster la langue, les règles de vigilance et de revoir cette visite à tout moment.',
      en: 'Settings lets you adjust the language, safety rules and replay this tour at any time.',
    },
  },
] as const;

interface TargetRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export function GuidedTour({
  locale,
  mode,
  onTargetChange,
  onComplete,
  onSkip,
}: {
  locale: Locale;
  mode: GuidedTourMode;
  onTargetChange: (navIndex: number) => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<TargetRect | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const step = guidedTourSteps[index]!;
  const english = locale === 'en';

  useEffect(() => {
    onTargetChange(step.navIndex);
  }, [onTargetChange, step.navIndex]);

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(
          `[data-tour-target="nav-${step.navIndex}"]`,
        );
        if (!element) return setTarget(null);
        const rect = element.getBoundingClientRect();
        setTarget({
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      });
    };
    measure();
    const settleTimer = window.setTimeout(measure, 320);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step.navIndex]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onSkip]);

  const padding = 8;
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const cardLeft = target ? Math.min(target.right + 24, viewportWidth - 420) : 290;
  const cardTop = target ? Math.max(24, Math.min(target.top - 12, viewportHeight - 330)) : 80;
  const style = {
    '--tour-left': `${Math.max(20, cardLeft)}px`,
    '--tour-top': `${cardTop}px`,
  } as CSSProperties;

  const shades = target
    ? [
        { top: 0, left: 0, width: viewportWidth, height: Math.max(0, target.top - padding) },
        {
          top: target.top - padding,
          left: 0,
          width: Math.max(0, target.left - padding),
          height: target.height + padding * 2,
        },
        {
          top: target.top - padding,
          left: target.right + padding,
          width: Math.max(0, viewportWidth - target.right - padding),
          height: target.height + padding * 2,
        },
        {
          top: target.bottom + padding,
          left: 0,
          width: viewportWidth,
          height: Math.max(0, viewportHeight - target.bottom - padding),
        },
      ]
    : [{ top: 0, left: 0, width: viewportWidth, height: viewportHeight }];

  return (
    <div className="guided-tour" style={style}>
      {shades.map((shade, shadeIndex) => (
        <div className="guided-tour-shade" style={shade} key={shadeIndex} />
      ))}
      {target && (
        <div
          className="guided-tour-highlight"
          style={{
            top: target.top - padding,
            left: target.left - padding,
            width: target.width + padding * 2,
            height: target.height + padding * 2,
          }}
        />
      )}
      <section
        className="guided-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
      >
        <button
          type="button"
          className="guided-tour-close"
          onClick={onSkip}
          aria-label={english ? 'Skip the tour' : 'Passer la visite'}
        >
          <X />
        </button>
        <span className="guided-tour-eyebrow">
          {english ? 'Guided tour' : 'Visite guidée'} · {index + 1}/{guidedTourSteps.length}
        </span>
        <h2 id="guided-tour-title" ref={titleRef} tabIndex={-1}>
          {step.title[locale]}
        </h2>
        <p>{step.description[locale]}</p>
        <div className="guided-tour-dots" aria-hidden="true">
          {guidedTourSteps.map((item, dotIndex) => (
            <i className={dotIndex === index ? 'is-active' : ''} key={item.navIndex} />
          ))}
        </div>
        <footer className="guided-tour-actions">
          <button type="button" className="guided-tour-skip" onClick={onSkip}>
            {english ? 'Skip tour' : 'Passer la visite'}
          </button>
          <div>
            <button
              type="button"
              className="guided-tour-back"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
            >
              <ArrowLeft /> {english ? 'Back' : 'Précédent'}
            </button>
            <button
              type="button"
              className="guided-tour-next"
              onClick={() =>
                index === guidedTourSteps.length - 1
                  ? onComplete()
                  : setIndex((current) => current + 1)
              }
            >
              {index === guidedTourSteps.length - 1
                ? mode === 'initial'
                  ? english
                    ? 'Create my home'
                    : 'Créer mon logement'
                  : english
                    ? 'Finish'
                    : 'Terminer'
                : english
                  ? 'Next'
                  : 'Suivant'}
              <ArrowRight />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
