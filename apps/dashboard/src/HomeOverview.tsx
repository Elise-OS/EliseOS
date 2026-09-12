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
  Eye,
  Footprints,
  Home,
  MapPin,
  Plus,
  Radio,
  ShieldCheck,
  Sofa,
  Sun,
  Toilet,
  Trees,
  Utensils,
  Warehouse,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HomeSensorOnboardingDialog } from './HomeSensorOnboardingDialog';
import { COVERAGE_FAMILIES, coverageNeeds } from './coverage-model';
import { SensorCoverageRecommendations } from './SensorCoverageRecommendations';
import { sensorDeviceHealthStatus } from './sensor-ui';
import { DataLoadingScreen } from './DataLoadingScreen';

type HomeInfo = {
  name: string;
  type: string;
  address: string | null;
  floorCount: number;
};

export function homeRealtimeEventAction(data: string): 'IGNORE' | 'PRESENCE' | 'REFRESH' {
  try {
    const type = (JSON.parse(data) as { type?: unknown }).type;
    if (type === 'connected' || type === 'heartbeat') return 'IGNORE';
    if (type === 'presence') return 'PRESENCE';
  } catch {
    // Unknown server events fall back to a full refresh.
  }
  return 'REFRESH';
}

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

export function locatePlanRoom(plan: HomePlan, roomId: string | null | undefined) {
  if (!roomId) return null;
  for (const level of plan.levels) {
    const room = level.rooms.find(({ id }) => id === roomId);
    if (room) return { level, room };
  }
  return null;
}

const deviceState = (device: SensorDevice): 'ONLINE' | 'DEGRADED' | 'OFFLINE' => {
  return sensorDeviceHealthStatus(device);
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
  presence,
  onSelect,
}: {
  floor: FloorLayout;
  plan: HomePlan;
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
        const occupied = room.id === presence?.roomId;
        return (
          <g
            key={room.id}
            className={`home-overview-room${occupied ? ' has-presence' : ''}`}
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
            {occupied && (
              <g
                className="presence-marker"
                transform={`translate(${center.x} ${center.y + 52})`}
                aria-label={`Présence probable dans ${room.name}`}
              >
                <circle className="presence-marker-pulse" cx="0" cy="0" r="24" />
                <circle className="presence-marker-core" cx="0" cy="0" r="13" />
                <circle className="presence-marker-center" cx="0" cy="0" r="4" />
              </g>
            )}
          </g>
        );
      })}
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
}: {
  locale: 'fr' | 'en';
  home: HomeInfo | undefined;
  cameras: CameraItem[];
  canManage: boolean;
  onManage: (roomId?: string) => void;
  onOpenLivePlan: () => void;
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
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [sensorFlowOpen, setSensorFlowOpen] = useState(false);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (showLoading) setCoverageLoading(true);
      try {
        const [
          planResponse,
          presenceResponse,
          devicesResponse,
          coverageResponse,
          protocolsResponse,
        ] = await Promise.all([
          fetch('/api/v1/household/plan', { cache: 'no-store' }),
          fetch('/api/v1/household/presence', { cache: 'no-store' }),
          fetch('/api/v1/sensor-devices', { cache: 'no-store' }),
          fetch('/api/v1/household/plan/equipment-coverage', { cache: 'no-store' }),
          fetch('/api/v1/sensor-devices/protocols', { cache: 'no-store' }),
        ]);
        if (!planResponse.ok) throw new Error('plan');
        const nextPlan = (await planResponse.json()) as HomePlan;
        const nextPresence = presenceResponse.ok
          ? ((await presenceResponse.json()) as PresenceEstimate)
          : null;
        setPlan(nextPlan);
        setFloorId((current) =>
          nextPlan.levels.some(({ id }) => id === current)
            ? current
            : (locatePlanRoom(nextPlan, nextPresence?.roomId)?.level.id ??
              nextPlan.levels[0]?.id ??
              ''),
        );
        if (nextPresence) setPresence(nextPresence);
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
    },
    [fr],
  );

  const refreshPresence = useCallback(async () => {
    const response = await fetch('/api/v1/household/presence', { cache: 'no-store' });
    if (!response.ok) return;
    const nextPresence = (await response.json()) as PresenceEstimate;
    setPresence(nextPresence);
    const occupiedLevel = plan ? locatePlanRoom(plan, nextPresence.roomId)?.level : null;
    if (occupiedLevel) setFloorId(occupiedLevel.id);
  }, [plan]);

  useEffect(() => void refresh(true), [refresh]);
  useEffect(() => {
    const events = new EventSource('/api/v1/events');
    events.onmessage = (event) => {
      const action = homeRealtimeEventAction(String(event.data));
      if (action === 'PRESENCE') void refreshPresence();
      if (action === 'REFRESH') void refresh();
    };
    return () => events.close();
  }, [refresh, refreshPresence]);

  const savedFloor = plan?.levels.find(({ id }) => id === floorId) ?? plan?.levels[0] ?? null;
  const floor = useMemo(
    () => (savedFloor ? assembleFloorForOverview(savedFloor) : null),
    [savedFloor],
  );
  const metrics = useMemo(
    () => (plan ? summarizeHome(plan, devices, cameras) : null),
    [plan, devices, cameras],
  );
  const activePresenceLocation = plan ? locatePlanRoom(plan, presence?.roomId) : null;
  const lastPresenceLocation = plan
    ? locatePlanRoom(plan, presence?.confirmedRoomId ?? presence?.roomId)
    : null;
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
  const coverageCards = COVERAGE_FAMILIES.map((family) => {
    const needs = family.types.flatMap((type) => coverageNeeds(type, coverage, plan, devices));
    const covered = needs.filter((need) => need.covered).length;
    return {
      label: fr ? family.label : family.labelEn,
      text: needs.length
        ? covered + '/' + needs.length + (fr ? ' équipés' : ' equipped')
        : fr
          ? 'À découvrir'
          : 'Explore',
    };
  });

  if (loading)
    return (
      <DataLoadingScreen
        locale={locale}
        message={fr ? 'Préparation de votre logement…' : 'Preparing your home…'}
      />
    );

  return (
    <section className="home-overview-page">
      <header className="home-overview-hero">
        <div className="home-overview-hero-copy">
          <div>
            <span className="eyebrow">{fr ? 'Vue d’ensemble' : 'Overview'}</span>
            <h2>{home?.name ?? (fr ? 'Mon logement' : 'My home')}</h2>
            <div className="home-overview-meta">
              <span>
                {homeTypeLabels[home?.type ?? ''] ?? home?.type ?? (fr ? 'Logement' : 'Home')}
              </span>
              {equipmentProblems === 0 && (
                <span className={`home-overview-status ${statusClass}`}>
                  <CircleDot /> {overallStatus}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="home-overview-actions">
          <button className="primary" onClick={canManage ? () => onManage() : onOpenLivePlan}>
            {canManage ? <Home /> : <Eye />}
            {canManage
              ? fr
                ? 'Modifier mon logement'
                : 'Manage my home'
              : fr
                ? 'Voir le plan en direct'
                : 'View live plan'}
          </button>
          {canManage && (
            <button className="add-sensor" onClick={() => setSensorFlowOpen(true)}>
              <Plus /> {fr ? 'Ajouter un capteur' : 'Add a sensor'}
            </button>
          )}
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
          <button onClick={() => void refresh(true)}>{fr ? 'Réessayer' : 'Try again'}</button>
        </div>
      ) : (
        <>
          <div className="home-overview-main-grid">
            <article className="home-overview-plan-card">
              <header>
                <div>
                  <span className="eyebrow">{fr ? 'Plan interactif' : 'Interactive plan'}</span>
                  <h3>{fr ? 'Votre logement en un coup d’œil' : 'Your home at a glance'}</h3>
                </div>
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
                      }}
                    >
                      {level.name}
                    </button>
                  ))}
              </div>
              <div className="home-overview-plan-layout">
                {floor && (
                  <MiniPlan floor={floor} plan={plan} presence={presence} onSelect={onManage} />
                )}
              </div>
              <footer className="home-overview-legend">
                {activePresenceLocation ? (
                  <button
                    type="button"
                    className="presence-active"
                    onClick={() => setFloorId(activePresenceLocation.level.id)}
                  >
                    <CircleDot />
                    {fr ? 'Présence probable' : 'Probable presence'} ·{' '}
                    {activePresenceLocation.room.name}
                  </button>
                ) : lastPresenceLocation ? (
                  <span className="presence-stale">
                    <CircleDot />
                    {fr ? 'Dernière présence connue' : 'Last known presence'} ·{' '}
                    {lastPresenceLocation.room.name}
                  </span>
                ) : (
                  <span className="presence-empty">
                    <CircleDot />
                    {fr ? 'Aucune présence récente' : 'No recent presence'}
                  </span>
                )}
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
                      <button key={room.id} onClick={() => onManage(room.id)}>
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

              <button
                className="home-overview-summary-card coverage-card coverage-card-trigger"
                onClick={() => setCoverageOpen(true)}
              >
                <span className="coverage-card-title">
                  <span>
                    <span className="eyebrow">{fr ? 'Compréhension' : 'Understanding'}</span>
                    <strong>{fr ? 'Ce qu’Élise couvre' : 'What Élise covers'}</strong>
                  </span>
                  <ShieldCheck />
                </span>
                {coverageCards.map(({ label, text }) => (
                  <span className="coverage-row" key={label}>
                    <span>{label}</span>
                    <small>{text}</small>
                  </span>
                ))}
                <span className="coverage-card-hint">
                  {fr ? 'Fonctions, pièces et produits' : 'Functions, rooms and products'}
                  <ArrowRight />
                </span>
              </button>
            </div>
          </div>
        </>
      )}
      {coverageOpen && (
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
          onRetry={() => void refresh(true)}
          onClose={() => setCoverageOpen(false)}
        />
      )}
      {sensorFlowOpen && plan && (
        <HomeSensorOnboardingDialog
          open
          locale={locale}
          plan={plan}
          devices={devices}
          onClose={() => setSensorFlowOpen(false)}
          onInstalled={refresh}
        />
      )}
    </section>
  );
}
