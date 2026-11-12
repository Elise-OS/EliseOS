import type { TvChannel } from '@elise/contracts';
import { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import logo24h from '../../assets/tv-logos/24h.png';
import logoAlJazeeraEnglish from '../../assets/tv-logos/al-jazeera-english.png';
import logoArte from '../../assets/tv-logos/arte.png';
import logoClan from '../../assets/tv-logos/clan.png';
import logoDw from '../../assets/tv-logos/dw.png';
import logoEuronews from '../../assets/tv-logos/euronews.png';
import logoFrance24 from '../../assets/tv-logos/france24.png';
import logoLa1 from '../../assets/tv-logos/la1.png';
import logoLa2 from '../../assets/tv-logos/la2.png';
import logoRai3 from '../../assets/tv-logos/rai-3.png';
import logoRmcDecouverte from '../../assets/tv-logos/rmc-decouverte.png';
import logoRmcLife from '../../assets/tv-logos/rmc-life.png';
import logoRmcStory from '../../assets/tv-logos/rmc-story.png';
import logoRtp1 from '../../assets/tv-logos/rtp1.png';
import logoRtp2 from '../../assets/tv-logos/rtp2.png';
import logoRtpAfrica from '../../assets/tv-logos/rtp-africa.png';
import logoRtpMemoria from '../../assets/tv-logos/rtp-memoria.png';
import logoRtpMundo from '../../assets/tv-logos/rtp-mundo.png';
import logoRtpNoticias from '../../assets/tv-logos/rtp-noticias.png';
import logoTv2000 from '../../assets/tv-logos/tv2000.png';

/** Official logos of the catalog channels (`logo` of @elise/contracts), bundled with the app. */
export const TV_CHANNEL_LOGOS: Record<string, ImageSourcePropType> = {
  '24h': logo24h,
  'al-jazeera-english': logoAlJazeeraEnglish,
  arte: logoArte,
  clan: logoClan,
  dw: logoDw,
  euronews: logoEuronews,
  france24: logoFrance24,
  la1: logoLa1,
  la2: logoLa2,
  'rai-3': logoRai3,
  'rmc-decouverte': logoRmcDecouverte,
  'rmc-life': logoRmcLife,
  'rmc-story': logoRmcStory,
  'rtp-africa': logoRtpAfrica,
  'rtp-memoria': logoRtpMemoria,
  'rtp-mundo': logoRtpMundo,
  'rtp-noticias': logoRtpNoticias,
  rtp1: logoRtp1,
  rtp2: logoRtp2,
  tv2000: logoTv2000,
};

/** Logo of a channel on a white tile (dark and light logos stay readable), or its text badge. */
export function TvChannelLogo({
  channel,
  style,
}: {
  channel: TvChannel;
  style?: StyleProp<ViewStyle>;
}) {
  const [broken, setBroken] = useState(false);
  const source = channel.logo ? TV_CHANNEL_LOGOS[channel.logo] : undefined;
  if (source && !broken)
    return (
      <View style={[s.tile, s.logoTile, style]}>
        <Image
          source={source}
          accessibilityLabel={channel.name}
          accessible
          resizeMode="contain"
          style={s.logo}
          onError={() => setBroken(true)}
        />
      </View>
    );
  return (
    <View
      accessible
      accessibilityLabel={channel.name}
      style={[s.tile, { backgroundColor: channel.badge.background }, style]}
    >
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[
          s.badgeText,
          channel.id === 'arte' ? s.badgeTextArte : s.badgeTextLabel,
          { color: channel.badge.color },
        ]}
      >
        {channel.badge.label}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  tile: {
    width: 64,
    height: 43,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoTile: {
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9E3E8',
    backgroundColor: '#FFFFFF',
  },
  logo: { width: '100%', height: '100%' },
  badgeText: { fontWeight: '900' },
  badgeTextArte: { fontSize: 23, letterSpacing: -2 },
  badgeTextLabel: { fontSize: 15, letterSpacing: -0.3 },
});
