import { HEATWAVE_REGISTRY_URL, type HeatwaveStatus } from '@elise/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CloudSun,
  ExternalLink,
  GlassWater,
  House,
  Landmark,
  Power,
  PowerOff,
  ShieldAlert,
  SlidersHorizontal,
  ThermometerSun,
  Tv,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { MobileApiError, mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import { colors } from '../theme';
import {
  heatwaveFacts,
  heatwaveHowItWorks,
  heatwaveStateText,
  heatwaveStatusLabel,
  heatwaveTone,
  type HeatwaveHowKey,
} from './heatwave-view';
import { HeatwaveSheet, heatwaveQueryKey } from './HeatwaveSheet';

const AMBER = '#9a5d1d';
const factIcons: Record<string, LucideIcon> = {
  indoor: House,
  forecast: CloudSun,
  reminders: GlassWater,
};
const howIcons: Record<HeatwaveHowKey, LucideIcon> = {
  on: Power,
  off: PowerOff,
  tv: Tv,
  family: Bell,
  registry: Landmark,
  medical: ShieldAlert,
};

/**
 * « Canicule » card of the Settings tab: how the mode works with the saved settings, its state
 * and today's figures, the family on/off, and the settings sheet for owners and administrators.
 * Hidden on a box too old to know the heatwave mode.
 */
export function HeatwaveCard({ server, token }: { server: SavedServer; token: string }) {
  const queryClient = useQueryClient();
  const queryKey = heatwaveQueryKey(server);
  const [expanded, setExpanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = useQuery({
    queryKey,
    queryFn: () => mobileApi.heatwave(server, token),
    refetchInterval: 60_000,
  });
  if (status.error instanceof MobileApiError && status.error.status === 404) return null;
  const data = status.data;

  const run = async (work: () => Promise<HeatwaveStatus>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      queryClient.setQueryData(queryKey, await work());
    } catch {
      setError(t('heatwave.card.actionError'));
    } finally {
      setBusy(false);
    }
  };

  const tone = data ? heatwaveTone(data) : 'idle';
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${t('heatwave.card.settingsTitle')}${data ? `, ${heatwaveStatusLabel(data)}` : ''}`}
        style={styles.header}
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.icon}>
          <ThermometerSun size={19} color={AMBER} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{t('heatwave.card.settingsEyebrow').toUpperCase()}</Text>
          <Text style={styles.title}>{t('heatwave.card.settingsTitle')}</Text>
        </View>
        {data ? (
          <Text
            style={[
              styles.badge,
              tone === 'active' && styles.badgeActive,
              tone === 'paused' && styles.badgePaused,
            ]}
          >
            {heatwaveStatusLabel(data)}
          </Text>
        ) : null}
        {expanded ? (
          <ChevronDown size={19} color={colors.muted} />
        ) : (
          <ChevronRight size={19} color={colors.muted} />
        )}
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <Text style={styles.intro}>{t('heatwave.card.settingsIntro')}</Text>
          {!data ? (
            status.isPending ? (
              <View style={styles.loading} accessibilityRole="progressbar">
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.muted}>{t('heatwave.card.loading')}</Text>
              </View>
            ) : (
              <View style={styles.stack}>
                <Text style={styles.error}>{t('heatwave.card.error')}</Text>
                <SmallButton
                  label={t('heatwave.card.retry')}
                  onPress={() => void status.refetch()}
                />
              </View>
            )
          ) : (
            <>
              <View style={[styles.state, tone === 'active' && styles.stateActive]}>
                <Text style={styles.stateText} accessibilityLiveRegion="polite">
                  {heatwaveStateText(data)}
                </Text>
              </View>
              <View style={styles.actions}>
                {data.canToggle ? (
                  <SmallButton
                    label={
                      data.active ? t('heatwave.card.deactivate') : t('heatwave.card.activate')
                    }
                    primary={!data.active}
                    disabled={busy}
                    onPress={() =>
                      void run(() => mobileApi.setHeatwaveManual(server, token, !data.active))
                    }
                  />
                ) : null}
                {data.canManage ? (
                  <SmallButton
                    label={t('heatwave.card.settings')}
                    icon={<SlidersHorizontal size={16} color={colors.blue} />}
                    disabled={busy}
                    onPress={() => setSettingsOpen(true)}
                  />
                ) : null}
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Text style={styles.heading} accessibilityRole="header">
                {t('heatwave.card.todayTitle')}
              </Text>
              <View style={styles.facts}>
                {heatwaveFacts(data).map((fact, index) => {
                  const Icon = factIcons[fact.key] ?? House;
                  return (
                    <View key={fact.key} style={[styles.fact, index > 0 && styles.divider]}>
                      <Icon size={17} color={colors.accent} />
                      <View style={styles.flex}>
                        <Text style={styles.factLabel}>{fact.label}</Text>
                        <Text style={styles.factValue}>{fact.value}</Text>
                        {fact.detail ? <Text style={styles.muted}>{fact.detail}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>

              {data.registry.due ? (
                <View style={styles.registry}>
                  <Text style={styles.registryTitle}>{t('heatwave.registry.title')}</Text>
                  <Text style={styles.registryText}>{t('heatwave.registry.text')}</Text>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(HEATWAVE_REGISTRY_URL)}
                    style={styles.link}
                  >
                    <Text style={styles.linkText}>{t('heatwave.registry.link')}</Text>
                    <ExternalLink size={15} color={colors.accent} />
                  </Pressable>
                  {data.canToggle ? (
                    <SmallButton
                      label={t('heatwave.registry.done')}
                      disabled={busy}
                      onPress={() =>
                        void run(() =>
                          mobileApi.acknowledgeHeatwaveRegistry(server, token, data.registry.year),
                        )
                      }
                    />
                  ) : null}
                </View>
              ) : null}

              <Text style={styles.heading} accessibilityRole="header">
                {t('heatwave.how.title')}
              </Text>
              {heatwaveHowItWorks(data).map((item) => {
                const Icon = howIcons[item.key];
                return (
                  <View key={item.key} style={styles.how}>
                    <View style={[styles.howIcon, item.key === 'medical' && styles.howIconBlue]}>
                      <Icon size={16} color={item.key === 'medical' ? colors.accent : AMBER} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.howTitle}>{item.title}</Text>
                      <Text style={styles.howText}>{item.text}</Text>
                    </View>
                  </View>
                );
              })}
              {!data.canManage ? (
                <Text style={styles.muted}>{t('heatwave.card.readOnly')}</Text>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {settingsOpen && data ? (
        <HeatwaveSheet
          server={server}
          token={token}
          settings={data.settings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </View>
  );
}

function SmallButton({
  label,
  onPress,
  disabled = false,
  primary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}
    >
      {icon}
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleAmber,
  },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  title: { marginTop: 4, color: colors.navy, fontSize: 16, fontWeight: '900' },
  badge: {
    maxWidth: 110,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
    borderRadius: 12,
    color: colors.accent,
    backgroundColor: colors.paleBlue,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  badgeActive: { color: '#7a4a14', backgroundColor: colors.paleAmber },
  badgePaused: { color: colors.muted, backgroundColor: '#EEF0F2' },
  body: { marginTop: 14, gap: 11 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  stack: { gap: 10 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.red, fontSize: 13, lineHeight: 19 },
  state: { padding: 12, borderRadius: 14, backgroundColor: colors.cream },
  stateActive: { backgroundColor: colors.amberSoft },
  stateText: { color: colors.navy, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heading: { marginTop: 4, color: colors.navy, fontFamily: 'Georgia', fontSize: 18 },
  facts: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  factLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  factValue: { marginTop: 2, color: colors.navy, fontSize: 15, fontWeight: '800' },
  registry: { gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.paleBlue },
  registryTitle: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  registryText: { color: colors.navy, fontSize: 13, lineHeight: 19 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  how: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  howIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  howIconBlue: { backgroundColor: colors.paleBlue },
  howTitle: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  howText: { marginTop: 2, color: colors.muted, fontSize: 13, lineHeight: 20 },
  button: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
  },
  buttonPrimary: { borderColor: colors.blue, backgroundColor: colors.blue },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
  buttonTextPrimary: { color: '#fff' },
  pressed: { opacity: 0.8 },
});
