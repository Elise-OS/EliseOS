import type {
  EquipmentCoverage,
  FloorLayout,
  HomePlan,
  Opening,
  PlanRoom,
  PresenceEstimate,
  RequestedRoom,
  SensorDevice,
} from '@michel/contracts';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  DoorOpen,
  Eye,
  Grid2X2,
  Link2,
  MousePointer2,
  MoveHorizontal,
  MoveUpRight,
  Plus,
  Radio,
  Redo2,
  Route,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Undo2,
  Waves,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DrawingSetupPanel,
  ExampleOverlay,
  HomeSetupOnboarding,
  type HomeSetupDetails,
} from './HomeSetupOnboarding';
import { RoomEquipmentPage } from './RoomEquipmentPage';
import { StairEquipmentPage } from './StairEquipmentPage';
import { retireFurniture } from '@michel/contracts';
import { sensorRequest } from './sensor-ui';
import { SensorCoverageRecommendations } from './SensorCoverageRecommendations';
import { DataLoadingScreen } from './DataLoadingScreen';

type Sensor = {
  id: string;
  entityId: string;
  capability: string;
  status: string;
  lastSeenAt?: string | null;
  lastValue?: Record<string, unknown> | null;
  device?: { name: string } | null;
};

type CameraItem = {
  id: string;
  name: string;
  status: string;
  privacyMode: boolean;
  room: { id: string; name: string } | null;
};

type Tool =
  | 'SELECT'
  | 'ROOM'
  | 'ROOM_L'
  | 'CORRIDOR'
  | 'DOOR'
  | 'MAIN_ENTRANCE'
  | 'WINDOW'
  | 'CONNECT'
  | 'STAIR';
type Mode = 'EDIT' | 'LIVE';

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

const ROOM_SENSOR_CAPABILITIES = new Set([
  'person_presence',
  'occupancy',
  'motion',
  'temperature',
  'humidity',
  'illuminance',
  'voc',
  'co2',
  'button',
  'water_leak',
  'smoke',
  'carbon_monoxide',
]);

export function sensorDevicePresentation(device: SensorDevice) {
  const capabilities = new Set(device.capabilities.map(({ capability }) => capability));
  const brand = device.manufacturer?.trim()
    ? device.manufacturer.trim().toLowerCase() === 'sonoff'
      ? 'Sonoff'
      : device.manufacturer.trim()
    : '';
  const kind =
    capabilities.has('temperature') && capabilities.has('humidity')
      ? 'Capteur de température et d’humidité'
      : capabilities.has('temperature')
        ? 'Capteur de température'
        : capabilities.has('humidity')
          ? 'Capteur d’humidité'
          : capabilities.has('person_presence') || capabilities.has('occupancy')
            ? 'Capteur de présence'
            : capabilities.has('motion')
              ? 'Détecteur de mouvement'
              : capabilities.has('contact')
                ? 'Capteur d’ouverture'
                : capabilities.has('water_leak')
                  ? 'Détecteur de fuite'
                  : device.name;
  return {
    name:
      brand && !kind.toLocaleLowerCase('fr').includes(brand.toLocaleLowerCase('fr'))
        ? `${kind} ${brand}`
        : kind,
    details: [brand, device.model]
      .filter(
        (value, index, values): value is string =>
          Boolean(value) && values.indexOf(value) === index,
      )
      .join(' · '),
    capabilities: [...new Set(device.capabilities.map(({ label }) => label))],
  };
}

export function isRoomSensorDevice(device: SensorDevice) {
  return device.capabilities.some(({ capability }) => ROOM_SENSOR_CAPABILITIES.has(capability));
}
type Point = { x: number; y: number };

export const shouldRunHomeSetup = ({
  configured,
  installationStatus,
  readOnly,
  preview,
}: {
  configured: boolean;
  installationStatus: string | undefined;
  readOnly: boolean;
  preview: boolean;
}) => !readOnly && !configured && (preview || installationStatus === 'DRAFT');

const expandFloorToRooms = (floor: FloorLayout) => {
  const points = floor.rooms.flatMap(({ geometry }) => geometry.points);
  floor.width = Math.min(
    10_000,
    Math.max(floor.width || 1_200, 1_200, ...points.map(({ x }) => x + 180)),
  );
  floor.height = Math.min(
    10_000,
    Math.max(floor.height || 800, 800, ...points.map(({ y }) => y + 180)),
  );
};

const emptyUnderstanding: HomePlan['understanding'] = {
  levels: [],
  isolatedRoomIds: [],
  adjacentWithoutPassage: [],
  nearAdjacencyIds: [],
  floorsWithoutStairs: [],
  incompleteStairIds: [],
};

const geometryAreaM2 = (points: PlanRoom['geometry']['points']) =>
  Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  ) / 10_000;

const normalizePlan = (source: HomePlan): HomePlan => {
  const value = retireFurniture(source);
  const levels = (value.levels ?? []).map((level) => ({
    ...level,
    rooms: (level.rooms ?? []).map((room) => ({
      ...room,
      areaM2: room.areaM2 ?? geometryAreaM2(room.geometry.points),
    })),
    openings: level.openings ?? [],
    stairs: level.stairs ?? [],
    items: [],
  }));
  for (const level of levels) expandFloorToRooms(level);
  return {
    ...value,
    schemaVersion: 4,
    setupDraft: value.setupDraft ?? null,
    levels,
    placements: (value.placements ?? []).map((placement) => ({
      ...placement,
      targetType: placement.targetType ?? 'ROOM',
      targetId: placement.targetId ?? placement.roomId,
      capabilityBindings: placement.capabilityBindings ?? [],
      equipmentRefKind:
        placement.equipmentRefKind ?? (placement.kind === 'CAMERA' ? 'CAMERA' : undefined),
    })),
    connections: value.connections ?? [],
    adjacencies: value.adjacencies ?? [],
    understanding: {
      ...emptyUnderstanding,
      ...(value.understanding ?? {}),
    },
  };
};

const previewSetupPlan = (locale: 'fr' | 'en'): HomePlan => ({
  schemaVersion: 4,
  revision: 0,
  configured: false,
  setupDraft: {
    stage: 'DETAILS',
    requestedRooms: [],
    tutorialCompleted: false,
  },
  levels: [
    {
      id: 'floor-0',
      name: locale === 'fr' ? 'Rez-de-chaussée' : 'Ground floor',
      floor: 0,
      order: 0,
      width: 1_200,
      height: 800,
      scaleCmPerUnit: null,
      rooms: [],
      openings: [],
      stairs: [],
      items: [],
    },
  ],
  placements: [],
  connections: [],
  adjacencies: [],
  understanding: emptyUnderstanding,
});

const migratePlanDevices = (plan: HomePlan, devices: SensorDevice[]) => {
  const sensorToDevice = new Map(
    devices.flatMap((device) =>
      device.capabilities.map(({ sensorId }) => [sensorId, device] as const),
    ),
  );
  const migrated = clone(plan);
  for (const placement of migrated.placements) {
    if (placement.kind !== 'SENSOR' || placement.equipmentRefKind) continue;
    const device = sensorToDevice.get(placement.equipmentId);
    if (device) {
      placement.equipmentId = device.id;
      placement.equipmentRefKind = 'DEVICE';
      placement.capabilityBindings = device.capabilities.map(({ sensorId, capability }) => ({
        sensorId,
        capability,
        role: capability === 'button' ? 'UNASSIGNED' : capability.toUpperCase(),
      }));
    } else placement.equipmentRefKind = 'SENSOR_ENTITY';
  }
  migrated.placements = migrated.placements.filter(
    (placement, index, all) =>
      placement.equipmentRefKind !== 'DEVICE' ||
      all.findIndex(
        (candidate) =>
          candidate.equipmentRefKind === 'DEVICE' &&
          candidate.equipmentId === placement.equipmentId,
      ) === index,
  );
  return migrated;
};

const roomKinds = [
  ['LIVING_ROOM', 'Salon'],
  ['KITCHEN', 'Cuisine'],
  ['BEDROOM', 'Chambre'],
  ['BATHROOM', 'Salle de bain'],
  ['TOILET', 'Toilettes'],
  ['ENTRANCE', 'Entrée'],
  ['HALLWAY', 'Couloir'],
  ['DINING_ROOM', 'Salle à manger'],
  ['OTHER', 'Autre'],
] as const;

const colors = ['#E8F0F3', '#F5EAD8', '#E6EFE7', '#EEE8F3', '#F3E5E5', '#E8EAF2'];

const uid = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
const snap = (value: number) => Math.round(value / 10) * 10;
const clone = <T,>(value: T): T => structuredClone(value);
const polygon = (room: PlanRoom) => room.geometry.points.map(({ x, y }) => `${x},${y}`).join(' ');
const bounds = (room: PlanRoom) => {
  const xs = room.geometry.points.map(({ x }) => x);
  const ys = room.geometry.points.map(({ y }) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};
const center = (room: PlanRoom) => {
  const box = bounds(room);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const roomAreaM2 = (room: PlanRoom) => room.areaM2 ?? geometryAreaM2(room.geometry.points);
const roomDraftPoints = (start: Point, end: Point, lShape = false, corridor = false) => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.max(120, Math.abs(end.x - start.x));
  const height = corridor
    ? Math.max(100, Math.min(180, Math.abs(end.y - start.y)))
    : Math.max(120, Math.abs(end.y - start.y));
  return lShape
    ? [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height / 2 },
        { x: x + width / 2, y: y + height / 2 },
        { x: x + width / 2, y: y + height },
        { x, y: y + height },
      ]
    : [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
};
const stairDockPoint = (room: PlanRoom, floor: FloorLayout) => {
  const box = bounds(room);
  const gap = 42;
  const candidates = [
    { x: box.x + box.width + gap, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + box.height + gap },
    { x: box.x - gap, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y - gap },
  ];
  return (
    candidates.find(
      (candidate) =>
        candidate.x >= 32 &&
        candidate.x <= floor.width - 32 &&
        candidate.y >= 32 &&
        candidate.y <= floor.height - 32 &&
        !floor.rooms.some((candidateRoom) => pointInRoom(candidate, candidateRoom)),
    ) ?? candidates[0]!
  );
};
const exteriorAnchorAt = (room: PlanRoom, at: Point) => {
  const wall = closestWall(at, [room]);
  if (!wall) return at;
  const roomCenter = center(room);
  const dx = wall.point.x - roomCenter.x;
  const dy = wall.point.y - roomCenter.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: snap(wall.point.x + (dx / length) * 42),
    y: snap(wall.point.y + (dy / length) * 42),
  };
};
const roomEdgeToward = (room: PlanRoom, target: Point) => {
  const box = bounds(room);
  const at = center(room);
  if (target.x > box.x + box.width) return { x: box.x + box.width, y: at.y };
  if (target.x < box.x) return { x: box.x, y: at.y };
  if (target.y > box.y + box.height) return { x: at.x, y: box.y + box.height };
  return { x: at.x, y: box.y };
};
const roomConnectionAnchors = (room: PlanRoom) => {
  const box = bounds(room);
  return [
    { id: 'N', x: box.x + box.width / 2, y: box.y - 25 },
    { id: 'E', x: box.x + box.width + 25, y: box.y + box.height / 2 },
    { id: 'S', x: box.x + box.width / 2, y: box.y + box.height + 25 },
    { id: 'W', x: box.x - 25, y: box.y + box.height / 2 },
  ];
};
const nearestConnectionAnchor = (room: PlanRoom, at: Point) =>
  [...roomConnectionAnchors(room)].sort(
    (first, second) =>
      Math.hypot(first.x - at.x, first.y - at.y) - Math.hypot(second.x - at.x, second.y - at.y),
  )[0]!;
const pointInRoom = (point: Point, room: PlanRoom) => {
  const points = room.geometry.points;
  let inside = false;
  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current++
  ) {
    const a = points[current]!;
    const b = points[previous]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
};
const closestWall = (point: Point, rooms: PlanRoom[]) => {
  let closest: { room: PlanRoom; point: Point; distance: number; rotation: number } | null = null;
  for (const room of rooms) {
    for (let index = 0; index < room.geometry.points.length; index += 1) {
      const start = room.geometry.points[index]!;
      const end = room.geometry.points[(index + 1) % room.geometry.points.length]!;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = dx * dx + dy * dy;
      const ratio = length
        ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
        : 0;
      const projected = { x: start.x + ratio * dx, y: start.y + ratio * dy };
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
      if (!closest || distance < closest.distance)
        closest = {
          room,
          point: projected,
          distance,
          rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
        };
    }
  }
  return closest;
};

const sharedWallPoint = (first: PlanRoom, second: PlanRoom) => {
  for (let left = 0; left < first.geometry.points.length; left += 1) {
    const a = first.geometry.points[left]!;
    const b = first.geometry.points[(left + 1) % first.geometry.points.length]!;
    for (let right = 0; right < second.geometry.points.length; right += 1) {
      const c = second.geometry.points[right]!;
      const d = second.geometry.points[(right + 1) % second.geometry.points.length]!;
      const vertical = Math.abs(a.x - b.x) < 2 && Math.abs(c.x - d.x) < 2;
      const horizontal = Math.abs(a.y - b.y) < 2 && Math.abs(c.y - d.y) < 2;
      if (vertical && Math.abs(a.x - c.x) <= 30) {
        const start = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
        const end = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
        if (end - start >= 90) return { x: (a.x + c.x) / 2, y: (start + end) / 2, rotation: 90 };
      }
      if (horizontal && Math.abs(a.y - c.y) <= 30) {
        const start = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
        const end = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
        if (end - start >= 90) return { x: (start + end) / 2, y: (a.y + c.y) / 2, rotation: 0 };
      }
    }
  }
  return null;
};

type ResizeHandle = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

const resizeHandles = (room: PlanRoom): Array<{ id: ResizeHandle; x: number; y: number }> => {
  const box = bounds(room);
  return [
    { id: 'NW', x: box.x, y: box.y },
    { id: 'N', x: box.x + box.width / 2, y: box.y },
    { id: 'NE', x: box.x + box.width, y: box.y },
    { id: 'E', x: box.x + box.width, y: box.y + box.height / 2 },
    { id: 'SE', x: box.x + box.width, y: box.y + box.height },
    { id: 'S', x: box.x + box.width / 2, y: box.y + box.height },
    { id: 'SW', x: box.x, y: box.y + box.height },
    { id: 'W', x: box.x, y: box.y + box.height / 2 },
  ];
};

const resizedPoints = (original: PlanRoom, handle: ResizeHandle, start: Point, at: Point) => {
  const originalBox = bounds(original);
  const dx = at.x - start.x;
  const dy = at.y - start.y;
  let left = originalBox.x;
  let right = originalBox.x + originalBox.width;
  let top = originalBox.y;
  let bottom = originalBox.y + originalBox.height;
  if (handle.includes('W')) left = Math.min(right - 80, left + dx);
  if (handle.includes('E')) right = Math.max(left + 80, right + dx);
  if (handle.includes('N')) top = Math.min(bottom - 80, top + dy);
  if (handle.includes('S')) bottom = Math.max(top + 80, bottom + dy);
  return original.geometry.points.map(({ x, y }) => ({
    x: snap(left + ((x - originalBox.x) / originalBox.width) * (right - left)),
    y: snap(top + ((y - originalBox.y) / originalBox.height) * (bottom - top)),
  }));
};

const transformRoomContents = (
  draft: HomePlan,
  floorId: string,
  roomId: string,
  nextPoints: Point[],
) => {
  const targetFloor = draft.levels.find(({ id }) => id === floorId)!;
  const targetRoom = targetFloor.rooms.find(({ id }) => id === roomId)!;
  const before = bounds(targetRoom);
  const after = bounds({
    ...targetRoom,
    geometry: { ...targetRoom.geometry, points: nextPoints },
  });
  const transform = ({ x, y }: Point) => ({
    x: snap(after.x + ((x - before.x) / before.width) * after.width),
    y: snap(after.y + ((y - before.y) / before.height) * after.height),
  });
  targetRoom.geometry.points = nextPoints;
  const roomScale = Math.min(1, after.width / before.width, after.height / before.height);
  for (const item of targetFloor.items.filter(({ roomId: id }) => id === roomId)) {
    Object.assign(item, transform(item));
    if (roomScale < 1) {
      item.visualScaleX = Math.max(0.2, (item.visualScaleX ?? 1) * roomScale);
      item.visualScaleY = Math.max(0.2, (item.visualScaleY ?? 1) * roomScale);
    }
  }
  for (const placement of draft.placements.filter(({ roomId: id }) => id === roomId))
    Object.assign(placement, transform(placement));
  for (const stair of draft.levels.flatMap(({ stairs }) => stairs)) {
    if (stair.fromRoomId === roomId) {
      Object.assign(stair, transform(stair));
      if (stair.fromAnchor) stair.fromAnchor = transform(stair.fromAnchor);
    }
    if (stair.toRoomId === roomId && stair.toAnchor) stair.toAnchor = transform(stair.toAnchor);
  }
  for (const opening of targetFloor.openings.filter(({ roomIds }) => roomIds.includes(roomId))) {
    if (opening.logical && (opening.hostRoomId ?? opening.roomIds[0]) !== roomId) continue;
    Object.assign(opening, transform(opening));
    if (!opening.logical && opening.roomIds.length > 1) opening.roomIds = [roomId];
  }
  expandFloorToRooms(targetFloor);
};

export function HomePlanEditor({
  locale,
  home,
  sensors,
  cameras,
  onOpenCamera,
  onSaved,
  readOnly = false,
  initialMode = 'EDIT',
  initialRoomId = null,
  initialStairId = null,
  onBack,
  setupPreview = false,
  onSetupPreviewClose,
}: {
  locale: 'fr' | 'en';
  home:
    | {
        name: string;
        type: string;
        address: string | null;
        timezone: string;
        floorCount: number;
        installationStatus: string;
      }
    | undefined;
  sensors: Sensor[];
  cameras: CameraItem[];
  onOpenCamera: (id: string) => void;
  onSaved: () => void;
  readOnly?: boolean;
  initialMode?: Mode;
  initialRoomId?: string | null;
  initialStairId?: string | null;
  onBack?: () => void;
  setupPreview?: boolean;
  onSetupPreviewClose?: () => void;
}) {
  const [plan, setPlan] = useState<HomePlan | null>(null);
  const [presence, setPresence] = useState<PresenceEstimate | null>(null);
  const [sensorDevices, setSensorDevices] = useState<SensorDevice[]>([]);
  const [coverage, setCoverage] = useState<EquipmentCoverage>(emptyCoverage);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState('');
  const [mode, setMode] = useState<Mode>(readOnly ? 'LIVE' : initialMode);
  const [tool, setTool] = useState<Tool>('SELECT');
  const [floorId, setFloorId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [movingOpeningId, setMovingOpeningId] = useState<string | null>(null);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<Point | null>(null);
  const [history, setHistory] = useState<HomePlan[]>([]);
  const [future, setFuture] = useState<HomePlan[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'LOADING' | 'SAVED' | 'SAVING' | 'ERROR' | 'CONFLICT'>(
    'LOADING',
  );
  const [message, setMessage] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [selectedRequestedRoomId, setSelectedRequestedRoomId] = useState<string | null>(null);
  const [showSetupExample, setShowSetupExample] = useState(false);
  const [setupConfirmOpen, setSetupConfirmOpen] = useState(false);
  const [previewHome, setPreviewHome] = useState({
    name: locale === 'fr' ? 'Maison de Jeanne' : 'Jeanne’s home',
    type: locale === 'fr' ? 'Maison' : 'House',
    address: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
  });
  const canvasRef = useRef<SVGSVGElement>(null);
  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const editVersion = useRef(0);
  const roomDrag = useRef<{
    roomId: string;
    floorId: string;
    start: Point;
    original: HomePlan;
    moved: boolean;
  } | null>(null);
  const [planResize, setPlanResize] = useState<{
    roomId: string;
    floorId: string;
    handle: ResizeHandle;
    start: Point;
    original: PlanRoom;
  } | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<{
    sourceRoomId: string;
    start: Point;
    current: Point;
    targetRoomId: string | null;
    targetValid: boolean;
  } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{
    sourceRoomId: string;
    targetRoomId: string;
    point: Point;
    rotation: number;
  } | null>(null);
  const [stairModalOpen, setStairModalOpen] = useState(false);
  const canvasResize = useRef<{
    floorId: string;
    startClient: Point;
    originalWidth: number;
    originalHeight: number;
    renderedWidth: number;
    renderedHeight: number;
    original: HomePlan;
  } | null>(null);
  const stairDrag = useRef<{
    stairId: string;
    endpoint: 'FROM' | 'TO';
    roomId: string;
    original: HomePlan;
  } | null>(null);

  const refreshDeviceData = useCallback(async () => {
    if (setupPreview) {
      setCoverageLoading(false);
      return;
    }
    setCoverageLoading(true);
    setCoverageError('');
    try {
      const [devicesResponse, coverageResponse] = await Promise.all([
        fetch('/api/v1/sensor-devices', { cache: 'no-store' }),
        fetch('/api/v1/household/plan/equipment-coverage', { cache: 'no-store' }),
      ]);
      if (devicesResponse.ok) setSensorDevices((await devicesResponse.json()) as SensorDevice[]);
      if (!coverageResponse.ok) throw new Error();
      setCoverage((await coverageResponse.json()) as EquipmentCoverage);
    } catch {
      setCoverageError(
        locale === 'fr'
          ? 'L’analyse des capteurs n’a pas pu être chargée.'
          : 'The sensor analysis could not be loaded.',
      );
    } finally {
      setCoverageLoading(false);
    }
  }, [locale, setupPreview]);

  const load = useCallback(async () => {
    setSaveState('LOADING');
    if (setupPreview) {
      const loaded = previewSetupPlan(locale);
      setPlan(loaded);
      setFloorId(loaded.levels[0]!.id);
      setSelectedRoomId(null);
      setEditingRoomId(null);
      setHistory([]);
      setFuture([]);
      setDirty(false);
      setSaveState('SAVED');
      setSetupError('');
      setCoverageLoading(false);
      return;
    }
    try {
      const [planResponse, presenceResponse, devicesResponse, coverageResponse] = await Promise.all(
        [
          fetch('/api/v1/household/plan'),
          fetch('/api/v1/household/presence'),
          fetch('/api/v1/sensor-devices', { cache: 'no-store' }),
          fetch('/api/v1/household/plan/equipment-coverage', { cache: 'no-store' }),
        ],
      );
      if (!planResponse.ok) throw new Error();
      const devices = devicesResponse.ok ? ((await devicesResponse.json()) as SensorDevice[]) : [];
      const loaded = migratePlanDevices(
        normalizePlan((await planResponse.json()) as HomePlan),
        devices,
      );
      setSensorDevices(devices);
      if (coverageResponse.ok) {
        setCoverage((await coverageResponse.json()) as EquipmentCoverage);
        setCoverageError('');
      } else {
        setCoverageError(
          locale === 'fr'
            ? 'L’analyse des capteurs n’a pas pu être chargée.'
            : 'The sensor analysis could not be loaded.',
        );
      }
      setCoverageLoading(false);
      setPlan(loaded);
      const requestedFloor = initialRoomId
        ? loaded.levels.find(({ rooms }) => rooms.some(({ id }) => id === initialRoomId))
        : initialStairId
          ? loaded.levels.find(({ stairs }) => stairs.some(({ id }) => id === initialStairId))
          : undefined;
      setFloorId(requestedFloor?.id ?? loaded.levels[0]?.id ?? '');
      setSelectedRoomId(requestedFloor ? initialRoomId : null);
      setEditingRoomId(!readOnly && requestedFloor ? initialRoomId : null);
      if (presenceResponse.ok) setPresence((await presenceResponse.json()) as PresenceEstimate);
      setHistory([]);
      setFuture([]);
      setDirty(false);
      setSaveState('SAVED');
    } catch {
      setSaveState('ERROR');
      setCoverageLoading(false);
      setMessage(
        locale === 'fr' ? 'Le plan ne peut pas être chargé.' : 'The plan cannot be loaded.',
      );
    }
  }, [initialRoomId, initialStairId, locale, readOnly, setupPreview]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (readOnly) setMode('LIVE');
  }, [readOnly]);
  useEffect(() => {
    if (setupPreview) return;
    const events = new EventSource('/api/v1/events');
    events.onmessage = () => void refreshDeviceData();
    return () => events.close();
  }, [refreshDeviceData, setupPreview]);
  useEffect(() => {
    if (mode !== 'LIVE') return;
    const refreshPresence = async () => {
      const response = await fetch('/api/v1/household/presence');
      if (response.ok) setPresence((await response.json()) as PresenceEstimate);
    };
    const timer = window.setInterval(() => void refreshPresence(), 5_000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const currentFloor = plan?.levels.find((level) => level.id === floorId) ?? plan?.levels[0];
  const selectedRoom = currentFloor?.rooms.find((room) => room.id === selectedRoomId) ?? null;
  const selectedOpening =
    currentFloor?.openings.find((opening) => opening.id === selectedOpeningId) ?? null;
  const editingRoom = plan?.levels
    .flatMap(({ rooms }) => rooms)
    .find(({ id }) => id === editingRoomId);
  const editingFloor = plan?.levels.find((level) =>
    level.rooms.some(({ id }) => id === editingRoomId),
  );
  const sensorMap = useMemo(() => new Map(sensors.map((sensor) => [sensor.id, sensor])), [sensors]);
  const cameraMap = useMemo(() => new Map(cameras.map((camera) => [camera.id, camera])), [cameras]);

  const commit = useCallback(
    (update: (draft: HomePlan) => void) => {
      if (readOnly) return;
      setPlan((current) => {
        if (!current) return current;
        const next = clone(current);
        update(next);
        setHistory((items) => [...items.slice(-29), clone(current)]);
        setFuture([]);
        editVersion.current += 1;
        setDirty(true);
        return next;
      });
    },
    [readOnly],
  );

  const save = useCallback(async () => {
    if (readOnly || setupPreview || !plan || !dirty || saving.current) return;
    saving.current = true;
    const savingVersion = editVersion.current;
    setSaveState('SAVING');
    try {
      const response = await fetch('/api/v1/household/plan', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(plan),
      });
      if (response.status === 409) {
        setSaveState('CONFLICT');
        setMessage(
          locale === 'fr'
            ? 'Une version plus récente existe. Rechargez le plan.'
            : 'A newer version exists. Reload the plan.',
        );
        return;
      }
      const result = (await response.json().catch(() => null)) as
        HomePlan | { message?: string } | null;
      if (!response.ok || !result || !('levels' in result)) {
        setMessage(
          (result && 'message' in result && result.message) ||
            (locale === 'fr'
              ? 'Le plan contient un élément invalide.'
              : 'The plan contains an invalid item.'),
        );
        setSaveState('ERROR');
        return;
      }
      const normalizedResult = normalizePlan(result);
      const unchanged = editVersion.current === savingVersion;
      setPlan((current) =>
        unchanged || !current
          ? normalizedResult
          : {
              ...current,
              revision: normalizedResult.revision,
              connections: normalizedResult.connections,
              adjacencies: normalizedResult.adjacencies,
              understanding: normalizedResult.understanding,
            },
      );
      setDirty(!unchanged);
      setSaveState(unchanged ? 'SAVED' : 'SAVING');
      onSaved();
      void refreshDeviceData();
    } catch {
      setSaveState('ERROR');
      setMessage(
        locale === 'fr'
          ? 'Hors ligne : les changements restent sur cet écran.'
          : 'Offline: changes remain on this screen.',
      );
    } finally {
      saving.current = false;
    }
  }, [dirty, locale, onSaved, plan, readOnly, refreshDeviceData, setupPreview]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 1_200);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, plan, save]);

  const undo = () => {
    const previous = history.at(-1);
    if (!previous || !plan) return;
    setFuture((items) => [clone(plan), ...items].slice(0, 30));
    setHistory((items) => items.slice(0, -1));
    setPlan(clone(previous));
    editVersion.current += 1;
    setDirty(true);
  };
  const redo = () => {
    const next = future[0];
    if (!next || !plan) return;
    setHistory((items) => [...items, clone(plan)].slice(-30));
    setFuture((items) => items.slice(1));
    setPlan(clone(next));
    editVersion.current += 1;
    setDirty(true);
  };

  const canvasPoint = (event: ReactPointerEvent<SVGSVGElement | SVGElement>): Point => {
    const svg = canvasRef.current!;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: snap(transformed.x), y: snap(transformed.y) };
  };

  const addRoom = (start: Point, end: Point, lShape = false, corridor = false) => {
    const drawnRoomIds = new Set(
      plan?.levels.flatMap(({ rooms }) => rooms.map(({ id }) => id)) ?? [],
    );
    const requestedRoom = plan?.setupDraft?.requestedRooms.find(
      ({ id, floor }) =>
        id === selectedRequestedRoomId && !drawnRoomIds.has(id) && currentFloor?.floor === floor,
    );
    const id = requestedRoom?.id ?? uid('room');
    const points = roomDraftPoints(start, end, lShape, corridor);
    commit((draft) => {
      const floor = draft.levels.find((item) => item.id === floorId)!;
      floor.rooms.push({
        id,
        name:
          requestedRoom?.name ??
          (corridor
            ? `Couloir ${draft.levels.flatMap((item) => item.rooms).filter(({ kind }) => kind === 'HALLWAY').length + 1}`
            : `Pièce ${draft.levels.flatMap((item) => item.rooms).length + 1}`),
        kind: requestedRoom?.kind ?? (corridor ? 'HALLWAY' : 'OTHER'),
        areaM2: geometryAreaM2(points),
        geometry: { points, color: colors[floor.rooms.length % colors.length]! },
      });
    });
    setSelectedRoomId(id);
    setSelectedRequestedRoomId(null);
    setTool('SELECT');
  };

  const addOpening = (kind: Opening['kind'], at: Point, mainEntrance = false) => {
    if (!currentFloor) return;
    const wall = closestWall(at, currentFloor.rooms);
    if (!wall || wall.distance > 70) {
      setMessage(
        locale === 'fr'
          ? 'Touchez un mur pour ajouter cette ouverture.'
          : 'Tap a wall to add this opening.',
      );
      return;
    }
    const touching = currentFloor.rooms.filter((room) => {
      const nearest = closestWall(wall.point, [room]);
      return nearest && nearest.distance < 8;
    });
    commit((draft) => {
      if (mainEntrance) {
        for (const level of draft.levels)
          for (const opening of level.openings) opening.isMainEntrance = false;
      }
      draft.levels
        .find(({ id }) => id === floorId)!
        .openings.push({
          id: uid(kind.toLowerCase()),
          kind,
          roomIds: touching.slice(0, mainEntrance ? 1 : 2).map(({ id }) => id),
          x: snap(wall.point.x),
          y: snap(wall.point.y),
          width: kind === 'DOOR' ? 90 : 120,
          rotation: wall.rotation,
          isMainEntrance: mainEntrance,
          hostRoomId: wall.room.id,
        });
    });
    setTool('SELECT');
  };

  const onCanvasDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (mode !== 'EDIT') return;
    const at = canvasPoint(event);
    if (movingOpeningId && currentFloor) {
      const opening = currentFloor.openings.find(({ id }) => id === movingOpeningId);
      const relatedRooms = currentFloor.rooms.filter(({ id }) => opening?.roomIds.includes(id));
      const movableRooms =
        relatedRooms.some(({ kind }) => kind === 'HALLWAY') &&
        relatedRooms.some(({ kind }) => kind !== 'HALLWAY')
          ? relatedRooms.filter(({ kind }) => kind !== 'HALLWAY')
          : relatedRooms;
      const wall = closestWall(at, movableRooms);
      if (!opening || !wall || wall.distance > 100) {
        setMessage('Touchez le mur de l’une des pièces reliées pour déplacer cette ouverture.');
        return;
      }
      commit((draft) => {
        const target = draft.levels
          .find(({ id }) => id === currentFloor.id)!
          .openings.find(({ id }) => id === movingOpeningId)!;
        target.x = snap(wall.point.x);
        target.y = snap(wall.point.y);
        target.rotation = wall.rotation;
        target.hostRoomId = wall.room.id;
        target.logical =
          target.roomIds.length === 2
            ? !target.roomIds.every((roomId) => {
                const room = currentFloor.rooms.find(({ id }) => id === roomId);
                return Boolean(room && closestWall(wall.point, [room])!.distance < 8);
              })
            : false;
        for (const placement of draft.placements.filter(
          ({ targetType, targetId }) => targetType === 'OPENING' && targetId === movingOpeningId,
        )) {
          placement.x = target.x;
          placement.y = target.y;
          placement.rotation = target.rotation;
          placement.roomId = target.hostRoomId ?? placement.roomId;
        }
      });
      setMovingOpeningId(null);
      setMessage(
        `${opening.kind === 'WINDOW' ? 'Fenêtre' : opening.kind === 'PASSAGE' ? 'Passage' : 'Porte'} déplacé${opening.kind === 'WINDOW' ? 'e' : ''} sur le mur de ${wall.room.name}.`,
      );
      return;
    }
    if ((event.target as Element).getAttribute?.('data-plan-background') === 'true') {
      setSelectedRoomId(null);
      setSelectedPlacementId(null);
      setSelectedOpeningId(null);
    }
    if (tool === 'ROOM' || tool === 'ROOM_L' || tool === 'CORRIDOR') {
      setDrawStart(at);
      setDrawCurrent(at);
    }
    if (tool === 'DOOR' || tool === 'WINDOW') addOpening(tool, at);
    if (tool === 'MAIN_ENTRANCE') addOpening('DOOR', at, true);
  };
  const connectionTargetAt = (sourceRoomId: string, at: Point) => {
    if (!currentFloor) return null;
    return (
      currentFloor.rooms
        .filter(({ id }) => id !== sourceRoomId)
        .map((room) => ({
          room,
          distance: pointInRoom(at, room) ? 0 : (closestWall(at, [room])?.distance ?? Infinity),
        }))
        .filter(({ distance }) => distance <= 100)
        .sort((first, second) => first.distance - second.distance)[0]?.room ?? null
    );
  };
  const connectRooms = (sourceRoomId: string, at: Point, targetRoomId?: string | null) => {
    if (!currentFloor) return;
    const source = currentFloor.rooms.find(({ id }) => id === sourceRoomId);
    const target = targetRoomId
      ? currentFloor.rooms.find(({ id }) => id === targetRoomId)
      : connectionTargetAt(sourceRoomId, at);
    if (!source || !target) {
      setMessage('Déposez le lien dans une autre pièce du même niveau.');
      return;
    }
    const exists = currentFloor.openings.some(
      ({ kind, roomIds }) =>
        (kind === 'DOOR' || kind === 'PASSAGE') &&
        roomIds.includes(source.id) &&
        roomIds.includes(target.id),
    );
    if (exists) {
      setMessage(`${source.name} et ${target.name} sont déjà reliés.`);
      return;
    }
    const shared = sharedWallPoint(source, target);
    const sourceEdge = roomEdgeToward(source, center(target));
    const sourceBox = bounds(source);
    const logicalRotation =
      Math.abs(sourceEdge.x - sourceBox.x) < 2 ||
      Math.abs(sourceEdge.x - sourceBox.x - sourceBox.width) < 2
        ? 90
        : 0;
    setPendingConnection({
      sourceRoomId: source.id,
      targetRoomId: target.id,
      point: shared
        ? { x: snap(shared.x), y: snap(shared.y) }
        : { x: snap(sourceEdge.x), y: snap(sourceEdge.y) },
      rotation: shared?.rotation ?? logicalRotation,
    });
  };
  const confirmConnection = () => {
    if (!pendingConnection || !currentFloor) return;
    const source = currentFloor.rooms.find(({ id }) => id === pendingConnection.sourceRoomId);
    const target = currentFloor.rooms.find(({ id }) => id === pendingConnection.targetRoomId);
    commit((draft) => {
      draft.levels
        .find(({ id }) => id === currentFloor.id)!
        .openings.push({
          id: uid('link'),
          kind: 'PASSAGE',
          roomIds: [pendingConnection.sourceRoomId, pendingConnection.targetRoomId],
          x: pendingConnection.point.x,
          y: pendingConnection.point.y,
          width: 130,
          rotation: pendingConnection.rotation,
          isMainEntrance: false,
          logical: !sharedWallPoint(source!, target!),
        });
    });
    setSelectedRoomId(pendingConnection.targetRoomId);
    setSelectedOpeningId(null);
    setPendingConnection(null);
    setMessage(`${source?.name} est maintenant relié à ${target?.name}.`);
  };
  const moveStairAnchor = (at: Point) => {
    const drag = stairDrag.current;
    if (!drag) return;
    setPlan((current) => {
      if (!current) return current;
      const next = clone(current);
      const level = next.levels.find(({ rooms }) => rooms.some(({ id }) => id === drag.roomId));
      const room = level?.rooms.find(({ id }) => id === drag.roomId);
      const stair = next.levels
        .flatMap(({ stairs }) => stairs)
        .find(({ id }) => id === drag.stairId);
      if (!room || !stair) return current;
      const rawAnchor = exteriorAnchorAt(room, at);
      const anchor = {
        x: Math.max(0, Math.min(level!.width, rawAnchor.x)),
        y: Math.max(0, Math.min(level!.height, rawAnchor.y)),
      };
      if (drag.endpoint === 'FROM') stair.fromAnchor = anchor;
      else stair.toAnchor = anchor;
      return next;
    });
  };
  const finishStairDrag = () => {
    const drag = stairDrag.current;
    if (!drag) return;
    setHistory((items) => [...items.slice(-29), drag.original]);
    setFuture([]);
    editVersion.current += 1;
    setDirty(true);
    stairDrag.current = null;
  };
  const updateConnectionDrag = (sourceRoomId: string, at: Point) => {
    const target = connectionTargetAt(sourceRoomId, at);
    const snapped = target ? nearestConnectionAnchor(target, at) : at;
    setConnectionDrag((current) =>
      current
        ? {
            ...current,
            current: snapped,
            targetRoomId: target?.id ?? null,
            targetValid: Boolean(target),
          }
        : current,
    );
  };
  const finishConnectionDrag = (sourceRoomId: string, at: Point) => {
    const target = connectionTargetAt(sourceRoomId, at);
    connectRooms(sourceRoomId, at, target?.id);
    setConnectionDrag(null);
  };
  const onCanvasMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const resize = canvasResize.current;
    if (resize) {
      const dx = event.clientX - resize.startClient.x;
      const dy = event.clientY - resize.startClient.y;
      const width = Math.min(
        10_000,
        Math.max(
          1_200,
          snap(resize.originalWidth + (dx * resize.originalWidth) / resize.renderedWidth),
        ),
      );
      const height = Math.min(
        10_000,
        Math.max(
          800,
          snap(resize.originalHeight + (dy * resize.originalHeight) / resize.renderedHeight),
        ),
      );
      setPlan((current) => {
        if (!current) return current;
        const next = clone(current);
        const floor = next.levels.find(({ id }) => id === resize.floorId);
        if (!floor) return current;
        floor.width = width;
        floor.height = height;
        expandFloorToRooms(floor);
        return next;
      });
      return;
    }
    if (stairDrag.current) {
      moveStairAnchor(canvasPoint(event));
      return;
    }
    if (!connectionDrag) {
      if (drawStart) setDrawCurrent(canvasPoint(event));
      return;
    }
    updateConnectionDrag(connectionDrag.sourceRoomId, canvasPoint(event));
  };
  const onCanvasUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const resize = canvasResize.current;
    if (resize) {
      setHistory((items) => [...items.slice(-29), resize.original]);
      setFuture([]);
      editVersion.current += 1;
      setDirty(true);
      canvasResize.current = null;
      return;
    }
    if (stairDrag.current) {
      moveStairAnchor(canvasPoint(event));
      finishStairDrag();
      return;
    }
    if (connectionDrag) return;
    if (!drawStart || (tool !== 'ROOM' && tool !== 'ROOM_L' && tool !== 'CORRIDOR')) return;
    addRoom(drawStart, canvasPoint(event), tool === 'ROOM_L', tool === 'CORRIDOR');
    setDrawStart(null);
    setDrawCurrent(null);
  };

  const deleteRoom = () => {
    if (
      selectedRoom &&
      plan?.placements.some(
        (placement) => placement.roomId === selectedRoom.id && placement.kind === 'SENSOR',
      )
    ) {
      window.alert(
        locale === 'fr'
          ? 'Déplacez ou retirez les capteurs de cette pièce avant de la supprimer.'
          : 'Move or remove the sensors in this room before deleting it.',
      );
      return;
    }
    if (
      !selectedRoom ||
      !window.confirm(
        locale === 'fr' ? `Supprimer « ${selectedRoom.name} » ?` : `Delete “${selectedRoom.name}”?`,
      )
    )
      return;
    commit((draft) => {
      for (const level of draft.levels) {
        level.rooms = level.rooms.filter(({ id }) => id !== selectedRoom.id);
        level.openings = level.openings.filter(({ roomIds }) => !roomIds.includes(selectedRoom.id));
        level.items = level.items.filter(({ roomId }) => roomId !== selectedRoom.id);
        level.stairs = level.stairs.filter(
          ({ fromRoomId, toRoomId }) =>
            fromRoomId !== selectedRoom.id && toRoomId !== selectedRoom.id,
        );
      }
      draft.placements = draft.placements.filter(({ roomId }) => roomId !== selectedRoom.id);
    });
    setSelectedRoomId(null);
  };
  const rotateSelectedRoom = () => {
    if (!selectedRoom || !currentFloor) return;
    commit((draft) => {
      const level = draft.levels.find(({ id }) => id === currentFloor.id)!;
      const room = level.rooms.find(({ id }) => id === selectedRoom.id)!;
      const at = center(room);
      const rotate = ({ x, y }: Point) => ({ x: at.x - (y - at.y), y: at.y + (x - at.x) });
      const rotated = room.geometry.points.map(rotate);
      const rotatedRoom = { ...room, geometry: { ...room.geometry, points: rotated } };
      const box = bounds(rotatedRoom);
      const dx = Math.max(-box.x, Math.min(0, level.width - box.x - box.width));
      const dy = Math.max(-box.y, Math.min(0, level.height - box.y - box.height));
      const transform = (point: Point) => {
        const result = rotate(point);
        return { x: snap(result.x + dx), y: snap(result.y + dy) };
      };
      room.geometry.points = room.geometry.points.map(transform);
      for (const item of level.items.filter(({ roomId }) => roomId === room.id)) {
        Object.assign(item, transform(item));
        item.rotation = (item.rotation + 90) % 360;
      }
      for (const placement of draft.placements.filter(({ roomId }) => roomId === room.id)) {
        Object.assign(placement, transform(placement));
        placement.rotation = (placement.rotation + 90) % 360;
      }
      for (const opening of level.openings.filter(({ roomIds }) => roomIds.includes(room.id))) {
        if (opening.logical && (opening.hostRoomId ?? opening.roomIds[0]) !== room.id) continue;
        Object.assign(opening, transform(opening));
        opening.rotation = (opening.rotation + 90) % 360;
        if (!opening.logical && opening.roomIds.length > 1) opening.roomIds = [room.id];
      }
      for (const stair of draft.levels.flatMap(({ stairs }) => stairs)) {
        if (stair.fromRoomId === room.id) {
          Object.assign(stair, transform(stair));
          if (stair.fromAnchor) stair.fromAnchor = transform(stair.fromAnchor);
        }
        if (stair.toRoomId === room.id && stair.toAnchor)
          stair.toAnchor = transform(stair.toAnchor);
      }
      expandFloorToRooms(level);
    });
  };
  const updateSelectedRoomArea = (area: number) => {
    if (!selectedRoom || !Number.isFinite(area) || area < 0.1) return;
    commit((draft) => {
      draft.levels.flatMap(({ rooms }) => rooms).find(({ id }) => id === selectedRoom.id)!.areaM2 =
        area;
    });
  };
  const addFloor = () => {
    if (!plan) return;
    const floor = Math.max(...plan.levels.map((item) => item.floor), -1) + 1;
    const id = uid('floor');
    commit((draft) =>
      draft.levels.push({
        id,
        name: floor === 0 ? 'Rez-de-chaussée' : floor === 1 ? '1er étage' : `${floor}e étage`,
        floor,
        order: draft.levels.length,
        width: 1_200,
        height: 800,
        scaleCmPerUnit: null,
        rooms: [],
        openings: [],
        stairs: [],
        items: [],
      }),
    );
    setFloorId(id);
    setSelectedRoomId(null);
    setSelectedOpeningId(null);
    setMovingOpeningId(null);
  };
  const deleteCurrentFloor = () => {
    if (!plan || !currentFloor || plan.levels.length <= 1) return;
    const deletingFloor = currentFloor;
    if (!window.confirm(`Supprimer le niveau « ${deletingFloor.name} » et toutes ses pièces ?`))
      return;
    const sorted = [...plan.levels].sort((a, b) => a.order - b.order);
    const fallback = sorted.find(({ id }) => id !== deletingFloor.id)!;
    const removedRoomIds = new Set(deletingFloor.rooms.map(({ id }) => id));
    commit((draft) => {
      draft.levels = draft.levels.filter(({ id }) => id !== deletingFloor.id);
      for (const level of draft.levels) {
        level.stairs = level.stairs.filter(
          ({ fromFloorId, toFloorId, fromRoomId, toRoomId }) =>
            fromFloorId !== deletingFloor.id &&
            toFloorId !== deletingFloor.id &&
            !removedRoomIds.has(fromRoomId) &&
            !removedRoomIds.has(toRoomId),
        );
      }
      draft.placements = draft.placements.filter(
        ({ floorId, roomId }) => floorId !== deletingFloor.id && !removedRoomIds.has(roomId),
      );
      [...draft.levels]
        .sort((a, b) => a.order - b.order)
        .forEach((level, index) => {
          level.order = index;
          level.floor = index;
          level.name =
            index === 0 ? 'Rez-de-chaussée' : index === 1 ? '1er étage' : `${index}e étage`;
        });
    });
    setFloorId(fallback.id);
    setSelectedRoomId(null);
    setSelectedOpeningId(null);
    setMovingOpeningId(null);
  };
  const addStair = (
    fromFloorId: string,
    fromRoomId: string,
    toFloorId: string,
    toRoomId: string,
  ) => {
    if (!plan || !fromFloorId || !fromRoomId || !toFloorId || !toRoomId) return false;
    const departureFloor = plan.levels.find(({ id }) => id === fromFloorId);
    const departureRoom = departureFloor?.rooms.find(({ id }) => id === fromRoomId);
    if (!departureFloor || !departureRoom || fromFloorId === toFloorId) return false;
    const alreadyExists = plan.levels
      .flatMap(({ stairs }) => stairs)
      .some(
        (stair) =>
          (stair.fromRoomId === fromRoomId && stair.toRoomId === toRoomId) ||
          (stair.fromRoomId === toRoomId && stair.toRoomId === fromRoomId),
      );
    if (alreadyExists) {
      setMessage('Ces deux espaces sont déjà reliés par un escalier.');
      return false;
    }
    const at = stairDockPoint(departureRoom, departureFloor);
    const destinationFloor = plan.levels.find(({ id }) => id === toFloorId);
    const destinationRoom = destinationFloor?.rooms.find(({ id }) => id === toRoomId);
    const destinationAt =
      destinationFloor && destinationRoom
        ? stairDockPoint(destinationRoom, destinationFloor)
        : undefined;
    commit((draft) =>
      draft.levels
        .find(({ id }) => id === departureFloor.id)!
        .stairs.push({
          id: uid('stair'),
          fromFloorId: departureFloor.id,
          toFloorId,
          fromRoomId: departureRoom.id,
          toRoomId,
          x: at.x,
          y: at.y,
          width: 100,
          height: 180,
          rotation: 0,
          fromAnchor: at,
          toAnchor: destinationAt,
        }),
    );
    setFloorId(departureFloor.id);
    setSelectedRoomId(departureRoom.id);
    setTool('SELECT');
    setMessage('Escalier ajouté. Déplacez ensuite chaque flèche autour de sa pièce.');
    return true;
  };

  const moveRoom = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = roomDrag.current;
    if (!drag || event.buttons !== 1 || drag.roomId !== event.currentTarget.dataset.roomId) return;
    const originalFloor = drag.original.levels.find(({ id }) => id === drag.floorId)!;
    const originalRoom = originalFloor.rooms.find(({ id }) => id === drag.roomId)!;
    const originalBox = bounds(originalRoom);
    const at = canvasPoint(event);
    const dx = Math.max(
      -originalBox.x,
      Math.min(originalFloor.width - originalBox.x - originalBox.width, at.x - drag.start.x),
    );
    const dy = Math.max(
      -originalBox.y,
      Math.min(originalFloor.height - originalBox.y - originalBox.height, at.y - drag.start.y),
    );
    if (Math.abs(dx) + Math.abs(dy) < 10) return;
    drag.moved = true;
    setPlan(() => {
      const next = clone(drag.original);
      const floor = next.levels.find(({ id }) => id === drag.floorId)!;
      const room = floor.rooms.find(({ id }) => id === drag.roomId)!;
      room.geometry.points = room.geometry.points.map(({ x, y }) => ({
        x: snap(x + dx),
        y: snap(y + dy),
      }));
      for (const placement of next.placements.filter(({ roomId }) => roomId === room.id)) {
        placement.x = snap(placement.x + dx);
        placement.y = snap(placement.y + dy);
      }
      for (const stair of next.levels.flatMap(({ stairs }) => stairs)) {
        if (stair.fromRoomId === room.id) {
          stair.x = snap(stair.x + dx);
          stair.y = snap(stair.y + dy);
          if (stair.fromAnchor)
            stair.fromAnchor = {
              x: snap(stair.fromAnchor.x + dx),
              y: snap(stair.fromAnchor.y + dy),
            };
        }
        if (stair.toRoomId === room.id && stair.toAnchor)
          stair.toAnchor = {
            x: snap(stair.toAnchor.x + dx),
            y: snap(stair.toAnchor.y + dy),
          };
      }
      for (const opening of floor.openings.filter(({ roomIds }) => roomIds.includes(room.id))) {
        if (opening.logical && (opening.hostRoomId ?? opening.roomIds[0]) !== room.id) continue;
        opening.x = snap(opening.x + dx);
        opening.y = snap(opening.y + dy);
        if (!opening.logical && opening.roomIds.length > 1) opening.roomIds = [room.id];
      }
      return next;
    });
  };

  const finishRoomMove = (roomId: string, cancelled = false) => {
    const drag = roomDrag.current;
    if (!drag || drag.roomId !== roomId) return;
    roomDrag.current = null;
    if (drag.moved) {
      setHistory((items) => [...items.slice(-29), drag.original]);
      setFuture([]);
      editVersion.current += 1;
      setDirty(true);
    } else if (cancelled) setPlan(clone(drag.original));
  };

  const resizeRoomOnPlan = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!planResize || event.buttons !== 1) return;
    const at = canvasPoint(event);
    const points = resizedPoints(planResize.original, planResize.handle, planResize.start, at);
    commit((draft) => transformRoomContents(draft, planResize.floorId, planResize.roomId, points));
  };

  const persistSetupPlan = async (candidate: HomePlan) => {
    if (setupPreview) {
      const saved = normalizePlan({ ...candidate, revision: candidate.revision + 1 });
      setPlan(saved);
      setDirty(false);
      setSaveState('SAVED');
      return saved;
    }
    setSaveState('SAVING');
    const response = await fetch('/api/v1/household/plan', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(candidate),
    });
    const result = (await response.json().catch(() => null)) as
      HomePlan | { message?: string } | null;
    if (!response.ok || !result || !('levels' in result)) {
      setSaveState('ERROR');
      throw new Error(
        (result && 'message' in result && result.message) ||
          (locale === 'fr'
            ? 'Le brouillon n’a pas pu être enregistré.'
            : 'The draft could not be saved.'),
      );
    }
    const saved = normalizePlan(result);
    setPlan(saved);
    editVersion.current += 1;
    setDirty(false);
    setSaveState('SAVED');
    onSaved();
    return saved;
  };

  const saveSetupDetails = async (details: HomeSetupDetails) => {
    if (!plan) return;
    setSetupBusy(true);
    setSetupError('');
    try {
      if (!setupPreview) {
        const response = await fetch('/api/v1/household/home', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: details.name,
            type: details.type,
            address: details.address,
            timezone: details.timezone,
          }),
        });
        if (!response.ok) throw new Error('Home details could not be saved');
      }
      const count = Math.max(1, Math.min(4, details.levels));
      if (setupPreview) {
        setPreviewHome({
          name: details.name,
          type: details.type,
          address: details.address,
          timezone: details.timezone,
        });
      }
      const next = clone(plan);
      next.setupDraft = {
        stage: 'ROOMS',
        requestedRooms: (next.setupDraft?.requestedRooms ?? []).map((room) => ({
          ...room,
          floor: Math.min(room.floor, count - 1),
        })),
        tutorialCompleted: false,
      };
      next.levels = Array.from(
        { length: count },
        (_, floor) =>
          next.levels.find((level) => level.floor === floor) ??
          ({
            id: `floor-${floor}`,
            name:
              locale === 'fr'
                ? floor === 0
                  ? 'Rez-de-chaussée'
                  : floor === 1
                    ? '1er étage'
                    : `${floor}e étage`
                : floor === 0
                  ? 'Ground floor'
                  : `Floor ${floor}`,
            floor,
            order: floor,
            width: 1_200,
            height: 800,
            scaleCmPerUnit: null,
            rooms: [],
            openings: [],
            stairs: [],
            items: [],
          } satisfies FloorLayout),
      );
      await persistSetupPlan(next);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const saveRequestedRooms = async (rooms: RequestedRoom[]) => {
    if (!plan) return;
    setSetupBusy(true);
    setSetupError('');
    try {
      const next = clone(plan);
      next.setupDraft = { stage: 'EXAMPLE', requestedRooms: rooms, tutorialCompleted: false };
      await persistSetupPlan(next);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const moveSetupBack = async () => {
    if (!plan?.setupDraft) return;
    setSetupBusy(true);
    setSetupError('');
    try {
      const next = clone(plan);
      next.setupDraft = {
        ...plan.setupDraft,
        stage: plan.setupDraft.stage === 'EXAMPLE' ? 'ROOMS' : 'DETAILS',
      };
      await persistSetupPlan(next);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const beginSetupDrawing = async () => {
    if (!plan?.setupDraft) return;
    setSetupBusy(true);
    setSetupError('');
    try {
      const next = clone(plan);
      next.setupDraft = { ...plan.setupDraft, stage: 'DRAW', tutorialCompleted: true };
      const saved = await persistSetupPlan(next);
      const first = saved.setupDraft?.requestedRooms[0];
      if (first) {
        setSelectedRequestedRoomId(first.id);
        setFloorId(
          saved.levels.find(({ floor }) => floor === first.floor)?.id ?? saved.levels[0]!.id,
        );
        setTool('ROOM');
      }
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const finalizeSetup = async () => {
    if (!plan || !plan.levels.some(({ rooms }) => rooms.length)) return;
    setSetupBusy(true);
    setSetupError('');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setDirty(false);
    try {
      const next = clone(plan);
      next.configured = true;
      next.setupDraft = null;
      await persistSetupPlan(next);
      setSetupConfirmOpen(false);
      if (setupPreview) onSetupPreviewClose?.();
      else void refreshDeviceData();
    } catch (error) {
      setDirty(true);
      setSetupError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const showSetupRecommendations = async () => {
    if (!plan || !plan.levels.some(({ rooms }) => rooms.length)) return;
    setSetupBusy(true);
    setSetupError('');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setDirty(false);
    try {
      const next = clone(plan);
      next.configured = false;
      next.setupDraft = {
        ...(plan.setupDraft ?? { requestedRooms: [], tutorialCompleted: true }),
        stage: 'RECOMMENDATIONS',
      };
      await persistSetupPlan(next);
      if (!setupPreview) await refreshDeviceData();
      setSetupConfirmOpen(false);
    } catch (error) {
      setDirty(true);
      setSetupError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const returnToSetupDrawing = async () => {
    if (!plan?.setupDraft) return;
    setSetupBusy(true);
    setSetupError('');
    try {
      const next = clone(plan);
      next.setupDraft = { ...plan.setupDraft, stage: 'DRAW' };
      await persistSetupPlan(next);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const focusRoom = (roomId: string) => {
    if (!plan) return;
    const level = plan.levels.find(({ rooms }) => rooms.some(({ id }) => id === roomId));
    if (!level) return;
    setFloorId(level.id);
    setSelectedRoomId(roomId);
    setSelectedPlacementId(null);
    setSelectedOpeningId(null);
    setMovingOpeningId(null);
  };

  if (!plan || !currentFloor)
    return saveState === 'ERROR' ? (
      <div className="home-plan-loading">{message}</div>
    ) : (
      <DataLoadingScreen
        locale={locale}
        message={locale === 'fr' ? 'Chargement de votre logement…' : 'Loading your home…'}
      />
    );

  const setupDraft = shouldRunHomeSetup({
    configured: plan.configured,
    installationStatus: home?.installationStatus,
    readOnly,
    preview: setupPreview,
  })
    ? (plan.setupDraft ?? {
        stage: 'DETAILS' as const,
        requestedRooms: [],
        tutorialCompleted: false,
      })
    : null;
  const setupHome = setupPreview
    ? previewHome
    : {
        name: home?.name ?? '',
        type: home?.type ?? (locale === 'fr' ? 'Maison' : 'House'),
        address: home?.address ?? '',
        timezone:
          home?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Paris',
      };

  if (setupDraft?.stage === 'RECOMMENDATIONS') {
    return (
      <SensorCoverageRecommendations
        locale={locale}
        coverage={coverage}
        loading={setupBusy || coverageLoading}
        error={setupError || coverageError}
        onRetry={() => void refreshDeviceData()}
        onBack={() => void returnToSetupDrawing()}
        onContinue={() => void finalizeSetup()}
        {...(setupPreview && onSetupPreviewClose ? { onClose: onSetupPreviewClose } : {})}
      />
    );
  }

  if (setupDraft && setupDraft.stage !== 'DRAW') {
    return (
      <HomeSetupOnboarding
        locale={locale}
        stage={setupDraft.stage}
        home={setupHome}
        floorCount={plan.levels.length}
        requestedRooms={setupDraft.requestedRooms}
        busy={setupBusy}
        error={setupError}
        preview={setupPreview}
        onSaveDetails={saveSetupDetails}
        onSaveRooms={saveRequestedRooms}
        onBack={moveSetupBack}
        onBeginDrawing={beginSetupDrawing}
        onClosePreview={onSetupPreviewClose}
      />
    );
  }

  if (initialStairId && !readOnly && !setupDraft) {
    return (
      <StairEquipmentPage
        stairId={initialStairId}
        plan={plan}
        devices={sensorDevices}
        locale={locale}
        onBack={() => onBack?.()}
        onRefresh={load}
      />
    );
  }

  if (editingRoom && editingFloor && !readOnly && !setupDraft) {
    return (
      <RoomEquipmentPage
        key={editingRoom.id}
        roomId={editingRoom.id}
        plan={plan}
        devices={sensorDevices}
        locale={locale}
        onBack={() => {
          if (initialRoomId && onBack) {
            onBack();
            return;
          }
          setEditingRoomId(null);
        }}
        onEditPlan={() => setEditingRoomId(null)}
        onPlanSaved={(saved) => {
          setPlan(normalizePlan(saved));
          setHistory([]);
          setFuture([]);
          setDirty(false);
          setSaveState('SAVED');
          onSaved();
        }}
        onRefresh={async () => {
          if (saving.current || dirty)
            throw new Error(
              locale === 'fr'
                ? 'Le plan est en cours d’enregistrement.'
                : 'The plan is being saved.',
            );
          const [fresh, freshDevices] = await Promise.all([
            sensorRequest<HomePlan>('/api/v1/household/plan'),
            sensorRequest<SensorDevice[]>('/api/v1/sensor-devices'),
          ]);
          setPlan((current) =>
            current && current.revision > fresh.revision ? current : normalizePlan(fresh),
          );
          setSensorDevices(freshDevices);
          setHistory([]);
          setFuture([]);
          setDirty(false);
          setSaveState('SAVED');
          onSaved();
          void refreshDeviceData();
        }}
      />
    );
  }

  const drawnRoomIds = new Set(plan.levels.flatMap(({ rooms }) => rooms.map(({ id }) => id)));
  const requestedRemaining =
    setupDraft?.requestedRooms.filter(({ id }) => !drawnRoomIds.has(id)).length ?? 0;

  return (
    <section className="home-plan-page">
      {onBack && !setupDraft && (
        <button className="home-plan-back" onClick={onBack}>
          <ArrowLeft /> {locale === 'fr' ? 'Retour à Mon logement' : 'Back to My home'}
        </button>
      )}
      <header className="home-plan-header">
        <div>
          <span className="eyebrow">
            {locale === 'fr' ? 'Jumeau numérique du domicile' : 'Digital home twin'}
          </span>
          <h2>
            {readOnly
              ? locale === 'fr'
                ? 'Plan en direct'
                : 'Live plan'
              : locale === 'fr'
                ? 'Gérer mon logement'
                : 'Manage my home'}
          </h2>
          <p>
            {locale === 'fr'
              ? 'Dessinez le lieu de vie, placez les équipements et observez-les en direct.'
              : 'Draw the home, place devices and monitor them live.'}
          </p>
        </div>
        <div className="home-plan-mode" role="group">
          {!readOnly && (
            <button className={mode === 'EDIT' ? 'active' : ''} onClick={() => setMode('EDIT')}>
              <Grid2X2 /> Aménager
            </button>
          )}
          <button className={mode === 'LIVE' ? 'active' : ''} onClick={() => setMode('LIVE')}>
            <Eye /> En direct
          </button>
        </div>
      </header>

      {setupDraft && (
        <DrawingSetupPanel
          locale={locale}
          requestedRooms={setupDraft.requestedRooms}
          drawnRoomIds={drawnRoomIds}
          selectedRoomId={selectedRequestedRoomId}
          roomCount={drawnRoomIds.size}
          busy={setupBusy || saveState === 'SAVING'}
          error={setupError}
          preview={setupPreview}
          onSelect={(room) => {
            setSelectedRequestedRoomId(room.id);
            setFloorId(
              plan.levels.find(({ floor }) => floor === room.floor)?.id ?? currentFloor.id,
            );
            setTool('ROOM');
            setMessage(
              locale === 'fr'
                ? `Tracez maintenant la forme de « ${room.name} ».`
                : `Now draw the shape of “${room.name}”.`,
            );
          }}
          onShowExample={() => setShowSetupExample(true)}
          onConfirm={() => {
            if (requestedRemaining) setSetupConfirmOpen(true);
            else void showSetupRecommendations();
          }}
          onClosePreview={onSetupPreviewClose}
        />
      )}

      <div className="home-plan-floorbar">
        {[...plan.levels]
          .sort((a, b) => a.order - b.order)
          .map((level) => (
            <button
              key={level.id}
              className={level.id === currentFloor.id ? 'active' : ''}
              onClick={() => {
                setFloorId(level.id);
                setSelectedRoomId(null);
                setSelectedOpeningId(null);
                setMovingOpeningId(null);
              }}
            >
              {level.name}
            </button>
          ))}
        {mode === 'EDIT' && (
          <button className="add-floor" onClick={addFloor}>
            <Plus /> Niveau
          </button>
        )}
        {mode === 'EDIT' && plan.levels.length > 1 && (
          <button className="remove-floor" onClick={deleteCurrentFloor}>
            <Trash2 /> Supprimer ce niveau
          </button>
        )}
        {mode === 'EDIT' && (
          <span className="construction-mode-label">Construction libre · pièces espacées</span>
        )}
        {!readOnly && (
          <span className={`save-indicator ${saveState.toLowerCase()}`}>
            {saveState === 'SAVING' ? (
              <>
                <RotateCcw className="spin" /> Sauvegarde…
              </>
            ) : saveState === 'SAVED' ? (
              <>
                <Save /> Enregistré
              </>
            ) : (
              <button onClick={() => void (saveState === 'CONFLICT' ? load() : save())}>
                {message || 'Réessayer'}
              </button>
            )}
          </span>
        )}
      </div>

      {mode === 'EDIT' && (
        <div className="home-plan-toolbar" aria-label="Outils du plan">
          <button className={tool === 'SELECT' ? 'active' : ''} onClick={() => setTool('SELECT')}>
            <MousePointer2 /> Sélectionner
          </button>
          <button className={tool === 'ROOM' ? 'active' : ''} onClick={() => setTool('ROOM')}>
            <Square /> Pièce
          </button>
          <button className={tool === 'ROOM_L' ? 'active' : ''} onClick={() => setTool('ROOM_L')}>
            <Grid2X2 /> Pièce en L
          </button>
          <button
            className={tool === 'CORRIDOR' ? 'active' : ''}
            onClick={() => setTool('CORRIDOR')}
          >
            <MoveHorizontal /> Couloir
          </button>
          <button
            className={tool === 'CONNECT' ? 'active' : ''}
            onClick={() => {
              setTool('CONNECT');
              setMessage(
                'Tirez un connecteur vers une pièce voisine. Toute la pièce sert de cible.',
              );
            }}
          >
            <Link2 /> Relier les pièces
          </button>
          <button
            disabled={plan.levels.length < 2}
            className={stairModalOpen ? 'active' : ''}
            onClick={() => {
              setTool('SELECT');
              setStairModalOpen(true);
            }}
          >
            <MoveUpRight /> Escalier
          </button>
          <i />
          <button disabled={!history.length} onClick={undo} title="Annuler">
            <Undo2 />
          </button>
          <button disabled={!future.length} onClick={redo} title="Rétablir">
            <Redo2 />
          </button>
        </div>
      )}

      <div className={`home-plan-workspace ${mode === 'LIVE' ? 'is-live' : ''}`}>
        <div className="home-plan-canvas-wrap">
          {mode === 'LIVE' && presence?.roomId && (
            <div className={`presence-banner confidence-${presence.confidence.toLowerCase()}`}>
              <span />
              <strong>
                {presence.state === 'AMBIGUOUS'
                  ? 'Plusieurs présences possibles'
                  : 'Présence probable'}
              </strong>
              <small>
                {presence.durationSeconds !== null
                  ? `depuis ${Math.max(1, Math.round(presence.durationSeconds / 60))} min`
                  : ''}{' '}
                · confiance{' '}
                {presence.confidence === 'HIGH'
                  ? 'élevée'
                  : presence.confidence === 'MEDIUM'
                    ? 'moyenne'
                    : 'faible'}
              </small>
            </div>
          )}
          <svg
            ref={canvasRef}
            className={`home-plan-canvas tool-${tool.toLowerCase()}`}
            viewBox={`0 0 ${currentFloor.width} ${currentFloor.height}`}
            style={{ aspectRatio: `${currentFloor.width} / ${currentFloor.height}` }}
            role="application"
            aria-label={`Plan du niveau ${currentFloor.name}`}
            onPointerDownCapture={(event) => {
              if (!movingOpeningId) return;
              onCanvasDown(event);
              event.stopPropagation();
            }}
            onPointerDown={onCanvasDown}
            onPointerMoveCapture={onCanvasMove}
            onPointerUpCapture={onCanvasUp}
            onPointerCancel={() => {
              setConnectionDrag(null);
              finishStairDrag();
            }}
          >
            <defs>
              <pattern id="plan-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#d8e0e3" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#plan-grid)" data-plan-background="true" />
            {currentFloor.openings
              .filter(({ kind, roomIds }) => kind === 'PASSAGE' && roomIds.length === 2)
              .map((opening) => {
                const from = currentFloor.rooms.find(({ id }) => id === opening.roomIds[0]);
                const to = currentFloor.rooms.find(({ id }) => id === opening.roomIds[1]);
                if (!from || !to) return null;
                const start = roomEdgeToward(from, center(to));
                const end = roomEdgeToward(to, center(from));
                const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
                const bend = Math.max(
                  45,
                  (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) * 0.42,
                );
                return (
                  <g
                    className={`room-connection-string ${opening.kind.toLowerCase()}`}
                    key={`link-${opening.id}`}
                  >
                    <path
                      d={
                        horizontal
                          ? `M ${start.x} ${start.y} C ${start.x + Math.sign(end.x - start.x) * bend} ${start.y}, ${end.x - Math.sign(end.x - start.x) * bend} ${end.y}, ${end.x} ${end.y}`
                          : `M ${start.x} ${start.y} C ${start.x} ${start.y + Math.sign(end.y - start.y) * bend}, ${end.x} ${end.y - Math.sign(end.y - start.y) * bend}, ${end.x} ${end.y}`
                      }
                    />
                    <circle cx={start.x} cy={start.y} r="8" />
                    <circle cx={end.x} cy={end.y} r="8" />
                  </g>
                );
              })}
            {connectionDrag && (
              <path
                className="connection-string-preview"
                d={`M ${connectionDrag.start.x} ${connectionDrag.start.y} C ${connectionDrag.start.x + 70} ${connectionDrag.start.y - 55}, ${connectionDrag.current.x - 70} ${connectionDrag.current.y - 55}, ${connectionDrag.current.x} ${connectionDrag.current.y}`}
              />
            )}
            {drawStart && drawCurrent && (
              <polygon
                className="room-drawing-preview"
                points={roomDraftPoints(
                  drawStart,
                  drawCurrent,
                  tool === 'ROOM_L',
                  tool === 'CORRIDOR',
                )
                  .map(({ x, y }) => `${x},${y}`)
                  .join(' ')}
              />
            )}
            {currentFloor.rooms.map((room) => {
              const at = center(room);
              const activePresence = mode === 'LIVE' && presence?.roomId === room.id;
              return (
                <g
                  key={room.id}
                  data-room-id={room.id}
                  className={`plan-room ${selectedRoomId === room.id ? 'selected' : ''} ${activePresence ? 'has-presence' : ''} ${connectionDrag?.sourceRoomId === room.id ? 'connection-source' : ''} ${connectionDrag?.targetRoomId === room.id ? (connectionDrag.targetValid ? 'connection-target' : 'connection-target-invalid') : ''}`}
                  onPointerDown={(event) => {
                    if (tool === 'CONNECT') return;
                    if (tool !== 'SELECT') return;
                    event.stopPropagation();
                    if (mode === 'EDIT') {
                      setSelectedRoomId(room.id);
                      setSelectedOpeningId(null);
                      setMovingOpeningId(null);
                      event.currentTarget.setPointerCapture(event.pointerId);
                      roomDrag.current = {
                        roomId: room.id,
                        floorId: currentFloor.id,
                        start: canvasPoint(event),
                        original: clone(plan),
                        moved: false,
                      };
                    }
                    setSelectedPlacementId(null);
                  }}
                  onPointerMove={moveRoom}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    if (tool === 'CONNECT') return;
                    finishRoomMove(room.id);
                  }}
                  onPointerCancel={() => finishRoomMove(room.id, true)}
                >
                  <polygon points={polygon(room)} fill={room.geometry.color} />
                  <text x={at.x} y={at.y - 4} textAnchor="middle">
                    {room.name}
                  </text>
                  <text className="room-size" x={at.x} y={at.y + 24} textAnchor="middle">
                    {roomAreaM2(room).toFixed(1)} m²
                    {currentFloor.scaleCmPerUnit ? '' : ' env.'}
                  </text>
                  {mode === 'EDIT' &&
                    tool === 'CONNECT' &&
                    roomConnectionAnchors(room).map((anchor) => (
                      <g
                        className={`room-link-anchor ${connectionDrag?.sourceRoomId === room.id ? 'is-source' : ''}`}
                        key={anchor.id}
                      >
                        <circle
                          className="anchor-hit"
                          cx={anchor.x}
                          cy={anchor.y}
                          r="34"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            const start = { x: anchor.x, y: anchor.y };
                            setConnectionDrag({
                              sourceRoomId: room.id,
                              start,
                              current: start,
                              targetRoomId: null,
                              targetValid: false,
                            });
                          }}
                          onPointerMove={(event) => {
                            if (event.buttons !== 1) return;
                            updateConnectionDrag(room.id, canvasPoint(event));
                          }}
                          onPointerUp={(event) => {
                            event.stopPropagation();
                            finishConnectionDrag(room.id, canvasPoint(event));
                          }}
                        />
                        <circle className="anchor-dot" cx={anchor.x} cy={anchor.y} r="7" />
                      </g>
                    ))}
                  {mode === 'EDIT' &&
                    tool === 'SELECT' &&
                    selectedRoomId === room.id &&
                    resizeHandles(room).map((handle) => (
                      <circle
                        key={handle.id}
                        cx={handle.x}
                        cy={handle.y}
                        r="13"
                        className={`room-resize-handle handle-${handle.id.toLowerCase()}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setPlanResize({
                            roomId: room.id,
                            floorId: currentFloor.id,
                            handle: handle.id,
                            start: canvasPoint(event),
                            original: clone(room),
                          });
                        }}
                        onPointerMove={resizeRoomOnPlan}
                        onPointerUp={() => setPlanResize(null)}
                      />
                    ))}
                </g>
              );
            })}
            {tool !== 'CONNECT' &&
              plan.levels
                .flatMap(({ stairs }) => stairs)
                .filter(
                  ({ fromFloorId, toFloorId }) =>
                    fromFloorId === currentFloor.id || toFloorId === currentFloor.id,
                )
                .map((stair) => {
                  const isDeparture = stair.fromFloorId === currentFloor.id;
                  const localRoomId = isDeparture ? stair.fromRoomId : stair.toRoomId;
                  const destinationFloorId = isDeparture ? stair.toFloorId : stair.fromFloorId;
                  const destinationRoomId = isDeparture ? stair.toRoomId : stair.fromRoomId;
                  const destinationFloor = plan.levels.find(({ id }) => id === destinationFloorId);
                  const goesUp =
                    (destinationFloor?.floor ?? currentFloor.floor) > currentFloor.floor;
                  const destinationRoom = destinationFloor?.rooms.find(
                    ({ id }) => id === destinationRoomId,
                  );
                  const localRoom = currentFloor.rooms.find(({ id }) => id === localRoomId);
                  if (!localRoom) return null;
                  const at =
                    (isDeparture ? stair.fromAnchor : stair.toAnchor) ??
                    stairDockPoint(localRoom, currentFloor);
                  const roomAt = roomEdgeToward(localRoom, at);
                  const tooltipLeft = at.x > currentFloor.width - 270;
                  return (
                    <g key={`${stair.id}-${currentFloor.id}`} className="plan-stair-link">
                      <path
                        className="stair-string"
                        d={`M ${roomAt.x} ${roomAt.y} C ${(roomAt.x + at.x) / 2} ${roomAt.y - 35}, ${(roomAt.x + at.x) / 2} ${at.y - 35}, ${at.x} ${at.y}`}
                      />
                      <g
                        className={`plan-stair-port ${goesUp ? 'up' : 'down'}`}
                        transform={`translate(${at.x} ${at.y})`}
                        onPointerDown={(event) => {
                          if (mode !== 'EDIT') return;
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          stairDrag.current = {
                            stairId: stair.id,
                            endpoint: isDeparture ? 'FROM' : 'TO',
                            roomId: localRoom.id,
                            original: clone(plan),
                          };
                        }}
                      >
                        <circle r="17" />
                        <path d={goesUp ? 'M -7 3 L 0 -4 L 7 3' : 'M -7 -3 L 0 4 L 7 -3'} />
                        <g
                          className={`stair-hover-card ${tooltipLeft ? 'align-left' : ''}`}
                          transform={`translate(${tooltipLeft ? -238 : 26} -32)`}
                        >
                          <rect width="212" height="45" rx="11" />
                          <text x="13" y="19">
                            Escalier vers {destinationFloor?.name}
                          </text>
                          <text className="stair-hover-room" x="13" y="34">
                            {destinationRoom?.name}
                          </text>
                        </g>
                      </g>
                    </g>
                  );
                })}
            {plan.placements
              .filter(({ floorId: id }) => id === currentFloor.id)
              .map((placement) => {
                const sensor = sensorMap.get(placement.equipmentId);
                const camera = cameraMap.get(placement.equipmentId);
                const online = (sensor?.status ?? camera?.status) === 'ONLINE';
                return (
                  <g
                    key={placement.id}
                    className={`plan-equipment ${placement.kind.toLowerCase()} ${online ? 'online' : 'offline'} ${selectedPlacementId === placement.id ? 'selected' : ''}`}
                    transform={`translate(${placement.x} ${placement.y})`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (mode === 'LIVE' && placement.kind === 'CAMERA') {
                        const item = cameraMap.get(placement.equipmentId);
                        if (item && !item.privacyMode) onOpenCamera(item.id);
                        return;
                      }
                      setSelectedPlacementId(placement.id);
                      setSelectedRoomId(null);
                      setSelectedOpeningId(null);
                      setMovingOpeningId(null);
                    }}
                    onPointerMove={(event) => {
                      if (mode !== 'EDIT' || event.buttons !== 1) return;
                      const at = canvasPoint(event);
                      const room = currentFloor.rooms.find((item) => pointInRoom(at, item));
                      if (!room) return;
                      commit((draft) => {
                        const target = draft.placements.find(({ id }) => id === placement.id)!;
                        Object.assign(target, { x: at.x, y: at.y, roomId: room.id });
                      });
                    }}
                  >
                    <circle r="22" />
                    <text textAnchor="middle" y="6">
                      {placement.kind === 'CAMERA' ? '◉' : '●'}
                    </text>
                    <title>
                      {sensor?.device?.name ?? sensor?.entityId ?? camera?.name}
                      {sensor?.lastValue ? ` · ${JSON.stringify(sensor.lastValue)}` : ''}
                    </title>
                  </g>
                );
              })}
            {mode === 'EDIT' && (
              <g
                className="plan-canvas-resize"
                transform={`translate(${currentFloor.width - 27} ${currentFloor.height - 27})`}
                role="button"
                aria-label="Agrandir la zone du plan"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const box = canvasRef.current?.getBoundingClientRect();
                  if (!box) return;
                  canvasResize.current = {
                    floorId: currentFloor.id,
                    startClient: { x: event.clientX, y: event.clientY },
                    originalWidth: currentFloor.width,
                    originalHeight: currentFloor.height,
                    renderedWidth: Math.max(1, box.width),
                    renderedHeight: Math.max(1, box.height),
                    original: clone(plan),
                  };
                }}
              >
                <rect width="27" height="27" rx="7" />
                <path d="M 9 21 L 21 9 M 15 21 L 21 15" />
              </g>
            )}
          </svg>
          <PlanLegend plan={plan} floor={currentFloor} />
          {mode === 'EDIT' && (tool === 'ROOM' || tool === 'ROOM_L' || tool === 'CORRIDOR') && (
            <div className="canvas-hint">Touchez et faites glisser pour dessiner la pièce.</div>
          )}
          {mode === 'EDIT' && tool === 'CONNECT' && (
            <div className="canvas-hint">
              Tirez un connecteur vers une pièce voisine, puis relâchez n’importe où dessus.
            </div>
          )}
        </div>

        {mode === 'EDIT' && (
          <aside className="home-plan-inspector">
            {selectedRoom ? (
              <div className="plan-room-summary">
                <div className="inspector-heading">
                  <div>
                    <span className="eyebrow">Pièce aménagée</span>
                    <h3>{selectedRoom.name}</h3>
                  </div>
                  <button onClick={deleteRoom} aria-label="Supprimer">
                    <Trash2 />
                  </button>
                </div>
                <label className="room-field">
                  <span>Nom de la pièce</span>
                  <input
                    value={selectedRoom.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      commit((draft) => {
                        draft.levels
                          .flatMap(({ rooms }) => rooms)
                          .find(({ id }) => id === selectedRoom.id)!.name = name;
                      });
                    }}
                  />
                </label>
                <label className="room-field">
                  <span>Type prédéfini</span>
                  <select
                    value={selectedRoom.kind}
                    onChange={(event) => {
                      const kind = event.target.value;
                      const definition = roomKinds.find(([value]) => value === kind);
                      commit((draft) => {
                        const target = draft.levels
                          .flatMap(({ rooms }) => rooms)
                          .find(({ id }) => id === selectedRoom.id)!;
                        const genericName = /^(Pièce|Couloir)\s*\d*$/i.test(target.name);
                        target.kind = kind;
                        if (genericName && definition) target.name = definition[1];
                      });
                    }}
                  >
                    {roomKinds.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="room-area-editor">
                  <span>Surface de la pièce</span>
                  <div>
                    <input
                      key={`${selectedRoom.id}-${roomAreaM2(selectedRoom).toFixed(1)}`}
                      type="number"
                      min="1"
                      step="0.5"
                      defaultValue={roomAreaM2(selectedRoom).toFixed(1)}
                      onBlur={(event) => updateSelectedRoomArea(Number(event.target.value))}
                    />
                    <strong>m²</strong>
                  </div>
                  <small>
                    Surface réelle, indépendante de la taille visuelle utilisée sur le plan.
                  </small>
                </label>
                <p className="room-summary-help">
                  Retrouvez les capteurs de cette pièce et ajoutez les équipements utiles.
                </p>
                <button className="rotate-room" onClick={rotateSelectedRoom}>
                  <RotateCcw /> Pivoter la pièce de 90°
                </button>
                <button
                  className="open-room-studio"
                  disabled={dirty || saveState !== 'SAVED'}
                  onClick={() => setEditingRoomId(selectedRoom.id)}
                >
                  Aménager cette pièce →
                </button>
              </div>
            ) : selectedOpening ? (
              <OpeningInspector
                opening={selectedOpening}
                floor={currentFloor}
                moving={movingOpeningId === selectedOpening.id}
                onMove={() => {
                  setMovingOpeningId(selectedOpening.id);
                  setMessage('Touchez le mur où vous souhaitez placer cette ouverture.');
                }}
                onRemove={() => {
                  commit((draft) => {
                    const floor = draft.levels.find(({ id }) => id === currentFloor.id)!;
                    floor.openings = floor.openings.filter(({ id }) => id !== selectedOpening.id);
                    for (const placement of draft.placements.filter(
                      ({ targetType, targetId }) =>
                        targetType === 'OPENING' && targetId === selectedOpening.id,
                    )) {
                      placement.targetType = 'ROOM';
                      placement.targetId = placement.roomId;
                      placement.openingId = null;
                    }
                  });
                  setSelectedOpeningId(null);
                  setMovingOpeningId(null);
                  setMessage('Ouverture supprimée. Vous pouvez l’annuler avec Cmd + Z.');
                }}
              />
            ) : selectedPlacementId ? (
              <PlacementInspector
                plan={plan}
                placementId={selectedPlacementId}
                onRemove={() => {
                  commit((draft) => {
                    draft.placements = draft.placements.filter(
                      ({ id }) => id !== selectedPlacementId,
                    );
                  });
                  setSelectedPlacementId(null);
                }}
              />
            ) : (
              <div className="inspector-empty">
                <MousePointer2 />
                <h3>Sélectionnez une pièce</h3>
                <p>Modifiez son nom, ses dimensions et son aménagement.</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {pendingConnection && (
        <div className="plan-confirm-backdrop" role="presentation">
          <div className="plan-confirm-modal" role="dialog" aria-modal="true">
            <span className="understanding-icon route">
              <MoveHorizontal />
            </span>
            <div>
              <span className="eyebrow">Compréhension du plan</span>
              <h3>Relier ces deux pièces ?</h3>
              <p>
                {currentFloor.rooms.find(({ id }) => id === pendingConnection.sourceRoomId)?.name} →{' '}
                {currentFloor.rooms.find(({ id }) => id === pendingConnection.targetRoomId)?.name}
              </p>
            </div>
            <p>Élise saura simplement que ces deux pièces communiquent.</p>
            <footer>
              <button className="secondary" onClick={() => setPendingConnection(null)}>
                Annuler
              </button>
              <button className="primary" onClick={confirmConnection}>
                <Link2 /> Relier les pièces
              </button>
            </footer>
          </div>
        </div>
      )}

      {stairModalOpen && (
        <StairModal
          key={`${currentFloor.id}:${selectedRoomId ?? 'none'}`}
          levels={plan.levels}
          initialFloorId={currentFloor.id}
          initialRoomId={selectedRoomId}
          onClose={() => setStairModalOpen(false)}
          onAdd={(fromFloorId, fromRoomId, toFloorId, toRoomId) => {
            if (addStair(fromFloorId, fromRoomId, toFloorId, toRoomId)) {
              setStairModalOpen(false);
            }
          }}
        />
      )}

      <PlanUnderstandingPanel
        plan={plan}
        locale={locale}
        updating={dirty || saveState === 'SAVING'}
        onFocusRoom={focusRoom}
        onFocusFloor={(id) => {
          setFloorId(id);
          setSelectedRoomId(null);
          setSelectedOpeningId(null);
          setMovingOpeningId(null);
        }}
      />

      {showSetupExample && (
        <ExampleOverlay locale={locale} onClose={() => setShowSetupExample(false)} />
      )}
      {setupConfirmOpen && (
        <div className="setup-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="setup-confirm-card">
            <span>
              <AlertTriangle />
            </span>
            <h2>{locale === 'fr' ? 'Confirmer ce premier plan ?' : 'Confirm this first plan?'}</h2>
            <p>
              {locale === 'fr'
                ? `${requestedRemaining} pièce(s) de votre liste ne sont pas encore dessinées. Vous pourrez les ajouter ensuite depuis Mon logement.`
                : `${requestedRemaining} room(s) from your list have not been drawn yet. You can add them later from My home.`}
            </p>
            <div>
              <button type="button" onClick={() => setSetupConfirmOpen(false)}>
                {locale === 'fr' ? 'Continuer à dessiner' : 'Keep drawing'}
              </button>
              <button
                type="button"
                className="home-setup-primary"
                disabled={setupBusy}
                onClick={() => void showSetupRecommendations()}
              >
                {locale === 'fr' ? 'Confirmer mon plan' : 'Confirm my plan'} <ArrowRight />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function PlanLegend({ plan, floor }: { plan: HomePlan; floor: FloorLayout }) {
  const floorPlacements = plan.placements.filter(({ floorId }) => floorId === floor.id);
  const hasStair = plan.levels
    .flatMap(({ stairs }) => stairs)
    .some(({ fromFloorId, toFloorId }) => fromFloorId === floor.id || toFloorId === floor.id);
  const hasSensor = floorPlacements.some(({ kind }) => kind === 'SENSOR');
  const hasCamera = floorPlacements.some(({ kind }) => kind === 'CAMERA');
  if (!hasStair && !hasSensor && !hasCamera) return null;
  return (
    <aside className="plan-legend" aria-label="Légende du plan">
      <strong>Légende</strong>
      <div>
        {hasStair && (
          <span>
            <i className="legend-stair">⌃</i> Escalier
          </span>
        )}
        {hasSensor && (
          <span>
            <i className="legend-device sensor">●</i> Capteur
          </span>
        )}
        {hasCamera && (
          <span>
            <i className="legend-device camera">◉</i> Caméra
          </span>
        )}
      </div>
    </aside>
  );
}

export function PlanUnderstandingPanel({
  plan,
  locale,
  updating,
  onFocusRoom,
  onFocusFloor,
}: {
  plan: HomePlan;
  locale: 'fr' | 'en';
  updating: boolean;
  onFocusRoom: (roomId: string) => void;
  onFocusFloor: (floorId: string) => void;
}) {
  const rooms = new Map(
    plan.levels.flatMap((level) =>
      level.rooms.map((room) => [room.id, { ...room, level }] as const),
    ),
  );
  const levels = new Map(plan.levels.map((level) => [level.id, level]));
  const list = (names: string[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
  const roomName = (id: string) =>
    rooms.get(id)?.name ?? (locale === 'fr' ? 'pièce inconnue' : 'unknown room');
  const adjacencyGroups = new Map<string, Set<string>>();
  for (const adjacency of plan.adjacencies) {
    const [firstId, secondId] = adjacency.roomIds;
    const first = rooms.get(firstId);
    const second = rooms.get(secondId);
    const owner =
      first?.kind === 'HALLWAY' ? firstId : second?.kind === 'HALLWAY' ? secondId : firstId;
    const neighbour = owner === firstId ? secondId : firstId;
    const group = adjacencyGroups.get(owner) ?? new Set<string>();
    group.add(neighbour);
    adjacencyGroups.set(owner, group);
  }
  const roomLinks = plan.connections.filter(({ kind }) => kind === 'DOOR' || kind === 'PASSAGE');
  const stairs = plan.levels.flatMap(({ stairs }) => stairs);
  const issueCount =
    plan.understanding.isolatedRoomIds.length +
    plan.understanding.adjacentWithoutPassage.length +
    plan.understanding.nearAdjacencyIds.length +
    plan.understanding.floorsWithoutStairs.length +
    plan.understanding.incompleteStairIds.length;

  return (
    <div className="home-plan-understanding">
      <section
        className="floor-routes"
        aria-label={locale === 'fr' ? 'Parcours entre les niveaux' : 'Routes between floors'}
      >
        <header>
          <div>
            <span className="understanding-icon route">
              <Route />
            </span>
            <div>
              <span className="eyebrow">
                {locale === 'fr' ? 'Circulation verticale' : 'Vertical circulation'}
              </span>
              <h3>{locale === 'fr' ? 'Parcours entre les niveaux' : 'Routes between floors'}</h3>
            </div>
          </div>
          <small>
            {stairs.length} {locale === 'fr' ? 'liaison(s)' : 'route(s)'}
          </small>
        </header>
        {stairs.length ? (
          <div className="floor-route-list">
            {stairs.map((stair) => {
              const fromFloor = levels.get(stair.fromFloorId);
              const toFloor = levels.get(stair.toFloorId);
              const goingUp = (toFloor?.floor ?? 0) > (fromFloor?.floor ?? 0);
              return (
                <article className="floor-route-card" key={stair.id}>
                  <button onClick={() => onFocusRoom(stair.fromRoomId)}>
                    <small>{locale === 'fr' ? 'Départ' : 'Start'}</small>
                    <strong>{fromFloor?.name}</strong>
                    <span>{roomName(stair.fromRoomId)}</span>
                  </button>
                  <div className="route-direction">
                    {goingUp ? <ArrowUp /> : <ArrowDown />}
                    <span>
                      {locale === 'fr' ? (goingUp ? 'monte' : 'descend') : goingUp ? 'up' : 'down'}
                    </span>
                  </div>
                  <button onClick={() => onFocusRoom(stair.toRoomId)}>
                    <small>{locale === 'fr' ? 'Arrivée' : 'Arrival'}</small>
                    <strong>{toFloor?.name}</strong>
                    <span>{roomName(stair.toRoomId)}</span>
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="understanding-empty">
            {locale === 'fr'
              ? plan.levels.length > 1
                ? 'Aucun escalier ne relie encore les niveaux.'
                : 'Ajoutez un niveau pour construire un parcours vertical.'
              : plan.levels.length > 1
                ? 'No stairs connect the floors yet.'
                : 'Add a floor to create a vertical route.'}
          </p>
        )}
      </section>

      <section className="plan-understanding-card">
        <header>
          <div>
            <span className={`understanding-icon ${issueCount ? 'attention' : 'ready'}`}>
              {issueCount ? <AlertTriangle /> : <CircleCheck />}
            </span>
            <div>
              <span className="eyebrow">
                {locale === 'fr' ? 'Lecture structurelle' : 'Structural reading'}
              </span>
              <h3>{locale === 'fr' ? 'Ce qu’Élise comprend' : 'What Élise understands'}</h3>
            </div>
          </div>
          <small className={updating ? 'is-updating' : ''}>
            {updating
              ? locale === 'fr'
                ? 'Mise à jour…'
                : 'Updating…'
              : issueCount
                ? locale === 'fr'
                  ? `${issueCount} point(s) à vérifier`
                  : `${issueCount} item(s) to check`
                : locale === 'fr'
                  ? 'Plan cohérent'
                  : 'Plan consistent'}
          </small>
        </header>

        <div className="understanding-grid">
          <div className="understanding-statements">
            {plan.understanding.levels.map((metric) => {
              const level = levels.get(metric.floorId);
              const area = metric.areaM2.toLocaleString(locale, { maximumFractionDigits: 1 });
              return (
                <button key={metric.floorId} onClick={() => onFocusFloor(metric.floorId)}>
                  <CircleCheck />
                  <span>
                    {locale === 'fr'
                      ? `${level?.name} contient ${metric.roomCount} pièce(s), pour ${metric.approximate ? 'environ ' : ''}${area} m² dessinés.`
                      : `${level?.name} contains ${metric.roomCount} room(s), covering ${metric.approximate ? 'about ' : ''}${area} m².`}
                  </span>
                </button>
              );
            })}
            {[...adjacencyGroups].map(([ownerId, neighbourIds]) => (
              <button key={`adjacency-${ownerId}`} onClick={() => onFocusRoom(ownerId)}>
                <Link2 />
                <span>
                  {locale === 'fr'
                    ? `${roomName(ownerId)} partage un mur avec ${list([...neighbourIds].map(roomName))}.`
                    : `${roomName(ownerId)} shares a wall with ${list([...neighbourIds].map(roomName))}.`}
                </span>
              </button>
            ))}
            {roomLinks.map((connection) => (
              <button key={connection.id} onClick={() => onFocusRoom(connection.fromRoomId)}>
                <MoveHorizontal />
                <span>
                  {locale === 'fr'
                    ? `${roomName(connection.fromRoomId)} est relié à ${roomName(connection.toRoomId)}.`
                    : `${roomName(connection.fromRoomId)} is linked to ${roomName(connection.toRoomId)}.`}
                </span>
              </button>
            ))}
            {stairs.map((stair) => {
              const fromFloor = levels.get(stair.fromFloorId);
              const toFloor = levels.get(stair.toFloorId);
              const goingUp = (toFloor?.floor ?? 0) > (fromFloor?.floor ?? 0);
              return (
                <button key={`statement-${stair.id}`} onClick={() => onFocusRoom(stair.fromRoomId)}>
                  {goingUp ? <ArrowUp /> : <ArrowDown />}
                  <span>
                    {locale === 'fr'
                      ? `Un escalier ${goingUp ? 'monte' : 'descend'} de ${roomName(stair.fromRoomId)} vers ${roomName(stair.toRoomId)} (${toFloor?.name}).`
                      : `Stairs go ${goingUp ? 'up' : 'down'} from ${roomName(stair.fromRoomId)} to ${roomName(stair.toRoomId)} (${toFloor?.name}).`}
                  </span>
                </button>
              );
            })}
          </div>

          <aside className={`understanding-issues ${issueCount ? '' : 'is-clear'}`}>
            <h4>{locale === 'fr' ? 'À vérifier' : 'Check'}</h4>
            {!issueCount && (
              <p>
                <CircleCheck />{' '}
                {locale === 'fr'
                  ? 'Toutes les pièces sont correctement reliées.'
                  : 'All rooms are properly connected.'}
              </p>
            )}
            {plan.understanding.isolatedRoomIds.map((roomId) => (
              <button key={`isolated-${roomId}`} onClick={() => onFocusRoom(roomId)}>
                <AlertTriangle />{' '}
                {locale === 'fr'
                  ? `${roomName(roomId)} n’est reliée à aucune autre pièce.`
                  : `${roomName(roomId)} is not connected to another room.`}
              </button>
            ))}
            {plan.understanding.adjacentWithoutPassage.map(([first, second]) => (
              <button key={`missing-${first}-${second}`} onClick={() => onFocusRoom(first)}>
                <AlertTriangle />{' '}
                {locale === 'fr'
                  ? `${roomName(first)} et ${roomName(second)} sont accolées, mais aucune liaison n’est indiquée.`
                  : `${roomName(first)} and ${roomName(second)} touch, but no link is defined.`}
              </button>
            ))}
            {plan.understanding.nearAdjacencyIds.map((adjacencyId) => {
              const adjacency = plan.adjacencies.find(({ id }) => id === adjacencyId);
              if (!adjacency) return null;
              return (
                <button
                  key={`near-${adjacencyId}`}
                  onClick={() => onFocusRoom(adjacency.roomIds[0])}
                >
                  <AlertTriangle />{' '}
                  {locale === 'fr'
                    ? `Les murs de ${roomName(adjacency.roomIds[0])} et ${roomName(adjacency.roomIds[1])} semblent accolés : alignement à confirmer.`
                    : `The walls of ${roomName(adjacency.roomIds[0])} and ${roomName(adjacency.roomIds[1])} nearly touch; confirm their alignment.`}
                </button>
              );
            })}
            {plan.understanding.floorsWithoutStairs.map((floorId) => (
              <button key={`floor-${floorId}`} onClick={() => onFocusFloor(floorId)}>
                <AlertTriangle />{' '}
                {locale === 'fr'
                  ? `${levels.get(floorId)?.name} n’est relié à aucun autre niveau.`
                  : `${levels.get(floorId)?.name} is not connected to another floor.`}
              </button>
            ))}
            {plan.understanding.incompleteStairIds.map((stairId) => (
              <button
                key={`incomplete-stair-${stairId}`}
                onClick={() => onFocusFloor(plan.levels[0]?.id ?? '')}
              >
                <AlertTriangle />{' '}
                {locale === 'fr'
                  ? 'Un escalier est incomplet : choisissez ses niveaux et ses pièces d’arrivée.'
                  : 'A staircase is incomplete: choose its floors and arrival rooms.'}
              </button>
            ))}
          </aside>
        </div>
      </section>
    </div>
  );
}

export function StairModal({
  levels,
  initialFloorId,
  initialRoomId,
  onClose,
  onAdd,
}: {
  levels: FloorLayout[];
  initialFloorId: string;
  initialRoomId: string | null;
  onClose: () => void;
  onAdd: (fromFloorId: string, fromRoomId: string, toFloorId: string, toRoomId: string) => void;
}) {
  const initialFloor = levels.find(({ id }) => id === initialFloorId) ?? levels[0];
  const [departureFloorId, setDepartureFloorId] = useState(initialFloor?.id ?? '');
  const departureFloor = levels.find(({ id }) => id === departureFloorId);
  const [departureRoomId, setDepartureRoomId] = useState(
    departureFloor?.rooms.some(({ id }) => id === initialRoomId)
      ? initialRoomId!
      : (departureFloor?.rooms[0]?.id ?? ''),
  );
  const targetFloors = levels.filter(({ id }) => id !== departureFloorId);
  const [targetFloorId, setTargetFloorId] = useState(targetFloors[0]?.id ?? '');
  const targetFloor = levels.find(({ id }) => id === targetFloorId);
  const [targetRoomId, setTargetRoomId] = useState(targetFloor?.rooms[0]?.id ?? '');

  useEffect(() => {
    if (!departureFloor?.rooms.some(({ id }) => id === departureRoomId)) {
      setDepartureRoomId(departureFloor?.rooms[0]?.id ?? '');
    }
  }, [departureFloor, departureRoomId]);
  useEffect(() => {
    if (!targetFloors.some(({ id }) => id === targetFloorId)) {
      setTargetFloorId(targetFloors[0]?.id ?? '');
    }
  }, [targetFloorId, targetFloors]);
  useEffect(() => setTargetRoomId(targetFloor?.rooms[0]?.id ?? ''), [targetFloor]);

  const departureRoom = departureFloor?.rooms.find(({ id }) => id === departureRoomId);
  const targetRoom = targetFloor?.rooms.find(({ id }) => id === targetRoomId);

  return (
    <div className="plan-confirm-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="plan-confirm-modal stair-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stair-modal-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="understanding-icon stair">
          <MoveUpRight />
        </span>
        <div>
          <span className="eyebrow">Nouvel escalier</span>
          <h3 id="stair-modal-title">Relier deux niveaux</h3>
          <p>Choisissez précisément son départ et son arrivée.</p>
        </div>

        <div className="stair-modal-fields">
          <fieldset>
            <legend>Départ</legend>
            <label>
              <span>Niveau</span>
              <select
                value={departureFloorId}
                onChange={(event) => setDepartureFloorId(event.target.value)}
              >
                {levels.map((level) => (
                  <option value={level.id} key={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Pièce de départ</span>
              <select
                value={departureRoomId}
                onChange={(event) => setDepartureRoomId(event.target.value)}
              >
                {!departureFloor?.rooms.length && <option value="">Aucune pièce disponible</option>}
                {departureFloor?.rooms.map((room) => (
                  <option value={room.id} key={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <span className="stair-modal-arrow">→</span>

          <fieldset>
            <legend>Arrivée</legend>
            <label>
              <span>Niveau</span>
              <select
                value={targetFloorId}
                onChange={(event) => setTargetFloorId(event.target.value)}
              >
                {targetFloors.map((level) => (
                  <option value={level.id} key={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Pièce d’arrivée</span>
              <select
                value={targetRoomId}
                onChange={(event) => setTargetRoomId(event.target.value)}
              >
                {!targetFloor?.rooms.length && <option value="">Aucune pièce disponible</option>}
                {targetFloor?.rooms.map((room) => (
                  <option value={room.id} key={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </div>

        <div className="stair-route stair-modal-route">
          <strong>{departureFloor?.name}</strong> · {departureRoom?.name || 'Pièce à choisir'}
          <span>→</span>
          <strong>{targetFloor?.name}</strong> · {targetRoom?.name || 'Pièce à choisir'}
        </div>

        <small className="stair-modal-help">
          Après validation, les deux flèches pourront être déplacées librement autour des pièces.
        </small>

        <footer>
          <button className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="primary"
            disabled={!departureRoomId || !targetFloorId || !targetRoomId}
            onClick={() => onAdd(departureFloorId, departureRoomId, targetFloorId, targetRoomId)}
          >
            <MoveUpRight /> Ajouter l’escalier
          </button>
        </footer>
      </div>
    </div>
  );
}

function OpeningInspector({
  opening,
  floor,
  moving,
  onMove,
  onRemove,
}: {
  opening: Opening;
  floor: FloorLayout;
  moving: boolean;
  onMove: () => void;
  onRemove: () => void;
}) {
  const rooms = floor.rooms.filter(({ id }) => opening.roomIds.includes(id));
  const hostRoom = floor.rooms.find(
    ({ id }) => id === (opening.hostRoomId ?? opening.roomIds[opening.roomIds.length - 1]),
  );
  const label = opening.isMainEntrance
    ? 'Entrée principale'
    : opening.kind === 'WINDOW'
      ? 'Fenêtre'
      : opening.kind === 'PASSAGE'
        ? 'Passage ouvert'
        : 'Porte intérieure';
  const noun =
    opening.kind === 'WINDOW'
      ? 'la fenêtre'
      : opening.kind === 'PASSAGE'
        ? 'le passage'
        : 'la porte';
  return (
    <div className="opening-inspector">
      <span className={`opening-inspector-icon ${opening.kind.toLowerCase()}`}>
        {opening.kind === 'WINDOW' ? <Waves /> : <DoorOpen />}
      </span>
      <span className="eyebrow">Ouverture sélectionnée</span>
      <h3>{label}</h3>
      <p>
        {rooms.length === 2
          ? `${rooms[0]!.name} ↔ ${rooms[1]!.name}`
          : `Accès à ${rooms[0]?.name ?? 'la pièce'}`}
      </p>
      {hostRoom && (
        <div className="opening-host-room">
          <small>Placée sur le mur de</small>
          <strong>{hostRoom.name}</strong>
        </div>
      )}
      <button className={`move-opening ${moving ? 'active' : ''}`} onClick={onMove}>
        <MoveHorizontal /> {moving ? 'Choisissez maintenant un mur…' : `Déplacer ${noun}`}
      </button>
      <button className="delete-opening" onClick={onRemove}>
        <Trash2 /> Supprimer {noun}
      </button>
      <small className="opening-inspector-help">
        Les connexions et capteurs associés resteront synchronisés pendant le déplacement.
      </small>
    </div>
  );
}

function PlacementInspector({
  plan,
  placementId,
  onRemove,
}: {
  plan: HomePlan;
  placementId: string;
  onRemove: () => void;
}) {
  const placement = plan.placements.find(({ id }) => id === placementId);
  if (!placement) return null;
  const room = plan.levels.flatMap(({ rooms }) => rooms).find(({ id }) => id === placement.roomId);
  return (
    <div className="placement-inspector">
      <Radio />
      <span className="eyebrow">Équipement positionné</span>
      <h3>{placement.kind === 'CAMERA' ? 'Caméra' : 'Capteur'}</h3>
      <p>{room?.name}</p>
      <button onClick={onRemove}>
        <Trash2 /> Retirer du plan
      </button>
    </div>
  );
}
