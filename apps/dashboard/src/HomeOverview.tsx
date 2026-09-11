import type {
  EquipmentCoverage,
  FloorLayout,
  HomePlan,
  PlanRoom,
  PresenceEstimate,
  SensorDevice,
} from '@michel/contracts';
import {
  AlertTriangle,
  ArrowRight,
  Bath,
  BedDouble,
  Boxes,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDot,
  CookingPot,
  DoorOpen,
  Droplets,
  Eye,
  Footprints,
  Home,
  Layers3,
  MapPin,
  Move,
  Plus,
  PlugZap,
  Radio,
  Ruler,
  ShieldCheck,
  Sofa,
  Sparkles,
  Sun,
  ThermometerSun,
  Toilet,
  Trees,
  Utensils,
  Warehouse,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SensorCoverageRecommendations } from './SensorCoverageRecommendations';

type HomeInfo = {
  name: string;
  type: string;
  address: string | null;
  floorCount: number;
};

type CameraItem = {
  id: string;
  name: string;
  status: string;
  privacyMode: boolean;
  room: { id: string; name: string } | null;
};

type Protocol = { id: string; available: boolean; native: boolean };
type CoverageStatus = 'COVERED' | 'PARTIAL' | 'NONE';

const emptyCoverage: EquipmentCoverage = {
  recommendations: [],
  profiles: [],
  summary: {
    main: [],
    optional: [],
    totals: { required: 0, covered: 0, toAdd: 0, optional: 0 },
    warnings: [],
  },
};

const roomKindLabels: Record<string, string> = {
  LIVING_ROOM: 'Salon',
  KITCHEN: 'Cuisine',
  BEDROOM: 'Chambre',
  BATHROOM: 'Salle de bain',
  TOILET: 'Toilettes',
  ENTRANCE: 'Entrée',
  HALLWAY: 'Couloir',
  DINING_ROOM: 'Salle à manger',
  OTHER: 'Autre',
};

const homeTypeLabels: Record<string, string> = {
  HOUSE: 'Maison',
  APARTMENT: 'Appartement',
  SENIOR_RESIDENCE: 'Résidence',
};

const roomIcons: Record<string, typeof Home> = {
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

export const roomIconKey = (room: Pick<PlanRoom, 'kind' | 'name'>) => {
  if (room.kind !== 'OTHER' && roomIcons[room.kind]) return room.kind;

  const name = room.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/salon|sejour/.test(name)) return 'LIVING_ROOM';
  if (/cuisine/.test(name)) return 'KITCHEN';
  if (/chambre/.test(name)) return 'BEDROOM';
  if (/salle de bain|sdb|douche/.test(name)) return 'BATHROOM';
  if (/toilette|\bwc\b/.test(name)) return 'TOILET';
  if (/entree|vestibule/.test(name)) return 'ENTRANCE';
  if (/couloir|degagement|palier/.test(name)) return 'HALLWAY';
  if (/salle a manger/.test(name)) return 'DINING_ROOM';
  if (/garage/.test(name)) return 'GARAGE';
  if (/jardin/.test(name)) return 'GARDEN';
  if (/terrasse|balcon/.test(name)) return 'TERRACE';
  if (/cagibi|cellier|rangement|placard|reserve/.test(name)) return 'STORAGE';
  return 'OTHER';
};

const roomIcon = (room: Pick<PlanRoom, 'kind' | 'name'>) =>
  roomIconKey(room) === 'STORAGE' ? Boxes : (roomIcons[roomIconKey(room)] ?? Home);

export const roomAreaM2 = (room: PlanRoom) =>
  room.areaM2 ??
  Math.abs(
    room.geometry.points.reduce((sum, point, index) => {
      const next = room.geometry.points[(index + 1) % room.geometry.points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  ) / 10_000;

const deviceState = (device: SensorDevice): 'ONLINE' | 'DEGRADED' | 'OFFLINE' => {
  const states = device.capabilities.map(({ status }) => status);
  if (!device.enabled || !states.length || states.every((status) => status === 'OFFLINE'))
    return 'OFFLINE';
  if (
    states.some((status) => status === 'DEGRADED' || status === 'OFFLINE' || status === 'UNKNOWN')
  )
    return 'DEGRADED';
  return 'ONLINE';
};

const capabilityCategory = (capability: string) => {
  const value = capability.toLowerCase();
  if (['presence', 'occupancy', 'motion'].some((part) => value.includes(part))) return 'presence';
  if (['temperature', 'humidity'].some((part) => value.includes(part))) return 'climate';
  if (['water_leak', 'moisture', 'leak'].some((part) => value.includes(part))) return 'water';
  if (['power', 'energy', 'switch'].some((part) => value.includes(part))) return 'electric';
  if (['contact', 'door'].some((part) => value.includes(part))) return 'entrance';
  return null;
};

export function getCoverageStatus(
  category: string,
  plan: HomePlan,
  devices: SensorDevice[],
  coverage: EquipmentCoverage,
): CoverageStatus {
  const placedIds = new Set(
    plan.placements.filter(({ kind }) => kind === 'SENSOR').map(({ equipmentId }) => equipmentId),
  );
  const placedCapabilities = devices
    .filter((device) => placedIds.has(device.id) || Boolean(device.room))
    .flatMap(({ capabilities }) => capabilities.map(({ capability }) => capability));
  const matching = coverage.recommendations.filter(
    (recommendation) => capabilityCategory(recommendation.capability) === category,
  );
  const fulfilled = matching.filter(({ fulfilledByPlacementId }) =>
    Boolean(fulfilledByPlacementId),
  );
  const directCount = placedCapabilities.filter(
    (capability) => capabilityCategory(capability) === category,
  ).length;

  if (category === 'entrance') {
    const mainEntranceId = plan.understanding.mainEntranceOpeningId;
    const mainEntranceCovered = plan.placements.some(
      (placement) =>
        placement.kind === 'SENSOR' &&
        placement.targetType === 'OPENING' &&
        placement.targetId === mainEntranceId,
    );
    if (mainEntranceCovered || fulfilled.length > 0) return 'COVERED';
    return directCount > 0 ? 'PARTIAL' : 'NONE';
  }
  if (matching.length > 0) {
    if (fulfilled.length === matching.length) return 'COVERED';
    if (fulfilled.length > 0 || directCount > 0) return 'PARTIAL';
    return 'NONE';
  }
  return directCount > 0 ? 'COVERED' : 'NONE';
}

export function summarizeHome(plan: HomePlan, devices: SensorDevice[], cameras: CameraItem[]) {
  const rooms = plan.levels.flatMap((level) => level.rooms);
  const area = plan.understanding.levels.length
    ? plan.understanding.levels.reduce((sum, level) => sum + level.areaM2, 0)
    : rooms.reduce((sum, room) => sum + roomAreaM2(room), 0);
  const approximate = plan.understanding.levels.length
    ? plan.understanding.levels.some((level) => level.approximate)
    : plan.levels.some(({ scaleCmPerUnit }) => scaleCmPerUnit === null);
  const states = devices.map(deviceState);
  const online = states.filter((state) => state === 'ONLINE').length;
  const degraded = states.filter((state) => state === 'DEGRADED').length;
  const offline = states.filter((state) => state === 'OFFLINE').length;
  const onlineCameras = cameras.filter(({ status }) => status === 'ONLINE').length;
  return {
    levels: plan.levels.length,
    rooms: rooms.length,
    area,
    approximate,
    physicalDevices: new Set(
      devices.map((device) => device.physicalDeviceId).filter((id): id is string => Boolean(id)),
    ).size,
    online,
    degraded,
    offline,
    onlineCameras,
    activeEquipment: online + degraded + onlineCameras,
  };
}

const points = (room: PlanRoom) => room.geometry.points.map(({ x, y }) => `${x},${y}`).join(' ');

type Offset = { x: number; y: number };

const roomBounds = (room: PlanRoom) => {
  const xs = room.geometry.points.map(({ x }) => x);
  const ys = room.geometry.points.map(({ y }) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

const roomCenter = (room: PlanRoom) => {
  const box = roomBounds(room);
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
};

const targetOffsetAtOpening = (
  host: PlanRoom,
  target: PlanRoom,
  opening: FloorLayout['openings'][number],
  hostOffset: Offset,
): Offset => {
  const hostBox = roomBounds(host);
  const targetBox = roomBounds(target);
  const side = [
    { id: 'LEFT', distance: Math.abs(opening.x - hostBox.minX) },
    { id: 'RIGHT', distance: Math.abs(opening.x - hostBox.maxX) },
    { id: 'TOP', distance: Math.abs(opening.y - hostBox.minY) },
    { id: 'BOTTOM', distance: Math.abs(opening.y - hostBox.maxY) },
  ].sort((left, right) => left.distance - right.distance)[0]!.id;

  if (side === 'LEFT')
    return {
      x: hostBox.minX + hostOffset.x - targetBox.maxX,
      y: hostOffset.y,
    };
  if (side === 'RIGHT')
    return {
      x: hostBox.maxX + hostOffset.x - targetBox.minX,
      y: hostOffset.y,
    };
  if (side === 'TOP')
    return {
      x: hostOffset.x,
      y: hostBox.minY + hostOffset.y - targetBox.maxY,
    };
  return {
    x: hostOffset.x,
    y: hostBox.maxY + hostOffset.y - targetBox.minY,
  };
};

/** A compact projection for the dashboard; saved editor coordinates remain untouched. */
export function assembleFloorForOverview(source: FloorLayout): FloorLayout {
  const floor = structuredClone(source);
  const rooms = new Map(floor.rooms.map((room) => [room.id, room]));
  const links = floor.openings.filter(
    ({ kind, roomIds }) => (kind === 'DOOR' || kind === 'PASSAGE') && roomIds.length === 2,
  );
  const offsets = new Map<string, Offset>();
  const remaining = new Set(floor.rooms.map(({ id }) => id));
  let componentCursor = 0;

  while (remaining.size) {
    const root = [...remaining]
      .map((id) => ({
        room: rooms.get(id)!,
        degree: links.filter(({ roomIds }) => roomIds.includes(id)).length,
      }))
      .sort(
        (left, right) =>
          Number(right.room.kind === 'HALLWAY') - Number(left.room.kind === 'HALLWAY') ||
          right.degree - left.degree,
      )[0]!.room;
    const componentIds = new Set<string>([root.id]);
    offsets.set(root.id, { x: 0, y: 0 });
    remaining.delete(root.id);

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const opening of links) {
        const [firstId, secondId] = opening.roomIds;
        const first = rooms.get(firstId!);
        const second = rooms.get(secondId!);
        if (!first || !second) continue;
        const firstOffset = offsets.get(first.id);
        const secondOffset = offsets.get(second.id);
        if ((firstOffset && secondOffset) || (!firstOffset && !secondOffset)) continue;

        const host = (opening.hostRoomId ?? first.id) === first.id ? first : second;
        const target = host.id === first.id ? second : first;
        const hostOffset = offsets.get(host.id);
        const targetOffset = offsets.get(target.id);
        if (hostOffset && !targetOffset) {
          offsets.set(target.id, targetOffsetAtOpening(host, target, opening, hostOffset));
          componentIds.add(target.id);
          remaining.delete(target.id);
          progressed = true;
        } else if (targetOffset && !hostOffset) {
          const targetAtZero = targetOffsetAtOpening(host, target, opening, { x: 0, y: 0 });
          offsets.set(host.id, {
            x: targetOffset.x - targetAtZero.x,
            y: targetOffset.y - targetAtZero.y,
          });
          componentIds.add(host.id);
          remaining.delete(host.id);
          progressed = true;
        }
      }
    }

    const boxes = [...componentIds].map((id) => {
      const box = roomBounds(rooms.get(id)!);
      const offset = offsets.get(id)!;
      return {
        minX: box.minX + offset.x,
        maxX: box.maxX + offset.x,
        minY: box.minY + offset.y,
        maxY: box.maxY + offset.y,
      };
    });
    const minX = Math.min(...boxes.map((box) => box.minX));
    const maxX = Math.max(...boxes.map((box) => box.maxX));
    const minY = Math.min(...boxes.map((box) => box.minY));
    for (const id of componentIds) {
      const offset = offsets.get(id)!;
      offsets.set(id, { x: offset.x + componentCursor - minX, y: offset.y - minY });
    }
    componentCursor += maxX - minX + 70;
  }

  const padding = 70;
  for (const room of floor.rooms) {
    const offset = offsets.get(room.id) ?? { x: 0, y: 0 };
    room.geometry.points = room.geometry.points.map(({ x, y }) => ({
      x: x + offset.x + padding,
      y: y + offset.y + padding,
    }));
  }
  for (const opening of floor.openings) {
    const offset = offsets.get(opening.hostRoomId ?? opening.roomIds[0]!) ?? { x: 0, y: 0 };
    opening.x += offset.x + padding;
    opening.y += offset.y + padding;
  }
  for (const stair of floor.stairs) {
    const roomId = stair.fromFloorId === floor.id ? stair.fromRoomId : stair.toRoomId;
    const offset = offsets.get(roomId) ?? { x: 0, y: 0 };
    stair.x += offset.x + padding;
    stair.y += offset.y + padding;
  }
  const allPoints = floor.rooms.flatMap(({ geometry }) => geometry.points);
  floor.width = Math.max(400, ...allPoints.map(({ x }) => x + padding));
  floor.height = Math.max(300, ...allPoints.map(({ y }) => y + padding));
  return floor;
}

function MiniPlan({
  floor,
  plan,
  selectedRoomId,
  presence,
  onSelect,
}: {
  floor: FloorLayout;
  plan: HomePlan;
  selectedRoomId: string | null;
  presence: PresenceEstimate | null;
  onSelect: (roomId: string) => void;
}) {
  return (
    <svg
      className="home-overview-map"
      viewBox={`0 0 ${Math.max(floor.width, 400)} ${Math.max(floor.height, 300)}`}
      role="img"
      aria-label={`Plan de ${floor.name}`}
    >
      <defs>
        <pattern id="overview-grid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#dce7ec" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" rx="20" fill="url(#overview-grid)" />
      {floor.rooms.map((room) => {
        const center = roomCenter(room);
        const selected = room.id === selectedRoomId;
        const occupied = room.id === presence?.roomId;
        return (
          <g
            key={room.id}
            className={`home-overview-room${selected ? ' is-selected' : ''}${occupied ? ' has-presence' : ''}`}
            onClick={() => onSelect(room.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(room.id);
            }}
          >
            <polygon points={points(room)} fill={room.geometry.color} />
            <text x={center.x} y={center.y - 6} textAnchor="middle">
              {room.name}
            </text>
            <text className="room-area" x={center.x} y={center.y + 20} textAnchor="middle">
              {roomAreaM2(room).toFixed(1)} m²
            </text>
            {occupied && <circle className="presence-dot" cx={center.x} cy={center.y + 45} r="7" />}
          </g>
        );
      })}
      {floor.openings.map((opening) => (
        <line
          key={opening.id}
          className={`home-overview-opening is-${opening.kind.toLowerCase()}`}
          x1={opening.x - opening.width / 2}
          y1={opening.y}
          x2={opening.x + opening.width / 2}
          y2={opening.y}
          transform={`rotate(${opening.rotation} ${opening.x} ${opening.y})`}
        />
      ))}
      {floor.stairs.map((stair) => {
        const destination = plan.levels.find(({ id }) =>
          stair.fromFloorId === floor.id ? id === stair.toFloorId : id === stair.fromFloorId,
        );
        const upward = (destination?.floor ?? floor.floor) > floor.floor;
        return upward ? (
          <ChevronUp key={stair.id} x={stair.x - 18} y={stair.y - 18} size={36} />
        ) : (
          <ChevronDown key={stair.id} x={stair.x - 18} y={stair.y - 18} size={36} />
        );
      })}
    </svg>
  );
}

export function HomeOverview({
  locale,
  home,
  cameras,
  canManage,
  onManage,
  onOpenLivePlan,
  onOpenSensors,
  onOpenCameras,
}: {
  locale: 'fr' | 'en';
  home: HomeInfo | undefined;
  cameras: CameraItem[];
  canManage: boolean;
  onManage: (roomId?: string) => void;
  onOpenLivePlan: () => void;
  onOpenSensors: () => void;
  onOpenCameras: () => void;
}) {
  const fr = locale === 'fr';
  const [plan, setPlan] = useState<HomePlan | null>(null);
  const [presence, setPresence] = useState<PresenceEstimate | null>(null);
  const [devices, setDevices] = useState<SensorDevice[]>([]);
  const [coverage, setCoverage] = useState<EquipmentCoverage>(emptyCoverage);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState('');
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [floorId, setFloorId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const refresh = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const [planResponse, presenceResponse, devicesResponse, coverageResponse, protocolsResponse] =
        await Promise.all([
          fetch('/api/v1/household/plan', { cache: 'no-store' }),
          fetch('/api/v1/household/presence', { cache: 'no-store' }),
          fetch('/api/v1/sensor-devices', { cache: 'no-store' }),
          fetch('/api/v1/household/plan/equipment-coverage', { cache: 'no-store' }),
          fetch('/api/v1/sensor-devices/protocols', { cache: 'no-store' }),
        ]);
      if (!planResponse.ok) throw new Error('plan');
      const nextPlan = (await planResponse.json()) as HomePlan;
      setPlan(nextPlan);
      setFloorId((current) =>
        nextPlan.levels.some(({ id }) => id === current) ? current : (nextPlan.levels[0]?.id ?? ''),
      );
      if (presenceResponse.ok) setPresence((await presenceResponse.json()) as PresenceEstimate);
      if (devicesResponse.ok) setDevices((await devicesResponse.json()) as SensorDevice[]);
      if (coverageResponse.ok) {
        setCoverage((await coverageResponse.json()) as EquipmentCoverage);
        setCoverageError('');
      } else {
        setCoverageError(
          fr
            ? 'L’analyse des capteurs n’a pas pu être chargée.'
            : 'The sensor analysis could not be loaded.',
        );
      }
      if (protocolsResponse.ok) setProtocols((await protocolsResponse.json()) as Protocol[]);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
      setCoverageLoading(false);
    }
  }, [fr]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const events = new EventSource('/api/v1/events');
    events.onmessage = () => void refresh();
    return () => events.close();
  }, [refresh]);

  const savedFloor = plan?.levels.find(({ id }) => id === floorId) ?? plan?.levels[0] ?? null;
  const floor = useMemo(
    () => (savedFloor ? assembleFloorForOverview(savedFloor) : null),
    [savedFloor],
  );
  const selectedRoom = floor?.rooms.find(({ id }) => id === selectedRoomId) ?? null;
  const metrics = useMemo(
    () => (plan ? summarizeHome(plan, devices, cameras) : null),
    [plan, devices, cameras],
  );
  const unassignedDevices = devices.filter(({ room }) => !room).length;
  const unassignedCameras = cameras.filter(({ room }) => !room).length;
  const essentialMissing = coverage.recommendations.filter(
    ({ priority, fulfilledByPlacementId }) => priority === 'ESSENTIAL' && !fulfilledByPlacementId,
  ).length;
  const structuralIssues = plan
    ? plan.understanding.floorsWithoutStairs.length +
      plan.understanding.isolatedRoomIds.length +
      plan.understanding.incompleteStairIds.length
    : 0;
  const planNeedsSetup = !plan?.configured || (metrics?.rooms ?? 0) === 0;
  const cameraProblems = cameras.filter(({ status }) => status === 'OFFLINE').length;
  const deviceProblems = (metrics?.offline ?? 0) + (metrics?.degraded ?? 0);
  const equipmentProblems = deviceProblems + cameraProblems;
  const completionProblems =
    unassignedDevices +
    unassignedCameras +
    essentialMissing +
    structuralIssues +
    (planNeedsSetup ? 1 : 0);
  const overallStatus = equipmentProblems
    ? fr
      ? 'Équipements à vérifier'
      : 'Equipment to check'
    : completionProblems
      ? fr
        ? 'À compléter'
        : 'To complete'
      : fr
        ? 'Opérationnel'
        : 'Operational';
  const statusClass = equipmentProblems ? 'attention' : completionProblems ? 'incomplete' : 'ready';
  const areaLabel = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(metrics?.area ?? 0);

  const coverageCards = plan
    ? [
        { id: 'presence', label: fr ? 'Présence et mouvement' : 'Presence and motion', icon: Move },
        { id: 'entrance', label: fr ? 'Entrée principale' : 'Main entrance', icon: DoorOpen },
        {
          id: 'climate',
          label: fr ? 'Température et humidité' : 'Temperature and humidity',
          icon: ThermometerSun,
        },
        { id: 'water', label: fr ? 'Points d’eau' : 'Water points', icon: Droplets },
        {
          id: 'electric',
          label: fr ? 'Appareils électriques' : 'Electrical appliances',
          icon: PlugZap,
        },
      ].map((item) => ({ ...item, status: getCoverageStatus(item.id, plan, devices, coverage) }))
    : [];

  const roomPlacements =
    selectedRoom && plan ? plan.placements.filter(({ roomId }) => roomId === selectedRoom.id) : [];
  const roomCameras = selectedRoom
    ? cameras.filter(({ room }) => room?.id === selectedRoom.id)
    : [];
  const roomOpenings =
    selectedRoom && floor
      ? floor.openings.filter(({ roomIds }) => roomIds.includes(selectedRoom.id))
      : [];
  const roomPassages =
    selectedRoom && plan
      ? plan.connections.filter(
          ({ fromRoomId, toRoomId }) =>
            fromRoomId === selectedRoom.id || toRoomId === selectedRoom.id,
        ).length
      : 0;
  const roomEquipmentIds = new Set(
    roomPlacements.filter(({ kind }) => kind === 'SENSOR').map(({ equipmentId }) => equipmentId),
  );
  const roomDevices = selectedRoom
    ? devices.filter(
        (device) => device.room?.id === selectedRoom.id || roomEquipmentIds.has(device.id),
      )
    : [];

  if (loading)
    return (
      <div className="home-overview-loading">
        {fr ? 'Préparation de votre logement…' : 'Preparing your home…'}
      </div>
    );

  return (
    <section className="home-overview-page">
      <header className="home-overview-hero">
        <div>
          <span className="eyebrow">{fr ? 'Vue d’ensemble' : 'Overview'}</span>
          <h2>{home?.name ?? (fr ? 'Mon logement' : 'My home')}</h2>
          <p className="home-overview-address">
            <MapPin />
            {home?.address || (fr ? 'Adresse à renseigner' : 'Address not provided')}
          </p>
          <div className="home-overview-meta">
            <span>
              {homeTypeLabels[home?.type ?? ''] ?? home?.type ?? (fr ? 'Logement' : 'Home')}
            </span>
            <span className={`home-overview-status ${statusClass}`}>
              <CircleDot /> {overallStatus}
            </span>
          </div>
        </div>
        <div className="home-overview-actions">
          <button className="primary" onClick={canManage ? () => onManage() : onOpenLivePlan}>
            {canManage ? <Home /> : <Eye />}
            {canManage
              ? fr
                ? 'Gérer mon logement'
                : 'Manage my home'
              : fr
                ? 'Voir le plan en direct'
                : 'View live plan'}
          </button>
          <button onClick={onOpenSensors}>
            <Radio /> {fr ? 'Capteurs' : 'Sensors'}
          </button>
          <button onClick={onOpenCameras}>
            <Camera /> {fr ? 'Caméras' : 'Cameras'}
          </button>
        </div>
      </header>

      {unavailable || !plan || !metrics ? (
        <div className="home-overview-empty">
          <AlertTriangle />
          <div>
            <h3>
              {fr
                ? 'Le plan est momentanément indisponible'
                : 'The plan is temporarily unavailable'}
            </h3>
            <p>
              {fr
                ? 'Les autres informations du logement restent accessibles.'
                : 'Other home information remains available.'}
            </p>
          </div>
          <button onClick={() => void refresh()}>{fr ? 'Réessayer' : 'Try again'}</button>
        </div>
      ) : (
        <>
          <div className="home-overview-metrics">
            <article>
              <Layers3 />
              <span>{fr ? 'Niveaux' : 'Levels'}</span>
              <strong>{metrics.levels}</strong>
            </article>
            <article>
              <Home />
              <span>{fr ? 'Pièces' : 'Rooms'}</span>
              <strong>{metrics.rooms}</strong>
            </article>
            <article>
              <Ruler />
              <span>{fr ? 'Surface' : 'Area'}</span>
              <strong className="home-overview-area-value">
                {metrics.approximate ? '≈ ' : ''}
                {areaLabel} m²
              </strong>
            </article>
            <article>
              <Radio />
              <span>{fr ? 'Capteurs' : 'Sensors'}</span>
              <strong>{metrics.physicalDevices}</strong>
            </article>
            <article>
              <Camera />
              <span>{fr ? 'Caméras' : 'Cameras'}</span>
              <strong>{cameras.length}</strong>
            </article>
            <article>
              <ShieldCheck />
              <span>{fr ? 'Actifs' : 'Active'}</span>
              <strong>{metrics.activeEquipment}</strong>
            </article>
          </div>

          <div className="home-overview-main-grid">
            <article className="home-overview-plan-card">
              <header>
                <div>
                  <span className="eyebrow">{fr ? 'Plan interactif' : 'Interactive plan'}</span>
                  <h3>{fr ? 'Votre logement en un coup d’œil' : 'Your home at a glance'}</h3>
                </div>
                <button onClick={onOpenLivePlan}>
                  {fr ? 'Ouvrir en grand' : 'Open full view'} <ArrowRight />
                </button>
              </header>
              <div className="home-overview-floor-tabs" role="tablist">
                {[...plan.levels]
                  .sort((a, b) => a.order - b.order)
                  .map((level) => (
                    <button
                      key={level.id}
                      className={floor?.id === level.id ? 'active' : ''}
                      onClick={() => {
                        setFloorId(level.id);
                        setSelectedRoomId(null);
                      }}
                    >
                      {level.name}
                    </button>
                  ))}
              </div>
              <div className="home-overview-plan-layout">
                {floor && (
                  <MiniPlan
                    floor={floor}
                    plan={plan}
                    selectedRoomId={selectedRoomId}
                    presence={presence}
                    onSelect={setSelectedRoomId}
                  />
                )}
                <aside className="home-overview-room-detail">
                  {selectedRoom ? (
                    <>
                      <span className="eyebrow">{fr ? 'Pièce sélectionnée' : 'Selected room'}</span>
                      <h4>{selectedRoom.name}</h4>
                      <p>
                        {roomKindLabels[selectedRoom.kind] ?? selectedRoom.kind} ·{' '}
                        {roomAreaM2(selectedRoom).toFixed(1)} m²
                      </p>
                      <dl>
                        <div>
                          <dt>{fr ? 'Portes et fenêtres' : 'Doors and windows'}</dt>
                          <dd>{roomOpenings.length}</dd>
                        </div>
                        <div>
                          <dt>{fr ? 'Passages' : 'Passages'}</dt>
                          <dd>{roomPassages}</dd>
                        </div>
                        <div>
                          <dt>{fr ? 'Capteurs' : 'Sensors'}</dt>
                          <dd>{roomPlacements.filter(({ kind }) => kind === 'SENSOR').length}</dd>
                        </div>
                        <div>
                          <dt>{fr ? 'Caméras' : 'Cameras'}</dt>
                          <dd>{roomCameras.length}</dd>
                        </div>
                      </dl>
                      {presence?.roomId === selectedRoom.id && (
                        <div className="home-overview-presence">
                          <CircleDot />
                          <div>
                            <strong>
                              {presence.state === 'AMBIGUOUS'
                                ? fr
                                  ? 'Plusieurs présences possibles'
                                  : 'Multiple possible presences'
                                : fr
                                  ? 'Présence probable'
                                  : 'Probable presence'}
                            </strong>
                            <span>
                              {presence.durationSeconds !== null
                                ? `${fr ? 'depuis' : 'for'} ${Math.max(1, Math.round(presence.durationSeconds / 60))} min`
                                : ''}{' '}
                              ·{' '}
                              {presence.confidence === 'HIGH'
                                ? fr
                                  ? 'confiance élevée'
                                  : 'high confidence'
                                : presence.confidence === 'MEDIUM'
                                  ? fr
                                    ? 'confiance moyenne'
                                    : 'medium confidence'
                                  : fr
                                    ? 'confiance faible'
                                    : 'low confidence'}
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="home-overview-room-placeholder">
                      <MapPin />
                      <strong>{fr ? 'Sélectionnez une pièce' : 'Select a room'}</strong>
                      <span>
                        {fr
                          ? 'Touchez une pièce pour voir ses informations.'
                          : 'Tap a room to see its details.'}
                      </span>
                    </div>
                  )}
                </aside>
              </div>
              <footer className="home-overview-legend">
                <span>
                  <i className="door" />
                  {fr ? 'Porte' : 'Door'}
                </span>
                <span>
                  <i className="window" />
                  {fr ? 'Fenêtre' : 'Window'}
                </span>
                <span>
                  <i className="passage" />
                  {fr ? 'Passage' : 'Passage'}
                </span>
                <span>
                  <CircleDot />
                  {fr ? 'Présence probable' : 'Probable presence'}
                </span>
              </footer>

              <section className="home-overview-rooms">
                <header>
                  <div>
                    <span className="eyebrow">{fr ? 'Pièce par pièce' : 'Room by room'}</span>
                    <h3>{fr ? 'Le détail de ce niveau' : 'Details for this level'}</h3>
                  </div>
                  <span>
                    {floor?.rooms.length ?? 0} {fr ? 'pièces' : 'rooms'}
                  </span>
                </header>
                <div className="home-overview-room-cards">
                  {floor?.rooms.map((room) => {
                    const placedDeviceIds = new Set(
                      plan.placements
                        .filter(({ roomId, kind }) => roomId === room.id && kind === 'SENSOR')
                        .map(({ equipmentId }) => equipmentId),
                    );
                    const sensorCount = devices.filter(
                      (device) => device.room?.id === room.id || placedDeviceIds.has(device.id),
                    ).length;
                    const cameraCount = cameras.filter(
                      ({ room: cameraRoom }) => cameraRoom?.id === room.id,
                    ).length;
                    const RoomIcon = roomIcon(room);
                    return (
                      <button
                        key={room.id}
                        className={selectedRoomId === room.id ? 'active' : ''}
                        onClick={() => {
                          if (canManage) {
                            onManage(room.id);
                            return;
                          }
                          setSelectedRoomId(room.id);
                        }}
                      >
                        <span
                          className="room-card-color"
                          style={{ background: room.geometry.color }}
                        >
                          <RoomIcon aria-hidden="true" />
                        </span>
                        <span className="room-card-copy">
                          <strong>{room.name}</strong>
                          <small>
                            {roomKindLabels[room.kind] ?? room.kind} · {roomAreaM2(room).toFixed(1)}{' '}
                            m²
                          </small>
                          <i>
                            {sensorCount} {fr ? 'capteurs' : 'sensors'} · {cameraCount}{' '}
                            {fr ? 'caméras' : 'cameras'}
                          </i>
                        </span>
                        <ArrowRight />
                      </button>
                    );
                  })}
                </div>

                {selectedRoom && (
                  <article className="home-overview-room-sheet">
                    <header>
                      <div>
                        <span className="eyebrow">
                          {roomKindLabels[selectedRoom.kind] ?? selectedRoom.kind}
                        </span>
                        <h4>{selectedRoom.name}</h4>
                        <p>
                          {roomAreaM2(selectedRoom).toFixed(1)} m² · {roomOpenings.length}{' '}
                          {fr ? 'ouvertures' : 'openings'} · {roomPassages}{' '}
                          {fr ? 'passages' : 'passages'}
                        </p>
                      </div>
                      {canManage && (
                        <button onClick={() => onManage(selectedRoom.id)}>
                          <Plus /> {fr ? 'Ajouter dans cette pièce' : 'Add to this room'}
                        </button>
                      )}
                    </header>
                    <div className="room-sheet-columns">
                      <section>
                        <h5>
                          <Radio /> {fr ? 'Capteurs associés' : 'Assigned sensors'}{' '}
                          <b>{roomDevices.length}</b>
                        </h5>
                        {roomDevices.length ? (
                          <div className="room-sheet-devices">
                            {roomDevices.map((device) => (
                              <div key={device.id}>
                                <i className={deviceState(device).toLowerCase()} />
                                <span>
                                  <strong>{device.name}</strong>
                                  <small>
                                    {device.capabilities.map(({ label }) => label).join(' · ')}
                                  </small>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>
                            {fr
                              ? 'Aucun capteur associé à cette pièce.'
                              : 'No sensors assigned to this room.'}
                          </p>
                        )}
                      </section>
                      <section>
                        <h5>
                          <Camera /> {fr ? 'Caméras' : 'Cameras'} <b>{roomCameras.length}</b>
                        </h5>
                        {roomCameras.length ? (
                          <div className="room-sheet-devices">
                            {roomCameras.map((camera) => (
                              <div key={camera.id}>
                                <i className={camera.status.toLowerCase()} />
                                <span>
                                  <strong>{camera.name}</strong>
                                  <small>
                                    {camera.privacyMode
                                      ? fr
                                        ? 'Mode privé'
                                        : 'Privacy mode'
                                      : camera.status}
                                  </small>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>
                            {fr ? 'Aucune caméra dans cette pièce.' : 'No camera in this room.'}
                          </p>
                        )}
                      </section>
                    </div>
                  </article>
                )}
              </section>
            </article>

            <div className="home-overview-side-column">
              <article className="home-overview-summary-card">
                <header>
                  <div>
                    <span className="eyebrow">{fr ? 'État du domicile' : 'Home status'}</span>
                    <h3>{fr ? 'Équipement du logement' : 'Home equipment'}</h3>
                  </div>
                  <Wifi />
                </header>
                <div className="equipment-state-row">
                  <span>
                    <i className="online" />
                    {fr ? 'En ligne' : 'Online'}
                  </span>
                  <strong>{metrics.online}</strong>
                </div>
                <div className="equipment-state-row">
                  <span>
                    <i className="degraded" />
                    {fr ? 'Dégradés' : 'Degraded'}
                  </span>
                  <strong>{metrics.degraded}</strong>
                </div>
                <div className="equipment-state-row">
                  <span>
                    <i className="offline" />
                    {fr ? 'Hors ligne' : 'Offline'}
                  </span>
                  <strong>{metrics.offline}</strong>
                </div>
                <div className="equipment-state-row">
                  <span>
                    <Camera />
                    {fr ? 'Caméras disponibles' : 'Available cameras'}
                  </span>
                  <strong>{metrics.onlineCameras}</strong>
                </div>
                <div className="equipment-state-row">
                  <span>
                    <MapPin />
                    {fr ? 'Non attribués' : 'Unassigned'}
                  </span>
                  <strong>{unassignedDevices + unassignedCameras}</strong>
                </div>
                <div className="zigbee-state">
                  <Radio />
                  <div>
                    <strong>{fr ? 'Réseau Zigbee' : 'Zigbee network'}</strong>
                    <span>
                      {protocols.find(({ id }) => id === 'zigbee')?.available
                        ? fr
                          ? 'Disponible'
                          : 'Available'
                        : fr
                          ? 'À configurer'
                          : 'To configure'}
                    </span>
                  </div>
                </div>
              </article>

              <article className="home-overview-summary-card coverage-card">
                <header>
                  <div>
                    <span className="eyebrow">{fr ? 'Compréhension' : 'Understanding'}</span>
                    <h3>{fr ? 'Ce qu’Élise couvre' : 'What Elise covers'}</h3>
                  </div>
                  <ShieldCheck />
                </header>
                {coverageCards.map(({ id, label, icon: Icon, status }) => (
                  <div className="coverage-row" key={id}>
                    <span>
                      <Icon />
                      {label}
                    </span>
                    <b className={status.toLowerCase()}>
                      {status === 'COVERED'
                        ? fr
                          ? 'Couvert'
                          : 'Covered'
                        : status === 'PARTIAL'
                          ? fr
                            ? 'Partiel'
                            : 'Partial'
                          : fr
                            ? 'Non équipé'
                            : 'Not equipped'}
                    </b>
                  </div>
                ))}
                <button
                  className="coverage-details-button"
                  type="button"
                  onClick={() => setCoverageOpen(true)}
                >
                  <Sparkles />
                  {fr ? 'Voir les capteurs recommandés' : 'View recommended sensors'}
                  <ArrowRight />
                </button>
              </article>
            </div>
          </div>

          {completionProblems + equipmentProblems > 0 && (
            <article className="home-overview-todo">
              <header>
                <div>
                  <span className="eyebrow">{fr ? 'Actions utiles' : 'Useful actions'}</span>
                  <h3>{fr ? 'À compléter' : 'To complete'}</h3>
                </div>
                <AlertTriangle />
              </header>
              <div>
                {unassignedDevices > 0 && (
                  <button onClick={onOpenSensors}>
                    <MapPin />
                    <span>
                      <strong>
                        {unassignedDevices} {fr ? 'capteur(s) à placer' : 'sensor(s) to place'}
                      </strong>
                      <small>
                        {fr
                          ? 'Attribuez-les à une pièce ou un objet.'
                          : 'Assign them to a room or object.'}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
                {unassignedCameras > 0 && (
                  <button onClick={onOpenCameras}>
                    <Camera />
                    <span>
                      <strong>
                        {unassignedCameras} {fr ? 'caméra(s) à attribuer' : 'camera(s) to assign'}
                      </strong>
                      <small>{fr ? 'Choisissez leur pièce.' : 'Choose their room.'}</small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
                {deviceProblems > 0 && (
                  <button onClick={onOpenSensors}>
                    <Wifi />
                    <span>
                      <strong>
                        {deviceProblems} {fr ? 'capteur(s) à vérifier' : 'sensor(s) to check'}
                      </strong>
                      <small>
                        {fr
                          ? 'Certains appareils ne répondent pas normalement.'
                          : 'Some devices are not responding normally.'}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
                {cameraProblems > 0 && (
                  <button onClick={onOpenCameras}>
                    <Camera />
                    <span>
                      <strong>
                        {cameraProblems} {fr ? 'caméra(s) à vérifier' : 'camera(s) to check'}
                      </strong>
                      <small>
                        {fr ? 'Certaines caméras sont hors ligne.' : 'Some cameras are offline.'}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
                {essentialMissing > 0 && (
                  <button onClick={canManage ? () => onManage() : onOpenSensors}>
                    <ShieldCheck />
                    <span>
                      <strong>
                        {essentialMissing}{' '}
                        {fr ? 'recommandation(s) essentielle(s)' : 'essential recommendation(s)'}
                      </strong>
                      <small>
                        {fr
                          ? 'Complétez la couverture utile du logement.'
                          : 'Complete useful home coverage.'}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
                {structuralIssues > 0 && (
                  <button onClick={canManage ? () => onManage() : onOpenLivePlan}>
                    <Layers3 />
                    <span>
                      <strong>
                        {structuralIssues}{' '}
                        {fr ? 'point(s) du plan à confirmer' : 'plan item(s) to confirm'}
                      </strong>
                      <small>
                        {fr
                          ? 'Escalier, étage ou circulation à préciser.'
                          : 'Stair, floor or circulation needs clarification.'}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
                {planNeedsSetup && (
                  <button onClick={canManage ? () => onManage() : onOpenLivePlan}>
                    <Home />
                    <span>
                      <strong>{fr ? 'Plan du logement à terminer' : 'Home plan to finish'}</strong>
                      <small>
                        {fr
                          ? 'Ajoutez les pièces et confirmez l’organisation du logement.'
                          : 'Add rooms and confirm the home layout.'}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
              </div>
            </article>
          )}
        </>
      )}
      {coverageOpen && (
        <div
          className="coverage-recommendations-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={fr ? 'Capteurs recommandés' : 'Recommended sensors'}
        >
          <SensorCoverageRecommendations
            locale={locale}
            coverage={coverage}
            loading={coverageLoading}
            error={
              coverageError ||
              (unavailable
                ? fr
                  ? 'L’analyse n’a pas pu être chargée.'
                  : 'The analysis could not be loaded.'
                : '')
            }
            onRetry={() => void refresh()}
            onClose={() => setCoverageOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
