import {
  ROOM_SENSOR_CATEGORIES,
  SENSOR_CATEGORY_GROUPS,
  deviceSupportsCategory,
  isBedOccupancySensorModel,
  productsForCategory,
  roomSupportsCategory,
  type HomePlan,
  type RoomSensorCategory,
  type SensorDevice,
  type SensorProduct,
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
  Plug,
  Radio,
  ScanSearch,
  ShieldAlert,
  Sun,
  Thermometer,
  UserRound,
  Wind,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { roomIcon } from '../dashboard/MobileHomePlanPanel';
import { dateLocale, t } from '../i18n';
import type { PairingApi } from './pairing';
import {
  BedContactChoice,
  DevicePicture,
  SensorInstalledPage,
  SensorPairingFlow,
} from './PairingFlow';
import { pairingErrorText } from './errors';
import { classifyPairingError } from './pairingApi';
import { productTexts, sensorCategoryDescription, sensorCategoryLabel } from './texts';
import {
  PlaceChip,
  PrimaryButton,
  ProductHero,
  ProductPhoto,
  SetupField,
  SetupList,
  SetupNotice,
  SetupPage,
  SetupRow,
  SetupSection,
  SetupSegmented,
  SetupSheet,
  SetupTile,
  Tag,
  ss,
  useSetupStep,
  useSheetControls,
} from './ui';

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

type Step = 'ROOM' | 'CATEGORY' | 'CATALOG' | 'PRODUCT' | 'ASSIGN' | 'PAIR' | 'DONE';
const TOTAL = 6;
const stepProgress = { ROOM: 1, CATEGORY: 2, CATALOG: 3, PRODUCT: 3, ASSIGN: 6 } as const;

export type SensorFlowApi = PairingApi & {
  /** Moves or renames a sensor already connected to Élise. */
  assign(
    id: string,
    body: {
      roomId: string;
      name: string;
      placementNote: string | null;
      target: { type: 'ROOM'; id: string } | null;
      buttonRole: 'ASSISTANCE';
      contactRole?: 'BED';
      bedOccupiedWhen?: 'CLOSED' | 'OPEN';
    },
  ): Promise<unknown>;
};

/** Add-a-sensor sheet of the Home tab: the web dashboard's guided flow, on a phone. */
export function AddSensorSheet(props: {
  plan: HomePlan;
  devices: SensorDevice[];
  api: SensorFlowApi;
  initialRoomId?: string | undefined;
  initialCategory?: RoomSensorCategory | undefined;
  onClose: () => void;
  onInstalled: () => Promise<void> | void;
}) {
  return (
    <SetupSheet onClose={props.onClose}>
      <HomeSensorFlow {...props} />
    </SetupSheet>
  );
}

function HomeSensorFlow({
  plan,
  devices,
  api,
  initialRoomId,
  initialCategory,
  onClose,
  onInstalled,
}: Parameters<typeof AddSensorSheet>[0]) {
  const firstStep: Step = initialRoomId ? (initialCategory ? 'CATALOG' : 'CATEGORY') : 'ROOM';
  const { step, direction, go, back, reset } = useSetupStep<Step>(firstStep);
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [category, setCategory] = useState<RoomSensorCategory | undefined>(initialCategory);
  const [tab, setTab] = useState<'PRODUCTS' | 'CONNECTED'>('PRODUCTS');
  const [product, setProduct] = useState<SensorProduct | undefined>(undefined);
  const [assigning, setAssigning] = useState<SensorDevice | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [bedOccupiedWhen, setBedOccupiedWhen] = useState<'CLOSED' | 'OPEN'>('CLOSED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pairingRun, setPairingRun] = useState(0);
  useSheetControls({ busy, onClose });

  const rooms = useMemo(
    () =>
      plan.levels.flatMap((level) =>
        level.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          kind: room.kind,
          floor: level.floor,
        })),
      ),
    [plan],
  );
  const selectedRoom = rooms.find((room) => room.id === roomId);
  const place = selectedRoom?.name ?? '';
  const outdoor = !!selectedRoom && ['GARDEN', 'TERRACE'].includes(selectedRoom.kind);
  const products = category ? productsForCategory(category, outdoor) : [];
  const compatible = category
    ? devices.filter((device) => deviceSupportsCategory(device, category))
    : [];
  const devicesInRoom = (id: string) => devices.filter((device) => device.room?.id === id).length;
  const progress = (value: number) => ({ value, total: TOTAL });
  const placeChip = place ? <PlaceChip>{place}</PlaceChip> : undefined;

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
    } else {
      setCategory(undefined);
      go('CATEGORY');
    }
  };

  const assign = async () => {
    if (!assigning || !name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.assign(assigning.id, {
        roomId,
        name: name.trim(),
        placementNote: note.trim() || null,
        target: category === 'bed' ? { type: 'ROOM', id: roomId } : null,
        buttonRole: 'ASSISTANCE',
        ...(category === 'bed' ? { contactRole: 'BED' as const, bedOccupiedWhen } : {}),
      });
      go('DONE');
      void Promise.resolve(onInstalled()).catch(() => undefined);
    } catch (err) {
      setError(pairingErrorText(classifyPairingError(err)));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'PAIR' && roomId)
    return (
      <SensorPairingFlow
        key={pairingRun}
        api={api}
        rooms={rooms}
        initialRoomId={roomId}
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
        photo={<DevicePicture device={assigning} size={84} />}
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
        centered
        hero={
          <View style={styles.photoBubble}>
            <DevicePicture device={assigning} size={84} />
          </View>
        }
        footer={
          <PrimaryButton
            label={
              assigning.room?.id === roomId
                ? t('sensorSetup.save')
                : t('sensorSetup.assignTo', { name: selectedRoom?.name })
            }
            busy={busy}
            disabled={!name.trim()}
            icon={<Check size={20} color="#fff" strokeWidth={3} />}
            onPress={() => void assign()}
          />
        }
      >
        {moving ? (
          <SetupNotice tone="warning">
            {t('sensorSetup.thisDeviceAndAllIts', {
              name: assigning.room?.name,
              name2: selectedRoom?.name,
            })}
          </SetupNotice>
        ) : null}
        <View style={styles.form}>
          <SetupField
            label={t('sensorSetup.name')}
            value={name}
            onChange={setName}
            maxLength={120}
          />
          <SetupField
            label={t('sensorSetup.locationOptional')}
            value={note}
            onChange={setNote}
            maxLength={500}
            placeholder={t('sensorSetup.forExampleByTheBed')}
          />
          {category === 'bed' ? (
            <SetupNotice>
              {isBedOccupancySensorModel(assigning.model)
                ? t('sensorSetup.theTuyaStripConnectsDirectly')
                : t('sensorSetup.connectADryContactPressure')}
            </SetupNotice>
          ) : null}
          {category === 'bed' && !isBedOccupancySensorModel(assigning.model) ? (
            <BedContactChoice value={bedOccupiedWhen} onChange={setBedOccupiedWhen} />
          ) : null}
        </View>
        {error ? <SetupNotice tone="danger">{error}</SetupNotice> : null}
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
          <ProductHero>
            <ProductPhoto product={product} size={170} />
          </ProductHero>
        }
        footer={
          <PrimaryButton
            label={t('sensorSetup.installThisSensor')}
            icon={<ChevronRight size={20} color="#fff" />}
            onPress={() => go('PAIR')}
          />
        }
      >
        <View style={styles.tags}>
          <Tag accent icon={<Radio size={14} color={ss.accent} />}>
            {product.protocol === 'zigbee' ? 'Zigbee' : product.protocol}
          </Tag>
          {product.compatibility === 'DOCUMENTED' ? (
            <Tag icon={<Check size={14} color={ss.ink2} strokeWidth={2.6} />}>
              {t('sensorSetup.documentedCompatibility')}
            </Tag>
          ) : null}
          {product.categories.map((id) => (
            <Tag key={id}>{sensorCategoryLabel(id)}</Tag>
          ))}
        </View>
        <SetupSection title={t('sensorSetup.documentedFeatures')}>
          <SetupList>
            {texts.features.map((feature, index) => (
              <SetupRow
                key={feature}
                first={index === 0}
                icon={<Check size={19} color={ss.accent} strokeWidth={2.6} />}
                title={feature}
              />
            ))}
          </SetupList>
        </SetupSection>
        <SetupSection title={t('sensorSetup.practical')}>
          <SetupList>
            <SetupRow
              first
              icon={<Plug size={19} color={ss.accent} />}
              title={t('sensorSetup.power')}
              detail={texts.power}
            />
            {product.manualUrl ? (
              <SetupRow
                href={product.manualUrl}
                icon={<BookOpen size={19} color={ss.accent} />}
                title={t('sensorSetup.manual')}
                detail={t('sensorSetup.manualDetail')}
              />
            ) : null}
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
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>
              {(category ? sensorCategoryLabel(category) : t('sensorSetup.sensor')).toUpperCase()}
            </Text>
            {placeChip}
          </View>
        }
        title={t('sensorSetup.chooseYourDevice')}
        subtitle={t('sensorSetup.chooseYourDeviceText')}
      >
        {compatible.length > 0 ? (
          <SetupSegmented
            label={t('sensorSetup.devices')}
            value={tab}
            onChange={setTab}
            options={[
              {
                value: 'PRODUCTS',
                label: t('sensorSetup.documentedProducts'),
                count: products.length,
              },
              {
                value: 'CONNECTED',
                label: t('sensorSetup.alreadyConnected'),
                count: compatible.length,
              },
            ]}
          />
        ) : null}
        {showConnected ? (
          <SetupList>
            {compatible.map((device, index) => (
              <SetupRow
                key={device.id}
                first={index === 0}
                icon={<DevicePicture device={device} size={34} />}
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
                    <Check size={20} color={ss.success} strokeWidth={2.6} />
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
          <View>
            {products.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.brand}. ${productTexts(item).name}`}
                onPress={() => {
                  setProduct(item);
                  go('PRODUCT');
                }}
                style={({ pressed }) => [styles.product, pressed && styles.productPressed]}
              >
                <View style={styles.productPhoto}>
                  <ProductPhoto product={item} size={70} />
                </View>
                <View style={styles.productText}>
                  <Text style={styles.productBrand}>{item.brand}</Text>
                  <Text style={styles.productName}>{productTexts(item).name}</Text>
                  <Text style={styles.productKinds} numberOfLines={2}>
                    {item.categories.length
                      ? item.categories.map((id) => sensorCategoryLabel(id)).join(' · ')
                      : t('sensorProductCard.powerEnergy')}
                  </Text>
                </View>
                <ChevronRight size={18} color={ss.ink3} />
              </Pressable>
            ))}
          </View>
        ) : (
          <SetupNotice>{t('sensorSetup.noDocumentedProduct')}</SetupNotice>
        )}
        <SetupList>
          <SetupRow
            first
            tone="accent"
            icon={<ScanSearch size={19} color={ss.accent} />}
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
    const available = (id: RoomSensorCategory) => roomSupportsCategory(selectedRoom.kind, id);
    const groups = SENSOR_CATEGORY_GROUPS.map((group) => ({
      ...group,
      categories: group.categories.filter(available),
    })).filter((group) => group.categories.length > 0);
    // Kinds Élise knows but that no group lists still appear, at the end.
    const grouped = new Set(SENSOR_CATEGORY_GROUPS.flatMap((group) => group.categories));
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
              <View>
                {group.categories.map((id) => {
                  const Icon = categoryIcons[id];
                  const installed = devices
                    .filter((device) => deviceSupportsCategory(device, id))
                    .some((device) => device.room?.id === roomId);
                  return (
                    <SetupTile
                      key={id}
                      icon={<Icon size={22} color={ss.ink} />}
                      tint={ss.groups[group.id]}
                      title={sensorCategoryLabel(id)}
                      detail={sensorCategoryDescription(id)}
                      badge={installed ? t('sensorSetup.installed') : undefined}
                      onSelect={() => {
                        setCategory(id);
                        setTab('PRODUCTS');
                        go('CATALOG');
                      }}
                    />
                  );
                })}
              </View>
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
            <View>
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
                    icon={<RoomIcon size={22} color={ss.ink} />}
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
            </View>
          </SetupSection>
        ))}
      {!rooms.length ? (
        <SetupNotice title={t('sensorSetup.noRoomsTitle')}>
          {t('sensorSetup.noRoomsAreDefinedClose')}
        </SetupNotice>
      ) : null}
    </SetupPage>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14, alignSelf: 'stretch' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  eyebrowRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  eyebrow: { color: ss.accent, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  photoBubble: {
    width: 116,
    height: 116,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f6',
  },
  product: {
    minHeight: 92,
    marginBottom: 10,
    padding: 10,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ss.line,
    backgroundColor: ss.bg,
  },
  productPressed: { backgroundColor: ss.fill },
  productPhoto: {
    width: 84,
    height: 84,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.fill,
  },
  productText: { flex: 1, gap: 2 },
  productBrand: { color: ss.accent, fontSize: 12, fontWeight: '700' },
  productName: { color: ss.ink, fontSize: 16, fontWeight: '700' },
  productKinds: { color: ss.ink2, fontSize: 13, lineHeight: 18 },
});
