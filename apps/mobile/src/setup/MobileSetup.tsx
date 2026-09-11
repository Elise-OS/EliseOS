import { Ionicons } from '@expo/vector-icons';
import type { Installation } from '@michel/contracts';
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

export type Locale = 'fr' | 'en';

type Draft = {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  confirmation: string;
  relation: string;
  residentFirstName: string;
  residentLastName: string;
  dailyName: string;
  birthDate: string;
  life: string[];
  mobility: string;
  senses: string[];
  habits: Record<string, { from: string; to: string; unknown: boolean }>;
};

const initialDraft: Draft = {
  firstName: '',
  lastName: '',
  username: '',
  password: '',
  confirmation: '',
  relation: '',
  residentFirstName: '',
  residentLastName: '',
  dailyName: '',
  birthDate: '',
  life: [],
  mobility: '',
  senses: [],
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
  birthDate: '1942-06-18',
  life: ['alone', 'visits'],
  mobility: 'independent',
  senses: [],
  habits: {
    Lever: { from: '07:30', to: '09:00', unknown: false },
    Coucher: { from: '21:00', to: '23:00', unknown: false },
    Déjeuner: { from: '12:00', to: '13:30', unknown: true },
    Dîner: { from: '19:00', to: '20:30', unknown: true },
  },
};

const colors = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  cream: '#F5F0E8',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  red: '#B74747',
};

const copy = {
  fr: {
    steps: ['Bienvenue', 'Vous', 'Résident', 'Quotidien', 'Habitudes'],
    eyebrows: [
      'INSTALLATION ÉLISE OS',
      'VOTRE RÔLE',
      'PROFIL D’ACCOMPAGNEMENT',
      'SON QUOTIDIEN',
      'PREMIERS REPÈRES',
    ],
    titles: [
      'Préparons Élise pour une personne qui compte.',
      'Créons votre accès',
      'Qui Élise va-t-elle accompagner ?',
      'Comment vit le résident ?',
      'À quoi ressemble une journée habituelle ?',
    ],
    intros: [
      'La création de votre environnement se fait ici, directement sur votre téléphone.',
      'Vous serez le gestionnaire principal de cette installation.',
      'Ces quelques repères permettent à Élise de s’adresser naturellement au résident.',
      'Sélectionnez les éléments qui correspondent à sa vie quotidienne.',
      'Des plages approximatives suffisent. Élise les affinera progressivement.',
    ],
    start: 'Commencer l’installation',
    next: 'Continuer',
    finish: 'Créer mon environnement',
    back: 'Retour',
    firstName: 'Prénom',
    lastName: 'Nom',
    username: 'Identifiant',
    relation: 'Lien avec le résident',
    password: 'Mot de passe · 12 caractères minimum',
    confirm: 'Confirmer le mot de passe',
    dailyName: 'Prénom utilisé au quotidien',
    birthDate: 'Date de naissance · AAAA-MM-JJ (facultatif)',
    life: 'Mode de vie',
    mobility: 'Mobilité',
    senses: 'Confort sensoriel · facultatif',
    unknown: 'Je ne sais pas',
    secure: 'Vos données restent stockées localement sur cette installation Élise OS.',
    required: 'Complétez les champs obligatoires avant de continuer.',
    mismatch: 'Les mots de passe ne correspondent pas.',
    failed: 'Élise n’a pas pu créer l’environnement. Vérifiez la connexion puis réessayez.',
    preview: 'MODE DÉMO · aucune donnée ne sera envoyée',
    previewFinish: 'Terminer l’aperçu',
    creatingTitle: 'Création de votre environnement',
    creatingIntro: 'Élise prépare votre espace personnel et sécurisé.',
    creatingSteps: [
      'Création du foyer',
      'Préparation du profil résident',
      'Configuration des habitudes',
      'Ouverture du dashboard',
    ],
    readyTitle: 'Votre environnement est prêt',
    readyText: 'Bienvenue chez Élise. Ouverture du dashboard…',
  },
  en: {
    steps: ['Welcome', 'You', 'Resident', 'Daily life', 'Routines'],
    eyebrows: ['ÉLISE OS SETUP', 'YOUR ROLE', 'SUPPORT PROFILE', 'DAILY LIFE', 'FIRST ROUTINES'],
    titles: [
      'Set up Élise for someone who matters.',
      'Create your access',
      'Who will Élise support?',
      'What is the resident’s daily life like?',
      'What does a typical day look like?',
    ],
    intros: [
      'Create your environment here, directly on your phone.',
      'You will be the primary manager for this installation.',
      'These details help Élise address the resident naturally.',
      'Select the items that match their daily life.',
      'Approximate time ranges are enough. Élise will refine them over time.',
    ],
    start: 'Start setup',
    next: 'Continue',
    finish: 'Create my environment',
    back: 'Back',
    firstName: 'First name',
    lastName: 'Last name',
    username: 'Username',
    relation: 'Relationship to resident',
    password: 'Password · 12 characters minimum',
    confirm: 'Confirm password',
    dailyName: 'Name used every day',
    birthDate: 'Date of birth · YYYY-MM-DD (optional)',
    life: 'Living situation',
    mobility: 'Mobility',
    senses: 'Sensory comfort · optional',
    unknown: 'I don’t know',
    secure: 'Your data stays locally on this Élise OS installation.',
    required: 'Complete the required fields before continuing.',
    mismatch: 'The passwords do not match.',
    failed: 'Élise could not create the environment. Check the connection and try again.',
    preview: 'DEMO MODE · no data will be sent',
    previewFinish: 'Finish preview',
    creatingTitle: 'Creating your environment',
    creatingIntro: 'Élise is preparing your private and secure space.',
    creatingSteps: [
      'Creating the home',
      'Preparing the resident profile',
      'Setting up routines',
      'Opening the dashboard',
    ],
    readyTitle: 'Your environment is ready',
    readyText: 'Welcome to Élise. Opening the dashboard…',
  },
} as const;

const options = {
  relation: [
    ['Enfant', 'Child'],
    ['Petit-enfant', 'Grandchild'],
    ['Conjoint', 'Partner'],
    ['Ami(e)', 'Friend'],
    ['Professionnel', 'Professional'],
    ['Autre', 'Other'],
  ],
  life: [
    ['alone', 'Vit seul', 'Lives alone'],
    ['partner', 'Vit avec son conjoint', 'Lives with a partner'],
    ['relative', 'Vit avec un proche', 'Lives with a relative'],
    ['home_help', 'Reçoit une aide à domicile', 'Receives home help'],
    ['visits', 'Reçoit des visites régulières', 'Receives regular visits'],
    ['pet', 'Possède un animal', 'Has a pet'],
  ],
  mobility: [
    ['independent', 'Se déplace seul', 'Moves independently'],
    ['cane', 'Utilise une canne', 'Uses a cane'],
    ['walker', 'Utilise un déambulateur', 'Uses a walker'],
    ['wheelchair', 'Utilise un fauteuil roulant', 'Uses a wheelchair'],
  ],
  senses: [
    ['hearing', 'Difficultés auditives', 'Hearing difficulties'],
    ['vision', 'Difficultés visuelles', 'Visual difficulties'],
  ],
} as const;

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
  const t = copy[locale];
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => (previewMode ? previewDraft : initialDraft));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creationPhase, setCreationPhase] = useState<'form' | 'creating' | 'ready'>('form');
  const [creationStep, setCreationStep] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;
  const residentName =
    draft.dailyName ||
    draft.residentFirstName ||
    (locale === 'fr' ? 'le résident' : 'the resident');
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
  const toggle = (key: 'life' | 'senses', value: string) =>
    patch({
      [key]: draft[key].includes(value)
        ? draft[key].filter((item) => item !== value)
        : [...draft[key], value],
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
    if (step === 3 && !draft.mobility) {
      setError(t.required);
      return false;
    }
    setError('');
    return true;
  };

  const submit = async () => {
    if (!valid()) return;
    if (previewMode) {
      await playCreation();
      setCreationPhase('ready');
      setTimeout(() => onPreviewCompleted?.(), 1100);
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
        birthDate: draft.birthDate.trim(),
        language: locale === 'fr' ? 'Français' : 'English',
        addressAs: 'daily',
        customAddress: '',
      },
      life: draft.life as Installation['life'],
      mobility: draft.mobility as Installation['mobility'],
      senses: draft.senses as Installation['senses'],
      important: [],
      importantNote: '',
      habits: draft.habits,
    };
    try {
      const [result] = await Promise.all([
        mobileApi.bootstrap(server, {
          displayName: `${draft.firstName.trim()} ${draft.lastName.trim()}`,
          password: draft.password,
          installation,
        }),
        playCreation(),
      ]);
      setCreationPhase('ready');
      await new Promise((resolve) => setTimeout(resolve, 900));
      await onCompleted(result.accessToken, result.user.displayName);
    } catch {
      setCreationPhase('form');
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!valid()) return;
    if (step === 4) void submit();
    else setStep((value) => value + 1);
  };

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
          <Pressable style={styles.back} onPress={step ? () => setStep(step - 1) : onBack}>
            <Ionicons name="arrow-back" size={20} color={colors.navy} />
          </Pressable>
          <Text style={styles.brand}>Élise</Text>
          <Text style={styles.counter}>
            {step + 1}/{t.steps.length}
          </Text>
        </View>
        <View style={styles.progress}>
          <View style={[styles.progressValue, { width: `${((step + 1) / 5) * 100}%` }]} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {previewMode ? (
            <View style={styles.previewBadge}>
              <Ionicons name="eye-outline" size={16} color={colors.blue} />
              <Text style={styles.previewBadgeText}>{t.preview}</Text>
            </View>
          ) : null}
          <Text style={styles.eyebrow}>{t.eyebrows[step]}</Text>
          <Text style={styles.title}>{t.titles[step]}</Text>
          <Text style={styles.intro}>{t.intros[step]}</Text>

          {step === 0 ? (
            <View style={styles.heroCard}>
              <Image source={eliseLogo} style={styles.heroLogo} resizeMode="contain" />
              <Text style={styles.heroName}>{server.instanceName}</Text>
              <Text style={styles.heroUrl}>{server.url}</Text>
              <View style={styles.localLine}>
                <Ionicons name="shield-checkmark-outline" size={19} color={colors.green} />
                <Text>{t.secure}</Text>
              </View>
            </View>
          ) : null}

          {step === 1 ? (
            <View style={styles.fields}>
              <TextInput
                style={styles.input}
                placeholder={t.firstName}
                value={draft.firstName}
                onChangeText={(firstName) => patch({ firstName })}
              />
              <TextInput
                style={styles.input}
                placeholder={t.lastName}
                value={draft.lastName}
                onChangeText={(lastName) => patch({ lastName })}
              />
              <TextInput
                style={styles.input}
                placeholder={t.username}
                autoCapitalize="none"
                value={draft.username}
                onChangeText={(username) => patch({ username })}
              />
              <Text style={styles.label}>{t.relation}</Text>
              <View style={styles.choiceGrid}>
                {options.relation.map(([fr, en]) => (
                  <Choice
                    key={fr}
                    active={draft.relation === fr}
                    label={locale === 'fr' ? fr : en}
                    onPress={() => patch({ relation: fr })}
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
            <View style={styles.fields}>
              <TextInput
                style={styles.input}
                placeholder={t.firstName}
                value={draft.residentFirstName}
                onChangeText={(residentFirstName) =>
                  patch({ residentFirstName, dailyName: draft.dailyName || residentFirstName })
                }
              />
              <TextInput
                style={styles.input}
                placeholder={t.lastName}
                value={draft.residentLastName}
                onChangeText={(residentLastName) => patch({ residentLastName })}
              />
              <TextInput
                style={styles.input}
                placeholder={t.dailyName}
                value={draft.dailyName}
                onChangeText={(dailyName) => patch({ dailyName })}
              />
              <TextInput
                style={styles.input}
                placeholder={t.birthDate}
                keyboardType="numbers-and-punctuation"
                value={draft.birthDate}
                onChangeText={(birthDate) => patch({ birthDate })}
              />
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.fields}>
              <Text style={styles.label}>{t.life}</Text>
              {options.life.map(([value, fr, en]) => (
                <Choice
                  key={value}
                  active={draft.life.includes(value)}
                  label={locale === 'fr' ? fr : en}
                  onPress={() => toggle('life', value)}
                />
              ))}
              <Text style={styles.label}>{t.mobility}</Text>
              {options.mobility.map(([value, fr, en]) => (
                <Choice
                  key={value}
                  active={draft.mobility === value}
                  label={locale === 'fr' ? fr : en}
                  onPress={() => patch({ mobility: value })}
                />
              ))}
              <Text style={styles.label}>{t.senses}</Text>
              {options.senses.map(([value, fr, en]) => (
                <Choice
                  key={value}
                  active={draft.senses.includes(value)}
                  label={locale === 'fr' ? fr : en}
                  onPress={() => toggle('senses', value)}
                />
              ))}
            </View>
          ) : null}

          {step === 4 ? (
            <View style={styles.fields}>
              {Object.entries(draft.habits).map(([name, habit]) => {
                const displayName =
                  locale === 'fr'
                    ? name
                    : ({ Lever: 'Wake up', Coucher: 'Bedtime', Déjeuner: 'Lunch', Dîner: 'Dinner' }[
                        name
                      ] ?? name);
                return (
                  <View style={styles.habit} key={name}>
                    <Text style={styles.habitName}>{displayName}</Text>
                    <View style={styles.timeRow}>
                      <TextInput
                        style={[styles.timeInput, habit.unknown && styles.disabled]}
                        editable={!habit.unknown}
                        value={habit.from}
                        onChangeText={(from) =>
                          patch({ habits: { ...draft.habits, [name]: { ...habit, from } } })
                        }
                      />
                      <Text>—</Text>
                      <TextInput
                        style={[styles.timeInput, habit.unknown && styles.disabled]}
                        editable={!habit.unknown}
                        value={habit.to}
                        onChangeText={(to) =>
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
          ) : null}

          {error ? (
            <View style={styles.error}>
              <Ionicons name="alert-circle-outline" size={19} color={colors.red} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <Pressable
            style={styles.primary}
            disabled={busy}
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
  brand: { color: colors.navy, fontFamily: 'Georgia', fontWeight: '600', fontSize: 20 },
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
  previewBadgeText: { color: colors.blue, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 8,
  },
  title: { color: colors.navy, fontFamily: 'Georgia', fontSize: 31, lineHeight: 38 },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 11, marginBottom: 24 },
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
  heroName: { color: colors.navy, fontFamily: 'Georgia', fontSize: 24 },
  heroUrl: { color: colors.muted, marginTop: 5 },
  localLine: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  fields: { gap: 12, marginBottom: 20 },
  input: {
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    color: colors.navy,
    paddingHorizontal: 15,
    fontSize: 15,
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
  habit: {
    padding: 16,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: 12,
  },
  habitName: { color: colors.navy, fontSize: 17, fontWeight: '800' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeInput: {
    flex: 1,
    minHeight: 45,
    textAlign: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.navy,
  },
  disabled: { opacity: 0.45 },
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
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
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
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 9,
  },
  creationTitle: {
    color: '#fff',
    fontFamily: 'Georgia',
    fontSize: 30,
    lineHeight: 37,
    textAlign: 'center',
  },
  creationIntro: {
    color: '#CAD6DF',
    fontSize: 14,
    lineHeight: 21,
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
  creationRowText: { color: '#7E94A7', fontSize: 14 },
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
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
