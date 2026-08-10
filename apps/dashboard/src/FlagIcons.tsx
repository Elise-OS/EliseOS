import type { SVGProps } from 'react';

export function FRFlag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 640 480"
      className="flag-icon"
      width="24"
      height="18"
      aria-hidden="true"
      {...props}
    >
      <rect width="640" height="480" fill="#fff" rx="40" />
      <path fill="#00267f" d="M0 0h213.3v480H0z" />
      <path fill="#f31830" d="M426.7 0H640v480H426.7z" />
      <rect
        width="640"
        height="480"
        fill="none"
        stroke="rgba(0,0,0,0.15)"
        strokeWidth="20"
        rx="40"
      />
    </svg>
  );
}

export function GBFlag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 640 480"
      className="flag-icon"
      width="24"
      height="18"
      aria-hidden="true"
      {...props}
    >
      <rect width="640" height="480" fill="#012169" rx="40" />
      <path stroke="#fff" strokeWidth="60" d="M0 0l640 480M0 480L640 0" />
      <path stroke="#c8102e" strokeWidth="36" d="M0 0l640 480M0 480L640 0" />
      <path stroke="#fff" strokeWidth="100" d="M320 0v480M0 240h640" />
      <path stroke="#c8102e" strokeWidth="60" d="M320 0v480M0 240h640" />
      <rect
        width="640"
        height="480"
        fill="none"
        stroke="rgba(0,0,0,0.15)"
        strokeWidth="20"
        rx="40"
      />
    </svg>
  );
}
