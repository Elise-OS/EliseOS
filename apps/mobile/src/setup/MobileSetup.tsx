import { Ionicons } from '@expo/vector-icons';
import type { Installation, RemoteAccessStatus } from '@michel/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
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

const copy = {
  fr: {
    steps: ['Bienvenue', 'Vous', 'Résident', 'Apprentissage', 'Accès privé', 'Terminé'],
    eyebrows: [
      '',
      'VOTRE RÔLE',
      'PROFIL D’ACCOMPAGNEMENT',
      'PREMIERS REPÈRES',
      'OPTION RECOMMANDÉE',
      'ENVIRONNEMENT CRÉÉ',
    ],
    titles: [
      'Préparons Élise pour une personne qui compte.',
      'Créons votre accès',
      'Qui Élise va-t-elle accompagner ?',
      'À quoi ressemble une journée habituelle ?',
      'Retrouvez Élise, même à distance',
      'Votre environnement Élise est créé',
    ],
    intros: [
      'La création de votre environnement se fait ici, directement sur votre téléphone.',
      'Vous serez le gestionnaire principal de cette installation.',
      'Ces quelques repères permettent à Élise de s’adresser naturellement au résident.',
      'Des plages approximatives suffisent. Élise les affinera progressivement.',
      'L’accès passe par votre espace privé Tailscale. Il peut être activé maintenant ou plus tard depuis les réglages.',
      'Découvrez maintenant les espaces essentiels de l’application. Vous créerez ensuite le logement accompagné pas à pas.',
    ],
    start: 'Commencer l’installation',
    next: 'Continuer',
    finish: 'Créer mon environnement',
    remoteContinue: 'Continuer',
    done: 'Découvrir Élise',
    back: 'Retour',
    firstName: 'Prénom',
    lastName: 'Nom',
    username: 'Identifiant · ex. paul.breton',
    relation: 'Lien avec le résident',
    password: 'Mot de passe · 12 caractères minimum',
    confirm: 'Confirmer le mot de passe',
    dailyName: 'Prénom utilisé au quotidien',
    unknown: 'Je ne sais pas encore',
    profileKicker: 'UNE PERSONNE, AVANT TOUT',
    profileDefault: 'Votre proche',
    profileNameEmpty: 'Son nom apparaîtra ici',
    profileHint: 'Élise utilisera ce prénom pour s’adresser à la personne.',
    profileDetails: 'Ses repères',
    profileDetailsHint: 'Ces informations pourront évoluer.',
    routineCount: '4 moments de la journée',
    routineHint: 'Des repères souples, à votre rythme',
    routineFrom: 'À partir de',
    routineUntil: 'Jusqu’à',
    routineConnector: 'à',
    routineLearn: 'Élise l’apprendra progressivement',
    routineNote: 'Ces horaires sont des repères de départ, jamais des règles rigides.',
    localBadge: 'Entièrement local',
    privacyBadge: 'Respecte votre intimité',
    caregiverBadge: 'Pensé pour les proches aidants',
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
      'Finalisation de l’environnement',
    ],
    readyTitle: 'Votre environnement est prêt',
    readyText: 'L’environnement est créé. L’accès privé peut être activé à l’étape suivante.',
    remoteChecking: 'Vérification de l’accès privé…',
    remoteUnavailable: 'Le service d’accès privé n’est pas disponible sur cet appareil.',
    remoteSignedOut:
      'Reliez Élise à Tailscale. Vous pourrez aussi le faire plus tard dans les réglages.',
    remoteAuthorizing: 'Validez la connexion dans Tailscale pour continuer l’activation.',
    remoteConfiguring: 'Élise prépare votre adresse privée.',
    remoteReady: 'L’accès privé est activé.',
    remoteDegraded:
      'L’accès privé demande une vérification. Vous pourrez reprendre dans les réglages.',
    remoteConnect: 'Activer l’accès privé',
    remoteApprove: 'Ouvrir Tailscale',
    remoteEnable: 'Terminer l’activation',
    remoteActionFailed:
      'Cette action est indisponible pour le moment. Vous pourrez réessayer dans les réglages.',
    remoteAddress: 'Adresse privée',
  },
  en: {
    steps: ['Welcome', 'You', 'Resident', 'Learning', 'Private access', 'Done'],
    eyebrows: [
      '',
      'YOUR ROLE',
      'SUPPORT PROFILE',
      'FIRST ROUTINES',
      'RECOMMENDED OPTION',
      'ENVIRONMENT CREATED',
    ],
    titles: [
      'Set up Élise for someone who matters.',
      'Create your access',
      'Who will Élise support?',
      'What does a typical day look like?',
      'Reach Élise while away from home',
      'Your Élise environment is ready',
    ],
    intros: [
      'Create your environment here, directly on your phone.',
      'You will be the primary manager for this installation.',
      'These details help Élise address the resident naturally.',
      'Approximate time ranges are enough. Élise will refine them over time.',
      'Access uses your private Tailscale network. Enable it now or later from settings.',
      'Discover the essential areas of the app. You can create the home step by step afterward.',
    ],
    start: 'Start setup',
    next: 'Continue',
    finish: 'Create my environment',
    remoteContinue: 'Continue',
    done: 'Discover Élise',
    back: 'Back',
    firstName: 'First name',
    lastName: 'Last name',
    username: 'Username · e.g. paul.breton',
    relation: 'Relationship to resident',
    password: 'Password · 12 characters minimum',
    confirm: 'Confirm password',
    dailyName: 'Name used every day',
    profileKicker: 'A PERSON, FIRST AND FOREMOST',
    profileDefault: 'Your loved one',
    profileNameEmpty: 'Their full name will appear here',
    profileHint: 'Élise will use this name when speaking to them.',
    profileDetails: 'A few details',
    profileDetailsHint: 'You can update these details later.',
    routineCount: '4 moments in the day',
    routineHint: 'Flexible starting points, at your pace',
    routineFrom: 'From',
    routineUntil: 'Until',
    routineConnector: 'to',
    routineLearn: 'Élise can learn this over time',
    routineNote: 'These times are starting points, never rigid rules.',
    unknown: 'I don’t know',
    localBadge: 'Entirely local',
    privacyBadge: 'Privacy comes first',
    caregiverBadge: 'Designed for caregivers',
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
      'Finalizing the environment',
    ],
    readyTitle: 'Your environment is ready',
    readyText: 'The environment is ready. You can set up private access in the next step.',
    remoteChecking: 'Checking private access…',
    remoteUnavailable: 'The private access service is not available on this device.',
    remoteSignedOut: 'Connect Élise to Tailscale. You can also do this later in settings.',
    remoteAuthorizing: 'Approve the connection in Tailscale to continue setup.',
    remoteConfiguring: 'Élise is preparing your private address.',
    remoteReady: 'Private access is active.',
    remoteDegraded: 'Private access needs attention. You can continue from settings later.',
    remoteConnect: 'Enable private access',
    remoteApprove: 'Open Tailscale',
    remoteEnable: 'Finish activation',
    remoteActionFailed: 'This action is unavailable right now. You can retry in settings later.',
    remoteAddress: 'Private address',
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

  const submit = async () => {
    if (!valid()) return;
    if (previewMode) {
      await playCreation();
      setCreationPhase('form');
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
        language: locale === 'fr' ? 'Français' : 'English',
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
      setSession({ token: result.accessToken, displayName: result.user.displayName });
      setRemoteStatus(null);
      setRemoteChecked(false);
      setStep(4);
      setCreationPhase('form');
    } catch {
      setCreationPhase('form');
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (!valid()) return;
    if (step === 3) void submit();
    else if (step === 4) setStep(5);
    else if (step === 5) {
      if (previewMode) onPreviewCompleted?.();
      else if (session) {
        setBusy(true);
        setError('');
        try {
          await onCompleted(session.token, session.displayName);
        } catch {
          setError(t.failed);
        } finally {
          setBusy(false);
        }
      }
    } else setStep((value) => value + 1);
  };

  const remoteDescription = remoteStatus
    ? {
        UNAVAILABLE: t.remoteUnavailable,
        SIGNED_OUT: t.remoteSignedOut,
        AUTHORIZING: t.remoteAuthorizing,
        CONFIGURING: t.remoteConfiguring,
        READY: t.remoteReady,
        DEGRADED: t.remoteDegraded,
      }[remoteStatus.state]
    : previewMode
      ? t.remoteSignedOut
      : remoteChecked
        ? t.remoteUnavailable
        : t.remoteChecking;

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
          {step <= 3 ? (
            <Pressable style={styles.back} onPress={step ? () => setStep(step - 1) : onBack}>
              <Ionicons name="arrow-back" size={20} color={colors.navy} />
            </Pressable>
          ) : (
            <View style={styles.back} />
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {previewMode ? (
            <View style={styles.previewBadge}>
              <Ionicons name="eye-outline" size={16} color={colors.blue} />
              <Text style={styles.previewBadgeText}>{t.preview}</Text>
            </View>
          ) : null}
          {step > 0 ? <Text style={styles.eyebrow}>{t.eyebrows[step]}</Text> : null}
          <Text style={styles.title}>{t.titles[step]}</Text>
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
                  placeholder={locale === 'fr' ? 'Ex. Élise' : 'e.g. Élise'}
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
                  placeholder={locale === 'fr' ? 'Ex. Martin' : 'e.g. Martin'}
                  value={draft.residentLastName}
                  onChangeText={(residentLastName) => patch({ residentLastName })}
                />
                <Text style={styles.fieldLabel}>{t.dailyName}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={locale === 'fr' ? 'Ex. Lili' : 'e.g. Lily'}
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
                  const displayName =
                    locale === 'fr'
                      ? name
                      : ({
                          Lever: 'Wake up',
                          Coucher: 'Bedtime',
                          Déjeuner: 'Lunch',
                          Dîner: 'Dinner',
                        }[name] ?? name);
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
                      <View style={styles.routineTimeRow}>
                        <View style={styles.routineTimeField}>
                          <Text style={styles.routineTimeLabel}>{t.routineFrom}</Text>
                          <TextInput
                            style={[styles.timeInput, habit.unknown && styles.disabled]}
                            editable={!habit.unknown}
                            value={habit.from}
                            onChangeText={(from) =>
                              patch({ habits: { ...draft.habits, [name]: { ...habit, from } } })
                            }
                          />
                        </View>
                        <Text style={styles.routineTimeSeparator}>{t.routineConnector}</Text>
                        <View style={styles.routineTimeField}>
                          <Text style={styles.routineTimeLabel}>{t.routineUntil}</Text>
                          <TextInput
                            style={[styles.timeInput, habit.unknown && styles.disabled]}
                            editable={!habit.unknown}
                            value={habit.to}
                            onChangeText={(to) =>
                              patch({ habits: { ...draft.habits, [name]: { ...habit, to } } })
                            }
                          />
                        </View>
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
                  <Text style={styles.routineNoteTitle}>
                    {locale === 'fr' ? 'Rien n’est figé. ' : 'Nothing is fixed. '}
                  </Text>
                  {t.routineNote}
                </Text>
              </View>
            </View>
          ) : null}

          {step === 4 ? (
            <View style={styles.remotePanel}>
              <View style={styles.remoteStatus}>
                <Ionicons name="shield-checkmark-outline" size={22} color={colors.green} />
                <Text style={styles.remoteMessage}>{remoteDescription}</Text>
              </View>
              {remoteStatus?.state === 'SIGNED_OUT' && session ? (
                <Pressable
                  style={styles.remoteAction}
                  disabled={remoteBusy}
                  onPress={() => void runRemoteAction('connect')}
                >
                  {remoteBusy ? <ActivityIndicator color={colors.navy} /> : null}
                  <Text style={styles.remoteActionText}>{t.remoteConnect}</Text>
                </Pressable>
              ) : null}
              {remoteStatus?.state === 'AUTHORIZING' && remoteStatus.authUrl ? (
                <Pressable
                  style={styles.remoteAction}
                  onPress={() =>
                    void Linking.openURL(remoteStatus.authUrl!).catch(() =>
                      setRemoteError(t.remoteActionFailed),
                    )
                  }
                >
                  <Text style={styles.remoteActionText}>{t.remoteApprove}</Text>
                  <Ionicons name="open-outline" size={18} color={colors.navy} />
                </Pressable>
              ) : null}
              {remoteStatus?.state === 'CONFIGURING' && session ? (
                <Pressable
                  style={styles.remoteAction}
                  disabled={remoteBusy}
                  onPress={() => void runRemoteAction('enable')}
                >
                  {remoteBusy ? <ActivityIndicator color={colors.navy} /> : null}
                  <Text style={styles.remoteActionText}>{t.remoteEnable}</Text>
                </Pressable>
              ) : null}
              {remoteStatus?.remoteUrl ? (
                <Pressable
                  style={styles.remoteAddress}
                  onPress={() => void Linking.openURL(remoteStatus.remoteUrl!).catch(() => {})}
                >
                  <Text style={styles.remoteAddressLabel}>{t.remoteAddress}</Text>
                  <Text style={styles.remoteAddressValue}>{remoteStatus.remoteUrl}</Text>
                </Pressable>
              ) : null}
              {remoteError ? <Text style={styles.remoteError}>{remoteError}</Text> : null}
            </View>
          ) : null}

          {step === 5 ? (
            <View style={styles.readyPanel}>
              <View style={styles.readyCheck}>
                <Ionicons name="checkmark" size={34} color="#fff" />
              </View>
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
            disabled={busy || (step === 5 && !previewMode && !session)}
            onPress={step === 0 ? () => setStep(1) : () => void next()}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.primaryText}>
                  {step === 0
                    ? t.start
                    : step === 3
                      ? previewMode
                        ? t.previewFinish
                        : t.finish
                      : step === 4
                        ? t.remoteContinue
                        : step === 5
                          ? previewMode
                            ? t.previewFinish
                            : t.done
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
  welcomePillText: { color: colors.navy, fontSize: 11, fontWeight: '700' },
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
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  residentPreviewName: {
    color: '#fff',
    fontFamily: 'Georgia',
    fontSize: 27,
    marginTop: 7,
  },
  residentPreviewFullName: { color: '#D6E0E2', fontSize: 12, marginTop: 5 },
  residentPreviewNote: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,.16)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 17,
    paddingTop: 12,
  },
  residentPreviewNoteText: { flex: 1, color: '#F4F7F4', fontSize: 11, lineHeight: 17 },
  residentForm: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    padding: 18,
  },
  residentFormHeading: { marginBottom: 10 },
  residentFormTitle: { color: colors.navy, fontFamily: 'Georgia', fontSize: 21 },
  residentFormHint: { color: colors.muted, fontSize: 11, marginTop: 4 },
  fieldLabel: {
    color: colors.navy,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: -5,
  },
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
  routinesOverviewTitle: { color: colors.navy, fontSize: 12, fontWeight: '800' },
  routinesOverviewHint: { color: colors.muted, fontSize: 10, marginTop: 3 },
  routinesCount: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#E4EEE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routinesCountText: { color: colors.green, fontSize: 14, fontWeight: '900' },
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
  habitName: { color: colors.navy, fontSize: 15, fontWeight: '800', marginTop: 2 },
  habitSummary: { color: colors.muted, fontSize: 10, marginTop: 3 },
  routineTimeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  routineTimeField: { flex: 1, gap: 5 },
  routineTimeLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  routineTimeSeparator: { color: colors.muted, fontSize: 10, paddingBottom: 14 },
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
  routineNoteText: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 16 },
  routineNoteTitle: { color: colors.navy, fontWeight: '800' },
  remotePanel: {
    backgroundColor: colors.paper,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 17,
    gap: 14,
  },
  remoteStatus: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  remoteMessage: { flex: 1, color: colors.navy, lineHeight: 21 },
  remoteAction: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  remoteActionText: { color: colors.navy, fontWeight: '800' },
  remoteAddress: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 13, gap: 4 },
  remoteAddressLabel: { color: colors.muted, fontSize: 12 },
  remoteAddressValue: { color: colors.navy, fontWeight: '700' },
  remoteError: { color: colors.red, lineHeight: 19 },
  readyPanel: { alignItems: 'center', paddingVertical: 15 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeInput: {
    flex: 1,
    minHeight: 43,
    textAlign: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.navy,
    backgroundColor: '#FBFCFA',
    paddingHorizontal: 7,
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
