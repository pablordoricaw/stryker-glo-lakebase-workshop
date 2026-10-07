-- Weekly SLA % + exception rate for the Southeast, last ~16 weeks.
-- Reads the pre-aggregated gold_delivery_performance table.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_global_logistics_exception_cockpit_e302b2
SELECT
  date_trunc('week', metric_date) AS week,
  CAST(ROUND(
    SUM(on_time_count) * 100.0 / NULLIF(SUM(shipments_count), 0), 1) AS DOUBLE) AS sla_pct,
  CAST(ROUND(
    SUM(exception_count) * 100.0 / NULLIF(SUM(shipments_count), 0), 1) AS DOUBLE) AS exception_rate_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_delivery_performance')
WHERE region = 'Southeast'
  AND metric_date >= date_sub(current_date(), 112)
GROUP BY date_trunc('week', metric_date)
ORDER BY week
