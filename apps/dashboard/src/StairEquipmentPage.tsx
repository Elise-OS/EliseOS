import type { HomePlan, RoomSensorCategory, SensorDevice, SensorProduct } from '@elise/contracts';
import { deviceSupportsCategory, ROOM_SENSOR_CATEGORIES } from '@elise/contracts';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BatteryMedium,
  Check,
  ChartNoAxesCombined as Stairs,
  CheckCircle2,
  ChevronRight,
  Plus,
  Radio,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { EquipmentDialog } from './EquipmentDialog';
import { HomeSensorOnboardingDialog } from './HomeSensorOnboardingDialog';
import { type Locale, t } from './i18n';
import { DevicePhoto, lastReadingLabel, roomSensorReading } from './RoomEquipmentPage';
import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import { SensorInstallationGuide } from './SensorInstallationGuide';
import { SensorOnboardingDialog } from './SensorOnboardingDialog';
import { productsForCategory } from './sensor-products';
import {
  connectedDevicesForCategory,
  sensorJson,
  sensorRequest,
  type SensorUiDevice,
} from './sensor-ui';
import { productTexts, sensorCategoryDescription, sensorCategoryLabel } from './i18n/data';

type StairSensorCategory = 'motion' | 'presence';

const STAIR_SENSOR_CATEGORIES: StairSensorCategory[] = ['motion', 'presence'];

const categoryIcons: Record<StairSensorCategory, typeof Activity> = {
  motion: Activity,
  presence: UserRound,
};

export function stairCategoryDevices(
  plan: HomePlan,
  stairId: string,
  devices: SensorDevice[],
  category: RoomSensorCategory,
) {
  const equipmentIds = new Set(
    plan.placements
      .filter(
        ({ kind, targetType, targetId }) =>
          kind === 'SENSOR' && targetType === 'STAIR' && targetId === stairId,
      )
      .map(({ equipmentId }) => equipmentId),
  );
  return devices.filter(
    (device) =>
      deviceSupportsCategory(device, category) &&
      (equipmentIds.has(device.id) ||
        device.capabilities.some(({ sensorId }) => equipmentIds.has(sensorId))),
  );
}

export function otherStairConnectedDevices(
  devices: SensorUiDevice[],
  category: RoomSensorCategory,
  assignedDevices: SensorUiDevice[],
) {
  const assignedIds = new Set(assignedDevices.map(({ id }) => id));
  return connectedDevicesForCategory(devices, category).filter(({ id }) => !assignedIds.has(id));
}

export function StairEquipmentPage({
  stairId,
  plan,
  devices,
  locale,
  onBack,
  onRefresh,
}: {
  stairId: string;
  plan: HomePlan;
  devices: SensorDevice[];
  locale: Locale;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}) {
  const fr = locale === 'fr';
  const stair = plan.levels.flatMap(({ stairs }) => stairs).find(({ id }) => id === stairId);
  const [category, setCategory] = useState<RoomSensorCategory | undefined>();
  const [flowOpen, setFlowOpen] = useState(false);
  const [tab, setTab] = useState<'PRODUCTS' | 'CONNECTED'>('PRODUCTS');
  const [product, setProduct] = useState<SensorProduct | null>(null);
  const [assigning, setAssigning] = useState<SensorUiDevice | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installationCategory, setInstallationCategory] = useState<RoomSensorCategory>();
  const [installationProduct, setInstallationProduct] = useState<SensorProduct | undefined>();
  const [guideId, setGuideId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = useRef(Date.now()).current;
  const context = useMemo(() => {
    if (!stair) return null;
    const fromLevel = plan.levels.find(({ id }) => id === stair.fromFloorId);
    const toLevel = plan.levels.find(({ id }) => id === stair.toFloorId);
    const fromRoom = fromLevel?.rooms.find(({ id }) => id === stair.fromRoomId);
    const toRoom = toLevel?.rooms.find(({ id }) => id === stair.toRoomId);
    return { fromLevel, toLevel, fromRoom, toRoom };
  }, [plan, stair]);

  if (!stair || !context) {
    return (
      <section className="room-equipment-page">
        <p>{t('stairEquipmentPage.theseStairsNoLongerExist')}</p>
        <button className="equipment-secondary" onClick={onBack}>
          {t('stairEquipmentPage.backToHome')}
        </button>
      </section>
    );
  }

  const stairName = `${t('stairEquipmentPage.stairs')} · ${context.fromRoom?.name ?? '—'} ↔ ${context.toRoom?.name ?? '—'}`;
  const devicesByCategory = (id: RoomSensorCategory) =>
    stairCategoryDevices(plan, stair.id, devices, id);
  const deviceCount = new Set(
    STAIR_SENSOR_CATEGORIES.flatMap((id) => devicesByCategory(id).map(({ id: key }) => key)),
  ).size;
  const openCategory = (id?: RoomSensorCategory) => {
    if (!id) {
      setCategory(undefined);
      setFlowOpen(true);
      return;
    }
    setCategory(id);
    setTab('PRODUCTS');
    setProduct(null);
    setAssigning(null);
    setConfirmRemoval(false);
    setError('');
  };
  const selected = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category);
  const selectedDevices = category ? devicesByCategory(category) : [];
  const availableConnected = category
    ? otherStairConnectedDevices(devices, category, selectedDevices)
    : [];
  const products = category ? productsForCategory(category, false) : [];
  const shownGuide = devices.find(({ id }) => id === guideId);
  const rooms = plan.levels.flatMap((level) =>
    level.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      floor: level.floor,
    })),
  );
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const editDevice = (device: SensorUiDevice) => {
    setAssigning(device);
    setConfirmRemoval(false);
    setName(device.name);
    const placement = plan.placements.find(
      (item) =>
        item.kind === 'SENSOR' &&
        item.targetType === 'STAIR' &&
        item.targetId === stair.id &&
        (item.equipmentId === device.id ||
          device.capabilities.some(({ sensorId }) => sensorId === item.equipmentId)),
    );
    setNote(device.placementNote ?? placement?.placementNote ?? '');
  };
  const associate = () =>
    run(async () => {
      if (!assigning) return;
      await sensorRequest(
        `/api/v1/sensor-devices/${encodeURIComponent(assigning.id)}`,
        sensorJson('PATCH', {
          roomId: stair.fromRoomId,
          name: name.trim(),
          placementNote: note.trim() || null,
          target: { type: 'STAIR', id: stair.id },
          buttonRole: 'ASSISTANCE',
        }),
      );
      const id = assigning.id;
      setAssigning(null);
      setCategory(undefined);
      setGuideId(id);
      await onRefresh();
    });
  const startInstall = (chosen?: SensorProduct) =>
    run(async () => {
      await onRefresh();
      setInstallationCategory(category);
      setInstallationProduct(chosen);
      setProduct(null);
      setCategory(undefined);
      setInstalling(true);
    });
  const removeDevice = () =>
    run(async () => {
      if (!assigning || assigning.protocol !== 'zigbee') return;
      await sensorRequest(`/api/v1/sensor-devices/${encodeURIComponent(assigning.id)}`, {
        method: 'DELETE',
      });
      setConfirmRemoval(false);
      setAssigning(null);
      setCategory(undefined);
      await onRefresh();
    });

  return (
    <section className="room-equipment-page stair-equipment-page">
      <nav className="room-equipment-breadcrumb" aria-label={t('stairEquipmentPage.navigation')}>
        <button className="room-equipment-back" onClick={onBack}>
          <span className="room-equipment-back-icon" aria-hidden="true">
            <ArrowLeft />
          </span>
          <span className="room-equipment-back-copy">
            <span>{t('stairEquipmentPage.backTo')}</span>
            <strong>{t('stairEquipmentPage.myHome')}</strong>
          </span>
        </button>
        <ChevronRight className="room-equipment-breadcrumb-divider" aria-hidden="true" />
        <span className="room-equipment-current-room" aria-current="page">
          {t('stairEquipmentPage.stairs2')}
        </span>
      </nav>

      <header className="room-equipment-header">
        <div className="room-equipment-title">
          <span className="equipment-kicker">{t('stairEquipmentPage.yourStairs')}</span>
          <h1>{stairName}</h1>
          <div className="room-equipment-metadata">
            <span>
              <Stairs />
              {context.fromLevel?.name ?? '—'} → {context.toLevel?.name ?? '—'}
            </span>
            <span className="room-equipment-status">
              <Radio />
              {t('stairEquipmentPage.sensorsAssigned', { count: deviceCount })}
            </span>
          </div>
        </div>
        <div className="room-equipment-actions">
          <button className="primary" onClick={() => openCategory()}>
            <Plus /> {t('stairEquipmentPage.addASensor')}
          </button>
        </div>
      </header>

      <div className="room-equipment-section-heading">
        <div>
          <h2>{t('stairEquipmentPage.stairSensors')}</h2>
          <p>{t('stairEquipmentPage.monitorMovementBetweenTheseTwo')}</p>
        </div>
      </div>

      <div className="room-equipment-grid">
        {STAIR_SENSOR_CATEGORIES.map((id) => {
          const definition = ROOM_SENSOR_CATEGORIES.find((item) => item.id === id)!;
          const items = devicesByCategory(id);
          const reading = items.length === 1 ? roomSensorReading(items[0]!, id, fr, now) : null;
          const Icon = categoryIcons[id];
          return (
            <article
              key={id}
              className={`room-sensor-card category-${id} ${items.length ? 'is-configured' : ''}`}
            >
              <button className="room-sensor-card-main" onClick={() => openCategory(id)}>
                <span className="room-sensor-card-top">
                  <span className="room-sensor-icon">
                    <Icon />
                  </span>
                  <span className={`room-sensor-status ${items.length ? 'is-configured' : ''}`}>
                    {items.length ? <CheckCircle2 /> : <span className="room-sensor-status-dot" />}
                    {items.length
                      ? t('stairEquipmentPage.configured')
                      : t('stairEquipmentPage.notConfigured')}
                  </span>
                </span>
                <h3>{sensorCategoryLabel(definition.id)}</h3>
                <p>{sensorCategoryDescription(definition.id)}</p>
                <div className="room-sensor-card-value">
                  {reading ? (
                    <>
                      <strong className={reading.outdated ? 'is-outdated' : ''}>
                        {reading.reading}
                      </strong>
                      {reading.status && <small>{reading.status}</small>}
                      <small>{lastReadingLabel(reading.lastSeenAt, fr, now, id)}</small>
                    </>
                  ) : items.length > 1 ? (
                    <strong>
                      {items.length} <span>{t('stairEquipmentPage.sensors')}</span>
                    </strong>
                  ) : (
                    <>
                      <span className="room-sensor-empty-line">—</span>
                      <small>{t('stairEquipmentPage.noSensorAssigned')}</small>
                    </>
                  )}
                </div>
                <span className="room-sensor-card-footer">
                  <span>
                    {items.length
                      ? t('stairEquipmentPage.devicesManage', { count: items.length })
                      : t('stairEquipmentPage.addASensor')}
                  </span>
                  {items.length ? <ArrowRight /> : <Plus />}
                </span>
              </button>
            </article>
          );
        })}
      </div>

      <p className="room-equipment-footnote">
        <CheckCircle2 />
        {t('stairEquipmentPage.theseSensorsAreAssignedDirectly')}
      </p>

      {selected && category && (
        <EquipmentDialog
          title={`${sensorCategoryLabel(selected.id)} · ${stairName}`}
          wide
          busy={busy}
          onClose={() => {
            setCategory(undefined);
            setAssigning(null);
            setConfirmRemoval(false);
            setError('');
          }}
        >
          <div className="equipment-category-content">
            {assigning ? (
              <>
                <button
                  className="equipment-text-button"
                  onClick={() => {
                    setAssigning(null);
                    setConfirmRemoval(false);
                  }}
                >
                  <ArrowLeft /> {t('stairEquipmentPage.backToSensors')}
                </button>
                <h3>{assigning.name}</h3>
                {!selectedDevices.some(({ id }) => id === assigning.id) && assigning.room && (
                  <p className="equipment-note">
                    {t('stairEquipmentPage.thisDeviceAndAllIts', {
                      name: assigning.room.name,
                      stairName,
                    })}
                  </p>
                )}
                <label className="equipment-field">
                  {t('stairEquipmentPage.name')}
                  <input
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="equipment-field">
                  {t('stairEquipmentPage.locationOptional')}
                  <input
                    value={note}
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t('stairEquipmentPage.forExampleMidwayUp')}
                  />
                </label>
                <footer className="equipment-dialog-footer">
                  <button
                    className="equipment-primary"
                    disabled={busy || !name.trim()}
                    onClick={() => void associate()}
                  >
                    <Check />
                    {selectedDevices.some(({ id }) => id === assigning.id)
                      ? t('stairEquipmentPage.save')
                      : t('stairEquipmentPage.assignToTheseStairs')}
                  </button>
                </footer>
                {assigning.protocol === 'zigbee' && (
                  <div className="equipment-removal">
                    {confirmRemoval ? (
                      <div className="equipment-removal-confirmation" role="group">
                        <strong>{t('stairEquipmentPage.removeThisSensorFromThe')}</strong>
                        <p>{t('stairEquipmentPage.itWillBeRemovedFrom')}</p>
                        <div>
                          <button
                            className="equipment-secondary"
                            disabled={busy}
                            onClick={() => setConfirmRemoval(false)}
                          >
                            {t('stairEquipmentPage.cancel')}
                          </button>
                          <button
                            className="equipment-delete-confirm"
                            disabled={busy}
                            onClick={() => void removeDevice()}
                          >
                            <Trash2 /> {t('stairEquipmentPage.removeFromNetwork')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="equipment-delete-trigger"
                        disabled={busy}
                        onClick={() => setConfirmRemoval(true)}
                      >
                        <Trash2 /> {t('stairEquipmentPage.removeFromNetwork')}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : product ? (
              <>
                <button className="equipment-text-button" onClick={() => setProduct(null)}>
                  <ArrowLeft /> {t('stairEquipmentPage.allProducts')}
                </button>
                <div className="equipment-product-detail">
                  <ProductPhoto product={product} />
                  <div>
                    <span className="equipment-kicker">{product.brand}</span>
                    <h3>{productTexts(product).name}</h3>
                    <p>{product.model}</p>
                    <span className="equipment-product-badge">
                      {t('stairEquipmentPage.documentedCompatibility')}
                    </span>
                  </div>
                </div>
                <h4>{t('stairEquipmentPage.whereToPlaceIt')}</h4>
                <ul>
                  {productTexts(product).placement.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
                <footer className="equipment-dialog-footer">
                  <button className="equipment-primary" onClick={() => void startInstall(product)}>
                    {t('stairEquipmentPage.installThisSensor')} <ChevronRight />
                  </button>
                </footer>
              </>
            ) : (
              <>
                {!!selectedDevices.length && (
                  <section className="equipment-assigned">
                    <h3>{t('stairEquipmentPage.onTheseStairs')}</h3>
                    {selectedDevices.map((device) => {
                      const reading = roomSensorReading(device, category, fr, now);
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
                            {reading.status && (
                              <small className="equipment-device-attention">{reading.status}</small>
                            )}
                            {reading.lastSeenAt && (
                              <small>
                                {lastReadingLabel(reading.lastSeenAt, fr, now, category)}
                              </small>
                            )}
                            {device.batteryPercent !== null && (
                              <small>
                                <BatteryMedium /> {t('stairEquipmentPage.battery')}{' '}
                                {device.batteryPercent} %
                              </small>
                            )}
                          </div>
                          <div className="equipment-device-actions">
                            <button onClick={() => editDevice(device)}>
                              {t('stairEquipmentPage.manage')}
                            </button>
                            <button
                              onClick={() => {
                                setGuideId(device.id);
                                setCategory(undefined);
                              }}
                            >
                              {t('stairEquipmentPage.guideAndTest')}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                )}
                <h3>{t('stairEquipmentPage.addASensor')}</h3>
                <div className="equipment-catalog-tabs" role="tablist">
                  <button
                    role="tab"
                    aria-selected={tab === 'PRODUCTS'}
                    onClick={() => setTab('PRODUCTS')}
                  >
                    {t('stairEquipmentPage.documentedProducts')}
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === 'CONNECTED'}
                    onClick={() => setTab('CONNECTED')}
                  >
                    {t('stairEquipmentPage.otherConnectedSensors')}
                  </button>
                </div>
                {tab === 'PRODUCTS' ? (
                  <div className="equipment-product-grid">
                    {products.map((item) => (
                      <SensorProductCard
                        key={item.id}
                        product={item}
                        onSelect={() => setProduct(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <div>
                    {availableConnected.map((device) => (
                      <button
                        className="equipment-connected-choice"
                        key={device.id}
                        onClick={() => editDevice(device)}
                      >
                        <Radio />
                        <span>
                          <strong>{device.name}</strong>
                          <small>{device.room?.name ?? t('stairEquipmentPage.unassigned')}</small>
                        </span>
                        <Plus />
                      </button>
                    ))}
                    {!availableConnected.length && (
                      <div className="equipment-connected-empty" role="status">
                        <Radio />
                        <strong>{t('stairEquipmentPage.noOtherSensorToAdd')}</strong>
                        <p>{t('stairEquipmentPage.sensorsOnTheseStairsAre')}</p>
                      </div>
                    )}
                  </div>
                )}
                <button
                  className="equipment-unlisted"
                  disabled={busy}
                  onClick={() => void startInstall()}
                >
                  <Radio />
                  <span>
                    {t('stairEquipmentPage.myModelIsNotListed')}
                    <small>{t('stairEquipmentPage.startAutomaticDetection')}</small>
                  </span>
                  <ArrowRight />
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
      )}

      {guideId && (
        <EquipmentDialog
          title={shownGuide?.name ?? t('stairEquipmentPage.sensorGuide')}
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
            <p>{t('stairEquipmentPage.sensorNoLongerAvailable')}</p>
          )}
        </EquipmentDialog>
      )}

      <SensorOnboardingDialog
        open={installing}
        locale={locale}
        rooms={rooms}
        initialRoomId={stair.fromRoomId}
        initialTarget={{ type: 'STAIR', id: stair.id }}
        category={installationCategory}
        product={installationProduct}
        onClose={() => setInstalling(false)}
        onInstalled={onRefresh}
      />

      <HomeSensorOnboardingDialog
        open={flowOpen}
        locale={locale}
        plan={plan}
        devices={devices}
        initialRoomId={stair.fromRoomId}
        initialCategory={category}
        initialTarget={{ type: 'STAIR', id: stair.id }}
        initialTargetLabel={stairName}
        allowedCategories={STAIR_SENSOR_CATEGORIES}
        onClose={() => setFlowOpen(false)}
        onInstalled={onRefresh}
      />
    </section>
  );
}
