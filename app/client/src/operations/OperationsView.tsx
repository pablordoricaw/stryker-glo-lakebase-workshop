/**
 * The Command Center — the primary WRITE SURFACE for the Global Logistics
 * exception cockpit.
 *
 * Layout (top → bottom), per the spec:
 *   KpiCards       — Open / Critical / Expedited-freight-at-risk / Avg resolution
 *   ExceptionMap   — the visual signature: scattergeo bubbles per hospital,
 *                    Southeast cluster blazing coral; thins after the agent acts
 *   BreakdownPanels— exception-type × severity + by-carrier
 *   TicketQueue    — the actionable table (secondary to the map), row → drawer
 *   TicketDrawer   — slide-over (Ticket / Shipment / Activity tabs)
 *
 * Everything stays in sync with the agent via the `dataMutated` pub/sub: when
 * a chat turn commits write-backs, KPIs + queue + map + panels all refetch so
 * you literally WATCH the agent's writes land here.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight } from 'lucide-react';
import {
  fetchTickets,
  fetchTicketKpis,
  type TicketFilters,
} from '@/lib/tickets';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type {
  TicketRow,
  TicketKpis,
  TicketStatus,
  Severity,
  ExceptionType,
} from '@/shared/types';

import { KpiCards } from './KpiCards';
import { ExceptionMap } from './ExceptionMap';
import { BreakdownPanels } from './BreakdownPanels';
import { TicketQueue } from './TicketQueue';
import { TicketDrawer } from './TicketDrawer';

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters — Southeast default per the story. All URL-synced for deep links.
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>(
    (searchParams.get('status') as TicketStatus | 'all') ?? 'open',
  );
  const [regionFilter, setRegionFilter] = useState<string | null>(
    searchParams.get('region') ?? 'Southeast',
  );
  const [carrierFilter, setCarrierFilter] = useState<string | null>(
    searchParams.get('carrier') ?? null,
  );
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(
    (searchParams.get('severity') as Severity | null) ?? null,
  );
  const [typeFilter, setTypeFilter] = useState<ExceptionType | null>(
    (searchParams.get('type') as ExceptionType | null) ?? null,
  );
  const [search, setSearch] = useState('');

  // Filters → URL.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string | null) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete('status', statusFilter === 'open' ? null : statusFilter);
    setOrDelete('region', regionFilter);
    setOrDelete('carrier', carrierFilter);
    setOrDelete('severity', severityFilter);
    setOrDelete('type', typeFilter);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, regionFilter, carrierFilter, severityFilter, typeFilter]);

  // URL → filters (e.g. a link from another page).
  useEffect(() => {
    const urlStatus = (searchParams.get('status') as TicketStatus | 'all') ?? 'open';
    if (urlStatus !== statusFilter) setStatusFilter(urlStatus);
    const urlRegion = searchParams.get('region');
    if (urlRegion !== regionFilter) setRegionFilter(urlRegion);
    const urlCarrier = searchParams.get('carrier');
    if (urlCarrier !== carrierFilter) setCarrierFilter(urlCarrier);
    const urlSeverity = (searchParams.get('severity') as Severity | null) ?? null;
    if (urlSeverity !== severityFilter) setSeverityFilter(urlSeverity);
    const urlType = (searchParams.get('type') as ExceptionType | null) ?? null;
    if (urlType !== typeFilter) setTypeFilter(urlType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [rows, setRows] = useState<TicketRow[]>([]);
  const [kpis, setKpis] = useState<TicketKpis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useSession();

  const filters: TicketFilters = useMemo(
    () => ({
      status: statusFilter === 'all' ? undefined : statusFilter,
      region: regionFilter ?? undefined,
      carrier: carrierFilter ?? undefined,
      severity: severityFilter ?? undefined,
      exceptionType: typeFilter ?? undefined,
    }),
    [statusFilter, regionFilter, carrierFilter, severityFilter, typeFilter],
  );

  async function reload() {
    setLoading(true);
    try {
      const [list, k] = await Promise.all([fetchTickets(filters), fetchTicketKpis()]);
      setRows(list);
      setKpis(k);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.destinationHospitalName ?? '').toLowerCase().includes(q) ||
        r.shipmentId.toLowerCase().includes(q) ||
        (r.carrier ?? '').toLowerCase().includes(q) ||
        (r.region ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        {/* Header + the "ask the assistant" bridge into the dock. */}
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Command Center · live exceptions
            </div>
            <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
              Clear the exception backlog.
            </h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Every open ticket is a shipment at risk. Reroute the worst lanes, escalate
            the critical excursions, hold what's waiting on customs — or let the assistant
            draft the whole batch for your approval.
          </p>
          {config?.assistantScript?.[0] && (
            <button
              onClick={() => dockController.openAndSend(config.assistantScript[0].prompt)}
              className="w-full text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-5 py-4 transition-all flex items-center gap-4 group"
            >
              <div
                className="size-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Sparkles className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Southeast is missing SLA
                </div>
                <div className="text-sm font-medium text-foreground mt-0.5">
                  Ask the assistant why — and let it draft the fix
                </div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            </button>
          )}
        </div>

        <KpiCards kpis={kpis} />

        <ExceptionMap region={regionFilter} />

        <BreakdownPanels region={regionFilter} />

        <TicketQueue
          rows={filteredRows}
          loading={loading}
          error={error}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          search={search}
          onSearch={setSearch}
          regionFilter={regionFilter}
          onRegionFilter={setRegionFilter}
          carrierFilter={carrierFilter}
          onCarrierFilter={setCarrierFilter}
          severityFilter={severityFilter}
          onSeverityFilter={setSeverityFilter}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          onSelect={setSelectedId}
        />
      </div>

      <TicketDrawer
        id={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onMutated={() => {
          void reload();
        }}
      />
    </div>
  );
}
