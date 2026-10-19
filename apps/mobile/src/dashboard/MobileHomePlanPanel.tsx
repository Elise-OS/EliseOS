import {
  ROOM_SENSOR_CATEGORIES,
  deviceSupportsCategory,
  isBedOccupancySensorModel,
  visibleRoomCategories,
  type HomePlan,
  type PlanRoom,
  type RoomSensorCategory,
  type SensorDevice,
} from '@michel/contracts';
import {
  Activity,
  ArrowLeft,
  Bath,
  BedDouble,
  Bell,
  Boxes,
  Camera,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronRight,
  CookingPot,
  DoorOpen,
  Droplets,
  Flame,
  Footprints,
  Home,
  ShieldAlert,
  Sofa,
  Sun,
  Thermometer,
  Toilet,
  Trees,
  UserRound,
  Utensils,
  Warehouse,
  Wind,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import image3RDS17BZ from '../../assets/sensor-products/3RDS17BZ.png';
import image3RMS16BZ from '../../assets/sensor-products/3RMS16BZ.png';
import image3RPL01084Z from '../../assets/sensor-products/3RPL01084Z.png';
import image3RSB22BZ from '../../assets/sensor-products/3RSB22BZ.png';
import image3RSPE01044BZ from '../../assets/sensor-products/3RSPE01044BZ.png';
import image3RTHS0224Z from '../../assets/sensor-products/3RTHS0224Z.png';
import image3RWS18BZ from '../../assets/sensor-products/3RWS18BZ.png';
import imageHS2FDE from '../../assets/sensor-products/HS2FD-E.png';
import imageHS1SAE from '../../assets/sensor-products/HS1SA-E.png';
import imageSDC4100 from '../../assets/sensor-products/SDC-4-1-00.png';
import imageSDO4100 from '../../assets/sensor-products/SDO-4-1-00.png';
import imageSEM4100 from '../../assets/sensor-products/SEM-4-1-00.png';
import imageSNZB02P from '../../assets/sensor-products/SNZB-02P.png';
import imageSTPH4100 from '../../assets/sensor-products/STPH-4-1-00.png';
import imageTuyaBedPressure from '../../assets/sensor-products/TS0601_bed_presence_sensor.png';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import type { CameraItem } from '../api';

type Locale = 'fr' | 'en';
type IconComponent = typeof Home;

const roomIcons: Record<string, IconComponent> = {
  LIVING_ROOM: Sofa,
  KITCHEN: CookingPot,
  BEDROOM: BedDouble,
  BATHROOM: Bath,
  TOILET: Toilet,
  ENTRANCE: DoorOpen,
  HALLWAY: Footprints,
  DINING_ROOM: Utensils,
  GARAGE: Warehouse,
  GARDEN: Trees,
  TERRACE: Sun,
};

const categoryIcons: Record<RoomSensorCategory, IconComponent> = {
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

const categoryColors: Record<RoomSensorCategory, { foreground: string; background: string }> = {
  temperature: { foreground: '#b56a29', background: '#fff0e2' },
  humidity: { foreground: '#307ba7', background: '#e9f5fc' },
  shower: { foreground: '#307ba7', background: '#e9f5fc' },
  motion: { foreground: '#7252ac', background: '#f2edfb' },
  presence: { foreground: '#297c72', background: '#e7f6f1' },
  fall_detection: { foreground: '#b45b54', background: '#fcedeb' },
  button: { foreground: '#8a65a9', background: '#f4edf8' },
  contact: { foreground: '#3d719f', background: '#edf3f9' },
  bed: { foreground: '#77619f', background: '#f1edf8' },
  water_leak: { foreground: '#307ba7', background: '#e9f5fc' },
  smoke: { foreground: '#b45b54', background: '#fcedeb' },
  carbon_monoxide: { foreground: '#3d719f', background: '#edf3f9' },
  air_quality: { foreground: '#3d719f', background: '#edf3f9' },
  illuminance: { foreground: '#957115', background: '#fff7d9' },
  camera: { foreground: '#3d719f', background: '#edf3f9' },
};

const sensorPhotoModels = [
  {
    brand: 'THIRDREALITY',
    model: '3RPL01084Z',
    aliases: ['SMARTPRESENCESENSORR3', 'MULTIFUNCTIONSMARTPRESENCESENSORR3'],
  },
  { brand: 'THIRDREALITY', model: '3RDS17BZ', aliases: ['DOORSENSOR'] },
  { brand: 'THIRDREALITY', model: '3RMS16BZ', aliases: ['WIRELESSMOTIONSENSOR'] },
  { brand: 'THIRDREALITY', model: '3RTHS0224Z', aliases: ['TEMPERATUREANDHUMIDITYSENSORLITE'] },
  { brand: 'THIRDREALITY', model: '3RWS18BZ', aliases: [] },
  { brand: 'THIRDREALITY', model: '3RSPE01044BZ', aliases: [] },
  { brand: 'THIRDREALITY', model: '3RSB22BZ', aliases: [] },
  { brand: 'HEIMAN', model: 'HS2FD-EF1-3.0', aliases: [] },
  { brand: 'HEIMAN', model: 'HS1SA-E', aliases: [] },
  { brand: 'SONOFF', model: 'SNZB-02P', aliases: [] },
  { brand: 'NODON', model: 'SDO-4-1-00', aliases: [] },
  { brand: 'NODON', model: 'STPH-4-1-00', aliases: [] },
  { brand: 'NODON', model: 'SDC-4-1-00', aliases: [] },
  { brand: 'NODON', model: 'SEM-4-1-00', aliases: [] },
  {
    brand: 'TUYA',
    model: 'TS0601_bed_presence_sensor',
    aliases: ['PRESSURESENSINGSTRAPBEDOCCUPANCYSENSOR', 'TZE200SEQ9CM6U'],
  },
];

const sensorPhotoAssets: Record<string, ImageSourcePropType> = {
  '3RPL01084Z': image3RPL01084Z,
  '3RDS17BZ': image3RDS17BZ,
  '3RMS16BZ': image3RMS16BZ,
  '3RTHS0224Z': image3RTHS0224Z,
  '3RWS18BZ': image3RWS18BZ,
  '3RSPE01044BZ': image3RSPE01044BZ,
  '3RSB22BZ': image3RSB22BZ,
  'HS2FD-EF1-3.0': imageHS2FDE,
  'HS1SA-E': imageHS1SAE,
  'SNZB-02P': imageSNZB02P,
  'SDO-4-1-00': imageSDO4100,
  'STPH-4-1-00': imageSTPH4100,
  'SDC-4-1-00': imageSDC4100,
  'SEM-4-1-00': imageSEM4100,
  TS0601_bed_presence_sensor: imageTuyaBedPressure,
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
  STORAGE: ['Rangement', 'Storage'],
  OTHER: ['Autre', 'Other'],
};

const sensorTone = { foreground: '#3d719f', background: '#edf3f9' };

function roomIcon(room: Pick<PlanRoom, 'kind' | 'name'>): IconComponent {
  if (room.kind !== 'OTHER' && roomIcons[room.kind]) return roomIcons[room.kind];
  const name = room.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/salon|sejour/.test(name)) return Sofa;
  if (/cuisine/.test(name)) return CookingPot;
  if (/chambre/.test(name)) return BedDouble;
  if (/salle de bain|sdb|douche/.test(name)) return Bath;
  if (/toilette|\bwc\b/.test(name)) return Toilet;
  if (/entree|vestibule/.test(name)) return DoorOpen;
  if (/couloir|degagement|palier/.test(name)) return Footprints;
  if (/salle a manger/.test(name)) return Utensils;
  if (/garage/.test(name)) return Warehouse;
  if (/jardin/.test(name)) return Trees;
  if (/terrasse|balcon/.test(name)) return Sun;
  if (/cagibi|cellier|rangement|placard|reserve/.test(name)) return Boxes;
  return Home;
}

function roomKindLabel(kind: string, locale: Locale) {
  return roomLabels[kind]?.[locale === 'fr' ? 0 : 1] ?? kind;
}

function sensorDevicePhotoModel(device: SensorDevice) {
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const manufacturer = normalize(device.manufacturer ?? '');
  const model = device.model?.trim() ?? '';
  const normalizedModel = normalize(model);
  if (!normalizedModel) return null;
  if (isBedOccupancySensorModel(model)) return 'TS0601_bed_presence_sensor';
  const product = sensorPhotoModels.find((candidate) => {
    const candidateBrand = normalize(candidate.brand);
    const brandMatches =
      !manufacturer ||
      candidateBrand === manufacturer ||
      manufacturer.includes(candidateBrand) ||
      candidateBrand.includes(manufacturer);
    const expected = normalize(candidate.model);
    const modelMatches =
      normalizedModel === expected ||
      normalizedModel.includes(expected) ||
      expected.includes(normalizedModel);
    return (
      modelMatches ||
      (brandMatches && candidate.aliases.some((alias) => normalizedModel.includes(alias)))
    );
  });
  const sonoffTemperatureSensor =
    manufacturer === 'SONOFF' &&
    ['SNZB02P', 'TEMPERATUREANDHUMIDITYSENSOR'].includes(normalizedModel) &&
    device.capabilities.some(({ capability }) => capability === 'temperature') &&
    device.capabilities.some(({ capability }) => capability === 'humidity');
  const imageModel = product?.model ?? (sonoffTemperatureSensor ? 'SNZB-02P' : null);
  return imageModel;
}

function sensorDevicePhotoUrl(device: SensorDevice, imageBaseUrl: string) {
  const imageModel = sensorDevicePhotoModel(device);
  if (!imageModel) return null;
  try {
    return new URL(`/sensor-products/${imageModel}.png`, imageBaseUrl).toString();
  } catch {
    return null;
  }
}

function placementMatchesDevice(placement: HomePlan['placements'][number], device: SensorDevice) {
  return placement.equipmentRefKind === 'DEVICE'
    ? placement.equipmentId === device.id
    : device.capabilities.some(({ sensorId }) => sensorId === placement.equipmentId);
}

function roomDevices(plan: HomePlan, roomId: string, devices: SensorDevice[]) {
  const placements = plan.placements.filter(
    (placement) => placement.roomId === roomId && placement.kind === 'SENSOR',
  );
  const stairPlacements = plan.placements.filter(
    (placement) => placement.kind === 'SENSOR' && placement.targetType === 'STAIR',
  );
  return devices.filter(
    (device) =>
      !stairPlacements.some((placement) => placementMatchesDevice(placement, device)) &&
      (device.room?.id === roomId ||
        (!device.room &&
          placements.some((placement) => placementMatchesDevice(placement, device)))),
  );
}

function roomSensorCount(plan: HomePlan, roomId: string, devices: SensorDevice[]) {
  const placements = plan.placements.filter(
    (placement) =>
      placement.roomId === roomId &&
      placement.kind === 'SENSOR' &&
      placement.targetType !== 'STAIR',
  );
  const stairPlacements = plan.placements.filter(
    (placement) => placement.kind === 'SENSOR' && placement.targetType === 'STAIR',
  );
  return devices.filter(
    (device) =>
      !stairPlacements.some((placement) => placementMatchesDevice(placement, device)) &&
      (device.room?.id === roomId ||
        placements.some((placement) => placementMatchesDevice(placement, device))),
  ).length;
}

function devicesForCategory(
  plan: HomePlan,
  roomId: string,
  devices: SensorDevice[],
  category: RoomSensorCategory,
) {
  const assigned = roomDevices(plan, roomId, devices);
  return assigned.filter((device) => deviceSupportsCategory(device, category));
}

function sensorCountForStair(plan: HomePlan, stairId: string, devices: SensorDevice[]) {
  const placements = plan.placements.filter(
    (placement) =>
      placement.kind === 'SENSOR' &&
      placement.targetType === 'STAIR' &&
      placement.targetId === stairId,
  );
  return devices.filter((device) =>
    placements.some((placement) => placementMatchesDevice(placement, device)),
  ).length;
}

function mainEntranceDevices(plan: HomePlan, roomId: string, devices: SensorDevice[]) {
  const opening = plan.levels
    .flatMap(({ openings }) => openings)
    .find(({ isMainEntrance, roomIds }) => isMainEntrance && roomIds.includes(roomId));
  const placements = plan.placements.filter(
    (placement) =>
      placement.kind === 'SENSOR' &&
      placement.roomId === roomId &&
      ((opening && placement.targetType === 'OPENING' && placement.targetId === opening.id) ||
        (placement.capabilityBindings ?? []).some(({ role }) => role === 'MAIN_ENTRANCE')),
  );
  return devices.filter(
    (device) =>
      deviceSupportsCategory(device, 'contact') &&
      placements.some((placement) => placementMatchesDevice(placement, device)),
  );
}

function deviceStatus(device: SensorDevice, locale: Locale) {
  const primary = device.capabilities.filter(({ primary }) => primary);
  const capabilities = primary.length ? primary : device.capabilities;
  const statuses = capabilities.map(({ status }) => status);
  if (!device.enabled || !statuses.length || statuses.every((status) => status === 'OFFLINE'))
    return locale === 'fr' ? 'Hors ligne' : 'Offline';
  if (statuses.some((status) => ['DEGRADED', 'OFFLINE', 'UNKNOWN'].includes(status)))
    return locale === 'fr' ? 'À vérifier' : 'Needs checking';
  return locale === 'fr' ? 'En ligne' : 'Online';
}

function deviceReading(device: SensorDevice, category: RoomSensorCategory, locale: Locale) {
  const matchesCategory = (capability: string) =>
    category === 'presence'
      ? ['person_presence', 'occupancy'].includes(capability)
      : category === 'motion'
        ? ['motion', 'occupancy'].includes(capability)
        : category === 'contact' || category === 'bed'
          ? category === 'bed'
            ? ['contact', 'dry_contact'].includes(capability) ||
              (capability === 'occupancy' && isBedOccupancySensorModel(device.model))
            : ['contact', 'dry_contact'].includes(capability)
          : category === 'air_quality'
            ? ['co2', 'pm25', 'voc', 'total_volatile_organic_compounds', 'air_quality'].includes(
                capability,
              )
            : category === 'shower'
              ? capability === 'humidity'
              : capability === category;
  const capability = device.capabilities.find(
    (item) => matchesCategory(item.capability) && item.value !== null,
  );
  if (!capability?.value) return deviceStatus(device, locale);
  const value = capability.value;
  if (typeof value.value === 'number') {
    const number = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en', {
      maximumFractionDigits: 1,
    }).format(value.value);
    return `${number}${capability.unit ? ` ${capability.unit}` : ''}`;
  }
  const active =
    typeof value.open === 'boolean'
      ? value.open
      : typeof value.active === 'boolean'
        ? value.active
        : typeof value.value === 'boolean'
          ? value.value
          : undefined;
  if (active !== undefined) {
    if (category === 'contact')
      return locale === 'fr' ? (active ? 'Ouvert' : 'Fermé') : active ? 'Open' : 'Closed';
    if (category === 'bed' && capability.capability === 'occupancy')
      return locale === 'fr' ? (active ? 'Occupé' : 'Libre') : active ? 'Occupied' : 'Unoccupied';
    return active ? (locale === 'fr' ? 'Détecté' : 'Detected') : '—';
  }
  return deviceStatus(device, locale);
}

function deviceLastSeen(device: SensorDevice, locale: Locale) {
  const lastSeenAt =
    device.capabilities.find(({ value }) => value !== null)?.lastSeenAt ??
    device.capabilities.find(({ lastSeenAt: seenAt }) => seenAt)?.lastSeenAt ??
    device.lastSeenAt;
  if (!lastSeenAt) return null;
  const date = new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MobileHomePlanPanel({
  plan,
  sensorDevices,
  cameras,
  imageBaseUrl,
  loading,
  error,
  locale,
  onRefresh,
  onRoomDetailChange,
}: {
  plan?: HomePlan;
  sensorDevices?: SensorDevice[];
  cameras: CameraItem[];
  imageBaseUrl: string;
  loading: boolean;
  error: boolean;
  locale: Locale;
  onRefresh: () => void;
  onRoomDetailChange: (isOpen: boolean) => void;
}) {
  const fr = locale === 'fr';
  const devices = sensorDevices ?? [];
  const sortedLevels = useMemo(
    () => [...(plan?.levels ?? [])].sort((a, b) => a.order - b.order),
    [plan?.levels],
  );
  const [levelId, setLevelId] = useState<string | null>(null);
  const [showStairs, setShowStairs] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [category, setCategory] = useState<RoomSensorCategory | null>(null);
  const floor = sortedLevels.find(({ id }) => id === levelId) ?? sortedLevels[0];
  const selectedRoom = plan?.levels.flatMap(({ rooms }) => rooms).find(({ id }) => id === roomId);
  const roomFloor = plan?.levels.find(({ rooms }) => rooms.some(({ id }) => id === roomId));

  useEffect(() => {
    if (!sortedLevels.length) return;
    if (!sortedLevels.some(({ id }) => id === levelId)) setLevelId(sortedLevels[0].id);
    if (roomId && !plan?.levels.some(({ rooms }) => rooms.some(({ id }) => id === roomId))) {
      setRoomId(null);
      setCategory(null);
      onRoomDetailChange(false);
    }
  }, [levelId, onRoomDetailChange, plan, roomId, sortedLevels]);

  const openRoom = (nextRoomId: string) => {
    setRoomId(nextRoomId);
    setCategory(null);
    onRoomDetailChange(true);
  };
  const closeRoom = () => {
    setRoomId(null);
    setCategory(null);
    onRoomDetailChange(false);
  };

  if (loading && !plan) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#15536a" />
        <Text style={styles.emptyText}>{fr ? 'Chargement des niveaux…' : 'Loading floors…'}</Text>
      </View>
    );
  }
  if (error && !plan) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>
          {fr
            ? 'Les informations du logement sont indisponibles.'
            : 'Home information is unavailable.'}
        </Text>
        <Pressable onPress={onRefresh} style={styles.retryButton}>
          <Text style={styles.retryText}>{fr ? 'Réessayer' : 'Try again'}</Text>
        </Pressable>
      </View>
    );
  }
  if (!plan || !sortedLevels.length) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>
          {fr
            ? 'Aucun niveau n’est renseigné pour ce logement.'
            : 'No floors have been added to this home.'}
        </Text>
      </View>
    );
  }

  if (selectedRoom && roomFloor) {
    const cameraCount = cameras.filter(
      ({ room: cameraRoom }) => cameraRoom?.id === selectedRoom.id,
    ).length;
    const visibleCategories = visibleRoomCategories(
      selectedRoom.kind,
      selectedRoom.sensorPreferences,
      ROOM_SENSOR_CATEGORIES.filter(({ id }) =>
        id === 'camera'
          ? cameraCount > 0
          : devicesForCategory(plan, selectedRoom.id, devices, id).length > 0,
      ).map(({ id }) => id),
    );
    const entranceDevices = mainEntranceDevices(plan, selectedRoom.id, devices);
    const configuredCategories = visibleCategories.filter((id) =>
      id === 'camera'
        ? cameraCount > 0
        : devicesForCategory(plan, selectedRoom.id, devices, id).length > 0,
    );
    const totalSensorCount = sensorDevices ? roomSensorCount(plan, selectedRoom.id, devices) : null;
    const selectedDefinition = category
      ? ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category)
      : undefined;
    const categoryDevices = category
      ? devicesForCategory(plan, selectedRoom.id, devices, category)
      : [];
    const categoryCameras =
      category === 'camera' ? cameras.filter(({ room }) => room?.id === selectedRoom.id) : [];

    if (category && selectedDefinition) {
      const Icon = categoryIcons[category];
      return (
        <View style={styles.detailPage}>
          <Pressable onPress={() => setCategory(null)} style={styles.backButton}>
            <ArrowLeft size={17} color="#15536a" strokeWidth={2} />
            <Text style={styles.backText}>
              {fr ? 'Retour aux capteurs de la pièce' : 'Back to room sensors'}
            </Text>
          </Pressable>
          <View style={styles.categoryDetailHeading}>
            <View
              style={[
                styles.categoryIcon,
                { backgroundColor: categoryColors[category].background },
              ]}
            >
              <Icon size={22} color={categoryColors[category].foreground} strokeWidth={1.8} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>{selectedRoom.name}</Text>
              <Text style={styles.roomTitle}>{selectedDefinition[fr ? 'label' : 'labelEn']}</Text>
              <Text style={styles.categoryDescription}>
                {selectedDefinition[fr ? 'description' : 'descriptionEn']}
              </Text>
            </View>
          </View>
          {category === 'camera' && categoryCameras.length ? (
            categoryCameras.map((camera) => (
              <View key={camera.id} style={styles.deviceRow}>
                <View style={styles.devicePhotoFrame}>
                  <Camera size={23} color="#3d719f" strokeWidth={1.8} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.deviceName}>{camera.name}</Text>
                  <Text style={styles.deviceMeta}>
                    {camera.provider} ·{' '}
                    {camera.status === 'ONLINE'
                      ? fr
                        ? 'En ligne'
                        : 'Online'
                      : fr
                        ? 'À vérifier'
                        : 'Needs checking'}
                  </Text>
                </View>
              </View>
            ))
          ) : categoryDevices.length ? (
            categoryDevices.map((device) => {
              const status = deviceStatus(device, locale);
              const online = status === (fr ? 'En ligne' : 'Online');
              const needsChecking = status === (fr ? 'À vérifier' : 'Needs checking');
              const statusStyle = online
                ? styles.deviceStatusOnline
                : needsChecking
                  ? styles.deviceStatusAttention
                  : styles.deviceStatusOffline;
              const lastSeen = deviceLastSeen(device, locale);
              return (
                <View key={device.id} style={styles.deviceCard}>
                  <View style={styles.deviceHero}>
                    <DevicePhoto device={device} imageBaseUrl={imageBaseUrl} large />
                    <View style={[styles.deviceSummary, styles.flex]}>
                      <Text style={styles.deviceName}>{device.name}</Text>
                      <Text style={styles.deviceModel}>
                        {[device.manufacturer, device.model].filter(Boolean).join(' · ') ||
                          (fr ? 'Modèle non indiqué' : 'Model not reported')}
                      </Text>
                      <View style={[styles.deviceStatusBadge, statusStyle]}>
                        <Text style={styles.deviceStatusText}>{status}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.deviceReadingCard}>
                    <Text style={styles.deviceReadingLabel}>
                      {selectedDefinition[fr ? 'label' : 'labelEn']}
                    </Text>
                    <Text style={styles.deviceReadingValue}>
                      {deviceReading(device, category, locale)}
                    </Text>
                  </View>
                  <View style={styles.deviceInfoList}>
                    {device.placementNote ? (
                      <View style={styles.deviceInfoRow}>
                        <Text style={styles.deviceInfoLabel}>
                          {fr ? 'Emplacement' : 'Placement'}
                        </Text>
                        <Text style={styles.deviceInfoValue}>{device.placementNote}</Text>
                      </View>
                    ) : null}
                    {device.batteryPercent !== null ? (
                      <View style={styles.deviceInfoRow}>
                        <Text style={styles.deviceInfoLabel}>{fr ? 'Batterie' : 'Battery'}</Text>
                        <Text style={styles.deviceInfoValue}>{device.batteryPercent} %</Text>
                      </View>
                    ) : null}
                    {lastSeen ? (
                      <View style={styles.deviceInfoRow}>
                        <Text style={styles.deviceInfoLabel}>
                          {fr ? 'Dernier signal' : 'Last signal'}
                        </Text>
                        <Text style={styles.deviceInfoValue}>{lastSeen}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {sensorDevices
                  ? fr
                    ? 'Aucun capteur associé à cette catégorie.'
                    : 'No sensor is assigned to this category.'
                  : fr
                    ? 'Les capteurs sont en cours de chargement.'
                    : 'Sensors are loading.'}
              </Text>
            </View>
          )}
        </View>
      );
    }

    return (
      <View style={styles.detailPage}>
        <Pressable onPress={closeRoom} style={styles.backButton}>
          <ArrowLeft size={17} color="#15536a" strokeWidth={2} />
          <Text style={styles.backText}>{fr ? 'Retour au logement' : 'Back to home'}</Text>
        </Pressable>
        <View style={styles.roomHeading}>
          <Text style={styles.eyebrow}>
            {roomKindLabel(selectedRoom.kind, locale)} · {roomFloor.name}
          </Text>
          <Text style={styles.roomTitle}>{selectedRoom.name}</Text>
          <View style={styles.roomMetaRow}>
            {selectedRoom.areaM2 != null && (
              <Text style={styles.roomMeta}>
                {selectedRoom.areaM2.toLocaleString(fr ? 'fr-FR' : 'en')} m²
              </Text>
            )}
            <Text style={styles.roomMeta}>
              {totalSensorCount === null
                ? '—'
                : fr
                  ? `${totalSensorCount} capteur${totalSensorCount !== 1 ? 's' : ''} associé${totalSensorCount !== 1 ? 's' : ''}`
                  : `${totalSensorCount} sensor${totalSensorCount !== 1 ? 's' : ''} assigned`}
            </Text>
          </View>
        </View>
        <View style={styles.sectionHeading}>
          <View style={styles.flex}>
            <Text style={styles.subheading}>
              {fr ? 'Les capteurs de la pièce' : 'Room sensors'}
            </Text>
            <Text style={styles.sectionDescription}>
              {fr ? 'Choisissez ce que vous souhaitez suivre.' : 'Choose what you want to monitor.'}
            </Text>
          </View>
          <Text style={styles.sectionCount}>
            {sensorDevices ? configuredCategories.length + (entranceDevices.length ? 1 : 0) : '—'}
          </Text>
        </View>
        <View style={styles.categoryList}>
          {entranceDevices.length > 0 && (
            <SensorCategoryCard
              label={fr ? 'Ouverture principale' : 'Main entrance'}
              description={fr ? 'La porte de sortie du logement' : 'The door leading outside'}
              count={entranceDevices.length}
              icon={DoorOpen}
              tone={sensorTone}
              locale={locale}
              onPress={() => setCategory('contact')}
            />
          )}
          {configuredCategories.map((id) => {
            const definition = ROOM_SENSOR_CATEGORIES.find(
              ({ id: categoryId }) => categoryId === id,
            )!;
            const items = devicesForCategory(plan, selectedRoom.id, devices, id);
            return (
              <SensorCategoryCard
                key={id}
                label={definition[fr ? 'label' : 'labelEn']}
                description={
                  id === 'camera'
                    ? cameraCount === 1
                      ? cameras.find(({ room }) => room?.id === selectedRoom.id)?.name
                      : definition[fr ? 'description' : 'descriptionEn']
                    : items.length === 1
                      ? items[0].name
                      : definition[fr ? 'description' : 'descriptionEn']
                }
                count={id === 'camera' ? cameraCount : sensorDevices ? items.length : null}
                icon={categoryIcons[id]}
                tone={categoryColors[id]}
                locale={locale}
                onPress={() => setCategory(id)}
              />
            );
          })}
          {!configuredCategories.length && !entranceDevices.length && (
            <View style={styles.emptyCard}>
              {sensorDevices ? null : <ActivityIndicator color="#15536a" />}
              <Text style={styles.emptyText}>
                {sensorDevices
                  ? fr
                    ? 'Aucun capteur n’est configuré pour cette pièce.'
                    : 'No sensors are configured for this room.'
                  : fr
                    ? 'Chargement des capteurs…'
                    : 'Loading sensors…'}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  const activeStairs = sortedLevels.flatMap((level) =>
    level.stairs.map((stair) => ({ stair, level })),
  );
  const roomById = new Map(
    plan.levels.flatMap(({ rooms }) => rooms).map((room) => [room.id, room] as const),
  );
  const levelById = new Map(plan.levels.map((level) => [level.id, level] as const));
  const visibleRooms = floor?.rooms ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.levelTabsHeading}>
        <Text style={styles.eyebrow}>{fr ? 'NIVEAUX DU LOGEMENT' : 'HOME LEVELS'}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.levelTabs}
      >
        {sortedLevels.map((level) => (
          <Pressable
            key={level.id}
            accessibilityRole="button"
            accessibilityState={{ selected: !showStairs && floor?.id === level.id }}
            onPress={() => {
              setShowStairs(false);
              setLevelId(level.id);
            }}
            style={[
              styles.levelBadge,
              !showStairs && floor?.id === level.id && styles.levelBadgeActive,
            ]}
          >
            <Text
              style={[
                styles.levelBadgeText,
                !showStairs && floor?.id === level.id && styles.levelBadgeTextActive,
              ]}
            >
              {level.name}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: showStairs }}
          onPress={() => setShowStairs(true)}
          style={[styles.levelBadge, showStairs && styles.levelBadgeActive]}
        >
          <ChartNoAxesCombined
            size={16}
            color={showStairs ? '#15536a' : '#667384'}
            strokeWidth={1.9}
          />
          <Text style={[styles.levelBadgeText, showStairs && styles.levelBadgeTextActive]}>
            {fr ? 'Escaliers' : 'Stairs'}
          </Text>
        </Pressable>
      </ScrollView>

      <View style={styles.sectionHeading}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>
            {showStairs
              ? fr
                ? 'PASSAGE ENTRE LES NIVEAUX'
                : 'BETWEEN LEVELS'
              : fr
                ? 'PIÈCE PAR PIÈCE'
                : 'ROOM BY ROOM'}
          </Text>
          <Text style={styles.subheading}>
            {showStairs
              ? fr
                ? 'Les escaliers du logement'
                : 'Stairs in this home'
              : fr
                ? 'Le détail de ce niveau'
                : 'Details for this level'}
          </Text>
        </View>
        <Text style={styles.sectionCount}>
          {showStairs
            ? `${activeStairs.length} ${fr ? `escalier${activeStairs.length > 1 ? 's' : ''}` : `stair${activeStairs.length === 1 ? '' : 's'}`}`
            : `${visibleRooms.length} ${fr ? 'pièces' : 'rooms'}`}
        </Text>
      </View>

      {showStairs ? (
        activeStairs.length ? (
          <View style={styles.roomList}>
            {activeStairs.map(({ stair }) => {
              const fromRoom = roomById.get(stair.fromRoomId);
              const toRoom = roomById.get(stair.toRoomId);
              const fromLevel = levelById.get(stair.fromFloorId);
              const toLevel = levelById.get(stair.toFloorId);
              const count = sensorDevices ? sensorCountForStair(plan, stair.id, devices) : null;
              return (
                <View key={stair.id} style={styles.roomCard}>
                  <View style={styles.stairIcon}>
                    <ChartNoAxesCombined size={20} color="#176078" strokeWidth={1.8} />
                  </View>
                  <View style={styles.roomCopy}>
                    <Text style={styles.roomName} numberOfLines={2}>
                      {fr ? 'Escalier' : 'Stairs'} · {fromRoom?.name ?? '—'} ↔ {toRoom?.name ?? '—'}
                    </Text>
                    <Text style={styles.roomSubline} numberOfLines={1}>
                      {fromLevel?.name ?? '—'} → {toLevel?.name ?? '—'}
                    </Text>
                    <Text style={styles.roomSensorCount}>
                      {count ?? '—'}{' '}
                      {fr ? 'capteurs · Mouvement et présence' : 'sensors · Motion and presence'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <ChartNoAxesCombined size={25} color="#2c7185" strokeWidth={1.8} />
            <Text style={styles.emptyText}>
              {fr
                ? 'Aucun escalier n’est encore défini dans le logement.'
                : 'No stairs have been added to this home yet.'}
            </Text>
          </View>
        )
      ) : visibleRooms.length ? (
        <View style={styles.roomList}>
          {visibleRooms.map((room) => {
            const Icon = roomIcon(room);
            const count = sensorDevices ? roomSensorCount(plan, room.id, devices) : null;
            return (
              <Pressable
                key={room.id}
                accessibilityRole="button"
                onPress={() => openRoom(room.id)}
                style={({ pressed }) => [styles.roomCard, pressed && styles.roomCardPressed]}
              >
                <View style={[styles.roomIcon, { backgroundColor: room.geometry.color }]}>
                  <Icon size={19} color="#173e64" strokeWidth={1.8} />
                </View>
                <View style={styles.roomCopy}>
                  <Text style={styles.roomName} numberOfLines={1}>
                    {room.name}
                  </Text>
                  <Text style={styles.roomSubline} numberOfLines={1}>
                    {roomKindLabel(room.kind, locale)}
                    {room.areaM2 != null
                      ? ` · ${room.areaM2.toLocaleString(fr ? 'fr-FR' : 'en')} m²`
                      : ''}
                  </Text>
                  <Text style={styles.roomSensorCount}>
                    {count ?? '—'}{' '}
                    {fr ? `capteur${count === 1 ? '' : 's'}` : `sensor${count === 1 ? '' : 's'}`}
                  </Text>
                </View>
                <ChevronRight size={18} color="#84909d" />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {fr
              ? 'Aucune pièce n’est renseignée à ce niveau.'
              : 'No rooms are listed on this level.'}
          </Text>
        </View>
      )}
    </View>
  );
}

function DevicePhoto({
  device,
  imageBaseUrl,
  large = false,
}: {
  device: SensorDevice;
  imageBaseUrl: string;
  large?: boolean;
}) {
  const photoModel = sensorDevicePhotoModel(device);
  const localPhoto = photoModel ? sensorPhotoAssets[photoModel] : undefined;
  const remotePhoto = sensorDevicePhotoUrl(device, imageBaseUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoModel, remotePhoto]);
  const photo = failed ? null : (localPhoto ?? (remotePhoto ? { uri: remotePhoto } : null));
  return (
    <View style={large ? styles.devicePhotoFrameLarge : styles.devicePhotoFrame}>
      {photo ? (
        <Image
          accessibilityLabel={`${device.manufacturer ?? ''} ${device.model ?? device.name}`.trim()}
          source={photo}
          resizeMode="contain"
          onError={() => setFailed(true)}
          style={large ? styles.devicePhotoLarge : styles.devicePhoto}
        />
      ) : (
        <Text style={styles.devicePhotoFallback}>
          {(device.manufacturer?.slice(0, 2) ?? device.name.slice(0, 2)).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function SensorCategoryCard({
  label,
  description,
  count,
  icon: Icon,
  tone,
  locale,
  onPress,
}: {
  label: string;
  description?: string;
  count: number | null;
  icon: IconComponent;
  tone: { foreground: string; background: string };
  locale: Locale;
  onPress: () => void;
}) {
  const configured = (count ?? 0) > 0;
  const fr = locale === 'fr';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.categoryCard,
        configured && styles.categoryCardConfigured,
        pressed && styles.categoryCardPressed,
      ]}
    >
      <View style={[styles.categoryIcon, { backgroundColor: tone.background }]}>
        <Icon size={22} color={tone.foreground} strokeWidth={1.8} />
      </View>
      <View style={styles.categoryCopy}>
        <Text style={styles.categoryTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.categoryDescription} numberOfLines={2}>
          {description ?? ''}
        </Text>
        <Text style={[styles.categoryStatus, configured && styles.categoryStatusConfigured]}>
          {count === null
            ? fr
              ? 'Chargement…'
              : 'Loading…'
            : configured
              ? `${count} ${fr ? `capteur${count > 1 ? 's' : ''} · Configuré${count > 1 ? 's' : ''}` : `sensor${count === 1 ? '' : 's'} · Configured`}`
              : fr
                ? 'Non configuré'
                : 'Not configured'}
        </Text>
      </View>
      {configured ? (
        <CheckCircle2 size={17} color="#267256" />
      ) : (
        <ChevronRight size={18} color="#84909d" />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  loading: {
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#dfe5e7',
    borderRadius: 18,
    backgroundColor: '#fff',
    padding: 18,
  },
  levelTabsHeading: { paddingHorizontal: 2, paddingTop: 5 },
  eyebrow: { color: '#376884', fontSize: 9, letterSpacing: 1.15, fontWeight: '900' },
  levelTabs: { gap: 7, paddingVertical: 2, paddingRight: 20 },
  levelBadge: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#dbe3e5',
    borderRadius: 999,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  levelBadgeActive: { borderColor: '#2c7185', backgroundColor: '#eaf5f6' },
  levelBadgeText: { color: '#667384', fontSize: 13, fontWeight: '700' },
  levelBadgeTextActive: { color: '#15536a' },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 5,
  },
  flex: { flex: 1 },
  subheading: { marginTop: 3, color: '#12385f', fontSize: 18, fontWeight: '700' },
  sectionDescription: { marginTop: 5, color: '#6b7b89', fontSize: 13, lineHeight: 19 },
  sectionCount: { color: '#657587', fontSize: 12, fontWeight: '600', paddingBottom: 2 },
  roomList: { gap: 9 },
  roomCard: {
    minHeight: 82,
    padding: 12,
    borderWidth: 1,
    borderColor: '#dfe5e7',
    borderRadius: 16,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roomCardPressed: { borderColor: '#4792a0', backgroundColor: '#fbfefe' },
  roomIcon: {
    width: 46,
    height: 46,
    borderWidth: 1,
    borderColor: '#445b6a33',
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stairIcon: {
    width: 46,
    height: 46,
    borderWidth: 1,
    borderColor: '#d7e9ee',
    borderRadius: 13,
    backgroundColor: '#e7f4f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomCopy: { flex: 1, minWidth: 0 },
  roomName: { color: '#173e64', fontSize: 14, fontWeight: '700' },
  roomSubline: { marginTop: 3, color: '#657587', fontSize: 11 },
  roomSensorCount: { marginTop: 6, color: '#84909d', fontSize: 10, fontWeight: '700' },
  emptyCard: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#dfe5e7',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  emptyText: { color: '#657587', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: '#15536a',
  },
  retryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  detailPage: { gap: 14, paddingBottom: 5 },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 8,
  },
  backText: { color: '#15536a', fontSize: 13, fontWeight: '700' },
  roomHeading: {
    padding: 18,
    borderWidth: 1,
    borderColor: '#dfe5e7',
    borderRadius: 18,
    backgroundColor: '#fff',
  },
  roomTitle: {
    marginTop: 4,
    color: '#12385f',
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  roomMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 },
  roomMeta: { color: '#5b6e7c', fontSize: 11, fontWeight: '600' },
  categoryList: { gap: 9 },
  categoryCard: {
    minHeight: 91,
    padding: 13,
    borderWidth: 1,
    borderColor: '#dfe6ed',
    borderRadius: 17,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  categoryCardConfigured: { borderColor: '#b7d4d1' },
  categoryCardPressed: { backgroundColor: '#fbfefe', borderColor: '#a9c4d7' },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCopy: { flex: 1, minWidth: 0 },
  categoryTitle: { color: '#173e64', fontSize: 15, fontWeight: '700' },
  categoryDescription: { marginTop: 3, color: '#6b7b89', fontSize: 11, lineHeight: 15 },
  categoryStatus: { marginTop: 5, color: '#5b6e7c', fontSize: 10, fontWeight: '600' },
  categoryStatusConfigured: { color: '#267256' },
  categoryDetailHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 5,
  },
  deviceRow: {
    minHeight: 82,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#dfe5e7',
    borderRadius: 14,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deviceCard: {
    gap: 13,
    padding: 14,
    borderWidth: 1,
    borderColor: '#dfe5e7',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  deviceHero: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  deviceSummary: { gap: 4 },
  devicePhotoFrame: {
    width: 58,
    height: 58,
    flex: 0,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#e7edf1',
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  devicePhotoFrameLarge: {
    width: 88,
    height: 88,
    minWidth: 88,
    flex: 0,
    flexShrink: 0,
    padding: 7,
    borderWidth: 1,
    borderColor: '#d5e2e8',
    borderRadius: 16,
    backgroundColor: '#e6f0f4',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  devicePhoto: { width: '100%', height: '100%' },
  devicePhotoLarge: { width: '100%', height: '100%' },
  devicePhotoFallback: { color: '#527083', fontSize: 12, fontWeight: '700' },
  deviceName: { color: '#173e64', fontSize: 15, fontWeight: '700' },
  deviceModel: { color: '#657587', fontSize: 11, lineHeight: 16 },
  deviceMeta: { marginTop: 4, color: '#657587', fontSize: 10 },
  deviceStatusBadge: {
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  deviceStatusOnline: { backgroundColor: '#e7f4ed' },
  deviceStatusAttention: { backgroundColor: '#fff2dc' },
  deviceStatusOffline: { backgroundColor: '#fceceb' },
  deviceStatusText: { color: '#326b4e', fontSize: 10, fontWeight: '700' },
  deviceReadingCard: {
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#f2f6f8',
  },
  deviceReadingLabel: { color: '#657587', fontSize: 11, fontWeight: '600' },
  deviceReadingValue: { marginTop: 3, color: '#173e64', fontSize: 18, fontWeight: '700' },
  deviceInfoList: { gap: 7 },
  deviceInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  deviceInfoLabel: { color: '#657587', fontSize: 11 },
  deviceInfoValue: {
    flex: 1,
    color: '#173e64',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
});
