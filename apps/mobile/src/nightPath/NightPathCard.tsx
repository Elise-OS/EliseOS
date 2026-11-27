import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MoonStar } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MobileApiError, mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import { colors } from '../theme';
import { nightPathCardText } from './night-path-view';
import { NightPathSheet, nightPathsQueryKey } from './NightPathSheet';

/**
 * « Chemin lumineux » card of the home tab: what is set up, and the way into the sheet where
 * paths are listed, paused and edited. Hidden on a box too old to know night paths.
 */
export function NightPathCard({
  server,
  token,
  resident,
  canManage,
}: {
  server: SavedServer;
  token: string;
  resident: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const overview = useQuery({
    queryKey: nightPathsQueryKey(server),
    queryFn: () => mobileApi.nightPaths(server, token),
  });
  if (overview.error instanceof MobileApiError && overview.error.status === 404) return null;
  const text = nightPathCardText(overview.data, resident);
  const action = canManage ? t('nightPath.cardManage') : t('nightPath.cardView');
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('nightPath.title')}. ${text}`}
        accessibilityHint={action}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <MoonStar size={24} color="#9a6410" strokeWidth={2} />
        </View>
        <View style={styles.text}>
          <Text style={styles.eyebrow}>{t('nightPath.cardEyebrow').toUpperCase()}</Text>
          <Text style={styles.title}>{t('nightPath.title')}</Text>
          <Text style={styles.detail}>{text}</Text>
          <Text style={styles.action}>{action}</Text>
        </View>
        <ChevronRight size={20} color={colors.muted} />
      </Pressable>
      {open ? (
        <NightPathSheet
          server={server}
          token={token}
          resident={resident}
          canManage={canManage}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: colors.paper,
  },
  pressed: { opacity: 0.8 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fdf2df',
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { color: colors.accent, fontSize: 12, letterSpacing: 0.6, fontWeight: '900' },
  title: { color: colors.navy, fontFamily: 'Georgia', fontSize: 22 },
  detail: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  action: { marginTop: 4, color: colors.blue, fontSize: 14, fontWeight: '800' },
});
