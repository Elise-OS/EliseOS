import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import type { HomePlan, RoomSensorCategory, SensorProduct } from '@michel/contracts';
import { deviceSupportsCategory, ROOM_SENSOR_CATEGORIES } from '@michel/contracts';
import {
  Activity,
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
import type { Locale } from './i18n';
import { SENSOR_PRODUCTS, productsForCategory } from './sensor-products';
import { SensorOnboardingDialog } from './SensorOnboardingDialog';
import { sensorJson, sensorRequest, type SensorUiDevice } from './sensor-ui';

const categoryIcons: Record<RoomSensorCategory, typeof Thermometer> = {
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
  onClose: () => void;
  onInstalled: () => Promise<void>;
}) {
  const fr = locale === 'fr';
  const [step, setStep] = useState<Step>('ROOM');
  const [roomId, setRoomId] = useState('');
  const [category, setCategory] = useState<RoomSensorCategory | undefined>();
  const [tab, setTab] = useState<'PRODUCTS' | 'CONNECTED'>('PRODUCTS');
  const [product, setProduct] = useState<SensorProduct | undefined>();
  const [assigning, setAssigning] = useState<SensorUiDevice | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
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
    setError('');
  }, [open, initialRoomId, initialCategory, initialProduct]);

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
        category={category}
        product={product}
        onClose={onClose}
        onInstalled={onInstalled}
      />
    );
  }

  const selectedRoom = rooms.find((room) => room.id === roomId);
  const selectedCategory = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category);
  const outdoor = plan.levels
    .flatMap(({ rooms }) => rooms)
    .some(({ id, kind }) => id === roomId && ['GARDEN', 'TERRACE'].includes(kind));
  const products = category
    ? productsForCategory(category, outdoor)
    : initialProduct && initialProduct.kind !== 'ROOM_SENSOR'
      ? SENSOR_PRODUCTS.filter((item) => item.kind !== 'ROOM_SENSOR' && (!outdoor || item.outdoor))
      : [];
  const compatible = category
    ? devices.filter(
        (device) => deviceSupportsCategory(device, category) && device.room?.id !== roomId,
      )
    : [];

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
          placementNote: note.trim() || null,
          buttonRole: 'ASSISTANCE',
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
          ? fr
            ? 'Choisir la pièce'
            : 'Choose a room'
          : step === 'CATEGORY'
            ? fr
              ? `Ajouter dans ${selectedRoom?.name ?? 'la pièce'}`
              : `Add to ${selectedRoom?.name ?? 'the room'}`
            : `${selectedCategory?.[fr ? 'label' : 'labelEn'] ?? (fr ? 'Capteur' : 'Sensor')} · ${selectedRoom?.name ?? ''}`
      }
      onClose={onClose}
      busy={busy}
    >
      <div className="home-sensor-flow">
        <ol className="home-sensor-flow-steps" aria-label={fr ? 'Étapes' : 'Steps'}>
          <li className="is-active">
            <span>{step !== 'ROOM' ? <Check /> : '1'}</span>
            {fr ? 'Pièce' : 'Room'}
          </li>
          <li className={step !== 'ROOM' ? 'is-active' : ''}>
            <span>{!['ROOM', 'CATEGORY'].includes(step) ? <Check /> : '2'}</span>
            {fr ? 'Type de capteur' : 'Sensor type'}
          </li>
        </ol>

        {step === 'ROOM' ? (
          <>
            <div className="home-sensor-flow-intro">
              <span className="home-sensor-flow-icon">
                <House />
              </span>
              <div>
                <h3>{fr ? 'Où souhaitez-vous l’installer ?' : 'Where will you install it?'}</h3>
                <p>
                  {fr
                    ? 'Le choix de la pièce permet à Élise de proposer les bons usages et le bon emplacement.'
                    : 'Choosing a room lets Élise suggest the right uses and placement.'}
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
                            setStep('CATEGORY');
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
                                ? `${new Intl.NumberFormat(fr ? 'fr-FR' : 'en', { maximumFractionDigits: 1 }).format(room.areaM2)} m²`
                                : fr
                                  ? 'Choisir cette pièce'
                                  : 'Choose this room'}
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
          </>
        ) : step === 'CATEGORY' ? (
          <>
            <button className="equipment-text-button" onClick={() => setStep('ROOM')}>
              <ArrowLeft />
              {fr ? 'Changer de pièce' : 'Change room'}
            </button>
            <div className="home-sensor-flow-intro is-compact">
              <div>
                <h3>{fr ? 'Que souhaitez-vous détecter ?' : 'What do you want to detect?'}</h3>
                <p>
                  {fr
                    ? 'Tous les types pris en charge par Élise sont proposés ici.'
                    : 'Every sensor type supported by Élise is available here.'}
                </p>
              </div>
            </div>
            <div className="equipment-category-picker home-sensor-category-picker">
              {ROOM_SENSOR_CATEGORIES.map((definition) => {
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
                      <strong>{definition[fr ? 'label' : 'labelEn']}</strong>
                      <small>{definition[fr ? 'description' : 'descriptionEn']}</small>
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
              <ArrowLeft /> {fr ? 'Retour aux capteurs' : 'Back to sensors'}
            </button>
            <h3>{assigning.name}</h3>
            {assigning.room && (
              <p className="equipment-note">
                {fr
                  ? `Cet appareil sera déplacé de « ${assigning.room.name} » vers « ${selectedRoom?.name} », avec toutes ses mesures.`
                  : `This device and all its readings will move from ${assigning.room.name} to ${selectedRoom?.name}.`}
              </p>
            )}
            <label className="equipment-field">
              {fr ? 'Nom' : 'Name'}
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="equipment-field">
              {fr ? 'Emplacement (facultatif)' : 'Location (optional)'}
              <input
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder={fr ? 'Par exemple : côté lit' : 'For example: by the bed'}
              />
            </label>
            <footer className="equipment-dialog-footer">
              <button
                className="equipment-primary"
                disabled={busy || !name.trim()}
                onClick={() => void assign()}
              >
                <Check />
                {fr ? `Associer à ${selectedRoom?.name}` : `Assign to ${selectedRoom?.name}`}
              </button>
            </footer>
          </>
        ) : step === 'PRODUCT' && product ? (
          <>
            <button className="equipment-text-button" onClick={() => setStep('CATALOG')}>
              <ArrowLeft /> {fr ? 'Tous les produits' : 'All products'}
            </button>
            <div className="equipment-product-detail">
              <ProductPhoto product={product} />
              <div>
                <span className="equipment-kicker">{product.brand}</span>
                <h3>{fr ? product.name : product.nameEn}</h3>
                <p>{product.model}</p>
                <span className="equipment-product-badge">
                  {fr ? 'Compatibilité documentée' : 'Documented compatibility'}
                </span>
              </div>
            </div>
            <div className="equipment-capability-tags">
              {product.categories.map((id) => (
                <span key={id}>
                  {
                    ROOM_SENSOR_CATEGORIES.find((item) => item.id === id)?.[
                      fr ? 'label' : 'labelEn'
                    ]
                  }
                </span>
              ))}
            </div>
            <h4>{fr ? 'Fonctions documentées' : 'Documented features'}</h4>
            <ul>
              {(fr ? product.features : product.featuresEn).map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <footer className="equipment-dialog-footer">
              <button className="equipment-primary" onClick={() => setStep('INSTALL')}>
                {fr ? 'Installer ce capteur' : 'Install this sensor'} <ChevronRight />
              </button>
            </footer>
          </>
        ) : (
          <>
            <button className="equipment-text-button" onClick={() => setStep('CATEGORY')}>
              <ArrowLeft /> {fr ? 'Changer de type' : 'Change type'}
            </button>
            <h3>{fr ? 'Ajouter un capteur' : 'Add a sensor'}</h3>
            <div className="equipment-catalog-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'PRODUCTS'}
                onClick={() => setTab('PRODUCTS')}
              >
                {fr ? 'Produits documentés' : 'Documented products'}
              </button>
              <button
                role="tab"
                aria-selected={tab === 'CONNECTED'}
                onClick={() => setTab('CONNECTED')}
              >
                {fr ? 'Déjà connectés' : 'Already connected'} <span>{compatible.length}</span>
              </button>
            </div>
            {tab === 'PRODUCTS' ? (
              <div className="equipment-product-grid">
                {products.map((item) => (
                  <SensorProductCard
                    key={item.id}
                    product={item}
                    fr={fr}
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
                      setStep('ASSIGN');
                    }}
                  >
                    <Radio />
                    <span>
                      <strong>{device.name}</strong>
                      <small>{device.room?.name ?? (fr ? 'Sans pièce' : 'Unassigned')}</small>
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
              onClick={() => {
                setProduct(undefined);
                setStep('INSTALL');
              }}
            >
              <Radio />
              <span>
                {fr ? 'Mon modèle n’est pas dans la liste' : 'My model is not listed'}
                <small>
                  {fr ? 'Lancer la détection automatique' : 'Start automatic detection'}
                </small>
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
