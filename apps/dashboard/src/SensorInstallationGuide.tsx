import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, LoaderCircle, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { Locale } from './i18n';
import { sensorRequest, type SensorUiDevice } from './sensor-ui';

type Guide = {
  title: string;
  summary: string;
  steps: string[];
  avoid: string[];
  testInstruction: string;
  safetyNote: string | null;
};

const verificationPriority = [
  'button',
  'contact',
  'dry_contact',
  'water_leak',
  'smoke',
  'carbon_monoxide',
  'fall_detection',
  'motion',
  'person_presence',
  'occupancy',
  'temperature',
  'humidity',
];
export function verificationTargetId(device: SensorUiDevice) {
  const capability = [...device.capabilities].sort((a, b) => {
    const left = verificationPriority.indexOf(a.capability);
    const right = verificationPriority.indexOf(b.capability);
    return (
      (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right)
    );
  })[0];
  return capability ? `sensor:${capability.sensorId}` : device.id;
}

export function SensorInstallationGuide({
  device,
  locale,
  onDone,
  onChanged,
  testOnly = false,
}: {
  device: SensorUiDevice;
  locale: Locale;
  onDone?: () => void;
  onChanged: () => Promise<void>;
  testOnly?: boolean;
}) {
  const fr = locale === 'fr';
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{
    id: string;
    status: string;
    expiresAt?: string;
    observedAt?: string | null;
  } | null>(null);
  const alive = useRef(true);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setGuide(null);
    setError('');
    setTest(null);
    void sensorRequest<Guide>(
      `/api/v1/sensor-devices/${encodeURIComponent(device.id)}/placement-guide`,
      { signal: controller.signal },
    )
      .then(setGuide)
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [device.id, retry]);
  useEffect(() => {
    if (!test || !['PENDING', 'WAITING_FOR_DEVICE'].includes(test.status)) return;
    const controller = new AbortController();
    let timer: number;
    const serverDeadline = test.expiresAt ? Date.parse(test.expiresAt) : Number.NaN;
    const deadline = Number.isFinite(serverDeadline)
      ? Math.min(serverDeadline, Date.now() + 20_000)
      : Date.now() + 20_000;
    const deadlineTimer = window.setTimeout(
      () => {
        controller.abort();
        setTest((current) =>
          current?.id === test.id ? { ...current, status: 'EXPIRED' } : current,
        );
      },
      Math.max(0, deadline - Date.now()),
    );
    const poll = async () => {
      try {
        const result = await sensorRequest<{
          id: string;
          status: string;
          expiresAt?: string;
          observedAt?: string | null;
        }>(`/api/v1/sensor-devices/verification-sessions/${test.id}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(result.status)) {
          setTest({ ...result, id: test.id });
          if (result.status === 'COMPLETED') await changed.current();
        } else timer = window.setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (!controller.signal.aborted && Date.now() < deadline) {
          setError((err as Error).message);
          setTest({ ...test, status: 'FAILED' });
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadlineTimer);
    };
  }, [test]);
  const runTest = async () => {
    setBusy(true);
    setError('');
    try {
      const targetId = verificationTargetId(device);
      const result = await sensorRequest<{
        id: string;
        status: string;
        expiresAt?: string;
        observedAt?: string | null;
      }>(`/api/v1/sensor-devices/${encodeURIComponent(targetId)}/verification-sessions`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
      if (alive.current) setTest({ ...result, status: result.status ?? 'PENDING' });
      if (result.status === 'COMPLETED') await changed.current();
    } catch (err) {
      if (alive.current) {
        const timedOut = (err as Error).name === 'TimeoutError';
        setError(
          timedOut
            ? fr
              ? 'La box ne répond pas. Vérifiez sa connexion, puis réessayez.'
              : 'The hub did not respond. Check its connection and try again.'
            : (err as Error).message,
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const testing = test && ['PENDING', 'WAITING_FOR_DEVICE'].includes(test.status);
  return (
    <div className="equipment-guide">
      {!guide && !error && (
        <p role="status">
          <LoaderCircle className="is-spinning" /> {fr ? 'Chargement du guide…' : 'Loading guide…'}
        </p>
      )}
      {guide && !testOnly && (
        <>
          <div className="equipment-guide-intro">
            <span className="equipment-kicker">{fr ? 'Installation' : 'Installation'}</span>
            <h3>{guide.title}</h3>
            <p>{guide.summary}</p>
          </div>
          <ol className="equipment-guide-steps">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {!!guide.avoid.length && (
            <div className="equipment-note">
              <strong>{fr ? 'À éviter' : 'Avoid'}</strong>
              <ul>
                {guide.avoid.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {guide.safetyNote && <p className="equipment-muted">{guide.safetyNote}</p>}
        </>
      )}
      <section className={`equipment-test ${testing ? 'is-testing' : ''}`}>
        <div className="equipment-test-heading">
          <span className="equipment-test-icon" aria-hidden="true">
            {test?.status === 'COMPLETED' ? (
              <Wifi />
            ) : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status) ? (
              <WifiOff />
            ) : (
              <Radio />
            )}
          </span>
          <div>
            <span className="equipment-kicker">
              {fr ? 'Connexion du capteur' : 'Sensor connection'}
            </span>
            <h3>{fr ? 'Installer et vérifier' : 'Install and check'}</h3>
            <p>
              {fr
                ? 'Élise demande un état récent à la box et vérifie la liaison du capteur.'
                : 'Élise requests a fresh status from the hub and checks the sensor link.'}
            </p>
          </div>
        </div>
        <div className="equipment-test-body">
          {guide?.testInstruction && (
            <p className="equipment-test-instruction">{guide.testInstruction}</p>
          )}
          {!device.room && (
            <p className="equipment-test-warning">
              {fr ? 'Associez une pièce avant de lancer le test.' : 'Assign a room before testing.'}
            </p>
          )}
          <div
            className={`equipment-test-status status-${test?.status?.toLowerCase() ?? 'idle'}`}
            role="status"
          >
            {testing ? (
              <LoaderCircle className="is-spinning" />
            ) : test?.status === 'COMPLETED' ? (
              <CheckCircle2 />
            ) : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status) ? (
              <WifiOff />
            ) : (
              <Radio />
            )}
            <span>
              <strong>
                {testing
                  ? fr
                    ? 'Vérification en cours'
                    : 'Checking connection'
                  : test?.status === 'COMPLETED'
                    ? fr
                      ? 'Capteur en ligne'
                      : 'Sensor online'
                    : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status)
                      ? fr
                        ? 'Capteur non confirmé'
                        : 'Sensor not confirmed'
                      : fr
                        ? 'Prêt pour la vérification'
                        : 'Ready to check'}
              </strong>
              <small>
                {testing
                  ? fr
                    ? 'Cela prend généralement quelques secondes.'
                    : 'This usually takes a few seconds.'
                  : test?.status === 'COMPLETED'
                    ? fr
                      ? 'Le capteur est présent et disponible dans le dernier état de la box.'
                      : 'The sensor is present and available in the latest hub status.'
                    : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status)
                      ? fr
                        ? 'Aucune réponse reçue. Réveillez le capteur puis réessayez.'
                        : 'No response received. Wake the sensor and try again.'
                      : fr
                        ? 'Le test s’arrête automatiquement après 20 secondes.'
                        : 'The check stops automatically after 20 seconds.'}
              </small>
            </span>
          </div>
          <button
            className="equipment-test-action"
            disabled={busy || !!testing || !device.room}
            onClick={() => void runTest()}
          >
            <RefreshCw className={testing ? 'is-spinning' : ''} />{' '}
            {testing
              ? fr
                ? 'Test en cours…'
                : 'Testing…'
              : fr
                ? test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status)
                  ? 'Réessayer'
                  : 'Vérifier maintenant'
                : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status)
                  ? 'Try again'
                  : 'Check now'}
          </button>
        </div>
      </section>
      {error && (
        <div className="equipment-error" role="alert">
          {error}{' '}
          {!guide && (
            <button onClick={() => setRetry((v) => v + 1)}>{fr ? 'Réessayer' : 'Retry'}</button>
          )}
        </div>
      )}
      {onDone && (
        <footer className="equipment-dialog-footer">
          <button className="equipment-primary" disabled={busy} onClick={onDone}>
            {fr ? 'Terminer' : 'Done'}
            <Check />
          </button>
        </footer>
      )}
    </div>
  );
}
