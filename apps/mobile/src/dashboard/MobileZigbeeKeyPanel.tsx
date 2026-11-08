import { Ionicons } from '@expo/vector-icons';
import {
  ZIGBEE_NETWORK_SEARCH_SECONDS,
  parseZigbeeNetworkAddress,
  zigbeeCandidateTitle,
  zigbeeErrorKey,
  zigbeeHeadline,
  zigbeeInstallRequest,
  zigbeeNeedsChoice,
  zigbeeOtherKeys,
  zigbeeSearch,
  zigbeeSearchNotice,
  zigbeeServiceState,
  zigbeeStatusSchema,
  type ZigbeeCandidate,
  type ZigbeeOption,
  type ZigbeeScanOutcome,
  type ZigbeeStatus,
} from '@elise/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';

const colors = {
  navy: '#0B2948',
  blue: '#376884',
  muted: '#687382',
  line: '#DED8CE',
  paper: '#FDFBF7',
  green: '#2E7650',
  paleGreen: '#E5F2E9',
  amber: '#8A5918',
  paleAmber: '#FFF0D9',
  paleBlue: '#E8F3F8',
};

export function MobileZigbeeKeyPanel({ server, token }: { server: SavedServer; token: string }) {
  const [status, setStatus] = useState<ZigbeeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  // What the last search found on each channel, and whether the family asked for it themselves.
  const [lastScan, setLastScan] = useState<ZigbeeScanOutcome | undefined>(undefined);
  const [searched, setSearched] = useState(false);

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
          <>
            <Text style={s.title}>{t('zigbeeKey.unavailableTitle')}</Text>
            <Text style={s.body}>{t('zigbeeKey.unavailableText')}</Text>
            <Action label={t('zigbeeKey.retry')} icon="refresh-outline" onPress={refresh} />
          </>
        ) : (
          <View style={s.loading}>
            <ActivityIndicator color={colors.blue} />
            <Text style={s.body}>{t('zigbeeKey.loading')}</Text>
          </View>
        )}
      </View>
    );
  }

  const headline = zigbeeHeadline(status);
  const otherKeys = zigbeeOtherKeys(status);
  const installing = status.state === 'INSTALLING';
  const searchNotice = lastScan ? zigbeeSearchNotice(lastScan, otherKeys) : null;
  const titleKey =
    headline.title === 'newKey'
      ? null
      : (
          {
            ready: 'readyTitle',
            attention: 'attentionTitle',
            keyMissing: 'keyMissingTitle',
            noKey: 'noKeyTitle',
            installing: 'installingTitle',
          } as const
        )[headline.title];

  return (
    <View style={s.stack}>
      <View style={s.card}>
        <View style={s.heading}>
          <View style={s.icon}>
            <Ionicons name="key-outline" size={21} color={colors.blue} />
          </View>
          <View style={s.flex}>
            <Text style={s.eyebrow}>{t('zigbeeKey.eyebrow')}</Text>
            <Text style={s.title}>{t('zigbeeKey.title')}</Text>
          </View>
        </View>
        <View style={[s.hero, headline.tone === 'ok' ? s.heroOk : s.heroBlue]}>
          <Ionicons
            name={
              installing
                ? 'sync-outline'
                : status.state === 'READY'
                  ? 'checkmark-circle-outline'
                  : 'hardware-chip-outline'
            }
            size={34}
            color={headline.tone === 'ok' ? colors.green : colors.blue}
          />
          <View style={s.flex}>
            <Text style={s.heroTitle}>
              {titleKey
                ? t(`zigbeeKey.${titleKey}`)
                : t('zigbeeKey.newKeyTitle', { count: Math.max(1, otherKeys.length) })}
            </Text>
            <Text style={s.body}>{t(`zigbeeKey.${headline.hint}`)}</Text>
          </View>
        </View>
        <View style={s.actions}>
          <Action
            label={busy ? t('zigbeeKey.searching') : t('zigbeeKey.search')}
            icon="scan-outline"
            disabled={busy || installing}
            onPress={() => void search()}
          />
        </View>
        <Text style={s.body}>{t('zigbeeKey.watching')}</Text>
      </View>

      {!installing && !busy && searchNotice && searchNotice !== 'none' ? (
        <View style={[s.card, s.warningCard]}>
          <Text style={s.warningText}>{t(`zigbeeKey.searchNotice.${searchNotice}`)}</Text>
        </View>
      ) : null}
      {!installing && !busy && searched && otherKeys.length === 0 && searchNotice === 'none' ? (
        <View style={s.card}>
          <Text style={s.body}>{t('zigbeeKey.searchNotice.none')}</Text>
        </View>
      ) : null}

      {installing ? (
        <View style={s.card}>
          <Text style={s.title}>{t('zigbeeKey.stepsTitle')}</Text>
          {status.install.steps.map((step) => (
            <View key={step.id} style={s.step}>
              {step.state === 'running' ? (
                <ActivityIndicator size="small" color={colors.blue} />
              ) : (
                <Ionicons
                  name={step.state === 'done' ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={step.state === 'done' ? colors.green : colors.muted}
                />
              )}
              <Text style={[s.body, step.state === 'running' && s.strong]}>
                {t(`zigbeeKey.step.${step.id}`)}
              </Text>
            </View>
          ))}
          {status.install.progress != null ? (
            <Text style={s.progress}>{status.install.progress}%</Text>
          ) : null}
          <Action
            label={t('zigbeeKey.stop')}
            icon="stop-circle-outline"
            outline
            onPress={() => void mobileApi.cancelZigbeeInstall(server, token).then(refresh)}
          />
        </View>
      ) : null}

      {status.install.finishedAt && status.install.state !== 'IDLE' && !installing ? (
        <View
          style={[s.card, status.install.state === 'SUCCEEDED' ? s.successCard : s.warningCard]}
        >
          <Text style={s.title}>
            {status.install.state === 'SUCCEEDED'
              ? t('zigbeeKey.successTitle')
              : t('zigbeeKey.rolledBackTitle')}
          </Text>
          <Text style={s.body}>
            {status.install.state === 'SUCCEEDED'
              ? t('zigbeeKey.successText', { name: status.install.target?.modelName ?? '' })
              : t('zigbeeKey.rolledBackText')}
          </Text>
          {status.install.errorCode ? (
            <Text style={s.warningText}>
              {t(`zigbeeKey.error.${zigbeeErrorKey(status.install.errorCode)}`, {
                detail: status.install.detail ?? '',
              })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {status.current ? (
        <Current status={status} advanced={advanced} setAdvanced={setAdvanced} />
      ) : null}

      {!installing
        ? otherKeys.map((candidate) => (
            <Candidate
              key={candidate.id}
              candidate={candidate}
              replacing={Boolean(status.current)}
              server={server}
              token={token}
              refresh={refresh}
            />
          ))
        : null}

      {!installing ? <AdvancedNetwork server={server} token={token} refresh={refresh} /> : null}
    </View>
  );
}

function AdvancedNetwork({
  server,
  token,
  refresh,
}: {
  server: SavedServer;
  token: string;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const parsed = parseZigbeeNetworkAddress(address);
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
      <Pressable style={s.detailsButton} onPress={() => setOpen(!open)}>
        <Text style={s.detailsText}>{t('zigbeeKey.advanced')}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.blue} />
      </Pressable>
      {open ? (
        <View style={s.technical}>
          <Text style={s.factLabel}>{t('zigbeeKey.networkAddress')}</Text>
          <TextInput
            style={s.input}
            value={address}
            onChangeText={setAddress}
            placeholder={t('zigbeeKey.networkPlaceholder')}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Action
            label={testing ? t('zigbeeKey.testing') : t('zigbeeKey.testAddress')}
            icon="wifi-outline"
            outline
            disabled={!parsed || testing}
            onPress={() => void test()}
          />
          {result ? (
            <Text style={result === 'ok' ? s.goodText : s.warningText}>
              {result === 'ok' ? t('zigbeeKey.addressOk') : t('zigbeeKey.addressFail')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Current({
  status,
  advanced,
  setAdvanced,
}: {
  status: ZigbeeStatus;
  advanced: boolean;
  setAdvanced: (value: boolean) => void;
}) {
  const current = status.current!;
  const service = zigbeeServiceState(current);
  const technology = {
    zstack: t('zigbeeKey.tech.zstack'),
    ember: t('zigbeeKey.tech.ember'),
    deconz: t('zigbeeKey.tech.deconz'),
    zigate: t('zigbeeKey.tech.zigate'),
    zboss: t('zigbeeKey.tech.zboss'),
  }[current.adapter];
  return (
    <View style={s.card}>
      <View style={s.rowBetween}>
        <Text style={s.title}>{t('zigbeeKey.currentKey')}</Text>
        <Text style={s.goodBadge}>
          {service === 'running' ? t('zigbeeKey.serviceRunning') : t('zigbeeKey.serviceStopped')}
        </Text>
      </View>
      <Fact
        label={t('zigbeeKey.model')}
        value={current.model?.name ?? t('zigbeeKey.unknownModel')}
      />
      <Fact label={t('zigbeeKey.technology')} value={technology ?? current.adapter} />
      <Fact
        label={t('zigbeeKey.devices')}
        value={
          current.deviceCount == null
            ? '—'
            : t('zigbeeKey.deviceCount', { count: current.deviceCount })
        }
      />
      <Fact
        label={t('zigbeeKey.channel')}
        value={current.coordinator?.channel?.toString() ?? '—'}
      />
      <Pressable style={s.detailsButton} onPress={() => setAdvanced(!advanced)}>
        <Text style={s.detailsText}>{t('zigbeeKey.technicalDetails')}</Text>
        <Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={18} color={colors.blue} />
      </Pressable>
      {advanced ? (
        <View style={s.technical}>
          <Fact label={t('zigbeeKey.port')} value={current.port} />
          <Fact label={t('zigbeeKey.firmware')} value={current.coordinator?.firmware ?? '—'} />
          <Fact label={t('zigbeeKey.panId')} value={current.coordinator?.panId ?? '—'} />
          <Fact label={t('zigbeeKey.ieee')} value={current.coordinator?.ieee ?? '—'} />
        </View>
      ) : null}
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
    candidate.identity.options.length === 1 ? candidate.identity.options[0] : null,
  );
  const [probing, setProbing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [keepNetwork, setKeepNetwork] = useState(true);
  const [installing, setInstalling] = useState(false);
  const needsChoice = zigbeeNeedsChoice(candidate);
  const identify = async () => {
    setProbing(true);
    try {
      const result = await mobileApi.probeZigbee(server, token, candidate.id);
      if (result.candidate.identity.options.length === 1)
        setChoice(result.candidate.identity.options[0]);
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
      <View style={s.heading}>
        <View style={s.icon}>
          <Ionicons name="hardware-chip-outline" size={21} color={colors.blue} />
        </View>
        <View style={s.flex}>
          <Text style={s.eyebrow}>{t('zigbeeKey.recognized')}</Text>
          <Text style={s.title}>
            {zigbeeCandidateTitle(candidate) ?? t('zigbeeKey.unknownModel')}
          </Text>
          <Text style={s.body}>
            {candidate.network
              ? t('zigbeeKey.networkKey', {
                  address: `${candidate.network.host}:${candidate.network.port}`,
                })
              : t('zigbeeKey.pluggedOn')}
          </Text>
        </View>
      </View>
      {needsChoice && !choice ? (
        <>
          <Text style={s.body}>{t('zigbeeKey.ambiguousExplain')}</Text>
          <Action
            label={probing ? t('zigbeeKey.identifying') : t('zigbeeKey.identify')}
            icon="search-outline"
            disabled={probing}
            onPress={() => void identify()}
          />
        </>
      ) : null}
      {choice && !confirming ? (
        <Action
          label={replacing ? t('zigbeeKey.useKeyInstead') : t('zigbeeKey.useKey')}
          icon="flash-outline"
          onPress={() => setConfirming(true)}
        />
      ) : null}
      {confirming && choice ? (
        <View style={s.confirm}>
          <Text style={s.title}>
            {t('zigbeeKey.confirmTitle', { name: choice.modelName ?? '' })}
          </Text>
          <Text style={s.body}>{t('zigbeeKey.confirmText')}</Text>
          {replacing ? (
            <Pressable style={s.choice} onPress={() => setKeepNetwork(!keepNetwork)}>
              <Ionicons
                name={keepNetwork ? 'radio-button-on' : 'radio-button-off'}
                size={21}
                color={colors.blue}
              />
              <View style={s.flex}>
                <Text style={s.strong}>
                  {keepNetwork ? t('zigbeeKey.keepNetwork') : t('zigbeeKey.newNetwork')}
                </Text>
                <Text style={s.body}>
                  {keepNetwork ? t('zigbeeKey.keepNetworkHint') : t('zigbeeKey.newNetworkHint')}
                </Text>
              </View>
            </Pressable>
          ) : null}
          <View style={s.actions}>
            <Action
              label={t('zigbeeKey.cancel')}
              icon="close-outline"
              outline
              onPress={() => setConfirming(false)}
            />
            <Action
              label={t('zigbeeKey.install')}
              icon="shield-checkmark-outline"
              disabled={installing}
              onPress={() => void install()}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text selectable style={s.factValue}>
        {value}
      </Text>
    </View>
  );
}

function Action({
  label,
  icon,
  onPress,
  outline,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void | Promise<void>;
  outline?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[s.button, outline && s.buttonOutline, disabled && s.disabled]}
      onPress={() => void onPress()}
    >
      <Ionicons name={icon} size={18} color={outline ? colors.blue : '#fff'} />
      <Text style={[s.buttonText, outline && s.buttonTextOutline]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  stack: { gap: 14 },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    backgroundColor: colors.paper,
    gap: 13,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: colors.paleBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  eyebrow: { color: colors.blue, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.navy, fontSize: 18, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  strong: { color: colors.navy, fontWeight: '700' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15, borderRadius: 16 },
  heroOk: { backgroundColor: colors.paleGreen },
  heroBlue: { backgroundColor: colors.paleBlue },
  heroTitle: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
  button: {
    minHeight: 44,
    paddingHorizontal: 15,
    borderRadius: 12,
    backgroundColor: colors.blue,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOutline: { borderWidth: 1, borderColor: colors.blue, backgroundColor: 'transparent' },
  buttonText: { color: '#fff', fontWeight: '700' },
  buttonTextOutline: { color: colors.blue },
  disabled: { opacity: 0.45 },
  loading: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  progress: { color: colors.blue, textAlign: 'right', fontWeight: '800' },
  successCard: { borderColor: '#BCE3CD', backgroundColor: '#F2FBF6' },
  warningCard: { borderColor: '#EFD1A5', backgroundColor: '#FFFAF1' },
  warningText: { color: colors.amber, fontWeight: '600' },
  goodText: { color: colors.green, fontWeight: '600' },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: '#fff',
    color: colors.navy,
    fontSize: 16,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  goodBadge: {
    color: colors.green,
    backgroundColor: colors.paleGreen,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '800',
  },
  fact: {
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  factLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  factValue: { color: colors.navy, marginTop: 3, fontWeight: '600' },
  detailsButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailsText: { color: colors.blue, fontWeight: '700' },
  technical: { gap: 3 },
  confirm: { padding: 14, borderRadius: 14, backgroundColor: '#F4F7F8', gap: 11 },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D8E3E6',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
});
