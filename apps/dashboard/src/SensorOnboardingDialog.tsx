import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AppWindow,
  Check,
  DoorClosed,
  DoorOpen,
  Ellipsis,
  LoaderCircle,
  MapPin,
  Radio,
  RadioTower,
  Refrigerator,
  RefreshCw,
  Sun,
} from 'lucide-react';
import {
  CONTACT_TYPES,
  type ContactRole,
  deviceSupportsCategory,
  isBedOccupancySensorModel,
  ACTIVE_ONBOARDING_STATUSES,
  SENSOR_SEARCH_SECONDS,
  deviceLooksUnsupported,
  formatSearchCountdown,
  pairingIntentApplies,
  pairingNameSuggestions,
  pairingProblems,
  pendingDeviceCount,
  searchTimedOut,
  secondsUntil,
  type RoomSensorCategory,
  type SensorErrorCode,
  type SensorProduct,
} from '@elise/contracts';
import { type Locale, t, textBlock } from './i18n';
import { ProductPhoto } from './SensorProductCard';
import {
  SetupField,
  SetupList,
  SetupNotice,
  SetupPage,
  SetupRow,
  SetupSection,
  SetupSegmented,
  SetupChoices,
  SetupSheet,
  useSetupStep,
  useSheetControls,
} from './SetupSheet';
import {
  SensorRequestError,
  sensorJson,
  sensorRequest,
  type SensorRoom,
  type SensorUiDevice,
} from './sensor-ui';
import { productMatchesDetectedModel, sensorDevicePhoto } from './sensor-products';
import { contactTypeLabel, productTexts, sensorCategoryLabel } from './i18n/data';

type Session = {
  id: string;
  protocol: string;
  status: string;
  expiresAt: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  detectedDevice?: (SensorUiDevice & { detectedType?: string }) | null;
  /** Other devices found by the same search (absent from older boxes). */
  pendingDevices?: Array<SensorUiDevice & { detectedType?: string }>;
  connection?: { online?: boolean; pairingOpen: boolean; deviceDetected?: boolean } | null;
};

/** Devices of one search are offered one after the other; see `pairingIntentApplies`. */
type Queue = {
  installed: number;
  intentUsed: boolean;
  previous: { name: string; room: string } | null;
};
const EMPTY_QUEUE: Queue = { installed: 0, intentUsed: false, previous: null };

type Phase = 'LOADING' | 'PREPARE' | 'SEARCH' | 'FOUND' | 'DONE';
type Failure = {
  reason: 'TIMEOUT' | 'REJECTED' | 'CANCELLED' | 'UNSUPPORTED';
  message?: string | null | undefined;
};

const ACTIVE: readonly string[] = ACTIVE_ONBOARDING_STATUSES;
const SESSIONS = '/api/v1/sensor-devices/onboarding-sessions';

const contactIcons: Record<ContactRole, ReactNode> = {
  DOOR: <DoorClosed />,
  MAIN_ENTRANCE: <DoorOpen />,
  WINDOW: <AppWindow />,
  VERANDA: <Sun />,
  FRIDGE: <Refrigerator />,
  OTHER: <Ellipsis />,
  BED: <Ellipsis />,
};

export type PairingProgress = { offset: number; total: number };

/**
 * Pairing part of the sensor setup: prepare the sensor, let the hub find it, then
 * name it and place it. Rendered inside a SetupSheet so a longer flow can lead into it.
 */
export function SensorPairingFlow({
  rooms,
  initialRoomId,
  initialTarget,
  contactRole,
  bedOccupiedWhen = 'CLOSED',
  category: categoryChoice,
  product: productChoice,
  progress = { offset: 0, total: 3 },
  onBack,
  backLabel,
  onClose,
  onInstalled,
  onAddAnother,
}: {
  rooms: SensorRoom[];
  initialRoomId?: string | undefined;
  initialTarget?: { type: 'OPENING' | 'STAIR'; id: string } | undefined;
  contactRole?: ContactRole | undefined;
  bedOccupiedWhen?: 'CLOSED' | 'OPEN' | undefined;
  category?: RoomSensorCategory | undefined;
  product?: SensorProduct | undefined;
  progress?: PairingProgress;
  onBack?: (() => void) | undefined;
  backLabel?: string | undefined;
  onClose: () => void;
  onInstalled: () => Promise<void>;
  onAddAnother?: (() => void) | undefined;
}) {
  const { step: phase, direction, go, back } = useSetupStep<Phase>('LOADING');
  const [session, setSession] = useState<Session | null>(null);
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [name, setName] = useState('');
  const [openingType, setOpeningType] = useState<ContactRole | ''>(contactRole ?? '');
  const [occupiedWhen, setOccupiedWhen] = useState<'CLOSED' | 'OPEN'>(bedOccupiedWhen);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  // The hub saw a device join, whether or not it could be used.
  const deviceSeen = useRef(false);
  // A start request that got no answer may still have opened the search on the hub.
  const startUnanswered = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [installed, setInstalled] = useState<{ name: string; room: string } | null>(null);
  const [queue, setQueue] = useState<Queue>(EMPTY_QUEUE);
  const alive = useRef(true);
  const refresh = useRef(onInstalled);
  refresh.current = onInstalled;

  const adopt = useCallback(
    (next: Session) => {
      setSession(next);
      if (next.connection?.deviceDetected) deviceSeen.current = true;
      if (next.status === 'DEVICE_FOUND' && next.detectedDevice) {
        setName(productChoice ? productTexts(productChoice).name : next.detectedDevice.name);
        if (categoryChoice === 'bed' && isBedOccupancySensorModel(next.detectedDevice.model))
          setOccupiedWhen('OPEN');
        setFailure(null);
        go('FOUND');
      } else if (ACTIVE.includes(next.status)) go('SEARCH');
    },
    // `go` only replaces state; the product and category are fixed for one flow.
    [productChoice, categoryChoice],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A search started earlier (another tab, a reload) is picked up where it was.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const current = await sensorRequest<Session | null>(`${SESSIONS}/current`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (current && ACTIVE.includes(current.status)) adopt(current);
        else go('PREPARE');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError((err as Error).message);
        go('PREPARE');
      }
    })();
    return () => controller.abort();
  }, [adopt]);

  const searching = phase === 'SEARCH' && !failure && !!session && ACTIVE.includes(session.status);

  useEffect(() => {
    if (!searching || !session) return;
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      window.clearTimeout(timer);
      try {
        const next = await sensorRequest<Session>(`${SESSIONS}/${session.id}`, {
          signal: withTimeout(controller.signal, 10_000),
        });
        if (controller.signal.aborted) return;
        setOffline(false);
        if (next.connection?.deviceDetected) deviceSeen.current = true;
        if (next.status === 'DEVICE_FOUND' && next.detectedDevice) return adopt(next);
        setSession(next);
        if (next.status === 'FAILED')
          return setFailure({ reason: 'REJECTED', message: next.errorMessage });
        if (next.status === 'EXPIRED')
          return setFailure({ reason: deviceSeen.current ? 'UNSUPPORTED' : 'TIMEOUT' });
        if (next.status === 'CANCELLED' || next.status === 'COMPLETED')
          return setFailure({ reason: 'CANCELLED' });
        timer = window.setTimeout(() => void poll(), 1500);
      } catch {
        if (controller.signal.aborted) return;
        // A dropped request does not end the search: the hub keeps listening.
        setOffline(true);
        timer = window.setTimeout(() => void poll(), 3000);
      }
    };
    // Background tabs slow timers down; look again as soon as the page is visible.
    const visible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', visible);
    timer = window.setTimeout(() => void poll(), 1200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [searching, session?.id, adopt]);

  useEffect(() => {
    if (!searching || !session) return;
    const update = () => {
      const left = secondsUntil(session.expiresAt);
      setSecondsLeft(left);
      if (searchTimedOut(left, session.connection?.deviceDetected || deviceSeen.current))
        setFailure({ reason: 'TIMEOUT' });
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [searching, session]);

  const cancelSession = async (target: Session | null) => {
    if (!target) {
      // Our request to start got no answer, yet the hub may be listening: stop that search.
      if (!startUnanswered.current) return;
      startUnanswered.current = false;
      const current = await sensorRequest<Session | null>(`${SESSIONS}/current`, {
        signal: AbortSignal.timeout(6_000),
      }).catch(() => null);
      return cancelSession(current);
    }
    if (!ACTIVE.includes(target.status)) return;
    await sensorRequest(`${SESSIONS}/${target.id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(6_000),
    }).catch(() => undefined);
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setFailure(null);
    setOffline(false);
    setQueue(EMPTY_QUEUE);
    deviceSeen.current = false;
    try {
      // Starting a search replaces any earlier one on the hub as well.
      await cancelSession(session);
      startUnanswered.current = true;
      const next = await sensorRequest<Session>(SESSIONS, {
        ...sensorJson('POST', { protocol: productChoice?.protocol ?? 'zigbee' }),
        signal: AbortSignal.timeout(15_000),
      });
      startUnanswered.current = false;
      if (!alive.current) return;
      setSecondsLeft(Math.ceil((Date.parse(next.expiresAt) - Date.now()) / 1000));
      adopt(next);
    } catch (err) {
      // An answer from the API (even a refusal) means nothing was started.
      if (err instanceof SensorRequestError) startUnanswered.current = false;
      if (alive.current) setError(friendlyError(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const stopSearch = async () => {
    if (busy) return;
    setBusy(true);
    await cancelSession(session);
    if (!alive.current) return;
    setSession(null);
    setFailure(null);
    setOffline(false);
    setBusy(false);
    back('PREPARE');
  };

  const close = async () => {
    if (busy) return;
    if (phase !== 'DONE') {
      setBusy(true);
      await cancelSession(session);
      if (alive.current) setBusy(false);
    }
    onClose();
  };
  useSheetControls({ busy, onClose: () => void close() });

  const device = session?.detectedDevice;
  const pending = pendingDeviceCount(session);
  // A search may find several devices: what the person chose goes to the one that fits it,
  // the others are named and placed as plain sensors.
  const intent =
    !device ||
    pairingIntentApplies(device, {
      category: categoryChoice,
      targetType: initialTarget?.type,
      product: productChoice,
      severalDevices: pending > 0 || queue.installed > 0,
      intentUsed: queue.intentUsed,
    });
  const category = intent ? categoryChoice : undefined;
  const product = intent ? productChoice : undefined;
  const target = intent ? initialTarget : undefined;
  useEffect(() => {
    // The next device of the same search gets its own default name and opening type.
    if (phase !== 'FOUND' || !device || queue.installed === 0) return;
    setName(product ? productTexts(product).name : device.name);
    setOpeningType(intent ? (contactRole ?? '') : '');
  }, [phase, session?.id]);
  const room = rooms.find(({ id }) => id === roomId);
  const isContact = !!device && deviceSupportsCategory(device, 'contact') && category !== 'bed';
  const problems = device
    ? pairingProblems(device, { category, targetType: target?.type })
    : { mismatch: false, wrongTarget: false };
  const { mismatch, wrongTarget } = problems;
  const unsupported = !!device && deviceLooksUnsupported(device);
  const canFinish =
    !!device &&
    !unsupported &&
    !!name.trim() &&
    !!room &&
    !mismatch &&
    !wrongTarget &&
    !(deviceSupportsCategory(device, 'contact') && category !== 'bed' && !openingType);

  const finish = async () => {
    if (!session || !device || !canFinish || busy) return;
    setBusy(true);
    setError('');
    const sessionUrl = `${SESSIONS}/${session.id}`;
    try {
      let answer: { nextSession?: Session | null } | null = null;
      try {
        answer = await sensorRequest<{ nextSession?: Session | null }>(`${sessionUrl}/complete`, {
          ...sensorJson('POST', {
            name: name.trim(),
            roomId,
            category,
            target: target ?? null,
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
      // Other devices of the same search come next. Older boxes answer without
      // `nextSession`; after a lost answer, ask the box which installation is current.
      const next = answer
        ? (answer.nextSession ?? null)
        : await sensorRequest<Session | null>(`${SESSIONS}/current`, {
            signal: AbortSignal.timeout(8_000),
          }).catch(() => null);
      if (!alive.current) return;
      if (next && next.id !== session.id && ACTIVE.includes(next.status)) {
        setQueue({
          installed: queue.installed + 1,
          intentUsed: queue.intentUsed || intent,
          previous: { name: name.trim(), room: room?.name ?? '' },
        });
        deviceSeen.current = true;
        adopt(next);
        void refresh.current().catch(() => undefined);
        return;
      }
      setSession((current) => (current ? { ...current, status: 'COMPLETED' } : current));
      setInstalled({ name: name.trim(), room: room?.name ?? '' });
      go('DONE');
      // The installation is complete; a slow page refresh must not hold the flow.
      void refresh.current().catch(() => undefined);
    } catch (err) {
      if (alive.current) setError(friendlyError(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const step = (value: number) => ({ value: progress.offset + value, total: progress.total });
  const productName = product ? productTexts(product).name : undefined;

  if (phase === 'LOADING')
    return (
      <SetupPage
        pageKey="loading"
        progress={step(1)}
        centered
        title={t('sensorSetup.preparing')}
        hero={<LoaderCircle className="ss-spinner is-large" aria-hidden />}
      />
    );

  if (phase === 'DONE' && installed)
    return (
      <SensorInstalledPage
        direction={direction}
        progress={progress.total}
        name={installed.name}
        room={installed.room}
        photo={product ? <ProductPhoto product={product} /> : <DevicePicture device={device} />}
        tip={product ? productTexts(product).placement[0] : undefined}
        onDone={onClose}
        onAddAnother={onAddAnother}
      />
    );

  if (phase === 'FOUND' && device) {
    const photo = sensorDevicePhoto(device);
    const features = device.capabilities.filter(
      ({ capability, primary }) =>
        primary && !['battery', 'signal_strength', 'unknown'].includes(capability),
    );
    const modelMatch = product ? productMatchesDetectedModel(product, device.model) : undefined;
    const suggestions = pairingNameSuggestions({
      productName,
      categoryLabel: category ? sensorCategoryLabel(category) : undefined,
      roomName: room?.name,
      deviceName: device.name,
    });
    return (
      <SetupPage
        pageKey="found"
        direction={direction}
        progress={step(3)}
        eyebrow={t('sensorSetup.connectionSuccessful')}
        title={t('sensorSetup.yourSensorIsReady')}
        subtitle={[device.manufacturer, device.model].filter(Boolean).join(' · ') || device.name}
        hero={
          <div className="ss-found-hero">
            <span className="ss-found-photo">
              {product ? (
                <ProductPhoto product={product} />
              ) : photo ? (
                <img src={photo} alt="" />
              ) : (
                <Radio aria-hidden />
              )}
            </span>
            <span className="ss-found-badge" aria-hidden>
              <Check />
            </span>
          </div>
        }
        footer={
          <>
            {error && (
              <button
                type="button"
                className="ss-secondary"
                disabled={busy}
                onClick={() => void start()}
              >
                <RefreshCw aria-hidden />
                {t('sensorSetup.retrySearch')}
              </button>
            )}
            <button
              type="button"
              className="ss-primary"
              disabled={busy || !canFinish}
              onClick={() => void finish()}
            >
              {busy ? <LoaderCircle className="ss-spinner" aria-hidden /> : <Check aria-hidden />}
              {busy
                ? t('sensorSetup.installing')
                : room
                  ? t('sensorSetup.installIn', { name: room.name })
                  : t('sensorSetup.chooseARoom')}
            </button>
          </>
        }
      >
        {features.length > 0 && (
          <div className="ss-tags" aria-label={t('sensorSetup.detectedFeatures')}>
            {features.map((feature) => (
              <span key={feature.sensorId}>
                <Check aria-hidden /> {feature.label}
              </span>
            ))}
          </div>
        )}
        {(queue.previous || pending > 0) && (
          <SetupNotice>
            {[
              queue.previous
                ? t('sensorSetup.queue.previousInstalled', {
                    name: queue.previous.name,
                    room: queue.previous.room,
                  })
                : '',
              pending > 0 ? t('sensorSetup.queue.remaining', { count: pending }) : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </SetupNotice>
        )}
        {unsupported && (
          <SetupNotice tone="danger" title={t('sensorSetup.unsupportedTitle')}>
            {t('sensorSetup.unsupportedText')}
          </SetupNotice>
        )}
        {device.room && (
          <SetupNotice tone="warning">
            {device.room.id === roomId
              ? t('sensorSetup.alreadyInstalledHere')
              : t('sensorSetup.alreadyInstalledElsewhere', { name: device.room.name })}
          </SetupNotice>
        )}
        {mismatch && (
          <SetupNotice tone="danger">
            {t('sensorSetup.thisDeviceDoesNotProvide', {
              categoryLabel: category ? sensorCategoryLabel(category) : '',
            })}
          </SetupNotice>
        )}
        {!mismatch && wrongTarget && (
          <SetupNotice tone="danger">{t('sensorSetup.wrongTarget')}</SetupNotice>
        )}
        {modelMatch === false && (
          <SetupNotice tone="warning">
            {t('sensorSetup.differentModelDetectedYouSelected', {
              model: product?.model,
              model2: device.model,
            })}
          </SetupNotice>
        )}
        {modelMatch === null && product && (
          <SetupNotice tone="warning">
            {t('sensorSetup.eliseCouldNotConfirmModel', { model: product.model })}
          </SetupNotice>
        )}

        <SetupSection title={t('sensorSetup.finishInstallation')}>
          <div className="ss-form">
            {intent && initialRoomId && room ? (
              <SetupList>
                <SetupRow
                  icon={<MapPin aria-hidden />}
                  title={room.name}
                  detail={t('sensorSetup.room')}
                  trailing={<Check className="ss-row-check" aria-hidden />}
                />
              </SetupList>
            ) : (
              <SetupField label={t('sensorSetup.whichRoom')}>
                <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                  <option value="">{t('sensorSetup.chooseARoom')}</option>
                  {[...rooms]
                    .sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0))
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                </select>
              </SetupField>
            )}
            <SetupField label={t('sensorSetup.sensorName')}>
              <input
                autoComplete="off"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </SetupField>
            {suggestions.length > 1 && (
              <div className="ss-suggestions" aria-label={t('sensorSetup.nameSuggestions')}>
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    aria-pressed={suggestion === name.trim()}
                    onClick={() => setName(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {isContact && (
              <div className="ss-field">
                <span className="ss-field-label">
                  {t('sensorSetup.whatDoesThisOpeningMonitor')}
                </span>
                <SetupChoices
                  label={t('sensorSetup.whatDoesThisOpeningMonitor')}
                  value={openingType}
                  onChange={setOpeningType}
                  options={CONTACT_TYPES.filter(({ id }) => id !== 'BED').map(({ id }) => ({
                    value: id,
                    label: contactTypeLabel(id),
                    icon: contactIcons[id],
                  }))}
                />
              </div>
            )}
            {category === 'bed' && (
              <>
                <SetupNotice>
                  {isBedOccupancySensorModel(device.model)
                    ? t('sensorSetup.theTuyaPressureStripDetects')
                    : t('sensorSetup.connectTheSdc41')}
                </SetupNotice>
                {!isBedOccupancySensorModel(device.model) && (
                  <BedContactChoice value={occupiedWhen} onChange={setOccupiedWhen} />
                )}
              </>
            )}
          </div>
        </SetupSection>
        {error && <SetupNotice tone="danger">{error}</SetupNotice>}
      </SetupPage>
    );
  }

  if (phase === 'SEARCH') {
    const detected = session?.connection?.deviceDetected === true;
    const listening = session?.connection?.pairingOpen === true;
    const shown = Math.max(0, secondsLeft);
    if (failure)
      return (
        <SetupPage
          pageKey="search-failed"
          direction={direction}
          progress={step(2)}
          onBack={() => back('PREPARE')}
          centered
          eyebrow={t('sensorSetup.searchEnded')}
          title={
            failure.reason === 'REJECTED'
              ? t('sensorSetup.pairingRejected')
              : failure.reason === 'CANCELLED'
                ? t('sensorSetup.searchStopped')
                : failure.reason === 'UNSUPPORTED'
                  ? t('sensorSetup.unsupportedTitle')
                  : t('sensorSetup.noSensorFound')
          }
          subtitle={
            failure.reason === 'REJECTED'
              ? (failure.message ?? t('sensorSetup.pairingRejectedText'))
              : failure.reason === 'CANCELLED'
                ? t('sensorSetup.searchStoppedText')
                : failure.reason === 'UNSUPPORTED'
                  ? t('sensorSetup.unsupportedText')
                  : t('sensorSetup.noDeviceFoundYouCan')
          }
          hero={
            <span className="ss-hero-icon is-warning">
              <RadioTower aria-hidden />
            </span>
          }
          footer={
            <button
              type="button"
              className="ss-primary"
              disabled={busy}
              onClick={() => void start()}
            >
              {busy ? (
                <LoaderCircle className="ss-spinner" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {t('sensorSetup.retrySearch')}
            </button>
          }
        >
          <SetupSection title={t('sensorSetup.troubleshootingTitle')}>
            <ol className="ss-steps is-compact">
              {textBlock('sensorSetup.troubleshooting').map((line, index) => (
                <li key={line}>
                  <span>{index + 1}</span>
                  <p>{line}</p>
                </li>
              ))}
            </ol>
          </SetupSection>
          {error && <SetupNotice tone="danger">{error}</SetupNotice>}
        </SetupPage>
      );
    // The hub listens for four minutes; a resumed search may have a little more left.
    const total = Math.max(SENSOR_SEARCH_SECONDS, shown);
    return (
      <SetupPage
        pageKey="search"
        direction={direction}
        progress={step(2)}
        onBack={() => void stopSearch()}
        backLabel={t('sensorSetup.cancel')}
        centered
        eyebrow={
          detected ? t('sensorSetup.sensorDetected') : t('sensorSetup.searchingAroundTheHub')
        }
        title={
          detected ? t('sensorSetup.pairingInProgress') : t('sensorSetup.waitingForYourSensor')
        }
        subtitle={
          detected
            ? t('sensorSetup.eliseFoundYourSensorAnd')
            : t('sensorSetup.keepTheSensorInPairing')
        }
        hero={
          <div className={`ss-radar ${detected ? 'is-detected' : ''}`} aria-hidden>
            <span className="ss-radar-wave" />
            <span className="ss-radar-wave" />
            <span className="ss-radar-wave" />
            <svg className="ss-radar-ring" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="56" />
              <circle
                cx="60"
                cy="60"
                r="56"
                className="is-value"
                style={{ strokeDashoffset: 352 * (1 - Math.min(1, shown / total)) }}
              />
            </svg>
            <span className="ss-radar-core">
              {product ? <ProductPhoto product={product} /> : <Radio />}
            </span>
          </div>
        }
        footer={
          <button
            type="button"
            className="ss-secondary"
            disabled={busy}
            onClick={() => void stopSearch()}
          >
            {t('sensorSetup.stopSearch')}
          </button>
        }
      >
        <strong className="ss-countdown" role="timer" aria-live="off">
          {t('sensorSetup.timeLeft', { time: formatSearchCountdown(shown) })}
        </strong>
        <ol className="ss-checklist" aria-label={t('sensorSetup.searchProgress')}>
          <CheckItem state="done">{t('sensorSetup.check.started')}</CheckItem>
          <CheckItem state={listening || detected ? 'done' : 'active'}>
            {t('sensorSetup.check.listening')}
          </CheckItem>
          <CheckItem state={detected ? 'done' : listening ? 'active' : 'waiting'}>
            {t('sensorSetup.check.spotted')}
          </CheckItem>
          <CheckItem state={detected ? 'active' : 'waiting'}>
            {t('sensorSetup.check.configuring')}
          </CheckItem>
        </ol>
        <span className="sr-only" role="status" aria-label={t('sensorSetup.searchStatus')}>
          {detected ? t('sensorSetup.sensorDetected') : t('sensorSetup.searchingAroundTheHub')}
        </span>
        {offline && (
          <SetupNotice tone="warning" title={t('sensorSetup.offlineTitle')}>
            {t('sensorSetup.offlineText')}
          </SetupNotice>
        )}
        {session?.connection?.online === false && (
          <SetupNotice tone="warning" title={t('sensorSetup.hubOfflineTitle')}>
            {t('sensorSetup.hubOfflineText')}
          </SetupNotice>
        )}
      </SetupPage>
    );
  }

  // PREPARE
  const preparation = product
    ? productTexts(product).preparation
    : textBlock('sensorSetup.genericPreparation');
  return (
    <SetupPage
      pageKey="prepare"
      direction={direction}
      progress={step(1)}
      onBack={onBack}
      backLabel={backLabel}
      eyebrow={product ? `${product.brand} · ${productName}` : t('sensorSetup.preparation')}
      title={t('sensorSetup.prepareYourSensor')}
      subtitle={t('sensorSetup.eliseFindsTheRightConnection')}
      hero={
        product ? (
          <div className="ss-product-hero ss-prepare-photo">
            <ProductPhoto product={product} />
          </div>
        ) : (
          <span className="ss-hero-icon">
            <RadioTower aria-hidden />
          </span>
        )
      }
      footer={
        <button type="button" className="ss-primary" disabled={busy} onClick={() => void start()}>
          {busy ? <LoaderCircle className="ss-spinner" aria-hidden /> : <Radio aria-hidden />}
          {busy ? t('sensorSetup.starting') : t('sensorSetup.findMySensor')}
        </button>
      }
    >
      <ol className="ss-steps">
        {preparation.map((line, index) => (
          <li key={line}>
            <span>{index + 1}</span>
            <p>{line}</p>
          </li>
        ))}
      </ol>
      <SetupNotice>{t('sensorSetup.stayClose')}</SetupNotice>
      {error && <SetupNotice tone="danger">{error}</SetupNotice>}
    </SetupPage>
  );
}

function CheckItem({
  state,
  children,
}: {
  state: 'done' | 'active' | 'waiting';
  children: ReactNode;
}) {
  return (
    <li className={`is-${state}`}>
      <span aria-hidden>
        {state === 'done' ? <Check /> : state === 'active' ? <LoaderCircle /> : null}
      </span>
      {children}
    </li>
  );
}

function DevicePicture({ device }: { device: SensorUiDevice | null | undefined }) {
  const photo = device ? sensorDevicePhoto(device) : null;
  return photo ? <img src={photo} alt="" /> : <Radio aria-hidden />;
}

export function BedContactChoice({
  value,
  onChange,
}: {
  value: 'CLOSED' | 'OPEN';
  onChange: (value: 'CLOSED' | 'OPEN') => void;
}) {
  return (
    <div className="ss-field">
      <span className="ss-field-label">{t('sensorSetup.whenTheBedIsOccupied')}</span>
      <SetupSegmented
        label={t('sensorSetup.whenTheBedIsOccupied')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'CLOSED', label: t('sensorSetup.theContactIsClosed') },
          { value: 'OPEN', label: t('sensorSetup.theContactIsOpen') },
        ]}
      />
    </div>
  );
}

/** Last page of every sensor setup: what was done and what comes next. */
export function SensorInstalledPage({
  direction,
  progress,
  name,
  room,
  photo,
  tip,
  onDone,
  onAddAnother,
}: {
  direction: 'forward' | 'back';
  progress: number;
  name: string;
  room: string;
  photo: ReactNode;
  tip?: string | undefined;
  onDone: () => void;
  onAddAnother?: (() => void) | undefined;
}) {
  return (
    <SetupPage
      pageKey="done"
      direction={direction}
      progress={{ value: progress, total: progress, label: t('sensorSetup.done') }}
      centered
      eyebrow={t('sensorSetup.allSet')}
      title={t('sensorSetup.sensorInstalled')}
      subtitle={t('sensorSetup.sensorInstalledText', { name, room })}
      hero={
        <div className="ss-done-hero">
          <span className="ss-done-photo">{photo}</span>
          <span className="ss-done-check" aria-hidden>
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27l7 7 15-16" />
            </svg>
          </span>
        </div>
      }
      footer={
        <>
          {onAddAnother && (
            <button type="button" className="ss-secondary" onClick={onAddAnother}>
              {t('sensorSetup.addAnother')}
            </button>
          )}
          <button type="button" className="ss-primary" onClick={onDone}>
            {t('sensorSetup.finish')}
          </button>
        </>
      }
    >
      {tip && (
        <SetupList>
          <SetupRow
            icon={<MapPin aria-hidden />}
            title={t('sensorSetup.nextPlaceIt')}
            detail={tip}
          />
        </SetupList>
      )}
    </SetupPage>
  );
}

/** Aborts with the flow or after `ms`; AbortSignal.any is missing on older iPads. */
function withTimeout(parent: AbortSignal, ms: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = window.setTimeout(abort, ms);
  parent.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', () => window.clearTimeout(timer), { once: true });
  return controller.signal;
}

const errorTexts: Record<SensorErrorCode, () => string> = {
  NO_PAIRING_MODULE: () => t('sensorSetup.errors.noPairingModule'),
  ADMIN_REQUIRED: () => t('sensorSetup.errors.adminRequired'),
  ACCESS_DENIED: () => t('sensorSetup.errors.accessDenied'),
  NO_SENSOR_TO_INSTALL: () => t('sensorSetup.errors.noSensorToInstall'),
  ALREADY_COMPLETED: () => t('sensorSetup.errors.alreadyCompleted'),
};

export const friendlyError = (err: unknown) => {
  const error = err as Error;
  if (error instanceof SensorRequestError && error.code) return errorTexts[error.code]();
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
    return t('sensorSetup.eliseDidNotAnswer');
  if (error instanceof TypeError) return t('sensorSetup.eliseUnreachable');
  return error?.message || t('sensorSetup.eliseUnreachable');
};

/** Sensor setup on its own: used by the room and stair pages. */
export function SensorOnboardingDialog({
  open,
  rooms,
  initialRoomId,
  initialTarget,
  contactRole,
  bedOccupiedWhen,
  category,
  product,
  onClose,
  onInstalled,
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
}) {
  if (!open) return null;
  return (
    <SetupSheet onClose={onClose}>
      <SensorPairingFlow
        rooms={rooms}
        initialRoomId={initialRoomId}
        initialTarget={initialTarget}
        contactRole={contactRole}
        bedOccupiedWhen={bedOccupiedWhen}
        category={category}
        product={product}
        onClose={onClose}
        onInstalled={onInstalled}
      />
    </SetupSheet>
  );
}
