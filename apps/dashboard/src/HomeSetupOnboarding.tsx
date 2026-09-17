import type { HomeSetupStage, RequestedRoom } from '@michel/contracts';
import {
  ArrowLeft,
  ArrowRight,
  Bath,
  BedDouble,
  Boxes,
  Check,
  CircleCheck,
  CookingPot,
  DoorOpen,
  Eye,
  Footprints,
  Grid2X2,
  Link2,
  MapPin,
  Minus,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Sofa,
  Sparkles,
  Sun,
  Toilet,
  Trees,
  Utensils,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

type Locale = 'fr' | 'en';

export type HomeSetupDetails = {
  name: string;
  type: string;
  address: string;
  timezone: string;
  levels: number;
};

const roomCatalog: ReadonlyArray<readonly [string, string, string, LucideIcon]> = [
  ['ENTRANCE', 'Entrée', 'Entrance', DoorOpen],
  ['LIVING_ROOM', 'Salon', 'Living room', Sofa],
  ['KITCHEN', 'Cuisine', 'Kitchen', CookingPot],
  ['DINING_ROOM', 'Salle à manger', 'Dining room', Utensils],
  ['BEDROOM', 'Chambre', 'Bedroom', BedDouble],
  ['BATHROOM', 'Salle de bain', 'Bathroom', Bath],
  ['TOILET', 'Toilettes', 'Toilet', Toilet],
  ['HALLWAY', 'Couloir', 'Hallway', Footprints],
  ['GARAGE', 'Garage', 'Garage', Warehouse],
  ['GARDEN', 'Jardin', 'Garden', Trees],
  ['TERRACE', 'Terrasse', 'Terrace', Sun],
  ['OTHER', 'Autre', 'Other', Boxes],
];

const draftId = () =>
  `requested-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;

const floorName = (floor: number, locale: Locale) => {
  if (locale === 'en') return floor === 0 ? 'Ground floor' : `Floor ${floor}`;
  return floor === 0 ? 'Rez-de-chaussée' : floor === 1 ? '1er étage' : `${floor}e étage`;
};

function Progress({ stage, locale }: { stage: HomeSetupStage; locale: Locale }) {
  const current = stage === 'DETAILS' ? 0 : stage === 'ROOMS' ? 1 : 2;
  const labels =
    locale === 'fr'
      ? ['Le logement', 'Les pièces', 'Comment dessiner']
      : ['The home', 'The rooms', 'How to draw'];
  return (
    <ol className="home-setup-progress" aria-label={locale === 'fr' ? 'Progression' : 'Progress'}>
      {labels.map((label, index) => (
        <li className={index <= current ? 'is-active' : ''} key={label}>
          <span>{index < current ? <Check /> : index + 1}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  );
}

export function HomeSetupOnboarding({
  locale,
  stage,
  home,
  floorCount,
  requestedRooms,
  busy,
  error,
  preview,
  onSaveDetails,
  onSaveRooms,
  onBack,
  onBeginDrawing,
  onClosePreview,
}: {
  locale: Locale;
  stage: Exclude<HomeSetupStage, 'DRAW'>;
  home: Omit<HomeSetupDetails, 'levels'>;
  floorCount: number;
  requestedRooms: RequestedRoom[];
  busy: boolean;
  error: string;
  preview: boolean;
  onSaveDetails: (details: HomeSetupDetails) => Promise<void>;
  onSaveRooms: (rooms: RequestedRoom[]) => Promise<void>;
  onBack: () => Promise<void>;
  onBeginDrawing: () => Promise<void>;
  onClosePreview?: (() => void) | undefined;
}) {
  const fr = locale === 'fr';
  const [details, setDetails] = useState<HomeSetupDetails>({ ...home, levels: floorCount });
  const [rooms, setRooms] = useState<RequestedRoom[]>(requestedRooms);
  const [localError, setLocalError] = useState('');
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => setRooms(requestedRooms), [requestedRooms]);
  useEffect(
    () => setDetails({ ...home, levels: floorCount }),
    [floorCount, home.address, home.name, home.timezone, home.type],
  );

  const addRoom = (kind: string, french: string, english: string) => {
    const base = fr ? french : english;
    const count = rooms.filter((room) => room.kind === kind).length;
    setRooms((current) => [
      ...current,
      { id: draftId(), name: count ? `${base} ${count + 1}` : base, kind, floor: 0 },
    ]);
  };
  const removeLast = (kind: string) => {
    const target = [...rooms].reverse().find((room) => room.kind === kind);
    if (target) setRooms((current) => current.filter(({ id }) => id !== target.id));
  };

  const submitDetails = async () => {
    if (!details.name.trim()) {
      setLocalError(fr ? 'Donnez un nom au logement.' : 'Give the home a name.');
      return;
    }
    setLocalError('');
    await onSaveDetails({ ...details, name: details.name.trim(), address: details.address.trim() });
  };
  const submitRooms = async () => {
    if (!rooms.length || rooms.some(({ name }) => !name.trim())) {
      setLocalError(
        fr ? 'Ajoutez et nommez au moins une pièce.' : 'Add and name at least one room.',
      );
      return;
    }
    const names = rooms.map(({ name }) => name.trim().toLocaleLowerCase(locale));
    if (new Set(names).size !== names.length) {
      setLocalError(
        fr ? 'Chaque pièce doit avoir un nom unique.' : 'Each room needs a unique name.',
      );
      return;
    }
    setLocalError('');
    await onSaveRooms(rooms.map((room) => ({ ...room, name: room.name.trim() })));
  };

  return (
    <section className="home-setup-page">
      <header className="home-setup-topbar">
        <div>
          <img className="home-setup-mark" src="/logo-transparent.png" alt="" />
          <span>
            <span className="home-setup-wordmark">
              élise<span className="brand-os">OS</span>
            </span>
            <small>{fr ? 'Création du logement' : 'Home setup'}</small>
          </span>
        </div>
        {preview && (
          <button type="button" onClick={onClosePreview} className="home-setup-close">
            <X /> {fr ? 'Quitter l’aperçu' : 'Exit preview'}
          </button>
        )}
      </header>
      <Progress stage={stage} locale={locale} />

      {stage === 'DETAILS' && (
        <div className="home-setup-card home-setup-details">
          <span className="eyebrow">{fr ? 'Commençons simplement' : 'Let’s start simply'}</span>
          <h1>{fr ? 'Parlez-nous du logement' : 'Tell us about the home'}</h1>
          <p>
            {fr
              ? 'Ces informations structurent le plan. Vous pourrez les modifier plus tard.'
              : 'These details structure the plan. You can change them later.'}
          </p>
          <div className="home-setup-fields">
            <label>
              {fr ? 'Nom du logement' : 'Home name'}
              <input
                autoFocus
                value={details.name}
                placeholder={fr ? 'Maison de Marie' : 'Marie’s home'}
                onChange={(event) =>
                  setDetails((value) => ({ ...value, name: event.target.value }))
                }
              />
            </label>
            <label>
              {fr ? 'Type de logement' : 'Home type'}
              <select
                value={details.type}
                onChange={(event) =>
                  setDetails((value) => ({ ...value, type: event.target.value }))
                }
              >
                {(fr
                  ? ['Maison', 'Appartement', 'Résidence services', 'Autre']
                  : ['House', 'Apartment', 'Assisted living', 'Other']
                ).map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{fr ? 'Nombre de niveaux' : 'Number of floors'}</legend>
              <div className="home-setup-levels">
                {[1, 2, 3, 4].map((count) => (
                  <button
                    type="button"
                    className={details.levels === count ? 'is-active' : ''}
                    key={count}
                    onClick={() => setDetails((value) => ({ ...value, levels: count }))}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              {fr ? 'Adresse (facultatif)' : 'Address (optional)'}
              <input
                value={details.address}
                onChange={(event) =>
                  setDetails((value) => ({ ...value, address: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="home-setup-timezone">
            <MapPin />
            <span>
              <strong>{fr ? 'Fuseau horaire détecté' : 'Detected time zone'}</strong>
              <small>{details.timezone}</small>
            </span>
            <CircleCheck />
          </div>
          {(localError || error) && <p className="home-setup-error">{localError || error}</p>}
          <footer>
            <i />
            <button
              className="home-setup-primary"
              disabled={busy}
              onClick={() => void submitDetails()}
            >
              {busy
                ? fr
                  ? 'Enregistrement…'
                  : 'Saving…'
                : fr
                  ? 'Choisir les pièces'
                  : 'Choose rooms'}
              <ArrowRight />
            </button>
          </footer>
        </div>
      )}

      {stage === 'ROOMS' && (
        <div className="home-setup-card home-setup-rooms">
          <div className="home-setup-rooms-heading">
            <div>
              <span className="eyebrow">{fr ? 'Votre futur plan' : 'Your future plan'}</span>
              <h1>
                {fr ? 'Quelles pièces composent le logement ?' : 'Which rooms are in the home?'}
              </h1>
              <p>
                {fr
                  ? 'Ajoutez les pièces connues et indiquez leur niveau. Vous les dessinerez vous-même juste après.'
                  : 'Add the known rooms and assign their floor. You will draw them yourself next.'}
              </p>
            </div>
            <div className="home-setup-room-total" aria-live="polite">
              <strong>{rooms.length}</strong>
              <span>
                {fr ? (rooms.length > 1 ? 'pièces ajoutées' : 'pièce ajoutée') : 'rooms added'}
              </span>
            </div>
          </div>
          <div className="home-room-catalog">
            {roomCatalog.map(([kind, french, english, Icon]) => {
              const count = rooms.filter((room) => room.kind === kind).length;
              return (
                <div className={count ? 'is-selected' : ''} key={kind}>
                  <button
                    className="room-counter-minus"
                    type="button"
                    aria-label={`${fr ? 'Retirer' : 'Remove'} ${fr ? french : english}`}
                    disabled={!count}
                    onClick={() => removeLast(kind)}
                  >
                    <Minus />
                  </button>
                  <span className="home-room-catalog-copy">
                    <i>
                      <Icon aria-hidden="true" />
                    </i>
                    <strong>{fr ? french : english}</strong>
                    <small>{count}</small>
                  </span>
                  <button
                    className="room-counter-plus"
                    type="button"
                    aria-label={`${fr ? 'Ajouter' : 'Add'} ${fr ? french : english}`}
                    onClick={() => addRoom(kind, french, english)}
                  >
                    <Plus />
                  </button>
                </div>
              );
            })}
          </div>
          {!!rooms.length && (
            <div className="home-requested-rooms">
              <header>
                <div>
                  <strong>{fr ? 'Pièces ajoutées' : 'Added rooms'}</strong>
                  <small>
                    {fr ? 'Personnalisez leur nom et leur niveau.' : 'Set their name and floor.'}
                  </small>
                </div>
              </header>
              <div className="home-requested-rooms-list">
                {rooms.map((room) => {
                  const RoomIcon = roomCatalog.find(([kind]) => kind === room.kind)?.[3] ?? Grid2X2;
                  return (
                    <div key={room.id}>
                      <span className="home-requested-room-icon">
                        <RoomIcon aria-hidden="true" />
                      </span>
                      <input
                        aria-label={fr ? 'Nom de la pièce' : 'Room name'}
                        value={room.name}
                        onChange={(event) =>
                          setRooms((current) =>
                            current.map((item) =>
                              item.id === room.id ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <select
                        aria-label={fr ? 'Niveau' : 'Floor'}
                        value={room.floor}
                        onChange={(event) =>
                          setRooms((current) =>
                            current.map((item) =>
                              item.id === room.id
                                ? { ...item, floor: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      >
                        {Array.from({ length: floorCount }, (_, floor) => (
                          <option value={floor} key={floor}>
                            {floorName(floor, locale)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`${fr ? 'Supprimer' : 'Delete'} ${room.name}`}
                        onClick={() =>
                          setRooms((current) => current.filter(({ id }) => id !== room.id))
                        }
                      >
                        <X />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(localError || error) && <p className="home-setup-error">{localError || error}</p>}
          <footer>
            <button className="home-setup-secondary" disabled={busy} onClick={() => void onBack()}>
              <ArrowLeft />
              {fr ? 'Retour' : 'Back'}
            </button>
            <button
              className="home-setup-primary"
              disabled={busy}
              onClick={() => void submitRooms()}
            >
              {fr ? 'Voir comment dessiner' : 'See how to draw'}
              <ArrowRight />
            </button>
          </footer>
        </div>
      )}

      {stage === 'EXAMPLE' && (
        <div className="home-setup-card home-setup-example">
          <div className="home-example-copy">
            <span className="eyebrow">
              {fr ? 'Un plan simple et lisible' : 'A simple, readable plan'}
            </span>
            <h1>{fr ? 'Chaque pièce garde sa place' : 'Every room keeps its place'}</h1>
            <p>
              {fr
                ? 'Les pièces sont dessinées séparément sur la grille. Les courbes indiquent ensuite comment on passe de l’une à l’autre.'
                : 'Rooms are drawn separately on the grid. Curves then show how you move between them.'}
            </p>
            <ul>
              <li>
                <CircleCheck />
                {fr ? 'Dessinez une forme par pièce' : 'Draw one shape per room'}
              </li>
              <li>
                <CircleCheck />
                {fr ? 'Laissez de l’espace entre elles' : 'Leave space between them'}
              </li>
              <li>
                <CircleCheck />
                {fr ? 'Reliez-les ensuite si vous le souhaitez' : 'Connect them later if you wish'}
              </li>
            </ul>
          </div>
          <figure className="home-example-image">
            <img
              src="/craftlogement.png"
              alt={
                fr
                  ? 'Exemple d’un étage Élise avec des pièces séparées et reliées'
                  : 'Example of an Élise floor with separated and connected rooms'
              }
            />
            <figcaption>
              {fr
                ? 'Exemple d’un étage terminé dans Élise OS'
                : 'Example of a completed floor in Élise OS'}
            </figcaption>
          </figure>
          <div className="home-drawing-demo" key={animationKey}>
            <header>
              <span>
                <Sparkles />
              </span>
              <div>
                <strong>{fr ? 'Regardez le geste' : 'Watch the gesture'}</strong>
                <small>
                  {fr
                    ? 'Élise vous montre, rien n’est ajouté à votre plan.'
                    : 'Élise demonstrates; nothing is added to your plan.'}
                </small>
              </div>
              <button type="button" onClick={() => setAnimationKey((value) => value + 1)}>
                <RotateCcw />
                {fr ? 'Rejouer' : 'Replay'}
              </button>
            </header>
            <div
              className="home-demo-stage"
              aria-label={
                fr ? 'Animation de démonstration du dessin' : 'Drawing demonstration animation'
              }
            >
              <div className="home-demo-toolbar">
                <span className="demo-select">
                  <MousePointer2 />
                  {fr ? 'Sélectionner' : 'Select'}
                </span>
                <span className="demo-room">
                  <Grid2X2 />
                  {fr ? 'Pièce' : 'Room'}
                </span>
                <span className="demo-link">
                  <Link2 />
                  {fr ? 'Relier' : 'Connect'}
                </span>
              </div>
              <svg viewBox="0 0 720 310" role="img">
                <defs>
                  <pattern
                    id={`setup-grid-${animationKey}`}
                    width="18"
                    height="18"
                    patternUnits="userSpaceOnUse"
                  >
                    <path d="M18 0H0V18" fill="none" stroke="#dbe4e7" />
                  </pattern>
                </defs>
                <rect width="720" height="310" fill={`url(#setup-grid-${animationKey})`} />
                <rect
                  className="demo-shape demo-shape-one"
                  x="75"
                  y="78"
                  width="220"
                  height="145"
                  rx="2"
                />
                <text className="demo-label demo-label-one" x="185" y="151">
                  {fr ? 'Salon' : 'Living room'}
                </text>
                <rect
                  className="demo-shape demo-shape-two"
                  x="430"
                  y="102"
                  width="180"
                  height="120"
                  rx="2"
                />
                <text className="demo-label demo-label-two" x="520" y="164">
                  {fr ? 'Cuisine' : 'Kitchen'}
                </text>
                <path className="demo-connection" d="M295 151 C350 92 382 224 430 162" />
                <circle className="demo-pointer-dot" cx="0" cy="0" r="10" />
              </svg>
              <span className="home-demo-pointer">
                <MousePointer2 />
              </span>
              <ol>
                <li>{fr ? 'Choisir Pièce' : 'Choose Room'}</li>
                <li>{fr ? 'Glisser sur la grille' : 'Drag on the grid'}</li>
                <li>{fr ? 'Dessiner la suivante' : 'Draw the next one'}</li>
                <li>{fr ? 'Relier si nécessaire' : 'Connect if needed'}</li>
              </ol>
            </div>
          </div>
          {error && <p className="home-setup-error">{error}</p>}
          <footer>
            <button className="home-setup-secondary" disabled={busy} onClick={() => void onBack()}>
              <ArrowLeft />
              {fr ? 'Retour' : 'Back'}
            </button>
            <button
              className="home-setup-primary"
              disabled={busy}
              onClick={() => void onBeginDrawing()}
            >
              <Play />
              {fr ? 'À moi de dessiner' : 'Let me draw'}
              <ArrowRight />
            </button>
          </footer>
        </div>
      )}
    </section>
  );
}

export function DrawingSetupPanel({
  locale,
  requestedRooms,
  drawnRoomIds,
  selectedRoomId,
  roomCount,
  busy,
  error,
  preview,
  onSelect,
  onShowExample,
  onConfirm,
  onClosePreview,
}: {
  locale: Locale;
  requestedRooms: RequestedRoom[];
  drawnRoomIds: Set<string>;
  selectedRoomId: string | null;
  roomCount: number;
  busy: boolean;
  error: string;
  preview: boolean;
  onSelect: (room: RequestedRoom) => void;
  onShowExample: () => void;
  onConfirm: () => void;
  onClosePreview?: (() => void) | undefined;
}) {
  const fr = locale === 'fr';
  const remaining = requestedRooms.filter(({ id }) => !drawnRoomIds.has(id)).length;
  return (
    <aside
      className="drawing-setup-panel"
      aria-label={fr ? 'Guide de création du plan' : 'Plan creation guide'}
    >
      <div className="drawing-coach">
        <span>
          <Sparkles />
        </span>
        <div>
          <small>{fr ? 'À vous de jouer' : 'Your turn'}</small>
          <strong>
            {fr
              ? 'Choisissez une pièce, puis tracez sa forme sur la grille.'
              : 'Choose a room, then draw its shape on the grid.'}
          </strong>
          <p>
            {fr
              ? 'Appuyez sur la grille, maintenez et faites glisser. Sur mobile, utilisez le même geste avec le doigt.'
              : 'Press the grid, hold and drag. On mobile, use the same gesture with your finger.'}
          </p>
        </div>
      </div>
      <div className="drawing-room-checklist">
        {requestedRooms.map((room) => {
          const done = drawnRoomIds.has(room.id);
          return (
            <button
              type="button"
              disabled={done}
              className={`${done ? 'is-done' : ''} ${selectedRoomId === room.id ? 'is-selected' : ''}`}
              key={room.id}
              onClick={() => onSelect(room)}
            >
              <span>{done ? <Check /> : <Grid2X2 />}</span>
              <strong>{room.name}</strong>
              <small>{floorName(room.floor, locale)}</small>
            </button>
          );
        })}
      </div>
      <div className="drawing-setup-actions">
        <button type="button" onClick={onShowExample}>
          <Eye />
          {fr ? 'Voir l’exemple' : 'View example'}
        </button>
        {preview && (
          <button type="button" onClick={onClosePreview}>
            <X />
            {fr ? 'Quitter' : 'Exit'}
          </button>
        )}
        <button
          type="button"
          className="drawing-confirm"
          disabled={!roomCount || busy}
          onClick={onConfirm}
        >
          {busy
            ? fr
              ? 'Enregistrement…'
              : 'Saving…'
            : fr
              ? 'Confirmer mon plan'
              : 'Confirm my plan'}
          <ArrowRight />
        </button>
      </div>
      {!!remaining && !!roomCount && (
        <small className="drawing-remaining">
          {fr
            ? `${remaining} pièce(s) pourront être dessinées plus tard.`
            : `${remaining} room(s) can be drawn later.`}
        </small>
      )}
      {error && <p className="home-setup-error">{error}</p>}
    </aside>
  );
}

export function ExampleOverlay({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const fr = locale === 'fr';
  return (
    <div
      className="home-example-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={fr ? 'Exemple de plan' : 'Plan example'}
    >
      <button type="button" onClick={onClose}>
        <X />
        <span className="sr-only">{fr ? 'Fermer' : 'Close'}</span>
      </button>
      <img
        src="/craftlogement.png"
        alt={
          fr
            ? 'Exemple d’un étage avec des pièces séparées et reliées'
            : 'Example floor with separated and connected rooms'
        }
      />
      <p>
        {fr
          ? 'Les pièces restent séparées ; les liaisons montrent les passages.'
          : 'Rooms remain separate; links show the passages.'}
      </p>
    </div>
  );
}
