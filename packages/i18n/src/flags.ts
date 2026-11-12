import type { Language } from './index.js';

/**
 * Flags shown next to each language, drawn the same way on the web (<svg>) and in the app
 * (react-native-svg). Shapes use a 640 × 480 box; renderers add the rounded frame.
 */
export interface FlagShape {
  kind: 'rect' | 'path';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  d?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export const FLAG_VIEWBOX = { width: 640, height: 480, radius: 40 } as const;

export const FLAGS: Record<Language, readonly FlagShape[]> = {
  fr: [
    { kind: 'rect', width: 640, height: 480, fill: '#fff' },
    { kind: 'path', fill: '#00267f', d: 'M0 0h213.3v480H0z' },
    { kind: 'path', fill: '#f31830', d: 'M426.7 0H640v480H426.7z' },
  ],
  // English is shown with the Union Jack, as on the dashboard until now.
  en: [
    { kind: 'rect', width: 640, height: 480, fill: '#012169' },
    { kind: 'path', stroke: '#fff', strokeWidth: 60, d: 'M0 0l640 480M0 480L640 0' },
    { kind: 'path', stroke: '#c8102e', strokeWidth: 36, d: 'M0 0l640 480M0 480L640 0' },
    { kind: 'path', stroke: '#fff', strokeWidth: 100, d: 'M320 0v480M0 240h640' },
    { kind: 'path', stroke: '#c8102e', strokeWidth: 60, d: 'M320 0v480M0 240h640' },
  ],
  // Red, yellow, red in 1:2:1 bands, without the coat of arms (too small to read at this size).
  es: [
    { kind: 'rect', width: 640, height: 480, fill: '#aa151b' },
    { kind: 'path', fill: '#f1bf00', d: 'M0 120h640v240H0z' },
  ],
  // Green, white, red in vertical 1:1:1 bands.
  it: [
    { kind: 'rect', width: 640, height: 480, fill: '#fff' },
    { kind: 'path', fill: '#009246', d: 'M0 0h213.3v480H0z' },
    { kind: 'path', fill: '#ce2b37', d: 'M426.7 0H640v480H426.7z' },
  ],
  // Green and red in 2:3 bands, with a simplified coat of arms on the boundary: yellow
  // sphere, red shield, white inner shield with the five blue quinas (readable when small).
  pt: [
    { kind: 'rect', width: 640, height: 480, fill: '#da291c' },
    { kind: 'path', fill: '#046a38', d: 'M0 0h256v480H0z' },
    { kind: 'path', fill: '#ffe000', d: 'M152 240a104 104 0 1 0 208 0a104 104 0 1 0 -208 0z' },
    { kind: 'path', fill: '#da291c', d: 'M200 172h112v74a56 56 0 0 1 -112 0z' },
    { kind: 'path', fill: '#fff', d: 'M216 188h80v58a40 40 0 0 1 -80 0z' },
    {
      kind: 'path',
      fill: '#003399',
      d: 'M247 198h18v18h-18zM247 222h18v18h-18zM247 246h18v18h-18zM223 222h18v18h-18zM271 222h18v18h-18z',
    },
  ],
};
