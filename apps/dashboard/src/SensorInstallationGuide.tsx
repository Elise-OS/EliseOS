import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, LoaderCircle, Radio, RefreshCw } from 'lucide-react';
import type { Locale } from './i18n';
import { sensorJson, sensorRequest, type SensorUiDevice } from './sensor-ui';

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
  const [test, setTest] = useState<{ id: string; status: string } | null>(null);
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
    const poll = async () => {
      try {
        const result = await sensorRequest<{ id: string; status: string }>(
          `/api/v1/sensor-devices/verification-sessions/${test.id}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(result.status)) {
          setTest({ ...result, id: test.id });
          if (result.status === 'COMPLETED') await changed.current();
        } else timer = window.setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError((err as Error).message);
          setTest({ ...test, status: 'FAILED' });
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [test]);
  const run = async (action: 'PLACE' | 'TEST') => {
    setBusy(true);
    setError('');
    try {
      if (action === 'PLACE') {
        await sensorRequest(
          `/api/v1/sensor-devices/${encodeURIComponent(device.id)}`,
          sensorJson('PATCH', { placementConfirmed: true }),
        );
        await changed.current();
      } else {
        const targetId = verificationTargetId(device);
        const result = await sensorRequest<{ id: string; status: string }>(
          `/api/v1/sensor-devices/${encodeURIComponent(targetId)}/verification-sessions`,
          { method: 'POST' },
        );
        if (alive.current) setTest({ ...result, status: result.status ?? 'PENDING' });
        if (result.status === 'COMPLETED') await changed.current();
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
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
          <button
            className="equipment-secondary"
            disabled={busy || !device.room}
            onClick={() => void run('PLACE')}
          >
            <Check />{' '}
            {device.placementConfirmedAt
              ? fr
                ? 'Emplacement confirmé'
                : 'Placement confirmed'
              : fr
                ? 'J’ai positionné le capteur'
                : 'I placed the sensor'}
          </button>
        </>
      )}
      <section className="equipment-test">
        <Radio />
        <div>
          <h3>{fr ? 'Vérifier la connexion' : 'Check connection'}</h3>
          <p>{guide?.testInstruction}</p>
          {!device.room && (
            <p>
              {fr ? 'Associez une pièce avant de lancer le test.' : 'Assign a room before testing.'}
            </p>
          )}
          <button
            className="equipment-secondary"
            disabled={busy || !!testing || !device.room}
            onClick={() => void run('TEST')}
          >
            <RefreshCw className={testing ? 'is-spinning' : ''} />{' '}
            {testing
              ? fr
                ? 'Test en cours…'
                : 'Testing…'
              : fr
                ? 'Tester le capteur'
                : 'Test sensor'}
          </button>
          {test?.status === 'COMPLETED' && (
            <p className="equipment-success" role="status">
              <CheckCircle2 /> {fr ? 'Signal reçu par la box.' : 'Signal received by the hub.'}
            </p>
          )}
          {test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status) && (
            <p role="status">
              {fr
                ? 'Aucun signal confirmé. Vous pouvez réessayer.'
                : 'No signal confirmed. You can retry.'}
            </p>
          )}
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
