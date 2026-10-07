-- Weekly expedited (express/emergency) freight $ for the Southeast — the
-- surge that peaked ~3 weeks ago (~$540K/wk vs ~$180K baseline). Last ~16 weeks.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_global_logistics_exception_cockpit_e302b2
SELECT
  date_trunc('week', metric_date) AS week,
  CAST(ROUND(SUM(expedited_freight_usd), 0) AS DOUBLE) AS expedited_freight_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_delivery_performance')
WHERE region = 'Southeast'
  AND metric_date >= date_sub(current_date(), 112)
GROUP BY date_trunc('week', metric_date)
ORDER BY week
