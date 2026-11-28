import {
  buildWeeklyDigestPdf,
  weeklyDigestPdfName,
  type WeeklyDigestLanguage,
} from '@elise/contracts';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { demoWeeklyDigest, isDemoServer } from '../demo/mock-api';
import { preferredServerUrls } from '../discovery/helpers';
import type { SavedServer } from '../discovery/types';
import { toBase64, weeklyDigestPdfPath } from './weekly-digest-view';

/**
 * Exports the PDF of a week. On a phone it opens the share sheet (mail, messages, files…);
 * in the web version of the app it downloads the file. The PDF is made on the box; in the demo,
 * which has no box, it is drawn on the phone with the same code.
 */
export async function shareWeeklyDigestPdf(options: {
  server: SavedServer;
  token: string;
  weekStart: string;
  language: WeeklyDigestLanguage;
  dialogTitle: string;
}): Promise<'shared' | 'downloaded'> {
  const { server, token, weekStart, language } = options;
  const name = weeklyDigestPdfName(weekStart, language);
  let bytes: Uint8Array | null = null;
  if (isDemoServer(server)) {
    const digest = demoWeeklyDigest(weekStart);
    if (!digest) throw new Error('Weekly digest not found');
    const { jsPDF } = await import('jspdf');
    bytes = buildWeeklyDigestPdf((settings) => new jsPDF(settings), digest, {
      language,
      personName: 'Jeanne Martin',
    });
  }
  const headers = { authorization: `Bearer ${token}`, 'x-elise-locale': language };

  if (Platform.OS === 'web') {
    if (!bytes) {
      let response: Response | null = null;
      for (const base of preferredServerUrls(server)) {
        try {
          response = await fetch(`${base}${weeklyDigestPdfPath(weekStart, language)}`, { headers });
          if (response.ok) break;
        } catch {
          response = null;
        }
      }
      if (!response?.ok) throw new Error('PDF unavailable');
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
    return 'downloaded';
  }

  const target = `${FileSystem.cacheDirectory ?? ''}${name}`;
  if (bytes) {
    await FileSystem.writeAsStringAsync(target, toBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else {
    let saved = false;
    for (const base of preferredServerUrls(server)) {
      try {
        const result = await FileSystem.downloadAsync(
          `${base}${weeklyDigestPdfPath(weekStart, language)}`,
          target,
          { headers },
        );
        if (result.status === 200) {
          saved = true;
          break;
        }
      } catch {
        // Try the next address of the box (local, then remote).
      }
    }
    if (!saved) throw new Error('PDF unavailable');
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable');
  await Sharing.shareAsync(target, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: options.dialogTitle,
  });
  return 'shared';
}
