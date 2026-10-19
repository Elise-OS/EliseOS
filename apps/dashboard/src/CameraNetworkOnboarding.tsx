import type { CameraNetworkDevice } from '@michel/contracts';
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
import type { Locale } from './i18n';
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

function errorMessage(cause: unknown, fr: boolean, fallback: string): string {
  if (cause instanceof Error && /Connexion impossible \((502|503|504)\)/.test(cause.message))
    return fr
      ? 'Le serveur Élise est momentanément indisponible. Réessayez dans quelques instants.'
      : 'The Élise server is temporarily unavailable. Please try again shortly.';
  if (cause instanceof TypeError)
    return fr
      ? 'La connexion au logement a été interrompue. Vérifiez le réseau puis réessayez.'
      : 'The connection to your home was interrupted. Check the network and try again.';
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function CameraNetworkOnboarding({
  locale,
  roomId,
  roomName,
  cameras,
  onAdded,
}: CameraNetworkOnboardingProps) {
  const fr = locale === 'fr';
  const steps = fr ? ['Rechercher', 'Connecter', 'Ajouter'] : ['Search', 'Connect', 'Add'];
  const activeDiscovery = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [devices, setDevices] = useState<CameraNetworkDevice[]>([]);
  const [selected, setSelected] = useState<CameraNetworkDevice | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [name, setName] = useState(`Caméra ${roomName}`);
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
          ? fr
            ? 'La recherche prend trop de temps. Réessayez dans quelques instants.'
            : 'The search is taking too long. Please try again shortly.'
          : errorMessage(
              cause,
              fr,
              fr ? 'La recherche réseau a échoué.' : 'The network search failed.',
            ),
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
      setError(
        errorMessage(
          cause,
          fr,
          fr ? 'La caméra n’a pas pu être ajoutée.' : 'The camera could not be added.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="equipment-onboarding camera-network-onboarding"
      aria-label={fr ? 'Ajout d’une caméra réseau' : 'Add a network camera'}
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
                <small>{fr ? `Étape ${number} sur 3` : `Step ${number} of 3`}</small>
                <strong>{label}</strong>
              </div>
            </li>
          );
        })}
      </ol>

      {cameras.length > 0 && (
        <p className="camera-network-existing equipment-muted">
          {fr ? 'Déjà dans cette pièce : ' : 'Already in this room: '}
          {cameras.map(({ name: cameraName }) => cameraName).join(', ')}
        </p>
      )}

      {step === 1 && (
        <>
          <div className="equipment-onboarding-intro">
            <Wifi aria-hidden="true" />
            <h3>{fr ? 'Rechercher une caméra sur le réseau' : 'Find a camera on the network'}</h3>
            <p>
              {fr
                ? 'Élise recherche les caméras accessibles depuis le réseau de votre logement.'
                : 'Élise looks for cameras available on your home network.'}
            </p>
          </div>
          <ol className="equipment-guide-steps">
            {(fr
              ? [
                  'La caméra doit être allumée et connectée au même réseau que le NAS.',
                  'Son flux RTSP doit être activé dans les réglages locaux de la caméra.',
                ]
              : [
                  'The camera must be powered on and connected to the same network as the NAS.',
                  'Its RTSP stream must be enabled in the camera’s local settings.',
                ]
            ).map((line) => (
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
              ? fr
                ? 'Recherche en cours…'
                : 'Searching…'
              : searched
                ? fr
                  ? 'Rechercher à nouveau'
                  : 'Search again'
                : fr
                  ? 'Rechercher sur mon réseau'
                  : 'Search my network'}
          </button>

          {scanning && (
            <p className="camera-network-status" role="status" aria-live="polite">
              <LoaderCircle className="is-spinning" aria-hidden="true" />
              {fr ? 'Élise analyse le réseau local…' : 'Élise is scanning the local network…'}
            </p>
          )}

          {searched && devices.length === 0 && !scanning && (
            <div className="camera-network-empty" role="status">
              <Camera aria-hidden="true" />
              <div>
                <strong>{fr ? 'Aucune caméra trouvée' : 'No camera found'}</strong>
                <p>
                  {fr
                    ? 'Vérifiez que la caméra est allumée, sur le réseau du logement et que son flux RTSP est activé, puis relancez la recherche.'
                    : 'Check that the camera is powered on, on your home network, and has RTSP enabled, then search again.'}
                </p>
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
              {fr
                ? `${devices.length} caméra${devices.length > 1 ? 's' : ''} trouvée${devices.length > 1 ? 's' : ''}`
                : `${devices.length} camera${devices.length > 1 ? 's' : ''} found`}
            </h4>
            {devices.length > 1 && (
              <p className="equipment-muted">
                {fr
                  ? 'Sélectionnez la caméra installée dans cette pièce.'
                  : 'Select the camera installed in this room.'}
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
                      <strong>{fr ? 'Caméra détectée' : 'Camera detected'}</strong>
                      <small>
                        {device.address} · RTSP · {fr ? 'port' : 'port'} {device.rtspPort}
                        {device.authenticationRequired ? (fr ? ' · protégé' : ' · protected') : ''}
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
                  <h4>{fr ? 'Connexion locale' : 'Local connection'}</h4>
                  <p>
                    {fr
                      ? selected.authenticationRequired
                        ? 'Le flux local demande un mot de passe. Le nom courant « admin » est prérempli. Saisissez le mot de passe de la caméra, pas celui de votre compte Imou Life.'
                        : 'Élise essaiera de lire le flux sans identifiants. Si la caméra le protège, vous pourrez ajouter ses identifiants locaux.'
                      : selected.authenticationRequired
                        ? 'The local stream requires a password. The common “admin” username is prefilled. Enter the camera password, not your Imou Life account password.'
                        : 'Élise will first try to read the stream without credentials. If the camera protects it, you can add its local credentials.'}
                  </p>
                </div>
              </div>
              <label className="equipment-field">
                {fr ? 'Nom de la caméra' : 'Camera name'}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={120}
                />
              </label>
              <p className="equipment-install-warning">
                {fr
                  ? 'Saisissez les identifiants locaux de l’appareil, pas ceux du compte Imou Life. Élise ne demande pas le chemin du flux vidéo.'
                  : 'Enter the camera’s local device credentials, not your Imou Life account. Élise does not ask for the video stream path.'}
              </p>
              <div className="camera-network-credentials">
                <label className="equipment-field">
                  {fr ? 'Identifiant local' : 'Local username'}
                  <input
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required={selected.authenticationRequired}
                    maxLength={128}
                  />
                </label>
                <label className="equipment-field">
                  {fr ? 'Mot de passe de la caméra' : 'Camera password'}
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
                <span>
                  {fr
                    ? 'Je confirme avoir l’autorisation d’installer et d’utiliser cette caméra dans cette pièce.'
                    : 'I confirm that I am authorized to install and use this camera in this room.'}
                </span>
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
                  <ArrowLeft aria-hidden="true" /> {fr ? 'Retour' : 'Back'}
                </button>
                <button
                  className="equipment-primary"
                  type="submit"
                  disabled={
                    !name.trim() || (selected.authenticationRequired && !password) || !consented
                  }
                >
                  {fr ? 'Détecter le flux et ajouter' : 'Detect stream and add'}
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
                <ArrowLeft aria-hidden="true" /> {fr ? 'Retour' : 'Back'}
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
                <strong>{fr ? 'Caméra ajoutée' : 'Camera added'}</strong>
                <br />
                {fr
                  ? `${name} est associée à ${roomName}. Son flux en direct est maintenant disponible dans Caméras.`
                  : `${name} is assigned to ${roomName}. Its live stream is now available in Cameras.`}
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
                      ? fr
                        ? 'Vérification du flux vidéo'
                        : 'Checking the video stream'
                      : fr
                        ? 'Vérifier le flux vidéo'
                        : 'Check the video stream'}
                  </h3>
                  <p>
                    {saving
                      ? fr
                        ? 'Élise cherche un flux et vérifie qu’une image arrive.'
                        : 'Élise is finding a stream and checking for a video frame.'
                      : fr
                        ? 'Les identifiants et l’accès au flux seront vérifiés avant l’ajout.'
                        : 'The credentials and stream will be checked before the camera is added.'}
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
                  {fr ? 'Modifier les identifiants' : 'Edit credentials'}
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
                    ? fr
                      ? 'Vérification…'
                      : 'Checking…'
                    : error
                      ? fr
                        ? 'Réessayer'
                        : 'Try again'
                      : fr
                        ? 'Détecter le flux et ajouter'
                        : 'Detect stream and add'}
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
