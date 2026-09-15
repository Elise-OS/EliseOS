import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  ArrowLeft,
  ArrowRight,
  Bell,
  BatteryMedium,
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
  Trash2,
  UserRound,
  Wind,
} from 'lucide-react';
import {
  CONTACT_TYPES,
  contactRoleSchema,
  type ContactRole,
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
import { productsForCategory, sensorDevicePhoto } from './sensor-products';
import {
  connectedDevicesForCategory,
  sensorJson,
  sensorRequest,
  type SensorUiDevice,
} from './sensor-ui';
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
  camera: Camera,
};

export function DevicePhoto({ device }: { device: SensorUiDevice }) {
  const [failed, setFailed] = useState(false);
  const photo = sensorDevicePhoto(device);
  return (
    <span className="equipment-device-photo">
      {photo && !failed ? (
        <img src={photo} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>{device.manufacturer?.slice(0, 2) ?? device.name.slice(0, 2)}</span>
      )}
    </span>
  );
}
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
  const stairPlacements = plan.placements.filter(
    (placement) => placement.kind === 'SENSOR' && placement.targetType === 'STAIR',
  );
  const mainEntrancePlacements = plan.placements.filter(
    (placement) =>
      placement.kind === 'SENSOR' &&
      (placement.capabilityBindings ?? []).some(({ role }) => role === 'MAIN_ENTRANCE'),
  );
  return devices.filter((device) => {
    const matches = (placement: HomePlan['placements'][number]) =>
      placement.equipmentRefKind === 'DEVICE'
        ? placement.equipmentId === device.id
        : device.capabilities.some(({ sensorId }) => sensorId === placement.equipmentId);
    // A stair uses one adjacent room as a technical anchor in the persisted plan.
    // Its device must nevertheless belong exclusively to the stair in the UI.
    if (stairPlacements.some(matches)) return false;
    // The main entrance has its own card and must not be duplicated in "Opening".
    if (category === 'contact' && mainEntrancePlacements.some(matches)) return false;
    return (
      deviceSupportsCategory(device, category) &&
      (device.room?.id === roomId || (!device.room && placements.some(matches)))
    );
  });
}

export function deviceContactType(plan: HomePlan, device: SensorUiDevice): ContactRole | undefined {
  const placement = plan.placements.find(
    (p) =>
      p.kind === 'SENSOR' &&
      (p.equipmentRefKind === 'DEVICE'
        ? p.equipmentId === device.id
        : device.capabilities.some(({ sensorId }) => sensorId === p.equipmentId)),
  );
  const role = placement?.capabilityBindings.find(({ capability }) =>
    ['contact', 'dry_contact'].includes(capability),
  )?.role;
  const parsed = contactRoleSchema.safeParse(role);
  return parsed.success ? parsed.data : undefined;
}

export function otherConnectedDevices(
  devices: SensorUiDevice[],
  category: RoomSensorCategory,
  roomId: string,
  assignedDevices: SensorUiDevice[],
) {
  const assignedIds = new Set(assignedDevices.map(({ id }) => id));
  return connectedDevicesForCategory(devices, category).filter(
    (device) => device.room?.id !== roomId && !assignedIds.has(device.id),
  );
}

export function mainEntranceDevices(plan: HomePlan, roomId: string, devices: SensorUiDevice[]) {
  const opening = plan.levels
    .flatMap(({ openings }) => openings)
    .find(({ isMainEntrance, roomIds }) => isMainEntrance && roomIds.includes(roomId));
  return devices.filter(
    (device) =>
      deviceSupportsCategory(device, 'contact') &&
      plan.placements.some(
        (placement) =>
          placement.kind === 'SENSOR' &&
          placement.roomId === roomId &&
          ((opening && placement.targetType === 'OPENING' && placement.targetId === opening.id) ||
            (placement.capabilityBindings ?? []).some(({ role }) => role === 'MAIN_ENTRANCE')) &&
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
  // A value can stay unchanged while another function of the same device reports.
  const stateful = ['presence', 'motion', 'contact'].includes(category);
  const deviceSeen = device.lastSeenAt ? Date.parse(device.lastSeenAt) : NaN;
  const freshness = Math.max(
    Number.isFinite(lastSeen) ? lastSeen : -Infinity,
    Number.isFinite(deviceSeen) ? deviceSeen : -Infinity,
  );
  const stale = !Number.isFinite(freshness) || now - freshness > 120 * 60 * 1000;
  const status = !device.enabled
    ? fr
      ? 'Désactivé'
      : 'Disabled'
    : capability?.status === 'OFFLINE'
      ? fr
        ? 'Hors ligne'
        : 'Offline'
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
              ? stateful
                ? 'Aucun signal récent'
                : 'Mesure ancienne'
              : stateful
                ? 'No recent signal'
                : 'Old reading'
            : null;
  const value = capability?.value;
  let reading = '—';
  let detail: string | null = null;
  if (typeof value?.value === 'number') {
    const formatted = `${new Intl.NumberFormat(fr ? 'fr-FR' : 'en', { maximumFractionDigits: 1 }).format(value.value)}${capability?.unit ? ` ${capability.unit}` : ''}`;
    if (category === 'illuminance') {
      reading = illuminanceLevel(value.value, fr);
      detail = formatted;
    } else reading = formatted;
  } else {
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
  if (category === 'camera') reading = status ?? (fr ? 'Connectée' : 'Connected');
  if (category === 'air_quality' && capability && reading !== '—')
    reading = `${capability.label} · ${reading}`;
  return {
    reading,
    detail,
    status,
    lastSeenAt,
    outdated: stale || capability?.status !== 'ONLINE' || !device.enabled,
  };
}

export function illuminanceLevel(lux: number, fr: boolean) {
  if (lux < 50) return fr ? 'Très faible' : 'Very dim';
  if (lux < 150) return fr ? 'Faible' : 'Dim';
  if (lux < 300) return fr ? 'Confortable' : 'Comfortable';
  if (lux < 1_000) return fr ? 'Lumineux' : 'Bright';
  return fr ? 'Très lumineux' : 'Very bright';
}

export function lastReadingLabel(
  lastSeenAt: string | null,
  fr: boolean,
  now = Date.now(),
  category?: RoomSensorCategory,
) {
  if (!lastSeenAt) return fr ? 'Heure de mesure inconnue' : 'Reading time unknown';
  const receivedAt = new Date(lastSeenAt);
  if (Number.isNaN(receivedAt.getTime()))
    return fr ? 'Heure de mesure inconnue' : 'Reading time unknown';
  const locale = fr ? 'fr-FR' : 'en-GB';
  const time = receivedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const sameDay = receivedAt.toDateString() === new Date(now).toDateString();
  const date = receivedAt.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const stateful = category && ['presence', 'motion', 'contact'].includes(category);
  const frenchLabel = stateful ? 'Dernier changement reçu' : 'Dernière mesure reçue';
  if (fr) return sameDay ? `${frenchLabel} à ${time}` : `${frenchLabel} le ${date} à ${time}`;
  return sameDay
    ? `Latest ${stateful ? 'change' : 'reading'} received at ${time}`
    : `Latest ${stateful ? 'change' : 'reading'} received on ${date} at ${time}`;
}

export function RoomEquipmentPage({
  roomId,
  plan,
  devices,
  locale,
  onBack,
  onRefresh,
  onPlanSaved,
}: {
  roomId: string;
  plan: HomePlan;
  devices: SensorUiDevice[];
  locale: Locale;
  onBack: () => void;
  onEditPlan?: () => void;
  onRefresh: () => Promise<void>;
  onPlanSaved: (plan: HomePlan) => void;
}) {
  const fr = locale === 'fr';
  const floor = plan.levels.find(({ rooms }) => rooms.some(({ id }) => id === roomId));
  const room = floor?.rooms.find(({ id }) => id === roomId);
  const [category, setCategory] = useState<RoomSensorCategory | null>(null);
  const [tab, setTab] = useState<'PRODUCTS' | 'CONNECTED'>('PRODUCTS');
  const [more, setMore] = useState(false);
  const [product, setProduct] = useState<SensorProduct | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installationCategory, setInstallationCategory] = useState<
    RoomSensorCategory | undefined
  >();
  const [installationProduct, setInstallationProduct] = useState<SensorProduct | undefined>();
  const [installationContactRole, setInstallationContactRole] = useState<ContactRole | undefined>();
  const [openingType, setOpeningType] = useState<ContactRole | ''>('');
  const [contactFilter, setContactFilter] = useState<ContactRole | undefined>();
  const [editingMainEntrance, setEditingMainEntrance] = useState(false);
  const [guideId, setGuideId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<SensorUiDevice | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
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
  const entranceDevices = mainEntranceDevices(plan, roomId, devices);
  const selected = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category);
  const selectedDevices = category
    ? editingMainEntrance
      ? entranceDevices
      : categoryDevices(category).filter(
          (device) =>
            category !== 'contact' ||
            !contactFilter ||
            deviceContactType(plan, device) === contactFilter,
        )
    : [];
  const availableConnected = category
    ? editingMainEntrance
      ? connectedDevicesForCategory(devices, category).filter(
          (device) => !selectedDevices.some(({ id }) => id === device.id),
        )
      : otherConnectedDevices(devices, category, roomId, selectedDevices)
    : [];
  const count = new Set([
    ...equipped.flatMap((id) => categoryDevices(id).map(({ id }) => id)),
    ...entranceDevices.map(({ id }) => id),
  ]).size;
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
  const openCategory = (id: RoomSensorCategory, type?: ContactRole) => {
    setContactFilter(type);
    setOpeningType(type ?? '');
    setEditingMainEntrance(false);
    setCategory(id);
    setProduct(null);
    setAssigning(null);
    setTab('PRODUCTS');
    setError('');
  };
  const openMainEntrance = () => {
    setOpeningType('MAIN_ENTRANCE');
    setContactFilter(undefined);
    setEditingMainEntrance(true);
    setCategory('contact');
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
      setInstallationContactRole(category === 'contact' ? openingType || undefined : undefined);
      setCategory(null);
      setProduct(null);
      setEditingMainEntrance(false);
      setInstalling(true);
    });
  const editDevice = (device: SensorUiDevice) => {
    if (category === 'contact')
      setOpeningType(
        deviceContactType(plan, device) ??
          (editingMainEntrance ? 'MAIN_ENTRANCE' : openingType || contactFilter || ''),
      );
    setAssigning(device);
    setConfirmRemoval(false);
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
          ...(category === 'contact'
            ? {
                contactRole: openingType || undefined,
                ...(deviceContactType(plan, assigning) === 'MAIN_ENTRANCE' &&
                openingType !== 'MAIN_ENTRANCE'
                  ? { target: { type: 'ROOM', id: roomId } }
                  : {}),
              }
            : {}),
          ...(editingMainEntrance
            ? {
                target: { type: 'ROOM', id: roomId },
                contactRole: openingType || undefined,
              }
            : {}),
        }),
      );
      const id = assigning.id;
      setAssigning(null);
      setCategory(null);
      setEditingMainEntrance(false);
      setGuideId(id);
      await onRefresh();
    });
  const removeDevice = () =>
    run(async () => {
      if (!assigning || assigning.protocol !== 'zigbee') return;
      await sensorRequest(`/api/v1/sensor-devices/${encodeURIComponent(assigning.id)}`, {
        method: 'DELETE',
      });
      setConfirmRemoval(false);
      setAssigning(null);
      setCategory(null);
      void onRefresh().catch(() =>
        setError(
          fr ? 'Actualisation indisponible. Réessayez.' : 'Refresh unavailable. Please retry.',
        ),
      );
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
        <button
          className="room-equipment-back"
          onClick={onBack}
          aria-label={fr ? 'Retour à Mon logement' : 'Back to My home'}
        >
          <span className="room-equipment-back-icon" aria-hidden="true">
            <ArrowLeft />
          </span>
          <span className="room-equipment-back-copy">
            <span>{fr ? 'Retour à' : 'Back to'}</span>
            <strong>{fr ? 'Mon logement' : 'My home'}</strong>
          </span>
        </button>
        <ChevronRight className="room-equipment-breadcrumb-divider" aria-hidden="true" />
        <span className="room-equipment-current-room" aria-current="page">
          {room.name}
        </span>
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
      </div>
      {error && !category && !more && !guideId && (
        <div className="equipment-error" role="alert">
          {error}
          <button onClick={() => void run(onRefresh)}>{fr ? 'Actualiser' : 'Refresh'}</button>
        </div>
      )}
      <div className="room-equipment-grid">
        {(room.kind === 'ENTRANCE' || entranceDevices.length > 0) && (
          <article
            className={`room-sensor-card category-main-entrance ${entranceDevices.length ? 'is-configured' : ''}`}
          >
            <button className="room-sensor-card-main" onClick={openMainEntrance}>
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
                    <small>
                      {lastReadingLabel(
                        roomSensorReading(entranceDevices[0]!, 'contact', fr, now).lastSeenAt,
                        fr,
                        now,
                        'contact',
                      )}
                    </small>
                    {entranceDevices[0]!.batteryPercent !== null && (
                      <small className="room-sensor-battery">
                        <BatteryMedium />
                        {fr ? 'Batterie' : 'Battery'} {entranceDevices[0]!.batteryPercent} %
                      </small>
                    )}
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
                    <small>{fr ? 'Aucun capteur associé' : 'No sensor assigned'}</small>
                  </>
                )}
              </div>
              <span className="room-sensor-card-footer">
                <span>
                  {entranceDevices.length
                    ? fr
                      ? 'Gérer la porte principale'
                      : 'Manage main door'
                    : fr
                      ? 'Associer un capteur'
                      : 'Assign a sensor'}
                </span>
                {entranceDevices.length ? <ArrowRight /> : <Plus />}
              </span>
            </button>
          </article>
        )}
        {visible
          .flatMap<{ id: RoomSensorCategory; type: ContactRole | undefined }>((id) => {
            if (id !== 'contact') return [{ id, type: undefined as ContactRole | undefined }];
            const types = CONTACT_TYPES.filter(
              ({ id: type }) =>
                type !== 'MAIN_ENTRANCE' &&
                categoryDevices('contact').some(
                  (device) => deviceContactType(plan, device) === type,
                ),
            );
            return [
              { id, type: undefined as ContactRole | undefined },
              ...types.map(({ id: type }) => ({ id, type })),
            ];
          })
          .map(({ id, type }) => {
            const definition = ROOM_SENSOR_CATEGORIES.find((c) => c.id === id)!;
            const items = categoryDevices(id).filter(
              (device) =>
                id !== 'contact' ||
                (type
                  ? deviceContactType(plan, device) === type
                  : !deviceContactType(plan, device)),
            );
            const Icon = categoryIcons[id];
            const reading = items.length === 1 ? roomSensorReading(items[0]!, id, fr, now) : null;
            const problems = items.filter(
              (device) => roomSensorReading(device, id, fr, now).status,
            ).length;
            return (
              <article
                key={`${id}-${type ?? 'general'}`}
                className={`room-sensor-card category-${id} ${items.length ? 'is-configured' : ''}`}
              >
                <button className="room-sensor-card-main" onClick={() => openCategory(id, type)}>
                  <span className="room-sensor-card-top">
                    <span className="room-sensor-icon">
                      <Icon />
                    </span>
                    <span className={`room-sensor-status ${items.length ? 'is-configured' : ''}`}>
                      {items.length ? (
                        <CheckCircle2 />
                      ) : (
                        <span className="room-sensor-status-dot" />
                      )}
                      {items.length
                        ? fr
                          ? 'Configuré'
                          : 'Configured'
                        : fr
                          ? 'Non configuré'
                          : 'Not configured'}
                    </span>
                  </span>
                  <h3>
                    {definition[fr ? 'label' : 'labelEn']}
                    {type
                      ? ` · ${CONTACT_TYPES.find((item) => item.id === type)?.[fr ? 'label' : 'labelEn']}`
                      : ''}
                  </h3>
                  <p>
                    {items.length === 1
                      ? items[0]!.name
                      : definition[fr ? 'description' : 'descriptionEn']}
                  </p>
                  <div className="room-sensor-card-value">
                    {reading ? (
                      <>
                        <strong className={reading.outdated ? 'is-outdated' : ''}>
                          {reading.reading}
                        </strong>
                        {reading.detail && (
                          <small className="room-sensor-reading-detail">{reading.detail}</small>
                        )}
                        {reading.status && <small>{reading.status}</small>}
                        <small>{lastReadingLabel(reading.lastSeenAt, fr, now, id)}</small>
                        {items[0]!.batteryPercent !== null && (
                          <small className="room-sensor-battery">
                            <BatteryMedium />
                            {fr ? 'Batterie' : 'Battery'} {items[0]!.batteryPercent} %
                          </small>
                        )}
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
          title={`${editingMainEntrance ? (fr ? 'Porte principale' : 'Main entrance') : selected[fr ? 'label' : 'labelEn']} · ${room.name}`}
          wide
          onClose={() => {
            setCategory(null);
            setAssigning(null);
            setConfirmRemoval(false);
            setEditingMainEntrance(false);
            setError('');
          }}
          busy={busy}
        >
          <div className="equipment-category-content">
            {category === 'contact' && (
              <label className="equipment-field">
                {fr ? 'À quoi correspond cette ouverture ?' : 'What does this opening monitor?'}
                <select
                  value={openingType}
                  onChange={(e) => setOpeningType(e.target.value as ContactRole)}
                >
                  <option value="">
                    {fr ? 'Choisir un type d’ouverture' : 'Choose an opening type'}
                  </option>
                  {CONTACT_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type[fr ? 'label' : 'labelEn']}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {assigning ? (
              <>
                <button
                  className="equipment-text-button"
                  onClick={() => {
                    setAssigning(null);
                    setConfirmRemoval(false);
                  }}
                >
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
                  <button
                    className="equipment-primary"
                    disabled={busy || !name.trim() || (category === 'contact' && !openingType)}
                    onClick={() => void associate()}
                  >
                    <Check />
                    {editingMainEntrance
                      ? fr
                        ? 'Définir comme porte principale'
                        : 'Set as main entrance'
                      : assigning.room?.id === roomId
                        ? fr
                          ? 'Enregistrer'
                          : 'Save'
                        : fr
                          ? `Associer à ${room.name}`
                          : `Assign to ${room.name}`}
                  </button>
                </footer>
                {assigning.protocol === 'zigbee' && (
                  <div className="equipment-removal">
                    {confirmRemoval ? (
                      <div
                        className="equipment-removal-confirmation"
                        role="group"
                        aria-label={fr ? 'Confirmer la suppression' : 'Confirm removal'}
                      >
                        <strong>
                          {fr
                            ? 'Retirer ce capteur du réseau ?'
                            : 'Remove this sensor from the network?'}
                        </strong>
                        <p>
                          {fr
                            ? 'Il sera supprimé de cette pièce et du réseau Zigbee. Pour le réinstaller ailleurs, remettez-le en mode appairage.'
                            : 'It will be removed from this room and the Zigbee network. To install it elsewhere, put it in pairing mode again.'}
                        </p>
                        <div>
                          <button
                            className="equipment-secondary"
                            disabled={busy}
                            onClick={() => setConfirmRemoval(false)}
                          >
                            {fr ? 'Annuler' : 'Cancel'}
                          </button>
                          <button
                            className="equipment-delete-confirm"
                            disabled={busy}
                            onClick={() => void removeDevice()}
                          >
                            <Trash2 />
                            {fr ? 'Supprimer du réseau' : 'Remove from network'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="equipment-delete-trigger"
                        disabled={busy}
                        onClick={() => setConfirmRemoval(true)}
                      >
                        <Trash2 />
                        {fr ? 'Supprimer du réseau' : 'Remove from network'}
                      </button>
                    )}
                  </div>
                )}
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
                    disabled={
                      busy ||
                      (category === 'contact' && !openingType) ||
                      product.compatibility !== 'DOCUMENTED'
                    }
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
                    <h3>
                      {editingMainEntrance
                        ? fr
                          ? 'Porte principale'
                          : 'Main entrance'
                        : fr
                          ? 'Dans cette pièce'
                          : 'In this room'}
                    </h3>
                    {selectedDevices.map((device) => {
                      const reading = roomSensorReading(device, category!, fr, now);
                      return (
                        <article className="equipment-device-row" key={device.id}>
                          <DevicePhoto device={device} />
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
                            {reading.detail && (
                              <small className="equipment-device-reading-detail">
                                {reading.detail}
                              </small>
                            )}
                            {reading.status && (
                              <small className="equipment-device-attention">{reading.status}</small>
                            )}
                            {reading.lastSeenAt && (
                              <small>
                                {fr
                                  ? ['presence', 'motion', 'contact'].includes(category!)
                                    ? 'Dernier changement le '
                                    : 'Mesure reçue le '
                                  : ['presence', 'motion', 'contact'].includes(category!)
                                    ? 'Latest change on '
                                    : 'Reading received '}{' '}
                                {new Date(reading.lastSeenAt).toLocaleString(fr ? 'fr-FR' : 'en')}
                              </small>
                            )}
                            {device.batteryPercent !== null && (
                              <small>
                                {fr ? 'Batterie' : 'Battery'} {device.batteryPercent} %
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
                    {fr ? 'Autres capteurs connectés' : 'Other connected sensors'}
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
                        {category === 'camera'
                          ? fr
                            ? 'Aucun produit caméra documenté pour l’instant. Vous pouvez ajouter une caméra Zigbee par détection automatique ou associer une caméra déjà reconnue.'
                            : 'No documented camera products yet. Add a Zigbee camera with automatic detection or assign a recognized camera.'
                          : outdoor
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
                    {availableConnected.map((device) => (
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
                          {device.batteryPercent !== null && (
                            <small>
                              {fr ? 'Batterie' : 'Battery'} {device.batteryPercent} %
                            </small>
                          )}
                        </span>
                        <Plus />
                      </button>
                    ))}
                    {!availableConnected.length && (
                      <div className="equipment-connected-empty" role="status">
                        <Radio />
                        <strong>
                          {fr ? 'Aucun autre capteur à ajouter' : 'No other sensor to add'}
                        </strong>
                        <p>
                          {selectedDevices.length
                            ? fr
                              ? 'Les capteurs de cette pièce sont déjà affichés plus haut. Les autres capteurs compatibles apparaîtront ici.'
                              : 'Sensors in this room are already shown above. Other compatible sensors will appear here.'
                            : fr
                              ? 'Les capteurs compatibles déjà connectés apparaîtront ici.'
                              : 'Compatible connected sensors will appear here.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <button
                  className="equipment-unlisted"
                  disabled={busy || (category === 'contact' && !openingType)}
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
        contactRole={installationContactRole}
        category={installationCategory}
        product={installationProduct}
        onClose={() => setInstalling(false)}
        onInstalled={onRefresh}
      />
      {busy && (
        <div className="equipment-working" role="status">
          <LoaderCircle className="is-spinning" />
          {confirmRemoval
            ? fr
              ? 'Suppression du capteur…'
              : 'Removing sensor…'
            : fr
              ? 'Enregistrement…'
              : 'Saving…'}
        </div>
      )}
    </section>
  );
}
