import {
  formatNightPathTime,
  NIGHT_PATH_OFF_DELAYS,
  parseNightPathTime,
  type NightPath,
  type NightPathOverview,
  type NightPathRoom,
} from '@elise/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BedDouble,
  Check,
  Clock3,
  Footprints,
  Lightbulb,
  Minus,
  MoonStar,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { currentLanguage, dateLocale, t } from '../i18n';
import { RoutineTimeField } from '../setup/RoutineTimeField';
import {
  PrimaryButton,
  SecondaryButton,
  SetupChoices,
  SetupField,
  SetupNotice,
  SetupPage,
  SetupSheet,
  ss,
  useSetupStep,
  useSheetControls,
} from '../sensors/ui';
import {
  canTriggerNightPath,
  draftFromPath,
  emptyNightPathDraft,
  NIGHT_PATH_MAX_BRIGHTNESS,
  NIGHT_PATH_MIN_BRIGHTNESS,
  NIGHT_PATH_TEMPERATURES,
  nightPathBedAvailable,
  nightPathDraftProblem,
  nightPathPayload,
  nightPathSummary,
  stepBrightness,
  toggleRoom,
  type NightPathDraft,
} from './night-path-view';

/** Same cache entry as the card of the home tab, so both always agree. */
export const nightPathsQueryKey = (server: SavedServer) => ['elise', server.id, 'night-paths'];

type Editing = { id: string | null; draft: NightPathDraft };

/** « Chemin lumineux » sheet: the night paths of the home, and their editor. */
export function NightPathSheet(props: {
  server: SavedServer;
  token: string;
  resident: string;
  canManage: boolean;
  onClose: () => void;
}) {
  return (
    <SetupSheet onClose={props.onClose}>
      <NightPathFlow {...props} />
    </SetupSheet>
  );
}

function NightPathFlow({
  server,
  token,
  resident,
  canManage,
  onClose,
}: Parameters<typeof NightPathSheet>[0]) {
  const queryClient = useQueryClient();
  const queryKey = nightPathsQueryKey(server);
  const overview = useQuery({
    queryKey,
    queryFn: () => mobileApi.nightPaths(server, token),
  });
  const { step, direction, go, back } = useSetupStep<'LIST' | 'EDIT'>('LIST');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testNotice, setTestNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useSheetControls({ busy, onClose });

  const reload = async () => {
    const next = await queryClient.fetchQuery({
      queryKey,
      queryFn: () => mobileApi.nightPaths(server, token),
      staleTime: 0,
    });
    return next;
  };

  const openEditor = (next: Editing) => {
    setEditing(next);
    setError('');
    setTestNotice('');
    setConfirmDelete(null);
    go('EDIT');
  };
  const closeEditor = () => {
    if (busy) return;
    setError('');
    setTestNotice('');
    back('LIST');
  };

  const save = async () => {
    if (!editing || busy || nightPathDraftProblem(editing.draft)) return;
    setBusy(true);
    setError('');
    try {
      const body = nightPathPayload(editing.draft);
      if (editing.id) await mobileApi.updateNightPath(server, token, editing.id, body);
      else await mobileApi.createNightPath(server, token, body);
      setTestNotice('');
      back('LIST');
      await reload().catch(() => undefined);
    } catch {
      setError(t('nightPath.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!editing || testing) return;
    setTesting(true);
    setTestNotice('');
    setError('');
    try {
      const result = await mobileApi.testNightPath(server, token, {
        lightRoomIds: editing.draft.lightRoomIds,
        brightnessPercent: editing.draft.brightnessPercent,
        colorTemperatureKelvin: editing.draft.colorTemperatureKelvin,
      });
      setTestNotice(
        result.lights
          ? t('nightPath.testStarted', { count: result.lights, seconds: result.seconds })
          : t('nightPath.testNoLight'),
      );
    } catch {
      setError(t('nightPath.testError'));
    } finally {
      setTesting(false);
    }
  };

  const toggle = async (path: NightPath) => {
    if (busyId) return;
    setBusyId(path.id);
    setError('');
    try {
      await mobileApi.updateNightPath(server, token, path.id, { enabled: !path.enabled });
      await reload();
    } catch {
      setError(t('nightPath.saveError'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (path: NightPath) => {
    if (busyId) return;
    setBusyId(path.id);
    setError('');
    try {
      await mobileApi.deleteNightPath(server, token, path.id);
      setConfirmDelete(null);
      await reload();
    } catch {
      setError(t('nightPath.deleteError'));
    } finally {
      setBusyId(null);
    }
  };

  const data = overview.data;

  if (step === 'EDIT' && editing && data)
    return (
      <NightPathEditor
        direction={direction}
        isNew={!editing.id}
        draft={editing.draft}
        rooms={data.rooms}
        resident={resident}
        busy={busy}
        testing={testing}
        testNotice={testNotice}
        error={error}
        onChange={(draft) => setEditing({ ...editing, draft })}
        onCancel={closeEditor}
        onSave={() => void save()}
        onTest={() => void test()}
      />
    );

  const create = () =>
    data && openEditor({ id: null, draft: emptyNightPathDraft(data.rooms, data.paths.length) });

  return (
    <SetupPage
      pageKey="night-paths"
      direction={direction}
      eyebrow={t('nightPath.cardEyebrow')}
      title={t('nightPath.title')}
      subtitle={t('nightPath.intro', { resident: resident || t('nightPath.theResident') })}
      footer={
        canManage && data ? (
          <PrimaryButton
            label={data.paths.length ? t('nightPath.addAnother') : t('nightPath.create')}
            icon={<Plus size={20} color="#fff" strokeWidth={2.6} />}
            disabled={Boolean(busyId)}
            onPress={() => create()}
          />
        ) : undefined
      }
    >
      {overview.isPending ? (
        <View
          style={styles.loading}
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator color={ss.accent} />
          <Text style={styles.loadingText}>{t('nightPath.loading')}</Text>
        </View>
      ) : !data ? (
        <View style={styles.stack}>
          <SetupNotice tone="danger">{t('nightPath.loadError')}</SetupNotice>
          <SecondaryButton label={t('nightPath.retry')} onPress={() => void overview.refetch()} />
        </View>
      ) : (
        <NightPathList
          overview={data}
          resident={resident}
          canManage={canManage}
          busyId={busyId}
          confirmDelete={confirmDelete}
          onEdit={(path) => openEditor({ id: path.id, draft: draftFromPath(path) })}
          onToggle={(path) => void toggle(path)}
          onAskDelete={setConfirmDelete}
          onDelete={(path) => void remove(path)}
        />
      )}
      {error && step === 'LIST' ? <SetupNotice tone="danger">{error}</SetupNotice> : null}
    </SetupPage>
  );
}

function NightPathList({
  overview,
  resident,
  canManage,
  busyId,
  confirmDelete,
  onEdit,
  onToggle,
  onAskDelete,
  onDelete,
}: {
  overview: NightPathOverview;
  resident: string;
  canManage: boolean;
  busyId: string | null;
  confirmDelete: string | null;
  onEdit: (path: NightPath) => void;
  onToggle: (path: NightPath) => void;
  onAskDelete: (id: string | null) => void;
  onDelete: (path: NightPath) => void;
}) {
  const { paths, rooms } = overview;
  const hasLights = rooms.some(({ lights }) => lights > 0);
  const hasSensors = rooms.some(canTriggerNightPath);
  const until = (value: string) =>
    new Date(value).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={styles.stack}>
      {!hasLights || !hasSensors ? (
        <SetupNotice tone="warning" title={t('nightPath.requirementsTitle')}>
          {[
            !hasSensors ? t('nightPath.needsSensor') : '',
            !hasLights ? t('nightPath.needsLight', { tab: t('dashboardApp.myHome') }) : '',
          ]
            .filter(Boolean)
            .join('\n')}
        </SetupNotice>
      ) : null}
      {paths.length === 0 ? (
        <View style={styles.empty} accessible accessibilityLiveRegion="polite">
          <View style={styles.emptyIcon}>
            <MoonStar size={26} color={ss.accent} strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>{t('nightPath.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('nightPath.emptyText')}</Text>
        </View>
      ) : (
        paths.map((path) => {
          const status = path.activeUntil
            ? t('nightPath.litUntil', { time: until(path.activeUntil) })
            : path.enabled
              ? t('nightPath.enabled')
              : t('nightPath.paused');
          const pathBusy = busyId === path.id;
          return (
            <View key={path.id} style={[styles.card, !path.enabled && styles.cardPaused]}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIcon, !path.enabled && styles.cardIconPaused]}>
                  <MoonStar size={22} color={path.enabled ? '#9a6410' : ss.ink3} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle} accessibilityRole="header">
                    {path.name}
                  </Text>
                  <View style={styles.statusRow}>
                    {path.activeUntil ? <Lightbulb size={14} color={ss.warning} /> : null}
                    <Text
                      style={[
                        styles.status,
                        path.activeUntil
                          ? styles.statusLit
                          : path.enabled
                            ? styles.statusOn
                            : styles.statusOff,
                      ]}
                    >
                      {status}
                    </Text>
                  </View>
                </View>
                {canManage ? (
                  pathBusy ? (
                    <ActivityIndicator color={ss.accent} />
                  ) : (
                    <Switch
                      value={path.enabled}
                      onValueChange={() => onToggle(path)}
                      disabled={Boolean(busyId)}
                      accessibilityLabel={t('nightPath.toggle', { name: path.name })}
                      trackColor={{ false: ss.fill2, true: ss.success }}
                      thumbColor="#ffffff"
                      ios_backgroundColor={ss.fill2}
                    />
                  )
                ) : null}
              </View>
              <Text style={styles.cardSummary}>{nightPathSummary(path, rooms, resident)}</Text>
              {canManage ? (
                confirmDelete === path.id ? (
                  <View style={styles.confirm} accessibilityRole="alert">
                    <Text style={styles.confirmText}>{t('nightPath.confirmDelete')}</Text>
                    <View style={styles.actions}>
                      <SmallButton
                        label={t('nightPath.keep')}
                        disabled={pathBusy}
                        onPress={() => onAskDelete(null)}
                      />
                      <SmallButton
                        label={t('nightPath.delete')}
                        danger
                        disabled={pathBusy}
                        icon={<Trash2 size={17} color="#fff" />}
                        onPress={() => onDelete(path)}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <SmallButton
                      label={t('nightPath.edit')}
                      accessibilityLabel={`${t('nightPath.edit')} « ${path.name} »`}
                      disabled={Boolean(busyId)}
                      icon={<Pencil size={17} color={ss.ink} />}
                      onPress={() => onEdit(path)}
                    />
                    <SmallButton
                      label={t('nightPath.delete')}
                      accessibilityLabel={`${t('nightPath.delete')} « ${path.name} »`}
                      quiet
                      disabled={Boolean(busyId)}
                      icon={<Trash2 size={17} color={ss.danger} />}
                      onPress={() => onAskDelete(path.id)}
                    />
                  </View>
                )
              ) : null}
            </View>
          );
        })
      )}
      {!canManage ? <SetupNotice>{t('nightPath.readOnly')}</SetupNotice> : null}
      <Text style={styles.disclaimer}>{t('nightPath.disclaimer')}</Text>
    </View>
  );
}

function NightPathEditor({
  direction,
  isNew,
  draft,
  rooms,
  resident,
  busy,
  testing,
  testNotice,
  error,
  onChange,
  onCancel,
  onSave,
  onTest,
}: {
  direction: 'forward' | 'back';
  isNew: boolean;
  draft: NightPathDraft;
  rooms: NightPathRoom[];
  resident: string;
  busy: boolean;
  testing: boolean;
  testNotice: string;
  error: string;
  onChange: (draft: NightPathDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const problem = nightPathDraftProblem(draft);
  const bedAvailable = nightPathBedAvailable(draft.triggerRoomIds, rooms);
  const who = resident || t('nightPath.theResident');
  const setTime = (key: 'startMinute' | 'endMinute', value: string) => {
    const minute = parseNightPathTime(value);
    if (minute !== null) onChange({ ...draft, [key]: minute });
  };
  const setBrightness = (direction: -1 | 1) =>
    onChange({ ...draft, brightnessPercent: stepBrightness(draft.brightnessPercent, direction) });
  return (
    <SetupPage
      pageKey={isNew ? 'night-path-new' : 'night-path-edit'}
      direction={direction}
      onBack={onCancel}
      backLabel={t('nightPath.backToPaths')}
      title={isNew ? t('nightPath.newTitle') : t('nightPath.editTitle')}
      footer={
        <>
          <PrimaryButton
            label={t('nightPath.save')}
            busy={busy}
            disabled={Boolean(problem) || testing}
            icon={<Check size={20} color="#fff" strokeWidth={3} />}
            onPress={onSave}
          />
          <View style={styles.footerRow}>
            <View style={styles.flex}>
              <SecondaryButton
                label={t('nightPath.test')}
                disabled={busy || testing || !draft.lightRoomIds.length}
                icon={
                  testing ? (
                    <ActivityIndicator color={ss.ink} />
                  ) : (
                    <Lightbulb size={18} color={ss.ink} />
                  )
                }
                onPress={onTest}
              />
            </View>
            <View style={styles.flex}>
              <SecondaryButton label={t('nightPath.cancel')} disabled={busy} onPress={onCancel} />
            </View>
          </View>
        </>
      }
    >
      <SetupField
        label={t('nightPath.name')}
        value={draft.name}
        maxLength={80}
        onChange={(name) => onChange({ ...draft, name })}
      />

      <EditorSection
        icon={<Footprints size={18} color={ss.accent} />}
        title={t('nightPath.triggerTitle', { resident: who })}
      >
        <Text style={styles.hint}>{t('nightPath.triggerHint')}</Text>
        <View accessibilityRole="list">
          {rooms.map((room) => {
            const usable = canTriggerNightPath(room);
            const checked = draft.triggerRoomIds.includes(room.id);
            return (
              <RoomChoice
                key={room.id}
                room={room}
                checked={checked}
                disabled={!usable && !checked}
                detail={
                  usable
                    ? t('nightPath.roomSensors', { count: room.presenceSensors + room.bedSensors })
                    : t('nightPath.roomWithoutSensor')
                }
                onToggle={() =>
                  onChange({ ...draft, triggerRoomIds: toggleRoom(draft.triggerRoomIds, room.id) })
                }
              />
            );
          })}
        </View>
        {bedAvailable ? (
          <View style={styles.switchRow}>
            <BedDouble size={20} color={ss.ink2} />
            <Text style={[styles.flex, styles.switchLabel]}>
              {t('nightPath.includeBedExit', { resident: who })}
            </Text>
            <Switch
              value={draft.includeBedExit}
              onValueChange={(includeBedExit) => onChange({ ...draft, includeBedExit })}
              accessibilityLabel={t('nightPath.includeBedExit', { resident: who })}
              trackColor={{ false: ss.fill2, true: ss.success }}
              thumbColor="#ffffff"
              ios_backgroundColor={ss.fill2}
            />
          </View>
        ) : null}
      </EditorSection>

      <EditorSection
        icon={<MoonStar size={18} color={ss.accent} />}
        title={t('nightPath.windowTitle')}
      >
        <View style={styles.times}>
          <RoutineTimeField
            label={t('nightPath.startLabel')}
            value={formatNightPathTime(draft.startMinute)}
            locale={currentLanguage()}
            onChange={(value) => setTime('startMinute', value)}
          />
          <RoutineTimeField
            label={t('nightPath.endLabel')}
            value={formatNightPathTime(draft.endMinute)}
            locale={currentLanguage()}
            onChange={(value) => setTime('endMinute', value)}
          />
        </View>
        <Text style={styles.hint}>{t('nightPath.windowHint')}</Text>
      </EditorSection>

      <EditorSection
        icon={<Lightbulb size={18} color={ss.accent} />}
        title={t('nightPath.lightsTitle')}
      >
        <Text style={styles.hint}>{t('nightPath.lightsHint')}</Text>
        <View accessibilityRole="list">
          {rooms.map((room) => {
            const checked = draft.lightRoomIds.includes(room.id);
            return (
              <RoomChoice
                key={room.id}
                room={room}
                checked={checked}
                disabled={room.lights === 0 && !checked}
                detail={
                  room.lights
                    ? t('nightPath.roomLights', { count: room.lights })
                    : t('nightPath.roomWithoutLight')
                }
                onToggle={() =>
                  onChange({ ...draft, lightRoomIds: toggleRoom(draft.lightRoomIds, room.id) })
                }
              />
            );
          })}
        </View>
      </EditorSection>

      <EditorSection
        icon={<Sparkles size={18} color={ss.accent} />}
        title={t('nightPath.lightTitle')}
      >
        <View
          style={styles.brightness}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('nightPath.brightness')}
          accessibilityValue={{
            min: NIGHT_PATH_MIN_BRIGHTNESS,
            max: NIGHT_PATH_MAX_BRIGHTNESS,
            now: draft.brightnessPercent,
            text: `${draft.brightnessPercent} %`,
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) =>
            setBrightness(event.nativeEvent.actionName === 'increment' ? 1 : -1)
          }
        >
          <View style={styles.brightnessHead}>
            <Text style={styles.label}>{t('nightPath.brightness')}</Text>
            <Text style={styles.brightnessValue}>{`${draft.brightnessPercent} %`}</Text>
          </View>
          <View style={styles.brightnessControls}>
            <StepButton
              label={t('nightPath.brightnessLess')}
              disabled={draft.brightnessPercent <= NIGHT_PATH_MIN_BRIGHTNESS}
              onPress={() => setBrightness(-1)}
            >
              <Minus size={20} color={ss.ink} strokeWidth={2.6} />
            </StepButton>
            <View style={styles.track}>
              <View style={[styles.trackValue, { width: `${draft.brightnessPercent}%` }]} />
            </View>
            <StepButton
              label={t('nightPath.brightnessMore')}
              disabled={draft.brightnessPercent >= NIGHT_PATH_MAX_BRIGHTNESS}
              onPress={() => setBrightness(1)}
            >
              <Plus size={20} color={ss.ink} strokeWidth={2.6} />
            </StepButton>
          </View>
        </View>
        <Text style={styles.hint}>{t('nightPath.brightnessHint')}</Text>
        <Text style={styles.label}>{t('nightPath.warmth')}</Text>
        <SetupChoices
          label={t('nightPath.warmth')}
          value={String(draft.colorTemperatureKelvin)}
          onChange={(value) => onChange({ ...draft, colorTemperatureKelvin: Number(value) })}
          options={NIGHT_PATH_TEMPERATURES.map((kelvin) => ({
            value: String(kelvin),
            label: t(`nightPath.temperatures.${kelvin}`),
            icon: <View style={[styles.swatch, { backgroundColor: SWATCHES[kelvin] }]} />,
          }))}
        />
        <Text style={styles.hint}>{t('nightPath.simpleLightHint')}</Text>
      </EditorSection>

      <EditorSection icon={<Clock3 size={18} color={ss.accent} />} title={t('nightPath.offTitle')}>
        <SetupChoices
          label={t('nightPath.offTitle')}
          value={String(draft.offDelayMinutes)}
          onChange={(value) => {
            const minutes = NIGHT_PATH_OFF_DELAYS.find((item) => String(item) === value);
            if (minutes) onChange({ ...draft, offDelayMinutes: minutes });
          }}
          options={NIGHT_PATH_OFF_DELAYS.map((minutes) => ({
            value: String(minutes),
            label: t('nightPath.minutes', { count: minutes }),
          }))}
        />
        <Text style={styles.hint}>{t('nightPath.offHint')}</Text>
      </EditorSection>

      <View style={styles.preview} accessible accessibilityLiveRegion="polite">
        <MoonStar size={22} color="#9a6410" />
        <Text style={[styles.flex, styles.previewText]}>
          {nightPathSummary(draft, rooms, resident)}
        </Text>
      </View>

      {error || problem ? <SetupNotice tone="danger">{error || problem}</SetupNotice> : null}
      {testNotice ? <SetupNotice tone="success">{testNotice}</SetupNotice> : null}
    </SetupPage>
  );
}

const SWATCHES: Record<(typeof NIGHT_PATH_TEMPERATURES)[number], string> = {
  2200: '#f6a54a',
  2700: '#f9c77d',
  3000: '#fbe0ad',
};

function EditorSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>{icon}</View>
        <Text style={[styles.flex, styles.sectionTitle]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function RoomChoice({
  room,
  checked,
  disabled,
  detail,
  onToggle,
}: {
  room: NightPathRoom;
  checked: boolean;
  disabled: boolean;
  detail: string;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={`${room.name}. ${detail}`}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.room,
        checked && styles.roomChecked,
        disabled && styles.roomDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
      </View>
      <View style={styles.flex}>
        <Text style={styles.roomName}>{room.name}</Text>
        <Text style={styles.roomDetail}>
          {[detail, room.floorName].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

function StepButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.stepButton,
        disabled && styles.roomDisabled,
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

function SmallButton({
  label,
  accessibilityLabel,
  icon,
  danger,
  quiet,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  icon?: ReactNode;
  danger?: boolean;
  quiet?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.small,
        danger && styles.smallDanger,
        quiet && styles.smallQuiet,
        disabled && styles.roomDisabled,
        pressed && styles.pressed,
      ]}
    >
      {icon}
      <Text
        style={[styles.smallText, danger && styles.smallTextDanger, quiet && styles.smallTextQuiet]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: 14, alignSelf: 'stretch' },
  pressed: { opacity: 0.75 },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  loadingText: { color: ss.ink2, fontSize: 15 },
  empty: {
    alignItems: 'center',
    gap: 8,
    padding: 22,
    borderRadius: 20,
    backgroundColor: ss.fill,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.accentSoft,
  },
  emptyTitle: { color: ss.ink, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: ss.ink2, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ss.line,
    backgroundColor: ss.bg,
  },
  cardPaused: { backgroundColor: ss.fill },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fdf2df',
  },
  cardIconPaused: { backgroundColor: ss.fill2 },
  cardTitle: { color: ss.ink, fontSize: 17, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  status: { fontSize: 14, fontWeight: '600' },
  statusOn: { color: ss.success },
  statusOff: { color: ss.ink2 },
  statusLit: { color: ss.warning },
  cardSummary: { color: ss.ink, fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirm: { gap: 10, padding: 12, borderRadius: 14, backgroundColor: ss.dangerSoft },
  confirmText: { color: ss.danger, fontSize: 15, fontWeight: '700' },
  small: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ss.fill,
  },
  smallDanger: { backgroundColor: ss.danger },
  smallQuiet: { backgroundColor: 'transparent' },
  smallText: { color: ss.ink, fontSize: 15, fontWeight: '600' },
  smallTextDanger: { color: '#fff' },
  smallTextQuiet: { color: ss.danger },
  disclaimer: { color: ss.ink3, fontSize: 13, lineHeight: 19 },
  footerRow: { flexDirection: 'row', gap: 10 },
  section: { gap: 10, alignSelf: 'stretch' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.accentSoft,
  },
  sectionTitle: { color: ss.ink, fontSize: 18, fontWeight: '700' },
  hint: { color: ss.ink2, fontSize: 14, lineHeight: 20 },
  label: { color: ss.ink, fontSize: 15, fontWeight: '700' },
  room: {
    minHeight: 56,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ss.line,
    backgroundColor: ss.bg,
  },
  roomChecked: { borderColor: ss.accent, backgroundColor: ss.accentSoft },
  roomDisabled: { opacity: 0.45 },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: ss.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { borderColor: ss.accent, backgroundColor: ss.accent },
  roomName: { color: ss.ink, fontSize: 16, fontWeight: '700' },
  roomDetail: { color: ss.ink2, fontSize: 13, marginTop: 1 },
  switchRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: ss.fill,
  },
  switchLabel: { color: ss.ink, fontSize: 15, lineHeight: 20 },
  times: { gap: 10 },
  brightness: { gap: 8 },
  brightnessHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brightnessValue: {
    color: ss.ink,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  brightnessControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.fill,
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: ss.fill2,
  },
  trackValue: { height: '100%', borderRadius: 5, backgroundColor: '#f2b35f' },
  swatch: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: '#e0b77a' },
  preview: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#fdf6e8',
    alignSelf: 'stretch',
  },
  previewText: { color: ss.ink, fontSize: 16, lineHeight: 23 },
});
