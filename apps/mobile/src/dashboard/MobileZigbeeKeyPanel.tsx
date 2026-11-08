import {
  ZIGBEE_NETWORK_SEARCH_SECONDS,
  parseZigbeeNetworkAddress,
  zigbeeCandidateTitle,
  zigbeeErrorKey,
  zigbeeHeadline,
  zigbeeInstallRequest,
  zigbeeKnownNotes,
  zigbeeNeedsChoice,
  zigbeeOtherKeys,
  zigbeeRecentResult,
  zigbeeSearch,
  zigbeeSearchNotice,
  zigbeeServiceState,
  zigbeeStatusSchema,
  type ZigbeeCandidate,
  type ZigbeeCurrent,
  type ZigbeeInstall,
  type ZigbeeNoteCode,
  type ZigbeeOption,
  type ZigbeeScanOutcome,
  type ZigbeeStatus,
} from '@elise/contracts';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Lightbulb,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Usb,
  Wifi,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import {
  ChecklistItem,
  PrimaryButton,
  Radar,
  SecondaryButton,
  SetupNotice,
  ss,
} from '../sensors/ui';
import { ZigbeeKeyArt } from './ZigbeeKeyArt';

const MIN_TOUCH = 48;

type Kind = 'usb' | 'network';

/** A key on the home network is configured as `tcp://host:port`; everything else is on the box. */
const portKind = (port: string | null | undefined): Kind =>
  port?.startsWith('tcp://') ? 'network' : 'usb';

function technologyLabel(technology: string) {
  return (
    (
      {
        zstack: t('zigbeeKey.tech.zstack'),
        ember: t('zigbeeKey.tech.ember'),
        deconz: t('zigbeeKey.tech.deconz'),
        zigate: t('zigbeeKey.tech.zigate'),
        zboss: t('zigbeeKey.tech.zboss'),
      } as Record<string, string>
    )[technology] ?? technology
  );
}

export function MobileZigbeeKeyPanel({ server, token }: { server: SavedServer; token: string }) {
  const [status, setStatus] = useState<ZigbeeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // What the last search found on each channel, and whether the family asked for it themselves.
  const [lastScan, setLastScan] = useState<ZigbeeScanOutcome | undefined>(undefined);
  const [searched, setSearched] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(zigbeeStatusSchema.parse(await mobileApi.zigbeeStatus(server, token)));
      setError(false);
    } catch {
      setError(true);
    }
  }, [server, token]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), status?.state === 'INSTALLING' ? 1200 : 3000);
    return () => clearInterval(timer);
  }, [refresh, status?.state]);

  const runSearch = useCallback(async () => {
    const next = await zigbeeSearch(async (network) =>
      zigbeeStatusSchema.parse(await mobileApi.scanZigbee(server, token, network)),
    );
    setStatus(next);
    setLastScan(next.scan);
    setError(false);
  }, [server, token]);

  // One button looks for everything: keys plugged on the box and keys on the home network.
  const search = async () => {
    setBusy(true);
    setSearched(true);
    try {
      await runSearch();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  // The box is watched every few seconds; the home network is slower, so it is searched quietly
  // every half minute.
  const idle = busy || status?.state === 'INSTALLING';
  useEffect(() => {
    if (idle) return;
    const timer = setInterval(
      () => void runSearch().catch(() => undefined),
      ZIGBEE_NETWORK_SEARCH_SECONDS * 1000,
    );
    return () => clearInterval(timer);
  }, [runSearch, idle]);

  if (!status) {
    return (
      <View style={s.card}>
        {error ? (
          <View style={s.centered}>
            <View style={[s.heroIcon, s.heroIconWarning]}>
              <CircleAlert size={34} color={ss.warning} />
            </View>
            <Text style={s.cardTitle}>{t('zigbeeKey.unavailableTitle')}</Text>
            <Text style={[s.body, s.textCenter]}>{t('zigbeeKey.unavailableText')}</Text>
            <SecondaryButton
              label={t('zigbeeKey.retry')}
              icon={<RefreshCw size={19} color={ss.ink} />}
              onPress={() => void refresh()}
            />
          </View>
        ) : (
          <View style={s.loading}>
            <ActivityIndicator color={ss.accent} />
            <Text style={s.body}>{t('zigbeeKey.loading')}</Text>
          </View>
        )}
      </View>
    );
  }

  const otherKeys = zigbeeOtherKeys(status);
  const installing = status.state === 'INSTALLING';
  const searchNotice = lastScan ? zigbeeSearchNotice(lastScan, otherKeys) : null;
  const result = zigbeeRecentResult(status.install);
  const shownResult = result && result.finishedAt !== dismissedAt ? result : null;
  const working = Boolean(status.current?.present);
  const showEmpty =
    !installing &&
    !busy &&
    otherKeys.length === 0 &&
    ((searched && searchNotice === 'none') || status.state === 'NO_KEY');

  return (
    <View style={s.stack}>
      {installing ? (
        <InstallProgress
          install={status.install}
          onStop={() => void mobileApi.cancelZigbeeInstall(server, token).then(refresh)}
        />
      ) : shownResult ? (
        <InstallResult
          install={shownResult}
          current={status.current}
          onDismiss={() => setDismissedAt(shownResult.finishedAt)}
        />
      ) : (
        <KeyHero
          status={status}
          newKeys={status.state === 'NEW_KEY' ? otherKeys.length : 0}
          busy={busy}
          onSearch={() => void search()}
        />
      )}

      {!installing && !busy ? (
        <View style={s.watching}>
          <View style={s.watchingDot} />
          <Text style={s.watchingText}>{t('zigbeeKey.watching')}</Text>
        </View>
      ) : null}

      {busy ? <SearchProgress /> : null}

      {!installing && !busy && searchNotice && searchNotice !== 'none' ? (
        <SetupNotice tone="warning">{t(`zigbeeKey.searchNotice.${searchNotice}`)}</SetupNotice>
      ) : null}

      {showEmpty ? (
        <EmptyState
          title={
            status.state === 'NO_KEY' && !searched
              ? t('zigbeeKey.emptyNoKeyTitle')
              : t('zigbeeKey.searchNotice.none')
          }
          onSearch={status.state === 'NO_KEY' ? null : () => void search()}
        />
      ) : null}

      {!installing && otherKeys.length > 0 ? (
        <View style={s.found}>
          {working || otherKeys.length > 1 ? (
            <View style={s.foundHeader}>
              {working ? (
                <Text style={s.sectionTitle} accessibilityRole="header">
                  {t('zigbeeKey.otherKeyTitle', { count: otherKeys.length })}
                </Text>
              ) : null}
              <Text style={s.body}>
                {working ? t('zigbeeKey.otherKeyHint') : t('zigbeeKey.multipleHint')}
              </Text>
            </View>
          ) : null}
          {otherKeys.map((candidate) => (
            <Candidate
              key={candidate.id}
              candidate={candidate}
              replacing={Boolean(status.current)}
              server={server}
              token={token}
              refresh={refresh}
            />
          ))}
        </View>
      ) : null}

      {!installing ? (
        <AdvancedNetwork status={status} server={server} token={token} refresh={refresh} />
      ) : null}
    </View>
  );
}

/** Drawing of the key in a soft tile, with a small round badge as on the sensor "found" page. */
function KeyPicture({
  kind,
  size = 'large',
  badge,
  muted,
}: {
  kind: Kind;
  size?: 'large' | 'small';
  badge?: 'ok' | 'warn' | 'new' | null;
  muted?: boolean;
}) {
  const tile = size === 'large' ? 92 : 64;
  return (
    <View
      style={{ width: tile + 8, height: tile + 8, justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          s.pictureTile,
          { width: tile, height: tile, borderRadius: size === 'large' ? 26 : 19 },
        ]}
      >
        <ZigbeeKeyArt kind={kind} size={tile * 0.84} muted={muted} />
      </View>
      {badge ? (
        <View
          style={[
            s.pictureBadge,
            badge === 'new' && { backgroundColor: ss.accent },
            badge === 'warn' && { backgroundColor: '#c27a17' },
          ]}
        >
          {badge === 'ok' ? (
            <Check size={16} color="#fff" strokeWidth={3.4} />
          ) : badge === 'new' ? (
            <PlugZap size={15} color="#fff" strokeWidth={2.6} />
          ) : (
            <CircleAlert size={16} color="#fff" strokeWidth={2.6} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'neutral'; children: string }) {
  const palette = {
    ok: { bg: ss.successSoft, fg: '#17744f' },
    warn: { bg: ss.warningSoft, fg: '#8a520c' },
    neutral: { bg: ss.fill, fg: ss.ink2 },
  }[tone];
  return (
    <View style={[s.pill, { backgroundColor: palette.bg }]}>
      <View style={[s.pillDot, { backgroundColor: palette.fg }]} />
      <Text style={[s.pillText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

function OriginTag({ kind, address }: { kind: Kind; address?: string | null }) {
  const color = kind === 'network' ? '#3d6aa8' : ss.accent;
  const Icon = kind === 'network' ? Wifi : Usb;
  return (
    <View style={s.origin}>
      <Icon size={16} color={color} strokeWidth={2.2} />
      <Text style={[s.originText, { color }]}>
        {kind === 'network' ? t('zigbeeKey.onNetwork') : t('zigbeeKey.pluggedOn')}
      </Text>
      {address ? <Text style={s.address}>{address}</Text> : null}
    </View>
  );
}

function KeyHero({
  status,
  newKeys,
  busy,
  onSearch,
}: {
  status: ZigbeeStatus;
  newKeys: number;
  busy: boolean;
  onSearch: () => void;
}) {
  const [details, setDetails] = useState(false);
  const headline = zigbeeHeadline(status);
  const current = status.current;
  const kind = portKind(current?.port);
  const title =
    headline.title === 'newKey'
      ? t('zigbeeKey.newKeyTitle', { count: Math.max(1, newKeys) })
      : t(
          `zigbeeKey.${
            (
              {
                ready: 'readyTitle',
                attention: 'attentionTitle',
                keyMissing: 'keyMissingTitle',
                noKey: 'noKeyTitle',
                installing: 'installingTitle',
              } as const
            )[headline.title]
          }`,
        );
  const badge =
    headline.tone === 'ok' ? 'ok' : headline.tone === 'new' ? 'new' : current ? 'warn' : null;
  const service = current ? zigbeeServiceState(current) : null;
  const notes = zigbeeKnownNotes(current?.model?.notes ?? []);
  const primary = status.state === 'NEW_KEY' || status.state === 'NO_KEY';
  const searchLabel = busy ? t('zigbeeKey.searching') : t('zigbeeKey.search');
  const searchIcon = <ScanSearch size={20} color={primary ? '#fff' : ss.ink} />;
  return (
    <View style={[s.card, s.hero, headline.tone === 'warn' && s.heroWarn]}>
      <View style={s.heroTop}>
        <KeyPicture kind={current ? kind : 'usb'} badge={badge} muted={status.state === 'NO_KEY'} />
        <View style={s.flex}>
          {current ? (
            <Text style={s.eyebrow}>{t('zigbeeKey.currentKey').toUpperCase()}</Text>
          ) : null}
          {service ? (
            <Pill tone={service === 'running' ? 'ok' : service === 'starting' ? 'warn' : 'neutral'}>
              {t(
                `zigbeeKey.${
                  (
                    {
                      running: 'serviceRunning',
                      starting: 'serviceStarting',
                      stopped: 'serviceStopped',
                      unknown: 'serviceUnknown',
                    } as const
                  )[service]
                }`,
              )}
            </Pill>
          ) : null}
        </View>
      </View>
      <View style={s.titles}>
        <Text style={s.heroTitle} accessibilityRole="header">
          {title}
        </Text>
        <Text style={s.body}>{t(`zigbeeKey.${headline.hint}`)}</Text>
      </View>

      {/* While searching the details fold away, so that the search shows right under the title. */}
      {current && !busy ? (
        <>
          <View style={s.facts}>
            <FactRow
              label={t('zigbeeKey.model')}
              value={current.model?.name ?? current.usb?.product ?? t('zigbeeKey.unknownModel')}
            />
            <FactRow
              label={t('zigbeeKey.devices')}
              value={
                current.deviceCount == null
                  ? '—'
                  : t('zigbeeKey.deviceCount', { count: current.deviceCount })
              }
            />
            <View style={[s.factRow, s.factRowLast]}>
              <Text style={s.factLabel}>{t('zigbeeKey.connection')}</Text>
              <OriginTag kind={kind} />
            </View>
          </View>
          {notes.length > 0 ? <Tips notes={notes} /> : null}
          <Disclosure
            label={t('zigbeeKey.technicalDetails')}
            open={details}
            onToggle={() => setDetails(!details)}
          />
          {details ? <TechnicalDetails current={current} /> : null}
        </>
      ) : null}

      {primary ? (
        <PrimaryButton label={searchLabel} busy={busy} icon={searchIcon} onPress={onSearch} />
      ) : (
        <SecondaryButton
          label={searchLabel}
          disabled={busy}
          icon={busy ? <ActivityIndicator color={ss.ink} /> : searchIcon}
          onPress={onSearch}
        />
      )}
    </View>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.factRow} accessible accessibilityLabel={`${label} : ${value}`}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Tips({ notes }: { notes: ZigbeeNoteCode[] }) {
  return (
    <View style={s.tips} accessibilityLabel={t('zigbeeKey.tips')}>
      {notes.map((note) => (
        <View key={note} style={s.tipRow}>
          <Lightbulb size={17} color="#b07a12" strokeWidth={2.2} />
          <Text style={s.tipText}>{t(`zigbeeKey.note.${note}`)}</Text>
        </View>
      ))}
    </View>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
  icon,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  icon?: ReactNode;
}) {
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [s.disclosure, pressed && s.pressed]}
      onPress={onToggle}
    >
      {icon}
      <Text style={s.disclosureText}>{label}</Text>
      <Chevron size={18} color={ss.accent} />
    </Pressable>
  );
}

function TechnicalDetails({ current }: { current: ZigbeeCurrent }) {
  const coordinator = current.coordinator;
  const rows: [string, string | null | undefined][] = [
    [t('zigbeeKey.technology'), technologyLabel(current.adapter)],
    [t('zigbeeKey.chip'), current.model?.chip],
    [t('zigbeeKey.port'), current.port],
    [t('zigbeeKey.firmware'), coordinator?.firmware],
    [t('zigbeeKey.channel'), coordinator?.channel != null ? String(coordinator.channel) : null],
    [t('zigbeeKey.panId'), coordinator?.panId],
    [t('zigbeeKey.ieee'), coordinator?.ieee],
  ];
  return (
    <View style={s.technical}>
      {rows
        .filter((row): row is [string, string] => Boolean(row[1]))
        .map(([label, value]) => (
          <View key={label} style={s.technicalRow}>
            <Text style={s.technicalLabel}>{label}</Text>
            <Text selectable style={s.technicalValue}>
              {value}
            </Text>
          </View>
        ))}
    </View>
  );
}

function SearchProgress() {
  return (
    <View
      style={[s.card, s.centered]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('zigbeeKey.searchingTitle')}
    >
      <View style={s.radar}>
        <Radar detected={false} ratio={0}>
          <ScanSearch size={38} color={ss.accent} />
        </Radar>
      </View>
      <Text style={s.cardTitle}>{t('zigbeeKey.searchingTitle')}</Text>
      <Text style={[s.body, s.textCenter]}>{t('zigbeeKey.searchingText')}</Text>
      <View style={s.checklist}>
        <ChecklistItem state="active">{t('zigbeeKey.searchUsb')}</ChecklistItem>
        <ChecklistItem state="active">{t('zigbeeKey.searchNetwork')}</ChecklistItem>
      </View>
    </View>
  );
}

function EmptyState({ title, onSearch }: { title: string; onSearch: (() => void) | null }) {
  return (
    <View style={s.card}>
      <View style={s.titles}>
        <Text style={s.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        <Text style={s.body}>{t('zigbeeKey.emptyText')}</Text>
      </View>
      {(['usb', 'network'] as const).map((kind) => (
        <View key={kind} style={s.way}>
          <KeyPicture kind={kind} size="small" />
          <View style={[s.flex, s.wayText]}>
            <OriginTag kind={kind} />
            <Text style={s.small}>
              {kind === 'usb' ? t('zigbeeKey.emptyUsb') : t('zigbeeKey.emptyNetwork')}
            </Text>
          </View>
        </View>
      ))}
      {onSearch ? (
        <SecondaryButton
          label={t('zigbeeKey.searchAgain')}
          icon={<RefreshCw size={19} color={ss.ink} />}
          onPress={onSearch}
        />
      ) : null}
    </View>
  );
}

function InstallProgress({ install, onStop }: { install: ZigbeeInstall; onStop: () => void }) {
  const progress = install.progress ?? 0;
  const name = install.target?.modelName ?? install.target?.port ?? '';
  return (
    <View style={[s.card, s.centered]} accessibilityLabel={t('zigbeeKey.stepsTitle')}>
      <View style={s.radar}>
        <Radar detected={false} ratio={progress / 100}>
          <ZigbeeKeyArt kind={portKind(install.target?.port)} size={76} />
        </Radar>
      </View>
      <Text style={[s.eyebrow, s.textCenter]}>
        {`${t('zigbeeKey.installingTitle')} · ${progress} %`.toUpperCase()}
      </Text>
      <Text style={[s.cardTitle, s.textCenter]}>{name}</Text>
      <Text style={[s.body, s.textCenter]}>{t('zigbeeKey.installingHint')}</Text>
      <View style={s.checklist}>
        {install.steps.map((step) => (
          <ChecklistItem
            key={step.id}
            state={step.state === 'done' ? 'done' : step.state === 'running' ? 'active' : 'waiting'}
          >
            {t(`zigbeeKey.step.${step.id}`)}
          </ChecklistItem>
        ))}
      </View>
      <View style={s.fullWidth}>
        <SecondaryButton
          label={t('zigbeeKey.stop')}
          icon={<X size={19} color={ss.ink} />}
          onPress={onStop}
        />
      </View>
    </View>
  );
}

function InstallResult({
  install,
  current,
  onDismiss,
}: {
  install: ZigbeeInstall;
  current: ZigbeeCurrent | null;
  onDismiss: () => void;
}) {
  const succeeded = install.state === 'SUCCEEDED';
  const cancelled = install.state === 'CANCELLED';
  const failed = install.state === 'FAILED';
  const name = install.target?.modelName ?? current?.model?.name ?? '';
  return (
    <View style={[s.card, s.centered, succeeded ? s.resultOk : !cancelled && s.heroWarn]}>
      {succeeded ? (
        <View style={s.doneHero}>
          <KeyPicture kind={portKind(install.target?.port ?? current?.port)} badge="ok" />
        </View>
      ) : (
        <View style={[s.heroIcon, !cancelled && s.heroIconWarning]}>
          {cancelled ? (
            <RotateCcw size={34} color={ss.accent} />
          ) : (
            <TriangleAlert size={34} color={ss.warning} />
          )}
        </View>
      )}
      {succeeded ? (
        <Text style={[s.eyebrow, s.textCenter]}>{t('zigbeeKey.successEyebrow').toUpperCase()}</Text>
      ) : null}
      <Text style={[s.resultTitle, s.textCenter]} accessibilityRole="header">
        {succeeded
          ? t('zigbeeKey.successTitle')
          : cancelled
            ? t('zigbeeKey.cancelledTitle')
            : failed
              ? t('zigbeeKey.failedTitle')
              : t('zigbeeKey.rolledBackTitle')}
      </Text>
      <Text style={[s.body, s.textCenter]}>
        {succeeded
          ? t('zigbeeKey.successText', { name })
          : cancelled
            ? t('zigbeeKey.cancelledText')
            : failed
              ? t('zigbeeKey.failedText')
              : t('zigbeeKey.rolledBackText')}
      </Text>
      {!succeeded && install.errorCode ? (
        <SetupNotice tone="warning">
          {t(`zigbeeKey.error.${zigbeeErrorKey(install.errorCode)}`, {
            detail: install.detail ?? '',
          })}
        </SetupNotice>
      ) : null}
      <View style={s.fullWidth}>
        <PrimaryButton
          label={succeeded ? t('zigbeeKey.done') : t('zigbeeKey.dismiss')}
          icon={succeeded ? <Check size={20} color="#fff" strokeWidth={2.8} /> : undefined}
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}

function Candidate({
  candidate,
  replacing,
  server,
  token,
  refresh,
}: {
  candidate: ZigbeeCandidate;
  replacing: boolean;
  server: SavedServer;
  token: string;
  refresh: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<ZigbeeOption | null>(
    candidate.identity.options.length === 1 ? (candidate.identity.options[0] ?? null) : null,
  );
  const [probing, setProbing] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [keepNetwork, setKeepNetwork] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [tips, setTips] = useState(false);
  const identity = candidate.identity;
  const needsChoice = zigbeeNeedsChoice(candidate);
  const kind: Kind = candidate.kind === 'network' ? 'network' : 'usb';
  const notes = zigbeeKnownNotes(identity.notes);
  const confidence =
    identity.confidence === 'high' || identity.confidence === 'medium'
      ? 'ok'
      : identity.confidence === 'ambiguous'
        ? 'confirm'
        : 'unknown';
  const meta = [
    identity.confidence !== 'unknown' ? identity.chip : null,
    choice ? technologyLabel(choice.technology) : null,
  ].filter(Boolean);

  const identify = async () => {
    setProbing(true);
    try {
      const result = await mobileApi.probeZigbee(server, token, candidate.id);
      const only = result.candidate.identity.options[0];
      if (result.candidate.identity.options.length === 1 && only) {
        setChoice(only);
        setAnswered(result.answered);
      }
      await refresh();
    } finally {
      setProbing(false);
    }
  };
  const install = async () => {
    if (!choice) return;
    setInstalling(true);
    try {
      await mobileApi.installZigbee(
        server,
        token,
        zigbeeInstallRequest(candidate, choice, keepNetwork ? 'keep' : 'new'),
      );
      await refresh();
    } finally {
      setInstalling(false);
    }
  };
  return (
    <View style={s.card}>
      <View style={s.candidateTop}>
        <KeyPicture kind={kind} size="small" />
        <View style={[s.flex, s.candidateCopy]}>
          <Text style={s.candidateTitle}>
            {zigbeeCandidateTitle(candidate) ?? t('zigbeeKey.unknownModel')}
          </Text>
          <Pill tone={confidence === 'ok' ? 'ok' : confidence === 'confirm' ? 'warn' : 'neutral'}>
            {confidence === 'ok'
              ? t('zigbeeKey.recognized')
              : confidence === 'confirm'
                ? t('zigbeeKey.toConfirm')
                : t('zigbeeKey.unknownKey')}
          </Pill>
        </View>
      </View>
      <View style={s.candidateInfo}>
        <OriginTag
          kind={kind}
          address={candidate.network ? `${candidate.network.host}:${candidate.network.port}` : null}
        />
        {meta.length > 0 ? <Text style={s.meta}>{meta.join(' · ')}</Text> : null}
      </View>

      {needsChoice && !choice ? (
        <Text style={s.small}>{t('zigbeeKey.ambiguousExplain')}</Text>
      ) : null}
      {answered && choice ? (
        <SetupNotice tone="success">
          {choice.modelName
            ? t('zigbeeKey.identified', { name: choice.modelName })
            : t('zigbeeKey.identifiedGeneric', { technology: technologyLabel(choice.technology) })}
        </SetupNotice>
      ) : null}
      {identity.confidence === 'unknown' ? (
        <Text style={s.small}>
          {t('zigbeeKey.unknownExplain', {
            id: candidate.usb ? `${candidate.usb.vid}:${candidate.usb.pid}` : '—',
          })}
        </Text>
      ) : null}
      {candidate.busy ? (
        <SetupNotice tone="warning">{t('zigbeeKey.busyBy', { by: candidate.busy.by })}</SetupNotice>
      ) : null}
      {notes.length > 0 && !confirming ? (
        <>
          <Disclosure
            label={t('zigbeeKey.tipsCount', { count: notes.length })}
            open={tips}
            onToggle={() => setTips(!tips)}
            icon={<Lightbulb size={17} color="#b07a12" strokeWidth={2.2} />}
          />
          {tips ? <Tips notes={notes} /> : null}
        </>
      ) : null}

      {needsChoice && !choice ? (
        <PrimaryButton
          label={probing ? t('zigbeeKey.identifying') : t('zigbeeKey.identify')}
          busy={probing}
          icon={<ScanSearch size={20} color="#fff" />}
          onPress={() => void identify()}
        />
      ) : null}
      {choice && !confirming && !candidate.busy ? (
        <PrimaryButton
          label={replacing ? t('zigbeeKey.useKeyInstead') : t('zigbeeKey.useKey')}
          icon={<PlugZap size={20} color="#fff" />}
          onPress={() => setConfirming(true)}
        />
      ) : null}
      {confirming && choice ? (
        <View style={s.confirm}>
          <View style={s.confirmTitle}>
            <ShieldCheck size={20} color={ss.success} />
            <Text style={[s.candidateTitle, s.flex]}>
              {t('zigbeeKey.confirmTitle', {
                name: choice.modelName ?? zigbeeCandidateTitle(candidate) ?? '',
              })}
            </Text>
          </View>
          <Text style={s.small}>{t('zigbeeKey.confirmText')}</Text>
          {replacing ? (
            <View style={s.choices} accessibilityRole="radiogroup">
              <Text style={s.choicesLegend}>{t('zigbeeKey.sensorsTitle')}</Text>
              {[true, false].map((keep) => (
                <Pressable
                  key={String(keep)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: keepNetwork === keep }}
                  style={[s.choice, keepNetwork === keep && s.choiceOn]}
                  onPress={() => setKeepNetwork(keep)}
                >
                  <View style={[s.radio, keepNetwork === keep && s.radioOn]}>
                    {keepNetwork === keep ? <View style={s.radioDot} /> : null}
                  </View>
                  <View style={s.flex}>
                    <Text style={s.choiceTitle}>
                      {keep ? t('zigbeeKey.keepNetwork') : t('zigbeeKey.newNetwork')}
                    </Text>
                    <Text style={s.small}>
                      {keep ? t('zigbeeKey.keepNetworkHint') : t('zigbeeKey.newNetworkHint')}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
          <PrimaryButton
            label={t('zigbeeKey.install')}
            busy={installing}
            icon={<ShieldCheck size={20} color="#fff" />}
            onPress={() => void install()}
          />
          <SecondaryButton label={t('zigbeeKey.cancel')} onPress={() => setConfirming(false)} />
        </View>
      ) : null}
    </View>
  );
}

function AdvancedNetwork({
  status,
  server,
  token,
  refresh,
}: {
  status: ZigbeeStatus;
  server: SavedServer;
  token: string;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const parsed = parseZigbeeNetworkAddress(address);
  const networkKeys = status.candidates.filter((candidate) => candidate.kind === 'network');
  const test = async () => {
    if (!parsed) return;
    setTesting(true);
    setResult(null);
    try {
      await mobileApi.testZigbeeNetwork(server, token, parsed.host, parsed.port);
      setResult('ok');
      await refresh();
    } catch {
      setResult('fail');
    } finally {
      setTesting(false);
    }
  };
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [s.advancedSummary, pressed && s.pressed]}
        onPress={() => setOpen(!open)}
      >
        <View style={s.advancedIcon}>
          <Settings2 size={20} color={ss.accent} />
        </View>
        <View style={s.flex}>
          <Text style={s.candidateTitle}>{t('zigbeeKey.advanced')}</Text>
          <Text style={s.small}>{t('zigbeeKey.advancedHint')}</Text>
        </View>
        {open ? (
          <ChevronUp size={20} color={ss.accent} />
        ) : (
          <ChevronDown size={20} color={ss.accent} />
        )}
      </Pressable>
      {open ? (
        <View style={s.advancedGroup}>
          <View style={s.advancedTitle}>
            <Wifi size={18} color={ss.accent} />
            <Text style={s.choiceTitle}>{t('zigbeeKey.networkSection')}</Text>
          </View>
          <Text style={s.small}>{t('zigbeeKey.networkSectionHint')}</Text>
          <Text style={s.fieldLabel}>{t('zigbeeKey.networkAddress')}</Text>
          <TextInput
            testID="zigbee-address"
            style={s.input}
            value={address}
            onChangeText={setAddress}
            placeholder={t('zigbeeKey.networkPlaceholder')}
            placeholderTextColor={ss.ink3}
            accessibilityLabel={t('zigbeeKey.networkAddress')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <SecondaryButton
            label={testing ? t('zigbeeKey.testing') : t('zigbeeKey.testAddress')}
            disabled={!parsed || testing}
            icon={
              testing ? <ActivityIndicator color={ss.ink} /> : <Wifi size={19} color={ss.ink} />
            }
            onPress={() => void test()}
          />
          {result ? (
            <SetupNotice tone={result === 'ok' ? 'success' : 'danger'}>
              {result === 'ok' ? t('zigbeeKey.addressOk') : t('zigbeeKey.addressFail')}
            </SetupNotice>
          ) : null}
          {networkKeys.map((candidate) => (
            <View key={candidate.id} style={s.remembered}>
              <Wifi size={16} color={ss.accent} />
              <Text style={[s.technicalValue, s.flex]}>{candidate.port}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 14 },
  flex: { flex: 1 },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.7 },
  textCenter: { textAlign: 'center' },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: ss.line,
    borderRadius: 24,
    backgroundColor: ss.bg,
    gap: 14,
    shadowColor: '#102e49',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  centered: { alignItems: 'center' },
  // The sensor radar, a little smaller inside a card.
  radar: { marginVertical: -34, transform: [{ scale: 0.72 }] },
  hero: { gap: 16 },
  heroWarn: { borderColor: '#f0dcbc', backgroundColor: '#fffdf9' },
  resultOk: { backgroundColor: '#fbfefc' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  titles: { gap: 6 },
  eyebrow: { color: ss.accent, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  heroTitle: {
    color: ss.ink,
    fontFamily: 'Georgia',
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  cardTitle: { color: ss.ink, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  sectionTitle: { color: ss.ink, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  resultTitle: { color: ss.ink, fontSize: 24, lineHeight: 29, fontWeight: '700' },
  body: { color: ss.ink2, fontSize: 16, lineHeight: 23 },
  small: { color: ss.ink2, fontSize: 15, lineHeight: 21 },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.accentSoft,
  },
  heroIconWarning: { backgroundColor: ss.warningSoft },
  loading: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 10 },
  pictureTile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f6',
  },
  pictureBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.success,
    borderWidth: 3,
    borderColor: '#fff',
  },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 6,
    paddingVertical: 4,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 999,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },
  origin: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  originText: { fontSize: 15, fontWeight: '600' },
  address: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: ss.fill,
    color: ss.ink2,
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  facts: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ss.line },
  factRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ss.line,
  },
  factRowLast: { borderBottomWidth: 0 },
  factLabel: { color: ss.ink2, fontSize: 15 },
  factValue: { flexShrink: 1, color: ss.ink, fontSize: 15, fontWeight: '700', textAlign: 'right' },
  tips: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: ss.fill },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tipText: { flex: 1, color: ss.ink2, fontSize: 14, lineHeight: 20 },
  disclosure: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8 },
  disclosureText: { flex: 1, color: ss.accent, fontSize: 16, fontWeight: '600' },
  technical: {
    marginTop: -6,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: ss.fill,
  },
  technicalRow: {
    paddingVertical: 9,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ss.fill2,
  },
  technicalLabel: { color: ss.ink2, fontSize: 13 },
  technicalValue: { color: ss.ink, fontFamily: 'Menlo', fontSize: 13 },
  watching: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
  watchingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ss.accent,
    shadowColor: ss.accent,
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  watchingText: { flex: 1, color: ss.ink3, fontSize: 14, lineHeight: 19 },
  checklist: {
    alignSelf: 'stretch',
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: ss.fill,
  },
  way: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: ss.fill,
  },
  wayText: { gap: 4 },
  found: { gap: 12 },
  foundHeader: { gap: 4, paddingHorizontal: 4, paddingTop: 6 },
  candidateTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  candidateCopy: { gap: 0 },
  candidateTitle: { color: ss.ink, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  candidateInfo: { gap: 4 },
  meta: { color: ss.ink3, fontSize: 14 },
  confirm: { gap: 12, padding: 14, borderRadius: 18, backgroundColor: ss.fill },
  confirmTitle: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  choices: { gap: 8 },
  choicesLegend: { color: ss.ink, fontSize: 15, fontWeight: '700' },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 13,
    borderWidth: 1.5,
    borderColor: ss.line,
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  choiceOn: { borderColor: ss.accent },
  choiceTitle: { color: ss.ink, fontSize: 16, fontWeight: '700' },
  radio: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: ss.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: ss.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ss.primary },
  doneHero: { marginTop: 4 },
  advancedSummary: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12 },
  advancedIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.accentSoft,
  },
  advancedGroup: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: ss.fill },
  advancedTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldLabel: { marginTop: 4, color: ss.ink, fontSize: 14, fontWeight: '700' },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#d3dee5',
    borderRadius: 14,
    backgroundColor: '#fff',
    color: ss.ink,
    fontSize: 16,
  },
  remembered: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
});
