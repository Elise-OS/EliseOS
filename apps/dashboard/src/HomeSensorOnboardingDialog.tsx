import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import type { HomePlan, RoomSensorCategory, SensorProduct } from '@elise/contracts';
import {
  ROOM_SENSOR_CATEGORIES,
  isBedOccupancySensorModel,
  roomSupportsCategory,
} from '@elise/contracts';
import {
  Activity,
  Camera,
  ArrowLeft,
  Bath,
  BedDouble,
  Bell,
  Boxes,
  Check,
  ChevronRight,
  CookingPot,
  DoorOpen,
  Droplets,
  Flame,
  Footprints,
  House,
  Plus,
  Radio,
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
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { EquipmentDialog } from './EquipmentDialog';
import { dateLocale, type Locale, t } from './i18n';
import { SENSOR_PRODUCTS, productsForCategory } from './sensor-products';
import { SensorOnboardingDialog } from './SensorOnboardingDialog';
import {
  connectedDevicesForCategory,
  sensorJson,
  sensorRequest,
  type SensorUiDevice,
} from './sensor-ui';
import { productTexts, sensorCategoryDescription, sensorCategoryLabel } from './i18n/data';

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

const roomIcons: Record<string, typeof House> = {
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
  STORAGE: Boxes,
};

export const roomIcon = (kind: string, name: string) => {
  if (kind !== 'OTHER' && roomIcons[kind]) return roomIcons[kind];
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/salon|sejour/.test(normalized)) return Sofa;
  if (/cuisine/.test(normalized)) return CookingPot;
  if (/chambre/.test(normalized)) return BedDouble;
  if (/salle de bain|sdb|douche/.test(normalized)) return Bath;
  if (/toilette|\bwc\b/.test(normalized)) return Toilet;
  if (/entree|vestibule/.test(normalized)) return DoorOpen;
  if (/couloir|degagement|palier/.test(normalized)) return Footprints;
  if (/salle a manger/.test(normalized)) return Utensils;
  if (/garage/.test(normalized)) return Warehouse;
  if (/jardin/.test(normalized)) return Trees;
  if (/terrasse|balcon/.test(normalized)) return Sun;
  if (/cagibi|cellier|rangement|placard|reserve/.test(normalized)) return Boxes;
  return House;
};

type Step = 'ROOM' | 'CATEGORY' | 'CATALOG' | 'PRODUCT' | 'ASSIGN' | 'INSTALL';

export function HomeSensorOnboardingDialog({
  open,
  locale,
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
}: {
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
  const [step, setStep] = useState<Step>('ROOM');
  const [roomId, setRoomId] = useState('');
  const [category, setCategory] = useState<RoomSensorCategory | undefined>();
  const [tab, setTab] = useState<'PRODUCTS' | 'CONNECTED'>('PRODUCTS');
  const [product, setProduct] = useState<SensorProduct | undefined>();
  const [assigning, setAssigning] = useState<SensorUiDevice | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [bedOccupiedWhen, setBedOccupiedWhen] = useState<'CLOSED' | 'OPEN'>('CLOSED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep(
      initialRoomId
        ? initialProduct
          ? 'PRODUCT'
          : initialCategory
            ? 'CATALOG'
            : 'CATEGORY'
        : 'ROOM',
    );
    setRoomId(initialRoomId ?? '');
    setCategory(initialCategory);
    setTab('PRODUCTS');
    setProduct(initialProduct);
    setAssigning(null);
    setBedOccupiedWhen(
      initialProduct && isBedOccupancySensorModel(initialProduct.model) ? 'OPEN' : 'CLOSED',
    );
    setError('');
  }, [open, initialRoomId, initialCategory, initialProduct, initialTarget?.id]);

  if (!open) return null;

  const rooms = plan.levels.flatMap((level) =>
    level.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      floor: level.floor,
      floorName: level.name,
    })),
  );

  if (step === 'INSTALL' && roomId) {
    return (
      <SensorOnboardingDialog
        open
        locale={locale}
        rooms={rooms}
        initialRoomId={roomId}
        initialTarget={category === 'bed' ? undefined : initialTarget}
        category={category}
        contactRole={category === 'bed' ? 'BED' : undefined}
        bedOccupiedWhen={bedOccupiedWhen}
        product={product}
        onClose={onClose}
        onInstalled={onInstalled}
      />
    );
  }

  const selectedRoom = rooms.find((room) => room.id === roomId);
  const selectedCategory = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category);
  const requestedCategory = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === initialCategory);
  const outdoor = plan.levels
    .flatMap(({ rooms }) => rooms)
    .some(({ id, kind }) => id === roomId && ['GARDEN', 'TERRACE'].includes(kind));
  const products = category
    ? productsForCategory(category, outdoor)
    : initialProduct && initialProduct.kind !== 'ROOM_SENSOR'
      ? SENSOR_PRODUCTS.filter((item) => item.kind !== 'ROOM_SENSOR' && (!outdoor || item.outdoor))
      : [];
  const compatible = category ? connectedDevicesForCategory(devices, category) : [];

  const assign = async () => {
    if (!assigning || !name.trim()) return;
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
      await onInstalled();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <EquipmentDialog
      title={
        step === 'ROOM'
          ? t('homeSensorOnboardingDialog.chooseARoom')
          : step === 'CATEGORY'
            ? (initialTargetLabel ?? selectedRoom?.name)
              ? t('homeSensorOnboardingDialog.addTo', {
                  place: initialTargetLabel ?? selectedRoom?.name,
                })
              : t('homeSensorOnboardingDialog.addToTheRoom')
            : `${selectedCategory ? sensorCategoryLabel(selectedCategory.id) : t('homeSensorOnboardingDialog.sensor')} · ${initialTargetLabel ?? selectedRoom?.name ?? ''}`
      }
      onClose={onClose}
      busy={busy}
    >
      <div className="home-sensor-flow">
        <ol className="home-sensor-flow-steps" aria-label={t('homeSensorOnboardingDialog.steps')}>
          <li className="is-active">
            <span>{step !== 'ROOM' ? <Check /> : '1'}</span>
            {t('homeSensorOnboardingDialog.room')}
          </li>
          <li className={step !== 'ROOM' ? 'is-active' : ''}>
            <span>{!['ROOM', 'CATEGORY'].includes(step) ? <Check /> : '2'}</span>
            {t('homeSensorOnboardingDialog.sensorType')}
          </li>
        </ol>

        {step === 'ROOM' ? (
          <>
            <div className="home-sensor-flow-intro">
              <span className="home-sensor-flow-icon">
                <House />
              </span>
              <div>
                <h3>{t('homeSensorOnboardingDialog.whereWillYouInstallIt')}</h3>
                <p>
                  {requestedCategory
                    ? t('homeSensorOnboardingDialog.chooseRoomFor', {
                        category: sensorCategoryLabel(requestedCategory.id),
                      })
                    : t('homeSensorOnboardingDialog.choosingARoomLetsElise')}
                </p>
              </div>
            </div>
            <div className="home-sensor-room-groups">
              {plan.levels.map((level) => (
                <section key={level.id}>
                  <h4>{level.name}</h4>
                  <div className="home-sensor-room-grid">
                    {level.rooms.map((room) => {
                      const RoomIcon = roomIcon(room.kind, room.name);
                      return (
                        <button
                          key={room.id}
                          onClick={() => {
                            setRoomId(room.id);
                            if (
                              initialCategory &&
                              roomSupportsCategory(room.kind, initialCategory)
                            ) {
                              setCategory(initialCategory);
                              setTab('PRODUCTS');
                              setStep('CATALOG');
                            } else {
                              setStep('CATEGORY');
                            }
                          }}
                        >
                          <span
                            className="home-sensor-room-icon"
                            style={{ background: room.geometry.color }}
                          >
                            <RoomIcon />
                          </span>
                          <span>
                            <strong>{room.name}</strong>
                            <small>
                              {room.areaM2 != null
                                ? `${new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(room.areaM2)} m²`
                                : t('homeSensorOnboardingDialog.chooseThisRoom')}
                            </small>
                          </span>
                          <Plus />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            {!rooms.length && (
              <p className="equipment-note" role="status">
                {t('homeSensorOnboardingDialog.noRoomsAreDefinedClose')}
              </p>
            )}
          </>
        ) : step === 'CATEGORY' ? (
          <>
            <button className="equipment-text-button" onClick={() => setStep('ROOM')}>
              <ArrowLeft />
              {t('homeSensorOnboardingDialog.changeRoom')}
            </button>
            <div className="home-sensor-flow-intro is-compact">
              <div>
                <h3>{t('homeSensorOnboardingDialog.whatDoYouWantTo')}</h3>
                <p>{t('homeSensorOnboardingDialog.everySensorTypeSupportedBy')}</p>
              </div>
            </div>
            <div className="equipment-category-picker home-sensor-category-picker">
              {ROOM_SENSOR_CATEGORIES.filter(
                ({ id }) =>
                  (!selectedRoom || roomSupportsCategory(selectedRoom.kind, id)) &&
                  (!allowedCategories || allowedCategories.includes(id)),
              ).map((definition) => {
                const Icon = categoryIcons[definition.id];
                return (
                  <button
                    key={definition.id}
                    onClick={() => {
                      setCategory(definition.id);
                      setTab('PRODUCTS');
                      setStep('CATALOG');
                    }}
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
            </div>
          </>
        ) : step === 'ASSIGN' && assigning ? (
          <>
            <button className="equipment-text-button" onClick={() => setStep('CATALOG')}>
              <ArrowLeft /> {t('homeSensorOnboardingDialog.backToSensors')}
            </button>
            <h3>{assigning.name}</h3>
            {assigning.room && assigning.room.id !== roomId && (
              <p className="equipment-note">
                {t('homeSensorOnboardingDialog.thisDeviceAndAllIts', {
                  name: assigning.room.name,
                  name2: selectedRoom?.name,
                })}
              </p>
            )}
            <label className="equipment-field">
              {t('homeSensorOnboardingDialog.name')}
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="equipment-field">
              {t('homeSensorOnboardingDialog.locationOptional')}
              <input
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('homeSensorOnboardingDialog.forExampleByTheBed')}
              />
            </label>
            {category === 'bed' && (
              <p className="equipment-note">
                {assigning
                  ? isBedOccupancySensorModel(assigning.model)
                    ? t('homeSensorOnboardingDialog.theTuyaStripConnectsDirectly')
                    : t('homeSensorOnboardingDialog.connectADryContactPressure')
                  : t('homeSensorOnboardingDialog.theTuyaStripSitsUnder')}
              </p>
            )}
            {category === 'bed' && (!assigning || !isBedOccupancySensorModel(assigning.model)) && (
              <label className="equipment-field">
                {t('homeSensorOnboardingDialog.whenTheBedIsOccupied')}
                <select
                  value={bedOccupiedWhen}
                  onChange={(event) => setBedOccupiedWhen(event.target.value as 'CLOSED' | 'OPEN')}
                >
                  <option value="CLOSED">
                    {t('homeSensorOnboardingDialog.theContactIsClosed')}
                  </option>
                  <option value="OPEN">{t('homeSensorOnboardingDialog.theContactIsOpen')}</option>
                </select>
              </label>
            )}
            <footer className="equipment-dialog-footer">
              <button
                className="equipment-primary"
                disabled={busy || !name.trim()}
                onClick={() => void assign()}
              >
                <Check />
                {assigning.room?.id === roomId
                  ? t('homeSensorOnboardingDialog.save')
                  : t('homeSensorOnboardingDialog.assignTo', { name: selectedRoom?.name })}
              </button>
            </footer>
          </>
        ) : step === 'PRODUCT' && product ? (
          <>
            <button className="equipment-text-button" onClick={() => setStep('CATALOG')}>
              <ArrowLeft /> {t('homeSensorOnboardingDialog.allProducts')}
            </button>
            <div className="equipment-product-detail">
              <ProductPhoto product={product} />
              <div>
                <span className="equipment-kicker">{product.brand}</span>
                <h3>{productTexts(product).name}</h3>
                <p>{product.model}</p>
                <span className="equipment-product-badge">
                  {t('homeSensorOnboardingDialog.documentedCompatibility')}
                </span>
              </div>
            </div>
            <div className="equipment-capability-tags">
              {product.categories.map((id) => (
                <span key={id}>{sensorCategoryLabel(id)}</span>
              ))}
            </div>
            <h4>{t('homeSensorOnboardingDialog.documentedFeatures')}</h4>
            <ul>
              {productTexts(product).features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <footer className="equipment-dialog-footer">
              <button className="equipment-primary" onClick={() => setStep('INSTALL')}>
                {t('homeSensorOnboardingDialog.installThisSensor')} <ChevronRight />
              </button>
            </footer>
          </>
        ) : (
          <>
            <button className="equipment-text-button" onClick={() => setStep('CATEGORY')}>
              <ArrowLeft /> {t('homeSensorOnboardingDialog.changeType')}
            </button>
            <h3>{t('homeSensorOnboardingDialog.addASensor')}</h3>
            <div className="equipment-catalog-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'PRODUCTS'}
                onClick={() => setTab('PRODUCTS')}
              >
                {t('homeSensorOnboardingDialog.documentedProducts')}
              </button>
              <button
                role="tab"
                aria-selected={tab === 'CONNECTED'}
                onClick={() => setTab('CONNECTED')}
              >
                {t('homeSensorOnboardingDialog.alreadyConnected')} <span>{compatible.length}</span>
              </button>
            </div>
            {tab === 'PRODUCTS' ? (
              <div className="equipment-product-grid">
                {products.map((item) => (
                  <SensorProductCard
                    key={item.id}
                    product={item}
                    onSelect={() => {
                      setProduct(item);
                      setStep('PRODUCT');
                    }}
                  />
                ))}
              </div>
            ) : (
              <div>
                {compatible.map((device) => (
                  <button
                    className="equipment-connected-choice"
                    key={device.id}
                    onClick={() => {
                      setAssigning(device);
                      setName(device.name);
                      setNote(device.placementNote ?? '');
                      if (category === 'bed')
                        setBedOccupiedWhen(
                          isBedOccupancySensorModel(device.model) ? 'OPEN' : 'CLOSED',
                        );
                      setStep('ASSIGN');
                    }}
                  >
                    <Radio />
                    <span>
                      <strong>{device.name}</strong>
                      <small>
                        {device.room?.id === roomId
                          ? t('homeSensorOnboardingDialog.alreadyInThisRoom')
                          : (device.room?.name ?? t('homeSensorOnboardingDialog.unassigned'))}
                      </small>
                      {device.batteryPercent !== null && (
                        <small>
                          {t('homeSensorOnboardingDialog.battery')} {device.batteryPercent} %
                        </small>
                      )}
                    </span>
                    {device.room?.id === roomId ? <Check /> : <Plus />}
                  </button>
                ))}
                {!compatible.length && (
                  <p className="equipment-note">
                    {t('homeSensorOnboardingDialog.noCompatibleDeviceIsConnected')}
                  </p>
                )}
              </div>
            )}
            <button
              className="equipment-unlisted"
              onClick={() => {
                setProduct(undefined);
                setStep('INSTALL');
              }}
            >
              <Radio />
              <span>
                {t('homeSensorOnboardingDialog.myModelIsNotListed')}
                <small>{t('homeSensorOnboardingDialog.startAutomaticDetection')}</small>
              </span>
              <ChevronRight />
            </button>
          </>
        )}
        {error && (
          <p className="equipment-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </EquipmentDialog>
  );
}
