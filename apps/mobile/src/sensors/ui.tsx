import type { SensorProduct } from '@elise/contracts';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Radio,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
  type ImageSourcePropType,
  type KeyboardTypeOptions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { t } from '../i18n';
import { sensorImage } from './images';

/** Same palette as the web setup sheet (sensor-setup.css), so both look alike. */
export const ss = {
  ink: '#102e49',
  ink2: '#4f677a',
  ink3: '#6b7f8e',
  bg: '#ffffff',
  fill: '#f2f5f7',
  fill2: '#e8eef2',
  line: '#e2e9ee',
  primary: '#17364f',
  accent: '#247fa4',
  accentSoft: '#e5f2f8',
  success: '#1f9467',
  successSoft: '#e3f5ec',
  warning: '#a86512',
  warningSoft: '#fdf2df',
  danger: '#b93a33',
  dangerSoft: '#fbebea',
  groups: {
    activity: '#e6edfb',
    openings: '#f3eafa',
    safety: '#fdece6',
    comfort: '#e2f4f0',
    other: '#eef2f5',
  } as Record<string, string>,
};

const MIN_TOUCH = 48;

// ---------------------------------------------------------------- sheet

type SheetContext = {
  close: () => void;
  busy: boolean;
  setStepBusy: (busy: boolean) => void;
  closeOverride: MutableRefObject<(() => void) | null>;
  backHandler: MutableRefObject<(() => void) | null>;
};
const SheetContext = createContext<SheetContext | null>(null);

/**
 * Full-screen guided sheet: one page at a time, a back button, a progress bar and a
 * footer within thumb reach. Android's back button goes one page back, then closes.
 */
export function SetupSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [stepBusy, setStepBusy] = useState(false);
  const closeOverride = useRef<(() => void) | null>(null);
  const backHandler = useRef<(() => void) | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const busyRef = useRef(false);
  busyRef.current = stepBusy;
  const close = useCallback(() => (closeOverride.current ?? latestClose.current)(), []);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (busyRef.current) return;
        (backHandler.current ?? close)();
      }}
    >
      <SafeAreaProvider>
        <SheetContext.Provider
          value={{ close, busy: stepBusy, setStepBusy, closeOverride, backHandler }}
        >
          <SafeAreaView style={styles.sheet} edges={['top', 'left', 'right']}>
            {children}
          </SafeAreaView>
        </SheetContext.Provider>
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * Lets the page shown in the sheet hold it while it works and decide what closing
 * means (for example cancelling a sensor search before leaving).
 */
export function useSheetControls({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  const sheet = useContext(SheetContext);
  const latest = useRef(onClose);
  latest.current = onClose;
  const setStepBusy = sheet?.setStepBusy;
  const closeOverride = sheet?.closeOverride;
  useEffect(() => {
    setStepBusy?.(busy);
  }, [busy, setStepBusy]);
  useEffect(() => {
    if (!closeOverride) return;
    closeOverride.current = () => latest.current();
    return () => {
      closeOverride.current = null;
      setStepBusy?.(false);
    };
  }, [closeOverride, setStepBusy]);
}

export type SetupDirection = 'forward' | 'back';

/** Remembers which way the person last moved, so pages slide in from the right side. */
export function useSetupStep<T>(initial: T) {
  const [state, setState] = useState<{ step: T; direction: SetupDirection }>({
    step: initial,
    direction: 'forward',
  });
  return {
    step: state.step,
    direction: state.direction,
    go: (step: T) => setState({ step, direction: 'forward' }),
    back: (step: T) => setState({ step, direction: 'back' }),
    reset: (step: T) => setState({ step, direction: 'forward' }),
  };
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => alive && setReduce(value));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

export function SetupPage({
  pageKey,
  direction = 'forward',
  progress,
  eyebrow,
  title,
  subtitle,
  hero,
  onBack,
  backLabel,
  footer,
  centered = false,
  children,
}: {
  pageKey: string;
  direction?: SetupDirection;
  progress?: { value: number; total: number; label?: string | undefined } | undefined;
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  hero?: ReactNode;
  onBack?: (() => void) | undefined;
  backLabel?: string | undefined;
  footer?: ReactNode;
  centered?: boolean;
  children?: ReactNode;
}) {
  const sheet = useContext(SheetContext);
  const heading = useRef<Text>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const busy = sheet?.busy ?? false;
  const backHandler = sheet?.backHandler;
  const latestBack = useRef(onBack);
  latestBack.current = onBack;

  useEffect(() => {
    if (!backHandler) return;
    backHandler.current = onBack ? () => latestBack.current?.() : null;
    return () => {
      backHandler.current = null;
    };
  }, [backHandler, onBack]);

  useEffect(() => {
    // Screen readers announce each new page as the person moves through the flow.
    const timer = setTimeout(() => {
      const node = heading.current ? findNodeHandle(heading.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 350);
    if (reduceMotion) slide.setValue(1);
    else {
      slide.setValue(0);
      Animated.timing(slide, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    return () => clearTimeout(timer);
    // One animation per page; `slide` and `reduceMotion` do not identify a new page.
  }, [pageKey]);

  if (!sheet) throw new Error('SetupPage must be rendered inside SetupSheet');
  const ratio = progress ? Math.min(1, Math.max(0, progress.value / progress.total)) : 0;
  const offset = direction === 'forward' ? 28 : -28;
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={backLabel ?? t('sensorSetup.back')}
              onPress={onBack}
              disabled={busy}
              hitSlop={6}
              style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
            >
              <ChevronLeft size={24} color={ss.accent} strokeWidth={2.4} />
              <Text style={styles.navText} numberOfLines={1}>
                {backLabel ?? t('sensorSetup.back')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {progress ? (
          <Text style={styles.step} accessibilityLiveRegion="polite">
            {progress.label ??
              t('sensorSetup.stepOf', { value: progress.value, total: progress.total })}
          </Text>
        ) : null}
        <View style={[styles.headerSide, styles.headerEnd]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sensorSetup.close')}
            onPress={sheet.close}
            disabled={busy}
            hitSlop={6}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <X size={22} color={ss.ink} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>
      <View
        style={[styles.progress, !progress && styles.hidden]}
        accessibilityRole="progressbar"
        accessibilityLabel={t('sensorSetup.progress')}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      >
        <View style={[styles.progressValue, { width: `${ratio * 100}%` }]} />
      </View>
      <Animated.View
        style={[
          styles.flex,
          {
            opacity: slide,
            transform: [
              { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) },
            ],
          },
        ]}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.body, centered && styles.bodyCentered]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {hero}
          <View style={[styles.titles, centered && styles.titlesCentered]}>
            {eyebrow ? (
              <View style={[styles.eyebrowRow, centered && styles.eyebrowCentered]}>
                {typeof eyebrow === 'string' ? (
                  <Text style={styles.eyebrow} accessibilityLiveRegion="polite">
                    {eyebrow.toUpperCase()}
                  </Text>
                ) : (
                  eyebrow
                )}
              </View>
            ) : null}
            <Text
              ref={heading}
              accessible
              accessibilityRole="header"
              style={[styles.title, centered && styles.textCentered]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text style={[styles.subtitle, centered && styles.textCentered]}>{subtitle}</Text>
            ) : null}
          </View>
          {children}
        </ScrollView>
      </Animated.View>
      {footer ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {footer}
        </SafeAreaView>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function PlaceChip({ children }: { children: ReactNode }) {
  return (
    <View style={styles.place}>
      <Text style={styles.placeText}>{children}</Text>
    </View>
  );
}

export function EyebrowText({ children }: { children: string }) {
  return <Text style={styles.eyebrow}>{children.toUpperCase()}</Text>;
}

// ---------------------------------------------------------------- buttons

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  icon?: ReactNode;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.primary,
        off && styles.primaryOff,
        pressed && !off && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : icon}
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondary,
        disabled && styles.primaryOff,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon}
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- content blocks

export function SetupSection({
  title,
  aside,
  children,
}: {
  title?: string | undefined;
  aside?: string | undefined;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title || aside ? (
        <View style={styles.sectionHeader}>
          {title ? (
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {title.toUpperCase()}
            </Text>
          ) : (
            <View />
          )}
          {aside ? <Text style={styles.sectionAside}>{aside}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A large tappable card: rooms, sensor kinds. */
export function SetupTile({
  icon,
  tint,
  title,
  detail,
  badge,
  onSelect,
}: {
  icon: ReactNode;
  tint?: string | undefined;
  title: string;
  detail?: string | undefined;
  badge?: string | undefined;
  onSelect: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, badge, detail].filter(Boolean).join('. ')}
      onPress={onSelect}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={[styles.tileIcon, tint ? { backgroundColor: tint } : null]}>{icon}</View>
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>
          {title}
          {badge ? <Text style={styles.tileBadge}>{`  ✓ ${badge}`}</Text> : null}
        </Text>
        {detail ? (
          <Text style={styles.tileDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={18} color={ss.ink3} />
    </Pressable>
  );
}

export function SetupList({ children }: { children: ReactNode }) {
  return <View style={styles.list}>{children}</View>;
}

export function SetupRow({
  icon,
  title,
  detail,
  trailing,
  tone,
  onSelect,
  href,
  first,
}: {
  icon: ReactNode;
  title: string;
  detail?: string | undefined;
  trailing?: ReactNode;
  tone?: 'accent' | undefined;
  onSelect?: (() => void) | undefined;
  href?: string | undefined;
  first?: boolean;
}) {
  const content = (
    <>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {trailing ?? (onSelect || href ? <ChevronRight size={18} color={ss.ink3} /> : null)}
    </>
  );
  const rowStyle = [styles.row, !first && styles.rowDivider, tone === 'accent' && styles.rowAccent];
  if (!onSelect && !href) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole={href ? 'link' : 'button'}
      accessibilityLabel={[title, detail].filter(Boolean).join('. ')}
      onPress={() => (href ? void Linking.openURL(href) : onSelect?.())}
      style={({ pressed }) => [...rowStyle, pressed && styles.pressedRow]}
    >
      {content}
    </Pressable>
  );
}

export function SetupNotice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string | undefined;
  children: ReactNode;
}) {
  const palette = {
    info: { bg: ss.accentSoft, fg: '#1d6684' },
    warning: { bg: ss.warningSoft, fg: ss.warning },
    danger: { bg: ss.dangerSoft, fg: ss.danger },
    success: { bg: ss.successSoft, fg: ss.success },
  }[tone];
  const Icon = tone === 'info' ? Info : tone === 'success' ? Check : TriangleAlert;
  return (
    <View
      style={[styles.notice, { backgroundColor: palette.bg }]}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      accessible
    >
      <Icon size={20} color={palette.fg} strokeWidth={2.2} />
      <View style={styles.flex}>
        {title ? <Text style={[styles.noticeTitle, { color: palette.fg }]}>{title}</Text> : null}
        <Text style={[styles.noticeText, { color: palette.fg }]}>{children}</Text>
      </View>
    </View>
  );
}

export function SetupSegmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number | undefined }>;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              option.count !== undefined ? `${option.label}, ${option.count}` : option.label
            }
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
              {option.count !== undefined ? `  ${option.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SetupChoices<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | '';
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
}) {
  return (
    <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={[styles.choice, selected && styles.choiceSelected]}
          >
            {option.icon}
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
              {option.label}
            </Text>
            {selected ? <Check size={16} color={ss.accent} strokeWidth={3} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function SetupField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  maxLength?: number | undefined;
  keyboardType?: KeyboardTypeOptions | undefined;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={ss.ink3}
        maxLength={maxLength}
        keyboardType={keyboardType}
        autoCorrect={false}
        returnKeyType="done"
        style={styles.input}
      />
    </View>
  );
}

export function Suggestions({
  label,
  values,
  selected,
  onPick,
}: {
  label: string;
  values: string[];
  selected: string;
  onPick: (value: string) => void;
}) {
  return (
    <View style={styles.suggestions} accessibilityLabel={label}>
      {values.map((value) => (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityState={{ selected: value === selected }}
          onPress={() => onPick(value)}
          style={[styles.suggestion, value === selected && styles.suggestionSelected]}
        >
          <Text style={[styles.suggestionText, value === selected && styles.suggestionTextOn]}>
            {value}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Tag({
  children,
  accent,
  icon,
}: {
  children: string;
  accent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <View style={[styles.tag, accent && styles.tagAccent]}>
      {icon}
      <Text style={[styles.tagText, accent && styles.tagTextAccent]}>{children}</Text>
    </View>
  );
}

export function NumberedSteps({ lines, compact }: { lines: string[]; compact?: boolean }) {
  return (
    <View style={[styles.steps, compact && styles.stepsCompact]}>
      {lines.map((line, index) => (
        <View key={line} style={styles.stepRow} accessible>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>{index + 1}</Text>
          </View>
          <Text style={styles.stepText}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- pictures

export function SensorPicture({
  source,
  label,
  size,
  fallback,
}: {
  source: ImageSourcePropType | null;
  label?: string;
  size: number;
  fallback?: string | undefined;
}) {
  return source ? (
    <Image
      source={source}
      accessibilityLabel={label}
      accessible={!!label}
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={{ width: size, height: size }}
    />
  ) : (
    <View style={[styles.pictureFallback, { width: size, height: size }]}>
      <Radio size={size * 0.4} color={ss.accent} />
      {fallback ? <Text style={styles.pictureFallbackText}>{fallback}</Text> : null}
    </View>
  );
}

export function ProductPhoto({ product, size }: { product: SensorProduct; size: number }) {
  return (
    <SensorPicture
      source={sensorImage(product.image)}
      label={`${product.brand} ${product.name}`}
      size={size}
      fallback={product.model}
    />
  );
}

export function HeroIcon({ children, warning }: { children: ReactNode; warning?: boolean }) {
  return <View style={[styles.heroIcon, warning && styles.heroIconWarning]}>{children}</View>;
}

export function ProductHero({ children }: { children: ReactNode }) {
  return <View style={styles.productHero}>{children}</View>;
}

// ---------------------------------------------------------------- radar

/** Waves around the sensor and a ring that empties with the countdown. */
export function Radar({
  detected,
  ratio,
  children,
}: {
  detected: boolean;
  ratio: number;
  children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const waves = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduceMotion) {
      waves.forEach((wave) => wave.setValue(0));
      return;
    }
    const loops = waves.map((wave, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 800),
          Animated.timing(wave, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reduceMotion, waves]);
  const circumference = 2 * Math.PI * 56;
  const tone = detected ? ss.success : ss.accent;
  return (
    <View style={styles.radar} accessibilityElementsHidden importantForAccessibility="no">
      {waves.map((wave, index) => (
        <Animated.View
          key={index}
          style={[
            styles.radarWave,
            { backgroundColor: detected ? 'rgba(31,148,103,0.2)' : 'rgba(36,127,164,0.22)' },
            {
              opacity: wave.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.8, 0] }),
              transform: [
                { scale: wave.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.6] }) },
              ],
            },
          ]}
        />
      ))}
      <Svg width={132} height={132} viewBox="0 0 120 120" style={styles.radarRing}>
        <Circle cx="60" cy="60" r="56" stroke={ss.fill2} strokeWidth={4} fill="none" />
        <Circle
          cx="60"
          cy="60"
          r="56"
          stroke={tone}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, ratio)))}
          rotation={-90}
          origin="60, 60"
        />
      </Svg>
      <View style={styles.radarCore}>{children}</View>
    </View>
  );
}

export function ChecklistItem({
  state,
  children,
}: {
  state: 'done' | 'active' | 'waiting';
  children: string;
}) {
  return (
    <View
      style={styles.checkItem}
      accessible
      accessibilityLabel={children}
      accessibilityState={{ checked: state === 'done', busy: state === 'active' }}
    >
      <View style={[styles.checkBullet, state === 'done' && styles.checkBulletDone]}>
        {state === 'done' ? (
          <Check size={14} color="#fff" strokeWidth={3.4} />
        ) : state === 'active' ? (
          <ActivityIndicator size="small" color={ss.accent} />
        ) : null}
      </View>
      <Text style={[styles.checkText, state !== 'waiting' && styles.checkTextOn]}>{children}</Text>
    </View>
  );
}

export function FoundHero({ children }: { children: ReactNode }) {
  return (
    <View style={styles.foundHero}>
      <View style={styles.foundPhoto}>{children}</View>
      <View style={styles.foundBadge}>
        <Check size={20} color="#fff" strokeWidth={3.4} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  pressedRow: { backgroundColor: ss.fill2 },
  hidden: { opacity: 0 },
  sheet: { flex: 1, backgroundColor: ss.bg },
  header: {
    minHeight: 60,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerSide: { flex: 1, flexDirection: 'row', minWidth: 0 },
  headerEnd: { justifyContent: 'flex-end' },
  navButton: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    gap: 2,
    maxWidth: '100%',
  },
  navText: { flexShrink: 1, color: ss.accent, fontSize: 16, fontWeight: '600' },
  step: { color: ss.ink3, fontSize: 13, fontWeight: '600' },
  close: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.fill,
  },
  progress: {
    height: 3,
    marginHorizontal: 20,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: ss.fill2,
  },
  progressValue: { height: '100%', borderRadius: 3, backgroundColor: ss.accent },
  body: { padding: 20, paddingTop: 22, paddingBottom: 28, gap: 20 },
  bodyCentered: { alignItems: 'center' },
  titles: { gap: 6, alignSelf: 'stretch' },
  titlesCentered: { alignItems: 'center', maxWidth: 420, alignSelf: 'center' },
  eyebrowRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  eyebrowCentered: { justifyContent: 'center' },
  eyebrow: { color: ss.accent, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  title: { color: ss.ink, fontSize: 28, lineHeight: 33, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { color: ss.ink2, fontSize: 16, lineHeight: 23 },
  textCentered: { textAlign: 'center' },
  place: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: ss.fill,
  },
  placeText: { color: ss.ink2, fontSize: 13, fontWeight: '600' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: ss.line,
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  primary: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ss.primary,
  },
  primaryOff: { opacity: 0.45 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondary: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ss.fill,
  },
  secondaryText: { color: ss.ink, fontSize: 17, fontWeight: '700' },
  section: { gap: 10, alignSelf: 'stretch' },
  sectionHeader: {
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: { color: ss.ink2, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  sectionAside: { color: ss.ink3, fontSize: 13 },
  tile: {
    minHeight: 76,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ss.line,
    backgroundColor: ss.bg,
    marginBottom: 10,
    alignSelf: 'stretch',
  },
  tilePressed: { backgroundColor: ss.fill, transform: [{ scale: 0.99 }] },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.fill,
  },
  tileText: { flex: 1, gap: 2 },
  tileTitle: { color: ss.ink, fontSize: 16, fontWeight: '700' },
  tileBadge: { color: ss.success, fontSize: 12, fontWeight: '700' },
  tileDetail: { color: ss.ink2, fontSize: 13, lineHeight: 18 },
  list: { alignSelf: 'stretch', overflow: 'hidden', borderRadius: 18, backgroundColor: ss.fill },
  row: {
    minHeight: 60,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: ss.line },
  rowAccent: { backgroundColor: ss.accentSoft },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.bg,
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { color: ss.ink, fontSize: 15, fontWeight: '600' },
  rowDetail: { color: ss.ink2, fontSize: 13, lineHeight: 18 },
  notice: {
    alignSelf: 'stretch',
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    borderRadius: 16,
  },
  noticeTitle: { fontSize: 15, fontWeight: '700' },
  noticeText: { fontSize: 14, lineHeight: 21 },
  segmented: {
    alignSelf: 'stretch',
    padding: 3,
    flexDirection: 'row',
    borderRadius: 14,
    backgroundColor: ss.fill,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: { backgroundColor: ss.bg },
  segmentText: { color: ss.ink2, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  segmentTextSelected: { color: ss.ink },
  choices: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: ss.line,
    backgroundColor: ss.bg,
  },
  choiceSelected: { borderColor: ss.accent, backgroundColor: ss.accentSoft },
  choiceText: { color: ss.ink, fontSize: 15, fontWeight: '600' },
  choiceTextSelected: { color: ss.accent },
  field: { alignSelf: 'stretch', gap: 6 },
  fieldLabel: { color: ss.ink, fontSize: 14, fontWeight: '700' },
  input: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: ss.line,
    backgroundColor: ss.bg,
    color: ss.ink,
    fontSize: 16,
  },
  suggestions: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestion: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: ss.fill,
  },
  suggestionSelected: { backgroundColor: ss.accentSoft },
  suggestionText: { color: ss.ink2, fontSize: 14, fontWeight: '600' },
  suggestionTextOn: { color: ss.accent },
  tag: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: ss.fill,
  },
  tagAccent: { backgroundColor: ss.accentSoft },
  tagText: { color: ss.ink2, fontSize: 13 },
  tagTextAccent: { color: ss.accent },
  steps: { alignSelf: 'stretch', gap: 10 },
  stepsCompact: { gap: 8 },
  stepRow: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderRadius: 16,
    backgroundColor: ss.fill,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.primary,
  },
  stepNumberText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  stepText: { flex: 1, color: ss.ink, fontSize: 15, lineHeight: 22 },
  pictureFallback: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  pictureFallbackText: { color: ss.ink3, fontSize: 11 },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcedf5',
  },
  heroIconWarning: { backgroundColor: '#fbecd0' },
  productHero: {
    alignSelf: 'stretch',
    height: 210,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.fill,
  },
  radar: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  radarWave: { position: 'absolute', width: 120, height: 120, borderRadius: 60 },
  radarRing: { position: 'absolute' },
  radarCore: {
    width: 108,
    height: 108,
    borderRadius: 54,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkItem: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ss.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.bg,
  },
  checkBulletDone: { borderColor: ss.success, backgroundColor: ss.success },
  checkText: { color: ss.ink3, fontSize: 15 },
  checkTextOn: { color: ss.ink },
  foundHero: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  foundPhoto: {
    width: 116,
    height: 116,
    borderRadius: 32,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f6',
  },
  foundBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ss.success,
    borderWidth: 3,
    borderColor: '#fff',
  },
});

export { styles as sheetStyles };
