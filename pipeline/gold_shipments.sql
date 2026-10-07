-- Gold: per-shipment fact (the brief's gold_shipments)
CREATE OR REFRESH MATERIALIZED VIEW gold_shipments
CLUSTER BY (ship_date)
COMMENT 'Per-shipment logistics fact. Southeast express/emergency exception spike peaked ~3 weeks ago on SwiftMed Freight + AeroCare Logistics.'
AS
SELECT
  shipment_id, origin_warehouse, origin_warehouse_name,
  destination_hospital, destination_hospital_name,
  carrier, status, ship_date, estimated_delivery, actual_delivery,
  freight_cost_usd, weight_kg, priority, region, product_category,
  is_exception, days_late, is_expedited, dest_lat, dest_lng
FROM silver_shipments;
