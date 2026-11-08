import type {
  ZigbeeCandidate,
  ZigbeeScanOutcome,
  ZigbeeCurrent,
  ZigbeeInstall,
  ZigbeeInstallRequest,
  ZigbeeOption,
  ZigbeeStatus,
} from './zigbee.js';

/**
 * What the web and mobile screens decide from the status, kept here so that both behave the same:
 * which key needs a question, which message an error code gets, which result is still worth showing.
 */

export const ZIGBEE_NOTE_CODES = [
  'usb3-extension',
  'keep-firmware-current',
  'ncp-firmware',
  'network-adapter',
  'discouraged-cc2531',
  'experimental',
  'old-generation',
  'gpio-uart',
  'multi-port',
  'check-radio',
  'check-baudrate',
] as const;

export const ZIGBEE_ERROR_CODES = [
  'PORT_BUSY',
  'KEY_UNREACHABLE',
  'NO_Z2M',
  'PORT_UNAVAILABLE',
  'NO_ANSWER',
  'WRONG_ADAPTER',
  'NETWORK_MISMATCH',
  'TIMEOUT',
  'CANCELLED',
  'INTERRUPTED',
  'ROLLBACK_FAILED',
  'INTERNAL',
] as const;

export const ZIGBEE_VISIBLE_ISSUES = [
  'firmware-old',
  'model-discouraged',
  'model-experimental',
] as const;

export type ZigbeeNoteCode = (typeof ZIGBEE_NOTE_CODES)[number];
export type ZigbeeErrorCode = (typeof ZIGBEE_ERROR_CODES)[number];
export type ZigbeeVisibleIssue = (typeof ZIGBEE_VISIBLE_ISSUES)[number];

/** Page that lists the compatible keys and how to update their firmware. */
export const ZIGBEE_GUIDE_URL = 'https://www.zigbee2mqtt.io/guide/adapters/';

/** A finished installation is shown for this long, then the card goes back to the plain status. */
export const ZIGBEE_RESULT_MINUTES = 20;

/** Translation key suffix of an error code (`unknown` for a code this app does not know). */
export function zigbeeErrorKey(code: string | null): ZigbeeErrorCode | 'unknown' {
  return ZIGBEE_ERROR_CODES.find((known) => known === code) ?? 'unknown';
}

export function zigbeeKnownNotes(notes: readonly string[]): ZigbeeNoteCode[] {
  return ZIGBEE_NOTE_CODES.filter((known) => notes.includes(known));
}

/** The warnings of the status that have a text in the apps. */
export function zigbeeVisibleIssues(issues: readonly string[]): ZigbeeVisibleIssue[] {
  return ZIGBEE_VISIBLE_ISSUES.filter((known) => issues.includes(known));
}

/** Name to show for a key, from the best source available. */
export function zigbeeCandidateTitle(candidate: ZigbeeCandidate): string | null {
  return (
    candidate.identity.name ??
    candidate.usb?.product ??
    candidate.network?.name ??
    candidate.identity.chip ??
    null
  );
}

/** USB identifier shown for a key the list does not know ("10c4:ea60"). */
export function zigbeeUsbId(candidate: ZigbeeCandidate): string | null {
  return candidate.usb ? `${candidate.usb.vid}:${candidate.usb.pid}` : null;
}

/** Several firmware families share this key: the box can ask it, or the user can choose. */
export function zigbeeNeedsChoice(candidate: ZigbeeCandidate): boolean {
  return candidate.identity.confidence === 'ambiguous' && candidate.identity.options.length > 1;
}

/** The key can be installed as it is, with its single proposed option. */
export function zigbeeIsInstallable(candidate: ZigbeeCandidate): boolean {
  return (
    candidate.identity.options.length === 1 &&
    (candidate.identity.confidence === 'high' || candidate.identity.confidence === 'medium') &&
    !candidate.busy
  );
}

export function zigbeeOptionKey(option: ZigbeeOption): string {
  return `${option.technology}:${option.baudrate}:${option.modelId ?? ''}`;
}

/** The request that installs a candidate with one of its options. */
export function zigbeeInstallRequest(
  candidate: ZigbeeCandidate,
  option: Pick<ZigbeeOption, 'technology' | 'baudrate' | 'rtscts' | 'modelId'>,
  networkMode: 'keep' | 'new',
): ZigbeeInstallRequest {
  return {
    candidateId: candidate.id,
    adapter: option.technology,
    baudrate: option.baudrate,
    rtscts: option.rtscts,
    networkMode,
    ...(networkMode === 'new' ? { confirmNewNetwork: true } : {}),
    ...(option.modelId ? { modelId: option.modelId } : {}),
  };
}

/** The last installation result, while it is recent enough to matter. */
export function zigbeeRecentResult(
  install: ZigbeeInstall,
  now: number = Date.now(),
): ZigbeeInstall | null {
  if (install.state === 'IDLE' || install.state === 'RUNNING' || !install.finishedAt) return null;
  const age = now - new Date(install.finishedAt).getTime();
  return age >= 0 && age < ZIGBEE_RESULT_MINUTES * 60_000 ? install : null;
}

export type ZigbeeServiceState = 'running' | 'starting' | 'stopped' | 'unknown';

export function zigbeeServiceState(current: ZigbeeCurrent): ZigbeeServiceState {
  if (current.z2m.container === 'running' && current.z2m.bridge === 'online') return 'running';
  if (current.z2m.container === 'running' && current.z2m.bridge === 'offline') return 'starting';
  if (current.z2m.container === 'restarting') return 'starting';
  if (current.z2m.container === 'stopped' || current.z2m.container === 'missing') return 'stopped';
  return 'unknown';
}

/** Keys the user can switch to: everything plugged except the key already in use. */
export function zigbeeOtherKeys(status: ZigbeeStatus): ZigbeeCandidate[] {
  return status.candidates.filter((candidate) => !candidate.isCurrent);
}

/** Translation key suffix of the sentence under the status title (`ready`, `noKey`…). */
export function zigbeeHeadline(status: ZigbeeStatus): {
  title: 'ready' | 'attention' | 'keyMissing' | 'noKey' | 'newKey' | 'installing';
  hint:
    | 'readyHint'
    | 'attentionStopped'
    | 'attentionOffline'
    | 'attentionBusy'
    | 'keyMissingHint'
    | 'noKeyHint'
    | 'newKeyHint'
    | 'installingHint';
  tone: 'ok' | 'new' | 'busy' | 'warn' | 'idle';
} {
  switch (status.state) {
    case 'READY':
      return { title: 'ready', hint: 'readyHint', tone: 'ok' };
    case 'ATTENTION':
      return {
        title: 'attention',
        hint: status.issues.includes('port-busy')
          ? 'attentionBusy'
          : status.issues.includes('z2m-offline')
            ? 'attentionOffline'
            : 'attentionStopped',
        tone: 'warn',
      };
    case 'KEY_MISSING':
      return { title: 'keyMissing', hint: 'keyMissingHint', tone: 'warn' };
    case 'NEW_KEY':
      return { title: 'newKey', hint: 'newKeyHint', tone: 'new' };
    case 'INSTALLING':
      return { title: 'installing', hint: 'installingHint', tone: 'busy' };
    default:
      return { title: 'noKey', hint: 'noKeyHint', tone: 'idle' };
  }
}

/** The network is searched this often while the screen is open (the box itself is checked every few seconds). */
export const ZIGBEE_NETWORK_SEARCH_SECONDS = 30;

/** Where a key is found: plugged on the box (USB or GPIO) or on the home network. */
export function zigbeeCandidateOrigin(candidate: ZigbeeCandidate): 'box' | 'network' {
  return candidate.kind === 'network' ? 'network' : 'box';
}

export type ZigbeeSearchNotice = 'none' | 'networkFailed' | 'usbFailed' | 'bothFailed' | null;

/**
 * What to tell after a search: nothing when it went well, a simple sentence when a channel failed
 * (the other channel's results are still shown), and the help text when no key was found to choose
 * from (`found`: the keys other than the one in use).
 */
export function zigbeeSearchNotice(
  scan: ZigbeeScanOutcome | undefined,
  found: readonly ZigbeeCandidate[],
): ZigbeeSearchNotice {
  const usbFailed = scan?.usb === 'failed';
  // A missing avahi is not the family's concern: it counts as "no network key found".
  const networkFailed = scan?.network === 'failed';
  if (usbFailed && networkFailed) return 'bothFailed';
  if (found.length === 0 && !usbFailed && !networkFailed) return 'none';
  if (networkFailed) return 'networkFailed';
  if (usbFailed) return 'usbFailed';
  return null;
}

/**
 * One search for everything: keys plugged on the box and keys on the home network. If the combined
 * request breaks (timeout), the box alone is searched so that the plugged keys still show up, and the
 * network is reported as failed. Only when both attempts break does the error go back to the caller.
 */
export async function zigbeeSearch(
  scan: (network: boolean) => Promise<ZigbeeStatus>,
): Promise<ZigbeeStatus> {
  try {
    const status = await scan(true);
    return { ...status, scan: status.scan ?? { usb: 'ok', network: 'ok' } };
  } catch {
    const status = await scan(false);
    return { ...status, scan: { usb: status.scan?.usb ?? 'ok', network: 'failed' } };
  }
}

/** `192.168.1.50`, `192.168.1.50:6638` or `tcp://192.168.1.50:6638` → host and port (6638 by default). */
export function parseZigbeeNetworkAddress(input: string): { host: string; port: number } | null {
  const text = input
    .trim()
    .replace(/^tcp:\/\//i, '')
    .replace(/\/+$/, '');
  const match = /^([A-Za-z0-9][A-Za-z0-9.-]{0,252})(?::(\d{1,5}))?$/.exec(text);
  if (!match?.[1]) return null;
  const port = match[2] ? Number(match[2]) : 6638;
  return port >= 1 && port <= 65535 ? { host: match[1], port } : null;
}
