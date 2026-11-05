import { FLAG_VIEWBOX, FLAGS, type Language } from '@elise/i18n';
import { useId, type SVGProps } from 'react';

/** The flag of a language, drawn from @elise/i18n like in the mobile app. */
export function FlagIcon({ language, ...props }: { language: Language } & SVGProps<SVGSVGElement>) {
  const { width, height, radius } = FLAG_VIEWBOX;
  // One id per drawing: several identical flags can share a page.
  const clip = `flag-${language}-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      className="flag-icon"
      width="24"
      height="18"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <clipPath id={clip}>
          <rect width={width} height={height} rx={radius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {FLAGS[language].map(({ kind, ...shape }, index) =>
          kind === 'rect' ? (
            <rect key={index} {...shape} />
          ) : (
            <path key={index} fill={shape.fill ?? 'none'} {...shape} />
          ),
        )}
      </g>
      <rect
        width={width}
        height={height}
        fill="none"
        stroke="rgba(0,0,0,0.15)"
        strokeWidth="20"
        rx={radius}
      />
    </svg>
  );
}
