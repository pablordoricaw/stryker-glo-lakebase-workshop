-- Silver: denormalized per-shipment fact (reads raw parquet from the Volume)
CREATE OR REFRESH MATERIALIZED VIEW silver_shipments AS
SELECT
  s.shipment_id,
  s.origin_warehouse,
  w.warehouse_name          AS origin_warehouse_name,
  s.destination_hospital,
  h.hospital_name           AS destination_hospital_name,
  s.carrier,
  s.status,
  s.ship_date,
  s.estimated_delivery,
  s.actual_delivery,
  s.freight_cost_usd,
  s.weight_kg,
  s.priority,
  s.region,
  s.product_category,
  h.dest_lat,
  h.dest_lng,
  -- derived
  (s.status IN ('exception','delayed')
     OR (s.actual_delivery IS NOT NULL AND s.actual_delivery > s.estimated_delivery)) AS is_exception,
  CASE
    WHEN s.actual_delivery IS NOT NULL AND s.actual_delivery > s.estimated_delivery
      THEN CAST(datediff(s.actual_delivery, s.estimated_delivery) AS INT)
    ELSE 0
  END AS days_late,
  (s.priority IN ('express','emergency')) AS is_expedited
FROM read_files('/Volumes/solution_builder/demo_global_logistics_exception_cockpit_e302b2/raw_data/shipments', format => 'parquet') s
LEFT JOIN read_files('/Volumes/solution_builder/demo_global_logistics_exception_cockpit_e302b2/raw_data/warehouses', format => 'parquet') w
  ON s.origin_warehouse = w.warehouse_id
LEFT JOIN read_files('/Volumes/solution_builder/demo_global_logistics_exception_cockpit_e302b2/raw_data/hospitals', format => 'parquet') h
  ON s.destination_hospital = h.destination_hospital;
