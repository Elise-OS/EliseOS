import type { HomePlan, RoomSensorCategory, SensorDevice } from '@michel/contracts';
import { deviceSupportsCategory, ROOM_SENSOR_CATEGORIES } from '@michel/contracts';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChartNoAxesCombined as Stairs,
  CheckCircle2,
  ChevronRight,
  Plus,
  Radio,
  UserRound,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { HomeSensorOnboardingDialog } from './HomeSensorOnboardingDialog';
import type { Locale } from './i18n';
import { lastReadingLabel, roomSensorReading } from './RoomEquipmentPage';

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
    setCategory(id);
    setFlowOpen(true);
  };

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
