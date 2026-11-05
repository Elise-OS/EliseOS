import {
  ArrowLeft,
  ArrowRight,
  Baby,
  BedDouble,
  BellRing,
  Check,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  Clock3,
  Coffee,
  Ear,
  Eye,
  EyeOff,
  Footprints,
  HeartHandshake,
  LoaderCircle,
  MapPin,
  Moon,
  Plus,
  Radar,
  ShieldCheck,
  Sparkles,
  Sunrise,
  Trash2,
  Utensils,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FlagIcon } from './FlagIcons';
import { dashboardLanguages, type Locale, t, textBlock } from './i18n';
import { RemoteAccessCard } from './RemoteAccessCard';

interface SetupProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onCompleted: () => void;
}

type Room = { id: string; kind: string; name: string; floor: string };
type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  relation: string;
  role: 'proche' | 'administrateur' | 'urgence';
  username?: string;
  temporaryPassword?: string;
  passwordConfirmation?: string;
};
type Equipment = {
  id: string;
  name: string;
  type: string;
  roomId: string;
  status: 'online' | 'offline';
};

interface SetupDraft {
  caregiver: {
    firstName: string;
    lastName: string;
    username: string;
    usernameEdited: boolean;
    password: string;
    confirmation: string;
    relation: string;
  };
  resident: {
    firstName: string;
    lastName: string;
    dailyName: string;
    dailyNameEdited: boolean;
    birthDate: string;
    language: string;
    addressAs: string;
    customAddress: string;
  };
  important: string[];
  importantNote: string;
  home: { name: string; type: string; floors: string; address: string; timezone: string };
  rooms: Room[];
  contacts: Contact[];
  habits: Record<string, { from: string; to: string; unknown: boolean }>;
  equipment: Equipment[];
}

export function createBootstrapPayload(
  firstName: string,
  lastName: string,
  email: string,
  password: string,
) {
  return { displayName: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), password };
}

const setupFlow = [0, 1, 2, 8, 12, 11] as const;

const defaultDraft: SetupDraft = {
  caregiver: {
    firstName: '',
    lastName: '',
    username: '',
    usernameEdited: false,
    password: '',
    confirmation: '',
    relation: '',
  },
  resident: {
    firstName: '',
    lastName: '',
    dailyName: '',
    dailyNameEdited: false,
    birthDate: '',
    language: 'Français',
    addressAs: 'daily',
    customAddress: '',
  },
  important: [],
  importantNote: '',
  home: {
    name: '',
    type: 'Maison',
    floors: '1',
    address: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
  },
  rooms: [],
  contacts: [],
  habits: {
    Lever: { from: '07:30', to: '09:00', unknown: false },
    Coucher: { from: '21:00', to: '23:00', unknown: false },
    Déjeuner: { from: '12:00', to: '13:30', unknown: true },
    Dîner: { from: '19:00', to: '20:30', unknown: true },
  },
  equipment: [],
};

const roomCatalog = [
  ['ENTRANCE', 'Entrée'],
  ['LIVING_ROOM', 'Salon'],
  ['KITCHEN', 'Cuisine'],
  ['DINING_ROOM', 'Salle à manger'],
  ['BEDROOM', 'Chambre'],
  ['BATHROOM', 'Salle de bain'],
  ['TOILET', 'Toilettes'],
  ['HALLWAY', 'Couloir'],
  ['GARAGE', 'Garage'],
  ['GARDEN', 'Jardin'],
  ['TERRACE', 'Terrasse'],
  ['OTHER', 'Autre'],
] as const;

const importantOptions = [
  [
    'memory',
    'Troubles de la mémoire ou maladie d’Alzheimer',
    'Des rappels plus simples et une attention renforcée aux sorties inhabituelles.',
    Baby,
  ],
  [
    'parkinson',
    'Parkinson ou mobilité fortement réduite',
    'Une lecture des déplacements adaptée pour limiter les fausses alertes.',
    Footprints,
  ],
  [
    'fall',
    'Risque élevé de chute',
    'Une réaction plus rapide face à une situation réellement inhabituelle.',
    BellRing,
  ],
  ['vision', 'Déficience visuelle importante', 'Les annonces vocales seront privilégiées.', Eye],
  [
    'hearing',
    'Déficience auditive importante',
    'Les repères et notifications visuels seront renforcés.',
    Ear,
  ],
] as const;

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

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

export function Setup({ locale, onLocaleChange, onCompleted }: SetupProps) {
  const [step, setStep] = useState(0);
  const [previewMode, setPreviewMode] = useState(false);
  const [draft, setDraft] = useState<SetupDraft>(() => {
    if (typeof window === 'undefined') return defaultDraft;
    try {
      const saved = JSON.parse(
        window.localStorage.getItem('elise_setup_draft') ?? '{}',
      ) as Partial<SetupDraft>;
      return {
        ...defaultDraft,
        ...saved,
        caregiver: {
          ...defaultDraft.caregiver,
          ...saved.caregiver,
          username:
            saved.caregiver?.usernameEdited === true
              ? (saved.caregiver?.username ?? '')
              : saved.caregiver?.username ||
                generateUsername(saved.caregiver?.firstName ?? '', saved.caregiver?.lastName ?? ''),
          usernameEdited:
            saved.caregiver?.usernameEdited ??
            Boolean(
              saved.caregiver?.username &&
              saved.caregiver.username !==
                generateUsername(saved.caregiver.firstName ?? '', saved.caregiver.lastName ?? ''),
            ),
          password: '',
          confirmation: '',
        },
        resident: {
          ...defaultDraft.resident,
          firstName: saved.resident?.firstName ?? '',
          lastName: saved.resident?.lastName ?? '',
          dailyName: saved.resident?.dailyName ?? '',
          dailyNameEdited:
            saved.resident?.dailyNameEdited ??
            Boolean(
              saved.resident?.dailyName && saved.resident.dailyName !== saved.resident.firstName,
            ),
          birthDate: '',
          language: saved.resident?.language ?? defaultDraft.resident.language,
          addressAs: saved.resident?.addressAs ?? defaultDraft.resident.addressAs,
          customAddress: saved.resident?.customAddress ?? '',
        },
        contacts: (saved.contacts ?? []).map((contact) => ({
          ...contact,
          temporaryPassword: '',
          passwordConfirmation: '',
        })),
      };
    } catch {
      return defaultDraft;
    }
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [contactForm, setContactForm] = useState<Omit<Contact, 'id'>>({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    relation: '',
    role: 'proche',
  });
  const [otherContactRelation, setOtherContactRelation] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const safeDraft = {
      ...draft,
      life: undefined,
      mobility: undefined,
      senses: undefined,
      caregiver: { ...draft.caregiver, password: '', confirmation: '' },
      resident: { ...draft.resident, birthDate: '' },
      contacts: draft.contacts.map((contact) => ({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        relation: contact.relation,
        role: contact.role,
        username: contact.username,
      })),
    };
    window.localStorage.setItem('elise_setup_draft', JSON.stringify(safeDraft));
  }, [draft]);

  const residentName =
    draft.resident.dailyName || draft.resident.firstName || t('setup.theResident');
  const stepLabels = textBlock('setup.steps');
  const visibleStep = Math.max(0, setupFlow.indexOf(step as (typeof setupFlow)[number]));
  const progress = Math.round(((visibleStep + 1) / stepLabels.length) * 100);
  const passwordStrength = useMemo(
    () =>
      [
        draft.caregiver.password.length >= 12,
        /[A-Z]/.test(draft.caregiver.password) && /[a-z]/.test(draft.caregiver.password),
        /\d/.test(draft.caregiver.password) && /[^A-Za-z0-9]/.test(draft.caregiver.password),
      ].filter(Boolean).length,
    [draft.caregiver.password],
  );

  const patchCaregiver = (value: Partial<SetupDraft['caregiver']>) =>
    setDraft((d) => ({ ...d, caregiver: { ...d.caregiver, ...value } }));
  const patchCaregiverName = (field: 'firstName' | 'lastName', value: string) =>
    setDraft((d) => {
      const caregiver = { ...d.caregiver, [field]: value };
      if (!caregiver.usernameEdited)
        caregiver.username = generateUsername(caregiver.firstName, caregiver.lastName);
      return { ...d, caregiver };
    });
  const patchResident = (value: Partial<SetupDraft['resident']>) =>
    setDraft((d) => ({ ...d, resident: { ...d.resident, ...value } }));
  const patchResidentFirstName = (firstName: string) =>
    setDraft((d) => ({
      ...d,
      resident: {
        ...d.resident,
        firstName,
        dailyName:
          d.resident.dailyNameEdited && d.resident.dailyName.trim()
            ? d.resident.dailyName
            : firstName,
      },
    }));
  const patchResidentDailyName = (dailyName: string) =>
    patchResident({ dailyName, dailyNameEdited: true });
  const patchHome = (value: Partial<SetupDraft['home']>) =>
    setDraft((d) => ({ ...d, home: { ...d.home, ...value } }));

  const validate = () => {
    setError('');
    if (step === 1) {
      const c = draft.caregiver;
      if (!c.firstName || !c.lastName || !c.username || !c.relation || c.password.length < 12)
        return (setError(t('setup.fillInTheFieldsAnd')), false);
      if (c.password !== c.confirmation)
        return (setError(t('setup.thePasswordsDoNotMatch')), false);
    }
    if (
      step === 2 &&
      (!draft.resident.firstName || !draft.resident.lastName || !draft.resident.dailyName)
    )
      return (setError(t('setup.enterAtLeastTheLast')), false);
    return true;
  };

  const next = async () => {
    if (!previewMode && !validate()) return;
    setError('');
    if (step === 8) {
      if (previewMode) {
        setStep(12);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      await submitInstallation();
      return;
    }
    const currentIndex = setupFlow.indexOf(step as (typeof setupFlow)[number]);
    setStep(setupFlow[currentIndex + 1] ?? 11);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitInstallation = async () => {
    setSubmitting(true);
    setError('');
    const username = draft.caregiver.username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');
    try {
      const response = await fetch('/api/v1/auth/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: `${draft.caregiver.firstName.trim()} ${draft.caregiver.lastName.trim()}`,
          password: draft.caregiver.password,
          installation: {
            username,
            timezone: draft.home.timezone,
            caregiver: {
              firstName: draft.caregiver.firstName,
              lastName: draft.caregiver.lastName,
              relation: draft.caregiver.relation,
            },
            resident: {
              firstName: draft.resident.firstName,
              lastName: draft.resident.lastName,
              dailyName: draft.resident.dailyName,
              birthDate: '',
              language: draft.resident.language,
              addressAs: draft.resident.addressAs,
              customAddress: draft.resident.customAddress,
            },
            life: [],
            mobility: 'unknown',
            senses: [],
            important: draft.important,
            importantNote: draft.importantNote,
            habits: draft.habits,
          },
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        if (response.status === 409) {
          setError(t('setup.thisInstallationIsAlreadyConfigured'));
        } else if (response.status === 403) setError(t('setup.accessDeniedOpenEliseFrom'));
        else setError(body?.message ?? t('setup.eliseCouldNotFinishThe'));
        return;
      }
      window.localStorage.removeItem('elise_setup_draft');
      setStep(12);
    } catch {
      setError(t('setup.cannotReachEliseCheckYour'));
    } finally {
      setSubmitting(false);
    }
  };

  const addRoom = (kind: string, baseName: string) => {
    const count = draft.rooms.filter((room) => room.kind === kind).length;
    const name = count ? `${baseName} ${count + 1}` : baseName;
    setDraft((d) => ({
      ...d,
      rooms: [...d.rooms, { id: `room-${Date.now()}`, kind, name, floor: 'Rez-de-chaussée' }],
    }));
  };
  const addContact = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (
      !contactForm.firstName ||
      !contactForm.lastName ||
      (!contactForm.phone && !contactForm.email)
    )
      return;
    if (contactForm.role === 'administrateur') {
      if (!contactForm.username || (contactForm.temporaryPassword?.length ?? 0) < 12) {
        setError(t('setup.aUsernameAndA12'));
        return;
      }
      if (contactForm.temporaryPassword !== contactForm.passwordConfirmation) {
        setError(t('setup.theTemporaryPasswordsDoNot'));
        return;
      }
    }
    setDraft((d) => ({
      ...d,
      contacts: [
        ...d.contacts,
        {
          ...contactForm,
          relation: contactForm.relation === 'Autre' ? otherContactRelation : contactForm.relation,
          id: `contact-${Date.now()}`,
        },
      ],
    }));
    setContactForm({
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      relation: '',
      role: 'proche',
    });
    setOtherContactRelation('');
  };
  const discoverEquipment = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/v1/auth/bootstrap-equipment');
      if (!response.ok) throw new Error('Discovery unavailable');
      const equipment = (await response.json()) as Equipment[];
      setDraft((d) => ({
        ...d,
        equipment: equipment.map((item) => ({ ...item, roomId: '' })),
      }));
    } catch {
      setError(t('setup.realDetectionIsNotAvailable'));
    } finally {
      setTesting(false);
    }
  };

  const page = (() => {
    switch (step) {
      case 0:
        return <Welcome locale={locale} onStart={() => setStep(1)} />;
      case 1:
        return (
          <StepShell
            eyebrow={t('setup.yourRole')}
            title={t('setup.createYourAccess')}
            text={t('setup.youWillBeThePrimary')}
          >
            <div className="elise-fields two-cols">
              <Field label={t('setup.firstName')}>
                <input
                  autoFocus
                  autoComplete="given-name"
                  value={draft.caregiver.firstName}
                  onChange={(e) => patchCaregiverName('firstName', e.target.value)}
                />
              </Field>
              <Field label={t('setup.lastName')}>
                <input
                  autoComplete="family-name"
                  value={draft.caregiver.lastName}
                  onChange={(e) => patchCaregiverName('lastName', e.target.value)}
                />
              </Field>
              <Field label={t('setup.username')} hint={t('setup.youWillUseItTo')}>
                <input
                  autoComplete="username"
                  placeholder={t('setup.eGPaulBreton')}
                  value={draft.caregiver.username}
                  onChange={(e) =>
                    patchCaregiver({ username: e.target.value, usernameEdited: true })
                  }
                />
              </Field>
              <Field label={t('setup.relationshipToTheResident')}>
                <Segmented
                  value={draft.caregiver.relation}
                  // The relation is kept as written, in the language of the setup.
                  options={textBlock('setup.relations')}
                  onChange={(relation) => patchCaregiver({ relation })}
                />
              </Field>
              <Field label={t('setup.password')} hint={t('setup.n12CharactersMinimum')}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={draft.caregiver.password}
                  onChange={(e) => patchCaregiver({ password: e.target.value })}
                />
                <span className="elise-password">
                  {[1, 2, 3].map((n) => (
                    <i key={n} className={n <= passwordStrength ? 'on' : ''} />
                  ))}
                </span>
              </Field>
              <Field label={t('setup.confirmThePassword')}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={draft.caregiver.confirmation}
                  onChange={(e) => patchCaregiver({ confirmation: e.target.value })}
                />
              </Field>
            </div>
          </StepShell>
        );
      case 2:
        return (
          <StepShell
            className="elise-panel--profile"
            eyebrow={t('setup.supportProfile')}
            title={t('setup.whoWillEliseSupport')}
            text={t('setup.theResidentDoesNotNeed')}
          >
            <div className="elise-profile-layout">
              <aside className="elise-profile-preview">
                <span className="elise-profile-mark">
                  <HeartHandshake />
                </span>
                <span className="elise-profile-kicker">{t('setup.aPersonFirstAndForemost')}</span>
                <strong>{draft.resident.dailyName || t('setup.yourLovedOne')}</strong>
                <small>
                  {[draft.resident.firstName, draft.resident.lastName].filter(Boolean).join(' ') ||
                    t('setup.theirFullNameWillAppear')}
                </small>
                <div className="elise-profile-note">
                  <Sparkles />
                  <span>{t('setup.eliseWillUseThisName')}</span>
                </div>
              </aside>
              <div className="elise-profile-form">
                <div className="elise-profile-form-heading">
                  <strong>{t('setup.aFewDetails')}</strong>
                  <span>{t('setup.youCanUpdateTheseDetails')}</span>
                </div>
                <div className="elise-fields two-cols elise-resident-fields">
                  <Field label={t('setup.firstName')}>
                    <input
                      autoFocus
                      placeholder={t('setup.eGElise')}
                      value={draft.resident.firstName}
                      onChange={(e) => patchResidentFirstName(e.target.value)}
                    />
                  </Field>
                  <Field label={t('setup.lastName')}>
                    <input
                      placeholder={t('setup.eGMartin')}
                      value={draft.resident.lastName}
                      onChange={(e) => patchResident({ lastName: e.target.value })}
                    />
                  </Field>
                  <Field label={t('setup.nameUsedEveryDay')} hint={t('setup.theNameEliseWillUse')}>
                    <input
                      placeholder={t('setup.eGLily')}
                      value={draft.resident.dailyName}
                      onChange={(e) => patchResidentDailyName(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </StepShell>
        );
      case 4:
        return (
          <StepShell
            eyebrow={t('setup.thoughtfulAdaptation')}
            title={t('setup.importantSupportInformation')}
            text={t('setup.someSituationsHelpEliseAdapt')}
          >
            <div className="elise-important-grid">
              {importantOptions.map(([value, title, detail, Icon]) => (
                <button
                  type="button"
                  key={value}
                  className={`elise-important ${draft.important.includes(value) ? 'selected' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, important: toggle(d.important, value) }))}
                >
                  <span>
                    <Icon />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </div>
                  <i>{draft.important.includes(value) && <Check />}</i>
                </button>
              ))}
            </div>
            <Field
              label="Autre information utile"
              optional
              hint="Décrivez uniquement ce qui aidera Élise à mieux accompagner la personne."
            >
              <textarea
                value={draft.importantNote}
                onChange={(e) => setDraft((d) => ({ ...d, importantNote: e.target.value }))}
              />
            </Field>
          </StepShell>
        );
      case 5:
        return (
          <StepShell
            eyebrow={t('setup.theHome')}
            title={t('setup.setUpTheHome')}
            text={t('setup.thisHomeCorrespondsToThis')}
          >
            <div className="elise-fields two-cols">
              <Field label="Nom du logement" hint="Un nom simple, visible par les proches.">
                <input
                  autoFocus
                  placeholder={`Maison de ${residentName}`}
                  value={draft.home.name}
                  onChange={(e) => patchHome({ name: e.target.value })}
                />
              </Field>
              <Field label="Type de logement">
                <Segmented
                  value={draft.home.type}
                  options={['Maison', 'Appartement', 'Résidence services', 'Autre']}
                  onChange={(type) => patchHome({ type })}
                />
              </Field>
              <Field label="Nombre de niveaux">
                <Segmented
                  value={draft.home.floors}
                  options={[
                    { value: '1', label: '1 niveau' },
                    { value: '2', label: '2 niveaux' },
                    { value: '3', label: '3 niveaux' },
                    { value: '4', label: '4 niveaux' },
                  ]}
                  onChange={(floors) => patchHome({ floors })}
                />
              </Field>
              <Field
                label="Adresse"
                optional
                hint="Utile seulement pour aider les proches à identifier le lieu."
              >
                <input
                  value={draft.home.address}
                  onChange={(e) => patchHome({ address: e.target.value })}
                />
              </Field>
            </div>
            <div className="elise-detected">
              <MapPin />
              <div>
                <strong>Fuseau horaire détecté</strong>
                <small>{draft.home.timezone} · modifiable plus tard</small>
              </div>
              <CircleCheck />
            </div>
          </StepShell>
        );
      case 6:
        return (
          <StepShell
            eyebrow={t('setup.homeLayout')}
            title={t('setup.whichRoomsAreInThe')}
            text={t('setup.addTheSpacesWhereDevices')}
          >
            <div className="elise-room-catalog">
              {roomCatalog.map(([kind, name]) => {
                const count = draft.rooms.filter((room) => room.kind === kind).length;
                return (
                  <div className="elise-room-counter" key={kind}>
                    <button
                      type="button"
                      className="minus"
                      aria-label={`Retirer ${name}`}
                      disabled={count === 0}
                      onClick={() =>
                        setDraft((d) => {
                          const target = [...d.rooms].reverse().find((room) => room.kind === kind);
                          return target
                            ? { ...d, rooms: d.rooms.filter((room) => room.id !== target.id) }
                            : d;
                        })
                      }
                    >
                      −
                    </button>
                    <span>
                      <strong>{name}</strong>
                      <small>{count}</small>
                    </span>
                    <button
                      type="button"
                      className="plus"
                      aria-label={`Ajouter ${name}`}
                      onClick={() => addRoom(kind, name)}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="elise-room-list">
              {draft.rooms.map((room) => (
                <div key={room.id}>
                  <BedDouble />
                  <input
                    aria-label="Nom de la pièce"
                    value={room.name}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        rooms: d.rooms.map((r) =>
                          r.id === room.id ? { ...r, name: e.target.value } : r,
                        ),
                      }))
                    }
                  />
                  <Segmented
                    compact
                    value={room.floor}
                    options={[
                      'Rez-de-chaussée',
                      ...Array.from(
                        { length: Math.max(0, Number(draft.home.floors) - 1) },
                        (_, i) => `${i + 1}${i === 0 ? 'er' : 'e'} étage`,
                      ),
                    ]}
                    onChange={(floor) =>
                      setDraft((d) => ({
                        ...d,
                        rooms: d.rooms.map((r) => (r.id === room.id ? { ...r, floor } : r)),
                      }))
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Supprimer ${room.name}`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, rooms: d.rooms.filter((r) => r.id !== room.id) }))
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          </StepShell>
        );
      case 7:
        return (
          <StepShell
            eyebrow={t('setup.careCircle')}
            title={t('setup.whoCanBeContacted')}
            text={t('setup.addImportantPeopleNowOr')}
          >
            {draft.contacts.length > 0 && (
              <div className="elise-contact-list">
                {draft.contacts.map((c, index) => (
                  <div className={c.role === 'administrateur' ? 'has-credentials' : ''} key={c.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>
                        {c.firstName} {c.lastName}
                      </strong>
                      <small>
                        {c.relation || 'Proche'} ·{' '}
                        {c.role === 'urgence' ? 'Contact d’urgence' : c.role}
                      </small>
                      {c.role === 'administrateur' && (
                        <div className="elise-admin-credentials">
                          <input
                            aria-label={`Identifiant de ${c.firstName}`}
                            placeholder="Identifiant"
                            value={c.username ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                contacts: d.contacts.map((contact) =>
                                  contact.id === c.id
                                    ? { ...contact, username: e.target.value }
                                    : contact,
                                ),
                              }))
                            }
                          />
                          <input
                            aria-label={`Mot de passe temporaire de ${c.firstName}`}
                            type="password"
                            minLength={12}
                            placeholder="Mot de passe temporaire"
                            value={c.temporaryPassword ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                contacts: d.contacts.map((contact) =>
                                  contact.id === c.id
                                    ? { ...contact, temporaryPassword: e.target.value }
                                    : contact,
                                ),
                              }))
                            }
                          />
                          <input
                            aria-label={`Confirmation du mot de passe de ${c.firstName}`}
                            type="password"
                            minLength={12}
                            placeholder="Confirmer"
                            value={c.passwordConfirmation ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                contacts: d.contacts.map((contact) =>
                                  contact.id === c.id
                                    ? { ...contact, passwordConfirmation: e.target.value }
                                    : contact,
                                ),
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Supprimer ${c.firstName}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          contacts: d.contacts.filter((x) => x.id !== c.id),
                        }))
                      }
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form className="elise-fields two-cols elise-contact-form" onSubmit={addContact}>
              <Field label="Prénom">
                <input
                  value={contactForm.firstName}
                  onChange={(e) => setContactForm((c) => ({ ...c, firstName: e.target.value }))}
                />
              </Field>
              <Field label="Nom">
                <input
                  value={contactForm.lastName}
                  onChange={(e) => setContactForm((c) => ({ ...c, lastName: e.target.value }))}
                />
              </Field>
              <Field label="Téléphone">
                <input
                  type="tel"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm((c) => ({ ...c, phone: e.target.value }))}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm((c) => ({ ...c, email: e.target.value }))}
                />
              </Field>
              <Field label="Lien avec le résident">
                <Segmented
                  value={contactForm.relation}
                  options={[
                    'Enfant',
                    'Conjoint(e)',
                    'Voisin(e)',
                    'Infirmier',
                    'Infirmière',
                    'Aide à domicile',
                    'Autre',
                  ]}
                  onChange={(relation) => setContactForm((c) => ({ ...c, relation }))}
                />
                {contactForm.relation === 'Autre' && (
                  <input
                    autoFocus
                    placeholder="Précisez le lien…"
                    value={otherContactRelation}
                    onChange={(e) => setOtherContactRelation(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Rôle">
                <Segmented
                  value={contactForm.role}
                  options={[
                    { value: 'proche', label: 'Proche' },
                    { value: 'administrateur', label: 'Administrateur' },
                    { value: 'urgence', label: 'Urgence' },
                  ]}
                  onChange={(role) =>
                    setContactForm((c) => ({ ...c, role: role as Contact['role'] }))
                  }
                />
              </Field>
              {contactForm.role === 'administrateur' && (
                <>
                  <Field label="Identifiant de connexion">
                    <input
                      value={contactForm.username ?? ''}
                      onChange={(e) => setContactForm((c) => ({ ...c, username: e.target.value }))}
                    />
                  </Field>
                  <Field
                    label="Mot de passe temporaire"
                    hint="Il devra être changé à la première connexion."
                  >
                    <input
                      type="password"
                      minLength={12}
                      value={contactForm.temporaryPassword ?? ''}
                      onChange={(e) =>
                        setContactForm((c) => ({ ...c, temporaryPassword: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Confirmer le mot de passe">
                    <input
                      type="password"
                      minLength={12}
                      value={contactForm.passwordConfirmation ?? ''}
                      onChange={(e) =>
                        setContactForm((c) => ({ ...c, passwordConfirmation: e.target.value }))
                      }
                    />
                  </Field>
                </>
              )}
              <button className="elise-add" type="submit">
                <Plus /> Ajouter ce proche
              </button>
            </form>
          </StepShell>
        );
      case 8:
        return (
          <StepShell
            className="elise-panel--routines"
            eyebrow={t('setup.firstRoutines')}
            title={t('setup.whatDoesATypicalDay')}
            text={t('setup.approximateTimeRangesAreEnough')}
          >
            <div className="elise-routine-overview">
              <span>
                <Clock3 /> {t('setup.n4MomentsInTheDay')}
              </span>
              <small>{t('setup.flexibleStartingPointsAtYour')}</small>
            </div>
            <div className="elise-habits">
              {Object.entries(draft.habits).map(([name, value]) => {
                const Icon =
                  name === 'Lever'
                    ? Sunrise
                    : name === 'Coucher'
                      ? Moon
                      : name === 'Déjeuner'
                        ? Coffee
                        : Utensils;
                const moment =
                  name === 'Lever'
                    ? t('setup.theStartOfTheMorning')
                    : name === 'Coucher'
                      ? t('setup.theEndOfTheDay')
                      : name === 'Déjeuner'
                        ? t('setup.theMiddayMeal')
                        : t('setup.theEveningMeal');
                // The routines are stored under their French names.
                const habitKey = (
                  {
                    Lever: 'wakeUp',
                    Coucher: 'bedtime',
                    Déjeuner: 'lunch',
                    Dîner: 'dinner',
                  } as const
                )[name as 'Lever' | 'Coucher' | 'Déjeuner' | 'Dîner'] as
                  'wakeUp' | 'bedtime' | 'lunch' | 'dinner' | undefined;
                const label = habitKey ? t(`setup.habit.${habitKey}`) : name;
                return (
                  <article
                    className={`elise-habit-card ${value.unknown ? 'is-unknown' : ''}`}
                    key={name}
                  >
                    <div className="elise-habit-heading">
                      <span className="elise-habit-icon">
                        <Icon />
                      </span>
                      <div>
                        <strong>{label}</strong>
                        <span>{moment}</span>
                      </div>
                    </div>
                    <div className="elise-time-range">
                      <label>
                        <span>{t('setup.from')}</span>
                        <input
                          aria-label={`${t('setup.start')} ${label}`}
                          type="time"
                          value={value.from}
                          disabled={value.unknown}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              habits: { ...d.habits, [name]: { ...value, from: e.target.value } },
                            }))
                          }
                        />
                      </label>
                      <span className="elise-range-separator">{t('setup.to')}</span>
                      <label>
                        <span>{t('setup.until')}</span>
                        <input
                          aria-label={`${t('setup.end')} ${label}`}
                          type="time"
                          value={value.to}
                          disabled={value.unknown}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              habits: { ...d.habits, [name]: { ...value, to: e.target.value } },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="elise-unknown">
                      <input
                        type="checkbox"
                        checked={value.unknown}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            habits: {
                              ...d.habits,
                              [name]: { ...value, unknown: e.target.checked },
                            },
                          }))
                        }
                      />
                      <span>{t('setup.notSureYet')}</span>
                    </label>
                  </article>
                );
              })}
            </div>
            <div className="elise-learning-note">
              <Sparkles />
              <div>
                <strong>{t('setup.nothingIsFixed')}</strong>
                <small>{t('setup.theseTimesAreStartingPoints')}</small>
              </div>
            </div>
          </StepShell>
        );
      case 9:
        return (
          <StepShell
            eyebrow={t('setup.homeConnection')}
            title={t('setup.addTheAvailableDevices')}
            text={t('setup.allEliseFeaturesAreReady')}
          >
            <div className="elise-discovery">
              <span className={testing ? 'scanning' : ''}>
                <Radar />
              </span>
              <h3>{testing ? 'Recherche en cours…' : 'Détection automatique'}</h3>
              <p>
                {testing
                  ? 'Élise explore le réseau local et les protocoles radio.'
                  : 'Les équipements compatibles seront reconnus sur cette installation.'}
              </p>
              <button type="button" onClick={discoverEquipment} disabled={testing}>
                {testing ? <LoaderCircle className="spin" /> : <Wifi />}
                {testing
                  ? 'Recherche…'
                  : draft.equipment.length
                    ? 'Relancer la recherche'
                    : 'Détecter les équipements'}
              </button>
            </div>
            {draft.equipment.length > 0 && <EquipmentList draft={draft} setDraft={setDraft} />}
            <button type="button" className="elise-link">
              <Plus /> Ajouter un équipement manuellement
            </button>
          </StepShell>
        );
      case 10:
        return (
          <StepShell
            eyebrow={t('setup.finalCheck')}
            title={t('setup.letSRunATest')}
            text={t('setup.checkEachDeviceInIts')}
          >
            {draft.equipment.length ? (
              <div className="elise-tests">
                {draft.equipment.map((eq) => (
                  <div key={eq.id}>
                    <span className={eq.status}>
                      <>{eq.status === 'online' ? <Wifi /> : <WifiOff />}</>
                    </span>
                    <div>
                      <strong>{eq.name}</strong>
                      <small>
                        {draft.rooms.find((r) => r.id === eq.roomId)?.name || 'Pièce à définir'} ·{' '}
                        {eq.type}
                      </small>
                    </div>
                    <p>
                      {eq.type === 'Mouvement'
                        ? 'Passez devant le détecteur.'
                        : eq.type === 'Ouverture'
                          ? 'Ouvrez puis refermez la porte.'
                          : 'Appuyez une fois sur le bouton.'}
                    </p>
                    <b className={eq.status}>
                      {eq.status === 'online' ? 'Fonctionne' : 'Ne répond pas'}
                    </b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="elise-empty">
                <CircleHelp />
                <h3>Aucun équipement ajouté</h3>
                <p>
                  Vous pouvez terminer l’installation et en ajouter plus tard depuis les réglages.
                </p>
              </div>
            )}
            <div className="elise-summary">
              {previewMode ? <Eye /> : <ShieldCheck />}
              <div>
                <strong>
                  {previewMode
                    ? t('setup.noInstallationWillBeCreated')
                    : `Prêt à créer l’environnement de ${residentName}`}
                </strong>
                <small>
                  {previewMode
                    ? t('setup.continueToPreviewTheFinal')
                    : t('setup.theAccountHomeAndPreferences')}
                </small>
              </div>
            </div>
          </StepShell>
        );
      case 12:
        return (
          <StepShell
            eyebrow={t('setup.recommendedOption')}
            title={t('setup.reachEliseWhileAwayFrom')}
            text={t('setup.accessUsesYourPrivateTailscale')}
          >
            {previewMode ? (
              <div className="elise-preview-state">
                <Eye />
                <div>
                  <strong>{t('setup.previewOnly')}</strong>
                  <small>{t('setup.thisWalkthroughWillNotChange')}</small>
                </div>
              </div>
            ) : (
              <RemoteAccessCard locale={locale} compact />
            )}
            <div className="elise-remote-nav">
              <button
                className="elise-back"
                type="button"
                onClick={() => setStep(previewMode ? 8 : 11)}
              >
                {previewMode ? t('setup.backToRoutines') : t('setup.setUpLater')}
              </button>
              <button className="elise-primary" type="button" onClick={() => setStep(11)}>
                {previewMode ? t('setup.continuePreview') : t('setup.continue')} <ArrowRight />
              </button>
            </div>
          </StepShell>
        );
      default:
        return (
          <StepShell
            eyebrow={previewMode ? t('setup.previewComplete') : t('setup.environmentCreated')}
            title={
              previewMode ? t('setup.youHaveViewedAll6') : t('setup.yourEliseEnvironmentIsReady')
            }
            text={
              previewMode
                ? t('setup.noEnvironmentWasCreatedYou')
                : t('setup.discoverTheEssentialAreasOf')
            }
          >
            {previewMode ? (
              <div className="elise-preview-state is-complete">
                <Eye />
                <div>
                  <strong>{t('setup.noEnvironmentWasCreated')}</strong>
                  <small>{t('setup.youViewedAllSixScreens')}</small>
                </div>
              </div>
            ) : (
              <div className="elise-success">
                <span>
                  <CircleCheck />
                </span>
                <div className="elise-learning-timeline">
                  <div className="active">
                    <b>1</b>
                    <strong>{t('setup.environmentCreated')}</strong>
                    <small>{t('setup.accountAndProfileSaved')}</small>
                  </div>
                  <div>
                    <b>2</b>
                    <strong>{t('setup.applicationTour')}</strong>
                    <small>{t('setup.sixEssentialAreasToDiscover')}</small>
                  </div>
                  <div>
                    <b>3</b>
                    <strong>{t('setup.homeCreation')}</strong>
                    <small>{t('setup.roomsFloorsAndDevices')}</small>
                  </div>
                </div>
                <blockquote>{t('setup.letSTakeAMoment')}</blockquote>
              </div>
            )}
            <button
              className="elise-primary final"
              type="button"
              onClick={() => {
                if (previewMode) {
                  setPreviewMode(false);
                  setStep(0);
                } else {
                  onCompleted();
                }
              }}
            >
              {previewMode ? t('setup.returnToTheBeginning') : t('setup.discoverElise')}
              <ArrowRight />
            </button>
          </StepShell>
        );
    }
  })();

  return (
    <main className="elise-setup">
      <header className="elise-header">
        <div className="elise-brand">
          <img src="/logo-transparent.png" width="46" height="46" alt="" />
          <div>
            <span className="elise-wordmark">
              élise<span className="brand-os">OS</span>
            </span>
            <small>{t('setup.localSetup')}</small>
          </div>
        </div>
        <div className="elise-header-right">
          <span className="elise-saved">
            <CircleCheck /> {t('setup.draftSavedOnThisDevice')}
          </span>
          <div className="elise-language">
            <button type="button" onClick={() => setLangOpen(!langOpen)} aria-expanded={langOpen}>
              <FlagIcon language={locale} />
              <span>{dashboardLanguages.find(({ code }) => code === locale)?.name ?? locale}</span>
              <ChevronDown />
            </button>
            {langOpen && (
              <div>
                {dashboardLanguages.map((language) => (
                  <button
                    key={language.code}
                    type="button"
                    aria-pressed={language.code === locale}
                    onClick={() => {
                      onLocaleChange(language.code);
                      setLangOpen(false);
                    }}
                  >
                    <FlagIcon language={language.code} /> {language.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="elise-progress-wrap">
        <div className="elise-progress-copy">
          <span>
            {previewMode
              ? t('setup.previewNothingWillBeCreated')
              : step === 0
                ? t('setup.eliseOsSetup')
                : t('setup.eliseSetup')}
          </span>
          <strong>
            {t('setup.step')} {visibleStep + 1} {t('setup.of')} {stepLabels.length} ·{' '}
            {stepLabels[visibleStep]}
          </strong>
        </div>
        <div className="elise-progress" role="progressbar" aria-valuenow={progress}>
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>
      <section className="elise-stage" key={step}>
        {page}
        {error && (
          <p className="elise-error" role="alert">
            {error}
          </p>
        )}
        {step > 0 && step < 11 && (
          <nav className="elise-nav">
            <button
              type="button"
              className="elise-back"
              onClick={() => {
                setError('');
                const currentIndex = setupFlow.indexOf(step as (typeof setupFlow)[number]);
                setStep(setupFlow[currentIndex - 1] ?? 0);
              }}
            >
              <ArrowLeft /> {t('setup.back')}
            </button>
            <span>{t('setup.everythingCanBeChangedLater')}</span>
            <button
              type="button"
              className="elise-primary"
              onClick={() => void next()}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <LoaderCircle className="spin" /> {t('setup.creating')}
                </>
              ) : (
                <>
                  {step === 8
                    ? previewMode
                      ? t('setup.previewTheFinalSteps')
                      : t('setup.startLearning')
                    : t('setup.continue')}
                  <ArrowRight />
                </>
              )}
            </button>
          </nav>
        )}
      </section>
      <footer className="elise-footer">
        <ShieldCheck />{' '}
        {step === 0 ? t('setup.yourDataStaysLocallyOn') : t('setup.yourDataStaysStoredLocally')}
      </footer>
    </main>
  );
}

function StepShell({
  className,
  eyebrow,
  title,
  text,
  children,
}: {
  className?: string;
  eyebrow: string;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`elise-panel ${className ?? ''}`.trim()}>
      <div className="elise-panel-heading">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <div className="elise-content">{children}</div>
    </div>
  );
}
function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="elise-field">
      <span>
        {label}
        {optional && <em>Facultatif</em>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Segmented({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`elise-segmented ${compact ? 'compact' : ''}`} role="group">
      {options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option;
        return (
          <button
            type="button"
            key={item.value}
            className={value === item.value ? 'selected' : ''}
            aria-pressed={value === item.value}
            onClick={() => onChange(item.value)}
          >
            <span>{item.label}</span>
            {value === item.value && <Check />}
          </button>
        );
      })}
    </div>
  );
}
function Welcome({ onStart }: { locale: Locale; onStart: () => void }) {
  return (
    <div className="elise-welcome">
      <div className="elise-welcome-copy">
        <h1>{t('setup.setUpEliseForSomeone')}</h1>
        <p>{t('setup.inAFewStepsYou')}</p>
        <button className="elise-primary welcome" type="button" onClick={onStart}>
          {t('setup.startSetup')} <ArrowRight />
        </button>
        <small>
          <ShieldCheck /> {t('setup.yourDataStaysLocallyOn')}
        </small>
      </div>
      <div className="elise-home-card">
        <div className="elise-home-orbit one" />
        <div className="elise-home-orbit two" />
        <span className="elise-home-icon">
          <img src="/logo-transparent.png" alt="" />
        </span>
        <div className="elise-signal signal-one">
          <Radar />
          <span>{t('setup.observes')}</span>
        </div>
        <div className="elise-signal signal-two">
          <HeartHandshake />
          <span>{t('setup.supports')}</span>
        </div>
        <div className="elise-signal signal-three">
          <BellRing />
          <span>{t('setup.reassures')}</span>
        </div>
        <div className="elise-device">
          <i />
          <span>Élise OS</span>
          <small>{t('setup.readyToSetUp')}</small>
        </div>
      </div>
      <div className="elise-pill-row">
        <span>
          <ShieldCheck /> {t('setup.entirelyLocal')}
        </span>
        <span>
          <EyeOff /> {t('setup.privacyComesFirst')}
        </span>
        <span>
          <HeartHandshake /> {t('setup.designedForCaregivers')}
        </span>
      </div>
    </div>
  );
}
function EquipmentList({
  draft,
  setDraft,
}: {
  draft: SetupDraft;
  setDraft: React.Dispatch<React.SetStateAction<SetupDraft>>;
}) {
  return (
    <div className="elise-equipment-list">
      {draft.equipment.map((eq) => (
        <div key={eq.id}>
          <span className={eq.status}>
            <Wifi />
          </span>
          <div>
            <strong>{eq.name}</strong>
            <small>
              {eq.type} · {eq.status === 'online' ? 'Détecté' : 'À vérifier'}
            </small>
          </div>
          <Segmented
            compact
            value={eq.roomId}
            options={draft.rooms.map((room) => ({ value: room.id, label: room.name }))}
            onChange={(roomId) =>
              setDraft((d) => ({
                ...d,
                equipment: d.equipment.map((x) => (x.id === eq.id ? { ...x, roomId } : x)),
              }))
            }
          />
          <button
            type="button"
            onClick={() =>
              setDraft((d) => ({ ...d, equipment: d.equipment.filter((x) => x.id !== eq.id) }))
            }
          >
            <Trash2 />
          </button>
        </div>
      ))}
    </div>
  );
}

export async function resizeResidentPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing unavailable');
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    720,
    720,
  );
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image conversion failed'))),
      'image/webp',
      0.84,
    );
  });
}
