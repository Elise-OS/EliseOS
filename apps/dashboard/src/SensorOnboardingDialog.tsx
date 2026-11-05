import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, MapPin, Radio, RadioTower, RefreshCw, Sparkles } from 'lucide-react';
import {
  CONTACT_TYPES,
  type ContactRole,
  deviceSupportsCategory,
  isBedOccupancySensorModel,
  type RoomSensorCategory,
  type SensorProduct,
} from '@elise/contracts';
import { type Locale, t, textBlock } from './i18n';
import { EquipmentDialog } from './EquipmentDialog';
import { ProductPhoto } from './SensorProductCard';
import { sensorJson, sensorRequest, type SensorRoom, type SensorUiDevice } from './sensor-ui';
import { productMatchesDetectedModel } from './sensor-products';
import { contactTypeLabel, productTexts, sensorCategoryLabel } from './i18n/data';

type Session = {
  id: string;
  protocol: string;
  status: string;
  expiresAt: string;
  errorMessage?: string | null;
  detectedDevice?: (SensorUiDevice & { detectedType?: string }) | null;
  connection?: { pairingOpen: boolean; deviceDetected?: boolean } | null;
};

/** One installation flow for both the sensor list and a contextual room page. */
export function SensorOnboardingDialog({
  open,
  locale,
  rooms,
  initialRoomId,
  initialTarget,
  contactRole,
  bedOccupiedWhen = 'CLOSED',
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
  initialTarget?: { type: 'OPENING' | 'STAIR'; id: string } | undefined;
  contactRole?: ContactRole | undefined;
  bedOccupiedWhen?: 'CLOSED' | 'OPEN' | undefined;
  category?: RoomSensorCategory | undefined;
  product?: SensorProduct | undefined;
  onClose: () => void;
  onInstalled: () => Promise<void>;
  onResume?: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [name, setName] = useState('');
  const [openingType, setOpeningType] = useState<ContactRole | ''>(contactRole ?? '');
  const [occupiedWhen, setOccupiedWhen] = useState<'CLOSED' | 'OPEN'>(bedOccupiedWhen);
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
      setName(product ? productTexts(product).name : next.detectedDevice.name);
      if (category === 'bed' && isBedOccupancySensorModel(next.detectedDevice.model))
        setOccupiedWhen('OPEN');
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
      setName('');
      setOpeningType(contactRole ?? '');
      setOccupiedWhen(bedOccupiedWhen);
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
        if (!controller.signal.aborted) setReady(true);
      } catch (err) {
        if (!controller.signal.aborted && open) {
          setError((err as Error).message);
          setReady(true);
        }
      }
    })();
    return () => controller.abort();
  }, [
    open,
    initialRoomId,
    initialTarget?.id,
    onResume,
    product,
    locale,
    contactRole,
    bedOccupiedWhen,
  ]);

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
          setError(next.errorMessage ?? t('sensorOnboardingDialog.noDeviceFoundYouCan'));
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
  }, [open, session?.id, session?.status, locale]);
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
        sensorJson('POST', { protocol: product?.protocol ?? 'zigbee' }),
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
      if (session)
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
    if (!session?.detectedDevice || !name.trim() || !roomId) return;
    if (category && !deviceSupportsCategory(session.detectedDevice, category)) return;
    if (
      initialTarget?.type === 'OPENING' &&
      !deviceSupportsCategory(session.detectedDevice, 'contact')
    )
      return;
    if (
      initialTarget?.type === 'STAIR' &&
      !(['motion', 'presence'] as RoomSensorCategory[]).some((id) =>
        deviceSupportsCategory(session.detectedDevice!, id),
      )
    )
      return;
    if (deviceSupportsCategory(session.detectedDevice, 'contact') && !openingType) return;
    setBusy(true);
    setError('');
    const sessionUrl = `/api/v1/sensor-devices/onboarding-sessions/${session.id}`;
    try {
      try {
        await sensorRequest(`${sessionUrl}/complete`, {
          ...sensorJson('POST', {
            name: name.trim(),
            roomId,
            category,
            target: initialTarget ?? null,
            contactRole: openingType || undefined,
            bedOccupiedWhen: category === 'bed' ? occupiedWhen : undefined,
            buttonRole: 'ASSISTANCE',
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (requestError) {
        // A lost response can follow a committed installation. Check the session
        // before offering another attempt, which would report a false failure.
        const confirmed = await sensorRequest<Session>(sessionUrl, {
          signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        if (confirmed?.status !== 'COMPLETED') throw requestError;
      }
      if (!alive.current) return;
      const refresh = onChanged.current;
      onClose();
      // The installation is complete; a slow page refresh must not hold the dialog open.
      void refresh().catch(() => undefined);
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
  const categoryLabel = category ? sensorCategoryLabel(category) : undefined;
  const deviceDetected = session?.connection?.deviceDetected === true;
  return (
    <EquipmentDialog
      title={t('sensorOnboardingDialog.addASensor')}
      onClose={() => void close()}
      busy={busy}
      closeLabel={t('sensorOnboardingDialog.close')}
    >
      <div className="equipment-onboarding">
        <ol className="equipment-steps">
          {[
            t('sensorOnboardingDialog.steps.prepare'),
            t('sensorOnboardingDialog.steps.connect'),
            t('sensorOnboardingDialog.steps.install'),
          ].map((label, index) => (
            <li
              className={step > index + 1 ? 'is-complete' : step === index + 1 ? 'is-current' : ''}
              aria-current={step === index + 1 ? 'step' : undefined}
              key={label}
            >
              <span>{step > index + 1 ? <Check /> : index + 1}</span>
              <div>
                <small>{t('sensorOnboardingDialog.stepOf3', { value: index + 1 })}</small>
                <strong>{label}</strong>
              </div>
            </li>
          ))}
        </ol>
        {!ready && (
          <p role="status">
            <LoaderCircle className="is-spinning" /> {t('sensorOnboardingDialog.preparing')}
          </p>
        )}
        {ready && step === 1 && (
          <>
            <div className="equipment-onboarding-intro">
              {product ? (
                <div className="equipment-onboarding-product-photo">
                  <ProductPhoto product={product} />
                </div>
              ) : (
                <RadioTower />
              )}
              <h3>
                {product
                  ? `${product.brand} ${productTexts(product).name}`
                  : t('sensorOnboardingDialog.prepareYourSensor')}
              </h3>
              <p>{t('sensorOnboardingDialog.eliseFindsTheRightConnection')}</p>
            </div>
            <ol className="equipment-guide-steps">
              {(product
                ? productTexts(product).preparation
                : textBlock('sensorOnboardingDialog.genericPreparation')
              ).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <button
              className="equipment-primary equipment-search-button"
              disabled={busy}
              onClick={() => void start()}
            >
              <Radio />
              {t('sensorOnboardingDialog.findMySensor')}
            </button>
          </>
        )}
        {step === 2 && (
          <div className="equipment-onboarding-intro">
            <Radio className={remaining > 0 ? 'equipment-pulse' : ''} />
            <span className="equipment-kicker">
              {deviceDetected
                ? t('sensorOnboardingDialog.sensorDetected')
                : t('sensorOnboardingDialog.searchingAroundTheHub')}
            </span>
            <h3>
              {deviceDetected
                ? t('sensorOnboardingDialog.pairingInProgress')
                : t('sensorOnboardingDialog.waitingForYourSensor')}
            </h3>
            <p>
              {deviceDetected
                ? t('sensorOnboardingDialog.eliseFoundYourSensorAnd')
                : t('sensorOnboardingDialog.keepTheSensorInPairing')}
            </p>
            <strong className="equipment-countdown" role="timer">
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
            </strong>
            {session?.connection?.pairingOpen && !deviceDetected && (
              <p>{t('sensorOnboardingDialog.theHubIsReady')}</p>
            )}
            {(error || remaining === 0) && (
              <button className="equipment-secondary" disabled={busy} onClick={() => void start()}>
                <RefreshCw />
                {t('sensorOnboardingDialog.retrySearch')}
              </button>
            )}
          </div>
        )}
        {step === 3 && device && (
          <div className="equipment-install-step">
            <div className="equipment-found-hero">
              <span className="equipment-found-icon">
                <Check />
              </span>
              <div>
                <span className="equipment-kicker">
                  {t('sensorOnboardingDialog.connectionSuccessful')}
                </span>
                <h3>{t('sensorOnboardingDialog.yourSensorIsReady')}</h3>
                <p>
                  {[device.manufacturer, device.model].filter(Boolean).join(' · ') || device.name}
                </p>
              </div>
            </div>
            <div className="equipment-detected-functions">
              <span>{t('sensorOnboardingDialog.detectedFeatures')}</span>
              <div className="equipment-capability-tags">
                {device.capabilities
                  .filter(
                    ({ capability, primary }) =>
                      primary && !['battery', 'signal_strength', 'unknown'].includes(capability),
                  )
                  .map((c) => (
                    <span key={c.sensorId}>
                      <Check /> {c.label}
                    </span>
                  ))}
              </div>
            </div>
            {mismatch && (
              <p className="equipment-install-warning" role="status">
                {t('sensorOnboardingDialog.thisDeviceDoesNotProvide', { categoryLabel })}
              </p>
            )}
            {modelMatch === false && (
              <p className="equipment-install-warning" role="status">
                {t('sensorOnboardingDialog.differentModelDetectedYouSelected', {
                  model: product?.model,
                  model2: device.model,
                })}
              </p>
            )}
            {modelMatch === null && product && (
              <p className="equipment-install-warning" role="status">
                {t('sensorOnboardingDialog.eliseCouldNotConfirmModel', { model: product.model })}
              </p>
            )}
            <section className="equipment-install-form">
              <div className="equipment-install-form-heading">
                <Sparkles />
                <div>
                  <h4>{t('sensorOnboardingDialog.finishInstallation')}</h4>
                  <p>{t('sensorOnboardingDialog.simplyChooseItsRoomAnd')}</p>
                </div>
              </div>
              {initialRoomId ? (
                <div className="equipment-room-choice is-selected">
                  <MapPin />
                  <span>
                    <small>{t('sensorOnboardingDialog.room')}</small>
                    <strong>{room?.name}</strong>
                  </span>
                  <Check />
                </div>
              ) : (
                <label className="equipment-field">
                  {t('sensorOnboardingDialog.whichRoom')}
                  <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    <option value="">{t('sensorOnboardingDialog.chooseARoom')}</option>
                    {[...rooms]
                      .sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0))
                      .map((candidateRoom) => (
                        <option key={candidateRoom.id} value={candidateRoom.id}>
                          {candidateRoom.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {deviceSupportsCategory(device, 'contact') && category !== 'bed' && (
                <label className="equipment-field">
                  {t('sensorOnboardingDialog.whatDoesThisOpeningMonitor')}
                  <select
                    value={openingType}
                    onChange={(e) => setOpeningType(e.target.value as ContactRole)}
                  >
                    <option value="">{t('sensorOnboardingDialog.chooseAnOpeningType')}</option>
                    {CONTACT_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>
                        {contactTypeLabel(type.id)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {category === 'bed' && (
                <>
                  <p className="equipment-note">
                    {isBedOccupancySensorModel(device.model)
                      ? t('sensorOnboardingDialog.theTuyaPressureStripDetects')
                      : t('sensorOnboardingDialog.connectTheSdc41')}
                  </p>
                  {!isBedOccupancySensorModel(device.model) && (
                    <label className="equipment-field">
                      {t('sensorOnboardingDialog.whenTheBedIsOccupied')}
                      <select
                        value={occupiedWhen}
                        onChange={(event) =>
                          setOccupiedWhen(event.target.value as 'CLOSED' | 'OPEN')
                        }
                      >
                        <option value="CLOSED">
                          {t('sensorOnboardingDialog.theContactIsClosed')}
                        </option>
                        <option value="OPEN">{t('sensorOnboardingDialog.theContactIsOpen')}</option>
                      </select>
                    </label>
                  )}
                </>
              )}
              <label className="equipment-field">
                {t('sensorOnboardingDialog.sensorName')}
                <input
                  autoComplete="off"
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </section>
            <footer className="equipment-dialog-footer">
              <button
                className="equipment-primary"
                disabled={
                  busy ||
                  !name.trim() ||
                  !room ||
                  Boolean(mismatch) ||
                  (deviceSupportsCategory(device, 'contact') && !openingType)
                }
                onClick={() => void finish()}
              >
                <Check />
                {busy
                  ? t('sensorOnboardingDialog.installing')
                  : room
                    ? t('sensorOnboardingDialog.installIn', { name: room.name })
                    : t('sensorOnboardingDialog.chooseARoom')}
              </button>
            </footer>
          </div>
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
