import {
  HEATWAVE_COOL_MARGIN,
  HEATWAVE_REGISTRY_URL,
  type HeatwaveSettings,
  type HeatwaveStatus,
} from '@elise/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CloudSun,
  ExternalLink,
  GlassWater,
  House,
  Landmark,
  Lightbulb,
  Minus,
  Plus,
  Power,
  SlidersHorizontal,
  ThermometerSun,
  type LucideIcon,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import {
  PrimaryButton,
  SecondaryButton,
  SetupNotice,
  SetupPage,
  SetupSheet,
  ss,
  useSetupStep,
  useSheetControls,
} from '../sensors/ui';
import {
  celsius,
  duration,
  heatwaveFacts,
  heatwaveStateText,
  heatwaveStatusLabel,
  heatwaveSummary,
  heatwaveTone,
  settingsValid,
  stepValue,
  withEndHour,
  withStartHour,
} from './heatwave-view';

/** Same cache entry as the card of the home tab, so both always agree. */
export const heatwaveQueryKey = (server: SavedServer) => ['elise', server.id, 'heatwave'];

const AMBER = '#9a5d1d';
const factIcons: Record<string, LucideIcon> = {
  indoor: House,
  forecast: CloudSun,
  reminders: GlassWater,
};

/** « Mode canicule » sheet: what the mode does now, and its settings for owners and admins. */
export function HeatwaveSheet(props: { server: SavedServer; token: string; onClose: () => void }) {
  return (
    <SetupSheet onClose={props.onClose}>
      <HeatwaveFlow {...props} />
    </SetupSheet>
  );
}

function HeatwaveFlow({ server, token, onClose }: Parameters<typeof HeatwaveSheet>[0]) {
  const queryClient = useQueryClient();
  const queryKey = heatwaveQueryKey(server);
  const status = useQuery({ queryKey, queryFn: () => mobileApi.heatwave(server, token) });
  const { step, direction, go, back } = useSetupStep<'STATUS' | 'SETTINGS'>('STATUS');
  const [draft, setDraft] = useState<HeatwaveSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useSheetControls({ busy, onClose });

  const run = async (work: () => Promise<HeatwaveStatus>, failure: string) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      queryClient.setQueryData(queryKey, await work());
      return true;
    } catch {
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const data = status.data;

  if (step === 'SETTINGS' && draft)
    return (
      <SetupPage
        pageKey="heatwave-settings"
        direction={direction}
        eyebrow={t('heatwave.card.title')}
        title={t('heatwave.settings.title')}
        subtitle={t('heatwave.settings.intro')}
        onBack={() => {
          if (busy) return;
          setError('');
          back('STATUS');
        }}
        backLabel={t('heatwave.settings.back')}
        footer={
          <PrimaryButton
            label={busy ? t('heatwave.settings.saving') : t('heatwave.settings.save')}
            busy={busy}
            disabled={!settingsValid(draft)}
            onPress={() =>
              void run(
                () => mobileApi.updateHeatwaveSettings(server, token, draft),
                t('heatwave.settings.error'),
              ).then((saved) => saved && back('STATUS'))
            }
          />
        }
      >
        <HeatwaveSettingsForm settings={draft} onChange={setDraft} />
        {error ? <SetupNotice tone="danger">{error}</SetupNotice> : null}
      </SetupPage>
    );

  return (
    <SetupPage
      pageKey="heatwave-status"
      direction={direction}
      eyebrow={t('heatwave.card.cardEyebrow')}
      title={t('heatwave.card.title')}
      subtitle={t('heatwave.card.detailSubtitle')}
      footer={
        data?.canToggle ? (
          <PrimaryButton
            label={data.active ? t('heatwave.card.deactivate') : t('heatwave.card.activate')}
            icon={<Power size={20} color="#fff" strokeWidth={2.4} />}
            busy={busy}
            onPress={() =>
              void run(
                () => mobileApi.setHeatwaveManual(server, token, !data.active),
                t('heatwave.card.actionError'),
              )
            }
          />
        ) : undefined
      }
    >
      {status.isPending ? (
        <View style={styles.loading} accessibilityRole="progressbar">
          <ActivityIndicator color={ss.accent} />
          <Text style={styles.muted}>{t('heatwave.card.loading')}</Text>
        </View>
      ) : !data ? (
        <View style={styles.stack}>
          <SetupNotice tone="danger">{t('heatwave.card.error')}</SetupNotice>
          <SecondaryButton label={t('heatwave.card.retry')} onPress={() => void status.refetch()} />
        </View>
      ) : (
        <HeatwaveStatusView
          status={data}
          busy={busy}
          onSettings={() => {
            setDraft(structuredClone(data.settings));
            setError('');
            go('SETTINGS');
          }}
          onRegistryDone={() =>
            void run(
              () => mobileApi.acknowledgeHeatwaveRegistry(server, token, data.registry.year),
              t('heatwave.card.actionError'),
            )
          }
        />
      )}
      {error && step === 'STATUS' ? <SetupNotice tone="danger">{error}</SetupNotice> : null}
    </SetupPage>
  );
}

function HeatwaveStatusView({
  status,
  busy,
  onSettings,
  onRegistryDone,
}: {
  status: HeatwaveStatus;
  busy: boolean;
  onSettings: () => void;
  onRegistryDone: () => void;
}) {
  const tone = heatwaveTone(status);
  return (
    <View style={styles.stack}>
      <View style={[styles.hero, tone === 'active' && styles.heroActive]}>
        <View style={[styles.heroIcon, tone === 'active' && styles.heroIconActive]}>
          <ThermometerSun size={26} color={tone === 'active' ? AMBER : ss.accent} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.heroLabel} accessibilityLiveRegion="polite">
            {heatwaveStatusLabel(status)}
          </Text>
          <Text style={styles.heroText}>{heatwaveStateText(status)}</Text>
        </View>
      </View>

      <View style={styles.facts}>
        {heatwaveFacts(status).map((fact, index) => {
          const Icon = factIcons[fact.key] ?? House;
          return (
            <View key={fact.key} style={[styles.fact, index > 0 && styles.factDivider]}>
              <View style={styles.factIcon}>
                <Icon size={19} color={ss.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
                {fact.detail ? <Text style={styles.muted}>{fact.detail}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      {status.registry.due ? (
        <View style={styles.registry} accessible accessibilityLabel={t('heatwave.registry.title')}>
          <View style={styles.registryHeader}>
            <Landmark size={20} color={AMBER} />
            <Text style={styles.registryTitle}>{t('heatwave.registry.title')}</Text>
          </View>
          <Text style={styles.registryText}>{t('heatwave.registry.text')}</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(HEATWAVE_REGISTRY_URL)}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <Text style={styles.link}>{t('heatwave.registry.link')}</Text>
            <ExternalLink size={16} color={ss.accent} />
          </Pressable>
          {status.canToggle ? (
            <SecondaryButton
              label={t('heatwave.registry.done')}
              disabled={busy}
              onPress={onRegistryDone}
            />
          ) : null}
        </View>
      ) : null}

      {status.canManage ? (
        <SecondaryButton
          label={t('heatwave.card.settings')}
          icon={<SlidersHorizontal size={19} color={ss.ink} />}
          disabled={busy}
          onPress={onSettings}
        />
      ) : (
        <SetupNotice>{t('heatwave.card.readOnly')}</SetupNotice>
      )}
      <Text style={styles.disclaimer}>{t('heatwave.notMedical')}</Text>
    </View>
  );
}

function HeatwaveSettingsForm({
  settings,
  onChange,
}: {
  settings: HeatwaveSettings;
  onChange: (settings: HeatwaveSettings) => void;
}) {
  const set = <K extends keyof HeatwaveSettings>(key: K, value: Partial<HeatwaveSettings[K]>) =>
    onChange({ ...settings, [key]: { ...settings[key], ...value } });
  const { indoorTrigger, forecastTrigger, reminders, tips, alert } = settings;
  const degrees = (value: number) => `${celsius(value)} °C`;
  const hour = (value: number) => t('heatwave.settings.hour', { hour: value });
  return (
    <View style={styles.stack}>
      <Text style={styles.group} accessibilityRole="header">
        {t('heatwave.settings.triggersHeading').toUpperCase()}
      </Text>
      <SettingSection
        icon={House}
        title={t('heatwave.settings.indoorTitle')}
        hint={t('heatwave.settings.indoorHint')}
        enabled={indoorTrigger.enabled}
        onToggle={(enabled) => set('indoorTrigger', { enabled })}
      >
        <Stepper
          label={t('heatwave.settings.threshold')}
          value={degrees(indoorTrigger.celsius)}
          disabled={!indoorTrigger.enabled}
          canLess={indoorTrigger.celsius > 24}
          canMore={indoorTrigger.celsius < 40}
          onStep={(delta) =>
            set('indoorTrigger', {
              celsius: stepValue(indoorTrigger.celsius, delta * 0.5, 24, 40, 0.5),
            })
          }
        />
        <Stepper
          label={t('heatwave.settings.during')}
          value={duration(indoorTrigger.minutes)}
          disabled={!indoorTrigger.enabled}
          canLess={indoorTrigger.minutes > 10}
          canMore={indoorTrigger.minutes < 240}
          onStep={(delta) =>
            set('indoorTrigger', {
              minutes: stepValue(indoorTrigger.minutes, delta * 10, 10, 240, 10),
            })
          }
        />
      </SettingSection>
      <SettingSection
        icon={CloudSun}
        title={t('heatwave.settings.forecastTitle')}
        hint={t('heatwave.settings.forecastHint')}
        enabled={forecastTrigger.enabled}
        onToggle={(enabled) => set('forecastTrigger', { enabled })}
      >
        <Stepper
          label={t('heatwave.settings.forecastThreshold')}
          value={degrees(forecastTrigger.celsius)}
          disabled={!forecastTrigger.enabled}
          canLess={forecastTrigger.celsius > 25}
          canMore={forecastTrigger.celsius < 45}
          onStep={(delta) =>
            set('forecastTrigger', {
              celsius: stepValue(forecastTrigger.celsius, delta, 25, 45, 1),
            })
          }
        />
      </SettingSection>
      <Text style={styles.note}>
        {t('heatwave.settings.offNote', {
          celsius: celsius(indoorTrigger.celsius - HEATWAVE_COOL_MARGIN),
        })}
      </Text>

      <Text style={styles.group} accessibilityRole="header">
        {t('heatwave.settings.tvHeading').toUpperCase()}
      </Text>
      <SettingSection
        icon={GlassWater}
        title={t('heatwave.settings.remindersTitle')}
        hint={t('heatwave.settings.remindersHint')}
        enabled={reminders.enabled}
        onToggle={(enabled) => set('reminders', { enabled })}
      >
        <Text style={styles.controlLabel}>{t('heatwave.settings.frequency')}</Text>
        <View
          style={styles.segments}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('heatwave.settings.frequency')}
        >
          {([1, 2, 3] as const).map((every) => {
            const selected = reminders.everyHours === every;
            return (
              <Pressable
                key={every}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: !reminders.enabled }}
                disabled={!reminders.enabled}
                onPress={() => set('reminders', { everyHours: every })}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                  {t('heatwave.settings.everyHours', { count: every })}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Stepper
          label={t('heatwave.settings.from')}
          value={hour(reminders.startHour)}
          disabled={!reminders.enabled}
          canLess={reminders.startHour > 0}
          canMore={reminders.startHour < 22}
          onStep={(delta) => onChange(withStartHour(settings, reminders.startHour + delta))}
        />
        <Stepper
          label={t('heatwave.settings.to')}
          value={hour(reminders.endHour)}
          disabled={!reminders.enabled}
          canLess={reminders.endHour > reminders.startHour + 1}
          canMore={reminders.endHour < 23}
          onStep={(delta) => onChange(withEndHour(settings, reminders.endHour + delta))}
        />
      </SettingSection>
      <SettingSection
        icon={Lightbulb}
        title={t('heatwave.settings.tipsTitle')}
        hint={t('heatwave.settings.tipsHint')}
        enabled={tips.enabled}
        onToggle={(enabled) => set('tips', { enabled })}
      />

      <Text style={styles.group} accessibilityRole="header">
        {t('heatwave.settings.familyHeading').toUpperCase()}
      </Text>
      <SettingSection
        icon={Bell}
        title={t('heatwave.settings.alertTitle')}
        hint={t('heatwave.settings.alertHint')}
        enabled={alert.enabled}
        onToggle={(enabled) => set('alert', { enabled })}
      >
        <Stepper
          label={t('heatwave.settings.threshold')}
          value={degrees(alert.celsius)}
          disabled={!alert.enabled}
          canLess={alert.celsius > 26}
          canMore={alert.celsius < 40}
          onStep={(delta) =>
            set('alert', { celsius: stepValue(alert.celsius, delta * 0.5, 26, 40, 0.5) })
          }
        />
        <Stepper
          label={t('heatwave.settings.during')}
          value={duration(alert.minutes)}
          disabled={!alert.enabled}
          canLess={alert.minutes > 15}
          canMore={alert.minutes < 360}
          onStep={(delta) =>
            set('alert', { minutes: stepValue(alert.minutes, delta * 15, 15, 360, 15) })
          }
        />
      </SettingSection>

      <View style={styles.summary} accessibilityLiveRegion="polite">
        <Text style={styles.summaryTitle}>{t('heatwave.settings.summaryTitle')}</Text>
        {heatwaveSummary(settings).map((sentence) => (
          <Text key={sentence} style={styles.summaryText}>
            {sentence}
          </Text>
        ))}
      </View>
      <Text style={styles.disclaimer}>{t('heatwave.notMedical')}</Text>
    </View>
  );
}

function SettingSection({
  icon: Icon,
  title,
  hint,
  enabled,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.section, !enabled && styles.sectionOff]}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, !enabled && styles.sectionIconOff]}>
          <Icon size={20} color={enabled ? AMBER : ss.ink3} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionHint}>{hint}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          accessibilityLabel={title}
          trackColor={{ false: ss.fill2, true: ss.success }}
          thumbColor="#ffffff"
          ios_backgroundColor={ss.fill2}
        />
      </View>
      {children ? (
        <View style={[styles.controls, !enabled && styles.controlsOff]}>{children}</View>
      ) : null}
    </View>
  );
}

function Stepper({
  label,
  value,
  disabled,
  canLess,
  canMore,
  onStep,
}: {
  label: string;
  value: string;
  disabled: boolean;
  canLess: boolean;
  canMore: boolean;
  onStep: (delta: -1 | 1) => void;
}) {
  const button = (delta: -1 | 1, allowed: boolean) => {
    const off = disabled || !allowed;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          delta < 0
            ? t('heatwave.settings.less', { label })
            : t('heatwave.settings.more', { label })
        }
        accessibilityState={{ disabled: off }}
        disabled={off}
        hitSlop={4}
        onPress={() => onStep(delta)}
        style={({ pressed }) => [
          styles.stepButton,
          off && styles.stepOff,
          pressed && styles.pressed,
        ]}
      >
        {delta < 0 ? <Minus size={18} color={ss.ink} /> : <Plus size={18} color={ss.ink} />}
      </Pressable>
    );
  };
  return (
    <View style={styles.stepper}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={styles.stepControl}>
        {button(-1, canLess)}
        <Text style={styles.stepValue} accessibilityLiveRegion="polite">
          {value}
        </Text>
        {button(1, canMore)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: 14 },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  muted: { color: ss.ink3, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.75 },
  hero: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ss.line,
    backgroundColor: ss.fill,
  },
  heroActive: { borderColor: '#ecd2ad', backgroundColor: '#fff8ee' },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.accentSoft,
  },
  heroIconActive: { backgroundColor: ss.warningSoft },
  heroLabel: { color: ss.ink, fontSize: 18, fontWeight: '800' },
  heroText: { marginTop: 3, color: ss.ink2, fontSize: 15, lineHeight: 21 },
  facts: { borderRadius: 18, borderWidth: 1, borderColor: ss.line, backgroundColor: ss.bg },
  fact: { flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' },
  factDivider: { borderTopWidth: 1, borderTopColor: ss.line },
  factIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.accentSoft,
  },
  factLabel: { color: ss.ink3, fontSize: 13, fontWeight: '700' },
  factValue: { marginTop: 2, color: ss.ink, fontSize: 16, fontWeight: '700' },
  registry: {
    gap: 8,
    padding: 16,
    borderRadius: 18,
    backgroundColor: ss.warningSoft,
  },
  registryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  registryTitle: { flex: 1, color: '#6b4210', fontSize: 16, fontWeight: '800' },
  registryText: { color: '#5b3a12', fontSize: 14, lineHeight: 20 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  link: { color: ss.accent, fontSize: 15, fontWeight: '800' },
  disclaimer: { color: ss.ink3, fontSize: 13, lineHeight: 19 },
  group: { marginTop: 6, color: ss.ink3, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  note: { color: ss.ink2, fontSize: 13, lineHeight: 19 },
  section: {
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ss.line,
    backgroundColor: ss.bg,
  },
  sectionOff: { backgroundColor: ss.fill },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.warningSoft,
  },
  sectionIconOff: { backgroundColor: ss.fill2 },
  sectionTitle: { color: ss.ink, fontSize: 16, fontWeight: '800' },
  sectionHint: { marginTop: 2, color: ss.ink2, fontSize: 13, lineHeight: 18 },
  controls: { gap: 10 },
  controlsOff: { opacity: 0.45 },
  controlLabel: { color: ss.ink2, fontSize: 14, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  stepControl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.fill,
    borderWidth: 1,
    borderColor: ss.line,
  },
  stepOff: { opacity: 0.4 },
  stepValue: { minWidth: 78, textAlign: 'center', color: ss.ink, fontSize: 16, fontWeight: '800' },
  segments: { flexDirection: 'row', gap: 6 },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 6,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: ss.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.fill,
  },
  segmentSelected: { borderColor: ss.accent, backgroundColor: ss.accentSoft },
  segmentText: { color: ss.ink2, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  segmentTextSelected: { color: ss.ink },
  summary: { gap: 6, padding: 14, borderRadius: 18, backgroundColor: ss.accentSoft },
  summaryTitle: { color: '#1d6684', fontSize: 15, fontWeight: '800' },
  summaryText: { color: '#1d4f66', fontSize: 14, lineHeight: 20 },
});
