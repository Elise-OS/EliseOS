import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  Baby,
  BedDouble,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  Ear,
  Eye,
  Footprints,
  HeartHandshake,
  Home,
  Languages,
  LoaderCircle,
  MapPin,
  PawPrint,
  Plus,
  Radar,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FRFlag, GBFlag } from './FlagIcons';
import type { Locale } from './i18n';

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
    password: string;
    confirmation: string;
    relation: string;
  };
  resident: {
    firstName: string;
    lastName: string;
    dailyName: string;
    birthDate: string;
    language: string;
    addressAs: string;
    customAddress: string;
    photoName: string;
  };
  life: string[];
  mobility: string;
  senses: string[];
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

const steps = [
  'Bienvenue',
  'Vous',
  'Résident',
  'Quotidien',
  'Accompagnement',
  'Logement',
  'Pièces',
  'Proches',
  'Habitudes',
  'Équipements',
  'Vérification',
  'Apprentissage',
];

const defaultDraft: SetupDraft = {
  caregiver: {
    firstName: '',
    lastName: '',
    username: '',
    password: '',
    confirmation: '',
    relation: '',
  },
  resident: {
    firstName: '',
    lastName: '',
    dailyName: '',
    birthDate: '',
    language: 'Français',
    addressAs: 'daily',
    customAddress: '',
    photoName: '',
  },
  life: [],
  mobility: '',
  senses: [],
  important: [],
  importantNote: '',
  home: {
    name: '',
    type: 'Maison',
    floors: '1',
    address: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
  },
  rooms: [
    { id: 'room-entry', kind: 'ENTRANCE', name: 'Entrée', floor: 'Rez-de-chaussée' },
    { id: 'room-living', kind: 'LIVING_ROOM', name: 'Salon', floor: 'Rez-de-chaussée' },
    { id: 'room-kitchen', kind: 'KITCHEN', name: 'Cuisine', floor: 'Rez-de-chaussée' },
    { id: 'room-bedroom', kind: 'BEDROOM', name: 'Chambre', floor: 'Rez-de-chaussée' },
    { id: 'room-bathroom', kind: 'BATHROOM', name: 'Salle de bain', floor: 'Rez-de-chaussée' },
  ],
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

const lifeOptions = [
  ['alone', 'Vit seul', Home],
  ['partner', 'Vit avec son conjoint', HeartHandshake],
  ['relative', 'Vit avec un proche', UsersRound],
  ['home_help', 'Reçoit une aide à domicile', Accessibility],
  ['visits', 'Reçoit des visites régulières', CalendarDays],
  ['pet', 'Possède un animal', PawPrint],
] as const;
const mobilityOptions = [
  ['independent', 'Se déplace seul'],
  ['cane', 'Utilise une canne'],
  ['walker', 'Utilise un déambulateur'],
  ['wheelchair', 'Utilise un fauteuil roulant'],
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

export function Setup({ locale, onLocaleChange, onCompleted }: SetupProps) {
  const [step, setStep] = useState(0);
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
          password: '',
          confirmation: '',
        },
        resident: { ...defaultDraft.resident, ...saved.resident, photoName: '' },
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
  const [residentPhoto, setResidentPhoto] = useState<File | null>(null);

  useEffect(() => {
    const safeDraft = {
      ...draft,
      caregiver: { ...draft.caregiver, password: '', confirmation: '' },
      resident: { ...draft.resident, photoName: '' },
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
  const progress = Math.round(((step + 1) / steps.length) * 100);
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
  const patchResident = (value: Partial<SetupDraft['resident']>) =>
    setDraft((d) => ({ ...d, resident: { ...d.resident, ...value } }));
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
    if (step === 3 && !draft.mobility)
      return (setError('Choisissez la situation qui décrit le mieux ses déplacements.'), false);
    if (step === 5 && (!draft.home.name || !draft.home.type || !draft.home.floors))
      return (setError('Donnez un nom au logement et précisez son type.'), false);
    if (step === 6 && draft.rooms.length === 0)
      return (setError('Ajoutez au moins une pièce.'), false);
    if (
      step === 7 &&
      draft.contacts.some(
        (contact) =>
          contact.role === 'administrateur' &&
          (!contact.username ||
            (contact.temporaryPassword?.length ?? 0) < 12 ||
            contact.temporaryPassword !== contact.passwordConfirmation),
      )
    ) {
      return (
        setError('Renseignez et confirmez le mot de passe temporaire de chaque administrateur.'),
        false
      );
    }
    return true;
  };

  const next = async () => {
    if (!validate()) return;
    if (step === 10) {
      await submitInstallation();
      return;
    }
    setStep((value) => Math.min(11, value + 1));
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
            ...draft,
            caregiver: {
              firstName: draft.caregiver.firstName,
              lastName: draft.caregiver.lastName,
              relation: draft.caregiver.relation,
            },
            contacts: draft.contacts.map((contact) => ({
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              phone: contact.phone,
              email: contact.email,
              relation: contact.relation,
              role: contact.role,
              username: contact.username,
              temporaryPassword: contact.temporaryPassword,
            })),
            username,
          },
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        if (response.status === 409)
          setError(
            'Cette installation a déjà été configurée. Rechargez la page pour vous connecter.',
          );
        else if (response.status === 403)
          setError(
            'La configuration doit être effectuée depuis le réseau local de votre installation.',
          );
        else
          setError(
            body?.message ??
              'Élise n’a pas pu finaliser l’installation. Réessayez dans un instant.',
          );
        return;
      }
      const result = (await response.json()) as { residentId: string };
      if (residentPhoto) {
        try {
          const photo = new FormData();
          photo.append('photo', await resizeResidentPhoto(residentPhoto), 'resident.webp');
          const upload = await fetch(`/api/v1/residents/${result.residentId}/photo`, {
            method: 'POST',
            body: photo,
          });
          if (!upload.ok) throw new Error('Photo upload failed');
        } catch {
          setError(
            'L’environnement est créé, mais la photo n’a pas pu être enregistrée. Vous pourrez la réessayer depuis la fiche résident.',
          );
        }
      }
      window.localStorage.removeItem('elise_setup_draft');
      setStep(11);
    } catch {
      setError('Impossible de joindre Élise. Vérifiez votre connexion au réseau local.');
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
      const firstRoom = draft.rooms[0]?.id ?? '';
      setDraft((d) => ({
        ...d,
        equipment: equipment.map((item) => ({ ...item, roomId: item.roomId || firstRoom })),
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
        return <Welcome onStart={() => setStep(1)} />;
      case 1:
        return (
          <StepShell
            eyebrow="Votre rôle"
            title="Créons votre accès"
            text="Vous serez le gestionnaire principal de cette installation. Vous pourrez inviter d’autres proches plus tard."
          >
            <div className="elise-fields two-cols">
              <Field label="Prénom">
                <input
                  autoFocus
                  autoComplete="given-name"
                  value={draft.caregiver.firstName}
                  onChange={(e) => patchCaregiver({ firstName: e.target.value })}
                />
              </Field>
              <Field label="Nom">
                <input
                  autoComplete="family-name"
                  value={draft.caregiver.lastName}
                  onChange={(e) => patchCaregiver({ lastName: e.target.value })}
                />
              </Field>
              <Field label="Identifiant" hint="Il servira à vous connecter depuis le domicile.">
                <input
                  autoComplete="username"
                  placeholder="ex. paul.martin"
                  value={draft.caregiver.username}
                  onChange={(e) => patchCaregiver({ username: e.target.value })}
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
            eyebrow="Profil d’accompagnement"
            title="Qui Élise va-t-elle accompagner ?"
            text="Le résident n’a pas de compte à gérer. Ces quelques repères permettent simplement à Élise de s’adresser à lui naturellement."
          >
            <div className="elise-profile-grid">
              <label className="elise-photo">
                <span>{draft.resident.photoName ? <CircleCheck /> : <Upload />}</span>
                <strong>{draft.resident.photoName || 'Ajouter une photo'}</strong>
                <small>Facultatif · modifiable plus tard</small>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setResidentPhoto(file);
                    patchResident({ photoName: file?.name ?? '' });
                  }}
                />
              </label>
              <div className="elise-fields two-cols">
                <Field label="Prénom">
                  <input
                    autoFocus
                    value={draft.resident.firstName}
                    onChange={(e) =>
                      patchResident({
                        firstName: e.target.value,
                        dailyName: draft.resident.dailyName || e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Nom">
                  <input
                    value={draft.resident.lastName}
                    onChange={(e) => patchResident({ lastName: e.target.value })}
                  />
                </Field>
                <Field label="Prénom utilisé au quotidien">
                  <input
                    value={draft.resident.dailyName}
                    onChange={(e) => patchResident({ dailyName: e.target.value })}
                  />
                </Field>
                <Field label="Date de naissance" optional>
                  <input
                    type="date"
                    value={draft.resident.birthDate}
                    onChange={(e) => patchResident({ birthDate: e.target.value })}
                  />
                </Field>
                <Field label="Langue parlée">
                  <ModernSelect
                    value={draft.resident.language}
                    options={[
                      { value: 'Français', label: 'Français', icon: <FRFlag /> },
                      { value: 'English', label: 'English', icon: <GBFlag /> },
                    ]}
                    onChange={(language) => patchResident({ language })}
                  />
                </Field>
                <Field label="Comment Élise doit-elle s’adresser à lui ?">
                  <ModernSelect
                    value={draft.resident.addressAs}
                    options={[
                      { value: 'daily', label: draft.resident.dailyName || 'Par son prénom' },
                      { value: 'grandmother', label: `Mamie ${draft.resident.dailyName}` },
                      { value: 'grandfather', label: `Papi ${draft.resident.dailyName}` },
                      { value: 'formal-f', label: `Madame ${draft.resident.lastName}` },
                      { value: 'formal-m', label: `Monsieur ${draft.resident.lastName}` },
                      { value: 'nickname', label: 'Par son surnom…' },
                    ]}
                    onChange={(addressAs) => patchResident({ addressAs })}
                  />
                </Field>
                {draft.resident.addressAs === 'nickname' && (
                  <Field label="Surnom utilisé au quotidien" hint="Par exemple : Lili, Dédé, Mado…">
                    <input
                      autoFocus
                      placeholder="Son surnom"
                      value={draft.resident.customAddress}
                      onChange={(e) => patchResident({ customAddress: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </div>
          </StepShell>
        );
      case 3:
        return (
          <StepShell
            eyebrow="Son quotidien"
            title={`Comment vit ${residentName} ?`}
            text="Quelques repères suffisent pour comprendre le contexte du domicile. Élise ne vous demande pas de dossier médical."
          >
            <SectionLabel>
              Situation de vie <small>Plusieurs choix possibles</small>
            </SectionLabel>
            <div className="elise-choice-grid compact">
              {lifeOptions.map(([value, label, Icon]) => (
                <Choice
                  key={value}
                  active={draft.life.includes(value)}
                  onClick={() => setDraft((d) => ({ ...d, life: toggle(d.life, value) }))}
                >
                  <Icon />
                  {label}
                </Choice>
              ))}
            </div>
            <SectionLabel>Déplacements</SectionLabel>
            <div className="elise-choice-grid compact">
              {mobilityOptions.map(([value, label]) => (
                <Choice
                  key={value}
                  active={draft.mobility === value}
                  onClick={() => setDraft((d) => ({ ...d, mobility: value }))}
                >
                  {label}
                </Choice>
              ))}
            </div>
            <SectionLabel>
              Confort sensoriel <small>Facultatif</small>
            </SectionLabel>
            <div className="elise-choice-grid compact">
              <Choice
                active={draft.senses.includes('hearing')}
                onClick={() => setDraft((d) => ({ ...d, senses: toggle(d.senses, 'hearing') }))}
              >
                <Ear />
                Difficultés auditives
              </Choice>
              <Choice
                active={draft.senses.includes('vision')}
                onClick={() => setDraft((d) => ({ ...d, senses: toggle(d.senses, 'vision') }))}
              >
                <Eye />
                Difficultés visuelles
              </Choice>
              <Choice
                active={draft.senses.length === 0}
                onClick={() => setDraft((d) => ({ ...d, senses: [] }))}
              >
                Aucune difficulté signalée
              </Choice>
            </div>
          </StepShell>
        );
      case 4:
        return (
          <StepShell
            eyebrow="Adaptation intelligente"
            title="Informations importantes pour l’accompagnement"
            text="Certaines situations permettent à Élise d’adapter son comportement. Tout est facultatif et enregistré uniquement sur cette installation locale."
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
            eyebrow="Le lieu de vie"
            title="Créons le logement"
            text="Ce logement correspond à cette installation d’Élise. L’adresse n’est pas nécessaire au fonctionnement."
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
            eyebrow="Plan du domicile"
            title="Quelles pièces composent le logement ?"
            text="Ajoutez les espaces où seront placés les équipements. Vous pourrez compléter ce plan à tout moment."
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
            eyebrow="Cercle de confiance"
            title="Qui pourra être contacté ?"
            text="Ajoutez maintenant les personnes importantes, ou passez cette étape. Les rôles et l’ordre de priorité resteront modifiables."
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
            eyebrow="Premiers repères"
            title="À quoi ressemble une journée habituelle ?"
            text="Des plages approximatives suffisent. Élise observera le quotidien et vous proposera ensuite des repères plus justes."
          >
            <div className="elise-habits">
              {Object.entries(draft.habits).map(([name, value]) => (
                <div key={name}>
                  <div>
                    <strong>{name}</strong>
                    <small>
                      {value.unknown
                        ? 'Élise l’apprendra progressivement'
                        : `Entre ${value.from.replace(':', ' h ')} et ${value.to.replace(':', ' h ')}`}
                    </small>
                  </div>
                  <div className="elise-time-range">
                    <input
                      aria-label={`Début ${name}`}
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
                    <span>à</span>
                    <input
                      aria-label={`Fin ${name}`}
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
                  </div>
                  <label className="elise-unknown">
                    <input
                      type="checkbox"
                      checked={value.unknown}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          habits: { ...d.habits, [name]: { ...value, unknown: e.target.checked } },
                        }))
                      }
                    />
                    Je ne sais pas
                  </label>
                </div>
              ))}
            </div>
            <div className="elise-learning-note">
              <Sparkles />
              <div>
                <strong>Rien n’est figé</strong>
                <small>Ces horaires sont des repères de départ, jamais des règles rigides.</small>
              </div>
            </div>
          </StepShell>
        );
      case 9:
        return (
          <StepShell
            eyebrow="Connexion du domicile"
            title="Ajoutons les équipements présents"
            text="Toutes les fonctions d’Élise sont déjà disponibles. Il suffit de connecter les équipements installés dans le logement."
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
            eyebrow="Dernière vérification"
            title="Faisons un test ensemble"
            text="Vérifiez chaque équipement dans la pièce indiquée. Vous pourrez terminer même si l’un d’eux ne répond pas."
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
              <ShieldCheck />
              <div>
                <strong>Prêt à créer l’environnement de {residentName}</strong>
                <small>
                  Le compte, le logement et les préférences seront enregistrés ensemble sur cette
                  installation.
                </small>
              </div>
            </div>
          </StepShell>
        );
      default:
        return (
          <StepShell
            eyebrow="Installation terminée"
            title={`Élise est prête à découvrir le quotidien de ${residentName}`}
            text="Une période d’observation commence maintenant. Les routines vont se construire progressivement, sans alerte critique fondée sur les habitudes."
          >
            <div className="elise-success">
              <span>
                <CircleCheck />
              </span>
              <div className="elise-learning-timeline">
                <div className="active">
                  <b>1</b>
                  <strong>Aujourd’hui</strong>
                  <small>Observation discrète du domicile</small>
                </div>
                <div>
                  <b>2</b>
                  <strong>Dans quelques jours</strong>
                  <small>Premières habitudes proposées</small>
                </div>
                <div>
                  <b>3</b>
                  <strong>Avec votre accord</strong>
                  <small>Repères validés ou ajustés</small>
                </div>
              </div>
              <blockquote>
                « J’ai remarqué que {residentName} se lève généralement entre 8 h et 9 h.
                Souhaitez-vous utiliser cette habitude comme référence ? »
              </blockquote>
            </div>
            <button className="elise-primary final" type="button" onClick={onCompleted}>
              Découvrir l’espace de {residentName}
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
          <span>
            <Home />
          </span>
          <div>
            <strong>Élise</strong>
            <small>{step === 0 ? 'OS · Installation locale' : 'Installation locale'}</small>
          </div>
        </div>
        <div className="elise-header-right">
          <span className="elise-saved">
            <CircleCheck /> Brouillon enregistré sur cet appareil
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
          <span>{step === 0 ? 'Installation d’Élise OS' : 'Installation d’Élise'}</span>
          <strong>
            Étape {step + 1} sur {steps.length} · {steps[step]}
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
                setStep((v) => v - 1);
              }}
            >
              <ArrowLeft /> Retour
            </button>
            <span>Tout pourra être modifié plus tard.</span>
            <button
              type="button"
              className="elise-primary"
              onClick={() => void next()}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <LoaderCircle className="spin" /> Création en cours…
                </>
              ) : (
                <>
                  {step === 10 ? 'Commencer l’apprentissage' : 'Continuer'}
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
          ? 'Vos données restent stockées localement sur votre installation Élise OS.'
          : 'Vos données restent stockées localement par Élise.'}
      </footer>
    </main>
  );
}

function StepShell({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className="elise-panel">
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
function ModernSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; icon?: React.ReactNode }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div className={`elise-modern-select ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="elise-modern-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected?.icon && <span className="elise-option-icon">{selected.icon}</span>}
        <strong>{selected?.label}</strong>
        <ChevronDown />
      </button>
      {open && (
        <div className="elise-modern-options" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={value === option.value ? 'selected' : ''}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.icon && <span className="elise-option-icon">{option.icon}</span>}
              <span>{option.label}</span>
              {value === option.value && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="elise-welcome">
      <div className="elise-welcome-copy">
        <span className="elise-kicker">
          <Sparkles /> Bienvenue chez vous
        </span>
        <h1>Préparons Élise pour une personne qui compte.</h1>
        <p>
          En quelques étapes, vous allez présenter le résident, son logement et les équipements
          présents. Élise apprendra ensuite, naturellement.
        </p>
        <button className="elise-primary welcome" type="button" onClick={onStart}>
          Commencer l’installation <ArrowRight />
        </button>
        <small>
          <ShieldCheck /> Vos données restent stockées localement sur votre installation Élise OS.
        </small>
      </div>
      <div className="elise-home-card">
        <div className="elise-home-orbit one" />
        <div className="elise-home-orbit two" />
        <span className="elise-home-icon">
          <Home />
        </span>
        <div className="elise-signal signal-one">
          <Radar />
          <span>Observe</span>
        </div>
        <div className="elise-signal signal-two">
          <HeartHandshake />
          <span>Accompagne</span>
        </div>
        <div className="elise-signal signal-three">
          <BellRing />
          <span>Rassure</span>
        </div>
        <div className="elise-device">
          <i />
          <span>Élise OS</span>
          <small>Installation prête</small>
        </div>
      </div>
      <div className="elise-pill-row">
        <span>
          <ShieldCheck /> Entièrement local
        </span>
        <span>
          <Eye /> Sans caméra
        </span>
        <span>
          <Languages /> Simple et humain
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
