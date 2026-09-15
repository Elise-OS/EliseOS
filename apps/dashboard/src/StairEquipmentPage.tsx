import type { HomePlan, RoomSensorCategory, SensorDevice, SensorProduct } from '@michel/contracts';
import { deviceSupportsCategory, ROOM_SENSOR_CATEGORIES } from '@michel/contracts';
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
import type { Locale } from './i18n';
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
        <p>{fr ? 'Cet escalier n’existe plus.' : 'These stairs no longer exist.'}</p>
        <button className="equipment-secondary" onClick={onBack}>
          {fr ? 'Retour au logement' : 'Back to home'}
        </button>
      </section>
    );
  }

  const stairName = `${fr ? 'Escalier' : 'Stairs'} · ${context.fromRoom?.name ?? '—'} ↔ ${context.toRoom?.name ?? '—'}`;
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
      <nav className="room-equipment-breadcrumb" aria-label={fr ? 'Navigation' : 'Navigation'}>
        <button className="room-equipment-back" onClick={onBack}>
          <span className="room-equipment-back-icon" aria-hidden="true">
            <ArrowLeft />
          </span>
          <span className="room-equipment-back-copy">
            <span>{fr ? 'Retour à' : 'Back to'}</span>
            <strong>{fr ? 'Mon logement' : 'My home'}</strong>
          </span>
        </button>
        <ChevronRight className="room-equipment-breadcrumb-divider" aria-hidden="true" />
        <span className="room-equipment-current-room" aria-current="page">
          {fr ? 'Escaliers' : 'Stairs'}
        </span>
      </nav>

      <header className="room-equipment-header">
        <div className="room-equipment-title">
          <span className="equipment-kicker">{fr ? 'Votre escalier' : 'Your stairs'}</span>
          <h1>{stairName}</h1>
          <div className="room-equipment-metadata">
            <span>
              <Stairs />
              {context.fromLevel?.name ?? '—'} → {context.toLevel?.name ?? '—'}
            </span>
            <span className="room-equipment-status">
              <Radio />
              {deviceCount}{' '}
              {fr
                ? `capteur${deviceCount > 1 ? 's' : ''} associé${deviceCount > 1 ? 's' : ''}`
                : `sensor${deviceCount === 1 ? '' : 's'} assigned`}
            </span>
          </div>
        </div>
        <div className="room-equipment-actions">
          <button className="primary" onClick={() => openCategory()}>
            <Plus /> {fr ? 'Ajouter un capteur' : 'Add a sensor'}
          </button>
        </div>
      </header>

      <div className="room-equipment-section-heading">
        <div>
          <h2>{fr ? 'Les capteurs de l’escalier' : 'Stair sensors'}</h2>
          <p>
            {fr
              ? 'Suivez les passages entre ces deux espaces.'
              : 'Monitor movement between these two spaces.'}
          </p>
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
                      ? fr
                        ? 'Configuré'
                        : 'Configured'
                      : fr
                        ? 'Non configuré'
                        : 'Not configured'}
                  </span>
                </span>
                <h3>{definition[fr ? 'label' : 'labelEn']}</h3>
                <p>{definition[fr ? 'description' : 'descriptionEn']}</p>
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
                      {items.length} <span>{fr ? 'capteurs' : 'sensors'}</span>
                    </strong>
                  ) : (
                    <>
                      <span className="room-sensor-empty-line">—</span>
                      <small>{fr ? 'Aucun capteur associé' : 'No sensor assigned'}</small>
                    </>
                  )}
                </div>
                <span className="room-sensor-card-footer">
                  <span>
                    {items.length
                      ? fr
                        ? `${items.length} appareil${items.length > 1 ? 's' : ''} · Gérer`
                        : `${items.length} device${items.length === 1 ? '' : 's'} · Manage`
                      : fr
                        ? 'Ajouter un capteur'
                        : 'Add a sensor'}
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
        {fr
          ? 'Ces capteurs sont associés directement à cet escalier.'
          : 'These sensors are assigned directly to these stairs.'}
      </p>

      {selected && category && (
        <EquipmentDialog
          title={`${selected[fr ? 'label' : 'labelEn']} · ${stairName}`}
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
                  <ArrowLeft /> {fr ? 'Retour aux capteurs' : 'Back to sensors'}
                </button>
                <h3>{assigning.name}</h3>
                {!selectedDevices.some(({ id }) => id === assigning.id) && assigning.room && (
                  <p className="equipment-note">
                    {fr
                      ? `Cet appareil sera déplacé de « ${assigning.room.name} » vers « ${stairName} », avec toutes ses mesures.`
                      : `This device and all its readings will move from ${assigning.room.name} to ${stairName}.`}
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
                    placeholder={
                      fr ? 'Par exemple : milieu de l’escalier' : 'For example: midway up'
                    }
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
                      ? fr
                        ? 'Enregistrer'
                        : 'Save'
                      : fr
                        ? 'Associer à cet escalier'
                        : 'Assign to these stairs'}
                  </button>
                </footer>
                {assigning.protocol === 'zigbee' && (
                  <div className="equipment-removal">
                    {confirmRemoval ? (
                      <div className="equipment-removal-confirmation" role="group">
                        <strong>
                          {fr
                            ? 'Retirer ce capteur du réseau ?'
                            : 'Remove this sensor from the network?'}
                        </strong>
                        <p>
                          {fr
                            ? 'Il sera supprimé de cet escalier et du réseau Zigbee.'
                            : 'It will be removed from these stairs and the Zigbee network.'}
                        </p>
                        <div>
                          <button
                            className="equipment-secondary"
                            disabled={busy}
                            onClick={() => setConfirmRemoval(false)}
                          >
                            {fr ? 'Annuler' : 'Cancel'}
                          </button>
                          <button
                            className="equipment-delete-confirm"
                            disabled={busy}
                            onClick={() => void removeDevice()}
                          >
                            <Trash2 /> {fr ? 'Supprimer du réseau' : 'Remove from network'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="equipment-delete-trigger"
                        disabled={busy}
                        onClick={() => setConfirmRemoval(true)}
                      >
                        <Trash2 /> {fr ? 'Supprimer du réseau' : 'Remove from network'}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : product ? (
              <>
                <button className="equipment-text-button" onClick={() => setProduct(null)}>
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
                <h4>{fr ? 'Où le placer' : 'Where to place it'}</h4>
                <ul>
                  {(fr ? product.placement : product.placementEn).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
                <footer className="equipment-dialog-footer">
                  <button className="equipment-primary" onClick={() => void startInstall(product)}>
                    {fr ? 'Installer ce capteur' : 'Install this sensor'} <ChevronRight />
                  </button>
                </footer>
              </>
            ) : (
              <>
                {!!selectedDevices.length && (
                  <section className="equipment-assigned">
                    <h3>{fr ? 'Dans cet escalier' : 'On these stairs'}</h3>
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
                                <BatteryMedium /> {fr ? 'Batterie' : 'Battery'}{' '}
                                {device.batteryPercent} %
                              </small>
                            )}
                          </div>
                          <div className="equipment-device-actions">
                            <button onClick={() => editDevice(device)}>
                              {fr ? 'Gérer' : 'Manage'}
                            </button>
                            <button
                              onClick={() => {
                                setGuideId(device.id);
                                setCategory(undefined);
                              }}
                            >
                              {fr ? 'Guide et test' : 'Guide and test'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                )}
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
                    {fr ? 'Autres capteurs connectés' : 'Other connected sensors'}
                  </button>
                </div>
                {tab === 'PRODUCTS' ? (
                  <div className="equipment-product-grid">
                    {products.map((item) => (
                      <SensorProductCard
                        key={item.id}
                        product={item}
                        fr={fr}
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
                          <small>{device.room?.name ?? (fr ? 'Sans pièce' : 'Unassigned')}</small>
                        </span>
                        <Plus />
                      </button>
                    ))}
                    {!availableConnected.length && (
                      <div className="equipment-connected-empty" role="status">
                        <Radio />
                        <strong>
                          {fr ? 'Aucun autre capteur à ajouter' : 'No other sensor to add'}
                        </strong>
                        <p>
                          {fr
                            ? 'Les capteurs de cet escalier sont déjà affichés plus haut.'
                            : 'Sensors on these stairs are already shown above.'}
                        </p>
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
                    {fr ? 'Mon modèle n’est pas dans la liste' : 'My model is not listed'}
                    <small>
                      {fr ? 'Lancer la détection automatique' : 'Start automatic detection'}
                    </small>
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
          title={shownGuide?.name ?? (fr ? 'Guide du capteur' : 'Sensor guide')}
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
            <p>{fr ? 'Le capteur n’est plus disponible.' : 'Sensor no longer available.'}</p>
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
