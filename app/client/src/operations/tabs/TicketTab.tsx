/**
 * Ticket tab — exception detail + the manual action buttons (Reroute /
 * Escalate / Hold / Release / Add note). Each posts a shipment_actions row
 * and updates the ticket, mirroring what the agent's batch does.
 */
import { useEffect, useState } from 'react';
import { ArrowRightLeft, AlertTriangle, PauseCircle, PlayCircle, StickyNote } from 'lucide-react';
import { applyTicketAction } from '@/lib/tickets';
import { exceptionTypeLabel } from '@/shared/badges';
import type { ActionType, TicketDetail } from '@/shared/types';

const CARRIERS = [
  'Continental Cargo',
  'Vanguard Transport',
  'MediLine Express',
  'PrimeHealth Carriers',
];

export function TicketTab({ detail, onMutated }: { detail: TicketDetail; onMutated: () => void }) {
  const [note, setNote] = useState('');
  const [rerouteTo, setRerouteTo] = useState(CARRIERS[0]);
  const [pending, setPending] = useState<ActionType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote('');
    setError(null);
  }, [detail.ticketId]);

  async function act(actionType: ActionType) {
    setPending(actionType);
    setError(null);
    try {
      await applyTicketAction(detail.ticketId, actionType, {
        rerouteToCarrier: actionType === 'reroute' ? rerouteTo : undefined,
        note: note || undefined,
      });
      onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  const resolved = detail.status === 'resolved';

  return (
    <div className="space-y-6 max-w-2xl">
      <dl className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3 sm:gap-y-4 text-sm">
        <Row label="Exception type" value={exceptionTypeLabel(detail.exceptionType)} />
        <Row label="Severity" value={detail.severity} />
        <Row label="Region" value={detail.region ?? '—'} />
        <Row label="Carrier" value={detail.carrier ?? '—'} />
        <Row label="Priority" value={detail.priority ?? '—'} />
        <Row label="Days late" value={detail.daysLate !== null ? `${detail.daysLate}d` : '—'} />
        <Row
          label="Freight cost"
          value={detail.freightCostUsd !== null ? `$${Math.round(detail.freightCostUsd).toLocaleString()}` : '—'}
        />
        <Row label="Assigned to" value={detail.assignedTo ?? '—'} full />
        {detail.resolutionNotes && <Row label="Resolution" value={detail.resolutionNotes} full />}
      </dl>

      {resolved && (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          This ticket is <strong>resolved</strong>. Further actions are still recorded in the audit
          trail.
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Reroute to (for Reroute)
        </label>
        <select
          value={rerouteTo}
          onChange={(e) => setRerouteTo(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Context for the carrier ops team or the audit trail…"
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
        />
        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex flex-wrap gap-2">
          <Btn label="Reroute" icon={<ArrowRightLeft className="size-4" />} onClick={() => act('reroute')} pending={pending === 'reroute'} variant="primary" />
          <Btn label="Escalate" icon={<AlertTriangle className="size-4" />} onClick={() => act('escalate')} pending={pending === 'escalate'} variant="danger" />
          <Btn label="Hold" icon={<PauseCircle className="size-4" />} onClick={() => act('hold')} pending={pending === 'hold'} variant="neutral" />
          <Btn label="Release" icon={<PlayCircle className="size-4" />} onClick={() => act('release')} pending={pending === 'release'} variant="success" />
          <Btn label="Add note" icon={<StickyNote className="size-4" />} onClick={() => act('add_note')} pending={pending === 'add_note'} variant="neutral" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col sm:grid sm:grid-cols-3 ${full ? 'col-span-2 sm:col-span-1' : ''}`}>
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground pt-0.5">{label}</dt>
      <dd className="sm:col-span-2">{value}</dd>
    </div>
  );
}

function Btn({
  label,
  icon,
  onClick,
  pending,
  variant,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  variant: 'primary' | 'success' | 'neutral' | 'danger';
}) {
  const cls =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground hover:opacity-90'
      : variant === 'success'
        ? 'bg-success text-success-foreground hover:opacity-90'
        : variant === 'danger'
          ? 'bg-warning text-warning-foreground hover:opacity-90'
          : 'bg-muted text-foreground hover:bg-muted/70';
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      {icon}
      {pending ? '…' : label}
    </button>
  );
}
