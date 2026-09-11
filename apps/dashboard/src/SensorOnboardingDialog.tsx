import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, MapPin, Radio, RadioTower, RefreshCw } from 'lucide-react';
import {
  deviceSupportsCategory,
  ROOM_SENSOR_CATEGORIES,
  type HomePlan,
  type RoomSensorCategory,
  type SensorProduct,
} from '@michel/contracts';
import type { Locale } from './i18n';
import { EquipmentDialog } from './EquipmentDialog';
import { SensorInstallationGuide } from './SensorInstallationGuide';
import { sensorJson, sensorRequest, type SensorRoom, type SensorUiDevice } from './sensor-ui';
import { productMatchesDetectedModel } from './sensor-products';

type Session = {
  id: string;
  protocol: string;
  status: string;
  expiresAt: string;
  errorMessage?: string | null;
  detectedDevice?: SensorUiDevice | null;
  connection?: { pairingOpen: boolean } | null;
};
type Target = { type: 'ROOM' | 'OPENING' | 'STAIR'; id: string };

/** One installation flow for both the sensor list and a contextual room page. */
export function SensorOnboardingDialog({
  open,
  locale,
  rooms,
  initialRoomId,
  category,
  product,
  onClose,
  onInstalled,
  onResume,
}: {
  open: boolean;
  locale: Locale;
  rooms: SensorRoom[];
  initialRoomId?: string;
  category?: RoomSensorCategory | undefined;
  product?: SensorProduct | undefined;
  onClose: () => void;
  onInstalled: () => Promise<void>;
  onResume?: () => void;
}) {
  const fr = locale === 'fr';
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [plan, setPlan] = useState<HomePlan | null>(null);
  const [installed, setInstalled] = useState<SensorUiDevice | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const alive = useRef(true);
  const onChanged = useRef(onInstalled);
  onChanged.current = onInstalled;
  const resume = useRef(onResume);
  resume.current = onResume;
  const restoreOnce = useRef(false);
  const adopt = (next: Session) => {
    setSession(next);
    if (next.status === 'DEVICE_FOUND' && next.detectedDevice) {
      setStep(3);
      setName(next.detectedDevice.name);
      setNote(next.detectedDevice.placementNote ?? '');
    } else setStep(2);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open && (!onResume || restoreOnce.current)) return;
    restoreOnce.current = true;
    const controller = new AbortController();
    setReady(false);
    setError('');
    if (open) {
      setRoomId(initialRoomId ?? '');
      setTarget(null);
      setNote('');
      setName('');
      setInstalled(null);
      setStep(1);
      setSession(null);
    }
    void (async () => {
      try {
        const current = await sensorRequest<Session | null>(
          '/api/v1/sensor-devices/onboarding-sessions/current',
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (current && ['DEVICE_FOUND', 'PENDING', 'WAITING_FOR_DEVICE'].includes(current.status)) {
          adopt(current);
          if (!open) resume.current?.();
        }
        if (open) {
          const nextPlan = await sensorRequest<HomePlan>('/api/v1/household/plan', {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setPlan(nextPlan);
        }
        if (!controller.signal.aborted) setReady(true);
      } catch (err) {
        if (!controller.signal.aborted && open) {
          setError((err as Error).message);
          setReady(true);
        }
      }
    })();
    return () => controller.abort();
  }, [open, initialRoomId, onResume]);

  useEffect(() => {
    if (!open || !session || !['PENDING', 'WAITING_FOR_DEVICE'].includes(session.status)) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const next = await sensorRequest<Session>(
          `/api/v1/sensor-devices/onboarding-sessions/${session.id}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setSession(next);
        if (next.status === 'DEVICE_FOUND') {
          adopt(next);
          setError('');
        } else if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(next.status))
          setError(
            next.errorMessage ??
              (fr
                ? 'La recherche est terminée sans détection. Vous pouvez réessayer.'
                : 'No device found. You can retry.'),
          );
        else timer = window.setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError((err as Error).message);
          timer = window.setTimeout(() => void poll(), 3000);
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, session?.id, session?.status, fr]);
  useEffect(() => {
    if (!open || !session || step !== 2) return;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((Date.parse(session.expiresAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [open, session, step]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      if (session)
        await sensorRequest(`/api/v1/sensor-devices/onboarding-sessions/${session.id}`, {
          method: 'DELETE',
        });
      const next = await sensorRequest<Session>(
        '/api/v1/sensor-devices/onboarding-sessions',
        sensorJson('POST', product ? { protocol: product.protocol } : {}),
      );
      if (alive.current) adopt(next);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (session && step !== 4)
        await sensorRequest(`/api/v1/sensor-devices/onboarding-sessions/${session.id}`, {
          method: 'DELETE',
        });
      setSession(null);
      setStep(1);
      onClose();
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const finish = async () => {
    if (!session?.detectedDevice || !name.trim() || (initialRoomId && !roomId)) return;
    setBusy(true);
    setError('');
    try {
      const result = await sensorRequest<{ device: SensorUiDevice }>(
        `/api/v1/sensor-devices/onboarding-sessions/${session.id}/complete`,
        sensorJson('POST', {
          name: name.trim(),
          roomId: roomId || null,
          target: roomId ? target : null,
          placementNote: note.trim() || null,
          buttonRole: 'ASSISTANCE',
        }),
      );
      if (!alive.current) return;
      setInstalled(result.device);
      setSession(null);
      setStep(4);
      try {
        await onChanged.current();
      } catch {
        setError(
          fr
            ? 'Capteur enregistré. L’actualisation a échoué ; réessayez depuis le guide.'
            : 'Sensor saved. Refresh failed; retry from the guide.',
        );
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  if (!open) return null;
  const device = session?.detectedDevice;
  const room = rooms.find(({ id }) => id === roomId);
  const mismatch = category && device && !deviceSupportsCategory(device, category);
  const modelMatch = product && device ? productMatchesDetectedModel(product, device.model) : null;
  const categoryLabel = ROOM_SENSOR_CATEGORIES.find(({ id }) => id === category)?.[
    fr ? 'label' : 'labelEn'
  ];
  const floor = plan?.levels.find(({ rooms }) => rooms.some(({ id }) => id === roomId));
  const capabilities = new Set(device?.capabilities.map(({ capability }) => capability));
  const targets: Array<{ target: Target; label: string }> = [
    ...(floor?.openings ?? [])
      .filter(
        (opening) =>
          opening.roomIds.includes(roomId) &&
          (capabilities.has('contact') ||
            (opening.kind === 'PASSAGE' &&
              ['motion', 'occupancy', 'person_presence'].some((c) => capabilities.has(c)))),
      )
      .map((opening, index) => ({
        target: { type: 'OPENING' as const, id: opening.id },
        label: `${opening.isMainEntrance ? (fr ? 'Entrée principale' : 'Main entrance') : opening.kind === 'WINDOW' ? (fr ? 'Fenêtre' : 'Window') : fr ? 'Passage / porte' : 'Passage / door'} ${index + 1}`,
      })),
    ...(floor?.stairs ?? [])
      .filter(
        (stair) =>
          [stair.fromRoomId, stair.toRoomId].includes(roomId) &&
          ['motion', 'occupancy', 'person_presence'].some((c) => capabilities.has(c)),
      )
      .map((stair) => ({
        target: { type: 'STAIR' as const, id: stair.id },
        label: fr ? 'Escalier' : 'Stairs',
      })),
  ];
  return (
    <EquipmentDialog
      title={
        step === 4
          ? fr
            ? 'Installer et vérifier'
            : 'Place and check'
          : fr
            ? 'Ajouter un capteur'
            : 'Add a sensor'
      }
      onClose={() => void close()}
      busy={busy}
      closeLabel={fr ? 'Fermer' : 'Close'}
    >
      <div className="equipment-onboarding">
        {step < 4 && (
          <ol className="equipment-steps">
            {(fr ? ['Préparer', 'Connecter', 'Installer'] : ['Prepare', 'Connect', 'Install']).map(
              (label, index) => (
                <li className={step >= index + 1 ? 'is-active' : ''} key={label}>
                  <span>{step > index + 1 ? <Check /> : index + 1}</span>
                  {label}
                </li>
              ),
            )}
          </ol>
        )}
        {!ready && (
          <p role="status">
            <LoaderCircle className="is-spinning" /> {fr ? 'Préparation…' : 'Preparing…'}
          </p>
        )}
        {ready && step === 1 && (
          <>
            <div className="equipment-onboarding-intro">
              <RadioTower />
              <h3>
                {product
                  ? `${product.brand} ${fr ? product.name : product.nameEn}`
                  : fr
                    ? 'Préparez votre capteur'
                    : 'Prepare your sensor'}
              </h3>
              <p>
                {fr
                  ? 'Élise recherche la connexion adaptée autour de votre box.'
                  : 'Élise finds the right connection around your hub.'}
              </p>
            </div>
            <ol className="equipment-guide-steps">
              {(product
                ? fr
                  ? product.preparation
                  : product.preparationEn
                : fr
                  ? [
                      'Rapprochez le capteur de la box.',
                      'Alimentez-le et activez son mode association selon sa notice.',
                    ]
                  : [
                      'Move the sensor close to the hub.',
                      'Power it on and enable pairing according to its manual.',
                    ]
              ).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <button className="equipment-primary" disabled={busy} onClick={() => void start()}>
              <Radio />
              {fr ? 'Rechercher mon capteur' : 'Find my sensor'}
            </button>
          </>
        )}
        {step === 2 && (
          <div className="equipment-onboarding-intro">
            <Radio className={remaining > 0 ? 'equipment-pulse' : ''} />
            <span className="equipment-kicker">
              {fr ? 'Recherche autour de la box' : 'Searching around the hub'}
            </span>
            <h3>{fr ? 'En attente de votre capteur' : 'Waiting for your sensor'}</h3>
            <p>
              {fr
                ? 'Gardez le capteur en mode association, à proximité de la box.'
                : 'Keep the sensor in pairing mode near the hub.'}
            </p>
            <strong className="equipment-countdown" role="timer">
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
            </strong>
            {session?.connection?.pairingOpen && (
              <p>{fr ? 'La box est prête à détecter.' : 'The hub is ready.'}</p>
            )}
            {(error || remaining === 0) && (
              <button className="equipment-secondary" disabled={busy} onClick={() => void start()}>
                <RefreshCw />
                {fr ? 'Relancer la recherche' : 'Retry search'}
              </button>
            )}
          </div>
        )}
        {step === 3 && device && (
          <>
            <div className="equipment-found">
              <Check />
              <div>
                <strong>{fr ? 'Capteur trouvé' : 'Sensor found'}</strong>
                <p>
                  {[device.manufacturer, device.model].filter(Boolean).join(' · ') || device.name}
                </p>
              </div>
            </div>
            <div className="equipment-capability-tags">
              {device.capabilities
                .filter(({ capability }) => !['battery', 'signal_strength'].includes(capability))
                .map((c) => (
                  <span key={c.sensorId}>{c.label}</span>
                ))}
            </div>
            {mismatch && (
              <p className="equipment-note" role="status">
                {fr
                  ? `Cet appareil ne fournit pas « ${categoryLabel} ». Vous pouvez l’installer pour ses fonctions reconnues ; cette catégorie restera non configurée.`
                  : `This device does not provide ${categoryLabel}. You can install its recognized functions; this category will remain unconfigured.`}
              </p>
            )}
            {modelMatch === false && (
              <p className="equipment-note" role="status">
                {fr
                  ? `Modèle différent détecté : vous aviez choisi « ${product?.model} », mais Élise reconnaît « ${device.model} ». Vous pouvez continuer si les fonctions affichées correspondent à votre besoin.`
                  : `Different model detected: you selected ${product?.model}, but Élise recognizes ${device.model}. You can continue if the displayed functions meet your needs.`}
              </p>
            )}
            {modelMatch === null && product && (
              <p className="equipment-note" role="status">
                {fr
                  ? `Élise n’a pas pu confirmer la référence « ${product.model} ». Vérifiez le modèle inscrit sur le capteur avant de continuer.`
                  : `Élise could not confirm model ${product.model}. Check the model printed on the sensor before continuing.`}
              </p>
            )}
            <label className="equipment-field">
              {fr ? 'Nom du capteur' : 'Sensor name'}
              <input
                autoComplete="off"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {initialRoomId ? (
              <p className="equipment-room-binding">
                <MapPin />
                {room?.name}
              </p>
            ) : (
              <label className="equipment-field">
                {fr ? 'Pièce' : 'Room'}
                <select
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value);
                    setTarget(null);
                  }}
                >
                  <option value="">{fr ? 'Sans pièce' : 'Unassigned'}</option>
                  {[...rooms]
                    .sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="equipment-field">
              {fr ? 'Emplacement (facultatif)' : 'Location (optional)'}
              <input
                maxLength={500}
                value={note}
                placeholder={fr ? 'Par exemple : fenêtre gauche' : 'For example: left window'}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {!!targets.length && (
              <label className="equipment-field">
                {fr
                  ? 'Associer à une ouverture ou un escalier (facultatif)'
                  : 'Link to an opening or stairs (optional)'}
                <select
                  value={target ? `${target.type}:${target.id}` : ''}
                  onChange={(e) =>
                    setTarget(
                      targets.find((t) => `${t.target.type}:${t.target.id}` === e.target.value)
                        ?.target ?? null,
                    )
                  }
                >
                  <option value="">{fr ? 'Dans la pièce' : 'In the room'}</option>
                  {targets.map((t) => (
                    <option
                      key={`${t.target.type}:${t.target.id}`}
                      value={`${t.target.type}:${t.target.id}`}
                    >
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <footer className="equipment-dialog-footer">
              <button
                className="equipment-primary"
                disabled={busy || !name.trim() || (!!initialRoomId && !room)}
                onClick={() => void finish()}
              >
                <Check />
                {busy
                  ? fr
                    ? 'Installation…'
                    : 'Installing…'
                  : room
                    ? fr
                      ? `Installer dans ${room.name}`
                      : `Install in ${room.name}`
                    : fr
                      ? 'Enregistrer sans pièce'
                      : 'Save without room'}
              </button>
            </footer>
          </>
        )}
        {error && (
          <p className="equipment-error" role="alert">
            {error}
          </p>
        )}
        {step === 4 && installed && (
          <SensorInstallationGuide
            device={installed}
            locale={locale}
            onChanged={async () => {
              await onChanged.current();
              const devices = await sensorRequest<SensorUiDevice[]>('/api/v1/sensor-devices');
              setInstalled(devices.find(({ id }) => id === installed.id) ?? installed);
            }}
            onDone={() => void close()}
          />
        )}
      </div>
    </EquipmentDialog>
  );
}
