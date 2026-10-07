/**
 * Pill badges for the Command Center — ticket status, severity, exception
 * type, action. If you add an enum value, update shared/types.ts and the
 * color map here.
 */
import type { Severity, TicketStatus, ExceptionType } from './types';

export function StatusBadge({ status }: { status: TicketStatus }) {
  const styles: Record<TicketStatus, string> = {
    open: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
    investigating: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
    resolved: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const styles: Record<Severity, string> = {
    critical: 'bg-[var(--sev-critical)] text-white',
    high: 'bg-[var(--sev-high)] text-white',
    medium: 'bg-[var(--sev-medium)] text-foreground',
    low: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${styles[severity]}`}
    >
      {severity}
    </span>
  );
}

const EXC_LABELS: Record<ExceptionType, string> = {
  temperature_excursion: 'Temp excursion',
  customs_delay: 'Customs delay',
  damage: 'Damage',
  missing_docs: 'Missing docs',
};

export function ExceptionTypeBadge({ type }: { type: ExceptionType }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
      {EXC_LABELS[type] ?? type}
    </span>
  );
}

export function exceptionTypeLabel(type: ExceptionType): string {
  return EXC_LABELS[type] ?? type;
}

export function ActionBadge({ action }: { action: string }) {
  const labels: Record<string, string> = {
    reroute: 'Rerouted',
    escalate: 'Escalated',
    hold: 'Held',
    release: 'Released',
    add_note: 'Noted',
  };
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-primary/15 text-primary">
      {labels[action] ?? action}
    </span>
  );
}
