import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  DoorOpen,
  Droplets,
  EyeOff,
  Flame,
  Grid2X2,
  House,
  Layers,
  LoaderCircle,
  Plus,
  Radio,
  ShieldAlert,
  Sun,
  Thermometer,
  UserRound,
  Wind,
} from 'lucide-react';
import {
  ROOM_SENSOR_CATEGORIES,
  deviceSupportsCategory,
  visibleRoomCategories,
  type HomePlan,
  type RoomSensorCategory,
  type SensorProduct,
} from '@michel/contracts';
import { EquipmentDialog } from './EquipmentDialog';
import { SensorOnboardingDialog } from './SensorOnboardingDialog';
import { SensorInstallationGuide } from './SensorInstallationGuide';
import { productsForCategory } from './sensor-products';
import { sensorJson, sensorRequest, type SensorUiDevice } from './sensor-ui';
import type { Locale } from './i18n';

const categoryIcons = {
  temperature: Thermometer,
  humidity: Droplets,
  motion: Activity,
  presence: UserRound,
  fall_detection: ShieldAlert,
  button: Bell,
  contact: DoorOpen,
  water_leak: Droplets,
  smoke: Flame,
  carbon_monoxide: Wind,
  air_quality: Wind,
  illuminance: Sun,
};
const roomLabels: Record<string, [string, string]> = {
  LIVING_ROOM: ['Salon', 'Living room'],
  BEDROOM: ['Chambre', 'Bedroom'],
  KITCHEN: ['Cuisine', 'Kitchen'],
  BATHROOM: ['Salle de bain', 'Bathroom'],
  TOILET: ['Toilettes', 'Toilet'],
  ENTRANCE: ['Entrée', 'Entrance'],
  HALLWAY: ['Couloir', 'Hallway'],
  DINING_ROOM: ['Salle à manger', 'Dining room'],
  GARAGE: ['Garage', 'Garage'],
  GARDEN: ['Jardin', 'Garden'],
  TERRACE: ['Terrasse', 'Terrace'],
  OTHER: ['Autre', 'Other'],
};

export function roomCategoryDevices(
  plan: HomePlan,
  roomId: string,
  devices: SensorUiDevice[],
  category: RoomSensorCategory,
) {
  const placements = plan.placements.filter(
    (placement) => placement.roomId === roomId && placement.kind === 'SENSOR',
  );
  return devices.filter(
    (device) =>
      deviceSupportsCategory(device, category) &&
      (device.room?.id === roomId ||
        (!device.room &&
          placements.some((placement) =>
            placement.equipmentRefKind === 'DEVICE'
              ? placement.equipmentId === device.id
              : device.capabilities.some(({ sensorId }) => sensorId === placement.equipmentId),
          ))),
  );
}

export function mainEntranceDevices(plan: HomePlan, roomId: string, devices: SensorUiDevice[]) {
  const opening = plan.levels
    .flatMap(({ openings }) => openings)
    .find(({ isMainEntrance, roomIds }) => isMainEntrance && roomIds.includes(roomId));
  if (!opening) return [];
  return devices.filter(
    (device) =>
      deviceSupportsCategory(device, 'contact') &&
      plan.placements.some(
        (placement) =>
          placement.kind === 'SENSOR' &&
          placement.roomId === roomId &&
          placement.targetType === 'OPENING' &&
          placement.targetId === opening.id &&
          (placement.equipmentRefKind === 'DEVICE'
            ? placement.equipmentId === device.id
            : device.capabilities.some(({ sensorId }) => sensorId === placement.equipmentId)),
      ),
  );
}

export function roomSensorReading(
  device: SensorUiDevice,
  category: RoomSensorCategory,
  fr: boolean,
  now = Date.now(),
) {
  const capabilities = device.capabilities.filter(({ capability }) =>
    category === 'presence'
      ? ['person_presence', 'occupancy'].includes(capability)
      : category === 'motion'
        ? ['motion', 'occupancy'].includes(capability)
        : category === 'contact'
          ? ['contact', 'dry_contact'].includes(capability)
          : category === 'air_quality'
            ? ['co2', 'pm25', 'voc', 'total_volatile_organic_compounds', 'air_quality'].includes(
                capability,
              )
            : capability === category,
  );
  const capability = capabilities.find((c) => c.value !== null) ?? capabilities[0];
  const lastSeenAt = capability?.lastSeenAt ?? device.lastSeenAt;
  const lastSeen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  const stale = !Number.isFinite(lastSeen) || now - lastSeen > 60 * 60 * 1000;
  const status = !device.enabled
    ? fr
      ? 'Désactivé'
      : 'Disabled'
    : capability?.status === 'OFFLINE'
      ? fr
        ? 'Hors ligne'
        : 'Offline'
      : device.installationStatus === 'NEEDS_TEST'
        ? fr
          ? 'À tester'
          : 'Needs test'
        : ['DETECTED', 'NEEDS_CONFIRMATION', 'NEEDS_PLACEMENT'].includes(device.installationStatus)
          ? fr
            ? 'À vérifier'
            : 'Needs checking'
          : device.installationStatus === 'ATTENTION' || capability?.status === 'DEGRADED'
            ? fr
              ? 'À vérifier'
              : 'Needs checking'
            : stale || capability?.status !== 'ONLINE'
              ? fr
                ? 'Mesure ancienne'
                : 'Old reading'
              : null;
  const value = capability?.value;
  let reading = '—';
  if (typeof value?.value === 'number')
    reading = `${new Intl.NumberFormat(fr ? 'fr-FR' : 'en', { maximumFractionDigits: 1 }).format(value.value)}${capability?.unit ? ` ${capability.unit}` : ''}`;
  else {
    const active =
      category === 'contact' && typeof value?.open === 'boolean'
        ? value.open
        : typeof value?.active === 'boolean'
          ? value.active
          : typeof value?.value === 'boolean'
            ? value.value
            : undefined;
    if (typeof active === 'boolean')
      reading =
        category === 'contact'
          ? active
            ? fr
              ? 'Ouvert'
              : 'Open'
            : fr
              ? 'Fermé'
              : 'Closed'
          : ['presence', 'motion'].includes(category)
            ? active
              ? fr
                ? 'Détecté'
                : 'Detected'
              : fr
                ? 'Non détecté'
                : 'Not detected'
            : active
              ? fr
                ? 'Signal détecté'
                : 'Signal detected'
              : fr
                ? 'Aucun signal'
                : 'No signal';
    else if (typeof value?.action === 'string')
      reading = fr ? 'Dernier appui reçu' : 'Last press received';
  }
  if (category === 'air_quality' && capability && reading !== '—')
    reading = `${capability.label} · ${reading}`;
  return {
    reading,
    status,
    lastSeenAt,
    outdated: stale || capability?.status !== 'ONLINE' || !device.enabled,
  };
}

export function RoomEquipmentPage({
  roomId,
  plan,
  devices,
  locale,
  onBack,
  onEditPlan,
  onRefresh,
  onPlanSaved,
}: {
  roomId: string;
  plan: HomePlan;
  devices: SensorUiDevice[];
  locale: Locale;
  onBack: () => void;
  onEditPlan: () => void;
  onRefresh: () => Promise<void>;
  onPlanSaved: (plan: HomePlan) => void;
}) {
  const fr = locale === 'fr';
  const floor = plan.levels.find(({ rooms }) => rooms.some(({ id }) => id === roomId));
  const room = floor?.rooms.find(({ id }) => id === roomId);
  const [category, setCategory] = useState<RoomSensorCategory | null>(null);
  const [mainEntranceOpen, setMainEntranceOpen] = useState(false);
  const [tab, setTab] = useState<'PRODUCTS' | 'CONNECTED'>('PRODUCTS');
  const [more, setMore] = useState(false);
  const [product, setProduct] = useState<SensorProduct | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installationCategory, setInstallationCategory] = useState<
    RoomSensorCategory | undefined
  >();
  const [installationProduct, setInstallationProduct] = useState<SensorProduct | undefined>();
  const [installationTargetId, setInstallationTargetId] = useState<string | undefined>();
  const [guideId, setGuideId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<SensorUiDevice | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const title = useRef<HTMLHeadingElement>(null);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    title.current?.focus();
  }, [roomId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh
        .current()
        .catch(() =>
          setError(
            fr ? 'Actualisation indisponible. Réessayez.' : 'Refresh unavailable. Please retry.',
          ),
        );
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [fr]);
  if (!room || !floor)
    return (
      <section className="room-equipment-page">
        <p>{fr ? 'Cette pièce n’existe plus.' : 'This room no longer exists.'}</p>
        <button className="equipment-secondary" onClick={onBack}>
          {fr ? 'Retour au logement' : 'Back to home'}
        </button>
      </section>
    );

  const categoryDevices = (id: RoomSensorCategory) =>
    roomCategoryDevices(plan, roomId, devices, id);
  const equipped = ROOM_SENSOR_CATEGORIES.filter(({ id }) => categoryDevices(id).length).map(
    ({ id }) => id,
  );
  const visible = visibleRoomCategories(room.kind, room.sensorPreferences, equipped);
  const mainEntrance = floor.openings.find(
    ({ isMainEntrance, roomIds }) => isMainEntrance && roomIds.includes(roomId),
  );
  const entranceDevices = mainEntranceDevices(plan, roomId, devices);
  const availableEntranceDevices = devices.filter((device) =>
    deviceSupportsCategory(device, 'contact'),
  );
  const selected = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category);
  const selectedDevices = category ? categoryDevices(category) : [];
  const compatible = category
    ? devices.filter(
        (device) =>
          deviceSupportsCategory(device, category) &&
          !selectedDevices.some(({ id }) => id === device.id),
      )
    : [];
  const count = new Set(equipped.flatMap((id) => categoryDevices(id).map(({ id }) => id))).size;
  const outdoor = ['GARDEN', 'TERRACE'].includes(room.kind);
  const products = category ? productsForCategory(category, outdoor) : [];
  const shownGuide = devices.find(({ id }) => id === guideId);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const preference = (id: RoomSensorCategory, hide: boolean) =>
    run(async () => {
      const next = structuredClone(plan);
      const nextRoom = next.levels
        .flatMap(({ rooms }) => rooms)
        .find(({ id: key }) => key === roomId)!;
      const prefs = nextRoom.sensorPreferences ?? { added: [], hidden: [] };
      nextRoom.sensorPreferences = {
        added: hide ? prefs.added.filter((key) => key !== id) : [...new Set([...prefs.added, id])],
        hidden: hide
          ? [...new Set([...prefs.hidden, id])]
          : prefs.hidden.filter((key) => key !== id),
      };
      const saved = await sensorRequest<HomePlan>(
        '/api/v1/household/plan',
        sensorJson('PUT', next),
      );
      onPlanSaved(saved);
      setMore(false);
    });
  const openCategory = (id: RoomSensorCategory) => {
    setMainEntranceOpen(false);
    setCategory(id);
    setProduct(null);
    setAssigning(null);
    setTab('PRODUCTS');
    setError('');
  };
  const startInstall = (chosen?: SensorProduct) =>
    run(async () => {
      await onRefresh();
      setInstallationCategory(category ?? undefined);
      setInstallationProduct(chosen);
      setInstallationTargetId(undefined);
      setCategory(null);
      setProduct(null);
      setInstalling(true);
    });
  const installEntranceSensor = () =>
    run(async () => {
      await onRefresh();
      setInstallationCategory('contact');
      setInstallationProduct(undefined);
      setInstallationTargetId(mainEntrance?.id);
      setMainEntranceOpen(false);
      setInstalling(true);
    });
  const bindEntranceSensor = (device: SensorUiDevice) =>
    run(async () => {
      if (!mainEntrance) return;
      await sensorRequest(
        `/api/v1/sensor-devices/${encodeURIComponent(device.id)}`,
        sensorJson('PATCH', {
          roomId,
          target: { type: 'OPENING', id: mainEntrance.id },
        }),
      );
      await onRefresh();
      setMainEntranceOpen(false);
    });
  const editDevice = (device: SensorUiDevice) => {
    setAssigning(device);
    setName(device.name);
    const placement = plan.placements.find(
      (p) =>
        p.equipmentId === device.id ||
        device.capabilities.some(({ sensorId }) => sensorId === p.equipmentId),
    );
    setNote(device.placementNote ?? placement?.placementNote ?? '');
  };
  const associate = () =>
    run(async () => {
      if (!assigning) return;
      await sensorRequest(
        `/api/v1/sensor-devices/${encodeURIComponent(assigning.id)}`,
        sensorJson('PATCH', {
          roomId,
          name: name.trim(),
          placementNote: note.trim() || null,
          buttonRole: 'ASSISTANCE',
        }),
      );
      const id = assigning.id;
      setAssigning(null);
      setCategory(null);
      setGuideId(id);
      await onRefresh();
    });
  const detach = (device: SensorUiDevice) =>
    run(async () => {
      await sensorRequest(
        `/api/v1/sensor-devices/${encodeURIComponent(device.id)}`,
        sensorJson('PATCH', { roomId: null }),
      );
      setAssigning(null);
      await onRefresh();
    });
  const rooms = plan.levels.flatMap((level) =>
    level.rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, floor: level.floor })),
  );

  return (
    <section className="room-equipment-page">
      <nav
        className="room-equipment-breadcrumb"
        aria-label={fr ? 'Navigation de la pièce' : 'Room navigation'}
      >
        <button onClick={onBack}>
          <ArrowLeft />
          {fr ? 'Mon logement' : 'My home'}
        </button>
        <ChevronRight />
        <span>{room.name}</span>
      </nav>
      <header className="room-equipment-header">
        <div className="room-equipment-title">
          <span className="equipment-kicker">{fr ? 'Votre pièce' : 'Your room'}</span>
          <h1 ref={title} tabIndex={-1}>
            {room.name}
          </h1>
          <div className="room-equipment-metadata">
            <span>
              <House />
              {roomLabels[room.kind]?.[fr ? 0 : 1] ?? room.kind}
            </span>
            <span>
              <Layers />
              {floor.name}
            </span>
            {room.areaM2 != null && (
              <span>
                <Grid2X2 />
                {new Intl.NumberFormat(fr ? 'fr-FR' : 'en', { maximumFractionDigits: 1 }).format(
                  room.areaM2,
                )}{' '}
                m²
              </span>
            )}
            <span className="room-equipment-status">
              <Radio />
              {count}{' '}
              {fr
                ? `capteur${count > 1 ? 's' : ''} associé${count > 1 ? 's' : ''}`
                : `sensor${count !== 1 ? 's' : ''} assigned`}
            </span>
          </div>
        </div>
        <div className="room-equipment-actions">
          <button
            className="primary"
            onClick={() => {
              setMore(true);
              setError('');
            }}
          >
            <Plus />
            {fr ? 'Ajouter un capteur' : 'Add a sensor'}
          </button>
        </div>
      </header>
      <div className="room-equipment-section-heading">
        <div>
          <h2>{fr ? 'Les capteurs de la pièce' : 'Room sensors'}</h2>
          <p>
            {fr ? 'Choisissez ce que vous souhaitez suivre.' : 'Choose what you want to monitor.'}
          </p>
        </div>
        <button
          className="equipment-secondary"
          onClick={() => {
            setMore(true);
            setError('');
          }}
        >
          <Plus />
          {fr ? 'Ajouter un autre type' : 'Add another type'}
        </button>
      </div>
      {error && !category && !more && !guideId && (
        <div className="equipment-error" role="alert">
          {error}
          <button onClick={() => void run(onRefresh)}>{fr ? 'Actualiser' : 'Refresh'}</button>
        </div>
      )}
      <div className="room-equipment-grid">
        {room.kind === 'ENTRANCE' && (
          <article
            className={`room-sensor-card category-main-entrance ${entranceDevices.length ? 'is-configured' : ''}`}
          >
            <button className="room-sensor-card-main" onClick={() => setMainEntranceOpen(true)}>
              <span className="room-sensor-card-top">
                <span className="room-sensor-icon">
                  <DoorOpen />
                </span>
                <span
                  className={`room-sensor-status ${entranceDevices.length ? 'is-configured' : ''}`}
                >
                  {entranceDevices.length ? (
                    <CheckCircle2 />
                  ) : (
                    <span className="room-sensor-status-dot" />
                  )}
                  {entranceDevices.length
                    ? fr
                      ? 'Configuré'
                      : 'Configured'
                    : fr
                      ? 'Non configuré'
                      : 'Not configured'}
                </span>
              </span>
              <h3>{fr ? 'Ouverture principale' : 'Main entrance'}</h3>
              <p>{fr ? 'La porte de sortie du logement' : 'The door leading outside'}</p>
              <div className="room-sensor-card-value">
                {entranceDevices.length === 1 ? (
                  <>
                    <strong
                      className={
                        roomSensorReading(entranceDevices[0]!, 'contact', fr, now).outdated
                          ? 'is-outdated'
                          : ''
                      }
                    >
                      {roomSensorReading(entranceDevices[0]!, 'contact', fr, now).reading}
                    </strong>
                    <small>{entranceDevices[0]!.name}</small>
                  </>
                ) : entranceDevices.length > 1 ? (
                  <>
                    <strong>
                      {entranceDevices.length} <span>{fr ? 'capteurs' : 'sensors'}</span>
                    </strong>
                    <small>{fr ? 'Voir les mesures' : 'View readings'}</small>
                  </>
                ) : (
                  <>
                    <span className="room-sensor-empty-line">—</span>
                    <small>
                      {mainEntrance
                        ? fr
                          ? 'Aucun capteur associé'
                          : 'No sensor assigned'
                        : fr
                          ? 'Porte principale à définir sur le plan'
                          : 'Define the main door on the floor plan'}
                    </small>
                  </>
                )}
              </div>
              <span className="room-sensor-card-footer">
                <span>
                  {entranceDevices.length
                    ? fr
                      ? 'Gérer la porte principale'
                      : 'Manage main door'
                    : mainEntrance
                      ? fr
                        ? 'Associer un capteur'
                        : 'Assign a sensor'
                      : fr
                        ? 'Définir la porte'
                        : 'Define the door'}
                </span>
                {entranceDevices.length ? <ArrowRight /> : <Plus />}
              </span>
            </button>
          </article>
        )}
        {visible.map((id) => {
          const definition = ROOM_SENSOR_CATEGORIES.find((c) => c.id === id)!;
          const items = categoryDevices(id);
          const Icon = categoryIcons[id];
          const reading = items.length === 1 ? roomSensorReading(items[0]!, id, fr, now) : null;
          const problems = items.filter(
            (device) => roomSensorReading(device, id, fr, now).status,
          ).length;
          return (
            <article
              key={id}
              className={`room-sensor-card category-${id} ${items.length ? 'is-configured' : ''}`}
            >
              <button className="room-sensor-card-main" onClick={() => openCategory(id)}>
                <span className="room-sensor-card-top">
                  <span className="room-sensor-icon">
                    <Icon />
                  </span>
                  <span className={`room-sensor-status ${items.length ? 'is-configured' : ''}`}>
                    {items.length ? <CheckCircle2 /> : <span className="room-sensor-status-dot" />}
                    {items.length
                      ? fr
                        ? 'Configuré'
                        : 'Configured'
                      : fr
                        ? 'Non configuré'
                        : 'Not configured'}
                  </span>
                </span>
                <h3>{definition[fr ? 'label' : 'labelEn']}</h3>
                <p>{definition[fr ? 'description' : 'descriptionEn']}</p>
                <div className="room-sensor-card-value">
                  {reading ? (
                    <>
                      <strong className={reading.outdated ? 'is-outdated' : ''}>
                        {reading.reading}
                      </strong>
                      <small>
                        {reading.status ??
                          (fr ? 'Dernière mesure reçue' : 'Latest received reading')}
                      </small>
                    </>
                  ) : items.length > 1 ? (
                    <>
                      <strong>
                        {items.length} <span>{fr ? 'capteurs' : 'sensors'}</span>
                      </strong>
                      <small>
                        {problems
                          ? fr
                            ? `${problems} à vérifier`
                            : `${problems} to check`
                          : fr
                            ? 'Voir les mesures'
                            : 'View readings'}
                      </small>
                    </>
                  ) : (
                    <>
                      <span className="room-sensor-empty-line">—</span>
                      <small>{fr ? 'Aucun capteur associé' : 'No sensor assigned'}</small>
                    </>
                  )}
                </div>
                <span className="room-sensor-card-footer">
                  <span>
                    {items.length
                      ? fr
                        ? `${items.length} appareil${items.length > 1 ? 's' : ''} · Gérer`
                        : `${items.length} device${items.length > 1 ? 's' : ''} · Manage`
                      : fr
                        ? 'Ajouter un capteur'
                        : 'Add a sensor'}
                  </span>
                  {items.length ? <ArrowRight /> : <Plus />}
                </span>
              </button>
              {!items.length && (
                <button
                  className="room-sensor-hide"
                  disabled={busy}
                  onClick={() => void preference(id, true)}
                  aria-label={`${fr ? 'Masquer' : 'Hide'} ${definition[fr ? 'label' : 'labelEn']}`}
                >
                  <EyeOff />
                </button>
              )}
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <p className="equipment-note">
          {fr ? 'Ajoutez un type de capteur pour commencer.' : 'Add a sensor type to get started.'}
        </p>
      )}
      <p className="room-equipment-footnote">
        <CheckCircle2 />
        {fr
          ? 'Un même appareil peut remplir plusieurs fonctions dans la pièce.'
          : 'One device can provide several functions in the room.'}
      </p>

      {mainEntranceOpen && (
        <EquipmentDialog
          title={fr ? `Ouverture principale · ${room.name}` : `Main entrance · ${room.name}`}
          onClose={() => setMainEntranceOpen(false)}
          busy={busy}
        >
          <div className="equipment-category-content">
            <p className="equipment-note">
              {fr
                ? 'Le capteur de cette porte aide à repérer un passage vers l’extérieur. Une ouverture seule ne confirme pas que la personne est sortie.'
                : 'This door sensor helps detect a passage outside. An opening alone does not confirm that the person has left.'}
            </p>
            {!mainEntrance ? (
              <>
                <p>
                  {fr
                    ? 'Définissez d’abord la porte principale sur le plan du logement.'
                    : 'First define the main door on the home floor plan.'}
                </p>
                <button
                  className="equipment-primary"
                  onClick={() => {
                    setMainEntranceOpen(false);
                    onEditPlan();
                  }}
                >
                  <DoorOpen /> {fr ? 'Ouvrir le plan' : 'Open floor plan'}
                </button>
              </>
            ) : (
              <>
                {!!entranceDevices.length && (
                  <section className="equipment-assigned">
                    <h3>{fr ? 'Capteur associé' : 'Assigned sensor'}</h3>
                    {entranceDevices.map((device) => (
                      <article className="equipment-device-row" key={device.id}>
                        <span className="equipment-device-icon">
                          <Radio />
                        </span>
                        <div>
                          <strong>{device.name}</strong>
                          <p>{roomSensorReading(device, 'contact', fr, now).reading}</p>
                        </div>
                      </article>
                    ))}
                  </section>
                )}
                <h3>{fr ? 'Associer un capteur d’ouverture' : 'Assign an opening sensor'}</h3>
                {availableEntranceDevices
                  .filter((device) => !entranceDevices.some(({ id }) => id === device.id))
                  .map((device) => (
                    <button
                      className="equipment-connected-choice"
                      key={device.id}
                      disabled={busy}
                      onClick={() => void bindEntranceSensor(device)}
                    >
                      <Radio />
                      <span>
                        <strong>{device.name}</strong>
                        <small>{device.room?.name ?? (fr ? 'Sans pièce' : 'Unassigned')}</small>
                      </span>
                      <Plus />
                    </button>
                  ))}
                <button
                  className="equipment-connected-choice"
                  disabled={busy}
                  onClick={() => void installEntranceSensor()}
                >
                  <Plus />
                  <span>
                    <strong>{fr ? 'Installer un nouveau capteur' : 'Install a new sensor'}</strong>
                    <small>
                      {fr
                        ? 'Capteur de contact pour la porte principale'
                        : 'Contact sensor for the main door'}
                    </small>
                  </span>
                  <ArrowRight />
                </button>
                {error && (
                  <p className="equipment-error" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </EquipmentDialog>
      )}

      {more && (
        <EquipmentDialog
          title={fr ? 'Ajouter un type de capteur' : 'Add a sensor type'}
          onClose={() => setMore(false)}
          busy={busy}
        >
          <div className="equipment-category-picker">
            {ROOM_SENSOR_CATEGORIES.filter(({ id }) => !visible.includes(id)).map((definition) => {
              const Icon = categoryIcons[definition.id];
              return (
                <button
                  key={definition.id}
                  disabled={busy}
                  onClick={() => void preference(definition.id, false)}
                >
                  <Icon />
                  <span>
                    <strong>{definition[fr ? 'label' : 'labelEn']}</strong>
                    <small>{definition[fr ? 'description' : 'descriptionEn']}</small>
                  </span>
                  <Plus />
                </button>
              );
            })}
            {visible.length === ROOM_SENSOR_CATEGORIES.length && (
              <p>{fr ? 'Tous les types sont déjà affichés.' : 'All types are already visible.'}</p>
            )}
            {error && (
              <p className="equipment-error" role="alert">
                {error}
                <button onClick={() => void run(onRefresh)}>{fr ? 'Actualiser' : 'Refresh'}</button>
              </p>
            )}
          </div>
        </EquipmentDialog>
      )}

      {selected && (
        <EquipmentDialog
          title={`${selected[fr ? 'label' : 'labelEn']} · ${room.name}`}
          wide
          onClose={() => {
            setCategory(null);
            setAssigning(null);
            setError('');
          }}
          busy={busy}
        >
          <div className="equipment-category-content">
            {assigning ? (
              <>
                <button className="equipment-text-button" onClick={() => setAssigning(null)}>
                  <ArrowLeft />
                  {fr ? 'Retour aux capteurs' : 'Back to sensors'}
                </button>
                <h3>{assigning.name}</h3>
                {assigning.room && assigning.room.id !== roomId && (
                  <p className="equipment-note">
                    {fr
                      ? `Cet appareil sera déplacé de « ${assigning.room.name} » vers « ${room.name} », avec toutes ses mesures.`
                      : `This device and all its readings will move from ${assigning.room.name} to ${room.name}.`}
                  </p>
                )}
                <label className="equipment-field">
                  {fr ? 'Nom' : 'Name'}
                  <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="equipment-field">
                  {fr ? 'Emplacement (facultatif)' : 'Location (optional)'}
                  <input
                    value={note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={fr ? 'Par exemple : côté lit' : 'For example: by the bed'}
                  />
                </label>
                <footer className="equipment-dialog-footer">
                  {selectedDevices.some(({ id }) => id === assigning.id) && (
                    <button
                      className="equipment-text-button"
                      disabled={busy}
                      onClick={() => void detach(assigning)}
                    >
                      {fr ? 'Détacher de la pièce' : 'Unassign from room'}
                    </button>
                  )}
                  <button
                    className="equipment-primary"
                    disabled={busy || !name.trim()}
                    onClick={() => void associate()}
                  >
                    <Check />
                    {assigning.room?.id === roomId
                      ? fr
                        ? 'Enregistrer'
                        : 'Save'
                      : fr
                        ? `Associer à ${room.name}`
                        : `Assign to ${room.name}`}
                  </button>
                </footer>
              </>
            ) : product ? (
              <>
                <button className="equipment-text-button" onClick={() => setProduct(null)}>
                  <ArrowLeft />
                  {fr ? 'Tous les produits' : 'All products'}
                </button>
                <div className="equipment-product-detail">
                  <ProductPhoto product={product} />
                  <div>
                    <span className="equipment-kicker">{product.brand}</span>
                    <h3>{fr ? product.name : product.nameEn}</h3>
                    <p>{product.model}</p>
                    <span className="equipment-product-badge">
                      {product.eliseValidated
                        ? fr
                          ? 'Validé avec Élise'
                          : 'Validated with Élise'
                        : fr
                          ? 'Compatibilité documentée · test Élise à faire'
                          : 'Documented compatibility · Élise test pending'}
                    </span>
                    <p className="equipment-muted">
                      {fr
                        ? `${product.testQuantity} exemplaire${product.testQuantity > 1 ? 's' : ''} dans le parc de test.`
                        : `${product.testQuantity} unit${product.testQuantity > 1 ? 's' : ''} in the test inventory.`}
                    </p>
                  </div>
                </div>
                <div className="equipment-capability-tags">
                  {product.categories.map((id) => (
                    <span key={id}>
                      {ROOM_SENSOR_CATEGORIES.find((c) => c.id === id)?.[fr ? 'label' : 'labelEn']}
                    </span>
                  ))}
                </div>
                <h4>{fr ? 'Fonctions documentées' : 'Documented features'}</h4>
                <ul>
                  {(fr ? product.features : product.featuresEn).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <dl className="equipment-product-specs">
                  <div>
                    <dt>{fr ? 'Alimentation' : 'Power'}</dt>
                    <dd>{fr ? product.power : product.powerEn}</dd>
                  </div>
                  <div>
                    <dt>{fr ? 'Utilisation' : 'Use'}</dt>
                    <dd>
                      {product.outdoor
                        ? fr
                          ? 'Extérieur'
                          : 'Outdoor'
                        : fr
                          ? 'Intérieur'
                          : 'Indoor'}
                    </dd>
                  </div>
                </dl>
                <h4>{fr ? 'Préparer le capteur' : 'Prepare the sensor'}</h4>
                <ol className="equipment-guide-steps">
                  {(fr ? product.preparation : product.preparationEn).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <h4>{fr ? 'Où le placer' : 'Where to place it'}</h4>
                <ul>
                  {(fr ? product.placement : product.placementEn).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <div className="equipment-product-links">
                  <a href={product.manualUrl} target="_blank" rel="noreferrer">
                    {fr ? 'Notice et documentation fabricant' : 'Manufacturer documentation'} ↗
                  </a>
                  <a href={product.integrationUrl} target="_blank" rel="noreferrer">
                    {fr ? 'Compatibilité documentée' : 'Documented compatibility'} ↗
                  </a>
                </div>
                <small className="equipment-muted">
                  {fr ? 'Documentation vérifiée le' : 'Documentation checked on'}{' '}
                  {product.verifiedAt}
                </small>
                <footer className="equipment-dialog-footer">
                  <button
                    className="equipment-primary"
                    disabled={busy || product.compatibility !== 'DOCUMENTED'}
                    onClick={() => void startInstall(product)}
                  >
                    {fr ? 'Installer ce capteur' : 'Install this sensor'}
                    <ArrowRight />
                  </button>
                </footer>
              </>
            ) : (
              <>
                {!!selectedDevices.length && (
                  <section className="equipment-assigned">
                    <h3>{fr ? 'Dans cette pièce' : 'In this room'}</h3>
                    {selectedDevices.map((device) => {
                      const reading = roomSensorReading(device, category!, fr, now);
                      return (
                        <article className="equipment-device-row" key={device.id}>
                          <span className="equipment-device-icon">
                            <Radio />
                          </span>
                          <div>
                            <strong>{device.name}</strong>
                            <p>
                              {device.placementNote ||
                                [device.manufacturer, device.model].filter(Boolean).join(' · ')}
                            </p>
                            <span
                              className={
                                reading.outdated ? 'equipment-muted' : 'equipment-device-value'
                              }
                            >
                              {reading.reading}
                            </span>
                            {reading.status && (
                              <small className="equipment-device-attention">{reading.status}</small>
                            )}
                            {reading.lastSeenAt && (
                              <small>
                                {fr ? 'Reçu le ' : 'Received '}{' '}
                                {new Date(reading.lastSeenAt).toLocaleString(fr ? 'fr-FR' : 'en')}
                              </small>
                            )}
                          </div>
                          <div className="equipment-device-actions">
                            <button onClick={() => editDevice(device)}>
                              {fr ? 'Gérer' : 'Manage'}
                            </button>
                            <button
                              onClick={() => {
                                setGuideId(device.id);
                                setCategory(null);
                              }}
                            >
                              {fr ? 'Guide et test' : 'Guide and test'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                )}
                <h3>{fr ? 'Ajouter un capteur' : 'Add a sensor'}</h3>
                <div
                  className="equipment-catalog-tabs"
                  role="tablist"
                  aria-label={fr ? 'Choix du capteur' : 'Sensor choice'}
                >
                  <button
                    id="equipment-products-tab"
                    role="tab"
                    aria-selected={tab === 'PRODUCTS'}
                    aria-controls="equipment-products-panel"
                    onClick={() => setTab('PRODUCTS')}
                  >
                    {fr ? 'Produits documentés' : 'Documented products'}
                  </button>
                  <button
                    id="equipment-connected-tab"
                    role="tab"
                    aria-selected={tab === 'CONNECTED'}
                    aria-controls="equipment-connected-panel"
                    onClick={() => setTab('CONNECTED')}
                  >
                    {fr ? 'Déjà connectés' : 'Already connected'}
                    <span>{compatible.length}</span>
                  </button>
                </div>
                {tab === 'PRODUCTS' ? (
                  <div
                    id="equipment-products-panel"
                    role="tabpanel"
                    aria-labelledby="equipment-products-tab"
                  >
                    <div className="equipment-product-grid">
                      {products.map((item) => (
                        <SensorProductCard
                          key={item.id}
                          product={item}
                          fr={fr}
                          onSelect={() => setProduct(item)}
                        />
                      ))}
                    </div>
                    {!products.length && (
                      <p className="equipment-note">
                        {outdoor
                          ? fr
                            ? 'Aucun modèle pour l’extérieur n’est disponible dans le matériel de test actuel.'
                            : 'No outdoor model is available in the current test hardware.'
                          : fr
                            ? 'Aucun modèle de votre matériel de test ne fournit cette fonction. Vous pouvez tout de même associer un appareil déjà reconnu ou lancer la détection automatique.'
                            : 'None of your current test devices provides this function. You can still assign an already recognized device or use automatic detection.'}
                      </p>
                    )}
                  </div>
                ) : (
                  <div
                    id="equipment-connected-panel"
                    role="tabpanel"
                    aria-labelledby="equipment-connected-tab"
                  >
                    {compatible.map((device) => (
                      <button
                        className="equipment-connected-choice"
                        key={device.id}
                        onClick={() => editDevice(device)}
                      >
                        <Radio />
                        <span>
                          <strong>{device.name}</strong>
                          <small>
                            {device.room
                              ? fr
                                ? `Actuellement : ${device.room.name}`
                                : `Currently: ${device.room.name}`
                              : fr
                                ? 'Sans pièce'
                                : 'Unassigned'}
                          </small>
                        </span>
                        <Plus />
                      </button>
                    ))}
                    {!compatible.length && (
                      <p className="equipment-note">
                        {fr
                          ? 'Aucun autre appareil compatible déjà connecté.'
                          : 'No other compatible device is connected yet.'}
                      </p>
                    )}
                  </div>
                )}
                <button
                  className="equipment-unlisted"
                  disabled={busy}
                  onClick={() => void startInstall()}
                >
                  <Radio />
                  <span>
                    {fr ? 'Mon modèle n’est pas dans la liste' : 'My model is not listed'}
                    <small>
                      {fr ? 'Lancer la détection automatique' : 'Start automatic detection'}
                    </small>
                  </span>
                  <ArrowRight />
                </button>
              </>
            )}
            {error && (
              <p className="equipment-error" role="alert">
                {error}
                <button onClick={() => void run(onRefresh)}>{fr ? 'Actualiser' : 'Refresh'}</button>
              </p>
            )}
          </div>
        </EquipmentDialog>
      )}
      {guideId && (
        <EquipmentDialog
          title={shownGuide?.name ?? (fr ? 'Guide du capteur' : 'Sensor guide')}
          onClose={() => setGuideId(null)}
        >
          {shownGuide ? (
            <SensorInstallationGuide
              device={shownGuide}
              locale={locale}
              onChanged={onRefresh}
              onDone={() => setGuideId(null)}
            />
          ) : (
            <p>{fr ? 'Le capteur n’est plus disponible.' : 'Sensor no longer available.'}</p>
          )}
        </EquipmentDialog>
      )}
      <SensorOnboardingDialog
        open={installing}
        locale={locale}
        rooms={rooms}
        initialRoomId={roomId}
        initialTarget={
          installationTargetId ? { type: 'OPENING', id: installationTargetId } : undefined
        }
        category={installationCategory}
        product={installationProduct}
        onClose={() => setInstalling(false)}
        onInstalled={onRefresh}
      />
      {busy && (
        <div className="equipment-working" role="status">
          <LoaderCircle className="is-spinning" />
          {fr ? 'Enregistrement…' : 'Saving…'}
        </div>
      )}
    </section>
  );
}
