import { Ionicons } from '@expo/vector-icons';
import type { Installation, RemoteAccessStatus } from '@elise/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import eliseLogo from '../../assets/logo.png';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { isClock } from './clock';
import { RemoteAccessStep } from './RemoteAccessStep';
import { RoutineTimeField } from './RoutineTimeField';
import { SetupSummary } from './SetupSummary';
import { colors } from '../theme';
import { currentLanguage, type Language, t as i18nT, textBlock } from '../i18n';
import { habitLabel, RELATIONS, relationLabel } from './labels';

export type Locale = Language;

type Draft = {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  confirmation: string;
  relation: string;
  usernameEdited: boolean;
  residentFirstName: string;
  residentLastName: string;
  dailyName: string;
  dailyNameEdited: boolean;
  habits: Record<string, { from: string; to: string; unknown: boolean }>;
};

const initialDraft: Draft = {
  firstName: '',
  lastName: '',
  username: '',
  usernameEdited: false,
  password: '',
  confirmation: '',
  relation: '',
  residentFirstName: '',
  residentLastName: '',
  dailyName: '',
  dailyNameEdited: false,
  habits: {
    Lever: { from: '07:30', to: '09:00', unknown: false },
    Coucher: { from: '21:00', to: '23:00', unknown: false },
    Déjeuner: { from: '12:00', to: '13:30', unknown: true },
    Dîner: { from: '19:00', to: '20:30', unknown: true },
  },
};

const previewDraft: Draft = {
  ...initialDraft,
  firstName: 'Camille',
  lastName: 'Martin',
  username: 'camille.martin',
  password: 'Elise-Demo-2026!',
  confirmation: 'Elise-Demo-2026!',
  relation: 'Enfant',
  residentFirstName: 'Jeanne',
  residentLastName: 'Martin',
  dailyName: 'Jeanne',
  habits: {
    Lever: { from: '07:30', to: '09:00', unknown: false },
    Coucher: { from: '21:00', to: '23:00', unknown: false },
    Déjeuner: { from: '12:00', to: '13:30', unknown: true },
    Dîner: { from: '19:00', to: '20:30', unknown: true },
  },
};

function generateUsername(firstName: string, lastName: string): string {
  const normalizePart = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '');
  const first = normalizePart(firstName);
  const last = normalizePart(lastName);
  return first && last ? `${first}.${last}` : '';
}

// Texts of this screen, kept as one block in the catalogs (mobileSetup.copy).
const copyText = () => textBlock('mobileSetup.copy');

function Choice({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
      {active ? <Ionicons name="checkmark-circle" size={20} color={colors.green} /> : null}
    </Pressable>
  );
}

export function MobileSetup({
  server,
  locale,
  previewMode = false,
  onBack,
  onCompleted,
  onPreviewCompleted,
}: {
  server: SavedServer;
  locale: Locale;
  previewMode?: boolean;
  onBack: () => void;
  onCompleted: (token: string, displayName: string) => Promise<void>;
  onPreviewCompleted?: () => void;
}) {
  const t = copyText();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => (previewMode ? previewDraft : initialDraft));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creationPhase, setCreationPhase] = useState<'form' | 'creating' | 'ready'>('form');
  const [creationStep, setCreationStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  // Every step opens at its top, not where the previous one was scrolled to.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step, creationPhase]);
  const [session, setSession] = useState<{ token: string; displayName: string } | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null);
  const [remoteChecked, setRemoteChecked] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const pulse = useRef(new Animated.Value(0)).current;
  const strength = useMemo(
    () =>
      [
        draft.password.length >= 12,
        /[A-Z]/.test(draft.password) && /[a-z]/.test(draft.password),
        /\d/.test(draft.password) && /[^A-Za-z0-9]/.test(draft.password),
      ].filter(Boolean).length,
    [draft.password],
  );

  const patch = (value: Partial<Draft>) => setDraft((current) => ({ ...current, ...value }));
  const patchCaregiverName = (field: 'firstName' | 'lastName', value: string) =>
    setDraft((current) => {
      const nextDraft: Draft = { ...current, [field]: value };
      if (!current.usernameEdited)
        nextDraft.username = generateUsername(nextDraft.firstName, nextDraft.lastName);
      return nextDraft;
    });

  useEffect(() => {
    if (creationPhase === 'form') return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [creationPhase, pulse]);

  useEffect(() => {
    if (step !== 4 || !session || previewMode) return;
    let cancelled = false;
    void mobileApi
      .remoteAccessStatus(server, session.token)
      .then((status) => {
        if (!cancelled) {
          setRemoteStatus(status);
          setRemoteChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteStatus(null);
          setRemoteChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewMode, server, session, step]);

  useEffect(() => {
    if (
      step !== 4 ||
      !session ||
      !remoteStatus ||
      !['AUTHORIZING', 'CONFIGURING'].includes(remoteStatus.state)
    )
      return;
    const timer = setTimeout(() => {
      void mobileApi
        .remoteAccessStatus(server, session.token)
        .then(setRemoteStatus)
        .catch(() => setRemoteStatus(null));
    }, 2500);
    return () => clearTimeout(timer);
  }, [remoteStatus, server, session, step]);

  const playCreation = async () => {
    setCreationPhase('creating');
    setCreationStep(0);
    await new Promise<void>((resolve) => {
      let current = 0;
      const timer = setInterval(() => {
        current += 1;
        setCreationStep(Math.min(current, 3));
        if (current >= 3) {
          clearInterval(timer);
          setTimeout(resolve, 550);
        }
      }, 650);
    });
  };

  const valid = () => {
    if (
      step === 1 &&
      (!draft.firstName ||
        !draft.lastName ||
        !draft.username ||
        !draft.relation ||
        draft.password.length < 12)
    ) {
      setError(t.required);
      return false;
    }
    if (step === 1 && draft.password !== draft.confirmation) {
      setError(t.mismatch);
      return false;
    }
    if (step === 2 && (!draft.residentFirstName || !draft.residentLastName || !draft.dailyName)) {
      setError(t.required);
      return false;
    }
    if (
      step === 3 &&
      Object.values(draft.habits).some(
        (habit) => !habit.unknown && (!isClock(habit.from) || !isClock(habit.to)),
      )
    ) {
      setError(t.required);
      return false;
    }
    setError('');
    return true;
  };

  const runRemoteAction = async (action: 'connect' | 'enable') => {
    if (!session) return;
    setRemoteBusy(true);
    setRemoteError('');
    try {
      setRemoteStatus(await mobileApi.remoteAccessAction(server, session.token, action));
    } catch {
      setRemoteError(t.remoteActionFailed);
    } finally {
      setRemoteBusy(false);
    }
  };

  // Linking Élise to Tailscale needs an administrator session: the account is created
  // when leaving the routines, and the creation screen plays once everything is chosen.
  const createAccount = async () => {
    if (!valid()) return;
    if (previewMode || session) {
      setStep(4);
      return;
    }
    setBusy(true);
    setError('');
    const username = draft.username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');
    const installation: Installation = {
      username,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
      caregiver: {
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        relation: draft.relation,
      },
      resident: {
        firstName: draft.residentFirstName.trim(),
        lastName: draft.residentLastName.trim(),
        dailyName: draft.dailyName.trim(),
        birthDate: '',
        // The server stores the resident's language as one of these two values.
        language: currentLanguage() === 'fr' ? 'Français' : 'English',
        addressAs: 'daily',
        customAddress: '',
      },
      life: [],
      mobility: 'unknown',
      senses: [],
      important: [],
      importantNote: '',
      habits: draft.habits,
    };
    try {
      const result = await mobileApi.bootstrap(server, {
        displayName: `${draft.firstName.trim()} ${draft.lastName.trim()}`,
        password: draft.password,
        installation,
      });
      setSession({ token: result.accessToken, displayName: result.user.displayName });
      setRemoteStatus(null);
      setRemoteChecked(false);
      setStep(4);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setError('');
    await playCreation();
    setCreationPhase('ready');
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (previewMode) {
      onPreviewCompleted?.();
      return;
    }
    if (!session) {
      setCreationPhase('form');
      return;
    }
    try {
      await onCompleted(session.token, session.displayName);
    } catch {
      setCreationPhase('form');
      setError(t.failed);
    }
  };

  const next = () => {
    if (!valid()) return;
    if (step === 3) void createAccount();
    else if (step === 5) void finish();
    else setStep((value) => value + 1);
  };

  // Coming back from Tailscale, the last activation step needs no extra tap.
  const autoEnabled = useRef(false);
  useEffect(() => {
    if (step !== 4 || remoteBusy || autoEnabled.current || remoteStatus?.state !== 'CONFIGURING')
      return;
    autoEnabled.current = true;
    void runRemoteAction('enable');
  }, [remoteBusy, remoteStatus?.state, runRemoteAction, step]);

  if (creationPhase !== 'form') {
    const ready = creationPhase === 'ready';
    return (
      <SafeAreaView style={styles.creationScreen}>
        <View style={styles.creationGlow} />
        <Animated.View
          style={[
            styles.creationLogoWrap,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.06] }) },
              ],
            },
          ]}
        >
          <Image source={eliseLogo} style={styles.creationLogo} resizeMode="contain" />
        </Animated.View>
        <Text style={styles.creationEyebrow}>{ready ? 'ÉLISE OS' : t.steps[0].toUpperCase()}</Text>
        <Text style={styles.creationTitle}>{ready ? t.readyTitle : t.creatingTitle}</Text>
        <Text style={styles.creationIntro}>{ready ? t.readyText : t.creatingIntro}</Text>
        {!ready ? (
          <View style={styles.creationList}>
            {t.creatingSteps.map((label, index) => {
              const complete = index < creationStep;
              const active = index === creationStep;
              return (
                <View key={label} style={styles.creationRow}>
                  <View
                    style={[
                      styles.creationCheck,
                      (complete || active) && styles.creationCheckActive,
                    ]}
                  >
                    {complete ? (
                      <Ionicons name="checkmark" size={15} color="#fff" />
                    ) : active ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.creationRowText,
                      (complete || active) && styles.creationRowTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.readyCheck}>
            <Ionicons name="checkmark" size={34} color="#fff" />
          </View>
        )}
        <Text style={styles.creationLocal}>{previewMode ? t.preview : t.secure}</Text>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.shell}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.shell}>
        <View style={styles.header}>
          {step <= 3 || step === 5 ? (
            <Pressable style={styles.back} onPress={step ? () => setStep(step - 1) : onBack}>
              <Ionicons name="arrow-back" size={20} color={colors.navy} />
            </Pressable>
          ) : (
            <View style={styles.backSpacer} />
          )}
          <Text style={styles.brand}>Élise</Text>
          <Text style={styles.counter}>
            {step + 1}/{t.steps.length}
          </Text>
        </View>
        <View style={styles.progress}>
          <View
            style={[styles.progressValue, { width: `${((step + 1) / t.steps.length) * 100}%` }]}
          />
        </View>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {previewMode ? (
            <View style={styles.previewBadge}>
              <Ionicons name="eye-outline" size={16} color={colors.blue} />
              <Text style={styles.previewBadgeText}>{t.preview}</Text>
            </View>
          ) : null}
          {step > 0 ? <Text style={styles.eyebrow}>{t.eyebrows[step]}</Text> : null}
          <Text style={styles.title}>
            {t.titles[step].replace(
              '{{name}}',
              draft.residentFirstName.trim() || draft.dailyName.trim() || t.profileDefault,
            )}
          </Text>
          <Text style={styles.intro}>{t.intros[step]}</Text>

          {step === 0 ? (
            <>
              <View style={styles.heroCard}>
                <Image source={eliseLogo} style={styles.heroLogo} resizeMode="contain" />
                <Text style={styles.heroName}>{server.instanceName}</Text>
                <Text style={styles.heroUrl}>{server.url}</Text>
              </View>
              <View style={styles.welcomePills}>
                <View style={styles.welcomePill}>
                  <Ionicons name="shield-checkmark-outline" size={15} color={colors.green} />
                  <Text style={styles.welcomePillText}>{t.localBadge}</Text>
                </View>
                <View style={styles.welcomePill}>
                  <Ionicons name="eye-off-outline" size={15} color={colors.blue} />
                  <Text style={styles.welcomePillText}>{t.privacyBadge}</Text>
                </View>
                <View style={styles.welcomePill}>
                  <Ionicons name="people-outline" size={15} color={colors.blue} />
                  <Text style={styles.welcomePillText}>{t.caregiverBadge}</Text>
                </View>
              </View>
            </>
          ) : null}

          {step === 1 ? (
            <View style={styles.fields}>
              <TextInput
                style={styles.input}
                placeholder={t.firstName}
                value={draft.firstName}
                onChangeText={(firstName) => patchCaregiverName('firstName', firstName)}
              />
              <TextInput
                style={styles.input}
                placeholder={t.lastName}
                value={draft.lastName}
                onChangeText={(lastName) => patchCaregiverName('lastName', lastName)}
              />
              <TextInput
                style={styles.input}
                placeholder={t.username}
                autoCapitalize="none"
                value={draft.username}
                onChangeText={(username) => patch({ username, usernameEdited: true })}
              />
              <Text style={styles.label}>{t.relation}</Text>
              <View style={styles.choiceGrid}>
                {RELATIONS.map(({ value }) => (
                  <Choice
                    key={value}
                    active={draft.relation === value}
                    label={relationLabel(value)}
                    onPress={() => patch({ relation: value })}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder={t.password}
                secureTextEntry
                value={draft.password}
                onChangeText={(password) => patch({ password })}
              />
              <View style={styles.strength}>
                {[1, 2, 3].map((value) => (
                  <View
                    key={value}
                    style={[styles.strengthBar, value <= strength && styles.strengthOn]}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder={t.confirm}
                secureTextEntry
                value={draft.confirmation}
                onChangeText={(confirmation) => patch({ confirmation })}
              />
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.residentLayout}>
              <View style={styles.residentPreview}>
                <View style={styles.residentPreviewMark}>
                  <Ionicons name="heart-outline" size={21} color="#fff" />
                </View>
                <Text style={styles.residentPreviewKicker}>{t.profileKicker}</Text>
                <Text style={styles.residentPreviewName}>
                  {draft.dailyName || t.profileDefault}
                </Text>
                <Text style={styles.residentPreviewFullName}>
                  {[draft.residentFirstName, draft.residentLastName].filter(Boolean).join(' ') ||
                    t.profileNameEmpty}
                </Text>
                <View style={styles.residentPreviewNote}>
                  <Ionicons name="sparkles-outline" size={16} color="#D0E0BF" />
                  <Text style={styles.residentPreviewNoteText}>{t.profileHint}</Text>
                </View>
              </View>
              <View style={styles.residentForm}>
                <View style={styles.residentFormHeading}>
                  <Text style={styles.residentFormTitle}>{t.profileDetails}</Text>
                  <Text style={styles.residentFormHint}>{t.profileDetailsHint}</Text>
                </View>
                <Text style={styles.fieldLabel}>{t.firstName}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={i18nT('mobileSetup.eGElise')}
                  value={draft.residentFirstName}
                  onChangeText={(residentFirstName) =>
                    setDraft((current) => ({
                      ...current,
                      residentFirstName,
                      dailyName:
                        current.dailyNameEdited && current.dailyName.trim()
                          ? current.dailyName
                          : residentFirstName,
                    }))
                  }
                />
                <Text style={styles.fieldLabel}>{t.lastName}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={i18nT('mobileSetup.eGMartin')}
                  value={draft.residentLastName}
                  onChangeText={(residentLastName) => patch({ residentLastName })}
                />
                <Text style={styles.fieldLabel}>{t.dailyName}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={i18nT('mobileSetup.eGLily')}
                  value={draft.dailyName}
                  onChangeText={(dailyName) => patch({ dailyName, dailyNameEdited: true })}
                />
              </View>
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.routinesSection}>
              <View style={styles.routinesOverview}>
                <View>
                  <Text style={styles.routinesOverviewTitle}>{t.routineCount}</Text>
                  <Text style={styles.routinesOverviewHint}>{t.routineHint}</Text>
                </View>
                <View style={styles.routinesCount}>
                  <Text style={styles.routinesCountText}>4</Text>
                </View>
              </View>
              <View style={styles.fields}>
                {Object.entries(draft.habits).map(([name, habit]) => {
                  const displayName = habitLabel(name);
                  const iconName =
                    name === 'Lever'
                      ? 'sunny-outline'
                      : name === 'Coucher'
                        ? 'moon-outline'
                        : name === 'Déjeuner'
                          ? 'cafe-outline'
                          : 'restaurant-outline';
                  return (
                    <View style={styles.habit} key={name}>
                      <View style={styles.habitHeader}>
                        <View style={styles.habitIcon}>
                          <Ionicons name={iconName} size={19} color={colors.green} />
                        </View>
                        <View style={styles.habitHeadingCopy}>
                          <Text style={styles.habitName}>{displayName}</Text>
                          <Text style={styles.habitSummary}>
                            {habit.unknown ? t.routineLearn : `${habit.from} – ${habit.to}`}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.routineTimes}>
                        <RoutineTimeField
                          label={t.routineFrom}
                          value={habit.from}
                          disabled={habit.unknown}
                          locale={locale}
                          onChange={(from) =>
                            patch({ habits: { ...draft.habits, [name]: { ...habit, from } } })
                          }
                        />
                        <RoutineTimeField
                          label={t.routineUntil}
                          value={habit.to}
                          disabled={habit.unknown}
                          locale={locale}
                          onChange={(to) =>
                            patch({ habits: { ...draft.habits, [name]: { ...habit, to } } })
                          }
                        />
                      </View>
                      <Choice
                        active={habit.unknown}
                        label={t.unknown}
                        onPress={() =>
                          patch({
                            habits: {
                              ...draft.habits,
                              [name]: { ...habit, unknown: !habit.unknown },
                            },
                          })
                        }
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.routineNote}>
                <Ionicons name="sparkles-outline" size={18} color={colors.green} />
                <Text style={styles.routineNoteText}>
                  <Text style={styles.routineNoteTitle}>{i18nT('mobileSetup.nothingIsFixed')}</Text>
                  {t.routineNote}
                </Text>
              </View>
            </View>
          ) : null}

          {step === 4 ? (
            <RemoteAccessStep
              locale={locale}
              status={remoteStatus}
              checked={remoteChecked}
              busy={remoteBusy}
              error={remoteError}
              previewMode={previewMode}
              onConnect={() => void runRemoteAction('connect')}
              onEnable={() => void runRemoteAction('enable')}
              onError={() => setRemoteError(t.remoteActionFailed)}
            />
          ) : null}

          {step === 5 ? (
            <SetupSummary
              locale={locale}
              caregiver={{
                name: `${draft.firstName.trim()} ${draft.lastName.trim()}`,
                relation: draft.relation,
                username: draft.username,
              }}
              resident={{
                dailyName: draft.dailyName.trim(),
                fullName: `${draft.residentFirstName.trim()} ${draft.residentLastName.trim()}`,
              }}
              habits={draft.habits}
              remoteReady={remoteStatus?.state === 'READY'}
            />
          ) : null}

          {error ? (
            <View style={styles.error}>
              <Ionicons name="alert-circle-outline" size={19} color={colors.red} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <Pressable
            style={styles.primary}
            disabled={busy || (step === 5 && !previewMode && !session)}
            onPress={step === 0 ? () => setStep(1) : next}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.primaryText}>
                  {step === 0
                    ? t.start
                    : step === 4
                      ? t.remoteContinue
                      : step === 5
                        ? previewMode
                          ? t.previewFinish
                          : t.finish
                        : t.next}
                </Text>
                <Ionicons name="arrow-forward" size={19} color="#fff" />
              </>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.cream },
  header: {
    height: 62,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backSpacer: { width: 40, height: 40 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { color: colors.navy, fontFamily: 'Georgia', fontWeight: '600', fontSize: 22 },
  counter: { width: 40, textAlign: 'right', color: colors.muted, fontWeight: '700' },
  progress: { height: 3, backgroundColor: colors.line },
  progressValue: { height: 3, backgroundColor: colors.accent },
  content: { padding: 22, paddingBottom: 50 },
  previewBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    backgroundColor: '#E5EEF4',
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginBottom: 16,
  },
  previewBadgeText: { color: colors.blue, fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  eyebrow: {
    color: colors.accent,
    fontSize: 13,
    letterSpacing: 0.6,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 8,
  },
  title: { color: colors.navy, fontFamily: 'Georgia', fontSize: 32, lineHeight: 40 },
  intro: { color: colors.muted, fontSize: 17, lineHeight: 26, marginTop: 11, marginBottom: 24 },
  heroCard: {
    backgroundColor: colors.paper,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 22,
  },
  heroLogo: { width: 112, height: 112, marginBottom: 15 },
  heroName: { color: colors.navy, fontFamily: 'Georgia', fontSize: 26 },
  heroUrl: { color: colors.muted, marginTop: 5 },
  welcomePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22,
  },
  welcomePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  welcomePillText: { color: colors.navy, fontSize: 14, fontWeight: '700' },
  fields: { gap: 12, marginBottom: 20 },
  residentLayout: { gap: 13, marginBottom: 8 },
  residentPreview: {
    borderRadius: 19,
    backgroundColor: colors.blue,
    padding: 19,
    overflow: 'hidden',
  },
  residentPreviewMark: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 17,
  },
  residentPreviewKicker: {
    color: '#C8D9DC',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  residentPreviewName: {
    color: '#fff',
    fontFamily: 'Georgia',
    fontSize: 29,
    marginTop: 7,
  },
  residentPreviewFullName: { color: '#D6E0E2', fontSize: 15, marginTop: 5 },
  residentPreviewNote: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,.16)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 17,
    paddingTop: 12,
  },
  residentPreviewNoteText: { flex: 1, color: '#F4F7F4', fontSize: 14, lineHeight: 22 },
  residentForm: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    padding: 18,
  },
  residentFormHeading: { marginBottom: 10 },
  residentFormTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 23 },
  residentFormHint: { color: colors.muted, fontSize: 14, marginTop: 4 },
  // The resident form has no gap: the label owns the space above its field.
  fieldLabel: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 7,
  },
  input: {
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    color: colors.navy,
    paddingHorizontal: 15,
    fontSize: 17,
  },
  label: { color: colors.navy, fontWeight: '800', marginTop: 8, marginBottom: 2 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  choiceActive: { borderColor: '#9BB8A6', backgroundColor: '#E8F1EB' },
  choiceText: { color: colors.navy, flexShrink: 1 },
  choiceTextActive: { fontWeight: '700' },
  strength: { flexDirection: 'row', gap: 5 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  strengthOn: { backgroundColor: colors.green },
  routinesSection: { gap: 11, marginBottom: 10 },
  routinesOverview: {
    minHeight: 58,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E2E8E2',
    backgroundColor: '#F5F7F3',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routinesOverviewTitle: { color: colors.navy, fontSize: 15, fontWeight: '800' },
  routinesOverviewHint: { color: colors.muted, fontSize: 13, marginTop: 3 },
  routinesCount: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#E4EEE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routinesCountText: { color: colors.green, fontSize: 17, fontWeight: '900' },
  habit: {
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: 13,
  },
  habitHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  habitIcon: {
    width: 41,
    height: 41,
    borderRadius: 14,
    backgroundColor: '#EAF2EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitHeadingCopy: { flex: 1 },
  habitName: { color: colors.navy, fontSize: 17, fontWeight: '800', marginTop: 2 },
  habitSummary: { color: colors.muted, fontSize: 13, marginTop: 3 },
  routineTimes: { gap: 8 },
  routineNote: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E4ECE4',
    backgroundColor: '#EDF3F0',
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  routineNoteText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 21 },
  routineNoteTitle: { color: colors.navy, fontWeight: '800' },
  error: {
    flexDirection: 'row',
    gap: 8,
    padding: 13,
    borderRadius: 12,
    backgroundColor: '#F8E7E4',
    marginBottom: 14,
  },
  errorText: { color: colors.red, flex: 1, lineHeight: 19 },
  primary: {
    minHeight: 55,
    borderRadius: 15,
    backgroundColor: colors.blue,
    paddingHorizontal: 19,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  creationScreen: {
    flex: 1,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    overflow: 'hidden',
  },
  creationGlow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(255,255,255,.06)',
    top: -170,
  },
  creationLogoWrap: {
    width: 150,
    height: 150,
    borderRadius: 42,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  creationLogo: { width: 126, height: 126 },
  creationEyebrow: {
    color: '#A9C4D5',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginBottom: 9,
  },
  creationTitle: {
    color: '#fff',
    fontFamily: 'Georgia',
    fontSize: 31,
    lineHeight: 39,
    textAlign: 'center',
  },
  creationIntro: {
    color: '#CAD6DF',
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
    marginTop: 11,
    maxWidth: 330,
  },
  creationList: { width: '100%', maxWidth: 340, marginTop: 31, gap: 14 },
  creationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  creationCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creationCheckActive: { backgroundColor: colors.green, borderColor: colors.green },
  creationRowText: { color: '#7E94A7', fontSize: 17 },
  creationRowTextActive: { color: '#fff', fontWeight: '700' },
  readyCheck: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
  },
  creationLocal: {
    position: 'absolute',
    bottom: 34,
    color: '#90A6B8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
