import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Locale } from './MobileSetup';
import { colors as themeColors } from '../theme';
import { t } from '../i18n';
import { habitLabel, relationLabel } from './labels';

type IconName = ComponentProps<typeof Ionicons>['name'];

const colors = { ...themeColors, amber: '#B7742F' };

function Section({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={18} color={colors.green} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export function SetupSummary({
  caregiver,
  resident,
  habits,
  remoteReady,
}: {
  locale: Locale;
  caregiver: { name: string; relation: string; username: string };
  resident: { dailyName: string; fullName: string };
  habits: Record<string, { from: string; to: string; unknown: boolean }>;
  remoteReady: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Section icon="person-outline" title={t('setupSummary.you')}>
        <Text style={styles.primary}>{caregiver.name}</Text>
        <Text style={styles.secondary}>
          {relationLabel(caregiver.relation)} · {caregiver.username}
        </Text>
      </Section>
      <Section icon="heart-outline" title={t('setupSummary.thePersonSupported')}>
        <Text style={styles.primary}>{resident.dailyName}</Text>
        <Text style={styles.secondary}>{resident.fullName}</Text>
      </Section>
      <Section icon="sunny-outline" title={t('setupSummary.firstRoutines')}>
        {Object.entries(habits).map(([name, habit]) => (
          <View key={name} style={styles.habit}>
            <Text style={styles.habitName}>{habitLabel(name)}</Text>
            <Text style={[styles.habitValue, habit.unknown && styles.habitLearn]}>
              {habit.unknown ? t('setupSummary.eliseWillLearn') : `${habit.from} – ${habit.to}`}
            </Text>
          </View>
        ))}
      </Section>
      <Section icon="shield-checkmark-outline" title={t('setupSummary.remoteAccess')}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, !remoteReady && styles.badgeLater]}>
            <Text style={[styles.badgeText, !remoteReady && styles.badgeTextLater]}>
              {remoteReady ? t('setupSummary.on') : t('setupSummary.toTurnOnLater')}
            </Text>
          </View>
        </View>
      </Section>
      <Text style={styles.note}>{t('setupSummary.everythingCanBeChangedLater')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 20 },
  section: {
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: 6,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { color: colors.muted, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  primary: { color: colors.navy, fontSize: 19, fontWeight: '700' },
  secondary: { color: colors.muted, fontSize: 16 },
  habit: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  habitName: { color: colors.navy, fontSize: 17 },
  habitValue: {
    color: colors.navy,
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  habitLearn: { color: colors.muted, fontWeight: '500', fontStyle: 'italic' },
  badgeRow: { flexDirection: 'row' },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: colors.greenSoft,
  },
  badgeLater: { backgroundColor: '#FBF0E3' },
  badgeText: { color: colors.green, fontWeight: '700', fontSize: 16 },
  badgeTextLater: { color: colors.amber },
  note: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 4 },
});
