import type {
  ZigbeeCandidate,
  ZigbeeCurrent,
  ZigbeeInstall,
  ZigbeeInstallStepId,
  ZigbeeStatus,
} from './zigbee.js';

/**
 * In-memory Zigbee key for the demos (web and mobile): no hardware, no network.
 * The answers have the shape of the real API, so the screens are the real ones.
 *
 * Story: a Sonoff ZBDongle-E runs the home. A first "detect" finds a second Sonoff key whose USB
 * identity does not say whether it is a ZBDongle-P or -E; the box asks it (probe), the family
 * installs it, and the installation walks through its steps. Choosing a technology that does not
 * match the key makes the installation fail so that the rollback can be seen.
 */
export type ZigbeeDemoScenario = 'ready' | 'none' | 'new' | 'missing';

export interface ZigbeeDemoResponse {
  status: number;
  body?: unknown;
}

const STEPS: Array<{ id: ZigbeeInstallStepId; seconds: number }> = [
  { id: 'check', seconds: 1.2 },
  { id: 'backup', seconds: 1.6 },
  { id: 'configure', seconds: 1.2 },
  { id: 'restart', seconds: 2.2 },
  { id: 'verify', seconds: 2.6 },
];
const TOTAL_SECONDS = STEPS.reduce((total, step) => total + step.seconds, 0);

const KEY_E = {
  id: '3f9a1c7d2b40',
  port: '/dev/serial/by-id/usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_c8d3a7e1b2f4-if00-port0',
  usb: {
    vid: '10c4',
    pid: 'ea60',
    manufacturer: 'ITead',
    product: 'Sonoff Zigbee 3.0 USB Dongle Plus V2',
    serial: 'c8d3a7e1b2f4',
  },
};
const KEY_P = {
  id: '7be41d09a5c2',
  port: '/dev/serial/by-id/usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_9a1e47c0d3b8-if00-port0',
  usb: {
    vid: '10c4',
    pid: 'ea60',
    manufacturer: 'ITead',
    product: 'Sonoff Zigbee 3.0 USB Dongle Plus',
    serial: '9a1e47c0d3b8',
  },
};

const MODEL_E = {
  id: 'sonoff-zbdongle-e',
  name: 'Sonoff ZBDongle-E',
  vendor: 'Sonoff (ITead)',
  chip: 'EFR32MG21',
  status: 'recommended' as const,
  notes: ['usb3-extension', 'keep-firmware-current'],
};
const MODEL_P = {
  id: 'sonoff-zbdongle-p',
  name: 'Sonoff ZBDongle-P',
  vendor: 'Sonoff (ITead)',
  chip: 'CC2652P',
  status: 'recommended' as const,
  notes: ['usb3-extension', 'keep-firmware-current'],
};

const optionE = {
  technology: 'ember' as const,
  baudrate: 115200,
  rtscts: false,
  modelId: MODEL_E.id,
  modelName: MODEL_E.name,
};
const optionP = {
  technology: 'zstack' as const,
  baudrate: 115200,
  rtscts: false,
  modelId: MODEL_P.id,
  modelName: MODEL_P.name,
};

const COORDINATORS = {
  e: {
    type: 'EZSP v13',
    firmware: '7.4.4.0 build 0',
    ieee: '0x00124b0029c3a1f7',
    channel: 15,
    panId: '0x1a62',
    extendedPanId: '0xdddddddddddddddd',
  },
  p: {
    type: 'zStack3x0',
    firmware: '20240710',
    ieee: '0x00124b0030d5e2a8',
    channel: 15,
    panId: '0x1a62',
    extendedPanId: '0xdddddddddddddddd',
  },
};

type KeyId = 'e' | 'p';

export function createZigbeeDemo(
  options: { scenario?: ZigbeeDemoScenario; now?: () => number } = {},
) {
  const now = options.now ?? (() => Date.now());
  const scenario = options.scenario ?? 'ready';
  let current: KeyId | null = scenario === 'ready' || scenario === 'missing' ? 'e' : null;
  const plugged: Record<KeyId, boolean> = { e: scenario === 'ready', p: scenario === 'new' };
  // A key plugged but still unnoticed: the first "detect" of the demo reveals it.
  let hidden: KeyId | null = scenario === 'ready' ? 'p' : scenario === 'none' ? 'e' : null;
  let probed = false;
  let run: {
    startedAt: number;
    key: KeyId;
    adapter: string;
    baudrate: number;
    rtscts: boolean;
    networkMode: 'keep' | 'new';
    failure: boolean;
  } | null = null;
  let finished: ZigbeeInstall | null = null;

  const iso = (time = now()) => new Date(time).toISOString();

  function candidate(key: KeyId): ZigbeeCandidate {
    const source = key === 'e' ? KEY_E : KEY_P;
    const settled = key === 'e' || probed || current === 'p';
    const model = key === 'e' ? MODEL_E : MODEL_P;
    return {
      id: source.id,
      kind: 'usb',
      port: source.port,
      portStability: 'by-id',
      device: key === 'e' ? '/dev/ttyUSB0' : '/dev/ttyUSB1',
      usb: source.usb,
      driver: 'cp210x',
      network: null,
      busy: null,
      isCurrent: current === key,
      identity: settled
        ? {
            modelId: model.id,
            name: model.name,
            vendor: model.vendor,
            chip: model.chip,
            status: model.status,
            confidence: 'high',
            source: key === 'p' ? 'probe' : 'usb-id',
            notes: model.notes,
            options: [key === 'e' ? optionE : optionP],
          }
        : {
            modelId: null,
            name: null,
            vendor: 'Sonoff (ITead)',
            chip: null,
            status: null,
            confidence: 'ambiguous',
            source: 'usb-id',
            notes: [],
            options: [optionP, optionE],
          },
    };
  }

  function currentInfo(): ZigbeeCurrent | null {
    if (!current) return null;
    const source = current === 'e' ? KEY_E : KEY_P;
    const model = current === 'e' ? MODEL_E : MODEL_P;
    const option = current === 'e' ? optionE : optionP;
    const missing = !plugged[current];
    return {
      port: source.port,
      adapter: option.technology,
      baudrate: option.baudrate,
      rtscts: option.rtscts,
      mode: 'manual',
      present: !missing,
      candidateId: source.id,
      model,
      usb: source.usb,
      z2m: {
        container: missing ? 'restarting' : 'running',
        bridge: missing ? 'offline' : 'online',
      },
      coordinator: missing ? null : COORDINATORS[current],
      deviceCount: missing ? null : 7,
      firmware: 'ok',
    };
  }

  function progress(): ZigbeeInstall | null {
    if (!run) return finished;
    const elapsed = (now() - run.startedAt) / 1000;
    const target = {
      port: (run.key === 'e' ? KEY_E : KEY_P).port,
      adapter: run.adapter,
      baudrate: run.baudrate,
      rtscts: run.rtscts,
      modelName: run.key === 'e' ? MODEL_E.name : MODEL_P.name,
    };
    const base: ZigbeeInstall = {
      state: 'RUNNING',
      step: null,
      steps: STEPS.map((step) => ({ id: step.id, state: 'pending' })),
      progress: 2,
      startedAt: iso(run.startedAt),
      finishedAt: null,
      target,
      networkMode: run.networkMode,
      errorCode: null,
      detail: null,
      rolledBack: false,
      backupId: '20260612T101500',
      coordinator: null,
    };
    // A wrong technology fails once Zigbee2MQTT restarts: the box puts the old key back.
    const failAt = run.failure
      ? STEPS.slice(0, 4).reduce((sum, step) => sum + step.seconds, 0) + 1.4
      : null;
    if (failAt !== null && elapsed >= failAt) {
      const done = {
        ...base,
        state: 'ROLLED_BACK' as const,
        step: 'rollback' as const,
        steps: STEPS.map((step) => ({
          id: step.id,
          state: step.id === 'verify' ? ('failed' as const) : ('done' as const),
        })),
        progress: null,
        finishedAt: iso(),
        errorCode: 'NO_ANSWER',
        detail: 'Error: Failed to start zigbee-herdsman — no answer from the coordinator',
        rolledBack: true,
      };
      finished = done;
      run = null;
      return done;
    }
    if (failAt === null && elapsed >= TOTAL_SECONDS) {
      current = run.key;
      const done: ZigbeeInstall = {
        ...base,
        state: 'SUCCEEDED',
        step: 'verify',
        steps: STEPS.map((step) => ({ id: step.id, state: 'done' as const })),
        progress: 100,
        finishedAt: iso(),
        coordinator: COORDINATORS[run.key],
      };
      finished = done;
      run = null;
      return done;
    }
    let passed = 0;
    let stepIndex = 0;
    STEPS.forEach((step, index) => {
      if (elapsed >= passed + step.seconds) stepIndex = index + 1;
      passed += step.seconds;
    });
    const running = Math.min(stepIndex, STEPS.length - 1);
    return {
      ...base,
      step: STEPS[running]?.id ?? null,
      steps: STEPS.map((step, index) => ({
        id: step.id,
        state: index < stepIndex ? 'done' : index === running ? 'running' : 'pending',
      })),
      progress: Math.max(2, Math.min(96, Math.round((elapsed / TOTAL_SECONDS) * 100))),
    };
  }

  function status(): ZigbeeStatus {
    const install = progress();
    const keys = (['e', 'p'] as KeyId[]).filter((key) => plugged[key]);
    const candidates = keys.map(candidate);
    const info = currentInfo();
    const others = candidates.filter((item) => !item.isCurrent);
    const issues: string[] = [];
    if (candidates.length > 1) issues.push('multiple-keys');
    if (others.length > 0 && info?.present) issues.push('other-key-plugged');
    let state: ZigbeeStatus['state'];
    if (install?.state === 'RUNNING') state = 'INSTALLING';
    else if (others.length > 0 && (!info || !info.present)) state = 'NEW_KEY';
    else if (!info) state = 'NO_KEY';
    else if (!info.present) state = 'KEY_MISSING';
    else state = 'READY';
    return {
      state,
      current: info,
      candidates,
      install:
        install ??
        ({
          state: 'IDLE',
          step: null,
          steps: STEPS.map((step) => ({ id: step.id, state: 'pending' as const })),
          progress: null,
          startedAt: null,
          finishedAt: null,
          target: null,
          networkMode: 'keep',
          errorCode: null,
          detail: null,
          rolledBack: false,
          backupId: null,
          coordinator: null,
        } satisfies ZigbeeInstall),
      issues,
      checkedAt: iso(),
    };
  }

  function parse(body: string | undefined): Record<string, unknown> {
    try {
      const value: unknown = body ? JSON.parse(body) : {};
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return {
    /** Answers `/zigbee/adapter…` calls; null for any other path. */
    handle(method: string, pathname: string, rawBody?: string): ZigbeeDemoResponse | null {
      if (!pathname.startsWith('/zigbee/adapter')) return null;
      const route = pathname.slice('/zigbee/adapter'.length);
      const body = parse(rawBody);
      if (route === '' && method === 'GET') return { status: 200, body: status() };
      if (route === '/scan' && method === 'POST') {
        if (hidden) {
          plugged[hidden] = true;
          hidden = null;
        }
        return { status: 200, body: status() };
      }
      if (route === '/probe' && method === 'POST') {
        probed = true;
        const found = candidate('p');
        return { status: 200, body: { candidate: found, answered: true } };
      }
      if (route === '/network/test' && method === 'POST')
        return { status: 400, body: { error: 'KEY_UNREACHABLE' } };
      if (route === '/network/forget' && method === 'POST') return { status: 200, body: status() };
      if (route === '/install' && method === 'GET') return { status: 200, body: status().install };
      if (route === '/install' && method === 'POST') {
        const key: KeyId | null =
          body.candidateId === KEY_E.id ? 'e' : body.candidateId === KEY_P.id ? 'p' : null;
        if (!key || !plugged[key])
          return { status: 400, body: { error: 'Cette clé n’est plus branchée.' } };
        if (run) return { status: 503, body: { error: 'Une installation est déjà en cours.' } };
        const expected = key === 'e' ? optionE : optionP;
        const adapter = typeof body.adapter === 'string' ? body.adapter : expected.technology;
        finished = null;
        run = {
          startedAt: now(),
          key,
          adapter,
          baudrate: typeof body.baudrate === 'number' ? body.baudrate : expected.baudrate,
          rtscts: body.rtscts === true,
          networkMode: body.networkMode === 'new' ? 'new' : 'keep',
          failure: adapter !== expected.technology,
        };
        return { status: 202, body: progress() };
      }
      if (route === '/install/cancel' && method === 'POST') {
        run = null;
        finished = null;
        return { status: 200, body: status().install };
      }
      return { status: 404, body: { message: 'Not found' } };
    },
    reset() {
      current = scenario === 'ready' || scenario === 'missing' ? 'e' : null;
      probed = false;
      run = null;
      finished = null;
    },
  };
}

export type ZigbeeDemo = ReturnType<typeof createZigbeeDemo>;
