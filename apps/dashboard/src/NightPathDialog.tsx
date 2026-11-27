import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BedDouble,
  Check,
  Clock3,
  Footprints,
  Lightbulb,
  LoaderCircle,
  MoonStar,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  formatNightPathTime,
  NIGHT_PATH_OFF_DELAYS,
  parseNightPathTime,
  type NightPath,
  type NightPathOverview,
  type NightPathRoom,
  type NightPathTestResult,
} from '@elise/contracts';
import { EquipmentDialog } from './EquipmentDialog';
import { sensorJson, sensorRequest } from './sensor-ui';
import { dateLocale, t } from './i18n';
import {
  draftFromPath,
  emptyNightPathDraft,
  NIGHT_PATH_TEMPERATURES,
  nightPathDraftProblem,
  nightPathSummary,
  type NightPathDraft,
} from './night-path-view';
import './night-path.css';

const ENDPOINT = '/api/v1/night-paths';

type Editing = { id: string | null; draft: NightPathDraft };

function RoomChoice({
  room,
  checked,
  disabled,
  detail,
  onToggle,
}: {
  room: NightPathRoom;
  checked: boolean;
  disabled: boolean;
  detail: string;
  onToggle: () => void;
}) {
  return (
    <label
      className={`night-path-room ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="night-path-room-check" aria-hidden="true">
        <Check />
      </span>
      <span className="night-path-room-copy">
        <strong>{room.name}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

export function NightPathEditor({
  draft,
  rooms,
  resident,
  busy,
  testing,
  testNotice,
  error,
  onChange,
  onCancel,
  onSave,
  onTest,
}: {
  draft: NightPathDraft;
  rooms: NightPathRoom[];
  resident: string;
  busy: boolean;
  testing: boolean;
  testNotice: string;
  error: string;
  onChange: (draft: NightPathDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const toggle = (key: 'triggerRoomIds' | 'lightRoomIds', id: string) =>
    onChange({
      ...draft,
      [key]: draft[key].includes(id)
        ? draft[key].filter((item) => item !== id)
        : [...draft[key], id],
    });
  const problem = nightPathDraftProblem(draft);
  const bedAvailable = rooms.some(
    ({ id, bedSensors }) => bedSensors > 0 && draft.triggerRoomIds.includes(id),
  );
  const who = resident || t('nightPath.theResident');
  return (
    <div className="night-path-editor">
      <button className="equipment-text-button" onClick={onCancel} disabled={busy}>
        <ArrowLeft />
        {t('nightPath.backToPaths')}
      </button>
      <label className="equipment-field">
        {t('nightPath.name')}
        <input
          value={draft.name}
          maxLength={80}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>

      <fieldset className="night-path-section">
        <legend>
          <span className="night-path-step" aria-hidden="true">
            <Footprints />
          </span>
          {t('nightPath.triggerTitle', { resident: who })}
        </legend>
        <p className="night-path-hint">{t('nightPath.triggerHint')}</p>
        <div className="night-path-rooms">
          {rooms.map((room) => {
            const usable = room.presenceSensors > 0 || room.bedSensors > 0;
            return (
              <RoomChoice
                key={room.id}
                room={room}
                checked={draft.triggerRoomIds.includes(room.id)}
                disabled={!usable && !draft.triggerRoomIds.includes(room.id)}
                detail={
                  usable
                    ? t('nightPath.roomSensors', { count: room.presenceSensors + room.bedSensors })
                    : t('nightPath.roomWithoutSensor')
                }
                onToggle={() => toggle('triggerRoomIds', room.id)}
              />
            );
          })}
        </div>
        {bedAvailable && (
          <label className="night-path-checkbox">
            <input
              type="checkbox"
              checked={draft.includeBedExit}
              onChange={(event) => onChange({ ...draft, includeBedExit: event.target.checked })}
            />
            <BedDouble aria-hidden="true" />
            {t('nightPath.includeBedExit', { resident: who })}
          </label>
        )}
      </fieldset>

      <fieldset className="night-path-section">
        <legend>
          <span className="night-path-step" aria-hidden="true">
            <MoonStar />
          </span>
          {t('nightPath.windowTitle')}
        </legend>
        <div className="night-path-times">
          <label className="equipment-field">
            {t('nightPath.from')}
            <input
              type="time"
              value={formatNightPathTime(draft.startMinute)}
              onChange={(event) => {
                const minute = parseNightPathTime(event.target.value);
                if (minute !== null) onChange({ ...draft, startMinute: minute });
              }}
            />
          </label>
          <label className="equipment-field">
            {t('nightPath.to')}
            <input
              type="time"
              value={formatNightPathTime(draft.endMinute)}
              onChange={(event) => {
                const minute = parseNightPathTime(event.target.value);
                if (minute !== null) onChange({ ...draft, endMinute: minute });
              }}
            />
          </label>
        </div>
        <p className="night-path-hint">{t('nightPath.windowHint')}</p>
      </fieldset>

      <fieldset className="night-path-section">
        <legend>
          <span className="night-path-step" aria-hidden="true">
            <Lightbulb />
          </span>
          {t('nightPath.lightsTitle')}
        </legend>
        <p className="night-path-hint">{t('nightPath.lightsHint')}</p>
        <div className="night-path-rooms">
          {rooms.map((room) => (
            <RoomChoice
              key={room.id}
              room={room}
              checked={draft.lightRoomIds.includes(room.id)}
              disabled={room.lights === 0 && !draft.lightRoomIds.includes(room.id)}
              detail={
                room.lights
                  ? t('nightPath.roomLights', { count: room.lights })
                  : t('nightPath.roomWithoutLight')
              }
              onToggle={() => toggle('lightRoomIds', room.id)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="night-path-section">
        <legend>
          <span className="night-path-step" aria-hidden="true">
            <Sparkles />
          </span>
          {t('nightPath.lightTitle')}
        </legend>
        <label className="night-path-slider">
          <span>
            {t('nightPath.brightness')}
            <strong>{draft.brightnessPercent} %</strong>
          </span>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={draft.brightnessPercent}
            aria-valuetext={`${draft.brightnessPercent} %`}
            onChange={(event) =>
              onChange({ ...draft, brightnessPercent: Number(event.target.value) })
            }
          />
          <small>{t('nightPath.brightnessHint')}</small>
        </label>
        <div className="night-path-segment" role="radiogroup" aria-label={t('nightPath.warmth')}>
          {NIGHT_PATH_TEMPERATURES.map((kelvin) => (
            <button
              key={kelvin}
              type="button"
              role="radio"
              aria-checked={draft.colorTemperatureKelvin === kelvin}
              className={draft.colorTemperatureKelvin === kelvin ? 'is-selected' : ''}
              onClick={() => onChange({ ...draft, colorTemperatureKelvin: kelvin })}
            >
              <span className={`night-path-swatch is-${kelvin}`} aria-hidden="true" />
              {t(`nightPath.temperatures.${kelvin}`)}
            </button>
          ))}
        </div>
        <p className="night-path-hint">{t('nightPath.simpleLightHint')}</p>
      </fieldset>

      <fieldset className="night-path-section">
        <legend>
          <span className="night-path-step" aria-hidden="true">
            <Clock3 />
          </span>
          {t('nightPath.offTitle')}
        </legend>
        <div className="night-path-segment" role="radiogroup" aria-label={t('nightPath.offTitle')}>
          {NIGHT_PATH_OFF_DELAYS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={draft.offDelayMinutes === minutes}
              className={draft.offDelayMinutes === minutes ? 'is-selected' : ''}
              onClick={() => onChange({ ...draft, offDelayMinutes: minutes })}
            >
              {t('nightPath.minutes', { count: minutes })}
            </button>
          ))}
        </div>
        <p className="night-path-hint">{t('nightPath.offHint')}</p>
      </fieldset>

      <section className="night-path-preview" aria-live="polite">
        <MoonStar aria-hidden="true" />
        <p>{nightPathSummary(draft, rooms, resident)}</p>
      </section>

      {(problem || error) && (
        <p className="equipment-error" role="alert">
          {error || problem}
        </p>
      )}
      {testNotice && (
        <p className="night-path-test-notice" role="status">
          {testNotice}
        </p>
      )}
      <footer className="equipment-dialog-footer night-path-footer">
        <button
          className="equipment-secondary"
          type="button"
          disabled={busy || testing || !draft.lightRoomIds.length}
          onClick={onTest}
        >
          {testing ? <LoaderCircle className="is-spinning" /> : <Lightbulb />}
          {t('nightPath.test')}
        </button>
        <button className="equipment-secondary" type="button" disabled={busy} onClick={onCancel}>
          {t('nightPath.cancel')}
        </button>
        <button
          className="equipment-primary"
          type="button"
          disabled={busy || Boolean(problem)}
          onClick={onSave}
        >
          {busy ? <LoaderCircle className="is-spinning" /> : <Check />}
          {t('nightPath.save')}
        </button>
      </footer>
    </div>
  );
}

export function NightPathList({
  overview,
  resident,
  canManage,
  busyId,
  confirmDelete,
  onCreate,
  onEdit,
  onToggle,
  onAskDelete,
  onDelete,
}: {
  overview: NightPathOverview;
  resident: string;
  canManage: boolean;
  busyId: string | null;
  confirmDelete: string | null;
  onCreate: () => void;
  onEdit: (path: NightPath) => void;
  onToggle: (path: NightPath) => void;
  onAskDelete: (id: string | null) => void;
  onDelete: (path: NightPath) => void;
}) {
  const { paths, rooms } = overview;
  const hasLights = rooms.some(({ lights }) => lights > 0);
  const hasSensors = rooms.some(
    ({ presenceSensors, bedSensors }) => presenceSensors > 0 || bedSensors > 0,
  );
  const until = (value: string) =>
    new Date(value).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="night-path-list">
      <p className="night-path-intro">
        {t('nightPath.intro', { resident: resident || t('nightPath.theResident') })}
      </p>
      {(!hasLights || !hasSensors) && (
        <div className="equipment-note night-path-requirements">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>{t('nightPath.requirementsTitle')}</strong>
            <ul>
              {!hasSensors && <li>{t('nightPath.needsSensor')}</li>}
              {!hasLights && <li>{t('nightPath.needsLight')}</li>}
            </ul>
          </div>
        </div>
      )}
      {paths.length === 0 ? (
        <div className="night-path-empty" role="status">
          <span aria-hidden="true">
            <MoonStar />
          </span>
          <strong>{t('nightPath.emptyTitle')}</strong>
          <p>{t('nightPath.emptyText')}</p>
          {canManage && (
            <button className="equipment-primary" onClick={onCreate}>
              <Plus />
              {t('nightPath.create')}
            </button>
          )}
        </div>
      ) : (
        <ul className="night-path-cards">
          {paths.map((path) => (
            <li key={path.id} className={`night-path-card ${path.enabled ? '' : 'is-paused'}`}>
              <header>
                <span className="night-path-card-icon" aria-hidden="true">
                  <MoonStar />
                </span>
                <div>
                  <h3>{path.name}</h3>
                  <span
                    className={`night-path-status ${path.activeUntil ? 'is-lit' : path.enabled ? 'is-on' : 'is-off'}`}
                  >
                    {path.activeUntil ? <Lightbulb aria-hidden="true" /> : null}
                    {path.activeUntil
                      ? t('nightPath.litUntil', { time: until(path.activeUntil) })
                      : path.enabled
                        ? t('nightPath.enabled')
                        : t('nightPath.paused')}
                  </span>
                </div>
                {canManage && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={path.enabled}
                    aria-label={t('nightPath.toggle', { name: path.name })}
                    className="night-path-switch"
                    disabled={busyId === path.id}
                    onClick={() => onToggle(path)}
                  >
                    <span aria-hidden="true" />
                  </button>
                )}
              </header>
              <p>{nightPathSummary(path, rooms, resident)}</p>
              {canManage &&
                (confirmDelete === path.id ? (
                  <div className="night-path-confirm" role="group">
                    <span>{t('nightPath.confirmDelete')}</span>
                    <button
                      className="equipment-secondary"
                      onClick={() => onAskDelete(null)}
                      disabled={busyId === path.id}
                    >
                      {t('nightPath.keep')}
                    </button>
                    <button
                      className="equipment-secondary night-path-danger"
                      onClick={() => onDelete(path)}
                      disabled={busyId === path.id}
                    >
                      <Trash2 />
                      {t('nightPath.delete')}
                    </button>
                  </div>
                ) : (
                  <div className="night-path-card-actions">
                    <button className="equipment-secondary" onClick={() => onEdit(path)}>
                      <Pencil />
                      {t('nightPath.edit')}
                    </button>
                    <button
                      className="equipment-text-button night-path-delete"
                      onClick={() => onAskDelete(path.id)}
                    >
                      <Trash2 />
                      {t('nightPath.delete')}
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
      {paths.length > 0 && canManage && (
        <button className="night-path-add" onClick={onCreate}>
          <Plus />
          {t('nightPath.addAnother')}
        </button>
      )}
      {!canManage && <p className="night-path-hint">{t('nightPath.readOnly')}</p>}
      <p className="night-path-disclaimer">{t('nightPath.disclaimer')}</p>
    </div>
  );
}

/** « Chemin lumineux » window: list of night paths and their editor. */
export function NightPathDialog({
  resident,
  canManage,
  onClose,
  onChanged,
}: {
  resident: string;
  canManage: boolean;
  onClose: () => void;
  onChanged?: (overview: NightPathOverview) => void;
}) {
  const [overview, setOverview] = useState<NightPathOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testNotice, setTestNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await sensorRequest<NightPathOverview>(ENDPOINT);
      setOverview(next);
      onChanged?.(next);
    } catch {
      setLoadError(t('nightPath.loadError'));
    } finally {
      setLoading(false);
    }
  }, [onChanged]);

  useEffect(() => void load(), [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const body = { ...editing.draft, name: editing.draft.name.trim() };
      if (editing.id)
        await sensorRequest(
          `${ENDPOINT}/${encodeURIComponent(editing.id)}`,
          sensorJson('PATCH', body),
        );
      else await sensorRequest(ENDPOINT, sensorJson('POST', body));
      setEditing(null);
      setTestNotice('');
      await load();
    } catch {
      setError(t('nightPath.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!editing) return;
    setTesting(true);
    setTestNotice('');
    setError('');
    try {
      const result = await sensorRequest<NightPathTestResult>(
        `${ENDPOINT}/test`,
        sensorJson('POST', {
          lightRoomIds: editing.draft.lightRoomIds,
          brightnessPercent: editing.draft.brightnessPercent,
          colorTemperatureKelvin: editing.draft.colorTemperatureKelvin,
        }),
      );
      setTestNotice(
        result.lights
          ? t('nightPath.testStarted', { count: result.lights, seconds: result.seconds })
          : t('nightPath.testNoLight'),
      );
    } catch {
      setError(t('nightPath.testError'));
    } finally {
      setTesting(false);
    }
  };

  const toggle = async (path: NightPath) => {
    setBusyId(path.id);
    setError('');
    try {
      await sensorRequest(
        `${ENDPOINT}/${encodeURIComponent(path.id)}`,
        sensorJson('PATCH', { enabled: !path.enabled }),
      );
      await load();
    } catch {
      setError(t('nightPath.saveError'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (path: NightPath) => {
    setBusyId(path.id);
    setError('');
    try {
      await sensorRequest(`${ENDPOINT}/${encodeURIComponent(path.id)}`, { method: 'DELETE' });
      setConfirmDelete(null);
      await load();
    } catch {
      setError(t('nightPath.deleteError'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <EquipmentDialog
      title={
        editing
          ? editing.id
            ? t('nightPath.editTitle')
            : t('nightPath.newTitle')
          : t('nightPath.title')
      }
      wide
      busy={busy}
      onClose={onClose}
    >
      <div className="night-path-dialog">
        {loading && !overview ? (
          <div className="night-path-loading" role="status">
            <LoaderCircle className="is-spinning" />
            {t('nightPath.loading')}
          </div>
        ) : loadError && !overview ? (
          <div className="equipment-error" role="alert">
            {loadError}
            <button onClick={() => void load()}>{t('nightPath.retry')}</button>
          </div>
        ) : overview && editing ? (
          <NightPathEditor
            draft={editing.draft}
            rooms={overview.rooms}
            resident={resident}
            busy={busy}
            testing={testing}
            testNotice={testNotice}
            error={error}
            onChange={(draft) => setEditing({ ...editing, draft })}
            onCancel={() => {
              setEditing(null);
              setError('');
              setTestNotice('');
            }}
            onSave={() => void save()}
            onTest={() => void test()}
          />
        ) : overview ? (
          <>
            <NightPathList
              overview={overview}
              resident={resident}
              canManage={canManage}
              busyId={busyId}
              confirmDelete={confirmDelete}
              onCreate={() =>
                setEditing({
                  id: null,
                  draft: emptyNightPathDraft(overview.rooms, overview.paths.length),
                })
              }
              onEdit={(path) => setEditing({ id: path.id, draft: draftFromPath(path) })}
              onToggle={(path) => void toggle(path)}
              onAskDelete={setConfirmDelete}
              onDelete={(path) => void remove(path)}
            />
            {error && (
              <p className="equipment-error" role="alert">
                {error}
              </p>
            )}
          </>
        ) : null}
      </div>
    </EquipmentDialog>
  );
}
