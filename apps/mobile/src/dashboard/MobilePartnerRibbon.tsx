import { useEffect, useRef, useState } from 'react';
import lifeplusLogo from '../../assets/partners/lifeplus.png';
import nodonLogo from '../../assets/partners/nodon.png';
import smlightLogo from '../../assets/partners/smlight-symbol.png';
import thirdrealityLogo from '../../assets/partners/thirdreality.png';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Locale = 'fr' | 'en';

type Partner = {
  id: 'nodon' | 'thirdreality' | 'smlight' | 'lifeplus';
  name: string;
  image: ImageSourcePropType;
  roleFr: string;
  roleEn: string;
};

const partners: Partner[] = [
  {
    id: 'nodon',
    name: 'NodOn',
    image: nodonLogo,
    roleFr: 'Partenaire principal',
    roleEn: 'Lead partner',
  },
  {
    id: 'thirdreality',
    name: 'ThirdReality',
    image: thirdrealityLogo,
    roleFr: 'Partenaire matériel',
    roleEn: 'Hardware partner',
  },
  {
    id: 'smlight',
    name: 'SMLIGHT',
    image: smlightLogo,
    roleFr: 'Partenaire matériel',
    roleEn: 'Hardware partner',
  },
  {
    id: 'lifeplus',
    name: 'Life Plus',
    image: lifeplusLogo,
    roleFr: 'Conseils & intimité du résident',
    roleEn: 'Resident guidance & privacy',
  },
];

export function MobilePartnerRibbon({ locale }: { locale: Locale }) {
  const fr = locale === 'fr';
  const offset = useRef(new Animated.Value(0)).current;
  const [groupWidth, setGroupWidth] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => setReducedMotion(true));
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    offset.stopAnimation();
    offset.setValue(0);
    if (reducedMotion || groupWidth <= 0) return;

    const animation = Animated.loop(
      Animated.timing(offset, {
        toValue: -groupWidth,
        duration: 42_000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [groupWidth, offset, reducedMotion]);

  const accessibleDescription = fr
    ? 'Ils accompagnent le projet : NodOn, partenaire principal ; ThirdReality et SMLIGHT, partenaires matériels ; Life Plus, conseils et intimité du résident.'
    : 'Supporting the project: NodOn, lead partner; ThirdReality and SMLIGHT, hardware partners; Life Plus, resident guidance and privacy.';

  return (
    <View style={styles.container} accessible accessibilityLabel={accessibleDescription}>
      <Text style={styles.heading}>
        {fr ? 'ILS ACCOMPAGNENT LE PROJET' : 'SUPPORTING THE PROJECT'}
      </Text>
      {reducedMotion ? (
        <View style={styles.staticGrid}>
          {partners.map((partner) => (
            <PartnerBrand key={partner.id} partner={partner} locale={locale} compact />
          ))}
        </View>
      ) : (
        <View style={styles.window}>
          <Animated.View style={[styles.track, { transform: [{ translateX: offset }] }]}>
            {[0, 1].map((copy) => (
              <View
                key={copy}
                style={styles.group}
                onLayout={
                  copy === 0 ? (event) => setGroupWidth(event.nativeEvent.layout.width) : undefined
                }
                accessibilityElementsHidden={copy === 1}
                importantForAccessibility={copy === 1 ? 'no-hide-descendants' : 'auto'}
              >
                {partners.map((partner) => (
                  <PartnerBrand key={partner.id} partner={partner} locale={locale} />
                ))}
              </View>
            ))}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

function PartnerBrand({
  partner,
  locale,
  compact = false,
}: {
  partner: Partner;
  locale: Locale;
  compact?: boolean;
}) {
  return (
    <View style={[styles.brand, compact && styles.compactBrand]}>
      {partner.id === 'smlight' ? (
        <View style={styles.smlightLogo}>
          <Image source={partner.image} style={styles.smlightSymbol} resizeMode="contain" />
          <Text style={styles.smlightName}>SMLIGHT</Text>
        </View>
      ) : (
        <Image
          source={partner.image}
          style={[
            styles.partnerLogo,
            partner.id === 'lifeplus' && styles.lifePlusLogo,
            compact && styles.compactLogo,
          ]}
          resizeMode="contain"
        />
      )}
      <Text style={styles.role}>{locale === 'fr' ? partner.roleFr : partner.roleEn}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    paddingTop: 14,
    paddingBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DED8CE',
    backgroundColor: '#EEEAE2',
  },
  heading: {
    paddingHorizontal: 14,
    color: '#52616C',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  window: { marginTop: 6, overflow: 'hidden' },
  track: { flexDirection: 'row', alignItems: 'stretch' },
  group: { flexDirection: 'row', flexShrink: 0 },
  brand: {
    width: 270,
    minHeight: 92,
    paddingHorizontal: 35,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: '#D5D2C9',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  partnerLogo: { width: 150, height: 50 },
  lifePlusLogo: { width: 132, height: 50 },
  smlightLogo: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 8 },
  smlightSymbol: { width: 30, height: 30 },
  smlightName: { color: '#101820', fontSize: 17, fontWeight: '700', letterSpacing: 1.8 },
  role: { color: '#52616C', fontSize: 9, textAlign: 'center' },
  staticGrid: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap' },
  compactBrand: {
    width: '50%',
    minHeight: 82,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRightWidth: 0,
    borderTopWidth: 1,
    borderTopColor: '#D5D2C9',
  },
  compactLogo: { width: 112, height: 40 },
});
