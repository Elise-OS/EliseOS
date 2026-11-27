/**
 * `?canicule=on` opens the demo during a heat episode: the heatwave mode is on, and the TV
 * weather of Lyon is the hot day the heatwave card announces (34 °C today, 35 °C tomorrow).
 */
export function demoHeatEpisode(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('canicule') === 'on'
  );
}

/** Weather of the TV during the demo heat episode, matching the heatwave demo forecast. */
export const HEAT_EPISODE_WEATHER = {
  temperature: 27,
  minimum: 21,
  maximum: 34,
  weatherCode: 0,
} as const;
