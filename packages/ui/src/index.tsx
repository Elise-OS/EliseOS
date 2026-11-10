import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`elise-card ${className}`}>{children}</section>;
}

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`elise-button ${className}`} {...props} />;
}

export function StatusPill({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'neutral' | 'attention' | 'urgent' }>) {
  return <span className={`elise-status elise-status--${tone}`}>{children}</span>;
}

export function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="elise-metric">
      <div className="elise-metric__icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
