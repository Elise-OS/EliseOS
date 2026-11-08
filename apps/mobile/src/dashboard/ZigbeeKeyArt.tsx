import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

/**
 * Drawings of a Zigbee key, where the sensor setup shows a product photo: a USB stick plugged on the
 * box, or a small network box (SLZB-06 style). Same shapes as the web dashboard (ZigbeeKeyArt.tsx).
 */
export function ZigbeeKeyArt({
  kind,
  size,
  muted = false,
}: {
  kind: 'usb' | 'network';
  size: number;
  muted?: boolean;
}) {
  const ink = muted ? '#a9b6bf' : '#17364f';
  const accent = muted ? '#b9c5cd' : '#247fa4';
  const led = muted ? '#c7d1d8' : '#1f9467';
  return kind === 'network' ? (
    <Svg width={size} height={size} viewBox="0 0 120 120" opacity={muted ? 0.7 : 1}>
      <Path
        d="M30 40a20 20 0 0 1 24 0M35 46a12 12 0 0 1 14 0"
        fill="none"
        stroke={accent}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <Circle cx="42" cy="52" r="3.5" fill={accent} />
      <Rect x="77" y="20" width="8" height="38" rx="4" fill={ink} />
      <Rect
        x="18"
        y="56"
        width="84"
        height="46"
        rx="13"
        fill="#fff"
        stroke="#c6d5de"
        strokeWidth={2.5}
      />
      <Rect x="18" y="56" width="84" height="12" rx="6" fill="#eef3f6" />
      <Rect x="30" y="78" width="22" height="14" rx="3" fill="#b9c8d2" />
      <Rect x="35" y="82" width="12" height="5" rx="1" fill="#8ea2b0" />
      <Circle cx="66" cy="85" r="3.5" fill={led} />
      <Circle cx="78" cy="85" r="3.5" fill={accent} />
      <Circle cx="90" cy="85" r="3.5" fill="#d7e1e7" />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 120 120" opacity={muted ? 0.7 : 1}>
      <G rotation={-16} origin="60, 62">
        <Rect x="55" y="6" width="10" height="40" rx="5" fill={ink} />
        <Rect
          x="37"
          y="38"
          width="46"
          height="56"
          rx="12"
          fill="#fff"
          stroke="#c6d5de"
          strokeWidth={2.5}
        />
        <Circle cx="60" cy="53" r="3.5" fill={led} />
        <Rect x="49" y="64" width="22" height="4" rx="2" fill="#dbe5eb" />
        <Rect x="53" y="72" width="14" height="4" rx="2" fill="#dbe5eb" />
        <Rect x="45" y="93" width="30" height="20" rx="3" fill="#b9c8d2" />
        <Rect x="51" y="99" width="6" height="5" rx="1" fill="#fff" />
        <Rect x="63" y="99" width="6" height="5" rx="1" fill="#fff" />
      </G>
    </Svg>
  );
}
