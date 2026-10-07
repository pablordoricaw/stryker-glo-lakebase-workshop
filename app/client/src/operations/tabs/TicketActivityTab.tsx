/**
 * Activity tab — append-only audit timeline of this ticket's actions
 * (reroute / escalate / hold / release / note). Grows live when the agent's
 * batch executes (the drawer refetches on dataMutated). This is the trust
 * trail: who did what, when, with what detail.
 */
import { ArrowRightLeft, AlertTriangle, PauseCircle, PlayCircle, StickyNote } from 'lucide-react';
import type { ActionType, TicketAction, TicketDetail } from '@/shared/types';

const ICON: Record<ActionType, React.ReactNode> = {
  reroute: <ArrowRightLeft className="size-3.5" />,
  escalate: <AlertTriangle className="size-3.5" />,
  hold: <PauseCircle className="size-3.5" />,
  release: <PlayCircle className="size-3.5" />,
  add_note: <StickyNote className="size-3.5" />,
};

const VERB: Record<ActionType, string> = {
  reroute: 'Rerouted',
  escalate: 'Escalated',
  hold: 'Held',
  release: 'Released',
  add_note: 'Note added',
};

export function TicketActivityTab({ detail }: { detail: TicketDetail }) {
  const actions = [...detail.actions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (actions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No actions recorded yet. Reroutes, escalations, holds, and notes appear here —
        including the ones the assistant commits on approval.
      </div>
    );
  }

  return (
    <ol className="relative space-y-4">
      <div aria-hidden className="absolute left-[13px] top-2 bottom-2 w-px bg-border" />
      {actions.map((a) => (
        <TimelineRow key={a.actionId} action={a} />
      ))}
    </ol>
  );
}

function TimelineRow({ action: a }: { action: TicketAction }) {
  return (
    <li className="relative flex items-start gap-3">
      <div className="relative z-10 size-7 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
        {ICON[a.actionType]}
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-foreground">{VERB[a.actionType]}</span>
          <span className="text-xs text-muted-foreground shrink-0">{fmtTime(a.timestamp)}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">by {a.performedBy}</div>
        {detailLine(a) && (
          <div className="text-xs text-foreground/80 mt-1">{detailLine(a)}</div>
        )}
      </div>
    </li>
  );
}

function detailLine(a: TicketAction): string | null {
  const d = a.details ?? {};
  const parts: string[] = [];
  if (d.from_carrier && d.reroute_to_carrier) {
    parts.push(`${d.from_carrier} → ${d.reroute_to_carrier}`);
  } else if (d.reroute_to_carrier) {
    parts.push(`→ ${d.reroute_to_carrier}`);
  }
  if (d.reason) parts.push(String(d.reason));
  if (d.note) parts.push(`"${d.note}"`);
  return parts.length ? parts.join(' · ') : null;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
