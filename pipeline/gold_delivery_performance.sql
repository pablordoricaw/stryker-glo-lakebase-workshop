-- Gold: pre-aggregated daily delivery SLA metrics by region x carrier x priority x product_category
CREATE OR REFRESH MATERIALIZED VIEW gold_delivery_performance
CLUSTER BY (metric_date)
COMMENT 'Daily delivery SLA metrics by region, carrier, priority, product_category. Tracks the Southeast exception spike and expedited-freight surge.'
AS
SELECT
  CAST(ship_date AS DATE)                                   AS metric_date,
  region,
  carrier,
  priority,
  product_category,
  COUNT(*)                                                  AS shipments_count,
  SUM(CASE WHEN NOT is_exception THEN 1 ELSE 0 END)         AS on_time_count,
  SUM(CASE WHEN is_exception THEN 1 ELSE 0 END)             AS exception_count,
  ROUND(AVG(CASE WHEN is_exception THEN days_late END), 2)  AS avg_days_late,
  ROUND(SUM(CASE WHEN NOT is_exception THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 4) AS sla_pct,
  ROUND(SUM(CASE WHEN is_exception THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 4)     AS exception_rate,
  ROUND(SUM(freight_cost_usd), 2)                           AS total_freight_usd,
  ROUND(SUM(CASE WHEN is_expedited THEN freight_cost_usd ELSE 0 END), 2) AS expedited_freight_usd
FROM silver_shipments
GROUP BY CAST(ship_date AS DATE), region, carrier, priority, product_category;
