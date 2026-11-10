import { describe, expect, it } from 'vitest';
import { residentScreenHref } from './resident-screen-link';

describe('residentScreenHref', () => {
  it('keeps the resident screen page on an installation', () => {
    expect(residentScreenHref('production', '/', '?lang=en')).toBe('/resident-screen');
  });

  it('points to the TV view of the demo under its base', () => {
    expect(residentScreenHref('demo', '/demo/', '')).toBe('/demo/?vue=tv');
  });

  it('keeps the language chosen in the demo address', () => {
    expect(residentScreenHref('demo', '/demo/', '?lang=en&vue=aidant')).toBe(
      '/demo/?vue=tv&lang=en',
    );
  });
});
