import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, LoaderCircle, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { type Locale, t } from './i18n';
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
          timedOut ? t('sensorInstallationGuide.theHubDidNotRespond') : (err as Error).message,
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
          <LoaderCircle className="is-spinning" /> {t('sensorInstallationGuide.loadingGuide')}
        </p>
      )}
      {guide && !testOnly && (
        <>
          <div className="equipment-guide-intro">
            <span className="equipment-kicker">{t('sensorInstallationGuide.installation')}</span>
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
              <strong>{t('sensorInstallationGuide.avoid')}</strong>
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
              {t('sensorInstallationGuide.sensorConnection')}
            </span>
            <h3>{t('sensorInstallationGuide.installAndCheck')}</h3>
            <p>{t('sensorInstallationGuide.eliseRequestsAFreshStatus')}</p>
          </div>
        </div>
        <div className="equipment-test-body">
          {guide?.testInstruction && (
            <p className="equipment-test-instruction">{guide.testInstruction}</p>
          )}
          {!device.room && (
            <p className="equipment-test-warning">
              {t('sensorInstallationGuide.assignARoomBeforeTesting')}
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
                  ? t('sensorInstallationGuide.checkingConnection')
                  : test?.status === 'COMPLETED'
                    ? t('sensorInstallationGuide.sensorOnline')
                    : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status)
                      ? t('sensorInstallationGuide.sensorNotConfirmed')
                      : t('sensorInstallationGuide.readyToCheck')}
              </strong>
              <small>
                {testing
                  ? t('sensorInstallationGuide.thisUsuallyTakesAFew')
                  : test?.status === 'COMPLETED'
                    ? t('sensorInstallationGuide.theSensorIsPresentAnd')
                    : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status)
                      ? t('sensorInstallationGuide.noResponseReceivedWakeThe')
                      : t('sensorInstallationGuide.theCheckStopsAutomaticallyAfter')}
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
              ? t('sensorInstallationGuide.testing')
              : test && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(test.status)
                ? t('sensorInstallationGuide.tryAgain')
                : t('sensorInstallationGuide.checkNow')}
          </button>
        </div>
      </section>
      {error && (
        <div className="equipment-error" role="alert">
          {error}{' '}
          {!guide && (
            <button onClick={() => setRetry((v) => v + 1)}>
              {t('sensorInstallationGuide.retry')}
            </button>
          )}
        </div>
      )}
      {onDone && (
        <footer className="equipment-dialog-footer">
          <button className="equipment-primary" disabled={busy} onClick={onDone}>
            {t('sensorInstallationGuide.done')}
            <Check />
          </button>
        </footer>
      )}
    </div>
  );
}
