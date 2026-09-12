import {
  Activity,
  AlertTriangle,
  Battery,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bed,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  CookingPot,
  DoorOpen,
  Droplets,
  Flame,
  Home,
  Layers,
  LayoutGrid,
  List,
  LoaderCircle,
  MapPin,
  Plus,
  Radio,
  RadioTower,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sofa,
  Sparkles,
  Thermometer,
  Trash2,
  UserCheck,
  WifiOff,
  Wifi,
  Tv,
  Speaker,
  Lightbulb,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SensorOnboardingDialog } from './SensorOnboardingDialog';
import { SensorInstallationGuide } from './SensorInstallationGuide';
import { HardwareCatalogDialog } from './HardwareCatalogDialog';
import type { Locale } from './i18n';
import { sensorDeviceHealthStatus } from './sensor-ui';

type Room = { id: string; name: string; kind: string; floor?: number; sortOrder?: number };

type Capability = {
  sensorId: string;
  entityId: string;
  capability: string;
  label: string;
  primary: boolean;
  status: string;
  value: Record<string, unknown> | null;
  unit: string | null;
  classification: { confidence: number; reason: string | null; confirmedAt: string | null };
};

type SensorDevice = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  protocol: string | null;
  integration: string | null;
  room: Room | null;
  installationStatus: string;
  enabled: boolean;
  placementConfirmedAt: string | null;
  lastSeenAt: string | null;
  batteryPercent: number | null;
  capabilities: Capability[];
  action: 'CONFIRM' | 'ASSIGN_ROOM' | 'PLACE' | 'TEST' | 'CHECK' | 'NONE';
};

type Protocol = {
  id: string;
  available: boolean;
  native: boolean;
  status?: 'READY' | 'CHECK';
  detail?: string;
};

type EquipmentAction = {
  id: string;
  domain: string;
  service: string;
  label: string;
  fields: string[];
};

type DiscoveryField = {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'multi_select';
  required: boolean;
  default?: unknown;
  options: Array<{ value: string | number | boolean; label: string }>;
};

type DiscoveryStep = {
  type: 'form' | 'menu' | 'external' | 'progress' | 'complete' | 'error';
  title: string | null;
  description: string | null;
  fields: DiscoveryField[];
  menuOptions: Array<{ value: string; label: string }>;
  externalUrl: string | null;
  errors: Record<string, string>;
};

type EquipmentEntity = {
  id: string;
  entityId: string;
  name: string;
  domain: string;
  deviceClass: string | null;
  available: boolean;
  state: unknown;
  actions: EquipmentAction[];
};

type EquipmentItem =
  | {
      source: 'configured';
      id: string;
      name: string;
      manufacturer: string | null;
      model: string | null;
      protocol: string | null;
      integration: string | null;
      status: 'OPERATIONAL' | 'OFFLINE' | 'ATTENTION' | 'UNSUPPORTED';
      entities: EquipmentEntity[];
    }
  | {
      source: 'discovered';
      id: string;
      name: string;
      integration: string;
      protocol: string;
      status: 'DISCOVERED' | 'CONFIGURING' | 'FAILED';
      step: DiscoveryStep | null;
      error: string | null;
    };

const capabilityOptions = [
  ['motion', 'Mouvement'],
  ['occupancy', 'Présence'],
  ['person_presence', 'Présence humaine'],
  ['contact', 'Ouverture'],
  ['button', 'Bouton'],
  ['temperature', 'Température'],
  ['humidity', 'Humidité'],
  ['water_leak', 'Fuite d’eau'],
  ['smoke', 'Fumée'],
  ['carbon_monoxide', 'Monoxyde de carbone'],
  ['co2', 'CO₂'],
  ['voc', 'COV'],
  ['pm25', 'Particules fines'],
  ['air_quality', 'Qualité de l’air'],
  ['illuminance', 'Luminosité'],
  ['vibration', 'Vibration'],
  ['fall_detection', 'Chute non visuelle'],
  ['power', 'Puissance'],
  ['energy', 'Énergie'],
] as const;

const protocolDescriptions: Record<string, { label: string; desc: [string, string] }> = {
  zigbee: {
    label: 'Zigbee',
    desc: [
      'Idéal pour les capteurs discrets sans fil à très longue autonomie.',
      'Best for discreet, ultra-low power wireless sensors.',
    ],
  },
  matter: {
    label: 'Matter / Thread',
    desc: [
      'Standard moderne universel, réactif et direct.',
      'Modern universal standard, fast and responsive.',
    ],
  },
  bluetooth: {
    label: 'Bluetooth / BTHome',
    desc: [
      'Capteurs de proximité et balises locales sécurisées.',
      'Proximity sensors and secure local beacons.',
    ],
  },
  zwave: {
    label: 'Z-Wave',
    desc: ['Réseau maillé fiable à longue portée.', 'Reliable long-range mesh network.'],
  },
  esphome: {
    label: 'ESPHome',
    desc: [
      'Capteurs sur-mesure et micromodules DIY.',
      'Custom sensors and local microcontrollers.',
    ],
  },
  wifi: {
    label: 'Wi-Fi local',
    desc: [
      'Connexion directe sur le réseau local sécurisé.',
      'Direct connection on your secure local Wi-Fi.',
    ],
  },
};

function getSensorIcon(capabilities: Capability[]) {
  const primaryCap = capabilities.find((c) => c.primary)?.capability ?? capabilities[0]?.capability;
  switch (primaryCap) {
    case 'temperature':
      return Thermometer;
    case 'motion':
    case 'occupancy':
    case 'person_presence':
    case 'vibration':
      return Activity;
    case 'contact':
      return DoorOpen;
    case 'humidity':
    case 'water_leak':
      return Droplets;
    case 'smoke':
      return Flame;
    case 'carbon_monoxide':
    case 'co2':
    case 'voc':
    case 'pm25':
    case 'air_quality':
      return Wind;
    case 'button':
      return Bell;
    case 'fall_detection':
      return UserCheck;
    case 'power':
    case 'energy':
      return Zap;
    default:
      return RadioTower;
  }
}

function getRoomIcon(kind?: string) {
  switch (kind) {
    case 'LIVING_ROOM':
      return Sofa;
    case 'KITCHEN':
      return CookingPot;
    case 'BEDROOM':
      return Bed;
    case 'ENTRANCE':
      return DoorOpen;
    default:
      return Home;
  }
}

function formatRelativeTime(dateStr: string | null, fr: boolean): string {
  if (!dateStr) return fr ? 'Jamais vu' : 'Never seen';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (diffMinutes < 1) return fr ? 'À l’instant' : 'Just now';
  if (diffMinutes < 60) return fr ? `Il y a ${diffMinutes} min` : `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return fr ? `Il y a ${diffHours} h` : `${diffHours}h ago`;
  return date.toLocaleDateString(fr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' });
}

function displayValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}

export function SensorsPanel({ locale, rooms }: { locale: Locale; rooms: Room[] }) {
  const [devices, setDevices] = useState<SensorDevice[]>([]);
  const [equipmentItems, setEquipmentItems] = useState<EquipmentItem[]>([]);
  const [selectedDiscovery, setSelectedDiscovery] = useState<Extract<
    EquipmentItem,
    { source: 'discovered' }
  > | null>(null);
  const [discoveryInput, setDiscoveryInput] = useState<Record<string, unknown>>({});
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [selectedEquipmentAction, setSelectedEquipmentAction] = useState<{
    item: Extract<EquipmentItem, { source: 'configured' }>;
    entity: EquipmentEntity;
    action: EquipmentAction;
  } | null>(null);
  const [actionInput, setActionInput] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [activeFilter, setActiveFilter] = useState<
    'ALL' | 'OPERATIONAL' | 'INSTALL' | 'ATTENTION' | 'BATTERY' | 'OFFLINE'
  >('ALL');
  const [roomFilter, setRoomFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'ROOMS' | 'LIST'>('ROOMS');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Drawer / Inspection
  const [inspectedDevice, setInspectedDevice] = useState<SensorDevice | null>(null);
  const [drawerTab, setDrawerTab] = useState<'GUIDE' | 'TEST' | 'CONFIG'>('GUIDE');
  const [deleteTarget, setDeleteTarget] = useState<SensorDevice | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [adding, setAdding] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const resumeOnboarding = useCallback(() => setAdding(true), []);

  const fr = locale === 'fr';

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [deviceResponse, protocolResponse, equipmentResponse] = await Promise.all([
        fetch('/api/v1/sensor-devices', { cache: 'no-store' }),
        fetch('/api/v1/sensor-devices/protocols', { cache: 'no-store' }),
        fetch('/api/v1/equipment/items', { cache: 'no-store' }),
      ]);
      if (deviceResponse.ok) {
        const nextDevices = (await deviceResponse.json()) as SensorDevice[];
        setDevices(nextDevices);
        setInspectedDevice((curr) =>
          curr ? (nextDevices.find((d) => d.id === curr.id) ?? null) : null,
        );
      }
      if (protocolResponse.ok) {
        setProtocols((await protocolResponse.json()) as Protocol[]);
      }
      if (equipmentResponse.ok) {
        const nextItems = (await equipmentResponse.json()) as EquipmentItem[];
        setEquipmentItems(nextItems);
        setSelectedDiscovery((current) =>
          current
            ? (nextItems.find(
                (item): item is Extract<EquipmentItem, { source: 'discovered' }> =>
                  item.source === 'discovered' && item.id === current.id,
              ) ?? null)
            : null,
        );
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const events = new EventSource('/api/v1/events');
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    events.onmessage = () => void refresh();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      events.close();
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  // Counts
  const counts = useMemo(() => {
    const operational = devices.filter(
      (d) => d.installationStatus === 'OPERATIONAL' && d.enabled,
    ).length;
    const install = devices.filter((d) =>
      ['DETECTED', 'NEEDS_CONFIRMATION', 'NEEDS_PLACEMENT', 'NEEDS_TEST'].includes(
        d.installationStatus,
      ),
    ).length;
    const attention = devices.filter(
      (d) => d.installationStatus === 'ATTENTION' || !d.enabled,
    ).length;
    const batteryLow = devices.filter(
      (d) => d.batteryPercent !== null && d.batteryPercent <= 20,
    ).length;
    const offline = devices.filter((d) => sensorDeviceHealthStatus(d) === 'OFFLINE').length;
    const unassigned = devices.filter((d) => !d.room).length;
    return {
      total: devices.length,
      operational,
      install,
      attention,
      batteryLow,
      offline,
      unassigned,
    };
  }, [devices]);

  // Filtered devices
  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      // Metric filter
      if (
        activeFilter === 'OPERATIONAL' &&
        (device.installationStatus !== 'OPERATIONAL' || !device.enabled)
      )
        return false;
      if (
        activeFilter === 'INSTALL' &&
        !['DETECTED', 'NEEDS_CONFIRMATION', 'NEEDS_PLACEMENT', 'NEEDS_TEST'].includes(
          device.installationStatus,
        )
      )
        return false;
      if (activeFilter === 'ATTENTION' && device.installationStatus !== 'ATTENTION') return false;
      if (
        activeFilter === 'BATTERY' &&
        (device.batteryPercent === null || device.batteryPercent > 20)
      )
        return false;
      if (activeFilter === 'OFFLINE' && sensorDeviceHealthStatus(device) !== 'OFFLINE')
        return false;

      if (roomFilter === 'NONE' && device.room) return false;
      if (roomFilter !== 'ALL' && roomFilter !== 'NONE' && device.room?.id !== roomFilter)
        return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchName = device.name.toLowerCase().includes(query);
        const matchRoom = device.room?.name.toLowerCase().includes(query) ?? false;
        const matchModel =
          (device.model?.toLowerCase().includes(query) ||
            device.manufacturer?.toLowerCase().includes(query)) ??
          false;
        const matchCap = device.capabilities.some(
          (c) =>
            c.label.toLowerCase().includes(query) || c.capability.toLowerCase().includes(query),
        );
        if (!matchName && !matchRoom && !matchModel && !matchCap) return false;
      }

      return true;
    });
  }, [devices, activeFilter, roomFilter, searchQuery]);

  // Group by rooms
  const groupedByRoom = useMemo(() => {
    const map = new Map<string, { room: Room | null; devices: SensorDevice[] }>();

    for (const r of rooms) {
      map.set(r.id, { room: r, devices: [] });
    }
    map.set('unassigned', { room: null, devices: [] });

    for (const d of filteredDevices) {
      if (d.room) {
        if (!map.has(d.room.id)) {
          map.set(d.room.id, { room: d.room, devices: [] });
        }
        map.get(d.room.id)!.devices.push(d);
      } else {
        map.get('unassigned')!.devices.push(d);
      }
    }

    return Array.from(map.values()).filter((group) => {
      if (group.devices.length === 0) return false;
      if (group.room) {
        if (roomFilter !== 'ALL' && group.room.id !== roomFilter) return false;
        return true;
      }
      return roomFilter === 'ALL' || roomFilter === 'NONE';
    });
  }, [rooms, filteredDevices, roomFilter]);

  const updateDevice = async (id: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/v1/sensor-devices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) await refresh();
  };

  const removeDevice = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      const response = await fetch(
        `/api/v1/sensor-devices/${encodeURIComponent(deleteTarget.id)}`,
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { message?: string } | null;
        setDeleteError(
          error?.message ??
            (fr
              ? 'Le capteur n’a pas pu être supprimé. Vérifiez la connexion puis réessayez.'
              : 'The sensor could not be removed. Check the connection and try again.'),
        );
        return;
      }
      setDeleteTarget(null);
      setInspectedDevice(null);
      await refresh();
    } catch {
      setDeleteError(
        fr
          ? 'Élise ne parvient pas à joindre la box. Le capteur n’a pas été supprimé.'
          : 'Élise cannot reach the hub. The sensor was not removed.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const openDrawer = (device: SensorDevice, tab: 'GUIDE' | 'TEST' | 'CONFIG' = 'GUIDE') => {
    setInspectedDevice(device);
    setDrawerTab(tab);
  };

  const confirmCapability = async (device: SensorDevice, sensorId: string, capability: string) => {
    const response = await fetch(
      `/api/v1/sensor-devices/${encodeURIComponent(device.id)}/classifications`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sensorId, capability }),
      },
    );
    if (response.ok) await refresh();
  };

  const openDiscovery = (item: Extract<EquipmentItem, { source: 'discovered' }>) => {
    const defaults = Object.fromEntries(
      (item.step?.fields ?? [])
        .filter((field) => field.default !== undefined && field.type !== 'password')
        .map((field) => [field.name, field.default]),
    );
    setSelectedDiscovery(item);
    setDiscoveryInput(defaults);
    setDiscoveryError('');
  };

  const advanceDiscovery = async (menuChoice?: string) => {
    if (!selectedDiscovery) return;
    setDiscoveryBusy(true);
    setDiscoveryError('');
    try {
      const input = menuChoice ? { next_step_id: menuChoice } : discoveryInput;
      const response = await fetch(
        `/api/v1/equipment/discoveries/${selectedDiscovery.id}/advance`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input }),
        },
      );
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(error?.message ?? (fr ? 'Configuration impossible.' : 'Setup failed.'));
      }
      await refresh();
      const result = (await response.json()) as { status?: string };
      if (result.status === 'COMPLETED') setSelectedDiscovery(null);
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const ignoreDiscovery = async () => {
    if (!selectedDiscovery) return;
    setDiscoveryBusy(true);
    try {
      const response = await fetch(`/api/v1/equipment/discoveries/${selectedDiscovery.id}/ignore`, {
        method: 'POST',
      });
      if (!response.ok)
        throw new Error(
          fr ? 'Impossible d’ignorer cet appareil.' : 'Unable to ignore this device.',
        );
      setSelectedDiscovery(null);
      await refresh();
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const executeEquipmentAction = async () => {
    if (!selectedEquipmentAction) return;
    setActionError('');
    const { entity, action } = selectedEquipmentAction;
    const response = await fetch('/api/v1/equipment/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityId: entity.entityId,
        actionId: action.id,
        data: actionInput,
        confirmed: true,
      }),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { message?: string } | null;
      setActionError(error?.message ?? (fr ? 'Action impossible.' : 'Action failed.'));
      return;
    }
    setSelectedEquipmentAction(null);
    setActionInput({});
    window.setTimeout(() => void refresh(), 800);
  };

  const zigbee = protocols.find(({ id }) => id === 'zigbee') ?? null;
  const sensorsWaitingForSetup = devices.filter((device) =>
    ['DETECTED', 'NEEDS_CONFIRMATION'].includes(device.installationStatus),
  );
  const firstWaitingSensor = sensorsWaitingForSetup[0] ?? null;
  const waitingSensorType = firstWaitingSensor
    ? (firstWaitingSensor.capabilities.find(({ primary }) => primary)?.label ??
      firstWaitingSensor.capabilities[0]?.label ??
      (fr ? 'Type en cours d’identification' : 'Type being identified'))
    : '';

  const openPairing = () => setAdding(true);

  return (
    <section className="section-view modern-sensors-page">
      {/* 1. Header with Title & Action */}
      <div className="sensors-header-row">
        <div>
          <div className="sensors-eyebrow">
            <Sparkles size={14} />
            <span>{fr ? 'Protection & Sérénité du domicile' : 'Home Safety & Reassurance'}</span>
          </div>
          <h1 className="sensors-main-title">
            {fr ? 'Capteurs & Équipements' : 'Sensors & Equipment'}
          </h1>
          <p className="sensors-subtitle">
            {fr
              ? 'Élise veille sur votre proche grâce à ces capteurs discrets et non-intrusifs. Retrouvez ici la couverture complète du domicile.'
              : 'Élise watches over your loved one through these non-intrusive sensors. Ensure optimal placement and health.'}
          </p>
        </div>

        <div className="sensors-header-actions">
          <button className="sensors-catalog-btn" onClick={() => setCatalogOpen(true)}>
            <BookOpen size={17} />
            <span>{fr ? 'Matériel de test' : 'Test hardware'}</span>
          </button>
          <button
            className={`sensors-refresh-btn ${isRefreshing ? 'is-spinning' : ''}`}
            onClick={() => void refresh()}
            title={fr ? 'Actualiser les capteurs' : 'Refresh sensors'}
            aria-label={fr ? 'Actualiser' : 'Refresh'}
          >
            <RefreshCw size={17} />
          </button>
          <button className="sensors-add-btn" onClick={openPairing}>
            <Plus size={18} />
            <span>{fr ? 'Ajouter un capteur' : 'Add sensor'}</span>
          </button>
        </div>
      </div>

      <section className="universal-equipment-section">
        <div className="universal-equipment-heading">
          <div>
            <span>{fr ? 'Maison connectée' : 'Connected home'}</span>
            <h2>{fr ? 'Tous les appareils vus par Élise' : 'Every device visible to Élise'}</h2>
            <p>
              {fr
                ? 'Home Assistant fournit la compatibilité ; Élise rassemble ici les appareils, leurs états et les actions disponibles.'
                : 'Home Assistant provides compatibility; Élise brings devices, states and available actions together here.'}
            </p>
          </div>
          <b>{equipmentItems.length}</b>
        </div>
        {equipmentItems.length === 0 ? (
          <div className="universal-equipment-empty">
            <Wifi size={22} />
            <span>
              {fr
                ? 'Aucun appareil réseau remonté pour le moment.'
                : 'No network device reported yet.'}
            </span>
          </div>
        ) : (
          <div className="universal-equipment-grid">
            {equipmentItems.map((item) => {
              const domains =
                item.source === 'configured' ? item.entities.map(({ domain }) => domain) : [];
              const Icon = domains.includes('media_player')
                ? Tv
                : domains.includes('notify')
                  ? Speaker
                  : domains.includes('light')
                    ? Lightbulb
                    : item.source === 'discovered'
                      ? Radio
                      : Wifi;
              const availableActions =
                item.source === 'configured'
                  ? item.entities.flatMap((entity) =>
                      entity.actions.map((action) => ({ entity, action })),
                    )
                  : [];
              return (
                <article
                  key={`${item.source}:${item.id}`}
                  className={`universal-equipment-card status-${item.status.toLowerCase()}`}
                >
                  <div className="universal-equipment-card-top">
                    <span>
                      <Icon size={22} />
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.integration || (fr ? 'Intégration locale' : 'Local integration')} ·{' '}
                        {item.protocol || 'local'}
                      </small>
                    </div>
                    <b>
                      {item.source === 'discovered'
                        ? fr
                          ? 'À configurer'
                          : 'Setup needed'
                        : item.status === 'OPERATIONAL'
                          ? fr
                            ? 'Opérationnel'
                            : 'Operational'
                          : item.status === 'OFFLINE'
                            ? fr
                              ? 'Hors ligne'
                              : 'Offline'
                            : fr
                              ? 'Limité'
                              : 'Limited'}
                    </b>
                  </div>
                  {item.source === 'discovered' ? (
                    <div className="universal-equipment-actions">
                      <button onClick={() => openDiscovery(item)}>
                        <Settings2 size={15} /> {fr ? 'Configurer dans Élise' : 'Set up in Élise'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="universal-equipment-states">
                        {item.entities.slice(0, 4).map((entity) => (
                          <span key={entity.id} className={entity.available ? '' : 'is-offline'}>
                            {entity.name}:{' '}
                            <b>
                              {displayValue(
                                entity.state,
                                entity.available ? '—' : fr ? 'indisponible' : 'unavailable',
                              )}
                            </b>
                          </span>
                        ))}
                      </div>
                      {availableActions.length > 0 && (
                        <div className="universal-equipment-actions">
                          {availableActions.slice(0, 5).map(({ entity, action }) => (
                            <button
                              key={`${entity.id}:${action.id}`}
                              onClick={() => {
                                setSelectedEquipmentAction({ item, entity, action });
                                setActionInput({});
                                setActionError('');
                              }}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Interactive Health Metric Pills */}
      <div className="sensors-metric-strip">
        <button
          className={`sensor-metric-card ${activeFilter === 'ALL' ? 'is-active' : ''}`}
          onClick={() => setActiveFilter('ALL')}
        >
          <div className="sensor-metric-icon tone-neutral">
            <Layers size={20} />
          </div>
          <div className="sensor-metric-data">
            <span className="sensor-metric-count">{counts.total}</span>
            <span className="sensor-metric-label">{fr ? 'Tous les capteurs' : 'All sensors'}</span>
          </div>
        </button>

        <button
          className={`sensor-metric-card ${activeFilter === 'OPERATIONAL' ? 'is-active' : ''}`}
          onClick={() => setActiveFilter('OPERATIONAL')}
        >
          <div className="sensor-metric-icon tone-success">
            <ShieldCheck size={20} />
          </div>
          <div className="sensor-metric-data">
            <span className="sensor-metric-count">{counts.operational}</span>
            <span className="sensor-metric-label">{fr ? 'Opérationnels' : 'Operational'}</span>
          </div>
        </button>

        <button
          className={`sensor-metric-card ${activeFilter === 'INSTALL' ? 'is-active' : ''} ${counts.install > 0 ? 'has-badge' : ''}`}
          onClick={() => setActiveFilter('INSTALL')}
        >
          <div className="sensor-metric-icon tone-amber">
            <MapPin size={20} />
          </div>
          <div className="sensor-metric-data">
            <span className="sensor-metric-count">{counts.install}</span>
            <span className="sensor-metric-label">
              {fr ? 'À installer / poser' : 'To install / place'}
            </span>
          </div>
        </button>

        <button
          className={`sensor-metric-card ${activeFilter === 'ATTENTION' ? 'is-active' : ''} ${counts.attention > 0 ? 'has-badge' : ''}`}
          onClick={() => setActiveFilter('ATTENTION')}
        >
          <div className="sensor-metric-icon tone-warning">
            <CircleAlert size={20} />
          </div>
          <div className="sensor-metric-data">
            <span className="sensor-metric-count">{counts.attention}</span>
            <span className="sensor-metric-label">{fr ? 'À vérifier' : 'Needs attention'}</span>
          </div>
        </button>

        <button
          className={`sensor-metric-card ${activeFilter === 'BATTERY' ? 'is-active' : ''} ${counts.batteryLow > 0 ? 'has-badge' : ''}`}
          onClick={() => setActiveFilter('BATTERY')}
        >
          <div className="sensor-metric-icon tone-red">
            <BatteryLow size={20} />
          </div>
          <div className="sensor-metric-data">
            <span className="sensor-metric-count">{counts.batteryLow}</span>
            <span className="sensor-metric-label">{fr ? 'Piles faibles' : 'Low battery'}</span>
          </div>
        </button>

        <button
          className={`sensor-metric-card ${activeFilter === 'OFFLINE' ? 'is-active' : ''} ${counts.offline > 0 ? 'has-badge' : ''}`}
          onClick={() => setActiveFilter('OFFLINE')}
        >
          <div className="sensor-metric-icon tone-gray">
            <WifiOff size={20} />
          </div>
          <div className="sensor-metric-data">
            <span className="sensor-metric-count">{counts.offline}</span>
            <span className="sensor-metric-label">{fr ? 'Hors-ligne' : 'Offline'}</span>
          </div>
        </button>
      </div>

      <div className="sensor-connection-card">
        <div className={`sensor-connection-icon ${zigbee?.available ? 'is-ready' : ''}`}>
          {zigbee?.available ? <CheckCircle2 size={24} /> : <RadioTower size={24} />}
        </div>
        <div className="sensor-connection-copy">
          <span className="sensor-connection-kicker">Zigbee</span>
          <strong>
            {zigbee === null
              ? fr
                ? 'Vérification de la clé…'
                : 'Checking the key…'
              : zigbee.available
                ? fr
                  ? 'Clé Zigbee détectée'
                  : 'Zigbee key detected'
                : fr
                  ? 'Clé Zigbee à vérifier'
                  : 'Check the Zigbee key'}
          </strong>
          <p>
            {zigbee?.available
              ? fr
                ? 'Tout est prêt pour jumeler de nouveaux équipements.'
                : 'Everything is ready to pair new equipment.'
              : fr
                ? 'Élise vérifie automatiquement la connexion de vos équipements.'
                : 'Élise is automatically checking your equipment connection.'}
          </p>
        </div>
        <span className={`sensor-connection-state ${zigbee?.available ? 'is-ready' : ''}`}>
          <i />
          {zigbee?.available ? (fr ? 'Prête' : 'Ready') : fr ? 'Vérification' : 'Checking'}
        </span>
        <button
          className="sensor-connection-action"
          onClick={openPairing}
          disabled={!zigbee?.available}
        >
          <Plus size={16} />
          {fr ? 'Jumeler un équipement' : 'Pair equipment'}
        </button>
      </div>

      {firstWaitingSensor && (
        <div className="sensor-detected-banner">
          <div className="sensor-detected-pulse">
            <Radio size={22} />
          </div>
          <div className="sensor-detected-copy">
            <strong>
              {sensorsWaitingForSetup.length}{' '}
              {fr
                ? sensorsWaitingForSetup.length > 1
                  ? 'capteurs détectés'
                  : 'capteur détecté'
                : sensorsWaitingForSetup.length > 1
                  ? 'sensors detected'
                  : 'sensor detected'}
            </strong>
            <span>{waitingSensorType}</span>
          </div>
          <span className="sensor-unpaired-status">
            {fr ? 'Détecté · à configurer' : 'Detected · setup needed'}
          </span>
          <button onClick={() => void openDrawer(firstWaitingSensor, 'CONFIG')}>
            {fr ? 'Configurer' : 'Set up'}
          </button>
        </div>
      )}

      {/* 3. Action Callout Banner */}
      {(counts.install > 0 || counts.batteryLow > 0 || counts.unassigned > 0) &&
        activeFilter === 'ALL' && (
          <div className="sensor-action-banner">
            <div className="sensor-action-banner-content">
              <div className="sensor-action-banner-icon">
                <AlertTriangle size={20} />
              </div>
              <div>
                <strong>
                  {fr
                    ? 'Actions recommandées pour optimiser la couverture :'
                    : 'Recommended actions for coverage:'}
                </strong>
                <div className="sensor-action-banner-tags">
                  {counts.unassigned > 0 && (
                    <span className="sensor-action-tag" onClick={() => setRoomFilter('NONE')}>
                      {counts.unassigned}{' '}
                      {fr ? 'capteur(s) sans pièce assignée' : 'unassigned sensor(s)'}
                    </span>
                  )}
                  {counts.install > 0 && (
                    <span className="sensor-action-tag" onClick={() => setActiveFilter('INSTALL')}>
                      {counts.install}{' '}
                      {fr
                        ? 'capteur(s) en attente de pose ou test'
                        : 'sensor(s) awaiting placement/test'}
                    </span>
                  )}
                  {counts.batteryLow > 0 && (
                    <span className="sensor-action-tag" onClick={() => setActiveFilter('BATTERY')}>
                      {counts.batteryLow}{' '}
                      {fr ? 'pile(s) faible(s) à remplacer' : 'low battery sensor(s)'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      {/* 4. Controls Bar */}
      <div className="sensors-controls-bar">
        <div className="sensors-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder={
              fr ? 'Rechercher un capteur, une pièce, un type...' : 'Search sensor, room, type...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="sensors-search-clear" onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="sensors-filter-dropdowns">
          <div className="sensors-select-wrapper">
            <MapPin size={15} />
            <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
              <option value="ALL">{fr ? 'Toutes les pièces' : 'All rooms'}</option>
              <option value="NONE">{fr ? 'Non assignés uniquement' : 'Unassigned only'}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sensors-view-switcher">
            <button
              className={`sensors-view-btn ${viewMode === 'ROOMS' ? 'is-active' : ''}`}
              onClick={() => setViewMode('ROOMS')}
              title={fr ? 'Vue groupée par pièces' : 'Grouped by rooms'}
            >
              <LayoutGrid size={16} />
              <span>{fr ? 'Par pièces' : 'Rooms'}</span>
            </button>
            <button
              className={`sensors-view-btn ${viewMode === 'LIST' ? 'is-active' : ''}`}
              onClick={() => setViewMode('LIST')}
              title={fr ? 'Vue liste' : 'List view'}
            >
              <List size={16} />
              <span>{fr ? 'Liste' : 'List'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="sensor-room-overview-heading">
        <div>
          <span>{fr ? 'Couverture du domicile' : 'Home coverage'}</span>
          <h2>{fr ? 'Le domicile, pièce par pièce' : 'The home, room by room'}</h2>
        </div>
        <p>
          {fr
            ? 'Chaque carte indique simplement les capteurs présents et leur état.'
            : 'Each card simply shows the sensors present and their status.'}
        </p>
      </div>

      {/* 5. Main Content */}
      {filteredDevices.length === 0 && devices.length > 0 ? (
        <div className="sensors-empty-state">
          <div className="sensors-empty-icon">
            <Search size={32} />
          </div>
          <h3>{fr ? 'Aucun capteur ne correspond' : 'No sensors found'}</h3>
          <p>
            {fr
              ? 'Essayez de modifier vos filtres ou effectuez une autre recherche.'
              : 'Try adjusting your filters or search terms.'}
          </p>
          <button
            className="sensors-empty-reset"
            onClick={() => {
              setActiveFilter('ALL');
              setRoomFilter('ALL');
              setSearchQuery('');
            }}
          >
            {fr ? 'Réinitialiser les filtres' : 'Reset filters'}
          </button>
        </div>
      ) : viewMode === 'ROOMS' ? (
        /* ROOMS VIEW */
        <div className="sensors-rooms-container">
          {groupedByRoom.map((group) => {
            const roomKey = group.room?.id ?? 'unassigned';
            const roomName = group.room ? group.room.name : fr ? 'Non assignés' : 'Unassigned';
            const RoomIcon = getRoomIcon(group.room?.kind);
            const operationalInRoom = group.devices.filter(
              (d) => d.installationStatus === 'OPERATIONAL' && d.enabled,
            ).length;

            return (
              <div key={roomKey} className="sensors-room-section">
                <div className="sensors-room-header">
                  <div className="sensors-room-title">
                    <span className={`sensors-room-badge ${group.room ? '' : 'is-unassigned'}`}>
                      <RoomIcon size={18} />
                    </span>
                    <div>
                      <h3>{roomName}</h3>
                      <span className="sensors-room-stats">
                        {group.devices.length}{' '}
                        {fr ? (group.devices.length > 1 ? 'capteurs' : 'capteur') : 'sensor(s)'}
                        {group.devices.length > 0 &&
                          ` · ${operationalInRoom}/${group.devices.length} ${fr ? 'opérationnels' : 'operational'}`}
                      </span>
                    </div>
                  </div>
                </div>

                {group.devices.length === 0 ? (
                  <div className="sensors-room-empty">
                    <p>
                      {fr
                        ? 'Aucun capteur dans cette pièce pour le moment.'
                        : 'No sensor in this room yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="sensors-grid">
                    {group.devices.map((device) => (
                      <SensorCard
                        key={device.id}
                        device={device}
                        fr={fr}
                        locale={locale}
                        onOpenGuide={() => void openDrawer(device, 'GUIDE')}
                        onOpenTest={() => void openDrawer(device, 'TEST')}
                        onOpenSettings={() => void openDrawer(device, 'CONFIG')}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="sensors-list-container">
          <div className="sensors-list-table">
            <div className="sensors-list-head">
              <span className="col-device">{fr ? 'Capteur & Modèle' : 'Sensor & Model'}</span>
              <span className="col-room">{fr ? 'Pièce' : 'Room'}</span>
              <span className="col-type">{fr ? 'Mesure / Rôle' : 'Measurement'}</span>
              <span className="col-battery">{fr ? 'Batterie' : 'Battery'}</span>
              <span className="col-status">{fr ? 'État' : 'Status'}</span>
              <span className="col-actions">{fr ? 'Actions' : 'Actions'}</span>
            </div>
            {filteredDevices.map((device) => {
              const Icon = getSensorIcon(device.capabilities);
              const isLowBattery = device.batteryPercent !== null && device.batteryPercent <= 20;

              return (
                <div
                  key={device.id}
                  className={`sensors-list-row ${!device.enabled ? 'is-disabled' : ''}`}
                >
                  <div className="col-device">
                    <div className="sensor-item-icon">
                      <Icon size={18} />
                    </div>
                    <div>
                      <strong>{device.name}</strong>
                      <small>
                        {[device.manufacturer, device.model].filter(Boolean).join(' · ') ||
                          device.protocol ||
                          'Équipement'}
                      </small>
                    </div>
                  </div>

                  <div className="col-room">
                    <span className="sensor-room-tag">
                      <MapPin size={13} />
                      {device.room?.name ?? (fr ? 'Non assigné' : 'Unassigned')}
                    </span>
                  </div>

                  <div className="col-type">
                    <span className="sensor-type-text">
                      {device.capabilities
                        .filter((c) => c.primary)
                        .map((c) => c.label)
                        .join(' · ') || (fr ? 'Standard' : 'Standard')}
                    </span>
                  </div>

                  <div className="col-battery">
                    {device.batteryPercent !== null ? (
                      <span className={`sensor-battery-pill ${isLowBattery ? 'is-low' : ''}`}>
                        {isLowBattery ? <BatteryLow size={14} /> : <Battery size={14} />}
                        {device.batteryPercent}%
                      </span>
                    ) : (
                      <span className="sensor-battery-na">—</span>
                    )}
                  </div>

                  <div className="col-status">
                    <SensorStatusBadge
                      status={device.installationStatus}
                      enabled={device.enabled}
                      health={sensorDeviceHealthStatus(device)}
                      fr={fr}
                    />
                  </div>

                  <div className="col-actions">
                    <button
                      className="sensor-row-action-btn"
                      onClick={() => void openDrawer(device, 'GUIDE')}
                      title={fr ? 'Consulter le guide de pose' : 'View placement guide'}
                    >
                      <MapPin size={14} />
                      <span>{fr ? 'Pose' : 'Placement'}</span>
                    </button>
                    <button
                      className="sensor-row-action-btn"
                      onClick={() => void openDrawer(device, 'TEST')}
                      title={fr ? 'Tester en direct' : 'Test sensor'}
                    >
                      <ShieldCheck size={14} />
                      <span>{fr ? 'Tester' : 'Test'}</span>
                    </button>
                    <button
                      className="sensor-row-menu-btn"
                      onClick={() => void openDrawer(device, 'CONFIG')}
                      title={fr ? 'Réglages du capteur' : 'Sensor settings'}
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. Side Drawer */}
      {selectedDiscovery && (
        <div className="sensor-modal-backdrop" role="dialog" aria-modal="true">
          <div className="sensor-modal universal-setup-modal">
            <button className="sensor-modal-close" onClick={() => setSelectedDiscovery(null)}>
              <X size={20} />
            </button>
            <div className="universal-modal-icon">
              <Radio size={24} />
            </div>
            <span className="sensor-modal-eyebrow">{selectedDiscovery.integration}</span>
            <h2>{selectedDiscovery.step?.title || selectedDiscovery.name}</h2>
            <p>
              {selectedDiscovery.step?.description ||
                (fr
                  ? 'Élise vous guide dans la configuration de cet appareil.'
                  : 'Élise guides you through this device setup.')}
            </p>

            {selectedDiscovery.step?.type === 'form' && (
              <div className="universal-form-fields">
                {selectedDiscovery.step.fields.map((field) => (
                  <label key={field.name}>
                    <span>
                      {field.label}
                      {field.required ? ' *' : ''}
                    </span>
                    {field.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(discoveryInput[field.name])}
                        onChange={(event) =>
                          setDiscoveryInput((current) => ({
                            ...current,
                            [field.name]: event.target.checked,
                          }))
                        }
                      />
                    ) : field.type === 'select' ? (
                      <select
                        value={displayValue(discoveryInput[field.name])}
                        onChange={(event) =>
                          setDiscoveryInput((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                      >
                        <option value="">{fr ? 'Choisir…' : 'Choose…'}</option>
                        {field.options.map((option) => (
                          <option key={String(option.value)} value={String(option.value)}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          field.type === 'password'
                            ? 'password'
                            : field.type === 'number'
                              ? 'number'
                              : 'text'
                        }
                        autoComplete={field.type === 'password' ? 'off' : undefined}
                        value={displayValue(discoveryInput[field.name])}
                        onChange={(event) =>
                          setDiscoveryInput((current) => ({
                            ...current,
                            [field.name]:
                              field.type === 'number' && event.target.value !== ''
                                ? Number(event.target.value)
                                : event.target.value,
                          }))
                        }
                      />
                    )}
                    {selectedDiscovery.step?.errors[field.name] && (
                      <small>{selectedDiscovery.step.errors[field.name]}</small>
                    )}
                  </label>
                ))}
              </div>
            )}

            {selectedDiscovery.step?.type === 'menu' && (
              <div className="universal-menu-options">
                {selectedDiscovery.step.menuOptions.map((option) => (
                  <button
                    key={option.value}
                    disabled={discoveryBusy}
                    onClick={() => void advanceDiscovery(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {selectedDiscovery.step?.type === 'external' && selectedDiscovery.step.externalUrl && (
              <a
                className="universal-external-link"
                href={selectedDiscovery.step.externalUrl}
                target="_blank"
                rel="noreferrer"
              >
                {fr ? 'Ouvrir l’étape de connexion' : 'Open sign-in step'}
              </a>
            )}

            {selectedDiscovery.step?.type === 'progress' && (
              <div className="universal-progress">
                <LoaderCircle className="spin" />{' '}
                {fr ? 'Configuration en cours…' : 'Setup in progress…'}
              </div>
            )}

            {discoveryError && (
              <div className="modal-error-box">
                <AlertTriangle size={18} /> {discoveryError}
              </div>
            )}
            <footer className="installation-footer">
              <button
                className="modal-cancel-btn"
                disabled={discoveryBusy}
                onClick={() => void ignoreDiscovery()}
              >
                {fr ? 'Ignorer' : 'Ignore'}
              </button>
              {selectedDiscovery.step?.type !== 'menu' && (
                <button
                  className="modal-finish-btn"
                  disabled={discoveryBusy}
                  onClick={() => void advanceDiscovery()}
                >
                  {discoveryBusy ? <LoaderCircle className="spin" /> : <Check size={18} />}
                  {fr ? 'Continuer' : 'Continue'}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {selectedEquipmentAction && (
        <div className="sensor-modal-backdrop" role="dialog" aria-modal="true">
          <div className="sensor-modal universal-action-modal">
            <button className="sensor-modal-close" onClick={() => setSelectedEquipmentAction(null)}>
              <X size={20} />
            </button>
            <div className="universal-modal-icon">
              <Tv size={24} />
            </div>
            <span className="sensor-modal-eyebrow">{selectedEquipmentAction.entity.name}</span>
            <h2>{selectedEquipmentAction.action.label}</h2>
            <p>{selectedEquipmentAction.item.name}</p>
            {selectedEquipmentAction.action.fields.length > 0 && (
              <div className="universal-form-fields">
                {selectedEquipmentAction.action.fields.map((field) => (
                  <label key={field}>
                    <span>{field.replaceAll('_', ' ')}</span>
                    <input
                      value={actionInput[field] ?? ''}
                      onChange={(event) =>
                        setActionInput((current) => ({ ...current, [field]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            {actionError && (
              <div className="modal-error-box">
                <AlertTriangle size={18} /> {actionError}
              </div>
            )}
            <footer className="installation-footer">
              <button className="modal-cancel-btn" onClick={() => setSelectedEquipmentAction(null)}>
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button className="modal-finish-btn" onClick={() => void executeEquipmentAction()}>
                <Check size={18} /> {fr ? 'Exécuter' : 'Run'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {inspectedDevice && (
        <div className="sensor-drawer-backdrop" onClick={() => setInspectedDevice(null)}>
          <div className="sensor-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="sensor-drawer-header">
              <div className="sensor-drawer-header-left">
                <div className="sensor-drawer-device-icon">
                  {(() => {
                    const Icon = getSensorIcon(inspectedDevice.capabilities);
                    return <Icon size={24} />;
                  })()}
                </div>
                <div>
                  <h2>{inspectedDevice.name}</h2>
                  <div className="sensor-drawer-meta">
                    <span className="sensor-drawer-room">
                      <MapPin size={13} />
                      {inspectedDevice.room?.name ?? (fr ? 'Sans pièce' : 'Unassigned')}
                    </span>
                    <span className="sensor-drawer-protocol">
                      {protocolDescriptions[inspectedDevice.protocol ?? '']?.label ??
                        inspectedDevice.protocol ??
                        'Capteur'}
                    </span>
                    {inspectedDevice.batteryPercent !== null && (
                      <span
                        className={`sensor-drawer-battery ${inspectedDevice.batteryPercent <= 20 ? 'is-low' : ''}`}
                      >
                        <Battery size={13} />
                        {inspectedDevice.batteryPercent}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                className="sensor-drawer-close"
                onClick={() => setInspectedDevice(null)}
                aria-label={fr ? 'Fermer' : 'Close'}
              >
                <X size={20} />
              </button>
            </div>

            <div className="sensor-drawer-nav">
              <button
                className={`sensor-drawer-nav-btn ${drawerTab === 'GUIDE' ? 'is-active' : ''}`}
                onClick={() => setDrawerTab('GUIDE')}
              >
                <MapPin size={16} />
                <span>{fr ? 'Guide de pose' : 'Placement guide'}</span>
              </button>
              <button
                className={`sensor-drawer-nav-btn ${drawerTab === 'TEST' ? 'is-active' : ''}`}
                onClick={() => setDrawerTab('TEST')}
              >
                <ShieldCheck size={16} />
                <span>{fr ? 'Test en direct' : 'Live test'}</span>
              </button>
              <button
                className={`sensor-drawer-nav-btn ${drawerTab === 'CONFIG' ? 'is-active' : ''}`}
                onClick={() => setDrawerTab('CONFIG')}
              >
                <Settings2 size={16} />
                <span>{fr ? 'Configuration' : 'Settings'}</span>
              </button>
            </div>

            <div className="sensor-drawer-content">
              {drawerTab !== 'CONFIG' && (
                <SensorInstallationGuide
                  key={inspectedDevice.id}
                  device={inspectedDevice}
                  locale={locale}
                  testOnly={drawerTab === 'TEST'}
                  onChanged={refresh}
                />
              )}
              {drawerTab === 'CONFIG' && (
                <div className="drawer-tab-config">
                  <div className="config-group">
                    <label className="config-label">
                      {fr ? 'Pièce d’installation' : 'Assigned room'}
                    </label>
                    <select
                      className="config-select"
                      value={inspectedDevice.room?.id ?? ''}
                      onChange={(e) =>
                        void updateDevice(inspectedDevice.id, { roomId: e.target.value || null })
                      }
                    >
                      <option value="">{fr ? 'Non assigné (aucune pièce)' : 'Unassigned'}</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {inspectedDevice.action === 'CONFIRM' &&
                    inspectedDevice.capabilities
                      .filter((item) => item.classification.confidence < 0.8)
                      .map((item) => (
                        <div key={item.sensorId} className="config-group is-attention">
                          <label className="config-label">
                            <Sparkles size={15} />
                            {fr
                              ? 'Confirmation de la mesure principale :'
                              : 'Confirm primary measurement:'}
                          </label>
                          <select
                            className="config-select"
                            defaultValue=""
                            onChange={(e) =>
                              e.target.value &&
                              void confirmCapability(inspectedDevice, item.sensorId, e.target.value)
                            }
                          >
                            <option value="" disabled>
                              {fr ? 'Choisir la fonction du capteur' : 'Choose sensor function'}
                            </option>
                            {capabilityOptions.map(([val, label]) => (
                              <option key={val} value={val}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}

                  <div className="config-group">
                    <label className="config-label">
                      {fr ? 'État du capteur' : 'Sensor state'}
                    </label>
                    <div className="config-toggle-row">
                      <div>
                        <strong>
                          {inspectedDevice.enabled
                            ? fr
                              ? 'Capteur activé'
                              : 'Sensor enabled'
                            : fr
                              ? 'Capteur désactivé'
                              : 'Sensor disabled'}
                        </strong>
                        <p>
                          {fr
                            ? 'Élise prend en compte ce capteur pour l’observation des habitudes.'
                            : 'Élise uses this sensor to observe daily routines.'}
                        </p>
                      </div>
                      <button
                        className={`config-toggle-btn ${inspectedDevice.enabled ? 'is-on' : 'is-off'}`}
                        onClick={() =>
                          void updateDevice(inspectedDevice.id, {
                            enabled: !inspectedDevice.enabled,
                          })
                        }
                      >
                        <span className="config-toggle-handle" />
                      </button>
                    </div>
                  </div>

                  <div className="config-tech-details">
                    <h4>{fr ? 'Détails techniques' : 'Technical details'}</h4>
                    <div className="tech-detail-grid">
                      <div>
                        <span>{fr ? 'Protocole' : 'Protocol'}</span>
                        <strong>{inspectedDevice.protocol ?? 'N/A'}</strong>
                      </div>
                      <div>
                        <span>{fr ? 'Fabricant' : 'Manufacturer'}</span>
                        <strong>{inspectedDevice.manufacturer ?? 'N/A'}</strong>
                      </div>
                      <div>
                        <span>{fr ? 'Modèle' : 'Model'}</span>
                        <strong>{inspectedDevice.model ?? 'N/A'}</strong>
                      </div>
                      <div>
                        <span>{fr ? 'Dernier signal' : 'Last seen'}</span>
                        <strong>{formatRelativeTime(inspectedDevice.lastSeenAt, fr)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="config-remove-sensor">
                    <div>
                      <strong>{fr ? 'Retirer ce capteur' : 'Remove this sensor'}</strong>
                      <p>
                        {fr
                          ? 'Le capteur sera complètement désappairé d’Élise.'
                          : 'The sensor will be completely unpaired from Élise.'}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setDeleteError('');
                        setDeleteTarget(inspectedDevice);
                      }}
                    >
                      <Trash2 size={16} />
                      {fr ? 'Supprimer le capteur' : 'Delete sensor'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="sensor-modal-backdrop sensor-delete-backdrop">
          <div
            className="sensor-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sensor-delete-title"
          >
            <div className="sensor-delete-icon">
              <Trash2 size={26} />
            </div>
            <span className="sensor-delete-kicker">
              {fr ? 'Suppression définitive' : 'Permanent removal'}
            </span>
            <h2 id="sensor-delete-title">
              {fr ? `Supprimer « ${deleteTarget.name} » ?` : `Delete “${deleteTarget.name}”?`}
            </h2>
            <p>
              {fr
                ? 'Ce capteur sera retiré d’Élise et désappairé du réseau Zigbee. Pour le réutiliser, vous devrez le remettre en mode appairage : Élise le détectera alors comme un nouveau capteur.'
                : 'This sensor will be removed from Élise and unpaired from the Zigbee network. To use it again, put it back into pairing mode and Élise will detect it as a new sensor.'}
            </p>
            {deleteError && (
              <div className="modal-error-box">
                <AlertTriangle size={18} /> {deleteError}
              </div>
            )}
            <div className="sensor-delete-actions">
              <button
                className="sensor-delete-cancel"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button
                className="sensor-delete-confirm"
                onClick={() => void removeDevice()}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <RefreshCw size={17} className="is-spinning" />
                ) : (
                  <Trash2 size={17} />
                )}
                {isDeleting
                  ? fr
                    ? 'Désappairage…'
                    : 'Unpairing…'
                  : fr
                    ? 'Supprimer et désappairer'
                    : 'Delete and unpair'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SensorOnboardingDialog
        open={adding}
        locale={locale}
        rooms={rooms}
        onClose={() => setAdding(false)}
        onInstalled={refresh}
        onResume={resumeOnboarding}
      />
      <HardwareCatalogDialog
        open={catalogOpen}
        locale={locale}
        onClose={() => setCatalogOpen(false)}
      />
    </section>
  );
}

/* Subcomponents */

function SensorCard({
  device,
  fr,
  locale,
  onOpenGuide,
  onOpenTest,
  onOpenSettings,
}: {
  device: SensorDevice;
  fr: boolean;
  locale: Locale;
  onOpenGuide: () => void;
  onOpenTest: () => void;
  onOpenSettings: () => void;
}) {
  const Icon = getSensorIcon(device.capabilities);
  const isLowBattery = device.batteryPercent !== null && device.batteryPercent <= 20;
  const isOffline = sensorDeviceHealthStatus(device) === 'OFFLINE';
  const liveCapabilities = device.capabilities.filter(
    (capability) =>
      capability.primary &&
      capability.status !== 'OFFLINE' &&
      typeof capability.value?.value === 'number',
  );

  return (
    <div
      className={`modern-sensor-card ${!device.enabled ? 'is-disabled' : ''} ${isOffline ? 'is-offline' : ''}`}
    >
      <div className="sensor-card-top">
        <div
          className="sensor-card-icon-wrapper"
          onClick={onOpenSettings}
          title={fr ? 'Gérer le capteur' : 'Manage sensor'}
        >
          <Icon size={22} />
        </div>

        <div className="sensor-card-header-text" onClick={onOpenSettings}>
          <div className="sensor-card-title-row">
            <h4 className="sensor-card-name">{device.name}</h4>
            <SensorStatusBadge
              status={device.installationStatus}
              enabled={device.enabled}
              health={sensorDeviceHealthStatus(device)}
              fr={fr}
            />
          </div>
          <p className="sensor-card-capabilities">
            {device.capabilities
              .filter((c) => c.primary)
              .map((c) => c.label)
              .join(' · ') || (fr ? 'Capteur d’ambiance' : 'Ambient sensor')}
          </p>
        </div>
      </div>

      <div className="sensor-card-meta-row">
        <div className="sensor-meta-left">
          {device.protocol && (
            <span className="sensor-meta-protocol">
              {protocolDescriptions[device.protocol]?.label ?? device.protocol}
            </span>
          )}
          {device.batteryPercent !== null ? (
            <span
              className={`sensor-meta-battery ${isLowBattery ? 'is-low' : ''}`}
              title={
                fr ? `Batterie : ${device.batteryPercent}%` : `Battery: ${device.batteryPercent}%`
              }
            >
              {isLowBattery ? <BatteryWarning size={14} /> : <BatteryMedium size={14} />}
              <span>{device.batteryPercent}%</span>
            </span>
          ) : (
            <span
              className="sensor-meta-battery is-power"
              title={fr ? 'Alimentation secteur' : 'Mains powered'}
            >
              <Zap size={13} />
            </span>
          )}
        </div>

        <div
          className="sensor-meta-time"
          title={device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString(locale) : ''}
        >
          <Clock size={12} />
          <span>{formatRelativeTime(device.lastSeenAt, fr)}</span>
        </div>
      </div>

      {liveCapabilities.length > 0 && (
        <div
          className="sensor-card-live-values"
          aria-label={fr ? 'Mesures en direct' : 'Live readings'}
        >
          {liveCapabilities.map((capability) => (
            <div className="sensor-card-live-value" key={capability.sensorId}>
              <span>{capability.label}</span>
              <strong>
                {String(capability.value?.value)}
                {capability.unit ? ` ${capability.unit}` : ''}
              </strong>
            </div>
          ))}
        </div>
      )}

      <div className="sensor-card-actions-row">
        <button
          className={`sensor-quick-action-btn ${device.installationStatus === 'NEEDS_PLACEMENT' ? 'is-recommended' : ''}`}
          onClick={onOpenGuide}
        >
          <MapPin size={14} />
          <span>{fr ? 'Pose' : 'Placement'}</span>
        </button>

        <button
          className={`sensor-quick-action-btn ${device.installationStatus === 'NEEDS_TEST' ? 'is-recommended' : ''}`}
          disabled={!device.room}
          onClick={onOpenTest}
        >
          <ShieldCheck size={14} />
          <span>{fr ? 'Connexion' : 'Connection'}</span>
        </button>

        <button
          className="sensor-settings-icon-btn"
          onClick={onOpenSettings}
          title={fr ? 'Réglages' : 'Settings'}
        >
          <Settings2 size={16} />
        </button>
      </div>
    </div>
  );
}

function SensorStatusBadge({
  status,
  enabled,
  health,
  fr,
}: {
  status: string;
  enabled: boolean;
  health: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  fr: boolean;
}) {
  if (!enabled) {
    return <span className="modern-status-badge is-disabled">{fr ? 'Désactivé' : 'Disabled'}</span>;
  }

  switch (status) {
    case 'OPERATIONAL':
      return (
        <span className="modern-status-badge is-operational">
          {fr ? 'Opérationnel' : 'Operational'}
        </span>
      );
    case 'NEEDS_PLACEMENT':
      return (
        <span className="modern-status-badge is-placement">{fr ? 'À placer' : 'To place'}</span>
      );
    case 'NEEDS_TEST':
      return (
        <span
          className={`modern-status-badge ${health === 'ONLINE' ? 'is-operational' : 'is-test'}`}
        >
          {health === 'ONLINE'
            ? fr
              ? 'Connecté · validation à faire'
              : 'Connected · validation pending'
            : fr
              ? 'Validation à faire'
              : 'Validation pending'}
        </span>
      );
    case 'NEEDS_CONFIRMATION':
      return (
        <span className="modern-status-badge is-attention">{fr ? 'À identifier' : 'Identify'}</span>
      );
    case 'ATTENTION':
      return (
        <span className="modern-status-badge is-attention">{fr ? 'À vérifier' : 'Check'}</span>
      );
    case 'DETECTED':
      return (
        <span className="modern-status-badge is-placement">{fr ? 'Détecté' : 'Detected'}</span>
      );
    default:
      return <span className="modern-status-badge is-neutral">{status}</span>;
  }
}
