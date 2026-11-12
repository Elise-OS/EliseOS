import {
  CONTACT_TYPES,
  SENSOR_SEARCH_SECONDS,
  deviceLooksUnsupported,
  deviceSupportsCategory,
  formatSearchCountdown,
  isBedOccupancySensorModel,
  pairingIntentApplies,
  pairingNameSuggestions,
  pendingDeviceCount,
  pairingProblems,
  productMatchesDetectedModel,
  sensorDevicePhoto,
  type ContactRole,
  type RoomSensorCategory,
  type SensorProduct,
} from '@elise/contracts';
import {
  AppWindow,
  Check,
  DoorClosed,
  DoorOpen,
  Ellipsis,
  MapPin,
  Radio,
  RadioTower,
  Refrigerator,
  RefreshCw,
  Sun,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { t, textBlock } from '../i18n';
import { pairingErrorText } from './errors';
import { sensorImage } from './images';
import { PairingController, type PairingApi } from './pairing';
import { classifyPairingError, isApiAnswer } from './pairingApi';
import { contactTypeLabel, productTexts, sensorCategoryLabel } from './texts';
import {
  ChecklistItem,
  FoundHero,
  HeroIcon,
  NumberedSteps,
  PrimaryButton,
  ProductHero,
  ProductPhoto,
  Radar,
  SecondaryButton,
  SensorPicture,
  SetupChoices,
  SetupList,
  SetupNotice,
  SetupPage,
  SetupRow,
  SetupSection,
  SetupSegmented,
  SetupField,
  Suggestions,
  Tag,
  ss,
  useSheetControls,
} from './ui';

export type SensorRoom = { id: string; name: string; kind: string; floor?: number };
export type PairingProgress = { offset: number; total: number };

const contactIcons: Record<ContactRole, ReactNode> = {
  DOOR: <DoorClosed size={20} color={ss.ink} />,
  MAIN_ENTRANCE: <DoorOpen size={20} color={ss.ink} />,
  WINDOW: <AppWindow size={20} color={ss.ink} />,
  VERANDA: <Sun size={20} color={ss.ink} />,
  FRIDGE: <Refrigerator size={20} color={ss.ink} />,
  OTHER: <Ellipsis size={20} color={ss.ink} />,
  BED: <Ellipsis size={20} color={ss.ink} />,
};

export function BedContactChoice({
  value,
  onChange,
}: {
  value: 'CLOSED' | 'OPEN';
  onChange: (value: 'CLOSED' | 'OPEN') => void;
}) {
  return (
    <SetupSection title={t('sensorSetup.whenTheBedIsOccupied')}>
      <SetupSegmented
        label={t('sensorSetup.whenTheBedIsOccupied')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'CLOSED', label: t('sensorSetup.theContactIsClosed') },
          { value: 'OPEN', label: t('sensorSetup.theContactIsOpen') },
        ]}
      />
    </SetupSection>
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
      hero={<FoundHero>{photo}</FoundHero>}
      footer={
        <>
          <PrimaryButton label={t('sensorSetup.finish')} onPress={onDone} testID="sensor-finish" />
          {onAddAnother ? (
            <SecondaryButton label={t('sensorSetup.addAnother')} onPress={onAddAnother} />
          ) : null}
        </>
      }
    >
      {tip ? (
        <SetupList>
          <SetupRow
            first
            icon={<MapPin size={19} color={ss.accent} />}
            title={t('sensorSetup.nextPlaceIt')}
            detail={tip}
          />
        </SetupList>
      ) : null}
    </SetupPage>
  );
}

/**
 * Pairing part of the sensor setup: prepare the sensor, let the hub find it, then
 * name it and place it. Same steps and texts as the web dashboard.
 */
export function SensorPairingFlow({
  api,
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
  api: PairingApi;
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
  onInstalled: () => Promise<void> | void;
  onAddAnother?: (() => void) | undefined;
}) {
  const controller = useMemo(
    () => new PairingController({ api, classifyError: classifyPairingError, isApiAnswer }),
    // One search per mounted flow; the API object is rebuilt at every render of the parent.
    [],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [name, setName] = useState('');
  const [openingType, setOpeningType] = useState<ContactRole | ''>(contactRole ?? '');
  const [occupiedWhen, setOccupiedWhen] = useState<'CLOSED' | 'OPEN'>(bedOccupiedWhen);
  const refresh = useRef(onInstalled);
  refresh.current = onInstalled;
  const [moved, setMoved] = useState<'forward' | 'back'>('forward');

  useEffect(() => {
    void controller.init();
    // The screen can disappear without a clean close (app swiped away): stop the search.
    return () => controller.abandon();
  }, [controller]);

  // Timers sleep while the app is in the background: look again as soon as it is back.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') controller.poke();
    });
    return () => subscription.remove();
  }, [controller]);

  const device = state.session?.detectedDevice ?? null;
  const sessionId = state.session?.id;
  const pending = pendingDeviceCount(state.session);
  // A search may find several devices: what the person chose goes to the one that fits it,
  // the others are named and placed as plain sensors.
  const intent =
    !device ||
    pairingIntentApplies(device, {
      category: categoryChoice,
      targetType: initialTarget?.type,
      product: productChoice,
      severalDevices: pending > 0 || state.queue.installed > 0,
      intentUsed: state.queue.intentUsed,
    });
  const category = intent ? categoryChoice : undefined;
  const product = intent ? productChoice : undefined;
  const target = intent ? initialTarget : undefined;
  useEffect(() => {
    if (state.phase !== 'FOUND' || !device) return;
    setName(product ? productTexts(product).name : device.name);
    if (category === 'bed' && isBedOccupancySensorModel(device.model)) setOccupiedWhen('OPEN');
    if (state.queue.installed > 0) setOpeningType(intent ? (contactRole ?? '') : '');
    // One default name per detected sensor, not per refresh of the session.
  }, [state.phase, sessionId]);

  const busy = state.busy;
  useSheetControls({
    busy,
    onClose: () => {
      void controller.close().then((closed) => {
        if (closed) onClose();
      });
    },
  });

  const room = rooms.find(({ id }) => id === roomId);
  const isContact = !!device && deviceSupportsCategory(device, 'contact') && category !== 'bed';
  const { mismatch, wrongTarget } = device
    ? pairingProblems(device, { category, targetType: target?.type })
    : { mismatch: false, wrongTarget: false };
  const unsupported = !!device && deviceLooksUnsupported(device);
  const canFinish =
    !!device &&
    !unsupported &&
    !!name.trim() &&
    !!room &&
    !mismatch &&
    !wrongTarget &&
    !(isContact && !openingType);

  const finish = () => {
    if (!device || !canFinish) return;
    void controller
      .finish(
        {
          name: name.trim(),
          roomId,
          ...(category ? { category } : {}),
          target: target ?? null,
          ...(openingType ? { contactRole: openingType } : {}),
          ...(category === 'bed' ? { bedOccupiedWhen: occupiedWhen } : {}),
          buttonRole: 'ASSISTANCE',
        },
        room?.name ?? '',
        intent,
      )
      .then(() => {
        if (controller.getState().phase === 'DONE') void Promise.resolve(refresh.current());
      });
  };

  const step = (value: number) => ({ value: progress.offset + value, total: progress.total });
  const productName = product ? productTexts(product).name : undefined;
  const errorBox = state.error ? (
    <SetupNotice tone="danger">{pairingErrorText(state.error)}</SetupNotice>
  ) : null;

  if (state.phase === 'LOADING')
    return (
      <SetupPage
        pageKey="loading"
        progress={step(1)}
        centered
        title={t('sensorSetup.preparing')}
        hero={<ActivityIndicator size="large" color={ss.accent} />}
      />
    );

  if (state.phase === 'DONE' && state.installed)
    return (
      <SensorInstalledPage
        direction={moved}
        progress={progress.total}
        name={state.installed.name}
        room={state.installed.room}
        photo={
          product ? (
            <ProductPhoto product={product} size={84} />
          ) : (
            <DevicePicture device={device} size={84} />
          )
        }
        tip={product ? productTexts(product).placement[0] : undefined}
        onDone={onClose}
        onAddAnother={onAddAnother}
      />
    );

  if (state.phase === 'FOUND' && device) {
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
        direction={moved}
        progress={step(3)}
        eyebrow={t('sensorSetup.connectionSuccessful')}
        title={t('sensorSetup.yourSensorIsReady')}
        subtitle={[device.manufacturer, device.model].filter(Boolean).join(' · ') || device.name}
        centered
        hero={
          <FoundHero>
            {product ? (
              <ProductPhoto product={product} size={84} />
            ) : (
              <DevicePicture device={device} size={84} />
            )}
          </FoundHero>
        }
        footer={
          <>
            <PrimaryButton
              label={
                busy
                  ? t('sensorSetup.installing')
                  : room
                    ? t('sensorSetup.installIn', { name: room.name })
                    : t('sensorSetup.chooseARoom')
              }
              icon={<Check size={20} color="#fff" strokeWidth={3} />}
              busy={busy}
              disabled={!canFinish}
              onPress={finish}
            />
            {state.error ? (
              <SecondaryButton
                label={t('sensorSetup.retrySearch')}
                disabled={busy}
                icon={<RefreshCw size={18} color={ss.ink} />}
                onPress={() =>
                  void controller.start(productChoice?.protocol ?? 'zigbee', productChoice?.model)
                }
              />
            ) : null}
          </>
        }
      >
        {features.length > 0 ? (
          <View
            style={styles.tags}
            accessible
            accessibilityLabel={`${t('sensorSetup.detectedFeatures')}: ${features
              .map(({ label }) => label)
              .join(', ')}`}
          >
            {features.map((feature) => (
              <Tag
                key={feature.sensorId}
                icon={<Check size={14} color={ss.ink2} strokeWidth={2.6} />}
              >
                {feature.label}
              </Tag>
            ))}
          </View>
        ) : null}
        {state.queue.previous || pending > 0 ? (
          <SetupNotice>
            {[
              state.queue.previous
                ? t('sensorSetup.queue.previousInstalled', state.queue.previous)
                : '',
              pending > 0 ? t('sensorSetup.queue.remaining', { count: pending }) : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </SetupNotice>
        ) : null}
        {unsupported ? (
          <SetupNotice tone="danger" title={t('sensorSetup.unsupportedTitle')}>
            {t('sensorSetup.unsupportedText')}
          </SetupNotice>
        ) : null}
        {device.room ? (
          <SetupNotice tone="warning">
            {device.room.id === roomId
              ? t('sensorSetup.alreadyInstalledHere')
              : t('sensorSetup.alreadyInstalledElsewhere', { name: device.room.name })}
          </SetupNotice>
        ) : null}
        {mismatch ? (
          <SetupNotice tone="danger">
            {t('sensorSetup.thisDeviceDoesNotProvide', {
              categoryLabel: category ? sensorCategoryLabel(category) : '',
            })}
          </SetupNotice>
        ) : null}
        {!mismatch && wrongTarget ? (
          <SetupNotice tone="danger">{t('sensorSetup.wrongTarget')}</SetupNotice>
        ) : null}
        {modelMatch === false ? (
          <SetupNotice tone="warning">
            {t('sensorSetup.differentModelDetectedYouSelected', {
              model: product?.model,
              model2: device.model,
            })}
          </SetupNotice>
        ) : null}
        {modelMatch === null && product ? (
          <SetupNotice tone="warning">
            {t('sensorSetup.eliseCouldNotConfirmModel', { model: product.model })}
          </SetupNotice>
        ) : null}

        <SetupSection title={t('sensorSetup.finishInstallation')}>
          <View style={styles.form}>
            {intent && initialRoomId && room ? (
              <SetupList>
                <SetupRow
                  first
                  icon={<MapPin size={19} color={ss.accent} />}
                  title={room.name}
                  detail={t('sensorSetup.room')}
                  trailing={<Check size={20} color={ss.success} strokeWidth={2.6} />}
                />
              </SetupList>
            ) : (
              <SetupChoices
                label={t('sensorSetup.whichRoom')}
                value={roomId}
                onChange={setRoomId}
                options={[...rooms]
                  .sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0))
                  .map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              />
            )}
            <SetupField
              label={t('sensorSetup.sensorName')}
              value={name}
              onChange={setName}
              maxLength={120}
            />
            {suggestions.length > 1 ? (
              <Suggestions
                label={t('sensorSetup.nameSuggestions')}
                values={suggestions}
                selected={name.trim()}
                onPick={setName}
              />
            ) : null}
            {isContact ? (
              <SetupSection title={t('sensorSetup.whatDoesThisOpeningMonitor')}>
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
              </SetupSection>
            ) : null}
            {category === 'bed' ? (
              <>
                <SetupNotice>
                  {isBedOccupancySensorModel(device.model)
                    ? t('sensorSetup.theTuyaPressureStripDetects')
                    : t('sensorSetup.connectTheSdc41')}
                </SetupNotice>
                {!isBedOccupancySensorModel(device.model) ? (
                  <BedContactChoice value={occupiedWhen} onChange={setOccupiedWhen} />
                ) : null}
              </>
            ) : null}
          </View>
        </SetupSection>
        {errorBox}
      </SetupPage>
    );
  }

  if (state.phase === 'SEARCH') {
    const detected = state.session?.connection?.deviceDetected === true;
    const listening = state.session?.connection?.pairingOpen === true;
    const shown = Math.max(0, state.secondsLeft);
    const { failure } = state;
    if (failure)
      return (
        <SetupPage
          pageKey="search-failed"
          direction={moved}
          progress={step(2)}
          onBack={() => {
            setMoved('back');
            void controller.stopSearch();
          }}
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
            <HeroIcon warning>
              <RadioTower size={40} color={ss.warning} />
            </HeroIcon>
          }
          footer={
            <PrimaryButton
              label={t('sensorSetup.retrySearch')}
              busy={busy}
              icon={<RefreshCw size={20} color="#fff" />}
              onPress={() =>
                void controller.start(productChoice?.protocol ?? 'zigbee', productChoice?.model)
              }
            />
          }
        >
          <SetupSection title={t('sensorSetup.troubleshootingTitle')}>
            <NumberedSteps compact lines={textBlock('sensorSetup.troubleshooting')} />
          </SetupSection>
          {errorBox}
        </SetupPage>
      );
    // The hub listens for four minutes; a resumed search may have a little more left.
    const total = Math.max(SENSOR_SEARCH_SECONDS, shown);
    return (
      <SetupPage
        pageKey="search"
        direction={moved}
        progress={step(2)}
        onBack={() => {
          setMoved('back');
          void controller.stopSearch();
        }}
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
          <Radar detected={detected} ratio={shown / total}>
            {product ? (
              <ProductPhoto product={product} size={78} />
            ) : (
              <Radio size={40} color={ss.accent} />
            )}
          </Radar>
        }
        footer={
          <SecondaryButton
            label={t('sensorSetup.stopSearch')}
            disabled={busy}
            onPress={() => {
              setMoved('back');
              void controller.stopSearch();
            }}
          />
        }
      >
        <Text
          style={styles.countdown}
          accessibilityRole="timer"
          accessibilityLabel={t('sensorSetup.timeLeft', { time: formatSearchCountdown(shown) })}
        >
          {t('sensorSetup.timeLeft', { time: formatSearchCountdown(shown) })}
        </Text>
        <View style={styles.checklist} accessibilityLabel={t('sensorSetup.searchProgress')}>
          <ChecklistItem state="done">{t('sensorSetup.check.started')}</ChecklistItem>
          <ChecklistItem state={listening || detected ? 'done' : 'active'}>
            {t('sensorSetup.check.listening')}
          </ChecklistItem>
          <ChecklistItem state={detected ? 'done' : listening ? 'active' : 'waiting'}>
            {t('sensorSetup.check.spotted')}
          </ChecklistItem>
          <ChecklistItem state={detected ? 'active' : 'waiting'}>
            {t('sensorSetup.check.configuring')}
          </ChecklistItem>
        </View>
        {state.offline ? (
          <SetupNotice tone="warning" title={t('sensorSetup.offlineTitle')}>
            {t('sensorSetup.offlineText')}
          </SetupNotice>
        ) : null}
        {state.session?.connection?.online === false ? (
          <SetupNotice tone="warning" title={t('sensorSetup.hubOfflineTitle')}>
            {t('sensorSetup.hubOfflineText')}
          </SetupNotice>
        ) : null}
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
      direction={moved}
      progress={step(1)}
      onBack={
        onBack
          ? () => {
              void controller.close().then(() => {
                setMoved('back');
                onBack();
              });
            }
          : undefined
      }
      backLabel={backLabel}
      eyebrow={product ? `${product.brand} · ${productName}` : t('sensorSetup.preparation')}
      title={t('sensorSetup.prepareYourSensor')}
      subtitle={t('sensorSetup.eliseFindsTheRightConnection')}
      hero={
        product ? (
          <ProductHero>
            <ProductPhoto product={product} size={170} />
          </ProductHero>
        ) : (
          <HeroIcon>
            <RadioTower size={40} color={ss.accent} />
          </HeroIcon>
        )
      }
      footer={
        <PrimaryButton
          label={busy ? t('sensorSetup.starting') : t('sensorSetup.findMySensor')}
          busy={busy}
          icon={<Radio size={20} color="#fff" />}
          onPress={() => {
            setMoved('forward');
            void controller.start(productChoice?.protocol ?? 'zigbee', productChoice?.model);
          }}
        />
      }
    >
      <NumberedSteps lines={preparation} />
      <SetupNotice>{t('sensorSetup.stayClose')}</SetupNotice>
      {errorBox}
    </SetupPage>
  );
}

function DevicePicture({
  device,
  size,
}: {
  device:
    | {
        manufacturer: string | null;
        model: string | null;
        capabilities: Array<{ capability: string }>;
      }
    | null
    | undefined;
  size: number;
}) {
  const path = device ? sensorDevicePhoto(device) : null;
  return <SensorPicture source={sensorImage(path)} size={size} />;
}

export { DevicePicture };

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  form: { gap: 14 },
  countdown: {
    color: ss.ink2,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    fontWeight: '600',
  },
  checklist: {
    alignSelf: 'stretch',
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: ss.fill,
  },
});
