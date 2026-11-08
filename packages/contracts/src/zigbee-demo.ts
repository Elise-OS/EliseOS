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
 * Story: a Sonoff ZBDongle-E runs the home. The first "search" (USB and home network together) finds
 * a second Sonoff key plugged on the box, whose USB identity does not say whether it is a ZBDongle-P
 * or -E, and an SMLIGHT SLZB-06M on the home network. The box asks the Sonoff (probe), the family
 * installs a key, and the installation walks through its steps. Choosing a technology that does not
 * match the key makes the installation fail so that the rollback can be seen.
 */
/** `empty`: the key works and nothing else is around, so a search finds nothing to choose. */
export type ZigbeeDemoScenario = 'ready' | 'none' | 'new' | 'missing' | 'empty';

export const ZIGBEE_DEMO_SCENARIOS: readonly ZigbeeDemoScenario[] = [
  'ready',
  'none',
  'new',
  'missing',
  'empty',
];

export function isZigbeeDemoScenario(value: unknown): value is ZigbeeDemoScenario {
  return ZIGBEE_DEMO_SCENARIOS.includes(value as ZigbeeDemoScenario);
}

/** A real search listens to the home network for a moment: the demos wait as long. */
export const ZIGBEE_DEMO_SEARCH_MS = 2600;

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

const KEY_N = {
  id: '5d2e8a14c9b7',
  port: 'tcp://192.168.1.50:6638',
};

const MODEL_N = {
  id: 'smlight-slzb-06m',
  name: 'SMLIGHT SLZB-06M',
  vendor: 'SMLIGHT',
  chip: 'EFR32MG21',
  status: 'recommended' as const,
  notes: ['network-adapter', 'keep-firmware-current'],
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

const optionN = {
  technology: 'ember' as const,
  baudrate: 115200,
  rtscts: false,
  modelId: MODEL_N.id,
  modelName: MODEL_N.name,
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
  n: {
    type: 'EZSP v13',
    firmware: '20250522',
    ieee: '0x00124b0041b7c6d9',
    channel: 15,
    panId: '0x1a62',
    extendedPanId: '0xdddddddddddddddd',
  },
};

type KeyId = 'e' | 'p' | 'n';
const ALL_KEYS: KeyId[] = ['e', 'p', 'n'];
const KEYS = {
  e: { source: KEY_E, model: MODEL_E, option: optionE },
  p: { source: KEY_P, model: MODEL_P, option: optionP },
  n: { source: KEY_N, model: MODEL_N, option: optionN },
};

function hiddenAtStart(scenario: ZigbeeDemoScenario): KeyId[] {
  if (scenario === 'ready') return ['p', 'n'];
  if (scenario === 'none') return ['e', 'n'];
  if (scenario === 'empty') return [];
  return ['n'];
}

export function createZigbeeDemo(
  options: { scenario?: ZigbeeDemoScenario; now?: () => number } = {},
) {
  const now = options.now ?? (() => Date.now());
  const scenario = options.scenario ?? 'ready';
  let current: KeyId | null = scenario === 'none' || scenario === 'new' ? null : 'e';
  const plugged: Record<KeyId, boolean> = {
    e: scenario === 'ready' || scenario === 'empty',
    p: scenario === 'new',
    n: false,
  };
  // Keys plugged or online but still unnoticed: the first search of the demo reveals them. The one on
  // the home network only shows up when the network is searched too.
  let hidden = hiddenAtStart(scenario);
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
    const { source, model, option } = KEYS[key];
    if (key === 'n') {
      return {
        id: KEY_N.id,
        kind: 'network',
        port: KEY_N.port,
        portStability: 'network',
        device: null,
        usb: null,
        driver: null,
        network: { host: '192.168.1.50', port: 6638, name: 'slzb-06m', service: '_slzb-06' },
        busy: null,
        isCurrent: current === 'n',
        identity: {
          modelId: model.id,
          name: model.name,
          vendor: model.vendor,
          chip: model.chip,
          status: model.status,
          confidence: 'high',
          source: 'hostname',
          notes: model.notes,
          options: [option],
        },
      };
    }
    const usbSource = source as typeof KEY_E;
    const settled = key === 'e' || probed || current === 'p';
    return {
      id: usbSource.id,
      kind: 'usb',
      port: usbSource.port,
      portStability: 'by-id',
      device: key === 'e' ? '/dev/ttyUSB0' : '/dev/ttyUSB1',
      usb: usbSource.usb,
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
            options: [option],
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
    const { source, model, option } = KEYS[current];
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
      usb: 'usb' in source ? source.usb : null,
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
      port: KEYS[run.key].source.port,
      adapter: run.adapter,
      baudrate: run.baudrate,
      rtscts: run.rtscts,
      modelName: KEYS[run.key].model.name,
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

  function status(scan?: ZigbeeStatus['scan']): ZigbeeStatus {
    const install = progress();
    const keys = ALL_KEYS.filter((key) => plugged[key]);
    const candidates = keys.map(candidate);
    const info = currentInfo();
    const others = candidates.filter((item) => !item.isCurrent);
    const issues: string[] = [];
    if (candidates.filter((item) => item.kind === 'usb').length > 1) issues.push('multiple-keys');
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
      ...(scan ? { scan } : {}),
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
        const network = body.network === true;
        // The box is always searched; the home network only when asked.
        for (const key of hidden.filter((item) => network || item !== 'n')) plugged[key] = true;
        hidden = hidden.filter((item) => !plugged[item]);
        return { status: 200, body: status({ usb: 'ok', network: network ? 'ok' : 'skipped' }) };
      }
      if (route === '/probe' && method === 'POST') {
        probed = true;
        const found = candidate('p');
        return { status: 200, body: { candidate: found, answered: true } };
      }
      if (route === '/network/test' && method === 'POST') {
        // Only the demo's SLZB-06M answers.
        if (body.host !== '192.168.1.50')
          return { status: 400, body: { error: 'KEY_UNREACHABLE' } };
        plugged.n = true;
        hidden = hidden.filter((item) => item !== 'n');
        return { status: 200, body: { candidate: candidate('n'), answered: true } };
      }
      if (route === '/network/forget' && method === 'POST') return { status: 200, body: status() };
      if (route === '/install' && method === 'GET') return { status: 200, body: status().install };
      if (route === '/install' && method === 'POST') {
        const key = ALL_KEYS.find((item) => KEYS[item].source.id === body.candidateId) ?? null;
        if (!key || !plugged[key])
          return { status: 400, body: { error: 'Cette clé n’est plus branchée.' } };
        if (run) return { status: 503, body: { error: 'Une installation est déjà en cours.' } };
        const expected = KEYS[key].option;
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
      current = scenario === 'none' || scenario === 'new' ? null : 'e';
      plugged.n = false;
      hidden = hiddenAtStart(scenario);
      probed = false;
      run = null;
      finished = null;
    },
  };
}

export type ZigbeeDemo = ReturnType<typeof createZigbeeDemo>;
