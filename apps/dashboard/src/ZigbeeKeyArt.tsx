/**
 * Drawings of a Zigbee key, used where the sensor setup shows a product photo: a USB stick plugged
 * on the box, or a small network box (SLZB-06 style) on the home network. Same shapes on mobile.
 */
export function ZigbeeKeyArt({ kind, className }: { kind: 'usb' | 'network'; className?: string }) {
  return kind === 'network' ? (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <path
        d="M30 40a20 20 0 0 1 24 0M35 46a12 12 0 0 1 14 0"
        fill="none"
        stroke="#247fa4"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="42" cy="52" r="3.5" fill="#247fa4" />
      <rect x="77" y="20" width="8" height="38" rx="4" fill="#17364f" />
      <rect
        x="18"
        y="56"
        width="84"
        height="46"
        rx="13"
        fill="#fff"
        stroke="#c6d5de"
        strokeWidth="2.5"
      />
      <rect x="18" y="56" width="84" height="12" rx="6" fill="#eef3f6" />
      <rect x="30" y="78" width="22" height="14" rx="3" fill="#b9c8d2" />
      <rect x="35" y="82" width="12" height="5" rx="1" fill="#8ea2b0" />
      <circle cx="66" cy="85" r="3.5" fill="#1f9467" />
      <circle cx="78" cy="85" r="3.5" fill="#247fa4" />
      <circle cx="90" cy="85" r="3.5" fill="#d7e1e7" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <g transform="rotate(-16 60 62)">
        <rect x="55" y="6" width="10" height="40" rx="5" fill="#17364f" />
        <rect
          x="37"
          y="38"
          width="46"
          height="56"
          rx="12"
          fill="#fff"
          stroke="#c6d5de"
          strokeWidth="2.5"
        />
        <circle cx="60" cy="53" r="3.5" fill="#1f9467" />
        <rect x="49" y="64" width="22" height="4" rx="2" fill="#dbe5eb" />
        <rect x="53" y="72" width="14" height="4" rx="2" fill="#dbe5eb" />
        <rect x="45" y="93" width="30" height="20" rx="3" fill="#b9c8d2" />
        <rect x="51" y="99" width="6" height="5" rx="1" fill="#fff" />
        <rect x="63" y="99" width="6" height="5" rx="1" fill="#fff" />
      </g>
    </svg>
  );
}
