/**
 * Types that cross the client/server boundary for the Global Logistics
 * Command Center. Keep in sync with server/db/queries/tickets.ts.
 */

export type TicketStatus = 'open' | 'investigating' | 'resolved';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ExceptionType =
  | 'customs_delay'
  | 'damage'
  | 'missing_docs'
  | 'temperature_excursion';
export type ActionType = 'reroute' | 'escalate' | 'hold' | 'release' | 'add_note';

export type TicketRow = {
  ticketId: string;
  shipmentId: string;
  exceptionType: ExceptionType;
  severity: Severity;
  status: TicketStatus;
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
  lastAction: string | null;
  region: string | null;
  carrier: string | null;
  destinationHospitalName: string | null;
  priority: string | null;
  productCategory: string | null;
  daysLate: number | null;
  freightCostUsd: number | null;
  shipmentStatus: string | null;
};

export type TicketKpis = {
  openCount: number;
  criticalCount: number;
  resolvedCount: number;
  expeditedFreightAtRisk: number;
  avgResolutionHours: number | null;
};

export type TypeBreakdownRow = {
  exceptionType: ExceptionType;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
};

export type CarrierBreakdownRow = {
  carrier: string;
  openTickets: number;
  critical: number;
};

export type MapBucket = {
  hospital: string;
  region: string;
  lat: number;
  lng: number;
  openTickets: number;
  critical: number;
  freightUsd: number;
};

export type ActionDetails = {
  reason?: string;
  reroute_to_carrier?: string;
  from_carrier?: string;
  note?: string;
  severity?: string;
  exception_type?: string;
  [k: string]: unknown;
};

export type TicketAction = {
  actionId: string;
  actionType: ActionType;
  performedBy: string;
  timestamp: string;
  details: ActionDetails;
};

export type ShipmentDetail = {
  shipmentId: string;
  originWarehouseName: string | null;
  destinationHospitalName: string | null;
  carrier: string | null;
  status: string | null;
  priority: string | null;
  productCategory: string | null;
  region: string | null;
  shipDate: string | null;
  estimatedDelivery: string | null;
  actualDelivery: string | null;
  daysLate: number | null;
  freightCostUsd: number | null;
  isExpedited: boolean | null;
};

export type TicketDetail = TicketRow & {
  shipment: ShipmentDetail | null;
  actions: TicketAction[];
  resolutionNotes: string | null;
};

export type ActivityEvent = {
  actionId: string;
  shipmentId: string | null;
  ticketId: string | null;
  actionType: ActionType;
  by: string;
  at: string;
  details: ActionDetails;
};

export type BackorderRow = {
  warehouseName: string | null;
  productName: string | null;
  category: string | null;
  quantityOnHand: number | null;
  reorderPoint: number | null;
  shortfallUnits: number | null;
  region: string | null;
};
