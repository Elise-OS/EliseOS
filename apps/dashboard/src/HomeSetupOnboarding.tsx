import type { HomeSetupStage, RequestedRoom } from '@elise/contracts';
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
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { t, textBlock } from './i18n';

type Locale = 'fr' | 'en';

export type HomeSetupDetails = {
  name: string;
  type: string;
  address: string;
  timezone: string;
  levels: number;
};

// Room names are in the catalogs (homeSetupOnboarding.roomKind.<kind>).
const roomCatalog = [
  ['ENTRANCE', DoorOpen],
  ['LIVING_ROOM', Sofa],
  ['KITCHEN', CookingPot],
  ['DINING_ROOM', Utensils],
  ['BEDROOM', BedDouble],
  ['BATHROOM', Bath],
  ['TOILET', Toilet],
  ['HALLWAY', Footprints],
  ['GARAGE', Warehouse],
  ['GARDEN', Trees],
  ['TERRACE', Sun],
  ['OTHER', Boxes],
] as const;
type RoomKind = (typeof roomCatalog)[number][0];
const roomKindName = (kind: RoomKind) => t(`homeSetupOnboarding.roomKind.${kind}`);

const draftId = () =>
  `requested-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;

const floorName = (floor: number) =>
  floor === 0
    ? t('common.levelName.ground')
    : floor === 1
      ? t('common.levelName.first')
      : t('common.levelName.numbered', { floor });

function Progress({ stage }: { stage: HomeSetupStage; locale: Locale }) {
  const current = stage === 'DETAILS' ? 0 : stage === 'ROOMS' ? 1 : 2;
  const labels = [
    t('homeSetupOnboarding.progressStep.home'),
    t('homeSetupOnboarding.progressStep.rooms'),
    t('homeSetupOnboarding.progressStep.drawing'),
  ];
  return (
    <ol className="home-setup-progress" aria-label={t('homeSetupOnboarding.progress')}>
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
  const [details, setDetails] = useState<HomeSetupDetails>({ ...home, levels: floorCount });
  const [rooms, setRooms] = useState<RequestedRoom[]>(requestedRooms);
  const [localError, setLocalError] = useState('');
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => setRooms(requestedRooms), [requestedRooms]);
  useEffect(
    () => setDetails({ ...home, levels: floorCount }),
    [floorCount, home.address, home.name, home.timezone, home.type],
  );

  const addRoom = (kind: RoomKind) => {
    const base = roomKindName(kind);
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
      setLocalError(t('homeSetupOnboarding.giveTheHomeAName'));
      return;
    }
    setLocalError('');
    await onSaveDetails({ ...details, name: details.name.trim(), address: details.address.trim() });
  };
  const submitRooms = async () => {
    if (!rooms.length || rooms.some(({ name }) => !name.trim())) {
      setLocalError(t('homeSetupOnboarding.addAndNameAtLeast'));
      return;
    }
    const names = rooms.map(({ name }) => name.trim().toLocaleLowerCase(locale));
    if (new Set(names).size !== names.length) {
      setLocalError(t('homeSetupOnboarding.eachRoomNeedsAUnique'));
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
            <small>{t('homeSetupOnboarding.homeSetup')}</small>
          </span>
        </div>
        {preview && (
          <button type="button" onClick={onClosePreview} className="home-setup-close">
            <X /> {t('homeSetupOnboarding.exitPreview')}
          </button>
        )}
      </header>
      <Progress stage={stage} locale={locale} />

      {stage === 'DETAILS' && (
        <div className="home-setup-card home-setup-details">
          <span className="eyebrow">{t('homeSetupOnboarding.letSStartSimply')}</span>
          <h1>{t('homeSetupOnboarding.tellUsAboutTheHome')}</h1>
          <p>{t('homeSetupOnboarding.theseDetailsStructureThePlan')}</p>
          <div className="home-setup-fields">
            <label>
              {t('homeSetupOnboarding.homeName')}
              <input
                autoFocus
                value={details.name}
                placeholder={t('homeSetupOnboarding.marieSHome')}
                onChange={(event) =>
                  setDetails((value) => ({ ...value, name: event.target.value }))
                }
              />
            </label>
            <label>
              {t('homeSetupOnboarding.homeType')}
              <select
                value={details.type}
                onChange={(event) =>
                  setDetails((value) => ({ ...value, type: event.target.value }))
                }
              >
                {textBlock('homeSetupOnboarding.homeTypes').map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{t('homeSetupOnboarding.numberOfFloors')}</legend>
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
              {t('homeSetupOnboarding.addressOptional')}
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
              <strong>{t('homeSetupOnboarding.detectedTimeZone')}</strong>
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
              {busy ? t('homeSetupOnboarding.saving') : t('homeSetupOnboarding.chooseRooms')}
              <ArrowRight />
            </button>
          </footer>
        </div>
      )}

      {stage === 'ROOMS' && (
        <div className="home-setup-card home-setup-rooms">
          <div className="home-setup-rooms-heading">
            <div>
              <span className="eyebrow">{t('homeSetupOnboarding.yourFuturePlan')}</span>
              <h1>{t('homeSetupOnboarding.whichRoomsAreInThe')}</h1>
              <p>{t('homeSetupOnboarding.addTheKnownRoomsAnd')}</p>
            </div>
            <div className="home-setup-room-total" aria-live="polite">
              <strong>{rooms.length}</strong>
              <span>{t('homeSetupOnboarding.roomsAdded', { count: rooms.length })}</span>
            </div>
          </div>
          <div className="home-room-catalog">
            {roomCatalog.map(([kind, Icon]) => {
              const count = rooms.filter((room) => room.kind === kind).length;
              return (
                <div className={count ? 'is-selected' : ''} key={kind}>
                  <button
                    className="room-counter-minus"
                    type="button"
                    aria-label={`${t('homeSetupOnboarding.remove')} ${roomKindName(kind)}`}
                    disabled={!count}
                    onClick={() => removeLast(kind)}
                  >
                    <Minus />
                  </button>
                  <span className="home-room-catalog-copy">
                    <i>
                      <Icon aria-hidden="true" />
                    </i>
                    <strong>{roomKindName(kind)}</strong>
                    <small>{count}</small>
                  </span>
                  <button
                    className="room-counter-plus"
                    type="button"
                    aria-label={`${t('homeSetupOnboarding.add')} ${roomKindName(kind)}`}
                    onClick={() => addRoom(kind)}
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
                  <strong>{t('homeSetupOnboarding.addedRooms')}</strong>
                  <small>{t('homeSetupOnboarding.setTheirNameAndFloor')}</small>
                </div>
              </header>
              <div className="home-requested-rooms-list">
                {rooms.map((room) => {
                  const RoomIcon = roomCatalog.find(([kind]) => kind === room.kind)?.[1] ?? Grid2X2;
                  return (
                    <div key={room.id}>
                      <span className="home-requested-room-icon">
                        <RoomIcon aria-hidden="true" />
                      </span>
                      <input
                        aria-label={t('homeSetupOnboarding.roomName')}
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
                        aria-label={t('homeSetupOnboarding.floor')}
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
                            {floorName(floor)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`${t('homeSetupOnboarding.delete')} ${room.name}`}
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
              {t('homeSetupOnboarding.back')}
            </button>
            <button
              className="home-setup-primary"
              disabled={busy}
              onClick={() => void submitRooms()}
            >
              {t('homeSetupOnboarding.seeHowToDraw')}
              <ArrowRight />
            </button>
          </footer>
        </div>
      )}

      {stage === 'EXAMPLE' && (
        <div className="home-setup-card home-setup-example">
          <div className="home-example-copy">
            <span className="eyebrow">{t('homeSetupOnboarding.aSimpleReadablePlan')}</span>
            <h1>{t('homeSetupOnboarding.everyRoomKeepsItsPlace')}</h1>
            <p>{t('homeSetupOnboarding.roomsAreDrawnSeparatelyOn')}</p>
            <ul>
              <li>
                <CircleCheck />
                {t('homeSetupOnboarding.drawOneShapePerRoom')}
              </li>
              <li>
                <CircleCheck />
                {t('homeSetupOnboarding.leaveSpaceBetweenThem')}
              </li>
              <li>
                <CircleCheck />
                {t('homeSetupOnboarding.connectThemLaterIfYou')}
              </li>
            </ul>
          </div>
          <figure className="home-example-image">
            <img src="/craftlogement.png" alt={t('homeSetupOnboarding.exampleOfAnEliseFloor')} />
            <figcaption>{t('homeSetupOnboarding.exampleOfACompletedFloor')}</figcaption>
          </figure>
          <div className="home-drawing-demo" key={animationKey}>
            <header>
              <span>
                <Sparkles />
              </span>
              <div>
                <strong>{t('homeSetupOnboarding.watchTheGesture')}</strong>
                <small>{t('homeSetupOnboarding.eliseDemonstratesNothingIsAdded')}</small>
              </div>
              <button type="button" onClick={() => setAnimationKey((value) => value + 1)}>
                <RotateCcw />
                {t('homeSetupOnboarding.replay')}
              </button>
            </header>
            <div
              className="home-demo-stage"
              aria-label={t('homeSetupOnboarding.drawingDemonstrationAnimation')}
            >
              <div className="home-demo-toolbar">
                <span className="demo-select">
                  <MousePointer2 />
                  {t('homeSetupOnboarding.select')}
                </span>
                <span className="demo-room">
                  <Grid2X2 />
                  {t('homeSetupOnboarding.room')}
                </span>
                <span className="demo-link">
                  <Link2 />
                  {t('homeSetupOnboarding.connect')}
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
                  {t('homeSetupOnboarding.livingRoom')}
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
                  {t('homeSetupOnboarding.kitchen')}
                </text>
                <path className="demo-connection" d="M295 151 C350 92 382 224 430 162" />
                <circle className="demo-pointer-dot" cx="0" cy="0" r="10" />
              </svg>
              <span className="home-demo-pointer">
                <MousePointer2 />
              </span>
              <ol>
                <li>{t('homeSetupOnboarding.chooseRoom')}</li>
                <li>{t('homeSetupOnboarding.dragOnTheGrid')}</li>
                <li>{t('homeSetupOnboarding.drawTheNextOne')}</li>
                <li>{t('homeSetupOnboarding.connectIfNeeded')}</li>
              </ol>
            </div>
          </div>
          {error && <p className="home-setup-error">{error}</p>}
          <footer>
            <button className="home-setup-secondary" disabled={busy} onClick={() => void onBack()}>
              <ArrowLeft />
              {t('homeSetupOnboarding.back')}
            </button>
            <button
              className="home-setup-primary"
              disabled={busy}
              onClick={() => void onBeginDrawing()}
            >
              <Play />
              {t('homeSetupOnboarding.letMeDraw')}
              <ArrowRight />
            </button>
          </footer>
        </div>
      )}
    </section>
  );
}

export function DrawingSetupPanel({
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
  const remaining = requestedRooms.filter(({ id }) => !drawnRoomIds.has(id)).length;
  return (
    <aside className="drawing-setup-panel" aria-label={t('homeSetupOnboarding.planCreationGuide')}>
      <div className="drawing-coach">
        <span>
          <Sparkles />
        </span>
        <div>
          <small>{t('homeSetupOnboarding.yourTurn')}</small>
          <strong>{t('homeSetupOnboarding.chooseARoomThenDraw')}</strong>
          <p>{t('homeSetupOnboarding.pressTheGridHoldAnd')}</p>
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
              <small>{floorName(room.floor)}</small>
            </button>
          );
        })}
      </div>
      <div className="drawing-setup-actions">
        <button type="button" onClick={onShowExample}>
          <Eye />
          {t('homeSetupOnboarding.viewExample')}
        </button>
        {preview && (
          <button type="button" onClick={onClosePreview}>
            <X />
            {t('homeSetupOnboarding.exit')}
          </button>
        )}
        <button
          type="button"
          className="drawing-confirm"
          disabled={!roomCount || busy}
          onClick={onConfirm}
        >
          {busy ? t('homeSetupOnboarding.saving') : t('homeSetupOnboarding.confirmMyPlan')}
          <ArrowRight />
        </button>
      </div>
      {!!remaining && !!roomCount && (
        <small className="drawing-remaining">
          {t('homeSetupOnboarding.roomSCanBeDrawn', { remaining })}
        </small>
      )}
      {error && <p className="home-setup-error">{error}</p>}
    </aside>
  );
}

export function ExampleOverlay({ onClose }: { locale: Locale; onClose: () => void }) {
  return (
    <div
      className="home-example-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('homeSetupOnboarding.planExample')}
    >
      <button type="button" onClick={onClose}>
        <X />
        <span className="sr-only">{t('homeSetupOnboarding.close')}</span>
      </button>
      <img src="/craftlogement.png" alt={t('homeSetupOnboarding.exampleFloorWithSeparatedAnd')} />
      <p>{t('homeSetupOnboarding.roomsRemainSeparateLinksShow')}</p>
    </div>
  );
}
