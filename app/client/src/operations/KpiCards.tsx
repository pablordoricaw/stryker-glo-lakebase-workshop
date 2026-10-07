/**
 * KPI tiles for the Command Center: Open exceptions / Critical tickets /
 * Expedited freight at risk / Avg resolution time. Subscribe to dataMutated
 * (OperationsView refetches); each tile pulses when its value changes.
 */
import { AlertTriangle, Flame, DollarSign, Timer } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { TicketKpis } from '@/shared/types';

export function KpiCards({ kpis }: { kpis: TicketKpis | null }) {
  const open = kpis?.openCount ?? 0;
  const critical = kpis?.criticalCount ?? 0;
  const freight = kpis?.expeditedFreightAtRisk ?? 0;
  const avgHours = kpis?.avgResolutionHours ?? null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
      <Card
        label="Open exceptions"
        value={open.toLocaleString()}
        sub="tickets awaiting action"
        icon={<AlertTriangle className="size-4" />}
        tone="warning"
        pulseKey={open}
      />
      <Card
        label="Critical tickets"
        value={critical.toLocaleString()}
        sub="severity = critical"
        icon={<Flame className="size-4" />}
        tone="critical"
        pulseKey={critical}
      />
      <Card
        label="Expedited freight at risk"
        value={compactUsd(freight)}
        sub="open exception shipments"
        icon={<DollarSign className="size-4" />}
        tone="neutral"
        pulseKey={Math.round(freight)}
      />
      <Card
        label="Avg resolution time"
        value={avgHours === null ? '—' : `${avgHours.toFixed(1)}h`}
        sub="resolved tickets"
        icon={<Timer className="size-4" />}
        tone="success"
        pulseKey={avgHours === null ? -1 : Math.round(avgHours * 10)}
      />
    </div>
  );
}

function compactUsd(n: number): string {
  return (
    '$' +
    new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  );
}

function Card({
  label,
  value,
  sub,
  icon,
  tone,
  pulseKey,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone: 'neutral' | 'warning' | 'critical' | 'success';
  pulseKey: number;
}) {
  const pulse = usePulseOnChange(pulseKey);
  const toneClass =
    tone === 'critical'
      ? 'text-[var(--sev-critical)]'
      : tone === 'warning'
        ? 'text-[var(--warning-subtle-foreground)]'
        : tone === 'success'
          ? 'text-[var(--success-subtle-foreground)]'
          : 'text-primary';
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 sm:p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 sm:mt-2 display text-2xl sm:text-3xl font-semibold text-foreground">
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
