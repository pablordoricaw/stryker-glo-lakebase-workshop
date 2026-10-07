/**
 * The exception-ticket queue — secondary to the hero map. Filterable by
 * region / carrier / severity / status / exception type. Click a row → the
 * action drawer. Rows gain an Action badge after the agent's write; status
 * badge flips open → investigating → resolved (pulsing on change).
 */
import { Search } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import { StatusBadge, SeverityBadge, ActionBadge, exceptionTypeLabel } from '@/shared/badges';
import type { TicketRow, TicketStatus, Severity, ExceptionType } from '@/shared/types';

const STATUS_TABS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
];

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const EXC_TYPES: ExceptionType[] = [
  'temperature_excursion',
  'customs_delay',
  'damage',
  'missing_docs',
];

type Props = {
  rows: TicketRow[];
  loading: boolean;
  error: string | null;
  statusFilter: TicketStatus | 'all';
  onStatusFilter: (s: TicketStatus | 'all') => void;
  search: string;
  onSearch: (s: string) => void;
  regionFilter: string | null;
  onRegionFilter: (r: string | null) => void;
  carrierFilter: string | null;
  onCarrierFilter: (c: string | null) => void;
  severityFilter: Severity | null;
  onSeverityFilter: (s: Severity | null) => void;
  typeFilter: ExceptionType | null;
  onTypeFilter: (t: ExceptionType | null) => void;
  onSelect: (id: string) => void;
};

export function TicketQueue(props: Props) {
  const {
    rows,
    loading,
    error,
    statusFilter,
    onStatusFilter,
    search,
    onSearch,
    regionFilter,
    onRegionFilter,
    carrierFilter,
    onCarrierFilter,
    severityFilter,
    onSeverityFilter,
    typeFilter,
    onTypeFilter,
    onSelect,
  } = props;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          className="relative inline-flex rounded-full border border-border bg-card p-0.5 text-sm"
        >
          {STATUS_TABS.map((s) => {
            const active = statusFilter === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onStatusFilter(s.value)}
                aria-pressed={active}
                className={`relative z-10 rounded-full px-3 py-1 transition-colors ${
                  active ? 'text-background' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && <span className="absolute inset-0 rounded-full bg-foreground" aria-hidden />}
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </div>

        <select
          value={severityFilter ?? ''}
          onChange={(e) => onSeverityFilter((e.target.value || null) as Severity | null)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-sm"
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={typeFilter ?? ''}
          onChange={(e) => onTypeFilter((e.target.value || null) as ExceptionType | null)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          {EXC_TYPES.map((t) => (
            <option key={t} value={t}>
              {exceptionTypeLabel(t)}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm flex-1 sm:flex-initial min-w-[180px]">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search hospital, shipment, carrier…"
            className="bg-transparent outline-none w-full sm:w-56 placeholder:text-muted-foreground"
          />
        </div>

        {regionFilter && (
          <button
            onClick={() => onRegionFilter(null)}
            className="text-xs rounded-full px-2 py-1 bg-primary/15 text-primary"
          >
            Region: {regionFilter} ✕
          </button>
        )}
        {carrierFilter && (
          <button
            onClick={() => onCarrierFilter(null)}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
          >
            Carrier: {carrierFilter} ✕
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        {loading && (
          <div className="absolute inset-x-0 top-0 h-0.5 z-10 overflow-hidden" aria-hidden>
            <div
              className="h-full w-1/3 rounded-full"
              style={{ background: 'var(--primary)', animation: 'loadingBar 1.1s ease-in-out infinite' }}
            />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Ticket</th>
                <th className="text-left px-4 py-2 font-semibold">Shipment</th>
                <th className="text-left px-4 py-2 font-semibold">Region</th>
                <th className="text-left px-4 py-2 font-semibold">Carrier</th>
                <th className="text-left px-4 py-2 font-semibold">Exception</th>
                <th className="text-left px-4 py-2 font-semibold">Severity</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-left px-4 py-2 font-semibold">Assigned</th>
                <th className="text-right px-4 py-2 font-semibold">Age</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No tickets match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Row
                  key={r.ticketId}
                  row={r}
                  onSelect={onSelect}
                  onRegion={onRegionFilter}
                  onCarrier={onCarrierFilter}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({
  row: r,
  onSelect,
  onRegion,
  onCarrier,
}: {
  row: TicketRow;
  onSelect: (id: string) => void;
  onRegion: (r: string | null) => void;
  onCarrier: (c: string | null) => void;
}) {
  const statusPulse = usePulseOnChange(r.status);
  return (
    <tr
      onClick={() => onSelect(r.ticketId)}
      className={`cursor-pointer border-t border-border hover:bg-muted/50 transition-colors ${
        statusPulse ? 'animate-pulse-row' : ''
      }`}
    >
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
        {r.ticketId.slice(0, 8)}
      </td>
      <td className="px-4 py-2">
        <div className="font-mono text-xs">{r.shipmentId}</div>
        <div className="text-xs text-muted-foreground truncate max-w-[16rem]">
          {r.destinationHospitalName ?? '—'}
        </div>
      </td>
      <td className="px-4 py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRegion(r.region);
          }}
          className="text-foreground hover:underline"
        >
          {r.region ?? '—'}
        </button>
      </td>
      <td className="px-4 py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCarrier(r.carrier);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          {r.carrier ?? '—'}
        </button>
      </td>
      <td className="px-4 py-2 text-muted-foreground">{exceptionTypeLabel(r.exceptionType)}</td>
      <td className="px-4 py-2">
        <SeverityBadge severity={r.severity} />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={r.status} />
          {r.lastAction && <ActionBadge action={r.lastAction} />}
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[12rem]">
        {r.assignedTo ?? '—'}
      </td>
      <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">
        {ageOf(r.createdAt)}
      </td>
    </tr>
  );
}

function ageOf(iso: string): string {
  const d = new Date(iso).getTime();
  const days = Math.max(0, Math.round((Date.now() - d) / 86400000));
  if (days === 0) return 'today';
  return `${days}d`;
}
