/** Sent by the "View the screen" button in the demo: the demo shows its TV view in the same page. */
export const DEMO_SHOW_TV_EVENT = 'elise-demo-show-tv';

/**
 * Where "View the screen" leads. On an installation the resident screen has its own page; the
 * public demo has no such page, so it points to its own TV view and keeps the chosen language.
 */
export function residentScreenHref(
  mode: string = import.meta.env.MODE,
  base: string = import.meta.env.BASE_URL,
  search: string = window.location.search,
) {
  if (mode !== 'demo') return '/resident-screen';
  const params = new URLSearchParams({ vue: 'tv' });
  const lang = new URLSearchParams(search).get('lang');
  if (lang) params.set('lang', lang);
  return `${base}?${params.toString()}`;
}
