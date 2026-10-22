import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Locale } from './MobileSetup';

type IconName = ComponentProps<typeof Ionicons>['name'];

const colors = {
  navy: '#0B2948',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  greenSoft: '#E7F1EB',
  amber: '#B7742F',
};

const habitNames: Record<string, string> = {
  Lever: 'Wake up',
  Coucher: 'Bedtime',
  Déjeuner: 'Lunch',
  Dîner: 'Dinner',
};

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
  locale,
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
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);
  return (
    <View style={styles.wrap}>
      <Section icon="person-outline" title={tr('Vous', 'You')}>
        <Text style={styles.primary}>{caregiver.name}</Text>
        <Text style={styles.secondary}>
          {caregiver.relation} · {caregiver.username}
        </Text>
      </Section>
      <Section icon="heart-outline" title={tr('La personne accompagnée', 'The person supported')}>
        <Text style={styles.primary}>{resident.dailyName}</Text>
        <Text style={styles.secondary}>{resident.fullName}</Text>
      </Section>
      <Section icon="sunny-outline" title={tr('Premiers repères', 'First routines')}>
        {Object.entries(habits).map(([name, habit]) => (
          <View key={name} style={styles.habit}>
            <Text style={styles.habitName}>
              {locale === 'fr' ? name : (habitNames[name] ?? name)}
            </Text>
            <Text style={[styles.habitValue, habit.unknown && styles.habitLearn]}>
              {habit.unknown
                ? tr('Élise apprendra', 'Élise will learn')
                : `${habit.from} – ${habit.to}`}
            </Text>
          </View>
        ))}
      </Section>
      <Section icon="shield-checkmark-outline" title={tr('Accès à distance', 'Remote access')}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, !remoteReady && styles.badgeLater]}>
            <Text style={[styles.badgeText, !remoteReady && styles.badgeTextLater]}>
              {remoteReady ? tr('Activé', 'On') : tr('À activer plus tard', 'To turn on later')}
            </Text>
          </View>
        </View>
      </Section>
      <Text style={styles.note}>
        {tr(
          'Tout reste modifiable ensuite dans les réglages d’Élise.',
          'Everything can be changed later in Élise settings.',
        )}
      </Text>
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
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  primary: { color: colors.navy, fontSize: 17, fontWeight: '700' },
  secondary: { color: colors.muted, fontSize: 13 },
  habit: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  habitName: { color: colors.navy, fontSize: 14 },
  habitValue: {
    color: colors.navy,
    fontSize: 14,
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
  badgeText: { color: colors.green, fontWeight: '700', fontSize: 13 },
  badgeTextLater: { color: colors.amber },
  note: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
