/**
 * Shipment tab — the synced shipment detail behind the exception ticket.
 * Pure read: origin warehouse, destination hospital, carrier, priority,
 * product category, ship/est/actual dates, days late, freight cost. Comes
 * from the gold_shipments mirror synced into Lakebase.
 */
import type { TicketDetail } from '@/shared/types';

export function ShipmentTab({ detail }: { detail: TicketDetail }) {
  const s = detail.shipment;
  if (!s) {
    return (
      <div className="text-sm text-muted-foreground">
        No synced shipment record for <span className="font-mono">{detail.shipmentId}</span>.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <dl className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3 sm:gap-y-4 text-sm">
        <Row label="Shipment" value={<span className="font-mono text-xs">{s.shipmentId}</span>} full />
        <Row label="Origin warehouse" value={s.originWarehouseName ?? '—'} />
        <Row label="Destination hospital" value={s.destinationHospitalName ?? '—'} />
        <Row label="Region" value={s.region ?? '—'} />
        <Row label="Carrier" value={s.carrier ?? '—'} />
        <Row label="Priority" value={s.priority ?? '—'} />
        <Row label="Product category" value={s.productCategory ?? '—'} />
        <Row label="Status" value={s.status ?? '—'} />
        <Row label="Expedited" value={s.isExpedited === null ? '—' : s.isExpedited ? 'Yes' : 'No'} />
        <Row label="Ship date" value={fmtDate(s.shipDate)} />
        <Row label="Est. delivery" value={fmtDate(s.estimatedDelivery)} />
        <Row label="Actual delivery" value={fmtDate(s.actualDelivery)} />
        <Row
          label="Days late"
          value={
            s.daysLate === null ? (
              '—'
            ) : (
              <span className={s.daysLate > 0 ? 'text-[var(--sev-critical)] font-semibold' : ''}>
                {s.daysLate}d
              </span>
            )
          }
        />
        <Row
          label="Freight cost"
          value={s.freightCostUsd !== null ? `$${Math.round(s.freightCostUsd).toLocaleString()}` : '—'}
        />
      </dl>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Row({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col sm:grid sm:grid-cols-3 ${full ? 'col-span-2 sm:col-span-1' : ''}`}>
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground pt-0.5">{label}</dt>
      <dd className="sm:col-span-2">{value}</dd>
    </div>
  );
}
