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
import { FRFlag, GBFlag } from './FlagIcons';
import type { Locale } from './i18n';
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

const steps: Record<Locale, string[]> = {
  fr: ['Bienvenue', 'Vous', 'Résident', 'Apprentissage', 'Accès privé', 'Terminé'],
  en: ['Welcome', 'You', 'Resident', 'Learning', 'Private access', 'Done'],
};

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

  const residentName = draft.resident.dailyName || draft.resident.firstName || 'le résident';
  const stepLabels = steps[locale];
  const visibleStep = Math.max(0, setupFlow.indexOf(step as (typeof setupFlow)[number]));
  const progress = Math.round(((visibleStep + 1) / stepLabels.length) * 100);
  const tr = (fr: string, en: string) => (locale === 'fr' ? fr : en);
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
        return (
          setError('Complétez les champs et choisissez un mot de passe d’au moins 12 caractères.'),
          false
        );
      if (c.password !== c.confirmation)
        return (setError('Les mots de passe ne correspondent pas.'), false);
    }
    if (
      step === 2 &&
      (!draft.resident.firstName || !draft.resident.lastName || !draft.resident.dailyName)
    )
      return (
        setError('Indiquez au moins le nom, le prénom et le prénom utilisé au quotidien.'),
        false
      );
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
          setError(
            tr(
              'Cette installation est déjà configurée.',
              'This installation is already configured.',
            ),
          );
        } else if (response.status === 403)
          setError(
            'Accès refusé. Ouvrez Élise depuis le réseau local ou son accès privé Tailscale.',
          );
        else
          setError(
            body?.message ??
              'Élise n’a pas pu finaliser l’installation. Réessayez dans un instant.',
          );
        return;
      }
      window.localStorage.removeItem('elise_setup_draft');
      setStep(12);
    } catch {
      setError('Impossible de joindre Élise. Vérifiez votre connexion locale ou Tailscale.');
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
        setError(
          'Un identifiant et un mot de passe temporaire de 12 caractères sont requis pour cet administrateur.',
        );
        return;
      }
      if (contactForm.temporaryPassword !== contactForm.passwordConfirmation) {
        setError('Les mots de passe temporaires ne correspondent pas.');
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
      setError(
        'La détection réelle n’est pas disponible. Vous pouvez terminer sans équipement et reprendre plus tard.',
      );
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
            eyebrow={tr('Votre rôle', 'Your role')}
            title={tr('Créons votre accès', 'Create your access')}
            text={tr(
              'Vous serez le gestionnaire principal de cette installation. Vous pourrez inviter d’autres proches plus tard.',
              'You will be the primary manager for this installation. You can invite other relatives later.',
            )}
          >
            <div className="elise-fields two-cols">
              <Field label="Prénom">
                <input
                  autoFocus
                  autoComplete="given-name"
                  value={draft.caregiver.firstName}
                  onChange={(e) => patchCaregiverName('firstName', e.target.value)}
                />
              </Field>
              <Field label="Nom">
                <input
                  autoComplete="family-name"
                  value={draft.caregiver.lastName}
                  onChange={(e) => patchCaregiverName('lastName', e.target.value)}
                />
              </Field>
              <Field label="Identifiant" hint="Il servira à vous connecter depuis le domicile.">
                <input
                  autoComplete="username"
                  placeholder="ex. paul.breton"
                  value={draft.caregiver.username}
                  onChange={(e) =>
                    patchCaregiver({ username: e.target.value, usernameEdited: true })
                  }
                />
              </Field>
              <Field label="Lien avec le résident">
                <Segmented
                  value={draft.caregiver.relation}
                  options={[
                    'Enfant',
                    'Petit-enfant',
                    'Conjoint',
                    'Ami(e)',
                    'Professionnel',
                    'Autre',
                  ]}
                  onChange={(relation) => patchCaregiver({ relation })}
                />
              </Field>
              <Field label="Mot de passe" hint="12 caractères minimum">
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
              <Field label="Confirmer le mot de passe">
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
            eyebrow={tr('Profil d’accompagnement', 'Support profile')}
            title={tr('Qui Élise va-t-elle accompagner ?', 'Who will Élise support?')}
            text={tr(
              'Le résident n’a pas de compte à gérer. Ces quelques repères permettent simplement à Élise de s’adresser à lui naturellement.',
              'The resident does not need to manage an account. These details simply help Élise address them naturally.',
            )}
          >
            <div className="elise-profile-layout">
              <aside className="elise-profile-preview">
                <span className="elise-profile-mark">
                  <HeartHandshake />
                </span>
                <span className="elise-profile-kicker">
                  {tr('Une personne, avant tout', 'A person, first and foremost')}
                </span>
                <strong>{draft.resident.dailyName || tr('Votre proche', 'Your loved one')}</strong>
                <small>
                  {[draft.resident.firstName, draft.resident.lastName].filter(Boolean).join(' ') ||
                    tr('Son nom apparaîtra ici', 'Their full name will appear here')}
                </small>
                <div className="elise-profile-note">
                  <Sparkles />
                  <span>
                    {tr(
                      'Élise utilisera ce prénom pour s’adresser à la personne.',
                      'Élise will use this name when speaking to them.',
                    )}
                  </span>
                </div>
              </aside>
              <div className="elise-profile-form">
                <div className="elise-profile-form-heading">
                  <strong>{tr('Ses repères', 'A few details')}</strong>
                  <span>
                    {tr(
                      'Ces informations pourront évoluer.',
                      'You can update these details later.',
                    )}
                  </span>
                </div>
                <div className="elise-fields two-cols elise-resident-fields">
                  <Field label={tr('Prénom', 'First name')}>
                    <input
                      autoFocus
                      placeholder={tr('Ex. Élise', 'e.g. Élise')}
                      value={draft.resident.firstName}
                      onChange={(e) => patchResidentFirstName(e.target.value)}
                    />
                  </Field>
                  <Field label={tr('Nom', 'Last name')}>
                    <input
                      placeholder={tr('Ex. Martin', 'e.g. Martin')}
                      value={draft.resident.lastName}
                      onChange={(e) => patchResident({ lastName: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={tr('Prénom utilisé au quotidien', 'Name used every day')}
                    hint={tr(
                      'Le prénom qu’Élise emploiera dans les échanges.',
                      'The name Élise will use in conversations.',
                    )}
                  >
                    <input
                      placeholder={tr('Ex. Lili', 'e.g. Lily')}
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
            eyebrow={tr('Adaptation intelligente', 'Thoughtful adaptation')}
            title={tr(
              'Informations importantes pour l’accompagnement',
              'Important support information',
            )}
            text={tr(
              'Certaines situations permettent à Élise d’adapter son comportement. Tout est facultatif et enregistré uniquement sur cette installation locale.',
              'Some situations help Élise adapt its behaviour. Everything is optional and stored only on this local installation.',
            )}
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
            eyebrow={tr('Le lieu de vie', 'The home')}
            title={tr('Créons le logement', 'Set up the home')}
            text={tr(
              'Ce logement correspond à cette installation d’Élise. L’adresse n’est pas nécessaire au fonctionnement.',
              'This home corresponds to this Élise installation. An address is not required for it to work.',
            )}
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
            eyebrow={tr('Plan du domicile', 'Home layout')}
            title={tr('Quelles pièces composent le logement ?', 'Which rooms are in the home?')}
            text={tr(
              'Ajoutez les espaces où seront placés les équipements. Vous pourrez compléter ce plan à tout moment.',
              'Add the spaces where devices will be installed. You can update this layout at any time.',
            )}
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
            eyebrow={tr('Cercle de confiance', 'Care circle')}
            title={tr('Qui pourra être contacté ?', 'Who can be contacted?')}
            text={tr(
              'Ajoutez maintenant les personnes importantes, ou passez cette étape. Les rôles et l’ordre de priorité resteront modifiables.',
              'Add important people now, or skip this step. Roles and contact priority can be changed later.',
            )}
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
            eyebrow={tr('Premiers repères', 'First routines')}
            title={tr(
              'À quoi ressemble une journée habituelle ?',
              'What does a typical day look like?',
            )}
            text={tr(
              'Des plages approximatives suffisent. Élise observera le quotidien et vous proposera ensuite des repères plus justes.',
              'Approximate time ranges are enough. Élise will observe daily life and suggest more accurate routines later.',
            )}
          >
            <div className="elise-routine-overview">
              <span>
                <Clock3 /> {tr('4 moments de la journée', '4 moments in the day')}
              </span>
              <small>
                {tr(
                  'Des repères souples, à votre rythme',
                  'Flexible starting points, at your pace',
                )}
              </small>
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
                    ? tr('Le début de matinée', 'The start of the morning')
                    : name === 'Coucher'
                      ? tr('La fin de journée', 'The end of the day')
                      : name === 'Déjeuner'
                        ? tr('Le repas du midi', 'The midday meal')
                        : tr('Le repas du soir', 'The evening meal');
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
                        <strong>{name}</strong>
                        <span>{moment}</span>
                      </div>
                    </div>
                    <div className="elise-time-range">
                      <label>
                        <span>{tr('À partir de', 'From')}</span>
                        <input
                          aria-label={`${tr('Début', 'Start')} ${name}`}
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
                      <span className="elise-range-separator">{tr('à', 'to')}</span>
                      <label>
                        <span>{tr('Jusqu’à', 'Until')}</span>
                        <input
                          aria-label={`${tr('Fin', 'End')} ${name}`}
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
                      <span>{tr('Je ne sais pas encore', 'Not sure yet')}</span>
                    </label>
                  </article>
                );
              })}
            </div>
            <div className="elise-learning-note">
              <Sparkles />
              <div>
                <strong>{tr('Rien n’est figé', 'Nothing is fixed')}</strong>
                <small>
                  {tr(
                    'Ces horaires sont des repères de départ, jamais des règles rigides.',
                    'These times are starting points, never rigid rules.',
                  )}
                </small>
              </div>
            </div>
          </StepShell>
        );
      case 9:
        return (
          <StepShell
            eyebrow={tr('Connexion du domicile', 'Home connection')}
            title={tr('Ajoutons les équipements présents', 'Add the available devices')}
            text={tr(
              'Toutes les fonctions d’Élise sont déjà disponibles. Il suffit de connecter les équipements installés dans le logement.',
              'All Élise features are ready. Simply connect the devices installed in the home.',
            )}
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
            eyebrow={tr('Dernière vérification', 'Final check')}
            title={tr('Faisons un test ensemble', 'Let’s run a test together')}
            text={tr(
              'Vérifiez chaque équipement dans la pièce indiquée. Vous pourrez terminer même si l’un d’eux ne répond pas.',
              'Check each device in its assigned room. You can finish even if one of them does not respond.',
            )}
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
                    ? tr('Aucune installation ne sera créée', 'No installation will be created')
                    : `Prêt à créer l’environnement de ${residentName}`}
                </strong>
                <small>
                  {previewMode
                    ? tr(
                        'Continuez pour voir les deux dernières étapes en aperçu.',
                        'Continue to preview the final two steps.',
                      )
                    : tr(
                        'Le compte, le logement et les préférences seront enregistrés ensemble sur cette installation.',
                        'The account, home and preferences will be saved together on this installation.',
                      )}
                </small>
              </div>
            </div>
          </StepShell>
        );
      case 12:
        return (
          <StepShell
            eyebrow={tr('Option recommandée', 'Recommended option')}
            title={tr('Retrouvez Élise, même à distance', 'Reach Élise while away from home')}
            text={tr(
              'L’accès passe par votre espace privé Tailscale. Il peut être activé maintenant ou plus tard depuis les réglages.',
              'Access uses your private Tailscale network. Enable it now or later from settings.',
            )}
          >
            {previewMode ? (
              <div className="elise-preview-state">
                <Eye />
                <div>
                  <strong>{tr('Aperçu seulement', 'Preview only')}</strong>
                  <small>
                    {tr(
                      'Aucun réglage Tailscale ne sera modifié pendant ce parcours.',
                      'This walkthrough will not change any Tailscale settings.',
                    )}
                  </small>
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
                {previewMode
                  ? tr('Retour aux repères', 'Back to routines')
                  : tr('Configurer plus tard', 'Set up later')}
              </button>
              <button className="elise-primary" type="button" onClick={() => setStep(11)}>
                {previewMode
                  ? tr('Continuer l’aperçu', 'Continue preview')
                  : tr('Continuer', 'Continue')}{' '}
                <ArrowRight />
              </button>
            </div>
          </StepShell>
        );
      default:
        return (
          <StepShell
            eyebrow={
              previewMode
                ? tr('Aperçu terminé', 'Preview complete')
                : tr('Environnement créé', 'Environment created')
            }
            title={
              previewMode
                ? tr('Vous avez parcouru les 6 étapes', 'You have viewed all 6 steps')
                : tr('Votre environnement Élise est créé', 'Your Élise environment is ready')
            }
            text={tr(
              previewMode
                ? 'Aucun environnement n’a été créé. Vous pouvez revoir le parcours ou quitter cet aperçu.'
                : 'Découvrez maintenant les espaces essentiels de l’application. Vous créerez ensuite le logement accompagné pas à pas.',
              previewMode
                ? 'No environment was created. You can review the steps or close this preview.'
                : 'Discover the essential areas of the application. You will then create the home step by step.',
            )}
          >
            {previewMode ? (
              <div className="elise-preview-state is-complete">
                <Eye />
                <div>
                  <strong>
                    {tr('Aucun environnement n’a été créé', 'No environment was created')}
                  </strong>
                  <small>
                    {tr(
                      'Vous avez parcouru les six écrans sans créer d’environnement sur cette installation.',
                      'You viewed all six screens without creating an environment on this installation.',
                    )}
                  </small>
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
                    <strong>{tr('Environnement créé', 'Environment created')}</strong>
                    <small>{tr('Compte et profil enregistrés', 'Account and profile saved')}</small>
                  </div>
                  <div>
                    <b>2</b>
                    <strong>{tr('Découverte de l’application', 'Application tour')}</strong>
                    <small>
                      {tr('Six espaces essentiels à découvrir', 'Six essential areas to discover')}
                    </small>
                  </div>
                  <div>
                    <b>3</b>
                    <strong>{tr('Création du logement', 'Home creation')}</strong>
                    <small>
                      {tr('Pièces, niveaux et équipements', 'Rooms, floors and devices')}
                    </small>
                  </div>
                </div>
                <blockquote>
                  {tr(
                    '« Prenons quelques instants pour découvrir Élise avant de représenter le logement. »',
                    '“Let’s take a moment to discover Élise before mapping the home.”',
                  )}
                </blockquote>
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
              {previewMode
                ? tr('Revenir au début', 'Return to the beginning')
                : tr('Découvrir Élise', 'Discover Élise')}
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
            <small>{tr('Installation locale', 'Local setup')}</small>
          </div>
        </div>
        <div className="elise-header-right">
          <span className="elise-saved">
            <CircleCheck />{' '}
            {tr('Brouillon enregistré sur cet appareil', 'Draft saved on this device')}
          </span>
          <div className="elise-language">
            <button type="button" onClick={() => setLangOpen(!langOpen)} aria-expanded={langOpen}>
              {locale === 'fr' ? <FRFlag /> : <GBFlag />}
              <span>{locale === 'fr' ? 'Français' : 'English'}</span>
              <ChevronDown />
            </button>
            {langOpen && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    onLocaleChange('fr');
                    setLangOpen(false);
                  }}
                >
                  <FRFlag /> Français
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onLocaleChange('en');
                    setLangOpen(false);
                  }}
                >
                  <GBFlag /> English
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="elise-progress-wrap">
        <div className="elise-progress-copy">
          <span>
            {previewMode
              ? tr('Aperçu sans création', 'Preview · nothing will be created')
              : step === 0
                ? tr('Installation d’Élise OS', 'Élise OS setup')
                : tr('Installation d’Élise', 'Élise setup')}
          </span>
          <strong>
            {tr('Étape', 'Step')} {visibleStep + 1} {tr('sur', 'of')} {stepLabels.length} ·{' '}
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
              <ArrowLeft /> {tr('Retour', 'Back')}
            </button>
            <span>
              {tr('Tout pourra être modifié plus tard.', 'Everything can be changed later.')}
            </span>
            <button
              type="button"
              className="elise-primary"
              onClick={() => void next()}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <LoaderCircle className="spin" /> {tr('Création en cours…', 'Creating…')}
                </>
              ) : (
                <>
                  {step === 8
                    ? previewMode
                      ? tr('Voir les dernières étapes', 'Preview the final steps')
                      : tr('Commencer l’apprentissage', 'Start learning')
                    : tr('Continuer', 'Continue')}
                  <ArrowRight />
                </>
              )}
            </button>
          </nav>
        )}
      </section>
      <footer className="elise-footer">
        <ShieldCheck />{' '}
        {step === 0
          ? tr(
              'Vos données restent stockées localement sur votre installation Élise OS.',
              'Your data stays locally on your Élise OS installation.',
            )
          : tr(
              'Vos données restent stockées localement par Élise.',
              'Your data stays stored locally by Élise.',
            )}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="elise-section-label">{children}</h3>;
}
function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`elise-choice ${active ? 'selected' : ''}`} onClick={onClick}>
      {children}
      <span>{active && <Check />}</span>
    </button>
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
function Welcome({ locale, onStart }: { locale: Locale; onStart: () => void }) {
  const english = locale === 'en';
  return (
    <div className="elise-welcome">
      <div className="elise-welcome-copy">
        <h1>
          {english
            ? 'Set up Élise for someone who matters.'
            : 'Préparons Élise pour une personne qui compte.'}
        </h1>
        <p>
          {english
            ? 'In a few steps, you will create your access and introduce the resident. You will discover the application before creating the home.'
            : 'En quelques étapes, vous allez créer votre accès et présenter le résident. Vous découvrirez ensuite l’application avant de créer le logement.'}
        </p>
        <button className="elise-primary welcome" type="button" onClick={onStart}>
          {english ? 'Start setup' : 'Commencer l’installation'} <ArrowRight />
        </button>
        <small>
          <ShieldCheck />{' '}
          {english
            ? 'Your data stays locally on your Élise OS installation.'
            : 'Vos données restent stockées localement sur votre installation Élise OS.'}
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
          <span>{english ? 'Observes' : 'Observe'}</span>
        </div>
        <div className="elise-signal signal-two">
          <HeartHandshake />
          <span>{english ? 'Supports' : 'Accompagne'}</span>
        </div>
        <div className="elise-signal signal-three">
          <BellRing />
          <span>{english ? 'Reassures' : 'Rassure'}</span>
        </div>
        <div className="elise-device">
          <i />
          <span>Élise OS</span>
          <small>{english ? 'Ready to set up' : 'Installation prête'}</small>
        </div>
      </div>
      <div className="elise-pill-row">
        <span>
          <ShieldCheck /> {english ? 'Entirely local' : 'Entièrement local'}
        </span>
        <span>
          <EyeOff /> {english ? 'Privacy comes first' : 'Respecte votre intimité'}
        </span>
        <span>
          <HeartHandshake />{' '}
          {english ? 'Designed for caregivers' : 'Pensé pour les proches aidants'}
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
