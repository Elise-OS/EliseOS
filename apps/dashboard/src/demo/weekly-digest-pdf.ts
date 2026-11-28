import { buildWeeklyDigestPdf, weeklyDigestLanguage } from '@elise/contracts';
import { demoWeeklyDigest } from './router';

/** The PDF of a demo week, drawn with jsPDF in the visitor's browser (loaded only when asked). */
export async function demoWeeklyDigestPdf(
  week: string | null,
  lang: string | null,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const digest = demoWeeklyDigest(week);
  if (!digest) return null;
  const { jsPDF } = await import('jspdf');
  const bytes = buildWeeklyDigestPdf((options) => new jsPDF(options), digest, {
    language: weeklyDigestLanguage(lang),
    personName: 'Jeanne Martin',
  });
  return new Uint8Array(bytes);
}
