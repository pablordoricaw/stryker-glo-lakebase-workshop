-- Average exception resolution time (hours) by type × region — the CDF /
-- metric-view loop proof. Reads gold_exception_resolution (resolved tickets
-- that streamed back from Lakebase via CDF). This is the "did the operational
-- actions move the needle?" chart.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_global_logistics_exception_cockpit_e302b2
SELECT
  exception_type,
  region,
  CAST(ROUND(AVG(resolution_hours), 1) AS DOUBLE) AS avg_resolution_hours,
  CAST(COUNT(*) AS BIGINT) AS tickets_resolved
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_exception_resolution')
WHERE status = 'resolved' AND resolution_hours IS NOT NULL
GROUP BY exception_type, region
ORDER BY avg_resolution_hours DESC
LIMIT 24
