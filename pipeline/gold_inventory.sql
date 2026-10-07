-- Gold: inventory snapshot with backorder-risk flags
CREATE OR REFRESH MATERIALIZED VIEW gold_inventory
COMMENT 'Warehouse x SKU inventory snapshot. below_reorder flags backorder risk, skewed Southeast implants/capital_equipment.'
AS
SELECT
  warehouse_id, warehouse_name, product_sku, product_name, category,
  CAST(quantity_on_hand AS INT) AS quantity_on_hand,
  CAST(reorder_point AS INT)    AS reorder_point,
  last_replenished, region,
  (quantity_on_hand < reorder_point) AS below_reorder,
  GREATEST(CAST(reorder_point AS INT) - CAST(quantity_on_hand AS INT), 0) AS shortfall_units
FROM read_files('/Volumes/solution_builder/demo_global_logistics_exception_cockpit_e302b2/raw_data/inventory', format => 'parquet');
