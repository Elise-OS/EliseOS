import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuidedTour, guidedTourSteps } from './GuidedTour';
import { inLanguage } from './i18n/test-language';

describe('Élise guided tour', () => {
  it('covers every visible sidebar destination in order', () => {
    expect(guidedTourSteps.map(({ navIndex }) => navIndex)).toEqual([0, 1, 2, 3, 7, 8]);
    expect(guidedTourSteps).toHaveLength(6);
    expect(guidedTourSteps.some(({ navIndex }) => navIndex === 5 || navIndex === 6)).toBe(false);
  });

  it('renders accessible French and English copy', () => {
    const french = renderToStaticMarkup(
      <GuidedTour
        locale="fr"
        mode="initial"
        onTargetChange={() => undefined}
        onComplete={() => undefined}
        onSkip={() => undefined}
      />,
    );
    const english = inLanguage('en', () =>
      renderToStaticMarkup(
        <GuidedTour
          locale="en"
          mode="replay"
          onTargetChange={() => undefined}
          onComplete={() => undefined}
          onSkip={() => undefined}
        />,
      ),
    );

    expect(french).toContain('Visite guidée');
    expect(french).toContain('Votre point de repère');
    expect(french).toContain('Passer la visite');
    expect(english).toContain('Guided tour');
    expect(english).toContain('Your starting point');
    expect(english).toContain('Skip tour');
  });

  it('ships translated content for every step', () => {
    for (const step of guidedTourSteps) {
      expect(step.title()).toBeTruthy();
      expect(step.description()).toBeTruthy();
    }
  });
});
