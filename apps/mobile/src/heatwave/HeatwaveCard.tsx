import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ThermometerSun } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MobileApiError, mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import { colors } from '../theme';
import {
  heatwaveFacts,
  heatwaveStateText,
  heatwaveStatusLabel,
  heatwaveTone,
} from './heatwave-view';
import { HeatwaveSheet, heatwaveQueryKey } from './HeatwaveSheet';

/**
 * « Mode canicule » card of the home tab: state of the mode, warmest room of the day and the
 * drink reminders, and the way into the sheet. Hidden on a box too old to know the mode.
 */
export function HeatwaveCard({ server, token }: { server: SavedServer; token: string }) {
  const [open, setOpen] = useState(false);
  const status = useQuery({
    queryKey: heatwaveQueryKey(server),
    queryFn: () => mobileApi.heatwave(server, token),
    refetchInterval: 60_000,
  });
  if (status.error instanceof MobileApiError && status.error.status === 404) return null;
  if (!status.data) return null;
  const data = status.data;
  const tone = heatwaveTone(data);
  const facts = heatwaveFacts(data);
  const indoor = facts.find(({ key }) => key === 'indoor');
  const reminders = facts.find(({ key }) => key === 'reminders');
  const text = heatwaveStateText(data);
  const action = data.canManage ? t('heatwave.card.cardManage') : t('heatwave.card.cardOpen');
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('heatwave.card.title')}, ${heatwaveStatusLabel(data)}. ${text}`}
        accessibilityHint={action}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.card,
          tone === 'active' && styles.cardActive,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.icon, tone === 'active' && styles.iconActive]}>
          <ThermometerSun size={24} color={tone === 'active' ? '#9a5d1d' : colors.accent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.eyebrow}>{t('heatwave.card.cardEyebrow').toUpperCase()}</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('heatwave.card.title')}</Text>
            <Text
              style={[
                styles.pill,
                tone === 'active' && styles.pillActive,
                tone === 'paused' && styles.pillPaused,
              ]}
            >
              {heatwaveStatusLabel(data)}
            </Text>
          </View>
          <Text style={styles.detail}>{text}</Text>
          {tone === 'active'
            ? [indoor, reminders].map((fact) =>
                fact ? (
                  <Text key={fact.key} style={styles.facts}>
                    <Text style={styles.factLabel}>{fact.label}</Text>
                    {`  ${fact.value}`}
                  </Text>
                ) : null,
              )
            : null}
          <Text style={styles.action}>{action}</Text>
        </View>
        <ChevronRight size={20} color={colors.muted} />
      </Pressable>
      {open ? <HeatwaveSheet server={server} token={token} onClose={() => setOpen(false)} /> : null}
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
  cardActive: { borderColor: '#ecd2ad', backgroundColor: '#fff8ee' },
  pressed: { opacity: 0.8 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  iconActive: { backgroundColor: colors.paleAmber },
  text: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { color: colors.accent, fontSize: 12, letterSpacing: 0.6, fontWeight: '900' },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { color: colors.navy, fontFamily: 'Georgia', fontSize: 22 },
  pill: {
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.paleBlue,
    color: colors.blue,
    fontSize: 12,
    fontWeight: '800',
  },
  pillActive: { backgroundColor: colors.paleAmber, color: '#7a4a14' },
  pillPaused: { backgroundColor: '#eef0f2', color: colors.muted },
  detail: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  facts: { color: colors.navy, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  factLabel: { color: colors.muted, fontWeight: '500' },
  action: { marginTop: 4, color: colors.blue, fontSize: 14, fontWeight: '800' },
});
