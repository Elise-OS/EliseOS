import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`michel-card ${className}`}>{children}</section>;
}

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`michel-button ${className}`} {...props} />;
}

export function StatusPill({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'neutral' | 'attention' | 'urgent' }>) {
  return <span className={`michel-status michel-status--${tone}`}>{children}</span>;
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
    <div className="michel-metric">
      <div className="michel-metric__icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
