import { useState } from 'react';
import type { TvChannel } from '@elise/contracts';
import './tv-channel-logo.css';

/**
 * Official logo of a channel (catalog of @elise/contracts), served from public/tv-logos so the
 * screen needs no network for it. Falls back to the text badge when the logo is missing or broken.
 */
export function TvChannelLogo({ channel, className }: { channel: TvChannel; className: string }) {
  const [broken, setBroken] = useState(false);
  if (channel.logo && !broken)
    return (
      <span className={`${className} tv-channel-logo`}>
        <img
          src={`/tv-logos/${channel.logo}.svg`}
          alt={channel.name}
          draggable={false}
          onError={() => setBroken(true)}
        />
      </span>
    );
  return (
    <span
      className={`${className} ${className}--${channel.id}`}
      style={{ color: channel.badge.color, background: channel.badge.background }}
      role="img"
      aria-label={channel.name}
    >
      <span aria-hidden="true">{channel.badge.label}</span>
    </span>
  );
}
