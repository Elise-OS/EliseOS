import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Bell,
  DoorOpen,
  House,
  LockKeyhole,
  MessageCircle,
  Radio,
  Smartphone,
  Thermometer,
  Tv,
  Video,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import eliseLogo from '../../assets/logo.png';
import interRegular from '../../assets/fonts/Inter-Regular.ttf';
import interSemiBold from '../../assets/fonts/Inter-SemiBold.ttf';
import interBold from '../../assets/fonts/Inter-Bold.ttf';
import sourceSerifRegular from '../../assets/fonts/SourceSerif4-Regular.ttf';
import sourceSerifItalic from '../../assets/fonts/SourceSerif4-Italic.ttf';
import type { Locale } from '../setup/MobileSetup';

type Props = {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onDiscover: () => void;
};

const palette = {
  background: '#F8F5EF',
  paper: '#FDFBF7',
  ink: '#0B2948',
  panel: '#E4E9E7',
  mint: '#376884',
  aqua: '#C6DAD6',
  coral: '#D99A55',
  text: '#0B2948',
  muted: '#586574',
  faint: '#6B7983',
};

const fonts = {
  body: 'InterRegular',
  medium: 'InterSemiBold',
  bold: 'InterBold',
  serif: 'SourceSerif4Regular',
  serifItalic: 'SourceSerif4Italic',
} as const;

const copy = {
  fr: {
    discover: 'Rechercher mon Élise',
    language: 'Langue',
    scroll: 'Défiler pour découvrir',
    illustration: 'Illustration de principe',
    hero: {
      eyebrow: 'UNE AUTRE FAÇON DE GARDER LE LIEN',
      title: 'Un lien discret',
      italic: 'avec son quotidien.',
      body: 'Élise relie les repères du logement, votre application et la télévision d’un proche pour aider la famille à garder le contact.',
    },
    sensors: {
      eyebrow: '01 / LE LOGEMENT',
      title: 'La maison donne des repères.',
      body: 'Une ouverture, un mouvement ou une température apportent du contexte. Aucun de ces indices ne peut, à lui seul, dire que tout va bien.',
      door: 'Ouverture',
      motion: 'Mouvement',
      temperature: 'Température',
      local: 'Événements traités au domicile',
    },
    mobile: {
      eyebrow: '02 / L’APPLICATION',
      title: 'L’essentiel, dans votre poche.',
      body: 'Consultez les faits du jour, les événements et les alertes. Une situation inhabituelle invite à vérifier et à prendre des nouvelles, jamais à conclure à distance.',
      today: 'Aujourd’hui',
      cues: 'Repères du jour',
      activity: 'Activité récente',
      alert: 'À vérifier',
    },
    tv: {
      eyebrow: '03 / LE LIEN',
      title: 'Le lien arrive aussi sur la TV.',
      body: 'Messages, médias et rendez-vous sont pensés pour un écran simple. La visio et son lancement automatique doivent encore être éprouvés avec le résident, selon son accord.',
      screen: 'Écran du résident',
      message: 'Un message de la famille',
      radio: 'Radio',
      call: 'Visio',
    },
    privacy: {
      eyebrow: '04 / VOTRE ESPACE',
      title: 'Le cœur du système reste chez soi.',
      body: 'Les événements sont traités au domicile. Les proches autorisés accèdent à leur espace par un réseau privé. Aucune caméra n’est nécessaire pour les repères du logement.',
      home: 'Au domicile',
      private: 'Accès privé',
      optional: 'Caméra facultative',
      disclaimer:
        'Élise est un prototype en cours d’intégration. Ni dispositif médical ni service d’urgence.',
    },
  },
  en: {
    discover: 'Find my Élise',
    language: 'Language',
    scroll: 'Scroll to discover',
    illustration: 'Concept illustration',
    hero: {
      eyebrow: 'A DIFFERENT WAY TO STAY CONNECTED',
      title: 'A gentle link',
      italic: 'to everyday life.',
      body: 'Élise connects cues from the home, your app and a loved one’s television to help families stay in touch.',
    },
    sensors: {
      eyebrow: '01 / THE HOME',
      title: 'The home offers useful cues.',
      body: 'An opening, movement or temperature provides context. None of these cues alone can tell you that everything is fine.',
      door: 'Opening',
      motion: 'Movement',
      temperature: 'Temperature',
      local: 'Events processed at home',
    },
    mobile: {
      eyebrow: '02 / THE APP',
      title: 'What matters, in your pocket.',
      body: 'See the day’s facts, events and alerts. An unusual situation is a reason to check in, never a conclusion to draw from afar.',
      today: 'Today',
      cues: 'Daily cues',
      activity: 'Recent activity',
      alert: 'Check in',
    },
    tv: {
      eyebrow: '03 / STAYING CLOSE',
      title: 'The connection reaches the TV.',
      body: 'Messages, media and appointments are designed for a simple screen. Video calling and automatic launch still need to be tested with the resident and their consent.',
      screen: 'Resident’s screen',
      message: 'A message from family',
      radio: 'Radio',
      call: 'Video call',
    },
    privacy: {
      eyebrow: '04 / YOUR SPACE',
      title: 'The heart of the system stays at home.',
      body: 'Events are processed at home. Authorised relatives access their space through a private network. A camera is not needed for the home’s activity cues.',
      home: 'At home',
      private: 'Private access',
      optional: 'Camera optional',
      disclaimer:
        'Élise is a prototype under integration. It is neither a medical device nor an emergency service.',
    },
  },
} as const;

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => {
        if (mounted) setReducedMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

function Reveal({
  active,
  reducedMotion,
  delay = 0,
  children,
}: {
  active: boolean;
  reducedMotion: boolean;
  delay?: number;
  children: ReactNode;
}) {
  const progress = useRef(new Animated.Value(active || reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(1);
    } else if (active) {
      Animated.timing(progress, {
        toValue: 1,
        duration: 580,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [active, delay, progress, reducedMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function SceneSurface({
  children,
  height,
  variant,
}: {
  children: ReactNode;
  height: number;
  variant: 'hero' | 'sensors' | 'mobile' | 'tv' | 'privacy';
}) {
  return (
    <View
      style={[styles.scene, { height }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
        <Defs>
          <LinearGradient id={`scene-${variant}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={variant === 'tv' ? '#F2E9DD' : '#E4E9E7'} />
            <Stop offset="55%" stopColor={variant === 'mobile' ? '#E7EFF0' : '#EDF1ED'} />
            <Stop offset="100%" stopColor={variant === 'privacy' ? '#E9E3D7' : '#F8F5EF'} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#scene-${variant})`} />
      </Svg>
      <View style={styles.sceneGlow} />
      {children}
    </View>
  );
}

function HeroScene({ height, pulse }: { height: number; pulse: Animated.Value }) {
  return (
    <SceneSurface height={height} variant="hero">
      <Svg width="100%" height="100%" viewBox="0 0 360 280" style={StyleSheet.absoluteFillObject}>
        <Circle cx="180" cy="139" r="106" stroke="#376884" strokeOpacity="0.16" fill="none" />
        <Circle cx="180" cy="139" r="82" stroke="#376884" strokeOpacity="0.19" fill="none" />
        <Path
          d="M180 139 C132 128 90 93 59 68"
          stroke="#376884"
          strokeOpacity="0.65"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          fill="none"
        />
        <Path
          d="M180 139 C226 123 270 101 307 76"
          stroke="#376884"
          strokeOpacity="0.65"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          fill="none"
        />
        <Path
          d="M180 139 C216 171 265 215 307 219"
          stroke="#D99A55"
          strokeOpacity="0.65"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          fill="none"
        />
      </Svg>
      <Animated.View
        style={[
          styles.heroPulse,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] }),
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.14] }) },
            ],
          },
        ]}
      />
      <View style={styles.heroCore}>
        <Image source={eliseLogo} style={styles.heroCoreLogo} resizeMode="contain" />
        <Text style={styles.heroCoreText}>ÉLISE OS</Text>
      </View>
      <View style={[styles.orbitIcon, styles.orbitHome]}>
        <House size={23} color={palette.ink} strokeWidth={1.8} />
      </View>
      <View style={[styles.orbitIcon, styles.orbitPhone]}>
        <Smartphone size={23} color={palette.ink} strokeWidth={1.8} />
      </View>
      <View style={[styles.orbitIcon, styles.orbitTv]}>
        <Tv size={24} color={palette.coral} strokeWidth={1.8} />
      </View>
    </SceneSurface>
  );
}

function SensorScene({
  height,
  t,
  pulse,
}: {
  height: number;
  t: typeof copy.fr.sensors | typeof copy.en.sensors;
  pulse: Animated.Value;
}) {
  return (
    <SceneSurface height={height} variant="sensors">
      <View style={styles.sensorPath} />
      <Animated.View
        style={[
          styles.sensorBeacon,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.95] }),
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] }) },
            ],
          },
        ]}
      >
        <House size={25} color={palette.paper} />
      </Animated.View>
      <View style={[styles.sensorChip, styles.sensorChipTop]}>
        <DoorOpen size={18} color={palette.mint} />
        <Text style={styles.sensorChipText}>{t.door}</Text>
      </View>
      <View style={[styles.sensorChip, styles.sensorChipMiddle]}>
        <Activity size={18} color={palette.coral} />
        <Text style={styles.sensorChipText}>{t.motion}</Text>
      </View>
      <View style={[styles.sensorChip, styles.sensorChipBottom]}>
        <Thermometer size={18} color="#477BA5" />
        <Text style={styles.sensorChipText}>{t.temperature}</Text>
      </View>
      <View style={styles.sensorFooter}>
        <View style={styles.onlineDot} />
        <Text style={styles.sensorFooterText}>{t.local}</Text>
      </View>
    </SceneSurface>
  );
}

function MobileScene({
  height,
  t,
}: {
  height: number;
  t: typeof copy.fr.mobile | typeof copy.en.mobile;
}) {
  return (
    <SceneSurface height={height} variant="mobile">
      <View style={styles.phoneHalo} />
      <View style={styles.phoneFrame}>
        <View style={styles.phoneHandle} />
        <Text style={styles.phoneEyebrow}>ÉLISE</Text>
        <Text style={styles.phoneTitle}>{t.today}</Text>
        <View style={styles.phoneCard}>
          <Text style={styles.phoneCardTitle}>{t.cues}</Text>
          <View style={styles.phoneCueRow}>
            <View style={[styles.phoneCue, { backgroundColor: '#D6F2E9' }]} />
            <View style={[styles.phoneCue, { backgroundColor: '#FBE5D8' }]} />
            <View style={[styles.phoneCue, { backgroundColor: '#D9E9F7' }]} />
          </View>
        </View>
        <View style={styles.phoneActivity}>
          <Text style={styles.phoneCardTitle}>{t.activity}</Text>
          <View style={styles.phoneActivityLine} />
          <View style={[styles.phoneActivityLine, { width: '68%' }]} />
        </View>
      </View>
      <View style={styles.alertChip}>
        <Bell size={17} color="#9A6130" />
        <Text style={styles.alertChipText}>{t.alert}</Text>
      </View>
    </SceneSurface>
  );
}

function TvScene({ height, t }: { height: number; t: typeof copy.fr.tv | typeof copy.en.tv }) {
  return (
    <SceneSurface height={height} variant="tv">
      <View style={styles.tvFrame}>
        <View style={styles.tvTopRow}>
          <View style={styles.tvStatusDot} />
          <Text style={styles.tvTopText}>{t.screen}</Text>
        </View>
        <View style={styles.tvMessage}>
          <MessageCircle size={22} color={palette.coral} />
          <Text style={styles.tvMessageText}>{t.message}</Text>
        </View>
        <View style={styles.tvTiles}>
          <View style={styles.tvTile}>
            <Radio size={17} color={palette.mint} />
            <Text style={styles.tvTileText}>{t.radio}</Text>
          </View>
          <View style={styles.tvTile}>
            <Video size={17} color={palette.mint} />
            <Text style={styles.tvTileText}>{t.call}</Text>
          </View>
        </View>
      </View>
      <View style={styles.tvStand} />
    </SceneSurface>
  );
}

function PrivacyScene({
  height,
  t,
  compact,
}: {
  height: number;
  t: typeof copy.fr.privacy | typeof copy.en.privacy;
  compact: boolean;
}) {
  return (
    <SceneSurface height={height} variant="privacy">
      <Svg width="100%" height="100%" viewBox="0 0 360 250" style={StyleSheet.absoluteFillObject}>
        <Path
          d="M96 125 C145 125 212 125 265 125"
          stroke="#376884"
          strokeWidth="2"
          strokeDasharray="4 7"
          fill="none"
        />
        <Circle cx="180" cy="125" r="67" stroke="#376884" strokeOpacity="0.18" fill="none" />
      </Svg>
      <View style={[styles.privacyNode, compact && styles.privacyNodeCompact, styles.privacyHome]}>
        <House size={30} color={palette.mint} />
        <Text style={styles.privacyNodeText}>{t.home}</Text>
      </View>
      <View style={[styles.privacyNode, compact && styles.privacyNodeCompact, styles.privacyPhone]}>
        <LockKeyhole size={29} color={palette.coral} />
        <Text style={styles.privacyNodeText}>{t.private}</Text>
      </View>
      <View style={styles.privacyOptional}>
        <Text style={styles.privacyOptionalText}>{t.optional}</Text>
      </View>
    </SceneSurface>
  );
}

function Chapter({
  index,
  eyebrow,
  title,
  body,
  scene,
  illustration,
  active,
  reducedMotion,
  onLayout,
}: {
  index: number;
  eyebrow: string;
  title: string;
  body: string;
  scene: ReactNode;
  illustration: string;
  active: boolean;
  reducedMotion: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  return (
    <View style={styles.chapter} onLayout={onLayout}>
      <View style={[styles.chapterNode, active && styles.chapterNodeActive]} />
      <Reveal active={active} reducedMotion={reducedMotion}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.chapterTitle}>{title}</Text>
        <Text style={styles.chapterBody}>{body}</Text>
      </Reveal>
      <Reveal active={active} reducedMotion={reducedMotion} delay={140}>
        {scene}
        <Text style={styles.illustrationLabel}>
          {illustration} · {String(index).padStart(2, '0')}/04
        </Text>
      </Reveal>
    </View>
  );
}

export function WelcomeExperience({ locale, onLocaleChange, onDiscover }: Props) {
  const [fontsLoaded] = useFonts({
    InterRegular: interRegular,
    InterSemiBold: interSemiBold,
    InterBold: interBold,
    SourceSerif4Regular: sourceSerifRegular,
    SourceSerif4Italic: sourceSerifItalic,
  });
  const t = copy[locale];
  const { width, height } = useWindowDimensions();
  const compact = width < 360;
  const sceneHeight = compact ? 224 : 250;
  const heroHeight = compact ? 246 : 280;
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const offsets = useRef<Record<number, number>>({});
  const storyTop = useRef(0);
  const currentScroll = useRef(0);
  const visible = useRef(new Set([0]));
  const [, setVisibilityRevision] = useState(0);
  const [contentHeight, setContentHeight] = useState(1);
  const [viewportHeight, setViewportHeight] = useState(1);

  useEffect(() => {
    if (reducedMotion !== false) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reducedMotion]);

  const updateVisibility = useCallback(
    (offset: number) => {
      let changed = false;
      for (let index = 1; index <= 4; index += 1) {
        const top = offsets.current[index];
        if (
          top !== undefined &&
          storyTop.current + top < offset + viewportHeight * 0.82 &&
          !visible.current.has(index)
        ) {
          visible.current.add(index);
          changed = true;
        }
      }
      if (changed) setVisibilityRevision((revision) => revision + 1);
    },
    [viewportHeight],
  );

  const onChapterLayout = useCallback(
    (index: number) => (event: LayoutChangeEvent) => {
      offsets.current[index] = event.nativeEvent.layout.y;
      updateVisibility(currentScroll.current);
    },
    [updateVisibility],
  );

  const handleScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: true,
    listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      currentScroll.current = event.nativeEvent.contentOffset.y;
      updateVisibility(currentScroll.current);
    },
  });

  const railTravel = Math.max(1, contentHeight - viewportHeight);
  const railPosition = reducedMotion
    ? 0
    : scrollY.interpolate({
        inputRange: [0, railTravel],
        outputRange: [0, 104],
        extrapolate: 'clamp',
      });
  const heroParallax = reducedMotion
    ? 0
    : scrollY.interpolate({
        inputRange: [0, Math.max(1, height * 0.7)],
        outputRange: [0, -24],
        extrapolate: 'clamp',
      });

  if (!fontsLoaded || reducedMotion === null) {
    return (
      <SafeAreaView style={styles.fontLoading}>
        <StatusBar style="dark" />
        <Image source={eliseLogo} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator color={palette.ink} size="small" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image
            source={eliseLogo}
            style={styles.brandLogo}
            resizeMode="contain"
            accessibilityLabel="Élise OS"
          />
          <Text style={styles.brandText}>
            élise<Text style={styles.brandOs}> OS</Text>
          </Text>
        </View>
        <View style={styles.languageSwitch} accessibilityLabel={t.language}>
          {(['fr', 'en'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.languageOption, locale === option && styles.languageOptionActive]}
              onPress={() => onLocaleChange(option)}
              accessibilityRole="button"
              accessibilityLabel={option === 'fr' ? 'Français' : 'English'}
              accessibilityState={{ selected: locale === option }}
            >
              <Text style={[styles.languageText, locale === option && styles.languageTextActive]}>
                {option.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, nextHeight) => setContentHeight(nextHeight)}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Reveal active reducedMotion={reducedMotion}>
            <Text style={styles.eyebrow}>{t.hero.eyebrow}</Text>
            <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>
              {t.hero.title}
              {'\n'}
              <Text style={styles.heroItalic}>{t.hero.italic}</Text>
            </Text>
            <Text style={styles.heroBody}>{t.hero.body}</Text>
          </Reveal>
          <Animated.View style={{ transform: [{ translateY: heroParallax }] }}>
            <HeroScene height={heroHeight} pulse={pulse} />
          </Animated.View>
          <View style={styles.scrollHint}>
            <ArrowDown size={15} color={palette.mint} />
            <Text style={styles.scrollHintText}>{t.scroll}</Text>
          </View>
        </View>

        <View
          style={styles.storyThread}
          onLayout={(event) => {
            storyTop.current = event.nativeEvent.layout.y;
            updateVisibility(currentScroll.current);
          }}
        >
          <View style={styles.threadLine} />
          <Chapter
            index={1}
            eyebrow={t.sensors.eyebrow}
            title={t.sensors.title}
            body={t.sensors.body}
            scene={<SensorScene height={sceneHeight} t={t.sensors} pulse={pulse} />}
            illustration={t.illustration}
            active={visible.current.has(1)}
            reducedMotion={reducedMotion}
            onLayout={onChapterLayout(1)}
          />
          <Chapter
            index={2}
            eyebrow={t.mobile.eyebrow}
            title={t.mobile.title}
            body={t.mobile.body}
            scene={<MobileScene height={sceneHeight + 36} t={t.mobile} />}
            illustration={t.illustration}
            active={visible.current.has(2)}
            reducedMotion={reducedMotion}
            onLayout={onChapterLayout(2)}
          />
          <Chapter
            index={3}
            eyebrow={t.tv.eyebrow}
            title={t.tv.title}
            body={t.tv.body}
            scene={<TvScene height={sceneHeight} t={t.tv} />}
            illustration={t.illustration}
            active={visible.current.has(3)}
            reducedMotion={reducedMotion}
            onLayout={onChapterLayout(3)}
          />
          <Chapter
            index={4}
            eyebrow={t.privacy.eyebrow}
            title={t.privacy.title}
            body={t.privacy.body}
            scene={<PrivacyScene height={sceneHeight} t={t.privacy} compact={compact} />}
            illustration={t.illustration}
            active={visible.current.has(4)}
            reducedMotion={reducedMotion}
            onLayout={onChapterLayout(4)}
          />
        </View>
        <Text style={styles.disclaimer}>{t.privacy.disclaimer}</Text>
      </Animated.ScrollView>

      {!reducedMotion && (
        <View style={styles.rail} pointerEvents="none" accessible={false}>
          <View style={styles.railLine} />
          <Animated.View style={[styles.railDot, { transform: [{ translateY: railPosition }] }]} />
        </View>
      )}

      <View style={styles.dock}>
        <Pressable
          style={({ pressed }) => [styles.discoverButton, pressed && styles.discoverButtonPressed]}
          onPress={onDiscover}
          accessibilityRole="button"
          accessibilityLabel={t.discover}
        >
          <Text style={styles.discoverText}>{t.discover}</Text>
          <ArrowRight size={21} color={palette.paper} strokeWidth={2.5} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: palette.background },
  fontLoading: {
    flex: 1,
    backgroundColor: palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  loadingLogo: { width: 68, height: 68, borderRadius: 18 },
  header: {
    minHeight: 62,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E0D7',
    backgroundColor: palette.paper,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandLogo: { width: 36, height: 36, borderRadius: 11 },
  brandText: { color: palette.ink, fontSize: 25, fontFamily: fonts.serif, letterSpacing: -0.8 },
  brandOs: { color: palette.mint, fontSize: 9, fontFamily: fonts.bold, letterSpacing: 0.7 },
  languageSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 15,
    backgroundColor: '#F1F3EF',
    borderWidth: 1,
    borderColor: '#DDE3DE',
  },
  languageOption: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  languageOptionActive: { backgroundColor: palette.ink },
  languageText: { color: palette.muted, fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.5 },
  languageTextActive: { color: palette.paper },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 34 },
  hero: { paddingTop: 28 },
  eyebrow: {
    color: palette.mint,
    fontSize: 10,
    fontFamily: fonts.bold,
    letterSpacing: 1.45,
    marginBottom: 13,
  },
  heroTitle: {
    color: palette.text,
    fontSize: 46,
    lineHeight: 49,
    fontFamily: fonts.serif,
    letterSpacing: -1.5,
    maxWidth: 390,
  },
  heroItalic: { color: palette.mint, fontFamily: fonts.serifItalic },
  heroTitleCompact: { fontSize: 40, lineHeight: 44, letterSpacing: -1.4 },
  heroBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 17,
    marginBottom: 24,
    maxWidth: 430,
    fontFamily: fonts.body,
  },
  scene: {
    borderRadius: 21,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D2DEDB',
    backgroundColor: palette.panel,
    position: 'relative',
  },
  sceneGlow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#A7C8C8',
    opacity: 0.19,
    top: -112,
    right: -83,
  },
  heroPulse: {
    position: 'absolute',
    width: 166,
    height: 166,
    borderRadius: 83,
    backgroundColor: palette.aqua,
    left: '50%',
    top: '50%',
    marginLeft: -83,
    marginTop: -83,
  },
  heroCore: {
    position: 'absolute',
    width: 126,
    height: 126,
    borderRadius: 63,
    left: '50%',
    top: '50%',
    marginLeft: -63,
    marginTop: -63,
    backgroundColor: palette.paper,
    borderWidth: 1,
    borderColor: '#BDCFCC',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.ink,
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
  heroCoreLogo: { width: 59, height: 59, borderRadius: 17 },
  heroCoreText: {
    color: palette.ink,
    fontSize: 10,
    fontFamily: fonts.bold,
    letterSpacing: 1.4,
    marginTop: 8,
  },
  orbitIcon: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CFDCDA',
    backgroundColor: palette.paper,
    shadowColor: palette.ink,
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  orbitHome: { left: '7%', top: '14%' },
  orbitPhone: { right: '7%', top: '18%' },
  orbitTv: { right: '8%', bottom: '11%' },
  scrollHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  scrollHintText: { color: palette.faint, fontSize: 11, fontFamily: fonts.medium },
  storyThread: { marginTop: 42, marginLeft: 6 },
  threadLine: {
    position: 'absolute',
    width: 2,
    top: 10,
    bottom: 18,
    left: 0,
    backgroundColor: '#C8D7D3',
  },
  chapter: { paddingLeft: 21, marginBottom: 54 },
  chapterNode: {
    position: 'absolute',
    top: 1,
    left: -5,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F5F0E8',
    borderWidth: 2,
    borderColor: '#B7C9C6',
  },
  chapterNodeActive: {
    backgroundColor: palette.coral,
    borderColor: palette.coral,
    shadowColor: palette.coral,
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  chapterTitle: {
    color: palette.text,
    fontSize: 33,
    lineHeight: 38,
    fontFamily: fonts.serif,
    letterSpacing: -0.9,
  },
  chapterBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 14,
    marginBottom: 22,
    fontFamily: fonts.body,
  },
  illustrationLabel: {
    color: palette.faint,
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 9,
    marginLeft: 3,
    fontFamily: fonts.body,
  },
  sensorPath: {
    position: 'absolute',
    width: 2,
    height: '65%',
    left: '50%',
    top: '14%',
    backgroundColor: '#A9C3C0',
  },
  sensorBeacon: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: palette.mint,
    left: '50%',
    top: '50%',
    marginLeft: -29,
    marginTop: -28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sensorChip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: palette.paper,
    borderWidth: 1,
    borderColor: '#CCDCD8',
    borderRadius: 15,
    paddingHorizontal: 12,
    minHeight: 42,
    shadowColor: palette.ink,
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  sensorChipTop: { left: '7%', top: '12%' },
  sensorChipMiddle: { right: '6%', top: '29%' },
  sensorChipBottom: { left: '8%', bottom: '20%' },
  sensorChipText: { color: palette.text, fontSize: 11, fontFamily: fonts.medium },
  sensorFooter: {
    position: 'absolute',
    bottom: 13,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#E2ECE8',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.coral },
  sensorFooterText: { color: palette.muted, fontSize: 9, fontFamily: fonts.medium },
  phoneHalo: {
    position: 'absolute',
    width: 206,
    height: 206,
    borderRadius: 103,
    alignSelf: 'center',
    top: 26,
    backgroundColor: palette.aqua,
    opacity: 0.42,
  },
  phoneFrame: {
    position: 'absolute',
    width: 185,
    height: '104%',
    top: 20,
    alignSelf: 'center',
    borderRadius: 28,
    borderWidth: 5,
    borderColor: '#AFC8C5',
    backgroundColor: '#FDFBF7',
    padding: 14,
    overflow: 'hidden',
    shadowColor: palette.ink,
    shadowOpacity: 0.16,
    shadowRadius: 20,
  },
  phoneHandle: {
    width: 39,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    backgroundColor: '#B6C6C3',
    marginBottom: 14,
  },
  phoneEyebrow: { color: palette.mint, fontSize: 8, fontFamily: fonts.bold, letterSpacing: 1.2 },
  phoneTitle: {
    color: palette.ink,
    fontSize: 18,
    fontFamily: fonts.serif,
    marginTop: 3,
    marginBottom: 12,
  },
  phoneCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E3EDEB',
  },
  phoneCardTitle: { color: palette.ink, fontSize: 9, fontFamily: fonts.medium },
  phoneCueRow: { flexDirection: 'row', gap: 4, marginTop: 10 },
  phoneCue: { height: 35, flex: 1, borderRadius: 7 },
  phoneActivity: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E3EDEB',
    marginTop: 8,
  },
  phoneActivityLine: {
    width: '90%',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#DCE9E8',
    marginTop: 8,
  },
  alertChip: {
    position: 'absolute',
    right: 13,
    top: '42%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E8CCAC',
    backgroundColor: '#FFF4E5',
    shadowColor: palette.ink,
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  alertChipText: { color: '#754D2E', fontSize: 10, fontFamily: fonts.bold },
  tvFrame: {
    position: 'absolute',
    left: '7%',
    right: '7%',
    top: '17%',
    height: '64%',
    borderRadius: 19,
    borderWidth: 6,
    borderColor: '#9FB3B1',
    backgroundColor: palette.paper,
    padding: 12,
  },
  tvTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tvStatusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.coral },
  tvTopText: { color: palette.muted, fontSize: 9, fontFamily: fonts.medium },
  tvMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7 },
  tvMessageText: {
    color: palette.text,
    fontSize: 16,
    fontFamily: fonts.serif,
    textAlign: 'center',
  },
  tvTiles: { flexDirection: 'row', gap: 8 },
  tvTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 9,
    backgroundColor: '#E9F0ED',
    minHeight: 30,
  },
  tvTileText: { color: palette.text, fontSize: 9, fontFamily: fonts.medium },
  tvStand: {
    position: 'absolute',
    width: 68,
    height: 8,
    borderRadius: 5,
    backgroundColor: '#9FB3B1',
    bottom: '12%',
    alignSelf: 'center',
  },
  privacyNode: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 25,
    backgroundColor: palette.paper,
    borderWidth: 1,
    borderColor: '#C7D5D1',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    top: '26%',
  },
  privacyNodeCompact: { width: 96, height: 104 },
  privacyHome: { left: '9%' },
  privacyPhone: { right: '9%' },
  privacyNodeText: { color: palette.text, fontSize: 10, fontFamily: fonts.medium },
  privacyOptional: {
    position: 'absolute',
    bottom: '10%',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#F0E7D9',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E4D4BB',
  },
  privacyOptionalText: { color: '#765D3F', fontSize: 10, fontFamily: fonts.medium },
  disclaimer: {
    color: palette.faint,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 17,
    marginTop: -4,
    fontFamily: fonts.body,
  },
  rail: { position: 'absolute', right: 5, top: '38%', height: 112, width: 5, alignItems: 'center' },
  railLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
    backgroundColor: '#C5D3D0',
  },
  railDot: {
    position: 'absolute',
    top: 0,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.coral,
  },
  dock: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#E1DDD4',
    backgroundColor: palette.paper,
  },
  discoverButton: {
    minHeight: 56,
    borderRadius: 17,
    paddingHorizontal: 20,
    backgroundColor: palette.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  discoverButtonPressed: { opacity: 0.82 },
  discoverText: { color: palette.paper, fontSize: 15, fontFamily: fonts.bold, flexShrink: 1 },
});
