import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  ArrowLeft,
  ArrowRight,
  Bell,
  BedDouble,
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
  UserRound,
  Wind,
} from 'lucide-react';
import {
  CONTACT_TYPES,
  contactRoleSchema,
  type ContactRole,
  ROOM_SENSOR_CATEGORIES,
  deviceSupportsCategory,
  isBedOccupancySensorModel,
  roomSupportsCategory,
  visibleRoomCategories,
  type HomePlan,
  type RoomSensorCategory,
  type SensorProduct,
} from '@elise/contracts';
import { EquipmentDialog } from './EquipmentDialog';
import { CameraNetworkOnboarding } from './CameraNetworkOnboarding';
import { SensorOnboardingDialog } from './SensorOnboardingDialog';
import { SensorInstallationGuide } from './SensorInstallationGuide';
import { productsForCategory, sensorDevicePhoto } from './sensor-products';
import {
  connectedDevicesForCategory,
  sensorJson,
  sensorRequest,
  type SensorUiDevice,
} from './sensor-ui';
import { dateLocale, type Locale, t } from './i18n';
import {
  contactTypeLabel,
  productTexts,
  sensorCategoryDescription,
  sensorCategoryLabel,
} from './i18n/data';

const categoryIcons = {
  temperature: Thermometer,
  humidity: Droplets,
  shower: Droplets,
  motion: Activity,
  presence: UserRound,
  fall_detection: ShieldAlert,
  button: Bell,
  contact: DoorOpen,
  bed: BedDouble,
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
const roomLabels: Record<string, () => string> = {
  LIVING_ROOM: () => t('roomEquipmentPage.roomLabels.LIVING_ROOM'),
  BEDROOM: () => t('roomEquipmentPage.roomLabels.BEDROOM'),
  KITCHEN: () => t('roomEquipmentPage.roomLabels.KITCHEN'),
  BATHROOM: () => t('roomEquipmentPage.roomLabels.BATHROOM'),
  TOILET: () => t('roomEquipmentPage.roomLabels.TOILET'),
  ENTRANCE: () => t('roomEquipmentPage.roomLabels.ENTRANCE'),
  HALLWAY: () => t('roomEquipmentPage.roomLabels.HALLWAY'),
  DINING_ROOM: () => t('roomEquipmentPage.roomLabels.DINING_ROOM'),
  GARAGE: () => t('roomEquipmentPage.roomLabels.GARAGE'),
  GARDEN: () => t('roomEquipmentPage.roomLabels.GARDEN'),
  TERRACE: () => t('roomEquipmentPage.roomLabels.TERRACE'),
  OTHER: () => t('roomEquipmentPage.roomLabels.OTHER'),
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
    const role = ['contact', 'bed'].includes(category)
      ? deviceContactType(plan, device)
      : undefined;
    if (category === 'bed' && role !== 'BED') return false;
    if (category === 'contact' && role === 'BED') return false;
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
  const role = placement?.capabilityBindings?.find(
    ({ capability }) =>
      ['contact', 'dry_contact'].includes(capability) ||
      (capability === 'occupancy' && isBedOccupancySensorModel(device.model)),
  )?.role;
  const parsed = contactRoleSchema.safeParse(role);
  return parsed.success ? parsed.data : undefined;
}

export function deviceBedOccupiedWhen(plan: HomePlan, device: SensorUiDevice): 'CLOSED' | 'OPEN' {
  const binding = plan.placements
    .filter(
      (placement) =>
        placement.kind === 'SENSOR' &&
        (placement.equipmentRefKind === 'DEVICE'
          ? placement.equipmentId === device.id
          : device.capabilities.some(({ sensorId }) => sensorId === placement.equipmentId)),
    )
    .flatMap((placement) => placement.capabilityBindings ?? [])
    .find(({ role }) => role === 'BED');
  return binding?.bedOccupiedWhen ?? (isBedOccupancySensorModel(device.model) ? 'OPEN' : 'CLOSED');
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
  bedOccupiedWhen: 'CLOSED' | 'OPEN' = 'CLOSED',
) {
  const capabilities = device.capabilities.filter(({ capability }) =>
    category === 'presence'
      ? ['person_presence', 'occupancy'].includes(capability)
      : category === 'motion'
        ? ['motion', 'occupancy'].includes(capability)
        : category === 'bed'
          ? ['contact', 'dry_contact'].includes(capability) ||
            (capability === 'occupancy' && isBedOccupancySensorModel(device.model))
          : category === 'contact'
            ? ['contact', 'dry_contact'].includes(capability)
            : category === 'air_quality'
              ? ['co2', 'pm25', 'voc', 'total_volatile_organic_compounds', 'air_quality'].includes(
                  capability,
                )
              : category === 'shower'
                ? capability === 'humidity'
                : capability === category,
  );
  const capability = capabilities.find((c) => c.value !== null) ?? capabilities[0];
  const lastSeenAt = capability?.lastSeenAt ?? device.lastSeenAt;
  const lastSeen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  // A value can stay unchanged while another function of the same device reports.
  const stateful = ['presence', 'motion', 'contact', 'bed'].includes(category);
  const deviceSeen = device.lastSeenAt ? Date.parse(device.lastSeenAt) : NaN;
  const freshness = Math.max(
    Number.isFinite(lastSeen) ? lastSeen : -Infinity,
    Number.isFinite(deviceSeen) ? deviceSeen : -Infinity,
  );
  const stale = !Number.isFinite(freshness) || now - freshness > 120 * 60 * 1000;
  const status = !device.enabled
    ? t('roomEquipmentPage.disabled')
    : capability?.status === 'OFFLINE'
      ? t('roomEquipmentPage.offline')
      : ['DETECTED', 'NEEDS_CONFIRMATION', 'NEEDS_PLACEMENT'].includes(device.installationStatus)
        ? t('roomEquipmentPage.needsChecking')
        : device.installationStatus === 'ATTENTION' || capability?.status === 'DEGRADED'
          ? t('roomEquipmentPage.needsChecking')
          : stale || capability?.status !== 'ONLINE'
            ? stateful
              ? t('roomEquipmentPage.noRecentSignal')
              : t('roomEquipmentPage.oldReading')
            : null;
  const value = capability?.value;
  let reading = '—';
  let detail: string | null = null;
  if (typeof value?.value === 'number') {
    const formatted = `${new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(value.value)}${capability?.unit ? ` ${capability.unit}` : ''}`;
    if (category === 'illuminance') {
      reading = illuminanceLevel(value.value);
      detail = formatted;
    } else reading = formatted;
  } else {
    const active =
      ['contact', 'bed'].includes(category) && typeof value?.open === 'boolean'
        ? value.open
        : typeof value?.active === 'boolean'
          ? value.active
          : typeof value?.value === 'boolean'
            ? value.value
            : undefined;
    if (typeof active === 'boolean')
      reading =
        category === 'bed'
          ? active === (bedOccupiedWhen === 'OPEN')
            ? t('roomEquipmentPage.occupied')
            : t('roomEquipmentPage.empty')
          : category === 'contact'
            ? active
              ? t('roomEquipmentPage.open')
              : t('roomEquipmentPage.closed')
            : ['presence', 'motion'].includes(category)
              ? active
                ? t('roomEquipmentPage.detected')
                : t('roomEquipmentPage.notDetected')
              : category === 'fall_detection'
                ? active
                  ? t('roomEquipmentPage.fallAlert')
                  : t('roomEquipmentPage.noFallReported')
                : active
                  ? t('roomEquipmentPage.signalDetected')
                  : t('roomEquipmentPage.noSignal');
    else if (typeof value?.action === 'string') reading = t('roomEquipmentPage.lastPressReceived');
  }
  if (category === 'camera') reading = status ?? t('roomEquipmentPage.connected');
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

export function illuminanceLevel(lux: number) {
  if (lux < 50) return t('roomEquipmentPage.veryDim');
  if (lux < 150) return t('roomEquipmentPage.dim');
  if (lux < 300) return t('roomEquipmentPage.comfortable');
  if (lux < 1_000) return t('roomEquipmentPage.bright');
  return t('roomEquipmentPage.veryBright');
}

export function lastReadingLabel(
  lastSeenAt: string | null,
  fr: boolean,
  now = Date.now(),
  category?: RoomSensorCategory,
) {
  if (!lastSeenAt) return t('roomEquipmentPage.readingTimeUnknown');
  const receivedAt = new Date(lastSeenAt);
  if (Number.isNaN(receivedAt.getTime())) return t('roomEquipmentPage.readingTimeUnknown');
  const locale = dateLocale();
  const time = receivedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const sameDay = receivedAt.toDateString() === new Date(now).toDateString();
  const date = receivedAt.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const stateful = category && ['presence', 'motion', 'contact', 'bed'].includes(category);
  if (stateful)
    return sameDay
      ? t('roomEquipmentPage.lastReceived.changeSameDay', { time })
      : t('roomEquipmentPage.lastReceived.changeOnDate', { date, time });
  return sameDay
    ? t('roomEquipmentPage.lastReceived.readingSameDay', { time })
    : t('roomEquipmentPage.lastReceived.readingOnDate', { date, time });
}

export function RoomEquipmentPage({
  roomId,
  plan,
  devices,
  cameras = [],
  locale,
  onBack,
  onRefresh,
  onPlanSaved,
  onCameraAdded = () => undefined,
}: {
  roomId: string;
  plan: HomePlan;
  devices: SensorUiDevice[];
  cameras?: Array<{
    id: string;
    name: string;
    status: string;
    room: { id: string; name: string; kind: string } | null;
  }>;
  locale: Locale;
  onBack: () => void;
  onEditPlan?: () => void;
  onRefresh: () => Promise<void>;
  onPlanSaved: (plan: HomePlan) => void;
  onCameraAdded?: () => void | Promise<void>;
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
  const [installationBedOccupiedWhen, setInstallationBedOccupiedWhen] = useState<'CLOSED' | 'OPEN'>(
    'CLOSED',
  );
  const [openingType, setOpeningType] = useState<ContactRole | ''>('');
  const [bedOccupiedWhen, setBedOccupiedWhen] = useState<'CLOSED' | 'OPEN'>('CLOSED');
  const [contactFilter, setContactFilter] = useState<ContactRole | undefined>();
  const [editingMainEntrance, setEditingMainEntrance] = useState(false);
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
        .catch(() => setError(t('roomEquipmentPage.refreshUnavailablePleaseRetry')));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [fr]);
  if (!room || !floor)
    return (
      <section className="room-equipment-page">
        <p>{t('roomEquipmentPage.thisRoomNoLongerExists')}</p>
        <button className="equipment-secondary" onClick={onBack}>
          {t('roomEquipmentPage.backToHome')}
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
    ? category === 'camera'
      ? []
      : editingMainEntrance
        ? connectedDevicesForCategory(devices, category).filter(
            (device) => !selectedDevices.some(({ id }) => id === device.id),
          )
        : category === 'bed'
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
  const readingFor = (device: SensorUiDevice, id: RoomSensorCategory) =>
    roomSensorReading(device, id, fr, now, deviceBedOccupiedWhen(plan, device));
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
    const matchingDevices = categoryDevices(id).filter(
      (device) =>
        id !== 'contact' ||
        (type ? deviceContactType(plan, device) === type : !deviceContactType(plan, device)),
    );
    setContactFilter(type);
    setOpeningType(id === 'bed' ? 'BED' : (type ?? ''));
    setBedOccupiedWhen('CLOSED');
    setEditingMainEntrance(false);
    setCategory(id);
    setProduct(null);
    if (matchingDevices.length === 1) {
      const device = matchingDevices[0]!;
      setAssigning(device);
      setName(device.name);
      const placement = plan.placements.find(
        (item) =>
          item.equipmentId === device.id ||
          device.capabilities.some(({ sensorId }) => sensorId === item.equipmentId),
      );
      setNote(device.placementNote ?? placement?.placementNote ?? '');
      if (id === 'bed') setBedOccupiedWhen(deviceBedOccupiedWhen(plan, device));
    } else setAssigning(null);
    setTab('PRODUCTS');
    setError('');
  };
  const openMainEntrance = () => {
    setOpeningType('MAIN_ENTRANCE');
    setContactFilter(undefined);
    setEditingMainEntrance(true);
    setCategory('contact');
    setProduct(null);
    if (entranceDevices.length === 1) {
      const device = entranceDevices[0]!;
      setAssigning(device);
      setName(device.name);
      const placement = plan.placements.find(
        (item) =>
          item.equipmentId === device.id ||
          device.capabilities.some(({ sensorId }) => sensorId === item.equipmentId),
      );
      setNote(device.placementNote ?? placement?.placementNote ?? '');
    } else setAssigning(null);
    setTab('PRODUCTS');
    setError('');
  };
  const startInstall = (chosen?: SensorProduct) =>
    run(async () => {
      await onRefresh();
      setInstallationCategory(category ?? undefined);
      setInstallationProduct(chosen);
      setInstallationContactRole(
        category === 'bed' ? 'BED' : category === 'contact' ? openingType || undefined : undefined,
      );
      setInstallationBedOccupiedWhen(
        category === 'bed' && isBedOccupancySensorModel(chosen?.model) ? 'OPEN' : bedOccupiedWhen,
      );
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
    if (category === 'bed') setBedOccupiedWhen(deviceBedOccupiedWhen(plan, device));
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
          ...(['contact', 'bed'].includes(category ?? '')
            ? {
                contactRole: category === 'bed' ? 'BED' : openingType || undefined,
                ...(category === 'bed' ? { bedOccupiedWhen } : {}),
                ...(category === 'bed' ||
                (deviceContactType(plan, assigning) === 'MAIN_ENTRANCE' &&
                  openingType !== 'MAIN_ENTRANCE')
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
  const rooms = plan.levels.flatMap((level) =>
    level.rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, floor: level.floor })),
  );

  return (
    <section className="room-equipment-page">
      <nav className="room-equipment-breadcrumb" aria-label={t('roomEquipmentPage.roomNavigation')}>
        <button
          className="room-equipment-back"
          onClick={onBack}
          aria-label={t('roomEquipmentPage.backToMyHome')}
        >
          <span className="room-equipment-back-icon" aria-hidden="true">
            <ArrowLeft />
          </span>
          <span className="room-equipment-back-copy">
            <span>{t('roomEquipmentPage.backTo')}</span>
            <strong>{t('roomEquipmentPage.myHome')}</strong>
          </span>
        </button>
        <ChevronRight className="room-equipment-breadcrumb-divider" aria-hidden="true" />
        <span className="room-equipment-current-room" aria-current="page">
          {room.name}
        </span>
      </nav>
      <header className="room-equipment-header">
        <div className="room-equipment-title">
          <span className="equipment-kicker">{t('roomEquipmentPage.yourRoom')}</span>
          <h1 ref={title} tabIndex={-1}>
            {room.name}
          </h1>
          <div className="room-equipment-metadata">
            <span>
              <House />
              {roomLabels[room.kind]?.() ?? room.kind}
            </span>
            <span>
              <Layers />
              {floor.name}
            </span>
            {room.areaM2 != null && (
              <span>
                <Grid2X2 />
                {new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(
                  room.areaM2,
                )}{' '}
                m²
              </span>
            )}
            <span className="room-equipment-status">
              <Radio />
              {t('roomEquipmentPage.sensorsAssigned', { count })}
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
            {t('roomEquipmentPage.addASensor')}
          </button>
        </div>
      </header>
      <div className="room-equipment-section-heading">
        <div>
          <h2>{t('roomEquipmentPage.roomSensors')}</h2>
          <p>{t('roomEquipmentPage.chooseWhatYouWantTo')}</p>
        </div>
      </div>
      {error && !category && !more && !guideId && (
        <div className="equipment-error" role="alert">
          {error}
          <button onClick={() => void run(onRefresh)}>{t('roomEquipmentPage.refresh')}</button>
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
                    ? t('roomEquipmentPage.configured')
                    : t('roomEquipmentPage.notConfigured')}
                </span>
              </span>
              <h3>{t('roomEquipmentPage.mainEntrance')}</h3>
              <p>{t('roomEquipmentPage.theDoorLeadingOutside')}</p>
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
                        {t('roomEquipmentPage.battery')} {entranceDevices[0]!.batteryPercent} %
                      </small>
                    )}
                  </>
                ) : entranceDevices.length > 1 ? (
                  <>
                    <strong>
                      {entranceDevices.length} <span>{t('roomEquipmentPage.sensors')}</span>
                    </strong>
                    <small>{t('roomEquipmentPage.viewReadings')}</small>
                  </>
                ) : (
                  <>
                    <span className="room-sensor-empty-line">—</span>
                    <small>{t('roomEquipmentPage.noSensorAssigned')}</small>
                  </>
                )}
              </div>
              <span className="room-sensor-card-footer">
                <span>
                  {entranceDevices.length
                    ? t('roomEquipmentPage.manageMainDoor')
                    : t('roomEquipmentPage.assignASensor')}
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
            const reading = items.length === 1 ? readingFor(items[0]!, id) : null;
            const problems = items.filter((device) => readingFor(device, id).status).length;
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
                        ? t('roomEquipmentPage.configured')
                        : t('roomEquipmentPage.notConfigured')}
                    </span>
                  </span>
                  <h3>
                    {sensorCategoryLabel(definition.id)}
                    {type ? ` · ${contactTypeLabel(type)}` : ''}
                  </h3>
                  <p>
                    {items.length === 1 ? items[0]!.name : sensorCategoryDescription(definition.id)}
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
                            {t('roomEquipmentPage.battery')} {items[0]!.batteryPercent} %
                          </small>
                        )}
                      </>
                    ) : items.length > 1 ? (
                      <>
                        <strong>
                          {items.length} <span>{t('roomEquipmentPage.sensors')}</span>
                        </strong>
                        <small>
                          {problems
                            ? t('roomEquipmentPage.toCheck', { problems })
                            : t('roomEquipmentPage.viewReadings')}
                        </small>
                      </>
                    ) : (
                      <>
                        <span className="room-sensor-empty-line">—</span>
                        <small>{t('roomEquipmentPage.noSensorAssigned')}</small>
                      </>
                    )}
                  </div>
                  <span className="room-sensor-card-footer">
                    <span>
                      {items.length
                        ? t('roomEquipmentPage.devicesManage', { count: items.length })
                        : t('roomEquipmentPage.addASensor')}
                    </span>
                    {items.length ? <ArrowRight /> : <Plus />}
                  </span>
                </button>
                {!items.length && (
                  <button
                    className="room-sensor-hide"
                    disabled={busy}
                    onClick={() => void preference(id, true)}
                    aria-label={`${t('roomEquipmentPage.hide')} ${sensorCategoryLabel(definition.id)}`}
                  >
                    <EyeOff />
                  </button>
                )}
              </article>
            );
          })}
      </div>
      {!visible.length && (
        <p className="equipment-note">{t('roomEquipmentPage.addASensorTypeTo')}</p>
      )}
      <p className="room-equipment-footnote">
        <CheckCircle2 />
        {t('roomEquipmentPage.oneDeviceCanProvideSeveral')}
      </p>

      {more && (
        <EquipmentDialog
          title={t('roomEquipmentPage.addASensorType')}
          onClose={() => setMore(false)}
          busy={busy}
        >
          <div className="equipment-category-picker">
            {ROOM_SENSOR_CATEGORIES.filter(
              ({ id }) => roomSupportsCategory(room.kind, id) && !visible.includes(id),
            ).map((definition) => {
              const Icon = categoryIcons[definition.id];
              return (
                <button
                  key={definition.id}
                  disabled={busy}
                  onClick={() => void preference(definition.id, false)}
                >
                  <Icon />
                  <span>
                    <strong>{sensorCategoryLabel(definition.id)}</strong>
                    <small>{sensorCategoryDescription(definition.id)}</small>
                  </span>
                  <Plus />
                </button>
              );
            })}
            {visible.length === ROOM_SENSOR_CATEGORIES.length && (
              <p>{t('roomEquipmentPage.allTypesAreAlreadyVisible')}</p>
            )}
            {error && (
              <p className="equipment-error" role="alert">
                {error}
                <button onClick={() => void run(onRefresh)}>
                  {t('roomEquipmentPage.refresh')}
                </button>
              </p>
            )}
          </div>
        </EquipmentDialog>
      )}

      {selected && (
        <EquipmentDialog
          title={`${editingMainEntrance ? t('roomEquipmentPage.mainEntrance2') : sensorCategoryLabel(selected.id)} · ${room.name}`}
          wide={category !== 'camera'}
          sidePanel={category !== 'camera'}
          onClose={() => {
            setCategory(null);
            setAssigning(null);
            setEditingMainEntrance(false);
            setError('');
          }}
          busy={busy}
        >
          {category === 'camera' ? (
            <CameraNetworkOnboarding
              locale={locale}
              roomId={roomId}
              roomName={room.name}
              cameras={cameras.filter(({ room: cameraRoom }) => cameraRoom?.id === roomId)}
              onAdded={async () => {
                await onRefresh();
                await onCameraAdded();
              }}
            />
          ) : (
            <div className="equipment-category-content">
              {category === 'contact' && (
                <label className="equipment-field">
                  {t('roomEquipmentPage.whatDoesThisOpeningMonitor')}
                  <select
                    value={openingType}
                    onChange={(e) => setOpeningType(e.target.value as ContactRole)}
                  >
                    <option value="">{t('roomEquipmentPage.chooseAnOpeningType')}</option>
                    {CONTACT_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>
                        {contactTypeLabel(type.id)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {category === 'bed' && (
                <>
                  <p className="equipment-note">
                    {assigning
                      ? isBedOccupancySensorModel(assigning.model)
                        ? t('roomEquipmentPage.theTuyaStripConnectsDirectly')
                        : t('roomEquipmentPage.connectADryContactPressure')
                      : t('roomEquipmentPage.chooseATuyaZigbeeOccupancy')}
                  </p>
                  {(!assigning || !isBedOccupancySensorModel(assigning.model)) && (
                    <label className="equipment-field">
                      {t('roomEquipmentPage.whenTheBedIsOccupied')}
                      <select
                        value={bedOccupiedWhen}
                        onChange={(event) =>
                          setBedOccupiedWhen(event.target.value as 'CLOSED' | 'OPEN')
                        }
                      >
                        <option value="CLOSED">{t('roomEquipmentPage.theContactIsClosed')}</option>
                        <option value="OPEN">{t('roomEquipmentPage.theContactIsOpen')}</option>
                      </select>
                    </label>
                  )}
                </>
              )}
              {assigning ? (
                <>
                  <button
                    className="equipment-text-button"
                    onClick={() => {
                      setAssigning(null);
                    }}
                  >
                    <ArrowLeft />
                    {t('roomEquipmentPage.backToSensors')}
                  </button>
                  <section className="equipment-sensor-profile">
                    <div className="equipment-sensor-profile-photo">
                      <DevicePhoto device={assigning} />
                    </div>
                    <div className="equipment-sensor-profile-copy">
                      <span className="equipment-sensor-profile-status">
                        <span aria-hidden="true" />
                        {assigning.enabled
                          ? t('roomEquipmentPage.activeSensor')
                          : t('roomEquipmentPage.sensorOffline')}
                      </span>
                      <h3>{assigning.name}</h3>
                      <p className="equipment-sensor-model">
                        {[assigning.manufacturer, assigning.model].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </section>
                  <section className="equipment-sensor-purpose">
                    <span className={`room-sensor-icon category-${category}`}>
                      {(() => {
                        const Icon = categoryIcons[category!];
                        return <Icon />;
                      })()}
                    </span>
                    <div>
                      <span>{t('roomEquipmentPage.whatIsThisSensorFor')}</span>
                      <strong>
                        {editingMainEntrance
                          ? t('roomEquipmentPage.itMonitorsTheOpeningOf')
                          : sensorCategoryDescription(selected.id)}
                      </strong>
                    </div>
                  </section>
                  <div className="equipment-sensor-glance">
                    <div>
                      <span>{t('roomEquipmentPage.currentReading')}</span>
                      <strong>
                        {roomSensorReading(assigning, category!, fr, now, bedOccupiedWhen).reading}
                      </strong>
                    </div>
                    <div>
                      <span>{t('roomEquipmentPage.battery')}</span>
                      <strong>
                        {assigning.batteryPercent !== null
                          ? `${assigning.batteryPercent} %`
                          : t('roomEquipmentPage.notReported')}
                      </strong>
                    </div>
                  </div>
                  {assigning.room && assigning.room.id !== roomId && (
                    <p className="equipment-note">
                      {t('roomEquipmentPage.thisDeviceAndAllIts', {
                        name: assigning.room.name,
                        name2: room.name,
                      })}
                    </p>
                  )}
                  <h4 className="equipment-sensor-settings-title">
                    {t('roomEquipmentPage.personalisation')}
                  </h4>
                  <label className="equipment-field">
                    {t('roomEquipmentPage.sensorName')}
                    <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="equipment-field">
                    {t('roomEquipmentPage.locationOptional')}
                    <input
                      value={note}
                      maxLength={500}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('roomEquipmentPage.forExampleByTheBed')}
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
                        ? t('roomEquipmentPage.setAsMainEntrance')
                        : assigning.room?.id === roomId
                          ? t('roomEquipmentPage.save')
                          : t('roomEquipmentPage.assignTo', { name: room.name })}
                    </button>
                  </footer>
                </>
              ) : product ? (
                <>
                  <button className="equipment-text-button" onClick={() => setProduct(null)}>
                    <ArrowLeft />
                    {t('roomEquipmentPage.allProducts')}
                  </button>
                  <div className="equipment-product-detail">
                    <ProductPhoto product={product} />
                    <div>
                      <span className="equipment-kicker">{product.brand}</span>
                      <h3>{productTexts(product).name}</h3>
                      <p>{product.model}</p>
                      <span className="equipment-product-badge">
                        {product.eliseValidated
                          ? t('roomEquipmentPage.validatedWithElise')
                          : t('roomEquipmentPage.documentedCompatibilityEliseTestPending')}
                      </span>
                    </div>
                  </div>
                  <div className="equipment-capability-tags">
                    {product.categories.map((id) => (
                      <span key={id}>{sensorCategoryLabel(id)}</span>
                    ))}
                  </div>
                  <h4>{t('roomEquipmentPage.documentedFeatures')}</h4>
                  <ul>
                    {productTexts(product).features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <dl className="equipment-product-specs">
                    <div>
                      <dt>{t('roomEquipmentPage.power')}</dt>
                      <dd>{productTexts(product).power}</dd>
                    </div>
                    <div>
                      <dt>{t('roomEquipmentPage.use')}</dt>
                      <dd>
                        {product.outdoor
                          ? t('roomEquipmentPage.outdoor')
                          : t('roomEquipmentPage.indoor')}
                      </dd>
                    </div>
                  </dl>
                  <h4>{t('roomEquipmentPage.prepareTheSensor')}</h4>
                  <ol className="equipment-guide-steps">
                    {productTexts(product).preparation.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <h4>{t('roomEquipmentPage.whereToPlaceIt')}</h4>
                  <ul>
                    {productTexts(product).placement.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  <div className="equipment-product-links">
                    <a href={product.manualUrl} target="_blank" rel="noreferrer">
                      {t('roomEquipmentPage.manufacturerDocumentation')} ↗
                    </a>
                    <a href={product.integrationUrl} target="_blank" rel="noreferrer">
                      {t('roomEquipmentPage.documentedCompatibility')} ↗
                    </a>
                  </div>
                  <small className="equipment-muted">
                    {t('roomEquipmentPage.documentationCheckedOn')} {product.verifiedAt}
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
                      {t('roomEquipmentPage.installThisSensor')}
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
                          ? t('roomEquipmentPage.mainEntrance2')
                          : t('roomEquipmentPage.inThisRoom')}
                      </h3>
                      {selectedDevices.map((device) => {
                        const reading = readingFor(device, category!);
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
                                <small className="equipment-device-attention">
                                  {reading.status}
                                </small>
                              )}
                              {reading.lastSeenAt && (
                                <small>
                                  {t(
                                    ['presence', 'motion', 'contact', 'bed'].includes(category!)
                                      ? 'roomEquipmentPage.latestChangeOnDate'
                                      : 'roomEquipmentPage.readingReceivedOnDate',
                                    {
                                      date: new Date(reading.lastSeenAt).toLocaleString(
                                        dateLocale(),
                                      ),
                                    },
                                  )}
                                </small>
                              )}
                              {device.batteryPercent !== null && (
                                <small>
                                  {t('roomEquipmentPage.battery')} {device.batteryPercent} %
                                </small>
                              )}
                            </div>
                            <div className="equipment-device-actions">
                              <button onClick={() => editDevice(device)}>
                                {t('roomEquipmentPage.manage')}
                              </button>
                              <button
                                onClick={() => {
                                  setGuideId(device.id);
                                  setCategory(null);
                                }}
                              >
                                {t('roomEquipmentPage.guideAndTest')}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  )}
                  <h3>{t('roomEquipmentPage.addASensor')}</h3>
                  <div
                    className="equipment-catalog-tabs"
                    role="tablist"
                    aria-label={t('roomEquipmentPage.sensorChoice')}
                  >
                    <button
                      id="equipment-products-tab"
                      role="tab"
                      aria-selected={tab === 'PRODUCTS'}
                      aria-controls="equipment-products-panel"
                      onClick={() => setTab('PRODUCTS')}
                    >
                      {t('roomEquipmentPage.documentedProducts')}
                    </button>
                    <button
                      id="equipment-connected-tab"
                      role="tab"
                      aria-selected={tab === 'CONNECTED'}
                      aria-controls="equipment-connected-panel"
                      onClick={() => setTab('CONNECTED')}
                    >
                      {t('roomEquipmentPage.otherConnectedSensors')}
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
                            onSelect={() => setProduct(item)}
                          />
                        ))}
                      </div>
                      {!products.length && (
                        <p className="equipment-note">
                          {outdoor
                            ? t('roomEquipmentPage.noOutdoorModelIsAvailable')
                            : t('roomEquipmentPage.noneOfYourCurrentTest')}
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
                                ? t('roomEquipmentPage.currently', { name: device.room.name })
                                : t('roomEquipmentPage.unassigned')}
                            </small>
                            {device.batteryPercent !== null && (
                              <small>
                                {t('roomEquipmentPage.battery')} {device.batteryPercent} %
                              </small>
                            )}
                          </span>
                          <Plus />
                        </button>
                      ))}
                      {!availableConnected.length && (
                        <div className="equipment-connected-empty" role="status">
                          <Radio />
                          <strong>{t('roomEquipmentPage.noOtherSensorToAdd')}</strong>
                          <p>
                            {selectedDevices.length
                              ? t('roomEquipmentPage.sensorsInThisRoomAre')
                              : t('roomEquipmentPage.compatibleConnectedSensorsWillAppear')}
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
                      {t('roomEquipmentPage.myModelIsNotListed')}
                      <small>{t('roomEquipmentPage.startAutomaticDetection')}</small>
                    </span>
                    <ArrowRight />
                  </button>
                </>
              )}
              {error && (
                <p className="equipment-error" role="alert">
                  {error}
                  <button onClick={() => void run(onRefresh)}>
                    {t('roomEquipmentPage.refresh')}
                  </button>
                </p>
              )}
            </div>
          )}
        </EquipmentDialog>
      )}
      {guideId && (
        <EquipmentDialog
          title={shownGuide?.name ?? t('roomEquipmentPage.sensorGuide')}
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
            <p>{t('roomEquipmentPage.sensorNoLongerAvailable')}</p>
          )}
        </EquipmentDialog>
      )}
      <SensorOnboardingDialog
        open={installing}
        locale={locale}
        rooms={rooms}
        initialRoomId={roomId}
        contactRole={installationContactRole}
        bedOccupiedWhen={installationBedOccupiedWhen}
        category={installationCategory}
        product={installationProduct}
        onClose={() => setInstalling(false)}
        onInstalled={onRefresh}
      />
      {busy && (
        <div className="equipment-working" role="status">
          <LoaderCircle className="is-spinning" />
          {t('roomEquipmentPage.saving')}
        </div>
      )}
    </section>
  );
}
