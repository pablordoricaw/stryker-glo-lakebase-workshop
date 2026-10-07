-- Southeast exceptions by carrier, last ~45 days (the spike window).
-- SwiftMed Freight + AeroCare Logistics tower over the rest.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_global_logistics_exception_cockpit_e302b2
SELECT
  carrier,
  CAST(SUM(exception_count) AS BIGINT) AS exception_count,
  CAST(ROUND(SUM(expedited_freight_usd), 0) AS DOUBLE) AS expedited_freight_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_delivery_performance')
WHERE region = 'Southeast'
  AND priority IN ('express', 'emergency')
  AND metric_date >= date_sub(current_date(), 45)
GROUP BY carrier
ORDER BY exception_count DESC
