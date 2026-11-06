import type { HomePlan, RoomSensorCategory, SensorProduct } from '@elise/contracts';
import {
  ROOM_SENSOR_CATEGORIES,
  isBedOccupancySensorModel,
  roomSupportsCategory,
} from '@elise/contracts';
import {
  Activity,
  BedDouble,
  Bell,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  DoorOpen,
  Droplets,
  Flame,
  LoaderCircle,
  MapPin,
  Plug,
  Radio,
  ScanSearch,
  ShieldAlert,
  Sun,
  Thermometer,
  UserRound,
  Wind,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { roomIcon } from './home-visuals';
import { dateLocale, type Locale, t } from './i18n';
import { productTexts, sensorCategoryDescription, sensorCategoryLabel } from './i18n/data';
import { BedContactChoice, SensorInstalledPage, SensorPairingFlow } from './SensorOnboardingDialog';
import { ProductPhoto } from './SensorProductCard';
import {
  SetupField,
  SetupList,
  SetupNotice,
  SetupPage,
  SetupRow,
  SetupSection,
  SetupSegmented,
  SetupSheet,
  SetupTile,
  useSetupStep,
  useSheetControls,
} from './SetupSheet';
import { SENSOR_PRODUCTS, productsForCategory, sensorDevicePhoto } from './sensor-products';
import {
  connectedDevicesForCategory,
  sensorJson,
  sensorRequest,
  type SensorUiDevice,
} from './sensor-ui';

const categoryIcons: Record<RoomSensorCategory, typeof Thermometer> = {
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

/** Sensor kinds, gathered the way a family thinks about them. */
const categoryGroups: Array<{
  id: 'activity' | 'openings' | 'safety' | 'comfort';
  categories: RoomSensorCategory[];
}> = [
  { id: 'activity', categories: ['presence', 'motion', 'fall_detection', 'bed'] },
  { id: 'openings', categories: ['contact', 'button', 'camera'] },
  { id: 'safety', categories: ['smoke', 'carbon_monoxide', 'water_leak'] },
  {
    id: 'comfort',
    categories: ['temperature', 'humidity', 'shower', 'air_quality', 'illuminance'],
  },
];

type Step = 'ROOM' | 'CATEGORY' | 'CATALOG' | 'PRODUCT' | 'ASSIGN' | 'PAIR' | 'DONE';
const TOTAL = 6;
const stepProgress: Record<Exclude<Step, 'PAIR' | 'DONE'>, number> = {
  ROOM: 1,
  CATEGORY: 2,
  CATALOG: 3,
  PRODUCT: 3,
  ASSIGN: 6,
};

export function HomeSensorOnboardingDialog(props: {
  open: boolean;
  locale: Locale;
  plan: HomePlan;
  devices: SensorUiDevice[];
  initialRoomId?: string;
  initialCategory?: RoomSensorCategory | undefined;
  initialProduct?: SensorProduct;
  initialTarget?: { type: 'OPENING' | 'STAIR'; id: string };
  initialTargetLabel?: string;
  allowedCategories?: RoomSensorCategory[];
  onClose: () => void;
  onInstalled: () => Promise<void>;
}) {
  if (!props.open) return null;
  return (
    <SetupSheet onClose={props.onClose}>
      <HomeSensorFlow {...props} />
    </SetupSheet>
  );
}

function HomeSensorFlow({
  plan,
  devices,
  initialRoomId,
  initialCategory,
  initialProduct,
  initialTarget,
  initialTargetLabel,
  allowedCategories,
  onClose,
  onInstalled,
}: Parameters<typeof HomeSensorOnboardingDialog>[0]) {
  const firstStep: Step = initialRoomId
    ? initialProduct
      ? 'PRODUCT'
      : initialCategory
        ? 'CATALOG'
        : 'CATEGORY'
    : 'ROOM';
  const { step, direction, go, back, reset } = useSetupStep<Step>(firstStep);
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [category, setCategory] = useState<RoomSensorCategory | undefined>(initialCategory);
  const [tab, setTab] = useState<'PRODUCTS' | 'CONNECTED'>('PRODUCTS');
  const [product, setProduct] = useState<SensorProduct | undefined>(initialProduct);
  const [assigning, setAssigning] = useState<SensorUiDevice | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [bedOccupiedWhen, setBedOccupiedWhen] = useState<'CLOSED' | 'OPEN'>(
    initialProduct && isBedOccupancySensorModel(initialProduct.model) ? 'OPEN' : 'CLOSED',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pairingRun, setPairingRun] = useState(0);
  useSheetControls({ busy, onClose });

  // The parent can point the same open flow at another room, kind or product.
  useEffect(() => {
    reset(firstStep);
    setRoomId(initialRoomId ?? '');
    setCategory(initialCategory);
    setProduct(initialProduct);
    setTab('PRODUCTS');
    setAssigning(null);
    setError('');
    // The initial values identify one flow; `reset` only replaces state.
  }, [initialRoomId, initialCategory, initialProduct, initialTarget?.id]);

  const rooms = plan.levels.flatMap((level) =>
    level.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      floor: level.floor,
      floorName: level.name,
    })),
  );
  const selectedRoom = rooms.find((room) => room.id === roomId);
  const place = initialTargetLabel ?? selectedRoom?.name ?? '';
  const outdoor = !!selectedRoom && ['GARDEN', 'TERRACE'].includes(selectedRoom.kind);
  const products = category
    ? productsForCategory(category, outdoor)
    : initialProduct && initialProduct.kind !== 'ROOM_SENSOR'
      ? SENSOR_PRODUCTS.filter((item) => item.kind !== 'ROOM_SENSOR' && (!outdoor || item.outdoor))
      : [];
  const compatible = category ? connectedDevicesForCategory(devices, category) : [];
  const devicesInRoom = (id: string) => devices.filter((device) => device.room?.id === id).length;
  const progress = (value: number) => ({ value, total: TOTAL });
  const placeChip = place ? (
    <span className="ss-place">
      <MapPin aria-hidden />
      {place}
    </span>
  ) : undefined;

  const restart = () => {
    setProduct(undefined);
    setAssigning(null);
    setError('');
    if (initialRoomId) {
      setCategory(initialCategory);
      reset(initialCategory ? 'CATALOG' : 'CATEGORY');
    } else {
      setRoomId('');
      setCategory(initialCategory);
      reset('ROOM');
    }
  };

  const chooseRoom = (id: string, kind: string) => {
    setRoomId(id);
    setError('');
    if (initialCategory && roomSupportsCategory(kind, initialCategory)) {
      setCategory(initialCategory);
      setTab('PRODUCTS');
      go('CATALOG');
    } else go('CATEGORY');
  };

  const assign = async () => {
    if (!assigning || !name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await sensorRequest(
        `/api/v1/sensor-devices/${encodeURIComponent(assigning.id)}`,
        sensorJson('PATCH', {
          roomId,
          name: name.trim(),
          target: category === 'bed' ? { type: 'ROOM', id: roomId } : (initialTarget ?? null),
          placementNote: note.trim() || null,
          buttonRole: 'ASSISTANCE',
          ...(category === 'bed' ? { contactRole: 'BED', bedOccupiedWhen } : {}),
        }),
      );
      go('DONE');
      void onInstalled().catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'PAIR' && roomId)
    return (
      <SensorPairingFlow
        key={pairingRun}
        rooms={rooms}
        initialRoomId={roomId}
        initialTarget={category === 'bed' ? undefined : initialTarget}
        category={category}
        contactRole={category === 'bed' ? 'BED' : undefined}
        bedOccupiedWhen={bedOccupiedWhen}
        product={product}
        progress={{ offset: 3, total: TOTAL }}
        onBack={() => back(product ? 'PRODUCT' : 'CATALOG')}
        backLabel={product ? productTexts(product).name : t('sensorSetup.devices')}
        onClose={onClose}
        onInstalled={onInstalled}
        onAddAnother={() => {
          setPairingRun((run) => run + 1);
          restart();
        }}
      />
    );

  if (step === 'DONE' && assigning)
    return (
      <SensorInstalledPage
        direction={direction}
        progress={TOTAL}
        name={name.trim()}
        room={selectedRoom?.name ?? place}
        photo={<DeviceIcon device={assigning} />}
        onDone={onClose}
        onAddAnother={restart}
      />
    );

  if (step === 'ASSIGN' && assigning) {
    const moving = !!assigning.room && assigning.room.id !== roomId;
    return (
      <SetupPage
        pageKey="assign"
        direction={direction}
        progress={progress(stepProgress.ASSIGN)}
        onBack={() => back('CATALOG')}
        backLabel={t('sensorSetup.devices')}
        eyebrow={t('sensorSetup.alreadyConnectedToElise')}
        title={assigning.name}
        subtitle={
          [assigning.manufacturer, assigning.model].filter(Boolean).join(' · ') || undefined
        }
        hero={
          <div className="ss-found-hero">
            <span className="ss-found-photo">
              <DeviceIcon device={assigning} />
            </span>
          </div>
        }
        footer={
          <button
            type="button"
            className="ss-primary"
            disabled={busy || !name.trim()}
            onClick={() => void assign()}
          >
            {busy ? <LoaderCircle className="ss-spinner" aria-hidden /> : <Check aria-hidden />}
            {assigning.room?.id === roomId
              ? t('sensorSetup.save')
              : t('sensorSetup.assignTo', { name: selectedRoom?.name })}
          </button>
        }
      >
        {moving && (
          <SetupNotice tone="warning">
            {t('sensorSetup.thisDeviceAndAllIts', {
              name: assigning.room?.name,
              name2: selectedRoom?.name,
            })}
          </SetupNotice>
        )}
        <div className="ss-form">
          <SetupField label={t('sensorSetup.name')}>
            <input
              value={name}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </SetupField>
          <SetupField label={t('sensorSetup.locationOptional')}>
            <input
              value={note}
              maxLength={500}
              autoComplete="off"
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('sensorSetup.forExampleByTheBed')}
            />
          </SetupField>
          {category === 'bed' && (
            <SetupNotice>
              {isBedOccupancySensorModel(assigning.model)
                ? t('sensorSetup.theTuyaStripConnectsDirectly')
                : t('sensorSetup.connectADryContactPressure')}
            </SetupNotice>
          )}
          {category === 'bed' && !isBedOccupancySensorModel(assigning.model) && (
            <BedContactChoice value={bedOccupiedWhen} onChange={setBedOccupiedWhen} />
          )}
        </div>
        {error && <SetupNotice tone="danger">{error}</SetupNotice>}
      </SetupPage>
    );
  }

  if (step === 'PRODUCT' && product) {
    const texts = productTexts(product);
    return (
      <SetupPage
        pageKey={`product-${product.id}`}
        direction={direction}
        progress={progress(stepProgress.PRODUCT)}
        onBack={() => back('CATALOG')}
        backLabel={t('sensorSetup.devices')}
        eyebrow={product.brand}
        title={texts.name}
        subtitle={product.model}
        hero={
          <div className="ss-product-hero">
            <ProductPhoto product={product} />
          </div>
        }
        footer={
          <button type="button" className="ss-primary" onClick={() => go('PAIR')}>
            {t('sensorSetup.installThisSensor')}
            <ChevronRight aria-hidden />
          </button>
        }
      >
        <div className="ss-tags">
          <span className="is-accent">
            <Radio aria-hidden /> {product.protocol === 'zigbee' ? 'Zigbee' : product.protocol}
          </span>
          {product.compatibility === 'DOCUMENTED' && (
            <span>
              <Check aria-hidden /> {t('sensorSetup.documentedCompatibility')}
            </span>
          )}
          {product.categories.map((id) => (
            <span key={id}>{sensorCategoryLabel(id)}</span>
          ))}
        </div>
        <SetupSection title={t('sensorSetup.documentedFeatures')}>
          <SetupList>
            {texts.features.map((feature) => (
              <SetupRow key={feature} icon={<Check aria-hidden />} title={feature} />
            ))}
          </SetupList>
        </SetupSection>
        <SetupSection title={t('sensorSetup.practical')}>
          <SetupList>
            <SetupRow
              icon={<Plug aria-hidden />}
              title={t('sensorSetup.power')}
              detail={texts.power}
            />
            {product.manualUrl && (
              <a className="ss-row" href={product.manualUrl} target="_blank" rel="noreferrer">
                <span className="ss-row-icon">
                  <BookOpen aria-hidden />
                </span>
                <span className="ss-row-text">
                  <strong>{t('sensorSetup.manual')}</strong>
                  <small>{t('sensorSetup.manualDetail')}</small>
                </span>
                <ChevronRight className="ss-row-chevron" aria-hidden />
              </a>
            )}
          </SetupList>
        </SetupSection>
      </SetupPage>
    );
  }

  if (step === 'CATALOG' || step === 'PRODUCT') {
    const showConnected = compatible.length > 0 && tab === 'CONNECTED';
    return (
      <SetupPage
        pageKey={`catalog-${category ?? 'any'}`}
        direction={direction}
        progress={progress(stepProgress.CATALOG)}
        onBack={initialCategory && initialRoomId ? undefined : () => back('CATEGORY')}
        backLabel={t('sensorSetup.usage')}
        eyebrow={
          <>
            {category ? sensorCategoryLabel(category) : t('sensorSetup.sensor')}
            {placeChip}
          </>
        }
        title={t('sensorSetup.chooseYourDevice')}
        subtitle={t('sensorSetup.chooseYourDeviceText')}
      >
        {compatible.length > 0 && (
          <SetupSegmented
            label={t('sensorSetup.devices')}
            value={tab}
            onChange={setTab}
            options={[
              {
                value: 'PRODUCTS',
                label: (
                  <>
                    {t('sensorSetup.documentedProducts')}{' '}
                    <span className="ss-count">{products.length}</span>
                  </>
                ),
              },
              {
                value: 'CONNECTED',
                label: (
                  <>
                    {t('sensorSetup.alreadyConnected')}{' '}
                    <span className="ss-count">{compatible.length}</span>
                  </>
                ),
              },
            ]}
          />
        )}
        {showConnected ? (
          <SetupList>
            {compatible.map((device) => (
              <SetupRow
                key={device.id}
                icon={<DeviceIcon device={device} />}
                title={device.name}
                detail={[
                  device.room?.id === roomId
                    ? t('sensorSetup.alreadyInThisRoom')
                    : (device.room?.name ?? t('sensorSetup.unassigned')),
                  device.batteryPercent !== null
                    ? t('sensorSetup.battery', { value: device.batteryPercent })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  device.room?.id === roomId ? (
                    <Check className="ss-row-check" aria-hidden />
                  ) : undefined
                }
                onSelect={() => {
                  setAssigning(device);
                  setName(device.name);
                  setNote(device.placementNote ?? '');
                  if (category === 'bed')
                    setBedOccupiedWhen(isBedOccupancySensorModel(device.model) ? 'OPEN' : 'CLOSED');
                  setError('');
                  go('ASSIGN');
                }}
              />
            ))}
          </SetupList>
        ) : products.length > 0 ? (
          <div className="ss-products">
            {products.map((item) => (
              <button
                type="button"
                className="ss-product"
                key={item.id}
                onClick={() => {
                  setProduct(item);
                  go('PRODUCT');
                }}
              >
                <span className="ss-product-photo">
                  <ProductPhoto product={item} />
                </span>
                <span className="ss-product-text">
                  <small>{item.brand}</small>
                  <strong>{productTexts(item).name}</strong>
                  <span>
                    {item.categories.length
                      ? item.categories.map((id) => sensorCategoryLabel(id)).join(' · ')
                      : t('sensorProductCard.powerEnergy')}
                  </span>
                </span>
                <ChevronRight className="ss-product-chevron" aria-hidden />
              </button>
            ))}
          </div>
        ) : (
          <SetupNotice>{t('sensorSetup.noDocumentedProduct')}</SetupNotice>
        )}
        <SetupList>
          <SetupRow
            tone="accent"
            icon={<ScanSearch aria-hidden />}
            title={t('sensorSetup.myModelIsNotListed')}
            detail={t('sensorSetup.startAutomaticDetection')}
            onSelect={() => {
              setProduct(undefined);
              go('PAIR');
            }}
          />
        </SetupList>
      </SetupPage>
    );
  }

  if (step === 'CATEGORY' && selectedRoom) {
    const available = (id: RoomSensorCategory) =>
      roomSupportsCategory(selectedRoom.kind, id) &&
      (!allowedCategories || allowedCategories.includes(id));
    const groups = categoryGroups
      .map((group) => ({ ...group, categories: group.categories.filter(available) }))
      .filter((group) => group.categories.length > 0);
    // Kinds Élise knows but that no group lists still appear, at the end.
    const grouped = new Set(categoryGroups.flatMap((group) => group.categories));
    const others = ROOM_SENSOR_CATEGORIES.map(({ id }) => id).filter(
      (id) => !grouped.has(id) && available(id),
    );
    return (
      <SetupPage
        pageKey="category"
        direction={direction}
        progress={progress(stepProgress.CATEGORY)}
        onBack={initialRoomId ? undefined : () => back('ROOM')}
        backLabel={t('sensorSetup.rooms')}
        eyebrow={placeChip}
        title={t('sensorSetup.whatDoYouWantTo')}
        subtitle={t('sensorSetup.everySensorTypeSupportedBy')}
      >
        {[...groups, ...(others.length ? [{ id: 'other' as const, categories: others }] : [])].map(
          (group) => (
            <SetupSection key={group.id} title={t(`sensorSetup.groups.${group.id}`)}>
              <div className="ss-tiles">
                {group.categories.map((id) => {
                  const Icon = categoryIcons[id];
                  const installed = connectedDevicesForCategory(devices, id).some(
                    (device) => device.room?.id === roomId,
                  );
                  return (
                    <SetupTile
                      key={id}
                      icon={<Icon aria-hidden />}
                      tint={`var(--ss-group-${group.id}, var(--ss-fill))`}
                      title={sensorCategoryLabel(id)}
                      detail={sensorCategoryDescription(id)}
                      badge={
                        installed ? (
                          <>
                            <Check aria-hidden /> {t('sensorSetup.installed')}
                          </>
                        ) : undefined
                      }
                      onSelect={() => {
                        setCategory(id);
                        setTab('PRODUCTS');
                        go('CATALOG');
                      }}
                    />
                  );
                })}
              </div>
            </SetupSection>
          ),
        )}
      </SetupPage>
    );
  }
  // ROOM
  return (
    <SetupPage
      pageKey="room"
      direction={direction}
      progress={progress(stepProgress.ROOM)}
      title={t('sensorSetup.whereWillYouInstallIt')}
      subtitle={
        initialCategory
          ? t('sensorSetup.chooseRoomFor', { category: sensorCategoryLabel(initialCategory) })
          : t('sensorSetup.choosingARoomLetsElise')
      }
    >
      {plan.levels
        .filter((level) => level.rooms.length > 0)
        .map((level) => (
          <SetupSection
            key={level.id}
            title={plan.levels.length > 1 ? level.name : undefined}
            aside={
              plan.levels.length > 1
                ? t('sensorSetup.roomCount', { count: level.rooms.length })
                : undefined
            }
          >
            <div className="ss-tiles">
              {level.rooms.map((room) => {
                const RoomIcon = roomIcon(room);
                const count = devicesInRoom(room.id);
                const area =
                  room.areaM2 != null
                    ? `${new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(room.areaM2)} m²`
                    : null;
                return (
                  <SetupTile
                    key={room.id}
                    icon={<RoomIcon aria-hidden />}
                    tint={room.geometry.color}
                    title={room.name}
                    detail={
                      [area, count ? t('sensorSetup.sensorCount', { count }) : null]
                        .filter(Boolean)
                        .join(' · ') || t('sensorSetup.noSensorYet')
                    }
                    onSelect={() => chooseRoom(room.id, room.kind)}
                  />
                );
              })}
            </div>
          </SetupSection>
        ))}
      {!rooms.length && (
        <SetupNotice title={t('sensorSetup.noRoomsTitle')}>
          {t('sensorSetup.noRoomsAreDefinedClose')}
        </SetupNotice>
      )}
    </SetupPage>
  );
}

function DeviceIcon({ device }: { device: SensorUiDevice }): ReactNode {
  const photo = sensorDevicePhoto(device);
  return photo ? <img src={photo} alt="" /> : <Radio aria-hidden />;
}
