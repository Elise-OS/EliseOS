import type { CameraNetworkDevice } from '@elise/contracts';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  LoaderCircle,
  Wifi,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Locale, t, textBlock } from './i18n';
import { sensorJson, sensorRequest } from './sensor-ui';

type RoomCamera = {
  id: string;
  name: string;
  status: string;
  room: { id: string; name: string; kind: string } | null;
};

type CameraNetworkOnboardingProps = {
  locale: Locale;
  roomId: string;
  roomName: string;
  cameras: RoomCamera[];
  onAdded: () => void | Promise<void>;
};

type Step = 1 | 2 | 3;

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && /Connexion impossible \((502|503|504)\)/.test(cause.message))
    return t('cameraNetworkOnboarding.theEliseServerIsTemporarily');
  if (cause instanceof TypeError) return t('cameraNetworkOnboarding.theConnectionToYourHome');
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function CameraNetworkOnboarding({
  roomId,
  roomName,
  cameras,
  onAdded,
}: CameraNetworkOnboardingProps) {
  const steps = [
    t('cameraNetworkOnboarding.steps.search'),
    t('cameraNetworkOnboarding.steps.connect'),
    t('cameraNetworkOnboarding.steps.add'),
  ];
  const activeDiscovery = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [devices, setDevices] = useState<CameraNetworkDevice[]>([]);
  const [selected, setSelected] = useState<CameraNetworkDevice | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [name, setName] = useState(t('cameraNetworkOnboarding.camera', { roomName }));
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [consented, setConsented] = useState(false);

  useEffect(
    () => () => {
      activeDiscovery.current?.abort();
      activeDiscovery.current = null;
    },
    [],
  );

  const discover = async () => {
    if (activeDiscovery.current) return;
    const controller = new AbortController();
    activeDiscovery.current = controller;
    setScanning(true);
    setSearched(false);
    setError('');
    setSelected(null);
    setDevices([]);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 25_000);
    try {
      const found = await sensorRequest<CameraNetworkDevice[]>(
        '/api/v1/cameras/network-discovery',
        { method: 'POST', signal: controller.signal },
      );
      if (activeDiscovery.current !== controller) return;
      setDevices(found);
      setSearched(true);
      if (found.length > 0) {
        setSelected(found.length === 1 ? found[0]! : null);
        setStep(2);
      }
    } catch (cause) {
      if (activeDiscovery.current !== controller) return;
      setError(
        timedOut
          ? t('cameraNetworkOnboarding.theSearchIsTakingToo')
          : errorMessage(cause, t('cameraNetworkOnboarding.theNetworkSearchFailed')),
      );
    } finally {
      window.clearTimeout(timeout);
      if (activeDiscovery.current === controller) {
        activeDiscovery.current = null;
        setScanning(false);
      }
    }
  };

  const addCamera = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await sensorRequest('/api/v1/cameras/network', {
        ...sensorJson('POST', {
          name: name.trim(),
          roomId,
          address: selected.address,
          rtspPort: selected.rtspPort,
          username,
          password,
          intimateSpaceConsent: consented,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      setComplete(true);
      setUsername('');
      setPassword('');
      void Promise.resolve(onAdded()).catch(() => undefined);
    } catch (cause) {
      setError(errorMessage(cause, t('cameraNetworkOnboarding.theCameraCouldNotBe')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="equipment-onboarding camera-network-onboarding"
      aria-label={t('cameraNetworkOnboarding.addANetworkCamera')}
      aria-busy={scanning || saving}
    >
      <ol className="equipment-steps">
        {steps.map((label, index) => {
          const number = (index + 1) as Step;
          return (
            <li
              className={number === step ? 'is-current' : number < step ? 'is-complete' : undefined}
              aria-current={number === step ? 'step' : undefined}
              key={label}
            >
              <span>{number < step ? <Check aria-hidden="true" /> : number}</span>
              <div>
                <small>{t('cameraNetworkOnboarding.stepOf3', { number })}</small>
                <strong>{label}</strong>
              </div>
            </li>
          );
        })}
      </ol>

      {cameras.length > 0 && (
        <p className="camera-network-existing equipment-muted">
          {t('cameraNetworkOnboarding.alreadyInThisRoom')}
          {cameras.map(({ name: cameraName }) => cameraName).join(', ')}
        </p>
      )}

      {step === 1 && (
        <>
          <div className="equipment-onboarding-intro">
            <Wifi aria-hidden="true" />
            <h3>{t('cameraNetworkOnboarding.findACameraOnThe')}</h3>
            <p>{t('cameraNetworkOnboarding.eliseLooksForCamerasAvailable')}</p>
          </div>
          <ol className="equipment-guide-steps">
            {textBlock('cameraNetworkOnboarding.requirements').map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <button
            className="equipment-primary equipment-search-button"
            disabled={scanning}
            onClick={() => void discover()}
          >
            {scanning ? (
              <LoaderCircle className="is-spinning" aria-hidden="true" />
            ) : (
              <Wifi aria-hidden="true" />
            )}
            {scanning
              ? t('cameraNetworkOnboarding.searching')
              : searched
                ? t('cameraNetworkOnboarding.searchAgain')
                : t('cameraNetworkOnboarding.searchMyNetwork')}
          </button>

          {scanning && (
            <p className="camera-network-status" role="status" aria-live="polite">
              <LoaderCircle className="is-spinning" aria-hidden="true" />
              {t('cameraNetworkOnboarding.eliseIsScanningTheLocal')}
            </p>
          )}

          {searched && devices.length === 0 && !scanning && (
            <div className="camera-network-empty" role="status">
              <Camera aria-hidden="true" />
              <div>
                <strong>{t('cameraNetworkOnboarding.noCameraFound')}</strong>
                <p>{t('cameraNetworkOnboarding.checkThatTheCameraIs')}</p>
              </div>
            </div>
          )}
        </>
      )}

      {step === 2 && devices.length > 0 && (
        <section className="equipment-install-step">
          <section
            className="camera-network-results"
            aria-labelledby="camera-network-results-title"
          >
            <h4 id="camera-network-results-title">
              {t('cameraNetworkOnboarding.camerasFound', { count: devices.length })}
            </h4>
            {devices.length > 1 && (
              <p className="equipment-muted">
                {t('cameraNetworkOnboarding.selectTheCameraInstalledIn')}
              </p>
            )}
            <div className="camera-network-result-list" role="list">
              {devices.map((device) => {
                const isSelected =
                  selected?.address === device.address && selected.rtspPort === device.rtspPort;
                return (
                  <button
                    type="button"
                    className={`camera-network-result${isSelected ? ' is-selected' : ''}`}
                    key={`${device.address}:${device.rtspPort}`}
                    role="listitem"
                    aria-pressed={isSelected}
                    onClick={() => setSelected(device)}
                  >
                    <span className="camera-network-result-icon">
                      <Camera aria-hidden="true" />
                    </span>
                    <span className="camera-network-result-copy">
                      <strong>{t('cameraNetworkOnboarding.cameraDetected')}</strong>
                      <small>
                        {device.address} · RTSP · {t('cameraNetworkOnboarding.port')}{' '}
                        {device.rtspPort}
                        {device.authenticationRequired
                          ? t('cameraNetworkOnboarding.protected')
                          : ''}
                      </small>
                    </span>
                    {isSelected && <CheckCircle2 aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </section>

          {selected ? (
            <form
              className="equipment-install-form camera-network-install-form"
              onSubmit={(event) => {
                event.preventDefault();
                setError('');
                setStep(3);
                void addCamera();
              }}
            >
              <div className="equipment-install-form-heading">
                <Camera aria-hidden="true" />
                <div>
                  <h4>{t('cameraNetworkOnboarding.localConnection')}</h4>
                  <p>
                    {selected.authenticationRequired
                      ? t('cameraNetworkOnboarding.theLocalStreamRequiresA')
                      : t('cameraNetworkOnboarding.eliseWillFirstTryTo')}
                  </p>
                </div>
              </div>
              <label className="equipment-field">
                {t('cameraNetworkOnboarding.cameraName')}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={120}
                />
              </label>
              <p className="equipment-install-warning">
                {t('cameraNetworkOnboarding.enterTheCameraSLocal')}
              </p>
              <div className="camera-network-credentials">
                <label className="equipment-field">
                  {t('cameraNetworkOnboarding.localUsername')}
                  <input
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required={selected.authenticationRequired}
                    maxLength={128}
                  />
                </label>
                <label className="equipment-field">
                  {t('cameraNetworkOnboarding.cameraPassword')}
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required={selected.authenticationRequired}
                    maxLength={256}
                  />
                </label>
              </div>
              <label className="camera-network-consent">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                  required
                />
                <span>{t('cameraNetworkOnboarding.iConfirmThatIAm')}</span>
              </label>
              <footer className="equipment-dialog-footer camera-network-form-footer">
                <button
                  type="button"
                  className="equipment-secondary"
                  onClick={() => {
                    setError('');
                    setStep(1);
                  }}
                >
                  <ArrowLeft aria-hidden="true" /> {t('cameraNetworkOnboarding.back')}
                </button>
                <button
                  className="equipment-primary"
                  type="submit"
                  disabled={
                    !name.trim() || (selected.authenticationRequired && !password) || !consented
                  }
                >
                  {t('cameraNetworkOnboarding.detectStreamAndAdd')}
                  <ArrowRight aria-hidden="true" />
                </button>
              </footer>
            </form>
          ) : (
            <footer className="equipment-dialog-footer">
              <button
                type="button"
                className="equipment-secondary"
                onClick={() => {
                  setError('');
                  setStep(1);
                }}
              >
                <ArrowLeft aria-hidden="true" /> {t('cameraNetworkOnboarding.back')}
              </button>
            </footer>
          )}
        </section>
      )}

      {step === 3 && selected && (
        <section className="equipment-install-step">
          {complete ? (
            <div className="equipment-found" role="status">
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>{t('cameraNetworkOnboarding.cameraAdded')}</strong>
                <br />
                {t('cameraNetworkOnboarding.isAssignedToItsLive', { name, roomName })}
              </span>
            </div>
          ) : (
            <>
              <div className="equipment-found-hero" role="status" aria-live="polite">
                {saving ? (
                  <LoaderCircle className="is-spinning" aria-hidden="true" />
                ) : (
                  <Camera aria-hidden="true" />
                )}
                <div>
                  <h3>
                    {saving
                      ? t('cameraNetworkOnboarding.checkingTheVideoStream')
                      : t('cameraNetworkOnboarding.checkTheVideoStream')}
                  </h3>
                  <p>
                    {saving
                      ? t('cameraNetworkOnboarding.eliseIsFindingAStream')
                      : t('cameraNetworkOnboarding.theCredentialsAndStreamWill')}
                  </p>
                </div>
              </div>
              <div className="equipment-room-choice">
                <Camera aria-hidden="true" />
                <span>
                  <strong>{name}</strong>
                  <br />
                  {roomName} · {selected.address}
                </span>
                <CheckCircle2 aria-hidden="true" />
              </div>
              {error && (
                <p className="equipment-error" role="alert">
                  {error}
                </p>
              )}
              <footer className="equipment-dialog-footer camera-network-form-footer">
                <button
                  type="button"
                  className="equipment-secondary"
                  disabled={saving}
                  onClick={() => {
                    setError('');
                    setStep(2);
                  }}
                >
                  <ArrowLeft aria-hidden="true" />
                  {t('cameraNetworkOnboarding.editCredentials')}
                </button>
                <button
                  type="button"
                  className="equipment-primary"
                  disabled={saving}
                  onClick={() => void addCamera()}
                >
                  {saving ? (
                    <LoaderCircle className="is-spinning" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 aria-hidden="true" />
                  )}
                  {saving
                    ? t('cameraNetworkOnboarding.checking')
                    : error
                      ? t('cameraNetworkOnboarding.tryAgain')
                      : t('cameraNetworkOnboarding.detectStreamAndAdd')}
                </button>
              </footer>
            </>
          )}
        </section>
      )}

      {error && step !== 3 && (
        <p className="equipment-error camera-network-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
