CREATE OR REPLACE VIEW solution_builder.demo_global_logistics_exception_cockpit_e302b2.mv_exception_resolution
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1
source: solution_builder.demo_global_logistics_exception_cockpit_e302b2.gold_exception_resolution
comment: "Exception resolution time by type and region, from the Lakebase CDF output. Proves operational actions reduced resolution time."
dimensions:
  - name: exception_type
    expr: exception_type
  - name: region
    expr: region
  - name: severity
    expr: severity
  - name: resolved_week
    expr: DATE_TRUNC('WEEK', resolved_at)
measures:
  - name: tickets_resolved
    expr: COUNT(*)
  - name: avg_resolution_hours
    expr: AVG(resolution_hours)
  - name: max_resolution_hours
    expr: MAX(resolution_hours)
$$
